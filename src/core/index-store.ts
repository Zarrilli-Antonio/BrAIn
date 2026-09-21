import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { isIgnored } from "./scan.js";

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".exe", ".dll", ".woff", ".woff2"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // ponytail: skip indexing huge generated files, raise if a project legitimately needs it
const REGEX_SCAN_BATCH = 2000;

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface SearchOptions {
  limit?: number;
  pathPrefix?: string;
  contextBefore?: number;
  contextAfter?: number;
}

interface Row {
  path: string;
  line_no: number;
  text: string;
}

/**
 * SQLite-backed search index at `.brain/index.db`: persists across restarts and scales to
 * large codebases without holding file content in memory. FTS5 with the trigram tokenizer
 * gives correct, indexed substring search (same semantics as plain string search, but fast).
 * Node's built-in `node:sqlite` — no new dependency.
 *
 * `line_content` mirrors `lines` in a plain (non-virtual) table keyed on (path, line_no) so
 * fetching a few lines of context around a hit is an indexed point lookup, not a full FTS scan.
 */
export class SearchIndex {
  private db: DatabaseSync;
  private ready = false;

  constructor(private root: string) {
    const dir = path.join(root, ".brain");
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "index.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(path UNINDEXED, line_no UNINDEXED, text, tokenize='trigram');
      CREATE TABLE IF NOT EXISTS line_content (path TEXT NOT NULL, line_no INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (path, line_no));
    `);
  }

  ensureReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.walk(this.root);
    try {
      const watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (filename) this.onFsEvent(filename);
      });
      watcher.unref(); // don't keep the process (or a test runner) alive just for this watch
    } catch {
      // recursive fs.watch unsupported on this platform (older Linux): index stays correct until restart
      // for changes made outside BrAIn's own tools. Writes made through writeFile/editFile stay correct
      // regardless, since those call reindexRelative() directly instead of waiting for this watcher.
    }
  }

  /** Index this one file immediately. Used right after writeFile/editFile so a just-written
   *  file is searchable without waiting on the fs.watch callback (which may lag, or on some
   *  platforms never fire at all — see ensureReady). */
  reindexRelative(rel: string): void {
    this.ensureReady();
    this.indexFile(path.join(this.root, rel));
  }

  /** Removes rel from the index, and — if it was a directory — every indexed path nested under it.
   *  Used after a delete or as the first half of a rename/move. */
  removePathAndDescendants(rel: string): void {
    this.ensureReady();
    // Normalize first: stored paths use path.relative()'s OS separator, but callers (the GUI, an
    // AI client) commonly pass "/" regardless of platform.
    const normalized = path.normalize(rel);
    const prefix = normalized + path.sep;
    const rows = this.db.prepare("SELECT path FROM files").all() as unknown as { path: string }[];
    for (const r of rows) {
      if (r.path === normalized || r.path.startsWith(prefix)) this.removeFile(r.path);
    }
  }

  /** Re-indexes rel — and, if it's now a directory, everything under it — used as the second half
   *  of a rename/move, since the old paths under the old name are already gone. */
  reindexPathAndDescendants(rel: string): void {
    this.ensureReady();
    const abs = path.join(this.root, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return;
    }
    if (stat.isDirectory()) this.walk(abs);
    else this.indexFile(abs);
  }

  /** Inspects the index itself: every indexed file, its last-indexed mtime, line count, and
   *  character count (the GUI turns the latter into a ~tokens estimate — 4 chars/token is the
   *  usual rule of thumb, and exact tokenization isn't worth a tokenizer dependency here). */
  listIndexedFiles(): { path: string; mtimeMs: number; lines: number; chars: number }[] {
    this.ensureReady();
    const rows = this.db
      .prepare(
        `SELECT f.path AS path, f.mtime_ms AS mtimeMs, COUNT(lc.line_no) AS lines, COALESCE(SUM(LENGTH(lc.text)), 0) AS chars
         FROM files f LEFT JOIN line_content lc ON lc.path = f.path
         GROUP BY f.path, f.mtime_ms
         ORDER BY f.path`,
      )
      .all() as unknown as { path: string; mtimeMs: number; lines: number; chars: number }[];
    return rows;
  }

  private walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (isIgnored(e.name) || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) this.walk(abs);
      else if (e.isFile() && !BINARY_EXT.has(path.extname(e.name))) this.indexFile(abs);
    }
  }

  private indexFile(abs: string): void {
    const rel = path.relative(this.root, abs);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return;
    }
    if (stat.size > MAX_FILE_BYTES) return;
    const row = this.db.prepare("SELECT mtime_ms FROM files WHERE path = ?").get(rel) as
      | { mtime_ms: number }
      | undefined;
    if (row && row.mtime_ms === stat.mtimeMs) return;
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      return;
    }
    const lines = content.split("\n");
    const insertLine = this.db.prepare("INSERT INTO lines (path, line_no, text) VALUES (?, ?, ?)");
    const insertContent = this.db.prepare("INSERT INTO line_content (path, line_no, text) VALUES (?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM lines WHERE path = ?").run(rel);
      this.db.prepare("DELETE FROM line_content WHERE path = ?").run(rel);
      lines.forEach((text, i) => {
        insertLine.run(rel, i + 1, text);
        insertContent.run(rel, i + 1, text);
      });
      this.db
        .prepare("INSERT INTO files (path, mtime_ms) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms")
        .run(rel, stat.mtimeMs);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private removeFile(rel: string): void {
    this.db.exec("BEGIN");
    this.db.prepare("DELETE FROM lines WHERE path = ?").run(rel);
    this.db.prepare("DELETE FROM line_content WHERE path = ?").run(rel);
    this.db.prepare("DELETE FROM files WHERE path = ?").run(rel);
    this.db.exec("COMMIT");
  }

  private onFsEvent(relRaw: string): void {
    if (relRaw.split(path.sep).some((s) => isIgnored(s) || s.startsWith("."))) return;
    const abs = path.join(this.root, relRaw);
    if (!fs.existsSync(abs)) {
      this.removeFile(relRaw);
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return;
    }
    if (stat.isDirectory() || BINARY_EXT.has(path.extname(relRaw))) return;
    this.indexFile(abs);
  }

  search(query: string, useRegex: boolean, opts: SearchOptions = {}): SearchMatch[] {
    this.ensureReady();
    const limit = opts.limit ?? 200;
    let rows: Row[];
    if (useRegex) {
      rows = this.scanWithPredicate((text) => new RegExp(query).test(text), limit, opts.pathPrefix);
    } else if (query.length < 3) {
      // FTS5 trigram can't index substrings shorter than 3 chars — fall back to a full scan for those.
      const needle = query.toLowerCase();
      rows = this.scanWithPredicate((text) => text.toLowerCase().includes(needle), limit, opts.pathPrefix);
    } else {
      rows = this.searchFts(query, limit, opts.pathPrefix);
    }
    return this.attachContext(rows, opts.contextBefore ?? 0, opts.contextAfter ?? 0);
  }

  private searchFts(query: string, limit: number, pathPrefix?: string): Row[] {
    const phrase = `"${query.replace(/"/g, '""')}"`;
    // `LIKE` against this FTS5 virtual table's UNINDEXED column returns nothing on this SQLite
    // build, MATCH or not — filter pathPrefix in JS instead, over a wider internal fetch.
    const fetchLimit = pathPrefix ? Math.max(limit * 10, 500) : limit;
    const rows = this.db
      .prepare("SELECT path, line_no, text FROM lines WHERE lines MATCH ? ORDER BY rank LIMIT ?")
      .all(phrase, fetchLimit) as unknown as Row[];
    const filtered = pathPrefix ? rows.filter((r) => r.path.startsWith(pathPrefix)) : rows;
    return filtered.slice(0, limit).map((r) => ({ path: r.path, line_no: r.line_no, text: r.text.trim().slice(0, 300) }));
  }

  /** Row-by-row scan over the indexed lines, in DB-sized batches so memory stays bounded regardless of project size. */
  private scanWithPredicate(matches: (text: string) => boolean, limit: number, pathPrefix?: string): Row[] {
    const out: Row[] = [];
    const stmt = this.db.prepare("SELECT path, line_no, text FROM lines ORDER BY rowid LIMIT ? OFFSET ?");
    let offset = 0;
    for (;;) {
      const rows = stmt.all(REGEX_SCAN_BATCH, offset) as unknown as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        if (out.length >= limit) return out;
        if (pathPrefix && !r.path.startsWith(pathPrefix)) continue;
        if (matches(r.text)) out.push({ path: r.path, line_no: r.line_no, text: r.text.trim().slice(0, 300) });
      }
      offset += rows.length;
    }
    return out;
  }

  /** Fetches before/after lines for each hit via an indexed (path, line_no) point lookup — cheap even for many hits. */
  private attachContext(rows: Row[], before: number, after: number): SearchMatch[] {
    if (!before && !after) return rows.map((r) => ({ path: r.path, line: r.line_no, text: r.text }));
    const stmt = this.db.prepare("SELECT line_no, text FROM line_content WHERE path = ? AND line_no BETWEEN ? AND ? ORDER BY line_no");
    return rows.map((r) => {
      const from = Math.max(1, r.line_no - before);
      const to = r.line_no + after;
      const ctx = stmt.all(r.path, from, to) as { line_no: number; text: string }[];
      const match: SearchMatch = { path: r.path, line: r.line_no, text: r.text };
      if (before) match.contextBefore = ctx.filter((c) => c.line_no < r.line_no).map((c) => c.text);
      if (after) match.contextAfter = ctx.filter((c) => c.line_no > r.line_no).map((c) => c.text);
      return match;
    });
  }
}
