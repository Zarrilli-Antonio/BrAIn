import fs from "node:fs";
import path from "node:path";

export type Profile = "dev" | "notes";
const VALID_PROFILES: Profile[] = ["dev", "notes"];

/** Where a project's chosen profile is stored — project data (like `.brain/index.db` or
 *  `.brain/docs`), not a machine-wide preference: a dev codebase and a marketing team's notes
 *  area are different *projects*, each pointed at with their own `--root`, so the choice belongs
 *  to the project, not the user. Set by `brain --init` (asks interactively) or `--set-profile`. */
export function profileConfigPath(root: string): string {
  return path.join(root, ".brain", "profile.json");
}

export function isProfile(value: string): value is Profile {
  return (VALID_PROFILES as string[]).includes(value);
}

/** "dev" if nothing was ever set for this project, or the file is missing/corrupt — the
 *  original, unbranded behavior, so a project that never ran `--init`/`--set-profile` doesn't
 *  change out from under it. */
export function readProfile(root: string): Profile {
  try {
    const data = JSON.parse(fs.readFileSync(profileConfigPath(root), "utf-8"));
    if (isProfile(data.profile)) return data.profile;
  } catch {
    // missing file, bad JSON, wrong shape — all fall through to the "dev" default below
  }
  return "dev";
}

export function writeProfile(root: string, profile: Profile): void {
  const configPath = profileConfigPath(root);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ profile }, null, 2) + "\n", "utf-8");
}
