#!/usr/bin/env bash
# B3spoken - remove a source install (made by setup.sh). Removes the launcher; keeps your files unless you add --remove-data.
rm -f "$HOME/Applications/B3spoken.command" "$HOME/.local/share/applications/b3spoken.desktop" && echo "Removed the B3spoken launcher."
if [ "$(uname -s)" = "Darwin" ]; then D="$HOME/Library/Application Support/B3spoken"; else D="${XDG_DATA_HOME:-$HOME/.local/share}/b3spoken"; fi
case " $* " in *" --remove-data "*) rm -rf "$D"; echo "Deleted your B3spoken files in $D";; *) echo "Your files are still in $D (run with --remove-data to delete them).";; esac
