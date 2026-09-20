# BrAIn — Interface Overview

BrAIn runs as a local web app (`brain --mode http --root <project> --port 4173`, or the `Start BrAIn.bat` / `start-brain.sh` launcher). Opening `http://localhost:4173` shows a two-pane shell: a 280px sidebar on the left and a main content panel on the right, both rendered as dark "glass" surfaces (near-black, blurred, hairline green border) floating over a slowly drifting green/azure/violet ambient background. Below 860px width the sidebar collapses into a slide-in drawer opened with a hamburger button.

The sidebar holds seven tabs. Selecting one swaps the main panel's content; the active tab is filled solid green.

The search bar above the content panel is context-aware: on Files/Graph/Index/MCP it searches code (`search_code`), on Docs/Memory/Style Guide it searches documentation content (`search_docs`) instead. Either way, results are clickable — a code hit opens that file for editing, a doc hit opens that doc.

## Files

Shows the project's real file tree. You can browse folders, open a file to view or edit its contents, create new files/folders, and rename or delete existing ones — all directly from the tree, with changes written straight to disk.

![Files tab](screenshots/files.png)

## Docs

Lists the documentation pages the AI has written for the project. Clicking one opens it for reading or editing. Docs can link to each other with `[[wikilink]]` syntax, which is what powers the Graph tab. Shown here on a project with no docs written yet.

![Docs tab](screenshots/docs.png)

## Graph

Renders the same docs as a network: each doc is a small glowing sphere node (canvas-drawn), each `[[wikilink]]` between two docs becomes a line between their nodes. Nodes can be dragged around; clicking one opens that doc.

![Graph tab](screenshots/graph.png)

## Memory

Shows the persistent memory page — free-form notes the AI is instructed to check before starting work on the project. Editable like any other page.

![Memory tab](screenshots/memory.png)

## Style Guide

Shows the design rules (colors, spacing, components) the AI is told to follow for anything visual, e.g. `DESIGN.md`.

![Style Guide tab](screenshots/style-guide.png)

## Index

A table of what the search index actually contains: every indexed file, its line count, and when it was last updated — useful for confirming a recent change was picked up. Click a row to open that file for editing.

![Index tab](screenshots/index.png)

## MCP

A live log of every tool call an AI has made against this project through MCP: which tool, with what arguments, whether it succeeded, and how long it took. Status is shown as plain text ("ok" / "error"), not color — BrAIn's interface reserves color exclusively for its green accent.

![MCP tab](screenshots/mcp.png)
