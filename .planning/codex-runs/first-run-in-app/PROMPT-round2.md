Follow-up to your implementation of the "First run in the app" spec in this worktree (read .planning/codex-runs/first-run-in-app/PROMPT.md for the full spec and the standing constraints; they still apply: no git, no npm install, never weaken a test, report with the output schema).

The orchestrator re-ran every gate outside the sandbox. Root lint/typecheck/build/test all pass (1268 tests). Desktop typecheck and lint pass. Desktop vitest has exactly ONE failure:

 FAIL  src/backend/__tests__/mock.test.ts > returns isolated Settings DTO additions while preserving drawn fixture constants
AssertionError: expected 'signed-in' to deeply equal undefined
 ❯ src/backend/__tests__/mock.test.ts:61:72

Cause: that test enumerates every key of the mock Settings DTO and expects each non-design key to be listed in its `additions` map (line 60). Spec §8.2 added `AGENT_CLI_AUTH: 'signed-in'` to the mock Settings, so the `additions` map must gain `AGENT_CLI_AUTH:'signed-in'` (it is a seam addition, not a design constant). Fix the test that way and nothing else about it.

node_modules is now a real directory of per-package symlinks, so vitest CAN run in your sandbox now. Run and report real counts:
  NODE_OPTIONS=--no-experimental-webstorage npm test --prefix desktop
  npm test   (root)
Both must be fully green. If any other test fails, fix the implementation or the test per the spec (never by weakening an assertion) and say what you changed in testsModified.
