// ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// ContextWeir rule engine
// ----------------------------------------------------------------------------
// Everything about flag rules that is pure data handling: checking a rule file
// (validateRules), writing it back (rulesToFile) and running the rules against
// one request and reply (checkRules). Shared by contextweir.js and by the
// worker thread that runs the checks (rules_worker.js), so both apply exactly
// the same checks. Nothing in a rule file is ever run as code: rules are
// targets, tests, values and labels; patterns become regular expressions only
// after the checks below.
//
// A rule, as written in rules.json:
//   { "name": "Reply starts with OOC", "severity": "warning",
//     "target": "reply", "test": "startsWith", "value": "OOC",
//     "unless": [ { "target": "lastUser", "test": "contains", "value": "(OOC" } ],
//     "note": "why this rule exists" }
// ============================================================================

'use strict';

const crypto = require('crypto');

// What a rule may look at, how it may test it, and how serious a hit is.
const TARGETS = ['reply', 'prompt', 'lastUser', 'lastMessage'];
const TEXT_TAIL = 2000;   // characters of a text-completion prompt that count as its last message
const TESTS = ['startsWith', 'contains', 'missing', 'regex', 'regexMissing'];
const SEVERITIES = ['note', 'warning', 'serious'];

const MAX_PATTERN = 200;          // longest value or pattern, in characters
const MAX_SCAN_CHARS = 400000;    // rules look at most this much of a prompt

// How many of each thing a rule file may hold, and the longest names and notes.
const LIMITS = { groups: 50, rulesPerGroup: 200, unless: 10, name: 120, groupName: 80, note: 500 };

// Patterns like (a+)+ or (a|a)* can take forever on some inputs. The worker's
// time limit catches anything that slips through; these usual culprits are
// refused up front.
function riskyPattern(p) {
  const nestedRepeat = /\([^)]*[+*}][^)]*\)\s*[+*{]/.test(p);       // (a+)+  (\w*)*  (x{2,})+
  const repeatedSameChoice = /\(([^()|]+)\|\1\)\s*[+*{]/.test(p);    // (a|a)*
  return nestedRepeat || repeatedSameChoice;
}

// Any value from a file, shown safely in a problem message. A crafted value (an object whose
// toString is not a function, a very long string...) can never crash the check or flood a message.
function shown(v) {
  if (typeof v === 'string') return JSON.stringify(v.slice(0, 60));
  try { return String(JSON.stringify(v)).slice(0, 60); } catch (_) { return '(unreadable value)'; }
}

// A short stable id for a rule, from its set and name (used to switch off a
// slow rule for the session and to count hits).
function ruleId(groupName, ruleName) {
  return crypto.createHash('sha1').update(groupName + '\u0000' + ruleName).digest('hex').slice(0, 10);
}

// Check a rule set (from rules.json, the rules window or an imported file).
// Returns the usable groups (with patterns compiled) and a list of problems.
// Anything unexpected is dropped with a reason; nothing in the data is run.
function validateRules(raw, where = 'rules') {
  const problems = [];
  const groups = [];
  if (!raw || typeof raw !== 'object') return { groups, problems: [`${where}: not a rule file`] };
  if (raw.format !== 'contextweir-rules') problems.push(`${where}: "format" should be "contextweir-rules"`);

  const rawGroups = Array.isArray(raw.groups) ? raw.groups.slice(0, LIMITS.groups) : [];
  const names = new Set();

  for (const g of rawGroups) {
    if (!g || typeof g !== 'object' || typeof g.name !== 'string' || !g.name.trim()) { problems.push('a set has no name: skipped'); continue; }
    let name = g.name.trim().slice(0, LIMITS.groupName);
    while (names.has(name)) name += ' (2)';                     // set names must be unique
    names.add(name);
    const group = { name, enabled: g.enabled !== false, rules: [] };

    const rawRules = Array.isArray(g.rules) ? g.rules.slice(0, LIMITS.rulesPerGroup) : [];
    for (const r of rawRules) {
      const label = `${group.name} / ${r && typeof r === 'object' ? (typeof r.name === 'string' ? r.name.slice(0, 120) : shown(r.name)) : '(not a rule)'}`;
      const rule = checkOneRule(r, group.name, label, problems);
      if (rule) group.rules.push(rule);
    }
    groups.push(group);
  }
  return { groups, problems };
}

// One rule: returns the checked rule, or null (with the reason in problems).
function checkOneRule(r, groupName, label, problems) {
  if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name.trim() || typeof r.value !== 'string') {
    problems.push(`${label}: needs a name and a value: skipped`);
    return null;
  }
  if (!TARGETS.includes(r.target)) { problems.push(`${label}: unknown target ${shown(r.target)}: skipped`); return null; }
  if (!TESTS.includes(r.test)) { problems.push(`${label}: unknown test ${shown(r.test)}: skipped`); return null; }
  if (r.value.length > MAX_PATTERN) {
    problems.push(`${label}: value longer than ${MAX_PATTERN} characters: skipped`);
    return null;
  }
  if (r.value === '' && r.test !== 'regexMissing') { problems.push(`${label}: value is empty: skipped`); return null; }

  const rule = {
    id: ruleId(groupName, r.name),
    name: r.name.trim().slice(0, LIMITS.name),
    enabled: r.enabled !== false,
    severity: SEVERITIES.includes(r.severity) ? r.severity : 'warning',
    target: r.target,
    test: r.test,
    value: r.value,
    flags: cleanFlags(r.flags),
    note: typeof r.note === 'string' ? r.note.slice(0, LIMITS.note) : '',
  };
  if (!compileTest(rule, label, problems)) return null;

  // Optional exceptions: the rule is skipped when any "unless" condition holds,
  // e.g. "no status line ... unless the last message is a script request".
  // One bad exception drops the whole rule (a rule without its exception
  // could flag every turn).
  rule.unless = [];
  const rawUnless = Array.isArray(r.unless) ? r.unless.slice(0, LIMITS.unless) : [];
  for (const u of rawUnless) {
    const ok = u && typeof u === 'object';
    const cond = { target: ok ? u.target : undefined, test: ok ? u.test : undefined, value: ok ? u.value : undefined, flags: cleanFlags(ok ? u.flags : '') };
    const wellFormed = TARGETS.includes(cond.target) && TESTS.includes(cond.test)
      && typeof cond.value === 'string' && cond.value.length <= MAX_PATTERN;
    if (!wellFormed) {
      problems.push(`${label}: an "unless" condition is malformed: rule skipped`);
      return null;
    }
    if (!compileTest(cond, label + ' (unless)', problems)) return null;
    rule.unless.push(cond);
  }
  return rule;
}

// Pattern flags: only i, m, s and u, each once.
function cleanFlags(f) {
  return typeof f === 'string' && /^[imsu]{0,4}$/.test(f) ? [...new Set(f)].join('') : '';
}

// Prepare a test (rule or "unless" condition): compile patterns, refuse slow ones.
function compileTest(t, label, problems) {
  if (!t.test.startsWith('regex')) return true;
  if (riskyPattern(t.value)) { problems.push(`${label}: pattern could run very slowly: skipped`); return false; }
  try {
    t.re = new RegExp(t.value, t.flags);
    return true;
  } catch (e) {
    // Not the engine's message: it repeats the whole pattern, which can hold story words.
    problems.push(`${label}: not a valid pattern`);
    return false;
  }
}

// The rule set as it is written to disk and exported: plain data, no compiled patterns.
// Credit line kept at the top of every saved or exported rule file (JSON has no comments).
const RULES_ABOUT = 'ContextWeir rule file, part of the Wellspring tools. Directed by Harahel-Whot. '
  + 'Written by Claude Opus 5.5 (Anthropic). Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir';

function rulesToFile(groups) {
  const plainTest = t => ({ target: t.target, test: t.test, value: t.value, ...(t.flags ? { flags: t.flags } : {}) });
  return {
    _about: RULES_ABOUT,
    format: 'contextweir-rules',
    version: 1,
    groups: groups.map(g => ({
      name: g.name,
      enabled: g.enabled,
      rules: g.rules.map(r => ({
        name: r.name,
        enabled: r.enabled,
        severity: r.severity,
        ...plainTest(r),
        ...(r.unless && r.unless.length ? { unless: r.unless.map(plainTest) } : {}),
        ...(r.note ? { note: r.note } : {}),
      })),
    })),
  };
}

// Pick out the text a rule looks at.
function targetText(target, request, reply) {
  if (target === 'reply') return reply;
  const msgs = messagesOf(request);
  if (target === 'lastMessage') {
    if (!msgs.length) return '';
    const last = contentText(msgs[msgs.length - 1].content);
    // Text completion sends one long prompt: its "last message" is the last TEXT_TAIL characters
    // (the newest turns). In text mode use "contains" rather than "startsWith" on it.
    return msgs[msgs.length - 1].role === 'prompt' ? last.slice(-TEXT_TAIL) : last;
  }
  if (target === 'lastUser') {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    return lastUser ? contentText(lastUser.content) : '';
  }
  // 'prompt': every message, joined, up to MAX_SCAN_CHARS
  return msgs.map(m => contentText(m.content)).join('\n').slice(0, MAX_SCAN_CHARS);
}

// One test against one piece of text. Returns { hit, match } (match: the text
// that matched, for highlighting; plain-text tests ignore case).
function runTest(t, text) {
  switch (t.test) {
    case 'startsWith': {
      const s = text.trimStart();
      const hit = s.toLowerCase().startsWith(t.value.toLowerCase());
      return { hit, match: hit ? s.slice(0, t.value.length) : '' };
    }
    case 'contains': {
      const i = text.toLowerCase().indexOf(t.value.toLowerCase());
      return { hit: i >= 0, match: i >= 0 ? text.slice(i, i + t.value.length) : '' };
    }
    case 'missing':
      return { hit: !text.toLowerCase().includes(t.value.toLowerCase()), match: '' };
    case 'regex': {
      const m = text.match(t.re);
      return { hit: !!m, match: m ? m[0].slice(0, 200) : '' };
    }
    case 'regexMissing':
      return { hit: !t.re.test(text), match: '' };
  }
  return { hit: false, match: '' };
}

// Run every enabled rule. Returns [{rule, name, group, severity, target, match}].
// onRule(i) is told the position of each rule (counting all rules in order)
// just before it runs, so a rule that hangs can be named from outside.
function checkRules(groups, request, reply, onRule = () => {}) {
  const hits = [];
  let position = -1;
  for (const g of groups) {
    for (const r of g.rules) {
      position++;
      if (!g.enabled || !r.enabled) continue;
      onRule(position);
      const { hit, match } = runTest(r, targetText(r.target, request, reply));
      if (!hit) continue;
      if (r.unless.some(u => runTest(u, targetText(u.target, request, reply)).hit)) continue;
      hits.push({ rule: r.id, name: r.name, group: g.name, severity: r.severity, target: r.target, match });
    }
  }
  return hits;
}

// The messages of a request: chat completion has "messages"; text completion
// has one "prompt", treated as a single message.
function messagesOf(request) {
  if (request && Array.isArray(request.messages)) return request.messages;
  if (request && typeof request.prompt === 'string') return [{ role: 'prompt', content: request.prompt }];
  return [];
}

// A message's text: a plain string, or the text parts of a multi-part message.
function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(part => (part && typeof part.text === 'string') ? part.text : '').join('');
  return c == null ? '' : JSON.stringify(c);
}


module.exports = {
  TARGETS, TESTS, SEVERITIES, MAX_PATTERN, LIMITS,
  validateRules, rulesToFile, checkRules, runTest, targetText, messagesOf, contentText, riskyPattern,
};
