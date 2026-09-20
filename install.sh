#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Linking the global \"brain\" command..."
npm link

NPM_BIN="$(npm config get prefix)/bin"
case ":$PATH:" in
  *":$NPM_BIN:"*)
    ;;
  *)
    echo
    echo "\"$NPM_BIN\" isn't on PATH yet, so \"brain\" won't be found in a new terminal."
    RC_FILE="$HOME/.profile"
    case "$SHELL" in
      */zsh) RC_FILE="$HOME/.zshrc" ;;
      */bash) RC_FILE="$HOME/.bashrc" ;;
    esac
    LINE="export PATH=\"\$PATH:$NPM_BIN\""
    if ! grep -qxF "$LINE" "$RC_FILE" 2>/dev/null; then
      echo "$LINE" >> "$RC_FILE"
      echo "Added it to $RC_FILE — open a NEW terminal (or run: source $RC_FILE) for it to take effect."
    fi
    ;;
esac

echo
echo "BrAIn is installed. Next, for any project you want to use it with:"
echo "  brain --init /path/to/project"
echo "That writes a launcher script AND registers BrAIn as an MCP server for Claude Code, both in"
echo "one step. See README.md for other AI clients (Cursor, Claude Desktop, Windsurf, Cline)."
