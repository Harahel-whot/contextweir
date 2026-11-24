// Test-only: PromptAssay's server (19 checks). Lists ContextWeir sessions (from
// test_contextweir.js) and old logger runs, indexes and decodes requests, labels sections
// against the staged lorebooks and card, marks what is new; then the safety checks: foreign
// Host, another site's Origin, anything but GET, and four path tricks are all refused, and
// the page carries a strict Content-Security-Policy.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const PA = H.PA;
const STAGED = H.STAGED;   // run test_contextweir.js first: its cwlogs\ are read here
const SETTINGS = path.join(T, 'pa_settings.json');
fs.writeFileSync(SETTINGS, JSON.stringify({
  logDirs: [path.join(T, 'cwlogs'), path.join(STAGED, 'Wellspring/v0.8.0.3/testkit/logs')],
  worldsDir: path.join(STAGED, 'SillyTavern/data/default-user/worlds'),
  charactersDir: path.join(STAGED, 'SillyTavern/data/default-user/characters'),
}));

let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PORT = 0;   // read from the console once PromptAssay starts
const get = (p, headers = {}, method = 'GET') => new Promise(res => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, ...headers } }, x => {
    const c = []; x.on('data', d => c.push(d)); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: Buffer.concat(c).toString('utf8') }));
  });
  r.on('error', e => res({ status: 0, body: e.message })); r.end();
});

(async () => {
  const tool = await H.startTool(PA, { PA_SETTINGS: SETTINGS, PA_RUNNING: path.join(T, 'pa_running.json') });
  const pa = tool.proc; PORT = tool.port;

  let r = await get('/api/sessions');
  const ss = JSON.parse(r.body);
  const cw = ss.sessions.find(s => s.kind === 'contextweir');
  const old = ss.sessions.find(s => s.kind === 'old-logger' && s.name.includes('2026-11-20'));
  ok(!!cw && !!old, 'lists ContextWeir sessions and old logger runs', ss.sessions.length + ' sessions');
  ok(!r.body.includes(STAGED) && !r.body.includes('"dir"'), 'session list does not expose folder paths');
  ok(ss.labelling.items > 100, 'loaded lorebook and card pieces for labelling', ss.labelling.items);

  for (const s of [cw, old]) {
    r = await get('/api/session?id=' + encodeURIComponent(s.id));
    const j = JSON.parse(r.body);
    ok(r.status === 200 && j.items.length >= 33, `${s.kind}: session indexed`, `${j.items.length} requests, ${j.stats.flagged} flagged`);
    const last = j.items[j.items.length - 1];
    const mid = j.items.find(i => i.n === (s.kind === 'old-logger' ? 2657 : 2));
    r = await get(`/api/record?id=${encodeURIComponent(s.id)}&n=${mid.n}`);
    const d = JSON.parse(r.body);
    ok(r.status === 200 && d.sections.length > 10, `${s.kind}: request decoded into sections`, `${d.sections.length} sections, ${d.totals.chars} chars`);
    const labelled = d.sections.filter(x => x.contains.length);
    ok(labelled.length > 0, `${s.kind}: some sections recognised from lorebook/card`, labelled.map(x => `${x.label} -> ${x.contains.map(c => c.label).join(', ')}`).slice(0, 4).join(' | '));
    ok(d.sections.some(x => x.isNew), `${s.kind}: new sections since the previous request marked`, d.sections.filter(x => x.isNew).length);
    if (s.kind === 'old-logger') console.log('      labels:', [...new Set(d.sections.map(x => x.label))].join(' / '), '\n      entered:', d.entered.join(', ') || '-', '\n      left:', d.left.join(', ') || '-');
  }

  // safety
  r = await get('/api/sessions', { host: `attacker.example:${PORT}` });
  ok(r.status === 403, 'refuses a foreign Host (DNS rebinding)', r.status);
  r = await get('/api/sessions', { origin: 'https://evil.example' });
  ok(r.status === 403, 'refuses a request from another site', r.status);
  r = await get('/api/sessions', {}, 'POST');
  ok(r.status === 405, 'read-only', r.status);
  for (const bad of ['../../../etc/passwd', '0:../../etc', '0:session_x/../../..', '9:run_2026-11-20T17-42-53-582Z']) {
    r = await get('/api/session?id=' + encodeURIComponent(bad));
    ok(r.status === 404, `path trick refused: ${bad}`, r.status);
  }
  r = await get('/');
  ok(/script-src 'self'/.test(r.headers['content-security-policy'] || '') && r.status === 200, 'page served with a strict Content-Security-Policy');

  pa.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
