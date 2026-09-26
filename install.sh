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
echo "Writing a drag-anywhere launcher..."
brain --write-launcher . >/dev/null
LAUNCHER="$(dirname "${BASH_SOURCE[0]}")/start-brain.sh"

echo
echo "BrAIn is installed. Simplest way to use it on a project: drag-and-drop"
echo "  $LAUNCHER"
echo "into that project's folder, then from a terminal there: ./start-brain.sh"
echo "First time in a new folder, it asks which profile that project is for (dev or notes) and"
echo "sets up the Claude Code MCP server for that project too — after that it just opens the browser."
