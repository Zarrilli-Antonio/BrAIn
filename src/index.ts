#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { runMcp } from "./mcp/server.js";
import { runHttp } from "./http/server.js";
import { installMcpConfig, resolveClientConfigPath } from "./core/mcp-config.js";
import { instructionsPathForClient, ensureAgentInstructions } from "./core/agent-instructions.js";
import { checkForUpdate } from "./core/update-check.js";
import { isProfile, readProfile, writeProfile, Profile } from "./core/profile.js";

// Where BrAIn itself is installed (dist/index.js's own folder, one level up) — not `--root`,
// which is the unrelated project a user is pointing BrAIn *at*. This is what should be checked
// for updates, and it resolves correctly through an `npm link` symlink too.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN_INSTALL_ROOT = path.join(__dirname, "..");

/** Fire-and-forget: never blocks startup, never throws (checkForUpdate already swallows its own
 *  failures — offline, no git, no remote, all silently skipped). */
function notifyIfUpdateAvailable(): void {
  checkForUpdate(BRAIN_INSTALL_ROOT).then((info) => {
    if (!info) return;
    console.log(
      `\nA newer version of BrAIn is available (local ${info.local.slice(0, 7)}, origin ${info.remote.slice(0, 7)}).\n` +
        `Update with: git -C "${BRAIN_INSTALL_ROOT}" pull && npm --prefix "${BRAIN_INSTALL_ROOT}" install && npm --prefix "${BRAIN_INSTALL_ROOT}" run build\n`,
    );
  });
}

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
    profileFlag: get("--profile"),
    setProfile: get("--set-profile"),
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

/** Asks which profile this *project* is for — dev (full code explorer) or notes (lightweight
 *  memory/docs area, different accent color) — and stores the answer in that project's own
 *  `.brain/profile.json`. Non-interactive (no TTY, e.g. a CI/scripted --init) silently defaults
 *  to dev rather than hanging on a prompt nobody can answer. */
async function promptAndSetProfile(projectRoot: string): Promise<void> {
  if (!process.stdin.isTTY) {
    writeProfile(projectRoot, "dev");
    console.log('Profile for this project: dev (non-interactive — switch anytime with: brain --set-profile notes --root "' + projectRoot + '")');
    return;
  }
  console.log("\nWhich version of BrAIn is this project for?");
  console.log("  1) dev   - full project explorer: code search, symbols, references (default)");
  console.log("  2) notes - lightweight memory/docs area for non-code projects (marketing, company notes, ...)");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Choice [1]: ");
  rl.close();
  const profile: Profile = answer.trim() === "2" ? "notes" : "dev";
  writeProfile(projectRoot, profile);
  console.log(`Profile set to "${profile}" for this project. Override any single run with: brain --mode http --profile ${profile === "dev" ? "notes" : "dev"}`);
}

/** `client` is undefined when the caller passed --config directly instead of a known --client
 *  name — there's then no known instructions-file format to write, so that step is skipped. */
function installMcpAndReport(configPath: string, projectRoot: string, name: string, client?: string): void {
  installMcpConfig(configPath, projectRoot, name);
  console.log(`MCP config updated: ${configPath} (server "${name}", root: ${projectRoot})`);
  const instrPath = client ? instructionsPathForClient(client, projectRoot) : undefined;
  if (instrPath) {
    ensureAgentInstructions(instrPath, name);
    console.log(`Agent instructions updated: ${instrPath} (tells the AI to prefer "${name}"'s tools)`);
  }
  console.log("Restart the client for it to pick up the change.");
}

const { mode, root, port, open, init, noMcp, installMcp, client, configPath, name, profileFlag, setProfile } = parseArgs();

if (setProfile) {
  if (!isProfile(setProfile)) {
    console.error(`Unknown --set-profile "${setProfile}". Use "dev" or "notes".`);
    process.exitCode = 1;
  } else {
    writeProfile(root, setProfile);
    console.log(`Profile for ${root} set to "${setProfile}". Override any single run with: brain --mode http --root "${root}" --profile ${setProfile === "dev" ? "notes" : "dev"}`);
  }
} else if (installMcp) {
  const resolvedClient = configPath ? client : (client ?? "claude-code");
  const target = configPath ?? resolveClientConfigPath(resolvedClient!, root);
  installMcpAndReport(target, root, name, resolvedClient);
} else if (init) {
  const initRoot = path.resolve(init);
  writeLauncher(init, port);
  // Claude Code reads .mcp.json straight from the project folder, so the one command that sets
  // up the human-facing launcher also wires up the AI-facing side by default — --no-mcp skips it
  // (e.g. for a client whose config doesn't live in the project itself).
  if (!noMcp) {
    try {
      installMcpAndReport(path.join(initRoot, ".mcp.json"), initRoot, name, "claude-code");
    } catch (e) {
      console.error(`Launcher written, but MCP config setup failed: ${(e as Error).message}`);
    }
  }
  await promptAndSetProfile(initRoot);
} else if (mode === "mcp") {
  // stdout is the MCP JSON-RPC channel here — any stray console.log would corrupt it, so no
  // update notice in this mode (checkForUpdate itself is skipped, not just its output).
  runMcp(root);
} else {
  if (profileFlag && !isProfile(profileFlag)) {
    console.error(`Unknown --profile "${profileFlag}". Use "dev" or "notes". Falling back to the stored default.`);
  }
  const profile = profileFlag && isProfile(profileFlag) ? profileFlag : readProfile(root);
  notifyIfUpdateAvailable();
  runHttp(root, port, open, profile);
}
