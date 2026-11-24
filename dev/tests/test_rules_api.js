// Test-only: the rules window's server side (24 checks), including hostile requests.
// Works on a copy of the shipped rules.json in rules_work\. Toggle, add, delete; a refused
// edit leaves the file untouched; writes refused with no Origin, another site, another local
// app, a foreign Host, a form post, or over 1 MB; export; import preview saves nothing;
// merge renames clashes; a hostile import (bad rules, too many sets); replace.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const CW = H.CW;
const WORK = path.join(T, 'rules_work');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK);
const RULES = path.join(WORK, 'rules.json');
fs.copyFileSync(H.CW_RULES, RULES);
const SETTINGS = path.join(WORK, 'settings.json');
fs.writeFileSync(SETTINGS, JSON.stringify({ relayPort: 6102, targetPort: 6101, logsDir: path.join(WORK, 'logs') }));

let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let UIP = 0, ORIGIN = '';   // the window's port, read from the console once it starts

function call(method, p, { body, headers = {} } = {}) {
  return new Promise(res => {
    const data = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { host: `127.0.0.1:${UIP}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port: UIP, method, path: p, headers: h }, x => {
      const c = []; x.on('data', d => c.push(d)); x.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) { } res({ status: x.statusCode, headers: x.headers, text: t, json: j }); });
    });
    r.on('error', e => res({ status: 0, text: e.message })); r.end(data);
  });
}
const fileText = () => fs.readFileSync(RULES, 'utf8');

(async () => {
  const tool = await H.startTool(CW, { CW_SETTINGS: SETTINGS, CW_RULES: RULES, CW_RUNNING: path.join(WORK, 'running.json') });
  const cw = tool.proc; UIP = tool.port; ORIGIN = `http://127.0.0.1:${UIP}`;
  const outNow = () => tool.out();

  let r = await call('GET', '/api/rules');
  ok(r.status === 200 && r.json.groups.length === 2, 'rules readable', r.json && r.json.groups.map(g => g.name).join(', '));
  const base = r.json.groups;

  // toggle a rule off through the window
  const g1 = JSON.parse(JSON.stringify(base)); g1[0].rules[1].enabled = false;
  r = await call('POST', '/api/rules', { body: { groups: g1 }, headers: { origin: ORIGIN } });
  ok(r.status === 200 && JSON.parse(fileText()).groups[0].rules[1].enabled === false, 'switching a rule off is saved to rules.json');
  ok(fs.existsSync(RULES + '.bak') && !fs.existsSync(RULES + '.tmp'), 'previous file kept as rules.json.bak; no temp file left');
  ok(JSON.parse(fileText()).groups[1].rules[0].unless.length >= 3, '"unless" conditions survive a save');

  // add a set with a rule, remove a set
  const g2 = JSON.parse(JSON.stringify(r.json.groups));
  g2.push({ name: 'My horror card', enabled: true, rules: [{ name: 'Says "suddenly"', severity: 'note', target: 'reply', test: 'contains', value: 'suddenly', note: 'cliche' }] });
  r = await call('POST', '/api/rules', { body: { groups: g2 }, headers: { origin: ORIGIN } });
  ok(r.status === 200 && r.json.groups.length === 3, 'new set with a rule saved');
  const g3 = r.json.groups.filter(g => g.name !== 'General');
  r = await call('POST', '/api/rules', { body: { groups: g3 }, headers: { origin: ORIGIN } });
  ok(r.status === 200 && !JSON.parse(fileText()).groups.some(g => g.name === 'General'), 'set deleted');

  // a bad edit is refused as a whole and nothing changes
  const before = fileText();
  const bad = JSON.parse(JSON.stringify(r.json.groups)); bad[0].rules.push({ name: 'slow', target: 'reply', test: 'regex', value: '(a+)+b' });
  r = await call('POST', '/api/rules', { body: { groups: bad }, headers: { origin: ORIGIN } });
  ok(r.status === 400 && /very slowly/.test((r.json.problems || []).join()), 'slow pattern refused with a reason');
  ok(fileText() === before, 'refused save leaves rules.json untouched');

  // writes from anywhere but the window are refused
  const good = JSON.parse(before).groups;
  for (const [desc, headers] of [
    ['no Origin (e.g. a script or curl)', {}],
    ['another site', { origin: 'https://evil.example' }],
    ['another local app (SillyTavern on :8000)', { origin: 'http://127.0.0.1:8000' }],
    ['foreign Host (DNS rebinding)', { origin: ORIGIN, host: `attacker.example:${UIP}` }],
  ]) {
    r = await call('POST', '/api/rules', { body: { groups: [] }, headers });
    ok(r.status === 403 && fileText() === before, `write refused: ${desc}`, r.status);
  }
  r = await call('POST', '/api/rules', { body: 'groups=x', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' } });
  ok(r.status === 415, 'write refused: form post (not JSON)', r.status);
  r = await call('POST', '/api/rules', { body: '{"groups":[' + '"x",'.repeat(300000) + '"x"]}', headers: { origin: ORIGIN } });
  ok((r.status === 413 || r.status === 0) && fileText() === before, 'write refused: over 1 MB', r.status);

  // export
  r = await call('GET', '/api/rules/export?set=Wellspring');
  ok(r.status === 200 && /attachment; filename="contextweir-rules_Wellspring.json"/.test(r.headers['content-disposition'] || '') && r.json.groups.length === 1, 'export one set as a file');
  const exported = r.json;
  r = await call('GET', '/api/rules/export');
  ok(r.status === 200 && r.json.groups.length === JSON.parse(fileText()).groups.length, 'export all sets');
  r = await call('GET', '/api/rules/export?set=' + encodeURIComponent('../../etc'));
  ok(r.status === 404, 'export of an unknown set refused', r.status);

  // import: preview changes nothing; merge renames clashes; replace swaps
  r = await call('POST', '/api/rules/import', { body: { file: exported, mode: 'merge' }, headers: { origin: ORIGIN } });
  ok(r.status === 200 && r.json.preview && fileText() === before, 'import preview shows sets and saves nothing', r.json && r.json.sets.map(s => s.name).join());
  r = await call('POST', '/api/rules/import', { body: { file: exported, mode: 'merge', confirm: true }, headers: { origin: ORIGIN } });
  const names = JSON.parse(fileText()).groups.map(g => g.name);
  ok(r.status === 200 && names.includes('Wellspring (imported)'), 'merge import adds the set, renaming the clash', names.join(', '));
  const hostile = { format: 'contextweir-rules', groups: [
    { name: 'Hostile', rules: [
      { name: 'run code', target: 'reply', test: 'eval', value: 'require("child_process")' },
      { name: 'slow', target: 'reply', test: 'regex', value: '(\\w*)*$' },
      { name: 'huge', target: 'reply', test: 'contains', value: 'x'.repeat(1000) },
      { name: 'odd target', target: 'filesystem', test: 'contains', value: 'C:\\' },
      { name: 'fine one', target: 'reply', test: 'contains', value: 'hello', __proto__: { polluted: true } },
    ] },
    ...Array.from({ length: 80 }, (_, i) => ({ name: 'spam ' + i, rules: [] })),
  ] };
  r = await call('POST', '/api/rules/import', { body: { file: hostile, mode: 'replace' }, headers: { origin: ORIGIN } });
  const probs = (r.json && r.json.problems) || [];
  ok(r.status === 200 && probs.length === 4 && r.json.sets[0].rules.length === 1, 'hostile import: 4 bad rules refused with reasons, the fine one kept', probs.length);
  ok(r.json.sets.length <= 50, 'hostile import: number of sets capped at 50', r.json.sets.length);
  r = await call('POST', '/api/rules/import', { body: { file: exported, mode: 'replace', confirm: true }, headers: { origin: ORIGIN } });
  ok(r.status === 200 && JSON.parse(fileText()).groups.length === 1, 'replace import swaps the whole rule set');
  r = await call('POST', '/api/rules/import', { body: { file: exported, mode: 'merge', confirm: true }, headers: { origin: 'http://localhost:8000' } });
  ok(r.status === 403, 'import refused from another local app', r.status);

  // the relay uses the new rules straight away (no restart)
  ok(/rules saved from the window/.test(outNow()) && /rules imported \(replace\)/.test(outNow()), 'console reports saves and imports');

  cw.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
