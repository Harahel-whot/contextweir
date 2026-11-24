DEV FILES FOR THE TOOLS (not shipped to users)
Kept by the Tools chat so a new chat can carry on. Moved here from the old chat's private
workspace on 24 Nov.

headers.py
  Stamps the credit header on every text file in tools\ and sets "_about" in the JSON files.
  Since 24 Nov evening it ALSO sets the version and build date everywhere they are written:
  VERSION and BUILT in both scripts, the "versions 0.1 to x" credit in each ABOUT, the version
  line in each help.html and the README title. Edit BUILT and VER at the top, then run from a
  workspace copy:  python3 headers.py <tools folder>   (safe to run again).
  It also writes contextweir\schemas\*.schema.json (made by contextweir.js --schema) and stamps
  AI_HELPERS.md.
  Careful: it also stamps the workspace copies of settings.json and rules.json. Never copy
  those two back to the PC (the PC's own settings and rules must not be overwritten).

errors_to_help.js
  Writes the "Error codes" table in each help.html from that tool's lib/error_codes.js (between
  the ERROR CODES START / END markers). Run after changing a code:  node errors_to_help.js <tools folder>
  test_diagnostics.js checks the source, the code lists and the help pages agree.

make_demo.js
  Makes tools\demo\ (the made-up Lantern Coast card, lorebook, rule set and a 12-request session,
  with flags from ContextWeir's own rule engine). Run after changing it:  node make_demo.js <tools folder>
  test_demo.js checks it is reproduced byte for byte and holds nothing from the real logs or lorebook.
  The demo is also the source for screenshots and public test fixtures: never use real logs for those.

tests\
  Test suites (Node, built-ins only; the UI suites drive a headless Chrome through its
  DevTools port). Run all:  node run_all.js   (or name suites: node run_all.js test_panel_api.js).
  run_all.js removes each suite's old work folder first. Each suite opens with a comment
  saying what it checks. mock_model.js is a stand-in model that replays real replies; the
  suites never use the real model, SillyTavern or the game.
  The windows take a free port each start; helpers.js reads it from the console line.
  Paths: the tools are two folders up from tests\. Real data is read from a staged copy of
  the PC folders (WS_STAGED, default /mnt/user-data/uploads/SillyTavern):
    Wellspring\v0.8.0.3\testkit\logs\run_2026-11-20T17-42-53-582Z\turns\ (turns 2656-2688, 33 files)
    SillyTavern\data\default-user\worlds\ (Wellspring.json and the chat books)
    SillyTavern\data\default-user\characters\Wellspring.png, SillyTavern\package.json
  Also stage the icons (contextweir\icon\*.png/.ico, promptassay\icon\*.png/.ico): the pages
  load them, and a missing icon shows as a script error in the UI suites.
  Never ship logs. shot_kinds.js and shot_ticks.js are old one-off screenshot helpers, not
  part of run_all.js.

COPYING TO THE PC: the copy step from the Claude workspace to the PC carries TEXT only. A binary
file (PNG, ICO) arrives corrupted (24 Nov: a 2,594-byte PNG arrived as 8,364 bytes). Ship only text
files from the workspace; the icons on the PC were made earlier and must not be re-copied.

GITHUB (25 Nov): the repository is github.com/Harahel-Whot/contextweir (PRIVATE until the release
check; user, 25 Nov). .gitignore and .gitattributes sit at the top of tools\ and keep out each
user's settings.json / rules.json, running.json, *.bak, contextweir\logs\ (real prompts) and
the .lnk shortcuts. Pushes are made from a Claude workspace copy (the PC cannot run git for
Claude): stage the tools folder, make the change, push, then copy the changed TEXT files back to
the PC. Credit name in every file: Harahel-Whot (was HarahelWhot until 25 Nov).

TEST-ONLY SWITCH (25 Nov, 0.6.0.0 / 0.4.1.0): WS_HIDE_THANKS=1 hides the thank-you note in both
tools, so the UI suites' scripted clicks do not land on it. helpers.startTool sets it by default; a
suite that tests the note passes WS_HIDE_THANKS: '0'. test_remote_thanks.js covers the outside-
address setting (a stand-in model on this machine's non-loopback address counts as "another
computer"; https with a certificate made by openssl at run time) and both thank-you notes.
