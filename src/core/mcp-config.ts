import fs from "node:fs";
import path from "node:path";

/** Where a known client's MCP config lives, so `--client <name>` is one word instead of a path
 *  the user has to look up. `claude-desktop` is Windows-only here — pass an explicit path
 *  on macOS/Linux (`~/Library/Application Support/Claude/...` / `~/.config/Claude/...`). */
export function resolveClientConfigPath(client: string, projectRoot: string): string {
  switch (client) {
    case "claude-code":
      return path.join(projectRoot, ".mcp.json");
    case "cursor":
      return path.join(projectRoot, ".cursor", "mcp.json");
    case "claude-desktop": {
      const appData = process.env.APPDATA;
      if (!appData) throw new Error("--client claude-desktop needs %APPDATA% (Windows); pass --config <path> instead");
      return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    default:
      throw new Error(`Unknown --client "${client}". Use claude-code, cursor, claude-desktop, or pass --config <path> directly.`);
  }
}

/**
 * Registers BrAIn as an MCP server in a client's config, merging into whatever's already there
 * instead of overwriting it — every client using this shape shares the same `mcpServers` shape,
 * so one function covers all of them. This is the step that used to mean hand-editing JSON.
 */
export function installMcpConfig(configPath: string, projectRoot: string, name: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      throw new Error(`${configPath} exists but isn't valid JSON — fix or remove it, then retry (not overwriting a file that might have other config in it)`);
    }
  }
  const mcpServers = (config.mcpServers ??= {}) as Record<string, unknown>;
  mcpServers[name] = { command: "brain", args: ["--mode", "mcp", "--root", projectRoot] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
