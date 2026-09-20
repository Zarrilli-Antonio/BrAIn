import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { safeResolve } from "./paths.js";
import { isIgnored } from "./scan.js";

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// TypeScript's language service host wants consistent forward-slash file names as its file
// identity, even on Windows — a native backslash path it was never given under that exact form
// fails lookups like findReferences() with "Could not find source file", even though the same
// path was in getScriptFileNames().
function toKey(p: string): string {
  return p.split(path.sep).join("/");
}

export interface Reference {
  path: string;
  line: number;
  text: string;
  isDefinition: boolean;
}

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (isIgnored(e.name) || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (EXTS.has(path.extname(e.name))) out.push(abs);
    }
  }
  walk(root);
  return out;
}

// ponytail: rebuilds the whole language service on every call — correct and simple, but O(project
// size) per call. Cache it (invalidated by mtime, like index-store.ts's `files` table) if this
// becomes slow on a large project.
function buildLanguageService(files: string[], fileContents: Map<string, string>): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => files,
    getScriptVersion: () => "0",
    getScriptSnapshot: (fileName) => {
      const content = fileContents.get(fileName);
      return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
    }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => fileContents.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => fileContents.get(fileName) ?? ts.sys.readFile(fileName),
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function positionOf(content: string, line: number, symbolName: string): number {
  const lines = content.split("\n");
  if (line < 1 || line > lines.length) throw new Error(`line ${line} is out of range (file has ${lines.length} lines)`);
  const col = lines[line - 1].indexOf(symbolName);
  if (col === -1) throw new Error(`"${symbolName}" not found on line ${line}`);
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
  return offset + col;
}

interface Prepared {
  service: ts.LanguageService;
  key: string;
  fileContents: Map<string, string>;
}

/** Shared setup for findReferences/findDefinition: collect project source, build a language
 *  service over it, and resolve `rel`+`line`+`symbolName` down to a service-ready position. */
function prepare(root: string, rel: string, line: number, symbolName: string, toolName: string): Prepared {
  const abs = safeResolve(root, rel);
  if (!EXTS.has(path.extname(abs))) {
    throw new Error(`${rel} is not a JS/TS file — ${toolName} only understands .js/.jsx/.ts/.tsx`);
  }
  const key = toKey(abs);

  const files = collectSourceFiles(root).map(toKey);
  const fileContents = new Map<string, string>();
  for (const f of files) {
    try {
      fileContents.set(f, fs.readFileSync(f, "utf-8"));
    } catch {
      // unreadable file (permissions, race with a delete): skip it, don't fail the whole search
    }
  }

  const content = fileContents.get(key);
  if (content === undefined) throw new Error(`${rel} could not be read`);
  positionOf(content, line, symbolName); // validates line/symbolName before building the service
  const service = buildLanguageService(files, fileContents);
  return { service, key, fileContents };
}

function lineAndTextAt(fileContents: Map<string, string>, fileName: string, start: number): { line: number; text: string } {
  const content = fileContents.get(fileName) ?? "";
  const line = content.slice(0, start).split("\n").length;
  const lines = content.split("\n");
  return { line, text: (lines[line - 1] ?? "").trim().slice(0, 200) };
}

/**
 * Real usage resolution for JS/TS via the TypeScript language service — not a text search.
 * Finds every reference to the symbol named `symbolName` at `line` in `rel` (its first
 * occurrence on that line), across the whole project, distinguishing the definition from uses.
 * A text search can't do this: it can't tell a genuine reference from a same-named identifier in
 * an unrelated scope, a comment, or a string.
 */
export function findReferences(root: string, rel: string, line: number, symbolName: string): Reference[] {
  const abs = safeResolve(root, rel);
  const content = fs.readFileSync(abs, "utf-8");
  const position = positionOf(content, line, symbolName);
  const { service, key, fileContents } = prepare(root, rel, line, symbolName, "find_references");

  const groups = service.findReferences(key, position);
  if (!groups) return [];

  const out: Reference[] = [];
  for (const group of groups) {
    for (const ref of group.references) {
      const { line: refLine, text } = lineAndTextAt(fileContents, ref.fileName, ref.textSpan.start);
      out.push({
        path: path.relative(root, ref.fileName),
        line: refLine,
        text,
        isDefinition: ref.isDefinition ?? false,
      });
    }
  }
  return out;
}

export interface Definition {
  path: string;
  line: number;
  text: string;
  name: string;
  kind: string;
}

/**
 * The reverse of findReferences: given a use of a symbol, jumps straight to where it's actually
 * declared — via the language service, so it resolves the real binding rather than guessing from
 * the name. Pairs with findReferences: one goes from a declaration to its uses, this goes from a
 * use back to its declaration.
 */
export function findDefinition(root: string, rel: string, line: number, symbolName: string): Definition[] {
  const abs = safeResolve(root, rel);
  const content = fs.readFileSync(abs, "utf-8");
  const position = positionOf(content, line, symbolName);
  const { service, key, fileContents } = prepare(root, rel, line, symbolName, "find_definition");

  const defs = service.getDefinitionAtPosition(key, position);
  if (!defs) return [];

  return defs.map((d) => {
    const { line: defLine, text } = lineAndTextAt(fileContents, d.fileName, d.textSpan.start);
    return { path: path.relative(root, d.fileName), line: defLine, text, name: d.name, kind: d.kind };
  });
}
