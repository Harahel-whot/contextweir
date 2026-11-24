// Test-only: help for AI assistants. The command-line checker (node contextweir.js --check,
// --check-settings, --check-rules, --schema): right exit codes and messages, and it never starts
// anything, opens a port or writes a file. The shipped JSON Schemas equal what ContextWeir makes
// from its own lists, and agree with real files (checked with a small schema checker written
// here, for the parts of JSON Schema the files use). AI_HELPERS.md lists every setting and its
// example rule file passes the checker.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./helpers');

const W = path.join(H.T, 'check_work');
const CW_DIR = path.join(H.TOOLS, 'contextweir');
const c = H.counter(), ok = c.ok;

// Run the checker. Returns { code, out, ms }.
function run(args, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [H.CW, ...args], {
    cwd: W, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, CW_RUNNING: path.join(W, 'running.json'), ...env },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - t0 };
}

// A small JSON Schema checker for the keywords these schemas use. Returns a list of problems.
function validate(schema, value, at = '$') {
  const problems = [];
  const type = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.const !== undefined && value !== schema.const) problems.push(`${at}: should be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: not one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const t = type(value);
    const okType = schema.type === t || (schema.type === 'number' && (t === 'integer' || t === 'number'));
    if (!okType) { problems.push(`${at}: should be ${schema.type}`); return problems; }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => problems.push(...validate(schema.items, v, `${at}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) problems.push(`${at}: missing "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && schema.properties[k]) problems.push(...validate(schema.properties[k], v, `${at}.${k}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: unknown key "${k}"`);
    }
  }
  return problems;
}

(async () => {
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(path.join(W, 'logs'), { recursive: true });
  const good = path.join(W, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ _about: 'x', relayPort: 6602, targetPort: 6601, logsDir: path.join(W, 'logs'), keepSessions: 5 }, null, 2));
  const goodRules = path.join(W, 'rules.json');
  fs.copyFileSync(H.CW_RULES, goodRules);

  // --- the checker ------------------------------------------------------------------
  let r = run(['--check'], { CW_SETTINGS: good, CW_RULES: goodRules });
  ok(r.code === 0 && /settings: .*good\.json\n\s+ok/.test(r.out) && /rules: .*\n\s+2 set\(s\), 7 usable rule\(s\)\n\s+ok/.test(r.out),
    '--check on good files: exit 0, both "ok"', r.code);
  ok(!fs.existsSync(path.join(W, 'running.json')) && r.ms < 5000, 'it starts nothing (no running.json) and returns at once', `${r.ms} ms`);
  const listening = await new Promise(res => { const s = net.connect(6602, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
  ok(!listening, 'and opens no port');

  const bad = path.join(W, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ relayPort: 6601, targetPort: 6601, targetHost: 'api.openai.com', keepSessions: 0, surprise: 1 }));
  const badBefore = fs.readFileSync(bad, 'utf8');
  r = run(['--check-settings', 'bad.json']);
  const problems = (r.out.match(/^\s+PROBLEM /gm) || []).length;
  ok(r.code === 1 && problems === 4 && /unknown setting "surprise"/.test(r.out) && /must be this computer/.test(r.out) && /cannot be the same/.test(r.out),
    '--check-settings on a bad file: exit 1, each problem named (the panel\'s own messages)', `${problems} problems`);
  ok(fs.readFileSync(bad, 'utf8') === badBefore && fs.readdirSync(W).sort().join() === 'bad.json,good.json,logs,rules.json', 'nothing written');

  fs.writeFileSync(path.join(W, 'broken.json'), '{ "relayPort": 5012, }');
  r = run(['--check-settings', 'broken.json']);
  ok(r.code === 2 && /not valid JSON/.test(r.out) && /CW-SETTINGS-BAD-JSON/.test(r.out), 'not valid JSON: exit 2, with its error code');
  r = run(['--check-settings', 'nowhere.json']);
  ok(r.code === 2 && /not found/.test(r.out), 'a missing file: exit 2');
  r = run(['--check-rules', path.join(H.T, 'bad_rules.json')]);
  ok(r.code === 1 && (r.out.match(/^\s+PROBLEM /gm) || []).length === 3 && /CW-RULES-PROBLEMS/.test(r.out), '--check-rules on a bad rule file: exit 1, three problems');
  r = run(['--check-rules', path.join(H.TOOLS, 'demo', 'rules', 'lantern_coast_rules.json')]);
  ok(r.code === 0, '--check-rules on the demo rule set: exit 0');
  r = run(['--check-rules']);
  ok(r.code === 3 && /needs a file name/.test(r.out), 'a missing file name: exit 3, with the usage');
  r = run(['--frobnicate']);
  ok(r.code === 3 && /unknown option/.test(r.out) && /Usage/.test(r.out), 'an unknown option: exit 3, with the usage');
  r = run(['--help']);
  ok(r.code === 0 && /--check-settings/.test(r.out) && /--schema/.test(r.out) && /Exit codes/.test(r.out), '--help lists every option and the exit codes');

  // --- the schemas -----------------------------------------------------------------
  const schemas = {};
  for (const kind of ['settings', 'rules', 'setup']) {
    r = run(['--schema', kind]);
    schemas[kind] = JSON.parse(r.out);
    const shipped = fs.readFileSync(path.join(CW_DIR, 'schemas', `${kind}.schema.json`), 'utf8');
    ok(r.code === 0 && shipped === r.out, `schemas/${kind}.schema.json is exactly what ContextWeir makes now`);
  }
  const engine = require(path.join(CW_DIR, 'lib', 'rules_engine.js'));
  const ruleSchema = schemas.rules.properties.groups.items.properties.rules.items;
  ok(JSON.stringify(ruleSchema.properties.target.enum) === JSON.stringify(engine.TARGETS)
    && JSON.stringify(ruleSchema.properties.test.enum) === JSON.stringify(engine.TESTS)
    && schemas.rules.properties.groups.maxItems === engine.LIMITS.groups, 'the rule schema uses the engine\'s own targets, tests and limits');

  const shippedSettings = JSON.parse(fs.readFileSync(path.join(H.STAGED, 'Wellspring', 'tools', 'contextweir', 'settings.json'), 'utf8'));
  ok(validate(schemas.settings, shippedSettings).length === 0, 'the PC\'s real settings.json passes the settings schema', validate(schemas.settings, shippedSettings).join('; '));
  const badProblems = validate(schemas.settings, JSON.parse(badBefore));
  ok(badProblems.some(p => /targetHost/.test(p)) && badProblems.some(p => /surprise/.test(p)) && badProblems.some(p => /keepSessions/.test(p)),
    'the schema also catches the bad file (cloud host, unknown key, out of range)', badProblems.length + ' problems');
  ok(validate(schemas.rules, JSON.parse(fs.readFileSync(H.CW_RULES, 'utf8'))).length === 0
    && validate(schemas.rules, JSON.parse(fs.readFileSync(path.join(H.TOOLS, 'demo', 'rules', 'lantern_coast_rules.json'), 'utf8'))).length === 0,
  'the shipped rules.json and the demo rule set pass the rules schema');

  // --- AI_HELPERS.md -----------------------------------------------------------------
  const guide = fs.readFileSync(path.join(H.TOOLS, 'AI_HELPERS.md'), 'utf8');
  const keys = Object.keys(schemas.settings.properties).filter(k => k !== '_about');
  const missing = keys.filter(k => !guide.includes('| `' + k + '` |'));
  ok(missing.length === 0, 'AI_HELPERS.md has a row for every setting', missing.join(', ') || `${keys.length} settings`);
  const rows = (guide.match(/^\| `(\w+)` \| ([^|]+)\| ([^|]+)\| (now|restart) \|/gm) || []);
  const wrongDefault = rows.filter(row => {
    const [, key, , def] = row.match(/^\| `(\w+)` \| ([^|]+)\| ([^|]+)\|/);
    const want = schemas.settings.properties[key].default;
    return String(want === '' ? 'empty' : want).replace(/^logs$/, '`logs`') !== def.trim();
  });
  ok(rows.length === keys.length && wrongDefault.length === 0, 'and its defaults match ContextWeir\'s', wrongDefault.join(' / ') || 'all match');
  const example = guide.match(/```json\n([\s\S]*?)\n```/)[1];
  fs.writeFileSync(path.join(W, 'example_rules.json'), example);
  r = run(['--check-rules', 'example_rules.json']);
  ok(r.code === 0 && /1 set\(s\), 3 usable rule\(s\)/.test(r.out), 'the example rule file in AI_HELPERS.md passes the checker', r.out.trim().split('\n').pop());
  ok(['--check', '--check-settings', '--check-rules', '--schema'].every(o => guide.includes(o)), 'AI_HELPERS.md documents every checker option');

  c.done('checker and AI helpers');
})();
