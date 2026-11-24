// Test-only: ContextWeir 0.5's control panel clicked through in headless Chrome.
// Start screen, Start, tabs, Check and Test buttons, saving a setting that
// applies now and one that needs Restart, Restart from the banner, Pause and
// Resume, the rules tab, skip-the-screen, a narrow window; no script errors or
// Content-Security-Policy violations. Screenshots go to panel_ui_work\.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'panel_ui_work');
const c = H.counter(), ok = c.ok;
const PORTS = { model: 6701, relay: 6702, relay2: 6712 };

(async () => {
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  const settingsFile = path.join(W, 'settings.json');
  const rules = path.join(W, 'rules.json');
  fs.copyFileSync(H.CW_RULES, rules);
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: path.join(W, 'logs'), sillyTavernDir: H.ST_DIR }));
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  const cw = await H.startTool(H.CW, { CW_SETTINGS: settingsFile, CW_RULES: rules, CW_RUNNING: path.join(W, 'running.json') });
  const b = await H.browser(9341, W, '1400,950');
  const { js, send, shot } = b;
  const shotTo = n => shot(path.join(W, n));
  await send('Page.navigate', { url: cw.url });
  await H.sleep(1500);
  const text = sel => js(`return document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
  const visible = sel => js(`const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.offsetParent !== null`);
  const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);

  // start screen
  ok(await text('#statePill') === 'Ready', 'opens showing Ready', await text('#statePill'));
  ok(await visible('#startBox') && /receiving port 6702/.test(await text('#startText')), 'start screen explains what Start will do', (await text('#startText')).slice(0, 60));
  ok(await js(`return document.getElementById('btnPause').disabled && document.getElementById('btnStop').disabled && !document.getElementById('btnStart').disabled`), 'only Start is available before starting');
  await shotTo('1_start_screen.png');

  await click('#bigStart'); await H.sleep(1200);
  ok(await text('#statePill') === 'Recording', 'Start records', await text('#statePill'));
  ok(!(await visible('#startBox')), 'start screen gives way to the session');
  await H.request({ port: PORTS.relay, method: 'POST', pathName: '/v1/chat/completions', body: { messages: [{ role: 'user', content: 'hi' }] }, headers: { host: `localhost:${PORTS.relay}` } });
  await H.sleep(3500);
  const st = await text('#status');
  ok(/SillyTavern 1\.19\.0/.test(st) && /KoboldCpp 1\.99-mock/.test(st), 'Running box shows the frontend and model server versions', st.slice(0, 160));
  ok(/^Requests1/.test(await text('#stats')), 'session counts the turn', (await text('#stats')).slice(0, 30));
  await shotTo('2_recording.png');

  // Connection tab: fields, Check and Test
  await click('#tabs [data-tab=connection]'); await H.sleep(300);
  ok(await js(`return document.querySelectorAll('[data-form=connection] .field').length`) === 3, 'Connection tab: three fields');
  ok(/Cloud models .* not supported/.test(await text('#tab-connection')), 'Connection tab says cloud models are not supported');
  await js(`[...document.querySelectorAll('[data-form=connection] button')].find(x => x.textContent === 'Check').click()`); await H.sleep(500);
  ok(/this ContextWeir/.test(await js(`return document.querySelectorAll('[data-form=connection] .result')[0].textContent`)), 'Check: the receiving port is ours');
  await js(`[...document.querySelectorAll('[data-form=connection] button')].find(x => x.textContent === 'Test').click()`); await H.sleep(800);
  ok(/answers: KoboldCpp/.test(await js(`return document.querySelectorAll('[data-form=connection] .result')[2].textContent`)), 'Test: the model server answers');
  ok(/needs Restart/.test(await text('[data-form=connection]')), 'each field says when it applies');
  await shotTo('3_connection.png');

  // a "now" setting on the Logs tab
  await click('#tabs [data-tab=logs]'); await H.sleep(400);
  await js(`const i = document.querySelector('[data-key=keepSessions]'); i.value = '7'; i.dispatchEvent(new Event('input', { bubbles: true }))`);
  ok(/unsaved/.test(await js(`return getComputedStyle(document.querySelector('[data-form=logs] .buttons.left button.primary'), '::after').content`)), 'unsaved changes are marked');
  await js(`document.querySelector('[data-form=logs] .buttons.left button.primary').click()`); await H.sleep(600);
  ok(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).keepSessions === 7 && /Settings saved/.test(await text('#banner')), 'Logs tab: save writes settings.json and says so');
  ok(/Sessions1/.test(await text('#logsOverview')), 'Logs tab shows the folder, session count and size', (await text('#logsOverview')).slice(0, 80));
  await shotTo('4_logs.png');

  // a bad value is refused with the reason
  await click('#tabs [data-tab=advanced]'); await H.sleep(200);
  await js(`document.querySelector('[data-key=ruleTimeoutMs]').value = '0'; document.querySelector('[data-form=advanced] .buttons.left button.primary').click()`); await H.sleep(500);
  ok(/Rule time limit/.test(await text('[data-form=advanced] .message.bad')), 'a bad value is refused with the reason shown');
  await js(`[...document.querySelectorAll('[data-form=advanced] button')].find(x => x.textContent === 'Undo changes').click()`); await H.sleep(200);

  // a "restart" setting: the banner offers Restart
  await click('#tabs [data-tab=connection]'); await H.sleep(200);
  await js(`document.querySelector('[data-key=relayPort]').value = '${PORTS.relay2}'; document.querySelector('[data-form=connection] .buttons.left button.primary').click()`); await H.sleep(3600);
  ok(/waiting for Restart: Receiving port/.test(await text('#banner')), 'saving the port: banner says it waits for Restart', (await text('#banner')).slice(0, 70));
  ok(/saved: waiting for Restart/.test(await text('[data-form=connection]')), 'the field itself says so too');
  ok(/6712\/v1/.test(await text('#frontendHint')), 'the frontend hint shows the new address');
  await shotTo('5_waiting_for_restart.png');
  await js(`document.querySelector('#banner button').click()`); await H.sleep(1500);
  const after = await (await fetch(cw.url + '/api/status')).json();
  ok(after.relay && after.relay.port === PORTS.relay2 && !(await visible('#banner')), 'Restart now: relay moves to the saved port, banner clears', after.relay && after.relay.port);

  // Pause and Resume
  await click('#btnPause'); await H.sleep(800);
  ok(await text('#statePill') === 'Paused' && /nothing is saved/.test(await text('#banner')) && await text('#btnPause') === 'Resume', 'Pause: pill, banner and button change');
  await shotTo('6_paused.png');
  await click('#btnPause'); await H.sleep(800);
  ok(await text('#statePill') === 'Recording', 'Resume');

  // Rules tab still works inside the panel
  await click('#tabs [data-tab=rules]'); await H.sleep(300);
  ok(await js(`return document.querySelectorAll('#sets .set').length`) >= 2 && await visible('#addSet'), 'Rules tab shows the rule sets');
  await js(`document.querySelector('#sets .rule input[type=checkbox]').click()`); await H.sleep(500);
  ok(JSON.parse(fs.readFileSync(rules, 'utf8')).groups[0].rules[0].enabled === false, 'Rules tab: unticking a rule saves it');
  await shotTo('7_rules.png');

  // Stop, then the start screen's skip box
  await click('#btnStop'); await H.sleep(1000);
  await click('#tabs [data-tab=status]'); await H.sleep(300);
  ok(await text('#statePill') === 'Ready' && await visible('#startBox'), 'Stop: back to the start screen');
  await click('#skipScreen'); await H.sleep(500);
  ok(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).showStartScreen === false, 'skip box saves showStartScreen = false');

  // About and Help
  await click('#aboutBtn'); await H.sleep(400);
  ok(/0\.5\.\d\.\d/.test(await text("#aboutBody")) && /Harahel-Whot/.test(await text('#aboutBody')), 'About shows the version and credit');
  await click('#aboutClose');

  // narrow window
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
  await H.sleep(400);
  ok(await js(`return document.documentElement.scrollWidth <= 660`), 'narrow window: nothing runs off the side', await js(`return document.documentElement.scrollWidth`));
  await shotTo('8_narrow.png');

  // reload keeps it running; closing the window quits it
  await b.send('Page.reload'); await H.sleep(5500);
  ok(cw.proc.exitCode === null, 'reloading the panel keeps ContextWeir running');
  const real = b.problems.filter(x => !/status of 400/.test(x));   // the refused bad value above answers 400 on purpose
  ok(real.length === 0, 'no script errors or CSP violations', real.join(' | '));
  await send('Runtime.evaluate', { expression: "document.getElementById('helpBtn').click()", userGesture: true }); await H.sleep(1200);   // a real click, so the popup is allowed
  const pages = async () => (await (await fetch('http://127.0.0.1:9341/json')).json()).filter(t => t.type === 'page');
  ok((await pages()).some(t => /\/help$/.test(t.url)), 'Help opens its own window');
  const tgt = (await pages()).find(t => !/\/help$/.test(t.url));
  await fetch('http://127.0.0.1:9341/json/close/' + tgt.id);
  await H.sleep(1500);
  ok(cw.proc.exitCode === null, 'closing only the panel window keeps ContextWeir running');
  ok(!(await pages()).some(t => /\/help$/.test(t.url)), 'closing the panel window closes its help window too');
  // Quit closes everything: ContextWeir ends and the page closes its own window
  const t2 = await (await fetch('http://127.0.0.1:9341/json/new?' + encodeURIComponent(cw.url + '/panel'), { method: 'PUT' })).json();
  const ws2 = new WebSocket(t2.webSocketDebuggerUrl); await new Promise(r => ws2.addEventListener('open', r));
  let i2 = 0; const send2 = (method, params = {}) => new Promise(res => { const i = ++i2; ws2.addEventListener('message', function h(ev) { const m = JSON.parse(ev.data); if (m.method === 'Page.javascriptDialogOpening') ws2.send(JSON.stringify({ id: 9000 + i, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); if (m.id === i) { ws2.removeEventListener('message', h); res(m); } }); ws2.send(JSON.stringify({ id: i, method, params })); });
  await send2('Page.enable'); await H.sleep(1500);
  send2('Runtime.evaluate', { expression: "document.getElementById('btnQuit').click()" });
  await H.sleep(2000);
  const still = (await (await fetch('http://127.0.0.1:9341/json')).json()).some(t => t.id === t2.id);
  ok(cw.proc.exitCode === 0, 'Quit ends ContextWeir', cw.proc.exitCode);
  ok(!still, 'Quit closes the panel window too');
  b.close(); cw.proc.kill(); mock.kill();
  c.done('panel UI');
})();
