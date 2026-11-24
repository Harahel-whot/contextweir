// Test-only: the 24 Nov evening UI pass. PromptAssay: wider timeline marks, Previous / Next,
// keyboard shortcuts and the Keys list. ContextWeir: Alt shortcuts and the Keys list. Both: no
// script errors. (The self-sizing on open only runs in an app-style window, not testable here.)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'keys_work');
const c = H.counter(), ok = c.ok;

(async () => {
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(path.join(W, 'pa.json'), JSON.stringify({ logDirs: [H.OLD_LOGS], worldsDir: H.WORLDS, charactersDir: H.CHARACTERS }));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: path.join(W, 'pa.json'), PA_RUNNING: path.join(W, 'pa_running.json') });
  const b = await H.browser(9343, W, '1400,900');
  const { js, send } = b;
  const key = async (k, mods = 0) => { const code = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35 }[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, modifiers: mods, windowsVirtualKeyCode: code || k.toUpperCase().charCodeAt(0), text: k.length === 1 ? k : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, modifiers: mods, windowsVirtualKeyCode: code || k.toUpperCase().charCodeAt(0) }); await H.sleep(500); };
  const cur = () => js(`return Number(document.querySelector('#turns .current')?.dataset.n)`);
  const sid = (await (await fetch(pa.url + '/api/sessions')).json()).sessions[0].id;
  await send('Page.navigate', { url: pa.url + '/?session=' + encodeURIComponent(sid) + '&n=2670' });
  await H.sleep(2000);

  const w = await js(`return document.querySelector('#timeline button').getBoundingClientRect().width`);
  ok(w >= 13, 'timeline marks are wider (about 3x)', Math.round(w) + ' px');
  ok(await cur() === 2670, 'opens on #2670', await cur());
  const nb = await js(`const b = [...document.querySelectorAll('.stepBtn')].find(x => x.textContent.includes('Next')); return b ? { dis: b.disabled, n: document.querySelectorAll('.stepBtn').length } : null`);
  await js(`[...document.querySelectorAll('.stepBtn')].find(x => x.textContent.includes('Next')).click()`); await H.sleep(600);
  ok(await cur() === 2671, 'Next button', `${await cur()} ${JSON.stringify(nb)}`);
  await js(`[...document.querySelectorAll('.stepBtn')].find(x => x.textContent.includes('Previous')).click()`); await H.sleep(600);
  ok(await cur() === 2670, 'Previous button', await cur());
  await key('ArrowRight'); ok(await cur() === 2671, 'Right arrow: the request after', await cur());
  await key('ArrowLeft'); ok(await cur() === 2670, 'Left arrow: the request before', await cur());
  await key('ArrowDown'); ok(await cur() === 2669, 'Down arrow: down the list (older)', await cur());
  await key('k'); ok(await cur() === 2670, 'K: up the list (newer)', await cur());
  await key('Home'); ok(await cur() === 2656, 'Home: the first request', await cur());
  await key('End'); ok(await cur() === 2688, 'End: the last request', await cur());
  const firstAt = await js(`return document.querySelector('.stepBtn:last-child').disabled`);
  ok(firstAt === true, 'Next is greyed out on the last request');
  await key('2'); ok(await js(`return document.getElementById('kindFilter').value`) === 'summary', '2: Summarize requests only');
  await key('0'); ok(await js(`return document.getElementById('kindFilter').value`) === '', '0: all requests');
  await key('f'); ok(await js(`return document.getElementById('onlyFlagged').checked`) === true, 'F: flagged only on');
  await key('f');
  await key('e'); ok(await js(`return [...document.querySelectorAll('details.sec')].every(d => d.open)`), 'E: opens all sections');
  await key('e'); ok(await js(`return [...document.querySelectorAll('details.sec')].every(d => !d.open)`), 'E again: closes them');
  await key('?'); ok(await js(`return document.getElementById('keysDialog').open && document.querySelectorAll('#keysTable tr').length`) >= 8, '?: the Keys list');
  await b.shot(path.join(W, 'pa_keys.png'));
  await js(`document.getElementById('keysClose').click()`);
  await key('ArrowLeft', 8);   // Shift: the flagged request before (none flagged in this run: stays put)
  ok(await cur() === 2688, 'Shift+Left with nothing flagged earlier: stays put', await cur());
  await b.shot(path.join(W, 'pa_timeline.png'));

  // ContextWeir
  fs.writeFileSync(path.join(W, 'cw.json'), JSON.stringify({ relayPort: 6952, targetPort: 6951, logsDir: path.join(W, 'logs') }));
  const cw = await H.startTool(H.CW, { CW_SETTINGS: path.join(W, 'cw.json'), CW_RULES: H.CW_RULES, CW_RUNNING: path.join(W, 'cw_running.json') });
  await send('Page.navigate', { url: cw.url + '/panel' }); await H.sleep(1500);
  await key('3', 1); ok(await js(`return !document.getElementById('tab-logs').hidden`), 'Alt+3: Logs tab');
  await key('1', 1);
  await key('s', 1); await H.sleep(800); ok(await js(`return document.getElementById('statePill').textContent`) === 'Recording', 'Alt+S: Start');
  await key('p', 1); await H.sleep(800); ok(await js(`return document.getElementById('statePill').textContent`) === 'Paused', 'Alt+P: Pause');
  await key('p', 1); await H.sleep(800); ok(await js(`return document.getElementById('statePill').textContent`) === 'Recording', 'Alt+P again: Resume');
  await key('?'); ok(await js(`return document.getElementById('keysDialog').open`), '?: the Keys list');
  await b.shot(path.join(W, 'cw_keys.png'));

  ok(b.problems.length === 0, 'no script errors or CSP violations', b.problems.join(' | '));
  b.close(); pa.proc.kill(); cw.proc.kill();
  c.done('keys and timeline');
})();
