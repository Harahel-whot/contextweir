#!/bin/bash
# ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
# Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
# Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
# Mac: double-click to start ContextWeir (unless it is already running) and open its window.
# The recorder runs in this Terminal window; close it (or press Ctrl+C) to stop.
# First time only: right-click > Open, because the file was downloaded.
cd "$(dirname "$0")/../.." || exit 1
command -v node >/dev/null || { echo "ContextWeir needs Node.js: https://nodejs.org"; exit 1; }
URL=$(node launch/where.js)
if [ -n "$URL" ]; then echo "ContextWeir is already running, so its window was only reopened. To restart it, use Restart in its window, or close its console window and start again."; launch/open-window.sh "$URL"; exit 0; fi
( URL=$(node launch/where.js --wait 15); [ -n "$URL" ] && launch/open-window.sh "$URL" ) &
exec node contextweir.js
