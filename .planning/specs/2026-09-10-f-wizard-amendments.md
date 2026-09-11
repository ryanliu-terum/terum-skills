# f-wizard — AMENDMENT A1: evals run in parallel, never one by one

Teddy (2026-09-11 01:10Z): "It should not be one by one eval it should be evals in parallel." This amends `f-wizard` D2–D4
(the wizard's `Now` / `In batches` / `Overnight` paths and `eval --drain`). Where A1 and the base spec disagree, A1 wins.
The merged wizard step (`src/commands/setup.ts`, PR #151) runs candidates in a sequential `for` loop with
`Evaluating i of n · name`; that loop is replaced, not kept.

## Facts that make this safe (read `src/commands/eval.ts` before changing anything)

- `eval` pins the evaluated version and materializes an immutable snapshot BEFORE it reads any skill content
  (`materializeVersion`, comment at the top of `run`): a concurrent clone refresh or a sibling's receipt commit cannot
  change what one eval evaluates. Nothing in eval.ts needs to change for parallelism.
- Each eval takes the clone lock twice: `refreshClone` at start and `safeWrite` for the receipt (and for generated
  assets) at the end. W-06 made both wait (`lockWaitMs` / `onWaiting`), so siblings contend and wait instead of failing.
- With `commit: true` and the reused preflight an eval normally asks nothing, but it CAN ask: the generated-assets
  commit pauses on one confirm (`generationCommitNotice`). Parallel evals therefore need question serialization.
- Cases inside ONE eval stay sequential (`for (const file of selected) await runCase(...)`): the run's seeded rng and
  the receipt's case order are part of its determinism. Per-case parallelism is out of scope (open question, default no).

## Decisions (locked)

- P1 **Bounded pool with allSettled semantics.** Add `settleWithConcurrency<T,R>(items, limit, fn): Promise<PromiseSettledResult<R>[]>`
  to `src/lib/concurrency.ts` beside `mapWithConcurrency` (which stops on the first rejection and is therefore wrong
  here): keep `limit` workers busy until every item has settled, never abort siblings, results in input order, `limit`
  clamped to ≥ 1. Then `src/lib/evals/batch.ts` (new) exports
  `EVAL_PARALLEL_DEFAULT = 4` and
  `runEvalBatch(input: { items: PendingEval[]; parallel: number; io: Prompter; run: (item, io) => Promise<Result<EvalResult>>; onSettled?: (item, outcome) => void }): Promise<{ ok: number; failed: number; outcomes: Result<EvalResult>[] }>`.
  The wizard and `eval --drain` both call it; there is exactly one batch runner.
- P2 **Where parallelism applies.**
  - `Now`: every candidate through `runEvalBatch` with `parallel = EVAL_PARALLEL_DEFAULT`, no pause.
  - `In batches`: the question becomes `How many at a time?` (text, default `4`, integer ≥ 1). A batch IS the set that
    runs at once: run `b` in parallel, then `Continue with the next {b}? ({done} of {n} done, {remaining} left)`; `No`
    queues the rest (D3). Base spec's "How many per batch?" and its default 3 are replaced by this.
  - `Overnight`: queue all (unchanged); `eval --drain` gains `--parallel <n>` (default `EVAL_PARALLEL_DEFAULT`) and
    drains up to `--max` items through the same runner, `parallel` at a time. The desktop drainer runs
    `eval --drain --parallel 4` (no `--max 1`): one CLI process runs the batch and its `progress` frames make it visible
    through the existing eval run host; "stoppable" means cancelling that one run.
- P3 **Output never interleaves.** `runEvalBatch` gives each eval a capturing Prompter (`interactive` and `channel`
  copied from the outer one): `print` appends to that eval's buffer; `progress` is dropped (the batch emits the only
  progress frames, see P5); `confirm` / `text` / `select` are serialized through one async mutex on the outer
  Prompter — before forwarding a question the runner flushes that eval's buffer as a block (`── {name} ──` then its
  lines) so the person has context, then asks, then resumes buffering. When an eval settles, its remaining buffer is
  flushed as the same kind of block, followed by one line: `✓ {name}` or `✗ {name}: {first line of the error}`.
  Blocks from different evals therefore never mix, and every line the eval printed still reaches the person.
- P4 **Lock budget.** Every eval in a batch is started with `lockWaitMs: 300_000` (five minutes): with `p` siblings a
  receipt push may legitimately wait for `p - 1` pushes ahead of it and must never fail for that reason. W-06's
  `onWaiting` line lands in the eval's buffer like any other print. The batch does NOT refresh the clone itself; each
  eval keeps its own `refreshClone` (cheap, under the lock, and it is what pins the version).
- P5 **Progress and copy.** Before the batch: `Evaluating {n} skills, {p} at a time…`. The batch emits
  `io.progress?.({ step: 'evals', current: done, total: n })` after each settle (never per eval). After the batch the
  existing line `Evaluated {ok} of {n}; {failed} failed.` stays byte-identical. The D1 estimate line adds the wall-clock
  reading: cost = median × n; duration = median × ceil(n / p); wording
  `Evaluating {n} skills, {p} at a time: about ${cost} and {duration} on this machine, from {k} earlier runs (median ${c1} · {d1} each).`
  and the no-data variant gains `, {p} at a time` after `{n} skills`.
- P6 **Setup outcomes** (`steps.evals`): unchanged from the base spec (`done` / `skipped` / `queued` / `batched`).

## Tests (add; never delete or weaken)

- `src/lib/__tests__/concurrency.test.ts`: `settleWithConcurrency` keeps exactly `limit` in flight while work remains,
  continues past a rejection and reports it in place, preserves input order, clamps `limit` to 1.
- `src/lib/evals/__tests__/batch.test.ts` (new): peak concurrency equals `parallel` with 2× that many items; a failing
  eval does not stop siblings; two evals that print concurrently produce two contiguous blocks; a question from one
  eval flushes its own buffer first and blocks a second eval's question until answered; progress frames are emitted
  once per settle with `total = n`; `lockWaitMs: 300_000` is passed to every eval.
- `src/commands/__tests__/setup.test.ts`: `Now` runs candidates concurrently (a stubbed `verbs.eval` that resolves on a
  deferred records ≥ 2 in flight with 3 candidates); `In batches` with `2` runs two at once, asks the continue question
  once between batches, and queues the rest on `No`; the estimate line carries `, 4 at a time`.
- `src/commands/__tests__/eval-queue.test.ts`: `--drain --parallel 2` runs two queued items at once; default is 4.
- `desktop/src/app/eval-queue-drainer.test.tsx`: argv is `['eval', '--drain', '--parallel', '4']`.
- Existing tests whose expectations move (C9 — name each in `testsModified` with its reason): every setup/walkthrough
  case that asserted the sequential `Evaluating i of n · name` lines or a sequential eval order.

## Open questions — defaults taken

| # | Fork | Default |
|---|---|---|
| A1-Q1 | Parallel cases inside one eval | No — seeded rng and receipt case order; record it. |
| A1-Q2 | Parallelism preference in the app | None; the constant 4. |
| A1-Q3 | Cap parallelism to the account's rate limit | Not measurable here; 4 is the default, `--parallel` overrides, a 429-style agent error fails that eval only and the batch continues. |

## A2 — step rules number what is printed, in the order it is printed (orchestrator, from the preview)

The current draft derives the rule as `rule(Object.keys(titles).indexOf(step) + 1, Object.keys(titles).length, title)`. Two
lies follow: a creator run prints `Step 5 · Team`, then `Step 7 · Invite`, then `Step 6 · Actions` (the invite section is
printed before the actions section but sits after it in the key order), and `of 13` is wrong whenever a step prints no
section (`app` on an unsupported platform or `--no-app`, `invite` for a joiner, `community` under `--quiet`).
Replace it: `rule(i, title)` renders `── Step {i} · {Title} ` padded to 60 columns with `─`, where `i` is a counter that
increments each time a section is actually printed; no total. `src/lib/banner.ts` `rule` drops its `total` parameter;
`banner.test.ts` covers the padding and the counter; a setup test asserts a creator run's rules are numbered 1…N in
print order with no gaps, and a joiner run has no Invite rule and still no gap.

## A3 — the wizard looks like the Codex CLI's setup, and the app's onboarding reflects the same steps (orchestrator, from Teddy: "can we make it look more like the codex setup? Also these changes should also be reflected in the in-app onboarding flow")

A3 supersedes D6/D7 of the base spec and A2 above where they conflict. Everything else in the base spec and A1 stands.
The model is the OpenAI Codex CLI onboarding TUI (`codex-rs/tui/src/onboarding/*.rs` and `selection_list.rs`): a
plain art frame, then `  Welcome to Codex, OpenAI's command-line coding agent` with the product name bold; each
step opens with `> ` plus a bold label; body text is indented two spaces and never boxed; option lists are
numbered, the highlighted row is `› 1. Yes, continue` in cyan while the others are `  2. No, quit`, a dim
description sits under an option indented five spaces; the footer hint `  Press enter to continue` is dim;
outcomes print `✓ Signed in with your ChatGPT account` in green and errors in red; the session header is a
`╭─╮│╰─╯` box whose first row is `>_ OpenAI Codex (v0.50.0)` followed by aligned `key:  value` rows.
We copy those conventions, not their text.

### A3.1 Terminal look (decorated mode only — `decorate(io, args)` exactly as D5; frames, `--quiet`, `NO_COLOR`, `TERM=dumb` and non-TTY output stay byte-identical to today)

- **Mark and welcome line.** Print `MARK` (dim), one blank line, then `  Welcome to terum-skills, your team's skill library.` with `terum-skills` bold. The wordmark/version line is dropped from the top; the version moves to the closing box (A3.1 last bullet). The existing welcome paragraph lines keep their text and are indented like every body line.
- **Welcome has no header.** The Welcome step prints no `> ` header line; the mark and the bold welcome line are its header, exactly as Codex opens.
- **Step header.** Replace `rule()` with `header(title)`: a blank line, then `> ` followed by the title in bold. No step numbers and no total (this replaces A2's numbering; keep A2's rule that a header prints only for a step that prints, in print order). Titles: Welcome, App, Role, GitHub, Team, Invite, Actions, Find skills, Evals, Community, Session hook, Wrapper, Done.
- **Body lines.** Every `io.print` of prose inside a step is indented two spaces (`  `), including question text printed by the terminal prompter and the `[y/N]` / `[default]` suffixes it already prints. Bullets stay `  • …`. Lines that are already indented (the "Next, from any terminal:" command table) get the same two-space prefix and nothing else. No re-wrapping.
- **Selects.** The terminal prompter's `select` prints, in decorated mode: the question (indented), then one row per choice: the default choice as `› {n}. {choice}` in cyan, the others as `  {n}. {choice}`; when `options.descriptions` is given (new optional `AskOptions.descriptions?: readonly string[]`, same length as `choices`), a dim description line follows each row indented five spaces; then the dim hint `  Press enter to choose {n}. {default}, or type a number.`; then the existing readline prompt `> ` unchanged. Typed answers keep today's semantics (a number, or enter for the default). No raw-mode key handling: the wizard must work in Windows conhost, over ssh and with piped stdin, so arrow keys are out of scope for this batch (say so in `docs/frame-protocol.md` next to `descriptions`).
  Descriptions for the wizard's selects (write them verbatim):
  - Role → `Create a new team` / `Creates a private GitHub repository under your account.`; `Join an existing team` / `Uses an invitation from the team owner.`
  - Actions (connect) → per skill `Connects {name} so the team can install it.`; `Skip` / `Connect skills later with \`{invocation} connect\`.`
  - Evals → `Now` / `Runs all {n}, {p} at a time, in this terminal.`; `In batches` / `Asks how many at a time and checks in between batches.`; `Overnight` / `Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.`; `Skip` / `Evaluate any skill later with \`{invocation} eval <skill>\`.`
  `{n}` and `{p}` are the candidate count and `EVAL_PARALLEL_DEFAULT`; `{invocation}` is `invocation(args.form, …)` as used elsewhere in setup.ts.
- **Outcome lines.** A helper `ok(line)` returns `✓ {line}` in green when decorated, else `line` unchanged; `bad(line)` returns `✗ {line}` in red, else unchanged. Apply `ok` to exactly these existing lines: `GitHub: gh is logged in.`, `Created team …`, `Joined …`, `Invited …`, `Connected …`, `Registered …`, `Installed the session hook …`, `Installed the /terum-skills Claude Code skill …`, `Queued … evals …`, `Evaluated … of …; 0 failed.` (only when `failed === 0`). Apply `bad` to `Could not look in …`, `Could not evaluate the shared skills: …`, `Skipping the evals: …`, and the `Evaluated … failed.` line when `failed > 0`. The per-eval settle lines from A1 P3 already carry `✓`/`✗`; colour them the same way in decorated mode.
- **Colour budget.** Five SGR codes, all through one `style(kind, line)` helper in `src/lib/banner.ts` guarded by the D7 TTY rule: bold `\x1b[1m`, dim `\x1b[2m`, cyan `\x1b[36m`, green `\x1b[32m`, red `\x1b[31m`, reset `\x1b[0m`. Nothing else is coloured; no dependency is added.
- **Closing box.** Replace the boxed "Set up" summary with a Codex-style session box printed under the `> Done` header:
  ```
  ╭──────────────────────────────────────────────────────╮
  │ >_ terum-skills (v0.12.2)                            │
  │                                                      │
  │ team:        alpha · you and 1 teammate              │
  │ members:     @alice — Alice                          │
  │              @bob — Bob                              │
  │ repository:  https://github.com/alice/alpha-repo     │
  │ readme:      …/alpha-repo/blob/main/README.md        │
  │ next:        npx -y terum-skills@latest ls           │
  ╰──────────────────────────────────────────────────────╯
  ```
  Labels are left-aligned in a 13-column gutter; long values are not truncated (the box grows; `box()` already sizes to the longest line — the `…` above is only this document's abbreviation). `you and {k} teammate(s)` counts the roster minus yourself; with no teammates the row reads `alpha · just you`. Non-decorated output keeps today's plain `Members:` / `Repository:` / `README:` lines exactly (the app classifies on them).
- **What stays out.** No spinner and no cursor movement (Codex's animation and live spinner need a full-screen TUI; our output must stay a transcript). No re-wrapping to terminal width.

### A3.2 The same changes in the app's onboarding flow (`desktop/`)

The app drives the same wizard over frames, so the copy is shared; what the app must reflect is the new steps and their outcomes. The base spec's "the drawn 14-board flow is final; setup changes are additive" rule is overridden by Teddy for this batch: these additions change what SetupBoot and the prompt dialog show, and the orchestrator will redraw/record the boards afterwards.

- **Ask frames carry descriptions.** `AskFrame` gains optional `descriptions?: string[]` (beside `detail`), written by the frame prompter when `options.descriptions` is set; `desktop/src/backend/tauri/frames.ts` parses it (strings only, dropped when malformed with the same diagnostic path as `detail`), `PromptQuestion.descriptions?: readonly string[]` in `desktop/src/backend/types.ts`, the mock prompter (`desktop/src/backend/mock/run.ts`) and `scriptedPrompter` pass it through untouched, `docs/frame-protocol.md` documents it.
- **Prompt dialog option list.** In `desktop/src/app/providers.tsx` `PromptDialog`, a `select` question renders a radio-style option list instead of the `<select>` element: one row per choice as a `<label>` with a native radio input (`name` = the question), the choice text, and, when descriptions are present, the description under it in the muted text tier (`--tk-text3`, 12px); the default choice is pre-selected; keyboard: arrow keys move within the radio group natively, Enter submits; the Continue button is enabled only when a choice is selected. `detail` lines keep rendering above the list as today. Existing tests that pick from the `<select>` element (`getByRole('combobox')`) move to `getByRole('radio', { name })`; add a test with descriptions and one without.
- **Setup result outcomes.** `SetupResult.steps` values widen to `'done' | 'skipped' | 'printed' | 'queued' | 'batched'` in `desktop/src/backend/types.ts` and the tauri result schema. In `SetupBoot.tsx` the right-column text becomes: `Skipped` for skipped, `Queued` for queued, `Done` for done/batched/printed-as-complete (unchanged rule otherwise). A queued evals step counts as complete (check icon), not pending.
- **Progress while evals run.** While `state.progress?.label === 'evals'` the evals row's right text shows `{done} of {total}` (tabular numerals, the existing `.onboarding-progress-row>span:last-child` tier) and the track uses the same numbers, as it already does for placement. When the frames stop carrying progress (batch check-in confirm or queue), the text reverts to the outcome rule above.
- **Setup output lines.** `setup-session.ts` `printedSetupStep`: lines starting with `Queued `, `✓ ` or `✗ `, and `Evaluating ` (already) map to `evals`; `Evaluated in batches` already maps via `Evaluated `. In the "Setup output" list, lines starting with `✓ ` render in `--tk-good` and lines starting with `✗ ` in `--tk-bad` (a class on the row; no other styling). Add cases to `setup-steps.test.ts` for every new line shape the wizard prints (`Queued 3 evals for overnight: …`, `Queued 2 evals for later. …`, `✓ deploy-check`, `✗ release-notes: Hygiene failed for release-notes`, `Evaluating 3 skills, 4 at a time…`).
- **Mock scenario.** Extend the mock's scripted setup replay (`desktop/src/backend/mock/onboarding.ts` / the setup replay used by `setup-replay.test.tsx`) so the default replay reaches the evals select with `detail` (the estimate line) and `descriptions`, answers `Overnight`, and finishes with the `Queued` outcome; a second replay answers `Now` and streams two `progress` frames plus one `✓` and one `✗` line. Route tests in `desktop/e2e/routes/` assert the dialog shows four radio options with their descriptions and the estimate line, and that the evals row ends as `Queued`.
- **Out of scope for the agent, orchestrator follow-ups:** `desktop/FIDELITY.md` (SetupBoot and the prompt dialog → in-progress with a deliberate-deviation entry naming this amendment), `desktop/GAPS.md`, the redrawn boards, and `.planning/**`.

### A3.3 Tests (add; never delete or weaken)
- `src/lib/__tests__/banner.test.ts`: `header`, `ok`, `bad`, `style` produce plain text when `NO_COLOR` is set or stdout is not a TTY, and the documented escapes otherwise; the closing box renders the example above byte-for-byte given that roster.
- `src/commands/__tests__/setup.test.ts`: a decorated transcript snapshot for a creator run that chooses `Overnight` (mark, welcome line, `> ` headers, the evals select with descriptions and hint, `✓` lines, closing box) and the existing proof that the frames transcript is unchanged apart from the new `descriptions`/`detail` fields on ask frames.
- `src/lib/__tests__/prompt.test.ts`: terminal `select` with descriptions prints the `›` row for the default and accepts a typed number, enter, and an out-of-range retry.
- Desktop: the dialog, SetupBoot outcome/progress and setup-steps cases named in A3.2; the routes spec for the mock replay.
