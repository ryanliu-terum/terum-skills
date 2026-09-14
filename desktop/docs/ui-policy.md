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
- Every **error** (`role="alert"`) and every **log pane** (`role="log"`) is selectable and offers right-click
  "Copy error" / "Copy output" (`useCopyMenu`). A streaming pane copies what is on screen at click time.
- A **value** a person may need elsewhere (a handle, a version, a hash, a path) copies on click (`CopyValue`,
  `Value`) and says "Copied <what>" in the toast; the toast never moves a board.

## §2 A filesystem path is never prose

- A path renders through `PathText`: mono, one line, shortened in the MIDDLE so the root and the folder name both
  stay legible, the full path in `title`, click copies it, right-click offers "Copy path" and the host's reveal
  verb ("Show in Finder" / "Show in Explorer" / "Show in file manager", from `revealLabel`).
- When a list can hold two folders of the same name (Check against the team, Library projects), each row carries a
  **root label** beside the name (`skillRootLabel`: "Global", or the project folder's name) so the rows are told
  apart without reading the path.
- A path never appears inside a sentence, a hint, or a chip label. A CLI message that embeds one (`lstat '<path>'`)
  is shown as the CLI wrote it, but the surface that groups such messages strips the path for the heading (§6).

## §3 A long command collapses; the copy is always the full line

- Past two refs, a command over a list of folders renders as `CollapsibleCommand`: the verb plus a count
  (`npx -y terum-skills@latest eval <28 skills> --batch 4`) with "Show full command" to expand the exact line.
  Both forms copy the FULL command. The summary is for reading, never for running.

## §4 A card row never wraps into another row

- The skill card's bottom row is two groups that never wrap under each other. The LEFT group (version words,
  eval state, size, installs) gives way: labels and chips clip with an ellipsis and carry the full text in `title`.
  The RIGHT group (Reinstall, flags, the enable switch) keeps its width. The one exception is the boards' own
  `.card-version` unit, which is one flex item so a check is never orphaned.
- Nothing in a card renders under `position:absolute` on top of another row's content.

## §5 Work in flight is visible where it started and where it lands

- The top bar carries the eval chip through every state: **Starting eval · name** (no CLI output yet),
  **Evaluating · name** (printing), **Evaluating · n of N** (counting), then **Eval finished / failed /
  stopped · name** with a ✕ to dismiss. Clicking the chip reopens the run's dialog. Only "Stop" cancels a run.
- Every skill card the run covers shows a pulsing dot (`.card-evaluating`, 6 px, the accent colour, still under
  `prefers-reduced-motion`) while the run is on. A `--pending` run's set is decided by the CLI, so no card claims
  it. The dot renders only during a run, so no board moves.
- A dialog's status line is never a bare "Running…" for long: "Starting…" until the CLI prints, "Running…" while it
  prints, the count once it counts, and one summary sentence at the end (`evalManyStatus`).

## §6 Say a thing once, and collapse what is long

- A hint that applies to several rows appears ONCE under the group (the rename footnote in Check against the
  team), never repeated under every row.
- A note that lists many items (Left out of the eval) is one sentence with a count when collapsed
  ("17 of 45 selected skills are left out of the eval — 3 reasons. Show why") and, expanded, groups the items
  under a shared heading with the instance-specific tail stripped (`reasonHeading`); each item keeps its full
  reason on hover and on right-click copy, and "Copy all" copies the note whole.
- Two long lists never render inline with no fold; the drawn boards' fixed-height surfaces stay as drawn.

## §7 Every rule has a test

- A new surface that prints a command, a path, an error or a long list ships with a vitest test that pins the
  rule it satisfies (copy button present, `title` carries the full text, note collapses, chip states). The guard
  test greps for the failure modes the rules forbid.
