// Test-only: text completion (ContextWeir 0.5.6.0, PromptAssay 0.4.0.0; design in
// tools_text_completion.txt).
// The splitter (promptassay\lib\text_prompt.js) on its own:
//   - lossless: the sections join back to the prompt exactly, for every template and on 1,000
//     random cuts of the demo's prompts
//   - each built-in template takes a made-up chat apart into the right roles
//   - a marker inside a known piece (a lorebook entry) does not split; one a player types does
//   - no template and no names: one block; names only: split at the names
//   - caps: 5,000 sections; a 2 MB prompt of markers finishes in under a second
//   - hostile preset files are skipped; SillyTavern presets are read
// ContextWeir: every generation address is recorded (text and KoboldCpp's own API included), each
// reply shape is read, an unknown generation address is counted and noted (CW-ENDPOINT-UNKNOWN),
// and in text mode lastMessage is the end of the prompt.
// PromptAssay: the made-up text-completion demo is taken apart like the chat one (same labels,
// same entries entering and leaving, same kinds), chat sessions answer exactly as 0.3.6.0 did
// apart from the new fields, and the page says how the prompt was split and shows it as one block.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'text_work');
const c = H.counter(), ok = c.ok;
const TP = require(path.join(H.TOOLS, 'promptassay', 'lib', 'text_prompt.js'));
const DEMO = path.join(H.TOOLS, 'demo');
const ORIG = process.env.WS_ORIG || path.join(H.TOOLS, '..', 'tools_orig');   // the version before (0.3.6.0)
const PORTS = { model: 7101, relay: 7102 };

const joined = (p, r) => r.sections.map(s => p.slice(s.start, s.end)).join('');
const roles = r => r.sections.map(s => s.role).join(',');

// A made-up chat written out in a template's markers.
function chatIn(t, withSystem = true) {
  const sys = t.system[0] && withSystem ? `${t.system[0]}\nYou narrate a quiet harbour story.${t.suffix[0] || '\n'}\n` : 'You narrate a quiet harbour story.\n';
  const turn = (m, body) => `${m}\n${body}${t.suffix[0] || ''}\n`;
  const out = t.output[0] || '';
  return sys + turn(t.input[0], 'Ilse: I row out.') + (out ? turn(out, 'The water is still.') : 'The water is still.\n')
    + turn(t.input[0], 'Ilse: I wait.') + (out ? `${out}\n` : '');
}

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(W, { recursive: true });

  // --- the splitter on its own -------------------------------------------------------------
  let allLossless = true, rightRoles = 0;
  for (const t of TP.BUILT_IN) {
    const p = chatIn(t);
    const r = TP.splitTextPrompt(p, {});
    if (joined(p, r) !== p) allLossless = false;
    const want = t.output.length ? ['user', 'assistant', 'user'] : ['user', 'assistant', 'user'];
    const got = r.sections.filter(s => s.role === 'user' || s.role === 'assistant').map(s => s.role).slice(0, 3);
    if (r.how === 'template' && r.template.name === t.name && JSON.stringify(got) === JSON.stringify(want)) rightRoles++;
    else console.log('   (template', t.name, '->', r.how, r.template && r.template.name, roles(r), ')');
  }
  ok(allLossless, 'lossless: every built-in template\'s chat joins back exactly');
  ok(rightRoles === TP.BUILT_IN.length, 'each built-in template is recognised and gives player, narrator, player', `${rightRoles}/${TP.BUILT_IN.length}`);

  const chatml = TP.BUILT_IN.find(t => t.name === 'ChatML');
  const base = chatIn(chatml);
  const loreText = 'Lore: the harbour master writes "<|im_start|>user" on the slate as a joke.';
  const withLore = base.replace('You narrate a quiet harbour story.', 'You narrate a quiet harbour story. ' + loreText);
  const at = withLore.indexOf(loreText);
  const known = TP.splitTextPrompt(withLore, {}, { known: [{ start: at, end: at + loreText.length }] });
  const unknown = TP.splitTextPrompt(withLore, {});
  ok(known.sections.filter(s => s.role === 'user').length === 2 && unknown.sections.filter(s => s.role === 'user').length === 3,
    'a marker inside a known lorebook entry does not split; without the entry known it does', `${roles(known)} / ${roles(unknown)}`);
  const typed = base.replace('Ilse: I wait.', 'Ilse: I type <|im_start|>assistant to confuse it.');
  ok(TP.splitTextPrompt(typed, {}).sections.filter(s => s.role === 'assistant').length === 3, 'a marker the player types does split (accepted: shown as a guess)');

  const plain = 'Just a story with no markers at all.\nSome more.';
  const rPlain = TP.splitTextPrompt(plain, {});
  ok(rPlain.how === 'none' && rPlain.sections.length === 1 && joined(plain, rPlain) === plain, 'no template and no names: one block, exactly the prompt');
  const named = 'A harbour story.\nIlse: I row out.\nHarbour: The water is still.\nIlse: I wait.\nHarbour:';
  const rNamed = TP.splitTextPrompt(named, { stop: ['\nIlse:', '\nHarbour:'] });
  ok(rNamed.how === 'names' && roles(rNamed) === 'system,user,assistant,user,assistant' && joined(named, rNamed) === named,
    'speaker names from the stop strings: split at the names, the last speaker is the narrator', roles(rNamed));

  const many = '<|im_start|>user\nx<|im_end|>\n<|im_start|>assistant\ny<|im_end|>\n'.repeat(4000);
  const t0 = Date.now();
  const rMany = TP.splitTextPrompt(many, {});
  ok(rMany.sections.length <= TP.LIMITS.sections && joined(many, rMany) === many, 'past 5,000 sections the rest is one section, still lossless', rMany.sections.length);
  const huge = '<|im_start|>user\n'.repeat(120000);   // about 2 MB of markers
  const rHuge = TP.splitTextPrompt(huge, {});
  const ms = Date.now() - t0;
  ok(ms < 1500 && joined(huge, rHuge) === huge, 'a 2 MB prompt of markers (and the 8,000-turn one) finish quickly', ms + ' ms');

  ok(TP.splitTextPrompt(null, null).sections.length === 1 && TP.splitTextPrompt(42, { stop: 7 }).how === 'none'
    && TP.splitTextPrompt('x', { stop: [{ toString: 1 }] }).how === 'none', 'odd input: never throws, one section');

  // SillyTavern presets: a ChatML-style preset with macros; hostile ones skipped.
  const preset = TP.templateFromPreset({ name: 'My ChatML', input_sequence: '<|im_start|>{{user}}', output_sequence: '<|im_start|>{{char}}\n',
    system_sequence: '<|im_start|>system', input_suffix: '<|im_end|>\n', output_suffix: '<|im_end|>\n', stop_sequence: '' }, 'a.json');
  ok(preset && preset.input[0] === '<|im_start|>' && preset.suffix.includes('<|im_end|>'), 'a preset with macros becomes markers (macro parts cut away)', JSON.stringify(preset && preset.input));
  const hostile = [null, [], 'text', { input_sequence: { toString: 1 } }, { input_sequence: 'x'.repeat(5000), output_sequence: 'y'.repeat(5000) },
    { name: { a: 1 }, input_sequence: ['a'], output_sequence: 7 }];
  ok(hostile.every(h => TP.templateFromPreset(h, 'h.json') === null), 'hostile or empty presets are skipped (null), never a crash');
  const tenK = Array.from({ length: 10000 }, (_, i) => ({ name: 'p' + i, input_sequence: `<in${i}>`, output_sequence: `<out${i}>` }))
    .map(j => TP.templateFromPreset(j, 'x.json'));
  const t1 = Date.now();
  TP.splitTextPrompt(base, {}, { templates: tenK });
  ok(Date.now() - t1 < 2000, '10,000 presets passed in are capped (200 used), still quick', (Date.now() - t1) + ' ms');

  // Findings of the security re-check (25 Nov), replayed.
  const pairs = '<|im_start|>user\nx\n<|im_start|>assistant\ny\n'.repeat(2500) + 'z'.repeat(1000000);
  let t2 = Date.now();
  const rPairs = TP.splitTextPrompt(pairs, {});
  ok(Date.now() - t2 < 1000 && joined(pairs, rPairs) === pairs, 're-check 1: 5,000 markers with no suffix and 1 MB after them: quick, lossless', (Date.now() - t2) + ' ms');
  const knownMany = Array.from({ length: 20000 }, (_, i) => ({ start: i * 100, end: i * 100 + 50 }));
  const big = ('<|im_start|>user\n' + 'w'.repeat(33) + '<|im_start|>assistant\n' + 'v'.repeat(28)).repeat(20000);
  const knownInside = Array.from({ length: 20000 }, (_, i) => ({ start: i * 100 + 2, end: i * 100 + 12 }));   // over every user marker
  t2 = Date.now();
  const rBig = TP.splitTextPrompt(big, { stop: ['\nIlse:', '\nHarbour:'] }, { known: knownInside });
  const rBig2 = TP.splitTextPrompt(big, {}, { known: knownMany });
  ok(Date.now() - t2 < 1500 && joined(big, rBig) === big && joined(big, rBig2) === big,
    're-check 2: a 2 MB prompt with 20,000 known pieces over or between 40,000 markers: quick, lossless', (Date.now() - t2) + ' ms, ' + rBig2.how);
  ok(['e', ':', '{{char}}:', 'ab', 'User', '  '].every(m => TP.templateFromPreset({ input_sequence: m, output_sequence: m }, 'x.json') === null)
    && TP.templateFromPreset({ input_sequence: 'USER:', output_sequence: 'ASSISTANT:' }, 'x.json') !== null,
  're-check 3: one- and two-character or plain-word markers are refused ("{{char}}:" no longer becomes ":")');
  const oneCharPresets = Array.from({ length: 200 }, (_, i) => ({ name: 'p' + i, source: 'SillyTavern preset', input: ['<<<' + i], output: ['>>>' + i], system: [], suffix: [] }));
  const noFit = 'plain text with no markers '.repeat(8000);
  t2 = Date.now();
  for (let i = 0; i < 20; i++) TP.splitTextPrompt(noFit, {}, { templates: oneCharPresets });
  ok(Date.now() - t2 < 2000, 're-check 3: 200 presets that never fit, 20 requests of 216 KB: quick (cheap first look)', (Date.now() - t2) + ' ms');

  // Lossless on 1,000 random cuts of the demo's text prompts.
  const textRecs = fs.readFileSync(path.join(DEMO, 'logs', 'session_2026-01-02T10-00-00-000Z', 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  let cutsOk = 0;
  for (let i = 0; i < 1000; i++) {
    const p = textRecs[i % textRecs.length].request.prompt;
    const a = (i * 7919) % p.length, b = Math.min(p.length, a + 1 + (i * 104729) % 3000);
    const piece = p.slice(a, b);
    if (joined(piece, TP.splitTextPrompt(piece, textRecs[0].request)) === piece) cutsOk++;
  }
  ok(cutsOk === 1000, 'lossless on 1,000 random cuts of the demo prompts', cutsOk);

  // Re-check 5: a 16 MB reply of tiny JSON lines is read quickly (at most 100,000 objects).
  {
    const src = fs.readFileSync(path.join(H.TOOLS, 'contextweir', 'contextweir.js'), 'utf8');
    const a = src.indexOf('const REPLY_READERS'), b2 = src.indexOf('// "chat" (a list of messages)');
    const reader = new Function(src.slice(a, b2) + ';return extractReplyShaped;')();
    const flood = '{}\n'.repeat(5500000);
    const t3 = Date.now();
    const r = reader(flood);
    ok(Date.now() - t3 < 1500 && typeof r.text === 'string', 're-check 5: a 16 MB reply of tiny JSON lines is read quickly', (Date.now() - t3) + ' ms, shape ' + r.shape);
  }

  // --- ContextWeir: addresses, reply shapes, the unknown-address note ----------------------
  const SHAPES = {
    '/v1/completions': () => JSON.stringify({ choices: [{ text: 'openai text reply' }] }),
    '/api/v1/generate': () => JSON.stringify({ results: [{ text: 'kobold reply' }] }),
    '/api/extra/generate/stream': () => 'event: message\ndata: {"token": "kob"}\n\nevent: message\ndata: {"token": "old stream"}\n\n',
    '/completion': () => JSON.stringify({ content: 'llama reply', stop: true }),
    '/api/generate': () => '{"response":"oll","done":false}\n{"response":"ama reply","done":true}\n',
    '/custom/generate': () => JSON.stringify({ choices: [{ text: 'never recorded' }] }),
  };
  const mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const p = req.url.split('?')[0];
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
      res.writeHead(200, { 'Content-Type': p.includes('stream') ? 'text/event-stream' : 'application/json' });
      res.end((SHAPES[p] || (() => '{}'))());
    });
  }).listen(PORTS.model, '127.0.0.1');
  process.on('exit', () => mock.close());

  const rulesFile = path.join(W, 'rules.json');
  fs.copyFileSync(path.join(H.TOOLS, 'contextweir', 'rule_sets', 'wellspring.json'), rulesFile);
  const settingsFile = path.join(W, 'cw.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ relayPort: PORTS.relay, targetPort: PORTS.model, logsDir: path.join(W, 'logs'), showStartScreen: false }));
  const cw = await H.startTool(H.CW, { CW_SETTINGS: settingsFile, CW_RULES: rulesFile, CW_RUNNING: path.join(W, 'cw_running.json') });
  process.on('exit', () => { try { cw.proc.kill(); } catch (_) { /* gone */ } });
  await H.waitFor(cw, /recording:/);
  const post = (p, body) => H.request({ port: PORTS.relay, method: 'POST', pathName: p, body });
  const textBody = (extra = '') => ({ prompt: '<|im_start|>user\nIlse: hello' + extra + '<|im_end|>\n<|im_start|>assistant\n', max_tokens: 20 });
  const replies = {};
  for (const p of Object.keys(SHAPES)) replies[p] = (await post(p, textBody())).body;
  await post('/custom/generate', textBody());   // a second unknown one: noted once only
  // A script request in text mode, its reply without a status line: the Wellspring rule must skip it.
  await post('/v1/completions?x=1', { prompt: 'story...\n<|im_start|>system\n[Private system request: write the day notes]<|im_end|>\n<|im_start|>assistant\n' });
  await H.sleep(700);

  const sessDir = path.join(W, 'logs', fs.readdirSync(path.join(W, 'logs')).find(n => n.startsWith('session_')));
  const recs = fs.readFileSync(path.join(sessDir, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const summary = JSON.parse(fs.readFileSync(path.join(sessDir, 'summary.json'), 'utf8'));
  ok(Object.values(replies).every(b => b.length > 2), 'every reply passed through to the frontend unchanged (recorded or not)');
  const byPath = p => recs.find(r => r.endpoint.split('?')[0] === p);
  ok(['/v1/completions', '/api/v1/generate', '/api/extra/generate/stream', '/completion', '/api/generate'].every(byPath) && !byPath('/custom/generate'),
    'recorded: text completion, KoboldCpp\'s own API (both), llama.cpp, Ollama; the unknown address not recorded', recs.map(r => r.endpoint).join(' '));
  const shapeOk = [['/v1/completions', 'openai', 'openai text reply'], ['/api/v1/generate', 'kobold', 'kobold reply'],
    ['/api/extra/generate/stream', 'kobold', 'kobold stream'], ['/completion', 'llamacpp', 'llama reply'], ['/api/generate', 'ollama', 'ollama reply']]
    .filter(([p, shape, text]) => byPath(p) && byPath(p).replyShape === shape && byPath(p).reply === text);
  ok(shapeOk.length === 5, 'each reply shape is read (replyShape openai / kobold / llamacpp / ollama) and the text taken out', recs.map(r => `${r.replyShape}:${r.reply}`).join(' | '));
  ok(recs.every(r => r.mode === 'text') && summary.textRequests === recs.length, 'records say mode "text"; the summary counts text requests', summary.textRequests);
  ok(summary.unrecognised === 2, 'two generation requests to an unknown address are counted (summary "unrecognised")', summary.unrecognised);
  const errs = (await H.request({ port: cw.port, pathName: '/api/errors' })).json;
  const notes = (errs.recent || []).filter(e => e.code === 'CW-ENDPOINT-UNKNOWN');
  ok(notes.length === 1 && /^\/custom\/\.\.\. \(2 parts\)$/.test(notes[0].detail || ''), 'noted once per session as CW-ENDPOINT-UNKNOWN, with only the first part of the address', JSON.stringify(notes));
  ok(/CW-ENDPOINT-UNKNOWN/.test(cw.out()), 'and said in the console');
  const script = recs.find(r => /Private system request/.test(r.request.prompt));
  ok(script && !script.flags.some(f => f.name === 'No status line'), 'text mode: the Wellspring rule set skips a script request (its "contains" line on the last message)');
  const story = recs.find(r => r.endpoint === '/v1/completions');
  ok(story.flags.some(f => f.name === 'No status line'), 'text mode: a story reply without a status line is still flagged');
  cw.proc.kill();
  mock.close();

  // --- PromptAssay on the text demo, against the chat demo ---------------------------------
  fs.mkdirSync(path.join(W, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [path.join(W, 'empty')] }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  process.on('exit', () => { try { pa.proc.kill(); } catch (_) { /* gone */ } });
  const P = pa.port;
  const get = async p => (await H.request({ port: P, pathName: p })).json;
  const list = await get('/api/sessions');
  const chatId = 'demo:session_2026-01-01T10-00-00-000Z', textId = 'demo:session_2026-01-02T10-00-00-000Z';
  ok(list.sessions.some(s => s.id === textId), 'the text-completion demo is listed');
  const chatS = await get('/api/session?id=' + encodeURIComponent(chatId));
  const textS = await get('/api/session?id=' + encodeURIComponent(textId));
  ok(textS.items.length === 12 && textS.items.every(i => i.mode === 'text') && chatS.items.every(i => i.mode === 'chat'), 'twelve text requests, marked as text');
  ok(JSON.stringify(textS.items.map(i => i.kind)) === JSON.stringify(chatS.items.map(i => i.kind)) && textS.items[5].kind === 'summary',
    'the same kinds as the chat demo (Summarize at #6 recognised in text mode)', textS.items.map(i => i.kind[0]).join(''));
  ok(textS.items[0].player === 'Wren: I shoulder my bag and start up the salt steps toward the lighthouse.', 'the turn list shows the player\'s line', textS.items[0].player);

  const rec = async (id, n) => get(`/api/record?id=${encodeURIComponent(id)}&n=${n}`);
  let sameEntries = 0, sameChanges = 0, exact = 0, tried = 0, splitOk = 0;
  const lore = JSON.parse(fs.readFileSync(path.join(DEMO, 'worlds', 'Lantern Coast.json'), 'utf8'));
  for (let n = 1; n <= 12; n++) {
    const a = await rec(chatId, n), b = await rec(textId, n);
    const ents = d => [...new Set(d.sections.flatMap(s => s.contains.map(x => x.label)))].sort().join('|');
    if (ents(a) === ents(b)) sameEntries++; else console.log('   entries differ at', n, ents(a), '//', ents(b));
    if (JSON.stringify(a.entered.sort()) === JSON.stringify(b.entered.sort()) && JSON.stringify(a.left.sort()) === JSON.stringify(b.left.sort())) sameChanges++;
    else console.log('   changes differ at', n, a.entered, a.left, '//', b.entered, b.left);
    if (b.mode === 'text' && b.textSplit && b.textSplit.how === 'template' && b.textSplit.template.name === 'ChatML'
      && b.sections.map(s => s.text).join('') === (JSON.parse(fs.readFileSync(path.join(DEMO, 'logs', 'session_2026-01-02T10-00-00-000Z', 'records.jsonl'), 'utf8').trim().split('\n')[n - 1])).request.prompt) splitOk++;
    for (const s of b.sections) for (const x of s.contains) {
      const entry = Object.values(lore.entries).find(e => `Lantern Coast: ${e.comment}` === x.label);
      if (!entry || /\{\{/.test(entry.content)) continue;
      tried++;
      if (x.span && s.text.slice(x.span.start, x.span.end) === entry.content) exact++;
    }
  }
  ok(splitOk === 12, 'every text request: split by the ChatML template, sections join back to the prompt exactly', splitOk);
  ok(sameEntries === 12, 'the same lorebook entries and card fields recognised as in the chat demo, request by request', sameEntries);
  ok(sameChanges === 12, 'the same entries entering and leaving as in the chat demo (the diff works in text mode)', sameChanges);
  ok(tried > 10 && exact === tried, 'every entry cut out character for character inside the text sections', `${exact}/${tried}`);
  const r2 = await rec(textId, 2);
  const labelsOf = d => d.sections.map(s => s.label);
  ok(labelsOf(r2).some(l => /^Player \(newest\) \(by template\)/.test(l)) && labelsOf(r2).some(l => /^Narrator \(by template\)/.test(l))
    && labelsOf(r2)[labelsOf(r2).length - 1] === 'Reply start (by template)' && /^System prompt/.test(labelsOf(r2)[0]),
  'labels: system prompt, narrator and player "(by template)", the reply start last', labelsOf(r2).join(' / '));
  const playerSec = r2.sections.find(s => /^Player \(newest\)/.test(s.label));
  ok(playerSec.wrap.length === 2 && playerSec.text.slice(playerSec.wrap[0].start, playerSec.wrap[0].end) === '<|im_start|>user'
    && playerSec.text.slice(playerSec.wrap[1].start, playerSec.wrap[1].end) === '<|im_end|>' && playerSec.name === 'Wren',
  'the player section carries its markers as wrap ranges, and the speaker name');
  ok((await rec(textId, 3)).sections.filter(s => s.isNew).length <= 2, 'the swipe at #3: almost nothing new (markers do not make old turns look new)');

  // --- chat sessions answer exactly as 0.3.6.0 did (apart from the new fields) ------------
  if (fs.existsSync(path.join(ORIG, 'promptassay', 'promptassay.js'))) {
    const cfg = { logDirs: [path.join(H.T, 'cwlogs'), H.OLD_LOGS], worldsDir: H.WORLDS, charactersDir: H.CHARACTERS, showDemo: true };
    fs.writeFileSync(path.join(W, 'cmp.json'), JSON.stringify(cfg));
    const env = n => ({ PA_SETTINGS: path.join(W, 'cmp.json'), PA_RUNNING: path.join(W, `cmp_${n}.json`) });
    const oldPa = await H.startTool(path.join(ORIG, 'promptassay', 'promptassay.js'), env('old'));
    const newPa = await H.startTool(H.PA, env('new'));
    process.on('exit', () => { for (const t of [oldPa, newPa]) { try { t.proc.kill(); } catch (_) { /* gone */ } } });
    const g = async (port, p) => (await H.request({ port, pathName: p })).json;
    const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (['mode', 'textSplit', 'replyShape'].includes(k) ? undefined : v)));
    const sess = (await g(oldPa.port, '/api/sessions')).sessions.filter(s => s.id !== textId);
    let compared = 0, differ = [];
    for (const s of sess) {
      const a = await g(oldPa.port, '/api/session?id=' + encodeURIComponent(s.id));
      const b = await g(newPa.port, '/api/session?id=' + encodeURIComponent(s.id));
      if (JSON.stringify(strip(a)) !== JSON.stringify(strip(b))) differ.push(s.id + ' (list)');
      for (const item of a.items.slice(0, 40)) {
        const ra = await g(oldPa.port, `/api/record?id=${encodeURIComponent(s.id)}&n=${item.n}`);
        const rb = await g(newPa.port, `/api/record?id=${encodeURIComponent(s.id)}&n=${item.n}`);
        compared++;
        if (JSON.stringify(strip(ra)) !== JSON.stringify(strip(rb))) differ.push(`${s.id} #${item.n}`);
      }
    }
    ok(compared > 50 && differ.length === 0, 'chat sessions: every answer identical to 0.3.6.0 apart from the new fields', `${compared} requests; ${differ.slice(0, 5).join(', ') || 'no differences'}`);
    oldPa.proc.kill(); newPa.proc.kill();
  } else {
    ok(false, 'chat sessions identical to 0.3.6.0', 'the old version (tools_orig) was not found: set WS_ORIG');
  }

  // --- the page ----------------------------------------------------------------------------
  const b = await H.browser(9371, W, '1300,850');
  await b.send('Page.navigate', { url: `http://127.0.0.1:${P}/?session=${encodeURIComponent(textId)}&n=2` });
  await H.sleep(2500);
  const line = await b.js(`const e = document.querySelector('.textsplit'); return e ? e.textContent : ''`);
  ok(/split by the ChatML template \(built-in\)/.test(line) && /a guess/.test(line), 'the page says how the prompt was split, and that it is a guess', line.slice(0, 120));
  ok(await b.js(`return document.querySelectorAll('.marker').length`) > 0, 'template markers are shown dimmed');
  await b.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' })); return 1`);
  await H.sleep(800);
  ok(/as sent/.test(await b.js(`return [...document.querySelectorAll('details.sec .lbl')].map(e => e.textContent).join('|')`)),
    'key B shows the prompt as one block, as sent');
  ok(b.problems.length === 0, 'no script errors or CSP violations', b.problems.join(' | '));
  b.close();
  pa.proc.kill();

  c.done('text completion');
  process.exit();
})();
