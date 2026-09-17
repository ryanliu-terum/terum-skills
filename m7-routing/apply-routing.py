#!/usr/bin/env python3
"""Apply the blank-map routing (section 10 of the M7 document) to merged-batches.json:
row moves, new rows, new batches S7ad/S7ae, dependency edits, statuses, and the desktop-first priority order.
Writes routed-batches.json (full) and batches-slim-routed.json (queue args). Audits: every row id placed exactly once."""
import json, sys
from pathlib import Path
HERE = Path(__file__).parent
m = json.loads((HERE / 'merged-batches.json').read_text())
B = {b['id']: b for b in m['batches']}

def move(row, src, dst):
    assert row in B[src]['rows'], (row, src)
    B[src]['rows'].remove(row); B[dst]['rows'].append(row)
def add(batch, *rows):
    for r in rows:
        assert all(r not in b['rows'] for b in B.values()), f'{r} already placed'
        B[batch]['rows'].append(r)

# --- moves (10.1) ---
move('RM-22', 'S7d', 'S7k')      # frame-mode form is a status payload; narrowed to presence
move('RM-10', 'S7d', 'S7f')      # its only consumer is ls's version loop (BM-08 is its call site)
move('RM-01', 'S7p', 'S7f')      # delivery is body?: string on LsSkill
move('RM-07', 'S7j', 'S7k')      # CLI export superseded by BM-09; S7k carries the consumer note
# --- new rows (10.2 / 10.3) ---
add('S7f', 'BM-01', 'BM-04', 'BM-08')
add('S7k', 'BM-02', 'BM-03', 'BM-09', 'BM-10')
add('S7d', 'BM-06', 'BM-07')
add('S7i', 'BM-05')
# --- new batches ---
B['S7ad'] = { 'id': 'S7ad', 'title': 'app.json: the launch PATH (BM-11) and the join target (BM-12, gated on D-BM-3)', 'rows': ['BM-11', 'BM-12'], 'dependsOn': [],
  'approver': 'Ryan (phase-1 spec §4.2; the app verb is his decision walk D1)', 'size': 'S', 'status': 'OPEN; BM-12 gated on D-BM-3; the CLI half is inert until the adapter track adds path/target to bridge.ts:13 and cli_spawn sets PATH',
  'cliChanges': 'src/commands/app.ts:58 AppState gains path: string | null and target?: string; :134 writes them; AppArgs gains path/target knobs; src/commands/setup.ts:111 passes target. One §4.2 paragraph adds run/app.json to the local-state tree (undocumented since PR #58) with the consume-once rule (writtenAt).',
  'appHalf': 'EXCLUDED from M7 (adapter track): bridge.ts:13 appStateSchema gains path/target and makes writtenAt required; cli_spawn sets command.env("PATH", ...); the onboarding route consumes target once per writtenAt (CP-21 slot in S7r).',
  'tests': 'src/commands/__tests__/app.test.ts (extend the pinned block at :83-103); src/commands/__tests__/setup.test.ts (target reaches verbs.app).', 'verification': [] }
B['S7ae'] = { 'id': 'S7ae', 'title': 'RM-17 producer: progress frames on sync (MEDIUM, gated on D-BM-1)', 'rows': ['RM-17-producer'], 'dependsOn': ['S7j'],
  'approver': 'Ryan (docs/frame-protocol.md:18 and phase-1 §3 Prompter enumeration :53/:60; a waiver of bar condition (5))', 'size': 'S', 'status': 'DEFERRED until Teddy decides D-BM-1 (B = build it as a MEDIUM; then change this status to OPEN); the consumer stays app-only in S7r keyed on frames arriving',
  'cliChanges': 'src/lib/prompt.ts:25 optional progress?(step, current?, total?); src/lib/frames.ts:163 frame implementation beside print (ProgressFrame at :23); src/commands/sync.ts four call sites (after :131, after :147, inside :310 with index+1 of candidates.length, after :348); flip FRAME_FEATURES.progress (frames.ts:41) and rewrite the all-false invariant at src/lib/__tests__/frames.test.ts:31; terminalPrompter unchanged. Cancellation is CLOSED (frames.ts:126, drive.ts:14, cli_kill).',
  'appHalf': 'S7r: drive.ts:7-12 renders progress frames when they arrive and nothing when they do not; OnboardingParts.tsx:26 stops filling the bar from design constants.',
  'tests': 'src/lib/__tests__/frames.test.ts (progress frame shape; the feature map assertion), src/commands/__tests__/sync.test.ts (four phases in order, none in --hook mode), src/__tests__/frames-cli.test.ts.', 'verification': [] }
# --- dependency edits ---
B['S7p']['dependsOn'] = sorted(set(B['S7p']['dependsOn']) | {'S7f'})   # RM-13 derives from RM-01's body
B['S7h']['dependsOn'] = sorted(set(B['S7h']['dependsOn']) | {'S7b'})   # verifier: PF-03 role lands first
add('S7r', 'RM-06')   # re-opened: app-side over BM-09's ledger
B['S7r']['dependsOn'] = sorted(set(B['S7r']['dependsOn']) | {'S7k'})
# --- statuses / notes ---
B['S7ac']['status'] = 'DONE: the app verb shipped as c487048 and PR #58; BM-12 (S7ad) is its named residue'
B['S7f']['title'] = 'ls / search skill payload: per-row degradation, one git child per listing, description, grants, installers, last-changed, SKILL.md body, projects, declined'
B['S7k']['title'] = 'status read model: pending, syncedAt, policy, categories, clone path, join block, machine ledger, identity, tool presence'
B['S7d']['title'] = 'frames channel correctness: typed decline, a result frame on usage errors, --safe argv scans'
B['S7c']['title'] = 'config.json team label and login --set (the identity WRITE half; the read half is BM-10 in S7k)'
B['S7n']['title'] = 'The receipt reader and the §12 UI contract (IB-02 keeps its eval half here; its ls input is BM-04 in S7f)'
B['S7q']['title'] = 'The nine rows with no CLI code: frontend-spec records and the flag wiring (RM-27 is satisfied by RM-22 tools in S7k)'
B['S7r']['title'] = 'App-only: chrome, the preference store, the adapter rules the mock already carries, and the RM-17 consumer'
B['S7j']['title'] = 'sync propagation: per-team outcome, --team, missing clone, complete Results (RM-18 minus its item (a), built once under RM-31)'
# order within S7f: RM-49 first (rewrite), then RM-10/BM-08 (one git child), then the keys
B['S7f']['rows'] = ['RM-49', 'RM-10', 'BM-08', 'RM-30', 'RM-02', 'RM-03', 'RM-38', 'RM-01', 'BM-01', 'BM-04']
B['S7k']['rows'] = ['RM-41', 'RM-48', 'RM-S1', 'TJ-12', 'BM-02', 'BM-03', 'BM-09', 'BM-10', 'RM-22', 'RM-07']
B['S7d']['rows'] = ['RM-09', 'CP-35', 'BM-06', 'BM-07']

# ===== 2026-09-08 ~17:40 UTC: Teddy's decisions and the connected-surfaces amendment (section 10.8) =====
# Rule (Teddy): "The real app should only be showing real data. If the inbox does not work it should not be there,
# visible just yet." and "Once it is covered by M7 implemented, they should show, since they should be connected."
# So every batch ships its app half in the same PR, and the adapter track's basic set folds into M7 as AD- rows.
AD = {
 'AD-01': "carry `value` beside `error` on an ok:false result frame (`desktop/src/backend/tauri/run.ts:72-74`); `status` fails-with-value when any team is unreadable (`status.ts:100`), so without this every status payload row lights only on healthy clones",
 'AD-02': "the query lifecycle (report step 2): `providers.tsx:11` policy, `({signal})` on every read, no refetch storm on minimise/restore (measured +1 fetch per key per cycle; Settings, Teams = 10 node processes and 15 git children at N=3); a stale board is a previously true board and must not be presented as current",
 'AD-03': "the served-surfaces declaration and the real-data rule: the adapter declares which read models it serves (a `surfaces` block beside `Capabilities`, `desktop/src/backend/types.ts:8`); `Sidebar.tsx:14` omits a nav group whose model is a gap (Inbox first) and `Shell.tsx:15` already queries capabilities; the mock declares every surface so the 87 locked boards do not move; delete the four hard-coded sidebar `COUNTS` literals (`InboxScreen.tsx:67`, `ShareScreen.tsx:32`, `LibraryScreen.tsx:18`, `MarketplaceScreen.tsx:66`) so a count comes only from `status` or is omitted (`Sidebar.tsx:8` draws the span only when present)",
 'AD-04': "report bug 12: `read()` (`tauri/index.ts:47-53`) collects print frames and appends them to a failing `Result.error`, as `run.ts:57` already does for stderr",
 'AD-05': "report bug 15: one `useEffect` in `providers.tsx` does `backend.subscribe(source => queryClient.invalidateQueries(...))` so `ChangeSource` (`tauri/index.ts:39-44,91`) has a consumer and counts refresh after install, uninstall and sync",
 'AD-06': "report bug 3 and step 5: pass `--team` on every verb, `ref` becomes `<team>/<name>` from a search hit, optional `team` on `ValidateArgs` / `InviteArgs` / `EvalArgs` (`tauri/index.ts:70,72,75,79,82,83,100`); no CLI change",
 'AD-07': "report bug 4: `cliConnect.optional()` (`tauri/index.ts:22,75`); bare `connect` legitimately succeeds with no value",
 'AD-08': "report bug 9: drop publish's `?? 'main'` third arm and carry `changed` (`tauri/index.ts:76`) so a no-op publish never reads as a real one",
 'AD-09': "report bug 11: `(args.ref || args.cwd)` for validate (`tauri/index.ts:83`); today `{ref:'', cwd}` sends `['validate','']` and emits 47 findings over `.git/**`",
 'AD-10': "report step 7: widen the `SearchHit` mapping (`team`, `category`, `author`, `installs`, `latest`, `endorsed`, `unresolved`; `description:''` until RM-30) and stop rendering the author's email in the results row",
 'AD-11': "report bug 5 (Rust): hold and `join()` the two reader `JoinHandle`s before emitting `Exit` (`src-tauri/src/lib.rs:59,69,76-87`); `run.ts:48` stops dropping events after the first settle; `bridge.ts:31` stops calling `unlisten()` on the exit event",
 'AD-12': "report bug 6 (Rust): `cli_kill` (`lib.rs:100-108`) uses a bounded poll after closing stdin, then kills the process group, so cancel no longer orphans a `git clone`",
 'AD-13': "report bug 7 (Rust): a small child queue with a 'too many pending' error (`lib.rs:15`); pairs with BM-08's one git child per listing",
 'AD-14': "report bug 2: key the install argv off `kind` using `ref` (`tauri/index.ts:72`; `MarketplaceScreen.tsx:37` sends `{ref, kind}`) so member and project installs stop building a bare skill install",
 'AD-15': "report bug 8: parse `executionStatus` (`eval.ts:53,256`) and translate `failed` into ok:false or carry it on the seam (`tauri/index.ts:82`); a failed or partial eval must never report success",
 'AD-16': "report bug 10: install / uninstall-skill map `name`, not `item.id`, into the DTO's `name` (`tauri/index.ts:72,73`), and the unit test stops feeding `{id:'deploy-check'}`; BM-05's app half",
 'AD-17': "report bug 13's adapter half: every argv builder orders verb, flags, `--`, positionals (`tauri/index.ts:70-83,96-103`); safe once BM-06 and BM-07 land in the same PR",
 'AD-18': "report bug 14: a truncated `app.json` surfaces the `NO_STATE` guidance, not a raw `SyntaxError` (`bridge.ts:45-46`), and `tauri/index.ts:37-38` stops memoising the failure for the whole session",
 'AD-19': "report bug 1's adapter half (BM-11 / BM-12): `bridge.ts:13` accepts `path` and `target` with `writtenAt` required; `cli_spawn` sets `command.env(\"PATH\", ...)` (`lib.rs:48`); the onboarding route's consume-once rule is S7r's",
 'AD-20': "report step 1: implement `backend.status()` from `status` (`teams[0].{team,handle,repository,members[].displayName,memberCount,sharedSkills}`, `version`), `ls --local` (`counts.Global`) and `host_platform()` (`machine.os`); omit `counts.Pushes/Updates/Alerts` and every project key until real; `gh_login`/`me.email`/`clone`/`last_sync`/`stamp` empty until their rows land; flips the status surface",
 'AD-21': "report step 3: implement `backend.library({scope})` from `ls`, `ls project <name>`, `ls --local` (`installed`) and `status` (`origin`) with the pixel-neutral screen half; honest defaults (`desc:''` until RM-30, `size:'—'`, `tokensK:0`, `wlt:null`, `summary:null`, `favorite:false`); flips the Library surface",
 'AD-22': "report step 4: implement `backend.skill({ref})` from `ls` + `ls --local` + `status` + `validate` (bare pass/fail); never default `favorites`, `lines`, `files`, `grants`, per-check hygiene rows or any synthesized receipt; `receipt:null` lands the evals tab on the drawn 'No receipt yet' board; flips the Skill detail surface",
 'AD-23': "report step 10's adapter half: map `placement {id,team,version}`, `shared {id,team}`, `tracked`, `health` from `ls --local` rows into Settings, This machine and into `installed`/`version` for steps 3 and 4 (no regex over prose)",
 'AD-24': "report step 12: implement `backend.settings()` from `ls --local` + `status` + board constants with the honest defaults (`PLACEMENTS[].state`/`placed` '—', `APPROVALS []`, `QUARANTINE []`, `CLI_LATEST '—'`, `HOOK.installed false`); stop folding `catalog()` into settings; flips the Settings surface",
 'AD-25': "report step 13: implement `backend.roster()` from `status` members (+ PF-03 role, PF-04 projects when this batch lands); `joined`/`lastSeen` '—' until PF-06 exists; flips the Share surface",
 'AD-26': "report step 13: implement `backend.catalog()` from `ls` + `ls member <handle>` + `ls --local` + `status` (Top rated, People, Categories; `projects:[]` until BM-01, `bulkInstall:{}`); flips the Marketplace surface",
}
B['S7af'] = { 'id': 'S7af', 'title': 'Adapter plumbing and the real-data rule (app-only): value beside error, query lifecycle, served surfaces, print frames, change notifier, argv team, four adapter one-liners', 'rows': ['AD-01','AD-02','AD-03','AD-04','AD-05','AD-06','AD-07','AD-08','AD-09','AD-10'], 'dependsOn': [],
  'approver': 'Ryan (desktop/AGENTS.md invariants; he wrote M5/M6)', 'size': 'M', 'status': 'OPEN (Teddy 2026-09-08: connected surfaces); FIRST in the queue; every batch with an app half stacks on it',
  'cliChanges': 'NONE', 'appHalf': 'desktop/src/backend/tauri/{run,index,bridge}.ts, desktop/src/backend/types.ts (surfaces beside Capabilities), desktop/src/backend/mock (declares every surface), desktop/src/components/domain/Sidebar.tsx:14, desktop/src/app/providers.tsx, the four COUNTS literals. Pixel-neutral on the mock: 87 locked boards unchanged.',
  'tests': 'desktop *.test.ts(x) beside each file (run.test.ts, index.test.ts, mock.test.ts strict toEqual at mock.test.ts:30 changes for surfaces, a Sidebar test that a gap model hides its group and the mock shows all); npx playwright test e2e/routes; fidelity 87/87.', 'verification': [] }
B['S7ag'] = { 'id': 'S7ag', 'title': 'Rust child lifecycle (app-only, src-tauri): join readers before Exit, a real cancel path, a child cap', 'rows': ['AD-11','AD-12','AD-13'], 'dependsOn': [],
  'approver': 'Ryan (src-tauri is his; cargo check only on this box, no .app from Linux)', 'size': 'M', 'status': 'OPEN (Teddy 2026-09-08: connected surfaces); second in the queue; S7ad stacks on it (both edit lib.rs)',
  'cliChanges': 'NONE', 'appHalf': 'desktop/src-tauri/src/lib.rs:15,48,59,69,76-108; desktop/src/backend/tauri/run.ts:48,57 and bridge.ts:31 for the settle/unlisten half. Gate: cargo check per .planning/research/2026-09-07-desktop-app-tauri-build.md (the env.sh recipe), plus the desktop battery for the TS half.',
  'tests': 'run.test.ts (events after the first settle are kept; exit after result), a Rust unit test for the queue cap if the crate has a test target, otherwise cargo check and a NOTES.md line saying the lifecycle was not reproduced on this box (no packaged app).', 'verification': [] }
ATTACH = {'S7f': ['AD-21','AD-22'], 'S7g': ['AD-23'], 'S7k': ['AD-20','AD-24'], 'S7d': ['AD-17'], 'S7ad': ['AD-19','AD-18'], 'S7i': ['AD-14','AD-16'], 'S7m': ['AD-15'], 'S7b': ['AD-25','AD-26']}
for bid, rows in ATTACH.items(): add(bid, *rows)
for b in B.values():
    b['adapterHalf'] = [f'{r}: {AD[r]}' for r in b['rows'] if r in AD]
for bid, b in B.items():
    if bid in ('S7af', 'S7ag', 'S7a', 'S7ac'): continue
    b['dependsOn'] = sorted(set(b['dependsOn']) | {'S7af'})
B['S7ad']['dependsOn'] = sorted(set(B['S7ad']['dependsOn']) | {'S7ag'})
B['S7f']['appHalf'] = (B['S7f'].get('appHalf') or '') + ' CONNECTED (10.8): AD-21 and AD-22 land in this PR; the Library and Skill detail surfaces flip to served; undelivered fields are null, never a design constant.'
B['S7k']['appHalf'] = (B['S7k'].get('appHalf') or '') + ' CONNECTED (10.8): AD-20 and AD-24 land in this PR; status and Settings flip to served.'
# Teddy's answers (in-thread, 2026-09-08 ~17:25 UTC); see decision-ledger-2026-09-08.md
NOTES = {
 'S7ae': ('OPEN (D-BM-1 = B, Teddy 2026-09-08): build the progress-frame producer as a MEDIUM; Ryan waives bar condition (5) per docs/frame-protocol.md:63; the consumer stays app-only in S7r keyed on frames arriving', 'D-BM-1 = B: ship the producer; the PR body names the waiver of condition (5).'),
 'S7k': (None, 'D-BM-2 = A: tools = presence only (git --version / gh --version exit codes, offline); no gh auth status, no claude. D-BM-5 = A: one PR of all rows. AD-01 (S7af) is the prerequisite for every payload row to light on an unhealthy clone.'),
 'S7ad': ('OPEN (D-BM-3 = A, Teddy 2026-09-08); stacks on S7ag (lib.rs) and S7af', "D-BM-3 = A with Teddy's rider: the join target is whatever the invite's generated wizard command already carries; a joiner never types or chooses the team and no new prompt asks for it. BM-12 lands with BM-11 now; AD-19 and AD-18 are the adapter half in the same PR."),
 'S7f': (None, 'D-BM-4 = A: declined rides ls member <handle> (member?: { handle, declined } on LsResult), not the default ls. Connected: AD-21/AD-22 in this PR.'),
 'S7g': (None, 'D-BM-6 = A: RM-44 ships the subset (placement {id, team, version}, shared {id, team}[]); the sharedState producer / reconcileShared refactor is a later Ryan PR only if the Sharing state chip must light.'),
 'S7n': (None, 'D-BM-7 = A: the receipt verb ships --runs (three lines over the same listing); EV-16 becomes display-permission only.'),
 'S7o': (None, 'A1 (Teddy 2026-09-08): keep CP-30; --project is a note-composer that chooses what the invitee is TOLD (remote + install line), never what the invitation authorises; TJ-01 stays dropped.'),
 'S7y': (None, 'A2 (Teddy 2026-09-08): proceed, but confirm against a real team.json that project keys are capitalised before the PR is sent; if the live keys are lowercase, S7y is moot.'),
 'S7z': ('MOOT: Teddy relabelled the New skill CTA to Connect (A3, 2026-09-08); RM-37 needs no `new` verb. The relabel is a canvas change for the design walk.', 'A3 = relabel. No CLI work.'),
 'S7p': (None, 'A4 (Teddy 2026-09-08): RM-13 is derived, the first paragraph of the SKILL.md body with description as fallback; no new frontmatter field, no schema change.'),
 'S7t': ("GATED: PF-02 needs Teddy's written yes (A5, 2026-09-08 = hold); open as a draft PR that says so in its first line", "A5: PF-02 stays GATED; the Follow tooltip's Inbox promise is held until IB-01 exists."),
 'S7ab': (None, 'A6 (Teddy 2026-09-08): interim accepted: a read-only role chip from ls --host with an explicit unknown state and no chevron if Ryan declines the fourth guard arm; the discipline label (PF-03) and the permission role never share a word in the UI.'),
 'S7b': (None, "A8 (Teddy 2026-09-08): CP-19's three refused strings stay design-side; the hello-frame verbs/features inventory gate ships here (CP-19 moved from the retired S7a). Connected: AD-25/AD-26 in this PR."),
}
for bid, (status, note) in NOTES.items():
    if status: B[bid]['status'] = status
    B[bid]['decisionNotes'] = note
move('CP-19', 'S7a', 'S7b')   # S7a is MOOT; the M7 document pins CP-19 to the batch that edits FRAME_VERBS / FRAME_FEATURES
(HERE / 'ad-rows.md').write_text('\n'.join(f'- **{k}.** {v}' for k, v in AD.items()) + '\n')
# --- priority order (10.4) ---
ORDER = ['S7af', 'S7ag', 'S7f', 'S7g', 'S7ad', 'S7k', 'S7d', 'S7c', 'S7b', 'S7e', 'S7h', 'S7i', 'S7j', 'S7ae', 'S7l', 'S7m', 'S7n', 'S7o', 'S7p', 'S7q', 'S7r', 'S7s', 'S7t', 'S7u', 'S7v', 'S7w', 'S7x', 'S7y', 'S7aa', 'S7ab', 'S7z', 'S7a', 'S7ac']  # 10.8 order: plumbing and Rust first
assert set(ORDER) == set(B), (set(ORDER) ^ set(B))
batches = [B[i] for i in ORDER]
# --- audits ---
seen = {}
for b in batches:
    for r in b['rows']:
        assert r not in seen, f'{r} placed twice: {seen[r]} and {b["id"]}'
        seen[r] = b['id']
for i, b in enumerate(batches):
    for d in b['dependsOn']:
        assert d in B, f'{b["id"]} depends on unknown {d}'
        assert ORDER.index(d) < i or d in ('S7a',), f'{b["id"]} listed before its dependency {d}'
required = list(AD) + ['RM-30','RM-44','RM-39','RM-40','RM-48','RM-S1','RM-22','RM-08','MC-10','MC-11','RM-01','RM-02','RM-03','EV-07','EV-13','RM-49','RM-38','IB-02','TJ-04','TJ-05','PF-03','PF-04','RM-32','RM-31','RM-17'] + [f'BM-{n:02d}' for n in range(1, 13)]
missing = [r for r in required if r not in seen]
assert not missing, missing
m['batches'] = batches
(HERE / 'routed-batches.json').write_text(json.dumps(m, indent=1))
slim = [{'id': b['id'], 'title': b['title'][:120], 'rows': b['rows'], 'dependsOn': b['dependsOn'], 'approver': (b.get('approver') or '')[:60], 'size': b.get('size'), 'status': b.get('status', ''), 'appHalf': (b.get('appHalf') or '')[:3200], 'adapterHalf': b.get('adapterHalf', []), 'decisionNotes': b.get('decisionNotes', '')} for b in batches]
(HERE / 'batches-slim-routed.json').write_text(json.dumps(slim, separators=(',', ':')))
print(f'{len(batches)} batches, {len(seen)} rows placed once each; all {len(required)} demand-list rows placed')
for b in batches: print(f"  {b['id']:5} dep={b['dependsOn']} rows={b['rows']}{'  [' + b['status'][:28] + ']' if b.get('status') else ''}")
