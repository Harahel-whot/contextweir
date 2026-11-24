// PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// PromptAssay's error codes
// ----------------------------------------------------------------------------
// Every known problem has a short code that never changes, a title, what it
// means and what to do. The code is shown beside the plain message, listed
// in the diagnostic report, and explained in help.html, section "Error codes"
// (that table is made from this list by dev/errors_to_help.js).
// ============================================================================

'use strict';

const CODES = {
  'PA-SETTINGS-BAD-JSON': {
    title: 'settings.json is not valid JSON',
    means: 'PromptAssay could not read its settings file (often a missing comma or quote after editing it by hand), so it stopped.',
    fix: 'Fix the file, or delete it and start PromptAssay again to get the defaults.',
  },
  'PA-SETTINGS-WRITE': {
    title: 'settings.json could not be written',
    means: 'You ticked "Don\'t show this again" in the thank-you note, but PromptAssay could not save that in its settings file.',
    fix: 'Check the PromptAssay folder is not read-only. You can also set "showThanks": false in settings.json by hand.',
  },
  'PA-SETTINGS-LOGDIRS': {
    title: 'logDirs is not a list of folders',
    means: 'The "logDirs" setting must be a list of folder names in square brackets, e.g. ["../contextweir/logs"].',
    fix: 'Fix "logDirs" in settings.json, then start PromptAssay again.',
  },
  'PA-WINDOW-FAILED': {
    title: 'The window could not open',
    means: 'PromptAssay could not open a port for its window, so it stopped.',
    fix: 'Start it again. If it keeps happening, restart the computer; a security program may be blocking local ports.',
  },
  'PA-LOG-FOLDER': {
    title: 'A log folder could not be read',
    means: 'One of the folders in "logDirs" does not exist or cannot be read, so its sessions are not listed.',
    fix: 'Check the folder in settings.json. By default it is ContextWeir\'s logs folder next to PromptAssay\'s.',
  },
  'PA-NO-SESSIONS': {
    title: 'No sessions found',
    means: 'The log folders hold no sessions yet (a session appears once ContextWeir has recorded at least one turn).',
    fix: 'Play a turn through ContextWeir (Start pressed, frontend pointed at it), or open the demo session that ships with the tools.',
  },
  'PA-LABELS-OFF': {
    title: 'Labelling is off',
    means: 'No lorebook or character folder is set, so sections are labelled by position only (no entry names).',
    fix: 'Set "worldsDir" and "charactersDir" in settings.json to SillyTavern\'s data\\default-user\\worlds and characters folders.',
  },
  'PA-LABELS-FOLDER': {
    title: 'A lorebook or character folder could not be read',
    means: 'The folder set in "worldsDir" or "charactersDir" does not exist or cannot be read, so nothing from it is labelled.',
    fix: 'Check the folder in settings.json (SillyTavern keeps them in data\\default-user\\).',
  },
  'PA-LABEL-FILE': {
    title: 'A lorebook or card could not be read',
    means: 'One file in the lorebook or character folder is not a readable lorebook or card, so it was skipped. The others are used.',
    fix: 'Usually harmless (a half-saved or non-SillyTavern file). The detail names the file.',
  },
  'PA-TEMPLATES-FOLDER': {
    title: 'The instruct preset folder could not be read',
    means: 'PromptAssay looks in SillyTavern\'s instruct folder to take text-completion prompts apart. The folder in "instructDir" (or the one beside your lorebook folder) could not be read.',
    fix: 'Check "instructDir" in settings.json, or leave it empty. Without it, text-completion prompts are taken apart with the built-in templates (ChatML, Llama 3, Gemma, Mistral, Alpaca and a few more).',
  },
  'PA-TEMPLATE-BAD': {
    title: 'An instruct preset file was skipped',
    means: 'A file in the instruct folder could not be read as a SillyTavern instruct preset (damaged, too large, or not a preset).',
    fix: 'Usually harmless; the other presets and the built-in templates are still used. The detail names the file.',
  },
  'PA-SESSION-GONE': {
    title: 'That session is no longer there',
    means: 'The page asked for a session that is no longer in the log folders (ContextWeir may have deleted it as an old session).',
    fix: 'Pick another session from the list, or reload the page.',
  },
  'PA-RECORD-UNREADABLE': {
    title: 'A request could not be read',
    means: 'A record in the session could not be read back (the log file changed, or the record is damaged).',
    fix: 'Reload the page. If it repeats for the same request, that record is damaged; the rest of the session still works.',
  },
  'PA-REFUSED-HOST': {
    title: 'A request with a strange address was refused',
    means: 'Something asked PromptAssay for a page with a Host header that was not this computer: how web pages try DNS-rebinding tricks.',
    fix: 'Nothing to do if you did not expect it. Open PromptAssay with its Start file.',
  },
  'PA-REFUSED-ORIGIN': {
    title: 'A request from another page was refused',
    means: 'A page that is not PromptAssay\'s own window tried to read your logs. Only the window itself may.',
    fix: 'Nothing to do if you did not expect it.',
  },
  'PA-READ-ONLY': {
    title: 'A request to change something was refused',
    means: 'PromptAssay only reads. Something tried to send it data (anything but a plain read).',
    fix: 'Nothing to do if you did not expect it.',
  },
  'PA-RUNNING-FILE': {
    title: 'running.json could not be written',
    means: 'The Start file finds a running PromptAssay through running.json. Writing it failed, so the Start file may open the wrong window.',
    fix: 'Check the PromptAssay folder is not read-only.',
  },
  'UNKNOWN': {
    title: 'Something unexpected went wrong',
    means: 'A problem with no code of its own.',
    fix: 'Save a diagnostic report and send it with a description of what you were doing.',
  },
};

module.exports = { CODES };
