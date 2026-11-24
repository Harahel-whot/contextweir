// Dev tool (not shipped to users): makes the demo folder that ships with the tools, so people
// can explore PromptAssay before setting anything up, and so screenshots, the screen recording
// and the public test fixtures never need a real log (real logs hold sealed Cores and private
// play). EVERYTHING HERE IS MADE UP: the Lantern Coast, its people, the player "Wren", every
// prompt and every reply. Nothing is copied from a real session.
//
// It writes tools\demo\:
//   README.txt
//   characters\Lantern Coast.json    a character card (SillyTavern's card format as a JSON file; SillyTavern
//                                    can import it. JSON, not PNG: the tools' own copy step only carries text)
//   worlds\Lantern Coast.json        a lorebook in SillyTavern's format
//   rules\lantern_coast_rules.json   a rule set (also an example to import into ContextWeir)
//   logs\session_2026-01-01T10-00-00-000Z\records.jsonl and summary.json
//                                    12 requests laid out the way SillyTavern sends them, with
//                                    flags worked out by ContextWeir's own rule engine
// Run again after changing anything here:  node make_demo.js <tools folder>
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const OUT = path.join(root, 'demo');
const { validateRules, checkRules, messagesOf, contentText } = require(path.join(root, 'contextweir', 'lib', 'rules_engine.js'));

const PLAYER = 'Wren';
const CREDIT = 'Made-up demo for the Wellspring tools (ContextWeir and PromptAssay). Directed by Harahel-Whot. '
  + 'Written by Claude Opus 5.5 (Anthropic). Licence: CC BY 4.0 (see LICENSE.txt).';

// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------

const CARD = {
  name: 'The Lantern Coast',
  description: 'The Lantern Coast is a cold, foggy stretch of shore where the lighthouses are kept by an old guild of keepers. '
    + '{{user}} has just arrived as the new apprentice at Greywick Light, the oldest lighthouse on the coast. '
    + 'The narrator plays everyone {{user}} meets and describes the sea, the weather and the lamp.',
  personality: 'Quiet, patient narration. The coast is lonely but not cruel; people are slow to trust and loyal once they do.',
  scenario: 'Late autumn. The keeper of Greywick Light, Odile Marsh, has asked the guild for an apprentice. {{user}} arrives at dusk on the last ferry.',
  system_prompt: 'You are the narrator of a slow, atmospheric story set on the Lantern Coast. Write in the second person, two or three '
    + 'short paragraphs a turn. Never speak for {{user}}. Keep the world consistent with what has been established.',
  post_history_instructions: 'End every reply with a status line on its own line, exactly in this shape: '
    + '[Tide: rising or falling | Lamp: lit or dark | Place: where {{user}} is]',
  first_mes: 'The ferry leaves you on the stone quay just as the light fails. Above the village, at the top of a long flight of '
    + 'steps cut into the cliff, Greywick Light is still dark: nobody has lit the lamp yet tonight.\n\n'
    + '[Tide: rising | Lamp: dark | Place: the quay]',
  mes_example: '<START>\n{{user}}: I look out to sea.\n{{char}}: The fog sits low on the water, and somewhere out in it a bell '
    + 'rings once, very far away.\n[Tide: falling | Lamp: lit | Place: the gallery]',
};

// ---------------------------------------------------------------------------------------------
// The lorebook (each entry has keys, as in SillyTavern; position 0 = before the chat, 1 = at depth)
// ---------------------------------------------------------------------------------------------

const ENTRIES = [
  { comment: '[Place] Greywick Light', key: ['Greywick', 'lighthouse'], where: 'before',
    content: 'Greywick Light is a squat white tower on the cliff above Greywick village, the oldest light on the Lantern Coast. '
      + 'Its lamp burns whale oil and must be trimmed twice a night. The keeper\'s cottage leans against its seaward side.' },
  { comment: '[Place] The Salt Steps', key: ['salt steps', 'steps'], where: 'before',
    content: 'The Salt Steps are three hundred and twelve steps cut into the cliff between the quay and Greywick Light. '
      + 'They are slick with spray in any wind, and the village children count them aloud for luck.' },
  { comment: '[Person] Keeper Odile Marsh', key: ['Odile', 'keeper', 'knock'], where: 'depth',
    content: 'Odile Marsh has kept Greywick Light for thirty-one years. She is small, weathered and blunt, speaks little, and '
      + 'tests every apprentice with chores before she trusts them with the lamp. She calls {{user}} "the new hands".' },
  { comment: '[Lore] The Drowned Bell', key: ['bell', 'drowned'], where: 'depth',
    content: 'On still nights a bell can be heard ringing out at sea where no buoy is moored. The village says it belongs to a '
      + 'chapel that slid into the sea in a storm long ago. Odile will not talk about it, and she always lights the lamp early '
      + 'when it rings.' },
  { comment: '[Rule] Tide hours', key: ['tide', 'wick', 'lamp'], where: 'depth',
    content: 'The lamp is lit at dusk and trimmed at the turn of each tide. A keeper who misses a trimming writes it in the log '
      + 'in red ink. Two red lines in a month and the guild sends an inspector.' },
  { comment: '[Person] Tamsin the ferrywoman', key: ['ferry', 'Tamsin'], where: 'depth',
    content: 'Tamsin runs the only ferry between Greywick and the mainland. She is loud, cheerful and knows every rumour on the '
      + 'coast, but she will not take the boat out after the bell has rung.' },
];

function lorebookFile() {
  const entries = {};
  ENTRIES.forEach((e, uid) => {
    entries[uid] = {
      uid, key: e.key, keysecondary: [], comment: e.comment, content: e.content, constant: false, selective: true,
      order: 100, position: e.where === 'before' ? 0 : 4, depth: e.where === 'before' ? 4 : 4, disable: false,
    };
  });
  return { _about: CREDIT, entries };
}

// ---------------------------------------------------------------------------------------------
// The rule set: ContextWeir's General rules plus two for this story
// ---------------------------------------------------------------------------------------------

const RULES = {
  _about: CREDIT,
  format: 'contextweir-rules',
  version: 1,
  groups: [
    { name: 'General', enabled: true, rules: [
      { name: 'Empty reply', enabled: true, severity: 'serious', target: 'reply', test: 'regexMissing', value: '\\S',
        note: 'The model sent nothing back.' },
      { name: 'Reply starts with OOC', enabled: true, severity: 'warning', target: 'reply', test: 'regex', value: '^\\s*(?:[(\\[]\\s*)?OOC\\b',
        note: 'The narrator stepped out of the story.' },
      { name: 'Model speaks as the AI', enabled: true, severity: 'warning', target: 'reply', test: 'regex', value: '\\bas an AI\\b|\\blanguage model\\b' },
    ] },
    { name: 'Lantern Coast', enabled: true, rules: [
      { name: 'No status line', enabled: true, severity: 'warning', target: 'reply', test: 'missing', value: '[Tide:',
        unless: [{ target: 'lastMessage', test: 'regex', value: 'summari[sz]e', flags: 'i' }],
        note: 'Every story reply should end with the [Tide: | Lamp: | Place:] line. Summarize requests are skipped.' },
      { name: 'The bell is named', enabled: true, severity: 'note', target: 'reply', test: 'contains', value: 'drowned bell',
        note: 'Just a marker: shows where the story mentions the Drowned Bell by name.' },
    ] },
  ],
};

// ---------------------------------------------------------------------------------------------
// The session: what the player did, and what came back
// ---------------------------------------------------------------------------------------------

const fill = s => s.replace(/\{\{user\}\}/g, PLAYER).replace(/\{\{char\}\}/g, CARD.name);
const status = (tide, lamp, place) => `\n\n[Tide: ${tide} | Lamp: ${lamp} | Place: ${place}]`;

// Each step: the player's message (or a special kind), and the reply. swipe: same history as before.
const STEPS = [
  { say: 'I shoulder my bag and start up the salt steps toward the lighthouse.',
    reply: 'The steps are wet and the wind pushes at your back as if it wants you up there quickly. Halfway, you stop to breathe '
      + 'and count: one hundred and sixty. Below, the ferry is already a small grey shape heading home.' + status('rising', 'dark', 'the Salt Steps') },
  { say: 'At the top I knock on the keeper\'s door.',
    reply: 'The door opens before your second knock. A small woman in an oilskin looks you up and down. "The new hands," she says. '
      + '"You\'re late. The lamp\'s later." She steps aside to let you in.' + status('rising', 'dark', 'the keeper\'s cottage') },
  { swipe: true,
    reply: 'Nobody answers. Then a voice calls from above, from the gallery of the tower: "Door\'s open. Come up, and mind the '
      + 'third stair, it\'s loose." You climb into the smell of oil and salt.' + status('rising', 'dark', 'the tower stairs') },
  { say: 'I ask Odile about the bell I heard from the ferry.',
    reply: 'OOC: Should Odile tell Wren the legend now, or keep it for later?\n\nOdile stops wiping the lens. "You heard it," she '
      + 'says, not a question. "Then we light early tonight." She will not say more about the drowned bell.' + status('rising', 'lit', 'the lamp room') },
  { say: '(OOC: please stay in the story and decide for yourself.) I watch her light the lamp.',
    reply: 'She strikes a match with one hand and opens the oil valve with the other, without looking. The wick catches, the lens '
      + 'turns, and the beam goes out across the water like a slow white arm.' + status('rising', 'lit', 'the lamp room') },
  { summarize: true,
    reply: 'Wren arrived at Greywick on the last ferry, climbed the Salt Steps and met Keeper Odile Marsh, who calls Wren "the new '
      + 'hands". A bell was heard at sea; Odile lit the lamp early and refused to talk about it.' },
  { say: 'I offer to trim the lamp wick at the turn of the tide.',
    reply: 'Odile hands you the scissors without a word. You trim the wick the way she showed you, square and short, and the flame '
      + 'steadies. She writes the time in the log in black ink.' + status('turning', 'lit', 'the lamp room') },
  { say: 'We sit on the gallery and watch the tide come in.', model: 'demo-model-large',
    reply: 'The sea climbs the rocks below in long grey breaths. She smokes a pipe and says nothing for a long time, then: "You did '
      + 'well with the wick." It sounds like it costs her something to say.' + status('rising', 'lit', 'the gallery') },
  { say: 'I ask whether the bell rings often.', model: 'demo-model-large',
    reply: '' },
  { swipe: true, model: 'demo-model-large',
    reply: '"Often enough," she says. "More in autumn. You\'ll learn to sleep through it, or you won\'t." She taps out her pipe '
      + 'on the rail and goes in.' + status('rising', 'lit', 'the gallery') },
  { say: 'In the morning I walk down to the quay to meet the ferry.', model: 'demo-model-large',
    reply: 'Tamsin is already tying up, shouting greetings to everyone and no one. "So you\'re the new hands!" she calls. "Odile '
      + 'bit you yet?" She laughs at your face before you can answer.' + status('falling', 'dark', 'the quay') },
  { say: 'I ask Tamsin what happened to the keeper before Odile.', model: 'demo-model-large',
    reply: 'Tamsin stops laughing. She looks up at the tower, then out to sea, and lowers her voice. "Ask Odile," she says. '
      + '"And if she won\'t tell you, that\'s your answer." She turns back to her ropes.' },
];

const SUMMARIZE = '[Pause your roleplay. Summarize the most important facts and events in the story so far. '
  + 'If a summary already exists in your memory, use that as a base and expand with new facts. '
  + 'Limit the summary to 100 words or less. Your response should include nothing but the summary.]';

// Which lorebook entries a turn brings in: SillyTavern scans the recent messages for the keys.
function entriesFor(recentText) {
  const t = recentText.toLowerCase();
  return ENTRIES.filter(e => e.key.some(k => t.includes(k.toLowerCase())));
}

// Build one request the way SillyTavern lays out a chat-completion prompt.
function buildRequest(history, summary, model, extraLast) {
  const recent = history.slice(-4).map(m => m.content).join('\n');
  const found = entriesFor(recent + (extraLast || ''));
  const before = found.filter(e => e.where === 'before');
  const atDepth = found.filter(e => e.where === 'depth');

  const msgs = [{ role: 'system', content: fill(CARD.system_prompt) }];
  if (summary) msgs.push({ role: 'system', content: `[Summary: ${summary}]` });
  msgs.push({ role: 'system', content: fill(CARD.description) });
  msgs.push({ role: 'system', content: fill(CARD.personality) });
  if (before.length) msgs.push({ role: 'system', content: before.map(e => fill(e.content)).join('\n') });
  msgs.push({ role: 'system', content: fill(CARD.scenario) });
  msgs.push({ role: 'system', content: '[Start a new Chat]' });

  const chat = history.map(m => ({ role: m.role, content: m.content }));
  if (atDepth.length) {
    const at = Math.max(0, chat.length - 4);   // "at depth 4": four messages from the end
    chat.splice(at, 0, { role: 'system', content: atDepth.map(e => fill(e.content)).join('\n') });
  }
  msgs.push(...chat);
  if (extraLast) msgs.push({ role: 'system', content: extraLast });
  else msgs.push({ role: 'system', content: fill(CARD.post_history_instructions) });

  return {
    messages: msgs, model, temperature: 0.8, max_tokens: 400, stream: true, presence_penalty: 0, frequency_penalty: 0,
    top_p: 0.95, top_k: 40, min_p: 0.05, repetition_penalty: 1.05,
  };
}

// The same request as SillyTavern sends it in TEXT COMPLETION with the ChatML instruct template and
// names included: one prompt string. (A made-up example until a real capture replaces it; the
// layout follows SillyTavern's instruct mode: story string first, each message wrapped in the
// template's markers, the reply started with the character's name.)
const SESSION_NAMES = { chat: 'session_2026-01-01T10-00-00-000Z', text: 'session_2026-01-02T10-00-00-000Z' };

function toTextRequest(chatReq) {
  const msgs = chatReq.messages;
  const firstChat = msgs.findIndex(m => m.role !== 'system');
  const story = msgs.slice(0, firstChat).map(m => m.content).join('\n');
  let prompt = `<|im_start|>system\n${story}<|im_end|>\n`;
  for (const m of msgs.slice(firstChat)) {
    if (m.role === 'user') prompt += `<|im_start|>user\n${PLAYER}: ${m.content}<|im_end|>\n`;
    else if (m.role === 'assistant') prompt += `<|im_start|>assistant\n${CARD.name}: ${m.content}<|im_end|>\n`;
    else prompt += `<|im_start|>system\n${m.content}<|im_end|>\n`;
  }
  prompt += `<|im_start|>assistant\n${CARD.name}:`;
  const { messages, presence_penalty, frequency_penalty, ...rest } = chatReq;
  return { prompt, ...rest, stop: ['<|im_end|>', `\n${PLAYER}:`, `\n${CARD.name}:`], rep_pen: 1.05 };
}

function makeSession(mode = 'chat') {
  const rules = validateRules(RULES, 'demo').groups;
  const history = [{ role: 'assistant', content: fill(CARD.first_mes) }];
  let summary = '';
  let model = 'demo-model';
  const records = [];
  const start = Date.parse(mode === 'text' ? '2026-01-02T10:00:00.000Z' : '2026-01-01T10:00:00.000Z');
  let clock = start;

  STEPS.forEach((step, i) => {
    model = step.model || model;
    let request;
    let swipe = false;
    if (step.swipe) {
      // Same history as the request before: drop the last reply and ask again.
      history.pop();
      swipe = true;
      request = buildRequest(history, summary, model);
    } else if (step.summarize) {
      request = buildRequest(history, summary, model, SUMMARIZE);
    } else {
      history.push({ role: 'user', content: step.say });
      request = buildRequest(history, summary, model);
    }
    if (mode === 'text') request = toTextRequest(request);
    const flags = checkRules(rules, request, step.reply);
    const seconds = Math.round((4 + (i * 7) % 9 + step.reply.length / 120) * 10) / 10;
    clock += Math.round(seconds * 1000) + 25000 + (i % 3) * 9000;
    records.push({
      format: 'contextweir-log', version: 1, n: i + 1, time: new Date(clock).toISOString(),
      endpoint: mode === 'text' ? '/v1/completions' : '/v1/chat/completions', status: 200, seconds, swipe,
      promptChars: messagesOf(request).reduce((a, m) => a + contentText(m.content).length, 0),
      replyCut: false, replyShape: 'openai', mode, flags, request, reply: step.reply,
    });
    if (step.summarize) summary = step.reply;
    else history.push({ role: 'assistant', content: step.reply });
  });

  const byRule = {};
  for (const r of records) for (const f of r.flags) byRule[f.name] = (byRule[f.name] || 0) + 1;
  const n = records.length;
  const totalMs = records.reduce((a, r) => a + r.seconds * 1000, 0);
  const summaryJson = {
    format: 'contextweir-log', version: 1, tool: 'ContextWeir', toolVersion: 'demo', toolBuilt: 'made-up demo',
    session: SESSION_NAMES[mode], demo: true,
    note: mode === 'text'
      ? 'A made-up session that ships with the tools: the same story in text completion (ChatML instruct template). Nothing in it comes from a real chat.'
      : 'A made-up session that ships with the tools. Nothing in it comes from a real chat.',
    started: new Date(start).toISOString(), updated: records[n - 1].time,
    frontend: { name: 'SillyTavern', version: '1.19.0', readFrom: 'made-up demo' },
    modelServer: { server: { name: 'KoboldCpp', version: 'demo' }, models: ['demo-model'], reachable: true },
    requests: n, swipes: records.filter(r => r.swipe).length, errors: 0, totalMs,
    totalPromptChars: records.reduce((a, r) => a + r.promptChars, 0),
    flagged: records.filter(r => r.flags.length).length, byRule, notLogged: 0, unrecognised: 0,
    textRequests: mode === 'text' ? n : 0,
    avgSeconds: Math.round(totalMs / n / 100) / 10,
    avgPromptChars: Math.round(records.reduce((a, r) => a + r.promptChars, 0) / n),
    warningsPer100: Math.round(records.filter(r => r.flags.length).length / n * 1000) / 10,
  };
  return { records, summaryJson };
}

// ---------------------------------------------------------------------------------------------
// The card as a JSON file in SillyTavern's card format (chara_card_v2)
// ---------------------------------------------------------------------------------------------

function cardJson(card) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { ...card, creator_notes: CREDIT, tags: ['demo'] } };
}

// ---------------------------------------------------------------------------------------------

const README = `MADE-UP DEMO FOR CONTEXTWEIR AND PROMPTASSAY
${CREDIT}

Everything in this folder is invented: the Lantern Coast, Keeper Odile Marsh, Tamsin, the player
"Wren", every prompt and every reply. No real chat was used. It is here so you can explore
PromptAssay before setting anything up, and so screenshots and tests never need a real log
(real logs can hold private play and story secrets).

PromptAssay lists the demo session at the bottom of its session list, marked "demo (made up)",
labelled against the demo's own card and lorebook. To hide it, set "showDemo": false in
promptassay\\settings.json.

What to look for in the 12 requests:
  #1   the Salt Steps and Greywick Light entries arrive (keys: steps, lighthouse)
  #2-3 a swipe: the same history asked twice, two different replies
  #4   a flagged reply ("Reply starts with OOC"), and the Drowned Bell entry entering
  #6   SillyTavern's Summarize request (no status line expected, so not flagged)
  #7   the summary now sits in the prompt as "[Summary: ...]"
  #8   the model asked for changes (demo-model -> demo-model-large)
  #9   an empty reply, flagged serious; #10 is its regenerate
  #11  Tamsin enters, Odile's entry leaves
  #12  a story reply without its status line ("No status line")

A SECOND SESSION (2 Jan) holds the same 12 requests as SillyTavern sends them in TEXT COMPLETION
with the ChatML instruct template: one prompt string per request. PromptAssay takes it apart into
the same kind of sections ("by template") and says how it did. This one is also made up, laid out
the way SillyTavern's instruct mode builds a prompt; it will be replaced by a real capture made with
this demo card.

Files:
  characters\\Lantern Coast.json    the character card (SillyTavern can import it)
  worlds\\Lantern Coast.json        the lorebook
  rules\\lantern_coast_rules.json   a rule set: import it on ContextWeir's Rules tab to try one
  logs\\session_...\\               the two recorded sessions, in ContextWeir's log format 1
Made by dev\\make_demo.js (not shipped).
`;

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['characters', 'worlds', 'rules']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
fs.writeFileSync(path.join(OUT, 'README.txt'), README);
fs.writeFileSync(path.join(OUT, 'characters', 'Lantern Coast.json'), JSON.stringify(cardJson(CARD), null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'worlds', 'Lantern Coast.json'), JSON.stringify(lorebookFile(), null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'rules', 'lantern_coast_rules.json'), JSON.stringify(RULES, null, 2) + '\n');
for (const mode of ['chat', 'text']) {
  const { records, summaryJson } = makeSession(mode);
  const sessionDir = path.join(OUT, 'logs', SESSION_NAMES[mode]);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'records.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(sessionDir, 'summary.json'), JSON.stringify(summaryJson, null, 2) + '\n');
  console.log(`demo ${mode} session written: ${records.length} requests, ${summaryJson.flagged} flagged`, summaryJson.byRule);
}
