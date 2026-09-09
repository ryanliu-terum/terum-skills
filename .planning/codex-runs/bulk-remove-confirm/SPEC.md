# Bulk remove on Marketplace project/person pages — converged implementation spec

Base: `origin/fix/installed-state` (#82, `d997b90`), which is not rebased on #81 (`1dc393a`); the branch for this work stacks on #82 after #82 is rebased on main so `detail` on asks and `AskOptions` exist. Line numbers below: `M` = `desktop/src/screens/marketplace/MarketplaceScreen.tsx` on #82; `U` = `src/commands/uninstall.ts`; `T` = `desktop/src/backend/tauri/index.ts` on #82; `S` = `desktop/src/screens/skill/SkillScreen.tsx`.

## 0. Reviewer rulings (ACCEPT / REBUT, with file:line)

| # | Amendment | Ruling | Evidence |
|---|---|---|---|
| 1 | `declined` is conditional, not "every endorsed id" | ACCEPT | `U:105` guards with `!installed.some(entry => entry.id === target.id)`; `uninstall.test.ts:178` "never declines a skill still installed globally". Disclosure copy fixed below. No separate decline flag: build spec `:203` "no separate per-project decline". |
| 2 | Test-contract contradiction; correct shape is one bulk run whose ask the provider renders | ACCEPT | `providers.tsx:26` queues `onUnexpected` questions; `:35` renders `question.detail` in `DialogDescription` with Yes/No. `drive.ts:5-17` routes unmatched asks there. Scripted pre-answer at `M:38` is dropped. `S:41` pre-answers `Remove ${ref}?` which no CLI path asks today (`cli.ts:132` → `U:18-60`, no `io.confirm`); once the CLI asks, a pre-answer keyed on `ref` and a drawn title keyed on `s.name` can diverge and the drawn body cannot carry the CLI's scope detail. ACCEPT: the single-skill path also goes run-first (see §3.4) — with one fork for Ryan on the fidelity board. |
| 3 | Person page: `Person.skills` is authored; #82 counts `installable` but removes filtered `p.skills` | ACCEPT | `ls.ts:90,95` (`skills: authored`); `T:351-353` (`names = authored…`, `skills: names`); `T:358-360` (`installable` from `member.installed`); `M:35` (`total = p?.installable.length`) vs `M:36` (`names = p?.skills`) vs `M:38` (filter by `placed`). Member verb: `U:31-33` reads H's file and iterates `member.installed`; `U:142` unions the caller's ledger scopes; `U:93` writes the caller's file. Remove acts on the member's installed set; the count and copy derive from `installable`; own handle = "everything you installed". |
| 4 | Cancel surfaces as a network error; partial failure; no notify on failure | ACCEPT | `M:66` `if (!result.ok) setActionError(result.error)` with no `cancelled` check; `M:69` renders any error as "Couldn't reach the team repo"; `M:38` stops at first `!ok` with earlier removals committed; `T:210` `else if (result.ok) notify(...touches)`. `Result.cancelled` exists (`types.ts:2`), `driveRun` returns it (`drive.ts:16`), `SetupBoot.tsx:19` already branches on it. |
| 5 | Project scope is cross-checkout; detail must name scopes/checkouts | ACCEPT | `U:85` matches `(id, team, sameScope)` with no cwd/destination predicate; `uninstall.test.ts:202` "removes every project placement for a skill installed in two checkouts". Detail lists paths, not names. |
| 6 | Confirm in `run()` only; replay stays prompt-free; non-TTY fails closed; spec :413 is an amendment | ACCEPT | `sync.ts:167` → `uninstallOne` → `U:114` `uninstallMany`, never `run()`; `sync.ts:108` hook prompter returns `false` for confirm but the replay path never asks. `prompt.ts:79` throws `PromptClosedError('not-interactive')`. Spec `:413` has no confirm requirement; `:414` calls machine uninstall "confirmed". Sentence in §5. |
| 7a | `placer.remove :137-140` does not read the ledger | ACCEPT | It checks `isSkillsRoot(root)` and `dirname(destination) === root`; `removePlacements` (`U:122-138`) is what supplies ledger keys. Diagnosis wording corrected. |
| 7b | "exactly N pushes" overstates | ACCEPT | `teamRepo.ts:139` returns `changed: false` when `tree.changedPaths.length === 0`. Wording: up to one people-file transaction per loop item. |
| 7c | "not placed N times" is conditional | ACCEPT | `U:78` returns `[]` for an empty target set; `U:86` prints only per target with no matching placement. |
| 7d | `T:152` project `installed` is scope-blind | ACCEPT, in scope for the desktop half | `T:152` `rows.every(row => inventoryCard(...).placed)`; `T:65` `placed = placements.length > 0` (any scope). A project with only global copies shows the trash; with the project verb the CLI removes nothing there but `U:105` can still write `declined` for ids with no install record. Fix the predicate (§3.2) so the trash means "this project's placements exist". |
| 7e | Authored-source protection is not categorical (connect adoption) | ACCEPT as a separate bug, out of scope here | #82 `connect.ts:190-198` records `current.shared[existing.id] = { source, team, baseline }` without touching `placements[source]`. Bug note in §6. |

Nothing rebutted outright. One item is narrowed: for SkillScreen (2) the drawn dialog is canvas-locked (`SkillDetailRemove`), so the run-first shape needs a fidelity decision — recorded as a fork, with a recommendation.

## 1. Behaviour (plain English)

- The trash on a project page asks one question: "Remove <project>'s N skills from this machine?" The body lists every folder that will go (path + scope), every install record that will be dropped, and which ids will stop being offered by sync until reinstalled. No / Escape leaves everything untouched and shows no error. Yes runs the CLI's existing `uninstall-skill project <name>`: one people-file write.
- The trash on a person page does the same through `uninstall-skill member <handle>`, acting on that member's current installed list (the inverse of the page's Install button). On your own page the title reads "Remove everything you installed (N skills)?".
- The question is asked by the CLI, once, before any write. The app renders that question through its existing prompt dialog; it never pre-answers it.
- A terminal user gets the same question (`[y/N]`, detail printed first). A piped, non-interactive `uninstall-skill` fails closed with the existing `PromptClosedError` instead of removing anything. Pending replay on `sync` and `sync --hook` never asks.

## 2. CLI half (`src/`)

### 2.1 `src/commands/uninstall.ts`

Add a preview + confirm inside `run()` (`U:18-60`), before each `uninstallMany` call at `U:34`, `U:48`, `U:58`. `uninstallMany`, `uninstallOne`, `removePlacements` unchanged (replay stays prompt-free).

```
// after targets are computed, before uninstallMany
const preview = await previewUninstall(store, team, targets);            // pure read
if (!preview.placements.length && !preview.records.length) return success([]);  // no-op: no question, no write (mirrors U:78)
const question = kindOf(args) === 'project' ? `Remove ${project}'s ${preview.ids.length} skills from this machine?`
               : kindOf(args) === 'member'  ? (handle === ownHandle ? `Remove everything you installed (${n} skills)?` : `Remove ${handle}'s ${n} skills from this machine?`)
               : `Remove ${record.name}?`;
if (!(await io.confirm(question, { detail: preview.lines }))) return cancelled('Remove was declined.');
```

`previewUninstall(store, team, targets)` reads `(await store.read()).placements` and the caller's people file (`readPerson`) and the team.json endorsement (same `isAuto` rule as `U:99`) and returns:

- `placements`: `[path, scope]` for every ledger entry matching `(id, team, sameScope)` — the exact predicate at `U:85`, so the list is what will be removed, across every checkout.
- `records`: caller install records matching `(id, sameScope)` — predicate at `U:100`.
- `declining`: ids where `isAuto(id)` and no install record for that id survives after `records` are dropped and the id is not already declined — predicate at `U:105`.
- `lines` (the `detail`), in this order and wording:
  - `Folders removed (<k>):` then one line per placement `  <path>  ·  <Global | project <name>>` (paths as stored; the desktop abbreviates `~`).
  - `Local changes are moved to <store.root>/quarantine, never deleted.` (from `U:131-132`)
  - `Install records dropped from your people file (<j>): <name>, <name>…`
  - When `declining` is non-empty: `Not offered again until you install them: <name>, …` followed by `These have no remaining install record, so sync stops placing them anywhere.` When empty, omit both lines.
  - For `member`: `Targets are <handle>'s current installed list, not what you installed from them.`
  - For `project`: `Copies installed to Global stay.` (from `U:43-47`).

Names come from `findSkill`/team records by id (fallback to `id.slice(0, 8)`).

Cancel returns `cancelled(...)` (`result.ts:9`) so the frame `result` carries `declined: true` and the desktop sees `cancelled: true`.

No change to `ledgerScopes`, the pending write order, or `samePending`.

### 2.2 `src/cli.ts:132`

Unchanged; all three forms already route to `active.uninstall`.

### 2.3 Docs

`docs/frame-protocol.md`: add `uninstall-skill` to the verbs whose confirm carries `detail`. README verb line for `uninstall-skill`: "asks once, listing every folder it will remove".

## 3. Desktop half (`desktop/`)

### 3.1 Seam

- `desktop/src/backend/types.ts:61`: `UninstallArgs {team?: string; ref: string; kind?: 'skill'|'member'|'project'; member?: string; project?: string}` (mirror of `InstallArgs :59`).
- `T:371`: argv mirrors `T:363`: `['uninstall-skill', ...team, '--', ...(kind==='member'&&member ? ['member', member] : kind==='project'&&project ? ['project', project] : [ref])]`.
- `T:210` `onSettled`: notify `touches` when `result.ok` **or** when `!result.ok && !result.cancelled` for mutating verbs (a failed-midway uninstall changed placements). Cancelled results notify nothing.
- Mock `desktop/src/backend/mock/index.ts:80`: accept the three forms; ask one question with the same title rule and a `detail` built from the mock catalog (paths + scopes); on `false` return `cancelled('Remove was declined.')`; on `true` return one result per id.

### 3.2 Catalog model

- `T:152` project `installed`: require a placement at **project scope for this project** for every listed skill: `rows.every(row => onDisk(local, team.team, row.id, features).some(r => r.scope === 'project' && r.placement?.id === row.id && r.placement.team === team.team && r.repoRoot matches a checkout of project))`. If the checkout ↔ project mapping is not available in `ls --local` (#85 territory), fall back to "any project-scope placement" and note it in the PR; do not keep the any-scope predicate.
- `T:360` person: keep `installable`; add `installedTargets: {name, id}[]` if the mock needs it — otherwise `installable` is the projection the page uses for count and copy.

### 3.3 `MarketplaceScreen.tsx` (#82 lines)

- `M:35`: `total = q?.skills ?? p?.installable.length ?? 0` (already on #82).
- `M:36`: for a person, the removable set is `p.installable`, not `p.skills`; `names` stays the page's listing set (authored buckets), and a new `removable = q ? q.skillsIn : p.installable` drives the trash.
- `M:38` replace `remove()` with:
  ```
  function remove() { return onRun(() => backend.uninstallSkill(q ? { ref, kind: 'project', project: ref } : { ref, kind: 'member', member: ref }), {}, () => {}); }
  ```
  No answers object: the CLI's ask reaches `PromptContext` (`drive.ts:11` → `prompter.ts:9` → `providers.tsx:26`) and renders with its `detail`. One run, one busy state, one commit.
- `M:42` trash `aria-label`: project `Remove ${name}'s ${total} skills from this machine`; person, own handle: `Remove everything you installed (${total} skills)`; other: `Remove ${handle}'s ${total} installed skills from this machine`. Keep `onClick={() => void remove()}`; keep `disabled={busy}`.
- `M:66` `run()`: `if (!result.ok) { if (!result.cancelled) setActionError(result.error); return false; }`. Cancel is silent (the dialog closed on No).
- `M:69` error board: out of scope here (its own gap-audit item), but this change stops feeding it cancels.
- Dialog: none drawn by the screen. The provider's `PromptDialog` (`providers.tsx:35`) renders title = question, description = detail lines, No / Yes. Add to `PromptDialog`: when `question.question` starts with `Remove ` or `Delete ` render the Yes button with `kind="danger"` — optional polish; if the canvas wants a `TerminalHint`, add `command?: string` to the ask frame later, not in this change.

### 3.4 `SkillScreen.tsx:41-43` (audited under the same rule)

Today: the trash opens a drawn dialog (`dialog==='remove'`, canvas `SkillDetailRemove`), Remove calls `execute('remove')`, which pre-answers `Remove ${ref}?` — a question no CLI path asks. After §2.1 the CLI asks `Remove ${name}?` with detail listing every checkout's copy (bare ref is destination-blind, `U:57`), which the drawn copy cannot know.

Fork for Ryan:
- (i) Keep the drawn dialog as the trigger; its Remove starts the run; drop the pre-answer so the CLI's ask renders through the provider as a second dialog. Rule-clean but two dialogs.
- (ii) Recommended: the drawn dialog becomes the rendering of the CLI's ask — the trash starts the run immediately (`execute('remove')`), the provider renders the ask, and the `dialog=remove` URL state goes away. `SkillDetailRemove` is re-derived from the provider dialog (its title and body come from the CLI: title `Remove deploy-check?`, body the detail lines; the TerminalHint line moves into the detail as `Terminal: npx -y terum-skills@latest uninstall-skill deploy-check`). This is the "one question, the CLI verb it stands for, cancel or go" rule with the CLI as the only author of the copy. Fidelity board re-lock needed on Ryan's Mac.
- Either way `S:41` `if(!result.ok){setActionError…}` gains the `cancelled` branch, and the pre-answer object `{[`Remove ${ref}?`]:true}` is removed.

## 4. Tests (fail on #82 before, pass after)

CLI, `src/commands/__tests__/uninstall.test.ts` (fixtures as in `:178` and `:202`):
1. `project` form, prompter answers `false`: no placement removed, no people-file commit (`repo.log` unchanged), no `pending` entry, result `ok:false, cancelled:true`. Fails before (nothing asked; removal happens).
2. `project` form answers `true`: ask has `detail` containing every project-scope path across two checkouts (`:202` fixture) and does not list the global copy; global placement and global record survive (`:178`); one commit.
3. `member` form where H's authored set ≠ H's installed set: detail lists the installed ids only; the caller's copies of H's installed ids go; authored-only ids untouched.
4. No-op target set (member with empty `installed`, or project whose skills are not placed here and have no install records): no ask, `[]`, no commit.
5. Own handle: title `Remove everything you installed (N skills)?`.
6. Hook replay: `sync --hook` with a pending `uninstall` entry completes it with the print-only prompter and never asks (extend `:70`/`:95`).
7. Non-TTY: `uninstall-skill project P` with `interactive: false` prompter rejects with `PromptClosedError('not-interactive')` before any write (`prompt.ts:79`).
8. Partial write failure: safeWrite push refused after placements removed → placements gone, pending entry retained, result is a failure naming the push (existing `:70` shape), and the frame `result.ok === false` without `declined`.

Desktop, `desktop/src/screens/marketplace/marketplace.test.tsx`:
9. Replace `:38` ("bulk removes … without a dialog") with: click trash on `#/marketplace/projects/terum` → `uninstallSkill` called once with `{ref:'terum', kind:'project', project:'terum'}`; a `dialog` appears whose title is the CLI question and whose description contains the mock's paths; before Yes, the mock has written nothing (spy on the mock's removal side effect); No → dialog closes, no `alert`, no error board, no removal; Yes → removal recorded once.
10. Person page own handle: aria-label `Remove everything you installed (N skills)` where N = `installable.length`, and the call is `{kind:'member', member: handle}`.
11. Cancelled result from the backend (`ok:false, cancelled:true`) renders no error board (`M:66`).
12. `desktop/src/backend/tauri/__tests__/run.test.ts`: a failed (non-cancelled) `uninstall-skill` run notifies `config`/`placed`; a cancelled one notifies nothing.
13. `desktop/src/screens/library/library-skill.test.tsx`: single Remove starts the run and the CLI's ask renders through the provider; no scripted `Remove X?` answer is sent (assert `run.answer` is called only after the dialog's Yes).

## 5. Spec sentence for `.planning/specs/2026-09-02-phase-1-build.md:413`

Append to the `uninstall-skill` bullet: "`uninstall-skill` is confirmed: after resolving its targets and before writing the `pending` entry, it asks one question whose detail lists every placement path and scope it will remove, every install record it will drop, and every ID that will be recorded in `declined` (the §5.2 rule: only IDs with no surviving install record). A `no` writes nothing and is reported as a cancel, not an error; a non-interactive caller fails closed. The pending-replay path (`sync`, `sync --hook`) never asks. The app renders this question through the frame channel and never pre-answers it (2026-09-07 dialog rule)." Amend `:414`'s "confirmed" so both verbs read the same.

## 6. Separate bug note — connect adoption leaves a placed folder placed (#82)

`src/commands/connect.ts:190-198` on `origin/fix/installed-state`: when a folder carries an existing skill id, connect records `current.shared[existing.id] = { source, team, baseline }` after a confirm, but does not delete `placements[source]` when `source` is a ledger path (a placed copy the user then connected). The path is now both a connected source and a placement, so `uninstall-skill` (`U:85` → `removePlacements` → `placer.remove`) will delete or quarantine it and leave `shared[id].source` pointing at a missing folder; `sync` then treats it per its orphan/shared rules. Fix belongs in connect: refuse to adopt a ledger path, or clear the placement (and its people-file record) in the same store update, with copy telling the user which happened. Out of scope for the bulk-remove change; log as its own gap-audit item.

## 7. Depth/Fit and effort footnote

Fit 4 (spec + North Star: the CLI is the prompt channel; one question; cancel or go; declined rule unchanged), Depth 4 (both bulk pages, the single-skill page, cancel handling, stale views, scope-blind project predicate). Effort: ~120 lines CLI incl. preview, ~60 lines desktop, 13 tests, one canvas board re-lock if fork (ii) is taken.
