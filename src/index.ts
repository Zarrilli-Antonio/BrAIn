#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runMcp } from "./mcp/server.js";
import { runHttp } from "./http/server.js";
import { installMcpConfig, resolveClientConfigPath } from "./core/mcp-config.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    mode: get("--mode") ?? "http",
    root: path.resolve(get("--root") ?? process.cwd()),
    port: Number(get("--port") ?? 4173),
    open: args.includes("--open"),
    init: args.includes("--init") ? get("--init") ?? process.cwd() : undefined,
    noMcp: args.includes("--no-mcp"),
    installMcp: args.includes("--install-mcp"),
    client: get("--client"),
    configPath: get("--config"),
    name: get("--name") ?? "brain",
  };
}

/**
 * Writes a double-clickable launcher into a project folder: starts BrAIn scoped to that folder, opens the browser.
 * Calls the global `brain` command (from `npm link` in the BrAIn repo) instead of a hardcoded path, so the same
 * launcher works when copied into any project on this machine, regardless of where BrAIn itself is installed.
 * Writes a `.bat` on Windows, a `.sh` (marked executable) everywhere else.
 */
function writeLauncher(targetDir: string, port: number): void {
  const dir = path.resolve(targetDir);
  fs.mkdirSync(dir, { recursive: true });
  const isWindows = process.platform === "win32";
  const launcherPath = path.join(dir, isWindows ? "Start BrAIn.bat" : "start-brain.sh");
  fs.writeFileSync(launcherPath, isWindows ? launcherBat(port) : launcherSh(port), "utf-8");
  if (!isWindows) fs.chmodSync(launcherPath, 0o755);
  console.log(`Launcher written: ${launcherPath}`);
  console.log(
    isWindows
      ? `Double-click it to start BrAIn for this project (root: ${dir}).`
      : `Run it (./${path.basename(launcherPath)}) to start BrAIn for this project (root: ${dir}).`,
  );
}

function launcherBat(port: number): string {
  // "%~dp0." not "%~dp0": a trailing backslash right before the closing quote escapes the quote in cmd.exe parsing.
  return [
    "@echo off",
    "where brain >nul 2>nul",
    "if errorlevel 1 (",
    "  echo BrAIn is not installed globally yet.",
    "  echo Run this once from the BrAIn project folder: npm link",
    "  pause",
    "  exit /b 1",
    ")",
    `brain --mode http --root "%~dp0." --port ${port} --open`,
    "if errorlevel 1 (",
    "  echo.",
    "  echo BrAIn failed to start.",
    "  pause",
    ")",
    "",
  ].join("\r\n");
}

function launcherSh(port: number): string {
  return [
    "#!/usr/bin/env bash",
    'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    "",
    "if ! command -v brain >/dev/null 2>&1; then",
    '  echo "BrAIn is not installed globally yet."',
    '  echo "Run this once from the BrAIn project folder: ./install.sh (or npm link)"',
    "  exit 1",
    "fi",
    "",
    `brain --mode http --root "$DIR" --port ${port} --open`,
    "",
  ].join("\n");
}

function installMcpAndReport(configPath: string, projectRoot: string, name: string): void {
  installMcpConfig(configPath, projectRoot, name);
  console.log(`MCP config updated: ${configPath} (server "${name}", root: ${projectRoot})`);
  console.log("Restart the client for it to pick up the change.");
}

const { mode, root, port, open, init, noMcp, installMcp, client, configPath, name } = parseArgs();

if (installMcp) {
  const target = configPath ?? resolveClientConfigPath(client ?? "claude-code", root);
  installMcpAndReport(target, root, name);
} else if (init) {
  writeLauncher(init, port);
  // Claude Code reads .mcp.json straight from the project folder, so the one command that sets
  // up the human-facing launcher also wires up the AI-facing side by default — --no-mcp skips it
  // (e.g. for a client whose config doesn't live in the project itself).
  if (!noMcp) {
    try {
      installMcpAndReport(path.join(path.resolve(init), ".mcp.json"), path.resolve(init), name);
    } catch (e) {
      console.error(`Launcher written, but MCP config setup failed: ${(e as Error).message}`);
    }
  }
} else if (mode === "mcp") {
  runMcp(root);
} else {
  runHttp(root, port, open);
}
