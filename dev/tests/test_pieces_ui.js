// Test-only: in headless Chrome, click an entry tag in PromptAssay, check the
// popup shows exactly that entry's text, use "Show in the prompt", open About
// in both tools.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
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
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(T, 'cw_about', name), Buffer.from(r.result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  return { ws, send, js, shot, problems };
}

(async () => {
  fs.rmSync(path.join(T, 'cw_about'), { recursive: true, force: true }); fs.mkdirSync(path.join(T, 'cw_about'));
  const paTool = await H.startTool(H.PA, { PA_SETTINGS: path.join(T, 'pa_settings.json'), PA_RUNNING: path.join(T, 'cw_about', 'pa_running.json') });
  const pa = paTool.proc;
  fs.writeFileSync(path.join(T, 'cw_about', 'settings.json'), JSON.stringify({ relayPort: 6302, targetPort: 6301, logsDir: path.join(T, 'cw_about', 'logs') }));
  const cwTool = await H.startTool(H.CW, { CW_SETTINGS: path.join(T, 'cw_about', 'settings.json'), CW_RULES: H.CW_RULES, CW_RUNNING: path.join(T, 'cw_about', 'cw_running.json') });
  const cw = cwTool.proc;
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${path.join(T, 'cw_about', 'chrome')}`, '--window-size=1500,950', 'about:blank']);
  await sleep(1500);
  const { ws, send, js, shot, problems } = await devtools(9334);

  // PromptAssay: open a mid-story turn
  await send('Page.navigate', { url: paTool.url + '/?session=1%3Arun_2026-11-20T17-42-53-582Z&n=2662' });
  await sleep(1500);
  const tagCount = await js(`return document.querySelectorAll('button.tag').length`);
  ok(tagCount > 10, 'entry tags are clickable buttons', tagCount);

  // click a lorebook entry tag inside the big injected block
  const label = await js(`const b=[...document.querySelectorAll('button.tag.lorebook')].find(x=>x.textContent.includes('[Cast] Fairweather')); b.click(); return b.textContent;`);
  await sleep(300);
  const pop = await js(`return { open: document.getElementById('pieceDialog').open, title: document.getElementById('pieceTitle').textContent, text: document.getElementById('pieceText').textContent, where: document.getElementById('pieceWhere').textContent }`);
  const r = await (await fetch(paTool.url + '/api/record?id=' + encodeURIComponent('1:run_2026-11-20T17-42-53-582Z') + '&n=2662')).json();
  const sec = r.sections.find(s => s.contains.some(c => c.label === label));
  const c = sec.contains.find(c => c.label === label);
  ok(pop.open && pop.title === label && pop.text === sec.text.slice(c.span.start, c.span.end), 'clicking a tag opens a popup with exactly that entry\'s text', `${label}: ${pop.text.length} chars`);
  ok(/characters \d+–\d+ of \d+/.test(pop.where), 'popup says where in the message it sits', pop.where.slice(0, 90));
  await shot('pa_piece.png');

  // the section did not toggle when the tag was clicked
  ok(await js(`return [...document.querySelectorAll('details.sec')].every(d => !d.open)`), 'clicking a tag does not open or close the section underneath');

  // "Show in the prompt"
  await js(`document.getElementById('pieceShow').click()`);
  await sleep(300);
  const shown = await js(`const m=document.querySelector('mark.piece'); return m ? { text: m.textContent, open: m.closest('details').open } : null`);
  ok(shown && shown.open && shown.text === pop.text, '"Show in the prompt" opens the message and marks the entry inside it');
  await shot('pa_piece_in_prompt.png');

  // an "entered" item is clickable too
  const entered = await js(`const b=document.querySelector('.changes button.link'); if(!b) return null; b.click(); return b.textContent;`);
  await sleep(300);
  if (entered) ok(await js(`return document.getElementById('pieceDialog').open && document.getElementById('pieceTitle').textContent`) === entered, '"entered" entries open the same popup', entered);
  await js(`document.getElementById('pieceClose').click()`);

  // card field with {{user}} macros: post-history instructions
  await js(`[...document.querySelectorAll('button.tag.card')].find(x=>x.textContent.includes('post-history')).click()`);
  await sleep(300);
  const ph = await js(`return document.getElementById('pieceText').textContent`);
  ok(ph.startsWith('[Game master rules]') && !/\{\{user\}\}/.test(ph), 'card field with macros shown as sent (names filled in, no {{user}})', ph.length + ' chars');
  await js(`document.getElementById('pieceClose').click()`);

  // About (PromptAssay)
  await js(`document.getElementById('aboutBtn').click()`);
  await sleep(400);
  const about = await js(`return document.getElementById('aboutDialog').open && document.getElementById('aboutBody').textContent`);
  ok(/PromptAssay/.test(about) && /\d+\.\d+\.\d+\.\d+ \(prototype\), built \d+ \w+ \d{4}/.test(about) && /Claude Opus 5\.5/.test(about) && /SillyTavern 1\.19\.0/.test(about), 'PromptAssay About shows version, SillyTavern version and model credit');
  await shot('pa_about.png');

  // About (ContextWeir)
  await send('Page.navigate', { url: cwTool.url + '/' });
  await sleep(1200);
  await js(`document.getElementById('aboutBtn').click()`);
  await sleep(400);
  const cabout = await js(`return document.getElementById('aboutDialog').open && document.getElementById('aboutBody').textContent`);
  ok(/ContextWeir/.test(cabout) && /0\.5\.\d\.\d \(prototype\), built \d+ \w+ \d{4}/.test(cabout) && /Claude Opus 5\.5/.test(cabout) && /format 1/.test(cabout), 'ContextWeir About shows version, log format and model credit');
  await shot('cw_about.png');

  ok(problems.length === 0, 'no script errors or Content-Security-Policy violations', problems.join(' | ').slice(0, 200));
  ws.close(); chrome.kill(); pa.kill(); cw.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
