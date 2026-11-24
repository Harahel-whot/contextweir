# ContextWeir and PromptAssay: a guide for AI assistants

ContextWeir 0.5.6.0 and PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
Licence: CC BY 4.0 (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

ContextWeir 0.5.4.0 and PromptAssay 0.3.5.0, built 25 Nov 2026. Part of the Wellspring tools.
Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic). Licence: CC BY 4.0 (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

This file is for AI assistants (Claude Code and the like) that a person asks for help with these
tools, for example to write flag rules for their character card, change a setting, or read what
their logs say. People can read it too. It is documentation only: it opens no new way into
ContextWeir. **The person decides; you propose, check and explain.**

## What the two tools are

- **ContextWeir** (`contextweir/`) is a recorder. It sits between a chat frontend (SillyTavern or
  any OpenAI-compatible frontend) and a model server on the same computer (KoboldCpp, etc.):
  `frontend -> ContextWeir (receiving port) -> model server`. It passes every request and reply
  through unchanged, saves both exactly as sent, and checks them against **flag rules**.
- **PromptAssay** (`promptassay/`) is a reader. It only reads ContextWeir's logs and shows each
  request taken apart: which lorebook entries and card fields it holds, what changed since the
  last request, and where the rules fired.

Both run only on this computer (127.0.0.1) and need Node.js 18 or newer, with no packages.

## Folder layout

```
tools/
  AI_HELPERS.md            this file
  README.txt, SECURITY.txt, LICENSE.txt
  contextweir/
    contextweir.js         the program (also the checker, see below)
    settings.json          its settings          (the person's file: change only as below)
    rules.json             its flag rules        (the person's file: change only as below)
    settings.json.bak, rules.json.bak   the previous copies, kept on every save
    running.json           exists only while it runs: { port (the panel), relayPort, state, pid }
    schemas/               JSON Schemas: settings, rules and setup files
    logs/session_<UTC time>/records.jsonl, summary.json
    lib/, ui/, launch/, icon/, help.html
  promptassay/
    promptassay.js, settings.json, lib/, ui/, launch/, icon/, help.html
  demo/                    a made-up session, card, lorebook and rule set (safe to show anyone)
```

## Checking your work: the command-line checker

Run these from the `contextweir` folder. They use exactly the checks ContextWeir uses at start-up
and in its panel, print what they find, and **never start anything, open a port or write a file**.

```
node contextweir.js --check                   checks settings.json and rules.json
node contextweir.js --check-settings <file>   checks one settings file
node contextweir.js --check-rules <file>      checks one rule file
node contextweir.js --schema settings|rules|setup   prints a JSON Schema
```

Exit codes: `0` no problems (lines marked `note` are fine), `1` problems found (each printed
as `PROBLEM ...`), `2` the file could not be read or is not valid JSON, `3` wrong use.

A schema (in `contextweir/schemas/`) checks shapes and ranges. Only `--check` also checks
folders, the two ports being different, patterns that could run very slowly, and patterns that
do not compile. **Always run `--check` after editing a file.**

## The safe way to change things

1. **Is ContextWeir running?** It is if `contextweir/running.json` exists (its `pid` is the
   process). While it runs, do **not** edit settings.json or rules.json: the person's panel
   holds its own copy and a save from the panel replaces the file. Instead, either tell the
   person what to change in the panel (the Connection, Logs, Advanced and Rules tabs), or write
   a new file next to it (a rule file to import, or a setup file) and ask them to import it in
   the panel, which shows a preview first.
2. **If it is not running**, you may edit the files. Keep the `"_about"` line. Then run
   `node contextweir.js --check` and fix every `PROBLEM` before you finish.
3. Settings marked "restart" below need ContextWeir restarted (the panel's Restart button) before
   they take effect; "now" settings apply from the next turn.
4. Say what you changed, in plain words, and which file the previous version is in (`.bak`).

### Never do these

- Never set `targetHost` to anything but this computer (`127.0.0.1`, `localhost`, `::1`). The
  tools are local-only by design; the checker refuses other hosts. Never add API keys anywhere.
- Never delete, move or edit anything in `logs/` (the person may need those sessions; ContextWeir
  deletes its own old sessions by the "Sessions to keep" setting).
- Never copy, upload, paste or summarise log contents anywhere outside this computer, and never
  put real log text into examples, tests, issues or screenshots. Logs hold full prompts and
  replies: personal play, and story secrets. Use `demo/` for examples.
- Never edit `running.json`, the files in `lib/`, `ui/` or `launch/`, or anything to make the
  panel accept requests from somewhere else.
- Never try to get round the panel's checks (only the panel's own window may change settings
  while it runs; that is the security design).

## Settings (contextweir/settings.json)

| key | type and range | default | applies | what it does |
|---|---|---|---|---|
| `relayPort` | integer 1024-65535 | 5002 | restart | the port the frontend connects to (`http://127.0.0.1:<port>/v1`); never moves on its own |
| `targetHost` | `127.0.0.1`, `localhost`, `::1` | 127.0.0.1 | restart | the model server; must be this computer |
| `targetPort` | integer 1024-65535 | 5001 | restart | the model server's port (KoboldCpp: 5001); must differ from `relayPort` |
| `logsDir` | folder, max 400 chars | `logs` | restart | where sessions go; relative to the contextweir folder or full; its parent must exist; not a program folder or a drive root |
| `keepSessions` | integer 1-10000 | 30 | now | older session folders are deleted when a session starts |
| `maxRecordsPerSession` | integer 1-1000000 | 5000 | now | after this many, turns pass through but are not saved |
| `sillyTavernDir` | folder or empty | empty | restart | optional; only its `package.json` is read, for the version number |
| `maxRequestMB` | integer 1-1024 | 32 | now | larger requests are refused |
| `maxReplyMB` | integer 1-1024 | 16 | now | longer replies pass through; the log keeps this much |
| `upstreamTimeoutSec` | integer 1-86400 | 600 | now | give up on a model that sends nothing this long |
| `ruleTimeoutMs` | integer 1-60000 | 1000 | now | a rule slower than this on one turn is switched off for the session |
| `showStartScreen` | true / false | true | now | false: start recording as soon as ContextWeir opens |

Unknown keys are refused. PromptAssay's `promptassay/settings.json` has only `logDirs` (a list of
folders with sessions), `worldsDir` and `charactersDir` (SillyTavern's lorebook and character
folders, for labelling) and `showDemo` (true/false). It is read at start; restart PromptAssay
after editing it.

## Flag rules (rules.json, or a rule file to import)

```json
{
  "format": "contextweir-rules",
  "version": 1,
  "groups": [
    {
      "name": "My horror card",
      "enabled": true,
      "rules": [
        {
          "name": "Reply starts with OOC",
          "severity": "warning",
          "target": "reply",
          "test": "regex",
          "value": "^\\s*[\\(\\[]?\\s*OOC\\b",
          "note": "The narrator stepped out of the story."
        },
        {
          "name": "No status line",
          "severity": "warning",
          "target": "reply",
          "test": "missing",
          "value": "[Sanity:",
          "unless": [
            { "target": "lastMessage", "test": "regex", "value": "summari[sz]e", "flags": "i" }
          ],
          "note": "Every story reply ends with a [Sanity: ...] line; Summarize requests are skipped."
        },
        {
          "name": "Secret named too early",
          "severity": "serious",
          "target": "reply",
          "test": "contains",
          "value": "the vicar is the cultist"
        }
      ]
    }
  ]
}
```

- `target`: `reply`, `prompt` (every message joined), `lastUser` (the player's last message),
  `lastMessage` (the last message sent, e.g. an instruction appended by the frontend).
  TEXT COMPLETION (one `prompt` string instead of `messages`): `lastMessage` is the last 2,000
  characters of the prompt and `lastUser` is empty. Use `contains` (not `startsWith`) on
  `lastMessage`, and prefer `reply` and `prompt`, which behave the same in both modes.
  `contextweir/rule_sets/` holds ready rule sets (General; Wellspring with text-mode lines).
- `test`: `startsWith`, `contains`, `missing` (plain text, case ignored), `regex`,
  `regexMissing` (JavaScript patterns; `flags` may hold `i`, `m`, `s`, `u`).
- `severity`: `note`, `warning`, `serious`. `value`: at most 200 characters; empty only for
  `regexMissing`.
- `unless`: up to 10 conditions; the rule is skipped when any of them holds. One bad condition
  drops the whole rule.
- Limits: 50 sets, 200 rules a set; set names unique; rule names unique within a set; names up
  to 120 characters (sets 80), notes up to 500.
- Patterns such as `(a+)+` or `(a|a)*` are refused as possibly very slow; prefer plain text
  tests; each turn's rules also run with a time limit.
- Rules are data, never code. Test a new rule with `--check-rules` and, if possible, against the
  person's past sessions in PromptAssay (its rule filter shows where a rule would have fired once
  it is in place).

To hand a rule set to the person, write it to its own file and ask them to import it on the
Rules tab (they see a preview, then choose to add it beside their sets or replace them).

## Setup files (settings and rules together)

The panel's Advanced tab exports and imports one file with both. Format: `"format":
"contextweir-setup"`, `"version": 1`, `"settings": { ... }`, `"rules": { a rule file }`, plus
`exported`, `from` and `foldersIncluded`. Importing shows a preview of each change; nothing
outside this computer can be set through it. Schema: `schemas/setup.schema.json`.

## Reading the logs

`contextweir/logs/session_<UTC time>/` (one folder per Start or Restart; names sort in time order):

- `records.jsonl`: one JSON object per request: `format` "contextweir-log", `version` 1, `n`
  (request number from 1), `time`, `endpoint`, `status`, `seconds`, `swipe` (same history as the
  request before), `promptChars`, `replyCut`, since 0.5.6 `mode` (`chat`, `text` or `other`) and
  `replyShape` (`openai`, `kobold`, `llamacpp`, `ollama`, or `raw` when no reader matched),
  `flags` [{`rule`, `name`, `group`, `severity`, `target`, `match`}], `request` (exactly as sent:
  `model`, `messages` or, in text completion, `prompt`, sampler settings) and `reply` (the text;
  streamed replies joined). The last line may be half-written while it runs. Recorded addresses:
  /v1/chat/completions, /v1/completions (and without /v1), KoboldCpp's /api/v1/generate and
  /api/extra/generate/stream, llama.cpp's /completion and Ollama's /api/generate (the last two
  untested).
- `summary.json`: the session's numbers (`requests`, `swipes`, `errors`, `flagged`, `byRule`,
  `notLogged`, `unrecognised` (generation requests to an address not recorded), `textRequests`,
  `avgSeconds`, `avgPromptChars`, `warningsPer100`), the tool version, and the
  frontend and model server versions seen (`frontend`, `modelServer`).

When you read logs to help the person, report what you find in your own words and keep prompt
text on this computer. PromptAssay (`promptassay/`, Start PromptAssay) shows the same thing to the
person, request by request.

## When something goes wrong

- Every known problem has a code (`CW-...` for ContextWeir, `PA-...` for PromptAssay). Each tool's
  `help.html`, section "Error codes", explains each one and what to do.
- The person can save a **diagnostic report** (ContextWeir: Status tab; PromptAssay: Report
  button). It holds versions, settings, counts and recent codes, never prompts or replies. Ask
  for that rather than for logs.
- `node contextweir.js --check` finds most problems with the files.
