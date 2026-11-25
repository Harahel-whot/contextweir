// ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// ContextWeir  (a prototype: relay, control panel, rules, keyboard shortcuts,
//               About, help)
// ----------------------------------------------------------------------------
// A recorder that sits between a chat frontend (SillyTavern or any other
// OpenAI-compatible frontend) and a local model server (KoboldCpp, etc.).
//
//   frontend  --->  ContextWeir (relay port)  --->  model server
//                        |
//                        +--> logs/session_<date-time>/records.jsonl
//
// Every request and reply passes through unchanged and is saved exactly as
// sent. Flag rules (rules.json) are checked against each request/reply and
// their results are saved alongside it. PromptAssay reads these logs.
//
// THE CONTROL PANEL (since 0.5): ContextWeir opens to its panel, like
// KoboldCpp's launcher. Nothing listens on the relay port until you press
// Start (or tick "skip this screen", which starts at once next time). From
// the panel: Start, Pause / Resume logging (turns still pass through), Stop
// (closes the relay port; the panel stays), Restart (applies saved settings
// and starts a new session), Quit. Settings, rules, logs, About and Help are
// all in the same window. Everything happens inside this one program: no
// child processes.
//
// SECURITY (see the transparency package's security pass):
//   - listens on 127.0.0.1 only; forwards to a model server on this computer
//     (loopback) unless "Allow a model server on another computer" is on
//     (since 0.6, user 25 Nov). Then a warning must be accepted before any
//     recording starts (per address), https certificates are always checked,
//     and no request is ever sent there except the frontend's own
//   - checks the Host and Origin headers on every request (blocks web pages
//     and DNS-rebinding tricks from reaching it through your browser)
//   - only the panel's own window (same port) can change settings or rules,
//     press its buttons, check a port or test the model address
//   - limits request size and gives up on a silent model after a timeout
//   - writes only inside its own log folder, with names it makes itself;
//     deletes only its own old session folders; the only other files it
//     writes are settings.json and rules.json (each with a .bak), after the
//     same checks as at start-up
//   - reads one file outside its folder, and only if you set the SillyTavern
//     folder: that folder's package.json, for the version number
//   - never logs request headers (API keys travel there)
//   - Node built-ins only: no packages, no child processes, no eval
//
// PRIVACY: logs hold full prompts and replies in plain text on disk.
//
// HOW THIS FILE IS LAID OUT (numbered sections, top to bottom):
//   1. Settings              6. The relay, and its states
//   2. Flag rules            7. The control panel window (pages and /api/...)
//   3. Reading requests      8. Start
//   4. Sessions and logs
//   5. Header checks
//
// Run:  double-click "Start ContextWeir.bat" (Windows), "Start ContextWeir.command"
//       (Mac) or "start-contextweir.sh" (Linux), or: node contextweir.js
// ============================================================================

'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL = 'ContextWeir';
const VERSION = '0.6.0.0';
const BUILT = '25 Nov 2026';   // the date this version's code last changed; shown beside the version
const LOG_FORMAT = { format: 'contextweir-log', version: 1 };

// Error codes and the diagnostic report (lib/diagnostics.js, lib/error_codes.js). The console is
// tapped first, so the report's "recent console lines" start from the very first line.
const { createDiagnostics, browserName, formatReport, problemLines } = require('./lib/diagnostics');
const { CODES } = require('./lib/error_codes');
const diag = createDiagnostics('ContextWeir', CODES);
diag.tapConsole();

// Shown in the About popup. Keep this the only place the version and credits live.
const ABOUT = {
  name: TOOL,
  version: VERSION,
  built: BUILT,
  stage: 'prototype',
  purpose: 'Sits between your chat frontend and your model, passes everything through unchanged, '
    + 'saves each request and reply exactly as sent, and checks them against your flag rules.',
  writes: [
    `ContextWeir log format ${LOG_FORMAT.version} (since 0.5 the session summary also notes the `
      + 'frontend and model server versions)',
    'rule files: contextweir-rules version 1',
  ],
  worksWith: 'any OpenAI-compatible frontend and a model server on this computer (e.g. KoboldCpp); '
    + 'since 0.6 also one on another computer or a cloud service, after a warning',
  testedWith: ['SillyTavern 1.19.0 (chat completion, streamed and not streamed)'],
  needs: 'Node.js 18 or newer; Edge, Chrome or Chromium for the app window (any browser works as a tab)',
  writtenBy: [{ versions: '0.1 to 0.6.0.0', by: 'Claude Opus 5.5 (Anthropic)' }],
  directedBy: 'Harahel-Whot',
  credit: 'Design and direction by Harahel-Whot; code, docs and testing written with Claude (Anthropic).',
  licence: 'MIT for the code, CC BY 4.0 for the help, docs and icons: free to use, change and share, '
    + 'as long as the credit is kept. See LICENSE.txt.',
  privacy: 'Runs only on this computer. Prompts go only to the model server you set: on this computer '
    + 'unless you allow another one (a warning explains the risk first). Logs hold full prompts and '
    + 'replies in plain text; keep them private.',
  // Where to send feedback (thank-you popup). Only these are shown; add a line here for a new place.
  links: {
    github: 'https://github.com/Harahel-Whot/contextweir',
  },
};


// ----------------------------------------------------------------------------
// 1. Settings
// ----------------------------------------------------------------------------
// settings.json sits next to this script. Missing values fall back to these
// defaults. One check (checkSettings) is used for the file at start-up and for
// every save from the panel: a save with any problem is refused whole.
//
// Each setting says when a change takes effect:
//   now      the next turn uses it (limits, timeouts, the start screen)
//   restart  needs Restart (or Stop and Start): ports, the model address, the
//            log folder and the SillyTavern folder (a new session is started)
//
// Two copies of the settings are kept (see the bottom of this section):
//   savedSettings  what settings.json says now
//   settings       what is in use; "now" settings follow savedSettings at once,
//                  "restart" ones only at the next Start or Restart

const HERE = __dirname;
// The environment variables let the test suites point ContextWeir at their own files.
const SETTINGS_FILE = process.env.CW_SETTINGS || path.join(HERE, 'settings.json');
const RULES_FILE = process.env.CW_RULES || path.join(HERE, 'rules.json');
const RUNNING_FILE = process.env.CW_RUNNING || path.join(HERE, 'running.json');

const DEFAULTS = {
  relayPort: 5002,          // the frontend connects here (e.g. http://localhost:5002/v1)
  targetHost: '127.0.0.1',  // the model server; must be this machine
  targetPort: 5001,         // KoboldCpp's default
  logsDir: 'logs',          // relative to this folder, or absolute
  keepSessions: 30,         // older session folders are deleted
  maxRecordsPerSession: 5000,
  maxRequestMB: 32,         // larger requests are refused
  maxReplyMB: 16,           // longer replies still pass through; the log keeps this much
  upstreamTimeoutSec: 600,  // give up on a model that goes silent this long
  ruleTimeoutMs: 1000,      // longest the flag rules may take on one turn
  sillyTavernDir: '',       // optional: SillyTavern's folder, read only for its version number
  showStartScreen: true,    // false: start recording at once (the panel still opens)
  allowRemoteModel: false,  // true: forward to remoteUrl, a model server on another computer (0.6)
  remoteUrl: '',            // e.g. http://192.168.1.20:5001 or https://openrouter.ai/api
  remoteWarningAcceptedFor: '',   // the remote address whose warning was accepted with "Don't show this again"
  showThanks: true,         // the thank-you popup when the panel opens
};

// What the panel shows for each setting: its tab, label, help line and when it
// applies. The panel draws its forms from this list, so the two always agree.
const FIELDS = [
  {
    key: 'relayPort', tab: 'connection', type: 'port', applies: 'restart',
    label: 'Receiving port',
    help: 'Your frontend connects here, e.g. http://127.0.0.1:5002/v1. It never moves on its own.',
  },
  {
    key: 'targetHost', tab: 'connection', type: 'choice', choices: ['127.0.0.1', 'localhost', '::1'],
    applies: 'restart',
    label: 'Model server (this computer)',
    help: 'Used unless "Allow a model server on another computer" is ticked below.',
  },
  {
    key: 'targetPort', tab: 'connection', type: 'port', applies: 'restart',
    label: 'Model server port',
    help: "KoboldCpp's default is 5001.",
  },
  {
    key: 'allowRemoteModel', tab: 'connection', type: 'bool', applies: 'restart',
    label: 'Allow a model server on another computer',
    help: 'Off: only this computer. On: your chats go over the network to the address below '
      + '(another PC, Tailscale or a cloud service). A warning explains the risk before anything is sent.',
  },
  {
    key: 'remoteUrl', tab: 'connection', type: 'url', applies: 'restart',
    label: 'Model server on another computer',
    help: 'The address up to (not including) /v1, e.g. http://192.168.1.20:5001 or https://openrouter.ai/api. '
      + 'Your frontend sends its API key with each request; ContextWeir passes it on and never saves it.',
  },
  {
    key: 'logsDir', tab: 'logs', type: 'folder', applies: 'restart',
    label: 'Log folder',
    help: 'Relative to the ContextWeir folder, or a full path. The folder above it must exist.',
  },
  {
    key: 'keepSessions', tab: 'logs', type: 'int', min: 1, max: 10000, applies: 'now',
    label: 'Sessions to keep',
    help: 'Older session folders are deleted when a session starts.',
  },
  {
    key: 'maxRecordsPerSession', tab: 'logs', type: 'int', min: 1, max: 1000000, applies: 'now',
    label: 'Most turns per session',
    help: 'After this many, turns still pass through but are not saved.',
  },
  {
    key: 'sillyTavernDir', tab: 'logs', type: 'folder', optional: true, applies: 'restart',
    label: 'SillyTavern folder (optional)',
    help: 'Only its package.json is read, for the version number noted in each session. Leave empty to skip.',
  },
  {
    key: 'maxRequestMB', tab: 'advanced', type: 'int', min: 1, max: 1024, applies: 'now',
    label: 'Largest request (MB)',
    help: 'Larger requests are refused.',
  },
  {
    key: 'maxReplyMB', tab: 'advanced', type: 'int', min: 1, max: 1024, applies: 'now',
    label: 'Largest reply kept (MB)',
    help: 'Longer replies still pass through; the log keeps this much.',
  },
  {
    key: 'upstreamTimeoutSec', tab: 'advanced', type: 'int', min: 1, max: 86400, applies: 'now',
    label: 'Model timeout (seconds)',
    help: 'Give up on a model that sends nothing for this long.',
  },
  {
    key: 'ruleTimeoutMs', tab: 'advanced', type: 'int', min: 1, max: 60000, applies: 'now',
    label: 'Rule time limit (ms)',
    help: 'A rule that takes longer is switched off for the session.',
  },
  {
    key: 'showStartScreen', tab: 'start', type: 'bool', applies: 'now',
    label: 'Show the start screen',
    help: 'Untick to start recording as soon as ContextWeir opens. '
      + 'The screen still comes back if the receiving port is taken.',
  },
  {
    key: 'showThanks', tab: 'start', type: 'bool', applies: 'now',
    label: 'Show the thank-you note',
    help: 'The note shown when the panel opens. Untick "Don\'t show this again" in it, or here.',
  },
  {
    key: 'remoteWarningAcceptedFor', tab: 'start', type: 'accepted', applies: 'now',
    label: 'Outside-address warning accepted for',
    help: 'Set only by the warning\'s "Don\'t show this again" (for that one address). Empty it to see the warning again.',
  },
];
const RESTART_KEYS = FIELDS.filter(f => f.applies === 'restart').map(f => f.key);

// The names that mean "this computer". Used for the model address and for the
// Host and Origin checks.
const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '::1', '[::1]'];

// ContextWeir's own program folders: the log folder may not be one of these. Compared without
// case on Windows and Mac (whose disks ignore it), without trailing dots or spaces (Windows drops
// them), and through any link (realpath), so "LIB", "lib." or a link to lib are caught too.
const PROGRAM_FOLDERS = ['', 'lib', 'ui', 'launch', 'icon', 'schemas'].map(sub => path.join(HERE, sub));
function comparablePath(p) {
  let out = p;
  try { out = fs.realpathSync.native(p); } catch (_) { /* not there yet: compare as written */ }
  out = out.replace(/[. ]+$/, '').replace(/[\\/]+$/, '');
  return process.platform === 'linux' ? out : out.toLowerCase();
}
function isProgramFolder(full) {
  const target = comparablePath(full);
  return PROGRAM_FOLDERS.some(p => comparablePath(p) === target);
}

// Check a whole settings object. Returns { settings, problems }; settings has
// the defaults filled in. Folders are checked here, before anything is written.
function checkSettings(user) {
  const problems = [];
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    return { settings: null, problems: ['settings must be an object'] };
  }

  // Start from the defaults; take the known keys from the file; name unknown ones.
  // ("_about" is the credit line; "uiPort" is left over from 0.4 and ignored.)
  const s = { ...DEFAULTS };
  for (const f of FIELDS) {
    if (user[f.key] !== undefined) s[f.key] = user[f.key];
  }
  for (const key of Object.keys(user)) {
    if (!Object.hasOwn(DEFAULTS, key) && key !== '_about' && key !== 'uiPort') problems.push(`unknown setting "${key.slice(0, 60)}"`);
  }

  for (const f of FIELDS) {
    const v = s[f.key];

    if (f.type === 'port' && !(Number.isInteger(v) && v >= 1024 && v <= 65535)) {
      problems.push(`${f.label}: a whole number from 1024 to 65535`);
    }
    if (f.type === 'int' && !(Number.isInteger(v) && v >= f.min && v <= f.max)) {
      problems.push(`${f.label}: a whole number from ${f.min} to ${f.max}`);
    }
    if (f.type === 'bool' && typeof v !== 'boolean') {
      problems.push(`${f.label}: yes or no`);
    }
    if (f.type === 'choice' && !(typeof v === 'string' && LOOPBACK_NAMES.includes(v))) {
      problems.push(`${f.label}: must be this computer (127.0.0.1, localhost or ::1)`);
    }
    if (f.type === 'url' || f.type === 'accepted') {
      if (typeof v !== 'string') { problems.push(`${f.label}: an address, or empty`); continue; }
      if (v !== '') {
        const why = remoteUrlProblem(v);
        if (why) problems.push(`${f.label}: ${why}`);
      }
    }

    if (f.type === 'folder') {
      if (typeof v !== 'string') { problems.push(`${f.label}: a folder name or path`); continue; }
      if (v.length > 400 || /[\0\r\n]/.test(v)) { problems.push(`${f.label}: not a usable path`); continue; }
      if (!v.trim()) {
        if (!f.optional) problems.push(`${f.label}: a folder name or path`);
        continue;
      }
      // Network paths (\\host\share, //host/share, \\?\ and \\.\ forms) are refused: just checking
      // one exists would make Windows contact that computer, and logs must stay on this one.
      if (/^[\\/]{2}/.test(v.trim())) { problems.push(`${f.label}: a folder on this computer, not a network path`); continue; }
      const full = path.resolve(HERE, v);
      if (path.parse(full).root === full) { problems.push(`${f.label}: not the top of a drive`); continue; }

      if (f.key === 'logsDir') {
        if (isProgramFolder(full)) {
          problems.push(`${f.label}: not one of ContextWeir's own program folders`);
        } else if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) {
          problems.push(`${f.label}: that is a file, not a folder`);
        } else if (!fs.existsSync(full) && !fs.existsSync(path.dirname(full))) {
          problems.push(`${f.label}: the folder above it does not exist (${path.dirname(full)})`);
        }
      }
      if (f.key === 'sillyTavernDir' && !fs.existsSync(path.join(full, 'package.json'))) {
        problems.push(`${f.label}: no package.json there (choose the folder that holds Start.bat)`);
      }
    }
  }

  if (s.relayPort === s.targetPort) {
    problems.push('The receiving port and the model server port cannot be the same');
  }
  if (s.allowRemoteModel === true && s.remoteUrl === '') {
    problems.push('Model server on another computer: needed when "Allow a model server on another computer" is ticked');
  }
  return { settings: s, problems };
}

// --- Outside addresses (0.6, user 25 Nov) ---------------------------------------
// A remote model server is given as one address: http or https, a host, an optional port and an
// optional path that goes in front of every request path (https://openrouter.ai/api + /v1/...).
// Refused: user names or passwords in it (they would be logged and shown), a query or #part, odd
// characters in the path, "..", and any address on this computer (use the fields above for those).

// An IPv6 address as eight numbers (null if it is not one). Handles "::" and a dotted IPv4 tail.
function ipv6Groups(h) {
  if (net.isIPv6(h) !== true) return null;
  let text = h;
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = v4[1].split('.').map(Number);
    text = text.slice(0, -v4[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map(x => parseInt(x || '0', 16));
}

// What kind of address a host is: 'loopback' (this computer), 'linklocal' (169.254.x.x, fe80::,
// including cloud metadata addresses), or '' for anything else. IPv4 inside IPv6 is unwrapped.
function hostKind(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback';
  let v4 = net.isIPv4(h) ? h.split('.').map(Number) : null;
  const g = ipv6Groups(h);
  if (g) {
    if (g.every(x => x === 0) || (g.slice(0, 7).every(x => x === 0) && g[7] === 1)) return 'loopback';
    if ((g[0] & 0xffc0) === 0xfe80) return 'linklocal';
    if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) v4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  }
  if (v4) {
    if (v4[0] === 127 || v4[0] === 0) return 'loopback';
    if (v4[0] === 169 && v4[1] === 254) return 'linklocal';
  }
  return '';
}
function isLoopbackHost(hostname) { return hostKind(hostname) === 'loopback'; }

// Only the scheme and computer name of an address, for the console and the diagnostic report
// (a path can hold a token).
function shortAddress(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch (_) { return '(an address)'; }
}

function remoteUrlProblem(v) {
  if (v.length > 300) return 'at most 300 characters';
  if (/[\0-\x20\x7f\\]/.test(v)) return 'no spaces, control characters or backslashes';
  // Letters outside plain ASCII can disguise an address (a Cyrillic "о" in "openrouter"): refused.
  if (/[^\x21-\x7e]/.test(v)) return 'plain letters only (a look-alike letter can disguise an address; use the xn-- form)';
  let u;
  try { u = new URL(v); } catch (_) { return 'not an address (start it with http:// or https://)'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'must start with http:// or https://';
  if (u.username || u.password) return 'no user name or password in the address (your frontend sends the API key)';
  if (u.search || u.hash || v.includes('?') || v.includes('#')) return 'no ? or # part';
  if (!u.hostname) return 'no computer name in it';
  // The computer name must read exactly as it will be used (no %-codes, no hidden default port).
  const typedHost = v.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (typedHost !== u.host.toLowerCase()) return `write it in its plain form: ${u.protocol}//${u.host}`;
  const kind = hostKind(u.hostname);
  if (kind === 'loopback') return 'that is this computer: untick "Allow a model server on another computer" and use the fields above';
  if (kind === 'linklocal') return 'link-local addresses (169.254.x.x, fe80::, cloud metadata) are refused';
  // The path as typed (the parser would quietly fold "a/../b" into "b"), and as parsed.
  const typedPath = v.replace(/^https?:\/\/[^/]*/i, '');
  const p = u.pathname;
  if (!/^[A-Za-z0-9/._~-]*$/.test(p) || !/^[A-Za-z0-9/._~-]*$/.test(typedPath)
    || typedPath.split('/').some(seg => seg === '..' || seg === '.')) return 'the path part has characters ContextWeir does not accept';
  return '';
}

// Where requests go, worked out from the settings in use.
//   { remote: false, host, port, label }   or
//   { remote: true, protocol, hostname, port, basePath, hostHeader, label }
function modelTarget(s) {
  if (s.allowRemoteModel && s.remoteUrl) {
    const u = new URL(s.remoteUrl);
    const secure = u.protocol === 'https:';
    return {
      remote: true, secure,
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port ? Number(u.port) : (secure ? 443 : 80),
      basePath: u.pathname.replace(/\/+$/, ''),
      hostHeader: u.host,
      label: s.remoteUrl.replace(/\/+$/, ''),
    };
  }
  return { remote: false, host: s.targetHost, port: s.targetPort, label: `${s.targetHost}:${s.targetPort}` };
}

// Has the person accepted the warning for the remote address now in use? Either in this run (OK in
// the popup) or for good, for that exact address ("Don't show this again").
let remoteAcceptedThisRun = '';   // the address OK was pressed for, since ContextWeir started

function remoteWarningNeeded() {
  if (!(settings.allowRemoteModel && settings.remoteUrl)) return false;
  const url = settings.remoteUrl;
  return !(remoteAcceptedThisRun === url || savedSettings.remoteWarningAcceptedFor === url);
}

// For use at start-up and on Restart: a problem with an optional setting (the
// SillyTavern folder, only used for a version number) must not stop the
// recorder. It is switched off for this run and reported as a warning.
let settingsWarnings = [];

function checkForUse(raw) {
  const result = checkSettings(raw);
  if (!result.settings) return result;

  const optionalLabels = FIELDS.filter(f => f.optional).map(f => f.label);
  const isAbout = (problem, label) => problem.startsWith(label + ':');
  const warnings = result.problems.filter(p => optionalLabels.some(label => isAbout(p, label)));

  if (warnings.length) {
    for (const f of FIELDS) {
      if (f.optional && warnings.some(p => isAbout(p, f.label))) result.settings[f.key] = '';
    }
    result.problems = result.problems.filter(p => !warnings.includes(p));
  }
  return { ...result, warnings };
}

// Read settings.json at start-up. A missing file is created with the defaults;
// a broken one stops ContextWeir with a plain message.
function readSettingsFile() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
    return { ...DEFAULTS };
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) {
    fail(`settings.json is ${jsonError(e)}`, 'CW-SETTINGS-BAD-JSON');
  }
}

// The same, for Restart: a broken file is reported to the panel instead of
// ending the program.
function readSettingsFileQuiet() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) {
    return { __bad: `settings.json is ${jsonError(e)}` };
  }
}

// Save checked settings: keep the old file as settings.json.bak, write a
// temporary file, rename it over (never a half-written file). "_about" stays.
function writeSettingsFile(s) {
  let about;
  try { about = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))._about; } catch (_) { /* no file yet */ }

  const out = about ? { _about: about } : {};
  for (const key of Object.keys(DEFAULTS)) out[key] = s[key];

  const tmp = SETTINGS_FILE + '.tmp';
  if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS_FILE);
}

// Stop at start-up with a plain message and its code (only before anything is running).
// A JSON parse error in plain words, WITHOUT the bit of the file Node quotes around the bad
// character (since Node 20 it does: that could be prompt or story text). Keeps the position.
function jsonError(e) {
  const where = String(e && e.message || '').match(/position (\d+)(?: \(line (\d+) column (\d+)\))?/);
  if (!where) return 'not valid JSON';
  return where[2] ? `not valid JSON (line ${where[2]}, column ${where[3]})` : `not valid JSON (at character ${where[1]})`;
}

function fail(msg, code = 'UNKNOWN') {
  diag.note(code, msg);
  console.error(`${TOOL}: ${msg}`);
  console.error(`  (${code}: see "Error codes" in help.html)`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// 1b. Checking files from the command line (for people and AI assistants)
// ----------------------------------------------------------------------------
//   node contextweir.js --check                   settings.json and rules.json
//   node contextweir.js --check-settings <file>   one settings file
//   node contextweir.js --check-rules <file>      one rule file (e.g. before sharing it)
//   node contextweir.js --schema settings|rules|setup   print a JSON Schema
// Runs exactly the checks the panel and start-up use, prints what it finds and
// exits. It never starts recording, never opens a port and never writes a file.
// Exit codes: 0 no problems (notes are fine), 1 problems found, 2 a file could not
// be read or is not valid JSON, 3 wrong use (unknown option, missing file name).

function readJsonForCheck(file) {
  try {
    return { json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? `not found: ${file}` : `${file} is ${jsonError(e)}` };
  }
}

function checkSettingsFileCli(file) {
  console.log(`settings: ${file}`);
  const read = readJsonForCheck(file);
  if (read.error) {
    console.log(`  ERROR ${read.error} (CW-SETTINGS-BAD-JSON)`
      + (/^not found/.test(read.error) ? '\n  (ContextWeir makes one with the defaults when it starts.)' : ''));
    return 2;
  }
  const result = checkForUse(read.json);
  if (!result.settings) { console.log('  PROBLEM settings must be an object (CW-SETTINGS-PROBLEMS)'); return 1; }
  for (const w of result.warnings || []) console.log(`  note    ${w} (left out when ContextWeir runs; CW-SILLYTAVERN-FOLDER)`);
  for (const p of result.problems) console.log(`  PROBLEM ${p}`);
  if (result.problems.length) {
    console.log(`  ${result.problems.length} problem(s): ContextWeir would refuse to start with this file (CW-SETTINGS-PROBLEMS).`);
    return 1;
  }
  console.log('  ok');
  return 0;
}

function checkRulesFileCli(file) {
  const { validateRules: validate } = require('./lib/rules_engine');
  console.log(`rules: ${file}`);
  const read = readJsonForCheck(file);
  if (read.error) { console.log(`  ERROR ${read.error} (CW-RULES-BAD-JSON)`); return 2; }
  const checked = validate(read.json, path.basename(file));
  const ruleCount = checked.groups.reduce((n, g) => n + g.rules.length, 0);
  for (const p of checked.problems) console.log(`  PROBLEM ${p}`);
  console.log(`  ${checked.groups.length} set(s), ${ruleCount} usable rule(s)`
    + (checked.problems.length ? `, ${checked.problems.length} problem(s) (CW-RULES-PROBLEMS)` : ''));
  if (!checked.problems.length) console.log('  ok');
  return checked.problems.length ? 1 : 0;
}

// JSON Schemas (draft 2020-12) made from the same lists the checks use (FIELDS,
// the rule engine's TARGETS, TESTS, SEVERITIES and LIMITS), so a schema can never
// disagree with ContextWeir. Shipped in schemas\ (made by: node contextweir.js
// --schema settings > schemas/settings.schema.json, and the same for rules and setup).
// A schema catches shapes and ranges; only --check also tests folders, patterns
// that could run slowly, and the two ports being different.
function schemaFor(kind) {
  const engine = require('./lib/rules_engine');
  const base = id => ({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `contextweir-${id}.schema.json`,
    $comment: `Made by ContextWeir ${VERSION} (node contextweir.js --schema ${id}). Directed by Harahel-Whot. `
      + 'Written by Claude Opus 5.5 (Anthropic). Licence: MIT. A schema checks shapes and ranges only: '
      + 'run node contextweir.js --check as well.',
  });

  const settingsProperties = { _about: { type: 'string', description: 'credit line; ignored by ContextWeir' } };
  for (const f of FIELDS) {
    const prop = { description: `${f.label}. ${f.help} Applies: ${f.applies === 'now' ? 'at once' : 'after Restart'}.`, default: DEFAULTS[f.key] };
    if (f.type === 'port') Object.assign(prop, { type: 'integer', minimum: 1024, maximum: 65535 });
    if (f.type === 'int') Object.assign(prop, { type: 'integer', minimum: f.min, maximum: f.max });
    if (f.type === 'bool') prop.type = 'boolean';
    if (f.type === 'choice') Object.assign(prop, { type: 'string', enum: LOOPBACK_NAMES });
    if (f.type === 'folder') Object.assign(prop, { type: 'string', maxLength: 400 });
    if (f.type === 'url' || f.type === 'accepted') {
      Object.assign(prop, { type: 'string', maxLength: 300, pattern: '^(https?://.+)?$' });
    }
    settingsProperties[f.key] = prop;
  }
  const settingsSchema = { type: 'object', properties: settingsProperties, additionalProperties: false };

  const test = {
    type: 'object',
    required: ['target', 'test', 'value'],
    properties: {
      target: { enum: engine.TARGETS, description: 'reply, prompt (every message), lastUser (the player\'s last message), lastMessage (the last message sent)' },
      test: { enum: engine.TESTS, description: 'startsWith / contains / missing ignore case; regex / regexMissing are patterns' },
      value: { type: 'string', maxLength: engine.MAX_PATTERN },
      flags: { type: 'string', pattern: '^[imsu]{0,4}$', description: 'pattern flags, e.g. "i" to ignore case' },
    },
  };
  const rule = {
    type: 'object',
    required: ['name', 'target', 'test', 'value'],
    properties: {
      ...test.properties,
      name: { type: 'string', minLength: 1, maxLength: engine.LIMITS.name, description: 'unique within its set' },
      enabled: { type: 'boolean', default: true },
      severity: { enum: engine.SEVERITIES, default: 'warning' },
      unless: { type: 'array', maxItems: engine.LIMITS.unless, items: test, description: 'the rule is skipped when any of these holds' },
      note: { type: 'string', maxLength: engine.LIMITS.note, description: 'why this rule exists' },
    },
  };
  const rulesSchema = {
    type: 'object',
    required: ['format', 'groups'],
    properties: {
      _about: { type: 'string' },
      format: { const: 'contextweir-rules' },
      version: { const: 1 },
      groups: {
        type: 'array',
        maxItems: engine.LIMITS.groups,
        items: {
          type: 'object',
          required: ['name', 'rules'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: engine.LIMITS.groupName, description: 'unique; a set of rules' },
            enabled: { type: 'boolean', default: true },
            rules: { type: 'array', maxItems: engine.LIMITS.rulesPerGroup, items: rule },
          },
        },
      },
    },
  };

  if (kind === 'settings') return { ...base('settings'), title: 'ContextWeir settings.json', ...settingsSchema };
  if (kind === 'rules') return { ...base('rules'), title: 'ContextWeir rule file (rules.json, or an exported rule set)', ...rulesSchema };
  if (kind === 'setup') {
    return {
      ...base('setup'), title: 'ContextWeir setup file (settings and rule sets together)',
      type: 'object',
      required: ['format', 'settings', 'rules'],
      properties: {
        _about: { type: 'string' }, format: { const: 'contextweir-setup' }, version: { const: 1 },
        exported: { type: 'string' }, from: { type: 'string' }, foldersIncluded: { type: 'boolean' },
        settings: { ...settingsSchema, properties: Object.fromEntries(Object.entries(settingsProperties).filter(([k]) => k !== '_about')) },
        rules: rulesSchema,
      },
    };
  }
  return null;
}

function commandLine(args) {
  const usage = 'Usage:\n  node contextweir.js                         start ContextWeir\n'
    + '  node contextweir.js --check                 check settings.json and rules.json\n'
    + '  node contextweir.js --check-settings <file> check one settings file\n'
    + '  node contextweir.js --check-rules <file>    check one rule file\n'
    + '  node contextweir.js --schema settings|rules|setup   print a JSON Schema for that file\n'
    + 'Exit codes: 0 no problems, 1 problems found, 2 unreadable or not JSON, 3 wrong use.';
  const [option, file] = args;
  if (option === '--help' || option === '-h') { console.log(usage); return 0; }
  if (option === '--schema') {
    const schema = schemaFor(file);
    if (!schema) { console.log('--schema needs settings, rules or setup\n' + usage); return 3; }
    process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
    return 0;
  }
  if (option === '--check') {
    if (file) { console.log('--check takes no file name (use --check-settings or --check-rules)\n' + usage); return 3; }
    const a = checkSettingsFileCli(SETTINGS_FILE);
    const b = fs.existsSync(RULES_FILE) ? checkRulesFileCli(RULES_FILE) : (console.log(`rules: ${RULES_FILE}\n  note    not found: no flag rules (CW-RULES-MISSING)`), 0);
    return Math.max(a, b);
  }
  if (option === '--check-settings' || option === '--check-rules') {
    if (!file) { console.log(`${option} needs a file name\n` + usage); return 3; }
    const full = path.resolve(process.cwd(), file);
    return option === '--check-settings' ? checkSettingsFileCli(full) : checkRulesFileCli(full);
  }
  console.log(`unknown option "${option}"\n` + usage);
  return 3;
}

if (process.argv.length > 2) {
  let code;
  try {
    code = commandLine(process.argv.slice(2));
  } catch (e) {
    console.log(`  ERROR the file could not be checked (${e.name}); it is not a usable file`);
    code = 1;
  }
  process.exit(code);
}

let savedSettings;   // what settings.json says now
let settings;        // what is in use (see the top of this section)
{
  const result = checkForUse(readSettingsFile());
  if (result.problems.length) fail('settings.json has problems:\n  - ' + result.problems.join('\n  - '), 'CW-SETTINGS-PROBLEMS');
  settingsWarnings = result.warnings.map(w => w + ' (left out for now)');
  for (const w of settingsWarnings) {
    diag.note('CW-SILLYTAVERN-FOLDER', w);
    console.log(`${TOOL}: note: ${w} (CW-SILLYTAVERN-FOLDER)`);
  }
  savedSettings = result.settings;
  settings = { ...savedSettings };
}

// A folder setting as a full path ('' when it is not set).
const resolvedFolder = (s, key) => (s[key] ? path.resolve(HERE, s[key]) : '');


// ----------------------------------------------------------------------------
// 2. Flag rules (data only, never code)
// ----------------------------------------------------------------------------
// rules.json holds groups of rules. Each rule is a target, a test and a value,
// for example: reply / starts with / OOC. Rules are validated on load; anything
// unexpected is refused. Raw patterns (regex) are allowed but limited in length
// and screened for the shapes that can freeze a program. The checking itself
// lives in lib/rules_engine.js, shared with the worker thread.

const { validateRules, rulesToFile, messagesOf, contentText, LIMITS } = require('./lib/rules_engine');

function loadRules() {
  if (!fs.existsSync(RULES_FILE)) {
    diag.note('CW-RULES-MISSING');
    return { groups: [], problems: ['rules.json not found: no flag rules (CW-RULES-MISSING)'] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch (e) {
    diag.note('CW-RULES-BAD-JSON', jsonError(e));
    return { groups: [], problems: [`rules.json is ${jsonError(e)} (CW-RULES-BAD-JSON)`] };
  }
  let checked;
  try {
    checked = validateRules(raw, 'rules.json');
  } catch (e) {
    // validateRules refuses odd values itself; this is the last safety net (never a crash at start-up).
    diag.note('CW-RULES-PROBLEMS', `rules.json could not be checked: ${e.name}`);
    return { groups: [], problems: [`rules.json could not be checked (${e.name}): no flag rules (CW-RULES-PROBLEMS)`] };
  }
  if (checked.problems.length) diag.note('CW-RULES-PROBLEMS', `${checked.problems.length} problem(s) in rules.json`);
  return checked;
}

// Save a checked rule set: keep the previous file as rules.json.bak, write to
// a temporary file, then rename it over rules.json (never a half-written file).
function saveRules(groups) {
  const text = JSON.stringify(rulesToFile(groups), null, 2) + '\n';
  const tmp = RULES_FILE + '.tmp';
  if (fs.existsSync(RULES_FILE)) fs.copyFileSync(RULES_FILE, RULES_FILE + '.bak');
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, RULES_FILE);
  rules = { groups, problems: [] };
  switchedOff.clear();                // a new rule set gets a fresh chance
  sendRulesToWorker();
}

let rules = loadRules();   // { groups, problems }

// ----------------------------------------------------------------------------
// 2b. Running the rules, with a time limit
// ----------------------------------------------------------------------------
// The rules run in a worker thread (lib/rules_worker.js), one turn at a time.
// If a turn's checks take longer than ruleTimeoutMs, the worker is stopped,
// the rule that was running is named and switched off for this session (until
// ContextWeir restarts or the rules are saved again), and the turn is checked
// once more without it. The model's reply has already gone back to the
// frontend before any checking starts, so a slow rule never delays play.
//
// How the running rule is named: the worker writes the position of each rule
// into a small shared counter ("progress") just before running it. When the
// time runs out, the counter says which rule it was stuck on.

const { Worker } = require('worker_threads');

const switchedOff = new Map();   // rule id -> { name, group, ms, time }
let worker = null;
let progress = null;             // Int32Array over the shared counter: [0] = rule position + 1
let jobCount = 0;                // each check gets a job number, so a late answer is never mistaken
let waiting = null;              // { job, done(flags) } for the check under way
let checkQueue = Promise.resolve();   // one check at a time, in order

// The rule sets without the rules switched off this session.
function activeGroups() {
  return rules.groups.map(g => ({ ...g, rules: g.rules.filter(r => !switchedOff.has(r.id)) }));
}

// A flag ContextWeir adds about itself (shown like any other flag).
const selfFlag = (severity, name) => ({ rule: 'contextweir', name, group: TOOL, severity, target: 'reply', match: '' });

function startWorker() {
  const shared = new SharedArrayBuffer(4);
  progress = new Int32Array(shared);
  worker = new Worker(path.join(HERE, 'lib', 'rules_worker.js'), { workerData: { progress: shared } });
  worker.on('message', msg => {
    if (waiting && msg.job === waiting.job) waiting.done(msg.flags);
  });
  worker.on('error', e => {
    diag.note('CW-RULE-WORKER', e.message);
    if (waiting) waiting.done([selfFlag('note', 'rule worker failed: ' + e.message)]);
    restartWorker();
  });
  worker.unref();   // the worker alone never keeps the program running
  sendRulesToWorker();
}

function sendRulesToWorker() {
  if (worker) worker.postMessage({ type: 'rules', file: rulesToFile(activeGroups()) });
}

function restartWorker() {
  const old = worker;
  worker = null;
  if (old) old.terminate().catch(() => {});
  startWorker();
}

// Check one turn. Resolves to the list of flags (never rejects).
function checkTurn(request, reply) {
  const run = () => new Promise(resolve => {
    // Every rule in order, as the worker counts them, so the counter can name one.
    const allRules = activeGroups().flatMap(g => g.rules.map(r => ({ r, group: g.name })));
    const job = ++jobCount;
    const started = Date.now();

    const timer = setTimeout(() => {
      // Too slow: name the rule that was running, switch it off, try once more without it.
      const position = Atomics.load(progress, 0) - 1;
      const culprit = allRules[position];
      waiting = null;
      restartWorkerWithout(culprit, Date.now() - started);

      const note = selfFlag('warning', culprit
        ? `Rule switched off: "${culprit.r.name}" took over ${settings.ruleTimeoutMs} ms`
        : `Rule checks took over ${settings.ruleTimeoutMs} ms`);
      if (!culprit) return resolve([note]);

      const retryJob = ++jobCount;
      const retryTimer = setTimeout(() => {
        waiting = null;
        restartWorker();
        resolve([note]);
      }, settings.ruleTimeoutMs);
      waiting = {
        job: retryJob,
        done: flags => { clearTimeout(retryTimer); waiting = null; resolve([note, ...flags]); },
      };
      try {
        worker.postMessage({ type: 'check', job: retryJob, request, reply });
      } catch (e) {
        clearTimeout(retryTimer);
        waiting = null;
        resolve([note, selfFlag('note', `rules not checked on this turn (${e.name})`)]);
      }
    }, settings.ruleTimeoutMs);

    waiting = {
      job,
      done: flags => { clearTimeout(timer); waiting = null; resolve(flags); },
    };
    try {
      worker.postMessage({ type: 'check', job, request, reply });   // throws on a request too deep to copy
    } catch (e) {
      clearTimeout(timer);
      waiting = null;
      resolve([selfFlag('note', `rules not checked on this turn (${e.name})`)]);
    }
  });

  checkQueue = checkQueue.then(run, run);
  return checkQueue;
}

function restartWorkerWithout(culprit, ms) {
  if (culprit) {
    switchedOff.set(culprit.r.id, { name: culprit.r.name, group: culprit.group, ms, time: new Date().toISOString() });
    diag.note('CW-RULE-TIMEOUT', `"${culprit.r.name}" (${culprit.group}) took ${ms} ms`);
    console.log(`  ! rule "${culprit.r.name}" (${culprit.group}) took over ${settings.ruleTimeoutMs} ms `
      + 'and is switched off until restart or the next rules save (CW-RULE-TIMEOUT)');
  }
  restartWorker();
}

startWorker();


// ----------------------------------------------------------------------------
// 3. Reading requests and replies
// ----------------------------------------------------------------------------

// Pull the text out of a reply. Servers answer in different shapes, so each
// reader is tried in turn and the first one that finds text wins:
//   openai   choices[0].message.content / .text, or streamed choices[0].delta.content / .text
//   kobold   KoboldCpp's own API: { results: [ { text } ] }, streamed { token }
//   llamacpp llama.cpp's own API: { content } (streamed the same way)
//   ollama   one JSON object per line: { response }
// Returns { text, shape }; shape "raw" means no reader matched and the reply is kept as it came.
// Only these fields are ever read from a reply.
const REPLY_READERS = [
  ['openai', o => {
    const c = Array.isArray(o.choices) ? o.choices[0] : null;
    if (!c || typeof c !== 'object') return null;
    for (const t of [c.delta && c.delta.content, c.message && c.message.content, c.text]) {
      if (typeof t === 'string') return t;
    }
    return '';   // an OpenAI-shaped piece with no text in it (e.g. the last chunk of a stream)
  }],
  ['kobold', o => {
    if (Array.isArray(o.results)) return o.results[0] && typeof o.results[0].text === 'string' ? o.results[0].text : '';
    return typeof o.token === 'string' ? o.token : null;
  }],
  ['llamacpp', o => (typeof o.content === 'string' ? o.content : null)],
  ['ollama', o => (typeof o.response === 'string' ? o.response : null)],
];

// The JSON objects in a reply: one plain object, server-sent events ("data: {...}" lines, also
// "event:" lines, which are skipped), or one object per line (Ollama). Only lines that start with
// "{" are parsed, and at most MAX_REPLY_OBJECTS of them, so a huge reply of tiny lines cannot
// hold the relay for long or fill memory (security re-check, 25 Nov).
const MAX_REPLY_OBJECTS = 100000;
function replyObjects(raw) {
  const out = [];
  const tryParse = t => {
    if (out.length >= MAX_REPLY_OBJECTS || t[0] !== '{') return;
    try { const o = JSON.parse(t); if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o); } catch (_) { /* partial or not JSON */ }
  };
  const trimmed = raw.trim();
  if (!trimmed) return out;
  // (Not /^\s*data:/m: on a long reply of blank lines that pattern takes time that grows with the
  // square of the length, and this runs on the main thread.)
  const streamed = /^data:/m.test(raw) || trimmed.startsWith('data:');
  const eachLine = fn => {
    let start = 0;
    while (start <= raw.length && out.length < MAX_REPLY_OBJECTS) {
      let end = raw.indexOf('\n', start);
      if (end < 0) end = raw.length;
      fn(raw.slice(start, end).trim());
      start = end + 1;
    }
  };
  if (streamed) {
    eachLine(t => {
      if (!t.startsWith('data:')) return;
      const data = t.slice(5).trim();
      if (data && data !== '[DONE]') tryParse(data);
    });
    return out;
  }
  tryParse(trimmed);
  if (!out.length && trimmed.includes('\n')) eachLine(t => { if (t) tryParse(t); });
  return out;
}

function extractReplyShaped(raw) {
  const objects = replyObjects(raw);
  if (!objects.length) return { text: raw, shape: 'raw' };
  for (const [shape, read] of REPLY_READERS) {
    let found = false;
    const pieces = [];
    for (const o of objects) {
      let t = null;
      try { t = read(o); } catch (_) { t = null; }
      if (t !== null) { found = true; pieces.push(t); }
    }
    if (found) return { text: pieces.join(''), shape };
  }
  return { text: raw, shape: 'raw' };
}

// "chat" (a list of messages), "text" (one prompt string) or "other".
function requestMode(request) {
  if (request && Array.isArray(request.messages)) return 'chat';
  if (request && typeof request.prompt === 'string') return 'text';
  return 'other';
}

// The text only (kept for older callers and the tests).
function extractReply(raw) { return extractReplyShaped(raw).text; }

// A fingerprint of the conversation before the newest turn. When it matches
// the previous request's, the new request is probably a swipe or regenerate.
function historyKey(request) {
  const msgs = messagesOf(request);
  let end = msgs.length;
  while (end > 0 && msgs[end - 1] && msgs[end - 1].role === 'assistant') end--;   // ignore a prefilled reply
  try {
    return crypto.createHash('sha1').update(JSON.stringify(msgs.slice(0, end))).digest('hex');
  } catch (_) {
    return null;   // a request too deeply nested to fingerprint: never counted as a swipe
  }
}


// ----------------------------------------------------------------------------
// 4. Sessions, records, statistics, versions
// ----------------------------------------------------------------------------
// A session starts each time recording starts (Start or Restart) and gets its
// own folder: records.jsonl (one line per request) and summary.json. Since
// 0.5 the summary also notes which frontend and model server versions the
// session was recorded with, when they can be found:
//   - SillyTavern: read from package.json in the SillyTavern folder, if set
//   - the model server: KoboldCpp answers /api/extra/version; any OpenAI-style
//     server lists its loaded model at /v1/models. Asked once, briefly.

const SESSION_RE = /^session_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const SESSION_FILES = ['records.jsonl', 'summary.json'];   // the only files ContextWeir writes in a session

// The current time as a folder-safe stamp: 2026-11-24T06-09-27-194Z
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

let session = null;   // { name, dir, logsDir, records, summary, stats, lastHistoryKey }

// Delete the oldest session folders beyond keepSessions. Only folders whose
// names this tool makes are ever touched, and only the files it writes inside.
function pruneSessions(logsDir, keepDir) {
  const all = fs.readdirSync(logsDir).filter(n => SESSION_RE.test(n)).sort();   // oldest first
  while (all.length > settings.keepSessions) {
    const old = path.join(logsDir, all.shift());
    if (old === keepDir) continue;
    for (const file of SESSION_FILES) {
      const p = path.join(old, file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    try { fs.rmdirSync(old); } catch (_) { /* not empty: something else is in there; leave it */ }
  }
}

// SillyTavern's version, from its package.json (read only; at most 1 MB).
function sillyTavernVersion() {
  const dir = resolvedFolder(settings, 'sillyTavernDir');
  if (!dir) return null;
  try {
    const file = path.join(dir, 'package.json');
    if (fs.statSync(file).size > 1024 * 1024) return null;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const version = String(pkg.version || '?').slice(0, 30);
    if (!/sillytavern/i.test(String(pkg.name || ''))) {
      return { name: String(pkg.name || '?').slice(0, 60), version, note: 'package.json is not SillyTavern\'s' };
    }
    return { name: 'SillyTavern', version, readFrom: 'package.json' };
  } catch (_) {
    return null;
  }
}

// Ask the model server something small (GET, loopback only, short timeout).
// Resolves to { status, json } or { status: 0, error }; never rejects.
function askModelServer(host, port, urlPath, ms = 2500) {
  return new Promise(resolve => {
    const bare = String(host).replace(/^\[|\]$/g, '');   // "[::1]" -> "::1"
    const hostHeader = `${bare === '::1' ? '[::1]' : bare}:${port}`;
    const req = http.get({ host: bare, port, path: urlPath, timeout: ms, headers: { host: hostHeader } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', d => {
        size += d.length;
        if (size < 256 * 1024) chunks.push(d);   // a version answer is tiny; keep at most 256 KB
      });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ status: 0, error: e.message === 'timeout' ? 'no answer' : (e.code || e.message) }));
  });
}

// What the model server says about itself: { server, models, reachable, error }.
async function modelServerInfo(host, port) {
  const [ver, models] = await Promise.all([
    askModelServer(host, port, '/api/extra/version'),   // KoboldCpp
    askModelServer(host, port, '/v1/models'),           // any OpenAI-style server
  ]);
  const info = {};
  if (ver.json && typeof ver.json.result === 'string') {
    info.server = { name: String(ver.json.result).slice(0, 60), version: String(ver.json.version || '?').slice(0, 30) };
  }
  if (models.json && Array.isArray(models.json.data)) {
    info.models = models.json.data.slice(0, 5).map(m => String((m && m.id) || '?').slice(0, 120));
  }
  info.reachable = !!(ver.status || models.status);
  if (!info.reachable) info.error = models.error || ver.error || 'no answer';
  return info;
}

function startSession() {
  const logsDir = resolvedFolder(settings, 'logsDir');
  fs.mkdirSync(logsDir, { recursive: true });
  const name = 'session_' + stamp();
  const dir = path.join(logsDir, name);
  fs.mkdirSync(dir);

  session = {
    name,
    dir,
    logsDir,
    lastHistoryKey: null,
    records: path.join(dir, 'records.jsonl'),
    summary: path.join(dir, 'summary.json'),
    stats: {
      ...LOG_FORMAT,
      tool: TOOL, toolVersion: VERSION, toolBuilt: BUILT, session: name,
      started: new Date().toISOString(), updated: null,
      frontend: sillyTavernVersion(), modelServer: null,
      requests: 0, swipes: 0, errors: 0, totalMs: 0, totalPromptChars: 0,
      flagged: 0, byRule: Object.create(null),   // rule name -> count (no inherited names such as "constructor")
      notLogged: 0,             // turns that passed through while logging was paused
      unrecognised: 0,          // generation requests sent to an address ContextWeir does not record
      textRequests: 0,          // requests in text-completion form (one prompt string)
    },
    unknownNoted: false,
  };
  pruneSessions(logsDir, dir);
  saveSummary();

  // A remote model server is never asked anything ContextWeir sends on its own (user, 25 Nov):
  // only the frontend's own requests go there. The summary notes the address instead.
  const target = modelTarget(settings);
  session.stats.target = target.label;
  if (target.remote) {
    session.stats.modelServer = { remote: true, address: target.label, reachable: null, note: 'remote server: version not asked' };
    saveSummary();
    return session;
  }

  // Ask the model server for its version in the background; note it if this
  // session is still the current one when the answer comes.
  const thisSession = session;
  modelServerInfo(settings.targetHost, settings.targetPort).then(info => {
    if (session === thisSession) {
      thisSession.stats.modelServer = info;
      if (!info.reachable) diag.note('CW-MODEL-NOT-ANSWERING', `${settings.targetHost}:${settings.targetPort}: ${info.error}`);
      saveSummary();
    }
  });
  return session;
}

// Write summary.json (the session's numbers) and return what was written.
function saveSummary() {
  if (!session) return null;
  const stats = session.stats;
  stats.updated = new Date().toISOString();
  const n = stats.requests || 1;
  const out = {
    ...stats,
    avgSeconds: Math.round(stats.totalMs / n / 100) / 10,
    avgPromptChars: Math.round(stats.totalPromptChars / n),
    warningsPer100: Math.round(stats.flagged / n * 1000) / 10,
  };
  try { fs.writeFileSync(session.summary, JSON.stringify(out, null, 2)); } catch (_) { /* try again next turn */ }
  return out;
}

function writeRecord(sess, record) {
  if (record.n > settings.maxRecordsPerSession) return;   // cap reached: still relays, stops logging
  try {
    fs.appendFileSync(sess.records, JSON.stringify(record) + '\n');
  } catch (e) {
    // A full disk or a locked file must not stop the relay: the turn has already passed through.
    diag.note('CW-LOG-WRITE', e.code || e.message);
    console.log(`  ! turn #${record.n} could not be saved: ${e.code || e.message} (CW-LOG-WRITE)`);
  }
}

// Folder size and session count, for the Logs tab (only this tool's folders).
function logsOverview() {
  const dir = resolvedFolder(settings, 'logsDir');
  const out = { folder: dir, sessions: 0, bytes: 0 };
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!SESSION_RE.test(name)) continue;
      out.sessions++;
      for (const file of SESSION_FILES) {
        try { out.bytes += fs.statSync(path.join(dir, name, file)).size; } catch (_) { /* not written yet */ }
      }
    }
  } catch (_) { /* no log folder yet */ }
  return out;
}


// ----------------------------------------------------------------------------
// 5. Header checks (shared by both servers)
// ----------------------------------------------------------------------------
// A web page in your browser can try to send requests to 127.0.0.1. The Host
// check stops DNS-rebinding tricks; the Origin check stops cross-site requests.

function hostOk(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  return LOOPBACK_NAMES.some(name => host === `${name}:${port}`);
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return !origin;   // no Origin: a program, not a web page
  try {
    const u = new URL(origin);
    return LOOPBACK_NAMES.includes(u.hostname) || LOOPBACK_NAMES.includes(`[${u.hostname}]`);
  } catch (_) {
    return false;
  }
}

function refuse(res, code, msg) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(`${TOOL}: ${msg}\n`);
}


// ----------------------------------------------------------------------------
// 6. The relay, and its states
// ----------------------------------------------------------------------------
// state:  ready      the panel is open, nothing listens on the relay port
//         recording  turns pass through and are saved
//         paused     turns pass through, nothing is saved
//         portTaken  Start failed because another program has the relay port

let state = 'ready';
let lastError = '';
let lastErrorCode = '';     // the code of lastError ('' when there is none)
let relay = null;           // the relay server while it listens
let relayPort = null;       // the port it listens on
const sockets = new Set();  // open connections, closed on Stop

// Headers that belong to one connection and must not be passed on.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

const withoutHopHeaders = headers => {
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (!HOP_BY_HOP.includes(k)) out[k] = v;
  return out;
};

// The addresses whose requests are recorded: generation requests. Matched exactly (the query
// string ignored), never by a loose pattern. Everything else (model lists, token counts, aborts)
// passes through unrecorded. The last two are for servers this project cannot test on
// (llama.cpp's own API, Ollama): shipped marked "untested" in the help (user, 25 Nov).
const GENERATION_PATHS = new Set([
  '/v1/chat/completions', '/chat/completions',   // chat completion (OpenAI style; KoboldCpp too)
  '/v1/completions', '/completions',             // text completion (OpenAI style; KoboldCpp too)
  '/api/v1/generate', '/api/extra/generate/stream',   // KoboldCpp's own API (KoboldAI Classic)
  '/completion',                                 // llama.cpp server's own API (untested)
  '/api/generate',                               // Ollama (untested)
]);

function requestPath(url) {
  const raw = String(url || '');
  const q = raw.indexOf('?');
  return (q >= 0 ? raw.slice(0, q) : raw).replace(/\/+$/, '') || '/';
}

function isGenerationPath(url) { return GENERATION_PATHS.has(requestPath(url)); }

// A POST to an address not on the list that still carries a "prompt" or "messages" body: the
// frontend is generating through an address ContextWeir does not know, so nothing would be
// recorded. Counted and noted once per session (the address only, never the body), so "it works
// but records nothing" is never silent. Only the start of the body is looked at.
function looksLikeGeneration(body) {
  const head = body.subarray(0, 4096).toString('utf8');
  return head.trimStart().startsWith('{') && (head.includes('"prompt"') || head.includes('"messages"'));
}

function noteUnknownEndpoint(sess, url) {
  if (!sess) return;
  // Only the first part of the address and how many parts it has: an address can carry text.
  const parts = requestPath(url).split('/').filter(Boolean);
  const where = '/' + (parts[0] || '').slice(0, 24).replace(/[^A-Za-z0-9._-]/g, '?') + (parts.length > 1 ? `/... (${parts.length} parts)` : '');
  sess.stats.unrecognised = (sess.stats.unrecognised || 0) + 1;
  if (!sess.unknownNoted) {
    sess.unknownNoted = true;
    diag.note('CW-ENDPOINT-UNKNOWN', where);
    console.log(`  ! a generation request went to ${where}, an address ContextWeir does not record (CW-ENDPOINT-UNKNOWN)`);
  }
  saveSummary();
}

// One request from the frontend: pass it to the model, stream the answer back
// as it comes, then record both.
function handleRelay(req, res) {
  try {
    relayRequest(req, res);
  } catch (e) {
    diag.note('UNKNOWN', `relay request failed: ${e.name}`);
    if (!res.headersSent) refuse(res, 500, `could not pass that on (${e.name})`);
  }
}

function relayRequest(req, res) {
  // A web page's <img> or link aimed at the relay ("no-cors", from another site) is refused: no
  // frontend sends those. Frontends running in a page on this computer still may (with an Origin).
  if (req.headers['sec-fetch-mode'] === 'no-cors' && req.headers['sec-fetch-site'] === 'cross-site') {
    diag.note('CW-REFUSED-ORIGIN', 'relay: sent by another site');
    return refuse(res, 403, diag.withCode('CW-REFUSED-ORIGIN', 'refused: sent by another site'));
  }
  if (!hostOk(req, relayPort)) {
    diag.note('CW-REFUSED-HOST', 'relay');
    return refuse(res, 403, diag.withCode('CW-REFUSED-HOST', 'refused: unexpected Host header'));
  }
  if (!originOk(req)) {
    diag.note('CW-REFUSED-ORIGIN', 'relay');
    return refuse(res, 403, diag.withCode('CW-REFUSED-ORIGIN', 'refused: request from a web page'));
  }

  // Settings are read once per request, so a change mid-request cannot mix values.
  const started = Date.now();
  const maxRequestBytes = settings.maxRequestMB * 1024 * 1024;
  const maxReplyBytes = settings.maxReplyMB * 1024 * 1024;
  const timeoutSec = settings.upstreamTimeoutSec;
  const target = modelTarget(settings);
  const sess = session;

  const chunks = [];
  let size = 0;
  let tooBig = false;

  req.on('data', chunk => {
    size += chunk.length;
    if (size > maxRequestBytes) { tooBig = true; req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('close', () => {
    if (tooBig && !res.headersSent) {
      diag.note('CW-REQUEST-TOO-LARGE', `over ${maxRequestBytes / 1024 / 1024} MB`);
      refuse(res, 413, diag.withCode('CW-REQUEST-TOO-LARGE', `request larger than ${maxRequestBytes / 1024 / 1024} MB`));
    }
  });

  req.on('end', () => {
    if (tooBig) return;
    const body = Buffer.concat(chunks);
    const isGeneration = req.method === 'POST' && isGenerationPath(req.url);   // only these are recorded
    if (req.method === 'POST' && !isGeneration && looksLikeGeneration(body)) noteUnknownEndpoint(sess, req.url);

    const headers = withoutHopHeaders(req.headers);
    headers['content-length'] = body.length;
    let upstream;
    if (target.remote) {
      // Another computer: only what the frontend itself sends goes on (its API key included).
      // Browser-only headers and cookies are dropped. https always checks the certificate.
      for (const k of Object.keys(headers)) {
        if (k === 'cookie' || k === 'origin' || k === 'referer' || k === 'forwarded' || k === 'x-real-ip'
          || k.startsWith('sec-fetch-') || k.startsWith('x-forwarded-')) delete headers[k];
      }
      headers['accept-encoding'] = 'identity';   // plain replies, so the log stays readable
      headers.host = target.hostHeader;
      const options = { host: target.hostname, port: target.port, path: target.basePath + req.url, method: req.method, headers };
      upstream = target.secure ? https.request({ ...options, rejectUnauthorized: true }) : http.request(options);
    } else {
      const bareHost = String(target.host).replace(/^\[|\]$/g, '');   // "[::1]" -> "::1"
      headers.host = `${bareHost === '::1' ? '[::1]' : bareHost}:${target.port}`;
      upstream = http.request({ host: bareHost, port: target.port, path: req.url, method: req.method, headers });
    }

    // One timer covers both "no answer" and "went silent mid-reply": it is
    // set again every time a piece of the reply arrives.
    let timer;
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => upstream.destroy(new Error('timeout')), timeoutSec * 1000);
    };
    armTimer();

    upstream.on('response', up => {
      const kept = [];
      let keptBytes = 0;
      const replyHeaders = withoutHopHeaders(up.headers);
      if (target.remote) delete replyHeaders['set-cookie'];   // a remote server's cookies stay out of the frontend
      res.writeHead(up.statusCode, replyHeaders);
      up.on('data', chunk => {
        armTimer();
        res.write(chunk);
        if (keptBytes < maxReplyBytes) { kept.push(chunk); keptBytes += chunk.length; }
      });
      up.on('end', () => {
        clearTimeout(timer);
        res.end();
        if (isGeneration) {
          const replyCut = keptBytes >= maxReplyBytes;
          // record() must never take the relay down: a request that cannot be recorded is noted and skipped.
          record(sess, req.url, body, Buffer.concat(kept).toString('utf8'), up.statusCode, Date.now() - started, replyCut)
            .catch(e => {
              diag.note('CW-LOG-WRITE', `a turn could not be recorded: ${e.name}`);
              console.log(`  ! a turn passed through but could not be recorded (${e.name}) (CW-LOG-WRITE)`);
            });
        }
      });
      up.on('error', () => { clearTimeout(timer); res.end(); });
    });

    upstream.on('error', e => {
      clearTimeout(timer);
      const timedOut = e.message === 'timeout';
      const code = timedOut ? 'CW-MODEL-TIMEOUT' : 'CW-MODEL-UNREACHABLE';
      diag.note(code, timedOut ? `${timeoutSec} s` : `${target.remote ? 'remote' : target.label} ${e.code || e.message}`);
      if (!res.headersSent) {
        refuse(res, timedOut ? 504 : 502, diag.withCode(code, timedOut
          ? `the model sent nothing for ${timeoutSec} s`
          : (target.remote ? `could not reach the model server at ${target.label} (${e.code || 'error'})`
            : `could not reach the model server on port ${target.port}`)));
      } else {
        res.end();
      }
      if (isGeneration && sess) { sess.stats.errors++; saveSummary(); }
      console.log(`  ! ${timedOut ? 'model timed out' : 'model server not reachable'} (${e.message}) (${code})`);
    });

    upstream.end(body);
  });
}

// Save one request and its reply (after the reply has gone back to the frontend).
async function record(sess, endpoint, body, rawReply, status, ms, replyCut) {
  if (!sess) return;
  const stats = sess.stats;

  // Paused, or the session ended while the reply was on its way: passed through, not saved.
  if (state === 'paused' || sess !== session) {
    stats.notLogged++;
    saveSummary();
    console.log('  (paused: a turn passed through, not saved)');
    return;
  }

  const n = ++stats.requests;
  const time = new Date().toISOString();
  let request;
  try { request = JSON.parse(body.toString('utf8')); } catch (_) { request = body.toString('utf8'); }
  const { text: reply, shape: replyShape } = extractReplyShaped(rawReply);

  const key = historyKey(request);
  const swipe = key !== null && key === sess.lastHistoryKey;
  sess.lastHistoryKey = key;
  if (swipe) stats.swipes++;
  if (requestMode(request) === 'text') stats.textRequests = (stats.textRequests || 0) + 1;

  let flags;
  try {
    flags = await checkTurn(request, reply);   // in the worker, with the time limit
  } catch (e) {
    flags = [selfFlag('note', `rules not checked on this turn (${e.name})`)];
  }

  const promptChars = messagesOf(request).reduce((sum, m) => sum + (m ? contentText(m.content).length : 0), 0);
  stats.totalMs += ms;
  stats.totalPromptChars += promptChars;
  if (flags.length) stats.flagged++;
  for (const f of flags) stats.byRule[f.name] = (stats.byRule[f.name] || 0) + 1;

  writeRecord(sess, {
    ...LOG_FORMAT, n, time, endpoint, status,
    seconds: Math.round(ms / 100) / 10, swipe, promptChars, replyCut, replyShape,
    mode: requestMode(request),
    flags, request, reply,
  });
  saveSummary();

  // One console line per turn: number, time, size and the worst flag.
  const worst = flags.some(f => f.severity === 'serious') ? 'SERIOUS'
    : flags.some(f => f.severity === 'warning') ? 'WARN'
      : flags.length ? 'note' : 'ok';
  const flagNames = flags.length ? ': ' + flags.map(f => f.name).join('; ') : '';
  console.log(`#${n}${swipe ? ' (swipe)' : ''}  ${(ms / 1000).toFixed(1)} s  ${promptChars} chars  ${worst}${flagNames}`);
}

// Open the relay port and start a session. The port never moves: if another
// program has it, nothing starts and the panel says so.
let starting = null;   // the Start in progress, so two quick presses share it

function startRelay() {
  if (starting) return starting;
  starting = openRelay().finally(() => { starting = null; });
  return starting;
}

function openRelay() {
  return new Promise(resolve => {
    if (relay) return resolve({ ok: true });
    // A model server on another computer: nothing opens until its warning is accepted.
    if (remoteWarningNeeded()) {
      state = 'ready';
      lastErrorCode = '';
      lastError = '';
      diag.note('CW-REMOTE-NOT-CONFIRMED', 'waiting for the warning to be accepted');
      console.log(`  waiting: ContextWeir is set to send your chats to ${shortAddress(settings.remoteUrl)}. `
        + 'Read the warning in the panel and press OK to start (CW-REMOTE-NOT-CONFIRMED)');
      return resolve({ ok: false, needsRemoteOk: true, error: diag.withCode('CW-REMOTE-NOT-CONFIRMED',
        `Not recording: ContextWeir is set to send your chats to ${settings.remoteUrl}. Accept the warning to start, `
        + 'or untick "Allow a model server on another computer" on the Connection tab.') });
    }
    const server = http.createServer(handleRelay);
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    server.once('error', e => {
      state = 'portTaken';
      lastErrorCode = e.code === 'EADDRINUSE' ? 'CW-PORT-TAKEN' : 'CW-PORT-FAILED';
      diag.note(lastErrorCode, `port ${settings.relayPort}: ${e.code || e.message}`);
      lastError = e.code === 'EADDRINUSE'
        ? `The receiving port ${settings.relayPort} is already in use (another copy of ContextWeir, the old logger, `
          + 'or another program). It does not move on its own, because your frontend is set to it: close whatever '
          + 'has it, or choose another port on the Connection tab and change the address in your frontend.'
        : `Could not open the receiving port ${settings.relayPort}: ${e.message}`;
      lastError = diag.withCode(lastErrorCode, lastError);
      console.log(`  ! ${lastError}`);
      resolve({ ok: false, error: lastError });
    });

    server.listen(settings.relayPort, '127.0.0.1', () => {
      relay = server;
      relayPort = settings.relayPort;
      server.on('error', e => console.log(`  ! relay: ${e.message}`));
      lastError = '';
      lastErrorCode = '';
      try {
        startSession();
      } catch (e) {
        lastErrorCode = 'CW-SESSION-FOLDER';
        diag.note(lastErrorCode, e.code || e.message);
        lastError = diag.withCode(lastErrorCode, `Could not create a session folder in ${resolvedFolder(settings, 'logsDir')}: ${e.message}`);
        console.log(`  ! ${lastError}`);
        return stopRelay().then(() => { state = 'ready'; resolve({ ok: false, error: lastError }); });
      }
      state = 'recording';
      writeRunning();
      const target = modelTarget(settings);
      console.log(`  recording: frontend -> http://127.0.0.1:${relayPort}  ->  model at ${target.remote ? shortAddress(target.label) : target.label}`
        + (target.remote ? '  (ANOTHER COMPUTER: your chats cross the network)' : ''));
      console.log(`  logging:   ${session.dir}`);
      resolve({ ok: true });
    });
  });
}

// Close the relay port (open connections too) and end the session.
function stopRelay() {
  return new Promise(resolve => {
    const server = relay;
    if (session) saveSummary();
    session = null;
    if (!server) {
      state = 'ready';
      writeRunning();
      return resolve();
    }
    relay = null;
    relayPort = null;
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
    state = 'ready';
    writeRunning();
    console.log('  stopped: the receiving port is closed (your frontend gets errors until you Start again)');
  });
}


// ----------------------------------------------------------------------------
// 7. The control panel window
// ----------------------------------------------------------------------------
// Reading needs only the Host check. Anything that changes something, presses
// a button, checks a port or contacts the model server needs more, because a
// web page in your browser could try it too:
//   - the request must come from this window's own address (Origin, same port;
//     not just any local page, so another local web app cannot do it)
//   - it must be JSON (a plain web form cannot send that without permission)
//   - at most 1 MB
// Settings and rules from the panel go through the same checks as the files.
//
// What the window can ask for:
//   GET   /, /panel, /ui.js, /ui.css, /icon.png, /help   the page itself
//   GET   /api/status, /api/settings, /api/logs, /api/about, /api/rules
//   GET   /api/rules/export[?set=<name>]                 a rule file download
//   POST  /api/control       the buttons (start, pause, resume, stop, restart, quit), and
//                            remote-ok (OK in the outside-address warning)
//   POST  /api/settings      save settings
//   POST  /api/check-port    is a port free?
//   POST  /api/test-model    does a model server answer at this address? (the saved remote one
//                            only after its warning was accepted)
//   POST  /api/rules         save the whole rule set
//   POST  /api/rules/import  preview, then merge or replace
//   GET   /api/setup/export[?folders=1]  settings and rules in one file (a download)
//   POST  /api/setup/import  preview, then apply the chosen parts
//   GET   /api/errors, /api/diagnostic[?full=1]   error codes; the diagnostic report

// The panel is served at "/" and at "/panel". The launchers open "/panel": browsers remember an
// app window's size by its address (host and path, not the port), so a path of its own gives the
// panel its own remembered size instead of PromptAssay's or an older window's on 127.0.0.1.
const UI_FILES = {
  '/': ['ui.html', 'text/html; charset=utf-8'],
  '/panel': ['ui.html', 'text/html; charset=utf-8'],
  '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'],
  '/ui.css': ['ui.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    + "img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// The help page is static text we wrote: no scripts at all, its own inline styles.
const HELP_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; "
  + "base-uri 'none'; form-action 'none'";

const MAX_UI_BODY = 1024 * 1024;
let uiPort = null;

// Did this request come from the panel's own window (same address and port)?
function sameWindowOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && LOOPBACK_NAMES.includes(u.hostname) && Number(u.port) === uiPort;
  } catch (_) {
    return false;
  }
}

function sendJson(res, code, obj, extraHeaders = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(obj));
}

// For every POST: check where it came from and what it is, read it (at most
// 1 MB), parse the JSON, then hand the object to handler(body).
function readJsonBody(req, res, handler) {
  if (!sameWindowOrigin(req)) return refuse(res, 403, 'refused: only from the ContextWeir window');
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return refuse(res, 415, 'JSON only');

  const chunks = [];
  let size = 0;
  let refused = false;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_UI_BODY && !refused) {
      refused = true;
      refuse(res, 413, 'too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_) {
      return sendJson(res, 400, { error: 'not valid JSON' });
    }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'expected an object' });
    // .then() so that a handler that throws at once is caught too, not only a failed promise.
    Promise.resolve().then(() => handler(body)).catch(e => {
      diag.note('UNKNOWN', `panel request failed: ${e.name}`);
      if (!res.headersSent) sendJson(res, 500, { error: `could not do that (${e.name})`, code: 'UNKNOWN' });
    });
  });
}

// The rule set as the window sees it: plain data plus the problems found.
function rulesView() { return { ...rulesToFile(rules.groups), problems: rules.problems }; }

// A rule set's name made safe for a download's file name.
function safeFileName(s) {
  return String(s).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'rules';
}

// Saved settings that are not in use yet (they wait for Restart).
function pendingRestart() {
  return RESTART_KEYS.filter(key => JSON.stringify(savedSettings[key]) !== JSON.stringify(settings[key]));
}

function settingsView() {
  return {
    saved: savedSettings, inUse: settings, fields: FIELDS,
    pendingRestart: pendingRestart(), defaults: DEFAULTS, toolFolder: HERE,
  };
}

function statusView() {
  return {
    tool: TOOL, version: VERSION, built: BUILT, state, lastError, lastErrorCode,
    relay: relay ? { port: relayPort, target: modelTarget(settings).label, remote: modelTarget(settings).remote } : null,
    remote: {
      inUse: !!(settings.allowRemoteModel && settings.remoteUrl), url: settings.allowRemoteModel ? settings.remoteUrl : '',
      warningNeeded: remoteWarningNeeded(),
    },
    // WS_HIDE_THANKS=1 is for the test suites only (their scripted clicks would land on the note).
    showThanks: savedSettings.showThanks !== false && process.env.WS_HIDE_THANKS !== '1',
    session: session ? session.name : null,
    sessionDir: session ? session.dir : null,
    summary: session ? saveSummary() : null,
    switchedOff: [...switchedOff.values()],
    pendingRestart: pendingRestart(),
    ruleTimeoutMs: settings.ruleTimeoutMs,
    warnings: settingsWarnings,
  };
}

// The diagnostic report (text). Built only from settings, state, counts,
// versions and ContextWeir's own console lines: never prompt or reply text.
// Rule patterns are left out of error messages too (they can hold story words).
function diagnosticReport(full, userAgent) {
  const hidePatterns = t => String(t).replace(/(Invalid regular expression: )\/.*?\/[a-z]*:/g, '$1/…/:');
  const sum = session ? saveSummary() : null;
  const ruleCount = rules.groups.reduce((n, g) => n + g.rules.length, 0);
  const rulesOn = rules.groups.reduce((n, g) => n + (g.enabled ? g.rules.filter(r => r.enabled).length : 0), 0);
  const logs = logsOverview();
  const uiFiles = ['ui/ui.html', 'ui/ui.js', 'ui/ui.css', 'help.html', 'icon/contextweir.png', 'lib/rules_worker.js'];

  const settingsLines = {};
  for (const f of FIELDS) {
    const waiting = pendingRestart().includes(f.key) ? `   (saved ${JSON.stringify(savedSettings[f.key])}, waits for Restart)` : '';
    settingsLines[f.key] = JSON.stringify(settings[f.key]) + waiting;
    // A remote address can hold a token in its path: only its scheme and computer name.
    if ((f.key === 'remoteUrl' || f.key === 'remoteWarningAcceptedFor') && settings[f.key]) {
      settingsLines[f.key] = `${shortAddress(settings[f.key])}/... (shortened)`
        + (pendingRestart().includes(f.key) ? '   (a saved change waits for Restart)' : '');
    }
  }

  const sections = [
    ['ContextWeir now', {
      State: state,
      'Last error': lastError || '(none)',
      'Receiving port': relay ? `${relayPort} (open)` : `${settings.relayPort} (closed)`,
      'Model server': modelTarget(settings).remote ? `another computer (${modelTarget(settings).secure ? 'https' : 'http'})`
        : `${settings.targetHost}:${settings.targetPort}`,
      'Panel port': uiPort,
      Session: session ? session.name : '(none)',
      'Session folder': session ? session.dir : '(none)',
      'Settings file': SETTINGS_FILE,
      Notes: settingsWarnings.join('; ') || '(none)',
    }],
    ['Settings in use', settingsLines],
    ['Versions seen this session', {
      Frontend: sum && sum.frontend ? `${sum.frontend.name} ${sum.frontend.version}` : '(not known)',
      'Model server': sum && sum.modelServer
        ? (sum.modelServer.reachable
          ? [sum.modelServer.server ? `${sum.modelServer.server.name} ${sum.modelServer.server.version}` : 'answered',
            ...(sum.modelServer.models || [])].join('; ')
          : `did not answer (${sum.modelServer.error})`)
        : '(not asked yet)',
    }],
    ['This session (numbers only)', sum ? {
      Requests: sum.requests, Swipes: sum.swipes, 'Model errors': sum.errors, Flagged: sum.flagged,
      'Passed through while paused': sum.notLogged, 'Avg reply time (s)': sum.avgSeconds,
      'Avg prompt (chars)': sum.avgPromptChars,
      'Flags by rule': Object.entries(sum.byRule).map(([name, n]) => `${name} x${n}`).join('; ') || '(none)',
    } : ['(no session)']],
    ['Flag rules', {
      'Rules file': RULES_FILE,
      Sets: rules.groups.length,
      Rules: `${ruleCount} (${rulesOn} switched on)`,
      'Switched off this session': [...switchedOff.values()].map(r => `${r.name} (${r.group}, ${r.ms} ms)`).join('; ') || '(none)',
      Problems: rules.problems.length ? rules.problems.map(hidePatterns).join(' | ') : '(none)',
    }],
    ['Log folder', { Folder: logs.folder, Sessions: logs.sessions, Size: `${(logs.bytes / 1e6).toFixed(1)} MB` }],
    ['Window', {
      Browser: browserName(userAgent),
      'Page files': uiFiles.map(f => `${f} ${fs.existsSync(path.join(HERE, f)) ? 'ok' : 'MISSING'}`).join(', '),
    }],
    ['Recent problems (oldest first; codes are explained in help.html)', problemLines(diag)],
    ['Recent console lines', diag.consoleLines().map(hidePatterns)],
  ];
  return formatReport(TOOL, VERSION, BUILT, sections, full);
}

// Is a port free on this computer? Opens it for a moment and closes it again.
function portFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

// --- GET: the page, its pieces, and read-only answers --------------------------

function handleGet(url, res, req) {
  if (UI_FILES[url.pathname]) {
    const [file, type] = UI_FILES[url.pathname];
    res.writeHead(200, { 'Content-Type': type, ...SECURITY_HEADERS });
    return res.end(fs.readFileSync(path.join(HERE, 'ui', file)));
  }
  if (url.pathname === '/api/status') return sendJson(res, 200, statusView());
  if (url.pathname === '/api/settings') return sendJson(res, 200, settingsView());
  if (url.pathname === '/api/logs') return sendJson(res, 200, logsOverview());

  // The tool's icon: shown on the window, its taskbar button and in the header.
  if (url.pathname === '/icon.png' || url.pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/png', ...SECURITY_HEADERS });
    return res.end(fs.readFileSync(path.join(HERE, 'icon', 'contextweir.png')));
  }
  if (url.pathname === '/help') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, 'Content-Security-Policy': HELP_CSP });
    return res.end(fs.readFileSync(path.join(HERE, 'help.html')));
  }
  if (url.pathname === '/api/about') return sendJson(res, 200, ABOUT);
  if (url.pathname === '/api/rules') return sendJson(res, 200, rulesView());
  if (url.pathname === '/api/errors') return sendJson(res, 200, { codes: CODES, recent: diag.problems() });
  if (url.pathname === '/api/diagnostic') {
    // The report is only text the page shows before the person saves it themselves.
    const full = url.searchParams.get('full') === '1';
    return sendJson(res, 200, { text: diagnosticReport(full, req.headers['user-agent']), full });
  }

  if (url.pathname === '/api/setup/export') {
    // Settings and rules in one file, offered as a download. Folders only if asked.
    const withFolders = url.searchParams.get('folders') === '1';
    const name = `contextweir-setup_${stamp().slice(0, 16)}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      ...SECURITY_HEADERS,
    });
    return res.end(JSON.stringify(setupFile(withFolders), null, 2) + '\n');
  }
  if (url.pathname === '/api/rules/export') {
    // All sets, or one set by name. Offered to the browser as a file download.
    const only = url.searchParams.get('set');
    const groups = only ? rules.groups.filter(g => g.name === only) : rules.groups;
    if (only && !groups.length) return refuse(res, 404, 'no such set');
    const name = `contextweir-rules_${safeFileName(only || 'all')}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      ...SECURITY_HEADERS,
    });
    return res.end(JSON.stringify(rulesToFile(groups), null, 2) + '\n');
  }
  return refuse(res, 404, 'not found');
}

// --- POST /api/control: the buttons ---------------------------------------------

async function pressButton(action, res, body = {}) {
  if (action === 'remote-ok') {
    // OK in the outside-address warning. Only for the address saved now, and only while the
    // setting is on, so the window cannot be used to approve some other address.
    // The address saved now, or the one in use (while a saved change waits for Restart).
    const url = typeof body.url === 'string' ? body.url : '';
    const savedOk = savedSettings.allowRemoteModel && url === savedSettings.remoteUrl;
    const inUseOk = settings.allowRemoteModel && url === settings.remoteUrl;
    if (!url || !(savedOk || inUseOk)) {
      return sendJson(res, 409, { ...statusView(), error: 'That address is not the one in the settings.' });
    }
    remoteAcceptedThisRun = url;
    if (body.dontShowAgain === true && savedSettings.remoteWarningAcceptedFor !== url) {
      try {
        writeSettingsFile({ ...savedSettings, remoteWarningAcceptedFor: url });
      } catch (e) {
        diag.note('CW-SETTINGS-WRITE', e.code || e.message);
        return sendJson(res, 500, { error: diag.withCode('CW-SETTINGS-WRITE', 'could not write settings.json: ' + e.message), code: 'CW-SETTINGS-WRITE' });
      }
      savedSettings = { ...savedSettings, remoteWarningAcceptedFor: url };
      settings.remoteWarningAcceptedFor = url;
    }
    console.log(`  warning accepted for ${shortAddress(url)}${body.dontShowAgain === true ? ' (not shown again for this address)' : ''}`);
    if (body.start !== true || relay) return sendJson(res, 200, statusView());
    action = 'start';
  }

  if (action === 'start') {
    if (relay) return sendJson(res, 200, statusView());
    const result = await startRelay();
    return sendJson(res, result.ok ? 200 : 409, { ...statusView(), error: result.error, needsRemoteOk: !!result.needsRemoteOk });
  }

  if (action === 'pause' || action === 'resume') {
    if (!relay) return sendJson(res, 409, { ...statusView(), error: 'Not recording: press Start first.' });
    state = action === 'pause' ? 'paused' : 'recording';
    writeRunning();
    console.log(action === 'pause'
      ? '  paused: turns pass straight through, nothing is saved'
      : '  resumed: saving turns again');
    return sendJson(res, 200, statusView());
  }

  if (action === 'stop') {
    await stopRelay();
    return sendJson(res, 200, statusView());
  }

  if (action === 'restart') {
    // Apply everything saved (ports, model address, folders) and start a new session.
    const raw = readSettingsFileQuiet();
    if (raw.__bad) {
      diag.note('CW-SETTINGS-BAD-JSON', raw.__bad);
      return sendJson(res, 400, { ...statusView(), error: diag.withCode('CW-SETTINGS-BAD-JSON', raw.__bad), code: 'CW-SETTINGS-BAD-JSON' });
    }
    const checked = checkForUse(raw);
    if (checked.problems.length) {
      diag.note('CW-SETTINGS-PROBLEMS', `${checked.problems.length} problem(s) on Restart`);
      return sendJson(res, 400, {
        ...statusView(), error: diag.withCode('CW-SETTINGS-PROBLEMS', 'settings.json has problems'),
        code: 'CW-SETTINGS-PROBLEMS', problems: checked.problems,
      });
    }
    settingsWarnings = checked.warnings.map(w => w + ' (left out for now)');
    for (const w of settingsWarnings) diag.note('CW-SILLYTAVERN-FOLDER', w);
    await stopRelay();
    savedSettings = checked.settings;
    settings = { ...savedSettings };
    const result = await startRelay();
    console.log(result.ok ? '  restarted with the saved settings' : '  restart: settings applied, not recording');
    return sendJson(res, result.ok ? 200 : 409, { ...statusView(), error: result.error, needsRemoteOk: !!result.needsRemoteOk });
  }

  if (action === 'quit') {
    // Quit closes everything (user, 24 Nov): ContextWeir ends here, its console closes with it
    // (the Windows launcher starts it with cmd /c), and the panel closes its own window.
    // Closing only the panel window leaves ContextWeir recording.
    sendJson(res, 200, { ...statusView(), state: 'quitting' });
    console.log('  quit from the panel');
    return setTimeout(() => process.exit(0), 300);
  }

  return sendJson(res, 400, { error: 'unknown action' });
}

// --- POST /api/settings: save settings --------------------------------------------
// All-or-nothing; "now" settings apply at once, the rest wait for Restart.

// The outside-address acceptance can be emptied from here, never set: only OK in the warning sets it.
function withoutNewAcceptance(incoming) {
  const out = { ...incoming };
  if (out.remoteWarningAcceptedFor !== undefined && out.remoteWarningAcceptedFor !== '') delete out.remoteWarningAcceptedFor;
  return out;
}

function saveSettingsFromPanel(body, res) {
  const incoming = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {};
  const checked = checkSettings({ ...savedSettings, ...withoutNewAcceptance(incoming) });
  if (checked.problems.length) return sendJson(res, 400, { error: 'not saved', problems: checked.problems });
  try {
    writeSettingsFile(checked.settings);
  } catch (e) {
    diag.note('CW-SETTINGS-WRITE', e.code || e.message);
    return sendJson(res, 500, { error: diag.withCode('CW-SETTINGS-WRITE', 'could not write settings.json: ' + e.message), code: 'CW-SETTINGS-WRITE' });
  }
  savedSettings = checked.settings;
  for (const f of FIELDS) if (f.applies === 'now') settings[f.key] = savedSettings[f.key];
  settingsWarnings = [];
  const waitingForRestart = pendingRestart();
  console.log(`  settings saved from the panel${waitingForRestart.length ? ` (waiting for Restart: ${waitingForRestart.join(', ')})` : ''}`);
  sendJson(res, 200, settingsView());
}

// --- POST /api/check-port: is this port free? (for the receiving port field) -----

async function checkPort(body, res) {
  const port = body.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return sendJson(res, 400, { error: 'a whole number from 1024 to 65535' });
  }
  if (relay && port === relayPort) {
    return sendJson(res, 200, { port, result: 'this', text: 'in use by this ContextWeir (it is recording on it)' });
  }
  if (port === uiPort) return sendJson(res, 200, { port, result: 'used', text: "in use by this panel's window" });
  const free = await portFree(port);
  sendJson(res, 200, { port, result: free ? 'free' : 'used', text: free ? 'free' : 'in use by another program' });
}

// --- POST /api/test-model: does a model server answer here? (loopback only) ------

async function testModel(body, res) {
  if (body.url !== undefined) return testRemoteModel(body, res);
  const host = String(body.host || '');
  const port = body.port;
  if (!LOOPBACK_NAMES.includes(host)) return sendJson(res, 400, { error: 'the model server must be on this computer' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return sendJson(res, 400, { error: 'not a port number' });
  if (port === uiPort || (relay && port === relayPort)) {
    return sendJson(res, 200, { reachable: false, error: "that is ContextWeir's own port" });
  }
  sendJson(res, 200, await modelServerInfo(host, port));
}

// The Test button for a model server on another computer: only the saved address, only with the
// setting saved on and its warning accepted. One GET of <address>/v1/models, no API key (so a cloud
// service usually answers 401, which still shows it is there), certificate checked, 5 s, 256 KB.
function testRemoteModel(body, res) {
  const url = typeof body.url === 'string' ? body.url : '';
  if (!savedSettings.allowRemoteModel || url !== savedSettings.remoteUrl || !url) {
    return sendJson(res, 400, { error: 'Save the address with "Allow a model server on another computer" ticked first.' });
  }
  if (!(remoteAcceptedThisRun === url || savedSettings.remoteWarningAcceptedFor === url)) {
    return sendJson(res, 409, { error: 'Accept the warning for this address first.', needsRemoteOk: true });
  }
  const t = modelTarget({ ...savedSettings });
  const lib = t.secure ? https : http;
  let answered = false;
  const answer = obj => { if (answered) return; answered = true; clearTimeout(overall); sendJson(res, 200, obj); };
  const req = lib.get({ host: t.hostname, port: t.port, path: t.basePath + '/v1/models', timeout: 5000,
    headers: { host: t.hostHeader, 'accept-encoding': 'identity' }, rejectUnauthorized: true }, up => {
    const reached = { reachable: true, remote: true, status: up.statusCode };
    let size = 0;
    up.on('data', d => { size += d.length; if (size > 256 * 1024) { answer(reached); up.destroy(); } });
    up.on('end', () => answer(reached));
    up.on('close', () => answer(reached));
    up.on('error', () => answer(reached));
  });
  // One limit for the whole test (the socket's own timeout only measures quiet gaps).
  const overall = setTimeout(() => { req.destroy(new Error('timeout')); answer({ reachable: false, remote: true, error: 'no answer within 8 s' }); }, 8000);
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', e => answer({ reachable: false, remote: true, error: e.message === 'timeout' ? 'no answer' : (e.code || 'error') }));
}

// --- POST /api/rules: save the whole rule set as edited in the window ------------
// All-or-nothing: if any rule has a problem, nothing is saved and the problems are returned.

function saveRulesFromPanel(body, res) {
  const checked = validateRules({ format: 'contextweir-rules', groups: body.groups }, 'the window');
  if (checked.problems.length) return sendJson(res, 400, { error: 'not saved', problems: checked.problems });
  try {
    saveRules(checked.groups);
  } catch (e) {
    diag.note('CW-RULES-WRITE', e.code || e.message);
    return sendJson(res, 500, { error: diag.withCode('CW-RULES-WRITE', 'could not write rules.json: ' + e.message), code: 'CW-RULES-WRITE' });
  }
  const ruleCount = checked.groups.reduce((sum, g) => sum + g.rules.length, 0);
  console.log(`  rules saved from the window (${checked.groups.length} sets, ${ruleCount} rules)`);
  sendJson(res, 200, rulesView());
}

// --- POST /api/rules/import ---------------------------------------------------------
// First a preview (what would be added, what was refused), then the real thing
// (confirm: true). "merge" adds the file's sets beside yours (renaming clashes);
// "replace" swaps your whole rule set for the file's.

// The rule sets after an import: "replace" takes the file's sets; "merge" adds
// them beside yours, renaming any whose name is taken ("(imported)", "(imported 2)"...).
function combineRuleSets(incomingGroups, mode) {
  if (mode === 'replace') return incomingGroups;
  const taken = new Set(rules.groups.map(g => g.name));
  const renamed = incomingGroups.map(g => {
    let name = g.name;
    if (taken.has(name)) {
      name = `${g.name} (imported)`;
      let i = 2;
      while (taken.has(name)) name = `${g.name} (imported ${i++})`;
    }
    taken.add(name);
    return { ...g, name };
  });
  return [...rules.groups, ...renamed];
}

// What an import preview shows of each incoming set.
function setSummaries(groups) {
  return groups.map(g => ({
    name: g.name,
    rules: g.rules.map(r => ({
      name: r.name, severity: r.severity, target: r.target, test: r.test, value: r.value,
      flags: r.flags, note: r.note, exceptions: r.unless.length,
    })),
  }));
}

function importRules(body, res) {
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  const incoming = validateRules(body.file, 'the imported file');
  const groups = combineRuleSets(incoming.groups, mode);
  if (groups.length > LIMITS.groups) return sendJson(res, 400, { error: `more than ${LIMITS.groups} sets` });

  const summary = { mode, problems: incoming.problems, sets: setSummaries(incoming.groups) };
  if (!body.confirm) return sendJson(res, 200, { preview: true, ...summary });

  try {
    saveRules(groups);
  } catch (e) {
    diag.note('CW-RULES-WRITE', e.code || e.message);
    return sendJson(res, 500, { error: diag.withCode('CW-RULES-WRITE', 'could not write rules.json: ' + e.message), code: 'CW-RULES-WRITE' });
  }
  const refusedNote = incoming.problems.length ? `, ${incoming.problems.length} rule(s) refused` : '';
  console.log(`  rules imported (${mode}): ${incoming.groups.length} set(s)${refusedNote}`);
  sendJson(res, 200, { preview: false, ...summary, rules: rulesView() });
}

// --- Settings and rules together: a setup file --------------------------------------
// One file with the settings and the rule sets, for moving ContextWeir to another
// computer, keeping a backup, or sharing a setup. Folder settings (the log folder,
// the SillyTavern folder) only go in when asked: they belong to one computer and
// usually hold the person's name. Importing shows a preview first (each setting
// that would change, old and new; the rule sets; anything refused), then applies
// only the parts chosen, through the same checks as the panel. Nothing in the file
// can point the model address off this computer: checkSettings refuses it.

const CONFIG_FORMAT = 'contextweir-setup';
const FOLDER_KEYS = FIELDS.filter(f => f.type === 'folder').map(f => f.key);

function setupFile(includeFolders) {
  const exported = {};
  for (const f of FIELDS) {
    if (!includeFolders && FOLDER_KEYS.includes(f.key)) continue;
    if (f.key === 'remoteWarningAcceptedFor') continue;   // a warning accepted here is not accepted on another PC
    exported[f.key] = savedSettings[f.key];
  }
  return {
    _about: 'ContextWeir setup file (settings and rule sets), part of the Wellspring tools. Directed by Harahel-Whot. '
      + 'Written by Claude Opus 5.5 (Anthropic). Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir',
    format: CONFIG_FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    from: `${TOOL} ${VERSION}`,
    foldersIncluded: !!includeFolders,
    settings: exported,
    rules: rulesToFile(rules.groups),
  };
}

// POST /api/setup/import  { file, applySettings, applyFolders, rulesMode: 'merge'|'replace'|'skip', confirm }
function importSetup(body, res) {
  const file = body.file;
  if (!file || typeof file !== 'object' || file.format !== CONFIG_FORMAT) {
    return sendJson(res, 400, { error: 'This is not a ContextWeir setup file (its "format" should be "contextweir-setup"). '
      + 'A rule file goes in through the Rules tab.' });
  }
  const rulesMode = ['merge', 'replace', 'skip'].includes(body.rulesMode) ? body.rulesMode : 'merge';

  // Settings: only known keys; folders only if asked. Checked together with the rest of
  // the saved settings, exactly as a save from the panel is.
  const incoming = file.settings && typeof file.settings === 'object' && !Array.isArray(file.settings) ? file.settings : {};
  const unknown = Object.keys(incoming).filter(k => !FIELDS.some(f => f.key === k)).map(k => k.slice(0, 60));
  const wanted = {};
  for (const f of FIELDS) {
    if (incoming[f.key] === undefined) continue;
    if (FOLDER_KEYS.includes(f.key) && !body.applyFolders) continue;
    if (f.key === 'remoteWarningAcceptedFor') continue;   // only OK in the warning on this PC sets it
    wanted[f.key] = incoming[f.key];
  }
  const checked = checkSettings({ ...savedSettings, ...wanted });
  const settingsProblems = [...unknown.map(k => `unknown setting "${k}" (left out)`), ...checked.problems];
  const changes = Object.keys(wanted)
    .filter(k => JSON.stringify(wanted[k]) !== JSON.stringify(savedSettings[k]))
    .map(k => ({ key: k, label: FIELDS.find(f => f.key === k).label, from: savedSettings[k], to: wanted[k],
      applies: FIELDS.find(f => f.key === k).applies }));
  const foldersInFile = FOLDER_KEYS.filter(k => incoming[k] !== undefined);

  // Rules: checked like any rule file.
  const incomingRules = file.rules ? validateRules(file.rules, 'the setup file') : { groups: [], problems: [] };
  const combined = rulesMode === 'skip' ? rules.groups : combineRuleSets(incomingRules.groups, rulesMode);

  const preview = {
    from: typeof file.from === 'string' ? file.from.slice(0, 60) : '',
    exported: typeof file.exported === 'string' ? file.exported.slice(0, 30) : '',
    settings: { changes, problems: settingsProblems, usable: !checked.problems.length, foldersInFile },
    rules: { sets: setSummaries(incomingRules.groups), problems: incomingRules.problems, mode: rulesMode },
  };
  if (!body.confirm) return sendJson(res, 200, { preview: true, ...preview });

  // Apply: settings first (all-or-nothing), then the rules (all-or-nothing).
  const applySettings = body.applySettings !== false && changes.length > 0;
  if (applySettings && checked.problems.length) {
    return sendJson(res, 400, { error: 'Settings not imported: they have problems', problems: checked.problems });
  }
  if (rulesMode !== 'skip' && combined.length > LIMITS.groups) {
    return sendJson(res, 400, { error: `more than ${LIMITS.groups} sets` });
  }
  if (applySettings) {
    try {
      writeSettingsFile(checked.settings);
    } catch (e) {
      diag.note('CW-SETTINGS-WRITE', e.code || e.message);
      return sendJson(res, 500, { error: diag.withCode('CW-SETTINGS-WRITE', 'could not write settings.json: ' + e.message), code: 'CW-SETTINGS-WRITE' });
    }
    savedSettings = checked.settings;
    for (const f of FIELDS) if (f.applies === 'now') settings[f.key] = savedSettings[f.key];
  }
  if (rulesMode !== 'skip' && incomingRules.groups.length) {
    try {
      saveRules(combined);
    } catch (e) {
      diag.note('CW-RULES-WRITE', e.code || e.message);
      return sendJson(res, 500, { error: diag.withCode('CW-RULES-WRITE', 'could not write rules.json: ' + e.message), code: 'CW-RULES-WRITE' });
    }
  }
  console.log(`  setup imported: ${applySettings ? changes.length : 0} setting(s), `
    + `${rulesMode === 'skip' ? 'rules skipped' : `${incomingRules.groups.length} rule set(s) (${rulesMode})`}`);
  sendJson(res, 200, { preview: false, ...preview, settingsApplied: applySettings, settingsView: settingsView(), rulesView: rulesView() });
}

// --- The window's server: every request starts here --------------------------------

const POST_ROUTES = {
  '/api/control': (body, res) => pressButton(body.action, res, body),
  '/api/settings': saveSettingsFromPanel,
  '/api/check-port': checkPort,
  '/api/test-model': testModel,
  '/api/rules': saveRulesFromPanel,
  '/api/rules/import': importRules,
  '/api/setup/import': importSetup,
};

// Requests a browser sends on behalf of ANOTHER page (an <img> or a link on some web site) say so
// in Sec-Fetch-Site. The panel's own page sends "same-origin"; opening it from the launcher or
// the address bar sends "none"; programs send nothing. Anything else is refused before it is read.
function crossSiteFetch(req) {
  const site = req.headers['sec-fetch-site'];
  return site !== undefined && site !== 'same-origin' && site !== 'none';
}

const ui = http.createServer((req, res) => {
  try {
    handleWindowRequest(req, res);
  } catch (e) {
    // Nothing a request does may stop ContextWeir (a missing page file, an odd address...).
    diag.note('UNKNOWN', `window request failed: ${e.name}`);
    if (!res.headersSent) refuse(res, 500, `could not answer that (${e.name})`);
  }
});

function handleWindowRequest(req, res) {
  if (crossSiteFetch(req)) {
    diag.note('CW-REFUSED-ORIGIN', 'panel: sent by another site');
    return refuse(res, 403, diag.withCode('CW-REFUSED-ORIGIN', 'refused: sent by another site'));
  }
  if (!hostOk(req, uiPort)) {
    diag.note('CW-REFUSED-HOST', 'panel');
    return refuse(res, 403, diag.withCode('CW-REFUSED-HOST', 'refused: unexpected Host header'));
  }
  if (!originOk(req)) {
    diag.note('CW-REFUSED-ORIGIN', 'panel');
    return refuse(res, 403, diag.withCode('CW-REFUSED-ORIGIN', 'refused: request from another site'));
  }
  let url;
  try {
    url = new URL(req.url, 'http://x');   // throws on addresses such as "//"
  } catch (_) {
    return refuse(res, 400, 'not a usable address');
  }

  if (req.method === 'GET') return handleGet(url, res, req);

  if (req.method === 'POST') {
    const route = POST_ROUTES[url.pathname];
    if (!route) return refuse(res, 404, 'not found');
    return readJsonBody(req, res, body => route(body, res));
  }

  refuse(res, 405, 'method not allowed');
}


// ----------------------------------------------------------------------------
// 8. Start
// ----------------------------------------------------------------------------
// The panel's window gets any free port the operating system hands out, so it
// can never clash with another program; running.json tells the launcher which
// port it got. The relay port is opened only by Start (or at once, if the
// start screen is switched off).

ui.on('error', e => fail(`window: ${e.message}`, 'CW-WINDOW-FAILED'));
ui.on('listening', async () => {
  uiPort = ui.address().port;
  writeRunning();
  console.log(`${TOOL} ${VERSION} (prototype), built ${BUILT}`);
  console.log(`  window:  http://127.0.0.1:${uiPort}  (the control panel)`);
  const ruleCount = rules.groups.reduce((sum, g) => sum + g.rules.length, 0);
  const problemNote = rules.problems.length ? `, ${rules.problems.length} problem(s):` : '';
  console.log(`  rules:   ${ruleCount} in ${rules.groups.length} group(s)${problemNote}`);
  for (const p of rules.problems) console.log('           - ' + p);
  console.log('  Logs hold full prompts in plain text. Close this window (or Quit in the panel) to stop.');
  if (settings.showStartScreen) {
    console.log(`  waiting: press Start in the panel to open the receiving port ${settings.relayPort}\n`);
  } else {
    console.log('');
    await startRelay();
  }
});
ui.listen(0, '127.0.0.1');

// running.json: which port this copy's panel is on, for the Start launchers. Removed on exit.
function writeRunning() {
  if (!uiPort) return;
  const info = {
    tool: TOOL, version: VERSION, built: BUILT, port: uiPort, relayPort,
    state, pid: process.pid, started: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(RUNNING_FILE, JSON.stringify(info, null, 2));
  } catch (e) {
    diag.note('CW-RUNNING-FILE', e.code || e.message);
    console.log(`  (could not write running.json: ${e.message}; the launcher may open the wrong port) (CW-RUNNING-FILE)`);
  }
}

function removeRunning() {
  try {
    // Only remove it if it is ours (another copy may have started since).
    if (JSON.parse(fs.readFileSync(RUNNING_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(RUNNING_FILE);
  } catch (_) { /* already gone */ }
}

process.on('exit', () => {
  try { saveSummary(); } catch (_) { /* nothing more can be done at exit */ }
  removeRunning();
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(0));
