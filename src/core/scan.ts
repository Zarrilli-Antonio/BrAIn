import fs from "node:fs";
import path from "node:path";
import { safeResolve } from "./paths.js";

// ponytail: hardcoded ignore list, upgrade to .gitignore parsing if projects need custom rules
const DEFAULT_IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".brain", ".venv", "__pycache__", ".next", "target",
]);

export interface TreeNode {
  name: string;
  type: "file" | "dir";
  path: string; // relative to root
  children?: TreeNode[];
}

export function buildTree(root: string, subpath = ".", maxDepth = 8): TreeNode {
  const abs = safeResolve(root, subpath);
  return walk(root, abs, maxDepth);
}

function walk(root: string, abs: string, depth: number): TreeNode {
  const rel = path.relative(root, abs) || ".";
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    return { name: path.basename(abs), type: "file", path: rel };
  }
  const node: TreeNode = { name: path.basename(abs) || rel, type: "dir", path: rel, children: [] };
  if (depth <= 0) return node;
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => !DEFAULT_IGNORE.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    node.children!.push(walk(root, path.join(abs, e.name), depth - 1));
  }
  return node;
}

export function readFileChunk(root: string, rel: string, startLine?: number, endLine?: number): string {
  const abs = safeResolve(root, rel);
  const content = fs.readFileSync(abs, "utf-8");
  if (startLine === undefined && endLine === undefined) return content;
  const lines = content.split("\n");
  const start = Math.max(0, (startLine ?? 1) - 1);
  const end = Math.min(lines.length, endLine ?? lines.length);
  return lines.slice(start, end).join("\n");
}

export function isIgnored(name: string): boolean {
  return DEFAULT_IGNORE.has(name);
}

function assertNotBrainPath(root: string, abs: string): void {
  if (path.relative(root, abs).split(path.sep)[0] === ".brain") {
    throw new Error("Refusing to write inside .brain/ (BrAIn's own index and docs storage)");
  }
}

export function writeFile(root: string, rel: string, content: string): void {
  const abs = safeResolve(root, rel);
  assertNotBrainPath(root, abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

/** Like writeFile, but refuses to clobber an existing path — for the GUI/AI "create new" action. */
export function createFile(root: string, rel: string, content = ""): void {
  const abs = safeResolve(root, rel);
  assertNotBrainPath(root, abs);
  if (fs.existsSync(abs)) throw new Error(`${rel} already exists`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

export function createFolder(root: string, rel: string): void {
  const abs = safeResolve(root, rel);
  assertNotBrainPath(root, abs);
  if (fs.existsSync(abs)) throw new Error(`${rel} already exists`);
  fs.mkdirSync(abs, { recursive: true });
}

export function renamePath(root: string, oldRel: string, newRel: string): void {
  const oldAbs = safeResolve(root, oldRel);
  const newAbs = safeResolve(root, newRel);
  assertNotBrainPath(root, oldAbs);
  assertNotBrainPath(root, newAbs);
  if (!fs.existsSync(oldAbs)) throw new Error(`${oldRel} does not exist`);
  if (fs.existsSync(newAbs)) throw new Error(`${newRel} already exists`);
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
}

/** Permanently deletes a file or folder (recursively). No trash, no undo. */
export function deletePath(root: string, rel: string): void {
  const abs = safeResolve(root, rel);
  assertNotBrainPath(root, abs);
  if (!fs.existsSync(abs)) throw new Error(`${rel} does not exist`);
  fs.rmSync(abs, { recursive: true, force: true });
}
