// Test-only: the made-up demo session (tools\demo\, made by dev\make_demo.js).
// It must be invented through and through: no Wellspring words and no stretch of text from the
// real lorebook or the real logs. make_demo.js must reproduce the shipped files byte for byte.
// PromptAssay lists it last, marked as a demo, labels it against the demo's own card and
// lorebook (never the user's folders), finds what each request is meant to show (entries
// entering and leaving, a swipe, Summarize, a model change, the flags), and hides it when
// showDemo is false. Its rule set imports cleanly into ContextWeir. The page shows it.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'demo_work');
const DEMO = path.join(H.TOOLS, 'demo');
const c = H.counter(), ok = c.ok;

const allFiles = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(path.join(W, 'empty'), { recursive: true });

  // --- the files, and that they are made up ------------------------------------------
  const files = allFiles(DEMO).map(f => path.relative(DEMO, f).replace(/\\/g, '/')).sort();
  ok(['README.md', 'characters/Lantern Coast.json', 'rules/lantern_coast_rules.json', 'worlds/Lantern Coast.json',
    'logs/session_2026-01-01T10-00-00-000Z/records.jsonl', 'logs/session_2026-01-01T10-00-00-000Z/summary.json'].every(f => files.includes(f)),
  'the demo folder holds the card, lorebook, rule set, session and README', files.length + ' files');

  const demoText = allFiles(DEMO).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const banned = ['Wellspring:', 'Oculum', 'Hlinova', 'sealed Core', 'Fairweather', 'Sounding', '[Time:'];
  ok(!banned.some(w => demoText.includes(w)), 'no Wellspring words in the demo', banned.filter(w => demoText.includes(w)).join(', ') || 'none');

  // Every 40-character stretch of the real lorebook, and of the 33 real turns' replies: none may appear.
  const realLore = JSON.parse(fs.readFileSync(path.join(H.WORLDS, 'Wellspring.json'), 'utf8'));
  const stretches = new Set();
  const addStretches = t => { for (let i = 0; i + 40 <= t.length; i += 40) stretches.add(t.slice(i, i + 40)); };
  for (const e of Object.values(realLore.entries)) addStretches(String(e.content || ''));
  for (const f of fs.readdirSync(H.TURNS)) addStretches(String(JSON.parse(fs.readFileSync(path.join(H.TURNS, f), 'utf8')).reply || ''));
  const leaked = [...stretches].filter(s => demoText.includes(s));
  ok(stretches.size > 1000 && leaked.length === 0, 'no 40-character stretch of the real lorebook or real replies appears in the demo', `${stretches.size} stretches checked`);

  // make_demo.js reproduces the shipped files byte for byte (built in a copy, so nothing shipped is touched).
  const copy = path.join(W, 'tools');
  fs.mkdirSync(path.join(copy, 'contextweir', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'dev'), { recursive: true });
  fs.copyFileSync(path.join(H.TOOLS, 'contextweir', 'lib', 'rules_engine.js'), path.join(copy, 'contextweir', 'lib', 'rules_engine.js'));
  fs.copyFileSync(path.join(H.TOOLS, 'dev', 'make_demo.js'), path.join(copy, 'dev', 'make_demo.js'));
  spawnSync(process.execPath, [path.join(copy, 'dev', 'make_demo.js'), copy], { encoding: 'utf8' });
  const differs = files.filter(f => !fs.existsSync(path.join(copy, 'demo', f))
    || !fs.readFileSync(path.join(copy, 'demo', f)).equals(fs.readFileSync(path.join(DEMO, f))));
  ok(differs.length === 0, 'make_demo.js reproduces the shipped demo byte for byte', differs.join(', ') || 'identical');

  // The rule set is a valid rule file for ContextWeir.
  const { validateRules } = require(path.join(H.TOOLS, 'contextweir', 'lib', 'rules_engine.js'));
  const checked = validateRules(JSON.parse(fs.readFileSync(path.join(DEMO, 'rules', 'lantern_coast_rules.json'), 'utf8')), 'demo');
  ok(checked.problems.length === 0 && checked.groups.length === 2, 'the demo rule set imports into ContextWeir with no problems');

  // --- PromptAssay: listed, labelled from its own files, showing what it should ------------
  // The user's own lorebook folder is set too: the demo must still be labelled from the demo's files only.
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [path.join(W, 'empty')], worldsDir: H.WORLDS, charactersDir: H.CHARACTERS }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  const P = pa.port;
  const get = async p => (await H.request({ port: P, pathName: p })).json;
  const list = await get('/api/sessions');
  const demo = list.sessions.find(s => s.demo);
  ok(demo && demo.id === 'demo:session_2026-01-01T10-00-00-000Z' && !('dir' in demo), 'listed as a demo session (and no folder path sent)');

  const sess = await get('/api/session?id=' + encodeURIComponent(demo.id));
  ok(sess.items.length === 12 && sess.stats.flagged === 3, 'twelve requests, three of them flagged', `${sess.items.length}, ${sess.stats.flagged}`);
  ok(sess.versions.demo === true && sess.versions.sillyTavernNow === null && JSON.stringify(sess.versions.modelChanges) === '[8]',
    'versions: marked demo, no "installed now", the model change at #8');
  ok(sess.items[2].swipe && sess.items[5].kind === 'summary' && sess.items[9].swipe, 'a swipe at #3, Summarize at #6, a regenerate at #10');

  const rec = async n => get(`/api/record?id=${encodeURIComponent(demo.id)}&n=${n}`);
  const labels = d => d.sections.flatMap(s => s.contains.map(x => x.label));
  const r1 = await rec(1);
  ok(labels(r1).includes('Lantern Coast: [Place] The Salt Steps') && labels(r1).some(l => /^Card The Lantern Coast: description/.test(l)),
    '#1: the Salt Steps entry and the card description are recognised');
  ok(!labels(r1).some(l => l.startsWith('Wellspring')), "the demo is labelled only from the demo's own files", r1.libraryLoaded + ' pieces');
  ok((await rec(4)).entered.includes('Lantern Coast: [Lore] The Drowned Bell'), '#4: the Drowned Bell enters');
  ok(labels(await rec(7)).includes('Summary (SillyTavern Summarize)'), '#7: the summary sits in the prompt');
  const r11 = await rec(11);
  ok(r11.entered.includes('Lantern Coast: [Person] Tamsin the ferrywoman') && r11.left.includes('Lantern Coast: [Person] Keeper Odile Marsh'),
    '#11: Tamsin enters, Odile leaves');
  ok((await rec(9)).flags.some(f => f.name === 'Empty reply' && f.severity === 'serious'), '#9: the empty reply is flagged serious');

  // Every lorebook entry the demo uses is cut out exactly (the ones without macros, character for character).
  const lore = JSON.parse(fs.readFileSync(path.join(DEMO, 'worlds', 'Lantern Coast.json'), 'utf8'));
  let exact = 0, tried = 0;
  for (let n = 1; n <= 12; n++) {
    const d = await rec(n);
    for (const s of d.sections) for (const x of s.contains) {
      const entry = Object.values(lore.entries).find(e => `Lantern Coast: ${e.comment}` === x.label);
      if (!entry || /\{\{/.test(entry.content)) continue;
      tried++;
      if (x.span && s.text.slice(x.span.start, x.span.end) === entry.content) exact++;
    }
  }
  ok(tried > 10 && exact === tried, 'every demo lorebook entry is cut out character for character', `${exact}/${tried}`);

  // The page.
  const b = await H.browser(9361, W, '1300,850');
  await b.send('Page.navigate', { url: `http://127.0.0.1:${P}/` });
  await H.sleep(2000);
  ok(/demo \(made up\)/.test(await b.js(`return document.querySelector('#session').selectedOptions[0].textContent`)),
    'the page opens the demo (the only session) and names it as made up');
  ok(/made-up session/.test(await b.js(`return document.querySelector('#versions').textContent`)), 'the versions line says it is a demo');
  ok(b.problems.length === 0, 'no script errors or CSP violations', b.problems.join(' | '));
  b.close();
  pa.proc.kill();

  // Hidden when showDemo is false.
  fs.writeFileSync(path.join(W, 'pa2.json'), JSON.stringify({ logDirs: [path.join(W, 'empty')], showDemo: false }));
  const pa2 = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa2.json'), PA_RUNNING: path.join(W, 'pa2_running.json') });
  ok((await H.request({ port: pa2.port, pathName: '/api/sessions' })).json.sessions.length === 0, 'showDemo false: not listed');
  pa2.proc.kill();

  c.done('demo');
  process.exit();
})();
