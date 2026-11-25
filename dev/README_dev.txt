ContextWeir 0.6.0.0 and PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

DEV FILES FOR CONTEXTWEIR AND PROMPTASSAY
These are for working on the tools, not for using them. Everything is Node.js or Python with
built-ins only.

headers.py
  Stamps the credit header on every text file and sets "_about" in the JSON files. It also sets
  the version and build date everywhere they are written (VERSION and BUILT in both scripts, the
  credit in each ABOUT, the version line in each help.html), and writes contextweir\schemas\.
  Edit BUILT and VER at the top, then run on a copy:  python3 headers.py <tools folder>
  It also stamps settings.json and rules.json if they exist in that copy: never copy those back
  over a real setup.

errors_to_help.js
  Writes the "Error codes" table in each help.html from that tool's lib/error_codes.js.
  Run after changing a code:  node errors_to_help.js <tools folder>

make_demo.js
  Makes demo\ (the made-up Lantern Coast card, lorebook, rule set and sessions, with flags from
  ContextWeir's own rule engine). Run after changing it:  node make_demo.js <tools folder>
  The demo is the source for screenshots and public test fixtures: never use real logs for those.

tests\
  Test suites (the UI suites drive a headless Chrome through its DevTools port).
  Run all:  node run_all.js     or name suites:  node run_all.js test_panel_api.js
  mock_model.js is a stand-in model; the suites never use a real model or SillyTavern.
  A few checks replay real logs and a real lorebook from a local copy (WS_STAGED); without that
  copy those checks fail and the rest still run.
  WS_HIDE_THANKS=1 hides the thank-you note so scripted clicks do not land on it; startTool sets
  it by default and test_remote_thanks.js turns it off to test the note.
  Never commit logs.
