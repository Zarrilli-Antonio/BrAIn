#!/usr/bin/env node
// Dev supervisor: runs `tsc --watch` and the server together, restarting the server whenever
// `dist/` changes. Fixes the class of bug where the server keeps running old code after a
// rebuild — Express routes and MCP tool registrations are fixed at process startup, so a plain
// `npm run build` never reaches an already-running process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");
const distEntry = path.join(distDir, "index.js");
const serverArgs = process.argv.slice(2);

// Run tsc's own JS entry directly via `node`, rather than the `tsc`/`npx` shell shims — those
// resolve differently enough across shells (cmd.exe vs a bash wrapper on Windows) to fail spawn
// entirely in some of them.
const tscBin = path.join(root, "node_modules", "typescript", "lib", "tsc.js");
const tsc = spawn(process.execPath, [tscBin, "--watch", "--preserveWatchOutput"], { cwd: root, stdio: "inherit" });

let child = null;
let restartQueued = false;
let debounceTimer = null;

function startServer() {
  child = spawn(process.execPath, [distEntry, ...serverArgs], { cwd: root, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    child = null;
    if (restartQueued) {
      restartQueued = false;
      startServer();
    } else if (code !== 0 && signal === null) {
      console.error(`[dev] server exited with code ${code}`);
    }
  });
}

function restartServer() {
  if (!child) {
    startServer();
    return;
  }
  restartQueued = true;
  child.kill();
}

function scheduleRestart() {
  clearTimeout(debounceTimer);
  // tsc writes multiple files per build; wait for the burst to settle before restarting once.
  debounceTimer = setTimeout(() => {
    console.log("[dev] dist/ changed, restarting BrAIn...");
    restartServer();
  }, 300);
}

fs.mkdirSync(distDir, { recursive: true });
const waitForFirstBuild = setInterval(() => {
  if (fs.existsSync(distEntry)) {
    clearInterval(waitForFirstBuild);
    console.log("[dev] starting BrAIn...");
    startServer();
    fs.watch(distDir, { recursive: true }, () => scheduleRestart());
  }
}, 300);

function shutdown() {
  clearInterval(waitForFirstBuild);
  tsc.kill();
  if (child) child.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
