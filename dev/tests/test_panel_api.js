// Test-only: ContextWeir 0.5's control panel, through its API. Start screen,
// Start / Pause / Resume / Stop / Restart / Quit, settings saved and refused,
// "applies now" against "needs Restart", the port check, the model test, a
// taken relay port, the SillyTavern and model server versions in the summary,
// and who may press the buttons.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'panel_api_work');
const c = H.counter(), ok = c.ok;
const settingsFile = path.join(W, 'settings.json');
const PORTS = { model: 6501, relay: 6502, relay2: 6512, held: 6522 };

function chatBody(text, stream = false) { return { model: 'test', stream, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: text }] }; }
const relayPost = (port, body) => H.request({ port, method: 'POST', pathName: '/v1/chat/completions', body, headers: { host: `localhost:${port}` } });
const status = async p => (await H.request({ port: p, pathName: '/api/status' })).json;
const sessions = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.startsWith('session_')).sort() : [];
const portOpen = port => new Promise(r => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });

(async () => {
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  const logs = path.join(W, 'logs');
  fs.writeFileSync(settingsFile, JSON.stringify({ _about: 'test header', relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: logs, sillyTavernDir: H.ST_DIR }, null, 2));
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  await H.sleep(400);
  const env = { CW_SETTINGS: settingsFile, CW_RULES: H.CW_RULES, CW_RUNNING: path.join(W, 'running.json') };

  // 1. start screen: the panel opens, the relay port stays closed
  let cw = await H.startTool(H.CW, env);
  const P = cw.port;
  ok(!!P, 'panel window opens on a free port', P);
  let st = await status(P);
  ok(st.state === 'ready' && !st.relay && !st.session, 'opens in the ready state (start screen), no session yet', st.state);
  ok(!(await portOpen(PORTS.relay)), 'relay port is closed until Start');
  ok(/press Start/.test(cw.out()), 'console says to press Start');
  ok(JSON.parse(fs.readFileSync(env.CW_RUNNING, 'utf8')).state === 'ready', 'running.json gives the panel port and state');

  // 2. who may press the buttons
  let r = await H.request({ port: P, method: 'POST', pathName: '/api/control', body: { action: 'start' } });
  ok(r.status === 403, 'Start refused with no Origin (a program, not the panel)', r.status);
  r = await H.panelPost(P, '/api/control', { action: 'start' }, { origin: 'http://127.0.0.1:8000' });
  ok(r.status === 403, 'Start refused from another local app', r.status);
  r = await H.panelPost(P, '/api/control', { action: 'start' }, { origin: 'https://evil.example' });
  ok(r.status === 403, 'Start refused from another site', r.status);
  r = await H.panelPost(P, '/api/control', 'action=start', { 'content-type': 'application/x-www-form-urlencoded' });
  ok(r.status === 415, 'a plain form post is refused (JSON only)', r.status);
  r = await H.panelPost(P, '/api/control', { action: 'start' }, { host: `evil.example:${P}` });
  ok(r.status === 403, 'foreign Host refused', r.status);

  // 3. Start: records, with versions noted
  r = await H.panelPost(P, '/api/control', { action: 'start' });
  ok(r.status === 200 && r.json.state === 'recording' && r.json.relay.port === PORTS.relay, 'Start opens the relay and records', r.json && r.json.state);
  r = await relayPost(PORTS.relay, chatBody('hello there'));
  ok(r.status === 200 && /Mock reply/.test(r.body), 'a turn passes through');
  await H.sleep(700);
  const s1 = sessions(logs);
  ok(s1.length === 1, 'one session folder made by Start', s1.length);
  let sum = JSON.parse(fs.readFileSync(path.join(logs, s1[0], 'summary.json'), 'utf8'));
  ok(sum.requests === 1, 'the turn is recorded', sum.requests);
  ok(sum.frontend && sum.frontend.name === 'SillyTavern' && sum.frontend.version === '1.19.0', 'summary notes the SillyTavern version from package.json', JSON.stringify(sum.frontend));
  ok(sum.modelServer && sum.modelServer.server && sum.modelServer.server.version === '1.99-mock' && sum.modelServer.models[0] === 'koboldcpp/Gemma-mock', 'summary notes the model server version and loaded model', JSON.stringify(sum.modelServer));

  // 4. Pause and Resume
  r = await H.panelPost(P, '/api/control', { action: 'pause' });
  ok(r.json.state === 'paused', 'Pause', r.json.state);
  r = await relayPost(PORTS.relay, chatBody('while paused'));
  ok(r.status === 200 && /while paused/.test(r.body), 'while paused, turns still pass through to the model');
  await H.sleep(300);
  sum = JSON.parse(fs.readFileSync(path.join(logs, s1[0], 'summary.json'), 'utf8'));
  const lines = () => fs.readFileSync(path.join(logs, s1[0], 'records.jsonl'), 'utf8').trim().split('\n').length;
  ok(sum.requests === 1 && sum.notLogged === 1 && lines() === 1, 'while paused, nothing is saved (counted as passed through)', `${sum.requests} saved, ${sum.notLogged} passed`);
  r = await H.panelPost(P, '/api/control', { action: 'resume' });
  await relayPost(PORTS.relay, chatBody('after resume'));
  await H.sleep(400);
  ok(r.json.state === 'recording' && lines() === 2, 'Resume saves turns again', lines());

  // 5. settings refused whole
  const before = fs.readFileSync(settingsFile, 'utf8');
  for (const [bad, why] of [
    [{ relayPort: 80 }, 'a port below 1024'], [{ targetHost: '192.168.1.50' }, 'a model server on another machine'],
    [{ targetHost: 'api.openai.com' }, 'a cloud address'], [{ logsDir: '/' }, 'the top of a drive'],
    [{ logsDir: path.join(W, 'no', 'such', 'deep') }, 'a log folder whose parent is missing'], [{ logsDir: path.dirname(H.CW) }, "ContextWeir's own program folder"],
    [{ keepSessions: 0 }, 'zero sessions'], [{ sillyTavernDir: W }, 'a SillyTavern folder without package.json'],
    [{ relayPort: PORTS.model }, 'the same port as the model server'], [{ showStartScreen: 'yes' }, 'a non yes/no'],
  ]) {
    r = await H.panelPost(P, '/api/settings', { settings: bad });
    ok(r.status === 400 && r.json.problems.length >= 1 && fs.readFileSync(settingsFile, 'utf8') === before, `refused and nothing written: ${why}`, r.json && r.json.problems[0]);
  }
  r = await H.panelPost(P, '/api/settings', { settings: { keepSessions: 5 } }, { origin: 'http://localhost:8000' });
  ok(r.status === 403, 'settings save refused from another local app', r.status);

  // 6. a "now" setting applies at once
  r = await H.panelPost(P, '/api/settings', { settings: { keepSessions: 5, ruleTimeoutMs: 800 } });
  ok(r.status === 200 && r.json.inUse.keepSessions === 5 && r.json.inUse.ruleTimeoutMs === 800 && !r.json.pendingRestart.length, '"applies now" settings are in use at once');
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  ok(saved._about === 'test header' && saved.keepSessions === 5 && fs.existsSync(settingsFile + '.bak'), 'settings.json written (header kept, previous file kept as .bak)');

  // 7. a "restart" setting waits for Restart
  r = await H.panelPost(P, '/api/settings', { settings: { relayPort: PORTS.relay2 } });
  ok(r.status === 200 && r.json.pendingRestart.includes('relayPort') && r.json.inUse.relayPort === PORTS.relay, 'the receiving port is saved but waits for Restart', r.json.pendingRestart.join());
  ok(await portOpen(PORTS.relay) && !(await portOpen(PORTS.relay2)), 'still on the old port until Restart');
  r = await H.panelPost(P, '/api/control', { action: 'restart' });
  ok(r.status === 200 && r.json.relay.port === PORTS.relay2 && !r.json.pendingRestart.length, 'Restart applies the saved port', r.json.relay && r.json.relay.port);
  ok(!(await portOpen(PORTS.relay)) && await portOpen(PORTS.relay2), 'old port closed, new port open');
  ok(sessions(logs).length === 2, 'Restart starts a new session', sessions(logs).length);
  r = await relayPost(PORTS.relay2, chatBody('on the new port'));
  ok(r.status === 200, 'turns pass through on the new port');

  // 8. port check and model test
  const holder = net.createServer().listen(PORTS.held, '127.0.0.1');
  await H.sleep(100);
  r = await H.panelPost(P, '/api/check-port', { port: PORTS.held });
  ok(r.json.result === 'used' && /another program/.test(r.json.text), 'port check: held by another program', r.json.text);
  r = await H.panelPost(P, '/api/check-port', { port: PORTS.relay });
  ok(r.json.result === 'free', 'port check: free', r.json.text);
  r = await H.panelPost(P, '/api/check-port', { port: PORTS.relay2 });
  ok(r.json.result === 'this', 'port check: our own relay', r.json.text);
  r = await H.panelPost(P, '/api/check-port', { port: 80 });
  ok(r.status === 400, 'port check: below 1024 refused', r.status);
  r = await H.request({ port: P, method: 'POST', pathName: '/api/check-port', body: { port: 6000 } });
  ok(r.status === 403, 'port check refused with no Origin (cannot be used as a port scanner by a program or page)', r.status);
  r = await H.panelPost(P, '/api/test-model', { host: '127.0.0.1', port: PORTS.model });
  ok(r.json.reachable && r.json.server.name === 'KoboldCpp', 'model test: answers, with name and version', JSON.stringify(r.json.server));
  r = await H.panelPost(P, '/api/test-model', { host: '127.0.0.1', port: PORTS.held + 1 });
  ok(r.status === 200 && r.json.reachable === false, 'model test: nothing there', r.json.error);
  r = await H.panelPost(P, '/api/test-model', { host: 'example.com', port: 443 });
  ok(r.status === 400, 'model test: another machine refused', r.json && r.json.error);
  r = await H.panelPost(P, '/api/test-model', { host: '127.0.0.1', port: PORTS.model }, { origin: 'http://127.0.0.1:9999' });
  ok(r.status === 403, 'model test refused from another local app', r.status);

  // 9. Stop and Start again
  r = await H.panelPost(P, '/api/control', { action: 'stop' });
  ok(r.json.state === 'ready' && !(await portOpen(PORTS.relay2)), 'Stop closes the relay; the panel stays', r.json.state);
  ok((await status(P)).state === 'ready', 'panel still answers after Stop');
  r = await H.panelPost(P, '/api/control', { action: 'start' });
  ok(r.json.state === 'recording' && sessions(logs).length === 3, 'Start again: a new session', sessions(logs).length);

  // 10. a taken relay port: the panel says so and stays up
  await H.panelPost(P, '/api/control', { action: 'stop' });
  r = await H.panelPost(P, '/api/settings', { settings: { relayPort: PORTS.held } });
  r = await H.panelPost(P, '/api/control', { action: 'restart' });
  ok(r.status === 409 && r.json.state === 'portTaken' && /already in use/.test(r.json.lastError), 'Start on a taken port: refused with a plain message, nothing moves', r.json.state);
  ok(r.json.relay === null && (await status(P)).state === 'portTaken', 'the panel stays up and shows it');

  // 11. Quit
  r = await H.panelPost(P, '/api/control', { action: 'quit' });
  await H.sleep(700);
  ok(cw.proc.exitCode === 0 && !fs.existsSync(env.CW_RUNNING), 'Quit ends ContextWeir and removes running.json', cw.proc.exitCode);

  // 12. skip the start screen, but the screen comes back when the port is taken
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.held, targetPort: PORTS.model, logsDir: logs, showStartScreen: false }));
  cw = await H.startTool(H.CW, env);
  await H.sleep(500);
  st = await status(cw.port);
  ok(cw.proc.exitCode === null && st.state === 'portTaken', 'skip screen + taken port: stays running and shows the panel with the problem', st.state);
  cw.proc.kill(); holder.close();
  await H.sleep(200);
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: logs, showStartScreen: false }));
  cw = await H.startTool(H.CW, env);
  await H.waitFor(cw, /recording:/);
  st = await status(cw.port);
  ok(st.state === 'recording' && await portOpen(PORTS.relay), 'skip screen: records as soon as it opens', st.state);
  cw.proc.kill();

  // 13. a broken settings.json stops ContextWeir with reasons
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: 99999, targetHost: '10.0.0.1' }));
  cw = await H.startTool(H.CW, env, 2000);
  await H.sleep(300);
  ok(cw.proc.exitCode === 1 && /Receiving port/.test(cw.out()) && /this computer/.test(cw.out()), 'bad settings.json at start: stops and lists the problems');

  // 14. a SillyTavern folder that is gone: a warning, not a stop (it is only used for a version number)
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: logs, sillyTavernDir: path.join(W, 'moved-away') }));
  cw = await H.startTool(H.CW, env);
  st = await status(cw.port);
  ok(cw.proc.exitCode === null && st.state === 'ready' && /SillyTavern folder/.test((st.warnings || [])[0] || '') && /left out for now/.test(cw.out()), 'a missing SillyTavern folder: starts anyway, with a note in the console and the panel', (st.warnings || [])[0]);
  r = await H.panelPost(cw.port, '/api/control', { action: 'start' });
  ok(r.json.state === 'recording', 'and records normally (no frontend version noted)');
  cw.proc.kill();

  // 15. closing only the panel window does not stop ContextWeir (no "closing" action any more)
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: logs }));
  cw = await H.startTool(H.CW, env);
  r = await H.panelPost(cw.port, '/api/control', { action: 'closing' });
  ok(r.status === 400, 'there is no action that quits when the window closes', r.status);
  cw.proc.kill();

  mock.kill();
  c.done('panel API');
})();
