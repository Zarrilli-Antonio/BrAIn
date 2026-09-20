import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface McpLogEntry {
  id: number;
  ts: number;
  tool: string;
  args: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
}

/**
 * Records every MCP tool call to `.brain/mcp-log.db`. The MCP server runs as a separate
 * process (spawned over stdio by the AI client) from the HTTP/GUI server, so this has to be
 * on-disk, not in-memory, for the GUI to ever see what the AI did. SQLite's WAL mode lets one
 * process append while another reads without locking either out.
 */
export class McpLog {
  private db: DatabaseSync;

  constructor(root: string) {
    const dir = path.join(root, ".brain");
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "mcp-log.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        duration_ms INTEGER NOT NULL
      );
    `);
  }

  record(tool: string, args: unknown, ok: boolean, durationMs: number, error?: string): void {
    const argsJson = JSON.stringify(args ?? {}).slice(0, 500);
    this.db
      .prepare("INSERT INTO calls (ts, tool, args, ok, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .run(Date.now(), tool, argsJson, ok ? 1 : 0, error ?? null, durationMs);
  }

  recent(limit = 200): McpLogEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, ts, tool, args, ok, error, duration_ms AS durationMs FROM calls ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as unknown as (Omit<McpLogEntry, "ok"> & { ok: number })[];
    return rows.map((r) => ({ ...r, ok: r.ok === 1 }));
  }
}
