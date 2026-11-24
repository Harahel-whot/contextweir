#!/bin/bash
# ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
# Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
# Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir
# Opens $1 (a 127.0.0.1 address) in your default browser.
# If the default browser can show an app-style window (no tabs, no address bar), it does:
# Chrome, Edge, Brave, Vivaldi and Chromium can. Any other browser (Firefox, Safari)
# gets a normal tab instead.
URL="$1/panel?fit"   # its own address, so the browser remembers its own window size
APPWIN="--app=$URL --window-size=900,600"
if [ "$(uname)" = "Darwin" ]; then
  # The app macOS uses for web links.
  APP=$(osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("http://127.0.0.1")).path.js' 2>/dev/null)
  case "$APP" in
    *"Google Chrome"*|*"Microsoft Edge"*|*"Brave Browser"*|*Vivaldi*|*Chromium*)
      open -na "$APP" --args $APPWIN; exit 0 ;;
  esac
  open "$URL"
else
  # The browser the desktop uses for web links, e.g. google-chrome.desktop.
  DEF=$(xdg-settings get default-web-browser 2>/dev/null)
  case "$DEF" in
    *chrom*|*edge*|*brave*|*vivaldi*)
      for B in "${DEF%.desktop}" google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable brave-browser vivaldi-stable; do
        case "$B" in *chrom*|*edge*|*brave*|*vivaldi*) ;; *) continue ;; esac
        if command -v "$B" >/dev/null; then "$B" $APPWIN >/dev/null 2>&1 & exit 0; fi
      done ;;
  esac
  xdg-open "$URL" >/dev/null 2>&1 &
fi
