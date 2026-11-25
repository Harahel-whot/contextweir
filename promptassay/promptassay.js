// PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// PromptAssay  (a prototype: viewer, exact text of entries, live updates,
//               Summarize labels, model and SillyTavern versions, About, help)
// ----------------------------------------------------------------------------
// Reads the logs ContextWeir writes (and the older Wellspring logger's run
// folders) and shows each request taken apart: every message as a labelled
// section with its size, which lorebook entries and card fields it contains,
// what changed since the previous request, and where the flag rules fired.
//
// It is SillyTavern-aware: it labels content by matching it against your own
// lorebook and character card files, not by guessing SillyTavern's layout.
// Anything it cannot identify is shown as an unlabelled block, so a
// SillyTavern update makes it less tidy, not broken.
//
// VERSIONS (since 0.3.2.0): which model each request asked for (from the
// request itself), where it changed within a session, and which SillyTavern
// and model server versions a session was recorded with (ContextWeir 0.5 notes
// them in the session's summary.json). For older logs the versions are "not
// recorded"; if the lorebook folder is set, the SillyTavern version installed
// NOW is shown beside that, clearly marked as today's, not the log's.
//
// SECURITY: listens on 127.0.0.1 only; checks Host and Origin; read-only (no
// request can delete or name a file path; the one write, since 0.4.1, is the
// thank-you note's "Don't show this again", which sets showThanks in its own
// settings.json and nothing else, from its own window only); serves its page
// with a strict Content-Security-Policy; Node built-ins only.
//
// HOW THIS FILE IS LAID OUT (numbered sections, top to bottom):
//   1. Settings              4. Knowing your content (lorebooks and cards)
//   2. Finding sessions      5. Taking a request apart
//   3. Reading records       6. The server (pages and /api/...)
//
// Run:  double-click "Start PromptAssay.bat" (Windows), "Start PromptAssay.command"
//       (Mac) or "start-promptassay.sh" (Linux), or: node promptassay.js
// ============================================================================

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL = 'PromptAssay';
const VERSION = '0.4.1.0';
const BUILT = '25 Nov 2026';   // the date this version's code last changed; shown beside the version

// Error codes and the diagnostic report (lib/diagnostics.js, lib/error_codes.js). The console is
// tapped first, so the report's "recent console lines" start from the very first line.
const { createDiagnostics, browserName, formatReport, problemLines } = require('./lib/diagnostics');
const { CODES } = require('./lib/error_codes');
const { splitTextPrompt, templateFromPreset, innerText } = require('./lib/text_prompt');
const diag = createDiagnostics('PromptAssay', CODES);
diag.tapConsole();

// Shown in the About popup. Keep this the only place the version and credits live.
const ABOUT = {
  name: TOOL,
  version: VERSION,
  built: BUILT,
  stage: 'prototype',
  purpose: 'Reads ContextWeir logs and takes each request apart, so you can see exactly what SillyTavern sent to your model.',
  reads: [
    'ContextWeir log format 1 (with the frontend and model server versions ContextWeir 0.5 notes)',
    'the Wellspring test logger (v0.8.0.3) run folders',
  ],
  testedWith: ['SillyTavern 1.19.0 (chat completion)'],
  needs: 'Node.js 18 or newer; Edge, Chrome or Chromium for the app window (any browser works as a tab)',
  writtenBy: [{ versions: '0.1 to 0.4.1.0', by: 'Claude Opus 5.5 (Anthropic)' }],
  directedBy: 'Harahel-Whot',
  credit: 'Design and direction by Harahel-Whot; code, docs and testing written with Claude (Anthropic).',
  licence: 'MIT for the code, CC BY 4.0 for the help, docs and icons: free to use, change and share, '
    + 'as long as the credit is kept. See LICENSE.txt.',
  privacy: 'Reads only (the one thing it writes is its own settings.json, when you tick "Don\'t show this again" '
    + 'in the thank-you note). Runs only on this computer; nothing is sent anywhere.',
  // Where to send feedback (thank-you popup). Only these are shown; add a line here for a new place.
  links: {
    github: 'https://github.com/Harahel-Whot/contextweir',
  },
};

const HERE = __dirname;
// The environment variables let the test suites point PromptAssay at their own files.
const SETTINGS_FILE = process.env.PA_SETTINGS || path.join(HERE, 'settings.json');
const RUNNING_FILE = process.env.PA_RUNNING || path.join(HERE, 'running.json');


// ----------------------------------------------------------------------------
// 1. Settings
// ----------------------------------------------------------------------------

const DEFAULTS = {
  // Folders holding ContextWeir sessions or old logger runs (relative to this folder or absolute).
  logDirs: ['../contextweir/logs'],
  // Optional: SillyTavern's lorebook folder and character folder, for labelling.
  worldsDir: '',
  charactersDir: '',
  // List the made-up demo session (tools\demo\) at the bottom of the session list.
  showDemo: true,
  // Optional: SillyTavern's instruct preset folder, to take text-completion prompts apart. Left
  // empty, the "instruct" folder beside worldsDir is used if there is one.
  instructDir: '',
  // The thank-you note when the window opens. "Don't show this again" sets it false.
  showThanks: true,
};

// The made-up demo that ships with the tools (dev/make_demo.js): its own logs, card and lorebook.
const DEMO = {
  logs: path.join(HERE, '..', 'demo', 'logs'),
  worldsDir: path.join(HERE, '..', 'demo', 'worlds'),
  charactersDir: path.join(HERE, '..', 'demo', 'characters'),
  instructDir: '',   // the demo's text-completion session uses a built-in template
};

// Stop at start-up with a plain message and its code.
function fail(msg, code = 'UNKNOWN') {
  diag.note(code, msg);
  console.error(`${TOOL}: ${msg}`);
  console.error(`  (${code}: see "Error codes" in help.html)`);
  process.exit(1);
}

// Read settings.json (created with the defaults if missing); folders become full paths.
function loadSettings() {
  let user = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      user = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
      fail(`settings.json is not valid JSON: ${e.message}`, 'PA-SETTINGS-BAD-JSON');
    }
  } else {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
  }

  const s = { ...DEFAULTS, ...user };
  if (!Array.isArray(s.logDirs) || !s.logDirs.every(d => typeof d === 'string')) fail('logDirs must be a list of folders', 'PA-SETTINGS-LOGDIRS');
  const fullPath = d => ((typeof d === 'string' && d.trim()) ? path.resolve(HERE, d) : '');
  s.logDirs = s.logDirs.map(fullPath).filter(Boolean);
  s.worldsDir = fullPath(s.worldsDir);
  s.charactersDir = fullPath(s.charactersDir);
  s.showDemo = s.showDemo !== false;
  s.showThanks = s.showThanks !== false;
  s.instructDir = fullPath(s.instructDir);
  if (!s.instructDir && s.worldsDir) {
    const beside = path.join(path.dirname(s.worldsDir), 'instruct');
    try { if (fs.statSync(beside).isDirectory()) s.instructDir = beside; } catch (_) { /* none: built-in templates only */ }
  }
  return s;
}

const settings = loadSettings();   // settings.port is added once the window is listening


// ----------------------------------------------------------------------------
// 2. Finding sessions
// ----------------------------------------------------------------------------
// A session is either a ContextWeir folder (session_<stamp>/records.jsonl) or
// an old Wellspring logger folder (run_<stamp>/turns/*.json + report.jsonl).
// The page refers to sessions by an id made here ("<log folder number>:<name>");
// it never sends a path.

const CW_SESSION_RE = /^session_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const OLD_RUN_RE = /^run_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const TURN_FILE_RE = /^turn_(\d+)_[\dTZ-]+\.json$/;

function listSessions() {
  const out = [];
  settings.logDirs.forEach((dir, src) => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      diag.note('PA-LOG-FOLDER', `${dir}: ${e.code || e.message}`);
      return;
    }
    for (const name of names) {
      const kind = CW_SESSION_RE.test(name) ? 'contextweir' : OLD_RUN_RE.test(name) ? 'old-logger' : null;
      if (!kind) continue;
      // Skip sessions that recorded nothing (e.g. started and closed straight away).
      const holds = kind === 'contextweir' ? 'records.jsonl' : 'turns';
      if (!fs.existsSync(path.join(dir, name, holds))) continue;
      out.push({ id: `${src}:${name}`, src, name, kind, dir: path.join(dir, name) });
    }
  });
  // Newest first, by the time stamp at the end of the folder name.
  out.sort((a, b) => b.name.slice(-24).localeCompare(a.name.slice(-24)));

  // The made-up demo always goes last, so it never hides a real session.
  if (settings.showDemo) {
    let names = [];
    try { names = fs.readdirSync(DEMO.logs); } catch (_) { /* no demo folder shipped: nothing to add */ }
    for (const name of names.filter(n => CW_SESSION_RE.test(n)).sort()) {
      if (!fs.existsSync(path.join(DEMO.logs, name, 'records.jsonl'))) continue;
      out.push({ id: `demo:${name}`, src: 'demo', name, kind: 'contextweir', demo: true, dir: path.join(DEMO.logs, name) });
    }
  }
  return out;
}

function findSession(id) {
  return listSessions().find(s => s.id === id) || null;
}


// ----------------------------------------------------------------------------
// 3. Reading records
// ----------------------------------------------------------------------------
// Each session is indexed once (and again if its files change): a short
// summary per record for the turn list, plus where to find the full record
// (a byte range in records.jsonl, or a turn file name).

const indexCache = new Map();   // session id -> { signature, items }

// Changes whenever the session's files change (size and time, or the number of turn files).
function sessionSignature(s) {
  try {
    if (s.kind === 'contextweir') {
      const st = fs.statSync(path.join(s.dir, 'records.jsonl'));
      return `${st.size}:${st.mtimeMs}`;
    }
    const st = fs.statSync(path.join(s.dir, 'turns'));
    return `${fs.readdirSync(path.join(s.dir, 'turns')).length}:${st.mtimeMs}`;
  } catch (_) {
    return 'missing';
  }
}

// What kind of request this is: a story turn, one of the game's private script requests, or
// SillyTavern's Summarize (its instruction sits in the first or last system message; the default
// wording, and the older "[Pause your roleplay. Summarize ..." one, both match).
const SUMMARY_RE = /^\s*\[?\s*(?:ignore previous instructions\.?\s*|pause your roleplay\.?\s*)*summari[sz]e\b|summari[sz]e the most important facts/i;
const SCRIPT_REQUEST_RE = /^\s*\[Private system request/i;

function isSummaryInstruction(m) {
  return !!m && m.role === 'system' && SUMMARY_RE.test(text(m.content).slice(0, 400));
}

function requestKind(msgs) {
  if (!msgs.length) return 'story';
  if (isSummaryInstruction(msgs[0]) || isSummaryInstruction(msgs[msgs.length - 1])) return 'summary';
  const last = msgs[msgs.length - 1];
  if (last.role === 'system' && SCRIPT_REQUEST_RE.test(text(last.content))) return 'script';
  return 'story';
}

// One line of the turn list. ctx carries what one session learns as it is read (which instruct
// template its text-completion requests use), so the template is not searched for every request.
function summarise(n, rec, extraFlags, ctx = {}) {
  const req = rec.request || {};
  const parts = partsOf(req, ctx);
  const msgs = parts.msgs;
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const kind = parts.mode === 'text' ? textRequestKind(parts) : requestKind(msgs);
  // For a Summarize request the line shows the start of the summary it produced.
  const playerLine = kind === 'summary' ? 'Summary: ' + String(rec.reply || '').slice(0, 150)
    : lastUser ? (lastUser.inner ?? text(lastUser.content)).trim().slice(0, 160) : '';
  return {
    n,
    time: rec.time || null,
    seconds: rec.seconds ?? null,
    swipe: !!rec.swipe,
    promptChars: msgs.reduce((sum, m) => sum + text(m.content).length, 0),
    messages: msgs.length,
    kind,
    mode: parts.mode,
    model: typeof req.model === 'string' ? req.model.slice(0, 120) : '',
    player: playerLine,
    flags: (rec.flags || extraFlags || []).map(f => ({ name: f.name, severity: f.severity, match: f.match || '' })),
  };
}

// ----------------------------------------------------------------------------
// The parts of a request, in one shape for both kinds of request:
//   chat completion: its messages, as sent
//   text completion: its one prompt string, cut into sections by lib/text_prompt.js, each
//     { role, name, content, inner (text without template markers), start, end, wrap }
// Everything that shows or compares a request goes through here.
function partsOf(req, ctx = {}, known = []) {
  if (req && Array.isArray(req.messages)) return { mode: 'chat', msgs: req.messages, split: null };
  if (!req || typeof req.prompt !== 'string') return { mode: 'other', msgs: [], split: null };
  const prompt = req.prompt;
  const split = splitTextPrompt(prompt, req, {
    known, templates: ctx.templates || [], preferred: ctx.preferred, onlyBuiltIn: (ctx.misses || 0) >= 5,
  });
  // Remember what this session uses, so later requests do not search every template again: the
  // template that fitted, or, after five requests in a row with none, only the built-in list.
  if (split.template) { ctx.preferred = split.template.key; ctx.misses = 0; } else ctx.misses = (ctx.misses || 0) + 1;
  const msgs = split.sections.map(sec => ({
    role: sec.role, name: sec.name, content: prompt.slice(sec.start, sec.end),
    inner: innerText(prompt, sec), start: sec.start, end: sec.end,
    wrap: sec.wrap.map(w => ({ start: w.start - sec.start, end: w.end - sec.start })),
  }));
  return { mode: 'text', msgs, split };
}

// The kind of a text-completion request: Summarize and script requests are recognised on the last
// section with text in it (markers removed), not counting an empty reply start.
function textRequestKind(parts) {
  const filled = parts.msgs.filter(m => (m.inner || '').trim());
  let last = filled[filled.length - 1];
  if (last && last.role === 'assistant' && filled.length > 1 && parts.msgs[parts.msgs.length - 1] === last) last = filled[filled.length - 2];
  const t = last ? last.inner.trim() : '';
  if (SUMMARY_RE.test(t.slice(0, 400)) || /summari[sz]e the most important facts/i.test(t)) return 'summary';
  if (SCRIPT_REQUEST_RE.test(t)) return 'script';
  return 'story';
}

// SillyTavern's instruct presets as templates, read once per change of the folder. Read-only;
// at most 200 files of at most 256 KB; a file that is not a preset is skipped (name noted).
const templateCache = new Map();   // folder -> { signature, list }
function loadTemplates(dir) {
  if (!dir) return [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')).sort().slice(0, 200);
  } catch (e) {
    diag.note('PA-TEMPLATES-FOLDER', `${dir}: ${e.code || e.name}`);
    return [];
  }
  let signature = '';
  try { signature = files.map(f => f + fs.statSync(path.join(dir, f)).mtimeMs).join('|'); } catch (_) { signature = String(Date.now()); }
  const cached = templateCache.get(dir);
  if (cached && cached.signature === signature) return cached.list;
  const list = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      if (fs.statSync(file).size > 256 * 1024) { diag.note('PA-TEMPLATE-BAD', `${f}: too large`); continue; }
      const t = templateFromPreset(JSON.parse(fs.readFileSync(file, 'utf8')), f);
      if (t) list.push(t);
    } catch (e) {
      diag.note('PA-TEMPLATE-BAD', `${f}: ${e.code || e.name}`);   // the name only: a JSON error quotes file text
    }
  }
  templateCache.set(dir, { signature, list });
  return list;
}

// A message's text: a plain string, or the text parts of a multi-part message.
function text(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(part => (part && typeof part.text === 'string') ? part.text : '').join('');
  return c == null ? '' : JSON.stringify(c);
}

// Old logger flags were plain strings; give them a severity.
function oldFlags(list) {
  return (list || []).map(f => ({
    // Keep sealed Cores out of the view (and out of screenshots).
    name: String(f)
      .replace(/turn #\d+/, 'an earlier turn')
      .replace(/"[^"]{0,40}\.\.\."/, '"…"')
      .replace(/\s*\(Core: [^)]*\)/, ' (Core hidden)'),
    severity: /EMPTY|logger error/.test(f) ? 'serious' : /^status field|odd characters/.test(f) ? 'note' : 'warning',
    match: '',
  }));
}

// The turn list for a session (cached until its files change).
function indexSession(s) {
  const signature = sessionSignature(s);
  const cached = indexCache.get(s.id);
  if (cached && cached.signature === signature) return cached.items;

  const items = [];
  const ctx = { templates: loadTemplates(s.demo ? '' : settings.instructDir), preferred: null, misses: 0 };
  if (s.kind === 'contextweir') {
    // One JSON record per line. Each item remembers its byte range ("at"), so
    // the full record can be read later without reading the whole file.
    const buf = fs.readFileSync(path.join(s.dir, 'records.jsonl'));
    let start = 0;
    for (let i = 0; i <= buf.length; i++) {
      if (i < buf.length && buf[i] !== 0x0a) continue;   // 0x0a: end of line
      if (i > start) {
        try {
          const rec = JSON.parse(buf.toString('utf8', start, i));
          items.push({ ...summarise(rec.n, rec, undefined, ctx), at: [start, i] });
        } catch (_) { /* a half-written last line: skip */ }
      }
      start = i + 1;
    }
  } else {
    // Old logger: one file per turn, plus a report with times and flags.
    const report = new Map();
    try {
      for (const line of fs.readFileSync(path.join(s.dir, 'report.jsonl'), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); report.set(r.n, r); } catch (_) { /* skip a broken line */ }
      }
    } catch (_) { /* no report: times and flags stay empty */ }
    const turnFiles = fs.readdirSync(path.join(s.dir, 'turns')).filter(f => TURN_FILE_RE.test(f)).sort();
    for (const file of turnFiles) {
      const n = Number(file.match(TURN_FILE_RE)[1]);
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(s.dir, 'turns', file), 'utf8')); } catch (_) { continue; }
      const r = report.get(n);
      items.push({ ...summarise(n, { ...rec, seconds: r ? r.seconds : null }, oldFlags(r && r.flags), ctx), file });
    }
  }
  indexCache.set(s.id, { signature, items, preferred: ctx.preferred, misses: ctx.misses });
  return items;
}

// The session's summary.json (ContextWeir 0.5+ writes the versions there).
function readSummary(s) {
  if (s.kind !== 'contextweir') return null;
  try {
    const file = path.join(s.dir, 'summary.json');
    if (fs.statSync(file).size > 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

const clip = (v, n = 60) => String(v == null ? '?' : v).slice(0, n);

function cleanVersion(v) {
  if (!v || typeof v !== 'object') return null;
  return { name: clip(v.name), version: clip(v.version, 30), ...(v.note ? { note: clip(v.note, 80) } : {}) };
}

// The versions a session was recorded with, and the models its requests asked
// for, with where they changed.
function sessionVersions(s, items) {
  const sum = readSummary(s);
  const ms = sum && sum.modelServer;

  const models = [];   // [{ model, from, to, count }] in order, one entry per stretch
  for (const item of items) {
    const last = models[models.length - 1];
    if (last && last.model === item.model) {
      last.to = item.n;
      last.count++;
    } else {
      models.push({ model: item.model, from: item.n, to: item.n, count: 1 });
    }
  }

  return {
    recorded: !!(sum && ('frontend' in sum)),
    tool: sum ? { name: clip(sum.tool), version: clip(sum.toolVersion, 30) } : null,
    frontend: sum ? cleanVersion(sum.frontend) : null,
    modelServer: ms && typeof ms === 'object' ? {
      server: cleanVersion(ms.server),
      reachable: !!ms.reachable,
      models: Array.isArray(ms.models) ? ms.models.slice(0, 5).map(m => clip(m, 120)) : [],
    } : null,
    models,
    modelChanges: models.slice(1).map(m => m.from),
    sillyTavernNow: s.demo ? null : sillyTavernNow(),
    demo: !!s.demo,
  };
}

// The SillyTavern installed now, found from the lorebook folder (…/data/default-user/worlds).
// Read only, one small file. Shown as today's version, never as the log's.
function sillyTavernNow() {
  if (!settings.worldsDir) return null;
  try {
    const file = path.join(settings.worldsDir, '..', '..', '..', 'package.json');
    if (fs.statSync(file).size > 1024 * 1024) return null;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return /sillytavern/i.test(String(pkg.name || '')) ? clip(pkg.version, 30) : null;
  } catch (_) {
    return null;
  }
}

// The full record for one item of the turn list.
function readRecord(s, item) {
  if (s.kind === 'contextweir') {
    const fd = fs.openSync(path.join(s.dir, 'records.jsonl'), 'r');
    try {
      const [from, to] = item.at;
      const buf = Buffer.alloc(to - from);
      fs.readSync(fd, buf, 0, to - from, from);
      return JSON.parse(buf.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  }
  const rec = JSON.parse(fs.readFileSync(path.join(s.dir, 'turns', item.file), 'utf8'));
  return { ...rec, flags: item.flags };
}


// ----------------------------------------------------------------------------
// 4. Knowing your content: lorebooks and character cards
// ----------------------------------------------------------------------------
// A piece of content is recognised when two stretches of it (its start and
// its middle) both appear in a message. Two stretches, because many entries
// open with the same template words (e.g. every campaign's sealed Core).
// Short entries must appear whole. The same text found in two files (a
// lorebook and the copy embedded in the card) is listed once.

// One library per pair of folders (the user's own, and the demo's): folders -> { signature, items },
// items: [{ label, kind, probes, key, full }].
const libraries = new Map();

const MACRO_RE = /\{\{[^{}]*\}\}|<[A-Z]+>/;

// Add one piece of content (an entry or card field) to the library.
function addProbe(items, label, kind, content) {
  // SillyTavern fills in macros such as {{user}} before sending, so only the
  // text between macros can be matched. Use the longest macro-free stretch.
  // Files saved on Windows may hold \r\n line endings; SillyTavern sends \n.
  const full = String(content || '').replace(/\r\n?/g, '\n').trim();
  const pieces = full.split(MACRO_RE).map(s => s.trim()).filter(s => s.length >= 24);
  if (!pieces.length) return;
  const longest = pieces.sort((a, b) => b.length - a.length)[0];

  // Short: the whole stretch. Long: 60 characters from the start and 60 from the middle.
  const middle = Math.floor(longest.length / 2);
  const probes = longest.length < 160
    ? [longest]
    : [longest.slice(0, 60), longest.slice(middle - 30, middle + 30)];
  // Kept beside the list (not searched through it), so a lorebook with thousands of entries
  // of the same name still loads in a moment.
  if (!items.seen) Object.defineProperties(items, { seen: { value: { keys: new Set(), labels: new Set(), next: new Map() } } });
  const seen = items.seen;
  const key = probes.join('\u0000');
  if (seen.keys.has(key)) return;   // the same text from another file
  seen.keys.add(key);

  // Two different entries with the same name (e.g. two "[Bond] Doctor Fairweather")
  // are both kept, the second as "(2)", so neither hides the other.
  let name = label;
  let n = seen.next.get(label) || 2;
  while (seen.labels.has(name)) name = `${label} (${n++})`;
  seen.next.set(label, n);
  seen.labels.add(name);
  items.push({ label: name, kind, probes, key, full });
}

function matches(item, t) { return item.probes.every(p => t.includes(p)); }

// Where exactly a recognised piece sits in a message: { start, end } or null.
// Without macros the stored text appears as it is. With macros, the text
// between them must appear in order, each macro filled by at most a few hundred
// characters (a name, a date...). This is a plain left-to-right search with
// indexOf, never a pattern, so its work grows with the text, not explosively:
// an earlier version built one regular expression per entry, and entries with
// several macros could make it run for minutes (security review, 25 Nov).
const MACRO_GAP = 400;   // most characters one filled-in macro may take
const MAX_TRIES = 200;   // most places tried for the entry's longest stretch

function locate(item, t) {
  if (!MACRO_RE.test(item.full)) {
    const i = t.indexOf(item.full);
    return i >= 0 ? { start: i, end: i + item.full.length } : null;
  }
  if (!item.parts) {
    // The literal stretches between macros, in order; each remembers how many macros came
    // just before it (each may take up to MACRO_GAP characters). Empty or blank stretches
    // between two macros just widen the gap.
    item.parts = [];
    let macrosBefore = 0;
    for (const piece of item.full.split(new RegExp(MACRO_RE.source, 'g'))) {
      if (piece.trim()) { item.parts.push({ text: piece, macrosBefore }); macrosBefore = 0; }
      macrosBefore++;
    }
    item.trailingMacros = macrosBefore - 1;   // macros after the last stretch
    item.leadingMacros = item.parts.length ? item.parts[0].macrosBefore : 0;
  }
  const parts = item.parts;
  if (!parts.length) return null;
  const allowed = macros => macros * MACRO_GAP + 1;

  // Start from the longest stretch (the rarest), then walk outwards to the others.
  let anchor = 0;
  parts.forEach((p, i) => { if (p.text.length > parts[anchor].text.length) anchor = i; });
  let from = 0;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const at = t.indexOf(parts[anchor].text, from);
    if (at < 0) return null;
    from = at + 1;

    // Leftwards: each earlier stretch must end within its gap before the next one starts.
    let start = at;
    let ok = true;
    for (let i = anchor - 1; i >= 0 && ok; i--) {
      const gap = allowed(parts[i + 1].macrosBefore);
      const windowStart = Math.max(0, start - parts[i].text.length - gap);
      const found = t.lastIndexOf(parts[i].text, start - parts[i].text.length);
      if (found < windowStart || found < 0) ok = false;
      else start = found;
    }
    // Rightwards: each later stretch must start within its gap after the one before ends.
    let end = at + parts[anchor].text.length;
    for (let i = anchor + 1; i < parts.length && ok; i++) {
      const found = t.indexOf(parts[i].text, end);
      if (found < 0 || found - end > allowed(parts[i].macrosBefore)) ok = false;
      else end = found + parts[i].text.length;
    }
    if (!ok) continue;

    // A macro at the very start or end (usually a name) takes the word next to it.
    if (item.leadingMacros) while (start > 0 && at - start < MACRO_GAP && /[^\s.,;:!?]/.test(t[start - 1])) start--;
    if (item.trailingMacros) while (end < t.length && /[^\s.,;:!?]/.test(t[end])) end++;
    return { start, end };
  }
  return null;
}

// "Chat Book Wellspring - 2026-11-22_11h08m32s749ms" -> "Chat book 2026-11-22 11:08"
function bookName(file) {
  return file.replace(/\.json$/, '').replace(/^Chat Book .* - (\d{4}-\d\d-\d\d)_(\d\d)h(\d\d).*$/, 'Chat book $1 $2:$3');
}

// Character cards are PNG files with the card JSON (base64) in a text chunk.
// Walks the PNG's chunks: [length 4][type 4][data length][crc 4].
function readCardPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;   // after the PNG signature
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tEXt') {
      const data = buf.subarray(pos + 8, pos + 8 + length);
      const zero = data.indexOf(0);
      const keyword = data.toString('latin1', 0, zero);
      if (keyword === 'chara' || keyword === 'ccv3') {
        try {
          return JSON.parse(Buffer.from(data.toString('latin1', zero + 1), 'base64').toString('utf8'));
        } catch (_) { /* not a readable card: keep looking */ }
      }
    }
    if (type === 'IEND') break;
    pos += 12 + length;
  }
  return null;
}

// A card saved as a JSON file (SillyTavern can import these): { spec: 'chara_card_v2', data: {...} },
// or an older card with the fields at the top. Anything else in the folder is skipped.
function readCardJson(file) {
  if (fs.statSync(file).size > 5 * 1024 * 1024) return null;
  const card = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = card && (card.data || card);
  return data && typeof data.name === 'string' && ('description' in data || 'first_mes' in data) ? card : null;
}

// The card fields that are labelled, and their names on the page.
const CARD_FIELDS = [
  ['description', 'description'], ['personality', 'personality'], ['scenario', 'scenario'],
  ['system_prompt', 'system prompt'], ['post_history_instructions', 'post-history instructions'],
  ['first_mes', 'first message'], ['mes_example', 'example messages'],
];

// Every lorebook entry and card field we can recognise (rebuilt only when the
// folders' files change). With no argument: the folders in settings.json. A
// session passes its own (the demo session uses the demo's card and lorebook).
function loadLibrary(folders = settings) {
  const worldsDir = folders.worldsDir;
  const charactersDir = folders.charactersDir;
  const folderStamp = dir => {
    try {
      return fs.readdirSync(dir).map(f => f + fs.statSync(path.join(dir, f)).mtimeMs).join('|');
    } catch (_) {
      return '';
    }
  };
  const signatureParts = [];
  if (worldsDir) signatureParts.push(folderStamp(worldsDir));
  if (charactersDir) signatureParts.push(folderStamp(charactersDir));
  const signature = crypto.createHash('sha1').update(signatureParts.join('#')).digest('hex');
  const cacheKey = `${worldsDir}\u0000${charactersDir}`;
  const cached = libraries.get(cacheKey);
  if (cached && cached.signature === signature) return cached.items;

  const items = [];
  if (worldsDir) {
    let files = [];
    try {
      files = fs.readdirSync(worldsDir).filter(f => f.endsWith('.json'));
    } catch (e) {
      diag.note('PA-LABELS-FOLDER', `worldsDir ${worldsDir}: ${e.code || e.message}`);
    }
    for (const file of files) {
      try {
        const lorebook = JSON.parse(fs.readFileSync(path.join(worldsDir, file), 'utf8'));
        const book = bookName(file);
        for (const entry of Object.values(lorebook.entries || {})) {
          addProbe(items, `${book}: ${entry.comment || 'entry ' + entry.uid}`, 'lorebook', entry.content);
        }
      } catch (e) {
        diag.note('PA-LABEL-FILE', `${file}: ${e.code || e.name}`);   // the name only: a JSON error quotes file text   // not a lorebook: skip it
      }
    }
  }
  if (charactersDir) {
    let files = [];
    try {
      files = fs.readdirSync(charactersDir).filter(f => f.endsWith('.png') || f.endsWith('.json'));
    } catch (e) {
      diag.note('PA-LABELS-FOLDER', `charactersDir ${charactersDir}: ${e.code || e.message}`);
    }
    for (const file of files) {
      try {
        const card = file.endsWith('.json') ? readCardJson(path.join(charactersDir, file)) : readCardPng(path.join(charactersDir, file));
        if (!card) continue;
        const data = card.data || card;
        const name = data.name || file.replace(/\.png$/, '');
        for (const [field, label] of CARD_FIELDS) addProbe(items, `Card ${name}: ${label}`, 'card', data[field]);
        const book = data.character_book;
        if (book && Array.isArray(book.entries)) {
          for (const entry of book.entries) {
            addProbe(items, `Card ${name} lorebook: ${entry.comment || entry.name || 'entry'}`, 'lorebook', entry.content);
          }
        }
      } catch (e) {
        diag.note('PA-LABEL-FILE', `${file}: ${e.code || e.name}`);   // the name only: a JSON error quotes file text   // not a card: skip it
      }
    }
  }
  libraries.set(cacheKey, { signature, items });
  return items;
}


// ----------------------------------------------------------------------------
// 5. Taking a request apart
// ----------------------------------------------------------------------------

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16); }

// What a block of text contains: lorebook entries and card fields we know,
// plus SillyTavern's own blocks recognised by how they open (hints only).
// withSpans adds where each piece sits ({ start, end }).
function identify(t, role, lib, withSpans = false) {
  const seen = new Set();
  const contains = lib
    .filter(item => matches(item, t) && !seen.has(item.label) && seen.add(item.label))
    .map(item => ({ label: item.label, kind: item.kind, ...(withSpans ? { span: locate(item, t) } : {}) }));

  if (role === 'system' && !contains.length) {
    const whole = withSpans ? { span: { start: 0, end: t.length } } : {};
    if (/^\s*\[Summary:/i.test(t)) contains.push({ label: 'Summary (SillyTavern Summarize)', kind: 'st', ...whole });
    else if (/^\s*\[Start a new Chat\]\s*$/i.test(t)) contains.push({ label: 'new chat marker', kind: 'st', ...whole });
  }
  // In the order they appear in the prompt (unlocated ones last).
  if (withSpans) contains.sort((a, b) => (a.span ? a.span.start : Infinity) - (b.span ? b.span.start : Infinity));
  return contains;
}

// A label for one message, from its role and position in the prompt.
function sectionLabel(m, i, t, msgs, firstChat, lastUser, kind) {
  const depth = msgs.length - 1 - i;
  let label;
  if (m.role === 'prompt') label = 'Prompt (text completion)';
  else if (m.role === 'system' && (firstChat === -1 || i < firstChat)) label = i === 0 ? 'System prompt' : `Before the chat (${i + 1})`;
  else if (m.role === 'system' && i > lastUser) label = SCRIPT_REQUEST_RE.test(t) ? 'Script request (after the chat)' : 'After the chat (post-history / note)';
  else if (m.role === 'system') label = `Injected at depth ${depth}`;
  else if (m.role === 'user') label = i === lastUser ? 'Player (newest)' : 'Player';
  else if (m.role === 'assistant') label = i === msgs.length - 1 ? 'Reply start (prefill)' : 'Narrator';
  else label = m.role || 'unknown';

  if (kind === 'summary') {
    if (isSummaryInstruction(m)) label = 'Summarize instruction (SillyTavern)';
    else if (m.role === 'user' && i === lastUser) label = 'Story sent to be summarised';
  }
  return label;
}

// Text completion: SillyTavern's own blocks sit inside a longer section rather than in a message
// of their own, so they are found by their opening text anywhere at a line start (plain indexOf).
function stBlocksIn(t, already) {
  const out = [];
  const has = label => already.some(c => c.label === label);
  const lineStart = i => i === 0 || t[i - 1] === '\n' || t[i - 1] === '>';
  const s = t.indexOf('[Summary:');
  if (s >= 0 && lineStart(s) && !has('Summary (SillyTavern Summarize)')) {
    const close = t.indexOf(']', s);
    out.push({ label: 'Summary (SillyTavern Summarize)', kind: 'st', span: { start: s, end: close >= 0 ? close + 1 : t.length } });
  }
  const m = t.indexOf('[Start a new Chat]');
  if (m >= 0 && lineStart(m) && !has('new chat marker')) out.push({ label: 'new chat marker', kind: 'st', span: { start: m, end: m + 18 } });
  return out;
}

// Everything the page shows for one request: labelled sections, sizes, what
// entered and left since the previous request, the reply and its flags.
// preferred: the instruct template this session's text requests were found to use (if any).
function decode(rec, prevRec, folders = settings, preferred = null, misses = 0) {
  const req = rec.request;
  const lib = loadLibrary(folders);
  const ctx = { templates: loadTemplates(folders.instructDir || ''), preferred, misses };

  // Text completion: locate the known pieces in the whole prompt first, so a template marker
  // that happens to sit inside a lorebook entry never splits the prompt.
  let known = [];
  if (req && typeof req.prompt === 'string' && !Array.isArray(req.messages)) {
    known = identify(req.prompt, 'system', lib, true).filter(c => c.span).map(c => c.span);
  }
  const parts = partsOf(req, ctx, known);
  const msgs = parts.msgs;
  const textMode = parts.mode === 'text';
  const firstChat = msgs.findIndex(m => m.role === 'user' || m.role === 'assistant');
  let lastUser = -1;
  msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i; });

  // Compared without template markers, so a template's own bookkeeping does not mark old turns new.
  const compareText = m => (m.inner !== undefined ? m.inner : text(m.content));

  // What the previous request held, to mark what is new and what entered or left.
  const prevHashes = new Set();
  const prevEntries = new Set();
  if (prevRec) {
    const prevParts = partsOf(prevRec.request, { templates: ctx.templates, preferred: ctx.preferred, misses: ctx.misses });
    for (const m of prevParts.msgs) {
      prevHashes.add(hash(m.role + '\u0000' + compareText(m)));
      const pt = text(m.content);
      const prevContains = identify(pt, (m.role === 'prompt' || m.role === 'between') ? 'system' : m.role, lib);
      if (prevParts.mode === 'text') prevContains.push(...stBlocksIn(pt, prevContains));
      for (const c of prevContains) prevEntries.add(c.label);
    }
  }

  const kind = textMode ? textRequestKind(parts) : requestKind(msgs);
  const how = textMode ? parts.split.how : null;
  const guess = how === 'template' ? ' (by template)' : how === 'names' ? ' (by speaker names)' : '';
  const sections = msgs.map((m, i) => {
    const t = text(m.content);
    const roleForIdentify = (m.role === 'prompt' || m.role === 'between') ? 'system' : m.role;
    const contains = identify(t, roleForIdentify, lib, true);
    if (textMode) contains.push(...stBlocksIn(t, contains));
    let label;
    if (m.role === 'between') label = 'Between turns';
    else if (m.role === 'turn') label = `Turn${m.name ? ` (${m.name})` : ''}`;
    else label = sectionLabel(m, i, t, msgs, firstChat, lastUser, kind);
    if (textMode && m.role === 'assistant' && i === msgs.length - 1) label = 'Reply start';
    if (guess && !(i === 0 && m.role === 'system' && !(m.wrap && m.wrap.length))) label += guess;

    // Say what a non-chat block holds, when we recognised it.
    if ((roleForIdentify === 'system') && contains.length) {
      const cardFields = contains.filter(c => c.kind === 'card').map(c => c.label.replace(/^Card [^:]*: /, 'card '));
      const loreCount = contains.filter(c => c.kind === 'lorebook').length;
      const stBlocks = contains.filter(c => c.kind === 'st').map(c => c.label);
      const loreText = loreCount ? `${loreCount} lorebook entr${loreCount === 1 ? 'y' : 'ies'}` : null;
      label += ': ' + [...cardFields, ...stBlocks, loreText].filter(Boolean).join(', ');
    }
    const chat = (m.role === 'user' || m.role === 'assistant' || m.role === 'turn') && !/^Reply start/.test(label);
    return {
      i, role: m.role, name: m.name || '', label, chat, chars: t.length,
      isNew: prevRec ? !prevHashes.has(hash(m.role + '\u0000' + compareText(m))) : false,
      contains, text: t,
      ...(textMode ? { wrap: m.wrap || [], at: m.start } : {}),
    };
  });

  const nowEntries = new Set(sections.flatMap(s => s.contains.map(c => c.label)));
  const total = sections.reduce((sum, s) => sum + s.chars, 0);
  const charsWhere = pick => sections.filter(pick).reduce((sum, s) => sum + s.chars, 0);
  const modelOf = r => (r && r.request && typeof r.request.model === 'string' ? r.request.model : null);
  const model = modelOf(rec);
  const prevModel = modelOf(prevRec);

  return {
    n: rec.n, kind, time: rec.time, seconds: rec.seconds ?? null, swipe: !!rec.swipe, endpoint: rec.endpoint || '',
    mode: parts.mode,
    // Text completion: how the prompt was taken apart, said plainly on the page.
    textSplit: textMode ? {
      how,
      template: parts.split.template,
      templatesKnown: ctx.templates.length,
    } : null,
    model: model ? model.slice(0, 120) : '',
    modelBefore: prevModel !== null && prevModel !== (req && req.model) ? prevModel.slice(0, 120) : null,
    // The sampler settings: everything in the request except the messages themselves.
    settings: req ? Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'messages' && k !== 'prompt')) : {},
    totals: {
      chars: total,
      approxTokens: Math.round(total / 3.6),
      chatChars: charsWhere(s => s.chat),
      otherChars: charsWhere(s => !s.chat),
      chatMessages: sections.filter(s => s.chat).length,
    },
    entered: prevRec ? [...nowEntries].filter(e => !prevEntries.has(e)) : [],
    left: prevRec ? [...prevEntries].filter(e => !nowEntries.has(e)) : [],
    sections,
    reply: String(rec.reply || ''),
    replyShape: rec.replyShape || null,
    flags: rec.flags || [],
    libraryLoaded: lib.length,
  };
}


// ----------------------------------------------------------------------------
// 6. The server
// ----------------------------------------------------------------------------
// What the window can ask for (everything is read-only):
//   GET  /, /app.js, /app.css, /icon.png, /help    the page itself
//   GET  /api/about
//   GET  /api/sessions                    the session list
//   GET  /api/session?id=<id>             one session's turn list, numbers, versions
//   GET  /api/record?id=<id>&n=<number>   one request, taken apart

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

function hostOk(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return LOOPBACK.some(name => host === `${name}:${settings.port}`);
}

// Only this window's own pages (same port) may ask; programs send no Origin.
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) && String(u.port) === String(settings.port);
  } catch (_) {
    return false;
  }
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    + "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// The help page is static text we wrote: no scripts at all, its own inline styles.
const HELP_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; "
  + "base-uri 'none'; form-action 'none'";

const PAGE_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// The diagnostic report (text): settings, folders, counts, versions and
// PromptAssay's own console lines. Never prompt, reply or lorebook text (only
// how many pieces were found, and lorebook file names when one fails to load).
function diagnosticReport(full, userAgent) {
  const folderState = dir => {
    try {
      const names = fs.readdirSync(dir);
      const cw = names.filter(n => CW_SESSION_RE.test(n)).length;
      const old = names.filter(n => OLD_RUN_RE.test(n)).length;
      return `readable, ${cw} ContextWeir session folder(s), ${old} old logger run(s)`;
    } catch (e) {
      return `NOT READABLE (${e.code || e.message})`;
    }
  };
  const fileCount = (dir, ext) => {
    if (!dir) return '(not set)';
    try { return `${fs.readdirSync(dir).filter(f => f.endsWith(ext)).length} ${ext} file(s)`; } catch (e) { return `NOT READABLE (${e.code || e.message})`; }
  };
  const sessions = listSessions();
  const lib = loadLibrary();
  const logFolders = {};
  settings.logDirs.forEach((dir, i) => { logFolders[`Folder ${i + 1}`] = `${dir}: ${folderState(dir)}`; });
  const pageFiles = ['ui/index.html', 'ui/app.js', 'ui/app.css', 'help.html', 'icon/promptassay.png'];

  const sections = [
    ['PromptAssay now', { 'Window port': settings.port, 'Settings file': SETTINGS_FILE }],
    ['Log folders (logDirs)', Object.keys(logFolders).length ? logFolders : ['(none set)']],
    ['Sessions found', {
      'ContextWeir sessions': sessions.filter(x => x.kind === 'contextweir').length,
      'Old logger runs': sessions.filter(x => x.kind === 'old-logger').length,
      Newest: sessions.length ? sessions[0].name : '(none)',
    }],
    ['Labelling', {
      'Lorebook folder (worldsDir)': settings.worldsDir ? `${settings.worldsDir}: ${fileCount(settings.worldsDir, '.json')}` : '(not set)',
      'Character folder (charactersDir)': settings.charactersDir ? `${settings.charactersDir}: ${fileCount(settings.charactersDir, '.png')}` : '(not set)',
      'Pieces found': `${lib.length} (${lib.filter(i => i.kind === 'lorebook').length} lorebook entries, ${lib.filter(i => i.kind === 'card').length} card fields)`,
      'SillyTavern installed now': sillyTavernNow() || '(not found)',
    }],
    ['Window', {
      Browser: browserName(userAgent),
      'Page files': pageFiles.map(f => `${f} ${fs.existsSync(path.join(HERE, f)) ? 'ok' : 'MISSING'}`).join(', '),
    }],
    ['Recent problems (oldest first; codes are explained in help.html)', problemLines(diag)],
    ['Recent console lines', diag.consoleLines()],
  ];
  return formatReport(TOOL, VERSION, BUILT, sections, full);
}

// GET /api/session: the turn list (without file positions), numbers and versions.
function sessionView(s) {
  const items = indexSession(s).map(({ at, file, ...item }) => item);
  const flagged = items.filter(i => i.flags.length).length;
  const byRule = Object.create(null);   // no inherited names (a rule called "constructor" counts like any other)
  for (const item of items) for (const f of item.flags) byRule[f.name] = (byRule[f.name] || 0) + 1;
  const timed = items.filter(i => typeof i.seconds === 'number');
  const average = (list, pick) => list.reduce((sum, i) => sum + pick(i), 0) / list.length;
  return {
    id: s.id, name: s.name, kind: s.kind, items,
    versions: sessionVersions(s, items),
    stats: {
      requests: items.length,
      flagged,
      warningsPer100: items.length ? Math.round(flagged / items.length * 1000) / 10 : 0,
      avgPromptChars: items.length ? Math.round(average(items, i => i.promptChars)) : 0,
      avgSeconds: timed.length ? Math.round(average(timed, i => i.seconds) * 10) / 10 : null,
      byRule,
    },
  };
}

// A refusal or failure: noted with its code, and the code sent with the message.
function sendProblem(res, status, code, message, detail = '') {
  // Details can come from the request (a session id): printable characters only, kept short.
  diag.note(code, String(detail || message).replace(/[^\x20-\x7e]/g, '?').slice(0, 80));
  return send(res, status, { error: `${message} (${code})`, code });
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (e) {
    // Nothing a request does may stop PromptAssay.
    diag.note('UNKNOWN', `request failed: ${e.name}`);
    if (!res.headersSent) send(res, 500, { error: `could not answer that (${e.name})`, code: 'UNKNOWN' });
  }
});

function handleRequest(req, res) {
  // Sent by a browser on behalf of another page (an <img> or link on some web site)? Refused.
  // The window's own page sends "same-origin"; the launcher or address bar "none"; programs nothing.
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return sendProblem(res, 403, 'PA-REFUSED-ORIGIN', 'sent by another site');
  if (!hostOk(req)) return sendProblem(res, 403, 'PA-REFUSED-HOST', 'unexpected Host header');
  if (!originOk(req)) return sendProblem(res, 403, 'PA-REFUSED-ORIGIN', 'request from another site');
  if (req.method === 'POST' && req.url === '/api/thanks') return hideThanks(req, res);
  if (req.method !== 'GET') return sendProblem(res, 405, 'PA-READ-ONLY', 'read-only', req.method);

  try {
    const url = new URL(req.url, 'http://x');   // throws on addresses such as "//": answered below
    if (PAGE_FILES[url.pathname]) {
      const [file, type] = PAGE_FILES[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(HERE, 'ui', file)), type);
    }

    // The tool's icon: shown on the window, its taskbar button and in the header.
    if (url.pathname === '/icon.png' || url.pathname === '/favicon.ico') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'icon', 'promptassay.png')), 'image/png');
    }
    if (url.pathname === '/help') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, 'Content-Security-Policy': HELP_CSP });
      return res.end(fs.readFileSync(path.join(HERE, 'help.html')));
    }
    if (url.pathname === '/api/about') return send(res, 200, ABOUT);
    // WS_HIDE_THANKS=1 is for the test suites only (their scripted clicks would land on the note).
    if (url.pathname === '/api/thanks') return send(res, 200, { show: settings.showThanks && process.env.WS_HIDE_THANKS !== '1' });
    if (url.pathname === '/api/errors') return send(res, 200, { codes: CODES, recent: diag.problems() });
    if (url.pathname === '/api/diagnostic') {
      // The report is only text the page shows before the person saves it themselves.
      const full = url.searchParams.get('full') === '1';
      return send(res, 200, { text: diagnosticReport(full, req.headers['user-agent']), full });
    }

    if (url.pathname === '/api/sessions') {
      const sessions = listSessions();
      if (!sessions.some(x => !x.demo)) diag.note('PA-NO-SESSIONS', settings.logDirs.join('; '));
      return send(res, 200, {
        tool: TOOL, version: VERSION, built: BUILT,
        sessions: sessions.map(({ dir, ...s }) => s),   // never the folder path
        labelling: { worlds: !!settings.worldsDir, characters: !!settings.charactersDir, items: loadLibrary().length },
      });
    }

    if (url.pathname === '/api/session') {
      const s = findSession(url.searchParams.get('id'));
      if (!s) return sendProblem(res, 404, 'PA-SESSION-GONE', 'no such session', String(url.searchParams.get('id')).slice(0, 80));
      return send(res, 200, sessionView(s));
    }

    if (url.pathname === '/api/record') {
      const s = findSession(url.searchParams.get('id'));
      if (!s) return sendProblem(res, 404, 'PA-SESSION-GONE', 'no such session', String(url.searchParams.get('id')).slice(0, 80));
      const items = indexSession(s);
      const n = Number(url.searchParams.get('n'));
      const k = items.findIndex(i => i.n === n);
      if (k < 0) return sendProblem(res, 404, 'PA-RECORD-UNREADABLE', 'no such request', `#${n}`);
      const rec = readRecord(s, items[k]);
      rec.n = n;
      const prev = k > 0 ? readRecord(s, items[k - 1]) : null;
      const cached = indexCache.get(s.id);
      return send(res, 200, decode(rec, prev, s.demo ? DEMO : settings, cached ? cached.preferred : null, cached ? cached.misses : 0));
    }
  } catch (e) {
    if (e instanceof TypeError && /Invalid URL/.test(e.message)) return send(res, 400, { error: 'not a usable address' });
    // The error's name only: a JSON error message quotes the record's own text.
    return sendProblem(res, 500, 'PA-RECORD-UNREADABLE', `could not read that (${e.name})`, `${req.url.slice(0, 40)}: ${e.name}`);
  }
  send(res, 404, { error: 'not found' });
}

// POST /api/thanks  { show: false }: the thank-you note's "Don't show this again".
// The only request that writes anything. It must come from this window's own page (an Origin on
// this port, not just "no Origin"), as JSON, at most 1 KB; it sets showThanks to false in
// settings.json and keeps every other line of the file as it was (temp file, then rename).
function hideThanks(req, res) {
  const origin = req.headers.origin;
  if (!origin || !originOk(req)) return sendProblem(res, 403, 'PA-REFUSED-ORIGIN', 'only from the PromptAssay window');
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'JSON only' });
  const chunks = [];
  let size = 0;
  let refused = false;
  req.on('data', d => {
    size += d.length;
    if (size > 1024 && !refused) {
      refused = true;
      res.setHeader('Connection', 'close');
      res.on('finish', () => req.destroy());   // after the answer has gone, so the sender sees it
      send(res, 413, { error: 'too large' });
      return;
    }
    if (refused) return;
    chunks.push(d);
  });
  req.on('end', () => {
    if (refused) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return send(res, 400, { error: 'not valid JSON' }); }
    if (!body || body.show !== false) return send(res, 400, { error: 'expected { "show": false }' });
    try {
      let raw = {};
      if (fs.existsSync(SETTINGS_FILE)) raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return send(res, 409, { error: 'settings.json is not an object' });
      raw.showThanks = false;
      const tmp = SETTINGS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
      fs.renameSync(tmp, SETTINGS_FILE);
      settings.showThanks = false;
      console.log('  the thank-you note will not show again (showThanks false in settings.json)');
      send(res, 200, { show: false });
    } catch (e) {
      sendProblem(res, 500, 'PA-SETTINGS-WRITE', `could not write settings.json (${e.code || e.name})`, e.code || e.name);
    }
  });
}

// The window port: any free port the operating system hands out, so it can never clash with
// another program. running.json tells the launcher which port it got.
server.on('error', e => fail(e.message, 'PA-WINDOW-FAILED'));
server.on('listening', () => {
  settings.port = server.address().port;
  writeRunning();
  console.log(`${TOOL} ${VERSION} (prototype), built ${BUILT}`);
  console.log(`  window: http://127.0.0.1:${settings.port}`);
  console.log(`  reading: ${settings.logDirs.join('; ') || '(no log folders set)'}`);
  const labelFolders = [settings.worldsDir, settings.charactersDir].filter(Boolean).join('; ');
  console.log(`  labelling from: ${labelFolders || '(not set: sections are labelled by position only) (PA-LABELS-OFF)'}`);
  if (!labelFolders) diag.note('PA-LABELS-OFF');
  console.log('  Read-only. Close this window to stop.\n');
});
server.listen(0, '127.0.0.1');

// running.json: which port this copy's window is on, for the Start launchers. Removed on exit.
function writeRunning() {
  const info = { tool: TOOL, version: VERSION, built: BUILT, port: settings.port, pid: process.pid, started: new Date().toISOString() };
  try {
    fs.writeFileSync(RUNNING_FILE, JSON.stringify(info, null, 2));
  } catch (e) {
    diag.note('PA-RUNNING-FILE', e.code || e.message);
    console.log(`  (could not write running.json: ${e.message}; the launcher may open the wrong port) (PA-RUNNING-FILE)`);
  }
}

function removeRunning() {
  try {
    // Only remove it if it is ours (another copy may have started since).
    if (JSON.parse(fs.readFileSync(RUNNING_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(RUNNING_FILE);
  } catch (_) { /* already gone */ }
}

process.on('exit', removeRunning);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(0));
