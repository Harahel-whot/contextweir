// ContextWeir 0.6.0.0, built 25 Nov 2026. Part of the Wellspring tools.
// Directed by Harahel-Whot. Written by Claude Opus 5.5 (Anthropic).
// Licence: MIT (see LICENSE.txt). Source: https://github.com/Harahel-Whot/contextweir

// ============================================================================
// ContextWeir rule worker
// ----------------------------------------------------------------------------
// Runs the flag rules in a thread of its own, so a rule that takes too long
// (a badly written or hostile pattern) can be stopped from outside without
// freezing the recorder. Before each rule it writes that rule's position into
// a small shared counter; if the main program has to stop this thread, it can
// read the counter to see which rule was running.
//
// Messages in:  { type: 'rules', file }                 the rule set to use
//               { type: 'check', job, request, reply }  check one turn
// Message out:  { job, flags }
// ============================================================================

'use strict';

const { parentPort, workerData } = require('worker_threads');
const { validateRules, checkRules } = require('./rules_engine');

// progress[0] = position of the rule running now, plus 1 (0 = none running)
const progress = new Int32Array(workerData.progress);
let groups = [];

parentPort.on('message', msg => {
  if (msg.type === 'rules') {
    groups = validateRules(msg.file, 'worker').groups;   // checked again here: the worker trusts nothing it is sent
    return;
  }

  if (msg.type === 'check') {
    let flags;
    try {
      flags = checkRules(groups, msg.request, msg.reply, i => Atomics.store(progress, 0, i + 1));
    } catch (e) {
      flags = [{
        rule: 'contextweir', name: 'rule check failed: ' + e.message,
        group: 'ContextWeir', severity: 'note', target: 'reply', match: '',
      }];
    }
    Atomics.store(progress, 0, 0);
    parentPort.postMessage({ job: msg.job, flags });
  }
});
