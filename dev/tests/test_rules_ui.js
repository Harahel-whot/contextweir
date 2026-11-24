// Test-only: the real rules tab clicked through in headless Chrome (16 checks), through
// the DevTools protocol, each action checked against rules.json on disk (a copy in
// rules_ui\): switch a set and a rule off, add a set, add / edit / delete a rule with an
// exception, rename, export, import with preview; no script errors or CSP violations.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const CW = H.CW;
const WORK = path.join(T, 'rules_ui');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK);
const RULES = path.join(WORK, 'rules.json');
fs.copyFileSync(H.CW_RULES, RULES);
const SETTINGS = path.join(WORK, 'settings.json');
fs.writeFileSync(SETTINGS, JSON.stringify({ relayPort: 6202, targetPort: 6201, logsDir: path.join(WORK, 'logs') }));
const IMPORT_FILE = path.join(WORK, 'shared-horror-rules.json');
fs.writeFileSync(IMPORT_FILE, JSON.stringify({ format: 'contextweir-rules', version: 1, groups: [{ name: 'Horror card', enabled: true, rules: [
  { name: 'Says "suddenly"', severity: 'note', target: 'reply', test: 'contains', value: 'suddenly', note: 'Overused.' },
  { name: 'Names the monster', severity: 'serious', target: 'reply', test: 'regex', value: '\\bthe Hollow Man\\b', flags: 'i', note: 'It must stay unnamed until act 3.' },
  { name: 'Broken', target: 'reply', test: 'regex', value: '(a+)+$' },
] }] }));

let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const disk = () => JSON.parse(fs.readFileSync(RULES, 'utf8'));
const set = name => disk().groups.find(g => g.name === name);

(async () => {
  const tool = await H.startTool(CW, { CW_SETTINGS: SETTINGS, CW_RULES: RULES, CW_RUNNING: path.join(WORK, 'running.json') });
  const cw = tool.proc;
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${path.join(WORK, 'chrome')}`, '--window-size=1400,1000', 'about:blank']);
  await sleep(1500);

  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map();
  const answers = [];          // replies for prompt()/confirm(), in order
  const problems = [];         // page errors and CSP violations
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    if (m.method === 'Page.javascriptDialogOpening') {
      const a = answers.shift() ?? { accept: true };
      send('Page.handleJavaScriptDialog', a);
    }
    if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && /Content Security Policy|error/i.test(m.params.entry.text) && m.params.entry.level === 'error') problems.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.result.value;
  };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(WORK, name), Buffer.from(r.result.data, 'base64')); };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');
  await send('Page.navigate', { url: tool.url + '/' });
  await sleep(1200);
  await js(`document.querySelector('#tabs [data-tab=rules]').click()`);   // since 0.5 the rules are a tab of the control panel
  await sleep(200);

  ok(await js(`return document.querySelectorAll('.set').length`) === 2, 'window shows the two shipped sets');

  // switch one rule off with its checkbox
  await js(`document.querySelectorAll('.set')[0].querySelectorAll('.rule input[type=checkbox]')[1].click()`);
  await sleep(400);
  ok(disk().groups[0].rules[1].enabled === false, 'rule checkbox switches the rule off on disk');

  // switch a whole set off
  await js(`document.querySelectorAll('.setHead input[type=checkbox]')[1].click()`);
  await sleep(400);
  ok(disk().groups[1].enabled === false, 'set checkbox switches the set off on disk');
  await js(`document.querySelectorAll('.setHead input[type=checkbox]')[1].click()`);
  await sleep(400);

  // new set
  answers.push({ accept: true, promptText: 'Test set' });
  await js(`document.getElementById('addSet').click()`);
  await sleep(500);
  ok(!!set('Test set'), '"+ New set" adds a set');

  // new rule with an exception, through the dropdown editor
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Test set'); s.querySelector('.setFoot button').click();`);
  await sleep(300);
  await js(`
    document.getElementById('fName').value = 'Reply mentions the weather';
    document.getElementById('fSeverity').value = 'serious';
    const c = document.getElementById('mainCond');
    c.querySelectorAll('select')[0].value = 'reply';
    c.querySelectorAll('select')[1].value = 'regex'; c.querySelectorAll('select')[1].dispatchEvent(new Event('change'));
    c.querySelector('input[type=text]').value = '\\\\b(rain|snow)\\\\b';
    c.querySelector('label.case input').checked = true;
    document.getElementById('addUnless').click();
    const u = document.querySelector('#unlessList .cond');
    u.querySelectorAll('select')[0].value = 'lastUser';
    u.querySelectorAll('select')[1].value = 'contains';
    u.querySelector('input[type=text]').value = 'weather';
    document.getElementById('fNote').value = 'Only if the player did not ask.';
  `);
  await shot('ui_editor.png');
  await js(`document.querySelector('#ruleForm button.primary').click()`);
  await sleep(500);
  const nr = (set('Test set') || { rules: [] }).rules[0] || {};
  ok(nr.name === 'Reply mentions the weather' && nr.test === 'regex' && nr.flags === 'i' && nr.severity === 'serious' && nr.unless && nr.unless[0].value === 'weather' && nr.note, 'editor saves a new rule with pattern, ignore case, exception and note', JSON.stringify(nr).slice(0, 120));

  // a bad pattern in the editor is refused and the dialog stays open
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Test set'); s.querySelector('.setFoot button').click();`);
  await sleep(300);
  await js(`document.getElementById('fName').value='Bad'; const c=document.getElementById('mainCond'); c.querySelectorAll('select')[1].value='regex'; c.querySelector('input[type=text]').value='(a+)+'; document.querySelector('#ruleForm button.primary').click();`);
  await sleep(500);
  const dlg = await js(`return { open: document.getElementById('ruleDialog').open, msg: document.getElementById('ruleProblems').textContent }`);
  ok(dlg.open && /slowly/.test(dlg.msg) && set('Test set').rules.length === 1, 'editor refuses a slow pattern and explains why', dlg.msg.slice(0, 80));
  await js(`document.getElementById('ruleCancel').click()`);

  // edit: change severity
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Test set'); s.querySelector('.rule .acts button').click();`);
  await sleep(300);
  await js(`document.getElementById('fSeverity').value='note'; document.querySelector('#ruleForm button.primary').click();`);
  await sleep(500);
  ok(set('Test set').rules[0].severity === 'note' && set('Test set').rules[0].unless.length === 1, 'editing a rule keeps its exception and saves the change');

  // rename the set
  answers.push({ accept: true, promptText: 'Weather checks' });
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Test set'); [...s.querySelectorAll('.setHead button')].find(b=>b.textContent==='Rename').click();`);
  await sleep(500);
  ok(!!set('Weather checks') && !set('Test set'), 'rename a set');

  // import with preview (merge)
  await js(`window.__sel = document.getElementById('importFile')`);
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#importFile' });
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [IMPORT_FILE] });
  await sleep(700);
  const prev = await js(`return { open: document.getElementById('importDialog').open, text: document.getElementById('importPreview').textContent }`);
  ok(prev.open && /Horror card/.test(prev.text) && /very slowly/.test(prev.text), 'import shows a preview, including what will be refused');
  await shot('ui_import.png');
  ok(!set('Horror card'), 'preview alone saves nothing');
  await js(`document.getElementById('importConfirm').click()`);
  await sleep(600);
  ok(set('Horror card') && set('Horror card').rules.length === 2, 'import (merge) adds the set without the broken rule');

  // delete a rule, then delete a set (both confirm first)
  answers.push({ accept: false });
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Horror card'); s.querySelectorAll('.rule .acts button')[1].click();`);
  await sleep(400);
  ok(set('Horror card').rules.length === 2, 'cancelling the delete keeps the rule');
  answers.push({ accept: true });
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Horror card'); s.querySelectorAll('.rule .acts button')[1].click();`);
  await sleep(400);
  ok(set('Horror card').rules.length === 1, 'delete a rule');
  answers.push({ accept: true });
  await js(`const s=[...document.querySelectorAll('.set')].find(x=>x.querySelector('.setName').textContent==='Weather checks'); [...s.querySelectorAll('.setHead button')].find(b=>b.textContent==='Delete set').click();`);
  await sleep(400);
  ok(!set('Weather checks'), 'delete a set');

  // export links point at the right sets
  const links = await js(`return [...document.querySelectorAll('a[download]')].map(a => a.getAttribute('href'))`);
  ok(links.includes('/api/rules/export') && links.some(h => h.includes('set=Horror%20card')), 'export links for all sets and each set', links.join(' '));

  await sleep(300);
  await shot('ui_rules.png');
  ok(problems.length === 0, 'no script errors or Content-Security-Policy violations in the page', problems.join(' | ').slice(0, 200));

  ws.close(); chrome.kill(); cw.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
