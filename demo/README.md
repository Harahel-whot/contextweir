# Made-up demo for ContextWeir and PromptAssay

<!-- Made-up demo for the Wellspring tools (ContextWeir and PromptAssay). Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic). Licence: CC BY 4.0 (see LICENSE.txt). -->

Everything in this folder is invented: the Lantern Coast, Keeper Odile Marsh, Tamsin, the player
"Wren", every prompt and every reply. No real chat was used. It is here so you can explore
PromptAssay before setting anything up, and so screenshots and tests never need a real log (real
logs can hold private play and story secrets).

PromptAssay lists the demo sessions at the bottom of its session list, marked "demo (made up)",
labelled against the demo's own card and lorebook. To hide them, set `"showDemo": false` in
`promptassay/settings.json`.

## What to look for in the 12 requests

| Request | What happens |
| --- | --- |
| #1 | the Salt Steps and Greywick Light entries arrive (keys: steps, lighthouse) |
| #2-3 | a swipe: the same history asked twice, two different replies |
| #4 | a flagged reply ("Reply starts with OOC"), and the Drowned Bell entry entering |
| #6 | SillyTavern's Summarize request (no status line expected, so not flagged) |
| #7 | the summary now sits in the prompt as "[Summary: ...]" |
| #8 | the model asked for changes (demo-model to demo-model-large) |
| #9 | an empty reply, flagged serious; #10 is its regenerate |
| #11 | Tamsin enters, Odile's entry leaves |
| #12 | a story reply without its status line ("No status line") |

## The second session

The second session (2 Jan) holds the same 12 requests as SillyTavern sends them in text
completion, with the ChatML instruct template: one prompt string per request. PromptAssay takes it
apart into the same kind of sections ("by template") and says how it did.

## Files

| File | What it is |
| --- | --- |
| `characters/Lantern Coast.json` | the character card (SillyTavern can import it) |
| `worlds/Lantern Coast.json` | the lorebook |
| `rules/lantern_coast_rules.json` | a rule set: import it on ContextWeir's Rules tab to try one |
| `logs/session_.../` | the two recorded sessions, in ContextWeir's log format 1 |

Made by `dev/make_demo.js`.
