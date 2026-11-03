#!/usr/bin/env bash
# Job Hunt Kit - Mac and Linux setup.  In a terminal, from this folder:   bash setup.sh
# Makes sure Node.js (22+) and Git are installed, then runs the setup (app/setup.mjs).
# Safe to run again. Options are passed through, e.g.:  bash setup.sh --provider gemini
set -u
KIT="$(cd "$(dirname "$0")" && pwd)"
red() { printf '\033[31m%s\033[0m\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"

node_ok() { has node && [ "$(node -p 'parseInt(process.versions.node)' 2>/dev/null || echo 0)" -ge 22 ]; }
if ! node_ok; then
  if [ "$OS" = "Darwin" ] && has brew; then echo "Installing Node.js with Homebrew..."; brew install node || brew upgrade node
  elif [ "$OS" = "Darwin" ]; then red "Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org (the .pkg installer), then run: bash setup.sh"; exit 1
  else red "Node.js 22 or newer is needed. On Ubuntu/Debian:"; echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"; echo "Or use nvm (https://github.com/nvm-sh/nvm): nvm install 22. Then run: bash setup.sh"; exit 1
  fi
fi
node_ok || { red "Node.js is still older than 22 ($(node -v 2>/dev/null)). Install Node 22 LTS from https://nodejs.org, then run setup again."; exit 1; }
if ! has git; then
  if [ "$OS" = "Darwin" ]; then echo "Git is needed. A window will offer to install Apple's command line tools: click Install, wait, then run: bash setup.sh"; xcode-select --install 2>/dev/null; exit 1
  else red "Git is needed. On Ubuntu/Debian: sudo apt-get install -y git   Then run: bash setup.sh"; exit 1
  fi
fi
cd "$KIT/app" && exec node setup.mjs "$@"
