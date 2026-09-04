# codex-spec review: 2026-09-02-phase-1-build.md

Target spec: /Users/ryanliu/Documents/Terum/skill-management-software/.planning/specs/2026-09-02-phase-1-build.md
Spec title: terum-skills — Phase 1 build spec (rev 3)
Findings were raised by **OpenAI Codex** (gpt-5.6-sol) and verified by a 2-vote Claude adversarial panel.

8 confirmed, 1 contested, 3 dropped, 0 unverified.

## Verdict

This spec is close to buildable but not yet buildable as written: the finders were **OpenAI Codex** (gpt-5.6-sol, high effort) and the verifiers were a **2-vote Claude adversarial panel**, so a reader comparing this against an `/ultraspec` run on the same spec should expect a different panel and different survival rates. Every confirmed item is a missing contract rather than a wrong design — the four blockers each let a conforming implementation do something the spec would call correct while silently losing data or consent: §8's `"async": true` hook can never deliver the `reloadSkills` directive it promises in-session; §5.3's byte-for-byte reconciliation has no persisted baseline in §5.4's `shared` map, so "source newer" vs "repo copy edited by someone else" is undecidable and a stale source can clobber newer repository content; malformed `allowed-tools` has no fail-closed rule, so an unparseable grant can be normalized to `none` and auto-placed without consent; and `team remove`'s only authorization gate is `gh api repos/{owner}/{repo}`, which does not exist for the generic-git teams §6 explicitly lets users create and join. The two gaps (global-handle collision recovery, settings-file mutation contract for hook install) are smaller but still block an implementer from writing the code without inventing policy. Note that the Claude verifiers, while confirming the substance 2-0, suggested downgrading five of these from BLOCKER to GAP — the defects are real, the severity labels are the finder's. Fixing the four blockers is a spec-text change of maybe a page: add a per-team/per-skill last-synced digest and three-way rules, make the hook sync synchronous or defer activation explicitly, define the `allowed-tools` schema plus an abort-on-malformed rule, and scope `team remove`/`invite` to GitHub with an explicit unsupported-host failure.

## Severity counts (confirmed only)

| Severity | Count |
| --- | --- |
| BLOCKER | 4 |
| DRIFT | 0 |
| AMBIGUITY | 0 |
| GAP | 2 |
| NOTE | 0 |

*8 confirmed findings consolidated into 6 items by two merges (noted inline). Contested and unverified items are excluded from this table.*

---

## Internal quality

- [ ] **BLOCKER — Async SessionStart hook cannot perform the promised same-session skill reload**
  - **Location:** §8 Session-start hook, lines 263–275
  - **Evidence:** Lines 263–273 require `"async": true` while claiming the command can return `reloadSkills: true` after placing skills so they appear in the current session. Claude Code’s official hooks documentation says an async hook “starts the hook process and immediately continues”; its output arrives on a later conversation turn, where only context or system-message output is delivered. The SessionStart reload response therefore cannot be processed before startup completes. See [Claude Code Hooks: Run hooks in the background](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background).
  - **Suggested fix:** Run the startup sync synchronously before returning `reloadSkills`, or retain async execution and explicitly defer activation until a later session/turn using a supported reload mechanism.

- [ ] **BLOCKER — Shared-source reconciliation cannot distinguish a local edit from a stale source and can overwrite newer repository content** *(merged: findings[1] internal-quality + findings[6] build-readiness — same defect, both 2-0 confirmed)*
  - **Location:** §5.3 Reconciliation contract, lines 156–161; §5.4 config schema, lines 169–170
  - **Evidence (findings[1]):** Lines 156–161 say to classify unequal trees as either “Source newer” or “Repo copy edited by someone else,” but line 170 stores only `id → local source` in `shared`. There is no last-synchronized source digest, repository tree hash, or other common baseline. In particular, a repository update made by the same author from another laptop is neither detectable as “someone else” nor distinguishable from a newer local edit, so a stale source can overwrite it.
  - **Evidence (findings[6]):** The contract says to “compare the source file tree against the repo copy byte-for-byte,” then distinguishes “Source newer” from “Repo copy edited by someone else.” But the only persisted state is `"shared": { "<id>": "<local-path>" }`; it contains no last-synced hash or baseline. An unequal byte comparison cannot determine which side changed, and the spec does not cover simultaneous changes or a repository update made by the same author from another machine.
  - **Suggested fix:** Persist a last-synchronized source/repository digest per team and skill. Perform three-way reconciliation and stop on concurrent local and repository changes rather than choosing a winner without a baseline. Define branches for local-only, remote-only, both-changed, repository-copy-missing, and rename cases; conflicts must refuse rather than overwrite either side. Add adversarial tests for every branch.
  - **Panel note:** verifiers suggested severity GAP.

- [ ] **GAP — A global immutable handle has no valid recovery from a collision in a second team**
  - **Location:** §5.4 config schema and handle contract, lines 167–179; §6 join, line 228
  - **Evidence:** Line 167 defines one global `config.handle` as “immutable once a people file exists,” while lines 179 and 228 require a live handle collision during `team join` to “re-prompt.” The spec explicitly supports several configured teams, but supplies no per-team handle field. Once a user belongs to one team, selecting a different handle for a colliding second team would violate immutability and alter their identity for the first team.
  - **Suggested fix:** Either store handles per team, or require one global handle and define a collision as an unrecoverable join error with an explicit migration/rename procedure.

## Build-readiness

- [ ] **BLOCKER — Malformed allowed-tools has no fail-closed contract**
  - **Location:** §5.4 line 181; §6 lines 235 and 242; §12 line 311
  - **Evidence:** The spec maps “absent or empty” `allowed-tools` to `none` and automatically places skills that “declare no `allowed-tools` at all.” Acceptance merely names “malformed or absent `allowed-tools`” as a test case without stating the expected result or valid field shape. An implementer could treat an unparseable value as absent and allow hook placement without consent.
  - **Suggested fix:** Define the accepted `allowed-tools` schema and normalization input. Require malformed or wrong-typed values to abort validation and placement in every mode—never hash them as `none`. State the expected test outcomes explicitly.
  - **Panel note:** verifiers suggested severity GAP.

- [ ] **BLOCKER — team remove authorization is undefined for generic-git teams** *(merged: findings[8] build-readiness + findings[5] internal-quality — same defect, both 2-0 confirmed; findings[5] additionally scopes `invite`)*
  - **Location:** §6.0 line 220; §6 lines 223–226 and 230
  - **Evidence (findings[8]):** Generic joining explicitly supports a `<remote-url>` on “any git host,” while `team remove` is “admin-only.” The only authorization contract is GitHub-specific: `gh api repos/{owner}/{repo} -q .permissions.admin`; collaborator revocation and pending-invitation cancellation are also GitHub operations. The spec gives no safe behavior when the configured team remote is GitLab, Bitbucket, Gitea, or bare SSH.
  - **Evidence (findings[5]):** Line 226 supports `team join <remote-url>` on “any git host,” but line 220 authorizes removal solely through GitHub’s `gh api repos/{owner}/{repo}` admin predicate. Line 230 then requires revoking collaborator access and cancelling invitations, also without a generic-host contract. Thus a valid non-GitHub team can be created and joined but cannot implement the in-scope `team remove` behavior.
  - **Suggested fix:** Either declare `team remove` (and `invite`) unsupported for non-GitHub remotes and fail before any mutation with defined generic-team behavior, or introduce host adapters with concrete admin checks, revocation operations, and unsupported-host failure rules. Add unauthorized, unsupported-host, and authorization-check-failure tests.
  - **Panel note:** verifiers suggested severity GAP for both source findings.

- [ ] **GAP — Session hook installation has no settings-file mutation contract**
  - **Location:** §3 line 37; §8 lines 261–275
  - **Evidence:** `hook.ts` is assigned “SessionStart hook install,” and §8 provides a literal JSON block, but never names the settings file or defines how to preserve and merge existing settings, avoid duplicate hook entries across multiple team joins, or recover from an interrupted write. The named `hook.test.ts` suite has no corresponding adversarial installation cases.
  - **Suggested fix:** Specify the exact settings path, an atomic read/validate/merge/write function, idempotency key, preservation rules for unrelated hooks/settings, malformed-file behavior, and lifecycle after leaving the last team. Add collocated tests for existing hooks, repeated installation, malformed JSON, and interrupted writes.

---

## Contested (split verdict — needs human adjudication)

- **findings[9]  (BLOCKER / build-readiness)  safeWrite exhaustion cannot leave the clone clean as specified**
  - **Location:** §6.0 lines 199–203; §12 line 307
  - **Evidence:** The algorithm resets to `origin/main`, runs the mutation, commits, and pushes. After a rejected push, the local commit remains checked out. Nevertheless, the exhaustion branch says to “leave the clone clean (it is already reset to `origin/main`)”; it is no longer reset after steps 2–4. Acceptance requires “deadline exhaustion leaves a clean clone.”
  - **Suggestion:** Add an explicit cleanup/finally step that resets HEAD/index/worktree to the freshly fetched `origin/main` and removes only operation-owned untracked artifacts before returning failure. Assert HEAD equality and clean status in the exhaustion test.
  - *Panel split — one vote from flipping. Excluded from counts and top findings.*

## Unverified (not adversarially checked)

(none)
