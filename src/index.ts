#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { runMcp } from "./mcp/server.js";
import { runHttp } from "./http/server.js";
import { writeLauncher } from "./core/launcher.js";
import { installMcpConfig, resolveClientConfigPath } from "./core/mcp-config.js";
import { instructionsPathForClient, ensureAgentInstructions } from "./core/agent-instructions.js";
import { checkForUpdate } from "./core/update-check.js";
import { isProfile, readProfile, writeProfile, profileConfigPath, Profile } from "./core/profile.js";

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
    writeLauncherTo: args.includes("--write-launcher") ? get("--write-launcher") ?? process.cwd() : undefined,
    noMcp: args.includes("--no-mcp"),
    installMcp: args.includes("--install-mcp"),
    client: get("--client"),
    configPath: get("--config"),
    name: get("--name") ?? "brain",
    profileFlag: get("--profile"),
    setProfile: get("--set-profile"),
  };
}

/** Asks which profile this *project* is for — dev (full code explorer) or notes (lightweight
 *  memory/docs area, different accent color) — and stores the answer in that project's own
 *  `.brain/profile.json`. Non-interactive (no TTY, e.g. a CI/scripted --init) silently defaults
 *  to dev rather than hanging on a prompt nobody can answer. */
async function promptAndSetProfile(projectRoot: string): Promise<Profile> {
  if (!process.stdin.isTTY) {
    writeProfile(projectRoot, "dev");
    console.log('Profile for this project: dev (non-interactive — switch anytime with: brain --set-profile notes --root "' + projectRoot + '")');
    return "dev";
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
  return profile;
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

const { mode, root, port, open, init, writeLauncherTo, noMcp, installMcp, client, configPath, name, profileFlag, setProfile } = parseArgs();

if (writeLauncherTo) {
  // Unlike --init: no MCP setup, no profile prompt right now — this is for a *template* launcher
  // (installed once, then copied by hand into whatever project folder), and neither of those
  // makes sense for a location the user hasn't actually picked yet. The launcher it writes is
  // fully self-contained (resolves its own folder at run time), so the copy works unmodified;
  // the profile prompt still happens, just on that copy's first real run (see the http branch).
  writeLauncher(writeLauncherTo, port);
} else if (setProfile) {
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
  // First time BrAIn's ever pointed at this project (no --profile override, nothing stored yet):
  // ask once, right here, so a copy of the generic launcher (--write-launcher) "just works" when
  // dropped into a new folder — no separate --init/--set-profile step needed first. Also does the
  // Claude Code MCP setup for free, same as --init — an AI needs it to use BrAIn at all, and
  // that's just as true pointed at a notes project as a code one.
  if (!(profileFlag && isProfile(profileFlag)) && !fs.existsSync(profileConfigPath(root))) {
    await promptAndSetProfile(root);
    try {
      installMcpAndReport(path.join(root, ".mcp.json"), root, "brain", "claude-code");
    } catch (e) {
      console.error(`MCP setup failed: ${(e as Error).message} (retry with: brain --install-mcp --client claude-code --root "${root}")`);
    }
  }
  const profile = profileFlag && isProfile(profileFlag) ? profileFlag : readProfile(root);
  notifyIfUpdateAvailable();
  runHttp(root, port, open, profile);
}
