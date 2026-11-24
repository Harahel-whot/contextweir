// Test-only: PromptAssay's live updates. Opens a ContextWeir session in headless Chrome, appends
// records to it as ContextWeir would, and checks the turn list, the stats and the followed view
// update without a reload; checks the Live switch; checks a new session is announced; checks the
// header wraps in a narrow window.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname, W = path.join(T, 'live_work');
let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtools(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map(); const problems = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.result.value;
  };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(W, name), Buffer.from(r.result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  return { send, js, shot, problems };
}

(async () => {
  // A copy of a real ContextWeir session, cut to its first 3 records; the rest are added live.
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(path.join(W, 'logs'), { recursive: true });
  // the newest session test_contextweir.js recorded (run that first)
  const cwlogs = path.join(T, 'cwlogs');
  const srcDir = path.join(cwlogs, fs.readdirSync(cwlogs).filter(n => n.startsWith('session_') && fs.existsSync(path.join(cwlogs, n, 'records.jsonl'))).sort().pop());
  const lines = fs.readFileSync(path.join(srcDir, 'records.jsonl'), 'utf8').split('\n').filter(Boolean);
  ok(lines.length >= 6, 'source session has enough records', lines.length);
  const SES = 'session_2026-11-23T05-00-00-000Z', sesDir = path.join(W, 'logs', SES);
  fs.mkdirSync(sesDir);
  const rec = i => { const r = JSON.parse(lines[i]); r.n = i + 1; return JSON.stringify(r) + '\n'; };
  fs.writeFileSync(path.join(sesDir, 'records.jsonl'), rec(0) + rec(1) + rec(2));
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [path.join(W, 'logs')] }));

  const tool = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  const pa = tool.proc, url = tool.url;
  ok(!!url, 'PromptAssay started on a free port', url);
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9335', `--user-data-dir=${path.join(W, 'chrome')}`, '--window-size=1400,900', 'about:blank']);
  await sleep(1500);
  const { send, js, shot, problems } = await devtools(9335);
  await send('Page.navigate', { url });
  await sleep(1500);

  const count = () => js(`return document.querySelectorAll('#turns .turn').length`);
  const current = () => js(`return document.querySelector('#turns .current .num')?.textContent`);
  ok(await count() === 3 && await current() === '#3', 'opens with 3 requests, newest shown', `${await count()}, ${await current()}`);

  // 1. a new record arrives while viewing the newest: list grows, view follows
  fs.appendFileSync(path.join(sesDir, 'records.jsonl'), rec(3));
  await sleep(4000);
  ok(await count() === 4, 'new request appears without a reload', await count());
  ok(await current() === '#4', 'view follows the newest when you were on the newest', await current());
  ok((await js(`return document.getElementById('sessionStats').textContent`)).startsWith('4 requests'), 'stats update');

  // 2. looking at an older turn: list grows but the view stays put
  await js(`document.querySelector('#turns .turn[data-n="2"]').click()`); await sleep(400);
  fs.appendFileSync(path.join(sesDir, 'records.jsonl'), rec(4));
  await sleep(4000);
  ok(await count() === 5 && await current() === '#2', 'view stays on an older request you picked', `${await count()}, ${await current()}`);

  // 3. Live off: nothing changes; on again: catches up
  await js(`document.getElementById('live').click()`);
  fs.appendFileSync(path.join(sesDir, 'records.jsonl'), rec(5));
  await sleep(4000);
  ok(await count() === 5, 'with Live off the list does not change', await count());
  await js(`document.getElementById('live').click()`); await sleep(1500);
  ok(await count() === 6, 'switching Live back on catches up at once', await count());

  // 4. a half-written last line is not shown (ContextWeir mid-write)
  const half = rec(0).replace(/"n":1/, '"n":7');
  fs.appendFileSync(path.join(sesDir, 'records.jsonl'), half.slice(0, 200));
  await sleep(4000);
  ok(await count() === 6, 'half-written line ignored', await count());
  fs.appendFileSync(path.join(sesDir, 'records.jsonl'), half.slice(200));
  await sleep(4000);
  ok(await count() === 7, 'shown once the line is complete', await count());

  // 5. a new session (ContextWeir restarted) is announced, not switched to
  const SES2 = 'session_2026-11-23T05-30-00-000Z';
  fs.mkdirSync(path.join(W, 'logs', SES2));
  fs.writeFileSync(path.join(W, 'logs', SES2, 'records.jsonl'), rec(0));
  await sleep(16000);
  const note = await js(`const n=document.getElementById('newNote'); return { hidden: n.hidden, text: n.textContent, sel: document.getElementById('session').value, opts: [...document.getElementById('session').options].filter(o => !o.value.startsWith('demo:')).length }`);   // the made-up demo is listed too; count real sessions
  ok(!note.hidden && note.opts === 2 && note.sel.endsWith(SES), 'new session announced and listed; current one kept', JSON.stringify(note));
  await js(`document.getElementById('newNote').click()`); await sleep(1200);
  ok((await js(`return document.getElementById('session').value`)).endsWith(SES2) && await count() === 1, 'clicking the note opens the new session');

  // 6. narrow window: header wraps, Help and About stay visible, stats stay one line
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const hdr = await js(`const h=document.querySelector('header').getBoundingClientRect(); const a=document.getElementById('aboutBtn').getBoundingClientRect(); const s=document.getElementById('sessionStats').getBoundingClientRect(); return { aboutRight: a.right, width: innerWidth, statsH: s.height, scrollW: document.documentElement.scrollWidth }`);
  ok(hdr.aboutRight <= hdr.width && hdr.statsH < 24 && hdr.scrollW <= hdr.width, 'narrow window: About fits, stats on one line, no sideways scroll', JSON.stringify(hdr));
  await shot('pa_narrow.png');

  ok(problems.length === 0, 'no script errors or CSP violations', problems.join(' | '));
  chrome.kill(); pa.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
