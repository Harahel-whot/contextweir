// ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// ContextWeir's error codes
// ----------------------------------------------------------------------------
// Every known problem has a short code that never changes, a title, what it
// means and what to do. The code is shown beside the plain message (in the
// console, the panel and the frontend's error), listed in the diagnostic
// report, and explained in help.html, section "Error codes" (that table is
// made from this list by dev/errors_to_help.js, so the two always agree).
// ============================================================================

'use strict';

const CODES = {
  'CW-PORT-TAKEN': {
    title: 'The receiving port is already in use',
    means: 'Start could not open the receiving port because another program has it: often another copy of ContextWeir, the old logger, or something else on that port.',
    fix: 'Close whatever has the port (look for another ContextWeir console), then press Start again. Or choose another port on the Connection tab and change the address in your frontend to match. ContextWeir never moves the port on its own.',
  },
  'CW-PORT-FAILED': {
    title: 'The receiving port could not be opened',
    means: 'The operating system refused to open the receiving port for a reason other than it being in use.',
    fix: 'Try another port from 1024 to 65535 on the Connection tab. A security program may be blocking it.',
  },
  'CW-WINDOW-FAILED': {
    title: 'The control panel could not open',
    means: "ContextWeir could not open a port for its own window, so it stopped.",
    fix: 'Start it again. If it keeps happening, restart the computer; a security program may be blocking local ports.',
  },
  'CW-SESSION-FOLDER': {
    title: 'No session folder could be made',
    means: 'Recording could not start because ContextWeir could not create a session folder in the log folder.',
    fix: 'Check the log folder on the Logs tab exists and that you can write to it (not a read-only or cloud-only folder), then press Start.',
  },
  'CW-LOG-WRITE': {
    title: 'A turn could not be saved',
    means: 'A request and its reply passed through, but writing them to records.jsonl failed (a full disk, or the file locked by another program).',
    fix: 'Free some disk space or close programs that might hold the log file open. Turns keep passing through to the model meanwhile.',
  },
  'CW-MODEL-UNREACHABLE': {
    title: 'The model server did not answer',
    means: 'ContextWeir could not reach the model server at the address on the Connection tab, so your frontend got an error.',
    fix: 'Start KoboldCpp (or your model server) and check its port matches "Model server port" (KoboldCpp\'s default is 5001). The Test button on the Connection tab checks it.',
  },
  'CW-MODEL-TIMEOUT': {
    title: 'The model went silent',
    means: 'The model server sent nothing for longer than the model timeout, so ContextWeir gave up on that request.',
    fix: 'A very slow model or a long reply may need a longer "Model timeout" (Advanced tab). Check KoboldCpp has not frozen or run out of memory.',
  },
  'CW-MODEL-NOT-ANSWERING': {
    title: 'The model server did not answer when the session started',
    means: 'At the start of a session ContextWeir asks the model server for its version. It got no answer, so no version was noted. Recording still works.',
    fix: 'Usually harmless if KoboldCpp was started after ContextWeir. If turns fail too, see CW-MODEL-UNREACHABLE.',
  },
  'CW-REMOTE-NOT-CONFIRMED': {
    title: 'Waiting for the outside-address warning',
    means: 'ContextWeir is set to send your chats to a model server on another computer, and nothing is recorded or sent until you accept the warning about that.',
    fix: 'Read the warning in the panel and press OK, or untick "Allow a model server on another computer" on the Connection tab and press Restart. Before unattended runs, tick "Don\'t show this again" in the warning once (it then applies to that address only).',
  },
  'CW-REQUEST-TOO-LARGE': {
    title: 'A request was too large',
    means: 'The frontend sent a request larger than "Largest request (MB)", so it was refused.',
    fix: 'Raise "Largest request (MB)" on the Advanced tab if your prompts really are that large.',
  },
  'CW-ENDPOINT-UNKNOWN': {
    title: 'Turns are passing through but not being recorded',
    means: 'Your frontend is generating through an address ContextWeir does not record (the address is shown beside the code). Replies still come back, but nothing is saved for those turns.',
    fix: 'Check your frontend\'s API type. ContextWeir records Chat Completion, Text Completion, KoboldCpp\'s own API (KoboldAI Classic), llama.cpp\'s /completion and Ollama\'s /api/generate (the last two untested). If you use another server or API, send a diagnostic report so its address can be added.',
  },
  'CW-REFUSED-HOST': {
    title: 'A request with a strange address was refused',
    means: 'Something sent a request whose Host header was not this computer. This is how web pages try DNS-rebinding tricks; ContextWeir refuses them.',
    fix: 'Nothing to do if you did not expect it. Point your frontend at http://127.0.0.1:<port>/v1, not a computer name.',
  },
  'CW-REFUSED-ORIGIN': {
    title: 'A request from a web page was refused',
    means: 'A page open in your browser (or another local web app) tried to send a request. Only programs, and the panel\'s own window for settings, are allowed.',
    fix: 'Nothing to do if you did not expect it. If your frontend runs in a browser and was refused, tell us: SillyTavern sends from its server, not the page.',
  },
  'CW-SETTINGS-BAD-JSON': {
    title: 'settings.json is not valid JSON',
    means: 'The settings file could not be read (often a missing comma or quote after editing it by hand).',
    fix: 'Fix the file, or delete it and start ContextWeir again to get the defaults (settings.json.bak holds the previous version). "node contextweir.js --check" points at the problem.',
  },
  'CW-SETTINGS-PROBLEMS': {
    title: 'settings.json has problems',
    means: 'One or more settings are out of range, unknown, or point somewhere ContextWeir will not write. The list names each one.',
    fix: 'Fix the named settings in the panel (or in the file while ContextWeir is closed). "node contextweir.js --check" lists them.',
  },
  'CW-SETTINGS-WRITE': {
    title: 'settings.json could not be saved',
    means: 'The panel checked your settings but could not write the file.',
    fix: 'Check the ContextWeir folder is not read-only and that no other program has settings.json open.',
  },
  'CW-SILLYTAVERN-FOLDER': {
    title: 'The SillyTavern folder was left out',
    means: 'The optional SillyTavern folder (used only to note its version) has no package.json, so it was left out for this run. Recording is not affected.',
    fix: 'On the Logs tab, choose the folder that holds SillyTavern\'s Start.bat, or leave the setting empty.',
  },
  'CW-RULES-MISSING': {
    title: 'rules.json was not found',
    means: 'There is no rules.json, so no flag rules are checked. Recording still works.',
    fix: 'Import a rule file on the Rules tab, or add a set there; saving creates rules.json.',
  },
  'CW-RULES-BAD-JSON': {
    title: 'rules.json is not valid JSON',
    means: 'The rule file could not be read, so no flag rules are checked. Recording still works.',
    fix: 'rules.json.bak holds the previous version. "node contextweir.js --check-rules rules.json" points at the problem.',
  },
  'CW-RULES-PROBLEMS': {
    title: 'Some rules could not be used',
    means: 'Some rules in the file were refused (an unknown test, an empty value, a pattern that could run very slowly...). The others work.',
    fix: 'The Rules tab lists each refused rule and why. Edit or delete it there.',
  },
  'CW-RULES-WRITE': {
    title: 'rules.json could not be saved',
    means: 'The rules were checked but the file could not be written.',
    fix: 'Check the ContextWeir folder is not read-only and that no other program has rules.json open.',
  },
  'CW-RULE-TIMEOUT': {
    title: 'A rule took too long and was switched off',
    means: 'One rule took longer than the rule time limit on a turn, so it was switched off for this session. Play was never delayed.',
    fix: 'Edit that rule\'s pattern (simpler, or plain text instead of a pattern) and save the rules to try it again.',
  },
  'CW-RULE-WORKER': {
    title: 'The rule checker stopped',
    means: 'The thread that checks the rules failed and was started again. That turn may be missing its flags.',
    fix: 'Usually harmless. If it repeats, save a diagnostic report and send it with a description of your rules.',
  },
  'CW-RUNNING-FILE': {
    title: 'running.json could not be written',
    means: 'The Start file finds a running ContextWeir through running.json. Writing it failed, so the Start file may open the wrong window.',
    fix: 'Check the ContextWeir folder is not read-only.',
  },
  'UNKNOWN': {
    title: 'Something unexpected went wrong',
    means: 'A problem with no code of its own.',
    fix: 'Save a diagnostic report and send it with a description of what you were doing.',
  },
};

module.exports = { CODES };
