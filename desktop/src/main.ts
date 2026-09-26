import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

app.setName("BrAIn"); // otherwise userData (the projects registry) lands under the package name

// brain-mcp's own dist/index.js (its package "main") runs a CLI dispatch as a top-level side
// effect the moment it's loaded — it can't be imported as a library. Its individual core modules
// have no such side effects (verified by reading them), so those are imported directly instead,
// via dynamic import() since they're ESM and this file compiles to CommonJS (the conventional,
// best-supported module system for an Electron main process).
async function brainCore() {
  const [{ readProfile, writeProfile }, { installMcpConfig, resolveClientConfigPath }, { instructionsPathForClient, ensureAgentInstructions }, { writeLauncher }, { runHttp }] = await Promise.all([
    import("brain-mcp/dist/core/profile.js"),
    import("brain-mcp/dist/core/mcp-config.js"),
    import("brain-mcp/dist/core/agent-instructions.js"),
    import("brain-mcp/dist/core/launcher.js"),
    import("brain-mcp/dist/http/server.js"),
  ]);
  return { readProfile, writeProfile, installMcpConfig, resolveClientConfigPath, instructionsPathForClient, ensureAgentInstructions, writeLauncher, runHttp };
}

export type AiClient = "claude-code" | "cursor" | "gemini" | "local";

// "local" covers local-model runners (Ollama, LM Studio, etc.) — there's no standard MCP config
// file for those to register into, so only the plain-instructions file (AGENTS.md) gets written.
const NO_MCP_CONFIG: ReadonlySet<AiClient> = new Set(["local"]);

// Writes the MCP config (if this client has a known one) + plain-instructions file for one AI
// client. Never touches another client's files — switching client later just adds this client's
// files alongside whatever's already there, it doesn't delete the previous client's setup.
async function installForClient(root: string, aiClient: AiClient): Promise<string | undefined> {
  const { installMcpConfig, resolveClientConfigPath, instructionsPathForClient, ensureAgentInstructions } = await brainCore();
  try {
    if (!NO_MCP_CONFIG.has(aiClient)) installMcpConfig(resolveClientConfigPath(aiClient, root), root, "brain");
    const instrPath = instructionsPathForClient(aiClient, root);
    if (instrPath) ensureAgentInstructions(instrPath, "brain");
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

// --- Project registry: which folders this app has set up/opened before, so "Open Existing" has
// something to list, plus which AI client each one is currently wired for. Just a JSON file under
// userData — the same pattern as any editor's "recent projects" list. Re-reading each project's
// actual `.brain/profile.json` at list/open time (not trusting a cached copy here) means a profile
// changed via the CLI elsewhere is picked up correctly; aiClient is our own bookkeeping though
// (BrAIn itself has no concept of "which client"), so it lives only in this registry entry.
interface RegistryEntry {
  path: string;
  aiClient: AiClient;
}
function registryPath(): string {
  return path.join(app.getPath("userData"), "projects.json");
}
function loadRegistry(): RegistryEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(), "utf-8"));
    // Back-compat: registry used to be a plain string[] of paths.
    return raw.map((entry: string | RegistryEntry) => (typeof entry === "string" ? { path: entry, aiClient: "claude-code" as const } : entry));
  } catch {
    return [];
  }
}
function saveRegistry(list: RegistryEntry[]): void {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(list, null, 2), "utf-8");
}
function rememberProject(root: string, aiClient: AiClient): void {
  const list = loadRegistry().filter((e) => e.path !== root);
  list.unshift({ path: root, aiClient });
  saveRegistry(list);
}

// --- Running projects: each open project gets its own server (in-process, via runHttp) and its
// own BrowserWindow (the app is Electron — the GUI it hands off to should be a real window in it,
// not the system browser). Opening the same project twice just focuses the existing window;
// several *different* projects can be open at once, each on whatever port runHttp's own
// EADDRINUSE-retry gave it — no port bookkeeping needed here beyond remembering the result.
const runningProjects = new Map<string, { port: number; window: BrowserWindow }>();

function openProjectWindow(root: string, port: number): void {
  const existing = runningProjects.get(root);
  if (existing && !existing.window.isDestroyed()) {
    existing.window.focus();
    return;
  }
  const win = new BrowserWindow({ width: 1280, height: 860, title: `BrAIn — ${path.basename(root)}` });
  win.loadURL(`http://localhost:${port}`);
  win.on("closed", () => {
    // The server keeps running (cheap, and reopening should be instant) — only the window entry goes.
    const cur = runningProjects.get(root);
    if (cur && cur.window === win) runningProjects.set(root, { port: cur.port, window: undefined as unknown as BrowserWindow });
  });
  runningProjects.set(root, { port, window: win });
}

async function openProject(root: string): Promise<{ port: number }> {
  const already = runningProjects.get(root);
  if (already?.port && already.window && !already.window.isDestroyed()) {
    already.window.focus();
    return { port: already.port };
  }
  if (already?.port) {
    // Server's still running from before, its window was just closed — reopen the window, skip
    // starting a second server on the same project (runHttp would just bind a new port for it).
    openProjectWindow(root, already.port);
    return { port: already.port };
  }
  const { readProfile, runHttp } = await brainCore();
  const profile = readProfile(root);
  const server = await runHttp(root, 4173, false, profile);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4173;
  // Registers it if this is the first time this app's seen it (e.g. "+ Add Folder" on a project
  // already set up via the CLI) — leaves an existing entry's aiClient alone otherwise.
  if (!loadRegistry().some((e) => e.path === root)) rememberProject(root, "claude-code");
  openProjectWindow(root, port);
  return { port };
}

function createWizardWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    resizable: false,
    title: "BrAIn",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWizardWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWizardWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a project folder for BrAIn",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("has-profile", async (_event, root: string) => {
  return fs.existsSync(path.join(root, ".brain", "profile.json"));
});

ipcMain.handle("setup-project", async (_event, root: string, profile: "dev" | "notes", aiClient: AiClient) => {
  const { writeProfile, writeLauncher } = await brainCore();

  writeProfile(root, profile);
  const mcpError = await installForClient(root, aiClient);
  writeLauncher(root, 4173);
  rememberProject(root, aiClient);

  const { port } = await openProject(root);
  return { port, mcpError };
});

// Takes effect next time the project's server (re)starts — a running server already has its
// profile baked into its in-process instance, same as any other config change while it's live.
ipcMain.handle("change-profile", async (_event, root: string, profile: "dev" | "notes") => {
  const { writeProfile } = await brainCore();
  writeProfile(root, profile);
  return true;
});

ipcMain.handle("list-projects", async () => {
  const { readProfile } = await brainCore();
  return loadRegistry()
    .filter((e) => fs.existsSync(e.path))
    .map((e) => ({
      path: e.path,
      name: path.basename(e.path),
      profile: readProfile(e.path),
      aiClient: e.aiClient,
      running: runningProjects.has(e.path) && !!runningProjects.get(e.path)?.window && !runningProjects.get(e.path)!.window.isDestroyed(),
    }));
});

ipcMain.handle("open-project", async (_event, root: string) => openProject(root));

ipcMain.handle("remove-project", async (_event, root: string) => {
  saveRegistry(loadRegistry().filter((e) => e.path !== root));
  return true;
});

// Switching AI client: writes the new client's MCP config + instructions file (leaving whatever
// the previous client had in place untouched, per installForClient's contract above) and updates
// the registry entry so the projects panel reflects the new choice.
ipcMain.handle("change-ai-client", async (_event, root: string, aiClient: AiClient) => {
  const mcpError = await installForClient(root, aiClient);
  const list = loadRegistry();
  const entry = list.find((e) => e.path === root);
  if (entry) entry.aiClient = aiClient;
  else list.unshift({ path: root, aiClient });
  saveRegistry(list);
  return { mcpError };
});
