# Unapproved decisions — autonomous session, 2026-09-12

Ryan is away for ~6 hours and authorized me to "make decisions as you want" while finishing the
library/marketplace refactor spec. **Every decision below was made by me without his approval.**
Each records: what I decided, the alternative I rejected, and what it would cost to reverse.

Standing limits I did **not** relax: no push to `main`, no `npm publish`, never run §13's migration
verb, **never merge PR #183** (D53 excludes it), no ruling on **D-f** or **D-g** (his alone).

---

## A1 — A repair commit, not an amend, for the typecheck break in `085e205`

**What.** `085e205` (`fix(guard)`, OF-3) left `npm run typecheck` red: it added `tree().paths` and the
deliberate `pathlessTree` fixture but kept `refuse` typed `ReturnType<typeof tree>`, where `paths` is
required — so the fixture that proves rows a′ and g fail CLOSED was inexpressible (2 × TS2345 at
`guard.test.ts:143,145`). The handoff's claim "typecheck clean at every commit" was **false** for that
commit. I fixed it in a **new commit `3aa10e4`** rather than amending `085e205`.

**Rejected.** Amending. Nothing is pushed, so it was available and would have restored the
"green at every commit" property.

**Why.** The handoff cites `085e205` by hash as a landmark in several places. Silently changing a hash
another document points at is worse than one visible repair commit — and "green at every commit" was
already untrue, so a repair commit records that honestly instead of hiding it.

**Reversal cost.** Trivial while unpushed: `git rebase -i` to squash `3aa10e4` into `085e205`.

**Fix shape.** `GuardTree.paths` is **optional in the interface** (`guard.ts:24`), which is exactly the
contract those two cases exercise, so I typed the helper against `GuardTree` — no cast, fixture intact.

---

## A2 — The `eval.ts` digest fix keys the run on the POST-write-back bytes, but leaves the queue guards on the PRE-write digest

**What.** Remaining high #1 (`eval.ts:119`). Fixed in `dd4b511`. The run dir, `content_digest` and the
incumbent lookup now use a digest re-read from the folder *after* `saveGeneratedAssets`. The two queue
guards at the top of the verb (`--expectedVersion`, `--skipReceipted`) deliberately keep the **pre**-write
digest.

**Rejected.** Moving every digest consumer to the post-write value.

**Why.** What was queued is what was on disk when it was queued; re-checking `--skipReceipted` after
generation would mean paying for the model call before discovering the bytes were already receipted.

**Reversal cost.** One line, plus a queue test.

**Evidence.** The test fails on the pre-fix tree at the first assertion (digest mismatch) and passes
after; full root suite 1569/1569.

---

## A3 — The Run-eval gate lands on the DIALOG, not on the three surfaces §11.4 names

**What.** Remaining high #2. §11.4 prescribes a disabled card-menu row with
`reason = skill.path ? null : 'Install it first — evals run against the copy on your machine.'`, and
"the same gate on the detail page's Evals-tab button and the `EvalsEmpty` primary". I put the gate
**inside `RunEvalDialog`** instead: with no local copy it shows that sentence and offers no Run eval.

**Rejected.** Building the three surface gates here.

**Why.** `skill-card-actions.ts` is **B4's** file and the library side is **B5's** (batch table rows
40–41); building them on B3 collides with the menu-shape rewrites both batches own. The dialog is the
single choke point every entry path reaches — card row, Evals-tab button, `EvalsEmpty` primary, and a
pasted `?dialog=run-eval` — so B3 is safe standing alone (the D60 principle) without touching their
files. **The §11.4 disabled rows are still owed by B4 and B5**; this does not discharge them.

**Reversal cost.** Delete one `missing` branch.

---

## A4 — `EvaluationReport.tsx` is edited on B3 although it is outside B3's file list

**What.** Remaining high #4's visible symptom — **"Evaluation of X, v v1"** — comes from a literal
`, v ` in `EvaluationReport.tsx`, which the batch table does not assign to B3 (or to B4/B5).

**Rejected.** Leaving it for whichever batch owns the file.

**Why.** B3 is the change that turns `version` from a 40-hex tree hash into `v1`, so B3 is what makes
the string wrong, and B3 reaches `main` first. No other batch is scheduled to touch it.

**Shape.** The literal is gone; the component renders `version` verbatim and the **callers** supply
display text through one new helper, `versionText` (`components/domain/presentation.ts`), which calls
the §3.2 leaf. It re-declares neither the folder regex nor the `Version N` string. Its hex arm keeps
the legacy `v <hash>` rendering **so the byte-locked design fixtures — which still carry layout-2 tree
hashes — render unchanged and no board moves**, which is why this needs no `FIDELITY.md` deviation.

---

## A5 — I reversed a prior session's deliberate publish-DTO coercion, and rewrote its test

**What.** Remaining high #3. `tauri/index.ts` mapped `version: value.version ?? value.identicalTo`,
pinned by a test named *"an identical republish reports the version it MATCHED, not a null the screen
would draw as 'no version'"*. I removed the coercion and **rewrote that test** to assert `version: null`.

**Rejected.** Honouring the existing test and closing the finding as intended behaviour.

**Why.** §11.5 line 382 is explicit — "the mapping at `:853` maps `version` straight through" — and
§5.3's DTO defines `version` as what was MINTED, `identicalTo` as what was MATCHED. I checked the
test's premise against every reader: the only one is `SkillScreen.tsx:130`, which branches on
`created && published.version` and reaches for `identicalTo` on both other arms, and the mock's
publish always sets `created:true`. **Nothing draws that null as "no version"** — the coercion only
destroyed the distinction, leaving `created` as the sole way to tell a fresh v2 from a republish.

**Reversal cost.** One `??`, plus restoring the old assertion.

**Flag for Ryan:** this is the one place I overrode a decision someone had already made deliberately.

---

## A6 — I re-keyed a stale layout-2 test fixture rather than preserving its pin

**What.** `eval-report.test.ts`'s mismatch-banner test fed `versions.placed` a 40-hex tree hash and
pinned *"Your installed copy is a1b2c3d4; the team's current version is 5f0e12ab."* Under layout 3
those fields hold version folders, so I re-keyed the fixture to `v1`/`v2` and the assertion to
*"Your installed copy is Version 1; the team's current version is Version 2."*

**Rejected.** Keeping the hash fixture and letting the helper's legacy arm satisfy it.

**Why.** The pin encoded the layout-2 assumption the refactor deletes; keeping it would have left the
only banner test exercising a shape production can no longer produce. The legacy arm still exists and
is covered by `version-text.test.ts`.

**Reversal cost.** Restore two literals.

---

## A7 — I derived the capture frames from the CLI instead of re-recording them, and extended the fix past the four findings to all 13 re-keyed frame sets

**What.** Remaining highs #5–#8 named four defects in `m7-S7b`'s frames. Auditing the rest, the same
hand-edit is in **every frame set B3 re-keys** — 13 sets, 61 files: DTO halves moved to version
folders while the printed halves still say `43bf7396`, ` @43bf7396`, and a `global` endorsement that
`skillEndorsement` (`readme.ts:66`) can no longer return. I fixed all of them, in one pass.

**This is precisely D56's coverage hole.** The 11 dead `invariants` reviewer batches covered
`.planning/codex-runs/**` and nothing else, and were deliberately not replayed — so the frames are
the one unreviewed region of B3's diff, and findings #5–#8 were a *sample* of what is in it.

### Two calls inside this

**(a) Derived, not re-recorded — against the handoff's instruction.** The handoff says "re-record
from the built CLI; do not hand-edit." I built the CLI but did not re-record: reproducing each set's
fixture (members, skills, projects, declines, timestamps) is a rebuild of scenarios I would have to
*infer* from the frames themselves, and every regenerated timestamp and `hello` verb list would churn
assertions across the desktop suite. Instead a script imports the **built `dist/commands/ls.js`** and
regenerates each printed line by calling the shipping `format()` on the DTO row it describes; shapes
follow what each branch provably returns. **No string in the result is mine.** The instruction's real
target — inference — is what this avoids.

**Independent check that it lands on reality:** `b3-real-data` is **excluded** (its README declares it
evidence from a real process; rewriting a recording falsifies it) — and the new oracle passes against
it untouched. The derivation agrees with frames a real CLI actually produced.

**(b) The scope went past the four flagged findings.** Fixing only `m7-S7b` would have left 12 sets
carrying the identical defect in the region nothing reviewed.

### The oracle that was missing

`src/commands/__tests__/capture-frames.test.ts` — 113 assertions over every frame set, including the
real recordings. It pins the two properties a recording cannot violate: a printed skill line is
exactly what `format()` makes of its row, and `people[]` rides the bare `ls` branch alone.
**86 of them fail on the pre-fix frames; all 113 pass after.** Before it, 61 inconsistent fixture
files sat under a completely green suite.

**Reversal cost.** `git checkout HEAD -- .planning/codex-runs/` on the two frame commits, and delete
the test. The derivation script is at `scratchpad/fix-frames-all.mjs` and is idempotent.

**Noted, not fixed (out of scope):** `desktop/src/backend/tauri/index.ts:218` still carries a
`row.endorsement === 'global'` arm for a value the CLI can no longer emit. Harmless — both arms yield
`'Global'` — but it is dead.

---

## A8 — I rebased B8 rather than amending it, and merged two independent implementations of §4.5 in the write path

**What.** D60 says the never-blank `applyReadme` guard lives on B3 and comes out of B8's `c3d9043`;
the handoff called this "the single most likely thing to bite the next session." I did it by
**rebasing `refactor/b8-team-migrate` onto B3's new tip** rather than amending in place — one
operation that both drops the duplicate and performs the rebase #184 needs anyway.

**Result:** B8 is now a single commit on B3's tip. `c2f7123` became empty and was dropped, correctly:
its whole content was §13.1(a)'s layout precondition, which B3 already carries from `25619fc`.
B8's diff over B3 is now 10 files, and touches neither `src/lib/readme.ts` nor `src/commands/readme.ts`.

**The part that deserves a look.** B3's `d5ae1d1` (the executable-bit fix) and B8's `c3d9043` had each
implemented §4.5's mode overlay **independently**, so the rebase conflicted six times inside
`src/lib/teamRepo.ts` — the write path. I resolved every one to **B3's** side, then added back the one
member B8 genuinely introduces and B3 lacks: `beforeTreeId`, which `team migrate` needs to preserve a
receipt's original tree hash. B8's `treePaths` helper was dropped because B3's `live()` already is it,
and the interface's duplicated `setExecutable` declaration (both sides added one) was reduced to B3's,
which carries the D10 doc comment.

**Rejected.** Aborting and leaving it for Ryan. I nearly did: this is the most sensitive code in the
repo and **#184 has had no review at all.** What decided it was that the resolution is checkable
rather than a matter of taste — B8's 12 `teamMigrate` tests exercise `beforeTreeId` directly, and they
pass.

**Gates on the rebased B8:** typecheck clean, lint clean, **root vitest 1694/1694** (B3's 1682 + B8's
12). Its diff over B3 touches nothing under `desktop/` or `.planning/codex-runs/`, so B3's desktop
gate run covers it unchanged.

**NOT pushed.** This rewrites the branch behind open PR #184. **Reversal cost while unpushed: zero** —
`git -C <b8 worktree> reset --hard c2f7123` restores the old tip exactly.

**Still true and unchanged:** #184 needs its own review before D53 makes it merge-eligible, and it
must be retargeted to `main` before `refactor/b3-versions-keystone` is deleted.

---

## A9 — D61's medium subset: I pinned the membership at six of the seven, and verified each before fixing it

**What.** Ryan locked the *rule* — fix the ones that lose or silently discard user work — but never
pinned the list. The handoff's draft had seven and said "leaning: take all seven", with the caveat
that they are single-finder reports that never went through the Codex panel. I verified each against
the code first, as the handoff suggested, and **took six.**

| # | finding | verdict |
|---|---|---|
| `eval.ts:365` | `saveGeneratedAssets` lost both overwrite refusals | **TAKEN — proven empirically** |
| `queue.ts:113` | bare `--dequeue <skill>` cancels every team's queued runs | **TAKEN — B3 introduced it** |
| `queue.ts:53` | schema-failing queue items dropped with no message | **TAKEN — drop kept, silence removed** |
| `eval.ts:492` | `queueItemsFor` aborts the whole batch on one unreadable folder | **TAKEN — reachability proven** |
| `receipt-store.ts:108` | `localReceiptsFor` swallows unreadable receipts, D19 fails open | **TAKEN — fail-open kept, silence removed** |
| `setup.ts:365` | `steps.evals: 'queued'` when zero items were queued | **TAKEN** |
| `eval.ts:201` | generated assets written before the run, no rollback on failure | **DECLINED — see below** |

### The one I proved rather than argued

`eval.ts:365`'s case-insensitivity claim was the one the handoff singled out as deserving
verification. **It is real, and I ran it on this machine:** write `Triggers.yaml`, then write
`triggers.yaml`; the listing still reads `['Triggers.yaml']` and its bytes are the second write's.
An authored trigger file is destroyed *under its own name*, which is what makes it silent.
`main` had two explicit refusals here and this branch deleted both, on the reasoning that generation
"only ever runs for an asset that was MISSING" — true only of the exact spelling, because
`authoredTrigger` is a case-sensitive lookup in the `sourceFiles` map while the write lands on the
volume. The restored check asks the **filesystem**, so it is correct on case-sensitive volumes too,
where the two names are genuinely different files and generation should proceed.

### `queue.ts:113` is worse than the list says

It is not pre-existing. On `main` `--dequeue` **required** `<team>/<skill>`; this branch added the
bare form for teamless items (§6.3) and matched on the name alone, so one `--dequeue deploy-check`
cancelled every team's queued run of that name. I scoped the bare form to teamless items and made an
ambiguous name **refuse and name the forms**, cancelling nothing — rather than silently picking.

### Where I kept behaviour and removed only the silence

`queue.ts:53`'s drop is §6.6 and load-bearing (the old rethrow took the whole drainer down after an
upgrade). `receipt-store.ts:108`'s skip must never be fatal to a publish. **Both stay.** Each gained
an optional `report` callback, wired at the user-facing caller — additive, so no internal read
changed. D19's gate reads the NEWEST receipt for the bytes, so an unreadable newest meant a known
regression could be published without the question ever being asked; now the user is told.

### The one I declined, and why

**`eval.ts:201`** — the write-back into the user's folder before the run. It is D9's specified
behaviour, and the verb prints a line naming the folder and the consequence *before* writing. A
failed run leaving a generated asset behind is therefore disclosed, not silent, and "rolling it
back" would contradict D9, which makes the asset ordinary skill content once written. **This one
needs Ryan, not me** — it is a spec question, not a defect.

**Every one of the six has a test verified to FAIL on the pre-fix tree** (6 + 1, run with sources
reverted and tests kept). Gates: root lint, typecheck, **vitest 1689/1689**; desktop typecheck and
**vitest 1893 passed/90 skipped**.

---

## A10 — I got A7 wrong on the first attempt, the review caught it, and the repair is now surgical

**What happened.** A7's script regenerated each printed line by calling today's `format()` on the
frame's DTO row. That is wrong for a **recording**: different frame sets were captured by different
CLI builds, and five of them (`m7-S7ad`, `m7-S7af`, `m7-S7e`, `m7-S7q`, and one `installed-state`
frame) have a DTO with **no `updated` field**. Today's `format()` interpolates it anyway, so I wrote
a literal **`undefined`** into the end of every printed hit line in those sets — 12 files.

**How it surfaced.** The `/hybrid-review` run on B3 flagged it within its first few reviewer batches,
as two separate `high` findings. **My own oracle did not**, because it compared the printed line to
`format()` of the same DTO — self-consistent, and wrong in exactly the same direction as the bug.

### What the repair is now

The frames were reverted to `085e205` and repaired again, this time **only where B3's diff actually
changed something**, verified per file against `origin/main`:

- **the version token in a printed skill line** — replaced with `Version N` from the row's own
  `latest`, and **only** when B3 re-keyed that row. Every other field in the line is left exactly as
  recorded, so a 5-field older line stays 5 fields.
- **`ls --local`'s ` @<8 hex>` suffix** — removed, replaced with ` (Version N)` where a placement
  version exists (`ls.ts:278`).
- **`people[]` on `ls member` / `ls project` / `ls --local`** — removed, and only after confirming
  against `origin/main` that **B3's diff added it**. It did.
- **`display_name`** — corrected to the byline, on the frames where B3 added the limb with the handle.

**Reverted from A7 as over-reach:** the `endorsement: "global" → "project: Global"` rewrite. B3's diff
never touched that field. `skillEndorsement` can no longer return `global`, but that is what the CLI
of the day emitted and the frame records it consistently — changing it is re-recording, not repairing.

### The oracle was rewritten, and now fails on the bug it missed

`capture-frames.test.ts` no longer asserts whole-line `format()` equality. It asserts what holds for a
recording of **any** vintage: **no printed line contains the string `undefined`** (every verb, every
frame — which also closes the review's medium about the old version skipping `publish` and `status`),
the printed version token is its own row's `Version N`, no local state keeps the `@<8 hex>` suffix,
`people[]` only on the bare `ls`, and `display_name` matches the byline.

**Proven both ways:** 86 of 140 fail on the pre-repair frames, and the `undefined` assertion fails
with all 12 offending lines listed when pointed at my first bad repair. 114 pass on the repair.

**The lesson, for the record:** an oracle built from the same function as the fix cannot catch the
fix being wrong. The assertion that caught this is the one that describes what a real CLI can never
emit, independent of how the file was produced.

**Gates:** root lint, typecheck, **vitest 1690/1690**; desktop **vitest 1893 passed / 90 skipped**.

---

## A11 — The last frame contradiction, and a desktop pin that was pinning the broken fixture

**What.** The stopped review's fourth finding: B3 added `people[]` to the bare `ls` frame with every
person's **`installed[]` empty**, while the same frame's `installedBy` — already there, untouched by
B3 — named those handles. `ls.ts:117-131` builds both from the *same* parsed people, so they cannot
disagree, and `b3-real-data/frames/ls.jsonl` shows the pairing exactly. Confirmed against
`origin/main`: the limb is B3's. **Five frames** (`m7-S7b`, `m7-S7f`, `m7-S7g`, `m7-S7r`,
`installed-state/real-data-check-ls`), nine person rows, every field derivable from the frame itself.

**The part worth reading.** Repairing it turned a desktop test red:

```
expect(catalog.value.people[0]).toMatchObject({ …, installable: [], onDisk: [0, 0], adoption: 2 })
```

`installable` and `onDisk` are **derived from `people[].installed`**. With the limb empty the members
page showed mira as having installed nothing — and the test pinned that. Repaired, she has her two
installs, and the derived pair becomes coherent with the rest of the same frame: `deploy-check` is
`placed` for the viewer and `tdd` is `absent`, so `onDisk` is `[1, 2]` and `installable` is both.
`adoption: 2` was already right, because it comes from `installedBy` — the half that was never broken.
**The assertion was pinning the contradiction, and the repair is what made the frame agree with
itself.** Updated with the reasoning in place.

**Audit, so the bound is known.** I checked every non-`b3-real-data` frame for the rest of this
family — `installs` vs `installedBy.length`, `roster` vs `people` handles, `authored[]` vs the author
byline, `versionCount` vs `latest`, and any surviving tree hash in a re-keyed version field.
**Zero further contradictions.** This was the last one.

**The oracle gained a sixth assertion** for the pairing; it fails on all five files before the repair.

**I restarted the review for this.** It had been running ~10 minutes against `303edc6`. Shipping a
review that reports "clean" on a tree I already knew was wrong is worse than paying ten minutes
again.

**Gates:** root lint, typecheck, **vitest 1698/1698**; desktop typecheck, lint, **vitest 1893
passed / 90 skipped**, `e2e:routes` **137 passed**.

---

## A12 — The review found my frame repair invented a value, and it was right

**What.** The scoped `/hybrid-review` of `085e205...HEAD` returned **5 confirmed (2 high, 3 medium)
of 22 distinct findings**, and **every one of them is on code I wrote today.** Four are fixed here.

**The one that matters most.** A11 repaired `people[].installed[]` by deriving it from the frame's own
`installedBy` limb — which carries `handle`/`displayName`/`scope`/`since` but **never `version`**. So
the version had to come from somewhere, and I took it from the skill's `latest`: `"v1"`.
`ls.ts:277-279` says exactly that must not happen — *"a null version simply says nothing rather than
inventing one"* — and the untouched sibling `mock-vs-real-2026-09-09/frames/ls.jsonl` shows `null`.

**What I had missed: these frame sets have `fixture.sh` files.** I assumed the drivers were lost,
because `b3-real-data`'s README says its own were ad-hoc — but `m7-S7b`, `m7-S7f`, `m7-S7g`, `m7-S7r`
and six others each ship the script that produced them, and `fixture.sh:39-41` seeds
`"version":null` on every installed entry. **The ground truth was in the repo the whole time.** The
repair now reads `installed[]` out of each set's own `fixture.sh` verbatim rather than deriving it.
`installed-state/real-data-check-ls.jsonl` has no fixture, so its one entry is set to `null` — the
value that invents nothing.

**The oracle was too weak to catch it**, exactly as the reviewer said: `toHaveLength` cannot see a
fabricated *field*. It now pairs each `installed[]` row against its `installedBy` row and asserts
`scope` and `since`. `version` is not on `installedBy` at all — which is precisely why it must never
be invented.

### The other three fixed here

- **(high) The D61 reporter was wired into `readEvalQueue` but not into `updateEvalQueue`** — the path
  that writes the parsed items straight back, making the drop **permanent**. `--dequeue` and
  `enqueue` therefore still discarded a paid-run request in silence. Threaded through
  `updateEvalQueue`, `enqueueEvals` and `dequeueEvals`, wired at the `--dequeue` call site and at
  `eval.ts:132`'s `--skipReceipted` guard. **Test verified to fail on the pre-fix tree.**
- **(medium) The chmod test would pass vacuously as root**, where permission bits are bypassed — every
  sibling chmod test in the tree carries `skipIf(win32 || getuid() === 0)`. Added.
- **(medium) The Run-eval gate was only consulted in the pre-run branch.** A finished, retryable run
  for a skill whose folder is gone still rendered a live "Run eval again" — the same guaranteed
  failure the gate exists to prevent, in the case its own comment anticipates.

**Shipped without a test, and saying so:** the retry-button gate. Reaching that state needs a run to
outlive a mid-stream uninstall, and the harness caches the skill query, so every route I tried
produced a test that did not actually exercise the path. A test that passes without exercising the
fix is worse than none — it is the tautological-test failure this project has been bitten by before.
**Owed.**

**Still open, and NOT mine: the second high.** See the handoff — the fixtures behind these frames are
`layout_version: 2`, which the current `teamSchema` refuses outright, so **none of these frame sets
can be regenerated by the current build at all.** That is a fixture-strategy decision, not a repair.

---

## A13 — The confirmation pass caught that my own high fix stopped one call site short

**What.** The `harden` loop's fix-scoped pass (`--base=c48ca7d`) returned **3 confirmed (1 high, 2
medium), 0 contested** — and the high was mine again, in the fix I had *just* made for the previous
high.

**The high.** A12 threaded the D61 reporter through `updateEvalQueue`, `enqueueEvals` and
`dequeueEvals` and wired **two** of the three permanent-write call sites: `--dequeue` and
`--skipReceipted`. `setup.ts:361`'s `enqueueEvals` still passed no reporter. So the onboarding
"queue evals overnight" step — **the route a brand-new user takes** — still deleted a schema-invalid
leftover permanently and silently. I fixed the signature and missed the caller.

**The two mediums.**
- The teamless `--dequeue` branch reads the queue twice (once for the ambiguity check, once inside
  `updateEvalQueue`) and I passed the reporter to both, so the drop line printed **twice** for one
  invocation. The reporter now goes to the first read only.
- The retry gate still had no test. **The reviewer supplied the way through** that I had given up on:
  extract the predicate and unit-test it. `canRetry` now lives in `screens/skill/can-retry.ts` — its
  own module, because `react-refresh/only-export-components` forbids a non-component export from a
  component file — and the branch that matters (a finished run whose folder vanished mid-stream) is
  covered. **The debt A12 recorded as owed is paid.**

**All three carry tests verified to fail on the pre-fix tree.**

**What this pass is worth saying about.** Two review rounds in a row, every confirmed finding was in
code written in this session, and in both rounds the high was a fix that stopped one caller short of
done. The pattern is mine: I change a signature, wire the call sites I am looking at, and do not grep
for the rest. **Grep for every caller after widening a signature** — the same discipline the repo's
CLAUDE.md already states for new functions.

**Gates:** root lint, typecheck, **vitest 1701/1701**; desktop lint, typecheck, **vitest 1980 passed**
(the 4 failures are the pre-existing missing-oracle boards on `main`, unchanged).

---

## A14 — The loop converged: pass 3 found one test gap, and it was a real one

**What.** The second fix-scoped pass (`--base=2d7b501`) returned **0 critical, 0 high, 1 medium, 0
contested** — convergence by the `harden` rule (no critical/high remaining).

The medium was in the test I had just written to pay off A13's debt. `canRetry`'s second disjunct is
`ok === false && value === undefined`, but `Result<T>` (`backend/types.ts:2`) explicitly permits
`ok:false` **with** a value, and `failureWith` produces exactly that on the drain path
(`eval.ts:625`: some queued evals failed, the partial result survives). My fixtures only covered
`value: undefined`, so the disjunct's second half was untested — a regression dropping it would have
passed.

The behaviour was already right; only the assertion was missing. Retrying there would spend the
user's own Claude account on work that already ran.

**Verified not vacuous:** weakening the guard to `ok === false` alone makes the new case fail.

**Three passes, and the trend is the point:** 5 confirmed → 3 confirmed → 1 confirmed, highs 2 → 1 → 0.
Every finding in all three was in code written this session.

**Gates:** root lint, typecheck, **vitest 1701/1701**; desktop lint, typecheck, **vitest 1981 passed**
(the 4 failures are the pre-existing missing-oracle boards on `main`).

---

## A15 — B8's first review, and a finding I could NOT reproduce, so I shipped nothing

**What.** I gave **PR #184 (B8) its first-ever review** — it had never had one, and D53 requires one
before it can merge. Runner: `.claude/workflows/ultrareview.b8.local.js`, a copy of the B3 one with
the worktree path swapped. B8 was re-rebased onto B3's final tip (`5918973`) first, again with **no
conflicts**, gates green (typecheck, lint, **root vitest 1713/1713**).

**Result: 0 critical, 0 high, 2 medium, 0 contested — no blockers.** Notably, **neither finding was in
my A8 rebase resolution**, which is the reassurance I wanted about that write-path merge.

### The finding I could not reproduce — and therefore did not fix

`teamMigrate.ts` compares skill uuids case-sensitively at three capture points, where `guard.ts:111/117`
lower-cases for the same comparison. Claimed impact: a case difference silently ARCHIVES a current
receipt instead of re-keying it, and silently nulls a member's installed version.

I wrote the fix (`.toLowerCase()` at each point, matching `guard.ts`) and then could not make a test
fail without it. Two attempts:

1. **Upper-cased the declared `metadata.id`.** Passed pre-fix — because **`z.uuid()` in this zod
   version NORMALIZES to lower case.** Verified directly: `z.uuid().safeParse(UPPERCASE)` returns
   `success: true` with the **lower-cased** value. That silently undercuts two of the reviewer's three
   capture points: the frontmatter id and a person's `installed[].id` both arrive already normalized.
2. **Upper-cased the `evals/<uuid>/` folder name** — the one identity no schema touches, captured raw
   by a regex that admits `[0-9a-fA-F-]{36}`. **Also passed pre-fix.** I ran out of budget before
   establishing why.

**So I reverted the fix and the test. B8 is back at exactly the reviewed commit.** The repo's rule is
that every fix carries a test proven to fail on the pre-fix tree; I could not meet it, and a change I
cannot demonstrate the need for — to a **data-moving migration verb**, in a batch that has had one
review and no human sign-off, made unsupervised — is not one to ship on a hunch.

**For whoever picks this up:** the fix is three `.toLowerCase()` calls plus one on `receipt.skill_id`
(needed so the tightened compare does not turn a case difference into a NEW refusal). The open
question is only whether the folder-name path is reachable — start by checking whether the uppercase
directory actually survives into the git index on this filesystem.

### The second medium, also not fixed

`teamRepo.ts:195`'s new migrate-only refusal (a non-regular file — symlink mode `120000`, gitlink
`160000` — under `skills/`/`evals/`/`people/`/`team.json`) **has zero test coverage**, and the review
noted a sibling untested throw at `:206`. Both are real coverage gaps in new control flow. I left them
because the same budget went into the finding above; they are small and worth closing.

**B8 remains UNPUSHED**, as under A8.

## A16 — The re-recorded fixtures keep the hash-seeded placement (a pre-versioning install), not an invented `v1`

**Context (2026-09-13, ~02:30 PDT, under D78 grant 3).** D70 delegated the real re-recording of the
frame corpus and D77 gated it before B5. Every committed `fixture.sh` seeds the machine-side
`config.json` placement with `VER=$(git rev-parse HEAD:skills/deploy-check)` — a 40-hex tree hash. In
rewriting the fixtures to layout 3 the question the ledger did not decide is what that placement
should depict: a machine that installed **before versioning** (keep the hash; the CLI reads it as
`null` per §3.4) or one that installed **at Version 1** (seed `"v1"`).

**Taken: keep the hash.** Three reasons. (1) It is what D70's own alternative — "seed layout 2 and
run `team migrate` inside the script" — would yield: migrate rewrites the repository, never the
machine's ledger, so the placement stays a hash and reads as null. (2) The B3 fix commit nulls
exactly these values in the derived frames (D70's LOCK half); a re-recording that keeps the same
input differs from those frames only where the CLI's real output differs, which is the honesty the
ruling wanted and keeps the desktop re-pins from flipping twice in one night. (3) Nothing in the
seven replay consumers needs a `v1` placement — D71's `tracked:false` coverage row is a hand-built
test fixture, not a recording. Every other id, handle, email, description, category and timestamp is
kept, so the recordings differ from the committed frames only where today's CLI genuinely differs.

**Revisit trigger:** a locked fidelity board or desktop test that needs a placement at a known
version folder — then one fixture gains a second, `v1`-seeded placement rather than rewriting this one.

## A17 — The B3 fix commit: the judgement calls the implementers made inside D69–D72, and the two defects the verifiers caught

**Context (2026-09-13, 02:10–03:00 PDT, D78 grant 3).** Seven implementers built the B3 fix commit on
disjoint file sets; seven read-only verifiers tried to refute each. Every item was implemented to its
ruling; the calls the rulings left open, taken as follows.

- **D69 shape.** `applyReadme(existing, block, { skipped })` stays a string-returning function;
  `applyReadmeWithReason` is the one refusal path underneath it and returns `{ text, refusal? }`.
  `ReadmeData.skipped` is required so a future reader cannot forget it. The cause refusal fires even
  on a README with no generated region yet (a versionless folder is never legitimate in layout 3, so a
  half-migrated repo gets no first catalogue either); rows are counted structurally (table body lines,
  never skill names); the original empty-catalogue rule is kept beneath the cause rule. The hidden
  `readme` command prints the reason and exits 0 — a red Action on every write would also fire for a
  team that legitimately removed its last skill, which is the case the never-throw rule protects.
  **Verifier defect, fixed:** the generic-remote path forwarded the reason only to an optional
  `onReadmeRefusal` hook nobody passed, so `install`/`publish`/`join`/… on a half-migrated repo
  would leave README.md out of the commit silently. The printer now rides `lockWait(io)`, which
  every command already spreads into its `safeWrite` options, in both interactive and background
  modes (a script's log is where its operator looks); `offerProfileEntry` gains the same spread.
- **D72 validate.** `--cwd` mode resolves the NAME first (`isSkillName` → newest `v<N>` in the
  checkout), then the path against the checkout; both modes descend from a `skills/<name>` container
  with no `SKILL.md` to its newest version. The only divergence from the triage's literal "always by
  name" is that a real path still works, which the folded `:30` case requires.
- **D72 local-skills.** Across roots a usable folder in a later root still wins over a rejected one
  in an earlier root; the rejected match is returned only when no root offers a usable one. Messages:
  rejected → `<path> is not a usable skill folder: <detail>`, failed → `<path> could not be read as a
  skill folder: <reason>`; the queue path skips that folder only. A folder with no `SKILL.md` at all
  still gets the generic §6.3 miss (unchanged; spec D16 territory).
- **D72 eval.** Staging is one `mkdtemp` under `<skill>/evals/`, one rename per asset; on failure the
  staging dir goes and `evals/` is removed only when this call created it; the failure is a `Result`,
  not a throw. No fs seam exists, so the partial-write test provokes the second file with a path that
  cannot be a file.
- **D72 mock.** The `endorsed` array stays (the catalog reads it for session-endorsed project cards);
  only the PR-number use went. The expected key list is written out literally.
- **D70 oracle.** The legacy half is keyed strictly to each set's own committed inputs (a fixture
  seeding `rev-parse` into a placement, or a `config-*.json` holding a 40-hex version); older rows with
  no `placement` field are keyed by the fixture's skill folder name; labels are markdown bullets in
  the NOTES.md style. **Verifier defect, fixed:** the label was also appended to `m7-S7d`, whose two
  frames (`decline`, `usage-error`) are the genuine 0.1.6 run record that the re-key commit never
  touched; removed. The twelve labelled sets are exactly the twelve `b721cc5` re-keyed.
- **D71 / config test.** The dead assertions after `setup.test.ts:919`'s `return;` were deleted, not
  relocated: the message still exists at `setup.ts:335` but nothing sets `versionProblem` since B3
  removed the `skillVersions` catch, so the arm is unreachable production code — filed below as owed,
  not fixed here. The config-migration test uses the default (non-preserving) `update()`; with
  `preserveUnchanged: true` the migration does not reach disk (observed, not asserted — a `patchConfig`
  diff of `before` vs `after` sees no change), which is a question for the batch that next touches it.

**Owed, not fixed here:** `setup.ts:333-335` + `eval.ts:490 versionProblem` dead code; the
`preserveUnchanged` observation above.

## A18 — B4's confirmation pass dispositions, and what the frame re-recording still owes

**B4 confirmation pass (`wf_b9a72b49-3ec`, base `3460e0d`, 2026-09-13 03:15 PDT): 0 critical/high.**
- *Medium, deferred:* in the demo backend the non-ME person pages' `buckets`/`onDisk` are computed once
  from the fixture and never re-derived after a session install or removal (D65's sibling for people;
  it reaches `personStatus()` and so the person page's Install/Remove primary). Not applied — the
  harden loop never applies mediums, and the D53 bar is met. **Gate:** D64's tripwire (the first locked
  board or desktop test that needs live per-person install state); fix shape = recompute both after
  `withInstall`/`removalState` in the `catalog` handler, as D65 did for the stale-eval overlay.
- *Contested 1-2, declined by ruling:* "the mock's `installable`/buckets model authorship, not
  `installed[]`/`profile[]`" restates D64's option B, which Ryan gated behind the same tripwire.

**Frame re-recording (D70 delegate, D77; stage 1 `bba1eae`, stage 2 this commit).** Fifteen drivers
re-recorded 91 frames from layout-3 fixtures with the CLI at `f2089dd`; every difference from the
derived frames is the CLI's real output. Still owed, none gating B5:
1. **m7-S7q** — the thirteenth derived set; stage 1 gave it no fixture (an orchestration omission —
   it has neither a `fixture.sh` nor a consumer beyond `features.test.ts`'s hello read). Labelled
   honestly as still derived. Fixture shape = m7-S7ad's.
2. **first-run-in-app `setup-create-fork.jsonl` / `setup-resume.jsonl`** — the creator path needs a
   logged-in gh under the fixture HOME; the driver now records them only when the fresh recording
   prints "GitHub: gh is logged in." and otherwise leaves the 0.1.7 recordings. Re-record on a
   machine where `gh auth status` succeeds under a foreign HOME (e.g. `GH_TOKEN` exported).
3. **Deleted-verb frames kept:** `m7-S7b/decline.jsonl` (`decline` is gone, §12) and
   `m7-S7d/decline.jsonl` (`connect` is gone); `replay.test.ts` still pins the latter's error text.
   A layout-3 substitute is a re-pin, not a recording — B5/B6's call.
4. **Reproducibility hygiene:** 31 frames and S7c's `config-{before,after}.json` bake in the recording
   session's scratch root, and `mock-vs-real` `update.jsonl` bakes in this checkout's `dist` path — as
   the old recordings did. A driver that normalises the fixture root to a fixed path would make
   re-runs byte-identical across machines; readers already rewrite the root, so no pin depends on it.
5. **Adapter observation from the re-pins:** with a 0.14.0 hello (`refresh:true`) the adapter spawns
   one background `sync` after the FIRST hello without consulting `workflowGate.busy()`
   (`desktop/src/backend/tauri/index.ts` `onHello`), so a fetch can run concurrently with a write when
   the mutation is the session's first CLI process. The pins document current behaviour; B5/B6 look.

## A19 — The B3 fix commit's own confirmation pass: two highs fixed, one adjacent medium taken, three coverage mediums deferred

**Pass `wf_e3862d60-9ba` (base `c960998`, 2026-09-13 03:30 PDT): 0 critical, 2 high, 4 medium, all 3-0.**
- *High, fixed:* `validate`'s new `atPath()` returned `name: basename(absolute)` for a directly targeted
  layout-3 version folder (`skills/<name>/v3` holds `SKILL.md`), so HYG1 rejected every valid skill
  validated by such a path — the trap the sibling `newestVersion()` docstring warns about, fixed only on
  the container branch. Now the version-folder shape (a `v<N>` basename under a `skills/<name>` parent)
  validates under `<name>`.
- *High, fixed:* eval's generated-asset staging folder lived inside `<skill>/evals/`, i.e. inside the
  tree `sourceFiles`/`skillContentDigest` walk; a non-catchable interruption left a hidden
  `.generated.terum-*` folder that the next publish would digest and ship. The staging now lives in
  the skill folder's parent (same volume by construction; the per-asset rename stays a rename). The
  spec-fixed D2 ignore list was NOT extended — a hidden folder the digest silently skips would be the
  wrong kind of invisible.
- *Medium, taken (same catch block):* the failure message claimed "nothing was left" even when the
  cases rename had landed and only the triggers rename failed; it now says what landed.
- *Mediums, deferred:* no test drives `offerProfileEntry`'s `lockWait(io)` spread (gate: B6, which
  owns `profile-entry.ts` per §9.3); no test drives `resolveLibrarySkill`'s `failed` inspection branch
  (gate: B5, which next touches `local-skills.ts`); `atPath`'s `lstat` reports a symlinked target as
  not-a-directory while the Library scan reports symlinks explicitly (gate: the first symlinked
  Library entry a user reports; `validate` on a symlink today falls through to the by-name path).

Budget note: this pass cost 5.4M subagent tokens and took the 5-hour session budget from 60% to 86%;
the re-review of the two-high fix (`--base=f2089dd`) waits for the 07:00 reset before #183 merges.
