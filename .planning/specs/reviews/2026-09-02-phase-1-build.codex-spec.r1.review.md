# codex-spec review: 2026-09-02-phase-1-build.md

Target spec: /Users/ryanliu/Documents/Terum/skill-management-software/.planning/specs/2026-09-02-phase-1-build.md
Spec title: terum-skills — Phase 1 build spec
Findings were raised by **OpenAI Codex** (gpt-5.6-sol) and verified by a 2-vote Claude adversarial panel.

13 confirmed, 3 contested, 4 dropped, 3 unverified.

## Verdict

This spec is not build-ready. The finders were OpenAI Codex (gpt-5.6-sol) and the verifiers were a 2-vote Claude adversarial panel — a different panel composition than an `/ultraspec` run on the same spec, so severities and survival rates are not directly comparable. Of 13 confirmed findings, two describe the same defect and are merged here, leaving 12 write-ups: 7 BLOCKER, 1 DRIFT, 1 AMBIGUITY, 3 GAP. The dominant failure is cross-spec drift — the sibling `/Users/ryanliu/Documents/Terum/skill-management-software/.planning/specs/2026-09-01-team-skill-sharing.md` still carries DECIDED text for the superseded per-person-folder content model, folder-derived install scope, and free cross-agent materialization, so an implementer reading the DECIDED sibling would build the model the target explicitly replaced. The remaining blockers are self-inflicted: membership is defined by a file the create/remove flows never maintain, the project-placement collision check queries global scope while placing project-locally, non-interactive `sync --hook` cannot honor the mandatory `allowed-tools` y/N gate, and the virgin-machine acceptance (`npx -y terum-skills@latest install terum/<skill>`) has no way to resolve the abbreviated team name to a repository. Three of the seven blockers are safety-relevant (unconsented tool grants, unconsented startup hook in the contested set, ownership-guard identity), so they should be closed before any code lands. Note that the verifier panel proposed softer severities for six confirmed items; those suggestions are recorded inline but counts below use the finder's severity.

## Severity counts (confirmed only)

| Severity | Count |
| --- | --- |
| BLOCKER | 7 |
| DRIFT | 1 |
| AMBIGUITY | 1 |
| GAP | 3 |
| NOTE | 0 |
| **Total** | **12** |

Counts exclude the 3 contested and 3 unverified findings listed at the end. Total is 12 rather than 13 because findings[10] and findings[17] were merged into a single write-up.

## Cross-spec drift

- [ ] **BLOCKER — STALE ECHO — sibling still declares the superseded per-person-folder content model** *(verifier panel suggested DRIFT; 2-0 confirm)*
  - Location: Target §1 line 8 and §4.1 lines 56–64
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:8` says: “Flat skill store with ID references — skills live once under `skills/`; per-person installs, team endorsement, and project assignment are lists of skill IDs, not folder positions or copies.” Lines 56–64 show `skills/` plus individual `people/<handle>.json` files. Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:25` still says: “A profile is one person's folder in that repo,” and line 36 marks “The monorepo with per-person folders is the content model” as DECIDED.
  - Fix: Replace the sibling’s three-sentence model and D2 with the flat skill store plus per-member JSON-file model already recorded in its revised §3.3.

- [ ] **BLOCKER — STALE ECHO — project/global install scope still follows the removed folder layout** *(verifier panel suggested DRIFT; 2-0 confirm)*
  - Location: Target §6 line 180 and §13 line 235
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:180` says: “Personal (non-endorsed) skills place globally; project-list skills place into the matching repo,” and line 235 specifies “no `--project` on install in v1.” Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:100` instead says: “Scope follows the skill's folder … and `install` outside that repo says so and offers `--global` to override.” Folder-derived scope no longer exists in the flat store, and the target defines no per-install override.
  - Fix: Rewrite sibling §3.4 line 100 to match D17 and the target: scope comes from endorsement/project ID lists, personal skills are global, and v1 has no install-time scope override.

- [ ] **BLOCKER — STALE ECHO — sibling promises cross-agent placement while the target deliberately targets Claude Code only** *(verifier panel suggested DRIFT; 2-0 confirm)*
  - Location: Target §6 line 180 and §7 line 187
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:180` requires every placement to pass “`-a claude-code`” specifically because omitting it installs to every detected agent; line 187 repeats the Claude-only command. Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:112` marks as DECIDED: “Cross-agent materialization (Codex, Cursor, ~75 others) comes free via the borrowed Vercel `skills` CLI.”
  - Fix: Resolve the product contract before implementation: either add an explicit agent-selection/cross-agent design to the target, or revise D18 to state that Phase 1 targets Claude Code only.

- [ ] **DRIFT — STALE ECHO — sibling header still says the build spec has not been written** *(verifier panel suggested NOTE; 2-0 confirm)*
  - Location: Target header line 3
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:3` is marked “BUILD-READY (rev 2, 2026-09-03).” Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:3` still says: “Phase-1 build spec still to be written.”
  - Fix: Update the sibling header to reference the existing build-ready Phase 1 spec and its current revision date.

## Spec-vs-code reality

No findings in this dimension survived verification.

## Internal quality

- [ ] **BLOCKER — Team creation and removal contradict the membership invariant** *(verifier panel suggested GAP; 2-0 confirm)*
  - Location: §4.1 lines 71–73; §6 lines 173 and 176
  - Evidence: Line 71 defines membership as: “you are a member iff `people/<handle>.json` exists.” But line 173 creates a team with an empty `people/` directory, leaving the creator outside that definition, while line 176 says removal leaves “their `people/` file” intact, leaving removed users inside it.
  - Fix: Create the owner’s profile during `team create`. On removal, either move/delete the active profile while retaining history elsewhere, or redefine membership using an explicit active/archived predicate consistently throughout the spec.

- [ ] **BLOCKER — Project-placement collision check inspects the wrong scope** *(2-0 confirm)*
  - Location: §6 line 180; §7 line 187
  - Evidence: Line 180 claims `npx skills list --json -g` prevents “an existing same-named skill” from being overwritten. But the same requirement places project skills locally, and line 187 confirms project placement runs “without `-g`.” A global listing therefore cannot detect a colliding project-local skill.
  - Fix: Check the actual destination scope through the Placer before every placement, including both project-local target paths, and define a non-destructive collision outcome.

- [ ] **AMBIGUITY — Project-skill uninstall and declined behavior conflict** *(verifier panel concurred AMBIGUITY; 2-0 confirm)*
  - Location: §5.2 line 129; §6 lines 181–182
  - Evidence: Line 181 says uninstalling any “team-endorsed skill” records it in `declined` so sync never re-offers it. Line 182 consults `declined` only for new global IDs, while project-list skills “auto-place” in matching repos without a stated declined check. A project uninstall can therefore mean either a persistent opt-out or an immediate reinstall on the next sync.
  - Fix: Define separate global-decline and project-placement policy semantics, then state explicitly whether users may opt out of project skills and how uninstall behaves when policy still assigns one.

- [ ] **GAP — Non-GitHub teams can be created but have no join contract** *(verifier panel concurred GAP; 2-0 confirm)*
  - Location: §6 lines 173–174; §9 line 207
  - Evidence: Line 173 explicitly supports an existing remote as a “non-GitHub path,” and line 207 supplies non-GitHub README regeneration. However, the only join form is `team join <org>/<repo>` and its entire flow is defined through GitHub invitations and `gh` (line 174); no remote-URL join form or non-GitHub access flow is specified.
  - Fix: Either remove non-GitHub support from Phase 1 or define `team join <remote-url>` plus credential, invitation/access-error, and config-normalization behavior for generic Git remotes. (See also the unverified findings[22], which independently reports the missing non-GitHub join command contract.)

- [ ] **GAP — Join has no defined source or validation for the member handle** *(verifier panel concurred GAP; 2-0 confirm)*
  - Location: §5.4 lines 153–159; §6 lines 172–174
  - Evidence: Config requires a `handle` (line 155), and join must create `people/<handle>.json` (line 174), but login only says it collects “name/email” (line 172). The spec supplies no handle prompt, flag, derivation, validation, existing-file collision behavior, or relationship between this handle and the GitHub handle passed to `invite`.
  - Fix: Define identity bootstrap before cloning/writing: handle source, allowed syntax, normalization, uniqueness check, collision recovery, and whether it must equal the GitHub login.

## Build-readiness

- [ ] **BLOCKER — Non-interactive sync has no fail-closed contract for new or expanded tool grants** *(merged: findings[17] build-readiness + findings[10] internal-quality "Noninteractive project sync cannot satisfy required tool-grant consent"; both 2-0 confirm, verifier suggested AMBIGUITY for the internal-quality twin)*
  - Location: §6 lines 180–182; §8 lines 191–201 (merged twin: §6 lines 180 and 182; §8 line 201)
  - Evidence (findings[17]): Installation says “any `allowed-tools` grant is printed and requires y/N.” Sync re-places changed unpinned installs, project-list skills auto-place, and “allowed-tools still gates.” But `sync --hook` is non-interactive, and its stdout must be exactly the reload directive or nothing. No schema records which grant set or content version the user approved. The spec therefore leaves implementers to decide whether an updated skill that adds privileges is installed silently, skipped, or prompts from an asynchronous hook.
  - Evidence (merged findings[10]): Line 180 requires that “any `allowed-tools` grant is printed and requires y/N” before placement. Line 182 simultaneously makes `--hook` noninteractive while saying project-list skills “auto-place” and “allowed-tools still gates.” Line 201 restricts hook output to exactly the reload directive when placement occurs. The spec never says whether such a skill is skipped, placed without consent, or somehow prompts during an asynchronous hook.
  - Fix: Require hook sync to fail closed for every unapproved or expanded grant. Persist consent keyed by skill ID plus normalized grant set or full tree hash, invalidate it when grants expand, and defer placement to interactive sync with a safe notification mechanism. Add tests for a previously approved skill whose next version adds or changes `allowed-tools`. (From the merged twin: specify that hook mode never places or updates a skill with a new or changed grant; persist approval against the skill ID/version and normalized grant set, then announce that interactive `sync` is required.)

- [ ] **BLOCKER — The virgin-machine install acceptance cannot resolve a team repository** *(verifier panel suggested GAP; 2-0 confirm)*
  - Location: §6 lines 166, 180; §11 line 222
  - Evidence: Refs are defined as `<team>/<name>`, and install merely “resolves ref→ID,” yet M4 requires `npx -y terum-skills@latest install terum/<skill>` to work “on a machine that has never seen the tool.” Such a machine has no config entry or clone mapping `terum` to a remote. The parent spec at `.planning/specs/2026-09-01-team-skill-sharing.md:97-99` says this path joins the team first, but neither document defines how the abbreviated team name discovers `<org>/<repo>` without a registry.
  - Fix: Define a self-resolving reference containing the repository URL or host/org/repo, or specify a deterministic repository naming/discovery rule. Then document the bootstrap sequence through identity collection, invitation acceptance, clone/join, ref resolution, placement, and install recording.

- [ ] **GAP — Shared-source reconciliation is undefined after managed frontmatter injection** *(verifier panel concurred GAP; 2-0 confirm)*
  - Location: §5.3 line 149; §5.4 line 158; §6 line 177
  - Evidence: The spec says `share` “injects `license`, `metadata.id`, and `metadata.author`,” copies the skill into the repository, records the original path in `config.shared`, and later `sync` “diffs each `shared` source against the repo copy.” It does not say whether injection edits the user's source or only the repository copy. If only the copy is changed, a raw diff is permanently unequal and may remove managed identity fields; if the source is changed, the command mutates user-owned input without a stated contract.
  - Fix: Name a reconciliation function and define its inputs: render a normalized repository copy from the source while preserving the existing UUID/owner and reinjecting managed fields, then diff rendered output. Specify source rename, missing source, local managed-field edits, and deletion behavior.

## Contested (split verdict — needs human adjudication)

These were one vote from flipping and are excluded from counts and top findings.

- **BLOCKER / cross-spec drift — STALE ECHO — sibling still installs the startup hook without the target’s consent gate** (findings[2])
  - Location: Target §6 line 173 and §8 line 191
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:173` says team creation “offers the hook,” while line 191 requires: “Installed only after y/N at create/join.” Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:47` says team creation “installs a session-start pull hook.” Implementing that DECIDED sibling text literally installs an executable startup hook without the required confirmation.
  - Suggestion: Change D6 to say create/join offer the hardened `sync --hook` SessionStart hook and install it only after explicit y/N consent.

- **BLOCKER / internal quality — Five retries cannot guarantee the eight-writer acceptance condition** (findings[11])
  - Location: §6.0 line 170; §12 line 226
  - Evidence: `safeWrite()` stops after “max 5” push-rejection retries (line 170), while acceptance requires “eight clones … concurrently — all writes land” (line 226). With eight writers fetching the same head, an adversarial valid schedule can make the last writer lose seven successive compare-and-push races, so jitter does not guarantee the stated outcome.
  - Suggestion: Use retry-until-deadline with a fresh fetch/rebase each time, or otherwise serialize writes. Make exhaustion behavior explicit and test a synchronized worst-case collision schedule rather than relying on favorable jitter.

- **DRIFT / cross-spec drift — STALE ECHO — evaluation text assigns frontmatter injection to `publish` and retains the removed “promotion” lifecycle** (findings[5])
  - Location: Target §1 line 10 and §5.3 line 149
  - Evidence: Target `.planning/specs/2026-09-02-phase-1-build.md:10` says “`share` puts a skill into your authorship,” “`publish` is … endorsing,” and “Promote no longer exists”; line 149 says “`share` injects `license`, `metadata.id`, and `metadata.author`.” Sibling `.planning/specs/2026-09-01-team-skill-sharing.md:141` instead says “`publish` emits `metadata.author` and a license,” while lines 146 and 186 still call the review path “promotion PRs.”
  - Suggestion: State that `share` injects the required metadata, reserve `publish` for endorsement-list changes, and rename “promotion PRs” to “publish PRs.”

## Unverified (not adversarially checked)

These exceeded the verify cap and were never adversarially checked. They are excluded from counts and top findings; treat as unconfirmed leads.

- **GAP / build-readiness — Install and uninstall have no transaction boundary between placement and shared tracking** (findings[20])
  - Location: §6 lines 180–182
  - Evidence: Install performs placement and then “Records `{id, version, scope}` in `people/<you>.json`, one safeWrite”; uninstall combines “Placer remove ... + people-file update”; sync combines pulls, repository writes, and placements. The spec does not define ordering, rollback, or reconciliation when placement succeeds but the push fails, or when the tracking write lands but placement fails. Either order can leave an untracked installed skill or a false installed record.
  - Suggestion: Define command-level transaction semantics and failure recovery, such as preflight followed by placement plus compensating rollback, or a durable pending operation reconciled by sync. Cover placer failure, push rejection/exhaustion, process interruption, and retry-after-partial-success.

- **GAP / build-readiness — The test plan violates the mandated layout and omits adversarial contracts** (findings[21])
  - Location: §3 line 38; §12 line 226
  - Evidence: The planned layout is `test/`, and acceptance only says “unit for schema/guard/version/readme; E2E + concurrency against local bare-repo fixtures.” The repository audit contract requires “Vitest + adversarial test inputs + collocated `__tests__`” (`.claude/workflows/ultraspec.js:242-247`). No collocated test files are named, no adversarial inputs or expected failure behavior are specified, and core modules such as `teamRepo`, `auth`, `placer`, `hook`, and command flows are omitted from the unit list.
  - Suggestion: Replace `test/` with named collocated suites such as `src/lib/__tests__/guard.test.ts` and `src/commands/__tests__/install.test.ts`. Enumerate adversarial cases for identity spoofing, pre/post-image ownership, malformed schemas, remote near-matches, concurrent same-file writers, retry exhaustion, privilege expansion, partial placement, and interrupted operations; retain bare-repo E2E fixtures for integration coverage.

- **GAP / build-readiness — The non-GitHub join path has no command or remote-resolution contract** (findings[22]; overlaps confirmed findings[12])
  - Location: §3 line 22; §6 lines 173–174
  - Evidence: The spec supports `team create --remote` as a “non-GitHub path,” but the only join syntax is `team join <org>/<repo>`, and its behavior is entirely framed around GitHub invitations and `gh`. Without `gh`, it must “check invitation state first and print the accept URL” without naming an API, credential source, or even how a non-GitHub remote is represented. An engineer cannot implement joining the non-GitHub team created by the preceding command from this contract.
  - Suggestion: Define separate GitHub and generic-git join inputs and flows, including accepted remote URL forms, host detection, credential behavior, invitation handling where supported, clone destination naming, and errors. If generic-host join is not Phase 1, remove the non-GitHub claim from scope and acceptance-facing behavior.
