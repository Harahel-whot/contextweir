ContextWeir 0.6.0.0 and PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
Licence: CC BY 4.0 (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

CONTEXTWEIR AND PROMPTASSAY  (prototypes: ContextWeir 0.6.0.0 and PromptAssay 0.4.1.0, built 25 Nov 2026)
=====================================================================================
Two small tools for seeing exactly what your chat frontend sends to your model.

  ContextWeir   the recorder. Sits between SillyTavern (or any OpenAI-compatible
                frontend) and your model server on this computer, passes
                everything through unchanged, and saves each request and reply
                exactly as sent. Checks every turn against flag rules
                (rules.json). Run from its control panel. Local models by
                default; since 0.6 a model server on another computer or a
                cloud service can be allowed, after a warning about the risk.
  PromptAssay   the reader. Opens those logs in a window and takes each request
                apart: every message as a labelled section with its size, which
                lorebook entries and card fields are in it, what entered or left
                since the previous turn, and where the flag rules fired.

Both need Node.js (https://nodejs.org). Nothing else is installed: no packages,
no downloads. Both open as their own app-style window (Edge or Chrome "app mode")
or, if neither browser is found, as a normal browser tab.


WHAT TO CLICK
-------------
Windows: double-click "Create Shortcuts (Windows).bat" once. It makes a
ContextWeir and a PromptAssay shortcut, with their icons, in this folder (and on
your desktop if you say yes). From then on, double-click a shortcut.
Without shortcuts: each tool's folder has one file to double-click,
"Start ContextWeir.bat" or "Start PromptAssay.bat". It starts the tool if it is
not running yet and opens its window; if it is already running, it only opens
the window again and says so (to restart ContextWeir, use Restart in its panel).
Mac: launch\mac\ in each tool's folder (first time: right-click > Open).
Linux: launch/linux/ in each tool's folder.
Everything else in launch\ is used by those files; you never need to open it.

TRYING THEM
-----------
PromptAssay on the old logs (safe any time; it only reads):
  1. Start PromptAssay. A window opens on the newest session. The drop-down at
     the top picks sessions; old logger runs are marked "(old logger)".
  2. Click any request on the left, or any mark on the timeline. Arrow keys move
     between requests. "flagged only" and the rule filter narrow the list.
  3. Click any tag on a section (a lorebook entry, a card field, the summary) to
     see exactly what it put into the prompt: the text as sent, with macros
     such as {{user}} filled in, its size, and where it sits. "Show in the
     prompt" opens the message and marks it there. Entries listed under
     "+ entered" can be clicked the same way.

ContextWeir in front of the game (needs SillyTavern free on the board):
  1. Start ContextWeir. Its console shows each turn; its control panel opens on
     the start screen. Check the Connection tab (Check the receiving port, Test
     the model server), then press Start.
  2. In SillyTavern, point the API URL at  http://127.0.0.1:5012/v1  (the old
     logger used 5002; the prototype uses 5012 so both can exist side by side).
  3. Play a few turns. PromptAssay shows the new session at the top of its list,
     with the SillyTavern and model server versions it was recorded with (set
     the SillyTavern folder on ContextWeir's Logs tab for the SillyTavern one).
  4. To go back: point SillyTavern at the old URL again and press Quit in the
     panel.

Both windows have a Help button (the full guide; the same text ships as help.html
in each tool's folder) and an About button (version, what it was tested with, and
who wrote it). SECURITY.txt in this folder sums up the security review.

THE CONTROL PANEL (ContextWeir's window, since 0.5)
  - Buttons: Start (opens the receiving port, new session), Pause / Resume
    (turns still pass through, nothing saved), Stop (closes the port; the panel
    stays), Restart (applies saved settings, new session), Quit (closes ContextWeir,
    its console and the panel window). Closing only the panel window keeps
    ContextWeir recording; its Start file brings the panel back.
  - Tabs: Status (the start screen, or the running session with versions and
    numbers), Connection, Logs, Rules, Advanced. Help and About on every tab.
  - Each setting says "applies now" or "needs Restart"; a yellow bar with a
    "Restart now" button appears while saved settings wait for Restart.
  - Keyboard shortcuts: Alt+S start, Alt+P pause/resume, Alt+R restart,
    Alt+1-5 tabs, ? the list. PromptAssay: arrows to move between requests
    (Shift for flagged ones), Home/End, F flagged only, L live, 0-3 kinds, E open
    all sections, ? the list; and Previous / Next buttons on each request.
  - "Skip this screen next time" starts recording as soon as ContextWeir opens.
    The start screen still comes back if the receiving port is taken: the port
    never moves on its own, because your frontend is set to it.

THE RULES (the Rules tab of the panel)
  - Tick or untick a rule, or a whole set, to switch it on or off without
    deleting it. Changes save straight away and apply from the next turn.
  - "+ New set", Rename, Delete set; "+ Add rule", Edit, Delete for rules.
  - The rule editor is dropdowns: [the reply] [contains] [text]. Patterns
    (regex) are the "advanced" tests. Add exceptions ("...unless the last
    message starts with [Private system request") and a note saying why the
    rule exists; the note is kept when the set is shared.
  - Export all sets, or one set, as a small .json file to share. Import shows
    what the file holds, and what will be refused, before anything is saved;
    then either add it beside your sets or replace yours.
  - Each save keeps the previous rules.json as rules.json.bak.
  - Rules run with a time limit (Advanced tab, 1 second per turn). A rule that
    goes over is stopped, named, and switched off until ContextWeir restarts or
    you save the rules again.

Mac: double-click the .command files (first time: right-click > Open).
Linux: run start-contextweir.sh / start-promptassay.sh.


SETTINGS
--------
contextweir\settings.json   ports, where the model is (this machine only), log
                            folder, how many sessions to keep, size limits, the
                            model timeout, the optional SillyTavern folder (for
                            its version) and the start screen. Changed on the
                            panel's tabs (or by hand while ContextWeir is
                            closed); bad values are refused, with reasons.
contextweir\rules.json      the flag rules (data only, never code). Each rule:
                            a target (reply, prompt, lastUser, lastMessage), a
                            test (startsWith, contains, missing, regex,
                            regexMissing), a value, a severity (note, warning,
                            serious), a note, and optional "unless" conditions.
                            Ships with a General group and a Wellspring group.
promptassay\settings.json   which log folders to read, and where your
                            SillyTavern lorebooks and character cards are (used
                            only to label content; read-only).


LOG FORMAT (the contract between the two tools)
-----------------------------------------------
logs\session_<date-time>\records.jsonl   one JSON object per request:
  format "contextweir-log", version 1, n, time, endpoint, status, seconds,
  swipe, promptChars, replyCut, mode (chat / text, since 0.5.6), replyShape
  (which reply format was read), flags [{rule, name, group, severity, target,
  match}], request (exactly as sent), reply (text).
logs\session_<date-time>\summary.json    session statistics: requests, swipes,
  errors, flagged, warnings per 100, average prompt size and reply time, count
  per rule; since ContextWeir 0.5 also frontend {name, version} (SillyTavern,
  from its package.json, or null), modelServer {server {name, version}, models,
  reachable} (asked once at the start of the session) and notLogged (turns that
  passed through while paused); since 0.5.6 unrecognised (generation requests
  sent to an address ContextWeir does not record) and textRequests. Older readers
  ignore the new fields.


SECURITY (see the transparency package's security pass)
-------------------------------------------------------
- Both listen on 127.0.0.1 only. ContextWeir forwards only to a model server on
  this machine; any other host in settings is refused.
- Both check the Host and Origin headers, so a web page open in your browser
  cannot read your logs through them (DNS rebinding, cross-site requests).
- PromptAssay is read-only and never takes a file path from a request; its page
  has a strict Content-Security-Policy and shows log text as plain text only.
- ContextWeir writes only inside its log folder with names it makes itself, and
  deletes only its own old session folders. It limits request size, gives up on
  a model that goes silent, and never logs request headers (API keys).
- Imported rule files are data: unknown fields, over-long values and patterns of
  the kind that can freeze a program are refused, with a reason.
- Only ContextWeir's own window can change settings or rules, press its
  buttons, check a port or test the model address: a request must come from that
  window's address (not another site, not another local app such as
  SillyTavern's page), must be JSON, and at most 1 MB. Every change is checked
  exactly like the files at start-up; a change with any problem is not saved.
  Forwarding to another computer (since 0.6) is off by default; when it is on,
  nothing is sent or recorded until the person accepts a warning in the panel
  (per address; never carried by a setup file), https certificates are always
  checked, the frontend's API key is passed on but never saved, and nothing is
  sent there that the frontend did not send (no version probe).
- PromptAssay's one write (since 0.4.1): the thank-you note's "Don't show this
  again" sets showThanks in its own settings.json, from its own window only.
- ContextWeir reads one file outside its folder, and only if you set the
  SillyTavern folder: that folder's package.json, for the version number.
- No eval, no child processes inside the tools, no packages, no auto-update.
  (The launchers open the browser window; the tools themselves never start
  programs.)

PRIVACY
-------
Logs hold full prompts and replies in plain text, including sealed Cores and
anything you typed. Keep them private; never share a log folder. When taking a
screenshot of PromptAssay, keep the "[Sealed]" sections collapsed, and do not
open an entry popup for a lorebook entry that holds secrets: the popup shows the
entry exactly as written, SECRET lines included. PromptAssay hides Core names in
the old logger's warning text.

Never expose SillyTavern or these tools to the internet. If you use remote
access (e.g. Tailscale), keep SillyTavern's whitelist or login on.


CHECKING FILES, AND HELP FOR AI ASSISTANTS
In the contextweir folder:  node contextweir.js --check  (settings.json and rules.json),
--check-settings <file>, --check-rules <file>, --schema settings|rules|setup. They run the panel's
own checks, list every problem and change nothing (exit 0 ok, 1 problems, 2 unreadable, 3 wrong
use). JSON Schemas are in contextweir\schemas\. AI_HELPERS.md is a guide for AI assistants
helping someone with these tools: layout, settings, rule format, logs, the safe way to change
things and what never to do.

THE DEMO SESSION (MADE UP)
PromptAssay lists "demo (made up): The Lantern Coast" at the bottom of its sessions: twelve
requests from an invented story (demo\ folder: card, lorebook, rule set, session), labelled
against its own files, so you can try PromptAssay before setting anything up. Nothing in it
comes from a real chat. Hide it with "showDemo": false in promptassay\settings.json.

A second demo session (2 Jan) holds the same twelve requests in TEXT COMPLETION (one prompt
string, ChatML instruct template), to show how PromptAssay takes such a prompt apart.

TEXT COMPLETION AND OTHER APIS
ContextWeir records Chat Completion, Text Completion, KoboldCpp's own API (KoboldAI Classic),
and, UNTESTED (no such server here; please send a diagnostic report if you use one), llama.cpp's
/completion and Ollama's /api/generate. A generation request to any other address still passes
through, but is not saved: ContextWeir says so once per session (CW-ENDPOINT-UNKNOWN). Each record
notes "mode" (chat or text) and "replyShape" (which reply format was read).
In text mode a rule's "last message" is the last 2,000 characters of the prompt: use "contains"
there, not "starts with". contextweir\rule_sets\ holds the General and Wellspring rule sets ready
to import (Wellspring's with "contains" lines for text mode).
PromptAssay 0.4 takes a text-completion prompt apart: known lorebook entries and card fields
first, then the instruct template's markers (from SillyTavern's instruct presets or a built-in
list), or the speakers' names. It says how it split each prompt, marks those labels "(by
template)", dims the markers, and shows the prompt as one block on request (key B).

MOVING OR SHARING A SETUP
ContextWeir's Advanced tab: "Export settings and rules" saves one file with your settings and all
rule sets (folder settings only if ticked: they hold your name and belong to one computer).
"Import a setup file..." shows a preview of every change first, then applies only what you tick,
through the same checks as the panel. Single rule sets still export and import on the Rules tab.

ERROR CODES AND THE DIAGNOSTIC REPORT
Every known problem has a short code that never changes (CW-... for ContextWeir, PA-... for
PromptAssay), shown beside the plain message in the console and the window. Each help page has
a table of its codes: what each means and what to do. ContextWeir's red bar has a "What does
this mean?" button that opens the right row.
To ask someone for help: ContextWeir's Status tab, "Save diagnostic report", or PromptAssay's
Report button. The window shows the whole report, then saves exactly that text. It holds
versions, settings, counts, recent codes and console lines, never your prompts, replies or
lorebook text; folder paths are shortened unless you ask; nothing is sent anywhere.

NOT IN THE PROTOTYPE YET
------------------------
- From the agreed rules window: test-before-save (how often a rule would have
  fired in past logs), per-card scope, and moving rules up or down.
- Routing different cards or chats to different log folders, and log limits per
  chat or card.
- PromptAssay: export/import of a range of turns to share.
- Desktop notifications for serious warnings.
- Side-by-side comparison of two sessions ("did my fix help?").
- Rules that capture a word from the prompt and look for it in the reply (the
  old logger's Core-word check). Fixed rules cannot do it.
- Labelling Summarize calls; text completion (one big prompt) is shown as one
  block.
- Large sessions: PromptAssay reads a whole session file when indexing it.


Design and direction by Harahel-Whot; code, docs and testing written with Claude
(Anthropic): prototype built 23 Nov by the Tools chat (Claude Opus 5.5).
Licence: MIT for the code, CC BY 4.0 for the help, docs and icons (LICENSE.txt).
 Not yet run against the live
game: tested with 33 real logged requests replayed through a stand-in model; the
rules window was clicked through in a real (headless) Chrome.
