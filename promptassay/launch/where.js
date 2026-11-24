// PromptAssay 0.4.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// Used by the Start launchers: prints the address of this tool's window if a copy of it is
// running, or prints nothing. With --wait N it waits up to N seconds for a copy to start.
// The tool writes running.json (its name, version, port) once its window is listening, so
// the launcher always opens the right port (the window gets a free port each time it starts).
// Run from the tool's own folder. Node built-ins only.
'use strict';
const fs = require('fs');

const waitArg = process.argv.indexOf('--wait');
const waitSec = waitArg > 0 ? Math.min(60, Math.max(0, parseInt(process.argv[waitArg + 1], 10) || 0)) : 0;
const deadline = Date.now() + waitSec * 1000;

function readRunning() {
  try {
    const r = JSON.parse(fs.readFileSync('running.json', 'utf8'));
    const port = parseInt(r.port, 10);
    if (port >= 1024 && port <= 65535 && typeof r.tool === 'string') return { tool: r.tool, port, pid: parseInt(r.pid, 10) };
  } catch (_) { }
  return null;
}

// Is a process with this number still running? (Signal 0 only asks; it sends nothing.)
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function alive(r) {
  try {
    const res = await fetch(`http://127.0.0.1:${r.port}/api/about`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const about = await res.json();
    return about && about.name === r.tool;  // the right tool, not something else on that port
  } catch (_) { return false; }
}

(async () => {
  for (;;) {
    const r = readRunning();
    if (r && await alive(r)) { console.log(`http://127.0.0.1:${r.port}`); return; }
    if (Date.now() >= deadline) {
      // Nothing answers: a running.json left behind by a copy that was closed is removed, but only
      // if that copy's process is really gone (a busy copy may just be slow to answer).
      if (r && !waitSec && !processAlive(r.pid)) { try { fs.unlinkSync('running.json'); } catch (_) { } }
      return;
    }
    await new Promise(ok => setTimeout(ok, 500));
  }
})();
