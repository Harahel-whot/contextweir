// Test-only: runs every suite one after another and adds up the checks.
// Order matters: test_contextweir.js records the logs (cwlogs\) that the PromptAssay
// suites read. Each suite's work folder from an earlier run is removed first, so a run
// that failed halfway never leaves files that confuse the next one.
// Usage:  node run_all.js            (all suites)
//         node run_all.js <suite>…   (only those, e.g. node run_all.js test_panel_api.js)
// Set WS_STAGED if the staged PC data is somewhere other than /mnt/user-data/uploads/SillyTavern.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUITES = [
  'test_contextweir.js', 'test_rules_api.js', 'test_rule_timeout.js', 'test_rules_ui.js',
  'test_panel_api.js', 'test_panel_ui.js', 'test_promptassay.js', 'test_pieces.js', 'test_pieces_ui.js',
  'test_live_ui.js', 'test_versions.js', 'test_keys_ui.js',
  'test_diagnostics.js', 'test_config_io.js', 'test_demo.js', 'test_check_cli.js', 'test_security.js', 'test_text_prompt.js', 'test_remote_thanks.js',
];

// The folders the suites make for themselves (never the tools' own folders).
const WORK_FOLDERS = [
  'cwlogs', 'cw_about', 'keys_work', 'live_work', 'panel_api_work', 'panel_ui_work', 'rules_ui',
  'rules_work', 'timeout_work', 'versions_work', 'diag_work', 'config_work', 'demo_work', 'check_work', 'security_work', 'text_work',
];

const wanted = process.argv.slice(2);
const suites = (wanted.length ? wanted : SUITES).filter(s => fs.existsSync(path.join(__dirname, s)));
if (!wanted.length) {
  for (const f of WORK_FOLDERS) fs.rmSync(path.join(__dirname, f), { recursive: true, force: true });
}

let pass = 0;
let fail = 0;
for (const suite of suites) {
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8', timeout: 180000 });
  const out = (run.stdout || '') + (run.stderr || '');
  const passed = (out.match(/^PASS/gm) || []).length;
  // A suite that crashed without printing FAIL still counts as one failure.
  const failed = (out.match(/^FAIL/gm) || []).length + (run.status !== 0 && !/FAIL/.test(out) ? 1 : 0);
  pass += passed;
  fail += failed;
  console.log(`${failed ? 'FAIL' : 'ok  '}  ${suite.padEnd(22)} ${passed} passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) console.log(out.split('\n').filter(l => /^FAIL|Error/.test(l)).map(l => '        ' + l).join('\n'));
}
console.log(`\n${suites.length} suites: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
