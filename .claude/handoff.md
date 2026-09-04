# Handoff

## Objective
Get `.planning/specs/2026-09-02-phase-1-build.md` (the terum-skills phase-1 build spec) certified build-ready via cross-model audit, with its sibling ledger `.planning/specs/2026-09-01-team-skill-sharing.md` kept in sync. The audit method is `/codex-spec`: OpenAI Codex finds defects across four dimensions (cross-spec drift, spec-vs-code reality, internal quality, build-readiness), then a 2-vote Claude panel adversarially verifies each finding. Acceptance: a re-audit of the revised spec comes back with no confirmed findings beyond notes; then M1 implementation can start.

## Approach
Rev 2 was audited (20 raw findings → 12 confirmed, 5 contested, 3 dropped), every finding was resolved into rev 3 through a decision walk with Ajay rather than autonomous fixes, and a re-audit of rev 3 was launched to certify the result. Key architectural choices already settled in rev 3 — do NOT relitigate these, they were explicit user decisions on 2026-09-03:

- **safeWrite = re-apply model**, not rebase: reset clone to `origin/main` → re-run a *pure* `mutate` → regenerate derived files → commit → push; retry whole loop max 5 with jitter. One-time values (UUIDs, prompts) minted by the caller before the loop. Marked `[default — veto cheap]`.
- **Consent contract**: `config.json` stores an `approvals` map (hash of normalized `allowed-tools`); sync never re-places on a stale approval; `--hook` mode announces, never places.
- **`share` mutates the source SKILL.md** (injects id/author/license into the user's own file) so sync diffs are raw byte compares and the skill survives config loss.
- **Three-part self-locating refs** `<org>/<repo>/<skill>` auto-join on fresh machines (this is what makes the M4 one-command exit reachable).
- **Departures archive, never delete**: membership = people file exists AND handle not in `team.json archived`.
- **Handles**: GitHub login as default, prompt to override, join-time collision check.
- **Teddy's onboarding doc** (`/Users/ajaywadhwani/Downloads/phase-1-onboarding-optimized.md`) adjudicated by Ajay: web UI stays OUT of phase 1; join offers install-all but `allowed-tools` skills always prompt individually; **PAT auth retired — gh-only**; hook consent prompt defaults to Y. Four of its features remain unadjudicated (listed in spec §13): terminal backfill, invite-from-repo, org-write-base-permission invite skip, Slack webhook.

The verify pipeline deliberately keeps finding evidence OUT of the orchestrating agent's context: the index passed to the verify workflow carries only `{i, dimension, severity, title}` (built with `jq`), and the report is extracted from the workflow result with `jq`, never retyped — models normalize curly quotes when copying, and evidence must match the spec byte-for-byte.

## Progress
DONE (committed on `main`):
- `285f389` — spec rev 3 + ledger sync + the rev-2 audit report (`.planning/specs/reviews/2026-09-02-phase-1-build.codex-spec.review.md`).
- `9d60f66` — the seven `/codex-spec` workflow files ported from Terum-MVP into `.claude/workflows/` (they didn't exist in this repo; that was the first run's failure). One adaptation: `codex-spec-find-rules.md`'s routing table now matches this repo (root README, no per-directory CLAUDE.md files).
- Codex CLI upgraded v0.142.2 → v0.153.0 via `codex update` (v0.142.2 gets a 400 from the API for `gpt-5.6-sol`; the error hides past the finder's 400-char stderr truncation).

IN-FLIGHT: **the rev-3 re-audit finder COMPLETED** (exit 0, 03:21 UTC): 20 raw findings from 12/12 reviewers in 508s — severity `{"BLOCKER":10,"DRIFT":3,"AMBIGUITY":1,"GAP":6}`; all 9 reality reviewers clean, drift 4 raw (down from rev-2's 8), quality 7, readiness 9. Findings at `/private/tmp/claude-501/-Users-ajaywadhwani-terum-skills/f22cf930-c131-4f31-8757-83a68e9066fe/scratchpad/codex-spec-rev3/findings.json`; run log at `…/tasks/bs2psewj8.output` (same session dir). **The verify panel COMPLETED** (03:42 UTC, 41 agents, 0 errors): 13 confirmed → **10 distinct after merging three duplicate pairs (5 BLOCKER, 1 DRIFT, 4 GAP)**, 3 contested, 4 dropped, 0 unverified. Report written to `.planning/specs/reviews/2026-09-02-phase-1-build.codex-spec.review.md` and committed as `1a5fd75` (rev-2 version preserved at `285f389`). Full result JSON: `…/tasks/wr8lys1kk.output`. The confirmed set means **rev 3 is NOT build-ready yet**. The 5 confirmed BLOCKERs: (1) rejoin's archived-removal write is forbidden by the guard's own path whitelist (§6.0 permits team.json only on publish/remove/leave — join is excluded); (2) install's collision pre-check is global-only (`skills list -g`) so project-local placements have no overwrite protection; (3) member removal has no authorization contract (who may remove whom); (4) symlink/path-traversal handling has no privacy predicate; (5) README generation is assigned to two contradictory write paths (§6.0 re-apply model vs §9 Action-on-main vs laptop fallback). The DRIFT is a one-line fix (§4.2 tree comment still says "remotes+tokens" after the PAT retirement — a rev-3 miss). The 4 GAPs: source-map recovery can't actually discover source folders (the §4.2 recovery sentence added in rev 3 overpromises), malformed allowed-tools validation unspecified (fail-open risk), no team-selection rule when multiple teams are configured, install/uninstall sequencing across placement + repo state undefined. Contested (1-1, need Ajay): archived-handle reclamation without identity proof; two sibling stale-echo candidates (profile/membership summary wording; cross-agent placement promise vs Claude-Code-only target).

## Dead Ends
- Running `codex-spec-find.mjs` before porting the workflow files → MODULE_NOT_FOUND (they lived only in `~/Terum-MVP/.claude/workflows/`). Fixed by the port; don't hunt elsewhere.
- Codex v0.142.2 with `gpt-5.6-sol` → HTTP 400 "requires a newer version of Codex", surfaced only as the banner in truncated stderr. Already fixed by upgrade; if a future run fails with a bare banner, reproduce manually to see the real error.

## Key Files
- `.planning/specs/2026-09-02-phase-1-build.md` — the spec, rev 3. §6.0 (safeWrite), §6 command bullets, §5.4 (config schema), §8 (hook), §13 (decision record incl. the four unadjudicated Teddy features) absorbed the biggest edits.
- `.planning/specs/2026-09-01-team-skill-sharing.md` — decision ledger, synced; header says build spec is authoritative where they disagree.
- `.planning/specs/reviews/2026-09-02-phase-1-build.codex-spec.review.md` — rev-2 audit report. The `.codex-spec.` infix is deliberate (must not collide with `/ultraspec` reports). Its severity table shows `GAP 0*` with a footnote — a quirk of the generated report, not an error to fix. If the re-audit report is written to the same path, the rev-2 version survives in git at `285f389`.
- `.claude/workflows/codex-spec-find.mjs` + `codex-spec-verify.js` + rules/schemas — the audit tooling. **Flags are space-separated only**; `--effort=high` is silently ignored (`argv.indexOf` exact-token match).
- `.claude/skills/codex-spec/SKILL.md` — the full runbook (Step 2 coverage check, Step 3 verify-args contract, Step 4 report rules).

## Current State
**Baseline:** branch `main` @ HEAD `1a5fd75`, snapshot 2026-09-03 03:37 UTC.

Tree clean (the rev-3 audit report is committed as `1a5fd75`; the rev-2 version survives at `285f389`). A `git pull` at the snapshot found the remote already up to date. Two pre-existing untracked items deliberately left alone (not this session's work — do not commit or delete): `skills/` (contains a codex-spec SKILL.md copy) and the `.claude/skills` symlink → `../skills`. Nothing is pushed; both commits exist only locally as of the snapshot.

## Gotchas
- **The background finder does not survive a session reset as a notification** — but it writes to disk regardless. Check `…/scratchpad/codex-spec-rev3/findings.json` (path above): if present with a final summary in the task output, the finder finished; if absent or the output shows fewer than 12 reviewer lines + no "wrote …findings.json" line, treat the run as dead and re-run (from repo root): `node .claude/workflows/codex-spec-find.mjs .planning/specs/2026-09-02-phase-1-build.md --out <dir>` in background (~7–10 min). Never treat a partial run as a clean result — a missing dimension reads as a clean spec.
- **Verify-args contract:** build the workflow `index` with `jq` from `findings.json` carrying ONLY `i/dimension/severity/title`; never pass `evidence`/`suggestion` inline (quote normalization corrupts evidence). Extract `reportMarkdown` from the workflow result file with `jq -r`, never by retyping.
- A non-zero finder exit means NO findings.json was written — do not launch the verify workflow (it only checks the arg is non-empty, not that the file exists).
- Raw Codex severity counts overstate: rev-2's 13 raw BLOCKERs became 9 confirmed. The readiness rise (6→9 raw) is unverified — likely finer probing of the rewritten §6.0/consent text, but could be real gaps my edits opened. Verify before alarming anyone.
- The nine decisions from this session live only in the spec files — NOT recorded in Terum's shared record. Ajay was offered this and hasn't confirmed; `record_decision` requires explicit in-session confirmation, never call it unprompted.
- Verification tasks V2, V4, V5, V6 (spec §10) are scheduled before/during M1 — build-time de-risking, not spec blockers.

## Next Step
The audit cycle is COMPLETE (finder + verify both done; results in Progress). What remains:

1. Classify the 10 confirmed findings mechanical vs open-decision (the pattern from the rev-2 round). Likely mechanical: the tokens-comment DRIFT, the rejoin guard-path fix, README write-path reconciliation (pick one owner per remote type and say so in both §6.0 and §9), collision check per-scope, the recovery-claim softening. Likely needing Ajay: member-removal authorization (who may remove whom — admin-only? anyone?), the symlink/traversal privacy predicate's strictness, team-selection UX (flag? prompt? per-repo default?), and the contested archived-handle reclamation question.
2. Walk Ajay through the open ones (AskUserQuestion, recommended option first), then apply all fixes to the spec as rev 4; sync the sibling if touched.
3. Commit rev 4 (the rev-3 report is already committed as `1a5fd75`).
4. Optionally re-run the audit loop on rev 4 (`node .claude/workflows/codex-spec-find.mjs …` background, then the verify workflow) — third round; drift/reality have been clean twice, so `--dims quality,readiness` is a defensible narrowing if cost matters.
5. Pending user calls to surface when natural: push the commits; record the decisions in Terum; adjudicate the four remaining Teddy features (backfill matters before M2 since it touches `share`).
