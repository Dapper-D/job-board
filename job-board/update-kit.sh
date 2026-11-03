#!/usr/bin/env bash
# Job Hunt Kit - one-time updater for kits installed before the board had an Update button (version 2.0.0).
# Newer kits update from the board's Updates panel.
#   Save this file into your kit folder (the one with setup.sh and the app folder), then run:  bash update-kit.sh
# Your answers, jobs, statuses, documents and logs are kept. Nothing is installed from scratch.
set -u
REPO="Dapper-D/job-board"
API="${KIT_UPDATE_API:-https://api.github.com}"
KIT="${1:-$(cd "$(dirname "$0")" && pwd)}"
red() { printf '\033[31m%s\033[0m\n' "$1"; }
while [ ! -f "$KIT/app/package.json" ]; do
  echo "No Job Hunt Kit found in: $KIT"
  read -r -p "Paste the path of your kit folder (or press Enter to stop): " KIT
  [ -z "$KIT" ] && exit 0
done
command -v node >/dev/null || { red "Node.js not found. Run setup.sh first."; exit 1; }
[ "$(node -p 'parseInt(process.versions.node)')" -ge 22 ] || { red "Node $(node -v) is too old. Install Node 22 LTS, then run this again."; exit 1; }
[ "$(node -p "require('$KIT/app/package.json').name")" = "job-hunt-kit" ] || { red "That folder isn't a Job Hunt Kit."; exit 1; }
[ -f "$KIT/config.json" ] || { red "This kit was never set up (no config.json). Run setup.sh instead."; exit 1; }

INFO="$(curl -fsSL -H 'User-Agent: job-hunt-kit-updater' "$API/repos/$REPO/releases/latest")" || { red "Couldn't reach GitHub to find the latest version."; exit 1; }
LATEST="$(printf '%s' "$INFO" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).tag_name.replace(/^v/,'')))")"
URL="$(printf '%s' "$INFO" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).tarball_url))")"
echo "Kit folder: $KIT"
echo "Installed version: $(node -p "require('$KIT/app/package.json').version")"
echo "Latest version:    $LATEST"
echo
printf '%s' "$INFO" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s).body;if(b)console.log(\"What's new:\n\"+b+'\n')})"
read -r -p "Update now? Your answers, jobs, documents and logs are kept (y/n) [y]: " GO
case "$GO" in [nN]*) exit 0;; esac

TMP="$(mktemp -d)"
echo "Downloading..."
curl -fsSL -H 'User-Agent: job-hunt-kit-updater' -o "$TMP/release.tar.gz" "$URL" || { red "Download failed."; exit 1; }
tar -xzf "$TMP/release.tar.gz" -C "$TMP"
SRC="$(dirname "$(ls -d "$TMP"/*/app/update.mjs | head -1)")/.."
[ -f "$SRC/app/update.mjs" ] || { red "The download doesn't look like the kit."; exit 1; }
SRC="$(cd "$SRC" && pwd)"
(cd "$SRC/app" && node update.mjs --install-into "$KIT" --source "$SRC" --start-board)
CODE=$?
rm -rf "$TMP"
[ $CODE -eq 0 ] || { red "The update did not finish. Your previous version was put back. Details: logs/update.log in your kit folder."; exit 1; }
echo
echo "Done. From now on, use the Updates panel on your board (or: node app/update.mjs)."
