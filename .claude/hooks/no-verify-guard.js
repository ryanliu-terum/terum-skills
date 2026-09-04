// Block Claude-initiated `git push --no-verify`.
//
// WHY: the pre-push hook runs typecheck + the bug-log status gate. The single most common
// reason to reach for --no-verify is "dependencies not installed", which is not a gate
// failure at all — it is a fresh worktree missing node_modules, fixed by one `npm install`.
// On 2026-07-28 that exact sequence traded both gates for a 60-second install. The hook's
// own message used to advertise the bypass on the same line as the remedy; that wording is
// fixed, and this guard closes the loop so the bypass is a decision Ryan makes, not one a
// session makes for him.
//
// SCOPE: this only intercepts Claude's own Bash calls. Ryan running `git push --no-verify`
// in his terminal is untouched — the escape hatch still exists, it just needs a human.
const fs = require('fs');

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // never break a tool call on a malformed payload
}

const command = input.tool_input?.command || '';

// Check each shell segment separately and require it to START with git (after any leading
// `cd x &&` or `FOO=bar` env prefix). Substring matching on the whole command is wrong in
// both directions: it misses `git -c core.hooksPath= push --no-verify` (the `-c` takes a
// separate-token argument, so a "git then flags then push" pattern breaks), and it fires on
// any command that merely CONTAINS the string — an `echo`, a heredoc, a PR body documenting
// this very rule. Both were caught by testing this file's own examples.
//
// `-n` is deliberately NOT treated as a bypass: for git-push it is --dry-run, and
// --no-verify has no short form here, so matching it would block harmless dry runs.
const segments = command.split(/&&|\|\||;|\|/);
const isPushBypass = (seg) =>
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git\b/.test(seg) &&
  /\bpush\b/.test(seg) &&
  /--no-verify\b/.test(seg) &&
  // A deletion-only push carries no code to gate, and .githooks/pre-push already skips its
  // gates for that case — bypassing adds nothing, so don't wedge branch cleanup behind a
  // prompt. Matches `--delete` and the `:branch` colon-refspec deletion form.
  !/--delete\b|\s:\S+/.test(seg);

if (!segments.some(isPushBypass)) process.exit(0);

console.error(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: [
      '`git push --no-verify` is blocked for agent sessions.',
      '',
      'The pre-push gate runs typecheck + the bug-log status gate. Bypassing it is a',
      "call for Ryan to make, not one to make on his behalf. Work out WHICH gate is",
      'actually failing first — they have different fixes:',
      '',
      '  "dependencies not installed"  → NOT a gate failure. This checkout has no',
      '     node_modules (a fresh worktree needs its own, even when the primary is',
      '     fully installed). Fix: cd into the checkout being pushed FROM and run',
      '     `npm install`. If the task is too throwaway to justify that — a one-file',
      "     docs or bug-log flip — don't use a worktree for it at all.",
      '',
      '  typecheck failed             → fix the type errors.',
      '',
      '  bug-log status drift         → `npm run check:bug-log-status -- --fix`.',
      '',
      '  main requires staging first  → land via staging; `staging-first.yml` auto-lands',
      '     non-draft PRs, so usually you just open the PR and wait.',
      '',
      'If you genuinely need the bypass, say so and let Ryan decide — he can run the',
      'push himself, or tell you to proceed.',
    ].join('\n'),
  },
}));
process.exit(2);
