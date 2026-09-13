# B3 slice — migrate test fixtures to layout 3 (`skills/<name>/v1/`)

A **mechanical, enumerable** slice of B3, split out for a Codex run. It is a path transformation plus
one literal edit. It contains **no design decisions**: every rule below is fully determined by
`.planning/specs/2026-09-11-library-marketplace-refactor.md` §3.1, which locks the repository layout.

## Scope — exactly 24 files, 141 sites

Edit **only** these files. Do not create, delete or edit any other file.

| file | sites |
| --- | --- |
| `src/__tests__/bin.test.ts` | 2 |
| `src/__tests__/frames-eval-cancel.test.ts` | 2 |
| `src/__tests__/m3-publish-walkthrough.test.ts` | 1 |
| `src/commands/__tests__/create.test.ts` | 1 |
| `src/commands/__tests__/eval-queue.test.ts` | 2 |
| `src/commands/__tests__/eval.test.ts` | 32 |
| `src/commands/__tests__/evalReport.test.ts` | 1 |
| `src/commands/__tests__/install.test.ts` | 16 |
| `src/commands/__tests__/invocation-hints.test.ts` | 1 |
| `src/commands/__tests__/join.test.ts` | 5 |
| `src/commands/__tests__/ls.test.ts` | 9 |
| `src/commands/__tests__/publish.test.ts` | 11 |
| `src/commands/__tests__/readme.test.ts` | 5 |
| `src/commands/__tests__/refresh.test.ts` | 2 |
| `src/commands/__tests__/search.test.ts` | 3 |
| `src/commands/__tests__/setup.test.ts` | 1 |
| `src/commands/__tests__/uninstall.test.ts` | 8 |
| `src/commands/__tests__/validate.test.ts` | 4 |
| `src/commands/__tests__/guard-push.test.ts` | 16 |
| `src/lib/__tests__/readme.test.ts` | 1 |
| `src/lib/__tests__/teamRepo.test.ts` | 14 |
| `src/lib/__tests__/fixtures.ts` | TEAM_JSON + 2 |
| `src/lib/__tests__/skills.test.ts` | 2 |
| `src/commands/__tests__/pending-eval-fixtures.ts` | 1 |

### Explicitly OUT of scope — do not touch these three, they are handled by hand

- `src/lib/__tests__/guard.test.ts` — its 68 sites ride on guard-row rewrites that are not mechanical.
- `src/lib/__tests__/version.test.ts` — the module it tests is being deleted.
- `src/lib/__tests__/versions.test.ts` — already written against layout 3.

**Do not edit any file outside `__tests__/` or `fixtures.ts`.** In particular: no file under `src/lib/`
or `src/commands/` that is not a test, and nothing under `desktop/`. If a change appears to require a
source edit, **stop and report it** rather than making it.

## Rule 1 — a skill folder in the TEAM CLONE gains a `v1/` segment

Under layout 3, published skill bytes live at `skills/<name>/v<N>/**`. Every fixture in scope seeds a
first version, so the segment is always `v1`.

```
skills/<name>/SKILL.md              ->  skills/<name>/v1/SKILL.md
skills/<name>/evals/cases/a.yaml    ->  skills/<name>/v1/evals/cases/a.yaml
skills/<name>/scripts/run.sh        ->  skills/<name>/v1/scripts/run.sh
```

The rule is: **insert `v1` immediately after the skill-name segment**, whatever follows. Eval assets go
inside `v1/` like everything else (spec D9) — there is no unversioned `skills/<name>/evals/` path.

It applies in both spellings used by these fixtures:

- string literals — `pushFromSeed(seed, 'skills/deploy-check/SKILL.md', …)` becomes
  `pushFromSeed(seed, 'skills/deploy-check/v1/SKILL.md', …)`
- `join()` chains — `join(clone, 'skills', name, 'SKILL.md')` becomes
  `join(clone, 'skills', name, 'v1', 'SKILL.md')`, and a `mkdir` of `join(clone, 'skills', name)`
  becomes `join(clone, 'skills', name, 'v1')` (keep `{ recursive: true }`)

### Rule 1 exclusions — these are NOT skill folders

- **`skills/.gitkeep`** and a bare `join(seed, 'skills')` — that is the store root, not a skill. Leave
  both exactly as they are (`src/lib/__tests__/fixtures.ts:87,89`).
- **Local skill roots stay flat.** Only the team clone is versioned. A path reaching
  `~/.claude/skills/<name>/` or `<project>/.claude/skills/<name>/` — anything built from a `home`,
  `cwd`, `root` or `.claude` segment — is a *local* skill folder and must **not** gain `v1`.
  Verified before writing this spec: no in-scope file addresses a local root through a bare
  `'skills/…'` literal, so a literal starting `skills/` is always the clone.

## Rule 2 — `TEAM_JSON` becomes layout 3

`src/lib/__tests__/fixtures.ts:72`. Today:

```ts
export const TEAM_JSON = { layout_version: 2, name: 'team', categories: [], global: [], projects: {}, archived: [] as string[], policy: { publish: 'pr', skill_license: 'UNLICENSED' } };
```

Becomes:

```ts
export const TEAM_JSON = { layout_version: 3, name: 'team', categories: [], projects: { Global: { remotes: [], skills: [] as string[] } }, archived: [] as string[], policy: { skill_license: 'UNLICENSED' } };
```

Three changes, all locked by §3.1 and §4.1: `layout_version` 2 → 3; the top-level `global` array is
**deleted**; `policy.publish` is **deleted** (`policy` keeps only `skill_license`); `projects` gains
the reserved `Global` project, which §3.1 requires to be present in every layout-3 repo.

If a test in scope reads `TEAM_JSON.global` or `TEAM_JSON.policy.publish`, that read is now invalid —
**report it, do not invent a replacement.**

## What "done" means here

- `npm run typecheck` at the repo root passes.
- The 24 files show the transformation and **nothing else**; `git diff --stat` touches no other path.

**The test suite WILL be red, and that is expected and correct.** This slice moves the fixtures ahead
of the source that reads them; the rest of B3 lands separately and makes them green together. Do **not**
edit source files to make tests pass, and do not revert a fixture because its test fails. Report the
failure counts if you run them; do not act on them.

## Why this slice exists

B3 as a whole is not a good Codex shape — it compiles only whole and its correctness lives in
behaviour this sandbox cannot execute (the root suite takes ~2 minutes against a 30-second command
window). This slice is the opposite: a counted target with an enumerated file list and a
character-level rule, which is the shape where every prior Codex run on this repo returned `complete`.
