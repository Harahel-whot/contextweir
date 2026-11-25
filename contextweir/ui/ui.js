// ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// ContextWeir's control panel (the page in ContextWeir's window)
// ----------------------------------------------------------------------------
// What is on the page, and where it is handled below:
//   1. Helpers                 building elements, sending JSON, messages
//   2. Buttons and status      Start / Pause / Stop / Restart / Quit, the
//                              start screen, the yellow or red bar, the
//                              session numbers (refreshed every 3 seconds)
//  2b. Two popups              the thank-you note, and the warning before
//                              chats go to a model server on another computer
//   3. Settings tabs           Connection, Logs, Advanced: drawn from the
//                              field list ContextWeir sends, so the panel and
//                              the checks on the other side always agree
//   4. Tabs
//   5. Rule sets               the list, switching on and off, rename, delete
//   6. Rule editor             a dialog with dropdowns; patterns are advanced
//   7. Import                  preview first, then merge or replace
//  7b. Setup file              settings and rules together (Advanced tab)
//   8. About and Help, and the diagnostic report (8b)
//   9. Window size on opening
//  10. Keyboard shortcuts
//  11. Start-up
//
// Every change is sent to ContextWeir, which checks it exactly like the files
// and saves settings.json or rules.json; the page then shows what was saved.
// Text from rule and settings files is shown with textContent only, never as
// HTML, so nothing in a file can run as script on this page.
// ============================================================================

'use strict';


// ----------------------------------------------------------------------------
// 1. Helpers
// ----------------------------------------------------------------------------

const $ = selector => document.querySelector(selector);

// Plain words for the rule targets and tests, as shown in the dropdowns.
const TARGETS = {
  reply: 'the reply',
  prompt: 'the whole prompt',
  lastUser: "the player's last message",
  lastMessage: 'the last message sent',
};
const TESTS = {
  startsWith: 'starts with',
  contains: 'contains',
  missing: 'does not contain',
  regex: 'matches pattern (advanced)',
  regexMissing: 'does not match pattern (advanced)',
};

let rules = { groups: [], problems: [] };   // the rule set as saved on disk

// Make an element. props: text (as textContent), class, on<event> handlers,
// true for an empty attribute (e.g. checked: true), false or null to leave it off.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

// A deep copy of plain data (rule sets are edited as copies, then saved whole).
function copy(obj) { return JSON.parse(JSON.stringify(obj)); }

// POST JSON to ContextWeir. Always resolves to { ok, ...answer }.
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let answer = {};
  try {
    answer = await res.json();
  } catch (_) {
    answer = { error: await res.text().catch(() => res.statusText) };
  }
  return { ok: res.ok, ...answer };
}

// GET JSON from ContextWeir (never cached).
async function getJson(path) {
  return (await fetch(path, { cache: 'no-store' })).json();
}

// The message line on the Rules tab. Good news fades after 2.5 s; problems stay.
function message(text, bad = false, list = []) {
  const box = $('#message');
  box.textContent = '';
  box.className = 'message' + (bad ? ' bad' : '');
  box.append(text);
  if (list.length) box.append(el('ul', {}, ...list.map(p => el('li', { text: p }))));
  box.hidden = false;
  clearTimeout(message.timer);
  if (!bad) message.timer = setTimeout(() => { box.hidden = true; }, 2500);
}

// A list of problems as <ul>, after a lead line.
function problemList(lead, problems) {
  return [lead, el('ul', {}, ...(problems || []).map(p => el('li', { text: p })))];
}

// One rule (or exception) in words: the reply starts with "OOC"
function describe(test) {
  const value = test.test.startsWith('regex') ? `/${test.value}/${test.flags || ''}` : `"${test.value}"`;
  return `${TARGETS[test.target] || test.target} ${TESTS[test.test] || test.test} ${value}`;
}

// Save a changed copy of the rule set. Returns true when saved.
async function save(groups, okText) {
  const answer = await post('/api/rules', { groups });
  if (!answer.ok) {
    message(answer.error || 'Not saved.', true, answer.problems || []);
    return false;
  }
  rules = answer;
  draw();
  if (okText) message(okText);
  return true;
}


// ----------------------------------------------------------------------------
// 2. The buttons, the start screen and the status (refreshes on its own)
// ----------------------------------------------------------------------------

// For each state: the label on the pill, and the line shown in the bar.
const STATES = {
  ready: ['Ready', 'Not recording. The receiving port is closed until you press Start.'],
  recording: ['Recording', ''],
  paused: ['Paused', 'Logging is paused: turns pass straight through to the model and nothing is saved.'],
  portTaken: ['Port in use', ''],
};

let status = null;     // the latest /api/status answer
let quitting = false;
let settings = null;   // the latest /api/settings answer: { saved, inUse, fields, pendingRestart, defaults }

function formatBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return Math.round(n / 1e3) + ' KB';
}

function versionLine(v) {
  if (!v) return 'not known';
  return `${v.name} ${v.version}${v.note ? ` (${v.note})` : ''}`;
}

// What the model server said about itself, in one line.
function modelServerLine(ms) {
  if (!ms) return 'asking…';
  if (ms.remote) return `${ms.address || 'another computer'} (remote server: version not asked)`;
  if (!ms.reachable) return `did not answer (${ms.error || 'no answer'})`;
  const bits = [];
  if (ms.server) bits.push(`${ms.server.name} ${ms.server.version}`);
  if (ms.models && ms.models.length) bits.push('model: ' + ms.models.join(', '));
  return bits.join('; ') || 'answered (no version given)';
}

// Press one of ContextWeir's buttons. Stop and Quit ask first: they cut the
// frontend off.
async function control(action) {
  if (action === 'stop' && !confirm('Stop recording and close the receiving port? '
    + 'Your frontend will get errors until you press Start again.')) return;
  if (action === 'quit' && !confirm('Quit ContextWeir? Recording stops, the receiving port closes, '
    + 'and this window and the console close. Start it again with its Start file.')) return;

  const answer = await post('/api/control', { action });

  // Start or Restart with a model server on another computer: the warning comes first.
  if (answer.needsRemoteOk) {
    status = answer;
    await refreshStatus();
    return askRemoteOk({ start: true });
  }

  if (action === 'quit') {
    quitting = true;
    document.body.classList.add('gone');
    // Shown if the browser will not let the page close its own window.
    $('#live').textContent = 'ContextWeir has closed. You can close this window.';
    closeHelp();
    setTimeout(() => window.close(), 400);
    return;
  }
  if (answer.error) banner(answer.error + (answer.problems ? ': ' + answer.problems.join('; ') : ''), 'bad');
  await refreshStatus();
}

// The bar under the header: kind '' (plain), 'warn' (yellow) or 'bad' (red),
// with an optional button ({ label, run }). No text hides it.
function banner(text, kind = '', action = null) {
  const bar = $('#banner');
  bar.textContent = '';
  if (!text) { bar.hidden = true; return; }
  bar.className = 'banner ' + kind;
  bar.append(el('span', { text }));
  if (action) bar.append(el('button', { type: 'button', class: 'small primary', text: action.label, onclick: action.run }));
  bar.hidden = false;
}

// Decide what the bar says, most important first.
function drawBanner() {
  if (!status) return;
  const waiting = status.pendingRestart || [];
  // An error with a code gets a button that opens the help page at that code.
  const explain = status.lastErrorCode ? { label: 'What does this mean?', run: () => openHelp(status.lastErrorCode) } : null;
  if (status.state === 'portTaken') return banner(status.lastError, 'bad', explain);
  if (status.remote && status.remote.warningNeeded && !status.relay) {
    return banner(`Not recording: set to send your chats to ${status.remote.url}. Read the warning to start, `
      + 'or untick "Allow a model server on another computer" on the Connection tab.', 'warn',
    { label: 'Read the warning', run: () => askRemoteOk({ start: true }) });
  }
  if (status.lastError) return banner(status.lastError, 'bad', explain);
  if (waiting.length && status.state !== 'ready') {
    const fieldLabel = key => ((settings && settings.fields.find(f => f.key === key)) || { label: key }).label;
    return banner(`Saved, waiting for Restart: ${waiting.map(fieldLabel).join(', ')}. `
      + 'The current session still uses the old values.', 'warn', { label: 'Restart now', run: () => control('restart') });
  }
  if (status.state === 'paused') return banner(STATES.paused[1], 'warn', { label: 'Resume', run: () => control('resume') });
  if ((status.warnings || []).length) {
    return banner('Note: ' + status.warnings.join('; ') + '. Fix it on the Logs tab, or leave it empty.', 'warn');
  }
  banner('');
}

// Fill a <dl> with label/value pairs.
function fillPairs(target, pairs) {
  target.textContent = '';
  for (const [label, value] of Object.entries(pairs)) {
    target.append(el('dt', { text: label }), el('dd', { text: String(value) }));
  }
}

// Ask ContextWeir how it is, and redraw the header, start screen and Status tab.
async function refreshStatus() {
  let st;
  try {
    st = await getJson('/api/status');
  } catch (_) {
    $('#live').textContent = 'ContextWeir is not running';
    $('#statePill').textContent = 'Closed';
    $('#statePill').className = 'pill closed';
    return;
  }
  status = st;

  // Header: version, state pill, which buttons can be pressed.
  $('#live').textContent = '';
  $('#ver').textContent = st.version + (st.built ? ` · ${st.built}` : '');
  const [label] = STATES[st.state] || [st.state];
  $('#statePill').textContent = label;
  $('#statePill').className = 'pill ' + st.state;

  const listening = !!st.relay;
  $('#btnStart').disabled = listening;
  $('#btnPause').disabled = !listening;
  $('#btnPause').textContent = st.state === 'paused' ? 'Resume' : 'Pause';
  $('#btnStop').disabled = !listening;
  drawBanner();

  // The start screen while nothing listens; session details while it does.
  const inUse = settings && settings.inUse;
  $('#startBox').hidden = listening;
  if (!listening && inUse) {
    const remoteInUse = inUse.allowRemoteModel && inUse.remoteUrl;
    const where = remoteInUse ? `${inUse.remoteUrl}, a model server on ANOTHER computer (a warning comes first)`
      : `${inUse.targetHost}:${inUse.targetPort}`;
    $('#startText').textContent = `Start opens the receiving port ${inUse.relayPort} (your frontend connects to `
      + `http://127.0.0.1:${inUse.relayPort}/v1) and forwards to the model server at ${where}. `
      + `Logs go to ${settings.saved.logsDir}.`;
    $('#skipScreen').checked = !settings.saved.showStartScreen;
  }

  if (listening) {
    fillPairs($('#status'), {
      'Frontend connects to': `http://127.0.0.1:${st.relay.port}/v1`,
      'Forwards to': st.relay.target + (st.relay.remote ? '  (another computer: your chats cross the network)' : ''),
      Logging: st.state === 'paused' ? 'paused (nothing saved)' : st.sessionDir,
      Frontend: versionLine(st.summary && st.summary.frontend),
      'Model server': modelServerLine(st.summary && st.summary.modelServer),
    });
  } else {
    fillPairs($('#status'), { State: (STATES[st.state] || [st.state])[0], 'Receiving port': 'closed' });
  }

  // This session's numbers.
  const sum = st.summary;
  if (sum) {
    fillPairs($('#stats'), {
      Requests: sum.requests,
      Swipes: sum.swipes,
      Flagged: `${sum.flagged} (${sum.warningsPer100} per 100)`,
      'Avg prompt': sum.avgPromptChars + ' chars',
      'Avg reply time': sum.avgSeconds + ' s',
      'Model errors': sum.errors,
      ...(sum.notLogged ? { 'Passed through while paused': sum.notLogged } : {}),
    });
  } else {
    fillPairs($('#stats'), { Session: 'none yet: press Start' });
  }

  // Rules that took too long and were switched off for this session.
  const offBox = $('#switchedOff');
  offBox.textContent = '';
  for (const r of st.switchedOff || []) {
    offBox.append(el('div', {
      class: 'message bad',
      text: `Switched off this session: "${r.name}" (${r.group}) took over ${st.ruleTimeoutMs} ms. `
        + "Edit the rule's pattern, then save the rules to try it again.",
    }));
  }

  // How often each rule fired, most first.
  const byRuleBox = $('#byRule');
  byRuleBox.textContent = '';
  if (sum) {
    for (const [name, count] of Object.entries(sum.byRule).sort((a, b) => b[1] - a[1])) {
      byRuleBox.append(el('div', { text: `${count} × ${name}` }));
    }
  }
}


// ----------------------------------------------------------------------------
// 2b. Two popups: the thank-you note and the outside-address warning
// ----------------------------------------------------------------------------
// The thank-you note shows when the panel opens, until "Don't show this again" (saved as
// showThanks). It never blocks anything: ContextWeir keeps relaying behind it.
// The warning shows before chats go to a model server on another computer: when Start or Restart
// is refused for it, when ContextWeir opened straight into recording, and when the box is ticked.
// OK tells ContextWeir (remote-ok, for the saved address only); Cancel leaves it not recording.

let remoteAgreedInForm = null;   // { url, dontShowAgain } once the warning was accepted while ticking the box

// Show a dialog and wait until it closes. Resolves to the value the closing button gave.
function waitForDialog(dialog) {
  return new Promise(resolve => {
    dialog.returnValue = '';   // Escape closes without a value: that counts as Cancel
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

async function showThanks() {
  const about = await getJson('/api/about');
  $('#thanksTitle').textContent = `Thank you for using ${about.name}!`;
  const links = $('#thanksLinks');
  links.textContent = '';
  // Only places that exist are shown; a new one is a line in ABOUT.links on the server.
  const names = { github: 'GitHub', discord: 'Discord' };
  Object.entries(about.links || {}).filter(([, href]) => href).forEach(([key, href], i) => {
    if (i) links.append(' · ');
    links.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: names[key] || key }));
  });
  $('#thanksVersion').textContent = `${about.name} ${about.version}, built ${about.built} · by ${about.directedBy}, written with Claude (Anthropic)`;
  $('#thanksHide').checked = false;
  await waitForDialog($('#thanksDialog'));
  if ($('#thanksHide').checked) {
    const answer = await post('/api/settings', { settings: { showThanks: false } });
    if (answer.ok) settings = answer;
  }
}
$('#thanksClose').addEventListener('click', () => $('#thanksDialog').close('close'));

// The warning itself. Resolves to { dontShowAgain } for OK, or null for Cancel (or Escape).
async function showRemoteWarning(url) {
  $('#remoteUrlShown').textContent = url || '(the address you type below)';
  $('#remoteHttpLine').hidden = !/^http:/i.test(url || '');
  $('#remoteHide').checked = false;
  const answer = await waitForDialog($('#remoteDialog'));
  return answer === 'ok' ? { dontShowAgain: $('#remoteHide').checked } : null;
}
$('#remoteOk').addEventListener('click', () => $('#remoteDialog').close('ok'));
$('#remoteCancel').addEventListener('click', () => $('#remoteDialog').close('cancel'));

// Ask about the address ContextWeir has in use, and tell it the answer. start: also start recording.
async function askRemoteOk({ start }) {
  const url = status && status.remote && status.remote.url;
  if (!url) return false;
  if ($('#remoteDialog').open) return false;
  const choice = await showRemoteWarning(url);
  if (!choice) {
    banner('Not recording: the warning was cancelled. Untick "Allow a model server on another computer" on the '
      + 'Connection tab and press Restart to use this computer only.', 'warn');
    return false;
  }
  const answer = await post('/api/control', { action: 'remote-ok', url, dontShowAgain: choice.dontShowAgain, start });
  if (answer.error) banner(answer.error, 'bad');
  await loadSettings();
  await refreshStatus();
  return !answer.error;
}


// ----------------------------------------------------------------------------
// 3. The settings tabs
// ----------------------------------------------------------------------------
// Drawn from the field list ContextWeir sends (FIELDS in contextweir.js), so
// the panel and the checks on the other side always agree. Each form box on
// the page says which tab's fields it holds (data-form="connection" etc.).

async function loadSettings() {
  try { settings = await getJson('/api/settings'); } catch (_) { return; }
  drawForms();
}

// The input for one setting, by its type.
function fieldInput(f, value) {
  if (f.type === 'bool') return el('input', { type: 'checkbox', checked: !!value, 'data-key': f.key });
  if (f.type === 'choice') {
    return el('select', { 'data-key': f.key }, ...f.choices.map(choice => el('option', {
      value: choice,
      text: choice === '127.0.0.1' ? '127.0.0.1 (this computer)' : choice,
      selected: choice === value,
    })));
  }
  if (f.type === 'port' || f.type === 'int') {
    return el('input', {
      type: 'number', 'data-key': f.key, value: String(value), step: 1,
      min: f.type === 'port' ? 1024 : f.min,
      max: f.type === 'port' ? 65535 : f.max,
    });
  }
  if (f.type === 'url') {
    return el('input', {
      type: 'text', 'data-key': f.key, value: value || '', maxlength: 300, class: 'wide',
      placeholder: 'e.g. http://192.168.1.20:5001', spellcheck: 'false', autocomplete: 'off',
    });
  }
  return el('input', {
    type: 'text', 'data-key': f.key, value: value || '', maxlength: 400,
    placeholder: f.optional ? '(not set)' : '', spellcheck: 'false',
  });
}

// Read an input back as the right type (numbers stay text if they are not
// whole numbers, so ContextWeir can say what is wrong).
function readField(input, f) {
  if (f.type === 'bool') return input.checked;
  if (f.type === 'port' || f.type === 'int') {
    const n = Number(input.value);
    return Number.isInteger(n) ? n : input.value;
  }
  return input.value.trim();
}

function drawForms() {
  for (const box of document.querySelectorAll('[data-form]')) {
    const fields = settings.fields.filter(f => f.tab === box.dataset.form);
    box.textContent = '';

    const rows = fields.map(f => {
      const input = fieldInput(f, settings.saved[f.key]);
      const result = el('span', { class: 'result' });
      const extraButtons = [];
      if (f.key === 'relayPort') {
        extraButtons.push(el('button', { type: 'button', class: 'small', text: 'Check', onclick: () => checkPort(input, result) }));
      }
      if (f.key === 'targetPort') {
        extraButtons.push(el('button', { type: 'button', class: 'small', text: 'Test', onclick: () => testModel(box, result) }));
      }
      if (f.key === 'remoteUrl') {
        extraButtons.push(el('button', { type: 'button', class: 'small', text: 'Test', onclick: () => testRemote(box, result) }));
      }
      if (f.key === 'allowRemoteModel') {
        // Ticking it shows the warning at once; Cancel unticks it again.
        input.addEventListener('change', async () => {
          if (!input.checked || settings.saved.allowRemoteModel) return;
          const url = box.querySelector('[data-key="remoteUrl"]').value.trim();
          const choice = await showRemoteWarning(url);
          if (!choice) { input.checked = false; return; }
          remoteAgreedInForm = { ...choice, url };   // accepted for the address that was shown, no other
        });
      }
      const waitingForRestart = (settings.pendingRestart || []).includes(f.key);
      const appliesText = f.applies === 'now' ? 'applies now' : (waitingForRestart ? 'saved: waiting for Restart' : 'needs Restart');
      const appliesTitle = f.applies === 'now' ? 'The next turn uses it' : 'Press Restart (or Stop and Start) to use it';
      return el('div', { class: 'field' },
        el('label', { text: f.label }),
        el('div', { class: 'inputRow' }, input, ...extraButtons, result),
        el('span', { class: 'applies ' + f.applies, text: appliesText, title: appliesTitle }),
        el('div', { class: 'help', text: f.help }));
    });

    const problems = el('div', { class: 'message bad', hidden: true });
    const saveButton = el('button', { type: 'button', class: 'primary', text: 'Save', onclick: () => saveForm(box, fields, problems) });
    const undoButton = el('button', { type: 'button', text: 'Undo changes', onclick: () => drawForms() });
    box.append(...rows, problems, el('div', { class: 'buttons left' }, saveButton, undoButton));
    if (box.dataset.form === 'connection' && settings.saved.remoteWarningAcceptedFor) {
      // "Don't show this again" was ticked for one address: a way to see the warning again.
      box.append(el('div', { class: 'hint' },
        el('span', { text: `The outside-address warning is not shown again for ${settings.saved.remoteWarningAcceptedFor}. ` }),
        el('button', { type: 'button', class: 'small', text: 'Show it again', onclick: async () => {
          const answer = await post('/api/settings', { settings: { remoteWarningAcceptedFor: '' } });
          if (answer.ok) { settings = answer; drawForms(); }
        } })));
    }
    box.oninput = () => box.classList.add('dirty');
    box.classList.remove('dirty');
  }

  // The line under the Connection tab: what to type into the frontend.
  const portInUse = settings.inUse.relayPort;
  const savedPort = settings.saved.relayPort;
  $('#frontendHint').textContent = `In your frontend, set the API address to http://127.0.0.1:${savedPort}/v1 `
    + '(in SillyTavern: API Connections, Chat Completion, Custom (OpenAI-compatible)).'
    + (savedPort !== portInUse ? ` The port in use until Restart is ${portInUse}.` : '');
}

// Save one tab's fields. ContextWeir checks them all; any problem refuses the lot.
async function saveForm(box, fields, problems) {
  const changes = {};
  for (const f of fields) changes[f.key] = readField(box.querySelector(`[data-key="${f.key}"]`), f);
  const answer = await post('/api/settings', { settings: changes });
  if (!answer.ok) {
    problems.textContent = '';
    problems.append(...problemList(answer.error || 'Not saved.', answer.problems));
    problems.hidden = false;
    return;
  }
  settings = answer;
  // The warning was accepted when the box was ticked: tell ContextWeir, but only if the address
  // saved is the one the warning showed. Otherwise the warning comes again at Restart.
  if (remoteAgreedInForm && settings.saved.allowRemoteModel && settings.saved.remoteUrl
    && remoteAgreedInForm.url === settings.saved.remoteUrl) {
    await post('/api/control', { action: 'remote-ok', url: settings.saved.remoteUrl, dontShowAgain: remoteAgreedInForm.dontShowAgain, start: false });
    settings = await getJson('/api/settings');
  }
  remoteAgreedInForm = null;
  drawForms();
  await refreshStatus();   // shows "waiting for Restart" when a saved setting needs it
  const restartBarShowing = (answer.pendingRestart || []).length && status && status.relay;
  if (!restartBarShowing) {
    banner('Settings saved.');
    setTimeout(drawBanner, 2500);
  }
}

// The Check button beside the receiving port.
async function checkPort(input, result) {
  result.textContent = 'checking…';
  result.className = 'result';
  const answer = await post('/api/check-port', { port: Number(input.value) });
  result.textContent = answer.error || answer.text;
  result.className = 'result ' + (answer.result === 'free' || answer.result === 'this' ? 'good' : 'bad');
}

// The Test button beside the model server port.
async function testModel(box, result) {
  result.textContent = 'asking the model server…';
  result.className = 'result';
  const host = box.querySelector('[data-key="targetHost"]').value;
  const port = Number(box.querySelector('[data-key="targetPort"]').value);
  const answer = await post('/api/test-model', { host, port });
  if (answer.error && answer.reachable === undefined) {   // refused before asking (not this computer, bad port)
    result.textContent = answer.error;
    result.className = 'result bad';
    return;
  }
  result.textContent = answer.reachable
    ? 'answers: ' + modelServerLine(answer)
    : `no answer on ${host}:${port} (${answer.error || 'nothing there'}). Is KoboldCpp running?`;
  result.className = 'result ' + (answer.reachable ? 'good' : 'bad');
}

// The Test button beside the remote address: only the saved address, after its warning.
async function testRemote(box, result) {
  const url = box.querySelector('[data-key="remoteUrl"]').value.trim();
  if (!settings.saved.allowRemoteModel || url !== settings.saved.remoteUrl) {
    result.textContent = 'Tick "Allow…", save, then test.';
    result.className = 'result bad';
    return;
  }
  result.textContent = 'asking…';
  result.className = 'result';
  let answer = await post('/api/test-model', { url });
  if (answer.needsRemoteOk) {
    if (!(await askRemoteOk({ start: false }))) { result.textContent = 'not tested'; return; }
    answer = await post('/api/test-model', { url });
  }
  if (answer.error && answer.reachable === undefined) {
    result.textContent = answer.error;
    result.className = 'result bad';
    return;
  }
  const status401 = answer.status === 401 || answer.status === 403;
  result.textContent = answer.reachable
    ? `answers (HTTP ${answer.status})${status401 ? ': it wants an API key, which your frontend sends' : ''}`
    : `no answer (${answer.error || 'nothing there'})`;
  result.className = 'result ' + (answer.reachable ? 'good' : 'bad');
}

// The "Log folder now" box on the Logs tab.
async function refreshLogs() {
  try {
    const logs = await getJson('/api/logs');
    fillPairs($('#logsOverview'), { Folder: logs.folder, Sessions: logs.sessions, Size: formatBytes(logs.bytes) });
  } catch (_) { /* ContextWeir closed: leave the box as it was */ }
}


// ----------------------------------------------------------------------------
// 4. Tabs, and the header buttons
// ----------------------------------------------------------------------------

for (const button of document.querySelectorAll('#tabs button')) {
  button.addEventListener('click', () => showTab(button.dataset.tab));
}

function showTab(name) {
  for (const button of document.querySelectorAll('#tabs button')) button.classList.toggle('on', button.dataset.tab === name);
  for (const tab of document.querySelectorAll('.tab')) tab.hidden = tab.id !== 'tab-' + name;
  if (name === 'logs') refreshLogs();
}

$('#btnStart').addEventListener('click', () => control('start'));
$('#bigStart').addEventListener('click', () => control('start'));
$('#btnPause').addEventListener('click', () => control(status && status.state === 'paused' ? 'resume' : 'pause'));
$('#btnStop').addEventListener('click', () => control('stop'));
$('#btnRestart').addEventListener('click', () => control('restart'));
$('#btnQuit').addEventListener('click', () => control('quit'));

// "Skip this screen next time" on the start screen saves showStartScreen at once.
$('#skipScreen').addEventListener('change', async e => {
  const answer = await post('/api/settings', { settings: { showStartScreen: !e.target.checked } });
  if (!answer.ok) return;
  settings = answer;
  drawForms();
  banner(e.target.checked
    ? 'Next time ContextWeir starts recording at once (the panel still opens).'
    : 'The start screen will show next time.');
  setTimeout(drawBanner, 3000);
});


// ----------------------------------------------------------------------------
// 5. The rule sets
// ----------------------------------------------------------------------------
// Every change edits a copy of the whole rule set and saves it; ContextWeir
// checks the lot and the list is redrawn from what was saved.

function draw() {
  const box = $('#sets');
  box.textContent = '';
  if (rules.problems && rules.problems.length) message('Some rules in rules.json could not be used:', true, rules.problems);
  if (!rules.groups.length) box.append(el('p', { class: 'muted', text: 'No rule sets yet. Add one, or import a file.' }));

  rules.groups.forEach((group, gi) => {
    const head = el('div', { class: 'setHead' },
      el('input', {
        type: 'checkbox', checked: group.enabled, title: 'Switch the whole set on or off',
        onchange: e => {
          const changed = copy(rules.groups);
          changed[gi].enabled = e.target.checked;
          save(changed, `${group.name} ${e.target.checked ? 'on' : 'off'}.`);
        },
      }),
      el('span', { class: 'setName', text: group.name }),
      el('span', { class: 'count', text: `${group.rules.filter(r => r.enabled).length} of ${group.rules.length} on` }),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'icon', text: 'Rename', onclick: () => renameSet(gi) }),
      el('a', { class: 'button icon', href: '/api/rules/export?set=' + encodeURIComponent(group.name), download: true, text: 'Export' }),
      el('button', { type: 'button', class: 'icon danger', text: 'Delete set', onclick: () => deleteSet(gi) }),
    );

    const list = el('div', { class: 'rules' });
    group.rules.forEach((rule, ri) => {
      const exceptions = rule.unless && rule.unless.length
        ? `  (+${rule.unless.length} exception${rule.unless.length > 1 ? 's' : ''})` : '';
      list.append(el('div', { class: 'rule' + (rule.enabled ? '' : ' off'), title: rule.note || '' },
        el('input', {
          type: 'checkbox', checked: rule.enabled, title: 'Switch this rule on or off',
          onchange: e => {
            const changed = copy(rules.groups);
            changed[gi].rules[ri].enabled = e.target.checked;
            save(changed);
          },
        }),
        el('span', { class: 'sev ' + rule.severity, text: rule.severity }),
        el('span', { class: 'name', text: rule.name }),
        el('span', { class: 'test', text: describe(rule) + exceptions }),
        el('span', { class: 'acts' },
          el('button', { type: 'button', class: 'icon', text: 'Edit', onclick: () => editRule(gi, ri) }),
          el('button', { type: 'button', class: 'icon danger', text: 'Delete', onclick: () => deleteRule(gi, ri) })),
      ));
    });
    if (!group.rules.length) list.append(el('div', { class: 'emptySet', text: 'No rules in this set yet.' }));

    const foot = el('div', { class: 'setFoot' },
      el('button', { type: 'button', class: 'small', text: '+ Add rule', onclick: () => editRule(gi, -1) }));
    box.append(el('div', { class: 'set' + (group.enabled ? '' : ' off') }, head, list, foot));
  });
}

async function addSet() {
  const name = (prompt('Name for the new rule set:', 'My rules') || '').trim();
  if (!name) return;
  if (rules.groups.some(g => g.name === name)) return message(`There is already a set called "${name}".`, true);
  const changed = copy(rules.groups);
  changed.push({ name, enabled: true, rules: [] });
  await save(changed, `Set "${name}" added.`);
}

async function renameSet(gi) {
  const oldName = rules.groups[gi].name;
  const name = (prompt('New name for this set:', oldName) || '').trim();
  if (!name || name === oldName) return;
  if (rules.groups.some(g => g.name === name)) return message(`There is already a set called "${name}".`, true);
  const changed = copy(rules.groups);
  changed[gi].name = name;
  await save(changed, `Renamed to "${name}".`);
}

async function deleteSet(gi) {
  const group = rules.groups[gi];
  if (!confirm(`Delete the set "${group.name}" and its ${group.rules.length} rule(s)?\n`
    + '(Tip: export it first if you might want it back. The previous rules.json is also kept as rules.json.bak.)')) return;
  const changed = copy(rules.groups);
  changed.splice(gi, 1);
  await save(changed, `Set "${group.name}" deleted.`);
}

async function deleteRule(gi, ri) {
  const rule = rules.groups[gi].rules[ri];
  if (!confirm(`Delete the rule "${rule.name}"?`)) return;
  const changed = copy(rules.groups);
  changed[gi].rules.splice(ri, 1);
  await save(changed, `Rule "${rule.name}" deleted.`);
}


// ----------------------------------------------------------------------------
// 6. The rule editor (a dialog with dropdowns; patterns are the advanced option)
// ----------------------------------------------------------------------------

// One condition row: [what to check] [test] [value] (ignore case), with a
// remove button for exceptions. row.read() returns the condition as data.
function conditionRow(cond, removable) {
  const target = el('select', {}, ...Object.entries(TARGETS).map(([value, text]) =>
    el('option', { value, text, selected: value === cond.target })));
  const test = el('select', {}, ...Object.entries(TESTS).map(([value, text]) =>
    el('option', { value, text, selected: value === cond.test })));
  const value = el('input', { type: 'text', maxlength: 200, value: cond.value || '', placeholder: 'text to look for' });
  const caseBox = el('input', { type: 'checkbox', checked: (cond.flags || '').includes('i') });
  const caseLabel = el('label', { class: 'case', title: 'Patterns only; plain text tests always ignore case' }, caseBox, 'ignore case');

  // "ignore case" only means something for patterns (plain tests always ignore case).
  const isPattern = () => test.value.startsWith('regex');
  const syncCase = () => {
    caseLabel.hidden = !isPattern();
    value.placeholder = isPattern() ? 'pattern, e.g. ^\\s*OOC\\b' : 'text to look for';
  };
  test.addEventListener('change', syncCase);
  syncCase();

  const removeButton = removable
    ? el('button', { type: 'button', class: 'icon danger', text: '✕', title: 'Remove this exception', onclick: () => row.remove() })
    : el('span');
  const row = el('div', { class: 'cond' }, target, test, value, caseLabel, removeButton);
  row.read = () => ({
    target: target.value,
    test: test.value,
    value: value.value,
    ...(isPattern() && caseBox.checked ? { flags: 'i' } : {}),
  });
  return row;
}

let editing = null;   // which rule the dialog is editing: { gi, ri } (ri -1 = a new rule)

function editRule(gi, ri) {
  editing = { gi, ri };
  const isNew = ri < 0;
  const rule = isNew
    ? { name: '', severity: 'warning', target: 'reply', test: 'contains', value: '', note: '', unless: [] }
    : rules.groups[gi].rules[ri];

  $('#ruleTitle').textContent = `${isNew ? 'New rule' : 'Edit rule'} in "${rules.groups[gi].name}"`;
  $('#fName').value = rule.name;
  $('#fSeverity').value = rule.severity;
  $('#fNote').value = rule.note || '';
  $('#mainCond').replaceWith(Object.assign(conditionRow(rule, false), { id: 'mainCond' }));
  const unlessList = $('#unlessList');
  unlessList.textContent = '';
  for (const u of rule.unless || []) unlessList.append(conditionRow(u, true));
  $('#ruleProblems').hidden = true;
  $('#ruleDialog').showModal();
  $('#fName').focus();
}

$('#addUnless').addEventListener('click', () => {
  $('#unlessList').append(conditionRow({ target: 'lastMessage', test: 'startsWith', value: '' }, true));
});
$('#ruleCancel').addEventListener('click', () => $('#ruleDialog').close());

$('#ruleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { gi, ri } = editing;
  const rule = {
    name: $('#fName').value.trim(),
    enabled: ri >= 0 ? rules.groups[gi].rules[ri].enabled : true,
    severity: $('#fSeverity').value,
    ...$('#mainCond').read(),
    // Empty exception rows are dropped (except "does not match" with an empty pattern).
    unless: [...$('#unlessList').children].map(row => row.read()).filter(u => u.value !== '' || u.test === 'regexMissing'),
    note: $('#fNote').value.trim(),
  };

  const problemsBox = $('#ruleProblems');
  const nameClash = rules.groups[gi].rules.some((other, i) => i !== ri && other.name === rule.name);
  if (nameClash) {
    problemsBox.textContent = 'Another rule in this set already has that name.';
    problemsBox.hidden = false;
    return;
  }

  const changed = copy(rules.groups);
  if (ri >= 0) changed[gi].rules[ri] = rule;
  else changed[gi].rules.push(rule);
  const answer = await post('/api/rules', { groups: changed });
  if (!answer.ok) {
    problemsBox.textContent = '';
    problemsBox.append(...problemList(answer.error || 'Not saved.', answer.problems));
    problemsBox.hidden = false;
    return;
  }
  rules = answer;
  $('#ruleDialog').close();
  draw();
  message(`Rule "${rule.name}" saved.`);
});


// ----------------------------------------------------------------------------
// 7. Import (preview first, then merge or replace)
// ----------------------------------------------------------------------------
// The file is read in the page and sent to ContextWeir, which checks it and
// answers with a preview (nothing saved). Only "Import" in the dialog saves.

let pendingImport = null;   // the file's contents while the preview is open

$('#importBtn').addEventListener('click', () => {
  $('#importFile').value = '';
  $('#importFile').click();
});

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) return message('That file is larger than 1 MB; rule files are small.', true);
  let contents;
  try { contents = JSON.parse(await file.text()); } catch (_) { return message('That file is not valid JSON.', true); }

  const preview = await post('/api/rules/import', { file: contents, mode: 'merge' });
  if (!preview.ok) return message(preview.error || 'Could not read that file.', true);
  pendingImport = contents;

  const box = $('#importPreview');
  box.textContent = '';
  const ruleCount = preview.sets.reduce((sum, s) => sum + s.rules.length, 0);
  box.append(el('p', { text: `From "${file.name}": ${preview.sets.length} set(s), ${ruleCount} rule(s). `
    + 'Nothing in the file is run; it is only patterns and labels.' }));
  for (const set of preview.sets) {
    box.append(el('div', { class: 'previewSet' }, el('b', { text: set.name }),
      ...set.rules.map(r => el('div', { text: `${r.severity}: ${r.name} — ${describe(r)}` }))));
  }
  if (preview.problems.length) {
    box.append(el('div', { class: 'message bad' }, ...problemList('These parts will not be imported:', preview.problems)));
  }
  $('#importDialog').showModal();
});

$('#importCancel').addEventListener('click', () => {
  pendingImport = null;
  $('#importDialog').close();
});

$('#importConfirm').addEventListener('click', async () => {
  const mode = document.querySelector('input[name=importMode]:checked').value;
  if (mode === 'replace' && !confirm('Replace ALL your current rule sets with the imported ones? '
    + '(The previous rules.json is kept as rules.json.bak.)')) return;
  const answer = await post('/api/rules/import', { file: pendingImport, mode, confirm: true });
  $('#importDialog').close();
  pendingImport = null;
  if (!answer.ok) return message(answer.error || 'Import failed.', true);
  rules = answer.rules;
  draw();
  message(`Imported ${answer.sets.length} set(s) (${mode === 'replace' ? 'replaced your sets' : 'added beside yours'}).`);
});


// ----------------------------------------------------------------------------
// 7b. A setup file: settings and rule sets together (Advanced tab)
// ----------------------------------------------------------------------------
// Export is a plain download (folders only if ticked). Import reads the file in
// the page, asks ContextWeir for a preview (nothing saved), shows each setting
// that would change and the rule sets, then applies only what is ticked.

let pendingSetup = null;   // the file's contents while the preview is open

$('#setupFolders').addEventListener('change', e => {
  $('#setupExport').href = '/api/setup/export' + (e.target.checked ? '?folders=1' : '');
});

$('#setupImportBtn').addEventListener('click', () => {
  $('#setupFile').value = '';
  $('#setupFile').click();
});

// Ask for a preview with the choices as they are ticked now, and draw it.
async function previewSetup() {
  const answer = await post('/api/setup/import', setupChoices(false));
  const box = $('#setupPreview');
  box.textContent = '';
  if (!answer.ok) {
    box.append(el('div', { class: 'message bad', text: answer.error || 'Could not read that file.' }));
    $('#setupConfirm').disabled = true;
    return;
  }
  $('#setupConfirm').disabled = false;
  box.append(el('p', { class: 'muted small', text: `Made by ${answer.from || 'an unknown version'}${answer.exported ? ' on ' + new Date(answer.exported).toLocaleString() : ''}. `
    + 'Nothing in the file is run: it is only settings, patterns and labels.' }));

  const st = answer.settings;
  box.append(el('h4', { text: 'Settings' }));
  if (!st.changes.length) box.append(el('p', { class: 'muted', text: 'No setting would change.' }));
  else {
    box.append(el('table', { class: 'keys' },
      el('tr', {}, el('th', { text: 'Setting' }), el('th', { text: 'Now' }), el('th', { text: 'From the file' }), el('th', { text: '' })),
      ...st.changes.map(ch => el('tr', {},
        el('td', { text: ch.label }), el('td', { text: JSON.stringify(ch.from) }), el('td', { text: JSON.stringify(ch.to) }),
        el('td', { class: 'muted', text: ch.applies === 'now' ? 'applies now' : 'needs Restart' })))));
  }
  if (st.foldersInFile.length && !$('#setupApplyFolders').checked) {
    box.append(el('p', { class: 'muted small', text: `The file also has folder settings (${st.foldersInFile.join(', ')}); they are left out unless you tick "also the folder settings".` }));
  }
  if (st.problems.length) box.append(el('div', { class: 'message bad' }, ...problemList(st.usable ? 'Left out:' : 'These settings cannot be imported as they are:', st.problems)));

  box.append(el('h4', { text: 'Rule sets' }));
  if (!answer.rules.sets.length) box.append(el('p', { class: 'muted', text: 'The file has no rule sets.' }));
  for (const set of answer.rules.sets) {
    box.append(el('div', { class: 'previewSet' }, el('b', { text: `${set.name} (${set.rules.length} rules)` })));
  }
  if (answer.rules.problems.length) box.append(el('div', { class: 'message bad' }, ...problemList('These rules will not be imported:', answer.rules.problems)));
}

function setupChoices(confirm) {
  return {
    file: pendingSetup,
    applySettings: $('#setupApplySettings').checked,
    applyFolders: $('#setupApplyFolders').checked,
    rulesMode: document.querySelector('input[name=setupRules]:checked').value,
    confirm,
  };
}

$('#setupFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) return banner('That file is larger than 1 MB; setup files are small.', 'bad');
  try { pendingSetup = JSON.parse(await file.text()); } catch (_) { return banner('That file is not valid JSON.', 'bad'); }
  $('#setupApplySettings').checked = true;
  $('#setupApplyFolders').checked = false;
  document.querySelector('input[name=setupRules][value=merge]').checked = true;
  await previewSetup();
  $('#setupDialog').showModal();
});

// Changing a choice redraws the preview (folders in or out change the list).
for (const input of document.querySelectorAll('#setupDialog input')) input.addEventListener('change', previewSetup);

$('#setupCancel').addEventListener('click', () => { pendingSetup = null; $('#setupDialog').close(); });

$('#setupConfirm').addEventListener('click', async () => {
  const choices = setupChoices(true);
  if (choices.rulesMode === 'replace' && !confirm('Replace ALL your current rule sets with the ones in the file? '
    + '(The previous rules.json is kept as rules.json.bak.)')) return;
  const answer = await post('/api/setup/import', choices);
  if (!answer.ok) {
    const box = $('#setupPreview');
    box.prepend(el('div', { class: 'message bad' }, ...problemList(answer.error || 'Import failed.', answer.problems)));
    return;
  }
  $('#setupDialog').close();
  pendingSetup = null;
  settings = answer.settingsView;
  rules = answer.rulesView;
  drawForms();
  draw();
  await refreshStatus();
  if (!(settings.pendingRestart || []).length) {
    banner('Setup imported.');
    setTimeout(drawBanner, 3000);
  }
});


// ----------------------------------------------------------------------------
// 8. About and Help
// ----------------------------------------------------------------------------

$('#aboutBtn').addEventListener('click', async () => {
  const about = await getJson('/api/about');
  const rows = [
    ['Version', `${about.version} (${about.stage}), built ${about.built}`],
    ['What it does', about.purpose],
    ['Writes', about.writes.join('; ')],
    ['Works with', about.worksWith],
    ['Tested with', about.testedWith.join('; ')],
    ['Needs', about.needs],
    ['Written by', about.writtenBy.map(w => `${w.by} (versions ${w.versions})`).join('; ')],
    ['Directed by', about.directedBy],
    ['Credit', about.credit],
    ['Licence', about.licence],
    ['Privacy', about.privacy],
  ];
  const body = $('#aboutBody');
  body.textContent = '';
  body.append(el('div', { class: 'about' }, el('h3', { text: about.name }),
    el('dl', {}, ...rows.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]))));
  $('#aboutDialog').showModal();
});
$('#aboutClose').addEventListener('click', () => $('#aboutDialog').close());

// Help opens in a window of its own (the same help.html that ships in the folder). The page keeps
// hold of that window so it can close it when this window closes (or reloads).
// openHelp('CW-PORT-TAKEN') opens it at that error code's explanation.
let helpWindow = null;
function openHelp(anchor = '') {
  helpWindow = window.open('/help' + (anchor ? '#' + anchor : ''), 'help', 'width=920,height=900');
}
$('#helpBtn').addEventListener('click', () => openHelp());
function closeHelp() {
  try { if (helpWindow && !helpWindow.closed) helpWindow.close(); } catch (_) { /* already gone */ }
}
window.addEventListener('pagehide', closeHelp);

$('#addSet').addEventListener('click', addSet);


// ----------------------------------------------------------------------------
// 8b. The diagnostic report
// ----------------------------------------------------------------------------
// ContextWeir builds the report (no prompt, reply or lorebook text; folder
// paths shortened unless "full paths" is ticked). The page shows all of it
// first; "Save to a file" saves exactly the text on screen, from the page
// itself, so nothing leaves this computer.

let diagUrl = null;   // the saved file's address in this page (freed when replaced)

async function showDiagnostic() {
  const full = $('#diagFull').checked;
  let report;
  try {
    const res = await fetch('/api/diagnostic' + (full ? '?full=1' : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('not available');
    report = await res.json();
  } catch (_) {
    // A ContextWeir started before this version has no report yet (its page files were updated on disk).
    report = { text: 'This ContextWeir has no diagnostic report yet: it was started before the version that adds it. '
      + 'Quit and start it again, then try once more.' };
  }
  $('#diagText').textContent = report.text;
  if (diagUrl) URL.revokeObjectURL(diagUrl);
  diagUrl = URL.createObjectURL(new Blob([report.text], { type: 'text/plain' }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  $('#diagSave').href = diagUrl;
  $('#diagSave').download = `contextweir-diagnostic_${stamp}.txt`;
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
// 9. Window size on opening
// ----------------------------------------------------------------------------
// Browsers ignore the size the launcher asks for once they have remembered
// one, so the page sets its own size when a new window opens. Only in a
// window the launcher opened (it adds ?fit to the address), only once per
// window, so a size the user picks survives reloads. A browser ignores this
// in an ordinary tab.
(function sizeOnOpen() {
  try {
    if (!new URLSearchParams(location.search).has('fit') || sessionStorage.getItem('sized')) return;
    sessionStorage.setItem('sized', '1');
    const width = Math.min(920, screen.availWidth);
    const height = Math.min(660, screen.availHeight);
    window.resizeTo(width, height);
    window.moveTo(screen.availLeft + Math.round((screen.availWidth - width) / 2),
      screen.availTop + Math.round((screen.availHeight - height) / 2));
  } catch (_) { /* not allowed here: keep the browser's size */ }
})();


// ----------------------------------------------------------------------------
// 10. Keyboard shortcuts
// ----------------------------------------------------------------------------
// Alt+letter for the buttons, so nothing fires while typing. Stop and Quit
// have no shortcut, on purpose (they cut your frontend off).

const startShortcut = () => { if (status && !status.relay) control('start'); };
const pauseShortcut = () => { if (status && status.relay) control(status.state === 'paused' ? 'resume' : 'pause'); };
const restartShortcut = () => control('restart');

// [keys, what they do] as listed by the Keys button.
const KEYS = [
  ['Alt+S', 'Start recording'],
  ['Alt+P', 'Pause or resume logging'],
  ['Alt+R', 'Restart (apply saved settings, new session)'],
  ['Alt+1 … Alt+5', 'Status, Connection, Logs, Rules, Advanced tab'],
  ['?', 'This list'],
  ['Esc', 'Close a popup'],
];
const ALT_KEYS = { s: startShortcut, p: pauseShortcut, r: restartShortcut };
const TAB_ORDER = ['status', 'connection', 'logs', 'rules', 'advanced'];

function showKeys() {
  const table = $('#keysTable');
  table.textContent = '';
  for (const [keys, what] of KEYS) {
    table.append(el('tr', {}, el('td', {}, el('kbd', { text: keys })), el('td', { text: what })));
  }
  $('#keysDialog').showModal();
}
$('#keysBtn').addEventListener('click', showKeys);
$('#keysClose').addEventListener('click', () => $('#keysDialog').close());

document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;   // a popup has the keyboard
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const shortcut = ALT_KEYS[e.key.toLowerCase()];
    if (shortcut) { e.preventDefault(); shortcut(); return; }
    if (/^[1-5]$/.test(e.key)) { e.preventDefault(); showTab(TAB_ORDER[Number(e.key) - 1]); return; }
  }
  if (!typing && e.key === '?') { e.preventDefault(); showKeys(); }
});


// ----------------------------------------------------------------------------
// 11. Start-up: load the rules, the settings and the status, then keep the
//     status fresh every 3 seconds.
// ----------------------------------------------------------------------------

(async () => {
  try { rules = await getJson('/api/rules'); } catch (_) { /* drawn empty; the status line says why */ }
  draw();
  await loadSettings();
  await refreshStatus();
  setInterval(refreshStatus, 3000);
  // The thank-you note first, then (if ContextWeir tried to start and is waiting for it) the warning,
  // so the warning is the last thing read before recording starts.
  if (status && status.showThanks) await showThanks();
  if (status && status.remote && status.remote.warningNeeded && !status.relay && settings && !settings.saved.showStartScreen) {
    await askRemoteOk({ start: true });
  }
})();
