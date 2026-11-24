// Test-only: error codes and the diagnostic report, in both tools.
// ContextWeir: codes appear in the console, the frontend's error, the panel's status and the
// report (a bad rule, a wrong SillyTavern folder, a foreign Host, a dead model server, a taken
// port, a broken settings.json at start-up). The report holds no prompt or reply text (a secret
// word sent in a prompt, matched by a rule, and echoed in the reply never appears), shortens
// paths unless asked, and is shown and saved byte for byte from the panel (headless Chrome).
// PromptAssay: a missing log folder, a vanished session and a write attempt get their codes; its
// report holds no prompt text; the Report button shows it. Both: every code the source uses is
// in the code list, and every code in the list has a row in help.html.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'diag_work');
const c = H.counter(), ok = c.ok;
const PORTS = { model: 6801, relay: 6802, dead: 6809, debug: 9341 };
const SECRET = 'ZEPHYRQUILL-7731';   // a word that must never reach a report

const relayPost = (port, body, headers = {}) =>
  H.request({ port, method: 'POST', pathName: '/v1/chat/completions', body, headers: { host: `127.0.0.1:${port}`, ...headers } });
const chat = text => ({ model: 'test', messages: [{ role: 'system', content: `Remember the word ${SECRET}.` }, { role: 'user', content: text }] });

// Every code a source file mentions, e.g. 'CW-PORT-TAKEN'.
const codesIn = (file, prefix) => [...new Set((fs.readFileSync(file, 'utf8').match(new RegExp(`'(${prefix}-[A-Z-]+)'`, 'g')) || []).map(s => s.slice(1, -1)))];

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(W, { recursive: true });

  // --- the code lists, the source and the help pages agree -------------------------
  for (const [tool, prefix] of [['contextweir', 'CW'], ['promptassay', 'PA']]) {
    const { CODES } = require(path.join(H.TOOLS, tool, 'lib', 'error_codes.js'));
    const used = [tool + '.js', 'ui/' + (tool === 'contextweir' ? 'ui.js' : 'app.js')]
      .flatMap(f => codesIn(path.join(H.TOOLS, tool, f), prefix));
    const missing = used.filter(code => !CODES[code]);
    ok(missing.length === 0, `${tool}: every code used in the source is in error_codes.js`, missing.join(', ') || `${used.length} used`);
    const help = fs.readFileSync(path.join(H.TOOLS, tool, 'help.html'), 'utf8');
    const notInHelp = Object.keys(CODES).filter(code => !help.includes(`<tr id="${code}">`));
    ok(notInHelp.length === 0, `${tool}: every code has a row in help.html`, notInHelp.join(', ') || `${Object.keys(CODES).length} codes`);
    ok(Object.values(CODES).every(x => x.title && x.means && x.fix), `${tool}: every code has a title, a meaning and a fix`);
  }

  // --- ContextWeir: a broken settings.json stops it with its code -------------------
  fs.writeFileSync(path.join(W, 'broken.json'), '{ "relayPort": 6802,, }');
  const broken = spawnSync(process.execPath, [H.CW], {
    env: { ...process.env, CW_SETTINGS: path.join(W, 'broken.json'), CW_RUNNING: path.join(W, 'r0.json') }, encoding: 'utf8', timeout: 10000,
  });
  ok(broken.status === 1 && /CW-SETTINGS-BAD-JSON/.test(broken.stderr), 'broken settings.json: stops with CW-SETTINGS-BAD-JSON', broken.status);

  // --- ContextWeir running: problems get codes ----------------------------------------
  const rulesFile = path.join(W, 'rules.json');
  fs.writeFileSync(rulesFile, JSON.stringify({
    format: 'contextweir-rules', groups: [{ name: 'Test', rules: [
      { name: 'Secret in prompt', target: 'prompt', test: 'contains', value: SECRET, severity: 'serious' },
      { name: 'Broken pattern', target: 'reply', test: 'regex', value: `(${SECRET}` },
    ] }],
  }));
  const settingsFile = path.join(W, 'cw.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: path.join(W, 'logs'),
    sillyTavernDir: W,                     // no package.json there: left out with a code
    showStartScreen: false,
  }));
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  await H.sleep(400);
  const cw = await H.startTool(H.CW, { CW_SETTINGS: settingsFile, CW_RULES: rulesFile, CW_RUNNING: path.join(W, 'cw_running.json') });
  await H.waitFor(cw, /recording:/);
  ok(/CW-SILLYTAVERN-FOLDER/.test(cw.out()), 'console: the wrong SillyTavern folder is noted with its code');

  let r = await relayPost(PORTS.relay, chat(`Say ${SECRET} back to me.`));
  ok(r.status === 200 && r.body.includes(SECRET), 'a turn with the secret word passes through (the mock echoes it)');
  r = await relayPost(PORTS.relay, chat('hello'), { host: `evil.example:${PORTS.relay}` });
  ok(r.status === 403 && /CW-REFUSED-HOST/.test(r.body), 'foreign Host: refused with CW-REFUSED-HOST in the message', r.body.trim());

  mock.kill();
  await H.sleep(300);
  r = await relayPost(PORTS.relay, chat('anyone there?'));
  ok(r.status === 502 && /CW-MODEL-UNREACHABLE/.test(r.body), 'model server gone: the frontend gets CW-MODEL-UNREACHABLE', r.body.trim());
  await H.sleep(500);

  const P = cw.port;
  const errors = (await H.request({ port: P, pathName: '/api/errors' })).json;
  const recent = errors.recent.map(p => p.code);
  ok(['CW-RULES-PROBLEMS', 'CW-SILLYTAVERN-FOLDER', 'CW-REFUSED-HOST', 'CW-MODEL-UNREACHABLE'].every(x => recent.includes(x)),
    '/api/errors lists the codes and the recent problems', recent.join(', '));

  const report = (await H.request({ port: P, pathName: '/api/diagnostic' })).json.text;
  ok(/ContextWeir DIAGNOSTIC REPORT/.test(report) && /Node\.js/.test(report) && /Operating system/.test(report),
    'report: title, Node.js and operating system');
  ok(['CW-RULES-PROBLEMS', 'CW-REFUSED-HOST', 'CW-MODEL-UNREACHABLE'].every(x => report.includes(x)), 'report: recent problems with their codes');
  ok(/SETTINGS IN USE/.test(report) && /relayPort\s+6802/.test(report), 'report: the settings in use');
  ok(/Flags by rule\s+Secret in prompt x1/.test(report), 'report: the session numbers (rule names and counts only)');
  ok(!report.includes(SECRET), 'report: NO prompt or reply text, not even the secret word inside a rule pattern or error');
  ok(!report.includes(os.homedir()) && report.includes('<home>'), 'report: folder paths shortened to <home>');
  const fullReport = (await H.request({ port: P, pathName: '/api/diagnostic?full=1' })).json.text;
  ok(fullReport.includes(H.TOOLS) && !fullReport.includes(SECRET), 'full paths when asked (and still no secret word)');
  const consoleBit = report.split('RECENT CONSOLE LINES')[1] || '';
  ok(/recording: frontend/.test(consoleBit), 'report: recent console lines');

  // A taken port: the code reaches the panel's status.
  await H.panelPost(P, '/api/control', { action: 'stop' });
  const blocker = net.createServer().listen(PORTS.relay, '127.0.0.1');
  await H.sleep(200);
  r = await H.panelPost(P, '/api/control', { action: 'start' });
  ok(r.status === 409 && r.json.lastErrorCode === 'CW-PORT-TAKEN' && /CW-PORT-TAKEN/.test(r.json.lastError),
    'taken port: status carries lastErrorCode CW-PORT-TAKEN', r.json && r.json.lastErrorCode);

  // The panel: the red bar's explain button, and the report dialog (shown, then saved byte for byte).
  const b = await H.browser(PORTS.debug, W, '1100,800');
  const downloads = path.join(W, 'downloads');
  fs.mkdirSync(downloads);
  await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${P}/panel` });
  await H.sleep(1500);
  ok(await b.js(`return [...document.querySelectorAll('#banner button')].some(x => x.textContent === 'What does this mean?')`),
    'panel: the red bar offers "What does this mean?"');
  await b.js(`document.querySelector('#diagBtn').click()`);
  await H.sleep(800);
  const shown = await b.js(`return document.querySelector('#diagDialog').open && document.querySelector('#diagText').textContent`);
  ok(typeof shown === 'string' && /DIAGNOSTIC REPORT/.test(shown) && !shown.includes(SECRET), 'panel: the dialog shows the whole report before saving');
  await b.js(`document.querySelector('#diagSave').click()`);
  let saved = null;
  for (let i = 0; i < 30 && !saved; i++) {
    await H.sleep(200);
    const f = fs.readdirSync(downloads).find(n => /^contextweir-diagnostic_.*\.txt$/.test(n));
    if (f) saved = fs.readFileSync(path.join(downloads, f), 'utf8');
  }
  ok(saved === shown, 'panel: "Save to a file" saves exactly the text shown', saved ? `${saved.length} chars` : 'no file');
  await b.js(`document.querySelector('#diagFull').click()`);
  await H.sleep(800);
  ok((await b.js(`return document.querySelector('#diagText').textContent`)).includes(H.TOOLS), 'panel: "Show full folder paths" shows them');
  ok(b.problems.length === 0, 'panel: no script errors or CSP violations', b.problems.join(' | '));
  b.close();
  blocker.close();
  cw.proc.kill();

  // --- PromptAssay -----------------------------------------------------------------
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({
    logDirs: [H.OLD_LOGS, path.join(W, 'no-such-folder')], worldsDir: H.WORLDS, charactersDir: H.CHARACTERS,
  }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  const Q = pa.port;
  const list = (await H.request({ port: Q, pathName: '/api/sessions' })).json;
  r = await H.request({ port: Q, pathName: '/api/session?id=9:session_gone' });
  ok(r.status === 404 && r.json.code === 'PA-SESSION-GONE', 'PromptAssay: a vanished session answers PA-SESSION-GONE', r.json && r.json.code);
  r = await H.request({ port: Q, method: 'POST', pathName: '/api/sessions', body: {} });
  ok(r.status === 405 && r.json.code === 'PA-READ-ONLY', 'PromptAssay: a write attempt answers PA-READ-ONLY', r.status);

  // A distinctive piece of a real prompt from the staged log: it must not reach the report.
  const firstTurn = fs.readdirSync(H.TURNS).sort()[0];
  const turnMsgs = JSON.parse(fs.readFileSync(path.join(H.TURNS, firstTurn), 'utf8')).request.messages;
  const promptBit = String(turnMsgs[turnMsgs.length - 1].content).trim().slice(0, 40);
  // Open a record first, so the report is made after real prompt text has passed through PromptAssay.
  await H.request({ port: Q, pathName: `/api/record?id=${encodeURIComponent(list.sessions[0].id)}&n=2656` });
  const paReport = (await H.request({ port: Q, pathName: '/api/diagnostic' })).json.text;
  ok(/PromptAssay DIAGNOSTIC REPORT/.test(paReport) && /PA-LOG-FOLDER/.test(paReport) && /PA-SESSION-GONE/.test(paReport),
    'PromptAssay report: the missing folder and the vanished session, with codes');
  ok(/Pieces found\s+\d+ \(\d+ lorebook entries, \d+ card fields\)/.test(paReport), 'PromptAssay report: labelling counts');
  ok(promptBit.length > 20 && !paReport.includes(promptBit), 'PromptAssay report: no prompt text', promptBit.slice(0, 20) + '…');
  ok(!paReport.includes(os.homedir()), 'PromptAssay report: paths shortened');

  const b2 = await H.browser(PORTS.debug + 1, path.join(W, 'b2'), '1300,850');
  await b2.send('Page.navigate', { url: `http://127.0.0.1:${Q}/` });
  await H.sleep(2000);
  await b2.js(`document.querySelector('#diagBtn').click()`);
  await H.sleep(800);
  ok(/PromptAssay DIAGNOSTIC REPORT/.test(await b2.js(`return document.querySelector('#diagText').textContent`)),
    'PromptAssay: the Report button shows the report');
  ok(b2.problems.length === 0, 'PromptAssay: no script errors or CSP violations', b2.problems.join(' | '));
  b2.close();
  pa.proc.kill();

  c.done('diagnostics');
  process.exit();
})();
