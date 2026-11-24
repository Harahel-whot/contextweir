// Test-only: the recorder itself (20 checks). Starts ContextWeir with its start screen
// skipped, in front of mock_model.js, and replays 33 real requests from the 20 Nov run
// (half of them streamed). Checks: each request and reply saved byte for byte, swipes
// marked, a foreign Host and a web page Origin refused, an oversized request refused, a
// silent model timed out (504), an empty reply flagged serious, summary.json numbers,
// a broken rule file refused rule by rule, a model host on another machine refused.
// Its logs (cwlogs\) are read by the PromptAssay suites that run after it.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const CW = H.CW;
const TURNS = process.argv[2] || H.TURNS;
const LOGS = path.join(T, 'cwlogs');
const SETTINGS = path.join(T, 'cw_settings.json');
const RULES = H.CW_RULES;

fs.rmSync(LOGS, { recursive: true, force: true });
fs.writeFileSync(SETTINGS, JSON.stringify({ relayPort: 6002, targetPort: 6001, logsDir: LOGS, keepSessions: 2, upstreamTimeoutSec: 2, maxRequestMB: 1, showStartScreen: false }));

let pass = 0, failN = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : failN++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function request({ port = 6002, method = 'POST', pathName = '/v1/chat/completions', headers = {}, body = '' }) {
  return new Promise(resolve => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: { host: `localhost:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, res => {
      const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8'), headers: res.headers }));
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    r.end(data);
  });
}

function startCW(env = {}) {
  const p = spawn(process.execPath, [CW], { env: { ...process.env, CW_SETTINGS: SETTINGS, CW_RULES: RULES, CW_RUNNING: path.join(T, 'cw_running.json'), ...env } });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.output = () => out;
  p.uiPort = () => Number((out.match(/window:\s+http:\/\/127\.0\.0\.1:(\d+)/) || [])[1]);
  return p;
}

(async () => {
  const mock = spawn(process.execPath, [path.join(T, 'mock_model.js'), '6001', TURNS]);
  await sleep(600);

  // three starts in a row: keepSessions = 2 should leave two folders
  for (let i = 0; i < 2; i++) { const p = startCW(); await sleep(400); p.kill(); await sleep(150); }
  const cw = startCW();
  await sleep(500);
  ok(fs.readdirSync(LOGS).filter(n => n.startsWith('session_')).length === 2, 'old sessions pruned to keepSessions (2)');

  // replay real requests, alternating streamed and plain
  const files = fs.readdirSync(TURNS).sort();
  let sent = 0, sameText = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(TURNS, f), 'utf8'));
    const body = { ...d.request, stream: sent % 2 === 0 };
    const r = await request({ body });
    sent++;
    if (r.status === 200) sameText++;
  }
  ok(sameText === files.length, `${files.length} real requests relayed (half streamed)`, `${sameText} ok`);
  await sleep(300);

  const session = fs.readdirSync(LOGS).filter(n => n.startsWith('session_')).sort().pop();
  const recs = fs.readFileSync(path.join(LOGS, session, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  ok(recs.length === files.length, 'one record per request', `${recs.length}`);
  let exact = 0;
  files.forEach((f, i) => {
    const d = JSON.parse(fs.readFileSync(path.join(TURNS, f), 'utf8'));
    if (recs[i] && recs[i].reply === d.reply && JSON.stringify(recs[i].request.messages) === JSON.stringify(d.request.messages)) exact++;
  });
  ok(exact === files.length, 'requests and replies saved exactly (streamed and plain)', `${exact}/${files.length}`);
  ok(recs.every(r => r.format === 'contextweir-log' && r.version === 1), 'records carry the log format and version');
  ok(!JSON.stringify(recs).includes('"content-type"'), 'no request headers in the log');
  const flagged = recs.filter(r => r.flags.length);
  console.log('      flags seen:', [...new Set(recs.flatMap(r => r.flags.map(f => f.name)))].join('; ') || 'none');

  // swipe: send the last request again
  const lastReq = JSON.parse(fs.readFileSync(path.join(TURNS, files[files.length - 1]), 'utf8')).request;
  await request({ body: lastReq });
  await sleep(200);
  const recs2 = fs.readFileSync(path.join(LOGS, session, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  ok(recs2[recs2.length - 1].swipe === true, 'a repeated request is marked as a swipe');

  // security checks
  let r = await request({ headers: { host: 'evil.example:6002' }, body: lastReq });
  ok(r.status === 403, 'relay refuses a foreign Host header', r.status);
  r = await request({ headers: { origin: 'https://evil.example' }, body: lastReq });
  ok(r.status === 403, 'relay refuses a request from a web page (Origin)', r.status);
  r = await request({ body: 'x'.repeat(1.5 * 1024 * 1024) });
  ok(r.status === 413 || r.status === 0, 'relay refuses a request over maxRequestMB', r.status);
  const t0 = Date.now();
  r = await request({ body: { messages: [{ role: 'user', content: 'SLOW please' }] } });
  ok(r.status === 504 && Date.now() - t0 < 4000, 'silent model times out with 504', `${r.status} after ${Date.now() - t0} ms`);
  r = await request({ body: { messages: [{ role: 'user', content: 'EMPTY please' }] } });
  await sleep(200);
  const lastRec = fs.readFileSync(path.join(LOGS, session, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  ok(lastRec.flags.some(f => f.name === 'Empty reply' && f.severity === 'serious'), 'empty reply flagged as serious');

  // status window (its port is read from the console line)
  const UI = cw.uiPort();
  r = await request({ port: UI, method: 'GET', pathName: '/api/status' });
  const st = JSON.parse(r.body);
  ok(r.status === 200 && st.summary.requests >= files.length, 'status window reports the session', `${st.summary.requests} requests`);
  ok(/default-src 'none'/.test(r.headers['content-security-policy'] || ''), 'status window sends a strict Content-Security-Policy');
  r = await request({ port: UI, method: 'GET', pathName: '/api/status', headers: { host: `attacker.example:${UI}` } });
  ok(r.status === 403, 'status window refuses a foreign Host (DNS rebinding)', r.status);
  r = await request({ port: UI, method: 'POST', pathName: '/api/status', headers: { origin: `http://localhost:${UI}` } });
  ok(r.status === 404 || r.status === 405, 'status cannot be written (only the panel endpoints take changes)', r.status);
  const summary = JSON.parse(fs.readFileSync(path.join(LOGS, session, 'summary.json'), 'utf8'));
  ok(typeof summary.warningsPer100 === 'number' && summary.swipes >= 1 && summary.errors >= 1, 'summary.json has statistics', `per100 ${summary.warningsPer100}, swipes ${summary.swipes}, errors ${summary.errors}`);
  cw.kill();
  await sleep(200);

  // hostile rules file: slow pattern and junk are refused, the tool still starts
  const badRules = path.join(T, 'bad_rules.json');
  fs.writeFileSync(badRules, JSON.stringify({ format: 'contextweir-rules', groups: [{ name: 'Bad', rules: [
    { name: 'slow', target: 'reply', test: 'regex', value: '(a+)+$' },
    { name: 'code', target: 'reply', test: 'eval', value: 'process.exit()' },
    { name: 'long', target: 'reply', test: 'contains', value: 'x'.repeat(500) },
    { name: 'fine', target: 'reply', test: 'contains', value: 'hello' },
  ] }] }));
  const cw2 = startCW({ CW_RULES: badRules });
  await sleep(500);
  const out = cw2.output();
  ok(/slow: pattern could run very slowly/.test(out) && /unknown test "eval"/.test(out) && /longer than 200/.test(out), 'bad rules are refused with reasons');
  ok(/rules:\s+1 in 1 group/.test(out), 'the good rule in the same file still loads');
  cw2.kill();

  // a settings file pointing the model at another machine is refused
  fs.writeFileSync(SETTINGS, JSON.stringify({ relayPort: 6002, targetHost: '192.168.1.50', logsDir: LOGS }));
  const cw3 = startCW();
  await sleep(400);
  ok(/must be this computer/.test(cw3.output()), 'settings refuse a model server on another machine');
  cw3.kill();

  mock.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
