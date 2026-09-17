# M7 decision ledger (Teddy, 2026-09-08 ~17:25 UTC, in-thread)

Answers as given, with the recorded consequence. Applied to routed-batches.json / batches-slim-routed.json as `status` changes and `decisionNotes`.

| id | answer | consequence recorded |
|---|---|---|
| D-BM-1 | B | S7ae status OPEN (MEDIUM, dep S7j); progress-frame producer ships; Ryan waives bar condition (5), PR body names it |
| D-BM-2 | A | S7k: `tools` = presence only from `--version` exit codes; offline; no `gh auth status`, no `claude` |
| D-BM-3 | A + rider | S7ad: BM-12 lands with BM-11. Rider: the join target is whatever the invite's generated wizard command already carries; a joiner never types or chooses the team; no new prompt |
| D-BM-4 | A | S7f: `declined` on `ls member <handle>` (`member?: { handle, declined }` on `LsResult`) |
| D-BM-5 | A | S7k: one PR, ten rows |
| D-BM-6 | A ("I think") | S7g: RM-44 subset only; `sharedState` refactor is a later Ryan PR if the Sharing chip must light |
| D-BM-7 | A | S7n: `receipt` ships `--runs`; EV-16 becomes display-permission only |
| A1 CP-30/TJ-01 | keep | S7o: `--project` stays as a note-composer; TJ-01 stays dropped |
| A2 RM-15 | "that is fine" | S7y: proceed; confirm real team.json key casing before the PR is sent; lowercase keys make S7y moot |
| A3 RM-37 | relabel | S7z status MOOT (no `new` verb); the CTA relabel to Connect goes to the design walk |
| A4 RM-13 | derive | S7p: first paragraph of the SKILL.md body, description as fallback; no schema change |
| A5 PF-02 | hold | S7t: PF-02 stays GATED (draft PR) until a written yes; Follow tooltip's Inbox promise held until IB-01 exists. Teddy asked how the Inbox works today (answered in-thread) |
| A6 TJ-02 | sure | S7ab: interim accepted (read-only chip from `ls --host`, explicit unknown, no chevron); the two "roles" never share a word |
| A7 S7ac | good | nothing to do; `app` verb is the answer |
| A8 CP-19 | yes | the three refused strings stay design-side; the inventory gate ships in S7b (CP-19 moved from the retired S7a) |

Ryan's fork (S7ad PR body): recorded launch PATH (BM-11) vs resolving a login-shell PATH at spawn time in Rust.

## Product rule added in-thread (Teddy, 2026-09-08 ~17:40 UTC)

"The real app should only be showing real data. If the inbox does not work it should not be there, visible just yet." Recorded as the first item of the shell-hygiene track and as a bullet in routing section 10.5: hide any nav surface whose read model is a gap on the real adapter (Inbox first); the mock keeps every surface so the fidelity lock holds; a surface returns when the adapter track maps its model.

## Connected surfaces (Teddy, 2026-09-08 ~17:45 UTC)

"Once it is covered by M7 implemented, they should show, since they should be connected." Applied: every batch ships its app half (adapter mapping, mock, served-surface flip) in the same PR; two app-only batches S7af (adapter plumbing + real-data rule, AD-01..10) and S7ag (Rust child lifecycle, AD-11..13) go first; the review's basic set and bugs become AD rows on the batch that completes each surface; every batch stacks on S7af. Routing section 10.8; 10.5 bullets 1-2 superseded. Queue simulated clean (30 run, 3 skipped, 2 drafts).

## Merging and delivery (Teddy, 2026-09-08 ~17:55 UTC)

"Don't care about ryan. You can merge." Applied to the queue: each implementer merges its own PR (merge commit) after its gates and the PR's CI checks are green; drafts (S7t, S7ab) are never merged; no direct pushes to main. Verified: main has no branch protection; teniroo has push (not admin). Delivery without Ryan: a version bump on main plus a dry-run dispatch of release.yml builds the desktop bundles (macOS, Windows ARM) and packs the npm tarball as workflow artifacts; the real npm publish needs the `npm` environment's only reviewer, ryanliu-terum. The `app` verb installs only from a GitHub Release; a manually placed bundle at ~/.terum/skills/app/<version>/ with installed.json skips the download (app.ts:96).

## Finish and launch (2026-09-08 ~18:30 UTC)

Teddy: "finish up the M7 and move to implementation." The workflow synthesizer re-lettered the verified batches twice (S7b for the ls payload, S7d for status) even when pinned, so its batch table was discarded and the document was generated deterministically by build-m7-doc.py from routed-batches.json, the critic's verdict and refutations, and routing section 10 (95k words; 33 batch sections; 62/62 SIMPLE CLI rows placed). Critic verdict: QUALIFIED (bulk confirmed, greyed controls contradicted). Three technical calls taken by Claude and recorded on their batches: names beside counts on sync (S7j), the project heart as a derived chip (S7t), CP-D1 closed by merits (S7c). Queue launched ~18:13 UTC; the S7af implementer failed at spawn (transient, no reason recorded; a probe of the same text spawned fine), which would have cascaded to every dependent, so the queue was stopped, S7ag's empty worktree removed, a three-attempt spawn retry added, and the queue relaunched ~18:25 UTC: 30 batches, S7af and S7ag first, max 2 in flight, implementers merge their own PRs after green CI, drafts for S7t and S7ab.
