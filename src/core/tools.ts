import { buildTree, readFileChunk, writeFile, createFile, createFolder, renamePath, deletePath } from "./scan.js";
import { getSymbols } from "./symbols.js";
import { findReferences, findDefinition } from "./references.js";
import { searchCode } from "./search.js";
import { SearchIndex, SearchOptions } from "./index-store.js";
import { listDocs, readDoc, writeDoc, getDocsGraph, readDocOrEmpty, searchDocs } from "./docs.js";
import { McpLog } from "./mcp-log.js";

const MEMORY_DOC = "memory.md";
const STYLE_GUIDE_DOC = "style-guide.md";

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

/** Tool logic shared by MCP transport and HTTP connector — one implementation, two doors in. */
export function makeTools(root: string) {
  const index = new SearchIndex(root);
  const mcpLog = new McpLog(root);
  return {
    listFiles: (subpath = ".") => buildTree(root, subpath),
    readFile: (rel: string, startLine?: number, endLine?: number) => readFileChunk(root, rel, startLine, endLine),
    readFiles: (rels: string[]) => rels.map((rel) => ({ path: rel, content: readFileChunk(root, rel) })),
    writeFile: (rel: string, content: string) => {
      writeFile(root, rel, content);
      index.reindexRelative(rel);
      return { ok: true };
    },
    /** Targeted patch: replaces oldString with newString instead of resending the whole file.
     *  Throws if oldString isn't found, or matches more than once without replaceAll. */
    editFile: (rel: string, oldString: string, newString: string, replaceAll = false) => {
      const content = readFileChunk(root, rel);
      const count = countOccurrences(content, oldString);
      if (count === 0) throw new Error(`old_string not found in ${rel}`);
      if (count > 1 && !replaceAll) {
        throw new Error(`old_string appears ${count} times in ${rel}; pass replaceAll or include more surrounding context to make it unique`);
      }
      const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
      writeFile(root, rel, updated);
      index.reindexRelative(rel);
      return { ok: true };
    },
    /** Creates a new file; unlike writeFile, refuses to overwrite an existing one. */
    createFile: (rel: string, content = "") => {
      createFile(root, rel, content);
      index.reindexRelative(rel);
      return { ok: true };
    },
    createFolder: (rel: string) => {
      createFolder(root, rel);
      return { ok: true };
    },
    renamePath: (oldRel: string, newRel: string) => {
      renamePath(root, oldRel, newRel);
      index.removePathAndDescendants(oldRel);
      index.reindexPathAndDescendants(newRel);
      return { ok: true };
    },
    /** Permanently deletes a file or folder (recursively). No trash, no undo. */
    deletePath: (rel: string) => {
      deletePath(root, rel);
      index.removePathAndDescendants(rel);
      return { ok: true };
    },
    getSymbols: (rel: string) => getSymbols(root, rel),
    findReferences: (rel: string, line: number, symbolName: string) => findReferences(root, rel, line, symbolName),
    findDefinition: (rel: string, line: number, symbolName: string) => findDefinition(root, rel, line, symbolName),
    searchCode: (query: string, useRegex = false, opts: SearchOptions = {}) => searchCode(index, query, useRegex, opts),
    searchDocs: (query: string) => searchDocs(root, query),
    listDocs: () => listDocs(root),
    docsGraph: () => getDocsGraph(root),
    readDoc: (rel: string) => readDoc(root, rel),
    writeDoc: (rel: string, content: string) => {
      writeDoc(root, rel, content);
      return { ok: true };
    },
    getIndexStatus: () => index.listIndexedFiles(),
    getMcpLog: (limit?: number) => mcpLog.recent(limit),
    getMemory: () => readDocOrEmpty(root, MEMORY_DOC),
    getStyleGuide: () => readDocOrEmpty(root, STYLE_GUIDE_DOC),
  };
}

export type Tools = ReturnType<typeof makeTools>;
