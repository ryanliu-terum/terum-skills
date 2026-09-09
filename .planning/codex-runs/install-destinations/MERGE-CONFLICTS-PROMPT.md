Resolve the git merge conflicts in this worktree. Read AGENTS.md at the repo root first. You may NOT run any git command (the worktree's git metadata is outside your writable root); edit the files in place and remove every `<<<<<<<`, `=======`, `>>>>>>>` marker. Do not touch anything else. Do not commit.

Context: HEAD is `feat/checkouts-cli` (CLI-1: a checkouts registry; it renamed the local-folder hint's `scope` field to `label` — values like `Global` or a repo basename — and added `checkout add|remove|list` rows to the bundled skill doc). The merged-in side is `feat/one-team-per-machine-cli` (one team per machine: every user-facing hint drops the `--team <t>` option, and `teamOption` is gone from publish.ts). Keep BOTH intents: CLI-1's `label` field and checkout rows, one-team's removal of `--team` from hints.

Files with conflicts:

1. `src/commands/publish.ts` (one hunk near line 236): take HEAD's `({ path, label })` / `(${label})` shape, but drop the `+ teamOption` and any `--team` text as the other side does. Then grep the file: `teamOption` must be either defined and used, or absent — it must not be referenced without a definition.

2. `src/commands/__tests__/publish.test.ts` (one hunk near line 369): expectations without `--team 'team'` (one-team side) AND with HEAD's `(Global)` label text (CLI-1 side): i.e. `connect '${project}'`, `publish 'local' --project 'p'`, `Found a local folder at ${global} (Global) that`, `connect '${global}'`.

3. `src/commands/__tests__/setup.test.ts` (one hunk at line 1): union of the imports — keep `createExecute`, `ResultOutcome`, and `import { realpath, mkdir, readFile, rm, writeFile } from 'node:fs/promises';`.

4. `.claude/skills/terum-skills/SKILL.md` (two hunks near lines 49 and 86): take HEAD's three rows (`status`, `ls`, `checkout add/remove/list`) but with `[--team <t>]` removed from the `status` and `ls` cells as the other side does; second hunk keep HEAD's `checkout add (no path)` row and the `connect (no path)` row with the command `npx -y terum-skills@latest connect` (no `--team <team>`).

Then run `npm run lint`, `npm run typecheck` and `npx vitest run src/commands/__tests__/publish.test.ts src/commands/__tests__/setup.test.ts src/lib/__tests__/invocation-hints.test.ts src/commands/__tests__/invocation-hints.test.ts` (whichever of those test paths exist) and report real results. If a test other than those fails because of a `--team` / `label` mismatch introduced by this merge, fix the expectation in the same spirit and say so. If node_modules is not yet present, wait — retry the commands after a minute, up to three times — and report if it never appears.

Report as JSON: { "resolved": [files], "gates": {"lint": "...", "typecheck": "...", "tests": "..."}, "notes": "..." }.
