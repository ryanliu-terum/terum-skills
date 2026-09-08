# `terum-skills sync` end-of-run verdict — implementation spec

**Status:** LOCKED (rev 1, 2026-09-08). Design reconciled 2026-09-07 between a Fable investigation and a `gpt-6-astra` adversarial review; re-anchored to `origin/main` @ `893adc9` (post PRs #39/#40/#41/#42/#43/#44). Rulings by Ryan (2026-09-07): hook mode unchanged; nothing-to-do prints one line; `--json` deferred to backlog; wording is `Sync complete`; standing decision 2026-09-06 — a freshness stamp means a fully completed sync, so the verdict's "complete" MUST be the same predicate that writes the stamp. Lock-skipped teams read `Sync incomplete`, exit 0 (build spec §6 `sync`, line ~353: lock/rate-limit skips never count toward the exit-1 failure).

**Parent:** `.planning/specs/2026-09-02-phase-1-build.md` (rev 14). This spec extends §6 `sync` and §5.3; it contradicts nothing there. All line numbers below are for `origin/main` @ `893adc9`; re-find by content if they drift — the content quoted is authoritative.

## 0. Problem

`src/commands/sync.ts:278` prints `Skills synchronized.` only when `changed` is true and otherwise ends in silence. A run that deferred work printed the remedy line earlier and then also ended in silence, so "done" and "quietly stopped" look identical. Every interactive `sync` must end with one verdict line whose "complete" is exactly the stamp predicate.

## 1. Result shape (`sync.ts:32`)

Keep `SyncResult { placed, deferred, notices, changed, hook }` with their **exact current semantics** (`placed` still keys the hook reload directive at :279; `deferred.length` is still the hook review count at `src/lib/execute.ts:47`). Add:

```ts
export interface PlacementCounts { placed: number; updated: number; renamed: number; removed: number; unchanged: number; adopted: number; declined: number; }
export interface SharedCounts { pushed: number; pulled: number; renamed: number; repaired: number; }
export type TeamOutcome =
  | { team: string; state: 'complete'; counts: PlacementCounts; shared: SharedCounts }
  | { team: string; state: 'incomplete'; counts: PlacementCounts; shared: SharedCounts; review: string[]; blocked: string[]; pendingLeft: number }
  | { team: string; state: 'skipped'; reason: 'unreachable' | 'locked' | 'busy' | 'error' | 'fresh'; detail: string }
  | { team: string; state: 'gone' };
export interface SyncResult { placed: number; deferred: string[]; notices: string[]; changed: boolean; hook: boolean; teams: TeamOutcome[]; }
```

Every returned `Result<SyncResult>` — success AND failure (`:293`, `:295`, prune) — carries `teams` (possibly `[]`). Failure results that today pass `undefined` as the value in interactive mode keep doing so; where a value is passed it includes `teams`.

### 1.1 `PlacementCounts` — counted per LEDGER PATH, one terminal category per path

Keep a `Map<string /*path*/, keyof PlacementCounts>` per team; a path is assigned once and later assignments for the same path are ignored, except that `unchanged` never overrides an existing entry and is itself set only when the path has no entry yet. Sources:

- Pending replay `:131-151`: `installOne` (`:143`) returns `{ path }` (`install.ts:139`); category `placed` if that path was absent from the ledger read at `:89` (`config.placements`), else `updated`. `uninstallOne` (`:136`) returns `{ removed: number }` (`uninstall.ts:16,88`); add it to `removed` (not path-keyed; a plain counter per team).
- Placement loop `:158-247`: the `continue` at `:209` and at `:227` → `unchanged` for that path (only if no entry yet — this fixes the double count where a path re-placed by the pending replay at `:143` would otherwise also read as unchanged at `:209`). After `place` at `:228`: `renamed` when `renamed` (`:229`) is true, else `updated`. A drift quarantine at `:226` alone does not change the category (the subsequent place decides).
- Endorsed batch `:268`: `installOne`'s returned path → `placed` (absent from the `:89` ledger) else `updated`.
- Orphans (`reconcileOrphans` `:302-343`): adopt `:330` → `adopted`; decline `:340` → `declined`. Pass a per-team recorder into `reconcileOrphans` (extend its parameter list; the `defer`/`notice` callbacks already flow in).

`placed` (the existing scalar) keeps its current increments unchanged — it is a separate legacy counter keyed to the reload directive; do not derive it from the map.

### 1.2 `SharedCounts` — from `reconcileShared`'s new return value

Change `src/commands/connect.ts:231` `reconcileShared(store, runner, io, skipTeams = new Set(), defer = () => undefined, form?)` to **return** `Promise<ReconcileOutcome[]>`:

```ts
export interface ReconcileOutcome { id: string; team: string; name: string; kind: 'pushed' | 'pulled' | 'renamed' | 'repaired' | 'unchanged' | 'deferred'; }
```

Keep `defer` as the fifth parameter and `form` sixth; add NO further callback. Row → kind:

- push branch `:295-310` → `pushed`; when `targetName !== record.name` (`:309`) emit an additional `renamed` outcome for the same id (so `pushed` and `renamed` both count).
- fast-forward branch `:311-319` → `pulled`.
- no-change row `:291-294` → `repaired` if `refreshRepo` wrote (`repairedRepo !== repoContents`, `:287`) or the source was rewritten at `:268` (`repaired !== sourceContents`); else `unchanged`.
- every `defer(...)`+`continue` exit (`:237`, `:240`, `:241`, `:255`, `:267`, `:270`, `:271`, `:278`) and the catch at `:320-323` → `deferred` (name = `record?.name ?? id.slice(0, 8)`).
- `skipTeams` skip `:234` → no outcome.

`sync.ts:154` folds the outcomes per team into `SharedCounts` and sets `changed = true` for `pushed | pulled | renamed`. Managed-field repairs are NOT changes (build spec §5.3 :228 — "a repair, not a change") and appear only as `; N managed-field repair(s)` in the nothing-to-do line. Orphan adopt/decline ARE changes (they commit to the people file): set `changed = true` for both — today `:330`/`:340` do not set it; that is a latent bug this spec fixes.

Existing callers of `reconcileShared` in `connect.test.ts` ignore the return value; they compile unchanged.

### 1.3 Skipped teams

Replace `const skipped = new Set<string>()` (`:99`) with `const skipped = new Map<string, { reason: TeamOutcome['reason']; detail: string }>()` (keep `unreachable: string[]` at `:100` for the exit-1 string at `:293`). Reasons: `'fresh'` at `:106` (hook only, detail `''`), `'locked'` at `:107-111` (detail = the lock path), `'error'` at `:114` (detail = message), `'unreachable'` at `:119-122` (detail = `error.origin`), `'busy'` at `:126` (detail = `error.message`). Every `skipped.has(...)` stays a `Map#has`; `reconcileShared`/`reconcileOrphans` take `ReadonlySet<string>` today — pass `new Set(skipped.keys())` or widen their parameter to `{ has(team: string): boolean }`; either is acceptable, pick one and apply consistently.

### 1.4 Per-team labels

`defer(team, ...labels)` (`:63`) also appends labels to a per-team `review: Map<string, string[]>`; `blocked(team, label, line)` (`:73`) also appends to a per-team `blocked: Map<string, string[]>` (and still calls `defer`, so the team is incomplete and `deferred` still grows exactly as today). `defer(team)` with no label (`:258`) marks the team incomplete with no review label — the verdict then reads "has unfinished work (endorsed batch skipped)".

### 1.5 One predicate — computed IN the stamp loop (`:287-292`)

```
for team of Object.keys(config.teams):
  if skipped.has(team)           → teams.push({ state:'skipped', reason, detail }); continue
  if !Object.hasOwn(final.teams, team) → { state:'gone' }; continue
  pendingLeft = final.pending.filter(e => e.team === team).length
  if incomplete.has(team) || pendingLeft > 0 → { state:'incomplete', counts, shared, review, blocked, pendingLeft }; continue
  await writeStamp(store, team); teams.push({ state:'complete', counts, shared })
```

`complete` is pushed only on the same iteration that calls `writeStamp`. No other code path may produce `state: 'complete'`.

## 2. Output

### 2.1 `verdict(line)`

A local `const verdict = (line: string) => { if (!args.hook && !args.prune) (io as { print(line: string): void }).print(line); }`. It NEVER pushes to `notices`. Emitted AFTER the stamp loop (between today's `:292` and `:293`). Delete `if (changed && !args.hook) … print('Skills synchronized.')` at `:278`. The reload directive at `:279` stays keyed on `placed`, unchanged. Zero-count fields are omitted from every counts phrase; the counts phrase is built in this fixed order: `placed, updated, renamed, removed, adopted, declined, pushed, pulled, repaired (as "managed-field repair(s)" ONLY in the nothing-to-do line), unchanged`. Singular/plural: `1 placed`, `2 updated`, `1 shared edit pushed` / `2 shared edits pushed`, `1 shared edit pulled`, `1 removed`, `1 adopted`, `1 declined`, `5 unchanged`. `renamed` renders as `1 renamed`.

### 2.2 Texts (exact)

One team, complete, something changed:
`Sync complete: Terum — 1 placed, 2 updated, 1 removed, 1 shared edit pushed, 5 unchanged.`

One team, complete, nothing changed (`changed === false`):
`Sync complete: nothing to do (Terum up to date, 8 skills).` — `8 skills` = the number of ledger paths for that team walked this run (the size of the per-team path map; `1 skill` singular). Append `; 1 managed-field repair` (or `; N managed-field repairs`) when `shared.repaired > 0`, inside the parentheses: `Sync complete: nothing to do (Terum up to date, 8 skills; 1 managed-field repair).`

Two or more teams (any mix of complete/incomplete/skipped): one line per team in `Object.keys(config.teams)` order, then the summary line:
```
Terum: 1 placed, 2 updated, 1 shared edit pushed, 5 unchanged
acme: up to date (3 skills)
Sync complete.
```
Per-team line for an incomplete team: `acme: 1 updated; 2 skills need review (sample, other)`. Per-team line for a lock-skipped team: `acme: skipped (another sync holds its lock)`. Summary line is `Sync complete.` when every non-skipped team is complete and no team is lock/busy/error-skipped; otherwise `Sync incomplete: <clauses>.` as below.

Incomplete (single team, or the summary line with ≥2 teams), clauses joined with `; `, in this order, each present only when non-empty:
- `N skills need review (a, b)` — count is `deferred.length` for that team's labels (verbatim cue `skills need review`, matching `execute.ts:47`), names = the review labels deduplicated in first-seen order; for the single-team form append ` — see the lines above for each remedy`.
- `N placement(s) blocked (a, b)` → `1 placement blocked (sample)` / `2 placements blocked (a, b)`; single-team form appends ` — see the lines above`.
- `<team> has unfinished work (endorsed batch skipped)` — for `defer(team)` with no label.
- `<team> still has N pending install(s); run sync again` — when `pendingLeft > 0`.
- `<team> skipped (another sync holds its lock) — retry when it finishes` (reason `locked`); `<team> skipped (<detail>)` for `busy`/`error`.
Single-team examples:
`Sync incomplete: 2 skills need review (sample, other) — see the lines above for each remedy.`
`Sync incomplete: 1 placement blocked (sample) — see the lines above.`
`Sync incomplete: acme has unfinished work (endorsed batch skipped) — see the lines above.`
`Sync incomplete: Terum still has 1 pending install; run sync again.`
`Sync incomplete: acme skipped (another sync holds its lock) — retry when it finishes.`
Counts for an incomplete single team precede the clauses: `Sync incomplete: Terum — 1 updated; 2 skills need review (sample, other) — see the lines above for each remedy.` (the ` — see …` tail appears once, at the end).

Unreachable (`unreachable.length > 0`, `:293`): print the healthy per-team lines (≥2 teams) or nothing (1 team), print NO success verdict, then return today's UNCHANGED failure string `Sync finished with <n> team(s) skipped: <names>. See the notices above.` (exit 1; `execute` prints it on stderr as today).

Any other failure (`:295`): `Sync failed: <message>` — prepend `Sync failed: ` only when `!args.hook`; hook mode returns the bare message exactly as today. The failure value, when passed, is `{ placed, deferred, notices, changed, hook, teams }`.

Prune (`prune()` `:360-369`, and `:84-88`): `Quarantine is empty.` (unchanged text; `changed: false`); on declined confirm print `Prune cancelled; nothing deleted.` (`changed: false`); on success print `Deleted N quarantined item(s).` → `Deleted 1 quarantined item.` / `Deleted 2 quarantined items.` (`changed: true`); partial: wrap each `rm` in try/catch, continue, then return `failure('Deleted N of M quarantined item(s); could not delete <path>: <message>')` with `changed: N > 0` (first failing path/message). Drop `:87`'s unconditional `changed: true`; `prune` returns `{ deleted: number; declined: boolean }` (or equivalent) so `:87` can set `changed` truthfully.

### 2.3 Ordering with the release notice

The verdict is the verb's last stdout line. The bin's stderr release tail (`src/index.ts` / `src/lib/update.ts`, exercised by `src/lib/__tests__/execute.test.ts:48-56`) stays after it — that test owns the order and must not change.

## 3. Spec and docs edits (in this PR)

- `.planning/specs/2026-09-02-phase-1-build.md:371`: replace the sentence `Prints one line when anything changed; silent otherwise.` with: `Every interactive run ends with one verdict line, the verb's last stdout line: \`Sync complete: …\` only for teams this run stamped (the stamp predicate and the verdict are one predicate); \`Sync incomplete: …\` naming the reason class (skills needing review, blocked placements, an unfinished endorsed batch, pending installs, a lock-skipped team) with per-team lines when more than one team is configured; an unreachable team keeps the exit-1 \`Sync finished with …\` string and no success verdict; any other failure is \`Sync failed: <message>\`; \`--hook\` output is unchanged; \`--prune\` ends with \`Quarantine is empty.\`, \`Prune cancelled; nothing deleted.\`, or \`Deleted N quarantined item(s).\`. Bump the status line to rev 15 with a one-clause note.`
- Same file, §5.3 after line 230 (the "Which copy is written" bullet): add the bullet `- **Sync counts the two writing rows as changes** (\`N shared edit(s) pushed\` / \`pulled\`) and they flip its changed state; a managed-field repair on the same/same row is reported separately as a repair and is not a change.`
- `src/cli.ts:128`: give `--hook` and `--prune` descriptions: `.option('--hook', 'session-start mode: stdout is the reload directive or empty; notices and the review count go to stderr')` and `.option('--prune', 'delete quarantined items under ~/.terum/skills/quarantine after listing them and asking')`.
- `.claude/skills/terum-skills/SKILL.md:51` (the `sync` row, third column): replace with `show stdout verbatim; the last line is the verdict. \`Sync complete: …\` means every team was stamped; \`Sync incomplete: …\` names why — a \`N skills need review\` cue means the user must run \`npx -y terum-skills@latest sync\` in a terminal to answer consent questions, a divergence line needs \`connect --keep-source <id>\` or \`connect --keep-repo <id>\`, a privileged-content line needs \`connect --keep-source <id> --allow-privileged\`. Never report success unless the verdict says complete. Long on a cold clone: use \`run_in_background\``. Line 63: replace `for \`sync\` it also carries notices and the review count` with `for \`sync --hook\` it also carries notices and the review count (interactive \`sync\` prints those on stdout, ending with the verdict)`.

## 4. Tests — red before fix

Write each test first against the unmodified tree and confirm it fails, then implement. In `src/commands/__tests__/sync.test.ts` unless noted:

1. `reconcileShared` return kinds (`connect.test.ts`, reusing `sharedFixture`): local edit → `[{kind:'pushed'}]`; remote push → `pulled`; local rename → `pushed` + `renamed`; stale author only → `repaired`; diverged → `deferred`; up to date → `unchanged`.
2. Push-only shared edit → `io.lines.at(-1)` matches `/^Sync complete: team — 1 shared edit pushed\.$/`, `changed` true, `teams[0].state === 'complete'`, stamp file exists.
3. Up-to-date single team → `io.lines` equals `['Sync complete: nothing to do (team up to date, 1 skill).']` (replaces `:584` `toEqual([])`).
4. Re-placed after upstream change → `io.lines.at(-1) === 'Sync complete: team — 1 updated.'` (replaces `:572` `toContain('Skills synchronized.')`).
5. Pending install replay of a new path → `counts.placed === 1`, `counts.unchanged === 0` (no double count); already-placed pending → `updated: 1`.
6. Uninstall replay with 0 and 2 matching placements → `removed` 0 / 2.
7. Two healthy teams → two per-team lines then `Sync complete.`.
8. Mixed: one complete team, one with a deferred consent → the summary line is `Sync incomplete: 1 skills need review (sample).` — the cue is always the verbatim `N skills need review`, even for N = 1, to match `execute.ts:47`. Assert that, and that only the complete team's stamp file exists.
9. Label-free batch failure (`:258` path, force `endorsedCandidates` to throw via a corrupt team.json) → `Sync incomplete: team has unfinished work (endorsed batch skipped) — see the lines above.`, no stamp.
10. Pending entry recorded after the team's replay (extend the fixture at `:843`) → verdict contains `still has 1 pending install; run sync again`, no stamp.
11. Stamp-write failure (make the stamp directory unwritable) → `Sync failed:` prefix on the returned error, `execute` prints it to stderr with code 1, and the failure value (if any) retains `teams`.
12. Non-TTY consent deferral (`:495-503` fixture) → `io.lines.join('\n')` lacks `hookSpecificOutput` and contains `1 skills need review`; TTY decline → same cue.
13. Divergence → `Sync incomplete` last, with the `--keep-source`/`--keep-repo` line before it.
14. Unreachable + healthy (`:104-150` fixture) → the healthy team's per-team line is printed, NO `Sync complete` anywhere, result is the unchanged failure string.
15. `execute`-level (`execute.test.ts`): a sync returning the unreachable failure with a real `afterVerb` sink → stderr order `[…notices, 'Sync finished with …', 'notice']`, exit codes `[1]`.
16. Prune: fixture at `:692-708` creates TWO quarantine entries → `io.lines.at(-1) === 'Deleted 2 quarantined items.'`, `changed: true`; declined → `Prune cancelled; nothing deleted.`, `changed: false`; empty → `Quarantine is empty.`, `changed: false`; partial (make one entry undeletable) → `ok: false`, error starts `Deleted 1 of 2 quarantined item`, exit path 1.
17. Hook mode: push-only and push+placement → `io.lines` is `[]` / exactly the directive; `notices` contains no line starting `Sync `.
18. Orphan adopt and decline → `changed: true`, counts `adopted: 1` / `declined: 1`.

Preserve unchanged: `sync.test.ts:35-62, 103, 142-147, 170, 409, 419, 511, 523, 539, 796-796`; `execute.test.ts:31-43, 48-59`; `m2-walkthrough.test.ts:36-53`; every `connect.test.ts` `reconcileShared` call site (return ignored). Only `:572` and `:584` change semantics; `:501` (`not.toContain('reloadSkills')`) is strengthened per test 12.

## 5. Gates

`npm run lint && npm run typecheck && npm test` from the worktree root; all green; report real counts. Do not weaken or delete any existing assertion except the two named above.
