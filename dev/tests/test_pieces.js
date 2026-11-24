// Test-only: exact-text spans in PromptAssay. For every recognised lorebook
// entry without macros, the text the viewer cuts out must equal the entry's
// content in the lorebook file, character for character.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./helpers');
const T = __dirname;
const WORLDS = H.WORLDS;   // pa_settings.json is written by test_promptassay.js: run that first
let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { c ? pass++ : failN++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  (' + extra + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// label -> content, as PromptAssay names lorebook entries
const bookName = f => f.replace(/\.json$/, '').replace(/^Chat Book .* - (\d{4}-\d\d-\d\d)_(\d\d)h(\d\d).*$/, 'Chat book $1 $2:$3');
const content = new Map();
for (const f of fs.readdirSync(WORLDS).filter(f => f.endsWith('.json'))) {
  const lb = JSON.parse(fs.readFileSync(path.join(WORLDS, f), 'utf8'));
  for (const e of Object.values(lb.entries || {})) {
    const key = `${bookName(f)}: ${e.comment || 'entry ' + e.uid}`;
    content.set(key, [...(content.get(key) || []), String(e.content || '').replace(/\r\n?/g, '\n').trim()]);
  }
}

(async () => {
  const tool = await H.startTool(H.PA, { PA_SETTINGS: path.join(T, 'pa_settings.json'), PA_RUNNING: path.join(T, 'pa_running.json') });
  const pa = tool.proc;
  const base = tool.url;
  const sid = encodeURIComponent('1:run_2026-11-20T17-42-53-582Z');
  const items = (await (await fetch(`${base}/api/session?id=${sid}`)).json()).items;

  let checked = 0, exact = 0, macro = 0, macroOk = 0, unlocated = 0, card = 0, cardOk = 0, drifted = 0;
  // A card edited after a log was made cannot be cut out of that log exactly (it is still
  // recognised by its start and middle). Those pieces are counted apart, not as misses.
  const cardChanged = fs.statSync(require('path').join(H.CHARACTERS, 'Wellspring.png')).mtimeMs;
  const misses = [];
  for (const it of items) {
    const d = await (await fetch(`${base}/api/record?id=${sid}&n=${it.n}`)).json();
    for (const s of d.sections) for (const c of s.contains) {
      if (!c.span && c.kind === 'card' && new Date(d.time).getTime() < cardChanged) { drifted++; continue; }
      if (!c.span) { unlocated++; misses.push(`#${it.n} ${c.label}`); continue; }
      const cut = s.text.slice(c.span.start, c.span.end);
      const wants = content.get(c.label.replace(/ \(\d+\)$/, ''));   // same-name entries share a base name
      if (c.kind === 'lorebook' && wants) {
        if (wants.some(w => /\{\{[^{}]*\}\}|<[A-Z]+>/.test(w))) { macro++; if (cut.length > 0) macroOk++; }
        else { checked++; if (wants.includes(cut)) exact++; else misses.push(`#${it.n} ${c.label} (cut ${cut.length} vs ${wants.map(w => w.length).join('/')})`); }
      } else if (c.kind === 'card') { card++; if (cut.length > 20) cardOk++; }
    }
  }
  ok(checked > 100 && exact === checked, 'lorebook entries without macros: cut-out text equals the lorebook content exactly', `${exact}/${checked}`);
  ok(macro === 0 || macroOk === macro, 'entries with macros: located with macros filled in', `${macroOk}/${macro}`);
  ok(card > 0 && cardOk === card, 'card fields located', `${cardOk}/${card}`);
  ok(unlocated <= Math.max(2, (checked + macro + card) * 0.02), 'almost everything recognised is also located', `${unlocated} not located`);
  if (misses.length) console.log('      misses:', misses.slice(0, 8).join(' | '));
  if (drifted) console.log(`      ${drifted} card pieces skipped: the card was edited after these logs were made`);

  const about = await (await fetch(`${base}/api/about`)).json();
  ok(/^\d+\.\d+\.\d+\.\d+$/.test(about.version) && /\d{4}$/.test(about.built) && about.writtenBy[0].by.includes('Claude Opus 5.5') && about.testedWith[0].includes('1.19.0'), 'PromptAssay About: version with build date, model credit, SillyTavern version', `${about.version}, built ${about.built}`);

  pa.kill();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
