// Test-only. ContextWeir 0.6.0.0 and PromptAssay 0.4.1.0 (user, 25 Nov 12:21-12:33):
//   OUTSIDE ADDRESSES: the remote-address setting and its checks; nothing is sent or recorded until
//   the warning is accepted (Start, Restart and opening straight into recording all wait); OK only
//   for the saved address; "Don't show this again" per address, set only by the warning (never by
//   a settings save or a setup file); requests go to <address path> + <frontend path> with the
//   frontend's API key and without cookies; no version probe to a remote server; https certificates
//   are checked (refused without the test CA, accepted with it); the Test button.
//   THANK-YOU NOTE: ContextWeir's status says when to show it and a save hides it; PromptAssay's
//   /api/thanks reads it and its one write is refused unless it comes from its own window as JSON.
//   The two popups clicked through in headless Chrome.
// A stand-in model listens on this machine's non-loopback address (192.0.2.x here), which
// ContextWeir counts as "another computer". Nothing real is contacted.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const { execFileSync } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'remote_work');
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });
const c = H.counter();

// This machine's first non-loopback IPv4 address.
function outsideAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

// A stand-in model server. Remembers every request (method, path, headers).
function standIn(secure, opts) {
  const seen = [];
  const handler = (req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'tracker=1' });
      if (req.url.endsWith('/models') && opts && opts.bigModels) return res.end('x'.repeat(300 * 1024));
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] }));
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Status: fine. A reply from far away.' } }] }));
    });
  };
  const server = secure ? https.createServer(opts, handler) : http.createServer(handler);
  return new Promise(r => server.listen(0, '0.0.0.0', () => r({ server, seen, port: server.address().port })));
}

function relayChat(port, extraHeaders = {}) {
  const body = JSON.stringify({ model: 'x', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello there' }] });
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/chat/completions',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...extraHeaders } }, res => {
      const b = []; res.on('data', d => b.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(b).toString(), headers: res.headers }));
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    r.end(body);
  });
}

const cwFiles = name => ({ CW_SETTINGS: path.join(W, `${name}.json`), CW_RULES: path.join(W, 'rules.json'), CW_RUNNING: path.join(W, `${name}_running.json`) });
const writeSettings = (name, s) => fs.writeFileSync(path.join(W, `${name}.json`), JSON.stringify(s, null, 2));
const readSettings = name => JSON.parse(fs.readFileSync(path.join(W, `${name}.json`), 'utf8'));
const status = port => H.request({ port, pathName: '/api/status' }).then(r => r.json);
const latestSession = logs => fs.readdirSync(logs).filter(n => n.startsWith('session_')).sort().pop();

(async () => {
  const ip = outsideAddress();
  c.ok(!!ip, 'this machine has a non-loopback address for the stand-in', ip || 'none');
  if (!ip) return c.done('remote and thanks');
  fs.writeFileSync(path.join(W, 'rules.json'), JSON.stringify({ format: 'contextweir-rules', version: 1, groups: [] }));

  // --- 1. The address checks ------------------------------------------------------
  const base = { relayPort: 6302, logsDir: path.join(W, 'logs'), showStartScreen: true };
  writeSettings('checks', base);
  const checks = await H.startTool(H.CW, cwFiles('checks'));
  const refused = [
    ['http://127.0.0.1:5001', 'this computer (127.0.0.1)'], ['http://localhost:5001', 'this computer (localhost)'],
    ['http://[::1]:5001', 'this computer (::1)'], ['http://127.5.5.5', 'this computer (127.x)'],
    ['http://0.0.0.0:5001', '0.0.0.0'], ['http://foo.localhost', 'a .localhost name'],
    ['http://user:pw@example.com', 'a user name and password'], ['https://example.com/api?key=1', 'a query'],
    ['https://example.com/#x', 'a #part'], ['ftp://example.com', 'ftp'], ['example.com', 'no http(s)'],
    ['https://example.com/a/../b', 'a .. in the path'], ['https://exa mple.com', 'a space'],
    ['https://example.com/' + 'a'.repeat(300), 'over 300 characters'],
    ['https://\u043epenrouter.ai/api', 'a look-alike (Cyrillic) letter'], ['https://openrouter.ai\u3002evil.com/api', 'a full-width dot'],
    ['https://openrouter.ai%2eevil.com/api', 'a %-coded computer name'], ['https://example.com:443/api', 'a hidden default port'],
    ['http://169.254.169.254', 'the cloud metadata address'], ['http://[fe80::1]:5001', 'an IPv6 link-local address'],
    ['http://[::ffff:127.0.0.1]:5001', 'IPv4 loopback inside IPv6'], ['http://[::ffff:7f00:1]:5001', 'IPv4 loopback inside IPv6 (hex)'],
    ['http://localhost.:5001', 'localhost with a trailing dot'], ['http://[::ffff:0:0]:5001', '0.0.0.0 inside IPv6'],
  ];
  for (const [url, what] of refused) {
    const r = await H.panelPost(checks.port, '/api/settings', { settings: { allowRemoteModel: true, remoteUrl: url } });
    c.ok(r.status === 400, `remote address refused: ${what}`, r.json && r.json.problems && r.json.problems[0]);
  }
  let r;
  r = await H.panelPost(checks.port, '/api/settings', { settings: { allowRemoteModel: true, remoteUrl: 'http://192.168.1.20:5001' } });
  c.ok(r.status === 200, 'a home-network address is accepted', r.json && r.json.problems);
  r = await H.panelPost(checks.port, '/api/settings', { settings: { allowRemoteModel: true, remoteUrl: '' } });
  c.ok(r.status === 400, 'ticking "Allow" with no address is refused');
  r = await H.panelPost(checks.port, '/api/settings', { settings: { allowRemoteModel: false, remoteUrl: 'https://openrouter.ai/api' } });
  c.ok(r.status === 200, 'an address can be saved with "Allow" off (nothing happens with it)');
  r = await H.panelPost(checks.port, '/api/settings', { settings: { remoteWarningAcceptedFor: 'https://openrouter.ai/api' } });
  c.ok(r.status === 200 && readSettings('checks').remoteWarningAcceptedFor === '', 'a plain settings save cannot mark the warning accepted');
  const fields = (await H.request({ port: checks.port, pathName: '/api/settings' })).json.fields;
  c.ok(fields.some(f => f.key === 'allowRemoteModel' && f.tab === 'connection') && fields.some(f => f.key === 'remoteUrl'), 'the Connection tab gains the two fields');
  const st0 = await status(checks.port);
  c.ok(st0.showThanks === false, 'status: thank-you note hidden under the test switch');
  checks.proc.kill();

  // Thank-you note in ContextWeir: shown by default, hidden by a save.
  writeSettings('thanks', { ...base, relayPort: 6303 });
  const thanks = await H.startTool(H.CW, { ...cwFiles('thanks'), WS_HIDE_THANKS: '0' });
  c.ok((await status(thanks.port)).showThanks === true, 'status: the thank-you note shows by default');
  await H.panelPost(thanks.port, '/api/settings', { settings: { showThanks: false } });
  c.ok((await status(thanks.port)).showThanks === false && readSettings('thanks').showThanks === false, '"Don\'t show this again" saves showThanks false');
  const about = (await H.request({ port: thanks.port, pathName: '/api/about' })).json;
  c.ok(about.links && about.links.github === 'https://github.com/Harahel-Whot/contextweir' && !('discord' in about.links), 'About carries the GitHub link and no Discord link');
  c.ok(about.version === '0.6.0.0', 'ContextWeir is 0.6.0.0', about.version);
  thanks.proc.kill();

  // --- 2. Remote over http: the warning first --------------------------------------
  const plain = await standIn(false);
  const url = `http://${ip}:${plain.port}/api`;
  writeSettings('remote', { ...base, relayPort: 6304, showStartScreen: false, allowRemoteModel: true, remoteUrl: url });
  let cw = await H.startTool(H.CW, cwFiles('remote'));
  c.ok(await H.waitFor(cw, /CW-REMOTE-NOT-CONFIRMED/), 'opening straight into recording waits for the warning (console)');
  let st = await status(cw.port);
  c.ok(st.state === 'ready' && !st.relay && st.remote.warningNeeded && st.remote.url === url, 'not recording; status says the warning is needed');
  c.ok((await relayChat(6304)).status === 0, 'the receiving port is closed while waiting');
  r = await H.panelPost(cw.port, '/api/control', { action: 'start' });
  c.ok(r.status === 409 && r.json.needsRemoteOk === true && /CW-REMOTE-NOT-CONFIRMED/.test(r.json.error), 'Start is refused until the warning is accepted');
  r = await H.panelPost(cw.port, '/api/control', { action: 'restart' });
  c.ok(r.status === 409 && r.json.needsRemoteOk === true, 'Restart is refused until the warning is accepted');
  r = await H.panelPost(cw.port, '/api/control', { action: 'remote-ok', url: `http://${ip}:1/evil`, start: true });
  c.ok(r.status === 409 && !(await status(cw.port)).relay, 'OK for any other address is refused');
  r = await H.request({ port: cw.port, method: 'POST', pathName: '/api/control', body: { action: 'remote-ok', url, start: true } });
  c.ok(r.status === 403, 'OK without the panel\'s Origin is refused');
  r = await H.panelPost(cw.port, '/api/test-model', { url });
  c.ok(r.status === 409 && plain.seen.length === 0, 'Test is refused before the warning, and nothing was sent');
  c.ok(plain.seen.length === 0, 'nothing at all reached the remote server before OK');

  r = await H.panelPost(cw.port, '/api/control', { action: 'remote-ok', url, start: true });
  st = r.json;
  c.ok(r.status === 200 && st.state === 'recording' && st.relay.remote === true && st.relay.target === url, 'OK starts recording, forwarding to the remote address');
  c.ok(!readSettings('remote').remoteWarningAcceptedFor, 'OK without "Don\'t show this again" saves nothing');
  await H.sleep(300);
  c.ok(plain.seen.length === 0, 'no version probe was sent to the remote server');
  const reply = await relayChat(6304, { authorization: 'Bearer sk-test-123', cookie: 'session=abc', origin: 'http://127.0.0.1:8000',
    'x-forwarded-for': '1.2.3.4', forwarded: 'for=1.2.3.4', 'x-real-ip': '1.2.3.4', 'accept-encoding': 'gzip, br' });
  const hit = plain.seen.find(x => x.method === 'POST');
  c.ok(reply.status === 200 && /far away/.test(reply.body), 'a turn goes through to the remote server and back');
  c.ok(hit && hit.path === '/api/v1/chat/completions', 'the address path goes in front of the frontend path', hit && hit.path);
  c.ok(hit && hit.headers.authorization === 'Bearer sk-test-123', "the frontend's API key is passed on");
  c.ok(hit && !hit.headers.cookie && !hit.headers.origin && !hit.headers['x-forwarded-for'] && !hit.headers.forwarded && !hit.headers['x-real-ip'],
    'cookies, Origin and forwarding headers are dropped');
  c.ok(hit && hit.headers['accept-encoding'] === 'identity', 'plain (not compressed) replies are asked for, so the log stays readable');
  c.ok(!reply.headers['set-cookie'], "the remote server's cookies are not passed back to the frontend");
  c.ok(hit && hit.headers.host === `${ip}:${plain.port}`, 'the Host header names the remote server');
  await H.sleep(400);
  const logs = path.join(W, 'logs');
  const sess = path.join(logs, latestSession(logs));
  const recText = fs.readFileSync(path.join(sess, 'records.jsonl'), 'utf8');
  const summary = JSON.parse(fs.readFileSync(path.join(sess, 'summary.json'), 'utf8'));
  c.ok(recText.includes('hello there') && !recText.includes('sk-test-123'), 'the turn is recorded; the API key is not');
  c.ok(summary.target === url && summary.modelServer && summary.modelServer.remote === true && /not asked/.test(summary.modelServer.note), 'the summary names the remote address and says no version was asked');
  r = await H.panelPost(cw.port, '/api/test-model', { url });
  c.ok(r.status === 200 && r.json.reachable === true && r.json.status === 200, 'Test works after OK (one GET of /v1/models)');
  c.ok(plain.seen.some(x => x.method === 'GET' && x.path === '/api/v1/models' && !x.headers.authorization), 'the Test request sends no API key');
  const diagText = (await H.request({ port: cw.port, pathName: '/api/diagnostic' })).json.text;
  c.ok(!diagText.includes('/api') && diagText.includes(`http://${ip}:${plain.port}/... (shortened)`), 'the diagnostic report shortens the remote address');
  r = await H.panelPost(cw.port, '/api/test-model', { url: `http://${ip}:1` });
  c.ok(r.status === 400, 'Test of any address other than the saved one is refused');

  // Setup file: the acceptance never travels.
  const exp = (await H.request({ port: cw.port, pathName: '/api/setup/export' })).json;
  c.ok(exp && exp.settings && !('remoteWarningAcceptedFor' in exp.settings) && exp.settings.remoteUrl === url, 'a setup file carries the address but never the acceptance');

  // "Don't show this again": per address.
  r = await H.panelPost(cw.port, '/api/control', { action: 'remote-ok', url, dontShowAgain: true, start: false });
  c.ok(readSettings('remote').remoteWarningAcceptedFor === url, '"Don\'t show this again" saves the acceptance for this address');
  cw.proc.kill();
  await H.sleep(200);
  cw = await H.startTool(H.CW, cwFiles('remote'));
  c.ok(await H.waitFor(cw, /recording: frontend/), 'with the address accepted for good, ContextWeir opens straight into recording');
  c.ok(/ANOTHER COMPUTER/.test(cw.out()), 'the console says the chats cross the network');
  const other = `http://${ip}:${plain.port}/other`;
  await H.panelPost(cw.port, '/api/settings', { settings: { remoteUrl: other } });
  r = await H.panelPost(cw.port, '/api/control', { action: 'restart' });
  c.ok(r.status === 409 && r.json.needsRemoteOk === true, 'a different address needs the warning again');
  const imported = await H.panelPost(cw.port, '/api/setup/import', {
    file: { format: 'contextweir-setup', version: 1, settings: { remoteWarningAcceptedFor: other } }, applySettings: true, rulesMode: 'skip', confirm: true });
  c.ok(readSettings('remote').remoteWarningAcceptedFor === url && imported.status === 200, 'a setup file cannot mark an address accepted');
  r = await H.panelPost(cw.port, '/api/settings', { settings: { remoteWarningAcceptedFor: '' } });
  c.ok(r.status === 200 && readSettings('remote').remoteWarningAcceptedFor === '', '"Show it again" empties the acceptance');
  r = await H.panelPost(cw.port, '/api/settings', { settings: { allowRemoteModel: false } });
  r = await H.panelPost(cw.port, '/api/control', { action: 'restart' });
  c.ok(r.status === 200 && r.json.state === 'recording' && r.json.relay.remote === false, 'unticking "Allow" and Restart: back to this computer, no warning');
  cw.proc.kill();
  plain.server.close();

  // --- 3. https: the certificate is always checked -----------------------------------
  let haveOpenssl = true;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(W, 'key.pem'), '-out', path.join(W, 'cert.pem'),
      '-days', '2', '-subj', `/CN=${ip}`, '-addext', `subjectAltName=IP:${ip}`], { stdio: 'ignore' });
  } catch (_) { haveOpenssl = false; }
  c.ok(haveOpenssl, 'a test certificate was made (openssl)');
  if (haveOpenssl) {
    const tls = await standIn(true, { key: fs.readFileSync(path.join(W, 'key.pem')), cert: fs.readFileSync(path.join(W, 'cert.pem')) });
    const surl = `https://${ip}:${tls.port}`;
    writeSettings('tls', { ...base, relayPort: 6305, showStartScreen: false, allowRemoteModel: true, remoteUrl: surl, remoteWarningAcceptedFor: surl });
    cw = await H.startTool(H.CW, cwFiles('tls'));
    await H.waitFor(cw, /recording: frontend/);
    let t = await relayChat(6305);
    c.ok(t.status === 502 && /CW-MODEL-UNREACHABLE/.test(t.body) && tls.seen.length === 0, 'an https server whose certificate is not trusted is refused', t.status);
    cw.proc.kill();
    await H.sleep(200);
    cw = await H.startTool(H.CW, { ...cwFiles('tls'), NODE_EXTRA_CA_CERTS: path.join(W, 'cert.pem') });
    await H.waitFor(cw, /recording: frontend/);
    t = await relayChat(6305, { authorization: 'Bearer sk-tls' });
    c.ok(t.status === 200 && tls.seen.some(x => x.path === '/v1/chat/completions' && x.headers.authorization === 'Bearer sk-tls'), 'with the certificate trusted, https works and the key goes through');
    cw.proc.kill();
    tls.server.close();
  }

  // The Test button answers even when the remote server sends far too much.
  const big = await standIn(false, { bigModels: true });
  const burl = `http://${ip}:${big.port}`;
  writeSettings('big', { ...base, relayPort: 6307, allowRemoteModel: true, remoteUrl: burl, remoteWarningAcceptedFor: burl });
  cw = await H.startTool(H.CW, cwFiles('big'));
  const t0 = Date.now();
  r = await H.panelPost(cw.port, '/api/test-model', { url: burl });
  c.ok(r.status === 200 && r.json.reachable === true && Date.now() - t0 < 4000, 'Test answers when the reply is over 256 KB', `${Date.now() - t0} ms`);
  cw.proc.kill();
  big.server.close();

  // --- 4. PromptAssay's thank-you note ---------------------------------------------------
  const paSettings = path.join(W, 'pa.json');
  fs.writeFileSync(paSettings, JSON.stringify({ logDirs: [logs], showDemo: true, custom: 'kept' }, null, 2));
  const pa = await H.startTool(H.PA, { PA_SETTINGS: paSettings, PA_RUNNING: path.join(W, 'pa_running.json'), WS_HIDE_THANKS: '0' });
  r = await H.request({ port: pa.port, pathName: '/api/thanks' });
  c.ok(r.json && r.json.show === true, 'PromptAssay: the note shows by default');
  const paAbout = (await H.request({ port: pa.port, pathName: '/api/about' })).json;
  c.ok(paAbout.version === '0.4.1.0' && paAbout.links.github.endsWith('/contextweir'), 'PromptAssay is 0.4.1.0 with the links', paAbout.version);
  const post = (headers, body = { show: false }, pathName = '/api/thanks') => H.request({ port: pa.port, method: 'POST', pathName, body, headers });
  r = await post({});
  c.ok(r.status === 403, 'PromptAssay: the write is refused without an Origin');
  r = await post({ origin: 'http://127.0.0.1:1' });
  c.ok(r.status === 403, 'PromptAssay: the write is refused from another port');
  r = await post({ origin: `http://127.0.0.1:${pa.port}`, 'content-type': 'text/plain' }, 'show=false');
  c.ok(r.status === 415, 'PromptAssay: the write is refused unless it is JSON');
  r = await post({ origin: `http://127.0.0.1:${pa.port}` }, { show: true });
  c.ok(r.status === 400, 'PromptAssay: only { show: false } is accepted');
  r = await post({ origin: `http://127.0.0.1:${pa.port}` }, { show: false, pad: 'x'.repeat(2000) });
  c.ok(r.status === 413, 'PromptAssay: a body over 1 KB is refused', r.status);
  r = await post({ origin: `http://127.0.0.1:${pa.port}` }, { show: false }, '/api/session');
  c.ok(r.status === 405, 'PromptAssay: every other POST is still refused (read-only)', r.status + ' ' + r.body.slice(0, 80));
  c.ok(JSON.parse(fs.readFileSync(paSettings, 'utf8')).showThanks === undefined, 'nothing was written by the refused requests');
  r = await post({ origin: `http://127.0.0.1:${pa.port}` });
  const after = JSON.parse(fs.readFileSync(paSettings, 'utf8'));
  c.ok(r.status === 200 && after.showThanks === false && after.custom === 'kept' && after.logDirs[0] === logs, 'PromptAssay: the write sets showThanks false and keeps the rest of the file');
  c.ok((await H.request({ port: pa.port, pathName: '/api/thanks' })).json.show === false, 'PromptAssay: the note is now hidden');
  pa.proc.kill();

  // --- 5. The popups, clicked in headless Chrome -------------------------------------------
  const plain2 = await standIn(false);
  const url2 = `http://${ip}:${plain2.port}`;
  writeSettings('ui', { ...base, relayPort: 6306, showStartScreen: false, allowRemoteModel: true, remoteUrl: url2 });
  cw = await H.startTool(H.CW, { ...cwFiles('ui'), WS_HIDE_THANKS: '0' });
  const b = await H.browser(9431, W);
  await b.send('Page.navigate', { url: `http://127.0.0.1:${cw.port}/panel` });
  await H.sleep(1500);
  c.ok(await b.js("return document.querySelector('#thanksDialog').open"), 'panel: the thank-you note opens first');
  c.ok(await b.js("return document.querySelector('#thanksLinks a').href === 'https://github.com/Harahel-Whot/contextweir/' || document.querySelector('#thanksLinks a').href.startsWith('https://github.com/Harahel-Whot/contextweir')"), 'panel: the note links to GitHub');
  c.ok(await b.js("return document.querySelector('#thanksLinks').textContent.trim() === 'GitHub'"), 'panel: only GitHub is listed (no Discord yet)');
  c.ok(!(await b.js("return document.querySelector('#remoteDialog').open")), 'panel: the warning waits behind the note');
  await b.shot(path.join(W, 'thanks.png'));
  await b.js("document.querySelector('#thanksHide').checked = true; document.querySelector('#thanksClose').click(); return true");
  await H.sleep(800);
  c.ok(readSettings('ui').showThanks === false, 'panel: "Don\'t show this again" saved');
  c.ok(await b.js("return document.querySelector('#remoteDialog').open"), 'panel: then the warning opens');
  c.ok(await b.js(`return document.querySelector('#remoteUrlShown').textContent === ${JSON.stringify(url2)} && !document.querySelector('#remoteHttpLine').hidden`), 'panel: the warning names the address and the plain-http line');
  await b.shot(path.join(W, 'warning.png'));
  await b.js("document.querySelector('#remoteCancel').click(); return true");
  await H.sleep(800);
  st = await status(cw.port);
  c.ok(!st.relay && plain2.seen.length === 0, 'panel: Cancel leaves it not recording, nothing sent');
  c.ok(/Not recording/.test(await b.js("return document.querySelector('#banner').textContent")), 'panel: the bar says why it is not recording');
  await b.js("document.querySelector('#btnStart').click(); return true");
  await H.sleep(800);
  c.ok(await b.js("return document.querySelector('#remoteDialog').open"), 'panel: Start shows the warning again');
  await b.js("document.querySelector('#remoteOk').click(); return true");
  await H.sleep(1000);
  st = await status(cw.port);
  c.ok(st.state === 'recording' && st.relay.remote, 'panel: OK starts recording');
  // Ticking the box shows the warning; Cancel unticks it.
  await H.panelPost(cw.port, '/api/settings', { settings: { allowRemoteModel: false } });
  await b.send('Page.reload');
  await H.sleep(1500);
  await b.js("document.querySelector('[data-tab=connection]').click(); const box = document.querySelector('[data-key=allowRemoteModel]'); box.click(); return true");
  await H.sleep(500);
  c.ok(await b.js("return document.querySelector('#remoteDialog').open"), 'panel: ticking "Allow" shows the warning at once');
  await b.js("document.querySelector('#remoteCancel').click(); return true");
  await H.sleep(300);
  c.ok(!(await b.js("return document.querySelector('[data-key=allowRemoteModel]').checked")), 'panel: Cancel unticks it');
  // OK for one address, then a different one saved: the acceptance does not carry over.
  await b.js("document.querySelector('[data-key=remoteUrl]').value = ''; document.querySelector('[data-key=allowRemoteModel]').click(); return true");
  await H.sleep(500);
  await b.js("document.querySelector('#remoteHide').checked = true; document.querySelector('#remoteOk').click(); return true");
  await H.sleep(300);
  await b.js(`document.querySelector('[data-key=remoteUrl]').value = ${JSON.stringify(url2 + '/elsewhere')}; [...document.querySelectorAll('[data-form=connection] button')].find(x => x.textContent === 'Save').click(); return true`);
  await H.sleep(800);
  c.ok(readSettings('ui').remoteUrl === url2 + '/elsewhere' && !readSettings('ui').remoteWarningAcceptedFor, 'panel: OK given for one address is not applied to a different one typed afterwards');
  // A refused Start (409) shows in the browser's log as a failed load: that is expected, not a fault.
  const realProblems = b.problems.filter(p => !/status of 409/.test(p));
  c.ok(realProblems.length === 0, 'panel: no script errors or CSP problems', realProblems.join(' | '));
  b.close();
  cw.proc.kill();
  plain2.server.close();

  // PromptAssay's page.
  fs.writeFileSync(paSettings, JSON.stringify({ logDirs: [logs], showDemo: true }, null, 2));
  const pa2 = await H.startTool(H.PA, { PA_SETTINGS: paSettings, PA_RUNNING: path.join(W, 'pa_running2.json'), WS_HIDE_THANKS: '0' });
  const b2 = await H.browser(9432, path.join(W, 'b2'));
  await b2.send('Page.navigate', { url: `http://127.0.0.1:${pa2.port}/` });
  await H.sleep(2000);
  c.ok(await b2.js("return document.querySelector('#thanksDialog').open"), 'PromptAssay page: the thank-you note opens');
  await b2.shot(path.join(W, 'pa_thanks.png'));
  await b2.js("document.querySelector('#thanksHide').checked = true; document.querySelector('#thanksClose').click(); return true");
  await H.sleep(600);
  c.ok(JSON.parse(fs.readFileSync(paSettings, 'utf8')).showThanks === false, 'PromptAssay page: "Don\'t show this again" saved');
  await b2.send('Page.reload');
  await H.sleep(1500);
  c.ok(!(await b2.js("return document.querySelector('#thanksDialog').open")), 'PromptAssay page: not shown again after a reload');
  c.ok(b2.problems.length === 0, 'PromptAssay page: no script errors or CSP problems', b2.problems.join(' | '));
  b2.close();
  pa2.proc.kill();

  c.done('remote and thanks');
  setTimeout(() => process.exit(), 300);
})();
