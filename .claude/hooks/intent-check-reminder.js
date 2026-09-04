// UserPromptSubmit hook: injects the Intent Check nudge — dosed, not every turn.
// This file is the LIVE copy of the protocol; CLAUDE.md (Response protocol) carries
// a compressed pointer to it.
//
// Dosage (2026-07-28 audit): the always-on version injected ~260 tokens on every
// prompt including one-word follow-ups — cumulative wallpaper. Measured behavior
// (82 intent checks classified: 53 acted-on / 27 noted / 2 pro-forma) shows the
// protocol is internalized, so we re-inject only when it plausibly matters:
//   - first prompt of a session (and the tail state resets after long gaps)
//   - any substantive prompt (>= 200 chars)
//   - every 5th prompt otherwise, to stay warm through long sessions
// Slash-command turns after the first prompt are skipped.
const fs = require('fs');
const os = require('os');
const path = require('path');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}

const prompt = String(input.prompt || '');
const sessionId = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');

const stateDir = path.join(os.tmpdir(), 'claude-intent-check');
try { fs.mkdirSync(stateDir, { recursive: true }); } catch {}

// opportunistic cleanup of stale session state (> 7 days)
try {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(stateDir)) {
    const p = path.join(stateDir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
} catch {}

const stateFile = path.join(stateDir, sessionId + '.json');
let state = { count: 0, sinceInject: 0 };
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
state.count += 1;
state.sinceInject += 1;

const isFirst = state.count === 1;
const isCommand = prompt.startsWith('/') || prompt.includes('<command-name>');
const isSubstantive = prompt.length >= 200;

let inject = isFirst || isSubstantive || state.sinceInject >= 5;
if (isCommand && !isFirst) inject = false;

if (inject) state.sinceInject = 0;
try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}

if (!inject) process.exit(0);

const reminder =
  'INTENT CHECK (CLAUDE.md Response protocol; live copy: .claude/hooks/intent-check-reminder.js): ' +
  'before non-trivial work, lead with — (1) Goal: a hypothesis about what this is for and who benefits, ' +
  'not a restatement; (2) Strongest reason this is the wrong move: a real, task-specific argument against, ' +
  'never a hand-waved hedge; (3) Confidence in the Goal — if you cannot state it confidently, STOP and ask ' +
  'Ryan first. If the request conflicts with the goal, or a materially better path exists, lead with the ' +
  'disagreement. Scale the ceremony to the stakes: one line suffices for small decisions; skip entirely on ' +
  'trivial or purely conversational turns.';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: reminder,
  },
}));
