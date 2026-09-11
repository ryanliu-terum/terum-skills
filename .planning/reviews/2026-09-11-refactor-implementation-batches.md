# Library/Marketplace refactor — implementation batch plan (typecheck-safe)

Read-only dependency analysis of `.planning/specs/2026-09-11-library-marketplace-refactor.md` (rev 6) against
`origin/main` @ `d09d278`, produced 2026-09-11 for the per-batch Codex runs. Every batch must leave
`npm run lint && npm run typecheck && npm test` green at the root and, when `desktop/` is touched, the desktop
`typecheck && lint && test` green too. Line numbers are from the `d09d278` tree.

## 0. Two facts that shape the plan

**(a) The desktop suite does not run the CLI.** Every `desktop/src/backend/tauri/__tests__/*` test feeds hand-written
CLI JSON through `fake-bridge.ts` and fixture files into the zod mirrors. A CLI DTO change with no mirror edit is
gate-green and app-broken; a mirror edit with no fixture edit is gate-red. Mirror strictness
(`desktop/src/backend/tauri/index.ts`):

| mirror | line | tolerance | breaks when the CLI… |
|---|---|---|---|
| `cliPublish` | 51 | `.passthrough()` but `branch`/`prUrl` required-nullable | drops `prUrl`/`branch` (M2) |
| `cliSync` | 52 | plain; `placed`, `deferred` required | drops them (M7) |
| `cliStatus` | 249-273 | plain; `ledger.shared` (269) required; `policy.publish` enum (264) | drops `config.shared` or `policy.publish` |
| `cliLsSkill` | 65 | plain; `unresolved`, `latest`, `endorsement`, `installedBy` required | drops `unresolved` |
| `cliSearch` | 58 | plain; `unresolved`, `latest` required | drops `unresolved` |
| `cliLocalRow` | 69 | **`.strict()`**; `shared` required; `placement.version` = `length(40)`; `health` enum | drops `shared`/`connected`, emits `edited`, emits `v3`, adds a health value |
| `cliLocalSection` | 70 | plain; `counts:{skillFolders,connectable}` | changes `counts` |
| `cliEval` | 56 | `.passthrough()` but `commit` required-nullable | drops `commit` |
| `cliSetup` | 55 | `steps` keyed by `SETUP_STEP_KEYS` | emits a `projects` step |
| `cliLs`, `cliInstalled`, `cliProject`, `cliUninstalled`, `cliMachine` | 75, 46, 66, 47, 48 | passthrough / catchall | tolerant of additions only |

**(b) Two root-suite tripwires bind every batch:** `src/lib/__tests__/invocation-tripwire.test.ts:7-24` asserts
set-equality between every non-test `src/` line containing `terum-skills` and `src/lib/__tests__/invocation-catalog.ts`;
`src/lib/__tests__/frames.test.ts:192` + `src/__tests__/frames-cli.test.ts:67-74` assert `FRAME_VERBS` equals the
commander inventory (and `frames.test.ts:198` requires every `FRAME_FEATURES` key in a `docs/frame-protocol.md` sentence).

## 1. Batches, in order

| id | spec sections | main files | §14.1 tests | why together | size |
|---|---|---|---|---|---|
| **B1 — connect, sync, decline, receipt-check die** (M7 + §12 verb deletions) | §10; §12 (connect, `autoShareRoots`, `reconcileShared`, `config.shared` + every reader, `auto_share`, decline, `eval --commit`/eval-assets, `receiptCheck`→`receipt-store`, `sync.ts`, `auto-sync.ts`, Settings▸Sharing, `AddSkillsDialog`, `librarySize` sync site); §11.2; §11.3; §11.5 (login notice; decline's desktop decls + `FRAME_VERBS`/`cli.ts:193`; `status` pending copy; Inbox ruling); §11.6; D17 (`sync --hook` manual refresh); §6.3's "delete `--commit` end to end" + `--working`/`--save` | del `src/commands/{sync,connect,decline,receiptCheck}.ts`, `desktop/src/backend/tauri/auto-sync.ts`, `AddSkillsDialog.tsx`; new `src/commands/prune.ts`, `src/lib/evals/receipt-store.ts`; rewrite `refresh.ts`→sync (+`--hook` shim, `receipt-check` shim), `execute.ts:4,52-59`, `cli.ts`, `frames.ts`, `schema.ts:126,132`, `local-skills.ts:90,249`, `ls.ts:188,196-265`, `status.ts:37,57`, `leave.ts:28-83,118`, `uninstallMachine.ts`, `login.ts:42`, `setup.ts:31,291-304`, `eval.ts` (`--commit`/`--working`/`--save`/`commitEligibility`/`reconcileShared`), `uninstall.ts:142-143,203-208`, `install.ts` (+`approved()` from `sync.ts:631`); desktop `Backend.ts`, `types.ts:11,12,107-116,126,140`, `tauri/index.ts:43,49-56,69,269,306,440-454,640,660,666,848-856`, `invalidation.ts`, `mock/index.ts`, settings/inbox/skill/share/onboarding/marketplace screens; tests: del connect/sync/decline/receiptCheck/auto-sync tests, rewrite the importers (§3 item 10), `features.test.ts:26`, fixtures carrying `placed`/`deferred`/`ledger.shared`/`connected`; `invocation-catalog.ts` | `leave`/`uninstallMachine` pending (half) | `sync.ts:23` imports connect; `eval.ts:10,119,187,200` import/read `reconcileShared`/`config.shared`; `setup.ts:31` imports connect; `execute.ts:4` imports `SyncResult`; `leave.ts:74` uses `config.shared`; `cliSync`/`cliStatus.ledger.shared`/`cliLocalRow.shared` required. Landing M7 first dissolves §16.1's coupling (2): every `'connect'|'sync'|'eval'|'eval-assets'|'decline'` guard call site is gone before B3 rewrites `guard.ts` | XL |
| **B2 — L-PROJ config half** | §3.6; §7.1; §7.2; D13; **§9.2 (moved here from M6)**; `team project create` move | rename `checkouts.ts`→`projects.ts`, `checkout.ts`→`project.ts`; old `project.ts` creator→`team.ts`; del `discover.ts` + tests; `schema.ts:122` preprocess; `local-skills.ts:52-84`; `ls.ts:187-191`; `install.ts:5,251-258`; `publish.ts:6,42-45,229`; `setup.ts` (`discover`→`projects`, `'path'` ask); `prompt.ts`; `frames.ts:16,36,50,54`; `cli.ts:74-97`; `docs/frame-protocol.md`; desktop `types.ts:9,12,15,73-78,124`, `Backend.ts:22,24`, `tauri/index.ts:71-74,647,654,727-728`, `mock/index.ts`, `Sidebar.tsx`, `WorkflowControls.tsx`, `LibraryScreen.tsx:34-41`, `SettingsContent.tsx:33-34,83`, `setup-session.ts`, `SetupBoot.tsx` | `schema.test` (checkouts→projects); §9.2 step-order fixtures | `discover.ts:3` imports `checkouts.ts` and `setup.ts:12` imports `discoverSkillRoots` — renaming forces D13, which empties setup's `discover` step (§9.2). `install.ts:257`/`publish.ts:43` import `writableCheckout`. `FRAME_FEATURES.checkouts` ↔ desktop `FEATURE_KEYS`. After B1: `sync.ts`/`connect.ts` read `checkouts` | L |
| **B3 — layout 3 keystone: M1 + M2 + M3 (+ forced slices)** | §3.2–§3.5; §4 all; §5 all; §6 all; **§9.3 `profile-entry.ts`** (publish calls it); **§13.1(a) layout precondition + `applyReadme` never-blank**; §11.5 (`status.ts:26,113`; `cliSearch`/`SearchHit`); §8.6; §8.4's `LsSkill.latest`/`versionCount`/drop `unresolved`; forced M6 slice: install source = `v<max>`, `@version` refused, `placements[].version:'vN'`; `team.ts:362-372` post-join offer deleted with `endorsedCandidates` | new `src/lib/versions.ts`, `src/lib/profile-entry.ts`; del `version.ts`; rewrite `guard.ts`, `publish.ts`, `eval.ts`, `evalReport.ts`; modify `skills.ts`, `readme.ts`, `src/commands/readme.ts:20-26`, `search.ts`, `validate.ts`, `teamRepo.ts`, `schema.ts`, `evals/receipt.ts`, `evals/queue.ts`, `hygiene.ts`, `team.ts`, `project.ts`, `install.ts`, `ls.ts`, `status.ts`; desktop `types.ts:99,113`, `tauri/index.ts:51,56,58,65,69,207,213,264,298,853`, eval-queue files, `RunEvalDialog.tsx`, `SkillScreen.tsx`, `SettingsContent.tsx:75`, `mock/index.ts`, fixtures; tests: `fixtures.ts:72 TEAM_JSON`→layout 3, ~34 files seeding flat `skills/<name>/SKILL.md`→`v1/`, `guard.test` (61 author/connect pins) | `versions.test`; `skills.test` pins; `publish.test`; `guard.test`; `teamRepo.test` modes; `readme.test`; `schema.test`; `eval.test`; desktop eval-queue; `validate.test` | `version.ts` is imported by `eval.ts:29,105,124,229,231,472,477`, `evalReport.ts:11,33`, `install.ts:20,105,109`; `teamSchema` dropping `global`/`policy.publish` breaks `publish.ts`, `status.ts`, `eval.ts:454`, `readme.ts`, `src/commands/readme.ts`, `team.ts:527`, `guard.ts:198`; `skillVersions`' new signature is consumed at `ls.ts:87`, `eval.ts:519`; publish's attach needs schema-2 receipts (§6.1) and the content-keyed store (§6.2); the profile prompt needs `offerProfileEntry`; `cliPublish.prUrl/branch`, `cliStatus.policy.publish`, `cliLsSkill.unresolved`, `cliSearch.unresolved` required. **Only defensible split:** B3a = M1+M2 / B3b = M3 with one spec-external shim (eval's candidate resolved to `<clone>/skills/<name>/v<max>/`, no `content_digest`) — prefer whole | XL |
| **B4 — M5 marketplace** | §8.1–§8.5 rest; §7.4's `SkillCard` field additions (first consumer); §11.4 marketplace side | `receipt-store.ts` (+`selectCardEval`), `ls.ts:49,65,81,125`; desktop `types.ts:33`, `tauri/index.ts:65,194,328,766-808`, `presentation.ts`, `SkillCard.tsx/.css`, `skill-card-actions.ts:20-40`, `MarketplaceScreen.tsx:95`, `market-data.ts`; tests `ls-receipt.test`, desktop `index.test` (two children), `marketplace.test`, `skill-card-actions.test`, `market-data.test` | `ls-receipt.test`; desktop two-children gate | Needs B3's `listVersions`/`v<N>` receipts; shares `ls.ts` and `tauri/index.ts` with B3/B5 | L |
| **B5 — M4 library** | §7.3; §7.4 (D16 filters, `edited`, neutrals, empty state); §7.5 (D6 `skill move/rename/delete`, D18); §11.4 library side | new `src/commands/skill.ts` + test; `local-skills.ts:152,159`, `ls.ts:48,192-195,212-225,266`, `placer.ts`, `frames.ts:36`, `cli.ts`; desktop `tauri/index.ts:104,123,129,137-162,286,600-660,688,711`, `types.ts:71,79`, `Backend.ts`, `mock/index.ts`, `LibraryScreen.tsx:43`, `SkillScreen.tsx:63,87,130-132`, three dialogs; tests `local-skills.test`, `ls.test`, desktop `index.test` (four cards), library/skill-detail tests, `e2e/routes/card-click.spec.ts:91` | `skill.test` matrix; D16 four-cards | Needs B2 (`config.projects` roots) and B3 (`evals/local/<digest>`, `placements[].version`); `cliLocalRow` is strict so `edited`/narrowed `health` land with the CLI change | L/XL |
| **B6 — M6 install rest** | §9.1; §9.1.1; §13's `pending` self-drain; PR #167 picker lift | `install.ts:131-142,247-258`, `placer.ts:29,194`, `uninstall.ts:197-210` (`writePersonFile`), `profile.ts:19-34`; desktop `install-destinations.ts` (+test) from `origin/feat/bulk-install-destination`, install dialog copy; tests `install.test`, `uninstall.test`, `profile.test`, pending | `install.test` (D12/D11/old-skills/exclude); pending | Needs B2, B3 | M |
| **B7 — manual + docs** | §11.1; final `docs/frame-protocol.md` pass | `.claude/skills/terum-skills/SKILL.md`, `invocation-catalog.ts`, `src/__tests__/bundle.test.ts:62`, `frames.test.ts:198` | — | Must describe the final verb surface (`project`, `prune`, `skill move`) — exists only after B5 | S |
| **B8 — §13 migration verb** | §13 steps 1-5, `team migrate`, `anyLayoutTeamSchema` caller #2, re-arm (§4.3) | `team.ts` (+`migrate`), `cli.ts`, migration test | migration test | Needs B3's row j / `anyLayoutTeamSchema` / D7 archive path. CLI-only. **Built here; run only after the release containing B1 has propagated (§16.1)** | M |

Desktop gates run for B1–B6. Fidelity boards: B1 renames `SettingsSharing`→`SettingsPublishing` (`boards.ts:513-514`) and, with the Inbox ruling, drops `InboxUpdate` (`boards.ts:258-259`, pin 91→90); B2 adds the projects onboarding board (+1, `in-progress`, FIDELITY deviation for `design.json`); B4 adds the stale-eval marketplace board (+1); B5 adds Library deviation notes. e2e routes: `card-click.spec.ts:91` (`dialog=move`, B5) and `setup-evals.spec.ts:12` (Connect dialog, B1) change.

## 2. Why each batch compiles

- **B1.** Every importer of the deleted files is edited in-batch (`cli.ts:3,13,18,31`, `execute.ts:4`, `eval.ts:10-11`, `evalReport.ts:12`, `ls.ts:16`, `setup.ts:31`, the seven test importers). `receiptFiles`/`newestReceiptAt` move to `receipt-store.ts` first (§12). Guard rows for the deleted actions are left in `guard.ts` with zero callers until B3 rewrites the file — dead rows, not a second active path. `endorsedCandidates` survives B1 (`team.ts:366`) until B3. Shims, both spec-mandated (§12): `sync --hook` and the hidden `receipt-check` no-op.
- **B2.** All `checkouts.ts` importers edited; `Config.checkouts`→`projects` under a preprocess; `SETUP_STEP_KEYS`/`Step` rename is a loud typecheck on both sides. No shim.
- **B3.** Compiles only whole (evidence in the table); `versions.ts` imports nothing so `desktop/src/backend/tauri/__tests__/cli-tree-imports.test.ts` admits the cross-tree import the way `session.ts:3` imports `serve-verbs.js`.
- **B4/B5/B6.** Additive over B3's vocabulary; each edits the mirror + fixtures it changes. **B7/B8.** Docs and a new verb.

## 3. Couplings §16.1 does not state (file:line at d09d278)

1. `sync.ts:19,502` imports `endorsedCandidates` (deleted in M1) — a second M1↔M7 coupling.
2. `sync.ts:22,282,428` imports `materializeVersion`.
3. `install.ts:20,105,109`, `eval.ts:29,105,124,229,231,472,477`, `evalReport.ts:11,33` import `resolveVersion`/`materializeVersion` — deleting `version.ts` pulls M3 and M6 work into M1's batch.
4. `teamRepo.ts:347` `skillVersions` rewrite → `ls.ts:87`, `eval.ts:519`.
5. `teamSchema` drops `global`/`policy.publish` → `publish.ts:64,75,87,110,125`, `status.ts:27,116`, `uninstall.ts:142,203`, `eval.ts:454`, `receiptCheck.ts:49-52`, `src/commands/readme.ts:25-26`, `readme.ts:27,62,160,189`, `team.ts:527`, `guard.ts:196-198`.
6. `layout_version` literal → `team.ts:527`, `src/lib/__tests__/fixtures.ts:72 TEAM_JSON`, 12 test files with `layout_version`, ~34 files seeding flat `skills/<name>/SKILL.md`.
7. `eval.ts:10` imports `reconcileShared`; `eval.ts:119,187,200` read `config.shared`; `--working`/`--save` (`eval.ts:43,46`, `cli.ts:157`) are named nowhere in the spec.
8. `setup.ts:31` imports `connect` for the `actions` step (`:291-295`); `SetupBoot.tsx:10`; `setup-session.ts:15`; `e2e/routes/setup-evals.spec.ts:12`.
9. `src/lib/execute.ts:4,52-59` imports `SyncResult` and special-cases hook results.
10. `teamRepo.test.ts:11`, `install.test.ts:11`, `uninstall.test.ts:10`, `m2-walkthrough:5-6`, `m3-*walkthrough:5-6`, `invocation-hints.test.ts:19-20`, `cli.test.ts:8` import `connect`/`sync`.
11. `discover.ts:3` imports `checkouts.ts`; `setup.ts:12` imports `discoverSkillRoots`; `checkout.ts:10` too.
12. `install.ts:5,251-258`, `publish.ts:6,43` import `writableCheckout`/`registerCheckout`.
13. Desktop `features.test.ts:26` pins `['connect']`,`['sync']`,`['sync','--auto',…]` spawns; `cliSync`, `cliStatus.ledger.shared` required.
14. `cliPublish.branch/prUrl`, `cliLsSkill.unresolved`, `cliSearch.unresolved` required; `cliLocalRow` strict; `cliEval.commit` required.
15. `receiptSchema.version` union (M1) ↔ publish attach (M2) ↔ schema-2 receipt (M3).
16. `profile-entry.ts` (§9.3, M6) is called by publish (§5.2, M2).
17. `team.ts:19,362-372` post-join offer uses `installOne`/`resolveDestination`/`endorsedCandidates`.
18. Invocation tripwire and `FRAME_VERBS` inventory tests — B1, B2, B5, B7, B8 each edit them.
19. `cli-tree-imports.test.ts` admits cross-tree imports only from leaf modules — `versions.ts` must stay import-free.
20. §13.1(a)'s layout precondition + `applyReadme` invariant are prerequisites of the first layout-3 CLI (B3), not of §13 (B8).

## 4. Unplaced or contradictory in the spec (for the spec's next revision)

a. §16.1's M1 → M2 → M3 order cannot be executed as three green batches (see B3).
b. "M7 SAME COMMIT AS M2 or before" is satisfiable only as "before" once (a) is accepted.
c. Setup's `actions` step has no body after `connect` dies (`setup.ts:291-295`, `SetupVerbs.connect`, `offerConnect`, `setup.test.ts:125-135`, `SetupBoot.tsx:10`); §9.2 keeps it in the thirteen-step list.
d. `src/commands/readme.ts --pr-comment` (`:20-26`) reads `before.global`/`current.global` and is the committed Action's fourth job (`team.ts:620`); no section names it.
e. §13's release gating vs the committed Action: from the release containing B3 until each team runs `team migrate`, every team repo's `readme` job is red — the spec calls it migration debt but never states the red-CI window.
f. "M4 library needs M1's SkillCard fields" — no M1 section defines any; §7.4 adds them, §8.1 reads them.
g. `unresolved` is deleted in three places with three owners (§4.1, §8.4, §11.5).
h. The Inbox ruling (§11.5) is explicitly undecided; `InboxScreen.tsx:18-49`, `settings-data.ts:7`, the `InboxUpdate` board and the 91-pin depend on it.
i. `desktop/src/fixtures/schema.ts:64` requires `TEAM_POLICY.publish` in `design.json` (byte-locked by `export:check`) while §11.5 deletes `policy.publish` and its three projections.
j. Whether `team migrate`, `prune` and `skill *` are `FRAME_VERBS` entries is unstated; the inventory test forces the decision.
k. Eval queue guards `expectedVersion`/`skipReceipted` (`eval.ts:33-36`) are keyed on the tree hash; §6.6 re-keys the item on `contentHash` but does not say what these become.
l. "M5 parallel with M2" is impractical on one branch (both edit `ls.ts`, `tauri/index.ts`, `index.test` fixtures); B4 follows B3.
