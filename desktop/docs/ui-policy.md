# UI policy — what every surface of the desktop app owes the person using it

Adopted 2026-09-14 after Teddy's review of 0.17.0 on Windows (the Update command dialog, a wrapped skill card,
the 28-skill eval dialog, "Check against the team", and the "Left out of the eval" note). These rules bind every
screen, dialog, note and card; a spec that needs an exception says so in writing, in the spec, with the reason.
The primitives that satisfy each rule live in `src/components/domain/Primitives.tsx` and `context-menu.ts`; a
guard test (`src/components/domain/__tests__/ui-policy.test.ts`) fails a build that prints a command outside them.

## §1 Anything the app prints is copyable

- A **command** renders through `CliBox` (copy button + right-click "Copy command" + selectable text),
  `TerminalHint` (the boards' "Prints the command, never runs it" line; right-click copies), or
  `CollapsibleCommand` (§3). Never a bare `<pre>`, `<code>` or prose sentence holding a command. The printed
  string is the CLI's own line verbatim (AGENTS.md invariant 4), never re-derived.
- The CLI's **advice** (update, uninstall) renders through `AdviceBlock`: prose stays prose, each indented line
  is a `CliBox`, and "Copy all" copies the whole printout when the caller has it (`report.lines`).
- Every **error block** renders through `AlertText`, `ErrorLine` or the workflow dialog's error line, and every
  **log pane** (`role="log"`) carries `useCopyMenu`: selectable, right-click "Copy error" / "Copy output". A
  streaming pane copies what is on screen at click time. (An inline `<span role="alert">` inside a settings row
  still relies on the row's own selectable text; converting those is outstanding, not claimed.)
- A **value** a person may need elsewhere (a handle, a version, a hash, a path) copies on click (`CopyValue`,
  `Value`) and says "Copied <what>" in the toast; the toast never moves a board.

## §2 A filesystem path is never prose

- A path renders through `PathText`: mono, one line, shortened in the MIDDLE so the root and the folder name both
  stay legible, the full path in `title`, click copies it, right-click offers "Copy path" and the host's reveal
  verb ("Show in Finder" / "Show in Explorer" / "Show in file manager", from `revealLabel`).
- When a list can hold two folders of the same name (the Library's Sync dialog, Library projects), each row carries a
  **root label** beside the name (`skillRootLabel`: "Global", or the project folder's name) so the rows are told
  apart without reading the path.
- A path never appears inside a sentence, a hint, or a chip label. A CLI message that embeds one (`lstat '<path>'`)
  is shown as the CLI wrote it, but the surface that groups such messages strips the path for the heading (§6).
- A copyable path beside a checkbox is a SIBLING of the checkbox's `<label>`, never inside it, and `CopyValue`
  cancels the click's default: a browser forwards a click on a role=button span to the label's control, so a copy
  would otherwise toggle the row. jsdom does not forward, so this rule has a Playwright test, not only a vitest one.

## §3 A long command collapses; the copy is always the full line

- Past two refs, a command over a list of folders renders as `CollapsibleCommand`: the verb plus a count
  (`npx -y terum-skills@latest eval <28 skills> --batch 4`) with "Show full command" to expand the exact line.
  Both forms copy the FULL command. The summary is for reading, never for running.

## §4 A card row never wraps into another row

- The skill card's bottom row is two groups that never wrap under each other. The LEFT group (version words,
  eval state, size, installs) gives way: every label and chip there clips with an ellipsis and carries its full text
  in `title`, except the size chip, which never shrinks. The RIGHT group (Reinstall, flags, the enable switch) keeps
  its width. Inside the boards' `.card-version` unit the words shrink and the green installed check never clips.
- Nothing in a card renders under `position:absolute` on top of another row's content.

## §5 Work in flight is visible where it started and where it lands

- The top bar carries the eval chip through every state: **Starting · name** (no CLI output yet),
  **Evaluating · name** (printing), **Evaluating · n of N** (counting; for several skills the count stands alone),
  then **Eval finished / failed / stopped · name** with a ✕ to clear. The chip is a *state* and a *subject*
  (`evalChip`): the state, verb and count, is never shortened; the subject, the skill's name or "N skills", is what
  gives way with an ellipsis when the fixed 240 px slot runs out (a name past about nine characters is shortened
  while the run is on; the whole label is in `title` and one click away in the dialog). The longest state in the
  ladder fits beside the square Stop button (named "Stop") and the inbox bell, proven in real Chromium by
  `e2e/routes/eval-chip-fit.spec.ts`. The settled words are the design's own ("Eval finished" is also the Inbox's).
  The chip's `title` carries the whole label and, for a failed run, the CLI's error. Closing a run's dialog never
  forgets the run (`dismiss` closes, `clear` forgets): the chip stays until its ✕ or the next run, and clicking it
  reopens the dialog in its final state. Only "Stop" cancels a run; a busy dialog offers "Keep running" beside it,
  and while the CLI is asking a question that question is modal, so the answer comes first.
- A question never outlives its run. Every question the CLI asks carries its run's signal (`PromptOptions.signal`,
  set by `driveRun`); when the run settles — Stop, a failure, the CLI finishing without waiting — the prompt host
  withdraws the dialog and the driver returns the run's own result, so no dead "Continue?" stays on screen and the
  next eval is never refused as "already running". Pinned by `drive.test.ts`, `prompt-provider.test.tsx`, the
  bulk-eval Stop test and `e2e/routes/eval-chip-fit.spec.ts`.
- Every skill card the run covers shows a pulsing dot (`.card-evaluating`, 6 px, the accent colour, still under
  `prefers-reduced-motion`) while the run is on. Covered means the card's own `localRef` is the run's ref (the path
  for a local folder, so two same-named folders in two roots never light together). A `--pending` run's set is
  decided by the CLI and a queueing run evaluates nothing now, so neither lights a card. The dot renders only
  during a run, so no board moves.
- Every eval dialog's status line comes from one ladder (`runStatus`): "Starting…" until the CLI prints, "Running…"
  while it prints, the count once it counts, then Stopped, the CLI's error, or the summary sentence
  (`evalManyStatus` for several skills).

## §6 Say a thing once, and collapse what is long

- A hint that applies to several rows appears ONCE under the group (the rename footnote in the Library's Sync dialog), never repeated under every row.
- A note that lists many items (Left out of the eval) is one sentence with a count when collapsed
  ("17 of 45 selected skills are left out of the eval — 3 reasons. Show why") and, expanded, groups the items
  under a shared heading with the instance-specific tail stripped (`reasonHeading`); each item keeps its full
  reason on hover and on right-click copy, and "Copy all" copies the note whole.
- Two long lists never render inline with no fold; the drawn boards' fixed-height surfaces stay as drawn.

## §7 Every rule has a test

- A new surface that prints a command, a path, an error or a long list ships with a vitest test that pins the
  rule it satisfies (copy button present, `title` carries the full text, note collapses, chip states). The guard
  test greps for the failure modes the rules forbid.
