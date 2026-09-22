#!/usr/bin/env bash
# Double-click entry point (macOS Finder runs a .command file in Terminal) — same install.sh
# underneath, just with the double-click convenience Windows gets from a .bat for free.
cd "$(dirname "${BASH_SOURCE[0]}")"
./install.sh
echo
read -p "Press Enter to close..." _
