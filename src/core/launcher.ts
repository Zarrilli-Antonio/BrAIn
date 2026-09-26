import fs from "node:fs";
import path from "node:path";

/**
 * Writes a launcher into a project folder: starts BrAIn scoped to that folder, opens the browser.
 * Calls the global `brain` command (from `npm link` in the BrAIn repo) instead of a hardcoded path, so the same
 * launcher works when copied into any project on this machine, regardless of where BrAIn itself is installed.
 * Writes a double-clickable `.bat` on Windows; a plain `.sh` (marked executable, run from a terminal) on
 * macOS/Linux — a `.command` would be double-clickable too, but Gatekeeper blocks an unsigned one's first
 * Finder launch ("Apple cannot check it for malicious software"), and code-signing isn't worth it here.
 */
export function writeLauncher(targetDir: string, port: number): void {
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
