<img src="public/favicon.svg" alt="" width="64" height="64" align="left" style="margin: 0 16px 16px 0" />

# BrAIn

BrAIn lets an AI coding assistant explore and edit your project without reading whole files just to find one function, and gives it a place to keep documentation, notes, and a style guide that stick around between sessions. A browser-based explorer lets a human look at the same project — and see exactly what the AI has been doing.

It runs entirely on your own machine. No cloud service, no account, no cost beyond what's already installed.

## What it actually gives you

- **Cheaper, more precise AI exploration.** Instead of reading a whole file to find one function, the AI can list a file's definitions, jump straight to the lines it needs, search with a few lines of context, or find every real usage of a symbol — not just text that happens to match its name.
- **Safer edits.** Small changes go through a find-and-replace instead of resending the whole file. Creating a file won't silently overwrite one that's already there. Every write is confirmed to be searchable immediately, not "eventually."
- **A shared memory.** Two things the AI is told to check before starting work: a **memory** page (notes you want it to always keep in mind) and a **style guide** (design rules to follow for anything visual). Both are just files it can read and write, and they outlive any single conversation — the next session, or a different AI tool entirely, picks up where the last one left off.
- **Documentation with a memory of its own.** The AI can write structured notes as it works, linking them together the way Obsidian links notes — and you can browse the result as a graph.
- **A window into what the AI is doing.** A browser page shows the project's file tree, the docs, the graph, and — this is the part most tools don't have — a live log of every tool call the AI has actually made. If you've ever wondered "is it really using this?", this answers it.

## Install (one time, per machine)

```
git clone <this repo> BrAIn
cd BrAIn
```

**Windows:** double-click **`Install BrAIn.bat`**.
**macOS:** double-click **`install.command`**.
**Linux, or if you'd rather use a terminal on macOS:** run **`./install.sh`**.

Either one installs everything, builds it, and makes the `brain` command available everywhere on your machine — on macOS/Linux it also adds `brain` to your shell's `PATH` (`~/.zshrc`/`~/.bashrc`) if it isn't there already. This step is generic — the same `brain` command works on any project; which **profile** a given project uses is chosen per-project (below), not here.

It also drops a drag-anywhere launcher right into this folder (`start-brain.command` on macOS, `start-brain.sh` on Linux, `Start BrAIn.bat` on Windows) — the simplest way to use BrAIn on a project: drag that one file into the project's folder and double-click it there (Linux: run it from a terminal instead — `.command` only means anything to Finder). First time in a new folder it asks which profile that project is for (dev or notes — more on that below, under "Browse it yourself"); after that it just opens the browser. It's a plain template, not tied to this specific project — copy it as many times as you like.

If you'd rather see what's happening, or you're on something else entirely:

```
npm install
npm run build
npm link
```

`npm link` is what makes the `brain` command work from any folder afterward — every instruction below assumes it's been run once.

<details><summary>"brain: command not found" after installing?</summary>

Your terminal's `PATH` doesn't include npm's global folder yet — `Install BrAIn.bat`/`install.sh` fix this automatically. Doing it by hand: Windows — `setx PATH "%PATH%;%APPDATA%\npm"`; macOS/Linux — add `export PATH="$PATH:$(npm config get prefix)/bin"` to your shell's rc file (`~/.zshrc` or `~/.bashrc`). Either way, open a **new** terminal afterward.
</details>

<details><summary>macOS says it "cannot check ... for malicious software" when you open install.command or start-brain.command?</summary>

That's Gatekeeper's standard one-time warning for any script that isn't signed with a paid Apple Developer certificate — it means unsigned, not unsafe, and every unsigned `.command`/`.app` you run outside the App Store hits it once. `--write-launcher` already clears this automatically for `start-brain.command` when it can (a no-op if there was nothing to clear); if you still hit it — often because the repo was downloaded as a zip from a browser rather than `git clone`d — **Control-click (or right-click) the file → Open**, then confirm in the dialog. That's a one-time approval for that file; a plain double-click afterward works normally. By hand, from a terminal: `xattr -d com.apple.quarantine start-brain.command` (or `install.command`).
</details>

## Connect it to your AI (MCP)

This is the part that lets an AI actually use BrAIn. One command, once per project:

```
brain --install-mcp --client claude-code --root /path/to/your/project
```

Swap `claude-code` for `cursor`, or `claude-desktop` (Windows). This writes (or safely merges into) that tool's configuration file — nothing else already registered there gets touched. Restart the AI tool afterward so it notices.

For `claude-code` and `cursor` (both project-scoped), the same command also writes — or updates in place, on a rerun — a marked block in that project's own instructions file (`CLAUDE.md` for Claude Code, `.cursorrules` for Cursor) telling the AI to actually prefer BrAIn's tools over its built-in ones. Anything else already in that file, outside the marked block, is left alone. `claude-desktop`'s config isn't project-scoped, so there's no per-project file to write this into — tell it by hand there.

Don't use one of those three, or you're on macOS/Linux with Claude Desktop? Point `--config` at the exact file instead of using `--client`:

```
brain --install-mcp --config /path/to/mcp-config.json --root /path/to/your/project
```

<details><summary>What this actually writes, if you want to check or edit it by hand</summary>

```json
{
  "mcpServers": {
    "brain": {
      "command": "brain",
      "args": ["--mode", "mcp", "--root", "/path/to/your/project"]
    }
  }
}
```

Want more than one project available at once in the same AI tool? Run the command again with a different `--name` for each one.
</details>

**Getting the AI to actually use it:** connecting BrAIn doesn't by itself force your AI to prefer it over its own built-in file tools — for `claude-code`/`cursor`, `--install-mcp` already wrote that instruction into `CLAUDE.md`/`.cursorrules` for you (see above). On another client, or if `--config` was used instead of `--client`, add it yourself to your project's own instructions file — something like "use BrAIn's tools for exploring and editing this project." The MCP tab described below is how you check that it's listening.

## Browse it yourself (the GUI)

```
brain --mode http --root /path/to/your/project --port 4173
```

Then open `http://localhost:4173`. Or skip typing entirely — drag the launcher the installer already wrote (see above) into the project's folder and double-click it there, no path or flags to remember.

First time BrAIn runs on a project — whether that's the drag-and-drop launcher, `brain --mode http`, or `brain --init` below — it asks which **profile** that project is for, and does the Claude Code MCP setup below automatically (so an AI can use it too; pass `--no-mcp` to `--init` if you don't want that):

- **dev** — the full project explorer: code search, symbols, references. Green/azure brain mark.
- **notes** — same underlying tools (every MCP tool and API route works identically either way), lighter GUI for a non-code "team memory" project: marketing notes, company docs, that kind of thing. Blue/violet brain mark instead of green/azure, opens on the Docs tab instead of Files, and the Index/MCP tabs (search-index internals, AI tool-call log — dev debugging views) are hidden since they're not useful on a non-code project. Nothing is deleted — switch to `dev` and they're back.

Either way, the header shows **"‹Dev or Notes› - ‹project name›"** (and so does the browser tab title) — so if you've got more than one BrAIn tab open, it's obvious at a glance which project (and which profile) each one is.

The choice is stored per-project (`.brain/profile.json`), not machine-wide — a dev codebase and a marketing notes folder are different projects, each with their own `--root`, so each gets its own answer. Change it anytime:

```
brain --set-profile notes --root /path/to/your/project   # or dev — changes the stored default for that project
brain --mode http --root /path/to/your/project --profile notes   # or override just this one run
```

Once it's open, there are seven tabs (see [screenshot.md](screenshot.md) for what each one looks like):

| Tab | What it's for |
|---|---|
| **Files** | Browse and edit the project's actual files. Create new files or folders, rename or delete anything, right from the tree. |
| **Docs** | The documentation pages the AI has written. Click one to read or edit it, create a new one, or rename/delete an existing one — right from the list. |
| **Graph** | The same docs, drawn as a network — a link between two pages becomes a line between two nodes. Drag nodes around, click one to open it. Export the current layout as a PNG image or the raw JSON. |
| **Memory** | The persistent notes the AI is told to check before starting work. |
| **Style Guide** | The design rules the AI is told to follow for anything visual. |
| **Index** | What the search index actually contains — every file, its line count, an estimated token count, and when it was last updated, with a total (and a rough cost estimate) in the footer. Useful for confirming a change was picked up, or seeing what exploring this project actually costs. |
| **MCP** | A running log of every tool call an AI has made through MCP — what it called, with what arguments, whether it succeeded, and how long it took. |

Running several projects at once is fine — each one's launcher opens its own project on its own port (it picks the next free one automatically if `4173` is already taken by another project).

## What the AI can actually do (the tool list)

The same set of capabilities is available two ways — as MCP tools for an AI, and as a plain HTTP API (`/api/...`) for anything else, like a browser or a custom integration. Grouped by what they're for:

**Look around:** list the file tree, read a whole file or just a line range, read several files at once, list a file's functions/classes/etc. with line numbers, search the project by text or pattern (optionally with a few lines of surrounding context, or scoped to one folder), find every real usage of a symbol across the codebase, and jump from a use of a symbol straight to where it's actually declared — the last two via real code understanding, not text matching.

**Make changes:** write a file's full contents, or patch just one exact piece of text without resending the whole file. Create a new file or folder without any risk of overwriting something that's already there. Rename, move, or permanently delete a file or folder.

**Remember things:** read, write, rename, or delete documentation pages (with the `[[wikilink]]` graph described above), search across every doc's content, and read or write the memory and style guide pages.

**Check its own work:** see what the search index actually contains, and (from the GUI only, for now) see the log of what the AI has actually called.

Anything editable from a tool is also editable by hand from the GUI — open a file or doc and click **Edit**. A change made either way is picked up by search and the docs graph the same way, and other open browser tabs update live without a refresh.

## How it stays fast on a big project

Search doesn't re-scan your files every time. Every line of every source file lives in a small SQLite database (`.brain/index.db`) that BrAIn manages for you — the same technology behind a lot of desktop search tools, just running locally for your project. It updates itself incrementally as files change, survives restarts without rebuilding, and never needs to hold your whole project in memory to answer a query.

The trade-off: it currently uses an experimental (but stable) part of Node.js, so you'll see a one-line `ExperimentalWarning` when it starts. Harmless.

## Staying up to date

`brain --mode http` checks — via a quick, silent `git` comparison against `origin`, nothing phoned home — whether your local clone is behind. If it is, it prints an update notice (with the exact `git pull` / `npm install` / `npm run build` command) right in the terminal when the server starts. No network access, no git remote, or already up to date: nothing is printed, and startup is never delayed waiting on it.

## Developing BrAIn itself

```
npm run dev
```

Rebuilds automatically when you change the source, and restarts the running server so you're never testing against stale code.

```
npm test
```

Runs the test suite against a real, temporary copy of the database — nothing here is mocked.

## Known limits, honestly

- Finding every real usage of a symbol (`find_references`) and AST-accurate function/class listing only understand JavaScript and TypeScript today. Other languages fall back to a simpler, pattern-based scan that can miss unusual syntax.
- Very short search terms (under 3 characters) and pattern (regex) searches can't use the fast index — they still work, just by scanning, which is slower on a very large project.
- There's no login or access control on the browser/HTTP mode. It's built to run on your own machine — don't put it on a network anyone else can reach without adding one.
