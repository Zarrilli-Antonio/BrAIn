import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { makeTools } from "../core/tools.js";
import { McpLog } from "../core/mcp-log.js";

/** Times and records every call so the GUI's MCP tab can show what the AI actually did,
 *  without changing what each tool returns or how it fails. */
function withLog<Args, Result>(log: McpLog, tool: string, fn: (args: Args) => Result) {
  return async (args: Args): Promise<Result> => {
    const start = Date.now();
    try {
      const result = await fn(args);
      log.record(tool, args, true, Date.now() - start);
      return result;
    } catch (e) {
      log.record(tool, args, false, Date.now() - start, String((e as Error).message));
      throw e;
    }
  };
}

export async function runMcp(root: string) {
  const tools = makeTools(root);
  const mcpLog = new McpLog(root);
  const server = new McpServer({ name: "brain-mcp", version: "0.1.0" });
  const tool = <Args>(name: string, description: string, schema: object, fn: (args: Args) => unknown) =>
    server.tool(name, description, schema as never, withLog(mcpLog, name, fn) as never);

  tool("list_files", "List project file tree (dirs+files), respects ignore rules.", {
    subpath: z.string().default("."),
  }, ({ subpath }: { subpath: string }) => ({ content: [{ type: "text", text: JSON.stringify(tools.listFiles(subpath)) }] }));

  tool("read_file", "Read a file, optionally a line range, to avoid pulling whole files into context.", {
    path: z.string(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
  }, ({ path, startLine, endLine }: { path: string; startLine?: number; endLine?: number }) => ({
    content: [{ type: "text", text: tools.readFile(path, startLine, endLine) }],
  }));

  tool("read_files", "Read several files in one call (full content each). Cheaper than one read_file per path when you already know which files you need.", {
    paths: z.array(z.string()),
  }, ({ paths }: { paths: string[] }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.readFiles(paths)) }],
  }));

  tool("write_file", "Write/create a project file's full content. Overwrites the file — read it first if you need to preserve existing content, or use edit_file for a small change.", {
    path: z.string(),
    content: z.string(),
  }, ({ path, content }: { path: string; content: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.writeFile(path, content)) }],
  }));

  tool("edit_file", "Replace one exact string with another inside a file, without resending the whole file. old_string must match exactly once unless replaceAll is set; include enough surrounding context to make it unique.", {
    path: z.string(),
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().default(false),
  }, ({ path, oldString, newString, replaceAll }: { path: string; oldString: string; newString: string; replaceAll: boolean }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.editFile(path, oldString, newString, replaceAll)) }],
  }));

  tool("create_file", "Create a new file. Unlike write_file, this refuses to overwrite a file that already exists.", {
    path: z.string(),
    content: z.string().default(""),
  }, ({ path, content }: { path: string; content: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.createFile(path, content)) }],
  }));

  tool("create_folder", "Create a new (possibly nested) folder.", {
    path: z.string(),
  }, ({ path }: { path: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.createFolder(path)) }],
  }));

  tool("rename_path", "Rename or move a file or folder.", {
    oldPath: z.string(),
    newPath: z.string(),
  }, ({ oldPath, newPath }: { oldPath: string; newPath: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.renamePath(oldPath, newPath)) }],
  }));

  tool("delete_path", "Permanently delete a file or folder (recursively). No trash, no undo — confirm with the user before calling this.", {
    path: z.string(),
  }, ({ path }: { path: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.deletePath(path)) }],
  }));

  tool("get_symbols", "List definitions (functions, classes, methods, interfaces, types, enums) with line numbers for a file. AST-accurate for .js/.jsx/.ts/.tsx; regex-based heuristics for other languages, which can miss unusual syntax.", {
    path: z.string(),
  }, ({ path }: { path: string }) => ({ content: [{ type: "text", text: JSON.stringify(tools.getSymbols(path)) }] }));

  tool("find_references", "Find every real usage of a symbol across the project's JS/TS files, via the TypeScript language service — not a text search, so it won't confuse a same-named identifier in another scope, a comment, or a string with a genuine reference. Get `line` from get_symbols or search_code first; symbolName is matched at its first occurrence on that line. Each result says whether it's the definition or a use.", {
    path: z.string(),
    line: z.number(),
    symbolName: z.string(),
  }, ({ path, line, symbolName }: { path: string; line: number; symbolName: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.findReferences(path, line, symbolName)) }],
  }));

  tool("find_definition", "The reverse of find_references: given a use of a symbol (path, line, symbolName), jumps to where it's actually declared, via the TypeScript language service. JS/TS only.", {
    path: z.string(),
    line: z.number(),
    symbolName: z.string(),
  }, ({ path, line, symbolName }: { path: string; line: number; symbolName: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.findDefinition(path, line, symbolName)) }],
  }));

  tool("search_code", "Search project source for a string or regex, returns file:line matches. Optionally scope to a path prefix, and/or include N lines of context before/after each hit to avoid a follow-up read_file.", {
    query: z.string(),
    useRegex: z.boolean().default(false),
    pathPrefix: z.string().optional(),
    contextBefore: z.number().optional(),
    contextAfter: z.number().optional(),
    limit: z.number().optional(),
  }, ({ query, useRegex, pathPrefix, contextBefore, contextAfter, limit }: {
    query: string; useRegex: boolean; pathPrefix?: string; contextBefore?: number; contextAfter?: number; limit?: number;
  }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.searchCode(query, useRegex, { pathPrefix, contextBefore, contextAfter, limit })) }],
  }));

  tool("list_docs", "List documentation pages stored for this project.", {}, () => ({
    content: [{ type: "text", text: JSON.stringify(tools.listDocs()) }],
  }));

  tool("search_docs", "Search the content of every documentation page for a piece of text, returns doc:line matches. Use this instead of reading every doc to find which one covers something.", {
    query: z.string(),
  }, ({ query }: { query: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.searchDocs(query)) }],
  }));

  tool("docs_graph", "Graph of documentation pages linked via [[wikilinks]], for visualizing doc structure.", {}, () => ({
    content: [{ type: "text", text: JSON.stringify(tools.docsGraph()) }],
  }));

  tool("read_doc", "Read a documentation page by relative path.", {
    path: z.string(),
  }, ({ path }: { path: string }) => ({ content: [{ type: "text", text: tools.readDoc(path) }] }));

  tool("write_doc", "Write/update a documentation page (markdown) for this project.", {
    path: z.string(),
    content: z.string(),
  }, ({ path, content }: { path: string; content: string }) => ({
    content: [{ type: "text", text: JSON.stringify(tools.writeDoc(path, content)) }],
  }));

  tool("get_index_status", "Inspect the search index itself: every indexed file with its last-indexed time and line count. Useful to confirm a file is actually indexed (e.g. right after a write) or to see index staleness.", {}, () => ({
    content: [{ type: "text", text: JSON.stringify(tools.getIndexStatus()) }],
  }));

  tool("get_memory", "Persistent project notes the user wants kept in mind for every task. Call this before starting work; empty string if nothing has been written yet. Write to it with write_doc (path: \"memory.md\") when the user asks you to remember something.", {}, () => ({
    content: [{ type: "text", text: tools.getMemory() }],
  }));

  tool("get_style_guide", "Design/style reference (colors, fonts, layout conventions) to follow whenever producing graphics, charts, or UI for this project. Call this before creating any visual output; empty string if none has been written yet. Write to it with write_doc (path: \"style-guide.md\").", {}, () => ({
    content: [{ type: "text", text: tools.getStyleGuide() }],
  }));

  // Same content as get_memory/get_style_guide, also offered as resources: a client that
  // supports resource subscription can auto-attach these without the AI having to remember to
  // call a tool first. The tools stay for clients that don't.
  const resource = (name: string, uri: string, description: string, read: () => string) =>
    server.resource(name, uri, { mimeType: "text/markdown", description }, async (u) => {
      const start = Date.now();
      const text = read();
      mcpLog.record(`resource:${name}`, {}, true, Date.now() - start);
      return { contents: [{ uri: u.href, mimeType: "text/markdown", text }] };
    });

  resource("memory", "brain://memory", "Persistent project notes to keep in mind for every task.", tools.getMemory);
  resource("style-guide", "brain://style-guide", "Design/style reference to follow for any visual output.", tools.getStyleGuide);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
