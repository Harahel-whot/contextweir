// Test-only: shared helpers for the tools' test suites (Node built-ins only).
// The suites live in tools\dev\tests\; the tools are two folders up. Real data
// (logs, lorebooks, the card) is read from a staged copy of the PC folders:
// set WS_STAGED to point somewhere else (default /mnt/user-data/uploads/SillyTavern).
// Windows get a free port each start: startTool() reads it from the console line
// "window:  http://127.0.0.1:<port>" that both tools print.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const T = __dirname;
const TOOLS = path.join(T, '..', '..');
const CW = path.join(TOOLS, 'contextweir', 'contextweir.js');
const PA = path.join(TOOLS, 'promptassay', 'promptassay.js');
const CW_RULES = path.join(TOOLS, 'contextweir', 'rules.json');
const STAGED = process.env.WS_STAGED || '/mnt/user-data/uploads/SillyTavern';
const TURNS = path.join(STAGED, 'Wellspring', 'v0.8.0.3', 'testkit', 'logs', 'run_2026-11-20T17-42-53-582Z', 'turns');
const OLD_LOGS = path.join(STAGED, 'Wellspring', 'v0.8.0.3', 'testkit', 'logs');
const ST_DIR = path.join(STAGED, 'SillyTavern');
const WORLDS = path.join(ST_DIR, 'data', 'default-user', 'worlds');
const CHARACTERS = path.join(ST_DIR, 'data', 'default-user', 'characters');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function counter() {
  const c = { pass: 0, fail: 0 };
  c.ok = (cond, name, extra = '') => { cond ? c.pass++ : c.fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' && extra != null ? '  (' + extra + ')' : ''}`); };
  c.done = label => { console.log(`\n${label}: ${c.pass} passed, ${c.fail} failed`); process.exitCode = c.fail ? 1 : 0; };
  return c;
}

// Start a tool. Resolves once its window is listening: { proc, port, url, out() }.
function startTool(script, env = {}, timeoutMs = 8000) {
  const proc = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  const t0 = Date.now();
  return new Promise(resolve => {
    const look = () => {
      const m = out.match(/window:\s+(http:\/\/127\.0\.0\.1:(\d+))/);
      if (m) return resolve({ proc, url: m[1], port: Number(m[2]), out: () => out });
      if (proc.exitCode !== null || Date.now() - t0 > timeoutMs) return resolve({ proc, url: null, port: null, out: () => out });
      setTimeout(look, 50);
    };
    look();
  });
}

// Wait until the console shows a line matching re.
async function waitFor(tool, re, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (re.test(tool.out())) return true; await sleep(50); }
  return false;
}

// Plain HTTP request to 127.0.0.1 with full control of headers.
function request({ port, method = 'GET', pathName = '/', headers = {}, body }) {
  const http = require('http');
  return new Promise(resolve => {
    const data = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: h }, res => {
      const c = []; res.on('data', x => c.push(x));
      res.on('end', () => { const b = Buffer.concat(c).toString('utf8'); let json = null; try { json = JSON.parse(b); } catch (_) { } resolve({ status: res.statusCode, body: b, json, headers: res.headers }); });
    });
    r.on('error', e => resolve({ status: 0, body: e.message, json: null, headers: {} }));
    r.end(data);
  });
}

// A JSON POST from the panel's own window (the only origin allowed to change things).
const panelPost = (port, pathName, body, headers = {}) => request({ port, method: 'POST', pathName, body, headers: { origin: `http://127.0.0.1:${port}`, ...headers } });

// Headless Chrome on a DevTools port; returns { chrome, send, js, shot, problems, close }.
async function browser(debugPort, workDir, size = '1400,900') {
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(workDir, 'chrome')}`, `--window-size=${size}`, 'about:blank']);
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); break; } catch (_) { await sleep(250); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map(); const problems = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(m.params.entry.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.result.value;
  };
  const shot = async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const close = () => { try { ws.close(); } catch (_) { } chrome.kill(); };
  return { chrome, send, js, shot, problems, close };
}

module.exports = { T, TOOLS, CW, PA, CW_RULES, STAGED, TURNS, OLD_LOGS, ST_DIR, WORLDS, CHARACTERS, sleep, counter, startTool, waitFor, request, panelPost, browser };
