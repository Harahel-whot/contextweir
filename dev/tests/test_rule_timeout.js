// Test-only: a rule whose pattern runs for seconds must not freeze ContextWeir.
// It should be stopped at ruleTimeoutMs, named, switched off for the session,
// and the turn checked again without it; play is never delayed.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const W = path.join(T, 'timeout_work');
fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W);
const RULES = path.join(W, 'rules.json');
const base = JSON.parse(fs.readFileSync(H.CW_RULES, 'utf8'));
base.groups.push({ name: 'Hostile', enabled: true, rules: [
  { name: 'Slow pattern', severity: 'note', target: 'reply', test: 'regex', value: '(a|aa)+$' },
] });
fs.writeFileSync(RULES, JSON.stringify(base));
fs.writeFileSync(path.join(W, 'settings.json'), JSON.stringify({ relayPort: 6402, targetPort: 6401, logsDir: path.join(W, 'logs'), ruleTimeoutMs: 500, showStartScreen: false }));

let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (port, p, body, headers = {}) => new Promise(res => {
  const data = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, x => {
    const c = []; x.on('data', d => c.push(d)); x.on('end', () => res({ status: x.statusCode, text: Buffer.concat(c).toString() }));
  });
  r.end(data);
});
const records = () => { const d = fs.readdirSync(path.join(W, 'logs')).find(n => n.startsWith('session_')); return fs.readFileSync(path.join(W, 'logs', d, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); };

(async () => {
  const mock = spawn(process.execPath, [path.join(T, 'mock_model.js'), '6401']);
  const tool = await H.startTool(H.CW, { CW_SETTINGS: path.join(W, 'settings.json'), CW_RULES: RULES, CW_RUNNING: path.join(W, 'running.json') });
  const cw = tool.proc, UIP = tool.port;
  await H.waitFor(tool, /recording:/);

  // 1. the slow turn: the reply must come back at once
  let t = Date.now();
  let r = await post(6402, '/v1/chat/completions', { messages: [{ role: 'user', content: 'HEAVYREPLY please' }] });
  const replyMs = Date.now() - t;
  ok(r.status === 200 && replyMs < 400, 'the player gets the reply at once, while the slow rule is still running', replyMs + ' ms');

  // while the worker is stuck, the recorder still answers other requests
  t = Date.now();
  const st = await new Promise(res => http.get({ host: '127.0.0.1', port: UIP, path: '/api/status', headers: { host: `127.0.0.1:${UIP}` } }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res(b)); }));
  ok(Date.now() - t < 300 && st.includes('"requests"'), 'the window still answers while a rule is stuck', (Date.now() - t) + ' ms');

  await sleep(1600);
  let recs = records();
  const f = recs[0].flags.map(x => x.name);
  ok(f.some(n => /Rule switched off: "Slow pattern" took over 500 ms/.test(n)), 'the stuck rule is named in the turn\'s flags', f.join(' | ').slice(0, 120));
  ok(f.includes('No status line'), 'the turn is checked again without it, so the other rules still report');
  ok(/rule "Slow pattern" \(Hostile\) took over 500 ms and is switched off/.test(tool.out()), 'the console says which rule was switched off and why');

  // 2. the same turn again: the bad rule no longer runs, no new timeout
  t = Date.now();
  await post(6402, '/v1/chat/completions', { messages: [{ role: 'user', content: 'HEAVYREPLY again' }] });
  await sleep(700);
  recs = records();
  ok(recs.length === 2 && !recs[1].flags.some(x => /switched off/.test(x.name)) && recs[1].flags.some(x => x.name === 'No status line'), 'next turn: the bad rule stays off, the rest keep working', recs[1].flags.map(x => x.name).join(' | '));

  // 3. the window reports it; saving the rules gives it a fresh chance
  const st2 = JSON.parse(await new Promise(res => http.get({ host: '127.0.0.1', port: UIP, path: '/api/status', headers: { host: `127.0.0.1:${UIP}` } }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res(b)); })));
  ok(st2.switchedOff.length === 1 && st2.switchedOff[0].name === 'Slow pattern', 'the status window lists the switched-off rule');
  const groups = JSON.parse(fs.readFileSync(RULES, 'utf8')).groups;
  groups.find(g => g.name === 'Hostile').rules[0].value = 'a{3}!';     // the user fixes the pattern
  r = await post(UIP, '/api/rules', { groups }, { origin: `http://127.0.0.1:${UIP}` });
  const st3 = JSON.parse(await new Promise(res => http.get({ host: '127.0.0.1', port: UIP, path: '/api/status', headers: { host: `127.0.0.1:${UIP}` } }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res(b)); })));
  ok(r.status === 200 && st3.switchedOff.length === 0, 'after the user saves a fixed rule, nothing is switched off');
  await post(6402, '/v1/chat/completions', { messages: [{ role: 'user', content: 'HEAVYREPLY third' }] });
  await sleep(500);
  recs = records();
  ok(recs[2].flags.some(x => x.name === 'Slow pattern'), 'the fixed rule runs and fires again', recs[2].flags.map(x => x.name).join(' | '));

  cw.kill(); mock.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
