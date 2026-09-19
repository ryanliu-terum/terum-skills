# Which skills actually fire

An eval tells you whether a skill helps when it runs. `usage` tells you whether it runs at all, and
whether the model picked it or a person had to name it.

```sh
npx -y terum-skills@latest usage [skill] [--since <iso>] [--all] [--json]
```

The number the verb exists for is a skill with `0 autonomous, N explicit`: people reach for it, and
the model never chooses it from its description.

## What it reads

Claude Code's own session transcripts, at `~/.claude/projects/<project>/<session>.jsonl`
(`%USERPROFILE%\.claude\projects\…` on Windows). The scan is exactly one level deep, so the nested
subagent and workflow transcripts that live deeper are not counted. A missing projects directory is
an empty result, not an error.

It does not read the session hook, a log file, or anything on the network.

## What an event is

Four fields and nothing else: the detector that saw it, the skill name, the timestamp straight from
the record, and the entrypoint.

Two detectors, because a slash-invoked skill writes no `Skill` record at all:

| Detector | Evidence | Meaning |
| --- | --- | --- |
| **D1, autonomous** | An assistant `tool_use` block named `Skill`; the skill name is `input.skill` | The model chose it from the catalog |
| **D2, explicit** | `<command-name>/name</command-name>` in a user message | A person named it |

D2 is additional to D1, never a subset. Claude Code's own 39 built-in slash commands (`clear`,
`compact`, `model`, `review`, `resume` and the rest) travel in the same envelope, so they are
excluded by name.

Records that are not a person at a terminal are filtered out by one field pair,
`entrypoint === 'cli'` and `isSidechain !== true`. That is what keeps every eval sandbox and every
subagent session out of the counts. A malformed line is skipped rather than fatal, and a truncated
final line is the normal shape of a file Claude Code is still appending to.

An unreadable transcript is reported and not counted:

```
warning: could not read /home/you/.claude/projects/foo/bar.jsonl (EACCES: permission denied); its firings are not counted.
```

## The archive and the 30-day window

The default window is the last **30 days**, because Claude Code prunes transcripts at roughly that
age. Without something else, the report would be permanently capped at whatever the last 30 days
still hold.

That something else is one append-only file:

```
~/.terum/skills/run/usage-events.jsonl
```

Every run appends the events it has scanned, before it reports, so each run widens what the next one
can see. The dedup key **is** the four-field tuple, so appending the same event twice adds one line,
not two. No session id, no file path and no cursor is ever persisted, and there is no free text in
it at all.

The retention rule is deliberate and worth stating plainly: **the default window is answered from
transcripts alone.** The archive is consulted only when `--since` names a moment earlier than 30 days
ago. Deleting the archive therefore changes no number today's report prints. It only shortens how far
back a `--since` can reach.

`--since` takes an ISO-8601 lower bound and replaces the 30-day default. The upper bound is always
now.

The value is never parsed. It is compared as a plain string against each record's own timestamp and
against the 30-day default, so an ISO-8601 UTC timestamp sorts correctly and anything else compares
wrongly instead of being refused.

## The report

```
handoff             0 autonomous    7 explicit  ·  never chosen from its description
decision-walk       2 autonomous    4 explicit
deploy-check        9 autonomous    0 explicit  (placed mid-window)
14 skills placed here and never fired in this window.
3 fired names had no placement here; pass --all to list them.

Counts are invocations, not outcome-changing uses; reopenings are not deduped.
30-day window: Claude Code prunes transcripts, so earlier use is visible only where this machine has already archived it.
```

**A row is a placement.** The row set is Terum's placements ledger: there is one row for every skill
this machine has placed, zero-filled when it never fired. A team skill you never installed has no
row, because the question ("did the model pass it over?") is only askable about a skill that was
actually available. The row's name is the basename of its placement path; when the same skill is
placed in more than one scope, the earliest placement date wins.

| Part of a line | Meaning |
| --- | --- |
| `N autonomous` | D1 firings in the window: the model chose it |
| `M explicit` | D2 firings in the window: a person named it |
| `· never chosen from its description` | Printed when autonomy is exactly 0, which means it fired only because people named it. This is the annotation the verb exists for. |
| `(placed mid-window)` | It was placed after the window opened, so it was only available for part of it |
| `(availability unknown)` | The ledger records no placement date for it |

A skill placed after the window closed is not a row at all.

Rows that never fired are not printed, but they are counted:

```
14 skills placed here and never fired in this window.
```

When nothing fired and nothing is in the tail, the first line is `No placed skill fired in this
window.` instead.

**The unrecognised tail** is fired names with no placement on this machine: a folder you put in
`~/.claude/skills` by hand, or a skill from somewhere else entirely. They are never folded into a
row, because nothing can be said about how long they were available. By default you get a one-line
hint. With `--all`, or when you named a single skill, they are listed under their own heading:

```
Fired here, but not placed by this machine — so how long it was available is unknown:
codex-spec          0 autonomous    5 explicit
```

**The two caveats print every time**, at the end, and no flag suppresses them:

> Counts are invocations, not outcome-changing uses; reopenings are not deduped.

> 30-day window: Claude Code prunes transcripts, so earlier use is visible only where this machine
> has already archived it.

They are the reason the report stays honest. A count that implied a skill *helped* is the one thing
this report must never print.

### Ordering

Rows sort by the argument they make, not alphabetically: skills that fired come first, then ascending
autonomy, then descending explicit count, then by name. The skills people reach for and the model
never picks end up at the top. Never-fired rows sort last, because they say nothing about the
description.

### Naming one skill

```sh
npx -y terum-skills@latest usage handoff
```

The corpus scan is the same; the filter is applied afterwards. The tail is narrowed to that name and
always listed, so a skill that fired from a copy Terum did not place still shows its counts instead
of hiding behind the `--all` hint. When the named skill has no placement row, the whole-machine
"placed here and never fired" tally is omitted, because it would be noise.

### `--json`

`--json` prints the aggregate object instead of the table: `since`, `until`, `rows`, `unused`,
`unrecognised`, `caveats`, plus `archived` (how many events this run added), `problems` (the
unreadable transcripts) and `usedArchive`. Every row carries `skill`, `label`, `d1`, `d2`,
`autonomy` and `availability`.

## What it does not do

No fetch. No clone lock. No agent, no model call. It reads the team repository not at all and your
transcripts read-only. Its **only** write is the append to the machine-local archive described above,
and nothing in it ever leaves this machine.

## In the app

A skill's **Activity** tab draws these counts and only these counts. It runs `usage --json` once,
with no skill argument, and filters client-side: `usage <skill>` costs the same whole-corpus scan as
an unfiltered one, so one read serves every skill page.

The tab shows the two numbers under the heading `Skill firings` with `last 30 days` beside it, then
whichever of these applies:

| State | What it says |
| --- | --- |
| Nothing observed | `No firings recorded for this skill in this window.` This is not the same as "not installed": the model reads transcripts, not the filesystem. |
| Placed, never fired | `Placed here and never fired in this window.` |
| Fired, autonomy 0 | `Never chosen from its description — people reach for it by name, the model never picks it.` |
| Fired, no placement row | `Terum did not place this copy, so how long it has been available is unknown.` |
| Placed mid-window | `Placed part-way through this window, so it was only available for part of it.` |
| No placement date | `Availability unknown — the ledger records no placement date for this skill.` |

The CLI's two caveats are repeated underneath, verbatim. On a terum-skills version that cannot report
firings, the tab says so and offers nothing.

The rest of the drawn activity feed does not exist yet. The tab says so: `Install, publish and
eval-run history will land on this tab too; only firings are recorded so far.`

## Related

- [Running an eval](running-evals.md)
- [Results and receipts](results-and-receipts.md)
- [The desktop app](../guides/desktop-app.md)
- [Local state](../reference/local-state.md)
- [CLI reference](../reference/cli.md)
