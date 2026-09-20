# AGENTS.md — loader for non-Claude agents (Codex)

You do not run this repo's Claude hooks and nothing auto-loads `CLAUDE.md` for you. Read this
file first, then `./CLAUDE.md`, then the document that owns what you are touching.

## What this repo is

The planning and harness repo for **terum-skills**, an open-source CLI (npm `terum-skills`,
Apache-2.0) that lets a team share private Claude Code skills through one private git repo, with
no server. **There is no product source yet.** When implementation starts, code lands under
`src/` in the layout the build spec §3 defines. Until then, "the code" means the spec.

## Which document wins

The build spec and decision ledger that drove the original implementation are not tracked in the
working tree; they remain in this repository's git history. The invariants below are the rules that
hold for code written here, and this file wins over any comment or doc that contradicts it.

## Invariants you must hold when you write code here

- **Nothing runs anywhere but laptops and the git host.** No HTTP client, no server, no daemon,
  no third-party CLI on the install path. Shell out only to `git` and `gh`. One recorded exception:
  `terum-skills app`
  and `terum-skills app-update` also run the platform's own tools to unpack, install and open the
  desktop app (`tar`, `open`, the NSIS installer they downloaded through `gh`), and `app-update
  --apply` re-runs this same CLI (`process.execPath`) as a detached process so the install outlives
  the app that asked for it — all through the `Exec` seam in `src/lib/runner.ts`. No new tool and no
  network client enters the product.
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
- **Vendored code keeps its provenance.** `src/lib/placer/vendor/skillhub/` holds two files copied
  from iflytek/skillhub `cli/src/services/` (Apache-2.0): `skill-fingerprint.ts` and
  `skill-target-lock.ts`. Upstream carries no per-file copyright header, so each copy gets an
  attribution header naming the source path, the pinned commit, the license, and whether it was
  modified, plus a NOTICE entry (build spec §3). The Claude Code path row is *derived* from
  skillhub's profile (both paths are `.claude/skills`), not copied — its profile factory bundles
  auto-detect, which is not vendored. Do not vendor its auto-detect, prompt, or in-folder
  metadata code.
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
- CI runs the suite on Linux. On Windows some tests skip rather than fail, each with its reason in
  the source: anything that creates a symlink is gated on `SYMLINKS_SUPPORTED`
  (`src/lib/__tests__/fixtures.ts`, a probe that needs Developer Mode or an elevated shell); POSIX
  mode assertions (0600/0700, executable bits) are guarded by `process.platform !== 'win32'`; and
  the eval engine's setup hooks, requirement probes and `command_succeeds` checks run under
  `/bin/sh`, which Windows lacks, so those cases skip there; tests that make an entry unreadable
  with `chmod` skip on win32 too, since Windows ignores POSIX mode bits. Repo-relative paths a
  plan reports (`copies`, `entries[].to`) come from `path.relative`, so expectations spell them
  with `join(...)`, never a literal `/`. A skip is not a pass: report the skipped count next to
  the passed count, and never add a skip to hide a failure that a Linux run would show.
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
- The hidden `readme` verb writes `README.md` in the current clone directly, not through `safeWrite`.
  Deliberate: it is the GitHub Action's entry point on the host's compute, where there is no
  `~/.terum` config and the Action itself commits; on a laptop, README regeneration for
  non-GitHub remotes still happens inside `safeWrite` (§9).
- `guard.ts` accepts a `previousAuthor` for `sync` only, and only for a write that touches
  `SKILL.md` alone with canonical content unchanged. Deliberate: it is the §5.3 managed-field
  refresh after a config email or license change; it can never carry a content change.
- `safeWrite` runs `git update-index --chmod` after every `git add`. Deliberate: `git add` copies
  the on-disk mode only where `core.filemode` is on, which it is not on Windows, so without it an
  executable bit set by the mutation never reaches the commit and a mode-only change stages
  nothing. On POSIX it restates what `git add` already recorded.
- `remote.ts` accepts a Windows drive path (`C:\Users\me\team.git`, `C:/…`, `file:///C:/…`) as a
  local remote on every platform and normalizes it to `file:C:/…`. Deliberate: a Windows user's
  local bare repo is a remote like any other, and the one parser must spell it one way.
- `placer.ts` treats EPERM from a rename as "destination exists" only after probing the
  destination. Deliberate: Windows reports EPERM both for a rename onto an existing directory and
  for a locked one; the probe tells them apart, and without it every replace on Windows failed.
