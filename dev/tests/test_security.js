// Test-only: the findings of the fresh security review (25 Nov), each replayed as an attack:
// F1  a GET for "//" (and friends) must not stop either tool; neither may a missing page file
// F2  a malformed relay request ({"messages":[null]}, content nested 200,000 deep) must not stop
//     ContextWeir, and turns after it are still recorded
// F3  rule and setup files with crafted values ({"toString":1}) are refused, not a crash: on
//     import, on setup import, at start-up and in --check-rules
// F4  PromptAssay's exact-text search finishes at once on entries full of macros
// F5  thousands of same-named lorebook entries load in a moment
// F6  JSON errors never put file text into the diagnostic report
// F7  every way of writing the home folder is shortened in the report
// F8  network paths and disguised program folders are refused as the log folder
// F10 requests a browser sends for another site (Sec-Fetch-Site) are refused by the panel and
//     PromptAssay, and an <img> aimed at the relay is refused
// F11 a rule named "constructor" is counted like any other
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'security_work');
const c = H.counter(), ok = c.ok;
const PORTS = { model: 7001, relay: 7002 };

// A raw request with an exact path (Node's http keeps "//" as it is).
function raw(port, pathName, headers = {}, method = 'GET', body) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end(body);
  });
}
const alive = async port => (await raw(port, '/api/about')).status === 200;

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(W, { recursive: true });
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  const started = [mock];
  process.on('exit', () => { for (const p of started) { try { p.kill(); } catch (_) { /* gone */ } } });
  await H.sleep(300);

  // ContextWeir with a rule named "constructor" (F11) and one that fires on every reply.
  const rulesFile = path.join(W, 'rules.json');
  fs.writeFileSync(rulesFile, JSON.stringify({ format: 'contextweir-rules', groups: [{ name: 'T', rules: [
    { name: 'constructor', target: 'reply', test: 'contains', value: 'Mock' },
  ] }] }));
  const settingsFile = path.join(W, 'cw.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: path.join(W, 'logs'), showStartScreen: false }));
  const cw = await H.startTool(H.CW, { CW_SETTINGS: settingsFile, CW_RULES: rulesFile, CW_RUNNING: path.join(W, 'cw_running.json') });
  started.push(cw.proc);
  await H.waitFor(cw, /recording:/);
  const P = cw.port;

  // F1
  for (const bad of ['//', '///', '/\\', '//@']) await raw(P, bad);
  ok(await alive(P), 'F1 ContextWeir panel: "//", "///", "/\\" and "//@" answered, still running');
  const r404 = await raw(P, '//');
  ok(r404.status === 400, 'F1 the panel answers 400 to "//"', r404.status);
  await raw(PORTS.relay, '//');
  ok((await raw(PORTS.relay, '/v1/models')).status === 200, 'F1 the relay survives "//" too');

  // F10
  const crossImg = await raw(P, '/api/diagnostic', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' });
  ok(crossImg.status === 403, 'F10 panel: a request sent for another site is refused', crossImg.status);
  ok((await raw(P, '/api/status', { 'sec-fetch-site': 'same-origin' })).status === 200, 'F10 panel: its own page (same-origin) still works');
  ok((await raw(PORTS.relay, '/v1/models', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' })).status === 403,
    'F10 relay: an <img> from another site is refused');

  // F2
  const post = body => raw(PORTS.relay, '/v1/chat/completions', { 'content-type': 'application/json' }, 'POST', body);
  await post('{"messages":[null]}');
  await post('{"messages":[{"role":"user","content":' + '['.repeat(200000) + ']'.repeat(200000) + '}]}');
  await H.sleep(800);
  ok(await alive(P), 'F2 malformed and 200,000-deep requests: ContextWeir still running');
  // (The stand-in model itself falls over on those two requests, which ContextWeir passes on
  // unchanged; start a fresh one for the real turn.)
  const mock2 = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  started.push(mock2);
  await H.sleep(400);
  const good = await post(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'still here?' }] }));
  await H.sleep(800);
  const records = fs.readFileSync(path.join(W, 'logs', fs.readdirSync(path.join(W, 'logs'))[0], 'records.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  ok(good.status === 200 && records.some(r => r.reply.includes('still here?')), 'F2 the next real turn is recorded', `${records.length} records`);

  // F11
  const st = (await H.request({ port: P, pathName: '/api/status' })).json;
  ok(st.summary.byRule.constructor === records.filter(r => r.flags.length).length && typeof st.summary.byRule.constructor === 'number',
    'F11 a rule named "constructor" is counted like any other', JSON.stringify(st.summary.byRule));

  // F3: import and setup import with crafted values: refused (or listed as problems), never a crash
  const crafted = { toString: 1 };
  let r = await H.panelPost(P, '/api/rules/import', { file: { format: 'contextweir-rules', groups: [{ name: 'X', rules: [{ name: crafted, target: 'reply', test: 'contains', value: 'x' }] }] } });
  ok(r.status === 200 && r.json.problems.length === 1 && await alive(P), 'F3 rule import, a crafted rule name: listed as a problem, still running');
  r = await H.panelPost(P, '/api/setup/import', { file: { format: 'contextweir-setup', settings: { targetHost: crafted }, rules: { format: 'contextweir-rules', groups: [{ name: 'Y', rules: [{ name: 'a', target: crafted, test: 'contains', value: 'x' }] }] } } });
  ok(r.status === 200 && !r.json.settings.usable && r.json.rules.problems.length === 1 && await alive(P), 'F3 setup import, crafted host and target: refused, still running');
  r = await H.panelPost(P, '/api/setup/import', { file: { format: 'contextweir-setup', settings: { targetHost: crafted }, rules: null }, confirm: true });
  ok(r.status === 400 && await alive(P), 'F3 and confirming it is refused');

  // F8
  for (const [logsDir, what] of [['\\\\evil-host\\share\\logs', 'a UNC path'], ['//evil-host/share/logs', 'a // path'], [path.join(H.TOOLS, 'contextweir', 'lib') + '.', 'lib. (trailing dot)']]) {
    r = await H.panelPost(P, '/api/settings', { settings: { logsDir } });
    ok(r.status === 400, `F8 log folder refused: ${what}`, (r.json.problems || []).join('; '));
  }
  if (process.platform !== 'linux') {
    r = await H.panelPost(P, '/api/settings', { settings: { logsDir: path.join(H.TOOLS, 'contextweir', 'LIB') } });
    ok(r.status === 400, 'F8 log folder refused: LIB (another case)');
  }

  // F6 and F7 in ContextWeir's report: a broken rules.json read at start-up must not quote itself.
  const secret = 'GLASSWRIGHT-0042';
  const brokenRules = path.join(W, 'broken_rules.json');
  fs.writeFileSync(brokenRules, `{ "format": "contextweir-rules", "groups": [ ${secret} ] }`);
  cw.proc.kill();
  const settings2 = path.join(W, 'cw2.json');
  fs.writeFileSync(settings2, JSON.stringify({ relayPort: PORTS.relay + 10, targetPort: PORTS.model, logsDir: path.join(W, 'logs2') }));
  const cw2 = await H.startTool(H.CW, { CW_SETTINGS: settings2, CW_RULES: brokenRules, CW_RUNNING: path.join(W, 'cw2_running.json') });
  started.push(cw2.proc);
  const report = (await H.request({ port: cw2.port, pathName: '/api/diagnostic' })).json.text;
  ok(/CW-RULES-BAD-JSON/.test(report) && !report.includes(secret), 'F6 a broken rules.json: its code in the report, its text not');
  cw2.proc.kill();

  // F3 at start-up and in the checker
  const craftedFile = path.join(W, 'crafted_rules.json');
  fs.writeFileSync(craftedFile, JSON.stringify({ format: 'contextweir-rules', groups: [{ name: 'Z', rules: [{ name: crafted, target: crafted, test: 'contains', value: 'x' }] }] }));
  const chk = spawnSync(process.execPath, [H.CW, '--check-rules', craftedFile], { encoding: 'utf8' });
  ok(chk.status === 1 && /PROBLEM/.test(chk.stdout) && !/at .*\.js:\d+/.test(chk.stdout + chk.stderr), 'F3 --check-rules on crafted values: exit 1 with problems, no stack trace', chk.status);
  const craftedSettings = path.join(W, 'crafted_settings.json');
  fs.writeFileSync(craftedSettings, JSON.stringify({ targetHost: crafted }));
  const start = spawnSync(process.execPath, [H.CW], { encoding: 'utf8', timeout: 8000, env: { ...process.env, CW_SETTINGS: craftedSettings, CW_RULES: craftedFile, CW_RUNNING: path.join(W, 'r3.json') } });
  ok(start.status === 1 && /CW-SETTINGS-PROBLEMS/.test(start.stderr) && !/TypeError/.test(start.stderr), 'F3 crafted settings at start-up: a plain refusal with its code, no stack trace');

  // F7
  const { shortenPaths } = require(path.join(H.TOOLS, 'contextweir', 'lib', 'diagnostics.js'));
  const forms = ['"C:\\\\Users\\\\Alice Smith\\\\logs"', 'C:/Users/Bob/logs', 'c:\\users\\eve\\logs', `${require('os').homedir()}/x`];
  const leaked = forms.map(f => shortenPaths(f)).filter(f => /Alice|Smith|Bob|eve|\/root|\/home\/[a-z]/.test(f));
  ok(leaked.length === 0, 'F7 the home folder is shortened however it is written', leaked.join(' | ') || 'all shortened');

  // --- PromptAssay ---------------------------------------------------------------------
  // F4 and F5: a lorebook with 4,000 same-named entries and entries full of macros, against a
  // session whose prompt holds the long stretch but a different ending (the slow case).
  const worlds = path.join(W, 'worlds');
  const logs = path.join(W, 'palogs', 'session_2026-01-02T00-00-00-000Z');
  fs.mkdirSync(worlds, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  const sentence = 'The harbour lamps were lit one by one along the black water, and nobody spoke for a long while.';
  const entries = {};
  for (let i = 0; i < 4000; i++) entries[i] = { uid: i, comment: 'Same name', content: `Entry number ${i} of a very long and repetitive lorebook used for timing.` };
  entries[4000] = { uid: 4000, comment: 'Many macros', content: `{{char}} {{char}} {{char}} {{char}} ${sentence} {{user}} ends here.` };
  entries[4001] = { uid: 4001, comment: 'Two macros', content: `{{user}} met {{char}} at the quay. ${sentence} Then {{user}} went home.` };
  fs.writeFileSync(path.join(worlds, 'Big.json'), JSON.stringify({ entries }));
  const prompt = `Wren Wren Wren Wren ${sentence} Odile ends differently.\n\nWren met Odile at the quay. ${sentence} Then Wren went home.`;
  fs.writeFileSync(path.join(logs, 'records.jsonl'), JSON.stringify({ format: 'contextweir-log', version: 1, n: 1, time: new Date().toISOString(),
    request: { model: 'm', messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'hi' }] }, reply: 'ok', flags: [] }) + '\n');
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [path.join(W, 'palogs')], worldsDir: worlds, showDemo: false }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  started.push(pa.proc);
  const Q = pa.port;
  let t0 = Date.now();
  const list = (await H.request({ port: Q, pathName: '/api/sessions' })).json;
  ok(Date.now() - t0 < 5000 && list.labelling.items === 4002, 'F5 4,000 same-named entries load in a moment', `${Date.now() - t0} ms, ${list.labelling.items} pieces`);
  t0 = Date.now();
  const d = (await H.request({ port: Q, pathName: `/api/record?id=${encodeURIComponent(list.sessions[0].id)}&n=1` })).json;
  const ms = Date.now() - t0;
  const two = d.sections[0].contains.find(x => x.label === 'Big: Two macros');
  ok(ms < 3000, 'F4 entries full of macros: the request opens at once', `${ms} ms`);
  ok(two && two.span && d.sections[0].text.slice(two.span.start, two.span.end) === `Wren met Odile at the quay. ${sentence} Then Wren went home.`,
    'F4 and an entry with macros is still cut out exactly (macros filled in)');

  // F1, F10, F13 on PromptAssay
  for (const bad of ['//', '///', '/\\', '//@']) await raw(Q, bad);
  ok(await alive(Q), 'F1 PromptAssay: "//" and friends answered, still running');
  ok((await raw(Q, '/api/sessions', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' })).status === 403, 'F10 PromptAssay: a request sent for another site is refused');
  ok((await raw(Q, '/api/sessions', { 'sec-fetch-site': 'same-origin' })).status === 200, 'F10 PromptAssay: its own page still works');

  // F6 in PromptAssay: a broken lorebook does not put its text into the report.
  fs.writeFileSync(path.join(worlds, 'Broken.json'), `{ "entries": { "0": { "content": Mara Venn ${secret} } } }`);
  await H.request({ port: Q, pathName: '/api/sessions' });
  const paReport = (await H.request({ port: Q, pathName: '/api/diagnostic' })).json.text;
  ok(/PA-LABEL-FILE/.test(paReport) && !paReport.includes(secret) && !paReport.includes('Mara Venn'), 'F6 a broken lorebook: its code in the report, its text not');
  pa.proc.kill();

  mock.kill();
  c.done('security findings');
  process.exit();
})();
