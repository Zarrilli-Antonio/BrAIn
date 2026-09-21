import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);
const GIT_TIMEOUT_MS = 4000;

export interface UpdateInfo {
  local: string;
  remote: string;
}

/**
 * Compares the local HEAD commit against origin's, purely via `git` — no GitHub API, no account,
 * no new dependency. Returns null on anything that isn't a clean "yes, they differ": not a git
 * repo, no remote configured, offline, git missing, or timed out. This is meant to nudge someone
 * running an old clone to update, not to track ahead/behind or verify a fast-forward is possible.
 */
export async function checkForUpdate(root: string): Promise<UpdateInfo | null> {
  try {
    const { stdout: remoteUrlOut } = await pExecFile("git", ["config", "--get", "remote.origin.url"], { cwd: root, timeout: GIT_TIMEOUT_MS });
    const remoteUrl = remoteUrlOut.trim();
    if (!remoteUrl) return null;

    const [{ stdout: localOut }, { stdout: remoteOut }] = await Promise.all([
      pExecFile("git", ["rev-parse", "HEAD"], { cwd: root, timeout: GIT_TIMEOUT_MS }),
      pExecFile("git", ["ls-remote", remoteUrl, "HEAD"], { cwd: root, timeout: GIT_TIMEOUT_MS }),
    ]);
    const local = localOut.trim();
    const remote = remoteOut.split(/\s+/)[0]?.trim();
    if (!local || !remote || local === remote) return null;
    return { local, remote };
  } catch {
    return null;
  }
}
