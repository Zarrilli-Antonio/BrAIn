#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v brain >/dev/null 2>&1; then
  echo "BrAIn is not installed globally yet."
  echo "Run this once from the BrAIn project folder: ./install.sh (or npm link)"
  exit 1
fi

brain --mode http --root "$DIR" --port 4173 --open
