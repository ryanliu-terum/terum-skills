# terum-skills — the bundled `/terum-skills` Claude Code skill (built spec)

Date: 2026-09-08. Built on `main` @ `b4dcbb9` (0.1.5). Ships in the next release.

**Decision (Ryan, 2026-09-08).** The `/terum-skills` Claude Code skill — the SKILL.md that tells Claude Code
which `terum-skills` verbs it may run inside a session and which to hand to a terminal — ships inside the
npm package and is placed by `terum-skills setup`. Chosen over connecting it through terum-skills itself
(option 1) and over asking teammates to clone this repository (option 3): the product ships npm-first and
`setup` is the one onboarding step (Ryan, 2026-09-08), so the skill that lets Claude Code drive the CLI has
to arrive from `setup` too. Trigger: a teammate installed the CLI with npm and had no `/terum-skills` in
Claude Code, because the skill lived only in this repository's `.claude/skills/`.

**Parent:** `.planning/specs/2026-09-05-m3-setup-hook.md` (the §8 hook offer this step mirrors),
`.planning/reviews/2026-09-07-cli-skill-wrappers-feasibility.md` (the skill's own design).

## 1. One canonical copy, bundled at build time

- The canonical file stays at `.claude/skills/terum-skills/SKILL.md`: it is what this repository's own
  Claude Code harness loads, so it cannot move.
- `npm run build` = `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs`. The script copies the
  file byte for byte to `dist/claude/skills/terum-skills/SKILL.md` and fails the build if the frontmatter
  lacks `name: terum-skills` or `metadata.managed-by: terum-skills`. It reports on **stderr**: it runs
  under `prepack`, and `release.yml` parses `npm pack --json` on stdout.
- Why not list the dot-directory in `files`: npm-packlist then also ships `.claude/skills/README.md`
  (verified with `npm pack --dry-run`, both for the directory and for the exact file path).
- `src/lib/wrapper.ts` resolves the bundle as `../claude/skills/terum-skills/SKILL.md` from its own
  location, so it exists from `dist/lib` and is absent from `src/lib`. Absent is a state
  (`unavailable`), never a crash: a source checkout or a vitest run says so in one line and asks nothing.
- `release.yml`'s tarball check requires `dist/claude/skills/terum-skills/SKILL.md` alongside
  `dist/index.js`.

## 2. The marker

The frontmatter carries `metadata:` → `managed-by: terum-skills`. It is the idempotency key, the way a
`SessionStart` command containing `terum-skills` is the hook's: a SKILL.md at the destination whose
frontmatter has `name: terum-skills` **and** that marker is ours; anything else at that path is foreign.
Claude Code ignores unknown frontmatter keys (shared skills already carry `metadata.id` and friends).

## 3. Placement contract (`src/lib/wrapper.ts`)

Destination: `AGENT_PATHS['claude-code'].global(home)/terum-skills` = `~/.claude/skills/terum-skills/`.
Judged with `lstat`, never following links (the repo's rule for symlinks everywhere).

| State | Meaning | `offerWrapper` does |
|---|---|---|
| `unavailable` | bundle missing or unmarked | prints `The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at <source>); skipped.` |
| `foreign` | a link, a file, a folder without a regular SKILL.md, or a SKILL.md without the marker | prints `<dir> exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.` |
| `current` | ours, bytes equal to the bundle | prints `The /terum-skills Claude Code skill at <dir> is current.` |
| `outdated` | ours, bytes differ | replaces **without asking**, prints `Updated the /terum-skills Claude Code skill at <dir>.` |
| `absent` | nothing there | asks once: `Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes <dir>)`; yes → `Installed …`, no → `Skipped the /terum-skills skill; re-run setup to install it later.` |

The refresh-without-asking reading is deliberate and differs from the hook (whose entry `setup` never
refreshes): consent was given at the first install, the file is provably ours, and a stale copy teaches
Claude Code the wrong verbs after an update. Writes are atomic (temp file beside the target, fsync,
rename). `removeWrapper` removes only the marked SKILL.md and then the folder if it is empty; a file the
user added keeps the folder and is theirs.

## 4. Where it runs

- **`setup`**, step `wrapper`, right after the hook offer and before the closing summary. `done` for
  `installed`/`replaced`, `skipped` otherwise. Same `io`, same rule as the hook: `setup` asks nothing
  itself; the offer function does. `SetupArgs.wrapper` / `SetupVerbs.offerWrapper` are the test knobs.
  The §6 `install` bootstrap forwards `wrapper` the way it forwards `hook`.
- **Machine `uninstall`** lists the copy in its inventory (`/terum-skills Claude Code skill at <dir>`,
  `No /terum-skills Claude Code skill at <dir>`, or the foreign notice), removes a managed copy after the
  hook and before the teams, and reports `wrapperRemoved`. A removal failure stops the run with nothing
  else removed, like a hook write failure.
- **Discovery and connect** never treat it as a team skill: `inspect()` in `src/lib/skill-source.ts`
  rejects a marked SKILL.md with reason `managed-wrapper` under any folder name, so `ls --local` lists it
  under "Cannot be connected" and `connect <path>` refuses it by name.
- WELCOME line 3 now ends "…offers the session hook and the /terum-skills Claude Code skill; re-run it any
  time to continue…" (supersedes the M3 spec's line 3).

## 5. Tests

`src/lib/__tests__/wrapper.test.ts` (states, atomic install, refresh, foreign/symlink/file refusals,
unavailable, the offer's five outcomes); `setup.test.ts` (end-to-end question order and placed bytes,
quiet mode keeps the prompt, the orchestrator suite, the unavailable notice); `m3-setup-walkthrough.test.ts`
(Alice and Bob each get one question, a resumed run finds its copy current); `install.test.ts` (bootstrap
forwards the knob); `uninstallMachine.test.ts` (removes ours, leaves a foreign folder, reports none);
`local-skills.test.ts` (`managed-wrapper`); `bin.test.ts` (the build script bundles byte for byte where
the built module resolves it, and the `build` pin); the invocation-literal catalog carries the new lines
(`prose` for comments, `not-a-hint` for messages that name the skill rather than a command).

## 6. Not built here (follow-ups)

- **Refresh on `sync`.** Today an outdated copy is refreshed only by re-running `setup`. Interactive
  `sync` is the natural place for the same silent refresh; the hourly `sync --hook` could do it too.
- **`team create` / `team join` direct path.** The hook is offered there when not inside `setup`; the
  skill is offered from `setup` only, because the invite block sends `setup <org>/<repo>`.
- **Per-verb aliases** (`.claude/commands/{ls,sync,install,…}.md`) are not shipped: generic names under a
  user's global `~/.claude/commands` would collide with their own commands. The wrapper skill alone gives
  Claude Code every verb.
- Whether `! <command>` in Claude Code's shell mode has a TTY is still unverified (feasibility §5).
