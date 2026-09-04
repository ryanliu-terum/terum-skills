# AGENTS.md — loader for non-Claude agents (Codex)

You do not run this repo's Claude hooks and nothing auto-loads `CLAUDE.md` for you. Read this
file first, then `./CLAUDE.md`, then the document that owns what you are touching.

## What this repo is

The planning and harness repo for **terum-skills**, an open-source CLI (npm `terum-skills`,
Apache-2.0) that lets a team share private Claude Code skills through one private git repo, with
no server. **There is no product source yet.** When implementation starts, code lands under
`src/` in the layout the build spec §3 defines. Until then, "the code" means the spec.

## Which document wins

1. `.planning/specs/2026-09-02-phase-1-build.md` — the **build spec**. Authoritative. Rev and
   date are in its status line; every rev is a full replacement, not a delta.
2. `.planning/specs/2026-09-01-team-skill-sharing.md` — the **decision ledger** (D1…D39).
   Background and rationale. Where it and the build spec disagree, the build spec wins.
3. `.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md` — the decision walk.
   History of how forks were closed. Decision 3 was reopened 2026-09-03; its reopen note wins
   over the original text below it.
4. `.planning/specs/reviews/*.codex-spec.r*.review.md` — prior audit rounds. Evidence, not rules.

Status tags in the ledger mean what they say: DECIDED is settled; PROPOSED is a recommendation;
OPEN is blank on purpose. In the build spec, **`[default — veto cheap]`** marks a default the
author chose to close a gap — implement it as written, do not treat it as undecided.

## Invariants you must hold when you write code here

- **Nothing runs anywhere but laptops and the git host.** No HTTP client, no server, no daemon,
  no third-party CLI on the install path. Shell out only to `git` and `gh`.
- **Every write to the team repo goes through `safeWrite()`** (build spec §6.0): fetch, hard-reset
  the clone to `origin/main`, re-run a *pure* mutation, commit, push, retry to a 30-second deadline.
  A mutation that does I/O, mints an ID, or prompts is a bug.
- **The guard is the authorization model** (§6.0 table): a diff may touch only the paths the
  caller owns. Do not add a write path that bypasses it.
- **Consent is a predicate on the normalized `allowed-tools` set** (§5.4 `approvals`). A changed
  grant hash is no approval. `sync --hook` never places an unapproved grant; it announces on
  stderr and prints nothing else but the reload directive on stdout.
- **Provenance is the `placements` ledger** (§5.4). It is the only source of deletable paths.
  Never infer ownership from what happens to be on disk; never write a marker inside a placed
  folder; never delete outside `~/.terum/skills/quarantine/`.
- **Placement is native and explicit** (§7): copy into a temp sibling, rename into place, under
  the per-target lock, into the directory the agent path table names for the agent the caller
  passed. Never auto-detect agents, never prompt for scope, never write `.agents/skills` in
  phase 1.
- **Vendored code keeps its provenance.** `src/lib/placer/vendor/skillhub/` is copied from
  iflytek/skillhub (Apache-2.0). Keep iFlytek's copyright header on each file, add a NOTICE
  entry, mark any modified file. Do not vendor its auto-detect, prompt, or in-folder metadata code.
- **Frontmatter is Agent-Skills-legal** (§5.3): top-level `name`/`description`/`license` only;
  everything custom nests under `metadata`. Skill folder name equals frontmatter `name`.
- **One active path per behavior.** Before writing a function, grep for one that already does the
  job and extend or replace it in the same change. Never leave two paths doing the same thing.

## Gates and sandbox

- Run with `--sandbox workspace-write`. `--dangerously-bypass-approvals-and-sandbox` is banned.
- Never `git push --no-verify`. Never push at all unless the task says so.
- Once `src/` exists: `npm run lint`, `npm run typecheck`, `npm test` (vitest, collocated under
  `src/**/__tests__/`, bare-repo fixtures, no network). Report their real output; a self-reported
  green gate is a hypothesis the reviewer re-runs.
- Use absolute paths in shell commands; do not `cd`.

## Things that look wrong and are not

- `safeWrite` hard-resets the clone. Deliberate: no local commit is ever carried forward, so there
  is nothing to rebase or conflict.
- `publish` under the `"pr"` policy pushes a branch and exits when `gh` is missing. Deliberate: a
  missing tool never downgrades a review gate to a direct push.
- A hand-edited placed copy is overwritten on `sync` and moved to quarantine. Deliberate: placed
  copies are generated output, not an authoring surface; the source is what you edit.
- The session hook is async and promises no same-session reload. Deliberate: a network pull must
  never sit in front of session start.
- Handles are per team, not global. Deliberate: it is the only shape in which a second-team
  collision is recoverable.
- `metadata.author` is `Name <email>`, never the handle. Deliberate: SkillEvaluator's schema.
