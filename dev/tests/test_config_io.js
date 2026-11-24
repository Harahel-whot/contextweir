// Test-only: the setup file (settings and rule sets together), ContextWeir's Advanced tab.
// Export: a download with the settings (folders only when asked) and every rule set. Import:
// a preview that saves nothing and lists each change; refusals (another site, not a setup
// file, a model address off this computer, folders that do not exist here); applying the
// chosen parts (settings that need Restart wait for it; rules merged, replaced or left alone);
// a round trip from one ContextWeir to a fresh one. The dialog clicked through in headless
// Chrome (file picked, preview shown, Import pressed).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'config_work');
const c = H.counter(), ok = c.ok;
const PORTS = { model: 6901, relayA: 6902, relayB: 6912, debug: 9351 };

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const noAbout = file => JSON.stringify({ ...file, _about: undefined });

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(W, { recursive: true });
  const mock = spawn(process.execPath, [path.join(H.T, 'mock_model.js'), String(PORTS.model)]);
  await H.sleep(300);

  // ContextWeir A: the one we export from and import into.
  const settingsA = path.join(W, 'a_settings.json');
  const rulesA = path.join(W, 'a_rules.json');
  fs.copyFileSync(H.CW_RULES, rulesA);
  fs.writeFileSync(settingsA, JSON.stringify({
    relayPort: PORTS.relayA, targetPort: PORTS.model, logsDir: path.join(W, 'logs_a'), sillyTavernDir: H.ST_DIR,
    keepSessions: 30, showStartScreen: false,
  }, null, 2));
  const a = await H.startTool(H.CW, { CW_SETTINGS: settingsA, CW_RULES: rulesA, CW_RUNNING: path.join(W, 'a_running.json') });
  const A = a.port;
  await H.waitFor(a, /recording:/);

  // --- export -------------------------------------------------------------------
  let r = await H.request({ port: A, pathName: '/api/setup/export' });
  const exported = r.json;
  ok(r.status === 200 && /attachment; filename="contextweir-setup_/.test(r.headers['content-disposition'] || ''), 'export: offered as a file download');
  ok(exported && exported.format === 'contextweir-setup' && exported.version === 1 && /ContextWeir/.test(exported.from), 'export: a setup file, format 1, says which version made it');
  ok(exported.settings.relayPort === PORTS.relayA && !('logsDir' in exported.settings) && !('sillyTavernDir' in exported.settings) && exported.foldersIncluded === false,
    'export: settings without the folder settings by default');
  ok(exported.rules.format === 'contextweir-rules' && exported.rules.groups.length === readJson(rulesA).groups.length, 'export: every rule set', exported.rules.groups.length);
  r = await H.request({ port: A, pathName: '/api/setup/export?folders=1' });
  ok(r.json.settings.logsDir === path.join(W, 'logs_a') && r.json.foldersIncluded === true, 'export with folders: the folder settings are in');

  // --- import: who may, and what is refused --------------------------------------
  const changed = JSON.parse(JSON.stringify(exported));
  changed.settings.keepSessions = 7;
  changed.settings.ruleTimeoutMs = 500;
  changed.settings.relayPort = 6922;
  changed.settings.surpriseKey = true;
  changed.rules.groups = [{ name: 'Imported set', rules: [
    { name: 'Says hello', target: 'reply', test: 'contains', value: 'hello' },
    { name: 'Broken', target: 'nowhere', test: 'contains', value: 'x' },
  ] }];
  r = await H.request({ port: A, method: 'POST', pathName: '/api/setup/import', body: { file: changed }, headers: { origin: 'http://127.0.0.1:8000' } });
  ok(r.status === 403, 'import refused from another local app', r.status);
  r = await H.panelPost(A, '/api/setup/import', { file: readJson(rulesA) });
  ok(r.status === 400 && /not a ContextWeir setup file/.test(r.json.error), 'a rule file is not a setup file (it goes in through the Rules tab)');

  const before = fs.readFileSync(settingsA, 'utf8');
  const rulesBefore = fs.readFileSync(rulesA, 'utf8');
  r = await H.panelPost(A, '/api/setup/import', { file: changed, rulesMode: 'merge' });
  const p = r.json;
  ok(r.status === 200 && p.preview === true, 'preview answers');
  ok(p.settings.changes.map(x => x.key).sort().join(',') === 'keepSessions,relayPort,ruleTimeoutMs', 'preview: lists each setting that would change',
    p.settings.changes.map(x => `${x.key} ${x.from}->${x.to}`).join('; '));
  ok(p.settings.changes.find(x => x.key === 'relayPort').applies === 'restart', 'preview: says which need Restart');
  ok(p.settings.problems.some(x => /surpriseKey/.test(x)) && p.settings.usable, 'preview: an unknown setting is left out, the rest usable');
  ok(p.rules.sets.length === 1 && p.rules.sets[0].rules.length === 1 && p.rules.problems.length === 1, 'preview: the rule set, with the broken rule refused');
  ok(fs.readFileSync(settingsA, 'utf8') === before && fs.readFileSync(rulesA, 'utf8') === rulesBefore, 'preview saves nothing');

  const hostile = JSON.parse(JSON.stringify(exported));
  hostile.settings.targetHost = 'api.openai.com';
  r = await H.panelPost(A, '/api/setup/import', { file: hostile, confirm: true });
  ok(r.status === 400 && fs.readFileSync(settingsA, 'utf8') === before, 'a model address off this computer: refused, nothing written', r.status);

  const elsewhere = JSON.parse(JSON.stringify(exported));
  elsewhere.settings.logsDir = '/no/such/place/logs';
  r = await H.panelPost(A, '/api/setup/import', { file: elsewhere });
  ok(r.json.settings.usable && r.json.settings.foldersInFile.includes('logsDir') && !r.json.settings.changes.some(x => x.key === 'logsDir'),
    'folder settings in the file are left out unless asked');
  r = await H.panelPost(A, '/api/setup/import', { file: elsewhere, applyFolders: true });
  ok(!r.json.settings.usable && r.json.settings.problems.some(x => /Log folder/.test(x)), 'asked for: a folder that does not exist here is refused');

  // --- import: apply -----------------------------------------------------------
  r = await H.panelPost(A, '/api/setup/import', { file: changed, rulesMode: 'skip', applySettings: false, confirm: true });
  ok(r.status === 200 && fs.readFileSync(settingsA, 'utf8') === before && fs.readFileSync(rulesA, 'utf8') === rulesBefore,
    'nothing ticked: nothing changes');
  r = await H.panelPost(A, '/api/setup/import', { file: changed, rulesMode: 'merge', confirm: true });
  const savedA = readJson(settingsA);
  ok(r.status === 200 && savedA.keepSessions === 7 && savedA.ruleTimeoutMs === 500 && savedA.relayPort === 6922 && savedA.logsDir === path.join(W, 'logs_a'),
    'applied: the settings are saved (folders untouched)');
  ok(fs.existsSync(settingsA + '.bak'), 'the previous settings.json is kept as .bak');
  const st = (await H.request({ port: A, pathName: '/api/status' })).json;
  ok(st.relay.port === PORTS.relayA && st.pendingRestart.includes('relayPort') && st.ruleTimeoutMs === 500,
    'the receiving port waits for Restart; "applies now" settings apply at once');
  const rulesAfter = readJson(rulesA);
  ok(rulesAfter.groups.length === readJson(path.join(H.TOOLS, 'contextweir', 'rules.json')).groups.length + 1
    && rulesAfter.groups.some(g => g.name === 'Imported set'), 'rule sets merged beside the existing ones');

  // --- round trip: A's setup into a fresh ContextWeir B (replace) ------------------
  const fromA = (await H.request({ port: A, pathName: '/api/setup/export' })).json;
  const settingsB = path.join(W, 'b_settings.json');
  const rulesB = path.join(W, 'b_rules.json');
  fs.writeFileSync(settingsB, JSON.stringify({ relayPort: PORTS.relayB, targetPort: PORTS.model, logsDir: path.join(W, 'logs_b') }));
  fs.writeFileSync(rulesB, JSON.stringify({ format: 'contextweir-rules', groups: [{ name: 'Old', rules: [] }] }));
  const b = await H.startTool(H.CW, { CW_SETTINGS: settingsB, CW_RULES: rulesB, CW_RUNNING: path.join(W, 'b_running.json') });
  fromA.settings.relayPort = PORTS.relayB;   // keep B on its own port
  r = await H.panelPost(b.port, '/api/setup/import', { file: fromA, rulesMode: 'replace', confirm: true });
  const exportedB = (await H.request({ port: b.port, pathName: '/api/setup/export' })).json;
  ok(r.status === 200 && noAbout(exportedB.rules) === noAbout(fromA.rules), 'round trip: B now has exactly A\'s rule sets');
  ok(Object.keys(fromA.settings).every(k => JSON.stringify(exportedB.settings[k]) === JSON.stringify(fromA.settings[k])), 'round trip: and A\'s settings');
  b.proc.kill();

  // --- the dialog, clicked ---------------------------------------------------------
  const pick = path.join(W, 'pick.json');
  const forUi = JSON.parse(JSON.stringify(exported));
  forUi.settings.keepSessions = 12;
  forUi.rules.groups = [{ name: 'From the dialog', rules: [{ name: 'Says bye', target: 'reply', test: 'contains', value: 'bye' }] }];
  fs.writeFileSync(pick, JSON.stringify(forUi));
  const br = await H.browser(PORTS.debug, W, '1100,850');
  await br.send('Page.navigate', { url: `http://127.0.0.1:${A}/panel` });
  await H.sleep(1500);
  await br.js(`document.querySelector('#tabs button[data-tab=advanced]').click()`);
  await br.js(`document.querySelector('#setupFolders').click()`);
  ok(/folders=1$/.test(await br.js(`return document.querySelector('#setupExport').getAttribute('href')`)), 'Advanced tab: ticking "include folder settings" changes the export link');
  const doc = await br.send('DOM.getDocument');
  const node = await br.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#setupFile' });
  await br.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [pick] });
  await H.sleep(1200);
  const rows = await br.js(`return document.querySelector('#setupDialog').open ? [...document.querySelectorAll('#setupPreview tr')].map(t => t.textContent) : null`);
  ok(Array.isArray(rows) && rows.some(t => /Sessions to keep.*7.*12/.test(t)), 'dialog: the preview lists the change (Sessions to keep 7 -> 12)', rows && rows.join(' | '));
  await br.js(`document.querySelector('#setupConfirm').click()`);
  await H.sleep(1200);
  ok(readJson(settingsA).keepSessions === 12 && readJson(rulesA).groups.some(g => g.name === 'From the dialog'), 'dialog: Import saves the settings and adds the set');
  ok(await br.js(`return !document.querySelector('#setupDialog').open && [...document.querySelectorAll('.setName')].some(x => x.textContent === 'From the dialog')`),
    'dialog: closes, and the Rules tab shows the new set');
  ok(br.problems.length === 0, 'no script errors or CSP violations', br.problems.join(' | '));
  br.close();

  a.proc.kill();
  mock.kill();
  c.done('setup file');
  process.exit();
})();
