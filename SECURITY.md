# Security: ContextWeir and PromptAssay

<!-- ContextWeir 0.6.0.0 and PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
     Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
     Licence: CC BY 4.0 (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir -->

Both tools were written by an AI (Claude, Anthropic) and reviewed more than once by a separate AI
reviewer that had not written the code: on 25 Nov 2026 for ContextWeir 0.5.4.0 and PromptAssay
0.3.5.0, again for text completion (ContextWeir 0.5.6.0, PromptAssay 0.4.0.0), and again for the
outside-address setting and the thank-you notes (ContextWeir 0.6.0.0, PromptAssay 0.4.1.0). Every
problem found was fixed, each with a test that replays it. No human security audit has been done.

## In short

- **Only on your computer.** Both tools listen on 127.0.0.1 only. Nothing on your network or the
  internet can connect to them, and they never contact the internet themselves.
- **Web pages can't reach them.** Requests a browser makes on behalf of another site (an image or
  link on a web page) are refused outright, and no request, however malformed, can stop either
  tool. Only ContextWeir's own panel window can change its settings or rules, press its buttons
  (Start, Stop, Quit...), check whether a port is free or test the model address.
- **Model servers on another computer are opt-in.** ContextWeir forwards only to a model server on
  this computer unless you tick "Allow a model server on another computer". Then a warning explains
  the risk, and nothing is sent or recorded until you press OK. "Don't show this again" covers one
  address only and never travels in a setup file; no web page or other program can accept it for
  you. https certificates are always checked. Your frontend's API key is passed on, never saved,
  and ContextWeir sends nothing there that your frontend did not send. It never saves request
  headers.
- **No packages, no downloads, no updates**, and the tools never start other programs. Rule files
  are data, never code; anything unexpected in one is refused with a reason. Rules run with a time
  limit, so even a badly written pattern cannot freeze the recorder.
- **Files.** ContextWeir writes only its own logs, rules and settings (keeping the previous copy of
  each as `.bak`; a change with any problem is refused whole), and deletes only its own old session
  folders. If you set the SillyTavern folder, it reads that folder's `package.json` for the version
  number and nothing else. PromptAssay only reads; it writes nothing but its `running.json` while it
  runs, a `settings.json` with the defaults if there is none, and "Don't show this again" in that
  file, from its own window only.
- **The diagnostic report** holds versions, settings, counts, recent error codes and the tools' own
  console lines: never prompts, replies or lorebook text. Folder paths are shortened unless you ask
  for full paths. You see all of it before saving, and it is never sent anywhere.
- **Text completion.** PromptAssay reads SillyTavern's instruct presets read-only (at most 200
  files of 256 KB each); markers from them are only searched as plain text, never run as patterns.
- **The launchers** start Node and open the window in your browser's app mode. "Create Shortcuts"
  makes two shortcut files and nothing else.

## Privacy

Logs hold your full prompts and replies in plain text, including secrets in your cards and anything
you typed. They stay on your computer. Keep the logs folder private, and don't share screenshots of
entries that hold secrets.

Never expose SillyTavern or these tools to the internet. If you use remote access (for example
Tailscale), keep SillyTavern's whitelist or login on.

## Reporting a problem

Open an issue at https://github.com/Harahel-Whot/contextweir/issues. Please don't attach your logs:
they hold your chats. A diagnostic report (ContextWeir's Status tab, or PromptAssay's Report button)
is safe to share and usually enough.
