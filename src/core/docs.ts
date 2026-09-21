import fs from "node:fs";
import path from "node:path";
import { safeResolve } from "./paths.js";

function docsDir(root: string): string {
  const dir = path.join(root, ".brain", "docs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listDocs(root: string): string[] {
  const dir = docsDir(root);
  return walk(dir, dir);
}

function walk(base: string, dir: string): string[] {
  let out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(base, abs));
    else if (e.name.endsWith(".md")) out.push(path.relative(base, abs).replace(/\\/g, "/"));
  }
  return out;
}

export function readDoc(root: string, rel: string): string {
  const dir = docsDir(root);
  const abs = safeResolve(dir, rel);
  return fs.readFileSync(abs, "utf-8");
}

/** Like readDoc, but "" instead of throwing when the doc doesn't exist yet — for pinned docs (memory, style guide) that may not have been created. */
export function readDocOrEmpty(root: string, rel: string): string {
  try {
    return readDoc(root, rel);
  } catch {
    return "";
  }
}

export function writeDoc(root: string, rel: string, content: string): void {
  const dir = docsDir(root);
  const abs = safeResolve(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

/** Deletes a doc — unlike deletePath (which refuses to touch anything under .brain/), docs are
 *  user/AI-managed content, not BrAIn's internal index, so they need their own delete alongside
 *  the existing read/write/search. Throws if rel doesn't exist, same as deletePath. */
export function deleteDoc(root: string, rel: string): void {
  const dir = docsDir(root);
  const abs = safeResolve(dir, rel);
  if (!fs.existsSync(abs)) throw new Error(`${rel} does not exist`);
  fs.rmSync(abs, { force: true });
}

/** Renames/moves a doc — same rationale as deleteDoc: the generic renamePath refuses anything
 *  under .brain/, so docs need their own. Refuses to clobber an existing doc at newRel. */
export function renameDoc(root: string, oldRel: string, newRel: string): void {
  const dir = docsDir(root);
  const oldAbs = safeResolve(dir, oldRel);
  const newAbs = safeResolve(dir, newRel);
  if (!fs.existsSync(oldAbs)) throw new Error(`${oldRel} does not exist`);
  if (fs.existsSync(newAbs)) throw new Error(`${newRel} already exists`);
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
}

export interface DocMatch {
  doc: string;
  line: number;
  text: string;
}

/** Line search across every doc's content — search_code covers project source, but nothing
 *  covered the docs themselves. A plain in-memory scan, not a SQLite index like search_code:
 *  the doc corpus is a handful to dozens of files, not thousands, so the simpler approach is the
 *  right-sized one, not a missed optimization. */
export function searchDocs(root: string, query: string): DocMatch[] {
  const needle = query.toLowerCase();
  const out: DocMatch[] = [];
  for (const doc of listDocs(root)) {
    const content = readDoc(root, doc);
    content.split("\n").forEach((text, i) => {
      if (text.toLowerCase().includes(needle)) out.push({ doc, line: i + 1, text: text.trim().slice(0, 200) });
    });
  }
  return out;
}

export interface DocGraph {
  nodes: { id: string; title: string }[];
  edges: { source: string; target: string }[];
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

/** Graph of docs linked via [[wikilinks]], for an Obsidian-style graph view. */
export function getDocsGraph(root: string): DocGraph {
  const dir = docsDir(root);
  const docs = listDocs(root);
  const byName = new Map<string, string>();
  for (const d of docs) {
    const base = d.replace(/\.md$/i, "").toLowerCase();
    byName.set(base, d);
    byName.set(path.basename(base), d);
  }
  const nodes = docs.map((d) => ({ id: d, title: d.replace(/\.md$/i, "") }));
  const edges: { source: string; target: string }[] = [];
  for (const d of docs) {
    const content = fs.readFileSync(path.join(dir, d), "utf-8");
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(content))) {
      const target = byName.get(m[1].trim().toLowerCase());
      if (target && target !== d) edges.push({ source: d, target });
    }
  }
  return { nodes, edges };
}

/** Watch .brain/docs for changes (any writer: this process or another). Returns a stop function. */
export function watchDocs(root: string, onChange: () => void): () => void {
  const dir = docsDir(root);
  // ponytail: recursive fs.watch works on Windows/macOS; on Linux it's a flat watch (subdir changes missed). Upgrade to chokidar if Linux support matters.
  const watcher = fs.watch(dir, { recursive: true }, () => onChange());
  return () => watcher.close();
}
