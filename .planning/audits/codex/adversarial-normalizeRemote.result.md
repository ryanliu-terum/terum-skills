# Adversarial run: normalizeRemote — 2026-09-04

First run of `scripts/codex-adversarial-tests.sh` in this repo (smoke test of the port).

- Generator: gpt-5.6-sol, effort high, rooted in a scratch dir holding only
  `adversarial-normalizeRemote.contract.md` (written from the doc comments in `src/lib/remote.ts`,
  no function bodies). Raw output: `adversarial-normalizeRemote.json` — 13 cases, 7 contract gaps.
- Cases were run against `src/lib/remote.ts` in the `m1-plumbing` worktree (then on the carve-out
  working tree; re-checked on branch `phase1-land`, same code). Transient test file, removed after.

## Result: 12 passed, 1 failed

**`repeated_git_suffix_removal_is_idempotent`** — the doc comment on `normalizeRemote` promises
"Idempotent: normalizing a normalized remote is a no-op, for every accepted form." A doubled
suffix breaks it, because `stripGitSuffix` does one `.replace(/\.git$/i, '')` and never re-checks:

    normalizeRemote('https://example.com/org/repo.git.GIT')  →  'example.com/org/repo.git'
    normalizeRemote('example.com/org/repo.git')              →  'example.com/org/repo'

Severity: low. GitHub refuses repository names ending in `.git`, so the practical reach is generic
hosts and local paths. It is still a documented invariant the existing idempotence test cannot
reach — every fixture there carries a single suffix.

Options: strip in a loop (one line, invariant holds as written) or narrow the doc comment to
single-suffix inputs. Not applied; the worktree carried another session's uncommitted changes at
the time. Fold the 12 passing cases into `src/lib/__tests__/remote.test.ts` when the fix lands.

## Contract gaps worth a spec sentence

Host grammar (IPv6, trailing dot, IDNA), port validity, internal `//` and `.` segments, `?`/`#`
handling, multiple `@` in scp form, Unicode whitespace in trimming, and redaction boundaries for
`user:a:b@host`. See the JSON for the full list.
