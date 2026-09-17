# SPEC — publish run host (a publish you can click out of)

Baseline: `ryanliu-terum/terum-skills` @ **65d532d** (`Merge pull request #244 … release/0.19.0`), CLI `0.19.0`.
Every line number and quoted identifier below was read out of that commit. Where this spec disagrees with the
code at its baseline, **the code wins** and the implementer reports the disagreement.

Governing decisions: `.planning/decisions/2026-09-14-publish-run-host-decision-walk.md` (D1 both single and bulk
route through the host; D2 Stop keeps today's semantics plus a second-press force-abandon; D3 single-flight
refusal, no queue; D3b publish and eval may run at the same time).

North Star: *the app must never be hostage to a publish, and a publish must never be silently lost — including a
backgrounded publish that finishes or fails while you are somewhere else.*

Corroboration from the team record (Terum, teddyzheng, 2026-09-14, "Desktop skills UX plan"): eval status must
appear in the top-bar area **rather than only as a transient running chip**
(`https://app.terum.ai/#/decisions/0cb321ed-a952-4846-ac63-b741ee98971f`). §2.2 applies the same rule to publish.

**Revision 3, 2026-09-15 — rebased onto `origin/main` @ 9c97878 (22 commits past the baseline).** Three upstream
changes bear on this spec and are folded in below; where a section still quotes the 65d532d line numbers, the
behaviour is what changed, not the location.

1. **Eval's chip now persists** (`348f444` "a finished run keeps its chip", `e0cec87`): `evalChip()` in
   `eval-run-status.ts` gives every run state a chip with a tone, `dismiss()` only closes the dialog, and a new
   `clear()` (the chip's ✕) forgets a settled run. §0.4's "the one place the port must not copy eval" is therefore
   moot — eval caught up — and §2.2 now says the opposite: the publish chip is drawn by the SAME markup
   (`TopBar.tsx` `StatusChip`) from a `publishChip()` in `desktop/src/app/publish-run-status.ts`, and
   `PublishRunApi` gains `clear()`. Closing the board keeps the chip; only ✕ or the next run forgets it.
2. **Publish targets the marketplace** (`aca73d6`): `GLOBAL_LIST` / `TARGET_ASK` are gone from
   `publish-defaults.ts`; the default target sends no `--project`, and `publishOutcomeText` names "the marketplace".
   Tests that pinned `project:'Global'` or "published to acme" now pin `{ref}` alone and "the marketplace".
3. **`origin`, `scope`, `reported`, `subscribe`.** `PublishRunState` carries `origin: 'library' | 'skill'` (required by
   `start()`), `scope?: string` (the Library scope key that asked) and `reported: boolean`. `start()` returns
   `{ startedAt, settled }` — a promise for the run's final snapshot — and the API gains `acknowledge(startedAt)`
   and `subscribe(listener)`, which delivers each settled run and replays an already-settled one to a late
   subscriber. These came out of the cross-model review (2026-09-15): once a settled run outlives its screen,
   every screen-local "have I reported this?" resets on remount and every derivation from "a run exists" goes
   stale, so the acknowledgement and the settle signal had to move onto the run itself.
   - **Skill page:** `publish()` keeps the run it started (`ownRun`) and, from `settled.then`, runs the exact
     continuation the pre-host page ran after `driveRun` — `setNotice(outcome)` or `setActionError(CLI sentence)`,
     `acknowledge`, and dropping `dialog` from the URL — only while that page instance is still up. The dialog is
     hidden by derivation the moment its own run settles; `ownRun` is forgotten from the URL (no dialog named), so
     the next `?dialog=publish` opens. A failure therefore lands on the page's existing error board once, as
     install and remove do, and does not persist app-wide; the success sentence is derived for a run the page did
     not see settle (`!reported`), so it waits on the page for the person who left.
   - **Library:** reports from `subscribe`'s callback (never from an effect body — the React Compiler lint rule
     forbids it, and the old effect only passed by bailing out on a ref write), for runs with `origin==='library'`
     and `scope===scopeKey`, acknowledged in a module-scope set keyed by `startedAt`. A run that settles while
     another Library scope is on screen is reported by its own Library when the person returns.
   - **Stopping is said out loud:** the board's status and the page dialog's step read
     `Stopping… press Stop again to stop waiting` (Cancel on the page) between the two presses (D2).
   - The publish chip's Stop is `aria-label="Stop publish"`; eval's stays `Stop` (its tests pin it) — both may run at
     once (D3b) and the two must not share a name. The Library
   reports (and ends its selection for) runs *it* started, whatever their row count — a one-card publish from
   the Library used to fall through a `rows.length < 2` heuristic and never end selection mode (§6 `:347` is the
   test that caught it). The skill page still derives its notice by name.

**Status: LOCKED, 2026-09-14.** Built in a worktree off `origin/main`
(`../skill-management-software-wt-publish-host`, branch `feat/publish-run-host`), never in the primary checkout,
which sits on `feat/frame-mode` with unrelated dirty state. `check_decision` ran on the port including the two
new behaviours and returned no candidates.

---

## 0. Summary

1. The Library's "Publish to team" queue is hostage to its own dialog. The dialog refuses outside-press and
   focus-out while running (`BulkPublishDialog.tsx:109`), and if it unmounts anyway its cleanup cancels the
   active run and stops the queue (`:40-47`). Leaving the screen kills the publish.
2. The same defect is on the single-skill path and is easier to hit: `SkillScreen` cancels `activeRun` on
   unmount (`SkillScreen.tsx:85`) and `SkillScreen` re-keys `SkillPage` on `ref:mock:path:root`
   (`SkillScreen.tsx:142`), so **navigating away mid-publish cancels it with no notice at all**.
3. The fix already exists in this repo for eval: a provider mounted above the router holds the run, a host
   mounted outside `RouteView` draws its dialog, and only explicit Stop cancels (`EvalRunProvider.tsx:10`). This
   spec ports that pattern to publish. Six of seven pieces are mechanical.
4. **The one place the port must NOT copy eval.** Eval's chip renders only while `state==='running'`
   (`TopBar.tsx:30`), and `dismiss()` keeps a running run alive while closing its dialog
   (`EvalRunProvider.tsx:52`). So an eval that finishes — or **fails** — while you are elsewhere surfaces
   nothing. Survivable for eval, whose score lands on the card. Not survivable for publish, whose entire output
   is which of **four** things happened (`publish-outcome.ts:13-22`) and whose failures would otherwise be
   invisible. §2.2 makes the chip outlive the run.
5. **Single publish is a one-row queue.** The provider holds `rows: PublishRow[]`; a single publish is that
   list with one entry. This is smaller than carrying two shapes, and it is what makes D1 cheap.
6. The *question* dialogs stay where they are. Only the *running board* moves to the host — exactly the
   `BulkEvalDialog` → `startMany` → `BulkEvalRunDialog` split that already ships
   (`BulkEvalDialog.tsx:16, :38-43`).

---

## 1. Current behaviour at 65d532d

| Fact | Where |
| --- | --- |
| Bulk queue state lives in the dialog's `useState` | `BulkPublishDialog.tsx:25-33` |
| Rows run strictly serially; every publish takes the clone writer lock | `BulkPublishDialog.tsx:54-92` (loop `:59`) |
| Outside-press and focus-out are refused while running | `BulkPublishDialog.tsx:106-113` (guard `:109`) |
| Unmount cancels the active run and stops the queue | `BulkPublishDialog.tsx:40-47` |
| A second Cancel on an unsettled run leaves the dialog; unmount cleanup cancels again | `BulkPublishDialog.tsx:96-98` |
| `mounted` ref is re-armed in the effect *setup* as a StrictMode workaround | `BulkPublishDialog.tsx:36-38, 40-41` |
| A publish that finished before its cancel landed is reported as published, and the queue stops | `BulkPublishDialog.tsx:74-80` |
| Bulk forces ONE target for every row | `BulkPublishDialog.tsx:32` (`publishFlags(target, null)`) |
| The dialog is mounted inside `LibraryScreen`, gated on `?select=1` | `LibraryScreen.tsx:127` |
| Finishing clears the selection and writes a Library-scoped notice | `LibraryScreen.tsx:68` (`finishBulk`) |
| Single publish cancels on unmount, and the page re-keys on navigation | `SkillScreen.tsx:85`, `:142` |
| Single publish's outcome is a page-local `setNotice(...)` | `SkillScreen.tsx:105-121` (`publish()`), `backend.publish` at `:109` |
| `closeDialog()` cancels the active run | `SkillScreen.tsx:104` |
| Eval's provider has no unmount cleanup, on purpose | `EvalRunProvider.tsx:10` |
| Eval refuses a second run with a sentence | `EvalRunProvider.tsx:16` |
| `dismiss()` closes the dialog and clears state only when not running | `EvalRunProvider.tsx:52` |
| The chip renders only while running | `TopBar.tsx:30` |
| `WorkflowDialog` hides Close and shows Stop while busy; `dismissKeepsRunning` lets Escape through | `WorkflowControls.tsx:13-14` |
| Provider mount point (inside `PromptProvider`, outside the router) | `providers.tsx:24` |
| Host mount point (inside `HashRouter`, outside `RouteView`) | `App.tsx:35` |

**Two facts that make cancelling mid-row safe.** The version write is one `safeWrite` commit+push
(`publish.ts:259`). The profile entry is a **second, independent** `safeWrite` after it whose failure is
explicitly not reported as a failed publish (`publish.ts:380-392`). A kill therefore lands on one of two clean
states, never a torn one.

**The fact behind D3b.** The per-clone writer lock is acquired inside `safeWrite` (`teamRepo.ts:187`) and
released after the push — seconds, not the length of a run — with contention bounded by `lockWaitMs` and
reported as `CloneBusy` (`teamRepo.ts:653-661`). Eval writes receipts through the same `safeWrite`
(`eval.ts:646`). So publish and eval contend per-write and self-report; they must **not** block each other.
Do **not** copy `MachineRemovalProvider.tsx:17`'s refuse-while-eval-runs guard: that exists because
uninstalling the machine mid-eval is meaningless, not because of lock contention.

---

## 2. Behaviour contract

### 2.1 What each gesture does

| Gesture | Before | After |
| --- | --- | --- |
| Press Escape / click outside the run board | Refused while running | **Dismisses the board; the queue keeps running** |
| Navigate anywhere in the app | Cancels the queue | **Nothing. The queue keeps running** |
| Click the top-bar chip | — | **Reopens the run board with every row's current state** |
| Press Stop (first time) | — | Cancels the active row; rows after it read `Not started`; finished rows keep their outcomes |
| Press Stop (second time, run not settled) | — | **Force-abandons: the app stops waiting, the active row reads `Stopped without confirming`, and publishing is available again** |
| Quit the app | Cancels | Cancels |

Only Stop and native quit cancel a publish. Nothing else may.

### 2.2 The chip (the binding half of the North Star)

**Revision 3.** The chip renders whenever `current !== null`, in the shape eval's now has (`EvalChip`: `state`
read whole, `subject` the part CSS may shorten, `label = state · subject` as the accessible name, `title` the
label plus a detail, a `tone`, and `running`). `publishChip()` in `desktop/src/app/publish-run-status.ts` builds
it; `TopBar.tsx`'s `StatusChip` draws eval's and publish's identically — the animated dot and the square
**Stop** while `running`, the ✕ (`aria-label="Dismiss publish status"`) afterwards. Counts cover rows the queue
can send; a skipped row was never part of them.

| Run state | `state` | `subject` | `title` detail | tone | Stop |
| --- | --- | --- | --- | --- | --- |
| `running`, 1 row | `Publishing` | `<name>`, plus ` · <label>` when the CLI reported a step | — | running | yes |
| `running`, N rows | `Publishing · <settled> of <sendable>` | — | — | running | yes |
| `stopping` | `Stopping` | `<name>` / `<n> skills` | — | running | yes (a second press force-abandons) |
| `done`, 1 row | `Publish finished` | `<name>` | the `publishOutcomeText` sentence | done | no |
| `done`, N rows | `Published · <published> of <attempted>` | `<failed> failed` when `failed > 0`, else none | — | done / failed when `failed > 0` | no |
| `failed` | `Publish failed` | `<name>` | the CLI's sentence | failed | no |
| `stopped` | `Publish stopped` | `<published> published` | — | stopped | no |

Clicking the chip in any state calls `show()` and reopens the board. Closing the board calls `dismiss()`, which
**only closes the board** — the chip stays until `clear()` (the ✕, refused while running) or the next `start()`.
This is upstream eval's rule (UI policy §5, `EvalRunProvider.tsx` `dismiss`/`clear`), and it is what keeps a
finished or failed publish from being lost by the reflex of closing the board. A chip is never cleared by a
route change, a refetch, or a timer.

### 2.3 Row states

`BulkRowState` (`bulk-publish.ts:4-12`) gains exactly one member for D2's force-abandon:

```ts
| { kind: 'abandoned' }
```

`rowText` (`bulk-publish.ts:17-27`) returns `'Stopped without confirming'` for it. The wording is deliberate:
the child process may still be alive, and the app must not claim otherwise. Every other row state and its text
is unchanged.

### 2.4 Single publish

**Revision 2, 2026-09-14 — decision walk D4.** The first build closed this dialog on start and moved everything
to the host. That broke a contract the spec had not noticed: `progress.test.tsx:58` and `:92` are
`it.each(['install','remove','publish'])`, one shared promise across all three operations. Publish must not leave
it.

The skill page's publish confirmation dialog is unchanged in look AND in its run behaviour: title, description,
`PublishOptions`, the `TerminalHint`, Cancel, and the primary button. While a publish it started is running it
**stays open**, exactly as Install and Remove do — the CLI step renders in its `role="status"`, the primary
button is disabled, Cancel stays enabled, the dialog closes when the run settles, and a failure closes it and
exposes the page's existing error board with the CLI's own sentence.

What changes is ownership, not appearance. The primary button calls `publishRun.start(...)` with a one-row queue,
and the dialog then renders from `publishRun.current` instead of page-local `busy`/`progressLabel`. The page no
longer owns `activeRun` for publish, and the `useEffect` unmount cancel at `SkillScreen.tsx:85` must no longer
cancel a publish.

**Dismissing is the handoff.** Escape or an outside press on this dialog does not cancel — it backgrounds the
run, exactly as §2.1 promises, and from that moment the chip and the host's board carry it.

**The run is never drawn twice.** `PublishRunDialogHost` renders only when `dialogOpen` is true, and `start()`
called from the skill page leaves `dialogOpen` FALSE — the page's own dialog is the board until it is dismissed,
and dismissing it is what sets `dialogOpen` true. A bulk publish, which has no page dialog, sets it true at
`start()` as before.

`SkillFixDialog`'s `onDone(_value, republish)` republish path (`SkillScreen.tsx:140`) calls the same `start(...)`.

### 2.5 Where a finished run is reported, per screen

Both screens subscribe to the run and report a finished run they have not yet acknowledged, keyed by
`startedAt`. If the run finished while the person was elsewhere, the report appears when they come back — the
chip covered the interim.

- **Library** keeps `finishBulk`'s behaviour (`LibraryScreen.tsx:68`): invalidate `['library']` and `['skill']`,
  clear the selection, write the scoped notice, drop `dialog` and `select` from the URL. It now fires from an
  effect that observes a finished multi-row run rather than from an `onFinished` prop.
- **Skill page** keeps its inline `setNotice({text: publishOutcomeText(...), url: null})` for a finished
  one-row run naming this skill, and refetches.

---

## 3. Data model and contracts

### 3.1 `desktop/src/app/publish-run-context.ts` (new)

Mirrors `eval-run-context.ts`.

```ts
export interface PublishRow { key: string; card: SkillCard; state: BulkRowState }

export interface PublishRunState {
  rows: readonly PublishRow[];
  /** Revision 3: who started it — the Library reports its own runs; the skill page derives by name. */
  origin: 'library' | 'skill';
  flags: Pick<PublishArgs, 'project' | 'category'>;
  team?: string;
  startedAt: number;
  state: 'running' | 'stopping' | 'done' | 'failed' | 'stopped';
  progress?: Extract<Frame, { t: 'progress' }>;
  summary?: BulkPublishSummary;
}

export interface PublishRunApi {
  current: PublishRunState | null;
  dialogOpen: boolean;
  /** Throws a sentence while another publish is in flight. `openBoard:false` is D4's skill-page start (§2.4). */
  start(args: { cards: readonly SkillCard[]; flags: Pick<PublishArgs,'project'|'category'>; origin: 'library'|'skill'; team?: string; openBoard?: boolean }): void;
  isRunning(): boolean;
  stop(): Promise<void>;
  /** Closes the board and nothing else (Revision 3). */
  dismiss(): void;
  /** Forgets a settled run — the chip's ✕. A running run is never cleared (Revision 3). */
  clear(): void;
  show(): void;
}
```

`BulkRowState`, `BulkRow`, `BulkPublishSummary` and `rowText` keep living in
`desktop/src/screens/library/bulk-publish.ts`; `PublishRow` is `BulkRow`. `Frame`, `Result`, `Run`,
`PublishArgs` and `PublishResult` are `desktop/src/backend/types.ts:3, 11, 12, 135, 142`.

### 3.2 `desktop/src/app/PublishRunProvider.tsx` (new)

Carries the docblock that states the contract, as `EvalRunProvider.tsx:10` does:

> App lifetime, independent of routes. Only explicit Stop or native quit cancels a publish. **There is no
> unmount cleanup here on purpose — do not add one.**

- **Refs:** `live` (the authoritative `PublishRunState`), `inFlight`, `stopRequested`, `abandoned`,
  `activeRun`, `landed`.
- **`assertAvailable()`** mirrors `EvalRunProvider.tsx:16` and throws
  `` `A publish is already running for ${…}` `` (§4). `start` calls it first; it does **not** consult the eval
  run (D3b).
- **`start(args)`** seeds rows from the cards exactly as `BulkPublishDialog.tsx:25-28` does — `localActionReason(card,'publish')` decides `ready` vs `skipped`, `key` is `card.path ?? card.name` — stores the
  pre-resolved `flags`, sets `state:'running'`, opens the dialog, and drives the serial loop.
- **The loop** is `BulkPublishDialog.tsx:54-92` moved verbatim, with `mounted.current` deleted and `setRow`
  writing through `live`. **`:74-80` — the publish that finished before its cancel landed — must survive
  unchanged**; it is what makes D2 safe, and it is the easiest thing in this spec to lose.
- **`stop()`**: if `state==='running'`, set `stopping`, set `stopRequested`, `void activeRun.current?.cancel()`.
  If `state==='stopping'`, **force-abandon**: set `abandoned`, mark the active row `{kind:'abandoned'}`, set
  `state:'stopped'`, clear `activeRun`, set `inFlight=false`, and invalidate every clone-backed read
  (`predicate: q => affects('clone', q.queryKey)`, as `EvalRunProvider.tsx:29` and
  `BulkPublishDialog.tsx:45` do). A later settlement of the abandoned `driveRun` is ignored — every write-back
  in the loop is already guarded on the run still being the active one, and `abandoned` makes that guard false.
- **`dismiss()`** closes the dialog and nothing else; **`clear()`** closes it and sets `current` to null unless
  the run is in flight (Revision 3 — upstream eval's `dismiss`/`clear` pair, verbatim).
- Invalidate clone-backed reads when the queue ends with `landed > 0`, matching `BulkPublishDialog.tsx:45`.

### 3.3 `desktop/src/app/PublishRunDialogHost.tsx` (new)

Renders `dialogOpen && current ? <PublishRunDialog …/> : null`. One board for both shapes; a one-row run simply
draws one row. It reads no route state and makes no query — everything it draws is on `current`.

### 3.4 `PublishRunDialog` (new, `desktop/src/components/domain/PublishRunDialog.tsx`)

The streaming board, modelled on `BulkEvalRunDialog` (`BulkEvalDialog.tsx:38-43`): `WorkflowDialog` with
`dismissKeepsRunning`, `onStop`, `closeLabel="Close"`, `primary={null}`, `busy={state==='running'||state==='stopping'}`, and the row list from today's markup (`BulkPublishDialog.tsx:118-123`,
`data-testid={'bulk-row-'+row.card.name}` preserved). The `TerminalHint` keeps today's command
(`BulkPublishDialog.tsx:125`). The summary line keeps today's copy (`:128`).

### 3.5 What stays a question dialog

- `BulkPublishDialog` (`desktop/src/screens/library/BulkPublishDialog.tsx`) keeps its title, description,
  `PublishOptions`, row preview, `TerminalHint` and empty state. Its primary button now calls
  `publishRun.start({cards, flags, …})` and then `onClose()`, and it renders the caught sentence from
  `assertAvailable` inline in `role="alert"` — exactly `BulkEvalDialog.tsx:22`'s shape.
- The skill page's publish dialog behaves the same way (§2.4).

---

## 4. Copy (exact strings)

| String | Where |
| --- | --- |
| `A publish is already running for <name>.` — 1 row | `assertAvailable` |
| `A publish is already running for <n> skills.` — N rows | `assertAvailable` |
| `Stopped without confirming` | `rowText({kind:'abandoned'})` |
| `Publishing <name>` / `Publishing <done> of <N>` | chip, §2.2 |
| `Stopping <name>…` | chip, §2.2 |
| `Published <p> of <a>` / ` · <f> failed` | chip and summary; reuses `LibraryScreen.tsx:68` wording |
| `Publish failed · <name>` | chip, §2.2 |
| `Publish stopped · <p> published` | chip, §2.2 |
| `Stop` | the chip's danger button and `WorkflowDialog`'s busy button (already exists); the publish chip's is named `Stop publish` |
| `Stopping… press Stop again to stop waiting` | board status and page dialog step while `stopping` (Revision 3) |

Every per-row sentence still comes from the CLI verbatim, or from `publishOutcomeText`
(`publish-outcome.ts:13-22`). This spec invents no new outcome vocabulary.

---

## 5. Changes per file (index)

| File | Change |
| --- | --- |
| `desktop/src/app/publish-run-context.ts` | **new** — §3.1 |
| `desktop/src/app/PublishRunProvider.tsx` | **new** — §3.2 |
| `desktop/src/app/PublishRunDialogHost.tsx` | **new** — §3.3 |
| `desktop/src/components/domain/PublishRunDialog.tsx` | **new** — §3.4 |
| `desktop/src/app/providers.tsx:24` | mount `PublishRunProvider` inside `PromptProvider`, beside `EvalRunProvider` |
| `desktop/src/app/App.tsx:35` | mount `PublishRunDialogHost` beside `EvalRunDialogHost` |
| `desktop/src/app/publish-run-status.ts` | **new** (Revision 3) — `publishChip()`, §2.2 |
| `desktop/src/components/domain/TopBar.tsx` | `StatusChip` draws eval's and publish's chip from the same markup; Stop only while running/stopping; ✕ afterwards |
| `desktop/src/screens/library/BulkPublishDialog.tsx` | becomes the question dialog only; loop, refs and cleanup removed |
| `desktop/src/screens/library/bulk-publish.ts:4-12, :17-27` | add `abandoned` + its text |
| `desktop/src/screens/library/LibraryScreen.tsx:68, :127` | `finishBulk` fires from an effect on the run; dialog keeps its mount, run board does not |
| `desktop/src/screens/skill/SkillScreen.tsx:85, :104, :105-121, :124` | publish routes through the host; unmount and `closeDialog` no longer cancel a publish |
| `desktop/src/screens/library/library.css:19` | row-list styles follow the board into its new dialog |

Not changed, by decision: `desktop/src/components/domain/ReconcileDialog.tsx:68` and `src/commands/publish.ts`.

---

## 6. Tests

`desktop/src/screens/library/bulk-publish.test.tsx` (377 lines, 18 tests) is the existing surface. Per the
team's note carried in the handoff, the desktop suite on Node 25 on this machine needs
`NODE_OPTIONS=--no-experimental-webstorage`, and anything driven by a manifest runs through `npm --prefix`
because `vitest --root` does not change cwd.

**Must keep passing unchanged** — `:101`, `:123`, `:159`, `:193`, `:207`, `:223`, `:249`, `:367`, and the four
selection-mode tests at `:35`, `:55`, `:68`, `:88`, `:331`, `:347`. `:223` (finished before its cancel landed)
is the load-bearing one.

**Must invert:**
- `:269` `leaving mid-queue cancels the active run…` → **leaving mid-queue keeps the queue running, starts the
  next row, and cancels nothing.**
- `:296` `a run that never settles: a second Cancel leaves the dialog…` → **a second Stop force-abandons: the
  row reads `Stopped without confirming`, the chip leaves the running state, and a new publish is accepted.**

**Must keep passing for ALL THREE kinds (D4):** `progress.test.tsx:58` and `:92`. Splitting the `it.each` so
publish asserts something weaker is the failure mode this decision exists to prevent — it is how the first build
went green.

**Must be deleted:** `:314` `StrictMode's effect replay does not freeze the queue after its first row` — the
`mounted` ref it guards does not exist once the queue lives in the provider. Deleting it is only correct if no
`mounted` ref survives; if one does, the refactor is wrong.

**New:**
1. Dismissing the run board leaves the queue running; reopening from the chip shows the finished rows with
   their outcomes intact.
2. Navigating from the Library to a skill page and back mid-queue cancels nothing and loses no row state.
3. The chip survives completion: after the last row, the chip still reads `Published 2 of 3 · 1 failed`; closing
   the reopened board clears it.
4. A run that **fails** while the board is dismissed still surfaces — the chip reads `Publish failed · <name>`.
   (This is the North Star's clause 2 and the one behaviour eval does not have.)
5. A second `start` while a publish is in flight throws the §4 sentence, and the question dialog shows it in
   `role="alert"`.
6. A publish starts and runs while an eval is running, and vice versa — neither refuses the other (D3b).
7. Single publish: pressing Publish on the skill page then navigating away completes the publish, and the page
   shows its notice when the person returns.
8. `providers.test.tsx` / `App.test.tsx`: the provider sits inside `PromptProvider` and the host outside
   `RouteView`, so a backgrounded publish's questions still render as app-level modals.

`desktop/src/screens/settings/publishing.test.tsx` references the bulk publish surface and must be re-checked.

**As shipped (Revision 3).** `bulk-publish.test.tsx` — 22 tests: the 13 unchanged originals (`:35 :55 :68 :88 :101
:123 :159 :175 :193 :207 :223 :249 :331 :347 :367`, with `:123`/`:159`/`:175` reading the host's board and chip, "Cancel"
→ "Stop", "Done" → "Close", and `:367` naming `abandoned`), the two inversions (`:269` → *leaving mid-queue keeps
the queue running*, `:296` → *a second Stop force-abandons*), `:314` deleted (no `mounted` ref survives), and new
1–5 (dismiss/reopen; Library → skill page → back; the chip survives completion and only ✕ forgets it; a failure
while dismissed reads `Publish failed · <name>` with the sentence in `title`; the §4 refusal in `role="alert"`).
`desktop/src/app/publish-run.test.tsx` — 5 tests: new 6 both ways (publish during eval, eval during publish), new
7 (single publish survives leaving the page; the notice waits on the page), D4's handoff (the board is drawn once),
and new 8 as behaviour (a backgrounded run's `ctx.ask` renders as an app-level modal on another route).
`desktop/src/app/publish-run-status.test.ts` — 8 tests over the §2.2 ladder.

**After the 2026-09-15 Codex pass (`gpt-6-astra@high`, read-only, 8 findings; 5 fixed, 1 already fixed, 2 deferred):**
`start()` gates rows with `localActionReason` only for `origin==='library'` — the skill page gates its own button
on live data and fix-and-republish hands over a card whose query data still says `broken`; a force-abandoned run's
later `ctx.ask` is withdrawn (`PromptCancelledError`), never shown; `settle()` fans out over a snapshot with each
listener isolated; the failed chip names the failed row, not a skipped first row; `startedAt` is monotonic; the
continuation drops `dialog` only when it is `publish` or `fix`; the settle continuation uses the latest search-param
setter (react-router's functional form reads the params of the render that made it). Deferred: a polite live-region
announcement for a backgrounded completion (eval has the same gap) and pruning the module-scope acknowledgement set.

**After the 2026-09-15 review:** `bulk-publish.test.tsx` gains *a run reported once stays reported* (detour and back:
no second notice, `select` kept) and *a run settling while another Library is on screen is reported by the Library that
started it* (24 total); `publish-run.test.tsx` gains *after a settled publish the page can publish again* (URL drops
`dialog`, the confirmation reopens, ✕ pops nothing) and *a publish that fails on the page lands on its error board once*
(7 total), and pins the two Stop names.

---

## 7. Gates

1. `npm --prefix desktop run typecheck` and `lint` clean. `exactOptionalPropertyTypes` is on — an absent `team`
   is absent, not `undefined` (`EvalRunProvider.tsx:47-49` shows the shape).
2. Full desktop suite green with `NODE_OPTIONS=--no-experimental-webstorage`.
3. The FIDELITY manifest rows that draw the Library selection bar and the publish dialogs are unchanged, run
   through `npm --prefix`.
4. Grep gate: **no `mounted` ref and no unmount cleanup anywhere in the new provider or host.** A cleanup that
   cancels a run is the bug this spec exists to remove.
5. Manual: start a bulk publish of three skills, press Escape, navigate Library → skill page → Marketplace →
   Settings, confirm the chip counts up throughout and every row's outcome is intact when the chip is clicked.

---

## 8. Out of scope and deferred

- **Variadic `publish`.** `publish <ref>` stays single-ref (`src/cli.ts:166`). Making it take N refs so a bulk
  publish costs one fetch/push instead of N is the larger win and the agreed follow-on, not this change. A prior
  attempt exists on `codex/batched-endorsement` (spec `23ad931`, implementation `f2b111d`, 2026-09-10); it
  predates the layout-3 rewrite and the removal of the PR/auto-merge publish flow, so it is worth mining for
  shape and will not apply as patches.
- **`ReconcileDialog`'s publish loop** (`ReconcileDialog.tsx:68`) keeps calling `backend.publish` directly and
  bypasses the host. Declared in the walk's `deferred:` frontmatter.
- **Eval parity.** Eval keeps both holes publish is fixing: no force-abandon, and no surfacing of a backgrounded
  run that finished or failed. Also declared in the walk's `deferred:` frontmatter.
- **Running rows in parallel** and **a queue of queues** — rejected in the walk (D3); do not relitigate.
