// Test-only stand-in for KoboldCpp. Replays the real replies from staged log
// turns (matched by the request's message list), and has a few trigger words:
//   SLOW  -> never answers (to test the timeout)
//   EMPTY -> empty reply
// Also answers GET /api/extra/version and /v1/models like KoboldCpp does.
// Streams (SSE) when the request asks for stream: true.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || 6001);
const TURNS = process.argv[3];
const replies = new Map();
const key = msgs => crypto.createHash('sha1').update(JSON.stringify(msgs)).digest('hex');
if (TURNS) for (const f of fs.readdirSync(TURNS)) {
  const d = JSON.parse(fs.readFileSync(path.join(TURNS, f), 'utf8'));
  if (d.request && d.request.messages) replies.set(key(d.request.messages), d.reply);
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/extra/version') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result: 'KoboldCpp', version: '1.99-mock' })); }
  if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'koboldcpp/Gemma-mock', object: 'model' }] })); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { }
    const msgs = body.messages || [];
    const last = msgs.length ? String(msgs[msgs.length - 1].content) : '';
    if (/SLOW/.test(last)) return;   // say nothing
    const reply = /HEAVYREPLY/.test(last) ? 'a'.repeat(40) + '!' : /EMPTY/.test(last) ? '' : replies.get(key(msgs)) ?? `Mock reply to: ${last.slice(0, 40)} [Time: Dawn | Location: x]`;
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const parts = reply.match(/.{1,40}/gs) || [];
      let i = 0;
      const tick = () => {
        if (i < parts.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`); setTimeout(tick, 2); }
        else { res.write('data: [DONE]\n\n'); res.end(); }
      };
      tick();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log('mock model on', PORT, 'with', replies.size, 'known replies'));
