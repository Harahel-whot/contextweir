// ContextWeir 0.5.6.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// Diagnostics: error codes, recent problems, and the diagnostic report
// ----------------------------------------------------------------------------
// The same file ships with ContextWeir and with PromptAssay. Each tool passes
// in its own list of error codes (lib/error_codes.js). This module keeps:
//   - the most recent problems, each with its code, time and a short detail
//   - the most recent console lines (the tool's own lines only)
// and builds the diagnostic report: a small text file someone can attach to
// a help request.
//
// WHAT THE REPORT NEVER HOLDS: prompt, reply or lorebook text. It is built
// only from settings, state, counts, versions and the tool's own console
// lines, and the tools never print prompt text to the console. Folder paths
// are shortened by default (on Windows a path usually holds the person's
// name): the home folder becomes <home>. Nothing is ever sent anywhere; the
// page shows the report and the person saves it themselves.
// ============================================================================

'use strict';

const os = require('os');

const MAX_PROBLEMS = 40;        // recent problems kept
const MAX_CONSOLE_LINES = 60;   // recent console lines kept
const MAX_LINE = 300;           // longest console line kept, in characters

function createDiagnostics(tool, codes) {
  const problems = [];   // [{ code, time, detail, count }]
  const lines = [];      // recent console lines

  // Note a problem by its code. The same code and detail in a row is counted, not repeated.
  function note(code, detail = '') {
    if (!codes[code]) code = codes.UNKNOWN ? 'UNKNOWN' : code;
    const short = String(detail).replace(/\s+/g, ' ').slice(0, 200);
    const last = problems[problems.length - 1];
    if (last && last.code === code && last.detail === short) {
      last.count++;
      last.time = new Date().toISOString();
      return code;
    }
    problems.push({ code, time: new Date().toISOString(), detail: short, count: 1 });
    if (problems.length > MAX_PROBLEMS) problems.shift();
    return code;
  }

  // A message with its code after it, e.g. "the model sent nothing for 600 s (CW-MODEL-TIMEOUT)".
  function withCode(code, message) { return `${message} (${code})`; }

  // Keep a copy of every console line the tool prints (they are shown as normal too).
  function tapConsole() {
    for (const name of ['log', 'error']) {
      const original = console[name].bind(console);
      console[name] = (...args) => {
        const text = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          lines.push(`${new Date().toISOString().slice(11, 19)}  ${line.slice(0, MAX_LINE)}`);
          if (lines.length > MAX_CONSOLE_LINES) lines.shift();
        }
        original(...args);
      };
    }
  }

  return { note, withCode, tapConsole, problems: () => problems.slice(), consoleLines: () => lines.slice(), codes };
}

// Folder paths with the home folder shown as <home>, however they are written: as is, with doubled
// backslashes (inside JSON), with forward slashes, in any letter case; and C:\Users\<name>,
// /home/<name> and /Users/<name> are caught even when the home folder is somewhere else (a name
// with spaces in it included).
const escapeRegExp = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function shortenPaths(text, full = false) {
  if (full) return String(text);
  let out = String(text);
  const home = os.homedir();
  if (home && home.length > 3) {
    const parts = home.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
    const lead = /^[\\/]/.test(home) ? '[\\\\/]+' : '';
    out = out.replace(new RegExp(lead + parts.join('[\\\\/]+'), 'gi'), '<home>');
  }
  out = out.replace(/\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/"'\n]+/gi, '<home>');
  out = out.replace(/(^|[\s"'(])\/(home|Users)\/[^/"'\n]+/g, '$1<home>');
  return out;
}

// The browser that asked for the report (the panel's window), from its User-Agent.
function browserName(userAgent) {
  const ua = String(userAgent || '');
  const pick = [
    [/Edg\/([\d.]+)/, 'Edge'], [/Vivaldi\/([\d.]+)/, 'Vivaldi'], [/Brave\/([\d.]+)/, 'Brave'],
    [/OPR\/([\d.]+)/, 'Opera'], [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome or Chromium'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of pick) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return ua ? 'unknown (' + ua.slice(0, 120) + ')' : 'not known (no browser asked)';
}

// The whole report as plain text. sections: [[title, { label: value } or [lines]]].
function formatReport(tool, version, built, sections, full) {
  const out = [];
  out.push(`${tool} DIAGNOSTIC REPORT`);
  out.push('='.repeat(out[0].length));
  out.push(`Made ${new Date().toISOString()} by ${tool} ${version}, built ${built}.`);
  out.push('Holds no prompts, replies or lorebook text. Nothing was sent anywhere: attach this file yourself');
  out.push(`if you ask for help. Folder paths are ${full ? 'shown in full' : 'shortened (your home folder is shown as <home>)'}.`);
  out.push('');
  out.push('SYSTEM');
  out.push(`  Node.js            ${process.version}`);
  out.push(`  Operating system   ${os.type()} ${os.release()} (${process.platform}, ${process.arch})`);
  for (const [title, body] of sections) {
    out.push('');
    out.push(title.toUpperCase());
    if (Array.isArray(body)) {
      if (!body.length) out.push('  (none)');
      for (const line of body) out.push('  ' + line);
    } else {
      const width = Math.max(0, ...Object.keys(body).map(k => k.length)) + 2;
      for (const [label, value] of Object.entries(body)) {
        const text = value === null || value === undefined || value === '' ? '(not set)'
          : typeof value === 'object' ? JSON.stringify(value) : String(value);
        out.push('  ' + label.padEnd(width) + text);
      }
    }
  }
  out.push('');
  out.push('(end of report)');
  return shortenPaths(out.join('\n'), full) + '\n';
}

// Recent problems as report lines, each with its plain explanation.
function problemLines(diag) {
  return diag.problems().map(p => {
    const info = diag.codes[p.code] || {};
    const times = p.count > 1 ? ` (x${p.count}, last ${p.time})` : '';
    return `${p.time}  ${p.code}${times}: ${info.title || ''}${p.detail ? ' | ' + p.detail : ''}`;
  });
}

module.exports = { createDiagnostics, shortenPaths, browserName, formatReport, problemLines };
