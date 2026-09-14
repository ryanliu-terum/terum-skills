# terum-skills — the skill dashboard: `--format` boards and the dashboard skills for Claude Code and Codex

Date: 2026-09-13. Baseline: `main` @ `c05d240` (0.16.0; PR #208 (M1.1 overlays) gives Library rows `localEval.mine` beside `teamEval.mine` — true when a handle this machine holds ran it or when the run carries the no-team placeholder `NO_TEAM_RUNNER_HANDLE = 'local'` — so the Library board's Eval cell names a runner iff the shown receipt's `mine` is false, and adds `cardVersionLabel` (`vN`, desktop cards only; the terminal keeps `Version N`); PR #206 adds `eval [skills...]` — `runMany`, `EvalManyResult { mode, team, skills, ok, failed, queued, stoppedAfter? }`, `--batch`/`--window`/`--pending` — which the `eval` board (§7) renders as a fourth shape, and the hook's `fresh` sync state; PR #198 routes hook notices to stderr, PR #199 gives Library rows `teamEval`/`matchedVersion`/`matchedName`/`matchedTeam`/`knownToTeam` — the §5 "Which receipt (local)" row and the Library board's Eval cell read them, PR #203 makes fixtures canonicalise temp paths; earlier `ccf5931` = 0.15.0 + PR #193, which taught `resolveLibrarySkill` the path grammar §6.1 builds on, + PR #194 `team move` and PR #195 `skill fix` in `FRAME_VERBS`, + `ValidateResult.repairable`, + PR #197: eval assets leave version identity and a finished `eval` publishes a matching receipt itself — `EvalResult.publishedTo`, `--no-commit`; the design was read against `8e479c6`). Amended 2026-09-13 after the implementation read (D11 additive fields, D6 `uncovered`, §6.1 wording, §10 hook rule, §13 snapshot files). Author: Claude (session 5aa8e792), design walked with Teddy.

**Decision (Teddy, 2026-09-13).** No MCP server. The dashboard's basic functions ship as *skills that point at the
CLI* — one `SKILL.md` per command, the same bytes for Claude Code and Codex — and the CLI does the presentation:
a new `--format` output mode renders every read model the `--frames` `result.value` already carries into a
Markdown board (for agent hosts) or an ANSI board (for a person at a terminal). Reason MCP was declined: both hosts
have a shell tool, the CLI is local, `--frames` already serves programs, and a second protocol surface would have to
be kept in step with both. Reason the CLI renders rather than the model: the output is then deterministic,
byte-identical in Claude Code and Codex, unit-testable against a fixture team, and lives in one place beside the
read models it renders (the `serve-verbs.ts` argument).

Parents: `.planning/specs/2026-09-08-bundled-claude-skill.md` (the one managed skill this generalises),
`.planning/reviews/2026-09-07-cli-skill-wrappers-feasibility.md` (run-here / hand-off rules, unchanged),
`docs/frame-protocol.md` (the `value` shapes the boards render).

Teddy's two refinements on the design walk: rendering is the product surface, not a footnote — it carries selection
policies, tables, ASCII, colour and autofill detection (§3–§6) — and every skill table carries a very short
description column (§7).

## 1. Scope

In:

1. `--format <plain|md|pretty|json|auto>` with `--host`, `--rows`, `--width`, `--no-color` (§2).
2. A board model and three backends: `md`, `pretty`, `json` (§3, §4).
3. A selection-policy module the boards obey and the desktop can adopt later (§5).
4. Autofill: argument resolution for read verbs and `eval`, and environment autodetection (§6).
5. Boards for `status`, `ls` (`--local`, team, `member`, `project`, `skill`), `search`, `eval-report`, `eval`
   (run and queue modes), `update`, `sync`, `validate`, `install`, `uninstall-skill`, `project list`; an explicit
   fallback for every other verb (§7).
6. One new verb surface: `ls skill <name>`; two additive result fields: `EvalResult.report`, `LsResult.viewer` (§8).
7. Eight managed skills — `list-skills`, `skill-info`, `search-skills`, `eval`, `eval-report`, `skill-status`,
   `sync-skills`, `terum-skills` — host-neutral prose, quoted frontmatter, the `managed-by` marker (§9).
8. Placement of the whole set into the Claude Code root and the Codex root by `setup`, silent refresh by
   `sync --hook`, removal by machine `uninstall`, rejection by `ls --local`/`connect` (§10).
9. Marker-driven bundling, the release tarball check, docs and tests (§11–§14).

Out (with the reason):

- An MCP server (decided above).
- Any desktop change. The desktop keeps its own `receipt-summary.ts` / `derive.ts`; §5's module is a leaf so the
  desktop can import it in a follow-up and delete its copies.
- `allowed-tools` grants on the shipped skills. Ajay's 2026-09-03 decision reserves grant consent for a human, and
  today's managed skill ships none; unchanged. The user's first `npx -y terum-skills@latest …` permission prompt
  in Claude Code remains.
- Any change to what a write verb does or asks. The run-here / hand-off tables of the feasibility review stand.
- A version bump or release; Ryan's `release-plan` flow owns that.
- Pretty-mode verification on Windows terminals. CI is ubuntu; §13 notes the manual check.

## 2. Output modes

**D1 — global, position-independent flags, stripped before commander.** `src/lib/render/options.ts` (a leaf) reads
and removes, from the argv prefix before the first `--`, exactly as `FRAMES_FLAG` is handled in `src/index.ts`:

| Flag | Values | Default |
|---|---|---|
| `--format <f>` / `--format=<f>` | `plain`, `md`, `pretty`, `json`, `auto` | `plain` |
| `--host <h>` | `claude`, `codex`, `terminal` | autodetected (§6.2) |
| `--rows <n\|all>` | positive integer or `all` | `25` |
| `--width <n>` | integer ≥ 40 | `stdout.columns`, else `100` |
| `--no-color` | flag | colour per §4.2 |

An unknown value is one stderr line (`--format must be one of plain, md, pretty, json, auto.`), exit 1, nothing
runs. `--format` combined with `--frames` is refused the same way (`--frames is already a machine format; drop
--format.`), as is `serve` and `sync --hook` (their stdout is spoken for). The stripped flags are documented in an
"Output" paragraph appended to the root `--help` with `addHelpText('after', …)`, and in `<verb> --help` for the
verbs of §7 through the same mechanism.

**D2 — `plain` is today's output, byte for byte.** No flag changes nothing: every existing test runs unchanged and
pins this. `auto` is `pretty` when stdout is a TTY and `md` otherwise. The shipped skills always pass an explicit
`--format md`; a person types `--format pretty` or `auto`.

**D3 — the board sink.** `src/lib/render/sink.ts` builds the `ExecuteSink` for a board run:

- `io` is a non-interactive Prompter (`interactive: false`): `print` collects lines in order; `confirm`, `text`,
  `select` throw `PromptClosedError(question, 'not-interactive')` — the identical refusal a non-TTY terminal
  produces, so the feasibility review's classification of every verb holds unchanged; `progress` writes a one-line
  progress to **stderr** in `pretty` mode on a TTY and is dropped otherwise.
- `result(outcome)` renders `renderBoard(outcome, lines, resolved, ctx)` and writes it to stdout in one write, followed by a
  newline. `ctx` = `{ format, host, rows, width, color, form, home, now, argv, command }` (§3). A renderer that
  throws is a defect, but the sink still answers: the board becomes the fallback block with one note naming the
  renderer error, so the person is never left with an empty stdout.
- `stderr(line)` still receives the one-line failure and `setExitCode(1)` still fires, so exit codes and stderr are
  exactly what `plain` produces; the board additionally carries the failure (§3, `failure`). A script reading
  stderr and a person reading stdout both see it.
- The update-notice tail (`index.ts`, stderr-TTY only) and `afterVerb` notices are untouched.

**D4 — `json`.** One document: `{"verb","ok","exitCode","error"?,"declined"?,"refused"?,"value"?,"lines":[…]}`
— the result frame minus `t`, plus every printed line. Scripts get in one read what frames spread over many.

## 3. The board model — `src/lib/render/board.ts` (leaf)

A renderer turns a verb's `value` into data; a backend turns data into text. Neither reads disk, env or clock —
everything arrives in `value` and `ctx` — so boards are pure and snapshot-testable.

```
Cell     = { kind:'text', text }               | { kind:'count', n: number|null }
         | { kind:'verdict', verdict:'PASS'|'NEUTRAL'|'FAIL'|null, lift?: number|null, partial?: [number,number]|null,
             stale?: boolean, from?: string|null }   // `from`: the version the receipt came from when not current
         | { kind:'status', tone:'ok'|'warn'|'bad'|'muted'|'info'|'pending', text }
         | { kind:'date', iso: string|null }     | { kind:'path', path }        | { kind:'code', text }
         | { kind:'bar', fraction: number|null, label }   | { kind:'strip', text }   // W/L/T record strips: "WWWWLL"
Column   = { key, label, align?:'left'|'right', priority: 1|2|3, max?: number }   // 1 never dropped; 3 dropped first
Table    = { title?, columns: Column[], rows: Record<string,Cell>[], more?: { count } }   // capped at construction; the footer's command is ctx.command
KV       = { title?, rows: [label, Cell][] }
Text     = { title?, lines: string[], fenced?: 'md'|'text' }
Bars     = { title?, rows: { label, fraction: number|null, value: string }[] }
NextItem = { label, skill?, verb, args: string[] } | { label, raw }   // phrased per ctx.host by the backend (§6.2)
Board    = { title, headline?, resolved: string[], sections: (Table|KV|Text|Bars)[], notes: string[],
             next: NextItem[], failure?: { error, refused?: true, declined?: true, partial?: true } }
```

Sections carry a `kind` discriminator (`table` / `kv` / `text` / `bars`). `ctx` also carries `argv` (the verb's own
argv, so a title such as `Search "term"` can name the term) and `command` (the same, joined, for the `--rows all`
footer). A `NextItem` with `raw` is a command that is not a terum-skills verb (the update advice line).

**D5 — one renderer per verb, a registry, an explicit fallback.** `src/lib/render/verbs/<verb>.ts` exports
`render(value, ctx): Board` and `covered: RegExp[]` (D6). `src/lib/render/registry.ts` maps the `verb` string of
`ResultOutcome` to its renderer; `ls` dispatches on `selection` (D11: member / project / skill detail), then on `local` → Library, else
Marketplace. `FALLBACK_VERBS` lists every verb deliberately rendered as a fenced block
of its printed lines. A test asserts `registry ∪ FALLBACK_VERBS` equals `FRAME_VERBS` plus the queue and
sub-verb keys that produce results (`eval --queue-list` etc. report as `eval`), so an unrendered verb is a decision
in the diff, never an accident.

**D6 — printed lines are never lost.** Each renderer declares `covered`: the printed lines its board reproduces
from `value`. A printed line matching none goes to `notes`, verbatim, in order (a print is split on `\n` first — `eval` prints
its whole report as one string — and an empty line is dropped, never a note). A renderer whose plain output
cannot be matched by pattern (the detail's description and body) declares `uncovered(lines, value)` instead and
decides the notes itself. The snapshot tests (§13) pin the
uncovered set for every fixture scenario, so a verb that grows a new print line surfaces as a diff instead of
disappearing. Verbs whose prints *are* the report (`eval`, `validate`, `sync`, `install`) cover nothing but their
own headers, so their notes carry the report.

**D7 — resolved lines.** The resolver of §6.1 prints `Resolved: …` lines (constant `RESOLVED_PREFIX` in
`src/lib/resolve-ref.ts`); the sink lifts them out of `lines` into `board.resolved`, which every backend renders
first. Same idiom as the hook's reload directive: one recognisable line, one constant, one reader.

**D8 — failure boards.** A failing outcome renders the board of whatever partial `value` exists (the eval drain
case), then a failure block: `md` → `> ❌ <error>` with `(refused)` / `(declined)` / `(partial result above)`
suffixes; `pretty` → the same in red. The one-line error still goes to stderr (D3).

## 4. Backends

### 4.1 `md` — for Claude Code and Codex

Both hosts render the model's reply as Markdown and neither renders ANSI, so `md` never emits an escape
sequence or HTML. Rules:

- Title `## <title>`; headline as a bold line under it; `resolved` as an italic line first.
- Tables are GFM with the full column set (agent hosts wrap; `--width` is ignored), numbers right-aligned by
  `---:`, every cell single-line (newlines replaced by a space, `|` escaped as `\|`).
- Cells: `count` → digits or `—`; `verdict` → `✓ PASS +33%`, `● NEUTRAL ±0%`, `✗ FAIL −20%`, `— not evaluated`;
  a partial run appends ` (4/6 scored)` and a stale one ` ⚠ stale`; a non-current receipt appends ` (v2)`.
  `status` → tone glyph + text (`✓` ok, `✗` bad, `⚠` warn, `◔` pending, `●` info, `—` muted). `date` → relative
  (`2d ago`, `today`) within 30 days of `ctx.now`, else the ISO date (`2026-07-01`). `path` →
  `~/…` relative to `ctx.home` in backticks. `code` → backticks. `bar` → `████████░░ 82%` (10 cells, fraction
  rounded half-even; `——————————` for null). `strip` → the letters in backticks; a strip is drawn from the aggregate record (`WWWWLL` for 4W 2L 0T) — receipts carry no per-case rows (verified 2026-09-13), so order is not claimed, only counts.
- `Text` with `fenced:'md'` → a fenced block tagged `md` (body previews); `fenced:'text'` → a plain fence.
- `Bars` → a two-column table (Label · Bar Value).
- `next` → one line: `**Next:** \`cmd\` · \`cmd\``, each command phrased for `ctx.host` (§6.2).
- `notes` → `**Notes**` then each line as a bullet, verbatim.
- Row cap: `ctx.rows`; the footer `… and 41 more — run \`<command> --rows all\`` when cut.

### 4.2 `pretty` — for a person at a terminal

- Colour when `colorCapable()` (existing: TTY, no `NO_COLOR`, `TERM≠dumb`) or `FORCE_COLOR` is set, and never with
  `--no-color`. `banner.ts`'s `style()` gains `yellow`; tones map: ok green, bad red, warn/pending yellow, muted dim,
  info cyan, names and commands cyan, headers bold, `resolved` dim italic.
- Tables are box-drawn in the `box()` style already used by setup (`╭─┬─╮`, `│`, `├─┼─┤`, `╰─┴─╯`), numbers
  right-aligned, cell text truncated to `Column.max` with `…`. Column dropping: when the table exceeds
  `ctx.width`, priority-3 columns drop first, then priority-2, never priority-1; below 60 columns of width a table
  degrades to a key/value list per row. Width measured in code points (the `box()` rule); East-Asian widths are a
  documented rough edge.
- Height: on a TTY the row cap is `min(ctx.rows, stdout.rows − 12)` so a board fits one screen; the footer names
  `--rows all`.
- Bars use the same block characters; strips colour `W` green, `L` red, `T` dim, `-` dim.
- Progress (`eval`) is a single rewritten stderr line (`\r`), only on a TTY.

### 4.3 `json` — D4. `plain` — untouched code path; no board is built.

## 5. Selection policies — `src/lib/render/policies.ts` (leaf: imports nothing)

Pure functions with the desktop's semantics where the desktop already has them (file references are to
`desktop/src/backend/`), so a later desktop import changes no pixel:

| Policy | Rule | Desktop twin |
|---|---|---|
| Verdict band | PASS if 3(w−l) ≥ n; FAIL if 3(l−w) ≥ n; else NEUTRAL; n = w+l+t; no comparison → null | `mock/derive.ts receipt_of` |
| Lift | round-half-even((w−l)/n·100), text `+12%` / `−5%` / `±0%` | `derive.ts round_half_even`, `lift_number` |
| Partial | `execution_status==='partial'` → `[scored_rows, expected_rows]` shown, verdict dimmed | `receipt-summary.ts` |
| Sign p | the receipt's own `sign_p`, 3 decimals; never recomputed | `receipt-summary.ts` |
| Which receipt (team) | the `receipt`/`evalVersion`/`latestEvalState` limbs `ls` already selected (`selectCardEval`: versions descending, newest per version, invalid or misfiled skipped and reported); `from` = evalVersion when it is not the latest; `invalid` shown when `latestEvalState==='invalid'` | `ls` carries it |
| Which receipt (local) | `localEval` with `localEvalStale` → `stale` (edited since the eval) | `ls --local` carries it |
| Never across receipts | a board shows one receipt's numbers; no averages, no ranking by score | eval-engine spec §12 |
| Marketplace order | installs ↓, then name | `derive.ts top_rated` |
| Library order | state ladder: broken/unreadable → edited → placed → tracked-shared → untracked; then name | — |
| People order | adoption ↓ (installs of authored skills), then handle | `people_by_adoption` |
| Projects order | member count ↓, then name | `projects_by_members` |
| History order | version ↓ (numeric), run id ↓ | `evalReport.ts byVersionThenRun` |
| Local runs | run id ↓ | `evalReport.ts newestFirst` |
| Attention (Library) | failing = local verdict FAIL; not evaluated = no local receipt; edited = health `local-changed`; attention = sum. Update availability is a Marketplace fact (`ls --local` reads no clone) and is not claimed here | `attentionCounts` (minus updates) |
| Update marker (Marketplace) | ▲ on Installs when the viewer's own `people[].installed[]` record for the skill carries a `v<N>` folder numerically older than `latest`; a null version draws no marker (`installedSchema.version` is `persistedVersionSchema`: a `v<N>` folder or null, legacy tree hashes read as null — `schema.ts`; `Installer` rows carry no version) | — |
| Verdict counts | PASS/NEUTRAL/FAIL/not-evaluated over the selected receipts | `verdict_counts` |
| Row cap | `rows` (25) with a `more` footer; `all` lifts it | — |
| Not-offered grouping | >5 rows → grouped by reason with `×N` counts; ≤5 or `--rows all` → individual rows | — |
| Description | first sentence if ≤ 80 chars, else first 80 chars + `…`; Marketplace/search column max 60; single line | — |
| Paths | `~/…` relative to home; ids only in detail key/values, never in tables | — |
| Nulls | `—`, never `0`; self-reports labelled (`local skills (self-reported)`) | frame-protocol.md |
| Eval estimate | cases × k × arms agent runs; minutes = 5·round(seconds/300); dollars rounded; from the receipt's efficiency sums when present, else omitted | `eval_estimate_text` |
| ROI bar | each arm's cost over the costlier arm; null when either cost is missing or both zero | `score-fractions.ts` |

## 6. Autofill

### 6.1 Argument autofill — `src/lib/resolve-ref.ts`

`resolveSkillRef(ref | undefined, { cwd, home, config, stateRoot, team })` returns `{ name, path, how }` or a failure,
and prints one `Resolved: …` line whenever `how !== 'exact'`. It wraps PR #193's `resolveLibrarySkill`, which already
accepts a name **or a folder path** (`refIsPath`, `expandRefPath`) and only ever lands inside a Library root; the
ladder adds the rungs a person at a prompt reaches for. Tried in order:

| Rung | `how` | Rule |
|---|---|---|
| 0 | `cwd` | `ref` absent: walk up from `cwd` to the first folder holding `SKILL.md` and resolve that path through `resolveLibrarySkill` — so, as for any path ref, it must lie under Global or a registered project root; otherwise the failure `Name a skill; the working directory is not inside a library skill folder.` |
| 1 | `exact` | `resolveLibrarySkill(ref)` as today: an exact name, or a path (`refIsPath`); then, when a team is in hand, `findSkill(clone, team, ref)` (exact team name or unique skill-id prefix; its two throws surface as failures). A path ref that misses stops here with PR #193's own message; rungs 2–4 apply to **name** refs only |
| 2 | `case` | unique case-insensitive equality over the candidate names |
| 3 | `prefix` | unique case-insensitive prefix |
| 4 | `substring` | unique case-insensitive substring |
| — | failure | more than one match at the first rung that matches anything: `Ambiguous skill name "de": decision-walk, deploy-check. Name one.` (alphabetical) — never a guess |

The printed line is `Resolved: <name> from the working directory` for rung 0 and `Resolved: "<ref>" → <name>
(case-insensitive match | unique prefix | unique substring)` for rungs 2–4. The candidate set is every Library
entry name (`inventory.entries`, so a rejected folder still resolves and is then refused by `unusableSkillFolder`)
plus the team's readable skill names. A miss after the last rung is the verb's own sentence: `eval` and `publish`
keep theirs, `eval-report` keeps `No skill named or identified by … exists in team …`, `ls skill` says
`No skill named <ref>.`, `validate` keeps `skills/<ref> holds no v<N> folder.`.

**D9 — which verbs get which rungs.** `eval-report`, `ls skill`, `validate` (name mode): rungs 0–4. `eval`: rungs
0–2 only — it is paid, so a prefix never picks the bill; a bare `eval` therefore means rung 0, and the queue modes
are reached only through a queue flag (`--queue-list`, `--drain`, `--dequeue`, `--window`, `--max`, `--parallel`).
Commander declares the argument optional for the rung-0 verbs (`ls skill [name]`, `eval-report [skill]`,
`validate [path|name]`). `search` is already a substring match; unchanged. Every
write verb (`install`, `uninstall-skill`, `publish`, `skill …`) resolves as today: exact only. The candidate set is
the Library names (`ls --local` rows) plus, when a team is configured, the team's skill names; a name that resolves
at rung 2–4 is then passed back through `resolveLibrarySkill` (or `findSkill` for a team-only name) so the folder
or record comes from the one resolver PR #193 made authoritative.

### 6.2 Environment autodetection

| What | Rule | Verified |
|---|---|---|
| Host | `--host`; else `CODEX_SESSION_ID` or `CODEX_THREAD_ID` set → `codex`; else `CLAUDECODE` set → `claude`; else `terminal`. Codex is tested first because a Codex shell started from inside Claude Code carries both and Codex is the inner host | probe 2026-09-13: Codex exports `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_CI=1`, `CODEX_SANDBOX_NETWORK_DISABLED=1`; Claude Code exports `CLAUDECODE=1` |
| Format `auto` | `pretty` if `isatty(1)` else `md` | `tty.ts` |
| Colour | §4.2 | `banner.ts` |
| Width | `--width`, else `stdout.columns`, else 100 | — |
| **Next** phrasing | `claude` → `/skill-info x`; `codex` → `$skill-info x`; `terminal` → `invocation(form, …)` (npx or bare, as the CLI already decides) | — |
| Team | unchanged (`selectTeam`: the only team, or `--team`) | — |
| `--into` | unchanged (`install` defaults to Global without a TTY when no project is registered) | — |

Host detection decides only how **Next** lines are phrased. The shipped skills do not pass `--host`; one file
serves both roots (§9, D13).

## 7. Boards

Column priorities in parentheses; `Desc` is the short description (§5). Every board ends with **Next**.

**Library** (`ls --local`). Title `Library`; headline `N skills across R roots · attention F failing · U not
evaluated · E edited`. Per root a section titled `Global — ~/.claude/skills` or `<label> — ~/<path> (<slug>)`,
with the root state when not `scanned` (absent / unreadable). Table: Skill(1) · State(1) · Eval(2) · Desc(2) ·
Path(3). State: `placed v3` / `untracked` / `shared` / `edited ✎` / `broken`. Second table `Cannot be connected`:
Skill(1) · Reason(1) · Path(3), grouped per §5. `problems` → notes. Next: `/skill-info <first not-evaluated>`,
`/eval <same>`, and `project add` when no project root is registered.

**Marketplace** (`ls`). Title `Marketplace — <team>`; headline `N skills · M members · P projects · PASS a ·
NEUTRAL b · FAIL c · not evaluated d`. Skills table: Skill(1) · Desc(2, max 60) · Author(3) · Category(2) ·
Ver(1) · Installs(1, ▲) · Eval(1) · Updated(3). People table: Handle(1) · Name(2) · Role(3) · Installed(1) ·
Authored(1) · Local skills(3, self-reported). Projects table: Project(1) · Skills(1) · Members(2) · Remotes(3). `problems` →
notes. Next: `/skill-info <top skill>`, `/eval <first not evaluated>`, `/terum-skills install <first not installed by viewer>`.

**Member** (`ls member <h>`). Title `@handle — name`; key/values role, projects; Installed table: Skill · Version ·
Scope · Since; Profile table: Skill · Version · Via · Added (the member limb gains `displayName`, per-install
`name`/`version`, and `profile`, D11).

**Project** (`ls project <n>`). Title; key/values remotes, members; Skills table as Marketplace minus People.

**Skill detail** (`ls skill <name>`, §8). Title `<name> — Version 3 (3 versions)`; the full description; key/values id,
author, category, endorsement, grants (or `—`), installs, updated, latest; Installed by table: Handle · Version ·
Scope · Since; Eval: the receipt headline line (`✓ PASS +33% · 4W 2L 0T (n=6) · p=0.031 · complete · model k
runner when`, `(from v2)` / `invalid` per §5); Body preview: first 30 lines fenced `md`, then `… N more lines`.
Next: `install`, `eval`, `eval-report`.

**Search**. Title `Search "term"` with active filters (from `ctx.argv`); headline `N hits` or `No skills found.`; table as the
Marketplace skills table.

**Eval report** (`eval-report`). Title `Eval report — <name>`; key/values placed / team current / evaluated, the
`from v2` note and the invalid-newest note; **Latest receipt**: headline line; Comparisons table: Comparison ·
W · L · T · Lift · p; Arm scores as bars; Efficiency table: Arm · Turns · Time · Cost, plus the ROI bar;
Triggers line `recall 0.80 · precision 1.00 (tp fn fp tn)` with each MISS / FALSE-FIRE prompt listed;
No per-case table: the receipt schema (`src/lib/evals/receipt.ts`) carries verdict, comparisons, arm scores,
triggers and efficiency, and no per-case rows (verified 2026-09-13); the record strip stands in; provenance line. **History** table: Version · Run · Verdict · Lift ·
W/L/T · Model · Runner · When. **Local runs** table: Run · Status · Committed · Verdict. Next: `eval <name> --k 3`,
`publish <name>`.

**Eval** (run). Title `Eval — <name>`; the same receipt sections built from `report.aggregate` and
`report.triggers` (§8); the generated-assets announcement and hygiene warnings arrive as notes (D6); key/values
run dir, receipt path, cc version, execution status, and (PR #197) `published to <team> (Version N)` when
`publishedTo` is set — the print `Published this receipt to …` is covered by that key/value; the print `The eval is
complete and saved locally, but publishing its receipt failed: …` stays a note; `alreadyEvaluated` renders a
one-line board. Queue modes: `--queue-list` → table Skill · Team · Digest · Window · Queued; `--drain` → table
Skill · Outcome · Detail from `outcomes` (D11) and then the remaining queue; `--dequeue` → the remaining items.
Next: `publish <name>` when `shareHint`, `eval-report <name>`.

**Status**. Title `terum-skills <version>`; per team a section `Team <name> — you are @handle` with key/values
repository, clone (the exact wording `status` prints today: absent / foreign / incomplete / ok), synced (`3h ago`,
`⚠ stale` when `stale`), membership, policy license, categories; Members table: Handle · Name (`(you)`);
Pending table: Op · Skill id · Scope · Version · Started; Placements table: Path · Team · Version · Scope ·
Placed; Identity key/values; Tools key/values (`git ✓`, `gh ✗`); host/process arch when they differ (the
Windows-on-ARM case). No team → the three get-started lines as the headline, and the Library hint. Next: `sync`
when stale, the retry command per pending op, `setup` lines when no team.

**Update**. Title `terum-skills <running>`; key/values latest, observation, launch; advice lines; Next: the update
command.

**Sync**. Title `Sync`; table Team · State · Changed · HEAD · Detail; notices as notes. **Validate**: Title
`Validate — <name>`; `ValidateResult` gains `directory` (the folder checked) so Next can name it; headline `N findings · M warnings · R repairable` from `ValidateResult { name, findings, warnings, repairable }` (counts only; `repairable` is what `skill fix` would change);
every printed finding line lands as a note (the renderer covers only its header), and both counts zero is the
headline `No findings.`; Next offers `skill fix <path>` when `repairable > 0`. **Install**: table Id · Version · Path · Profiled from `InstalledResult[]`; consent and
replace outcomes arrive as notes. **Uninstall-skill**: table Id · Team · Removed from `UninstalledResult[]`.
**Project list**: table Path · Label · State · Skill folders from `ProjectRow[]`; `project add` / `remove` are
one-line boards. Everything else: fallback (D5).

## 8. Verb surface

**D10 — `ls skill <name>`.** A third `ls` subcommand beside `member` and `project`, `LsArgs.kind:'skill'`. It
answers from the team record when the name is a team skill, otherwise from the Library row (`ls --local`'s row for
that folder: state, path, health, local receipt, description, frontmatter, body); a name in neither is the failure
`No skill named …`. A team-less machine therefore still gets a detail board. Result: `LsResult` with `skills`
holding the one team record (with `body`, `frontmatter`, `installedBy`, `receipt` as `ls` already builds them) or
empty, `local` holding the one Library row or empty, `projects` filtered to the lists holding it, `roster` and
`problems` as for `ls`, and the new `viewer`. Resolution through §6.1 (rungs 0–4) over Library + team names.
Plain output: the record's `format()` line, its description, then the body — the same information `ls` prints,
for one skill. The detail board's **Next** offers `eval-report <name>` only for a team skill; `skill-info` reads
that cue (§9).

**D11 — additive result fields, protocol unchanged.** `EvalResult.report = { aggregate, triggers }` — the
`Aggregate` and `TriggerSummary` `eval` already computed for `renderReport` (the normal run; the already-evaluated
path carries none) — and `EvalResult.receiptPath` (declared today, never assigned) set to `<runDir>/receipt.json`;
`EvalQueueResult.outcomes = { skill, team?, ok, error? }[]` on `--drain`, one per attempted item, so the drain board
can name the successes that leave `items`; `LsResult.viewer = { handle, team }` on the team reads (`selectTeam`
already has both); `LsResult.selection = { kind:'member', handle } | { kind:'project', name } | { kind:'skill',
name, source:'team'|'library' }` on the narrowed reads (today `ls project <n>`'s value does not carry the project's
name); `LsResult.member` gains `displayName`, `installed[].name` / `installed[].version` and `profile`;
`Installer` rows gain `version`; `ValidateResult.directory`. All additive; `docs/frame-protocol.md` gains one line
for `ls` and one for `eval`; `hello.protocol` stays 1.

## 9. The skills

**D12 — eight managed skills, canonical under `.claude/skills/<name>/SKILL.md`.**

| Skill | Invoked as | Command it runs | Board |
|---|---|---|---|
| `list-skills` | `/list-skills [--local\|--team]`, `$list-skills` | `ls --local --format md`, then `ls --format md` (one of them with the flag) | Library, Marketplace |
| `skill-info` | `/skill-info <name>` | `ls skill <name> --format md`; then `eval-report <name> --format md` when the detail board's **Next** offers it (a team skill) | Skill detail, Eval report |
| `search-skills` | `/search-skills <term> [--category --author --project]` | `search … --format md` | Search |
| `eval` | `/eval <skill> [flags]` | `eval … --format md`, in the background | Eval |
| `eval-report` | `/eval-report <skill>` | `eval-report … --format md` | Eval report |
| `skill-status` | `/skill-status` | `status --format md`, then `update --format md` | Status, Update |
| `sync-skills` | `/sync-skills` | `sync --format md` | Sync |
| `terum-skills` | `/terum-skills <verb …>` | any verb, `--format md` | that verb's board or fallback |

Frontmatter of each: `name` (= folder), a **quoted** `description` (the HYG1 defect that already excludes five
skills from sharing), `metadata: { managed-by: terum-skills, short-description: "…" }` (Codex reads
`short-description`; Claude Code ignores it). No other top-level key. The bundler (§11) refuses a marked file
missing `short-description`.

**D13 — one file, both hosts.** The body never names a host-specific tool: "your shell tool", "ask the user",
"show the board verbatim". The CLI autodetects the host (§6.2), so no host flag is passed. `$ARGUMENTS` appears
once, in the line `Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS")`; Codex
leaves the literal in place, which the model reads correctly.

Body contract, in this order, for every named skill:

1. **Command** — the exact `npx -y terum-skills@latest … --format md` line(s), the only invocation form
   (`docs`: never a bare binary, checkout entry or `node dist/index.js`).
2. **Before** — what to confirm with the user (nothing for reads; the cost line for `eval`, built from
   the estimate the board shows; the "fetches and resets the disposable clone" disclosure for `sync`).
3. **After** — show the board verbatim as the answer; do not re-summarise unless asked; when the board's
   **Notes** or failure block name a hand-off, say plainly "run this in a terminal" with the command.
4. **Rules** — the four that never change: no TTY (never pipe `y`, never `expect`, never `--frames` to dodge a
   question), no `` !`command` `` injection, no `cd` (absolute paths), exit 1 is a result, not a retry.
5. **Sandbox** (Codex) — when `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` so a
   cached package resolves without the registry, and hand off the verbs that need the network (`sync`, `update`'s
   probe, `install`, `publish`, `invite`, `eval`) with the reason. **The plan verifies `--prefer-offline`
   against a warm npx cache before this line ships**; if it does not hold, the line becomes "ask the user to
   run Codex with network access for terum-skills".

`terum-skills` keeps its two tables (run here / hand off) from the current manual, rewritten to the `--format md`
invocation and with one new opening rule: when the request maps to a named skill, use that skill's command. Its
run-here table gains `skill fix <abs-path>` (PR #195: asks nothing, rewrites the folder's SKILL.md for the hygiene
faults with one right answer — confirm with the user first, as for `install`; its board is the fallback block of
its notices) and `team move` joins the terminal hand-off table beside the other `team` administration verbs.
`eval` keeps the current manual's eval section (what a run buys, `--triggers-only` first look, `run_in_background`,
model flags) and adds the estimate line the board shows.

The repo-local `.claude/commands/{eval,ls,…}.md` thin commands are rewritten to point at the named skills
(`ls.md` → `list-skills`, `eval.md` → `eval`, the rest → `terum-skills <verb>`); they stay repo-local as before.

## 10. Placement

**D14 — `wrapper.ts` generalises from one skill × one root to the managed set × two roots.** The managed set is
discovered at runtime from the bundle: every `dist/claude/skills/<name>/SKILL.md` whose frontmatter carries the
marker and whose `name` equals `<name>` (`readdir`, then `isManagedWrapper` — an unmarked or misnamed file is a
build defect the bundle script already refuses, §11). Roots: `MANAGED_SKILL_ROOTS(home, env)` =
`[~/.claude/skills, <CODEX_HOME or ~/.codex>/skills]`, defined in `wrapper.ts`; `AGENT_PATHS` is **not** extended,
so `isSkillsRoot` and the Placer's removal rule are untouched.

States are per (skill, root), the five of the parent spec, judged with `lstat` and never following links. Writes
stay atomic (temp file beside the target, fsync, rename). Aggregation:

- `offerWrapper` (setup, step `wrapper`): one question, once, naming both roots and the skill names:
  `Install the terum-skills skills for Claude Code and Codex so they can run terum-skills for you? (writes
  ~/.claude/skills/{list-skills, …} and ~/.codex/skills/{…})`. The Codex root is written only when
  `CODEX_HOME`/`~/.codex` exists as a directory; otherwise the offer names the Claude root alone and prints
  `No ~/.codex on this machine; Codex skills skipped.` The question is asked only when no root holds any managed copy (a first install); once any root does, missing
  copies are written and outdated ones replaced without a question (the parent spec's consent-once reading); foreign entries are named and left alone; `unavailable` (a source
  checkout) is one line. Outcome: `installed` when any copy was written for the first time, `replaced` when only
  refreshes happened, `present`, `declined`, `foreign` (every destination foreign), `unavailable`.
- `sync --hook`: in every root that already holds at least one managed copy (consent on record) it refreshes every
  outdated managed copy and writes every missing one — a CLI upgrade that adds a skill reaches a machine that never
  re-runs setup; a root with no managed copy is left alone (never a first install without the question). The one
  notice becomes `Updated your terum-skills skills for this CLI.`
- Machine `uninstall`: inventory lists each managed copy per root (and each foreign folder, left alone); removal
  after the hook and before the teams; a removal failure stops the run, as today. `wrapperRemoved` stays a
  boolean (true when any copy was removed — the desktop reads it); additive `wrappersRemoved: string[]` names them.
- `ls --local` / `connect`: `skill-source.ts` already rejects any marked SKILL.md under any folder name before the
  field checks (verified); only the message generalises: `a terum-skills skill that ships with terum-skills; not a
  team skill`.
- Migration: the existing `~/.claude/skills/terum-skills` managed copy is simply `outdated` and is replaced; nothing
  else moves.

## 11. Build and release

**D15 — the marker decides what ships.** `scripts/bundle-skill.mjs` scans `.claude/skills/*/SKILL.md`, bundles
every file carrying the marker to `dist/claude/skills/<name>/SKILL.md` byte for byte, and fails the build when a
marked file's `name` differs from its folder, its `description` is not a quoted or block scalar, or it carries a
top-level key outside `name`, `description`, `metadata`, or lacks `metadata.short-description`. It reports one
stderr line per file (`Bundled <src> -> <dst>`; prepack keeps stdout parseable). Unmarked skills in that folder (the review tools) are never bundled.

`release.yml`'s tarball must-list gains the eight paths (a literal list; the new
`src/__tests__/release-tarball-list.test.ts` parses that array out of the workflow and asserts it names every
marked skill under `.claude/skills/`). `bin.test.ts`
and `bundle.test.ts` assert the whole set.

## 12. Failure modes

| Situation | Behaviour |
|---|---|
| Bad `--format` / `--rows` / `--width` value | one stderr line, exit 1, nothing runs |
| `--format` with `--frames`, `serve`, or `sync --hook` | refused, one line, exit 1 |
| Verb asks a question under `--format` | `PromptClosedError` → failure board + the existing stderr line, exit 1; completed work stays visible in notes |
| Failure with a partial value | partial board, then the failure block, `(partial result above)` |
| Renderer receives unexpected data (null limb, missing field) | every cell constructor is null-safe; a renderer never throws — the null-safety test feeds each renderer `{}` and `null` limbs |
| Verb without a renderer | fallback fenced block; the registry test makes this deliberate |
| Ambiguous or unresolvable autofill | failure naming the candidates; no guess; exit 1 |
| No team on the machine | Library boards render; team boards render the get-started headline; `skill-info` skips the report half |
| `~/.codex` absent | Codex placement skipped with one line |
| Foreign folder at a destination | named, left alone, never overwritten |
| Source checkout (no bundle) | `unavailable`, one line, nothing written |
| Not a TTY, `pretty` requested | rendered without colour; width 100; no progress line |
| `NO_COLOR` set | no colour even on a TTY; `FORCE_COLOR` wins only with `--format pretty` |
| Codex sandbox without network | the skill's sandbox rule (§9 item 5) |

## 13. Tests

- `src/lib/render/__tests__/options.test.ts` — the pre-parser: every flag, `=` form, position independence, the
  `--` boundary, bad values, the three refusals.
- `src/lib/render/__tests__/policies.test.ts` — every row of §5 with the desktop's own examples (verdict bands at
  the boundaries, half-even rounding, lift text signs, ordering ties, grouping threshold, truncation, null rules).
- `src/lib/render/__tests__/boards.test.ts` — one `toMatchFileSnapshot` per board × {`md`, `pretty` (colour on,
  width 100), `pretty` (no colour, width 70 → column drop), `json`} from typed fixtures: the fixture team of
  `review/2026-09-08-desktop-blank-map/fixture.sh` ported to `src/lib/__tests__/fixtures.ts` as `dashboardTeam()`
  (3 skills, 3 people, one placement, receipts at two versions, one invalid receipt, one edited local folder, one
  symlinked and one invalid-YAML local folder), the empty machine (no team), and the partial-eval case. The
  uncovered-print set per scenario is part of the snapshot (D6). Snapshots are reviewed by eye once at the plan's
  review checkpoint. Files live in `src/lib/render/__tests__/__snapshots__/<scenario>.<board>.<backend>.txt`;
  the fixture's temp root and home are replaced by `<ROOT>` and `<HOME>`, git dates are pinned through
  `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`, `ctx.now` is a constant, and machine facts (`version`, `hostArch`,
  `processArch`, `tools`) are overwritten on the value before rendering.
- `src/lib/render/__tests__/registry.test.ts` — D5's exhaustiveness; null-safety of every renderer (§12).
- `src/lib/__tests__/resolve-ref.test.ts` — the ladder, D9's per-verb rungs, cwd walk inside/outside a root, the
  ambiguity failure, the `Resolved:` line.
- `src/__tests__/format-cli.test.ts` — mirrors `frames-cli.test.ts`: every verb through commander with the board
  sink, the stub verb's prints and refusal, exit codes, stderr unchanged, `plain` byte-identical to today.
- `src/lib/__tests__/wrapper.test.ts`, `setup.test.ts`, `m3-setup-walkthrough.test.ts`, `install.test.ts`,
  `uninstallMachine.test.ts`, the sync/refresh tests, `local-skills.test.ts` — extended to the set × two roots, the
  absent-Codex case, the migration of the old single copy, the generalised notices.
- `src/__tests__/bin.test.ts`, `bundle.test.ts` — the bundle script over the set, the tarball list, the built bin
  running `--format md` and `--format json` boards for `status`, `ls --local`, `ls`, `ls skill`, `search`,
  `eval-report`, `update` against `dashboardTeam()`.
- `src/__tests__/skill-prose.test.ts` — every bundled SKILL.md: quoted description, allowed keys only, the
  `Command` line's verbs ⊆ the registered commander commands (a superset of `FRAME_VERBS`), every `--format md` command parses through the pre-parser, no
  host-specific tool name (`Bash(`, `AskUserQuestion`, `request_user_input`), the four rules present. The seven new
  skill files are not added to the invocation tripwire's document list (the manual stays its only skill document);
  this test is their gate.
- `cli-hints.test.ts` / the invocation-literal catalogue — the new lines classified.
- Manual, recorded in the run record, not CI: `claude -p "/skill-status"` and `codex exec '$skill-status'` against
  `dashboardTeam()` under a scratch HOME; `--format pretty` in Windows Terminal and macOS Terminal; the
  `--prefer-offline` check of §9.
- Gates: `npm run lint && npm run typecheck && npm test` green; desktop untouched (`git diff --stat desktop/` empty).

## 14. Docs

- `README.md`: a section "From Claude Code and Codex" listing the eight commands with one line each, and the
  `--format` paragraph under "CLI Commands".
- `docs/frame-protocol.md`: the two additive fields (D11); a note that `--format` and `--frames` are exclusive.
- The manual (`.claude/skills/terum-skills/SKILL.md`) rewritten per §9; `.claude/skills/README.md` rows for the
  eight; `.claude/commands/*.md` repointed.
- `desktop/GAPS.md`: one line that `src/lib/render/policies.ts` is the CLI-side twin of `receipt-summary.ts` /
  `derive.ts` and the follow-up is to import it. A second line that `desktop/src/components/domain/MachineRemovalHost.tsx` still prints `/terum-skills skill:` — the desktop uninstall copy predates the managed set (Plan 2 Task 5).

## 15. Not built here (follow-ups)

- The desktop importing `policies.ts` and deleting its copies.
- `--format` inside `serve` (a per-request `format` field) — the desktop has its own renderer; a script wanting
  boards over a warm session is not a known caller.
- `allowed-tools` on the shipped skills (Ryan/Ajay's call).
- A `--format` default of `auto` for humans, once Ryan has seen the boards.

## 16. Files

New: `src/lib/render/{options,sink,board,cells,registry,md,pretty,json,policies,text}.ts`, `src/lib/render/verbs/*.ts`,
`src/__tests__/{format-cli,skill-prose,release-tarball-list}.test.ts`, `src/lib/__tests__/fixtures.ts` (`dashboardTeam()`),
`src/lib/resolve-ref.ts`, `.claude/skills/{list-skills,skill-info,search-skills,eval,eval-report,skill-status,sync-skills}/SKILL.md`,
the tests of §13.
Changed: `src/index.ts` (pre-parser, sink), `src/cli.ts` (`ls skill`, help text), `src/commands/{ls,eval,evalReport,validate,setup,refresh,uninstallMachine}.ts`,
`src/lib/{wrapper,banner,skill-source}.ts`, `scripts/bundle-skill.mjs`, `.github/workflows/release.yml`,
`.claude/skills/terum-skills/SKILL.md`, `.claude/skills/README.md`, `.claude/commands/*.md`, `README.md`,
`docs/frame-protocol.md`, `desktop/GAPS.md` (one line).
