import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeResolve } from "./paths.js";
import { buildTree, readFileChunk, writeFile, createFile, createFolder, renamePath, deletePath } from "./scan.js";
import { getSymbols } from "./symbols.js";
import { searchCode } from "./search.js";
import { SearchIndex } from "./index-store.js";
import { listDocs, readDoc, writeDoc, deleteDoc, renameDoc, getDocsGraph, readDocOrEmpty, searchDocs } from "./docs.js";
import { makeTools } from "./tools.js";
import { McpLog } from "./mcp-log.js";
import { findReferences, findDefinition } from "./references.js";
import { installMcpConfig, resolveClientConfigPath } from "./mcp-config.js";
import { instructionsPathForClient, ensureAgentInstructions } from "./agent-instructions.js";
import { checkForUpdate } from "./update-check.js";
import { readProfile, writeProfile, isProfile, profileConfigPath } from "./profile.js";

function mkTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-test-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "export function hello() {\n  return 1;\n}\n");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "junk.js"), "noise");
  return dir;
}

test("safeResolve blocks path traversal", () => {
  const root = mkTmpProject();
  assert.throws(() => safeResolve(root, "../../etc/passwd"));
  assert.doesNotThrow(() => safeResolve(root, "src/app.js"));
});

test("buildTree ignores node_modules", () => {
  const root = mkTmpProject();
  const tree = buildTree(root);
  const names = tree.children!.map((c) => c.name);
  assert.ok(names.includes("src"));
  assert.ok(!names.includes("node_modules"));
});

test("readFileChunk slices lines", () => {
  const root = mkTmpProject();
  const chunk = readFileChunk(root, "src/app.js", 1, 1);
  assert.equal(chunk, "export function hello() {");
});

test("writeFile creates/overwrites a project file, blocks traversal and .brain writes", () => {
  const root = mkTmpProject();
  writeFile(root, "src/app.js", "export function hello() {\n  return 2;\n}\n");
  assert.equal(readFileChunk(root, "src/app.js"), "export function hello() {\n  return 2;\n}\n");
  writeFile(root, "src/new-file.js", "export const x = 1;\n");
  assert.equal(readFileChunk(root, "src/new-file.js"), "export const x = 1;\n");
  assert.throws(() => writeFile(root, "../../evil.js", "pwned"));
  assert.throws(() => writeFile(root, ".brain/index.db", "corrupt"));
});

test("createFile makes a new file but refuses to overwrite an existing one", () => {
  const root = mkTmpProject();
  createFile(root, "src/created.js", "export const x = 1;\n");
  assert.equal(readFileChunk(root, "src/created.js"), "export const x = 1;\n");
  assert.throws(() => createFile(root, "src/created.js", "overwrite"));
  assert.throws(() => createFile(root, "src/app.js")); // already exists from mkTmpProject
  assert.throws(() => createFile(root, ".brain/evil.js", "x"));
});

test("createFolder makes a nested folder but refuses to overwrite an existing path", () => {
  const root = mkTmpProject();
  createFolder(root, "src/nested/deeper");
  assert.ok(fs.statSync(path.join(root, "src", "nested", "deeper")).isDirectory());
  assert.throws(() => createFolder(root, "src")); // already exists
  assert.throws(() => createFolder(root, ".brain/evil"));
});

test("renamePath moves a file, refuses missing source, existing dest, and .brain paths", () => {
  const root = mkTmpProject();
  renamePath(root, "src/app.js", "src/renamed.js");
  assert.ok(!fs.existsSync(path.join(root, "src", "app.js")));
  assert.equal(readFileChunk(root, "src/renamed.js"), "export function hello() {\n  return 1;\n}\n");
  assert.throws(() => renamePath(root, "src/does-not-exist.js", "src/x.js"));
  createFile(root, "src/taken.js");
  assert.throws(() => renamePath(root, "src/renamed.js", "src/taken.js"));
  assert.throws(() => renamePath(root, "src/renamed.js", ".brain/evil.js"));
});

test("deletePath removes a file or folder recursively, refuses missing and .brain paths", () => {
  const root = mkTmpProject();
  deletePath(root, "src/app.js");
  assert.ok(!fs.existsSync(path.join(root, "src", "app.js")));
  createFolder(root, "src/sub");
  createFile(root, "src/sub/inner.js");
  deletePath(root, "src/sub");
  assert.ok(!fs.existsSync(path.join(root, "src", "sub")));
  assert.throws(() => deletePath(root, "src/does-not-exist.js"));
  assert.throws(() => deletePath(root, ".brain"));
});

test("getSymbols finds function", () => {
  const root = mkTmpProject();
  const syms = getSymbols(root, "src/app.js");
  assert.equal(syms.length, 1);
  assert.equal(syms[0].line, 1);
});

test("getSymbols is AST-accurate for TypeScript constructs the old regex heuristics missed", () => {
  const root = mkTmpProject();
  fs.writeFileSync(
    path.join(root, "src", "types.ts"),
    [
      "export interface User {",
      "  id: string;",
      "}",
      "",
      "export type Id = string;",
      "",
      "export enum Role { Admin, User }",
      "",
      "export class Service {",
      "  method() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "export const helper = () => 1;",
      "",
    ].join("\n"),
  );
  const syms = getSymbols(root, "src/types.ts");
  const byKind = (kind: string) => syms.filter((s) => s.kind === kind).map((s) => s.name);
  assert.deepEqual(byKind("interface"), ["User"]);
  assert.deepEqual(byKind("type"), ["Id"]);
  assert.deepEqual(byKind("enum"), ["Role"]);
  assert.deepEqual(byKind("class"), ["Service"]);
  assert.deepEqual(byKind("method"), ["method"]);
  assert.deepEqual(byKind("function"), ["helper"]);
  const service = syms.find((s) => s.kind === "class")!;
  assert.ok(service.endLine! > service.line);
});

test("findReferences resolves real cross-file usages, not same-named unrelated symbols", () => {
  const root = mkTmpProject();
  fs.writeFileSync(path.join(root, "src", "lib.js"), 'export function greet(name) {\n  return "hi " + name;\n}\n');
  fs.writeFileSync(
    path.join(root, "src", "main.js"),
    'import { greet } from "./lib.js";\nconsole.log(greet("world"));\n',
  );
  fs.writeFileSync(path.join(root, "src", "unrelated.js"), 'function greet() {\n  return "unrelated";\n}\ngreet();\n');

  const refs = findReferences(root, "src/lib.js", 1, "greet");
  const paths = refs.map((r) => r.path);
  assert.ok(paths.includes(path.join("src", "lib.js")));
  assert.ok(paths.includes(path.join("src", "main.js")));
  assert.ok(!paths.includes(path.join("src", "unrelated.js")), "a same-named symbol in an unrelated scope must not be conflated with the real one");

  const definition = refs.find((r) => r.isDefinition);
  assert.ok(definition);
  assert.equal(definition!.path, path.join("src", "lib.js"));
});

test("findReferences throws on an unknown symbol, a bad line, or a non-JS/TS file", () => {
  const root = mkTmpProject();
  assert.throws(() => findReferences(root, "src/app.js", 1, "doesNotExist"));
  assert.throws(() => findReferences(root, "src/app.js", 999, "hello"));
  fs.writeFileSync(path.join(root, "notes.md"), "# hello\n");
  assert.throws(() => findReferences(root, "notes.md", 1, "hello"));
});

test("findDefinition jumps from a use back to the real declaration, across files", () => {
  const root = mkTmpProject();
  fs.writeFileSync(path.join(root, "src", "lib.js"), 'export function greet(name) {\n  return "hi " + name;\n}\n');
  fs.writeFileSync(
    path.join(root, "src", "main.js"),
    'import { greet } from "./lib.js";\nconsole.log(greet("world"));\n',
  );
  const defs = findDefinition(root, "src/main.js", 2, "greet");
  assert.equal(defs.length, 1);
  assert.equal(defs[0].path, path.join("src", "lib.js"));
  assert.equal(defs[0].line, 1);
  assert.equal(defs[0].name, "greet");
});

test("searchCode finds match, skips node_modules", () => {
  const root = mkTmpProject();
  const hits = searchCode(new SearchIndex(root), "hello");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, path.join("src", "app.js"));
});

test("searchCode trigram index has no false negatives on substring queries", () => {
  const root = mkTmpProject();
  fs.writeFileSync(path.join(root, "src", "calling.js"), "function calling() {}\n");
  const hits = searchCode(new SearchIndex(root), "call");
  const files = hits.map((h) => h.path).sort();
  assert.deepEqual(files, [path.join("src", "calling.js")]);
});

test("searchCode falls back to a scan for sub-trigram (<3 char) queries", () => {
  const root = mkTmpProject();
  const hits = searchCode(new SearchIndex(root), "1");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "return 1;");
});

test("searchCode supports regex queries", () => {
  const root = mkTmpProject();
  const hits = searchCode(new SearchIndex(root), "hel+o", true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, path.join("src", "app.js"));
});

test("searchCode returns context lines when requested", () => {
  const root = mkTmpProject();
  const hits = searchCode(new SearchIndex(root), "return 1", false, { contextBefore: 1, contextAfter: 1 });
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].contextBefore, ["export function hello() {"]);
  assert.deepEqual(hits[0].contextAfter, ["}"]);
});

test("searchCode scopes results by pathPrefix", () => {
  const root = mkTmpProject();
  fs.mkdirSync(path.join(root, "other"));
  fs.writeFileSync(path.join(root, "other", "app.js"), "export function hello() {\n  return 1;\n}\n");
  const scoped = searchCode(new SearchIndex(root), "hello", false, { pathPrefix: "other" });
  assert.deepEqual(scoped.map((h) => h.path), [path.join("other", "app.js")]);
});

test("search index persists in .brain/index.db across SearchIndex instances", () => {
  const root = mkTmpProject();
  searchCode(new SearchIndex(root), "hello"); // builds and persists the index
  const reopened = new SearchIndex(root);
  const hits = searchCode(reopened, "hello");
  assert.equal(hits.length, 1);
  assert.ok(fs.existsSync(path.join(root, ".brain", "index.db")));
});

test("tools.writeFile is immediately searchable, without waiting on fs.watch", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.writeFile("src/new.js", "function findMeNow() {}\n");
  const hits = tools.searchCode("findMeNow");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, path.join("src", "new.js"));
});

test("tools.editFile replaces a unique match and reindexes", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.editFile("src/app.js", "return 1;", "return 42;");
  assert.equal(readFileChunk(root, "src/app.js"), "export function hello() {\n  return 42;\n}\n");
  assert.equal(tools.searchCode("return 42;").length, 1);
});

test("tools.editFile throws on no match or ambiguous match, replaceAll disambiguates", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  assert.throws(() => tools.editFile("src/app.js", "nope", "x"));
  tools.writeFile("src/dup.js", "a\na\n");
  assert.throws(() => tools.editFile("src/dup.js", "a", "b"));
  tools.editFile("src/dup.js", "a", "b", true);
  assert.equal(readFileChunk(root, "src/dup.js"), "b\nb\n");
});

test("tools.createFile creates and indexes; tools.createFolder creates without indexing", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.createFile("src/brand-new.js", "function findThisToo() {}\n");
  assert.equal(tools.searchCode("findThisToo").length, 1);
  tools.createFolder("src/empty-dir");
  assert.ok(fs.statSync(path.join(root, "src", "empty-dir")).isDirectory());
});

test("tools.renamePath moves a file's index entry, old path unsearchable, new path is", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.renamePath("src/app.js", "src/moved.js");
  const hits = tools.searchCode("hello");
  assert.deepEqual(hits.map((h) => h.path), [path.join("src", "moved.js")]);
});

test("tools.renamePath on a folder reindexes every file moved with it", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.createFolder("src/sub");
  tools.createFile("src/sub/inner.js", "function insideSub() {}\n");
  tools.renamePath("src/sub", "src/relocated");
  assert.equal(tools.searchCode("insideSub")[0].path, path.join("src", "relocated", "inner.js"));
  const status = tools.getIndexStatus();
  assert.ok(!status.some((f) => f.path.startsWith(path.join("src", "sub"))));
});

test("tools.deletePath removes a file's index entry; deleting a folder removes every nested entry", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.deletePath("src/app.js");
  assert.equal(tools.searchCode("hello").length, 0);
  tools.createFolder("src/sub");
  tools.createFile("src/sub/inner.js", "function goingAway() {}\n");
  tools.deletePath("src/sub");
  assert.equal(tools.searchCode("goingAway").length, 0);
});

test("getIndexStatus lists indexed files with line counts", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.searchCode("hello"); // touches the index so it's built
  const status = tools.getIndexStatus();
  const app = status.find((f) => f.path === path.join("src", "app.js"));
  assert.ok(app);
  assert.equal(app.lines, 4); // trailing newline in the fixture produces a trailing empty line
  assert.ok(!status.some((f) => f.path.includes("node_modules")));
});

test("tools.readFiles batches several reads in one call", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  const out = tools.readFiles(["src/app.js", "src/app.js"]);
  assert.equal(out.length, 2);
  assert.equal(out[0].content, readFileChunk(root, "src/app.js"));
});

test("McpLog records calls and lists them most-recent-first", () => {
  const root = mkTmpProject();
  const log = new McpLog(root);
  log.record("read_file", { path: "src/app.js" }, true, 5);
  log.record("delete_path", { path: "gone.js" }, false, 2, "gone.js does not exist");
  const entries = log.recent();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].tool, "delete_path");
  assert.equal(entries[0].ok, false);
  assert.equal(entries[0].error, "gone.js does not exist");
  assert.equal(entries[1].tool, "read_file");
  assert.equal(entries[1].ok, true);
  assert.ok(entries[1].args.includes("src/app.js"));
});

test("McpLog persists across instances, since the MCP process and the HTTP/GUI process are separate", () => {
  const root = mkTmpProject();
  new McpLog(root).record("write_file", { path: "x.js" }, true, 1);
  const reopened = new McpLog(root);
  assert.equal(reopened.recent().length, 1);
  assert.ok(fs.existsSync(path.join(root, ".brain", "mcp-log.db")));
});

test("tools.getMcpLog reflects what tools.* calls actually did", () => {
  const root = mkTmpProject();
  const tools = makeTools(root);
  tools.readFile("src/app.js");
  assert.equal(tools.getMcpLog().length, 0); // tools.* itself doesn't log — only the MCP transport wrapper does
});

test("docs write/read roundtrip and traversal guard", () => {
  const root = mkTmpProject();
  writeDoc(root, "overview.md", "# Overview");
  assert.deepEqual(listDocs(root), ["overview.md"]);
  assert.equal(readDoc(root, "overview.md"), "# Overview");
  assert.throws(() => writeDoc(root, "../../evil.md", "pwned"));
});

test("readDocOrEmpty returns '' for a missing doc, real content once written", () => {
  const root = mkTmpProject();
  assert.equal(readDocOrEmpty(root, "memory.md"), "");
  writeDoc(root, "memory.md", "Always use TypeScript strict mode.");
  assert.equal(readDocOrEmpty(root, "memory.md"), "Always use TypeScript strict mode.");
});

test("deleteDoc removes a doc, throws on a missing one or a traversal attempt", () => {
  const root = mkTmpProject();
  writeDoc(root, "overview.md", "# Overview");
  deleteDoc(root, "overview.md");
  assert.deepEqual(listDocs(root), []);
  assert.throws(() => deleteDoc(root, "overview.md"));
  assert.throws(() => deleteDoc(root, "../../evil.md"));
});

test("renameDoc moves a doc, refuses a missing source, an existing dest, or traversal", () => {
  const root = mkTmpProject();
  writeDoc(root, "old.md", "# Content");
  renameDoc(root, "old.md", "folder/new.md");
  assert.deepEqual(listDocs(root), ["folder/new.md"]);
  assert.equal(readDoc(root, "folder/new.md"), "# Content");

  assert.throws(() => renameDoc(root, "missing.md", "x.md"));

  writeDoc(root, "taken.md", "# Taken");
  assert.throws(() => renameDoc(root, "folder/new.md", "taken.md"));
  assert.throws(() => renameDoc(root, "folder/new.md", "../../evil.md"));
});

test("checkForUpdate returns null (never throws) for a plain folder that isn't a git repo", async () => {
  const root = mkTmpProject();
  assert.equal(await checkForUpdate(root), null);
});

test("readProfile defaults to \"dev\" when unset, missing, or corrupt; writeProfile round-trips, scoped per project root", () => {
  const root = mkTmpProject();

  assert.equal(readProfile(root), "dev"); // never set for this project yet

  writeProfile(root, "notes");
  assert.equal(readProfile(root), "notes");

  writeProfile(root, "dev");
  assert.equal(readProfile(root), "dev");

  fs.writeFileSync(profileConfigPath(root), "not valid json");
  assert.equal(readProfile(root), "dev");

  fs.writeFileSync(profileConfigPath(root), JSON.stringify({ profile: "something-else" }));
  assert.equal(readProfile(root), "dev");

  const otherRoot = mkTmpProject();
  writeProfile(root, "notes");
  assert.equal(readProfile(otherRoot), "dev"); // a different project's profile is untouched
});

test("isProfile accepts only the known profile names", () => {
  assert.equal(isProfile("dev"), true);
  assert.equal(isProfile("notes"), true);
  assert.equal(isProfile("marketing"), false);
});

test("getDocsGraph links docs via [[wikilinks]]", () => {
  const root = mkTmpProject();
  writeDoc(root, "overview.md", "# Overview\nSee [[Auth]] for details.");
  writeDoc(root, "auth.md", "# Auth");
  const graph = getDocsGraph(root);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.edges, [{ source: "overview.md", target: "auth.md" }]);
});

test("searchDocs finds a term across doc content, case-insensitively, with doc:line hits", () => {
  const root = mkTmpProject();
  writeDoc(root, "overview.md", "# Overview\nThe search index uses SQLite FTS5.\n");
  writeDoc(root, "auth.md", "# Auth\nUnrelated content.\n");
  const hits = searchDocs(root, "sqlite");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].doc, "overview.md");
  assert.equal(hits[0].line, 2);
});

test("resolveClientConfigPath knows the well-known clients, rejects unknown ones", () => {
  const root = "/some/project";
  assert.equal(resolveClientConfigPath("claude-code", root), path.join(root, ".mcp.json"));
  assert.equal(resolveClientConfigPath("cursor", root), path.join(root, ".cursor", "mcp.json"));
  assert.throws(() => resolveClientConfigPath("some-unknown-tool", root));
});

test("installMcpConfig creates a fresh config and merges into an existing one without touching other servers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-mcp-config-"));
  const configPath = path.join(dir, ".mcp.json");

  installMcpConfig(configPath, "/project/a", "brain");
  let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.deepEqual(config.mcpServers.brain, { command: "brain", args: ["--mode", "mcp", "--root", "/project/a"] });

  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { "other-tool": { command: "other", args: ["--x"] } } }));
  installMcpConfig(configPath, "/project/b", "brain");
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.deepEqual(config.mcpServers["other-tool"], { command: "other", args: ["--x"] });
  assert.deepEqual(config.mcpServers.brain, { command: "brain", args: ["--mode", "mcp", "--root", "/project/b"] });
});

test("installMcpConfig refuses to clobber a config file that isn't valid JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-mcp-config-"));
  const configPath = path.join(dir, ".mcp.json");
  fs.writeFileSync(configPath, "{not valid json");
  assert.throws(() => installMcpConfig(configPath, "/project/a", "brain"));
  assert.equal(fs.readFileSync(configPath, "utf-8"), "{not valid json");
});

test("instructionsPathForClient knows claude-code and cursor, has nothing for claude-desktop", () => {
  const root = "/some/project";
  assert.equal(instructionsPathForClient("claude-code", root), path.join(root, "CLAUDE.md"));
  assert.equal(instructionsPathForClient("cursor", root), path.join(root, ".cursorrules"));
  assert.equal(instructionsPathForClient("claude-desktop", root), undefined);
});

test("ensureAgentInstructions creates a fresh file, updates its block in place on rerun, and leaves the rest of an existing file alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-agent-instructions-"));
  const file = path.join(dir, "CLAUDE.md");

  ensureAgentInstructions(file, "brain");
  const first = fs.readFileSync(file, "utf-8");
  assert.match(first, /Use its tools instead of built-in file tools/);

  fs.writeFileSync(file, `# My Project\n\nSome notes I wrote.\n\n${first}`);
  ensureAgentInstructions(file, "brain");
  const second = fs.readFileSync(file, "utf-8");
  assert.match(second, /Some notes I wrote\./);
  assert.equal(countOccurrences(second, "<!-- brain-mcp:brain -->"), 1);
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
