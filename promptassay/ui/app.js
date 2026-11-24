// PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// PromptAssay's window (the page that shows the logs)
// ----------------------------------------------------------------------------
// What is on the page, and where it is handled below:
//   1. Helpers                 building elements, asking PromptAssay, marks
//   2. Sessions                the session list, numbers and versions line
//   3. Live updates            new requests appear without reloading
//   4. Timeline and turn list  one mark / one line per request, filters
//   5. One request             taken apart: facts, flags, size bar, what
//                              entered or left, the prompt in order, reply
//   6. One piece               a lorebook entry or card field, exactly as sent
//   7. About, Help and the diagnostic report
//   8. Filters, keyboard shortcuts, window size on opening, start-up
//
// Log text is untrusted (it is whatever the model and the prompt contained),
// so everything is put on the page with textContent, never as HTML.
// ============================================================================

'use strict';


// ----------------------------------------------------------------------------
// 1. Helpers
// ----------------------------------------------------------------------------

const $ = selector => document.querySelector(selector);
const SEVERITY_ORDER = { note: 1, warning: 2, serious: 3 };

let session = null;      // the loaded session: { id, name, kind, items, versions, stats }
let currentN = null;     // the request number on show
let showChat = false;    // chat history sections collapsed into one line by default
let oneBlock = false;    // text completion: show the prompt as the one block it was sent as (key B)

// Make an element. props: class, text (as textContent), on<event> handlers,
// true for an empty attribute (e.g. disabled: true), false or null to leave it off.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

// GET JSON from PromptAssay; throws with its error message if it refused.
async function api(path) {
  const res = await fetch(path, { cache: 'no-store' });
  const answer = await res.json();
  if (!res.ok) throw new Error(answer.error || res.statusText);
  return answer;
}

// The most serious severity among some flags ('' if none).
function worst(flags) {
  let result = '';
  for (const f of flags) {
    if ((SEVERITY_ORDER[f.severity] || 0) > (SEVERITY_ORDER[result] || 0)) result = f.severity;
  }
  return result;
}

// 1234 -> "1.2k"
function kchars(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

function timeOf(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

// Put text into a <pre>, wrapping every occurrence of each flag's matched text in <mark>.
// "piece" ({start, end, label}) optionally marks one entry's exact place as well.
function highlighted(text, flags, piece = null) {
  const pre = el('pre');
  const marks = [];   // [start, end, class, title]
  if (piece) marks.push([piece.start, piece.end, 'piece', piece.label]);

  const lower = text.toLowerCase();
  for (const f of flags) {
    const matched = (f.match || '').trim();
    if (matched.length < 2) continue;
    const needle = matched.toLowerCase();
    let i = 0;
    while ((i = lower.indexOf(needle, i)) !== -1) {
      marks.push([i, i + matched.length, f.severity, f.name]);
      i += matched.length;
    }
  }

  marks.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [start, end, cls, title] of marks) {
    if (start < pos) continue;   // overlapping marks: the first one wins (the entry's own mark comes first)
    pre.append(text.slice(pos, start));
    pre.append(el('mark', { class: cls, title, text: text.slice(start, end) }));
    pos = end;
  }
  pre.append(text.slice(pos));
  return pre;
}


// ----------------------------------------------------------------------------
// 2. Sessions: the list, the numbers line and the versions line
// ----------------------------------------------------------------------------

let knownSessions = new Set();   // session ids already in the list (to spot new ones)

async function loadSessions() {
  const answer = await api('/api/sessions');
  knownSessions = new Set(answer.sessions.map(s => s.id));
  const select = $('#session');
  if (!answer.sessions.length) {
    select.textContent = '';
    select.append(el('option', { text: 'no sessions found (PA-NO-SESSIONS: see Help)' }));
    return;
  }
  await fillSessionList(answer);
  // A link may name a session and request: /?session=<id>&n=<number>
  const query = new URLSearchParams(location.search);
  if (query.get('session') && answer.sessions.some(s => s.id === query.get('session'))) select.value = query.get('session');
  await loadSession(select.value, Number(query.get('n')) || null);
}

function fillSessionList(answer) {
  knownSessions = new Set(answer.sessions.map(s => s.id));
  const select = $('#session');
  select.textContent = '';
  for (const s of answer.sessions) {
    // Folder names hold UTC time (2026-11-22T09-03-29-495Z); show it in local time.
    const iso = s.name.replace(/^(session|run)_/, '').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, 'T$1:$2:$3.$4Z');
    const when = new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const text = s.demo ? 'demo (made up): The Lantern Coast' : `${when}  ${s.kind === 'old-logger' ? '(old logger)' : ''}`;
    select.append(el('option', { value: s.id, text }));
  }
}

// Open a session; show request wantN, or else the newest visible one.
async function loadSession(id, wantN = null) {
  session = await api('/api/session?id=' + encodeURIComponent(id));
  $('#newNote').hidden = true;
  showStats();
  drawLists();
  const items = visibleItems();
  if (wantN && session.items.some(i => i.n === wantN)) showRecord(wantN);
  else if (items.length) showRecord(items[items.length - 1].n);
}

// The numbers in the header, and the rule filter's choices.
function showStats() {
  const st = session.stats;
  $('#sessionStats').textContent =
    `${st.requests} requests · ${st.flagged} flagged (${st.warningsPer100} per 100) · avg ${kchars(st.avgPromptChars)} chars`
    + (st.avgSeconds != null ? ` · avg ${st.avgSeconds} s` : '');

  const ruleFilter = $('#ruleFilter');
  const keep = ruleFilter.value;
  ruleFilter.textContent = '';
  ruleFilter.append(el('option', { value: '', text: 'all rules' }));
  for (const [name, count] of Object.entries(st.byRule).sort((a, b) => b[1] - a[1])) {
    ruleFilter.append(el('option', { value: name, text: `${name} (${count})` }));
  }
  ruleFilter.value = keep in st.byRule ? keep : '';
  showVersions();
}

// Which versions this session was recorded with, and which model(s) its requests asked for.
// Logs from before ContextWeir 0.5 did not note versions: those say "not recorded", and the
// SillyTavern installed now is shown beside it, marked as today's.
function showVersions() {
  const v = session.versions;
  const box = $('#versions');
  box.textContent = '';
  if (!v) return;

  const part = (label, value, title) => el('span', { class: 'v', title: title || '' }, el('span', { class: 'muted', text: label + ' ' }), value);
  const versionText = x => (x ? `${x.name} ${x.version}${x.note ? ' (' + x.note + ')' : ''}` : null);

  // Frontend (SillyTavern)
  const installedNow = v.sillyTavernNow ? ` (installed now: ${v.sillyTavernNow})` : '';
  const frontendText = versionText(v.frontend) || (v.recorded ? 'not found' + installedNow : 'not recorded' + installedNow);
  const frontendTitle = v.recorded
    ? 'Noted by ContextWeir when the session started'
    : 'This log is from before ContextWeir 0.5, which notes versions. "Installed now" is today\'s SillyTavern, '
      + 'not necessarily the one that made this log.';
  box.append(part('Frontend:', frontendText, frontendTitle));

  // Model server
  const ms = v.modelServer;
  let serverText = 'not recorded';
  if (ms) {
    serverText = ms.server ? versionText(ms.server) : ms.reachable ? 'answered, no version given' : 'did not answer';
    if (ms.models && ms.models.length) serverText += ` · loaded: ${ms.models.join(', ')}`;
  }
  box.append(part('Model server:', serverText));

  // The model the requests asked for, and every change
  const named = v.models.filter(m => m.model);
  if (!named.length) {
    box.append(part('Model asked for:', 'not given in the requests'));
  } else if (v.models.length === 1) {
    box.append(part('Model asked for:', named[0].model));
  } else {
    const changes = v.modelChanges.length;
    const stretches = v.models.map(m => `${m.model || '(none)'} (#${m.from}${m.to !== m.from ? '–' + m.to : ''})`).join(' → ');
    box.append(part('Model asked for:', el('span', { class: 'mchange-text', text: `changed ${changes} time${changes > 1 ? 's' : ''}: ${stretches}` })));
  }
  if (v.demo) box.append(part('Demo:', 'a made-up session that ships with the tools; nothing in it comes from a real chat'));
  else if (v.tool) box.append(part('Recorded by:', `${v.tool.name} ${v.tool.version}`));
}


// ----------------------------------------------------------------------------
// 3. Live updates
// ----------------------------------------------------------------------------
// New requests appear without reloading the page. If you were looking at the
// newest request, the view follows the new one; otherwise it stays where you
// are. A session started after the page opened (ContextWeir restarted) is
// added to the list and announced, never jumped to.

const LIVE_MS = 3000;          // the open session is checked every 3 s
const SESSIONS_EVERY = 5;      // the session list every 5th check (15 s)
let liveTick = 0;
let liveBusy = false;

async function liveUpdate() {
  if (liveBusy || !session || !$('#live').checked || document.hidden) return;
  liveBusy = true;
  try {
    const fresh = await api('/api/session?id=' + encodeURIComponent(session.id));
    if (fresh.id === session.id && fresh.items.length !== session.items.length) {
      const lastN = session.items.length ? session.items[session.items.length - 1].n : null;
      const following = currentN === lastN;
      session = fresh;
      showStats();
      drawLists();
      const visible = visibleItems();
      if (following && visible.length) showRecord(visible[visible.length - 1].n);
    }

    if (++liveTick % SESSIONS_EVERY === 0) {
      const answer = await api('/api/sessions');
      const added = answer.sessions.filter(s => !knownSessions.has(s.id));
      if (added.length) {
        const select = $('#session');
        const keep = select.value;
        await fillSessionList(answer);
        select.value = keep;
        const note = $('#newNote');
        note.textContent = added.length === 1 ? 'new session: open it' : `${added.length} new sessions: open the newest`;
        note.dataset.id = added[0].id;
        note.hidden = false;
      }
    }
  } catch (_) {
    /* the tool may be restarting; try again next time */
  } finally {
    liveBusy = false;
  }
}
setInterval(liveUpdate, LIVE_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveUpdate(); });


// ----------------------------------------------------------------------------
// 4. The timeline and the turn list
// ----------------------------------------------------------------------------

// The requests that pass the filters (flagged only, rule, kind), oldest first.
function visibleItems() {
  const flaggedOnly = $('#onlyFlagged').checked;
  const rule = $('#ruleFilter').value;
  const kind = $('#kindFilter').value;
  return session.items.filter(item =>
    (!flaggedOnly || item.flags.length)
    && (!rule || item.flags.some(f => f.name === rule))
    && (!kind || item.kind === kind));
}

const KIND_NOTE = { summary: ' (Summarize)', script: ' (script request)' };

function drawLists() {
  const timeline = $('#timeline');
  const list = $('#turns');
  timeline.textContent = '';
  list.textContent = '';
  const rule = $('#ruleFilter').value;
  const modelChanged = new Set((session.versions && session.versions.modelChanges) || []);

  // The timeline: every request, one mark each, coloured by its worst flag.
  // Every 25th request number (and the first) gets a number under its mark, to find turns faster.
  session.items.forEach((item, k) => {
    const flags = rule ? item.flags.filter(f => f.name === rule) : item.flags;
    const tick = k === 0 || item.n % 25 === 0;
    const changed = modelChanged.has(item.n);
    const classes = worst(flags) + (tick ? ' tick' : '') + (item.kind !== 'story' ? ' k-' + item.kind : '') + (changed ? ' mchange' : '');
    const title = `#${item.n}${KIND_NOTE[item.kind] || ''}`
      + (changed ? ' (model changed: ' + (item.model || 'none') + ')' : '')
      + (flags.length ? ': ' + flags.map(f => f.name).join('; ') : '');
    timeline.append(el('button', {
      class: classes, 'data-n': item.n, ...(tick ? { 'data-tick': String(item.n) } : {}),
      title,
      onclick: () => showRecord(item.n),
    }));
  });

  // The turn list: only the visible requests, newest first.
  for (const item of visibleItems().slice().reverse()) {
    const meta = [
      item.mode === 'text' ? 'text' : null,
      item.swipe ? 'swipe' : null,
      item.seconds != null ? item.seconds + ' s' : null,
      kchars(item.promptChars) + ' chars',
      timeOf(item.time),
    ].filter(Boolean).join(' · ');
    list.append(el('button', { class: 'turn', 'data-n': item.n, onclick: () => showRecord(item.n) },
      el('div', { class: 'top' },
        el('span', { class: 'dot ' + worst(item.flags) }),
        el('span', { class: 'num', text: '#' + item.n }),
        item.kind !== 'story' ? el('span', { class: 'kind ' + item.kind, text: item.kind === 'summary' ? 'Summarize' : 'script' }) : null,
        modelChanged.has(item.n)
          ? el('span', { class: 'kind mchange', text: 'model changed', title: 'Now asking for: ' + (item.model || '(none)') })
          : null,
        el('span', { class: 'meta', text: meta })),
      el('div', { class: 'player', text: item.player || '—' }),
      item.flags.length ? el('div', { class: 'meta', text: item.flags.map(f => f.name).join('; ') }) : null,
    ));
  }
  markCurrent();
}

// Highlight the request on show in both lists and keep it in view.
function markCurrent() {
  document.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('current', Number(b.dataset.n) === currentN));
  const inList = document.querySelector('#turns .current');
  if (inList) inList.scrollIntoView({ block: 'nearest' });
  const onTimeline = document.querySelector('#timeline .current');   // the timeline scrolls sideways to keep it in view
  if (onTimeline) onTimeline.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Moving between requests, in request order, within the current filters.
// direction -1 = the one before (earlier), +1 = the one after; flaggedOnly skips to the next flagged one.
function step(direction, flaggedOnly = false) {
  if (!session) return;
  const items = visibleItems().filter(i => !flaggedOnly || i.flags.length);
  if (!items.length) return;
  let k = items.findIndex(i => i.n === currentN);
  if (k < 0) {
    // The current one is filtered out: find the nearest in that direction.
    k = direction > 0
      ? items.findIndex(i => i.n > currentN)
      : items.map(i => i.n < currentN).lastIndexOf(true);
    if (k >= 0) return showRecord(items[k].n);
    return;
  }
  const next = items[k + direction];
  if (next) showRecord(next.n);
}

function jump(where) {
  const items = visibleItems();
  if (items.length) showRecord(items[where === 'first' ? 0 : items.length - 1].n);
}


// ----------------------------------------------------------------------------
// 5. One request, taken apart
// ----------------------------------------------------------------------------

// Colours of the size bar, by where in the prompt the text sits.
const BAR_COLOURS = { system: '#7fb3d5', inject: '#b39ddb', after: '#e0a96d', chat: '#4f5a6b', prefill: '#8fd19e' };
const BAR_NAMES = { system: 'before the chat', inject: 'injected', after: 'after the chat', chat: 'chat history', prefill: 'prefill' };

// Which part of the bar a section belongs to.
function barPart(section) {
  if (section.chat) return 'chat';
  if (section.label.startsWith('Reply start')) return 'prefill';
  if (section.label.startsWith('Injected')) return 'inject';
  if (section.label.startsWith('After') || section.label.startsWith('Script')) return 'after';
  return 'system';
}

async function showRecord(n) {
  currentN = n;
  markCurrent();
  const d = await api(`/api/record?id=${encodeURIComponent(session.id)}&n=${n}`);
  if (currentN !== n) return;   // another request was picked while this one loaded: show that one, not this
  const box = $('#detail');
  box.textContent = '';

  drawRequestHead(box, d);
  drawFlags(box, d);
  drawSizeBar(box, d);
  drawChanges(box, d);
  drawSections(box, d);

  // The reply
  const replyTitle = d.kind === 'summary' ? 'Summary written (SillyTavern Summarize, not a story reply)'
    : d.kind === 'script' ? 'Reply to the script request' : 'Reply';
  box.append(el('h3', { text: replyTitle }));
  const replyFlags = d.flags.filter(f => !f.target || f.target === 'reply');
  box.append(el('div', { class: 'reply' }, highlighted(d.reply || '(empty)', replyFlags)));

  // Sampler settings, for completeness
  box.append(el('h3', { text: 'Request settings' }));
  box.append(el('pre', { text: JSON.stringify(d.settings, null, 2) }));
}

// Title, Previous / Next, and the facts line (size, messages, time, model, labelling).
function drawRequestHead(box, d) {
  const visible = visibleItems();
  const at = visible.findIndex(i => i.n === d.n);
  box.append(el('div', { class: 'reqHead' },
    el('h2', { text: `Request #${d.n}${d.swipe ? '  (swipe / regenerate)' : ''}` }),
    el('span', { class: 'grow' }),
    el('button', { type: 'button', class: 'stepBtn', text: '◀ Previous', title: 'The request before (Left arrow)', disabled: at <= 0, onclick: () => step(-1) }),
    el('button', { type: 'button', class: 'stepBtn', text: 'Next ▶', title: 'The request after (Right arrow)', disabled: at < 0 || at >= visible.length - 1, onclick: () => step(1) })));

  box.append(el('div', { class: 'facts' },
    el('span', {}, el('b', { text: kchars(d.totals.chars) }), ' chars (about ', el('b', { text: kchars(d.totals.approxTokens) }), ' tokens)'),
    el('span', {}, el('b', { text: String(d.sections.length) }), ' messages, ', el('b', { text: String(d.totals.chatMessages) }), ' of them chat'),
    d.seconds != null ? el('span', {}, el('b', { text: d.seconds + ' s' }), ' reply time') : null,
    d.time ? el('span', { text: new Date(d.time).toLocaleString() }) : null,
    d.model
      ? el('span', { class: d.modelBefore ? 'mchange-text' : '' }, 'model ', el('b', { text: d.model }), d.modelBefore ? ` (changed from ${d.modelBefore})` : '')
      : null,
    el('span', { text: d.libraryLoaded ? `labelled against ${d.libraryLoaded} lorebook/card pieces` : 'labelling off (set worldsDir / charactersDir)' }),
  ));
  if (d.textSplit) box.append(textSplitLine(d));
}

// Text completion: one line saying how the single prompt string was taken apart, so a wrong split
// reads as the guess it is. "Show as one block" (key B) shows the prompt exactly as it was sent.
function textSplitLine(d) {
  const t = d.textSplit;
  const how = t.how === 'template'
    ? `split by the ${t.template.name} template (${t.template.source === 'built-in' ? 'built-in' : 'from SillyTavern\'s instruct presets'}); labels marked "(by template)" are a guess`
    : t.how === 'names'
      ? 'split at the speakers\' names (no instruct template recognised); labels marked "(by speaker names)" are a guess'
      : 'not split: no instruct template or speaker names recognised, so it is shown as one block';
  return el('div', { class: 'textsplit' },
    el('b', { text: 'Text completion: ' }), `one prompt string, ${how}.  `,
    t.how !== 'none'
      ? el('button', { type: 'button', class: 'link', text: oneBlock ? 'show the sections' : 'show as one block',
        title: 'Key B', onclick: () => { oneBlock = !oneBlock; showRecord(currentN); } })
      : null);
}

// A section's text with the template's markers dimmed (text completion), flags highlighted.
function sectionBody(s) {
  if (!s.wrap || !s.wrap.length) return highlighted(s.text, s.flags);
  const box = el('pre');
  const plain = part => box.append(...highlighted(part, s.flags).childNodes);   // one <pre>, pieces inside it
  let at = 0;
  for (const w of s.wrap) {
    if (w.start > at) plain(s.text.slice(at, w.start));
    box.append(el('span', { class: 'marker', text: s.text.slice(w.start, w.end), title: 'instruct template marker' }));
    at = w.end;
  }
  if (at < s.text.length) plain(s.text.slice(at));
  return box;
}

// The whole prompt as one block, with the tags of every section (text completion, key B).
function drawOneBlock(box, d) {
  const tags = el('span', { class: 'tags' });
  for (const s of d.sections) {
    for (const c of s.contains) {
      tags.append(el('button', {
        type: 'button', class: 'tag ' + c.kind, text: c.label, title: 'Click to see exactly what this put into the prompt',
        onclick: e => { e.preventDefault(); e.stopPropagation(); showPiece(s, c); },
      }));
    }
  }
  const whole = d.sections.map(s => s.text).join('');
  const flags = d.flags.filter(f => f.target === 'prompt' || f.target === 'lastUser');
  box.append(el('details', { class: 'sec', open: true },
    el('summary', {}, el('span', { class: 'lbl', text: 'Prompt (text completion), as sent' }), tags,
      el('span', { class: 'size', text: `${kchars(whole.length)} chars` })),
    highlighted(whole, flags)));
}

// The flags this request got.
function drawFlags(box, d) {
  if (!d.flags.length) return;
  const list = el('div', { class: 'flags' });
  for (const f of d.flags) {
    // Logs made before the Summarize exception existed still carry this flag on summaries.
    const expected = d.kind === 'summary' && /status line/i.test(f.name);
    list.append(el('div', { class: 'flag ' + f.severity },
      el('span', { class: 'sev', text: f.severity }),
      f.name,
      f.match ? el('span', { class: 'muted', text: `  “${f.match.slice(0, 80)}”` }) : null,
      expected ? el('span', { class: 'muted', text: '  (expected: a Summarize request writes no status line)' }) : null));
  }
  box.append(list);
}

// Where the prompt's size goes: one coloured bar and a legend.
function drawSizeBar(box, d) {
  const sums = {};
  for (const s of d.sections) sums[barPart(s)] = (sums[barPart(s)] || 0) + s.chars;
  const total = Math.max(1, d.totals.chars);
  const bar = el('div', { class: 'bar' });
  for (const [part, chars] of Object.entries(sums)) {
    const piece = el('span', { title: `${part}: ${chars} chars` });
    // Set from the script: the page's security policy blocks style="" attributes.
    piece.style.width = (chars / total * 100).toFixed(2) + '%';
    piece.style.background = BAR_COLOURS[part];
    bar.append(piece);
  }
  box.append(bar);
  box.append(el('div', { class: 'legend', text: Object.entries(sums).map(([part, chars]) => `${BAR_NAMES[part]} ${Math.round(chars / total * 100)}%`).join(' · ') }));
}

// What changed since the previous request. Entries that entered can be
// clicked to see their text; those that left are no longer in this prompt.
function drawChanges(box, d) {
  if (!d.entered.length && !d.left.length) return;
  const shortList = list => (list.length > 10 ? list.slice(0, 10).join(', ') + ` … and ${list.length - 10} more` : list.join(', '));

  const enteredLine = el('div', { class: 'in' }, '+ entered: ');
  d.entered.slice(0, 10).forEach((label, i) => {
    if (i) enteredLine.append(', ');
    const section = d.sections.find(s => s.contains.some(c => c.label === label));
    enteredLine.append(section
      ? el('button', {
        type: 'button', class: 'link', text: label, title: 'Show exactly what this put into the prompt',
        onclick: () => showPiece(section, section.contains.find(c => c.label === label)),
      })
      : label);
  });
  if (d.entered.length > 10) enteredLine.append(` … and ${d.entered.length - 10} more`);

  box.append(el('div', { class: 'changes' },
    d.entered.length ? enteredLine : null,
    d.left.length ? el('div', { class: 'out', text: '− left: ' + shortList(d.left), title: d.left.join('\n') }) : null));
}

// The prompt, message by message. Chat history is folded into one line unless
// "show" was pressed; the player's newest message is always shown.
function drawSections(box, d) {
  box.append(el('h3', { text: 'The prompt, in order' }));
  if (d.textSplit && oneBlock && d.textSplit.how !== 'none') return drawOneBlock(box, d);

  let foldedChat = [];
  const flushFoldedChat = () => {
    if (!foldedChat.length) return;
    const count = foldedChat.length;
    const chars = foldedChat.reduce((sum, s) => sum + s.chars, 0);
    const fresh = foldedChat.filter(s => s.isNew).length;
    box.append(el('div', { class: 'chathide' }, `${count} chat messages, ${kchars(chars)} chars${fresh ? `, ${fresh} new` : ''}  `,
      el('button', { text: 'show', onclick: () => { showChat = true; showRecord(currentN); } })));
    foldedChat = [];
  };

  for (const s of d.sections) {
    if (s.chat && !showChat && !(s.label === 'Player (newest)')) { foldedChat.push(s); continue; }
    flushFoldedChat();

    const tags = el('span', { class: 'tags' });
    if (s.isNew) tags.append(el('span', { class: 'tag new', text: 'new' }));
    for (const c of s.contains) {
      tags.append(el('button', {
        type: 'button', class: 'tag ' + c.kind, text: c.label, title: 'Click to see exactly what this put into the prompt',
        onclick: e => { e.preventDefault(); e.stopPropagation(); showPiece(s, c); },   // don't also open/close the section
      }));
    }
    s.flags = d.flags.filter(f => f.target === 'prompt' || f.target === 'lastUser');
    s.el = el('details', { class: 'sec' + (s.chat ? ' chat' : '') },
      el('summary', {},
        el('span', { class: 'lbl', text: s.label }),
        tags,
        el('span', { class: 'size', text: `${kchars(s.chars)} chars · ${s.role}` })),
      sectionBody(s));
    box.append(s.el);
  }
  flushFoldedChat();
  if (showChat) {
    box.append(el('div', { class: 'chathide' },
      el('button', { text: 'collapse chat history', onclick: () => { showChat = false; showRecord(currentN); } })));
  }
}


// ----------------------------------------------------------------------------
// 6. One piece (a lorebook entry, card field or block), exactly as it was sent
// ----------------------------------------------------------------------------

let shownPiece = null;   // { section, piece } while the dialog is open

function showPiece(section, piece) {
  shownPiece = { section, piece };
  const span = piece.span;
  const text = span ? section.text.slice(span.start, span.end) : section.text;
  $('#pieceTitle').textContent = piece.label;
  $('#pieceWhere').textContent = span
    ? `In "${section.label}" (message ${section.i + 1}, ${section.role}): characters ${span.start + 1}–${span.end} of ${section.chars}, `
      + `${text.length} chars (about ${Math.round(text.length / 3.6)} tokens). Shown exactly as sent, with macros such as {{user}} already filled in.`
    : `Recognised in "${section.label}" (message ${section.i + 1}), but its exact edges could not be found `
      + '(the text may have been changed on the way in). Showing the whole message.';
  $('#pieceText').textContent = text;
  $('#pieceShow').hidden = !span || span.end - span.start === section.chars;   // nothing to point at if it is the whole message
  $('#pieceDialog').showModal();
}

$('#pieceClose').addEventListener('click', () => $('#pieceDialog').close());

$('#pieceCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#pieceText').textContent);
    $('#pieceCopy').textContent = 'Copied';
  } catch (_) {
    $('#pieceCopy').textContent = 'Copy failed';
  }
  setTimeout(() => { $('#pieceCopy').textContent = 'Copy text'; }, 1500);
});

// Open the message in the list, mark the piece inside it, and scroll to it.
$('#pieceShow').addEventListener('click', () => {
  const { section, piece } = shownPiece;
  $('#pieceDialog').close();
  if (!section.el) return;
  section.el.querySelector('pre').replaceWith(highlighted(section.text, section.flags, { ...piece.span, label: piece.label }));
  section.el.open = true;
  const mark = section.el.querySelector('mark.piece');
  if (mark) mark.scrollIntoView({ block: 'center' });
});


// ----------------------------------------------------------------------------
// 7. About, Help and the diagnostic report
// ----------------------------------------------------------------------------

$('#aboutBtn').addEventListener('click', async () => {
  const about = await api('/api/about');
  const body = $('#aboutBody');
  body.textContent = '';
  const rows = [
    ['Version', `${about.version} (${about.stage}), built ${about.built}`],
    ['What it does', about.purpose],
    ['Reads', about.reads.join('; ')],
    ['Tested with', about.testedWith.join('; ')],
    ['Needs', about.needs],
    ['Written by', about.writtenBy.map(w => `${w.by} (versions ${w.versions})`).join('; ')],
    ['Directed by', about.directedBy],
    ['Credit', about.credit],
    ['Licence', about.licence],
    ['Privacy', about.privacy],
  ];
  body.append(el('div', { class: 'about' }, el('h3', { text: about.name }),
    el('dl', {}, ...rows.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]))));
  $('#aboutDialog').showModal();
});
$('#aboutClose').addEventListener('click', () => $('#aboutDialog').close());

// Help opens in a window of its own (the same help.html that ships in the folder). The page keeps
// hold of that window so it can close it when this window closes (or reloads) (user, 24 Nov).
let helpWindow = null;
$('#helpBtn').addEventListener('click', () => { helpWindow = window.open('/help', 'help', 'width=920,height=900'); });
function closeHelp() {
  try { if (helpWindow && !helpWindow.closed) helpWindow.close(); } catch (_) { /* already gone */ }
}
window.addEventListener('pagehide', closeHelp);

// The diagnostic report. PromptAssay builds it (no prompt, reply or lorebook text; folder paths
// shortened unless "full paths" is ticked). The page shows all of it first; "Save to a file"
// saves exactly the text on screen, from the page itself, so nothing leaves this computer.
let diagUrl = null;   // the saved file's address in this page (freed when replaced)

async function showDiagnostic() {
  const full = $('#diagFull').checked;
  let report;
  try {
    report = await api('/api/diagnostic' + (full ? '?full=1' : ''));
  } catch (_) {
    report = { text: 'This PromptAssay has no diagnostic report yet: it was started before the version that adds it. '
      + 'Close its console and start it again, then try once more.' };
  }
  $('#diagText').textContent = report.text;
  if (diagUrl) URL.revokeObjectURL(diagUrl);
  diagUrl = URL.createObjectURL(new Blob([report.text], { type: 'text/plain' }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('#diagSave').href = diagUrl;
  $('#diagSave').download = `promptassay-diagnostic_${stamp}.txt`;
  if (!$('#diagDialog').open) $('#diagDialog').showModal();
}

$('#diagBtn').addEventListener('click', showDiagnostic);
$('#diagFull').addEventListener('change', showDiagnostic);
$('#diagClose').addEventListener('click', () => $('#diagDialog').close());
$('#diagCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#diagText').textContent);
    $('#diagCopy').textContent = 'Copied';
  } catch (_) {
    $('#diagCopy').textContent = 'Copy failed';
  }
  setTimeout(() => { $('#diagCopy').textContent = 'Copy'; }, 1500);
});


// ----------------------------------------------------------------------------
// 8. Filters, keyboard shortcuts, window size on opening, start-up
// ----------------------------------------------------------------------------

$('#session').addEventListener('change', e => loadSession(e.target.value));
$('#newNote').addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (id) { $('#session').value = id; loadSession(id); }
});
$('#live').addEventListener('change', () => { if ($('#live').checked) liveUpdate(); });
$('#onlyFlagged').addEventListener('change', drawLists);
$('#ruleFilter').addEventListener('change', drawLists);
$('#kindFilter').addEventListener('change', drawLists);

// Keyboard shortcuts (user, 24 Nov). Single keys work when you are not typing in a box.
const KEYS = [
  ['← / →', 'The request before / after'],
  ['↑ / ↓  (or K / J)', 'Up / down the list (the list shows the newest first)'],
  ['Shift+← / Shift+→', 'The flagged request before / after'],
  ['Home / End', 'The first / last request'],
  ['F', 'Flagged only on or off'],
  ['L', 'Live updates on or off'],
  ['0  1  2  3', 'Show all requests / story turns / Summarize / script requests'],
  ['E', 'Open or close all sections of the request'],
  ['B', 'Text completion: show the prompt as one block / as sections'],
  ['?', 'This list'],
  ['Esc', 'Close a popup'],
];

function showKeys() {
  const table = $('#keysTable');
  table.textContent = '';
  for (const [keys, what] of KEYS) table.append(el('tr', {}, el('td', {}, el('kbd', { text: keys })), el('td', { text: what })));
  $('#keysDialog').showModal();
}
$('#keysBtn').addEventListener('click', showKeys);
$('#keysClose').addEventListener('click', () => $('#keysDialog').close());

// Tick or untick a checkbox as if clicked (so its change handler runs).
function toggle(selector) {
  const box = $(selector);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change'));
}

// 0-3: the kind filter (all, story, summary, script).
function showKind(digit) {
  const kindFilter = $('#kindFilter');
  kindFilter.value = ['', 'story', 'summary', 'script'][digit];
  kindFilter.dispatchEvent(new Event('change'));
}

function toggleAllSections() {
  const all = [...document.querySelectorAll('details.sec')];
  const open = !all.every(d => d.open);
  all.forEach(d => { d.open = open; });
}

document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;          // Esc closes a popup by itself
  const typingInBox = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && e.target.type !== 'checkbox';
  if (typingInBox) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key;
  const actions = {
    ArrowLeft: () => step(-1, e.shiftKey),
    ArrowRight: () => step(1, e.shiftKey),
    ArrowUp: () => step(1), k: () => step(1),          // the list shows the newest first, so "up" is later
    ArrowDown: () => step(-1), j: () => step(-1),
    Home: () => jump('first'),
    End: () => jump('last'),
    f: () => toggle('#onlyFlagged'),
    l: () => toggle('#live'),
    e: toggleAllSections,
    b: () => { oneBlock = !oneBlock; if (currentN != null) showRecord(currentN); },
    '?': showKeys,
  };
  const act = actions[key.length === 1 ? key.toLowerCase() : key] || (/^[0-3]$/.test(key) ? () => showKind(Number(key)) : null);
  if (act) { e.preventDefault(); act(); }
});

// Window size on opening (user, 24 Nov): browsers ignore the size the launcher asks for once
// they have remembered one, so the page sets its own size when a new window opens. Only in a
// window the launcher opened (it adds ?fit to the address), only once per window, so a size the
// user picks survives reloads. A browser ignores this in an ordinary tab.
(function sizeOnOpen() {
  try {
    if (!new URLSearchParams(location.search).has('fit') || sessionStorage.getItem('sized')) return;
    sessionStorage.setItem('sized', '1');
    const width = Math.min(1400, screen.availWidth);
    const height = Math.min(900, screen.availHeight);
    window.resizeTo(width, height);
    window.moveTo(screen.availLeft + Math.round((screen.availWidth - width) / 2),
      screen.availTop + Math.round((screen.availHeight - height) / 2));
  } catch (_) { /* not allowed here: keep the browser's size */ }
})();

loadSessions().catch(e => { $('#detail').textContent = 'Could not load: ' + e.message; });
