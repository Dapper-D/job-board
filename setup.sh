#!/usr/bin/env bash
# B3spoken - Mac and Linux setup from source (every file it runs is in this folder). In a terminal:  bash setup.sh
# What it does, and nothing else:
#   1. Checks Node.js 22 or newer is installed (it tells you how to install it if not).
#   2. Adds a launcher: Linux: ~/.local/share/applications/b3spoken.desktop; Mac: ~/Applications/B3spoken.command
#      Both run: node "<this folder>/b3spoken/src/helper/main.mjs"
#   3. Starts B3spoken, which opens in your browser at http://127.0.0.1:4747  (add --no-launch to skip)
# Your own files are kept in ~/Library/Application Support/B3spoken (Mac) or ~/.local/share/b3spoken (Linux).
# To remove it: bash uninstall.sh.  This is NOT the old Job Hunt Kit setup (that one lives on the main branch).
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
HELPER="$ROOT/b3spoken/src/helper/main.mjs"
red() { printf '\033[31m%s\033[0m\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }
[ -f "$HELPER" ] || { red "Can't find $HELPER. Run this from the folder you downloaded B3spoken into."; exit 1; }
node_ok() { has node && [ "$(node -p 'parseInt(process.versions.node)' 2>/dev/null || echo 0)" -ge 22 ]; }
if ! node_ok; then
  if [ "$(uname -s)" = "Darwin" ] && has brew; then echo "Installing Node.js with Homebrew..."; brew install node || brew upgrade node
  else red "Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org (Mac: the .pkg installer; Linux: your package manager or nvm), then run: bash setup.sh"; exit 1
  fi
fi
node_ok || { red "Node.js is older than 22 ($(node -v 2>/dev/null)). Install Node 22 LTS from https://nodejs.org, then run setup again."; exit 1; }
NODE="$(command -v node)"
echo "Node.js $(node -v): $NODE"
if [ "$(uname -s)" = "Darwin" ]; then
  mkdir -p "$HOME/Applications"; L="$HOME/Applications/B3spoken.command"
  printf '#!/bin/bash\nexec "%s" "%s"\n' "$NODE" "$HELPER" > "$L"; chmod +x "$L"
else
  mkdir -p "$HOME/.local/share/applications"; L="$HOME/.local/share/applications/b3spoken.desktop"
  printf '[Desktop Entry]\nType=Application\nName=B3spoken\nComment=Open B3spoken\nExec="%s" "%s"\nTerminal=true\n' "$NODE" "$HELPER" > "$L"
fi
echo "Launcher: $L"
case " $* " in *" --no-launch "*) echo "Done."; exit 0;; esac
echo "Starting B3spoken. It opens in your browser; keep this window open while you use it."
cd "$ROOT" && exec "$NODE" "$HELPER"
