// Dev tool (not shipped to users): writes the "Error codes" table in each tool's help.html from
// that tool's lib/error_codes.js, between the markers <!-- ERROR CODES START --> and
// <!-- ERROR CODES END -->, so the help page and the code always list the same codes.
// Each row has an id equal to its code, so the panel can open help.html#CW-PORT-TAKEN.
// Usage: node errors_to_help.js <tools folder>
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const tool of ['contextweir', 'promptassay']) {
  const { CODES } = require(path.join(root, tool, 'lib', 'error_codes.js'));
  const helpFile = path.join(root, tool, 'help.html');
  const html = fs.readFileSync(helpFile, 'utf8');
  const rows = Object.entries(CODES).map(([code, c]) =>
    `<tr id="${code}"><td><code>${code}</code></td><td><b>${escapeHtml(c.title)}.</b> ${escapeHtml(c.means)}</td><td>${escapeHtml(c.fix)}</td></tr>`);
  const table = ['<!-- ERROR CODES START (made by dev/errors_to_help.js from lib/error_codes.js: edit that file, not this table) -->',
    '<table class="codes">', '<tr><th>Code</th><th>What it means</th><th>What to do</th></tr>', ...rows, '</table>',
    '<!-- ERROR CODES END -->'].join('\n');
  const re = /<!-- ERROR CODES START[\s\S]*?<!-- ERROR CODES END -->/;
  if (!re.test(html)) throw new Error(`${helpFile}: markers not found`);
  fs.writeFileSync(helpFile, html.replace(re, table));
  console.log(`${tool}: ${rows.length} codes written to help.html`);
}
