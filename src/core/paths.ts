import path from "node:path";

/** Resolve `rel` under `root`, throw if it escapes root (path traversal guard). */
export function safeResolve(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path escapes root: ${rel}`);
  }
  return resolved;
}
