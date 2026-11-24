// PromptAssay 0.4.1.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// Taking a text-completion prompt apart
// ----------------------------------------------------------------------------
// In chat completion the frontend sends a list of messages, each with a role.
// In text completion it sends ONE string: the story string, lorebook entries,
// the chat and the instruct template's markers ("<|im_start|>user" and the
// like) glued together. This file cuts that string back into sections shaped
// like chat messages, so the rest of PromptAssay can show it the same way.
//
// The rules it keeps (design: tools_text_completion.txt):
//   - LOSSLESS: the sections, joined in order, are the prompt, character for
//     character. Every section is a { start, end } range of the original.
//   - KNOWN CONTENT FIRST: a marker found inside a known piece (a lorebook
//     entry or card field the caller has located) never splits the prompt.
//   - SAYS HOW: the result says whether it was split by a template (and
//     which), by speaker names, or not at all. Labels built on it are a guess.
//   - NO PATTERNS FROM DATA: markers, names and stop strings come from files
//     and requests, so they are only ever searched with indexOf, never turned
//     into a regular expression. Every list read has a cap.
//   - NEVER THROWS, and always returns at least one section.
//
// Nothing here reads files or the network; the caller passes everything in.
// ============================================================================

'use strict';

const LIMITS = {
  sections: 5000,        // most sections one prompt is cut into; past that the rest is one section
  markerChars: 200,      // longest marker (instruct sequence) used
  stopStrings: 100,      // most stop strings looked at
  names: 20,             // most speaker names used
  nameChars: 60,         // longest speaker name
  presets: 200,          // most instruct preset files used
  hits: 20000,           // most marker occurrences looked at per prompt and template (inside known pieces too)
  budget: 32000000,      // most characters searched per prompt across all templates (about 30 ms); past it, not split
};

// Templates everyone knows, for people who have not pointed PromptAssay at SillyTavern's
// instruct presets. input / output / system open a turn; the suffixes close one.
const BUILT_IN = [
  { name: 'ChatML', input: ['<|im_start|>user'], output: ['<|im_start|>assistant'], system: ['<|im_start|>system'], suffix: ['<|im_end|>'] },
  { name: 'Llama 3', input: ['<|start_header_id|>user<|end_header_id|>'], output: ['<|start_header_id|>assistant<|end_header_id|>'], system: ['<|start_header_id|>system<|end_header_id|>'], suffix: ['<|eot_id|>'] },
  { name: 'Gemma', input: ['<start_of_turn>user'], output: ['<start_of_turn>model'], system: [], suffix: ['<end_of_turn>'] },
  { name: 'Mistral', input: ['[INST]'], output: [], system: ['[SYSTEM_PROMPT]'], suffix: ['[/INST]', '[/SYSTEM_PROMPT]'] },
  { name: 'Alpaca', input: ['### Instruction:'], output: ['### Response:'], system: ['### Input:'], suffix: [] },
  { name: 'Vicuna', input: ['USER:'], output: ['ASSISTANT:'], system: [], suffix: [] },
  { name: 'Phi', input: ['<|user|>'], output: ['<|assistant|>'], system: ['<|system|>'], suffix: ['<|end|>'] },
  { name: 'Command-R', input: ['<|START_OF_TURN_TOKEN|><|USER_TOKEN|>'], output: ['<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>'], system: ['<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>'], suffix: ['<|END_OF_TURN_TOKEN|>'] },
].map(t => ({ ...t, source: 'built-in' }));

const MACRO_RE = /\{\{[^{}]*\}\}/;   // a fixed pattern (ours), used only to cut macros out of markers

// A marker as it can be searched for: trimmed, the longest stretch without a {{macro}},
// at most LIMITS.markerChars. Empty when nothing usable is left.
function cleanMarker(v) {
  if (typeof v !== 'string') return '';
  const pieces = v.split(MACRO_RE).map(p => p.trim()).filter(Boolean);
  if (!pieces.length) return '';
  const longest = pieces.sort((a, b) => b.length - a.length)[0];
  if (longest.length > LIMITS.markerChars) return '';
  // Too short or too plain to be a marker: "{{char}}:" leaves ":", and a marker like "e" would
  // match everywhere (security re-check, 25 Nov). A marker needs 3 characters and at least one
  // that is not a letter, digit or space ("<|im_start|>", "[INST]", "### Response:", "USER:").
  if (longest.length < 3 || !/[^A-Za-z0-9 ]/.test(longest)) return '';
  return longest;
}

const uniq = list => [...new Set(list.filter(Boolean))];

// One of SillyTavern's instruct preset files (data/<user>/instruct/*.json) as a template, or null.
// Only these fields are read; anything of the wrong type is ignored.
function templateFromPreset(json, fileName) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const m = k => cleanMarker(json[k]);
  const t = {
    name: (typeof json.name === 'string' && json.name.trim() ? json.name : String(fileName || 'preset').replace(/\.json$/i, '')).slice(0, 80),
    source: 'SillyTavern preset',
    input: uniq([m('input_sequence'), m('first_input_sequence'), m('last_input_sequence')]),
    output: uniq([m('output_sequence'), m('first_output_sequence'), m('last_output_sequence')]),
    system: uniq([m('system_sequence'), m('last_system_sequence')]),
    // Whitespace-only suffixes ("\n\n") would cut everywhere: left out.
    suffix: uniq([m('input_suffix'), m('output_suffix'), m('system_suffix'), m('stop_sequence')]),
  };
  if (!t.input.length && !t.output.length) return null;
  return t;
}

// Speaker names from the request's stop strings: SillyTavern stops on "\nName:" for the player
// and each character. Also returns the stop strings themselves (trimmed) for scoring templates.
function stopInfo(request) {
  const raw = [];
  for (const key of ['stop', 'stop_sequence', 'stopping_strings', 'stop_sequences']) {
    const v = request && request[key];
    if (typeof v === 'string') raw.push(v);
    else if (Array.isArray(v)) for (const s of v) if (typeof s === 'string') raw.push(s);
  }
  const stops = raw.slice(0, LIMITS.stopStrings);
  const names = [];
  for (const s of stops) {
    const t = s.replace(/^\s+/, '');
    if (s.startsWith('\n') && t.endsWith(':') && t.length >= 2 && t.length <= LIMITS.nameChars + 1 && !t.includes('\n')) {
      const name = t.slice(0, -1).trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return { stops: stops.map(s => s.trim()).filter(Boolean), names: names.slice(0, LIMITS.names) };
}

// Is the stretch [i, i + len) touching one of the known ranges? A binary search finds the last
// range starting before the stretch ends; the running maximum of the ends up to it says whether
// any of those ranges reaches past i. O(log n) per question (a linear scan from the start made
// marker-heavy prompts with many known pieces slow: security re-check, 25 Nov).
function insideKnown(i, len, known) {
  let lo = 0, hi = known.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (known[mid].start < i + len) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return last >= 0 && known.runMax[last] > i;
}

// Prepare the known ranges: sorted by start, with a running maximum of their ends.
function prepareKnown(list) {
  const known = list.slice().sort((a, b) => a.start - b.start);
  const runMax = [];
  let m = -1;
  for (const k of known) { m = Math.max(m, k.end); runMax.push(m); }
  known.runMax = runMax;
  return known;
}

// Where a string occurs in the prompt: every position, in order, capped. Each search is counted
// against the prompt's budget (ctx.budget), so no prompt can make the splitter search for long.
function positions(prompt, needle, ctx) {
  const out = [];
  let from = 0;
  while (out.length < LIMITS.hits) {
    if (ctx.spent > LIMITS.budget) { ctx.overBudget = true; break; }
    const at = prompt.indexOf(needle, from);
    ctx.spent += (at < 0 ? prompt.length : at + needle.length) - from;
    if (at < 0) break;
    out.push(at);
    from = at + needle.length;
  }
  return out;
}

// Every place a marker occurs, outside known content: [{ at, len, role, marker }].
// When two markers start at the same place the longer wins; a marker starting inside one
// already taken is skipped.
function findOpeners(prompt, template, known, ctx) {
  const found = [];
  const add = (list, role) => {
    for (const marker of list) {
      if (!marker) continue;
      for (const at of positions(prompt, marker, ctx)) {
        if (!insideKnown(at, marker.length, known)) found.push({ at, len: marker.length, role, marker });
      }
    }
  };
  // Input first, so a marker shared by two roles counts as the player's.
  add(template.input, 'user');
  add(template.output, 'assistant');
  add(template.system, 'system');
  found.sort((a, b) => a.at - b.at || b.len - a.len);
  const out = [];
  let end = -1;
  for (const f of found) {
    if (f.at < end) continue;
    out.push(f);
    end = f.at + f.len;
  }
  return out;
}

// How well a template fits this prompt: how many times its markers occur, if both a player and
// a narrator marker occur (or, for a template whose narrator has no marker, a player marker and a
// suffix). Stop strings that equal one of its markers count extra.
function scoreTemplate(prompt, template, known, stops, ctx) {
  // A cheap first look: both a player and a narrator marker (or a suffix) must occur at all.
  const first = list => list.some(m => m && prompt.includes(m));
  ctx.spent += prompt.length;
  if (!first(template.input) || !(first(template.output) || (!template.output.length && first(template.suffix)))) return { score: 0, openers: [] };
  const openers = findOpeners(prompt, template, known, ctx);
  const has = role => openers.some(o => o.role === role);
  const hasSuffix = template.suffix.some(s => s && prompt.includes(s));
  const fits = has('user') && (has('assistant') || (!template.output.length && hasSuffix));
  if (!fits) return { score: 0, openers };
  const markers = [...template.input, ...template.output, ...template.system, ...template.suffix];
  const stopBonus = markers.filter(m => stops.includes(m)).length * 5;
  return { score: openers.length + stopBonus, openers };
}

// Cut the prompt at the chosen template's markers. Returns sections (see splitTextPrompt).
function cutByTemplate(prompt, template, openers, known, ctx) {
  const sections = [];
  const push = (start, end, role, wrap = []) => {
    if (end > start) sections.push({ start, end, role, name: '', wrap });
  };
  if (!openers.length) return sections;
  push(0, openers[0].at, 'system');   // the story string, before the first marker

  // Every suffix position, found once (outside known content), then walked alongside the openers:
  // searching again from each opener cost (openers x prompt length) on prompts without a suffix
  // (security re-check, 25 Nov).
  const closers = [];
  for (const sfx of template.suffix.filter(Boolean)) {
    for (const at of positions(prompt, sfx, ctx)) if (!insideKnown(at, sfx.length, known)) closers.push({ at, len: sfx.length });
  }
  closers.sort((a, b) => a.at - b.at);
  let ci = 0;
  const narratorHasNoMarker = !template.output.length;
  for (let i = 0; i < openers.length && sections.length < LIMITS.sections - 2; i++) {
    const o = openers[i];
    const sectionEnd = i + 1 < openers.length ? openers[i + 1].at : prompt.length;
    const wrap = [{ start: o.at, end: o.at + o.len }];
    // The first suffix after the marker (and before the next marker) closes the turn.
    while (ci < closers.length && closers[ci].at < o.at + o.len) ci++;
    let close = -1;
    let closeLen = 0;
    if (ci < closers.length && closers[ci].at + closers[ci].len <= sectionEnd) { close = closers[ci].at; closeLen = closers[ci].len; }
    if (close >= 0) {
      wrap.push({ start: close, end: close + closeLen });
      const after = prompt.slice(close + closeLen, sectionEnd);
      if (after.trim() && narratorHasNoMarker && o.role === 'user') {
        // Mistral-style: the narrator's text follows the player's closing marker with no opener.
        push(o.at, close + closeLen, o.role, wrap);
        push(close + closeLen, sectionEnd, 'assistant');
        continue;
      }
      if (after.trim()) {
        // Text between a closed turn and the next marker: kept as its own section.
        push(o.at, close + closeLen, o.role, wrap);
        push(close + closeLen, sectionEnd, 'between');
        continue;
      }
    }
    push(o.at, sectionEnd, o.role, wrap);
  }
  // Past the section cap: everything left is one section.
  const lastEnd = sections.length ? sections[sections.length - 1].end : 0;
  if (lastEnd < prompt.length) push(lastEnd, prompt.length, 'between');
  return sections;
}

// No template, but speaker names known: cut at line starts "Name:". The name whose cut ends the
// prompt with nothing after it is the narrator (the frontend leaves "\nName:" for the reply);
// every other name is the player. Without that ending, roles stay unknown ("turn").
function cutByNames(prompt, names, known, ctx) {
  const cuts = [];
  for (const name of names) {
    const marker = '\n' + name + ':';
    for (const at of positions(prompt, marker, ctx)) {
      if (cuts.length >= LIMITS.sections) break;
      if (!insideKnown(at, marker.length, known)) cuts.push({ at: at + 1, len: marker.length - 1, name });
    }
  }
  if (!cuts.length) return null;
  cuts.sort((a, b) => a.at - b.at);
  const last = cuts[cuts.length - 1];
  const narrator = prompt.slice(last.at + last.len).trim() === '' ? last.name : null;
  const sections = [];
  if (cuts[0].at > 0) sections.push({ start: 0, end: cuts[0].at, role: 'system', name: '', wrap: [] });
  cuts.forEach((c, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].at : prompt.length;
    const role = narrator === null ? 'turn' : (c.name === narrator ? 'assistant' : 'user');
    sections.push({ start: c.at, end, role, name: c.name, wrap: [{ start: c.at, end: c.at + c.len }] });
  });
  return sections;
}

// A turn that opens with "Name:" (SillyTavern's "include names") gets that name.
function addNames(prompt, sections, names) {
  if (!names.length) return;
  for (const s of sections) {
    if (s.name || (s.role !== 'user' && s.role !== 'assistant')) continue;
    const bodyStart = s.wrap.length ? s.wrap[0].end : s.start;
    const head = prompt.slice(bodyStart, Math.min(s.end, bodyStart + LIMITS.nameChars + 4)).replace(/^\s+/, '');
    for (const n of names) {
      if (head.startsWith(n + ':')) { s.name = n; break; }
    }
  }
}

// Take a text-completion prompt apart.
//   prompt     the request's prompt string
//   request    the whole request (for its stop strings), may be null
//   options    { known: [{ start, end }] located known pieces,
//                templates: [...] preset templates (from templateFromPreset),
//                preferred: key ("source|name") of the template to try first (the one this session used),
//                onlyBuiltIn: try only the built-in list (and the preferred template) }
// Returns { how: 'template' | 'names' | 'none', template: { name, source } | null,
//           sections: [{ start, end, role, name, wrap: [{ start, end }] }] }
// role is 'system', 'user', 'assistant', 'between' (text between turns) or 'turn' (role unknown).
function splitTextPrompt(prompt, request, options = {}) {
  const whole = { how: 'none', template: null, sections: [{ start: 0, end: String(prompt || '').length, role: 'prompt', name: '', wrap: [] }] };
  try {
    if (typeof prompt !== 'string' || !prompt) return whole;
    const known = prepareKnown((Array.isArray(options.known) ? options.known : [])
      .filter(k => k && Number.isInteger(k.start) && Number.isInteger(k.end) && k.end > k.start));
    const { stops, names } = stopInfo(request);
    const presets = (Array.isArray(options.templates) ? options.templates : []).slice(0, LIMITS.presets);
    // options.onlyBuiltIn: the caller found no preset fitting several requests in a row, so only
    // the built-in list (and the preferred template) are tried.
    const candidates = options.onlyBuiltIn ? [...BUILT_IN] : [...presets, ...BUILT_IN];
    const ctx = { spent: 0, overBudget: false };
    const keyOf = t => `${t.source}|${t.name}`;

    // The preferred template first: if it still fits, no need to score the rest.
    let best = null;
    const preferred = [...presets, ...BUILT_IN].find(t => keyOf(t) === options.preferred);
    if (preferred) {
      const r = scoreTemplate(prompt, preferred, known, stops, ctx);
      if (r.score > 0) best = { template: preferred, ...r };
    }
    if (!best) {
      for (const t of candidates) {
        if (ctx.overBudget) break;
        const r = scoreTemplate(prompt, t, known, stops, ctx);
        if (r.score > 0 && (!best || r.score > best.score)) best = { template: t, ...r };
      }
    }
    if (ctx.overBudget) return whole;   // too much to search: shown as one block, never slow

    let result = null;
    if (best) {
      const sections = cutByTemplate(prompt, best.template, best.openers, known, ctx);
      if (sections.length) {
        addNames(prompt, sections, names);
        result = { how: 'template', template: { name: best.template.name, source: best.template.source, key: keyOf(best.template) }, sections };
      }
    }
    if (!result && names.length) {
      const sections = cutByNames(prompt, names, known, ctx);
      if (sections) result = { how: 'names', template: null, sections };
    }
    if (!result || ctx.overBudget) return whole;

    // The promise this file makes: the sections cover the prompt exactly, in order.
    let at = 0;
    for (const s of result.sections) {
      if (s.start !== at || s.end <= s.start) return whole;
      at = s.end;
    }
    return at === prompt.length ? result : whole;
  } catch (_) {
    return whole;
  }
}

// A section's text without its wrapper markers (for comparing turns and recognising requests).
function innerText(prompt, section) {
  let out = '';
  let at = section.start;
  for (const w of section.wrap || []) {
    out += prompt.slice(at, w.start);
    at = w.end;
  }
  return out + prompt.slice(at, section.end);
}

module.exports = { splitTextPrompt, templateFromPreset, innerText, stopInfo, BUILT_IN, LIMITS };
