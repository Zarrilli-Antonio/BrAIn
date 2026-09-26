<img src="build/icon.png" alt="" width="64" height="64" align="left" style="margin: 0 16px 16px 0" />

# BrAIn (desktop app)

A real double-clickable app for BrAIn: pick a project folder with a native folder picker, choose
dev or notes, and BrAIn is set up and running for that project — no terminal.

It's a thin GUI over BrAIn itself — lives inside the main BrAIn repo (`desktop/`), not a separate
one, since it depends on BrAIn's actual code (`file:..`) rather than just talking to it over HTTP
the way `brain-docgen` does. It calls BrAIn's core functions in-process (`writeProfile`,
`installMcpConfig`, `ensureAgentInstructions`, `writeLauncher`, `runHttp`) — the same things
`brain --init`/`brain --mode http` do from the terminal, just driven by a wizard instead of flags.
See `../README.md` for what each of those actually does.

## Requires

The parent BrAIn repo built (`cd .. && npm run build`) — this app depends on its compiled `dist/`,
not its source, since `npm install` here links `brain-mcp` straight to `..`.

## Develop

```
npm install
npm start        # builds + launches the app (electron .)
```

## Package (macOS)

```
npm run dist:mac  # -> release/BrAIn-<version>-mac.zip
```

Unsigned (no Apple Developer Program account involved) — electron-builder's own log says so
plainly ("skipped macOS application code signing"). First launch of a copy downloaded from
somewhere (not a fresh local build) may show the standard "Apple could not verify..." Gatekeeper
warning — right-click → Open once to clear it, exactly like any other free/unsigned indie Mac app.
Not a bug, not specific to this app.

## How the wizard maps to BrAIn's own concepts

| Wizard step | What it actually does |
|---|---|
| Choose folder | Native `dialog.showOpenDialog` (real OS picker, not a web directory tree) |
| Choose dev/notes | `writeProfile(root, profile)` — same `.brain/profile.json` the terminal flow writes |
| Set Up BrAIn | `installMcpConfig` + `ensureAgentInstructions` (Claude Code MCP setup) + `writeLauncher` (drops `start-brain.sh` for later, terminal-based reopening) + `runHttp` (starts the server, opens the browser) |

Everything it writes is exactly what `brain --init`/first-run `brain --mode http` would — the
project stays fully usable from the terminal afterward too, this is just an alternate front door.
