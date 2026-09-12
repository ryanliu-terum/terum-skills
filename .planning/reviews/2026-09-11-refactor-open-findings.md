# Library/Marketplace refactor — open findings, tracked for implementation

**Status:** the tracked list Ryan chose on 2026-09-11 in place of a third clean `/harden` round.
Implementation proceeds against this list; each item names the batch that must resolve it, and
resolution happens **at that batch's start**, not all up front.

**Provenance.** `/harden` ran three rounds on the spec. Rounds 1 and 2 counted: each confirmed a
set of findings, applied its eligible ones (8 and 8), and adjudicated the rest — those are closed
and in the spec. This file holds everything that did **not** reach a resolution:

| source | why still open |
| --- | --- |
| r1 contested (3) | panel split 2-1 or 1-2; never adjudicated |
| r2 contested (4) | panel split; never adjudicated |
| r3 confirmed (6) | verified 3-0, but **all six triage agents died** on the Claude spend limit, so none has a fix |
| r3 split (4) | genuine panel splits |
| r3 unverified (7) | **all three verifiers died**; the engine labels these `contested 0-0` — they are unverified, not split |

Round 3's Codex find half succeeded in full (54/54 reviewers, 0 failures, 21 findings at
`../harden-refactor-scratch/r3-findings.json`); only its Claude verify half aborted. Four of its
BLOCKER-rated findings were refuted 0-3 and are listed at the end for completeness, not for action.

## How to use this list

1. **At the start of each batch**, take that batch's rows below. For each, do the cheap thing
   first: **check the claim against the code in the worktree**. Most of these are one grep.
2. A claim that holds → fix the spec text *before* handing the batch to Codex, so the spec Codex
   implements is the corrected one. A claim that does not hold → strike the row with the grep that
   disproves it.
3. **Recurrence outranks a split vote.** Three items below were raised independently in two or
   three separate rounds and got a *different* verdict each time. Repeated independent discovery
   is stronger evidence than one panel's 2-1, so treat the ✦ rows as probably-real regardless of
   their last vote.
4. Nothing here is applied to the spec. When one is resolved, record it in the decision ledger the
   same way D15–D19 were.

---

## Blocking B3 — the layout-3 keystone (M1 + M2 + M3)

These change code Codex writes in B3. Resolve all of them before that run.

### ✦ OF-1 — `assessHygiene`'s signature omits the category list HYG7 needs

> **RESOLVED rev 8 (D28, Ryan 2026-09-11).** The filed question was the smaller half: the whole auto-category build is unowned — `categorize.ts`, `suggestCategory` and `askJson settingSources` do not exist — so B3 ships the precedence without the suggestion limb and the suggestion, HYG7 and hygiene's fifth parameter become batch **B9** after B5. HYG7 is kept, not dropped.
*r1 #8 BLOCKER (1-2) · r3 #9 BLOCKER→NOTE (1-2) — raised twice, split twice*
§5.1 step 5 specifies `assessHygiene(name, { files, executable }, policy.skill_license)`, but the
auto-category sibling (`2026-09-10-auto-category.md` §6) specifies
`assessHygiene(name, input, license, allowExecutable = false, categories?: readonly string[])` and
says HYG7 **no-ops when the list is absent**. As written, publish silently disables HYG7.
**Check:** read `src/lib/evals/hygiene.ts`'s signature and the HYG7 predicate at the worktree HEAD.
If `categories` exists and gates HYG7, the spec's call is wrong and §5.1 step 5 gains the argument.

### OF-2 — publish writes local bytes before a gate that can still refuse

> **RESOLVED rev 8.** The local write-back is now §5.1 **step 6b**, after every refusal-capable question, and the boundary against a failed `safeWrite` is stated (local first, idempotent on retry). Test added to §14.1.
*r3 #15 BLOCKER→GAP (3-0) and r3 #19 BLOCKER→DRIFT (3-0) — the same defect, found by two dimensions*
§5.1 step 5 writes the injected `SKILL.md` back into the local folder and promises "a refused
publish leaves the folder untouched"; step 6a (D19's regression gate) then asks *"Publish anyway?
[y/N]"*. Answering **N** refuses after the local rewrite already happened, so the promise is false.
**Fix shape:** move every refusal-capable confirmation *before* the local write, and state the
write boundary relative to a `safeWrite` failure. Add the `publish.test.ts` case: a matching FAIL
receipt + changed managed fields + a declined confirmation leaves the file byte-identical.
This one is self-inflicted — D19 (added in r2's adjudication) created it — so it is certainly real.

### OF-3 — guard row a′ does not actually enforce version immutability

> **RESOLVED rev 8.** Row a′ now requires the whole `skills/<name>/v<N>/` prefix to be absent from the pre-image, not merely each path; many files added together for a new version still pass. Test added to §14.1.
*r3 #16 BLOCKER→GAP (3-0)*
Row a′ admits a path when `tree.before(path) === undefined && tree.after(path) !== undefined`, and
§4.2 claims that "is what makes a version immutable at the authorization layer". It is not: the
predicate admits **adding a new file** to an already-committed `skills/x/v3/`. Every existing file
is untouched, but the version's bytes and content digest change, contradicting §3.1's "immutable,
never modified after commit".
**Fix shape:** require the entire target version prefix to be absent from the pre-image, while
still allowing many files to be added together for a *new* version. Test: adding a previously
absent file to an existing version is refused.

### OF-4 — the config preprocess destroys the hashes the migration needs

> **RESOLVED rev 8.** §3.4's claim was simply wrong — `personSchema` is team state and is never parsed through `configSchema`, so no preprocess ever touched it. The preprocess is now scoped to `configSchema` explicitly, and §13 gains an explicit legacy people-file reader that holds the 40-hex values through the re-key and validates the result. Also unblocks B8.
*r3 #17 BLOCKER (3-0) — the only r3 finding whose severity survived verification unchanged*
§3.4 requires a read-time preprocess mapping any 40-hex `version` in `personSchema.installed[]` to
`null`. §13 step 5 requires a 40-hex `installed[].version` to become `'v1'` when it matches the
migrated tree, and justifies itself with "the people files are committed team state and no
preprocess touches them". Both cannot hold: parsing a member file through `personSchema` nulls the
hash before the migration can read it.
**Fix shape:** give the migration an explicit legacy people-file parser that preserves the original
hashes until re-keying completes, then validates the layout-3 result; and correct §3.4's claim.
**Also blocks B8** (the migration verb) — resolve once, in B3, and B8 inherits it.

### OF-5 — `saveGeneratedAssets` refuses regeneration

> **RESOLVED rev 8 (D29, Ryan 2026-09-11).** `--gen` is deleted: eval uses the assets that are there and generates only what is missing, per asset. With no way to force generation over existing files, nothing can be overwritten — both refusals become unreachable and go. Regenerating is deleting `evals/cases/` and re-running.
*r3 #14 DRIFT (unverified — all three verifiers died)*
§6.3 says `--generate`'s new behaviour is "the first half of the old one and nothing else —
`saveGeneratedAssets(<the local skill folder>, generated)`, full stop", while D9 explicitly
anticipates regenerating cases. The finder reports `src/commands/eval.ts:437` rejects generated
cases when they already exist.
**Check:** read that line. If it refuses on existing cases, §6.3 must say what regeneration does
(overwrite in place is the obvious reading, since D9 accepts the version churn).

### OF-6 — eval's candidate source and receipt writer are not reconciled
*r2 #7 BLOCKER (2-1)*
Carried from round 2 unadjudicated. Re-read the r2 report's entry before B3's eval work; it sits in
the same §6.1/§6.3 area that OF-5 touches.

---

## Blocking B4 — M5 marketplace

### ✦ OF-7 — `newestReceiptAt` returns a wrapper, not a receipt
*r1 #13 DRIFT (2-1) · r2 #13 DRIFT (refuted 0-3) · r3 #12 DRIFT (unverified) — raised three times, three different verdicts*
§8.1's `selectCardEval` does `newest := newestReceiptAt(...)` then reads `newest.skill_id` and
`newest.version` and returns `receipt: newest`. The finder reports `src/commands/receiptCheck.ts:15`
defines `CheckedReceipt = { file, … }` — a wrapper around the receipt, not the receipt itself.
**This is the single cheapest item on the list to settle and the most-repeated:** read
`receiptCheck.ts`'s type and `newestReceiptAt`'s return, and either fix §8.1's field access or
strike the row. A wrong answer here makes every marketplace card's eval read `undefined`.

### OF-8 — the sibling display contract still forbids the older-version fallback
*r3 #8 DRIFT (unverified)*
§8.1's fallback walk and §8.2's "from Version 3 · latest Version 5" chip reverse the ratified s12
display rule, which §8.2 acknowledges. The finder reports `2026-09-04-eval-engine.md` §12 still
states the old rule as live. The reversal is already deliberate and recorded — this is a
sibling-spec supersession note, in the style already used at that spec's head.

### OF-9 — the catalog call count omits an existing team inventory read
*r2 #15 DRIFT (1-2)*
§8.4 claims `catalog()` becomes two processes. Verify against the adapter before writing §14.1's
"exactly two CLI children" gate, or that test pins the wrong number.

---

## Blocking B5 — M4 library

### OF-10 — `backend.skill` is already taken by the detail reader
*r3 #11 DRIFT (unverified)*
§7.5 specifies `backend.skill.{move,rename,delete}` on the seam, but `desktop/src/backend/Backend.ts:28`
already declares `skill(q: {ref, team?, at?}, options?): Promise<Result<SkillDetail>>`. A method and
a namespace cannot share the name.
**Check:** one read of `Backend.ts`. If it holds, §7.5 picks another name (`backend.skillFile.*`
or `backend.library.*`) and §11.4's `moveAction` routing follows.

### OF-11 — reusing `uninstallMany` unchanged breaks the undo guarantee
*r2 #16 DRIFT (2-1) · r3 #13 DRIFT (unverified) — raised twice*
§7.5 promises deletion "is undoable, and `prune` is the only thing that ever hard-deletes", and
prescribes "delete of a placement = `uninstallMany`, unchanged". The finders report `uninstallMany`
does not in fact preserve an undoable copy in every path.
**Check:** read `uninstall.ts`'s removal path and `placer.remove`'s quarantine behaviour.

### OF-12 — interrupted rename has no usable completion contract
*r3 #20 GAP (unverified)*
§7.5's recovery rule re-points a stale ledger row "when the recorded fingerprint matches what is
there, dropped otherwise". After an interruption *between* the `SKILL.md` frontmatter rewrite and
the ledger re-key, the old path is gone and the new fingerprint no longer matches the recorded one,
so the rule drops the row rather than repairing it — the one state §7.5 says must not persist.
**Fix shape:** match on the recorded *name* as well as the fingerprint, or write the ledger first.

### OF-13 — the Library inventory still hides folders and reads team state (sibling)
*r1 #6 DRIFT (2-1) · r3 #6 DRIFT (unverified) — raised twice*
D16 and §7.4 make every direct child folder a card and delete the clone-dependent health states;
`2026-09-02-phase-1-build.md` §6 still requires the old discovery and team-derived inventory. A
sibling supersession note, same shape as OF-8.

---

## Blocking B6 — M6 install

### OF-14 — the lifted destination picker requires the feature key B2 renames
*r3 #10 BLOCKER→DRIFT (1-2)*
§9.1.1 lifts `install-destinations.ts` from closed PR #167 "not rewritten", but §7.1 renames the
`checkouts` feature key to `libraryProjects`. The lifted file reads the old key.
**Fix shape:** the lift carries a rename. Say so in §9.1.1 so the implementer does not paste a file
that silently reads `false`.

### OF-15 — receipt seeding needs a digest migrated receipts never acquire
*r2 #19 BLOCKER (1-2) · r3 #18 BLOCKER (refuted 0-3)*
D11's install seeding keys the local store by `content_digest`, which a receipt re-keyed by §13
step 3 does not carry (it predates schema 2). Round 3's panel refuted this 0-3; round 2's split
1-2. Worth one check when B6 writes the seeding step: if a migrated receipt lacks the digest, state
whether it is seeded under a computed digest or skipped.
**Also touches B8.**

### OF-16 / OF-17 — sibling install grammar and collision contract are stale
*r3 #4 DRIFT (3-0) · r3 #5 DRIFT (3-0) — both confirmed, both sibling-spec edits*
`2026-09-02-phase-1-build.md` §6 still advertises `install <ref>[@<version>]`, says an unregistered
root is registered by the install, and describes the foreign-collision abort with a `--force` hint
into quarantine — all three reversed by §9.1/§9.1.1 and D12. Its §12 walkthrough tests the old
behaviour. Amend the sibling (grammar, destination rule, collision contract, walkthrough) while
preserving quarantine for uninstall and explicit deletion.

---

## Sibling-spec drift, no batch (do with whichever batch touches the area)

- **OF-18** *r3 #2 DRIFT→NOTE (2-1)* — `2026-09-02-phase-1-build.md` §6 still calls publish "the
  deliberate team-endorsement" and describes the PR gate.
- **OF-19** *r3 #3 DRIFT→NOTE (2-1)* — the same sibling still describes layout 2 and 40-hex
  persisted versions.

Both are the same class as OF-8 and OF-13: the phase-1 build spec is the ancestor this refactor
supersedes wholesale. A single supersession banner at its head, enumerating the sections §3, §5,
§9 and §10 replace, closes OF-13, OF-16, OF-17, OF-18 and OF-19 together — cheaper than five
separate edits, and the pattern is already established at `2026-09-04-eval-engine.md:3`.

---

## Refuted in round 3 — listed so they are not re-raised

All four were BLOCKER-rated by Codex and killed 0-3 by the Claude panel:

- **#0** build-spec guard rejects publish and migration writes
- **#1** `skillVersions` retains an incompatible signature and return shape
- **#7** no incumbent incorrectly becomes a single-arm eval
- **#18** migrated receipts lack the digest install requires *(but see OF-15 — round 2 split on the
  same substance, so the refutation is not unanimous across rounds)*

---

## What this list does not cover

The four conscious deferrals in the decision ledger's `deferred:` frontmatter (repeated replacement
overwriting `.claude/old-skills/`, nothing ever emptying it, `eval --generate` version churn) are
product punts with named revisit triggers, not open findings — they stay where they are.

**Every ruling in the spec and the ledger remains unchecked against the team's shared record.** The
`terum` MCP has refused auth (HTTP 401) across three sessions, so `check_decision` and
`get_standing_decisions` have never run against D1–D19. That is a caveat on the whole spec, not an
item here.
