// Test-only: model and SillyTavern versions, end to end. ContextWeir 0.5 records
// a session (versions in summary.json) through the mock model, with the model
// changed halfway; PromptAssay shows the versions, the model per request and
// where it changed. An old log says "not recorded" and shows today's
// SillyTavern beside it, marked as today's.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'versions_work');
const c = H.counter(), ok = c.ok;
const PORTS = { model: 6801, relay: 6802 };

(async () => {
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  const logs = path.join(W, 'logs');
  fs.writeFileSync(path.join(W, 'cw.json'), JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: logs, sillyTavernDir: H.ST_DIR, showStartScreen: false }));
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model), H.TURNS]);
  await H.sleep(500);
  const cw = await H.startTool(H.CW, { CW_SETTINGS: path.join(W, 'cw.json'), CW_RULES: H.CW_RULES, CW_RUNNING: path.join(W, 'cw_running.json') });
  await H.waitFor(cw, /recording:/);

  // six real requests; the model name changes after the third (as when you switch models in SillyTavern)
  const files = fs.readdirSync(H.TURNS).sort().slice(0, 6);
  for (const [i, f] of files.entries()) {
    const req = JSON.parse(fs.readFileSync(path.join(H.TURNS, f), 'utf8')).request;
    req.model = i < 3 ? 'gemma-4-text-rpg' : 'mistral-small-rp';
    await H.request({ port: PORTS.relay, method: 'POST', pathName: '/v1/chat/completions', body: req, headers: { host: `localhost:${PORTS.relay}` } });
  }
  await H.sleep(800);
  cw.proc.kill();
  const ses = fs.readdirSync(logs).filter(n => n.startsWith('session_'))[0];
  const sum = JSON.parse(fs.readFileSync(path.join(logs, ses, 'summary.json'), 'utf8'));
  ok(sum.requests === 6 && sum.frontend.version === '1.19.0' && sum.modelServer.server.name === 'KoboldCpp', 'ContextWeir recorded six turns with the versions', `${sum.requests}, ${sum.frontend.version}, ${sum.modelServer.server.name}`);

  // PromptAssay reads that session and an old logger run
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [logs, H.OLD_LOGS], worldsDir: H.WORLDS, charactersDir: H.CHARACTERS }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  const api = async p => (await H.request({ port: pa.port, pathName: p })).json;
  const list = (await api('/api/sessions')).sessions;
  const cwId = list.find(s => s.kind === 'contextweir').id, oldId = list.find(s => s.kind === 'old-logger').id;

  let s = await api('/api/session?id=' + encodeURIComponent(cwId));
  ok(s.versions.recorded && s.versions.frontend.name === 'SillyTavern' && s.versions.frontend.version === '1.19.0', 'session: the SillyTavern version it was recorded with', JSON.stringify(s.versions.frontend));
  ok(s.versions.modelServer.server.version === '1.99-mock' && s.versions.modelServer.models[0] === 'koboldcpp/Gemma-mock', 'session: the model server and its loaded model', JSON.stringify(s.versions.modelServer));
  ok(s.versions.tool.name === 'ContextWeir' && /^0\.5/.test(s.versions.tool.version), 'session: which ContextWeir recorded it', s.versions.tool.version);
  ok(s.items.every((it, i) => it.model === (i < 3 ? 'gemma-4-text-rpg' : 'mistral-small-rp')), 'each request carries the model it asked for');
  ok(s.versions.models.length === 2 && s.versions.modelChanges.length === 1 && s.versions.modelChanges[0] === 4, 'the change of model is found at request #4', JSON.stringify(s.versions.models));
  let d = await api(`/api/record?id=${encodeURIComponent(cwId)}&n=4`);
  ok(d.model === 'mistral-small-rp' && d.modelBefore === 'gemma-4-text-rpg', 'request #4: model and the one before it', `${d.model} (was ${d.modelBefore})`);
  d = await api(`/api/record?id=${encodeURIComponent(cwId)}&n=5`);
  ok(d.model === 'mistral-small-rp' && d.modelBefore === null, 'request #5: same model, no change marked');

  s = await api('/api/session?id=' + encodeURIComponent(oldId));
  ok(!s.versions.recorded && s.versions.frontend === null && s.versions.sillyTavernNow === '1.19.0', 'old log: versions not recorded; today\'s SillyTavern found beside it', JSON.stringify({ rec: s.versions.recorded, now: s.versions.sillyTavernNow }));
  ok(!JSON.stringify(s.versions).includes(H.STAGED), 'no folder paths in what the page gets');

  // the page
  const b = await H.browser(9342, W, '1400,900');
  await b.send('Page.navigate', { url: pa.url + '/?session=' + encodeURIComponent(cwId) + '&n=4' });
  await H.sleep(1800);
  const vtext = await b.js(`return document.getElementById('versions').textContent`);
  ok(/Frontend: SillyTavern 1\.19\.0/.test(vtext) && /KoboldCpp 1\.99-mock/.test(vtext) && /loaded: koboldcpp\/Gemma-mock/.test(vtext), 'versions line: frontend, model server, loaded model', vtext.slice(0, 120));
  ok(/changed 1 time: gemma-4-text-rpg \(#1–3\) → mistral-small-rp \(#4–6\)/.test(vtext), 'versions line: which model, and where it changed', vtext.match(/Model asked for:.*?(?=Recorded|$)/)?.[0]);
  ok(await b.js(`return document.querySelectorAll('#turns .kind.mchange').length`) === 1 && await b.js(`return document.querySelector('#timeline button.mchange')?.dataset.n`) === '4', 'turn list and timeline mark request #4');
  ok(/model mistral-small-rp \(changed from gemma-4-text-rpg\)/.test(await b.js(`return document.querySelector('.facts').textContent`)), 'request view: model, and what it changed from');
  await b.shot(path.join(W, 'versions.png'));
  await b.send('Page.navigate', { url: pa.url + '/?session=' + encodeURIComponent(oldId) });
  await H.sleep(1800);
  const otext = await b.js(`return document.getElementById('versions').textContent`);
  ok(/Frontend: not recorded \(installed now: 1\.19\.0\)/.test(otext) && /Model server: not recorded/.test(otext), 'old log: "not recorded", with today\'s version marked as today\'s', otext.slice(0, 100));
  await b.shot(path.join(W, 'versions_old.png'));
  ok(b.problems.length === 0, 'no script errors or CSP violations', b.problems.join(' | '));
  b.close(); pa.proc.kill(); mock.kill();
  c.done('versions');
})();
