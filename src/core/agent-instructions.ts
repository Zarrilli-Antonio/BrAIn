import fs from "node:fs";
import path from "node:path";

/** Where a known client keeps its plain-language project instructions, if it has one scoped to
 *  a project at all — claude-desktop's config is one file for the whole machine, not per-project,
 *  so there's nothing to write there. */
export function instructionsPathForClient(client: string, projectRoot: string): string | undefined {
  switch (client) {
    case "claude-code":
      return path.join(projectRoot, "CLAUDE.md");
    case "cursor":
      return path.join(projectRoot, ".cursorrules");
    default:
      return undefined;
  }
}

function startMarker(name: string): string {
  return `<!-- brain-mcp:${name} -->`;
}
function endMarker(name: string): string {
  return `<!-- /brain-mcp:${name} -->`;
}

function block(name: string): string {
  return [
    startMarker(name),
    "## BrAIn",
    "",
    `MCP server "${name}" is connected for this project. Use its tools instead of built-in file tools:`,
    "",
    "- Exploring: list_files, read_file, read_files, get_symbols, search_code, find_references, find_definition.",
    "- Editing: write_file, edit_file, create_file, create_folder, rename_path, delete_path.",
    "- Before starting work, check get_memory (persistent project notes) and get_style_guide (design rules).",
    "- Keep ongoing notes with write_doc (.brain/docs/*.md, [[wikilink]]-linked); save long-term notes to memory.md.",
    endMarker(name),
  ].join("\n");
}

/**
 * Writes (or, on a second run, updates in place) a marked BrAIn block inside a client's plain
 * instructions file — same "merge, don't clobber" contract as installMcpConfig, just for a
 * markdown file instead of JSON: content outside the markers (the user's own project notes) is
 * left untouched, and re-running --install-mcp updates the block instead of duplicating it.
 */
export function ensureAgentInstructions(filePath: string, serverName: string): void {
  const newBlock = block(serverName);
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    // no existing file — write a fresh one below
  }
  const start = startMarker(serverName);
  const end = endMarker(serverName);
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  const updated =
    startIdx !== -1 && endIdx !== -1
      ? existing.slice(0, startIdx) + newBlock + existing.slice(endIdx + end.length)
      : existing.trim().length > 0
        ? existing.trimEnd() + "\n\n" + newBlock + "\n"
        : newBlock + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, updated, "utf-8");
}
