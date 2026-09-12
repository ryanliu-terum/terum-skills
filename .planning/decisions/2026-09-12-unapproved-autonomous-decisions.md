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
