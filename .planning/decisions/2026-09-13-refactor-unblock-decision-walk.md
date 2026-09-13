---
title: library/marketplace refactor — unblocking the pipeline decision walk
date: 2026-09-13
north_star: Every remaining batch can build, review and merge in order without another ruling from Ryan, while main never carries a defect a teammate would see
status: complete
deferred:
  - what: delete declined[] and its three readers (uninstall.ts, install.ts, ls.ts) under §9.1 — D49 wrongly said nothing reads it (D62)
    gate: B6 is specced — the deletion is B6s per §16.1, and its spec text names the three readers
  - what: real per-person installed[]/profile[] fixture data for the demo backends person buckets, through the design.json generator (D64)
    gate: the first locked fidelity board or desktop test that needs a person with an installed-but-not-authored skill
  - what: §4.4 applyTree hardening (removals before writes, prune emptied parents) and lower-casing the migrated evals/ folder (D66)
    gate: any safeWrite mutation that needs a case-only rename, or a decision to normalize legacy evals/ folders
  - what: genuinely re-record the thirteen frame sets from layout-3 fixture.sh scripts and re-pin the seven replay consumers (D70, D77)
    gate: before B5 is handed to Codex — started in parallel with the B4/B8 merges
  - what: publish notice collapses two CLI-distinguished outcomes with no coverage, SkillScreen.tsx:57 (D71)
    gate: B5s SkillScreen work
  - what: profile-entry.ts lacks the writePersonFile/addProfileEntry/removeProfileEntry API §9.3 names (D71)
    gate: B6s spec resolution — §9.3 is M6
  - what: twelve test-coverage and perf mediums from the B3 full review (profile-entry re-add path, ignoredByDigest parity, create.test Global project, regenerateReadmeInTree double read, EvaluationReport header regex, teamless EvalQueueItem, bare --dequeue ambiguity, evalReport digest store, detailVersionFields fallback, resolveLibrarySkill serial scan, and two more) (D72)
    gate: the batch that next touches each file — B5 for local-skills.ts/ls.ts/desktop, B6 for profile-entry.ts, B8 for readme.ts
  - what: publish bakes the team licence policy in before taking the lock and never re-validates it, publish.ts:105 (D72)
    gate: the first team with more than one admin changing policy
  - what: B6 seeds the local eval store by content_digest and prints a line for any migrated receipt lacking one (D76)
    gate: B6s spec resolution
---

# Refactor pipeline unblock — Decision Walk

**North Star:** Every remaining batch can build, review and merge in order without another ruling from Ryan, while `main` never carries a defect a teammate would see. (Ratified by Ryan, 2026-09-13. Measured underneath the refactor's product North Star: *nothing moves between your machine and the team unless you ask, and you can always see exactly what's on each.*)

Continues the ledger at `2026-09-11-library-marketplace-refactor-decision-walk.md` (D1–D61); numbering here starts at **D62**. Every item below was surfaced by a review or a prior session and left for Ryan; none is new.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 62 | D-g — the declined[] record contradiction (the one blocker on #183) | LOCK | correct D49s false sentence; B6 owns the §9.1 deletion; code untouched | deferred entry → B6 |
| 63 | push the rebased B4 (3460e0d) and B8 (54fbda5) over their open PRs | LOCK | nothing can move unpushed; A8s teamRepo merge is read before B8 MERGES, not before it is pushed | done 2026-09-13 |
| 64 | B4s demo-backend person buckets (last confirmed high on #185) | GATE | one-line approximation now; real fixture data behind a tripwire | a board/test needing installed-but-not-authored |
| 65 | B4s untriaged medium — demo stale-eval overlay ignores mid-session installs | LOCK | two-line reorder + the missing scenario test, same commit as D64 | — |
| 66 | §4.4 applyTree hardening + migrate folder lower-casing | DEFER | no live trigger: skill names are lowercase-only and skill rename never enters safeWrite | a case-only rename in safeWrite |
| 67 | D61s declined seventh — eval writes generated cases before the run | LOCK (declined) | D9-specified and disclosed; rollback would orphan the runs digest | — |
| 68 | D-f — fold scanned roots + local ids into status | LOCK (closed) | three processes stay (D52); nothing measured says the third is visible | — |
| 69 | README catalogue partial-wipe (B3 CRITICAL, D58s residual) | LOCK | refuse on a versionless skill folder AND on a row drop; keep existing, never throw | lands on B3 under D55 |
| 70 | the frame corpus — thirteen derived frame sets | LOCK + DELEGATE | null invented values + label as derived on B3 now; real re-recording is its own session | before B5 (D77) |
| 71 | the ten contested findings | GROUP | 4 → D70, 1 resolved by events, 1 folded into the validate fix, 2 test hygiene on B3, 2 deferred | B5 / B6 gates |
| 72 | what else from the B3 review lands on B3 | LOCK | the four highs under D55 + the config-migration integration test; twelve mediums + the licence race deferred | per-file batch gates |
| 73 | OF-10, 13, 14, 16, 17 — the non-fork spec findings | LOCK | all hold; backend.skillFile.*, supersession notes, the lift carries the libraryProjects rename | B5 / B6 spec start |
| 74 | OF-11 — uninstallMany vs "delete is undoable" | LOCK | rewrite §7.5 to the real three-way contract; no behaviour change | B5 spec start |
| 75 | OF-12 — interrupted rename recovery | LOCK | re-point the ledger row by skill id; fingerprint only decides local-changed | B5 spec start |
| 76 | OF-15 — migrated receipts lack content_digest | LOCK | B8 stamps it at migrate; B6 seeds by digest and names the skipped | one more B8 commit; B6 spec |
| 77 | D70s gate vs B5 | LOCK | gate stands; re-recording overlaps the B4/B8 merges | started after B3s nulls commit |

---

## Decision 62 — D-g: the `declined[]` record contradiction (the one blocker on #183)

**Verdict: LOCK — correct the record; B6 owns the deletion** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** uninstall still writes a member's name onto the `declined` list in their people file, and three places still read it. D49's closing paragraph says nothing reads it any more. That sentence is false, every B3 review flags the contradiction as a high, and no deferred entry tells any batch to finish the job.
- **Why it's a fork:** fix the record, or fix the code. Fixing the code pulls B6's §9.1 work into a converged branch under Ryan's open PR.
- **Options:**
  - **A — correct D49, add a B6-owned deferred entry.** Code untouched. *(decides it: B3 stays frozen; the high disappears because the false claim is gone)*
  - **B — delete `declined[]` and its readers now on B3.** *(decides it: contradicts §16.1's build order and changes uninstall's preview copy in the keystone batch)*
  - **C — leave it.** *(#183 never reaches zero highs)*
- **Recommendation:** A.
- **Zoom-out:** a record fix; nothing a teammate sees changes.
- **The call:** A.

### Technical
- Live readers (verified 2026-09-13): `src/commands/uninstall.ts:145`, `src/commands/install.ts:170`, `src/commands/ls.ts:220`; writer `uninstall.ts:207-212`.
- Edit: the closing paragraph after D49 in `2026-09-11-library-marketplace-refactor-decision-walk.md` (~`:700-705`) is rewritten to name the three readers and B6's ownership under §9.1; this walk's `deferred:` block carries the B6 entry. Lands on `refactor/b3-versions-keystone` **after** review `wf_36b70cd8-188` finishes (Dead End 16).
- Effort: one paragraph. Risk: none. Grounding: none needed.

---

## Decision 63 — Push the rebased B4 and B8 over their open PRs

**Verdict: LOCK — push both now** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** #185 and #184 show CONFLICTING because their base was rewritten under them (D55/D57). The corrected branches — B4 `3460e0d` (review loop converged), B8 `54fbda5` (uuid fix) — exist only on this Mac; CI cannot run and neither PR can move until pushed.
- **Why it's a fork:** a push rewrites history under an open PR, and B8 carries a hand-merged write-path resolution (A8, six `teamRepo.ts` hunks) no human has read.
- **Options:**
  - **A — push both now.** *(decides it: nothing else can happen to either PR unpushed, and A8 can be read before B8 MERGES rather than before it is pushed — B8 cannot merge before B3 anyway)*
  - **B — push B4, hold B8 until A8 is read.**
  - **C — Ryan pushes both himself later.**
- **Recommendation:** A.
- **Zoom-out:** `main` is untouched either way; the old tips `d887758` and `c2f7123` stay recoverable by hash.
- **The call:** A. **Still owed before #184 merges:** Ryan reads A8's `teamRepo.ts` resolution.

### Technical
- `git push --force-with-lease=<branch>:<old tip> origin <branch>` from each worktree. Both PRs remain based on `refactor/b3-versions-keystone`; retarget to `main` before that branch is deleted (Gotcha 10).
- Effort: two commands. Risk: history rewrite only. Grounding: none needed.

---

## Decision 64 — B4's mock-backend person buckets (the last confirmed high on #185)

**Verdict: GATE — option A now; option B behind a tripwire** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** the marketplace person page shows two lists — *On their profile* and *Installed*. The real adapter gets both from the CLI's `people[]` and is right. The demo backend (web preview, design boards, most UI tests) hardcodes the profile list empty and fills *Installed* with the skills the person AUTHORED — §8.5's distinction, inverted for every person.
- **Why it's a fork:** the demo fixture knows who authored what and what is on disk, never who installed what. Approximate from that in one line, or extend the fixture generator to carry real per-person `installed[]`/`profile[]`.
- **Options:**
  - **A — one-line approximation:** profile = authored; installed = the on-disk subset of authored. *(decides it: the buckets become genuinely different today from signals the fixture has; the demo still cannot show installed-but-not-authored)*
  - **B — real fixture data** through the design.json generator, mirroring the CLI shape. *(decides it: exact parity with the real adapter, but the design-canvas copies on this Mac are stale relative to the repo and #185 would wait on that tooling)*
- **Recommendation:** A now, B gated.
- **Zoom-out:** the North Star's "defect a teammate would see" is about the real app, already correct; this is demo fidelity and should not hold the B4 merge.
- **The call:** A now, B gated. **Tripwire:** the first locked fidelity board or desktop test that needs a person with an installed-but-not-authored skill.

### Technical
- A: `desktop/src/backend/mock/data.ts:28` — `buckets:[['On their profile',authored],['Installed',authored.filter(s=>s.installed!==false)]]` via `derive.skills_by`; `installable` untouched (pinned at full authored length by `marketplace.test.tsx:122,132,294`). Closes the 2-1 contested finding (profile bucket hardcoded empty) with it.
- B: `desktop/src/fixtures/schema.ts`, `design-canvas-terum-skills`' generator, new `derive` readers.
- Effort: A one line + one test; B a day. Risk: A none. Grounding: the review's triage agent, verified against `data.ts`/`derive.ts` this session.

---

## Decision 65 — B4's untriaged medium: the demo's stale-eval scene ignores mid-session installs

**Verdict: LOCK — fix in the same commit as D64's one-liner** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** in the demo backend's `stale-eval` scene, "you have Version 2" is computed from install state at page load; an install or removal during the session does not update it until reload. Demo only; the real adapter is unaffected; the board for this scene is `in-progress`, unasserted.
- **Why it came up:** the review loop never applies mediums unilaterally and this one's triage agent crashed (no disposition recorded).
- **Options:** fix now (two-line reorder + the missing `__mock=stale-eval` test) or defer to the board work.
- **Recommendation:** fix now — obvious, not a real fork.
- **The call:** fix now, same commit as D64.

### Technical
- `desktop/src/backend/mock/index.ts:121` — apply the overlay after `withInstall`/`removalState` (or read `withInstall(skill).placed`); add the scenario case to `desktop/src/backend/__tests__/mock.test.ts`.
- Effort: minutes. Risk: none. Grounding: read this session.

---

## Decision 66 — §4.4's `applyTree` hardening and the migrate folder spelling (opened by the B8 uuid fix)

**Verdict: DEFER — keep the shipped fix; §4.4 waits for a trigger** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** `54fbda5` stops migrate silently archiving a receipt whose `evals/` folder spells the uuid in upper case, and keeps that folder's spelling. D1 says paths are lowercase, so such a repo keeps one non-D1 folder after migrate; on Linux the readers (which look up the normalized id) do not see those receipts — exactly as before migrate. Nothing gets worse.
- **Why it's a fork:** lower-casing the destination is one line, but `safeWrite` applies mutations through the working tree and stages by literal path, so a case-only rename cannot be committed from macOS/Windows (reproduced this session: the staged-diff proof throws). Spec §4.4 prescribes the cure (removals first, prune emptied parents, then writes) and it is unimplemented and untracked.
- **Grounding that changed the lean:** `isSkillName` (`src/lib/schema.ts:31`) admits lowercase only, and §7.5's `skill rename` is a LOCAL folder operation that never enters `safeWrite`. So §4.4's "ordinary case-only skill rename" cannot happen through the CLI; the only reachable case-only rename is a hand-made upper-case uuid folder.
- **Options:**
  - **A — keep the fix, DEFER §4.4 with a trigger.** *(decides it: no write-path change in a batch that already carries an unread hand-merge; no live trigger exists)*
  - **B — build §4.4 now and lowercase the folder.** *(decides it: only if repos with upper-case uuid folders are a real population)*
- **Recommendation:** A.
- **Zoom-out:** the teammate-visible defect was the silent archive; fixed. The residue is invisible to anyone whose repo the CLI wrote.
- **The call:** A. **Revisit trigger:** any `safeWrite` mutation that needs a case-only rename, or a decision to normalize legacy `evals/` folders.

### Technical
- Shipped: `src/commands/teamMigrate.ts` — `folder = match[1]`, `id = folder.toLowerCase()` for the lookup, `folder` for destinations.
- §4.4 when triggered: `applyTree` (`src/lib/teamRepo.ts` ~`:430`) processes removals before writes and `rmdir`s emptied parents (lift the loop from `removeCreated`), plus a test only a case-insensitive filesystem can see.
- Effort: none now. Risk: none. Grounding: `schema.ts:31`, spec §7.5, this session's reproduction.

---

## Decision 67 — D61's declined seventh: eval writes generated cases into the skill folder before the run

**Verdict: LOCK — declined as a defect; the behaviour stands** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** `eval` on a skill with no cases generates them and writes them into the skill folder BEFORE running, after printing one line that names the folder and the consequence (the content changed; the next publish mints a new version; the local score blanks). A failed run leaves the generated files behind. The replay reviewer called that a missing rollback.
- **Why it is not a fork:** the spec's D9 makes generated cases ordinary skill content once written, and `dd4b511` keys the run on the folder as it stands after the write so publish can attach it. Rollback would orphan that digest; writing only after a successful run would re-key it. The behaviour is disclosed, not silent.
- **Options:** decline (record closed) · make the write-back a confirm prompt (breaks unattended `--drain` and the onboarding queue) · roll back on failure (contradicts D9).
- **Recommendation:** decline.
- **The call:** decline.

### Technical
- `src/commands/eval.ts` ~`:190-200`: print → `saveGeneratedAssets` → `evaluatedDigest` from the post-write folder → `evals/local/<digest>/<runId>`.
- Effort: none. Grounding: read this session.

---

## Decision 68 — D-f: fold scanned roots and local skill ids into `status` (OF-9's open half)

**Verdict: LOCK — closed; three CLI processes stay** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** the marketplace spawns three CLI processes (`status`, `ls --team`, `ls --local`). §8.4 originally targeted two. The win that mattered — one process per teammate, deleted — landed with B4; the third is a constant.
- **Why it's a fork:** two is reachable only by teaching `status` to report scanned roots and local skill ids — new CLI surface the spec never describes, and every recorded `status` frame re-recorded.
- **Options:** A — close, three stays (D52 already says so in §8.4/§14.1) · B — gate on a measured marketplace-load threshold.
- **Recommendation:** A. Nothing measured says the third read is visible to a user; the frame corpus it would disturb was just found unreliable.
- **The call:** A.

### Technical
- `catalog()` in `desktop/src/backend/tauri/index.ts`; `scannedRoots(local, home)` and `onDisk`'s `localIdentity` branch need the `ls --local` read (D52). No change.

---

## Decision 69 — The README catalogue partial-wipe (B3 full review's one CRITICAL; D58's residual)

**Verdict: LOCK — refuse on the cause AND on a row drop; lands on B3 under D55** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** the team README's generated skill table is regenerated on many writes (in-process for non-GitHub remotes; the Action commits and pushes it with `contents: write` on GitHub). B3's never-blank guard refuses only a FULL wipe. The generator silently skips any `skills/<name>/` with no version folder — the exact state a half-finished migration leaves — so one migrated skill plus nine unmigrated yields a one-row table that is pushed over the team's catalogue. D58 filed this as owed with no gate; the panel confirmed it 3-0 as critical (irreversible shared-repo data loss).
- **Why it's a fork:** how strict the refusal is. Too loose ships the wipe; a throw would wedge README regeneration forever, which is why the existing guard returns `existing` instead.
- **Options:**
  - **A — refuse on the cause:** any skill folder with no version folder → keep the existing block, say which folder. *(decides it: names the exact state; in layout 3 a versionless skill folder is never legitimate, so it cannot misfire)*
  - **B — refuse on the symptom:** new row count below the previous → keep the existing block. *(decides it: broader; also cannot misfire today because rows never legitimately drop in layout 3; would need revisiting if a batch adds repo-side skill deletion)*
  - **C — warn only.** *(fit 2; the push still happens)*
- **Recommendation:** A + B in the same guard.
- **Zoom-out:** the North Star's second half verbatim — a wiped shared README is the most teammate-visible defect in the batch.
- **The call:** A + B.

### Technical
- `src/lib/readme.ts`: `readReadmeData` (`:165`) and `regenerateReadmeInTree` (~`:196`) return the skipped names with the data; `applyReadme` (`:140-142`) refuses — returning `existing`, never throwing — when that list is non-empty or the new row count is below the previous; the caller prints the reason. Tests in `src/lib/__tests__/readme.test.ts` for both conditions, proven failing pre-fix.
- Placement: `refactor/b3-versions-keystone` after the review's other B3 fixes, one commit per harden pass (D55/D57). Effort: hours. Risk: low — fail-closed only.

---

## Decision 70 — The frame corpus: thirteen "recorded" frame sets that no CLI can reproduce

**Verdict: SPLIT — LOCK the surgical honesty fixes on B3 now; DELEGATE the re-recording to its own session, gated before B5** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** thirteen frame sets under `.planning/codex-runs/` are replayed by seven desktop test files and the fidelity gate as ground truth for what the CLI says. The B3 full review established they are not recordings any more: every committed `fixture.sh` builds a layout-2 repo today's CLI refuses outright, the contents were hand-derived across two sessions, some values were invented (a legacy placement shown as "Version 1" where the CLI says nothing), two sibling files disagree about one fixture, and an `endorsement:"global"` the CLI can no longer emit survives. The tests pass — which is the problem: the gate certifies itself. Four confirmed highs, one declined high, one medium, two contested findings share this root.
- **Why it's a fork:** re-recording is a day-plus (ten fixture scripts to layout 3, rebuild, re-record, re-pin every shifted desktop assertion); doing it on B3 holds #183. Not doing it leaves a gate that cannot fail.
- **Options:**
  - **A — split:** on B3 now, null the invented `v1`/`Version 1` values with the tree-hash prose they came with (the triage's fit-4 fix) and label each set's README as *derived, not recorded*; a dedicated session re-records for real, **before B5** (whose Library boards lean on these frames hardest). *(decides it: #183 carries no fabricated value; the real fix gets a focused session)*
  - **B — regenerate now on B3.** *(holds the keystone a day or more)*
  - **C — accept as derived permanently.** *(the fidelity gate stays self-certifying through the refactor)*
- **Recommendation:** A.
- **Zoom-out:** fixtures, not product — `main` is no less safe either way; but the pipeline half of the North Star needs a gate that can fail, and B5 is where it starts to matter. The `"global"` endorsement stays declined (the CLI of the day emitted it; rewriting a recorded value is re-recording) and disappears with the real re-recording.
- **The call:** A.

### Technical
- Now (B3): `mock-vs-real-2026-09-09/frames/status-json.jsonl:13`, `m7-S7c/frames/ls-local.jsonl:7`, `m7-S7k/frames/ls-local.jsonl:3` and siblings via the derivation scripts; `capture-frames.test.ts` gains a "no invented version for a legacy hash" assertion; each set's README gains a *derived* label.
- Delegated: migrate each of the ten `fixture.sh` to seed layout 3 (or run `team migrate` inside the script), rebuild `dist/`, re-record all sets, re-pin `replay.test.ts`, `replay-screens.test.tsx` and the five other consumers. **Gate:** before B5 is handed to Codex.
- Effort: now — an hour; delegated — a day-plus. Grounding: review `wf_36b70cd8-188`, `schema.ts:71-72`, the ten `fixture.sh`.

---

## Decision 71 — The contested bucket: ten panel splits, resolved as a group

**Verdict: GROUP — 4 covered by D70 · 1 resolved by events · 1 folded into a locked fix · 2 LOCK (test hygiene on B3) · 2 DEFER with gates** (Ryan, 2026-09-13)

### Plain English
The verify panel split on ten findings (four from the earlier B3 passes, six from the full review). None changes anything a teammate sees on `main`; most collapse into decisions already made.

| finding | vote | verdict |
|---|---|---|
| `ls-local` frames show "(Version 1)" for a placement the CLI leaves blank | 2-1 | covered by **D70** |
| `endorsement:"global"` in the frames | 2-1 | covered by **D70** (declined; goes with the re-recording) |
| `ls-local` fixtures drop the version text D1 requires (`m7-S7k/frames/ls-local.jsonl:3`) | 1-2 high | covered by **D70** |
| `search.jsonl` keeps the `endorsed` field search must drop (`m7-S7ad/frames/search.jsonl:6`) | 2-1 | covered by **D70** |
| §11.4's Run-eval gate only on the dialog | 1-2 | **resolved by events** — marketplace half landed on B4 (`3460e0d`); library half is B5's (A3) |
| `validate`'s path invocation resolves to the version-folder container (`validate.ts:30`) | 1-2 high | **folded into** the locked `validate` cwd fix — same code path, checked there |
| `placementVersionLabel()` has no coverage — every PLACEMENTS row is `tracked:true` | 2-1 | **LOCK** — one fixture row, on B3 |
| dead assertions after an early return (`setup.test.ts:919`) | 1-2 | **LOCK** — remove or relocate, on B3 |
| publish notice collapses two CLI-distinguished outcomes, no coverage (`SkillScreen.tsx:57`) | 1-2 | **DEFER** — gate: B5's `SkillScreen` work |
| `profile-entry.ts` lacks the `writePersonFile`/`addProfileEntry`/`removeProfileEntry` API §9.3 names (`:34`) | 2-1 | **DEFER** — gate: B6's spec resolution (§9.3 is M6) |

- **Recommendation / the call:** accept the group.

### Technical
- The two LOCK items ride the B3 fix commit; the two DEFER items are declared in this walk's `deferred:` frontmatter.

---

## Decision 72 — What else from the B3 full review lands on B3 before #183 merges

**Verdict: LOCK — the four remaining highs under D55, plus ONE medium (the config-migration integration test); the other mediums and the licence race DEFER with gates** (Ryan, 2026-09-13)

### Plain English
- **Under D55, no new ruling:** the demo backend's invented PR link on publish (delete); generated eval cases written non-atomically into the user's skill folder (stage-then-rename); an existing-but-invalid skill folder reported as "not found" (surface the scan's rejection); `validate` resolving a bare name against `process.cwd()` instead of `--cwd` (scope by call mode, and cover the contested `:30` path case).
- **The mediums (14 + 1 untriaged):** none is itself a data-loss defect — thirteen are missing tests, duplication or a repeated read; one guards an irreversible per-user rewrite (`migrateVersion`/`migrateScope` rewrite every user's placement ledger on first read, zero tests); the untriaged one is a two-admin licence-policy race in publish.
- **Options:** A — highs + the config-migration test, rest deferred · B — highs + all six mechanical mediums · C — highs only.
- **Recommendation / the call:** A. D61's shape; keeps the fix commit small enough for one confirmation pass.

### Technical
- Highs: `desktop/src/backend/mock/index.ts:177`; `src/commands/eval.ts:363`; `src/lib/local-skills.ts:260`; `src/commands/validate.ts:31` (+`:30`).
- Taken medium: `src/lib/schema.ts:245` — integration test through `ConfigStore` (read → update → re-read), the triage's fit-4 option.
- Deferred (frontmatter): twelve test/perf mediums gated on the batch that next touches each file; `publish.ts:105` licence race gated on the first multi-admin team; `applyTree` §4.4 already D66.

---

## Decision 73 — OF-10, OF-13, OF-14, OF-16, OF-17: the five B5/B6 spec findings that are not forks

**Verdict: LOCK — all five hold against the code; spec edits at the owning batch's start** (Ryan, 2026-09-13; presented as obvious, no vote)

| finding | grounding | resolution |
|---|---|---|
| **OF-10** §7.5's `backend.skill.{move,rename,delete}` collides with the existing `skill()` method | `desktop/src/backend/Backend.ts:28` declares `skill(q)`; `:19` declares `library(q)`, so `backend.library.*` collides too | the namespace becomes **`backend.skillFile.{move,rename,delete}`**; §11.4's `moveAction` routing follows. B5 |
| **OF-13** the phase-1 sibling still requires the old discovery/team-derived inventory | `2026-09-02-phase-1-build.md` §6 | scoped supersession note in the D51 shape. B5 |
| **OF-14** the lifted destination picker reads the feature key B2 renamed | `origin/feat/bulk-install-destination:desktop/src/screens/marketplace/install-destinations.ts:4,10` reads `features.checkouts`; B2 renamed it `libraryProjects` | §9.1.1 states that the lift carries the rename. B6 |
| **OF-16 / OF-17** the sibling's install grammar and collision contract are stale | phase-1 build §6 `:316`, `:415` still advertise `install <ref>[@<version>]`, registration-by-install and the `--force` quarantine hint; §12 walkthrough tests the old behaviour | amend grammar, destination rule, collision contract and walkthrough; quarantine kept for uninstall and explicit deletion. B6 |

---

## Decision 74 — OF-11: `uninstallMany` and §7.5's "delete is undoable" promise

**Verdict: LOCK — rewrite §7.5 to the real three-way contract; no behaviour change** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** §7.5 promises "delete is undoable, and `prune` is the only thing that ever hard-deletes." Today an UNMODIFIED placement is deleted outright (its bytes live in the team repo; reinstall restores them), an edited placement is quarantined (`uninstall.ts:240-241`), and a non-placement folder always goes through `moveToQuarantine()`. True in substance, false in wording.
- **Options:** A — state the three-way contract in §7.5 (fit 4) · B — quarantine every placement (fit 3; quarantine fills with bytes the repo already holds).
- **The call:** A.

### Technical
- Spec edit only, at B5's start. `src/commands/uninstall.ts:178-241` unchanged.

---

## Decision 75 — OF-12: what an interrupted `skill rename` leaves, and how recovery finds the row

**Verdict: LOCK — recovery re-points the ledger row by skill id; the fingerprint only decides local-changed** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** §7.5's recovery rule re-points a stale ledger row "when the recorded fingerprint matches what is there, dropped otherwise." Interrupted between the folder rename and the ledger re-key, the old path is gone and the new fingerprint (the frontmatter `name` changed) no longer matches, so the rule DROPS the row — the state §7.5 says must not persist.
- **Why the pick is clear:** a skill folder carries a stable `metadata.id` that survives a rename. Keyed on it, every interruption point repairs forward: folder renamed but frontmatter stale → rewrite the frontmatter; frontmatter and folder renamed but ledger stale → a ledger row whose path is missing is matched to the sibling folder whose `metadata.id` equals the row's id and re-pointed.
- **Options:** A — re-point by id (fit 4) · B — write the ledger before the rename and repair forward (fit 2; the mirror-image interruption leaves a row pointing at a path that does not exist yet).
- **The call:** A.

### Technical
- Spec edit to §7.5's recovery paragraph at B5's start; B5 implements it in `src/commands/skill.ts` with a test per interruption point.

---

## Decision 76 — OF-15: migrated receipts carry no `content_digest`; B6's install seeding is keyed on it

**Verdict: LOCK — B8 stamps `content_digest` at migrate time; B6 seeds by digest and prints a line for any receipt still lacking one** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** D11's install seeding keys the local eval store by the receipt's `content_digest`. Receipts §13 re-keys stay schema 1 and have none (`receipt.ts:73` optional; `:109` requires it only at schema 2). Nothing seeds today — B6 has not built it (grep: no seeding in `install.ts`).
- **Why the pick is clear:** migrate re-keys ONLY a receipt whose tree hash equals the skill's current tree (`teamMigrate.ts` `hashes.get(id) === hash`), so the `v1` folder's bytes are exactly what was evaluated; the digest computed from them is faithful by construction.
- **Options:** A — stamp at migrate, seed by digest (fit 4) · B — compute at seed time (fit 3; the receipt stays incomplete) · C — skip digest-less receipts (fit 2).
- **The call:** A.

### Technical
- B8: in the rekey branch, `json({ ...receipt, version: v1, version_tree: hash, content_digest: skillContentDigest(<v1 files from the tree>) })`; test asserts the stamped digest equals the digest of the migrated folder. One more commit on `refactor/b8-team-migrate`.
- B6: seed by `content_digest`; a receipt without one prints `Skipped <runId>: no content digest (pre-migration receipt).` §9.1's spec text says so at B6's start.

---

## Decision 77 — D70's gate: when the frames are re-recorded relative to B5

**Verdict: LOCK — the gate stands (re-record before B5 is handed to Codex), and the re-recording starts the moment B3's frame fixes commit, overlapping the B4 and B8 merges** (Ryan, 2026-09-13)

### Plain English
- **What's at stake:** D70 delegated the real re-recording (ten `fixture.sh` to layout 3, rebuild, re-record thirteen sets, re-pin the seven replay consumers) to its own session and gated it before B5, because B5's Library boards and tests lean on these frames hardest. That is 3–4 hours on B5's critical path on a night when everything is meant to move.
- **Options:** A — keep the gate, overlap the work with the B4/B8 rebase-CI-merge steps (which touch no frames) · B — waive; re-record after B5 merges (B5's review cannot catch a CLI-vs-screen mismatch in the Library) · C — waive for the build only; re-record before B5 merges.
- **Recommendation:** A. Most of the wait is absorbed by work that has to happen anyway, and B5's review keeps a gate that can fail.
- **The call:** A.

### Technical
- Sequence: B3 fix commit (incl. D70's nulls/labels) → confirmation pass → #183 merges; **in parallel from the nulls commit:** re-recording in a scratch worktree off B3's tip; B4/B8 rebase → CI → merge. B5's spec resolution (D73–D76) can be written meanwhile; B5 is handed to Codex only once the re-recorded frames are merged.

---

## Decision 78 — Standing authorizations for the overnight run (2026-09-13, 02:01 PDT)

**Verdict: LOCK — "everything granted, 1 through 5"** (Ryan, 2026-09-13)

Ryan's stated goal: the refactor spec fully implemented with every PR merged, targeting **09:00 America/Los_Angeles on 2026-09-13**; if implementation finishes earlier, `/hybrid-review` the most important PRs until **10:00**. Granted so Claude runs without asking:

1. **#183 merges on Claude's report of green CI + a review with zero confirmed critical/high** — D53's exclusion of #183 is lifted for this run.
2. **Rebase and force-push each child after its parent merges; retarget #184/#185 (and later PRs) to `main`; delete merged branches** in the Gotcha-10 order (retarget first). D63 made standing.
3. **Take any fork a later review or confirmation pass surfaces**, logged in the A-ledger (`2026-09-12-unapproved-autonomous-decisions.md`, continuing A16+), under the unchanged limits: **no `npm publish`, never run `team migrate` against a real repo, no direct push to `main`.**
4. **Run Codex builds for B5, B6, B9 and B7** in fresh worktrees (`npm ci` root and desktop), review each with `/hybrid-review`, fix, and merge on the D53 bar.
5. **Fidelity boards:** a new board is filed as an owed deviation in `desktop/FIDELITY.md` rather than blocking on an oracle (the design-canvas copies on this Mac are stale).

Not granted because not Ryan's to grant: the machine staying awake, Codex quota, `gh` auth. **Owed to Ryan, non-gating under grant 4:** reading A8's hand-merged `teamRepo.ts` resolution on B8 before or after #184 merges.

---
