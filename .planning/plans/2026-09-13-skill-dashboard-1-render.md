# Skill dashboard — Plan 1 of 2: the render pipeline (`--format` boards, policies, autofill, `ls skill`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every read model the CLI already returns renders as a deterministic board — Markdown for Claude Code and Codex, ANSI for a terminal, one JSON document for scripts — behind a global `--format` flag, with selection policies, argument autofill, and one new verb surface (`ls skill <name>`), while `plain` output stays byte-identical.

**Architecture:** A leaf pre-parser (`src/lib/render/options.ts`) strips the global flags before commander, exactly as `--frames` is stripped today. When a board format is on, `src/index.ts` hands `createExecute` a *board sink* (`src/lib/render/sink.ts`) whose Prompter collects prints and refuses questions, and whose `result()` renders the verb's `ResultOutcome` through a per-verb renderer registry (`src/lib/render/registry.ts`, `verbs/*.ts`) into a pure `Board` (`board.ts`) that one of three backends (`md.ts`, `pretty.ts`, `json.ts`) turns into text. Policies live in a leaf module (`policies.ts`) with the desktop's semantics. Autofill is `src/lib/resolve-ref.ts`, wrapping PR #193's `resolveLibrarySkill`. Nothing in `src/lib/render/` reads `process.*`, disk, env or clock — everything arrives in `value` and `ctx` — so boards are snapshot-tested against a fixture team.

**Tech Stack:** TypeScript ESM (node ≥ 22.12), commander 15, zod 4, vitest 4 (`toMatchFileSnapshot`), esbuild bundle. No new dependencies.

**Spec:** `.planning/specs/2026-09-13-skill-dashboard.md` (baseline `main` @ `c05d240`). This plan implements §2–§8 and the render half of §13–§14. Plan 2 (`2026-09-13-skill-dashboard-2-skills.md`) implements §9–§11 and the rest.

## Global Constraints

- Worktree: `/home/teniroo/Projects/terum-skills-codex/skill-dashboard`, branch `feat/skill-dashboard`, base `4cf8e30` (0.16.0; PR #213 skill copy, PR #218 share-hint print + edit hook, PR #215 install/uninstall internals, PR #211 Library rows' `updated`, PR #217 harness docs only, PR #216, #214 and #212 desktop-only, PR #210 added `ValidateResult.repairs`, PR #208 gave Library rows `localEval.mine` and the `local` placeholder handle, PR #206 added `eval [skills...]` with `--batch`/`--window`/`--pending` (`runMany`, `EvalManyResult`) and the hook's `fresh` sync state, PR #198 routes hook notices to stderr, PR #203 canonicalises fixture temp paths, PR #199 gave Library rows `teamEval`, `matchedVersion`, `matchedName`, `matchedTeam`, `knownToTeam`). Never touch the primary checkout (another session owns it). Absolute paths in every shell command; no `cd` (AGENTS.md).
- No new dependencies, no network clients, no `console`/`process.stdin|stdout|stderr|exit|exitCode` outside `src/lib/prompt.ts` and `src/index.ts` (ESLint `PROMPTER_BOUNDARY`, `eslint.config.js`). `process.env` and `process.cwd()` are allowed. Every relative import carries `.js`; `import type` for type-only imports (`isolatedModules`). `noUncheckedIndexedAccess` is on: index into arrays with `!` or a guard, as the codebase does.
- `plain` output stays byte for byte what it is today (spec D2): `src/__tests__/bin.test.ts` pins `status` stdout literally; every existing test keeps passing.
- Every user-facing version string is `Version N` (`versionLabel`), never `v3`, except inside a `v<N>` folder name shown as data (`LsSkill.latest`).
- Invocation literals: any new line in `src/**` (outside `__tests__`) containing `terum-skills`, and any README/`docs/**` line naming a verb after a backtick or at line start, must be catalogued in `src/lib/__tests__/invocation-catalog.ts` with a policy (`src/lib/__tests__/invocation-tripwire.test.ts` is an exact-set equality). Run the tripwire after every doc or print edit; it prints the diff.
- Widths are code points (`[...s].length`), as `box()` in `src/lib/banner.ts` measures. ANSI is stripped before measuring.
- Nulls render as `—`, never `0`; a self-report is labelled (spec §5).
- Gates before every commit: `npm run lint && npm run typecheck && npm test` — one vitest battery at a time on this machine, and the box is shared with other sessions: start a full `npm test` only when the 1-minute load average (`cut -d' ' -f1 /proc/loadavg`) is under 8, never two batteries at once; if `npm test` reports 5 s timeouts in `bin.test.ts`/`bundle.test.ts`, wait and re-run rather than raising timeouts. Single-file `npx vitest run <file>` is fine any time. `npm` needs `NODE_OPTIONS=--dns-result-order=ipv4first` on this box for anything that reaches the registry (nothing here should).
- Commit messages: `type(scope): subject`, a wrapped body naming files, a `Verified …` paragraph stating what was run. No attribution trailers (withdrawn 2026-09-14: the `-m "Co-Authored-By: …"` and `-m "Claude-Session: …"` arguments in the commit commands below are to be omitted). Commit at the end of each task; never push.
- PR #208 (`feat/cross-mirror-m1-1`, merged 2026-09-14, in this base): Library rows' `localEval` now carries `mine` beside `teamEval.mine` (`src/commands/ls.ts` `ranHereWithoutTeam`: true when a handle this machine holds ran it, or when the run carries the no-team placeholder `NO_TEAM_RUNNER_HANDLE = 'local'` from `src/lib/evals/receipt.ts`); the team receipt wins an equal `run_id`; a runner is named iff the shown receipt's `mine` is false — the Eval cell applies that to whichever receipt it shows. The byte match decides a folder's version over the placement ledger, so a byte-matched folder is not "edited". `cardVersionLabel` (`vN`) is desktop-card-only; the terminal and docs keep `Version N`, so every board string stays `Version N`. PR #205 and #207 are desktop-only; before each task run `git fetch origin main && git log --oneline HEAD..origin/main` and rebase first when main moved.
- PR #210 (`feat/autofix-confirm-republish`, merged 2026-09-14 and rebased into this branch — no fetch check needed): `ValidateResult` gained `repairs: string[]` (one sentence per change `skill fix` would make, beside `repairable`), returned on both the success and the failure value; it also edits `validate.test.ts`, `cli.test.ts`, `docs/frame-protocol.md` and the catalogue. For Tasks 11 and 16: keep `repairs` (additive) through Task 11's `ValidateArgs`/`ValidateResult.directory` change, and have Task 16's validate board list `repairs` as a text section titled `Will change` when non-empty (Ruling: the board shows what Fix would do, matching the desktop dialog).
- PR #211 (`feat/desktop-ui-polish`, MERGED 2026-09-14 as 97a922a and rebased into this branch before Task 6): `LocalEntry` gained `updated?: string` (ISO-8601 mtime of the folder's own SKILL.md, set only when the stat is finite) in `src/lib/local-skills.ts`, and `src/commands/ls.ts` copies it onto every Library row (`LocalSection.rows[].updated`, in the `LsSkill`/row type at ~line 63 and the `showLocal` push at ~line 447), with matching rows in `ls.test.ts` and `local-skills.test.ts`. Tasks 9 and 13 touch both files: when Task 9 transcribes the brief's `collectLocal` (the split of `showLocal`), KEEP `updated` in the row push and the row type — the brief predates #211 — and record it as a deviation; never rename or reorder existing `LocalSection.rows[]` members. Ruling: the Library board does not render `updated` (the spec's Library columns do not list it) — cost if wrong: one column added in a follow-up.
- PR #213 (`feat/skill-copy-to`, MERGED 2026-09-14 as 4cf8e30, rebased into this branch after Task 6): adds `skill copy <path> --to <destination>` — `'skill copy'` joins `FRAME_VERBS` in `src/lib/frames.ts` (35 verbs), `SkillArgs.kind` gains `'copy'` in `src/commands/skill.ts`, and it edits `src/cli.ts`, `frames-cli.test.ts`, the catalogue, `SKILL.md`, `README.md`, `docs/frame-protocol.md`. Task 7's `FALLBACK_VERBS` is computed from `FRAME_VERBS`, so the new verb lands there without an edit. Task 17's per-verb argv map iterates `FRAME_VERBS` (35 entries now): add the row `'skill copy': ['skill', 'copy', '/skills/a', '--to', 'global']` beside `'skill move'`. Ruling: no renderer for `skill copy` in this plan (the skill verbs are fallback verbs by design) — cost if wrong: one fallback line instead of a board.
- PR #218 (`feat/skill-verb-routing`, Ryan, MERGED 2026-09-14 as 00e1870 and rebased into this branch before Task 6 — every item below is now in the base; diff saved at `/tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/pr218.KJJX.diff`): (1) `src/commands/eval.ts` prints a state-derived share hint after a run — `shareHint(name, verdict, form)` returns `These bytes are not a published version, so nothing was shared. To share these results, publish the skill again: <invocation publish name>` or, on FAIL, `… This run's verdict is FAIL: evaluate a fix rather than publishing these bytes — <command> asks before it publishes a failed verdict.`, printed only when nothing was shared, results exist, `--no-commit` was not given and a team + handle exist; (2) `src/lib/__tests__/fixtures.ts` gains `BUNDLED_EDIT_HOOK_SOURCE` and `editHookFor(...)` near the top; (3) `src/lib/hook.ts` is generalised per event (`MANAGED_EVENTS`, `installEventHook`, `removeEventHook`, `eventHookInstalled`; `installHook`/`removeHook`/`hookInstalled` delegate); (4) `refresh.ts` adds the notice `Updated your terum-skills edit hook for this CLI.` (a notice → stderr, never printed); (5) `install.ts`/`setup.ts`/`uninstallMachine.ts` gain an additive `editHook` option; (6) it edits `.claude/skills/terum-skills/SKILL.md`, `scripts/bundle-skill.mjs` (also bundles `assets/claude/hooks/terum-skills-edit.mjs` → `dist/claude/hooks/`) and the catalogue. Rulings for this plan: keep every #218 line (Task 10's edits to the success return must leave the share-hint print in place; Task 12's fixture additions sit beside the two new exports). Task 15's eval renderer adds the covered regex `/^These bytes are not a published version, so nothing was shared\. /` (the board's Next already carries the publish step from `value.shareHint`) — cost if wrong: the hint shows as a note. Task 18 reconciles the catalogue rows #218 added.
- PR #220 (`feat/cross-mirror-m2`, Ryan, MERGED 2026-09-14 ~10:10 as 4362465 — rebased into this branch after Task 17 closed; `reconcile` is the 36th `FRAME_VERBS` entry, so Task 18 adds its `format-cli` INVOCATIONS row, its catalogue rows and its manual/doc rows, and Plan 2 Tasks 8/10 add its manual paragraph and README rows; diff saved at `/tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/pr220.diff`): adds a `reconcile` verb (`src/commands/reconcile.ts`, `'reconcile'` joins `FRAME_VERBS` → 36 entries, `ReconcileArgs`/`ReconcileResult`/`ReconcileRow`), gives `ProjectResult`'s first member an additive `reconcile?: ReconcileResult` and `ProjectArgs` a `reconcile?` hook, gives `InstallArgs` an `adopt?: string`, and edits `src/commands/ls.ts`, `src/lib/local-skills.ts`, `src/cli.ts`, `README.md`, `docs/frame-protocol.md`, the catalogue and several tests. Rulings: `reconcile` is a fallback verb in this plan (no board; Task 7's partition is computed); Task 16's project board keeps narrowing by key presence and ignores `reconcile` (an additive field); if #220 has merged when Tasks 9, 13, 16, 17 or 18 dispatch, rebase first, keep every #220 line, and Task 17 adds a `'reconcile'` row to the format-cli argv map matching the verb's registration in `src/cli.ts`; Task 18 reconciles its catalogue and doc rows. Cost if wrong: one fallback line instead of a board, or one argv row.
- `desktop/` stays untouched except the one `desktop/GAPS.md` line in Task 18 (`git diff --stat desktop/` shows only that file).

## File map

| File | Responsibility |
|---|---|
| `src/lib/render/policies.ts` (new, leaf: imports nothing) | §5 selection policies: verdict band, half-even rounding, lift text, receipt summary, orderings, attention/verdict counts, update marker, row cap, not-offered grouping, short description, eval estimate, ROI fractions |
| `src/lib/render/text.ts` (new) | width/truncate/pad on code points, ANSI strip, single-line, relative date, `~/` paths |
| `src/lib/render/board.ts` (new, leaf) | the `Board` model: cells, columns, sections, `NextItem`, `RenderContext`, null-safe cell constructors, `board()`/`table()`/`kv()`/`textBlock()`/`bars()` |
| `src/lib/render/cells.ts` (new) | one cell → `{ text, tone, mono, align }` shared by md and pretty; `nextCommand(item, ctx)` phrased per host |
| `src/lib/render/options.ts` (new, leaf) | the argv pre-parser for `--format/--host/--rows/--width/--no-color`, `detectHost`, `OUTPUT_HELP` |
| `src/lib/render/md.ts`, `pretty.ts`, `json.ts` (new) | the three backends |
| `src/lib/render/registry.ts` (new) | `Renderer` type, `REGISTRY`, `FALLBACK_VERBS`, `renderBoard(outcome, lines, resolved, ctx)` |
| `src/lib/render/sink.ts` (new) | `createBoardSink(input): ExecuteSink` — collecting Prompter, `Resolved:` lifting, one stdout write |
| `src/lib/render/verbs/{ls,status,search,eval-report,eval,update,sync,validate,install,uninstall-skill,project}.ts` (new) | one renderer per verb (`ls` dispatches on `selection`/`local`; `project` serves `project list|add|remove`) |
| `src/lib/resolve-ref.ts` (new) | §6.1 ladder: `resolveSkillRef`, `RESOLVED_PREFIX`, `nearestSkillFolder` |
| `src/lib/banner.ts` (modify) | `paint(kind, line, enabled)`; `StyleKind` gains `yellow` |
| `src/index.ts` (modify) | pre-parser, the three refusals, the board sink, `parseAsync(argv)` on the terminal branch |
| `src/cli.ts` (modify) | `ls skill [name]`, `eval-report [skill]`, `validate [path|name]`, bare `eval` → rung 0, `OUTPUT_HELP` epilogues |
| `src/commands/ls.ts` (modify) | `kind:'skill'`, `selection`, `viewer`, member limb fields, collect/print split of `showLocal` |
| `src/commands/eval.ts`, `evalReport.ts`, `validate.ts` (modify) | `report`/`receiptPath`/`outcomes`; the resolver; `directory` |
| `src/lib/readme.ts` (modify) | `Installer.version` |
| `src/lib/__tests__/fixtures.ts` (modify) | `git()` env parameter; `dashboardTeam()`, `dashboardReceipt()`, `DASHBOARD_*` constants |
| Tests | `src/lib/render/__tests__/{text,policies,board,options,md,pretty,registry,boards}.test.ts`, `src/lib/__tests__/resolve-ref.test.ts`, `src/__tests__/format-cli.test.ts`; extensions of `cli.test.ts`, `cli-hints.test.ts`, `ls.test.ts`, `eval.test.ts`, `evalReport.test.ts`, `validate.test.ts`, `banner.test.ts`, `bin.test.ts`, `bundle.test.ts`, `frames.test.ts` |
| Docs | `README.md` (`--format` paragraph, `ls skill` span), `docs/frame-protocol.md` (D11 lines, exclusivity note), `desktop/GAPS.md` (one line), `src/lib/__tests__/invocation-catalog.ts` |

Task order: 1 text → 2 policies → 3 board+options → 4 banner → 5 cells+md → 6 pretty → 7 json+registry+sink → 8 resolve-ref → 9 ls → 10 eval → 11 eval-report+validate → 12 fixture → 13 ls renderer → 14 status/update/sync renderers → 15 search/eval-report/eval renderers → 16 validate/install/uninstall/project renderers + registry tests → 17 index/cli wiring + format-cli/bin tests → 18 docs + gates.

---

### Task 1: `src/lib/render/text.ts` — width and wording helpers

**Files:**
- Create: `src/lib/render/text.ts`
- Test: `src/lib/render/__tests__/text.test.ts`

**Interfaces:**
- Produces: `stripAnsi(text)`, `visibleWidth(text): number`, `truncate(text, max): string` (total ≤ `max` code points, `…` last), `padVisible(text, width, align?)`, `singleLine(text)`, `relativeDate(iso, now): string`, `tildePath(path, home): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/render/__tests__/text.test.ts
import { describe, expect, it } from 'vitest';
import { padVisible, relativeDate, singleLine, stripAnsi, tildePath, truncate, visibleWidth } from '../text.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('render/text', () => {
  it('measures code points with ANSI stripped', () => {
    expect(visibleWidth('\x1b[32m✓ PASS\x1b[0m')).toBe(6);
    expect(visibleWidth('naïve')).toBe(5);
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
  });
  it('truncates to max code points with a trailing ellipsis and leaves a fitting string alone', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcd', 4)).toBe('abcd');
    expect(truncate('abcdef', 1)).toBe('…');
    expect(truncate('ééééé', 3)).toBe('éé…');
  });
  it('pads by visible width on either side', () => {
    expect(padVisible('\x1b[31mab\x1b[0m', 4)).toBe('\x1b[31mab\x1b[0m  ');
    expect(padVisible('12', 4, 'right')).toBe('  12');
    expect(padVisible('toolong', 4)).toBe('toolong');
  });
  it('collapses newlines into one line', () => {
    expect(singleLine('a\nb\r\nc ')).toBe('a b c');
  });
  it('renders dates relative within 30 days and as ISO dates otherwise', () => {
    expect(relativeDate('2026-09-13T09:00:00Z', NOW)).toBe('today');
    expect(relativeDate('2026-09-11T12:00:00Z', NOW)).toBe('2d ago');
    expect(relativeDate('2026-08-14T12:00:00Z', NOW)).toBe('2026-08-14');
    expect(relativeDate('2026-09-20T12:00:00Z', NOW)).toBe('2026-09-20');
    expect(relativeDate(null, NOW)).toBe('—');
    expect(relativeDate('—', NOW)).toBe('—');
    expect(relativeDate('not a date', NOW)).toBe('—');
  });
  it('shortens paths under home to ~/ and leaves others alone', () => {
    expect(tildePath('/home/u/.claude/skills/x', '/home/u')).toBe('~/.claude/skills/x');
    expect(tildePath('/home/u', '/home/u/')).toBe('~');
    expect(tildePath('/opt/x', '/home/u')).toBe('/opt/x');
    expect(tildePath('/home/user2/x', '/home/u')).toBe('/home/user2/x');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/render/__tests__/text.test.ts`
Expected: FAIL — `Cannot find module '../text.js'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/render/text.ts
/**
 * Width and wording helpers the backends share. Widths are code points (the `box()` rule in
 * banner.ts); East-Asian double-width glyphs are a documented rough edge (spec §4.2). Nothing here
 * reads the clock, the environment or the disk: `now` and `home` arrive as arguments.
 */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string { return text.replace(ANSI, ''); }

export function visibleWidth(text: string): number { return [...stripAnsi(text)].length; }

/** At most `max` code points, the last one `…` when anything was cut; a string that fits is returned unchanged. */
export function truncate(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  return max <= 1 ? '…' : `${points.slice(0, max - 1).join('')}…`;
}

export function padVisible(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - visibleWidth(text));
  return align === 'right' ? `${' '.repeat(gap)}${text}` : `${text}${' '.repeat(gap)}`;
}

/** One line: every line break becomes a single space; ends trimmed. */
export function singleLine(text: string): string { return text.replace(/\s*\r?\n\s*/g, ' ').trim(); }

/** `today` / `Nd ago` within 30 days of `now` (epoch ms); the ISO date otherwise; `—` for nothing usable. */
export function relativeDate(iso: string | null | undefined, now: number): string {
  if (typeof iso !== 'string' || iso === '' || iso === '—') return '—';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const days = Math.floor((now - at) / 86_400_000);
  if (days < 0 || days >= 30) return new Date(at).toISOString().slice(0, 10);
  return days === 0 ? 'today' : `${days}d ago`;
}

/** `~/…` for a path under `home` (separators shown as `/`); the path itself otherwise. */
export function tildePath(path: string, home: string): string {
  const root = home.replace(/[\\/]+$/, '');
  if (path === root) return '~';
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) return `~${path.slice(root.length).replaceAll('\\', '/')}`;
  return path;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/render/__tests__/text.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint && npm run typecheck`
Expected: no problems.

```bash
git add src/lib/render/text.ts src/lib/render/__tests__/text.test.ts
git commit -m "feat(render): text helpers — code-point widths, truncation, relative dates, ~ paths"
```
(Full message body per Global Constraints; the subject line is what is shown here — same for every commit step below.)

---

### Task 2: `src/lib/render/policies.ts` — the §5 selection policies (leaf)

**Files:**
- Create: `src/lib/render/policies.ts`
- Test: `src/lib/render/__tests__/policies.test.ts`

**Interfaces:**
- Produces (all pure, the module imports nothing): `Verdict`, `verdictBand(w, l, t): Verdict | null`, `roundHalfEven(n)`, `liftPercent(w, l, t): number | null`, `liftText(lift: number | null): string`, `HEADLINE_COMPARISON`, `ReceiptLike`, `ReceiptSummary`, `summariseReceipt(receipt): ReceiptSummary | null`, `stripText(w, l, t)`, `compareText(a, b)`, `marketplaceOrder`, `LibraryState`, `libraryState(row)`, `libraryOrder`, `adoption(person, installs)`, `peopleOrder(installs)`, `projectsOrder(members)`, `historyOrder`, `localRunsOrder`, `attentionCounts(rows)`, `parseVersionOrdinal(v): number | null`, `updateAvailable(latest, installed)`, `verdictCounts(verdicts)`, `applyRowCap(rows, cap)`, `groupNotOffered(rows, cap)`, `shortDescription(description, max = 80)`, `evalEstimate(input)`, `roiFractions(candidate, baseline)`, `displayName(author)`.
- The desktop twins are `desktop/src/backend/mock/derive.ts` (`receipt_of`, `round_half_even`, `lift_number`, `top_rated`, `people_by_adoption`, `projects_by_members`, `verdict_counts`, `eval_estimate`) and `desktop/src/backend/score-fractions.ts` (`roiFractions`); `src/lib/evals/stats.ts` `verdictBand` is the CLI's own band for n > 0.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/render/__tests__/policies.test.ts
import { describe, expect, it } from 'vitest';
import { verdictBand as engineBand } from '../../evals/stats.js';
import {
  adoption, applyRowCap, attentionCounts, displayName, evalEstimate, groupNotOffered, historyOrder, libraryOrder, libraryState, liftPercent, liftText,
  localRunsOrder, marketplaceOrder, parseVersionOrdinal, peopleOrder, projectsOrder, roiFractions, roundHalfEven, shortDescription, stripText,
  summariseReceipt, updateAvailable, verdictBand, verdictCounts,
} from '../policies.js';

describe('policies (§5) — the desktop\'s semantics', () => {
  it.each([[12.5, 12], [13.5, 14], [-12.5, -12], [-13.5, -14], [2.4, 2], [2.6, 3]])('rounds %s half to even', (n, expected) => expect(roundHalfEven(n)).toBe(expected));
  it('refuses a non-finite number', () => { expect(() => roundHalfEven(Number.POSITIVE_INFINITY)).toThrow(RangeError); });

  it.each([
    [4, 2, 0, 'PASS'], [3, 2, 1, 'NEUTRAL'], [1, 3, 2, 'FAIL'], [2, 2, 2, 'NEUTRAL'], [1, 0, 0, 'PASS'], [0, 1, 0, 'FAIL'], [0, 0, 0, null],
  ] as const)('bands %dW %dL %dT as %s', (w, l, t, band) => {
    expect(verdictBand(w, l, t)).toBe(band);
    if (band !== null) expect(engineBand(w, l, t)).toBe(band);
  });

  it('computes lift half-even and words its sign', () => {
    expect(liftPercent(4, 2, 0)).toBe(33); expect(liftText(33)).toBe('+33%');
    expect(liftPercent(1, 4, 1)).toBe(-50); expect(liftText(-50)).toBe('−50%');
    expect(liftPercent(2, 2, 2)).toBe(0); expect(liftText(0)).toBe('±0%');
    expect(liftPercent(0, 0, 0)).toBeNull(); expect(liftText(null)).toBe('—');
    expect(liftPercent(1, 0, 7)).toBe(12);   // 12.5 → 12 (half to even)
  });

  it('summarises one receipt from its candidate-vs-baseline comparison and keeps its own sign p', () => {
    const receipt = { verdict: 'PASS' as const, execution_status: 'partial' as const, expected_rows: 6, scored_rows: 4, comparisons: { 'candidate-vs-baseline': { win: 3, loss: 1, tie: 0, net_lift: 0.5, sign_p: 0.03125 }, 'candidate-vs-incumbent': { win: 1, loss: 1, tie: 2, net_lift: 0, sign_p: 1 } } };
    expect(summariseReceipt(receipt)).toEqual({ verdict: 'PASS', w: 3, l: 1, t: 0, n: 4, lift: 50, partial: [4, 6], signP: '0.031' });
    expect(summariseReceipt({ ...receipt, comparisons: {} })).toEqual({ verdict: 'PASS', w: 0, l: 0, t: 0, n: 0, lift: null, partial: [4, 6], signP: null });
    expect(summariseReceipt(null)).toBeNull();
    expect(stripText(4, 2, 0)).toBe('WWWWLL');
  });

  it('orders the marketplace by installs then name, the library by the state ladder then name', () => {
    const rows = [{ installs: 1, name: 'b' }, { installs: 3, name: 'z' }, { installs: 3, name: 'a' }];
    expect([...rows].sort(marketplaceOrder).map((r) => r.name)).toEqual(['a', 'z', 'b']);
    const lib = [
      { name: 'u', edited: false, tracked: false, known: false },
      { name: 'p', edited: false, tracked: true, known: true },
      { name: 'e', edited: true, tracked: true, known: true },
      { name: 'b', edited: false, tracked: false, known: false, problem: 'x' },
      { name: 's', edited: false, tracked: false, known: true },
      { name: 'a', edited: false, tracked: false, known: false },
    ];
    expect([...lib].sort(libraryOrder).map((r) => r.name)).toEqual(['b', 'e', 'p', 's', 'a', 'u']);
    expect(libraryState(lib[3]!)).toBe('broken'); expect(libraryState(lib[2]!)).toBe('edited'); expect(libraryState(lib[1]!)).toBe('placed'); expect(libraryState(lib[4]!)).toBe('shared'); expect(libraryState(lib[0]!)).toBe('untracked');
  });

  it('orders people by adoption of their authored skills, projects by member count, history by version then run', () => {
    const installs = new Map([['a', 5], ['b', 1]]);
    const people = [{ handle: 'zed', authored: ['b'] }, { handle: 'amy', authored: ['a'] }, { handle: 'bob', authored: ['a'] }, { handle: 'eve', authored: [] }];
    expect(adoption(people[0]!, installs)).toBe(1);
    expect([...people].sort(peopleOrder(installs)).map((p) => p.handle)).toEqual(['amy', 'bob', 'zed', 'eve']);
    const members = new Map([['x', 2], ['y', 3]]);
    expect([{ name: 'x' }, { name: 'z' }, { name: 'y' }].sort(projectsOrder(members)).map((p) => p.name)).toEqual(['y', 'x', 'z']);
    const history = [{ version: 'v2', run_id: '20260901T000000Z' }, { version: 'v10', run_id: '20260801T000000Z' }, { version: 'v2', run_id: '20260902T000000Z' }, { version: '—', run_id: '20260903T000000Z' }];
    expect([...history].sort(historyOrder).map((h) => `${h.version}/${h.run_id.slice(0, 8)}`)).toEqual(['v10/20260801', 'v2/20260902', 'v2/20260901', '—/20260903']);
    expect([{ run_id: 'b' }, { run_id: 'c' }, { run_id: 'a' }].sort(localRunsOrder).map((r) => r.run_id)).toEqual(['c', 'b', 'a']);
  });

  it('counts attention and verdicts without inventing zeros', () => {
    expect(attentionCounts([
      { localVerdict: 'FAIL', edited: false, broken: false }, { localVerdict: null, edited: true, broken: false }, { localVerdict: null, edited: false, broken: true }, { localVerdict: 'PASS', edited: false, broken: false },
    ])).toEqual({ failing: 1, notEvaluated: 1, edited: 1, attention: 3 });
    expect(verdictCounts(['PASS', null, 'FAIL', 'PASS', 'NEUTRAL'])).toEqual({ PASS: 2, NEUTRAL: 1, FAIL: 1, notEvaluated: 1 });
  });

  it('marks an update only when the viewer holds a numerically older v<N> folder', () => {
    expect(parseVersionOrdinal('v10')).toBe(10); expect(parseVersionOrdinal('v0')).toBeNull(); expect(parseVersionOrdinal(null)).toBeNull(); expect(parseVersionOrdinal('deadbeefcafe')).toBeNull();
    expect(updateAvailable('v3', 'v1')).toBe(true); expect(updateAvailable('v3', 'v3')).toBe(false); expect(updateAvailable('v3', null)).toBe(false); expect(updateAvailable('v3', 'deadbeefcafe')).toBe(false); expect(updateAvailable('v1', 'v3')).toBe(false);
  });

  it('caps rows and groups the not-offered list above five', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => i);
    expect(applyRowCap(thirty, 25)).toEqual({ rows: thirty.slice(0, 25), more: 5 });
    expect(applyRowCap(thirty, 'all')).toEqual({ rows: thirty, more: 0 });
    expect(applyRowCap([1, 2], 25)).toEqual({ rows: [1, 2], more: 0 });
    const six = [{ reason: 'symlink' }, { reason: 'invalid-yaml' }, { reason: 'symlink' }, { reason: 'symlink' }, { reason: 'failed' }, { reason: 'invalid-yaml' }];
    expect(groupNotOffered(six, 25)).toEqual({ grouped: true, groups: [{ reason: 'symlink', count: 3 }, { reason: 'invalid-yaml', count: 2 }, { reason: 'failed', count: 1 }] });
    expect(groupNotOffered(six, 'all')).toEqual({ grouped: false, groups: [] });
    expect(groupNotOffered(six.slice(0, 5), 25)).toEqual({ grouped: false, groups: [] });
  });

  it('shortens a description to its first sentence or 80 characters, on one line', () => {
    expect(shortDescription('Use this when a deploy needs a checklist. Then more text.')).toBe('Use this when a deploy needs a checklist.');
    expect(shortDescription('A'.repeat(100))).toBe(`${'A'.repeat(80)}…`);
    expect(shortDescription('line one\nline two.')).toBe('line one line two.');
    expect(shortDescription(null)).toBe('—'); expect(shortDescription('')).toBe('—');
    expect(shortDescription('Short. Second.', 5)).toBe('Short…');
    expect(displayName('Mira Chen <mira@example.com>')).toBe('Mira Chen'); expect(displayName('  anon ')).toBe('anon'); expect(displayName('')).toBe('—');
  });

  it('estimates an eval from per-arm efficiency and gives ROI fractions like the desktop', () => {
    expect(evalEstimate({ cases: 6, k: 1, efficiency: { candidate: { duration_ms: 30_000, cost_usd: 0.4 }, baseline: { duration_ms: 20_000, cost_usd: 0.3 } } })).toEqual({ cases: 6, k: 1, arms: 2, runs: 12, minutes: 5, dollars: 4 });
    expect(evalEstimate({ cases: 6, k: 1, efficiency: { candidate: { duration_ms: null, cost_usd: 0.4 } } })).toBeNull();
    expect(evalEstimate({ cases: 0, k: 1, efficiency: { candidate: { duration_ms: 1, cost_usd: 1 } } })).toBeNull();
    expect(roiFractions(0.4, 0.5)).toEqual([0.8, 1]); expect(roiFractions(0.5, 0.4)).toEqual([1, 0.8]);
    expect(roiFractions(null, 0.5)).toBeNull(); expect(roiFractions(0, 0)).toBeNull(); expect(roiFractions(Number.NaN, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/render/__tests__/policies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/render/policies.ts
/**
 * §5 selection policies — pure functions with the desktop's semantics where the desktop already has
 * them (desktop/src/backend/mock/derive.ts, receipt-summary.ts, score-fractions.ts), so a later
 * desktop import changes no pixel. This module imports NOTHING (a leaf the desktop bundle may take).
 */
export type Verdict = 'PASS' | 'NEUTRAL' | 'FAIL';

/** PASS when 3(w−l) ≥ n, FAIL when 3(l−w) ≥ n, else NEUTRAL; null when there is nothing to band. */
export function verdictBand(w: number, l: number, t: number): Verdict | null {
  const n = w + l + t;
  if (!(n > 0)) return null;
  if (3 * (w - l) >= n) return 'PASS';
  if (3 * (l - w) >= n) return 'FAIL';
  return 'NEUTRAL';
}

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Cannot round a non-finite number.');
  const floor = Math.floor(value);
  const fraction = value - floor;
  return fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
}

export function liftPercent(w: number, l: number, t: number): number | null {
  const n = w + l + t;
  return n > 0 ? roundHalfEven(((w - l) / n) * 100) : null;
}

export function liftText(lift: number | null): string {
  if (lift === null) return '—';
  return `${lift > 0 ? '+' : lift < 0 ? '−' : '±'}${Math.abs(lift)}%`;
}

export const HEADLINE_COMPARISON = 'candidate-vs-baseline';

export interface ComparisonLike { win: number; loss: number; tie: number; net_lift?: number; sign_p?: number }
export interface ReceiptLike { verdict: Verdict; execution_status: 'complete' | 'partial' | 'failed'; expected_rows: number; scored_rows: number; comparisons: Record<string, ComparisonLike> }
export interface ReceiptSummary { verdict: Verdict; w: number; l: number; t: number; n: number; lift: number | null; partial: [number, number] | null; signP: string | null }

/** One receipt's headline numbers — never combined across receipts (eval-engine spec §12). */
export function summariseReceipt(receipt: ReceiptLike | null | undefined): ReceiptSummary | null {
  if (!receipt) return null;
  const comparison = receipt.comparisons?.[HEADLINE_COMPARISON];
  const w = comparison?.win ?? 0, l = comparison?.loss ?? 0, t = comparison?.tie ?? 0;
  return {
    verdict: receipt.verdict, w, l, t, n: w + l + t,
    lift: comparison ? liftPercent(w, l, t) : null,
    partial: receipt.execution_status === 'partial' ? [receipt.scored_rows, receipt.expected_rows] : null,
    signP: comparison && typeof comparison.sign_p === 'number' ? comparison.sign_p.toFixed(3) : null,
  };
}

/** The record strip: counts only — receipts carry no per-case order (spec §4.1). */
export function stripText(w: number, l: number, t: number): string { return 'W'.repeat(w) + 'L'.repeat(l) + 'T'.repeat(t); }

export function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function marketplaceOrder(a: { installs: number; name: string }, b: { installs: number; name: string }): number {
  return b.installs - a.installs || compareText(a.name, b.name);
}

export type LibraryState = 'broken' | 'edited' | 'placed' | 'shared' | 'untracked';
const LIBRARY_LADDER: readonly LibraryState[] = ['broken', 'edited', 'placed', 'shared', 'untracked'];
/** `known`: the folder's uuid belongs to a team skill (`knownToTeam`, PR #199) — the 'shared' state. */
export interface LibraryRowLike { name: string; edited: boolean; tracked: boolean; known: boolean; problem?: string }

export function libraryState(row: LibraryRowLike): LibraryState {
  return row.problem !== undefined ? 'broken' : row.edited ? 'edited' : row.tracked ? 'placed' : row.known ? 'shared' : 'untracked';
}

export function libraryOrder(a: LibraryRowLike, b: LibraryRowLike): number {
  return LIBRARY_LADDER.indexOf(libraryState(a)) - LIBRARY_LADDER.indexOf(libraryState(b)) || compareText(a.name, b.name);
}

export function adoption(person: { authored: readonly string[] }, installs: ReadonlyMap<string, number>): number {
  return person.authored.reduce((sum, id) => sum + (installs.get(id) ?? 0), 0);
}

export function peopleOrder(installs: ReadonlyMap<string, number>): (a: { handle: string; authored: readonly string[] }, b: { handle: string; authored: readonly string[] }) => number {
  return (a, b) => adoption(b, installs) - adoption(a, installs) || compareText(a.handle, b.handle);
}

export function projectsOrder(members: ReadonlyMap<string, number>): (a: { name: string }, b: { name: string }) => number {
  return (a, b) => (members.get(b.name) ?? 0) - (members.get(a.name) ?? 0) || compareText(a.name, b.name);
}

/** `v<N>` → N; anything else (null, a legacy tree hash, `v0`) → null. Re-declared here because this module imports nothing. */
export function parseVersionOrdinal(version: string | null | undefined): number | null {
  if (typeof version !== 'string' || !/^v[1-9][0-9]*$/.test(version)) return null;
  const n = Number(version.slice(1));
  return Number.isSafeInteger(n) ? n : null;
}

/** Version DESC (numeric), then run id DESC — `evalReport.ts byVersionThenRun`. */
export function historyOrder(a: { version: string; run_id: string }, b: { version: string; run_id: string }): number {
  const left = parseVersionOrdinal(a.version) ?? -1;
  const right = parseVersionOrdinal(b.version) ?? -1;
  return right - left || compareText(b.run_id, a.run_id);
}

export function localRunsOrder(a: { run_id: string }, b: { run_id: string }): number { return compareText(b.run_id, a.run_id); }

export interface AttentionCounts { failing: number; notEvaluated: number; edited: number; attention: number }

export function attentionCounts(rows: readonly { localVerdict: Verdict | null; edited: boolean; broken: boolean }[]): AttentionCounts {
  const failing = rows.filter((row) => row.localVerdict === 'FAIL').length;
  const notEvaluated = rows.filter((row) => !row.broken && row.localVerdict === null).length;
  const edited = rows.filter((row) => row.edited).length;
  return { failing, notEvaluated, edited, attention: failing + notEvaluated + edited };
}

/** ▲ only when the viewer's recorded install is a `v<N>` folder numerically older than the latest. */
export function updateAvailable(latest: string, installed: string | null | undefined): boolean {
  const newest = parseVersionOrdinal(latest);
  const held = parseVersionOrdinal(installed);
  return newest !== null && held !== null && held < newest;
}

export function verdictCounts(verdicts: readonly (Verdict | null)[]): { PASS: number; NEUTRAL: number; FAIL: number; notEvaluated: number } {
  const counts = { PASS: 0, NEUTRAL: 0, FAIL: 0, notEvaluated: 0 };
  for (const verdict of verdicts) { if (verdict === null) counts.notEvaluated += 1; else counts[verdict] += 1; }
  return counts;
}

export function applyRowCap<T>(rows: readonly T[], cap: number | 'all'): { rows: T[]; more: number } {
  if (cap === 'all' || rows.length <= cap) return { rows: [...rows], more: 0 };
  return { rows: rows.slice(0, cap), more: rows.length - cap };
}

/** Above five rows the not-offered list is grouped by reason (first-seen order, count DESC); `--rows all` lists them all. */
export function groupNotOffered<T extends { reason: string }>(rows: readonly T[], cap: number | 'all'): { grouped: boolean; groups: { reason: string; count: number }[] } {
  if (cap === 'all' || rows.length <= 5) return { grouped: false, groups: [] };
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  return { grouped: true, groups: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
}

/** First sentence when it fits in `max` code points, else the first `max` code points and `…`; always one line. */
export function shortDescription(description: string | null | undefined, max = 80): string {
  if (typeof description !== 'string' || description.trim() === '') return '—';
  const flat = description.replace(/\s*\r?\n\s*/g, ' ').trim();
  const sentence = /^(.*?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  if ([...sentence].length <= max) return sentence;
  return `${[...flat].slice(0, max).join('')}…`;
}

/** The person's name out of a `Name <email>` byline; `—` for an empty one. */
export function displayName(author: string | null | undefined): string {
  const name = (author ?? '').replace(/\s*<[^>]*>\s*$/, '').trim();
  return name === '' ? '—' : name;
}

export interface EvalEstimate { cases: number; k: number; arms: number; runs: number; minutes: number; dollars: number }

/** `derive.ts eval_estimate`: per-arm means × cases × k; null when any arm lacks a duration or a cost, or there is nothing to run. */
export function evalEstimate(input: { cases: number; k: number; efficiency: Record<string, { duration_ms: number | null; cost_usd: number | null }> }): EvalEstimate | null {
  const arms = Object.values(input.efficiency);
  const perArm = input.cases * input.k;
  if (arms.length === 0 || !(perArm > 0)) return null;
  if (arms.some((arm) => arm.duration_ms === null || arm.cost_usd === null)) return null;
  const seconds = arms.reduce((sum, arm) => sum + (arm.duration_ms as number) / 1000, 0) * perArm;
  const dollars = arms.reduce((sum, arm) => sum + (arm.cost_usd as number), 0) * perArm;
  return { cases: input.cases, k: input.k, arms: arms.length, runs: perArm * arms.length, minutes: 5 * roundHalfEven(seconds / 300), dollars: roundHalfEven(dollars) };
}

/** `score-fractions.ts`: each arm's cost over the costlier arm; null without two finite costs or when both are zero. */
export function roiFractions(candidate: number | null | undefined, baseline: number | null | undefined): [number, number] | null {
  if (candidate == null || baseline == null) return null;
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return null;
  const max = Math.max(candidate, baseline);
  if (max <= 0) return null;
  return [candidate / max, baseline / max];
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/render/__tests__/policies.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`

```bash
git add src/lib/render/policies.ts src/lib/render/__tests__/policies.test.ts
git commit -m "feat(render): selection policies — the desktop's bands, rounding, orderings and estimates as one leaf"
```

---

### Task 3: `board.ts` (the model) and `options.ts` (the pre-parser)

**Files:**
- Create: `src/lib/render/board.ts`, `src/lib/render/options.ts`
- Test: `src/lib/render/__tests__/board.test.ts`, `src/lib/render/__tests__/options.test.ts`

**Interfaces:**
- Produces (`board.ts`): types `Tone`, `Cell`, `Column`, `Table`, `KV`, `TextBlock`, `Bars`, `Section`, `NextItem`, `Failure`, `Board`, `RenderFormat`, `Host`, `RenderContext`; constructors `text`, `count`, `status`, `date`, `path`, `code`, `bar`, `strip`, `verdict`, `board`, `table`, `kv`, `textBlock`, `bars`.
- Produces (`options.ts`): `FORMATS`, `HOSTS`, `RenderOptions`, `TerminalFacts`, `ParsedRenderOptions`, `parseRenderOptions(argv, env, terminal)`, `detectHost(env)`, `OUTPUT_HELP`.
- Consumes: `applyRowCap` (Task 2), `InvocationForm` (`src/lib/invocation.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/render/__tests__/board.test.ts
import { describe, expect, it } from 'vitest';
import { bar, board, code, count, date, kv, path, status, strip, table, text, textBlock, verdict } from '../board.js';

describe('board model constructors are null-safe', () => {
  it('turns nothing into a dash and keeps values', () => {
    expect(text(null)).toEqual({ kind: 'text', text: '—' }); expect(text('')).toEqual({ kind: 'text', text: '—' }); expect(text(3)).toEqual({ kind: 'text', text: '3' });
    expect(count(undefined)).toEqual({ kind: 'count', n: null }); expect(count(Number.NaN)).toEqual({ kind: 'count', n: null }); expect(count(7)).toEqual({ kind: 'count', n: 7 });
    expect(date(42)).toEqual({ kind: 'date', iso: null }); expect(date('2026-01-01')).toEqual({ kind: 'date', iso: '2026-01-01' });
    expect(path(undefined)).toEqual({ kind: 'text', text: '—' }); expect(path('/x')).toEqual({ kind: 'path', path: '/x' });
    expect(code('')).toEqual({ kind: 'text', text: '—' }); expect(strip(null)).toEqual({ kind: 'text', text: '—' }); expect(strip('WL')).toEqual({ kind: 'strip', text: 'WL' });
    expect(bar(1.7, 'x')).toEqual({ kind: 'bar', fraction: 1, label: 'x' }); expect(bar(null, null)).toEqual({ kind: 'bar', fraction: null, label: '' });
    expect(status('ok', null)).toEqual({ kind: 'status', tone: 'ok', text: '—' });
    expect(verdict({ verdict: 'bogus' })).toEqual({ kind: 'verdict', verdict: null, lift: null, partial: null, stale: false, from: null, invalid: false });
    expect(verdict({ verdict: 'PASS', lift: 33, partial: [4, 6], stale: true, from: 'v2', invalid: false })).toEqual({ kind: 'verdict', verdict: 'PASS', lift: 33, partial: [4, 6], stale: true, from: 'v2', invalid: false });
  });
  it('builds a board with empty lists and a table with a capped row set', () => {
    expect(board('T')).toEqual({ title: 'T', resolved: [], sections: [], notes: [], next: [] });
    const rows = Array.from({ length: 4 }, (_, i) => ({ a: text(i) }));
    expect(table([{ key: 'a', label: 'A', priority: 1 }], rows, { cap: 3, title: 'Rows' })).toEqual({ kind: 'table', title: 'Rows', columns: [{ key: 'a', label: 'A', priority: 1 }], rows: rows.slice(0, 3), more: { count: 1 } });
    expect(table([{ key: 'a', label: 'A', priority: 1 }], rows)).toEqual({ kind: 'table', columns: [{ key: 'a', label: 'A', priority: 1 }], rows });
    expect(kv([['k', text('v')]], 'K')).toEqual({ kind: 'kv', title: 'K', rows: [['k', { kind: 'text', text: 'v' }]] });
    expect(textBlock(['a'], { fenced: 'md' })).toEqual({ kind: 'text', lines: ['a'], fenced: 'md' });
  });
});
```

```ts
// src/lib/render/__tests__/options.test.ts
import { describe, expect, it } from 'vitest';
import { detectHost, OUTPUT_HELP, parseRenderOptions } from '../options.js';

const tty = { isTTY: true, columns: 120, rows: 40, colorCapable: true };
const pipe = { isTTY: false, colorCapable: false };
const argv = (...rest: string[]) => ['node', 'terum-skills', ...rest];

describe('the --format pre-parser (D1)', () => {
  it('leaves argv alone and reports plain when no flag is given', () => {
    expect(parseRenderOptions(argv('status'), {}, pipe)).toEqual({ ok: true, argv: argv('status'), options: { format: 'plain', formatGiven: false, host: 'terminal', rows: 25, width: 100, color: false } });
  });
  it('strips every flag wherever it sits, in both spellings, and honours the -- boundary', () => {
    const parsed = parseRenderOptions(argv('--rows', '5', 'ls', '--format=md', '--local', '--host', 'codex', '--width=80', '--no-color', '--', '--format', 'json'), {}, tty);
    expect(parsed).toEqual({ ok: true, argv: argv('ls', '--local', '--', '--format', 'json'), options: { format: 'md', formatGiven: true, host: 'codex', rows: 5, width: 80, color: false } });
  });
  it('resolves auto to pretty on a TTY and md otherwise, and folds the screen height into rows on a TTY', () => {
    expect(parseRenderOptions(argv('--format', 'auto', 'ls'), {}, tty)).toMatchObject({ ok: true, options: { format: 'pretty', rows: 25, width: 120, color: true } });
    expect(parseRenderOptions(argv('--format', 'auto', 'ls'), {}, pipe)).toMatchObject({ ok: true, options: { format: 'md', rows: 25, width: 100, color: false } });
    expect(parseRenderOptions(argv('--format', 'pretty', 'ls'), {}, { ...tty, rows: 20 })).toMatchObject({ ok: true, options: { rows: 8 } });
    expect(parseRenderOptions(argv('--format', 'pretty', '--rows', 'all', 'ls'), {}, { ...tty, rows: 20 })).toMatchObject({ ok: true, options: { rows: 'all' } });
    expect(parseRenderOptions(argv('--format', 'pretty', 'ls'), {}, { ...tty, rows: 10 })).toMatchObject({ ok: true, options: { rows: 5 } });
  });
  it('colours pretty output on a capable terminal or with FORCE_COLOR, never with --no-color', () => {
    expect(parseRenderOptions(argv('--format', 'pretty'), { FORCE_COLOR: '1' }, pipe)).toMatchObject({ ok: true, options: { color: true } });
    expect(parseRenderOptions(argv('--format', 'pretty', '--no-color'), { FORCE_COLOR: '1' }, tty)).toMatchObject({ ok: true, options: { color: false } });
    expect(parseRenderOptions(argv('--format', 'md'), {}, tty)).toMatchObject({ ok: true, options: { color: true } });
  });
  it('uses the terminal width when it is at least 40, else 100', () => {
    expect(parseRenderOptions(argv('--format', 'pretty'), {}, { ...tty, columns: 30 })).toMatchObject({ ok: true, options: { width: 100 } });
    expect(parseRenderOptions(argv('--format', 'pretty'), {}, { ...tty, columns: undefined })).toMatchObject({ ok: true, options: { width: 100 } });
  });
  it.each([
    [['--format', 'yaml'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format=', 'ls'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--format', 'md', '--host', 'vim'], '--host must be one of claude, codex, terminal.'],
    [['--format', 'md', '--rows', '0'], '--rows must be a positive integer or all.'],
    [['--format', 'md', '--rows', 'ten'], '--rows must be a positive integer or all.'],
    [['--format', 'md', '--width', '39'], '--width must be an integer of at least 40.'],
    [['--format', 'md', '--width=abc'], '--width must be an integer of at least 40.'],
    [['--rows', '5', 'ls'], '--rows, --width, --host and --no-color need --format.'],
    [['--no-color', 'ls'], '--rows, --width, --host and --no-color need --format.'],
  ])('refuses %j with one line', (rest, error) => {
    expect(parseRenderOptions(argv(...rest), {}, tty)).toEqual({ ok: false, error });
  });
  it('detects the host from the environment, Codex first', () => {
    expect(detectHost({ CODEX_SESSION_ID: 'x', CLAUDECODE: '1' })).toBe('codex');
    expect(detectHost({ CODEX_THREAD_ID: 'x' })).toBe('codex');
    expect(detectHost({ CLAUDECODE: '1' })).toBe('claude');
    expect(detectHost({})).toBe('terminal');
    expect(parseRenderOptions(argv('--format', 'md'), { CLAUDECODE: '1' }, pipe)).toMatchObject({ ok: true, options: { host: 'claude' } });
  });
  it('documents the flags in one help paragraph', () => {
    for (const flag of ['--format <plain|md|pretty|json|auto>', '--host <claude|codex|terminal>', '--rows <n|all>', '--width <n>', '--no-color']) expect(OUTPUT_HELP).toContain(flag);
    expect(OUTPUT_HELP.startsWith('\nOutput:')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/render/__tests__/board.test.ts src/lib/render/__tests__/options.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `board.ts`**

```ts
// src/lib/render/board.ts
/**
 * The board model (spec §3): a renderer turns a verb's `value` into this data, a backend turns it
 * into text. Neither side reads disk, env or clock — everything arrives in `value` and `ctx` — so a
 * board is pure and snapshot-testable. Every constructor is null-safe: a missing limb is a `—`
 * cell, never a throw (spec §12).
 */
import type { InvocationForm } from '../invocation.js';
import { applyRowCap, type Verdict } from './policies.js';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info' | 'pending';

export type Cell =
  | { kind: 'text'; text: string }
  | { kind: 'count'; n: number | null }
  | { kind: 'verdict'; verdict: Verdict | null; lift: number | null; partial: [number, number] | null; stale: boolean; from: string | null; invalid: boolean }
  | { kind: 'status'; tone: Tone; text: string }
  | { kind: 'date'; iso: string | null }
  | { kind: 'path'; path: string }
  | { kind: 'code'; text: string }
  | { kind: 'bar'; fraction: number | null; label: string }
  | { kind: 'strip'; text: string };

/** Priority 1 is never dropped; 3 drops first when a pretty table exceeds the width. */
export interface Column { key: string; label: string; align?: 'left' | 'right'; priority: 1 | 2 | 3; max?: number }
export interface Table { kind: 'table'; title?: string; columns: Column[]; rows: Record<string, Cell>[]; more?: { count: number } }
export interface KV { kind: 'kv'; title?: string; rows: [string, Cell][] }
export interface TextBlock { kind: 'text'; title?: string; lines: string[]; fenced?: 'md' | 'text' }
export interface Bars { kind: 'bars'; title?: string; rows: { label: string; fraction: number | null; value: string }[] }
export type Section = Table | KV | TextBlock | Bars;

/** A next step: a named skill (`/skill-info x`, `$skill-info x`) or a verb (`/terum-skills install x`); `raw` is a command that is not a terum-skills verb. */
export type NextItem = { label: string; skill?: string; verb: string; args: string[] } | { label: string; raw: string };
export interface Failure { error: string; refused?: true; declined?: true; partial?: true }

export interface Board { title: string; headline?: string; resolved: string[]; sections: Section[]; notes: string[]; next: NextItem[]; failure?: Failure }

export type RenderFormat = 'md' | 'pretty' | 'json';
export type Host = 'claude' | 'codex' | 'terminal';
export interface RenderContext {
  format: RenderFormat; host: Host; rows: number | 'all'; width: number; color: boolean;
  form: InvocationForm | undefined; home: string;
  /** Epoch milliseconds; the only clock a renderer may read. */
  now: number;
  /** The verb's own argv (after the bin), e.g. `['search', 'deploy', '--category', 'ops']`, and the same joined for the `--rows all` footer. */
  argv: readonly string[]; command: string;
}

const dash = (): Cell => ({ kind: 'text', text: '—' });
const empty = (value: unknown): boolean => value === null || value === undefined || value === '';

export function text(value: unknown): Cell { return empty(value) ? dash() : { kind: 'text', text: String(value) }; }
export function count(value: unknown): Cell { return { kind: 'count', n: typeof value === 'number' && Number.isFinite(value) ? value : null }; }
export function status(tone: Tone, label: unknown): Cell { return { kind: 'status', tone, text: empty(label) ? '—' : String(label) }; }
export function date(iso: unknown): Cell { return { kind: 'date', iso: typeof iso === 'string' && iso !== '' ? iso : null }; }
export function path(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'path', path: value } : dash(); }
export function code(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'code', text: value } : dash(); }
export function strip(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'strip', text: value } : dash(); }
export function bar(fraction: unknown, label: unknown): Cell {
  const clamped = typeof fraction === 'number' && Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : null;
  return { kind: 'bar', fraction: clamped, label: empty(label) ? '' : String(label) };
}
export function verdict(input: { verdict?: unknown; lift?: number | null; partial?: [number, number] | null; stale?: boolean; from?: string | null; invalid?: boolean }): Cell {
  const banded = input.verdict === 'PASS' || input.verdict === 'NEUTRAL' || input.verdict === 'FAIL' ? input.verdict : null;
  return { kind: 'verdict', verdict: banded, lift: input.lift ?? null, partial: input.partial ?? null, stale: input.stale === true, from: input.from ?? null, invalid: input.invalid === true };
}

export function board(title: string, partial: Partial<Omit<Board, 'title'>> = {}): Board { return { title, resolved: [], sections: [], notes: [], next: [], ...partial }; }
export function table(columns: Column[], rows: Record<string, Cell>[], options: { title?: string; cap?: number | 'all' } = {}): Table {
  const capped = applyRowCap(rows, options.cap ?? 'all');
  return { kind: 'table', ...(options.title === undefined ? {} : { title: options.title }), columns, rows: capped.rows, ...(capped.more > 0 ? { more: { count: capped.more } } : {}) };
}
export function kv(rows: [string, Cell][], title?: string): KV { return { kind: 'kv', ...(title === undefined ? {} : { title }), rows }; }
export function textBlock(lines: string[], options: { title?: string; fenced?: 'md' | 'text' } = {}): TextBlock { return { kind: 'text', ...(options.title === undefined ? {} : { title: options.title }), lines, ...(options.fenced === undefined ? {} : { fenced: options.fenced }) }; }
export function bars(rows: Bars['rows'], title?: string): Bars { return { kind: 'bars', ...(title === undefined ? {} : { title }), rows }; }
```

- [ ] **Step 4: Implement `options.ts`**

```ts
// src/lib/render/options.ts
/**
 * D1: the global output flags, read and removed from the argv prefix before the first `--` exactly
 * as `--frames` is handled in src/index.ts, so commander never sees them and no verb needs to
 * declare them. A leaf: the terminal facts (TTY, columns, rows, colour) arrive as an argument,
 * because only src/index.ts may read process.stdout.
 */
export const FORMATS = ['plain', 'md', 'pretty', 'json', 'auto'] as const;
export const HOSTS = ['claude', 'codex', 'terminal'] as const;
export type RenderFormatOption = (typeof FORMATS)[number];
export type Host = (typeof HOSTS)[number];

export interface RenderOptions {
  format: 'plain' | 'md' | 'pretty' | 'json';
  /** Whether `--format` was typed at all — the refusals (`--frames`, `serve`, `sync --hook`) key on this. */
  formatGiven: boolean;
  host: Host;
  rows: number | 'all';
  width: number;
  color: boolean;
}
export interface TerminalFacts { isTTY: boolean; columns?: number | undefined; rows?: number | undefined; colorCapable: boolean }
export type ParsedRenderOptions = { ok: true; argv: string[]; options: RenderOptions } | { ok: false; error: string };

const FORMAT_ERROR = `--format must be one of ${FORMATS.join(', ')}.`;
const HOST_ERROR = `--host must be one of ${HOSTS.join(', ')}.`;
const ROWS_ERROR = '--rows must be a positive integer or all.';
const WIDTH_ERROR = '--width must be an integer of at least 40.';
const NEEDS_FORMAT = '--rows, --width, --host and --no-color need --format.';

/** Codex is tested first: a Codex shell started inside Claude Code carries both markers and Codex is the inner host (spec §6.2). */
export function detectHost(env: NodeJS.ProcessEnv): Host {
  if (env.CODEX_SESSION_ID !== undefined || env.CODEX_THREAD_ID !== undefined) return 'codex';
  if (env.CLAUDECODE !== undefined) return 'claude';
  return 'terminal';
}

export function parseRenderOptions(argv: readonly string[], env: NodeJS.ProcessEnv, terminal: TerminalFacts): ParsedRenderOptions {
  const separator = argv.indexOf('--');
  const prefixEnd = separator === -1 ? argv.length : separator;
  const kept: string[] = [];
  let format: RenderFormatOption | undefined;
  let host: Host | undefined;
  let rows: number | 'all' | undefined;
  let width: number | undefined;
  let noColor = false;
  let formatGiven = false, othersGiven = false;
  const take = (name: string, index: number): { value: string | undefined; next: number } => {
    const token = argv[index]!;
    if (token.startsWith(`${name}=`)) return { value: token.slice(name.length + 1), next: index + 1 };
    const value = argv[index + 1];
    return value === undefined || index + 1 >= prefixEnd ? { value: undefined, next: index + 1 } : { value, next: index + 2 };
  };
  for (let index = 0; index < prefixEnd;) {
    const token = argv[index]!;
    if (token === '--format' || token.startsWith('--format=')) {
      formatGiven = true;
      const { value, next } = take('--format', index);
      if (value === undefined || !(FORMATS as readonly string[]).includes(value)) return { ok: false, error: FORMAT_ERROR };
      format = value as RenderFormatOption; index = next; continue;
    }
    if (token === '--host' || token.startsWith('--host=')) {
      othersGiven = true;
      const { value, next } = take('--host', index);
      if (value === undefined || !(HOSTS as readonly string[]).includes(value)) return { ok: false, error: HOST_ERROR };
      host = value as Host; index = next; continue;
    }
    if (token === '--rows' || token.startsWith('--rows=')) {
      othersGiven = true;
      const { value, next } = take('--rows', index);
      if (value === 'all') rows = 'all';
      else if (value !== undefined && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) rows = Number(value);
      else return { ok: false, error: ROWS_ERROR };
      index = next; continue;
    }
    if (token === '--width' || token.startsWith('--width=')) {
      othersGiven = true;
      const { value, next } = take('--width', index);
      if (value === undefined || !/^[0-9]+$/.test(value) || Number(value) < 40) return { ok: false, error: WIDTH_ERROR };
      width = Number(value); index = next; continue;
    }
    if (token === '--no-color') { othersGiven = true; noColor = true; index += 1; continue; }
    kept.push(token); index += 1;
  }
  if (!formatGiven && othersGiven) return { ok: false, error: NEEDS_FORMAT };
  const resolved: RenderOptions['format'] = format === undefined ? 'plain' : format === 'auto' ? (terminal.isTTY ? 'pretty' : 'md') : format;
  let cap: number | 'all' = rows ?? 25;
  // §4.2: on a TTY a pretty board fits one screen; `--rows all` lifts it.
  if (resolved === 'pretty' && terminal.isTTY && typeof terminal.rows === 'number' && cap !== 'all') cap = Math.min(cap, Math.max(5, terminal.rows - 12));
  const options: RenderOptions = {
    format: resolved, formatGiven,
    host: host ?? detectHost(env),
    rows: cap,
    width: width ?? (typeof terminal.columns === 'number' && terminal.columns >= 40 ? terminal.columns : 100),
    color: !noColor && (terminal.colorCapable || env.FORCE_COLOR !== undefined),
  };
  return { ok: true, argv: [...kept, ...argv.slice(prefixEnd)], options };
}

export const OUTPUT_HELP = [
  '',
  'Output:',
  '  --format <plain|md|pretty|json|auto>  render the result as a board: md for Claude Code and Codex, pretty for a',
  '                                        terminal, json for scripts; auto is pretty on a TTY and md otherwise',
  '                                        (default: plain, the output above)',
  '  --host <claude|codex|terminal>        how the board\'s Next line phrases commands (autodetected)',
  '  --rows <n|all>                        rows per table before the "… and N more" footer (default: 25)',
  '  --width <n>                           width of a pretty board (default: the terminal width, else 100; at least 40)',
  '  --no-color                            no ANSI colour in a pretty board',
].join('\n');
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/render/__tests__/board.test.ts src/lib/render/__tests__/options.test.ts`
Expected: PASS (2 + 8 tests).

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add src/lib/render/board.ts src/lib/render/options.ts src/lib/render/__tests__/board.test.ts src/lib/render/__tests__/options.test.ts
git commit -m "feat(render): the board model and the --format pre-parser (D1, §3)"
```

---

### Task 4: `banner.ts` — `paint()` and `yellow`

**Files:**
- Modify: `src/lib/banner.ts:28-43` (`StyleKind`, `style`)
- Test: `src/lib/__tests__/banner.test.ts` (the `uses only the five specified styles and reset` case)

**Interfaces:**
- Produces: `paint(kind: StyleKind, line: string, enabled: boolean): string` (pure; no env read), `StyleKind` = `'bold' | 'dim' | 'cyan' | 'green' | 'red' | 'yellow'`. `style(kind, line)` becomes `paint(kind, line, colorCapable())` and keeps its behaviour.

- [ ] **Step 1: Extend the failing test**

In `src/lib/__tests__/banner.test.ts`, replace the `uses only the five specified styles and reset` test with:

```ts
it('uses only the six specified styles and reset, and paint() is the pure form', () => {
  for (const [kind, code] of [['bold', 1], ['dim', 2], ['cyan', 36], ['green', 32], ['red', 31], ['yellow', 33]] as const) {
    expect(paint(kind, 'line', true)).toBe(`\x1b[${code}mline\x1b[0m`);
    expect(paint(kind, 'line', false)).toBe('line');
  }
  expect(style('yellow', 'line')).toBe(colorCapable() ? '\x1b[33mline\x1b[0m' : 'line');
});
```
and add `paint`, `colorCapable` to the import from `../banner.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/banner.test.ts`
Expected: FAIL — `paint` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/banner.ts` replace the `StyleKind` type and `style()`:

```ts
export type StyleKind = 'bold' | 'dim' | 'cyan' | 'green' | 'red' | 'yellow';
const CODES: Record<StyleKind, number> = { bold: 1, dim: 2, cyan: 36, green: 32, red: 31, yellow: 33 };
/** The pure form: the caller decides whether colour is on (a board's `ctx.color`); `style()` decides from the terminal. */
export function paint(kind: StyleKind, line: string, enabled: boolean): string {
  return enabled ? `\x1b[${CODES[kind]}m${line}\x1b[0m` : line;
}
export function style(kind: StyleKind, line: string): string { return paint(kind, line, colorCapable()); }
```

- [ ] **Step 4: Run the banner tests**

Run: `npx vitest run src/lib/__tests__/banner.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
git add src/lib/banner.ts src/lib/__tests__/banner.test.ts
git commit -m "feat(banner): paint() as the pure style form; yellow joins the palette"
```

---
### Task 5: `cells.ts` and the `md` backend

**Files:**
- Create: `src/lib/render/cells.ts`, `src/lib/render/md.ts`
- Test: `src/lib/render/__tests__/md.test.ts`

**Interfaces:**
- Produces (`cells.ts`): `RenderedCell { text; tone?; mono?; align }`, `renderCell(cell, ctx): RenderedCell`, `barText(fraction, label)`, `nextCommand(item: NextItem, ctx): string`, `quoteArg(arg)`.
- Produces (`md.ts`): `renderMd(board: Board, ctx: RenderContext): string`.
- Consumes: `Cell`, `NextItem`, `RenderContext`, `Board`, `Table`, `Section` (Task 3); `liftText`, `roundHalfEven` (Task 2); `relativeDate`, `singleLine`, `tildePath` (Task 1); `invocation` (`src/lib/invocation.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/render/__tests__/md.test.ts
import { describe, expect, it } from 'vitest';
import { bar, bars, board, code, count, date, kv, path, status, strip, table, text, textBlock, verdict, type RenderContext } from '../board.js';
import { barText, nextCommand, renderCell } from '../cells.js';
import { renderMd } from '../md.js';

const ctx: RenderContext = { format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined, home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['ls'], command: 'npx -y terum-skills@latest ls --format md' };

describe('cells', () => {
  it('renders every cell kind as the spec words it', () => {
    expect(renderCell(text('a|b\nc'), ctx).text).toBe('a|b c');
    expect(renderCell(count(null), ctx)).toEqual({ text: '—', align: 'right' });
    expect(renderCell(count(12), ctx)).toEqual({ text: '12', align: 'right' });
    expect(renderCell(verdict({ verdict: 'PASS', lift: 33 }), ctx)).toEqual({ text: '✓ PASS +33%', tone: 'ok', align: 'left' });
    expect(renderCell(verdict({ verdict: 'NEUTRAL', lift: 0, partial: [4, 6] }), ctx)).toEqual({ text: '● NEUTRAL ±0% (4/6 scored)', tone: 'muted', align: 'left' });
    expect(renderCell(verdict({ verdict: 'FAIL', lift: -20, stale: true, from: 'v2' }), ctx)).toEqual({ text: '✗ FAIL −20% ⚠ stale (v2)', tone: 'bad', align: 'left' });
    expect(renderCell(verdict({ verdict: null }), ctx)).toEqual({ text: '— not evaluated', tone: 'muted', align: 'left' });
    expect(renderCell(verdict({ verdict: null, stale: true }), ctx)).toEqual({ text: '⚠ stale — edited since the eval', tone: 'warn', align: 'left' });
    expect(renderCell(verdict({ verdict: null, invalid: true }), ctx)).toEqual({ text: '⚠ invalid receipt', tone: 'warn', align: 'left' });
    expect(renderCell(status('ok', 'git'), ctx).text).toBe('✓ git'); expect(renderCell(status('bad', 'gh'), ctx).text).toBe('✗ gh'); expect(renderCell(status('warn', 'x'), ctx).text).toBe('⚠ x');
    expect(renderCell(status('pending', 'x'), ctx).text).toBe('◔ x'); expect(renderCell(status('info', 'x'), ctx).text).toBe('● x'); expect(renderCell(status('muted', 'x'), ctx).text).toBe('— x');
    expect(renderCell(date('2026-09-11T12:00:00Z'), ctx).text).toBe('2d ago');
    expect(renderCell(path('/home/u/.claude/skills/x'), ctx)).toEqual({ text: '~/.claude/skills/x', mono: true, align: 'left' });
    expect(renderCell(code('v3'), ctx)).toEqual({ text: 'v3', mono: true, align: 'left' });
    expect(renderCell(strip('WWLT'), ctx)).toEqual({ text: 'WWLT', mono: true, align: 'left' });
    expect(barText(0.82, '82%')).toBe('████████░░ 82%'); expect(barText(0.25, '')).toBe('██░░░░░░░░'); expect(barText(null, 'n/a')).toBe('—————————— n/a');
    expect(renderCell(bar(1, '$1.00'), ctx).text).toBe('██████████ $1.00');
  });
  it('phrases a next step for each host', () => {
    const item = { label: 'Info', skill: 'skill-info', verb: 'ls skill', args: ['deploy-check'] };
    expect(nextCommand(item, ctx)).toBe('/skill-info deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'codex' })).toBe('$skill-info deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'terminal' })).toBe('npx -y terum-skills@latest ls skill deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'terminal', form: 'bare' })).toBe('terum-skills ls skill deploy-check');
    expect(nextCommand({ label: 'Install', verb: 'install', args: ['my skill'] }, ctx)).toBe('/terum-skills install "my skill"');
    expect(nextCommand({ label: 'Install', verb: 'install', args: ['my skill'] }, { ...ctx, host: 'codex' })).toBe('$terum-skills install "my skill"');
    expect(nextCommand({ label: 'Update', raw: 'npm install -g terum-skills@latest' }, ctx)).toBe('npm install -g terum-skills@latest');
  });
});

describe('md backend', () => {
  it('renders title, resolved, headline, sections, failure, notes and next in order', () => {
    const b = board('Marketplace — acme', {
      headline: '2 skills · 3 members',
      resolved: ['Resolved: "dep" → deploy-check (unique prefix)'],
      sections: [
        table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'installs', label: 'Installs', priority: 1, align: 'right' }, { key: 'eval', label: 'Eval', priority: 1 }],
          [{ skill: text('deploy-check'), installs: count(2), eval: verdict({ verdict: 'PASS', lift: 33 }) }, { skill: text('a|b'), installs: count(null), eval: verdict({ verdict: null }) }, { skill: text('third'), installs: count(0), eval: verdict({ verdict: null }) }],
          { title: 'Skills', cap: 2 }),
        kv([['role', text('Platform')], ['path', path('/home/u/proj')]], 'Identity'),
        textBlock(['# Body', 'line ``` inside'], { title: 'Body preview', fenced: 'md' }),
        bars([{ label: 'candidate', fraction: 0.8, value: '$0.40' }, { label: 'baseline', fraction: null, value: '—' }], 'ROI'),
        table([{ key: 'a', label: 'A', priority: 1 }], [], { title: 'Empty' }),
      ],
      notes: ['skills/bad: cannot parse'],
      next: [{ label: 'Info', skill: 'skill-info', verb: 'ls skill', args: ['deploy-check'] }, { label: 'Eval', skill: 'eval', verb: 'eval', args: ['deploy-check'] }],
      failure: { error: 'Hygiene failed for x:\nHYG1 SKILL.md: bad', partial: true },
    });
    expect(renderMd(b, ctx)).toBe([
      '## Marketplace — acme',
      '_Resolved: "dep" → deploy-check (unique prefix)_',
      '**2 skills · 3 members**',
      '',
      '### Skills',
      '',
      '| Skill | Installs | Eval |',
      '|---|---:|---|',
      '| deploy-check | 2 | ✓ PASS +33% |',
      '| a\\|b | — | — not evaluated |',
      '_… and 1 more — run `npx -y terum-skills@latest ls --format md --rows all`_',
      '',
      '### Identity',
      '',
      '- **role:** Platform',
      '- **path:** `~/proj`',
      '',
      '### Body preview',
      '',
      '````md',
      '# Body',
      'line ``` inside',
      '````',
      '',
      '### ROI',
      '',
      '| Label | Bar |',
      '|---|---|',
      '| candidate | ████████░░ $0.40 |',
      '| baseline | —————————— — |',
      '',
      '### Empty',
      '',
      '_none_',
      '',
      '> ❌ Hygiene failed for x: (partial result above)',
      '> HYG1 SKILL.md: bad',
      '',
      '**Notes**',
      '- skills/bad: cannot parse',
      '',
      '**Next:** `/skill-info deploy-check` · `/eval deploy-check`',
    ].join('\n'));
  });
  it('never emits an escape sequence and marks refusals and declines', () => {
    const md = renderMd(board('T', { failure: { error: 'no', refused: true } }), { ...ctx, color: true });
    expect(md).toBe('## T\n\n> ❌ no (refused)');
    expect(renderMd(board('T', { failure: { error: 'no', declined: true } }), ctx)).toBe('## T\n\n> ❌ no (declined)');
    expect(md).not.toMatch(/\x1b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/render/__tests__/md.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `cells.ts`**

```ts
// src/lib/render/cells.ts
/**
 * One cell → its text, for both text backends (§4.1's wording is the contract; `pretty` adds colour
 * and truncation on top). `nextCommand` is the one place a Next step is phrased for a host (§6.2).
 */
import { invocation } from '../invocation.js';
import type { Cell, NextItem, RenderContext, Tone } from './board.js';
import { liftText, roundHalfEven } from './policies.js';
import { relativeDate, singleLine, tildePath } from './text.js';

export interface RenderedCell { text: string; tone?: Tone; mono?: boolean; align: 'left' | 'right' }

const STATUS_GLYPH: Record<Tone, string> = { ok: '✓', bad: '✗', warn: '⚠', pending: '◔', info: '●', muted: '—' };
const VERDICT_TONE = { PASS: 'ok', NEUTRAL: 'info', FAIL: 'bad' } as const;
const VERDICT_GLYPH = { PASS: '✓', NEUTRAL: '●', FAIL: '✗' } as const;

export function renderCell(cell: Cell, ctx: RenderContext): RenderedCell {
  switch (cell.kind) {
    case 'text': return { text: singleLine(cell.text), align: 'left' };
    case 'count': return { text: cell.n === null ? '—' : String(cell.n), align: 'right' };
    case 'status': return { text: `${STATUS_GLYPH[cell.tone]} ${cell.text}`, tone: cell.tone, align: 'left' };
    case 'date': return { text: relativeDate(cell.iso, ctx.now), align: 'left' };
    case 'path': return { text: tildePath(cell.path, ctx.home), mono: true, align: 'left' };
    case 'code': return { text: cell.text, mono: true, align: 'left' };
    case 'strip': return { text: cell.text, mono: true, align: 'left' };
    case 'bar': return { text: barText(cell.fraction, cell.label), mono: true, align: 'left' };
    case 'verdict': {
      if (cell.invalid) return { text: '⚠ invalid receipt', tone: 'warn', align: 'left' };
      if (cell.verdict === null) return cell.stale ? { text: '⚠ stale — edited since the eval', tone: 'warn', align: 'left' } : { text: '— not evaluated', tone: 'muted', align: 'left' };
      let text = `${VERDICT_GLYPH[cell.verdict]} ${cell.verdict} ${liftText(cell.lift)}`;
      if (cell.partial) text += ` (${cell.partial[0]}/${cell.partial[1]} scored)`;
      if (cell.stale) text += ' ⚠ stale';
      if (cell.from !== null) text += ` (${cell.from})`;
      return { text, tone: cell.partial ? 'muted' : VERDICT_TONE[cell.verdict], align: 'left' };
    }
  }
}

/** Ten cells, the fraction rounded half-even; `——————————` for nothing to draw. */
export function barText(fraction: number | null, label: string): string {
  const filled = fraction === null ? null : roundHalfEven(Math.min(1, Math.max(0, fraction)) * 10);
  const cells = filled === null ? '—'.repeat(10) : `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  return label === '' ? cells : `${cells} ${label}`;
}

/** A bare word stays bare; anything else is double-quoted so a host pastes it as one argument. */
export function quoteArg(arg: string): string { return /^[A-Za-z0-9_./~:@+=-]+$/.test(arg) ? arg : JSON.stringify(arg); }

export function nextCommand(item: NextItem, ctx: RenderContext): string {
  if ('raw' in item) return item.raw;
  if (ctx.host === 'terminal') return invocation(ctx.form, item.verb, ...item.args);
  const sigil = ctx.host === 'claude' ? '/' : '$';
  const tail = item.args.length === 0 ? '' : ` ${item.args.map(quoteArg).join(' ')}`;
  return item.skill === undefined ? `${sigil}terum-skills ${item.verb}${tail}` : `${sigil}${item.skill}${tail}`;
}
```

- [ ] **Step 4: Implement `md.ts`**

```ts
// src/lib/render/md.ts
/** §4.1: GitHub-flavoured Markdown, no escape sequence, no HTML — what Claude Code and Codex render. */
import type { Board, Failure, RenderContext, Section, Table } from './board.js';
import { barText, nextCommand, renderCell, type RenderedCell } from './cells.js';
import { singleLine } from './text.js';

export function renderMd(board: Board, ctx: RenderContext): string {
  const out: string[] = [`## ${board.title}`];
  for (const line of board.resolved) out.push(`_${line}_`);
  if (board.headline !== undefined) out.push(`**${board.headline}**`);
  for (const section of board.sections) out.push('', ...renderSection(section, ctx));
  if (board.failure) {
    const [first, ...rest] = board.failure.error.split(/\r?\n/);
    out.push('', `> ❌ ${first ?? ''}${failureSuffix(board.failure)}`, ...rest.map((line) => `> ${line}`));
  }
  if (board.notes.length) out.push('', '**Notes**', ...board.notes.map((note) => `- ${note}`));
  if (board.next.length) out.push('', `**Next:** ${board.next.map((item) => `\`${nextCommand(item, ctx)}\``).join(' · ')}`);
  return out.join('\n');
}

export function failureSuffix(failure: Failure): string {
  return failure.refused ? ' (refused)' : failure.declined ? ' (declined)' : failure.partial ? ' (partial result above)' : '';
}

const escape = (text: string): string => singleLine(text).replaceAll('|', '\\|');
const inline = (cell: RenderedCell): string => (cell.mono ? `\`${escape(cell.text)}\`` : escape(cell.text));

/** A fence one backtick longer than any run inside the body, so a body that quotes a fence still renders. */
function fence(lines: readonly string[]): string {
  const longest = Math.max(2, ...lines.flatMap((line) => [...line.matchAll(/`+/g)].map((run) => run[0].length)));
  return '`'.repeat(longest + 1);
}

function renderSection(section: Section, ctx: RenderContext): string[] {
  const out: string[] = section.title === undefined ? [] : [`### ${section.title}`, ''];
  switch (section.kind) {
    case 'table': out.push(...renderTable(section, ctx)); break;
    case 'kv': for (const [label, cell] of section.rows) out.push(`- **${label}:** ${inline(renderCell(cell, ctx))}`); break;
    case 'text': {
      if (section.fenced === undefined) out.push(...section.lines);
      else { const mark = fence(section.lines); out.push(`${mark}${section.fenced === 'md' ? 'md' : ''}`, ...section.lines, mark); }
      break;
    }
    case 'bars': out.push('| Label | Bar |', '|---|---|', ...section.rows.map((row) => `| ${escape(row.label)} | ${barText(row.fraction, row.value)} |`)); break;
  }
  return out;
}

function renderTable(table: Table, ctx: RenderContext): string[] {
  if (table.rows.length === 0) return ['_none_'];
  const cells = table.rows.map((row) => table.columns.map((column) => renderCell(row[column.key] ?? { kind: 'text', text: '—' }, ctx)));
  const right = table.columns.map((column, index) => column.align === 'right' || cells.every((row) => row[index]!.align === 'right'));
  const out = [
    `| ${table.columns.map((column) => escape(column.label)).join(' | ')} |`,
    `|${right.map((isRight) => (isRight ? '---:' : '---')).join('|')}|`,
    ...cells.map((row) => `| ${row.map(inline).join(' | ')} |`),
  ];
  if (table.more) out.push(`_… and ${table.more.count} more — run \`${ctx.command} --rows all\`_`);
  return out;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/render/__tests__/md.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Catalogue the invocation literal, lint, commit**

`cells.ts` carries the literal `terum-skills` in `${sigil}terum-skills ${item.verb}${tail}`; run `npx vitest run src/lib/__tests__/invocation-tripwire.test.ts` — it fails naming the line. Add to `src/lib/__tests__/invocation-catalog.ts` (alphabetical by file, as the existing rows are):

```ts
  {
    "file": "src/lib/render/cells.ts",
    "line": 47,
    "policy": "fixed",
    "pattern": "return item.skill === undefined ? `${sigil}terum-skills ${item.verb}${tail}` : `${sigil}${item.skill}${tail}`;"
  },
```
(`line` is informational; the tripwire keys on `file: pattern`. Copy the pattern from the test's diff output verbatim.) Re-run the tripwire: PASS.

Run: `npm run lint && npm run typecheck`

```bash
git add src/lib/render/cells.ts src/lib/render/md.ts src/lib/render/__tests__/md.test.ts src/lib/__tests__/invocation-catalog.ts
git commit -m "feat(render): cell wording and the Markdown backend (§4.1)"
```

---

### Task 6: the `pretty` backend

**Files:**
- Create: `src/lib/render/pretty.ts`
- Test: `src/lib/render/__tests__/pretty.test.ts`

**Interfaces:**
- Produces: `renderPretty(board: Board, ctx: RenderContext): string`.
- Consumes: `paint`, `StyleKind` (Task 4); `renderCell`, `barText`, `nextCommand` (Task 5); `padVisible`, `truncate`, `visibleWidth` (Task 1); `failureSuffix` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/render/__tests__/pretty.test.ts
import { describe, expect, it } from 'vitest';
import { bars, board, count, kv, path, status, strip, table, text, textBlock, verdict, type RenderContext } from '../board.js';
import { renderPretty } from '../pretty.js';
import { stripAnsi } from '../text.js';

const ctx: RenderContext = { format: 'pretty', host: 'terminal', rows: 25, width: 100, color: false, form: 'bare', home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['ls'], command: 'terum-skills ls --format pretty' };
const columns = [
  { key: 'skill', label: 'Skill', priority: 1 as const },
  { key: 'desc', label: 'Desc', priority: 2 as const, max: 20 },
  { key: 'author', label: 'Author', priority: 3 as const },
  { key: 'installs', label: 'Installs', priority: 1 as const, align: 'right' as const },
];
const rows = [
  { skill: text('deploy-check'), desc: text('A very long description that will be truncated'), author: text('Mira Chen'), installs: count(2) },
  { skill: text('tdd'), desc: text('Short.'), author: text('Seed'), installs: count(null) },
];

describe('pretty backend', () => {
  it('draws a box table with right-aligned numbers and truncated cells', () => {
    const out = renderPretty(board('Marketplace', { sections: [table(columns, rows, { title: 'Skills' })] }), ctx);
    expect(out).toBe([
      'Marketplace',
      '',
      'Skills',
      '╭──────────────┬──────────────────────┬───────────┬──────────╮',
      '│ Skill        │ Desc                 │ Author    │ Installs │',
      '├──────────────┼──────────────────────┼───────────┼──────────┤',
      '│ deploy-check │ A very long descrip… │ Mira Chen │        2 │',
      '│ tdd          │ Short.               │ Seed      │        — │',
      '╰──────────────┴──────────────────────┴───────────┴──────────╯',
    ].join('\n'));
  });
  it('drops priority-3 then priority-2 columns to fit the width, never priority 1, and says which', () => {
    const narrow = renderPretty(board('M', { sections: [table(columns, rows)] }), { ...ctx, width: 62 });
    expect(narrow).toContain('│ Skill        │ Installs │');
    expect(narrow).not.toContain('Author');
    expect(narrow).toContain('(columns not shown at this width: Desc, Author)');
    const mid = renderPretty(board('M', { sections: [table(columns, rows)] }), { ...ctx, width: 70 });
    expect(mid).toContain('│ Skill        │ Desc                 │ Installs │');
    expect(mid).toContain('(columns not shown at this width: Author)');
  });
  it('degrades to a key/value list per row below 60 columns', () => {
    const out = renderPretty(board('M', { sections: [table(columns, rows)] }), { ...ctx, width: 40 });
    expect(out).toBe(['M', '', '  Skill:    deploy-check', '  Desc:     A very long descrip…', '  Author:   Mira Chen', '  Installs: 2', '', '  Skill:    tdd', '  Desc:     Short.', '  Author:   Seed', '  Installs: —'].join('\n'));
  });
  it('renders kv, text, bars, notes, next, failure and the more footer', () => {
    const out = renderPretty(board('T', {
      headline: 'h', resolved: ['Resolved: x from the working directory'],
      sections: [kv([['role', text('Platform')], ['path', path('/home/u/p')]], 'Identity'), textBlock(['# Body'], { fenced: 'md' }), bars([{ label: 'candidate', fraction: 0.5, value: '$1' }]), table(columns.slice(0, 1), [rows[0]!, rows[1]!], { cap: 1 })],
      notes: ['n1'], next: [{ label: 'Eval', skill: 'eval', verb: 'eval', args: ['tdd'] }], failure: { error: 'boom\nline 2', refused: true },
    }), ctx);
    expect(out).toBe([
      'T', 'Resolved: x from the working directory', 'h', '',
      'Identity', '  role: Platform', '  path: ~/p', '',
      '  # Body', '',
      '  candidate █████░░░░░ $1', '',
      '╭──────────────╮', '│ Skill        │', '├──────────────┤', '│ deploy-check │', '╰──────────────╯', '… and 1 more — run terum-skills ls --format pretty --rows all', '',
      '✗ boom (refused)', '  line 2', '',
      'Notes', '  • n1', '',
      'Next: terum-skills eval tdd',
    ].join('\n'));
  });
  it('colours tones, strips and commands only when ctx.color is on, and the visible text is identical', () => {
    const b = board('T', { sections: [table([{ key: 's', label: 'S', priority: 1 as const }, { key: 'v', label: 'V', priority: 1 as const }, { key: 'r', label: 'R', priority: 1 as const }], [{ s: status('ok', 'git'), v: verdict({ verdict: 'FAIL', lift: -50 }), r: strip('WLT') }])], next: [{ label: 'x', verb: 'sync', args: [] }] });
    const plain = renderPretty(b, ctx);
    const coloured = renderPretty(b, { ...ctx, color: true });
    expect(plain).not.toMatch(/\x1b/);
    expect(stripAnsi(coloured)).toBe(plain);
    expect(coloured).toContain('\x1b[32m✓ git\x1b[0m'); expect(coloured).toContain('\x1b[31m✗ FAIL −50%\x1b[0m');
    expect(coloured).toContain('\x1b[32mW\x1b[0m\x1b[31mL\x1b[0m\x1b[2mT\x1b[0m'); expect(coloured).toContain('\x1b[36mterum-skills sync\x1b[0m'); expect(coloured).toContain('\x1b[1mT\x1b[0m');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/render/__tests__/pretty.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/render/pretty.ts
/**
 * §4.2: box-drawn tables in setup's `box()` style, tones as colour through `paint()` (never
 * `colorCapable()` — the sink decided colour once), columns dropped by priority when a table exceeds
 * `ctx.width`, a key/value list per row below 60 columns.
 */
import { paint, type StyleKind } from '../banner.js';
import type { Board, Column, RenderContext, Section, Table, Tone } from './board.js';
import { barText, nextCommand, renderCell, type RenderedCell } from './cells.js';
import { failureSuffix } from './md.js';
import { padVisible, truncate, visibleWidth } from './text.js';

const TONE_STYLE: Record<Tone, StyleKind> = { ok: 'green', bad: 'red', warn: 'yellow', pending: 'yellow', muted: 'dim', info: 'cyan' };
const MIN_COLUMN = 6;
type Paint = (kind: StyleKind, text: string) => string;

export function renderPretty(board: Board, ctx: RenderContext): string {
  const c: Paint = (kind, text) => paint(kind, text, ctx.color);
  const out: string[] = [c('bold', board.title)];
  for (const line of board.resolved) out.push(c('dim', line));
  if (board.headline !== undefined) out.push(board.headline);
  for (const section of board.sections) out.push('', ...renderSection(section, ctx, c));
  if (board.failure) {
    const [first, ...rest] = board.failure.error.split(/\r?\n/);
    out.push('', c('red', `✗ ${first ?? ''}${failureSuffix(board.failure)}`), ...rest.map((line) => c('red', `  ${line}`)));
  }
  if (board.notes.length) out.push('', c('bold', 'Notes'), ...board.notes.map((note) => `  • ${note}`));
  if (board.next.length) out.push('', `${c('bold', 'Next:')} ${board.next.map((item) => c('cyan', nextCommand(item, ctx))).join(' · ')}`);
  return out.join('\n');
}

function colour(text: string, cell: RenderedCell, c: Paint): string {
  if (cell.tone !== undefined) return c(TONE_STYLE[cell.tone], text);
  if (cell.text === text && /^[WLT-]+$/.test(text) && cell.mono) return [...text].map((letter) => c(letter === 'W' ? 'green' : letter === 'L' ? 'red' : 'dim', letter)).join('');
  return text;
}

function renderSection(section: Section, ctx: RenderContext, c: Paint): string[] {
  const out: string[] = section.title === undefined ? [] : [c('bold', section.title)];
  switch (section.kind) {
    case 'table': out.push(...renderTable(section, ctx, c)); break;
    case 'kv': {
      const width = Math.max(0, ...section.rows.map(([label]) => visibleWidth(label) + 1));
      for (const [label, cell] of section.rows) { const rendered = renderCell(cell, ctx); out.push(`  ${padVisible(`${label}:`, width)} ${colour(rendered.text, rendered, c)}`); }
      break;
    }
    case 'text': out.push(...section.lines.map((line) => `  ${line}`)); break;
    case 'bars': {
      const width = Math.max(0, ...section.rows.map((row) => visibleWidth(row.label)));
      for (const row of section.rows) out.push(`  ${padVisible(row.label, width)} ${barText(row.fraction, row.value)}`);
      break;
    }
  }
  return out;
}

function renderTable(table: Table, ctx: RenderContext, c: Paint): string[] {
  if (table.rows.length === 0) return ['  none'];
  const rendered = table.rows.map((row) => table.columns.map((column) => renderCell(row[column.key] ?? { kind: 'text', text: '—' }, ctx)));
  if (ctx.width < 60) return keyValueRows(table.columns, rendered, c);
  const clip = (cell: RenderedCell, column: Column): string => (column.max === undefined ? cell.text : truncate(cell.text, column.max));
  const widths = table.columns.map((column, index) => Math.max(visibleWidth(column.label), ...rendered.map((row) => visibleWidth(clip(row[index]!, column)))));
  let keep = table.columns.map((_, index) => index);
  const total = (): number => keep.reduce((sum, index) => sum + widths[index]! + 3, 1);
  for (const priority of [3, 2] as const) {
    while (total() > ctx.width) {
      const drop = [...keep].reverse().find((index) => table.columns[index]!.priority === priority);
      if (drop === undefined) break;
      keep = keep.filter((index) => index !== drop);
    }
  }
  // Only priority-1 columns left and still too wide: narrow the widest until it fits or nothing can give.
  while (total() > ctx.width) {
    const widest = keep.reduce((a, b) => (widths[a]! >= widths[b]! ? a : b));
    if (widths[widest]! <= MIN_COLUMN) break;
    widths[widest] = widths[widest]! - 1;
  }
  const rule = (left: string, mid: string, right: string): string => `${left}${keep.map((index) => '─'.repeat(widths[index]! + 2)).join(mid)}${right}`;
  const line = (cells: string[]): string => `│ ${cells.join(' │ ')} │`;
  const out = [
    rule('╭', '┬', '╮'),
    line(keep.map((index) => c('bold', padVisible(table.columns[index]!.label, widths[index]!, table.columns[index]!.align ?? 'left')))),
    rule('├', '┼', '┤'),
  ];
  for (const row of rendered) {
    out.push(line(keep.map((index) => {
      const cell = row[index]!; const width = widths[index]!;
      return padVisible(colour(truncate(clip(cell, table.columns[index]!), width), cell, c), width, cell.align);
    })));
  }
  out.push(rule('╰', '┴', '╯'));
  if (table.more) out.push(c('dim', `… and ${table.more.count} more — run ${ctx.command} --rows all`));
  const dropped = table.columns.filter((_, index) => !keep.includes(index)).map((column) => column.label);
  if (dropped.length) out.push(c('dim', `(columns not shown at this width: ${dropped.join(', ')})`));
  return out;
}

function keyValueRows(columns: readonly Column[], rendered: readonly RenderedCell[][], c: Paint): string[] {
  const width = Math.max(0, ...columns.map((column) => visibleWidth(column.label) + 1));
  const out: string[] = [];
  for (const [rowIndex, row] of rendered.entries()) {
    if (rowIndex > 0) out.push('');
    for (const [index, column] of columns.entries()) {
      const cell = row[index]!;
      out.push(`  ${padVisible(`${column.label}:`, width)} ${colour(column.max === undefined ? cell.text : truncate(cell.text, column.max), cell, c)}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/render/__tests__/pretty.test.ts`
Expected: PASS (5 tests). If the box widths in the first expectation differ by one, the arithmetic is wrong in the implementation, not the test: `Desc` is capped at 20 code points (`A very long descrip…` is 20), `Installs` is 8 wide, and each column adds two padding spaces.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
git add src/lib/render/pretty.ts src/lib/render/__tests__/pretty.test.ts
git commit -m "feat(render): the pretty backend — box tables, priority column drops, tones as colour (§4.2)"
```

---

### Task 7: `json.ts`, the registry, and the board sink

**Files:**
- Create: `src/lib/render/json.ts`, `src/lib/render/registry.ts`, `src/lib/render/sink.ts`
- Test: `src/lib/render/__tests__/registry.test.ts` (the fallback and exhaustiveness halves; renderer null-safety is added in Task 16), `src/lib/render/__tests__/sink.test.ts`

**Interfaces:**
- Produces (`json.ts`): `renderJson(outcome: ResultOutcome, lines: readonly string[]): string`.
- Produces (`registry.ts`): `Renderer { render(value: unknown, ctx): Board; covered: RegExp[]; uncovered?(lines: string[], value: unknown): string[] }`, `REGISTRY: Record<string, Renderer>` (empty until Tasks 13–16 fill it), `RENDERED_VERBS` (the thirteen keys), `FALLBACK_VERBS`, `renderBoard(outcome, lines, resolved, ctx): Board`, `fallbackBoard(verb, lines)`.
- Produces (`sink.ts`): `BoardSinkInput { options: RenderOptions; form?: InvocationForm; home: string; now(): number; argv: readonly string[]; command: string; write(text: string): void; stderr(line: string): void; setExitCode(code: number): void; progress?(line: string): void; afterVerb?(): Promise<void> }`, `createBoardSink(input): ExecuteSink & { lines: string[] }`.
- Consumes: `ExecuteSink` (`src/lib/execute.ts`), `Prompter`, `PromptClosedError`, `ProgressUpdate` (`src/lib/prompt.ts`), `ResultOutcome`, `FRAME_VERBS` (`src/lib/frames.ts`), `renderMd` (Task 5), `renderPretty` (Task 6), `RenderOptions` (Task 3), `RESOLVED_PREFIX` (Task 8 — until then the sink imports the constant from `resolve-ref.ts`, which Task 8 creates; **create `src/lib/resolve-ref.ts` in this task with only the constant** `export const RESOLVED_PREFIX = 'Resolved: ';` and Task 8 fills the rest).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/render/__tests__/registry.test.ts
import { describe, expect, it } from 'vitest';
import { FRAME_VERBS } from '../../frames.js';
import { type RenderContext } from '../board.js';
import { FALLBACK_VERBS, REGISTRY, RENDERED_VERBS, renderBoard } from '../registry.js';

export const CTX: RenderContext = { format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined, home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['publish', 'x'], command: 'npx -y terum-skills@latest publish x --format md' };

describe('registry (D5)', () => {
  it('rendered verbs and fallback verbs partition FRAME_VERBS exactly', () => {
    expect([...RENDERED_VERBS, ...FALLBACK_VERBS].sort()).toEqual([...FRAME_VERBS].sort());
    expect(RENDERED_VERBS.filter((verb) => FALLBACK_VERBS.includes(verb))).toEqual([]);
  });
  it('every registry key is a rendered verb (the registry fills in as renderers land)', () => {
    for (const key of Object.keys(REGISTRY)) expect(RENDERED_VERBS).toContain(key);
  });
  it('renders an unregistered verb as a fenced block of its lines, with resolved lines and the failure attached', () => {
    const b = renderBoard({ verb: 'publish', ok: false, error: 'declined', cancelled: true, exitCode: 1 }, ['a', 'b'], ['Resolved: x from the working directory'], CTX);
    expect(b).toEqual({ title: 'publish', resolved: ['Resolved: x from the working directory'], sections: [{ kind: 'text', lines: ['a', 'b'], fenced: 'text' }], notes: [], next: [], failure: { error: 'declined', declined: true } });
    expect(renderBoard({ verb: 'publish', ok: true, value: {}, exitCode: 0 }, [], [], CTX)).toEqual({ title: 'publish', resolved: [], sections: [], notes: [], next: [] });
    expect(renderBoard({ verb: 'eval', ok: false, error: 'x', refused: true, value: { items: [] }, exitCode: 1 }, [], [], CTX).failure).toEqual({ error: 'x', refused: true, partial: true });
  });
  it('answers with the fallback block and a note when a renderer throws', () => {
    REGISTRY['__throwing__'] = { render: () => { throw new Error('renderer bug'); }, covered: [] };
    try {
      const b = renderBoard({ verb: '__throwing__', ok: true, value: {}, exitCode: 0 }, ['line'], [], CTX);
      expect(b.sections).toEqual([{ kind: 'text', lines: ['line'], fenced: 'text' }]);
      expect(b.notes).toEqual(['The __throwing__ board could not be drawn (renderer bug); its printed lines are shown instead.']);
    } finally { delete REGISTRY['__throwing__']; }
  });
});
```

```ts
// src/lib/render/__tests__/sink.test.ts
import { describe, expect, it } from 'vitest';
import { PromptClosedError } from '../../prompt.js';
import { createBoardSink } from '../sink.js';
import type { RenderOptions } from '../options.js';

const options: RenderOptions = { format: 'md', formatGiven: true, host: 'claude', rows: 25, width: 100, color: false };
function make(overrides: Partial<Parameters<typeof createBoardSink>[0]> = {}) {
  const written: string[] = []; const errors: string[] = []; const codes: number[] = []; const progress: string[] = [];
  const sink = createBoardSink({ options, home: '/home/u', now: () => Date.parse('2026-09-13T12:00:00Z'), argv: ['publish', 'x'], command: 'npx -y terum-skills@latest publish x --format md', write: (text) => written.push(text), stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code), progress: (line) => progress.push(line), ...overrides });
  return { sink, written, errors, codes, progress };
}

describe('the board sink (D3)', () => {
  it('collects prints split on newlines, lifts Resolved: lines, and writes one Markdown document with a trailing newline', () => {
    const { sink, written } = make();
    sink.io.print('Resolved: "x" → xylophone (unique prefix)'); sink.io.print('a\nb'); sink.io.print('');
    sink.result!({ verb: 'publish', ok: true, value: { ok: 1 }, exitCode: 0 });
    expect(written).toEqual(['## publish\n_Resolved: "x" → xylophone (unique prefix)_\n\n```\na\nb\n```\n']);
    expect(sink.lines).toEqual(['Resolved: "x" → xylophone (unique prefix)', 'a', 'b', '']);
  });
  it('refuses every question as a non-TTY terminal would and exposes no interactivity', async () => {
    const { sink } = make();
    expect(sink.io.interactive).toBe(false); expect(sink.io.channel).toBe('terminal');
    for (const ask of [() => sink.io.confirm('Go?'), () => sink.io.text('Name'), () => sink.io.select('Pick', ['a'])]) {
      const error = await ask().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(PromptClosedError); expect((error as PromptClosedError).message).toContain('not-interactive');
    }
  });
  it('renders the json document with every printed line and the failure fields', () => {
    const { sink, written, errors, codes } = make({ options: { ...options, format: 'json' } });
    sink.io.print('Resolved: x from the working directory'); sink.io.print('one');
    sink.stderr('boom'); sink.setExitCode(1);
    sink.result!({ verb: 'publish', ok: false, error: 'boom', cancelled: true, value: { partial: true }, exitCode: 1 });
    expect(JSON.parse(written[0]!)).toEqual({ verb: 'publish', ok: false, exitCode: 1, error: 'boom', declined: true, value: { partial: true }, lines: ['Resolved: x from the working directory', 'one'] });
    expect(written[0]!.endsWith('\n')).toBe(true);
    expect(errors).toEqual(['boom']); expect(codes).toEqual([1]);
  });
  it('renders pretty with the board colour decision and forwards progress as one line', () => {
    const { sink, written, progress } = make({ options: { ...options, format: 'pretty', color: true } });
    sink.io.progress?.({ step: 'evals', current: 1, total: 2 }); sink.io.progress?.({ step: 'download' });
    sink.result!({ verb: 'publish', ok: true, exitCode: 0 });
    expect(progress).toEqual(['evals 1/2', 'download', '']); // the trailing '' clears the progress line before the board
    expect(written[0]).toBe('\x1b[1mpublish\x1b[0m\n');
    const silent = make({ options: { ...options, format: 'pretty' }, progress: undefined });
    expect(silent.sink.io.progress).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/render/__tests__/registry.test.ts src/lib/render/__tests__/sink.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `json.ts`**

```ts
// src/lib/render/json.ts
/** D4: the result frame minus `t`, plus every printed line — one document, one read. */
import type { ResultOutcome } from '../frames.js';

export function renderJson(outcome: ResultOutcome, lines: readonly string[]): string {
  const document = {
    verb: outcome.verb, ok: outcome.ok, exitCode: outcome.exitCode,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    ...(outcome.cancelled === true ? { declined: true } : {}),
    ...(outcome.refused === true ? { refused: true } : {}),
    ...(outcome.value === undefined ? {} : { value: outcome.value }),
    lines: [...lines],
  };
  return JSON.stringify(document, null, 2);
}
```

- [ ] **Step 4: Create `src/lib/resolve-ref.ts` with the constant only**

```ts
// src/lib/resolve-ref.ts
/** D7: the one recognisable line the sink lifts into `board.resolved`. The resolver itself is Task 8. */
export const RESOLVED_PREFIX = 'Resolved: ';
```

- [ ] **Step 5: Implement `registry.ts`**

```ts
// src/lib/render/registry.ts
/**
 * D5: one renderer per verb, keyed by the `verb` of a ResultOutcome; every other public verb is
 * listed in FALLBACK_VERBS on purpose (a fenced block of its printed lines). D6: a printed line no
 * renderer covers becomes a note, so nothing a verb said is lost. A renderer that throws is a defect,
 * but the person still gets the fallback block and a note naming it (§12).
 */
import { FRAME_VERBS } from '../frames.js';
import type { ResultOutcome } from '../frames.js';
import { board, textBlock, type Board, type RenderContext } from './board.js';

export interface Renderer {
  render(value: unknown, ctx: RenderContext): Board;
  /** The printed lines this board reproduces from `value`; anything else is a note. */
  covered: RegExp[];
  /** For a board whose plain output cannot be matched by pattern: decide the notes from the lines and the value. */
  uncovered?(lines: readonly string[], value: unknown): string[];
}

export const RENDERED_VERBS: readonly string[] = ['ls', 'status', 'search', 'eval-report', 'eval', 'update', 'sync', 'validate', 'install', 'uninstall-skill', 'project list', 'project add', 'project remove'];
export const FALLBACK_VERBS: readonly string[] = FRAME_VERBS.filter((verb) => !RENDERED_VERBS.includes(verb));

/** Filled by the verb modules (Tasks 13–16); a key here must be in RENDERED_VERBS. */
export const REGISTRY: Record<string, Renderer> = {};

export function fallbackBoard(verb: string, lines: readonly string[]): Board {
  return board(verb, { sections: lines.length === 0 ? [] : [textBlock([...lines], { fenced: 'text' })] });
}

export function renderBoard(outcome: ResultOutcome, printed: readonly string[], resolved: readonly string[], ctx: RenderContext): Board {
  const lines = printed.filter((line) => line.trim() !== '');
  const renderer = REGISTRY[outcome.verb];
  let drawn: Board;
  if (renderer === undefined) drawn = fallbackBoard(outcome.verb, lines);
  else {
    try {
      drawn = renderer.render(outcome.value, ctx);
      const notes = renderer.uncovered ? renderer.uncovered(lines, outcome.value) : lines.filter((line) => !renderer.covered.some((pattern) => pattern.test(line)));
      drawn.notes.push(...notes);
    } catch (error) {
      drawn = fallbackBoard(outcome.verb, lines);
      drawn.notes.push(`The ${outcome.verb} board could not be drawn (${error instanceof Error ? error.message : String(error)}); its printed lines are shown instead.`);
    }
  }
  drawn.resolved = [...resolved];
  if (!outcome.ok) {
    drawn.failure = {
      error: outcome.error ?? 'failed',
      ...(outcome.refused === true ? { refused: true as const } : {}),
      ...(outcome.cancelled === true ? { declined: true as const } : {}),
      ...(outcome.value === undefined ? {} : { partial: true as const }),
    };
  }
  return drawn;
}
```

- [ ] **Step 6: Implement `sink.ts`**

```ts
// src/lib/render/sink.ts
/**
 * D3: the ExecuteSink of a board run. The Prompter collects prints and refuses questions exactly as a
 * non-TTY terminal does (PromptClosedError 'not-interactive'), so every verb's classification holds;
 * `result()` renders once and writes once. stderr and the exit code are the caller's, untouched.
 */
import type { ExecuteSink } from '../execute.js';
import type { ResultOutcome } from '../frames.js';
import type { InvocationForm } from '../invocation.js';
import { PromptClosedError, type ProgressUpdate, type Prompter } from '../prompt.js';
import { RESOLVED_PREFIX } from '../resolve-ref.js';
import type { RenderContext } from './board.js';
import { renderJson } from './json.js';
import { renderMd } from './md.js';
import type { RenderOptions } from './options.js';
import { renderPretty } from './pretty.js';
import { renderBoard } from './registry.js';

export interface BoardSinkInput {
  options: RenderOptions;
  form?: InvocationForm | undefined;
  home: string;
  now(): number;
  /** The verb's argv after the bin, flags stripped: `['ls', 'skill', 'x']`. */
  argv: readonly string[];
  /** The same as a re-runnable command line, for the `--rows all` footer. */
  command: string;
  write(text: string): void;
  stderr(line: string): void;
  setExitCode(code: number): void;
  /** A one-line progress sink (stderr on a TTY); absent means progress is dropped. */
  progress?: ((line: string) => void) | undefined;
  afterVerb?: (() => Promise<void>) | undefined;
}

export function createBoardSink(input: BoardSinkInput): ExecuteSink & { lines: string[] } {
  const lines: string[] = [];
  const refuse = (question: string): never => { throw new PromptClosedError(question, 'not-interactive'); };
  const progress = input.progress;
  const io: Prompter = {
    interactive: false,
    channel: 'terminal',
    print: (line) => { lines.push(...line.split(/\r?\n/)); },
    confirm: async (question) => refuse(question),
    text: async (question) => refuse(question),
    select: async (question) => refuse(question),
    ...(progress === undefined ? {} : { progress: (update: ProgressUpdate) => { progress(`${update.step}${update.current === undefined ? '' : ` ${update.current}${update.total === undefined ? '' : `/${update.total}`}`}`); } }),
  };
  const result = (outcome: ResultOutcome): void => {
    if (input.options.format === 'plain') return; // never built for plain (D2); defensive
    input.progress?.(''); // clear the one-line progress before the board lands
    if (input.options.format === 'json') { input.write(`${renderJson(outcome, lines)}\n`); return; }
    const resolved = lines.filter((line) => line.startsWith(RESOLVED_PREFIX));
    const rest = lines.filter((line) => !line.startsWith(RESOLVED_PREFIX));
    const ctx: RenderContext = { format: input.options.format, host: input.options.host, rows: input.options.rows, width: input.options.width, color: input.options.color, form: input.form, home: input.home, now: input.now(), argv: input.argv, command: input.command };
    const board = renderBoard(outcome, rest, resolved, ctx);
    input.write(`${input.options.format === 'pretty' ? renderPretty(board, ctx) : renderMd(board, ctx)}\n`);
  };
  return { io, lines, result, stderr: input.stderr, setExitCode: input.setExitCode, ...(input.form === undefined ? {} : { form: input.form }), ...(input.afterVerb === undefined ? {} : { afterVerb: input.afterVerb }) };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/render/__tests__/registry.test.ts src/lib/render/__tests__/sink.test.ts`
Expected: PASS (4 + 4 tests).

- [ ] **Step 8: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`

```bash
git add src/lib/render/json.ts src/lib/render/registry.ts src/lib/render/sink.ts src/lib/resolve-ref.ts src/lib/render/__tests__/registry.test.ts src/lib/render/__tests__/sink.test.ts
git commit -m "feat(render): json document, renderer registry with an explicit fallback, and the board sink (D3–D6)"
```

---

### Task 8: `src/lib/resolve-ref.ts` — the autofill ladder (§6.1)

**Files:**
- Modify: `src/lib/resolve-ref.ts` (created with the constant in Task 7)
- Test: `src/lib/__tests__/resolve-ref.test.ts`

**Interfaces:**
- Produces: `RESOLVED_PREFIX`, `ResolveHow = 'cwd' | 'exact' | 'case' | 'prefix' | 'substring'`, `ResolvedRef = { name; how; source: 'library'; match: LibrarySkillMatch } | { name; how; source: 'team'; record: SkillRecord }`, `ResolveInput { ref: string | undefined; cwd: string; home: string; config: Pick<Config, 'placements' | 'projects'>; stateRoot: string; team?: { clone: string; name: string }; rungs: 2 | 4; print(line: string): void; miss(ref: string): string; pathMiss?(ref: string): string }`, `resolveSkillRef(input): Promise<Result<ResolvedRef>>`, `nearestSkillFolder(cwd): Promise<string | undefined>`, `CWD_MISS` (the rung-0 sentence).
- Consumes: `resolveLibrarySkill`, `refIsPath`, `localSkillRoots`, `localSkills`, `LibrarySkillMatch` (`src/lib/local-skills.ts`); `findSkill`, `skillRecords`, `SkillRecord` (`src/lib/skills.ts`); `Result`, `failure`, `success` (`src/lib/result.ts`); `Config` (`src/lib/schema.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/resolve-ref.test.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../config.js';
import { CWD_MISS, nearestSkillFolder, resolveSkillRef, type ResolveInput } from '../resolve-ref.js';
import { temporaryDirectory } from './fixtures.js';

const ID = '11111111-1111-4111-8111-111111111111';
const record = (name: string, id = ID) => `---\nname: ${name}\ndescription: Team ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: ops\n---\n# ${name}\n`;

async function library() {
  const home = await temporaryDirectory();
  const store = createConfigStore(join(home, 'state'));
  const root = join(home, '.claude', 'skills');
  for (const name of ['deploy-check', 'decision-walk', 'Notes']) { await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: local ${name}\n---\n`); }
  await mkdir(join(root, 'broken'), { recursive: true }); await writeFile(join(root, 'broken', 'SKILL.md'), '---\nname: [\n---\n');
  const clone = join(home, 'clone');
  await mkdir(join(clone, 'skills', 'tdd', 'v1'), { recursive: true }); await mkdir(join(clone, 'people'), { recursive: true });
  await writeFile(join(clone, 'skills', 'tdd', 'v1', 'SKILL.md'), record('tdd'));
  await mkdir(join(clone, 'skills', 'deploy-check', 'v1'), { recursive: true });
  await writeFile(join(clone, 'skills', 'deploy-check', 'v1', 'SKILL.md'), record('deploy-check', '22222222-2222-4222-8222-222222222222'));
  const config = await store.read();
  const printed: string[] = [];
  const base: ResolveInput = { ref: undefined, cwd: home, home, config, stateRoot: store.root, team: { clone, name: 'acme' }, rungs: 4, print: (line) => printed.push(line), miss: (ref) => `No skill named ${ref}.` };
  return { home, root, clone, base, printed };
}

describe('resolveSkillRef (§6.1)', () => {
  it('rung 0: a bare ref resolves the skill folder above cwd and prints the resolved line', async () => {
    const { root, base, printed } = await library();
    const inside = join(root, 'deploy-check', 'sub'); await mkdir(inside, { recursive: true });
    expect(await nearestSkillFolder(inside)).toBe(join(root, 'deploy-check'));
    expect(await resolveSkillRef({ ...base, cwd: inside })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'cwd', source: 'library', match: { path: join(root, 'deploy-check') } } });
    expect(printed).toEqual(['Resolved: deploy-check from the working directory']);
  });
  it('rung 0: outside every skill folder, or inside one that is not in a Library root, is the one sentence', async () => {
    const { home, base } = await library();
    expect(await resolveSkillRef({ ...base, cwd: home })).toEqual({ ok: false, error: CWD_MISS });
    const elsewhere = join(home, 'elsewhere', 'skill'); await mkdir(elsewhere, { recursive: true }); await writeFile(join(elsewhere, 'SKILL.md'), '---\nname: skill\ndescription: x\n---\n');
    expect(await resolveSkillRef({ ...base, cwd: elsewhere })).toEqual({ ok: false, error: CWD_MISS });
    expect(CWD_MISS).toBe('Name a skill; the working directory is not inside a library skill folder.');
  });
  it('rung 1: an exact Library name, a path, and a team name or id prefix resolve without a printed line', async () => {
    const { root, base, printed } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'deploy-check' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', name: 'deploy-check' } });
    expect(await resolveSkillRef({ ...base, ref: join(root, 'Notes') })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', name: 'Notes' } });
    expect(await resolveSkillRef({ ...base, ref: 'tdd' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'team', name: 'tdd', record: { name: 'tdd' } } });
    expect(await resolveSkillRef({ ...base, ref: ID.slice(0, 8) })).toMatchObject({ ok: true, value: { how: 'exact', source: 'team', name: 'tdd' } });
    expect(printed).toEqual([]);
    expect(await resolveSkillRef({ ...base, ref: 'broken' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', match: { inspection: { kind: 'rejected' } } } });
  });
  it('rung 1: a path that misses stops with the path sentence and never climbs the ladder', async () => {
    const { home, base } = await library();
    expect(await resolveSkillRef({ ...base, ref: join(home, 'nowhere'), pathMiss: (ref) => `path miss ${ref}` })).toEqual({ ok: false, error: `path miss ${join(home, 'nowhere')}` });
    expect(await resolveSkillRef({ ...base, ref: './deploy' })).toEqual({ ok: false, error: 'No skill named ./deploy.' });
  });
  it('rungs 2–4: case, prefix and substring over Library and team names, each printing its line', async () => {
    const { base, printed } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'notes' })).toMatchObject({ ok: true, value: { name: 'Notes', how: 'case', source: 'library' } });
    expect(await resolveSkillRef({ ...base, ref: 'TD' })).toMatchObject({ ok: true, value: { name: 'tdd', how: 'prefix', source: 'team' } });
    expect(await resolveSkillRef({ ...base, ref: 'walk' })).toMatchObject({ ok: true, value: { name: 'decision-walk', how: 'substring', source: 'library' } });
    expect(printed).toEqual(['Resolved: "notes" → Notes (case-insensitive match)', 'Resolved: "TD" → tdd (unique prefix)', 'Resolved: "walk" → decision-walk (unique substring)']);
  });
  it('refuses an ambiguous match alphabetically and never guesses; a miss is the verb\'s own sentence', async () => {
    const { base } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'de' })).toEqual({ ok: false, error: 'Ambiguous skill name "de": decision-walk, deploy-check. Name one.' });
    expect(await resolveSkillRef({ ...base, ref: 'zzz' })).toEqual({ ok: false, error: 'No skill named zzz.' });
  });
  it('D9: rungs 2 stops after the case rung, and a team-less machine resolves Library names only', async () => {
    const { base } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'DEPLOY-CHECK', rungs: 2 })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'case' } });
    expect(await resolveSkillRef({ ...base, ref: 'depl', rungs: 2 })).toEqual({ ok: false, error: 'No skill named depl.' });
    const { team: _team, ...teamless } = base;
    expect(await resolveSkillRef({ ...teamless, ref: 'tdd' })).toEqual({ ok: false, error: 'No skill named tdd.' });
    expect(await resolveSkillRef({ ...teamless, ref: 'DEPLOY' })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'prefix', source: 'library' } });
  });
  it('a team lookup that throws (an ambiguous id prefix) surfaces as a failure', async () => {
    const { base, clone } = await library();
    await mkdir(join(clone, 'skills', 'other', 'v1'), { recursive: true });
    await writeFile(join(clone, 'skills', 'other', 'v1', 'SKILL.md'), record('other', '11111111-1111-4111-8111-999999999999'));
    expect(await resolveSkillRef({ ...base, ref: '11111111' })).toEqual({ ok: false, error: 'Skill ID prefix 11111111 is ambiguous.' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/resolve-ref.test.ts`
Expected: FAIL — `resolveSkillRef` is not exported.

- [ ] **Step 3: Implement**

Replace `src/lib/resolve-ref.ts` with:

```ts
// src/lib/resolve-ref.ts
/**
 * §6.1 argument autofill. Wraps PR #193's `resolveLibrarySkill` (a name or a path, always inside a
 * Library root) with the rungs a person at a prompt reaches for: the folder above cwd, then a unique
 * case-insensitive / prefix / substring match over the Library's entry names and the team's skill
 * names. A hit at rungs 2–4 is passed back through the exact resolvers so the folder or record comes
 * from the one authoritative reader; an ambiguity is a failure naming the candidates, never a guess.
 * D9: `eval` runs rungs 0–2 (paid: a prefix never picks the bill); the read verbs run 0–4.
 */
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { localSkillRoots, localSkills, refIsPath, resolveLibrarySkill, type LibrarySkillMatch } from './local-skills.js';
import { failure, success, type Result } from './result.js';
import type { Config } from './schema.js';
import { findSkill, skillRecords, type SkillRecord } from './skills.js';

/** D7: the one recognisable line the board sink lifts into `board.resolved`. */
export const RESOLVED_PREFIX = 'Resolved: ';
export const CWD_MISS = 'Name a skill; the working directory is not inside a library skill folder.';

export type ResolveHow = 'cwd' | 'exact' | 'case' | 'prefix' | 'substring';
export type ResolvedRef =
  | { name: string; how: ResolveHow; source: 'library'; match: LibrarySkillMatch }
  | { name: string; how: ResolveHow; source: 'team'; record: SkillRecord };

export interface ResolveInput {
  ref: string | undefined;
  cwd: string;
  home: string;
  config: Pick<Config, 'placements' | 'projects'>;
  stateRoot: string;
  /** The selected team, when one is configured; absent on a team-less machine or for a verb that reads no team. */
  team?: { clone: string; name: string } | undefined;
  /** 2: case only (eval); 4: case, prefix, substring (the read verbs). */
  rungs: 2 | 4;
  print(line: string): void;
  /** The verb's own miss sentence for a name no rung matched. */
  miss(ref: string): string;
  /** The verb's own sentence for a path ref no Library root holds; defaults to `miss`. */
  pathMiss?(ref: string): string;
}

const HOW_TEXT: Record<Exclude<ResolveHow, 'cwd' | 'exact'>, string> = { case: 'case-insensitive match', prefix: 'unique prefix', substring: 'unique substring' };

/** The first ancestor of `cwd` (itself included) holding a regular `SKILL.md`; undefined at the filesystem root. */
export async function nearestSkillFolder(cwd: string): Promise<string | undefined> {
  let current = cwd;
  for (;;) {
    const marker = await lstat(join(current, 'SKILL.md')).then((details) => details.isFile(), () => false);
    if (marker) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function resolveSkillRef(input: ResolveInput): Promise<Result<ResolvedRef>> {
  const { home, config, stateRoot, team } = input;
  const library = (ref: string): Promise<LibrarySkillMatch | undefined> => resolveLibrarySkill(home, config, stateRoot, ref);
  // Rung 0 — the folder above cwd, which must itself lie inside a Library root.
  if (input.ref === undefined) {
    const folder = await nearestSkillFolder(input.cwd);
    const match = folder === undefined ? undefined : await library(folder);
    if (match === undefined) return failure(CWD_MISS);
    input.print(`${RESOLVED_PREFIX}${match.name} from the working directory`);
    return success({ name: match.name, how: 'cwd', source: 'library', match });
  }
  const ref = input.ref;
  // Rung 1 — exact: the Library (name or path), then the team (name or unique id prefix).
  const exact = await library(ref);
  if (exact !== undefined) return success({ name: exact.name, how: 'exact', source: 'library', match: exact });
  if (refIsPath(ref)) return failure((input.pathMiss ?? input.miss)(ref));
  if (team !== undefined) {
    const found = await teamLookup(team, ref);
    if (!found.ok) return found;
    if (found.value !== undefined) return success({ name: found.value.name, how: 'exact', source: 'team', record: found.value });
  }
  // Rungs 2–4 — over every Library entry name and every readable team skill name.
  const candidates = await candidateNames(home, config, stateRoot, team);
  const lower = ref.toLowerCase();
  const rungs: [ResolveHow, (name: string) => boolean][] = [['case', (name) => name.toLowerCase() === lower]];
  if (input.rungs === 4) rungs.push(['prefix', (name) => name.toLowerCase().startsWith(lower)], ['substring', (name) => name.toLowerCase().includes(lower)]);
  for (const [how, matches] of rungs) {
    const hits = candidates.filter(matches);
    if (hits.length === 0) continue;
    if (hits.length > 1) return failure(`Ambiguous skill name "${ref}": ${hits.join(', ')}. Name one.`);
    const name = hits[0]!;
    const resolved = await resolveExactly(name, library, team);
    if (!resolved.ok) return resolved;
    if (resolved.value === undefined) break;
    input.print(`${RESOLVED_PREFIX}"${ref}" → ${name} (${HOW_TEXT[how as keyof typeof HOW_TEXT]})`);
    return success({ ...resolved.value, how });
  }
  return failure(input.miss(ref));
}

async function teamLookup(team: { clone: string; name: string }, ref: string): Promise<Result<SkillRecord | undefined>> {
  try { return success(await findSkill(team.clone, team.name, ref)); }
  catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function resolveExactly(name: string, library: (ref: string) => Promise<LibrarySkillMatch | undefined>, team: { clone: string; name: string } | undefined): Promise<Result<Omit<ResolvedRef, 'how'> | undefined>> {
  const match = await library(name);
  if (match !== undefined) return success({ name: match.name, source: 'library', match });
  if (team === undefined) return success(undefined);
  const found = await teamLookup(team, name);
  if (!found.ok) return found;
  return success(found.value === undefined ? undefined : { name: found.value.name, source: 'team', record: found.value });
}

/** Sorted, deduplicated: every Library entry (rejected folders included — they resolve, then the verb refuses them) plus the team's readable records. */
async function candidateNames(home: string, config: Pick<Config, 'placements' | 'projects'>, stateRoot: string, team: { clone: string; name: string } | undefined): Promise<string[]> {
  const names = new Set<string>();
  const discovery = await localSkillRoots(home, config.projects ?? []);
  for (const root of discovery.roots) {
    const inventory = await localSkills(root.root, config, { scope: root.scope, stateRoot });
    for (const entry of inventory.entries) names.add(entry.name);
  }
  if (team !== undefined) for (const record of await skillRecords(team.clone, team.name, { onProblem: () => undefined })) names.add(record.name);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/__tests__/resolve-ref.test.ts src/lib/render/__tests__/sink.test.ts`
Expected: PASS (8 + 4 tests). If `skillRecords` needs `team.json` in the clone for the `problem` path, add `await writeFile(join(clone, 'team.json'), JSON.stringify({ layout_version: 3, name: 'acme', categories: [], projects: {}, archived: [], policy: { skill_license: 'UNLICENSED' } }))` to the fixture — verify by reading `src/lib/skills.ts:39-75` rather than guessing.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
git add src/lib/resolve-ref.ts src/lib/__tests__/resolve-ref.test.ts
git commit -m "feat(resolve-ref): the autofill ladder — cwd, exact, case, prefix, substring; ambiguity is a failure (§6.1, D9)"
```

---
### Task 9: `ls skill <name>`, `selection`/`viewer`, the member limb, and the collect/print split of the Library read

**Files:**
- Modify: `src/commands/ls.ts` (`LsArgs`, `LsResult`, `run`, `listSkills`, `showMember`, `showProject`, `showLocal`), `src/lib/readme.ts:61-70` (`Installer.version`), `src/cli.ts:140-143` (`ls skill [name]`)
- Test: `src/commands/__tests__/ls.test.ts` (new `describe('ls skill (D10)')`), `src/__tests__/cli.test.ts` (one exact-args assertion), `src/__tests__/cli-hints.test.ts` (the `['ls', 'skill', 'x']` argv)

**Interfaces:**
- Produces: `LsArgs.kind: 'all' | 'member' | 'project' | 'skill'`; `LsResult.selection?: { kind: 'member'; handle: string } | { kind: 'project'; name: string } | { kind: 'skill'; name: string; source: 'team' | 'library' }`; `LsResult.viewer?: { handle: string; team: string }`; `LsResult.member` = `{ handle; displayName; role; projects; installed: { id; name: string | null; version: string | null; scope; since }[]; profile: { id; name; version; added; via }[] }`; `Installer.version: string | null`; `LocalSection` unchanged; exported `collectLocal(store, home, io, runner, only?)` and `printLocal(io, sections, discoveryProblems)`; plain output of `ls skill` = the `format()` line (team) or the Library row line, the description, the body.
- Consumes: `resolveSkillRef`, `RESOLVED_PREFIX` (Task 8).

- [ ] **Step 1: Write the failing tests**

Append to `src/commands/__tests__/ls.test.ts` (imports `run, format` already exist; add `import { RESOLVED_PREFIX } from '../../lib/resolve-ref.js';` and `import { cp } from 'node:fs/promises';` if `cp` is not imported):

```ts
describe('ls skill (D10)', () => {
  const ID2 = '44444444-4444-4444-8444-444444444444';
  async function teamAndLibrary() {
    const { store, clone, root } = await inventoryFixture();
    const home = join(root, 'home');
    await mkdir(join(clone, 'skills', 'deploy-check', 'v1'), { recursive: true });
    await writeFile(join(clone, 'skills', 'deploy-check', 'v1', 'SKILL.md'), inventorySource('deploy-check').replace(ID, ID2));
    await writeFile(join(clone, 'team.json'), JSON.stringify({ ...TEAM_JSON, projects: { Global: { remotes: [], skills: [ID2] }, app: { remotes: ['github.com/acme/app'], skills: [ID2] } } }));
    await writeFile(join(clone, 'people', 'seed.json'), JSON.stringify(person('seed', { installed: [{ id: ID2, version: 'v1', scope: { kind: 'global' }, since: '2026-08-01' }] })));
    await git(['add', '--all'], clone); await git(['commit', '-qm', 'detail'], clone);
    // A placed copy of the team skill, and a Library-only folder.
    const placed = join(home, '.claude', 'skills', 'deploy-check'); await cp(join(clone, 'skills', 'deploy-check', 'v1'), placed, { recursive: true });
    await localSource(home, 'notes', '---\nname: notes\ndescription: Only here.\n---\n# Notes body\n');
    return { store, clone, home, placed };
  }
  it('answers from the team record, filters projects to its lists, and carries the Library row of the placed copy', async () => {
    const { store, home, placed } = await teamAndLibrary();
    const io = new ScriptedPrompter();
    const result = await run({ kind: 'skill', value: 'deploy-check', config: store, home, cwd: home }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.selection).toEqual({ kind: 'skill', name: 'deploy-check', source: 'team' });
    expect(result.value.viewer).toEqual({ handle: 'seed', team: 'team' });
    expect(result.value.skills.map((skill) => skill.name)).toEqual(['deploy-check']);
    expect(result.value.skills[0]!.installedBy).toEqual([{ handle: 'seed', displayName: 'seed', scope: { kind: 'global' }, since: '2026-08-01', version: 'v1' }]);
    expect(result.value.projects?.map((project) => project.name)).toEqual(['Global', 'app']);
    expect(result.value.local?.flatMap((section) => section.rows.map((row) => row.path))).toEqual([placed]);
    expect(result.value.people).toBeUndefined();
    expect(io.lines).toEqual([format(result.value.skills[0]!), 'A description with <tags> and  spaces', '# Real body']);
  });
  it('answers from the Library alone for a folder the team has never seen, and on a team-less machine', async () => {
    const { store, home } = await teamAndLibrary();
    const io = new ScriptedPrompter();
    const result = await run({ kind: 'skill', value: 'notes', config: store, home, cwd: home }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.selection).toEqual({ kind: 'skill', name: 'notes', source: 'library' });
    expect(result.value.skills).toEqual([]);
    expect(result.value.local?.flatMap((section) => section.rows.map((row) => row.name))).toEqual(['notes']);
    expect(io.lines).toEqual([`  notes — untracked locally; path: ${join(home, '.claude', 'skills', 'notes')}`, 'Only here.', '# Notes body']);
    const teamless = createConfigStore(join(home, 'state2'));
    const alone = await run({ kind: 'skill', value: 'notes', config: teamless, home, cwd: home }, new ScriptedPrompter());
    expect(alone).toMatchObject({ ok: true, value: { selection: { kind: 'skill', name: 'notes', source: 'library' }, viewer: undefined, roster: [] } });
  });
  it('autofills through the ladder, prints the resolved line, and fails a miss with one sentence', async () => {
    const { store, home } = await teamAndLibrary();
    const io = new ScriptedPrompter();
    expect(await run({ kind: 'skill', value: 'DEPLOY', config: store, home, cwd: home }, io)).toMatchObject({ ok: true, value: { selection: { name: 'deploy-check', source: 'team' } } });
    expect(io.lines[0]).toBe(`${RESOLVED_PREFIX}"DEPLOY" → deploy-check (unique prefix)`);
    expect(await run({ kind: 'skill', value: 'ghost', config: store, home, cwd: home }, new ScriptedPrompter())).toEqual({ ok: false, error: 'No skill named ghost.' });
    const inside = join(home, '.claude', 'skills', 'notes');
    expect(await run({ kind: 'skill', config: store, home, cwd: inside }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { selection: { name: 'notes' } } });
    expect(await run({ kind: 'skill', config: store, home, cwd: home }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Name a skill; the working directory is not inside a library skill folder.' });
    expect(await run({ kind: 'skill', value: 'x', local: true, config: store, home, cwd: home }, new ScriptedPrompter())).toEqual({ ok: false, error: '--local cannot be combined with skill; ls skill reads both the team and your Library.' });
  });
  it('member and project reads name their selection, the viewer, and the member limb\'s display facts', async () => {
    const { store, home } = await teamAndLibrary();
    const member = await run({ kind: 'member', value: 'seed', config: store, home, cwd: home }, new ScriptedPrompter());
    expect(member).toMatchObject({ ok: true, value: { selection: { kind: 'member', handle: 'seed' }, viewer: { handle: 'seed', team: 'team' }, member: { handle: 'seed', displayName: 'seed', installed: [{ id: ID2, name: 'deploy-check', version: 'v1', scope: { kind: 'global' }, since: '2026-08-01' }], profile: [] } } });
    const project = await run({ kind: 'project', value: 'app', config: store, home, cwd: home }, new ScriptedPrompter());
    expect(project).toMatchObject({ ok: true, value: { selection: { kind: 'project', name: 'app' }, viewer: { handle: 'seed', team: 'team' } } });
    const all = await run({ config: store, home, cwd: home }, new ScriptedPrompter());
    expect(all).toMatchObject({ ok: true, value: { viewer: { handle: 'seed', team: 'team' } } });
    expect(all.value?.selection).toBeUndefined();
  });
  it('the Library read prints byte for byte what it printed before the collect/print split', async () => {
    const { store, home } = await teamAndLibrary();
    const io = new ScriptedPrompter();
    const result = await run({ local: true, config: store, home }, io);
    if (!result.ok) throw new Error(result.error);
    expect(io.lines).toEqual([
      `Local Claude Code skills (${join(home, '.claude', 'skills')}; global):`,
      `  deploy-check — untracked locally; path: ${join(home, '.claude', 'skills', 'deploy-check')}`,
      `  notes — untracked locally; path: ${join(home, '.claude', 'skills', 'notes')}`,
      '  2 skill folders (2 connectable)',
    ]);
  });
});
```

In `src/__tests__/cli.test.ts`, beside the existing exact `ls member` assertion, add:

```ts
    await program.parseAsync(['ls', 'skill', 'deploy'], { from: 'user' });
    expect(calls.at(-1)).toEqual({ verb: 'ls', cwd: process.cwd(), kind: 'skill', value: 'deploy' });
    await program.parseAsync(['ls', 'skill'], { from: 'user' });
    expect(calls.at(-1)).toEqual({ verb: 'ls', cwd: process.cwd(), kind: 'skill' });
```
(Match the surrounding test's capture idiom exactly — read the `ls member` case above it and mirror its `calls` shape; the object above assumes the stub records `{ verb, ...args }` with `form` undefined and dropped, as the member case does.)

In `src/__tests__/cli-hints.test.ts`, add `['ls', 'skill', 'x'], ['ls', 'skill']` after `['ls', 'project', 'app']`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/commands/__tests__/ls.test.ts -t "ls skill"`
Expected: FAIL — `kind: 'skill'` is not a known kind (the run falls through to the team listing) and `selection` is undefined.

- [ ] **Step 3: `Installer.version`**

In `src/lib/readme.ts`:

```ts
export interface Installer { handle: string; displayName: string; scope: Person['installed'][number]['scope']; since: string; version: string | null; }
```
and in `installersById` the pushed row becomes `rows.push({ handle: person.handle, displayName: person.display_name, scope: item.scope, since: item.since, version: item.version });`. Run `npx vitest run src/lib/__tests__/readme.test.ts src/commands/__tests__/ls.test.ts`; any `toEqual` that pins an `installedBy` row gains `version: null` (the fixtures record `version: null`) — extend those expectations, they are the additive field.

- [ ] **Step 4: Types and the guards in `src/commands/ls.ts`**

```ts
export interface LsArgs extends WithForm { local?: boolean; home?: string; cwd?: string; kind?: 'all' | 'member' | 'project' | 'skill'; value?: string; team?: string; config?: ConfigStore; runner?: Runner; }
```
Add after `LsPerson`:
```ts
/** D11: which narrowed read produced this value — a shell cannot tell a project view from the whole team by shape alone. */
export type LsSelection = { kind: 'member'; handle: string } | { kind: 'project'; name: string } | { kind: 'skill'; name: string; source: 'team' | 'library' };
export interface LsMember { handle: string; displayName: string; role: string | null; projects: readonly string[]; installed: { id: string; name: string | null; version: string | null; scope: Person['installed'][number]['scope']; since: string }[]; profile: { id: string; name: string; version: string; added: string; via: 'publish' | 'install' }[]; }
```
and change `LsResult`'s `member?` to `member?: LsMember;` plus two new optional fields at the end: `selection?: LsSelection; viewer?: { handle: string; team: string };`.

Replace the top of `run()` through the `selectTeam` line:

```ts
export async function run(args: LsArgs, io: Prompter): Promise<Result<LsResult>> {
  try {
    if (args.local && (args.kind === 'member' || args.kind === 'project')) throw new Error('--local cannot be combined with member or project.');
    if (args.local && args.kind === 'skill') throw new Error('--local cannot be combined with skill; ls skill reads both the team and your Library.');
    if (args.local && args.team) throw new Error('--local lists every configured team; drop --team.');
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    if (args.local) return await showLocal(store, args.home ?? homedir(), io, runner);
    if (args.kind === 'skill') return await showSkill(args, store, io, runner);
    const [teamName, binding] = selectTeam((await store.read()).teams, args.team, args.form);
    const viewer = { handle: binding.handle, team: teamName };
    const clone = store.teamClone(teamName);
```
(delete the later `const runner = args.runner ?? systemRunner;` line that now duplicates). Thread `viewer` into the three returns: `showMember(..., problems, viewer)`, `showProject(..., problems, viewer)`, and the `kind:'all'` return becomes `return success({ roster, skills, projects, problems, people: personRows, viewer });`.

`listSkills` gains a trailing parameter `only?: string` and filters right after `skillRecords`: `const records = (await skillRecords(...)).filter((record) => only === undefined || record.name === only);` — the `onProblem` callback stays as it is (a problem on another skill is still printed; that is what `ls` does today, and `ls skill` inherits it — the board sends it to notes).

`showMember` gains a last parameter `viewer: LsResult['viewer']` and returns:
```ts
  return success({ roster, skills: authored, projects, problems, viewer, selection: { kind: 'member', handle: member.handle }, member: {
    handle: member.handle, displayName: member.display_name, role: member.role ?? null, projects: member.projects ?? [],
    installed: member.installed.map(({ id, version, scope, since }) => ({ id, name: namesById.get(id) ?? null, version, scope, since })),
    profile: (member.profile ?? []).map(({ id, name, version, added, via }) => ({ id, name, version, added, via })),
  } });
```
`showProject` gains `viewer` and returns `success({ roster, skills: selected, projects, problems, viewer, selection: { kind: 'project', name: projectName } })`.

- [ ] **Step 5: Split `showLocal` into `collectLocal` + `printLocal`**

Every computation stays where it is; only the `io.print` calls that happen inside the per-root loop move to `printLocal`. Nothing between the old header print and the old row prints printed anything (`healthOf`, `evalOf`, `originRemote` are silent), so the output is byte-identical — the new test in Step 1 pins it.

```ts
/** The Library read without its report: sections in root order, plus the discovery problems the report ends with. */
export async function collectLocal(store: ConfigStore, home: string, io: Prompter, runner: Runner, only?: string): Promise<{ sections: LocalSection[]; discoveryProblems: { path: string; reason: string }[] }> {
  const config = await store.read();
  const ledger = await canonicalLedger(config);
  const discovery = await localSkillRoots(home, config.projects ?? []);
  const inventories = await Promise.all(discovery.roots.map(async (root) => ({ ...root, inventory: await localSkills(root.root, config, { scope: root.scope, stateRoot: store.root, ledger }) })));
  const sections: LocalSection[] = [];
  // … stateOf, healthOf, the local receipt read, teamIndex, ambiguous, evalOf: unchanged, verbatim …
  const remotes = await Promise.all(inventories.map((root) => originRemote(root.repoRoot, runner)));
  for (const [index, { inventory, ...root }] of inventories.entries()) {
    const local: LocalSection = { ...root, root: inventory.root, rootState: inventory.rootState, label: localRootLabel(root), remote: remotes[index]!, counts: localSkillCounts(inventory), rows: [], notOffered: [], problems: [...inventory.problems] };
    sections.push(local);
    // `only`: one folder's row without the fingerprint and digest cost of every other folder; counts stay the root's.
    const entries = only === undefined ? inventory.entries : inventory.entries.filter((entry) => entry.name === only);
    const healthNeeded = entries.filter((entry) => entry.placement !== undefined || entry.inspection.kind === 'candidate');
    const healths = new Map<LocalEntry, LocalHealth>();
    const computed = await mapWithConcurrency(healthNeeded, FINGERPRINT_CONCURRENCY, (entry) => healthOf(entry));
    healthNeeded.forEach((entry, index) => healths.set(entry, computed[index]!));
    const evals = await Promise.all(entries.map(evalOf));
    for (const [entryIndex, entry] of entries.entries()) {
      // … the row / notOffered / problems construction, unchanged, verbatim …
    }
  }
  return { sections, discoveryProblems: discovery.problems };
}

/** The Library report, exactly the lines `ls --local` has always printed, in the same order. */
export function printLocal(io: Prompter, sections: readonly LocalSection[], discoveryProblems: readonly { path: string; reason: string }[]): void {
  for (const local of sections) {
    io.print(`Local Claude Code skills (${printable(local.root)}; ${local.scope}${local.registered ? '; registered' : ''}):`);
    if (local.repoRoot !== undefined) io.print(`  GitHub: ${local.remote === null ? 'not connected' : local.remote.slug === null ? `not connected (origin is ${printable(local.remote.url)})` : printable(local.remote.slug)}`);
    for (const row of local.rows) io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
    if (local.notOffered.length) {
      io.print('Could not inspect as skills:');
      for (const entry of local.notOffered) io.print(`  ${printable(entry.name)} — ${printable(entry.detail)}; path: ${printable(entry.path)}`);
    }
    if (local.rootState === 'absent') io.print(`  none (${printable(local.root)} does not exist)`);
    else if (local.rootState === 'scanned' && local.counts.skillFolders === 0) io.print('  none');
    for (const problem of local.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
    io.print(`  ${local.counts.skillFolders} skill ${local.counts.skillFolders === 1 ? 'folder' : 'folders'} (${local.counts.connectable} connectable)`);
  }
  for (const problem of discoveryProblems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
}

async function showLocal(store: ConfigStore, home: string, io: Prompter, runner: Runner): Promise<Result<LsResult>> {
  const { sections, discoveryProblems } = await collectLocal(store, home, io, runner);
  printLocal(io, sections, discoveryProblems);
  return success({ roster: [], skills: [], problems: [], local: sections });
}
```
Two details that keep it byte-identical: the old `none` line tested `!inventory.entries.some(isSkillFolder)`; `localSkillCounts(inventory).skillFolders` counts exactly the entries `isSkillFolder` accepts (`src/lib/local-skills.ts:187-192` — read it to confirm before relying on it; if it counts differently, keep an `empty: boolean` on the section computed from `inventory.entries.some(isSkillFolder)` instead). And `local.root`/`local.scope`/`local.registered` are the same values the old code read from `inventory`/`root`.

- [ ] **Step 6: `showSkill`**

```ts
/** D10: one skill, whole — from the team record when the name is a team skill, else from the Library row. Resolution through §6.1, rungs 0–4. */
async function showSkill(args: LsArgs, store: ConfigStore, io: Prompter, runner: Runner): Promise<Result<LsResult>> {
  const config = await store.read();
  const home = args.home ?? homedir();
  const selected = args.team !== undefined || Object.keys(config.teams).length > 0 ? selectTeam(config.teams, args.team, args.form) : null;
  const teamName = selected === null ? null : selected[0];
  const viewer = selected === null ? undefined : { handle: selected[1].handle, team: selected[0] };
  const clone = teamName === null ? null : store.teamClone(teamName);
  const resolved = await resolveSkillRef({
    ref: args.value, cwd: args.cwd ?? process.cwd(), home, config, stateRoot: store.root, rungs: 4, print: (line) => io.print(line),
    ...(clone === null || teamName === null ? {} : { team: { clone, name: teamName } }),
    miss: (ref) => `No skill named ${ref}.`,
  });
  if (!resolved.ok) return resolved;
  const name = resolved.value.name;
  const library = await collectLocal(store, home, io, runner, name);
  const local = library.sections.map((section) => ({ ...section, rows: section.rows.filter((row) => row.name === name), notOffered: section.notOffered.filter((entry) => entry.name === name) })).filter((section) => section.rows.length > 0 || section.notOffered.length > 0);
  const row = local[0]?.rows[0];
  if (clone !== null && teamName !== null && viewer !== undefined) {
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const problems: { source: string; message: string }[] = [];
    const report = (source: string, message: string) => { problems.push({ source, message }); io.print(`${source}: ${message}`); };
    const people = (await Promise.all((await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).sort().map((file) => readPerson(clone, file.slice(0, -5)).catch((error: unknown) => { report(`people/${file}`, error instanceof Error ? error.message : String(error)); return undefined; })))).filter((person) => person !== undefined);
    const roster = people.sort((a, b) => a.handle.localeCompare(b.handle)).map((person) => ({ handle: person.handle, active: isActivePerson(person, team.archived), role: person.role ?? null, projects: person.projects ?? [] }));
    const skills = await listSkills(team, people, clone, runner, io, teamName, problems, name);
    const record = skills[0];
    if (record !== undefined) {
      const projects = Object.entries(team.projects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([projectName, project]) => ({ ...project, name: projectName })).filter((project) => project.skills.includes(record.id));
      io.print(format(record));
      io.print(record.description);
      if (record.body !== null && record.body.trim() !== '') io.print(record.body.trimEnd());
      return success({ roster, skills: [record], projects, problems, local, viewer, selection: { kind: 'skill', name, source: 'team' } });
    }
    if (row === undefined) return failure(`No skill named ${args.value ?? name}.`);
    printLibraryDetail(io, row);
    return success({ roster, skills: [], projects: [], problems, local, viewer, selection: { kind: 'skill', name, source: 'library' } });
  }
  if (row === undefined) return failure(`No skill named ${args.value ?? name}.`);
  printLibraryDetail(io, row);
  return success({ roster: [], skills: [], problems: [], local, selection: { kind: 'skill', name, source: 'library' } });
}

function printLibraryDetail(io: Prompter, row: LocalSection['rows'][number]): void {
  io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
  if (row.description !== null) io.print(row.description);
  if (row.body !== null && row.body !== undefined && row.body.trim() !== '') io.print(row.body.trimEnd());
}
```
Add the imports: `import { resolveSkillRef } from '../lib/resolve-ref.js';` and `failure` from `../lib/result.js` if not already imported. Duplicated team-reading lines between `run()` and `showSkill` are acceptable here only if they are identical; prefer extracting `readTeamPeople(clone, team, io, problems)` returning `{ people, roster }` and calling it from both.

- [ ] **Step 7: `src/cli.ts` — the `ls skill` subcommand**

After the `ls.command('project <name>')…` line:

```ts
  ls.command('skill [name]').description('Show one skill in full: the team record when it is shared, else your Library folder (name, id prefix, or a unique prefix; bare inside a skill folder)').addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp()).action(async (name: string | undefined, options: { team?: string }) => execute((io) => active.ls({ form: context.form, cwd: process.cwd(), kind: 'skill', value: name, team: options.team ?? ls.opts<{ team?: string }>().team, local: ls.opts<{ local?: boolean }>().local }, io), { verb: 'ls', notices: true }));
```
`value: name` is `undefined` for a bare `ls skill`; the exact-args test in Step 1 expects the key absent — spread it: `...(name === undefined ? {} : { value: name })`, and likewise `team`/`local` only when defined, mirroring what the `member` case does today (read `src/cli.ts:142` and copy its exact conditional shape so both assertions in `cli.test.ts` hold).

- [ ] **Step 8: Run the tests, the README span test and the tripwire**

Run: `npx vitest run src/commands/__tests__/ls.test.ts src/__tests__/cli.test.ts src/__tests__/cli-hints.test.ts src/lib/__tests__/invocation-tripwire.test.ts src/lib/__tests__/readme.test.ts src/commands/__tests__/ls-local-overlay.test.ts`
Expected: the README span test in `cli.test.ts` fails because `ls skill` is a visible command path with no README span — add ` / \`ls skill <name>\`` to the README row that lists `ls [--local]` / `ls member <handle>` / `ls project <name>` (`README.md:369`), then catalogue that README line's new pattern in `invocation-catalog.ts` (replace the row whose `pattern` is the old line text with the new text; the tripwire diff names it). All green after that.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
git add src/commands/ls.ts src/lib/readme.ts src/cli.ts src/commands/__tests__/ls.test.ts src/__tests__/cli.test.ts src/__tests__/cli-hints.test.ts README.md src/lib/__tests__/invocation-catalog.ts
git commit -m "feat(ls): ls skill <name> — one skill whole from the team or the Library; selection, viewer and member display facts (D10, D11)"
```

---

### Task 10: `eval` — rung-0 autofill, `report`, `receiptPath`, drain `outcomes`

**Files:**
- Modify: `src/commands/eval.ts` (`EvalArgs`, `EvalResult`, the ref resolution at lines 110–118, the success return at 344–348, `EvalQueueResult`, the drain result at 754–755 and the empty-drain return at 721), `src/cli.ts:166-179` (queue dispatch, `cwd`)
- Test: `src/commands/__tests__/eval.test.ts`, `src/commands/__tests__/eval-queue.test.ts:55`, `src/__tests__/cli.test.ts` (bare `eval` dispatch)

**Interfaces:**
- Produces: `EvalArgs.ref?: string`, `EvalArgs.cwd?: string`; `EvalResult.report?: { aggregate: Aggregate; triggers: TriggerSummary | null }`, `EvalResult.receiptPath` populated on the normal path; `EvalQueueResult.outcomes?: { skill: string; team?: string; ok: boolean; error?: string }[]` (on `--drain`, one per attempted item, in queue order).
- Consumes: `resolveSkillRef` (Task 8), `Aggregate` (`src/lib/evals/results.ts`), `TriggerSummary` (`src/lib/evals/triggers.ts`).

- [ ] **Step 1: Write the failing tests**

In `src/commands/__tests__/eval.test.ts`, inside `describe('eval (§6 / IE2)')` after the path-ref test, add (the fixture's Library folder is `join(home, '.claude', 'skills', 'sample')`; `armAgent`, `CASE` and `TRIGGERS` are the file's existing stubs):

```ts
  it('a bare eval inside a Library skill folder evaluates that folder and says so (rung 0); the result carries the report and the receipt path', async () => {
    const { store, home, folder } = await evalFixture({ assets: { 'evals/cases/happy.yaml': CASE } });
    const io = new ScriptedPrompter();
    const result = await run(args(store, home, { ref: undefined, cwd: join(folder, 'evals'), agent: armAgent, k: 1, noGen: true }), io);
    if (!result.ok) throw new Error(result.error);
    expect(io.lines[0]).toBe('Resolved: sample from the working directory');
    expect(result.value.receiptPath).toBe(join(result.value.runDir, 'receipt.json'));
    expect(result.value.report?.aggregate.verdict).toBe(result.value.report?.aggregate.verdict);
    expect(result.value.report?.aggregate.execution_status).toBe(result.value.executionStatus);
    expect(result.value.report?.triggers).toBeNull();
  });
  it('a bare eval outside any Library skill folder is the rung-0 sentence, and a prefix never picks the bill (rungs 0–2 only)', async () => {
    const { store, home } = await evalFixture();
    expect(await run(args(store, home, { ref: undefined, cwd: home }), new ScriptedPrompter())).toEqual({ ok: false, error: 'Name a skill; the working directory is not inside a library skill folder.' });
    expect(await run(args(store, home, { ref: 'samp' }), new ScriptedPrompter())).toMatchObject({ ok: false, error: 'No local skill folder named `samp` in your library; install it from the marketplace first, or pass the folder\'s path.' });
    const io = new ScriptedPrompter();
    expect(await run(args(store, home, { ref: 'SAMPLE', case: 'missing' }), io)).toMatchObject({ ok: false, error: 'No eval case named missing for sample.' });
    expect(io.lines[0]).toBe('Resolved: "SAMPLE" → sample (case-insensitive match)');
  });
```

In `src/commands/__tests__/eval-queue.test.ts:55` change the exact expectation to
```ts
  expect(await runQueue({ config, drain: true, preflight, evaluate }, io)).toEqual(success({ items: [], attempted: 2, completed: 2, failures: [], outcomes: [{ skill: 'alpha', team: 'team', ok: true }, { skill: 'beta', team: 'team', ok: true }] }));
```
and in the `retains failures` test add after the `toMatchObject`: `expect(outcome.value?.outcomes).toEqual([{ skill: 'alpha', team: 'team', ok: false, error: 'probe failed' }, { skill: 'beta', team: 'team', ok: true }]);` (read `item()` in that file: if its team is not `'team'`, use the value it sets).

In `src/__tests__/cli.test.ts`, beside the eval args assertions, add a stub-recording case proving dispatch: `eval` with no argument calls `verbs.eval` (not the queue) with `{ verb: 'eval', cwd: process.cwd() }` and `eval --queue-list` does not call `verbs.eval` at all. Mirror the existing eval assertion's capture idiom (the queue path is a dynamic import of `runQueue`, which with a real config store lists an empty queue — assert only that the `eval` stub was not called and the run resolved).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/commands/__tests__/eval.test.ts -t "rung 0" src/commands/__tests__/eval-queue.test.ts`
Expected: FAIL — `ref: undefined` is refused by the type / `resolveLibrarySkill(undefined)`; `outcomes` missing.

- [ ] **Step 3: Implement in `src/commands/eval.ts`**

Types:
```ts
export interface EvalArgs extends WithForm {
  /** A name, a folder path, or absent: the skill folder above `cwd` (§6.1 rung 0). */
  ref?: string;
  /** Where a bare `eval` looks for the skill folder; defaults to process.cwd(). */
  cwd?: string;
  …(rest unchanged)
}
export interface EvalResult {
  …(existing fields)
  receiptPath?: string;
  /** D11: what `renderReport` printed, as data — the normal run only; an already-evaluated answer carries none. */
  report?: { aggregate: Aggregate; triggers: TriggerSummary | null };
}
```
Import `type Aggregate` from `../lib/evals/results.js` (it already imports `renderReport` from there) and `type TriggerSummary` from `../lib/evals/triggers.js`; import `resolveSkillRef` from `../lib/resolve-ref.js`; `resolveLibrarySkill` and `refIsPath` imports go away if nothing else in the file uses them (check with grep; `unusableSkillFolder` stays).

Replace lines 110–118 (`const local = await resolveLibrarySkill(...)` through the two-sentence `failure`) with:
```ts
    // §6.1: a name, a path, or nothing (the folder above cwd). eval runs rungs 0–2 only — it is paid, so a
    // prefix never picks the bill — and reads no team names: the bytes must be a Library folder.
    const resolved = await resolveSkillRef({
      ref: args.ref, cwd: args.cwd ?? process.cwd(), home: args.home ?? homedir(), config, stateRoot: store.root, rungs: 2, print: (line) => io.print(line),
      // The ref is a name or a folder path (refIsPath): there is no separate --path flag, so the miss must
      // not promise one. A path outside every Library root is refused like an unknown name — the roots are
      // the only place a ref may land — and the sentence says which roots would have held it.
      miss: (ref) => `No local skill folder named \`${ref}\` in your library; install it from the marketplace first, or pass the folder's path.`,
      pathMiss: (ref) => `\`${ref}\` is not a skill folder in your library (~/.claude/skills or an added project's .claude/skills); add the project holding it with \`project add\`, or install it from the marketplace first.`,
    });
    if (!resolved.ok) return resolved;
    if (resolved.value.source !== 'library') return failure(`No local skill folder named \`${resolved.value.name}\` in your library; install it from the marketplace first, or pass the folder's path.`);
    const local = resolved.value.match;
```
The success return at the end of the normal path becomes:
```ts
    return success({
      team: teamName, id: skillId, name: local.name, runDir, ccVersion: preflight.value.ccVersion,
      executionStatus: summary.execution_status,
      receiptPath: join(runDir, 'receipt.json'),
      report: { aggregate: summary, triggers },
      ...(shared?.ok === true ? { publishedTo: shared.version } : { shareHint: true }),
    });
```
(`summary` and `triggers` are the values already passed to `renderReport(summary, triggers)` two dozen lines above; use the same identifiers.)

Queue: add to `EvalQueueResult`:
```ts
  /** D11: one entry per attempted item in queue order, so a board can name the successes that have left `items`. */
  outcomes?: { skill: string; team?: string; ok: boolean; error?: string }[];
```
The empty-drain return gains `outcomes: []`; the final drain value becomes
```ts
      const outcomes = pending.map((item, index) => {
        const outcome = batch.outcomes[index]!;
        return { skill: item.skill, ...(item.team === undefined ? {} : { team: item.team }), ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) };
      });
      const value = { items: (await readEvalQueue(store.root)).items, attempted, completed, failures, outcomes };
```
(`batch.outcomes` is index-aligned with `pending`: `runEvalBatch` maps `settled` in input order.)

- [ ] **Step 4: `src/cli.ts` eval dispatch**

The action is `eval [skills...]` since PR #206 (`refs: string[]`; three shapes: the queue modes, one skill, `runMany` for several skills or `--batch`/`--window`/`--parallel`/`--pending`). Rung 0 slots into the single-run shape: no skill, no `--pending`, no batch flag, no queue flag → the ordinary run with `cwd`. Replace the dispatch and pass `cwd`:
```ts
    const args = { form: context.form, cwd: process.cwd(), ...rest, ...(gen === false ? { noGen: true } : {}), ...(commit === false ? { commit: false } : {}) };
    // Three shapes share the verb: the queue modes (no skills), one skill or none (the ordinary run — a bare `eval`
    // inside a Library skill folder resolves the folder, rung 0), and several skills or the wizard's
    // batch/window/pending choices as flags (runMany). Queue-mode validation stays in runQueue.
    const queueMode = options.queueList || options.drain || options.dequeue !== undefined || options.max !== undefined;
    if (queueMode) {
      const { runQueue } = await import('./commands/eval.js');
      return execute(io => runQueue({ ...args, ...(refs[0] === undefined ? {} : { ref: refs[0] }) }, io), { verb: 'eval', notices: true });
    }
    if (refs.length <= 1 && !options.pending && options.batch === undefined && options.window === undefined && options.parallel === undefined) return execute(io => active.eval({ ...args, ...(refs[0] === undefined ? {} : { ref: refs[0] }) }, io), { verb: 'eval', notices: true });
    const { runMany } = await import('./commands/eval.js');
    return execute(io => runMany({ ...args, refs }, io), { verb: 'eval', notices: true });
```
`runQueue` still refuses `Provide a skill (or several), --pending, --queue-list, --drain, or --dequeue.` when no mode flag is set — unreachable from the CLI now, kept for direct callers. `EvalManyArgs extends Omit<EvalArgs, 'ref'>`, so `cwd` reaches `runMany` too and is ignored there (it resolves every explicit ref by name; a bare `eval --pending` needs no folder). Update the `eval` args expectations in `cli.test.ts` (they are exact objects: add `cwd: process.cwd()`), and add one case: `eval` with no argument calls `verbs.eval` — not `runQueue` — so the `Provide a skill…` failure is no longer reachable from a bare `eval`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/commands/__tests__/eval.test.ts src/commands/__tests__/eval-queue.test.ts src/__tests__/cli.test.ts src/__tests__/frames-eval-cancel.test.ts src/commands/__tests__/publish.test.ts`
Expected: PASS. `publish.test.ts` pins `No local skill folder named ghost in your library.` — publish is untouched by this task; it must still pass.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add src/commands/eval.ts src/cli.ts src/commands/__tests__/eval.test.ts src/commands/__tests__/eval-queue.test.ts src/__tests__/cli.test.ts
git commit -m "feat(eval): bare eval evaluates the folder above cwd; report, receiptPath and drain outcomes on the result (§6.1, D11)"
```

---

### Task 11: `eval-report [skill]` and `validate [path|name]` autofill; `ValidateResult.directory`

**Files:**
- Modify: `src/commands/evalReport.ts:18-42`, `src/commands/validate.ts:15-17, 63-110`, `src/cli.ts:162, 165`
- Test: `src/commands/__tests__/evalReport.test.ts`, `src/commands/__tests__/validate.test.ts`, `src/__tests__/cli.test.ts`

**Interfaces:**
- Produces: `EvalReportArgs.ref?: string; cwd?: string`; `ValidateArgs.target?: string; workingDirectory?: string`; `ValidateResult.directory: string`.
- Consumes: `resolveSkillRef`, `nearestSkillFolder`, `CWD_MISS`, `RESOLVED_PREFIX` (Task 8).

- [ ] **Step 1: Write the failing tests**

`src/commands/__tests__/evalReport.test.ts` — add inside the describe (the `setup()` helper gives `store`, `clone`, `runner`; the skill is `sample` with id `ID`):

```ts
  it('autofills the skill through the ladder and keeps the miss sentence', async () => {
    const { store, runner } = await setup();
    const io = new ScriptedPrompter();
    expect(await run({ ref: 'SAMP', config: store, runner }, io)).toMatchObject({ ok: true, value: { skill: { name: 'sample' } } });
    expect(io.lines).toEqual(['Resolved: "SAMP" → sample (unique prefix)']);
    expect(await run({ ref: 'zzz', config: store, runner }, new ScriptedPrompter())).toEqual({ ok: false, error: 'No skill named or identified by zzz exists in team team.' });
    const home = await temporaryDirectory();
    const inside = join(home, '.claude', 'skills', 'sample', 'deep'); await mkdir(inside, { recursive: true });
    await writeFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), skill);
    const bare = await run({ config: store, runner, home, cwd: inside }, new ScriptedPrompter());
    expect(bare).toMatchObject({ ok: true, value: { skill: { name: 'sample' } } });
    expect(await run({ config: store, runner, home, cwd: home }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Name a skill; the working directory is not inside a library skill folder.' });
    await mkdir(join(home, '.claude', 'skills', 'only-local'), { recursive: true }); await writeFile(join(home, '.claude', 'skills', 'only-local', 'SKILL.md'), '---\nname: only-local\ndescription: x\n---\n');
    expect(await run({ ref: 'only-local', config: store, runner, home }, new ScriptedPrompter())).toEqual({ ok: false, error: 'No skill named or identified by only-local exists in team team.' });
  });
```
(`skill`, `temporaryDirectory`, `mkdir`, `writeFile` — add the imports the file lacks.)

`src/commands/__tests__/validate.test.ts` — add:

```ts
  it('a bare validate checks the skill folder above cwd; a name resolves through the ladder after both lookups miss; --cwd is untouched', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter();
    expect(await run({ workingDirectory: join(clone, 'skills', 'sample', 'v1'), config: store }, io)).toMatchObject({ ok: true, value: { name: 'sample', directory: join(clone, 'skills', 'sample', 'v1'), findings: 0 } });
    expect(io.lines[0]).toBe('Resolved: sample from the working directory');
    expect(await run({ workingDirectory: fixture.root, config: store }, new ScriptedPrompter())).toEqual({ ok: false, error: 'Name a skill; the working directory is not inside a library skill folder.' });
    const ladder = new ScriptedPrompter();
    expect(await run({ target: 'SAMP', config: store }, ladder)).toMatchObject({ ok: true, value: { name: 'sample', directory: join(clone, 'skills', 'sample', 'v1') } });
    expect(ladder.lines[0]).toBe('Resolved: "SAMP" → sample (unique prefix)');
    expect(await run({ target: 'zzz', config: store }, new ScriptedPrompter())).toEqual({ ok: false, error: 'skills/zzz holds no v<N> folder.' });
    expect(await run({ target: 'SAMP', cwd: clone }, new ScriptedPrompter())).toEqual({ ok: false, error: 'skills/SAMP holds no v<N> folder.' });
  });
```
The `directory` field: extend every existing `toMatchObject` on a validate value only if it uses `toEqual` (none do today — check with grep).

`src/__tests__/cli.test.ts`: the `validate` and `eval-report` exact-args assertions gain `workingDirectory: process.cwd()` and `cwd: process.cwd()` respectively; add a bare `validate` / bare `eval-report` case expecting no `target` / no `ref` key.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/commands/__tests__/evalReport.test.ts src/commands/__tests__/validate.test.ts`
Expected: FAIL (type errors on `ref`/`target` optional, `directory` missing).

- [ ] **Step 3: Implement `evalReport.ts`**

```ts
export interface EvalReportArgs extends WithForm { ref?: string; /** Where a bare eval-report looks for the skill folder; defaults to process.cwd(). */ cwd?: string; team?: string; config?: ConfigStore; runner?: Runner; home?: string; }
```
Replace the `findSkill` line and its `failure` with:
```ts
    const miss = (ref: string) => `No skill named or identified by ${ref} exists in team ${teamName}.`;
    const home = args.home ?? homedir();
    // §6.1 rungs 0–4 over the Library and the team; the report itself is a team fact, so a name that
    // resolves only to a Library folder still has to be a team record.
    const resolved = await resolveSkillRef({ ref: args.ref, cwd: args.cwd ?? process.cwd(), home, config, stateRoot: store.root, team: { clone, name: teamName }, rungs: 4, print: (line) => io.print(line), miss });
    if (!resolved.ok) return resolved;
    const record = resolved.value.source === 'team' ? resolved.value.record : await findSkill(clone, teamName, resolved.value.name);
    if (!record) return failure(miss(args.ref ?? resolved.value.name));
```
(`homedir` — check whether the file already imports it for `versions.placed`; add if not. Reuse `home` where the file later derives the Library roots.)

- [ ] **Step 4: Implement `validate.ts`**

```ts
export interface ValidateArgs extends WithForm { /** A path, a name, or absent: the skill folder above `workingDirectory` (§6.1 rung 0). */ target?: string; team?: string; /** The team checkout to read (the Action); unrelated to the working directory. */ cwd?: string; /** Where a bare validate looks for the skill folder; defaults to process.cwd(). */ workingDirectory?: string; config?: ConfigStore; }
export interface ValidateResult { name: string; findings: number; warnings: number; repairable: number; /** The folder that was checked — what `skill fix` would rewrite. */ directory: string; }
```
In `run()`, before the `let clone` block:
```ts
    // Rung 0: a bare validate checks the skill folder above the working directory — any folder holding SKILL.md,
    // Library or not, because validate has always accepted any path.
    let targetRef = args.target;
    if (targetRef === undefined) {
      const folder = await nearestSkillFolder(args.workingDirectory ?? process.cwd());
      if (folder === undefined) return failure(CWD_MISS);
      io.print(`${RESOLVED_PREFIX}${basename(folder)} from the working directory`);
      targetRef = folder;
    }
```
Replace every later `args.target` with `targetRef`. After the existing two-mode target lookup, before `if (target === undefined) throw …`:
```ts
    // Rungs 1–4 (name mode, without --cwd only): after both lookups missed, a name may still be a unique
    // case/prefix/substring of a Library folder or a team skill. The Action's --cwd path is untouched.
    let resolvedTarget = target;
    if (resolvedTarget === undefined && args.cwd === undefined && isSkillName(targetRef) && store !== undefined) {
      const resolved = await resolveSkillRef({ ref: targetRef, cwd: args.workingDirectory ?? process.cwd(), home: homedir(), config, stateRoot: store.root, team: { clone, name: team }, rungs: 4, print: (line) => io.print(line), miss: (ref) => `skills/${ref} holds no v<N> folder.` });
      if (!resolved.ok) return resolved;
      resolvedTarget = resolved.value.source === 'library' ? await atPath(resolved.value.match.path) : await newestVersion(clone, resolved.value.record.name);
    }
    if (resolvedTarget === undefined) throw new Error(`skills/${targetRef} holds no v<N> folder.`);
    const { directory, name } = resolvedTarget;
```
This needs `store`, `config` and `team` hoisted out of the `if (args.cwd === undefined)` branch (`let store: ConfigStore | undefined; let config: Config | undefined; let team: string | undefined;` assigned in that branch; the resolver call is guarded on `store !== undefined && config !== undefined && team !== undefined`). Both result objects gain `directory`: `failure(\`Hygiene failed …\`, { name, findings, warnings, repairable, directory })` and `success({ name, findings: 0, warnings, repairable, directory })`. Imports: `basename` (already), `homedir` from `node:os`, `nearestSkillFolder, resolveSkillRef, CWD_MISS, RESOLVED_PREFIX` from `../lib/resolve-ref.js`, `type Config` from `../lib/schema.js`.

- [ ] **Step 5: `src/cli.ts`**

`program.command('validate [path|name]')` — the argument optional, the action `async (target: string | undefined, options) => execute((io) => active.validate({ form: context.form, workingDirectory: process.cwd(), ...(target === undefined ? {} : { target }), ...options }, io), …)`. `program.command('eval-report [skill]')` — the argument optional, `active.evalReport({ form: context.form, cwd: process.cwd(), ...(ref === undefined ? {} : { ref }), ...options }, io)`. The `desktop`'s `cliValidate` passes `--cwd` and a name over frames: unchanged.

- [ ] **Step 6: Run, lint, typecheck, commit**

Run: `npx vitest run src/commands/__tests__/evalReport.test.ts src/commands/__tests__/validate.test.ts src/__tests__/cli.test.ts src/__tests__/cli-hints.test.ts src/lib/__tests__/invocation-tripwire.test.ts src/commands/__tests__/serve.test.ts`
Expected: PASS. If `serve.test.ts` pins `validate`'s value shape with `toEqual`, add `directory: expect.any(String)`.

```bash
git add src/commands/evalReport.ts src/commands/validate.ts src/cli.ts src/commands/__tests__/evalReport.test.ts src/commands/__tests__/validate.test.ts src/__tests__/cli.test.ts
git commit -m "feat(eval-report, validate): optional argument with the autofill ladder; validate names the folder it checked (§6.1, D9)"
```

---

### Task 12: the `dashboardTeam()` fixture

**Files:**
- Modify: `src/lib/__tests__/fixtures.ts` (`git()` gains `env`; new exports)
- Test: `src/lib/__tests__/fixtures-dashboard.test.ts`

**Interfaces:**
- Produces: `git(args, cwd?, env?)`; `DASHBOARD_NOW = Date.parse('2026-09-13T12:00:00Z')`; `dashboardTeam(options?: { storeUnderHome?: boolean; localRemote?: boolean })` — `storeUnderHome` puts the config store at `<home>/.terum/skills` (the built bin's default root, for `bin.test.ts`), `localRemote` records the bare path as the team remote so a real `git` (no `mappedRunner`) sees the clone as `ok`; `DASHBOARD_IDS = { deploy: '11111111-1111-4111-8111-111111111111', tdd: '22222222-2222-4222-8222-222222222222', diagnose: '33333333-3333-4333-8333-333333333333' }`; `dashboardReceipt(overrides)` (a schema-2 receipt with comparisons, arm scores, efficiency, triggers); `dashboardTeam(): Promise<DashboardFixture>` where `DashboardFixture = { root: string; home: string; store: ConfigStore; clone: string; bare: string; runner: Runner & { calls: RecordedCall[] }; projectRoot: string; paths: { deploy: string; tdd: string; notes: string; diagnose: string } }`; `emptyMachine(): Promise<{ home: string; store: ConfigStore }>`; `redact(text, fixture)` (replaces `fixture.root` → `<ROOT>`, `fixture.home` → `<HOME>`).
- Consumes: `bareTeam`, `pushFromSeed`, `cloneWithIdentity`, `mappedRunner`, `person`, `temporaryDirectory`; `createConfigStore`; `canonicalDigest` (`src/lib/skills.ts`); `snapshotSkillDirectory` (`src/lib/placer/vendor/skillhub/skill-fingerprint.js`); `writeStamp` (`src/lib/hook.ts`); `receiptSchema` (`src/lib/evals/receipt.ts`).

The fixture is `review/2026-09-08-desktop-blank-map/fixture.sh` ported to layout 3 and extended with what the boards need to show: two versions, a partial receipt, an invalid receipt, a local FAIL, a stale local, an edited placement, a rejected folder, a symlink, a project root.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/fixtures-dashboard.test.ts
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as ls } from '../../commands/ls.js';
import { run as status } from '../../commands/status.js';
import { run as evalReport } from '../../commands/evalReport.js';
import { DASHBOARD_IDS, dashboardTeam, emptyMachine, redact, ScriptedPrompter } from './fixtures.js';

describe('dashboardTeam()', () => {
  it('builds a team the boards can show: three skills, three people, receipts at two versions, one invalid', async () => {
    const f = await dashboardTeam();
    const team = await ls({ config: f.store, runner: f.runner, home: f.home, cwd: f.home }, new ScriptedPrompter());
    if (!team.ok) throw new Error(team.error);
    expect(team.value.skills.map((s) => [s.name, s.latest, s.versionCount, s.installs, s.receipt?.verdict ?? null, s.evalVersion, s.latestEvalState])).toEqual([
      ['deploy-check', 'v2', 2, 2, 'NEUTRAL', 2, 'ok'], ['diagnose', 'v1', 1, 0, null, null, 'invalid'], ['tdd', 'v2', 2, 1, 'PASS', 1, 'ok'],
    ]);
    expect(team.value.skills.map((s) => s.updated)).toEqual(['2026-09-05T10:00:00+00:00', '2026-09-03T10:00:00+00:00', '2026-09-04T10:00:00+00:00']);
    expect(team.value.people?.map((p) => [p.handle, p.role, p.local_skills, p.installed.length, p.profile.length])).toEqual([['mira', null, 3, 2, 0], ['ravi', 'Debugging', null, 0, 0], ['seed', 'Platform', 4, 1, 1]]);
    expect(team.value.projects?.map((p) => p.name)).toEqual(['Global', 'terum']);
    expect(team.value.problems).toEqual([{ source: `evals/${DASHBOARD_IDS.diagnose}`, message: expect.stringContaining('invalid') }]);
  });
  it('builds a Library with a placed, an edited, an untracked, a symlinked, an invalid-YAML and a project folder, with local receipts', async () => {
    const f = await dashboardTeam();
    const library = await ls({ local: true, config: f.store, runner: f.runner, home: f.home }, new ScriptedPrompter());
    if (!library.ok) throw new Error(library.error);
    const [global, project] = library.value.local!;
    expect(global!.rows.map((r) => [r.name, r.tracked, r.edited, r.localEval?.verdict ?? null, r.localEvalStale, r.matchedVersion, r.teamEval?.verdict ?? null])).toEqual([
      ['deploy-check', true, false, 'FAIL', false, 'v1', 'PASS'], ['notes', false, false, null, false, null, null], ['tdd', true, true, null, true, null, null],
    ]);
    expect(global!.notOffered.map((r) => [r.name, r.reason])).toEqual([['bad-yaml', 'invalid-yaml'], ['linked', 'symlink']]);
    expect(project!.registered).toBe(true); expect(project!.label).toBe('proj');
    expect(project!.rows.map((r) => [r.name, r.tracked, r.knownToTeam])).toEqual([['diagnose', false, true]]);
    expect((await lstat(f.paths.notes)).isDirectory()).toBe(true);
  });
  it('status sees a stale stamp, a pending install and the placements; eval-report falls back for tdd and warns for diagnose', async () => {
    const f = await dashboardTeam();
    const s = await status({ config: f.store, runner: f.runner, now: () => Date.parse('2026-09-13T12:00:00Z') }, new ScriptedPrompter());
    if (!s.ok) throw new Error(s.error);
    expect(s.value.teams[0]).toMatchObject({ team: 'acme', handle: 'seed', stale: true, membership: 'active', memberCount: 3, sharedSkills: 3, pending: [{ op: 'install', id: DASHBOARD_IDS.diagnose }] });
    expect(s.value.ledger.placements.map((p) => p.id).sort()).toEqual([DASHBOARD_IDS.deploy, DASHBOARD_IDS.tdd]);
    expect(s.value.tools).toEqual({ git: true, gh: false });
    const tdd = await evalReport({ ref: 'tdd', config: f.store, runner: f.runner, home: f.home }, new ScriptedPrompter());
    expect(tdd).toMatchObject({ ok: true, value: { versions: { placed: 'v1', teamCurrent: 'v2', evaluated: 'v1' }, fallbackFrom: 'v1', latestState: 'none' } });
    const io = new ScriptedPrompter();
    expect(await evalReport({ ref: 'diagnose', config: f.store, runner: f.runner, home: f.home }, io)).toMatchObject({ ok: true, value: { latestState: 'invalid', latest: null } });
    expect(io.lines[0]).toMatch(/^warning: the newest receipt is invalid/);
    expect(redact(`${f.root}/x ${f.home}/y`, f)).toBe('<ROOT>/x <HOME>/y');
    expect(JSON.parse(await readFile(join(f.store.root, 'config.json'), 'utf8')).default_handle).toBe('seed');
  });
  it('emptyMachine() has no team and an empty Library', async () => {
    const m = await emptyMachine();
    const s = await status({ config: m.store, runner: { run: async (command) => (command === 'git' ? { code: 0, stdout: 'git version 2', stderr: '' } : Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))) } }, new ScriptedPrompter());
    expect(s).toMatchObject({ ok: true, value: { teams: [] } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/fixtures-dashboard.test.ts`
Expected: FAIL — `dashboardTeam` is not exported.

- [ ] **Step 3: Implement in `src/lib/__tests__/fixtures.ts`**

Change `git`:
```ts
export async function git(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await systemRunner.run('git', args, { cwd, ...(env === undefined ? {} : { env }) });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
```
Add (imports: `cp, symlink, utimes` from `node:fs/promises`; `canonicalDigest` from `../skills.js`; `snapshotSkillDirectory` from `../placer/vendor/skillhub/skill-fingerprint.js`; `writeStamp` from `../hook.js`; `receiptSchema, type Receipt` from `../evals/receipt.js`; `createConfigStore, type ConfigStore` from `../config.js`; `type Runner` from `../runner.js`):

```ts
export const DASHBOARD_NOW = Date.parse('2026-09-13T12:00:00Z');
export const DASHBOARD_IDS = { deploy: '11111111-1111-4111-8111-111111111111', tdd: '22222222-2222-4222-8222-222222222222', diagnose: '33333333-3333-4333-8333-333333333333' } as const;
export const DASHBOARD_REMOTE = 'github.com/acme/team';

const dashboardSkill = (name: string, id: string, author: string, category: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: "${description}"\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: ${author}\n  terum-category: ${category}\n---\n${body}`;

/** A schema-2 receipt with every limb the boards draw; `comparison` is the candidate-vs-baseline record. */
export function dashboardReceipt(input: { skill_id: string | null; skill_name: string; version: string | null; run_id: string; content_digest: string; w: number; l: number; t: number; execution_status?: 'complete' | 'partial' | 'failed'; expected?: number; runner?: string; timestamp?: string; triggers?: boolean }): Receipt {
  const n = input.w + input.l + input.t;
  const expected = input.expected ?? n;
  return receiptSchema.parse({
    schema_version: 2, skill_id: input.skill_id, skill_name: input.skill_name, version: input.version, content_digest: input.content_digest, run_id: input.run_id,
    verdict: 3 * (input.w - input.l) >= n ? 'PASS' : 3 * (input.l - input.w) >= n ? 'FAIL' : 'NEUTRAL', attribution: 'The candidate answered every case with the checklist; the baseline skipped the rollback step twice.',
    execution_status: input.execution_status ?? 'complete', expected_rows: expected, scored_rows: n,
    comparisons: { 'candidate-vs-baseline': { win: input.w, loss: input.l, tie: input.t, net_lift: n === 0 ? 0 : (input.w - input.l) / n, sign_p: 0.03125 } },
    arm_scores: { candidate: 0.8, baseline: 0.5 }, environment_skips: {},
    triggers: input.triggers === false ? null : { recall: 0.8, precision: 1, tp: 4, fn: 1, fp: 0, tn: 5 },
    efficiency: { candidate: { turns: 6.5, duration_ms: 30_000, cost_usd: 0.4 }, baseline: { turns: 5, duration_ms: 20_000, cost_usd: 0.3 } },
    provenance: { engine_version: '0.16.0', engine_commit: 'abc1234', cc_version: '2.1.0', model: 'sonnet', judge_model: 'opus', k: 1, cases: ['rollback', 'canary', 'smoke', 'alerts', 'rollout', 'audit'].slice(0, Math.max(1, expected)), arm_skill_lists: { candidate: [input.skill_name], baseline: null }, timestamp: input.timestamp ?? '2026-09-01T10:00:00Z', runner_handle: input.runner ?? 'seed' },
  });
}

export interface DashboardFixture { root: string; home: string; store: ConfigStore; clone: string; bare: string; runner: Runner & { calls: RecordedCall[] }; projectRoot: string; paths: { deploy: string; tdd: string; notes: string; diagnose: string } }

/**
 * The fixture team of review/2026-09-08-desktop-blank-map/fixture.sh, ported to layout 3 and given
 * what the boards must show (§13): three skills at two versions, three people, receipts at two
 * versions plus one invalid, a stale stamp, a pending install, and a Library with a placed, an
 * edited, an untracked, a symlinked, an invalid-YAML and a project folder, with local receipts.
 * Every date is fixed so a snapshot is stable; `DASHBOARD_NOW` is the clock a board must render with.
 */
export async function dashboardTeam(options: { storeUnderHome?: boolean; localRemote?: boolean } = {}): Promise<DashboardFixture> {
  const team = await bareTeam();
  const home = join(team.root, 'home');
  await mkdir(home, { recursive: true });
  const store = createConfigStore(options.storeUnderHome ? join(home, '.terum', 'skills') : join(team.root, 'state'));
  const remote = options.localRemote ? team.bare : DASHBOARD_REMOTE;
  const seed = team.seed;
  const at = (iso: string): NodeJS.ProcessEnv => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
  const commit = async (message: string, iso: string): Promise<void> => {
    await git(['add', '--all'], seed); await git(['commit', '-q', '-m', message], seed, at(iso)); await git(['push', '-q', 'origin', 'HEAD:main'], seed);
  };
  const write = async (path: string, content: string): Promise<void> => { await mkdir(join(seed, path, '..'), { recursive: true }); await writeFile(join(seed, path), content); };
  const { deploy, tdd, diagnose } = DASHBOARD_IDS;
  const MIRA = 'Mira Chen <mira@example.com>', SEED = 'Seed <seed@example.com>', RAVI = 'Ravi Patel <ravi@example.com>';
  // team.json, people, skills — one commit per skill version so `updated` dates differ.
  await write('team.json', `${JSON.stringify({ layout_version: 3, name: 'acme', categories: ['ops', 'engineering', 'debugging'], projects: { Global: { remotes: [], skills: [deploy] }, terum: { remotes: ['github.com/acme/terum'], skills: [tdd] } }, archived: [], policy: { skill_license: 'UNLICENSED' } }, null, 2)}\n`);
  await write('people/seed.json', `${JSON.stringify(person('seed', { display_name: 'Seed', role: 'Platform', projects: ['terum'], local_skills: 4, installed: [{ id: deploy, version: 'v1', scope: { kind: 'global' }, since: '2026-08-20T09:00:00Z' }], profile: [{ id: deploy, name: 'deploy-check', version: 'v1', added: '2026-08-20T09:00:00Z', via: 'install' }] }), null, 2)}\n`);
  await write('people/mira.json', `${JSON.stringify(person('mira', { display_name: 'Mira Chen', local_skills: 3, installed: [{ id: deploy, version: 'v1', scope: { kind: 'global' }, since: '2026-08-25T09:00:00Z' }, { id: tdd, version: 'v1', scope: { kind: 'project', project: 'terum' }, since: '2026-08-26T09:00:00Z' }] }), null, 2)}\n`);
  await write('people/ravi.json', `${JSON.stringify(person('ravi', { display_name: 'Ravi Patel', role: 'Debugging', local_skills: null }), null, 2)}\n`);
  await write('skills/deploy-check/v1/SKILL.md', dashboardSkill('deploy-check', deploy, MIRA, 'ops', 'Use this when a deploy needs a checklist. Walks rollback, canary and smoke steps.', '# Deploy check\n\n1. Confirm the rollback path.\n2. Canary one host.\n3. Smoke test.\n'));
  await commit('deploy-check v1', '2026-09-01T10:00:00Z');
  await write('skills/tdd/v1/SKILL.md', dashboardSkill('tdd', tdd, SEED, 'engineering', 'Red, green, refactor. Use when adding behaviour to code with tests.', '# TDD\n\nWrite the failing test first.\n'));
  await commit('tdd v1', '2026-09-02T10:00:00Z');
  await write('skills/diagnose/v1/SKILL.md', dashboardSkill('diagnose', diagnose, RAVI, 'debugging', 'Narrow a failure to one cause before changing anything.', '# Diagnose\n\nReproduce, bisect, fix.\n'));
  await commit('diagnose v1', '2026-09-03T10:00:00Z');
  await write('skills/tdd/v2/SKILL.md', dashboardSkill('tdd', tdd, SEED, 'engineering', 'Red, green, refactor. Use when adding behaviour to code with tests.', '# TDD\n\nWrite the failing test first. Then the smallest change.\n'));
  await commit('tdd v2', '2026-09-04T10:00:00Z');
  await write('skills/deploy-check/v2/SKILL.md', dashboardSkill('deploy-check', deploy, MIRA, 'ops', 'Use this when a deploy needs a checklist. Walks rollback, canary and smoke steps.', '# Deploy check\n\n1. Confirm the rollback path.\n2. Canary one host.\n3. Smoke test.\n4. Watch the alerts for ten minutes.\n'));
  await commit('deploy-check v2', '2026-09-05T10:00:00Z');
  // Receipts: deploy v1 PASS 4W2L0T, deploy v2 NEUTRAL 2W2L2T partial 6/8, tdd v1 PASS 5W1L0T (v2 has none → fallback), diagnose v1 invalid JSON.
  const digest = (name: string, folder: string): Promise<string> => canonicalDigest(join(seed, 'skills', name, folder));
  await write(`evals/${deploy}/v1/20260901T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: 'v1', run_id: '20260901T100000Z', content_digest: await digest('deploy-check', 'v1'), w: 4, l: 2, t: 0, runner: 'mira', timestamp: '2026-09-01T11:00:00Z' }), null, 2)}\n`);
  await write(`evals/${deploy}/v2/20260905T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: 'v2', run_id: '20260905T100000Z', content_digest: await digest('deploy-check', 'v2'), w: 2, l: 2, t: 2, execution_status: 'partial', expected: 8, runner: 'seed', timestamp: '2026-09-05T11:00:00Z' }), null, 2)}\n`);
  await write(`evals/${tdd}/v1/20260902T100000Z.json`, `${JSON.stringify(dashboardReceipt({ skill_id: tdd, skill_name: 'tdd', version: 'v1', run_id: '20260902T100000Z', content_digest: await digest('tdd', 'v1'), w: 5, l: 1, t: 0, runner: 'seed', timestamp: '2026-09-02T11:00:00Z', triggers: false }), null, 2)}\n`);
  await write(`evals/${diagnose}/v1/20260903T100000Z.json`, '{');
  await commit('receipts', '2026-09-06T10:00:00Z');
  const clone = await cloneWithIdentity(team.bare, store.teamClone('acme'), 'Seed', 'seed@example.com');
  // Library: a placed unedited copy of deploy-check v1, a placed and edited copy of tdd v1, an untracked folder,
  // a symlink, an invalid-YAML folder, and a registered project holding diagnose.
  const skillsRoot = join(home, '.claude', 'skills');
  const paths = { deploy: join(skillsRoot, 'deploy-check'), tdd: join(skillsRoot, 'tdd'), notes: join(skillsRoot, 'notes'), diagnose: join(team.root, 'proj', '.claude', 'skills', 'diagnose') };
  await cp(join(clone, 'skills', 'deploy-check', 'v1'), paths.deploy, { recursive: true });
  await cp(join(clone, 'skills', 'tdd', 'v1'), paths.tdd, { recursive: true });
  const tddFingerprint = (await snapshotSkillDirectory(paths.tdd)).fingerprint; // recorded BEFORE the edit → `edited`
  await writeFile(join(paths.tdd, 'SKILL.md'), `${await readFile(join(paths.tdd, 'SKILL.md'), 'utf8')}\nLocal note.\n`);
  await mkdir(paths.notes, { recursive: true }); await writeFile(join(paths.notes, 'SKILL.md'), '---\nname: notes\ndescription: "Personal notes on how this team ships. Not shared; not a team skill."\n---\n# Notes\n\nKeep the release calendar here.\n');
  await symlink(paths.notes, join(skillsRoot, 'linked'));
  await mkdir(join(skillsRoot, 'bad-yaml'), { recursive: true }); await writeFile(join(skillsRoot, 'bad-yaml', 'SKILL.md'), '---\nname: [\ndescription: broken\n---\n');
  const projectRoot = join(team.root, 'proj');
  await mkdir(join(projectRoot, '.git'), { recursive: true });
  await cp(join(clone, 'skills', 'diagnose', 'v1'), paths.diagnose, { recursive: true });
  // Config: identity, the team, the project, two placements, one pending install.
  await store.update((config) => {
    config.default_handle = 'seed'; config.email = 'seed@example.com'; config.display_name = 'Seed'; config.github = 'seed';
    config.teams.acme = { remote, handle: 'seed' };
    config.projects = [{ root: projectRoot, label: 'proj' }];
    config.placements[paths.deploy] = { id: deploy, team: 'acme', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-08-20T09:00:00Z', fingerprint: '' };
    config.placements[paths.tdd] = { id: tdd, team: 'acme', version: 'v1', scope: { kind: 'global' }, placed_at: '2026-08-21T09:00:00Z', fingerprint: tddFingerprint };
    config.pending.push({ op: 'install', id: diagnose, team: 'acme', scope: { kind: 'global' }, started: '2026-09-12T08:00:00Z' });
  });
  await store.update(async (config) => { config.placements[paths.deploy]!.fingerprint = (await snapshotSkillDirectory(paths.deploy)).fingerprint; });
  // Local receipts (content-keyed): deploy-check FAIL 1W4L1T with a run.jsonl; tdd's PRISTINE bytes (so the edited folder is stale).
  const localRun = async (path: string, receipt: Receipt): Promise<void> => {
    const dir = join(store.root, 'evals', 'local', receipt.content_digest!.slice(7), receipt.run_id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(join(dir, 'run.jsonl'), '{"event":"start"}\n');
    void path;
  };
  await localRun(paths.deploy, dashboardReceipt({ skill_id: deploy, skill_name: 'deploy-check', version: null, run_id: '20260912T100000Z', content_digest: await canonicalDigest(paths.deploy), w: 1, l: 4, t: 1, runner: 'seed', timestamp: '2026-09-12T10:00:00Z' }));
  await localRun(paths.tdd, dashboardReceipt({ skill_id: tdd, skill_name: 'tdd', version: null, run_id: '20260911T100000Z', content_digest: await digest('tdd', 'v1'), w: 3, l: 0, t: 0, runner: 'seed', timestamp: '2026-09-11T10:00:00Z', triggers: false }));
  // A stamp three hours old: stale.
  await writeStamp(store.root, 'acme', { head: 'fixture', at: '2026-09-13T09:00:00Z' });
  const stampAt = new Date(DASHBOARD_NOW - 3 * 60 * 60_000);
  await utimes(join(store.root, 'run', 'acme.stamp'), stampAt, stampAt);
  return { root: team.root, home, store, clone, bare: team.bare, runner: mappedRunner(remote, team.bare), projectRoot, paths };
}

/** No team, no Library: the get-started boards. */
export async function emptyMachine(): Promise<{ home: string; store: ConfigStore }> {
  const root = await temporaryDirectory();
  const home = join(root, 'home'); await mkdir(home, { recursive: true });
  return { home, store: createConfigStore(join(root, 'state')) };
}

export function redact(text: string, fixture: { root: string; home: string }): string {
  return text.split(fixture.home).join('<HOME>').split(fixture.root).join('<ROOT>');
}
```
Notes for the implementer: `store.update` may be synchronous-callback only — read `src/lib/config.ts:11-22`; if it does not accept an async callback, compute both fingerprints before the single `update` call. `snapshotSkillDirectory(paths.deploy)` after `cp` gives the unedited fingerprint (`edited: false`); the tdd fingerprint is taken before the edit so `healthOf` reports `local-changed`. `stampIsFresh` reads the file's mtime (`stampedAt`), which `utimes` sets; `staleLine` needs `now` — `status` takes `now` in `StatusArgs`. `canonicalDigest` on the seed folder equals the digest of the same bytes in the clone and in the placed copy (one digest function).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/__tests__/fixtures-dashboard.test.ts`
Expected: PASS (4 tests). The `updated` dates come from `git log -1 --format=%cI` and are the `GIT_COMMITTER_DATE` values rendered in the committer's zone: the fixture passes `Z` times, git prints `+00:00`. If a date differs, the `env` did not reach git — check `systemRunner`'s env merge (`src/lib/runner.ts`).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
git add src/lib/__tests__/fixtures.ts src/lib/__tests__/fixtures-dashboard.test.ts
git commit -m "test(fixtures): dashboardTeam() — the blank-map team ported to layout 3 with receipts, a Library and a stale stamp"
```

---
### Task 13: shared renderer helpers and the `ls` renderer (Library, Marketplace, Member, Project, Skill detail)

**Files:**
- Create: `src/lib/render/verbs/shared.ts`, `src/lib/render/verbs/ls.ts`
- Modify: `src/lib/render/registry.ts` (register `ls`)
- Test: `src/lib/render/__tests__/boards.test.ts` (created here with the `ls` scenarios; later tasks add theirs), `src/lib/render/__tests__/__snapshots__/*.txt` (written by the first run, reviewed by eye)

**Interfaces:**
- Produces (`shared.ts`): `asRecord(value): Record<string, unknown>`, `asArray(value): unknown[]`, `str(value): string | null`, `num(value): number | null`, `escapeRegExp(text)`, `versionText(folder: unknown): string` (`v3` → `Version 3`, anything else → `—`), `receiptVerdict(receipt: unknown, extra?: { stale?; from?; invalid? }): Cell`, `receiptHeadline(receipt: unknown, ctx): string` (`✓ PASS +33% · 4W 2L 0T (n=6) · p=0.031 · complete · sonnet k=1 · @mira · 2026-09-01`), `receiptSections(receipt: unknown, triggers: unknown, ctx): Section[]` (Comparisons table, Arm scores bars, Efficiency table + ROI bars, Triggers text, Provenance kv), `skillsTable(rows: SkillRowInput[], ctx, options: { title?; viewerInstalled?: Map<string, string | null>; eval: boolean; team?: boolean })` → `Table`, `SkillRowInput = { name; description; author; category; latest; installs; updated; receipt?; evalVersion?; latestEvalState?; team?; id }`, `nextSkillInfo(name)`, `nextEval(name)`, `nextEvalReport(name)`, `nextInstall(ref)`, `nextListSkills(local?)`.
- Produces (`ls.ts`): `render(value, ctx): Board`, `covered`, `uncovered` — registered as `REGISTRY['ls']`.
- Consumes: Tasks 1–7; `LsResult`, `LsSkill`, `LocalSection` shapes (Task 9); `getStartedLines` (`src/lib/invocation.ts`) is not needed here.

- [ ] **Step 1: Write the failing snapshot test**

```ts
// src/lib/render/__tests__/boards.test.ts
import { describe, expect, it } from 'vitest';
import { run as ls } from '../../../commands/ls.js';
import { createExecute } from '../../execute.js';
import type { ResultOutcome } from '../../frames.js';
import type { Prompter } from '../../prompt.js';
import type { Result } from '../../result.js';
import { DASHBOARD_NOW, dashboardTeam, emptyMachine, redact, type DashboardFixture } from '../../__tests__/fixtures.js';
import type { RenderOptions } from '../options.js';
import { createBoardSink } from '../sink.js';

/**
 * §13: one file snapshot per board × backend. Each scenario runs the real verb against dashboardTeam()
 * through the board sink, so what is pinned is the whole path from value to text. Review a changed
 * snapshot by eye; never regenerate one to make a test pass without reading the diff.
 */
export const BACKENDS: Record<string, Partial<RenderOptions>> = {
  md: { format: 'md', color: false, width: 100 },
  'pretty-colour': { format: 'pretty', color: true, width: 100 },
  'pretty-70': { format: 'pretty', color: false, width: 70 },
  json: { format: 'json' },
};

export async function boardOf(verb: string, argv: string[], backend: string, act: (io: Prompter) => Promise<Result<unknown>>, fixture: { root: string; home: string }): Promise<string> {
  const written: string[] = []; const errors: string[] = []; const codes: number[] = [];
  const options: RenderOptions = { format: 'md', formatGiven: true, host: 'claude', rows: 25, width: 100, color: false, ...BACKENDS[backend] };
  const sink = createBoardSink({ options, form: undefined, home: fixture.home, now: () => DASHBOARD_NOW, argv, command: `npx -y terum-skills@latest ${argv.join(' ')} --format ${options.format}`, write: (text) => written.push(text), stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code) });
  await createExecute(sink)(act, { verb, notices: false });
  expect(written).toHaveLength(1);
  const trailer = errors.length || codes.length ? `\n--- stderr ---\n${errors.join('\n')}\n--- exit ${codes.join(',')} ---\n` : '';
  return redact(`${written[0]}${trailer}`, fixture);
}

export function typed(verb: string, argv: string[], backend: string, outcome: Omit<ResultOutcome, 'verb'>, lines: string[], fixture = { root: '/nowhere-root', home: '/home/seed' }): Promise<string> {
  return boardOf(verb, argv, backend, async (io) => { for (const line of lines) io.print(line); return outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: outcome.error ?? 'failed', ...(outcome.refused ? { refused: true } : {}), ...(outcome.cancelled ? { cancelled: true } : {}), ...(outcome.value === undefined ? {} : { value: outcome.value }) }; }, fixture);
}

const snapshot = (name: string, backend: string): string => `./__snapshots__/${name}.${backend}.txt`;
let team: DashboardFixture | undefined;
const fixture = async (): Promise<DashboardFixture> => team ??= await dashboardTeam();

describe('ls boards', () => {
  for (const backend of Object.keys(BACKENDS)) {
    it.each([
      ['team.library', ['ls', '--local'], { local: true }],
      ['team.marketplace', ['ls'], {}],
      ['team.member', ['ls', 'member', 'seed'], { kind: 'member', value: 'seed' }],
      ['team.project', ['ls', 'project', 'terum'], { kind: 'project', value: 'terum' }],
      ['team.skill-team', ['ls', 'skill', 'deploy-check'], { kind: 'skill', value: 'deploy-check' }],
      ['team.skill-library', ['ls', 'skill', 'notes'], { kind: 'skill', value: 'notes' }],
      ['team.skill-prefix', ['ls', 'skill', 'DIAG'], { kind: 'skill', value: 'DIAG' }],
      ['team.skill-miss', ['ls', 'skill', 'ghost'], { kind: 'skill', value: 'ghost' }],
    ] as const)('%s (' + backend + ')', async (name, argv, args) => {
      const f = await fixture();
      const text = await boardOf('ls', [...argv], backend, (io) => ls({ ...args, config: f.store, runner: f.runner, home: f.home, cwd: f.home }, io), f);
      await expect(text).toMatchFileSnapshot(snapshot(name, backend));
    });
    it(`empty.library (${backend})`, async () => {
      const m = await emptyMachine();
      const text = await boardOf('ls', ['ls', '--local'], backend, (io) => ls({ local: true, config: m.store, home: m.home, runner: { run: async () => ({ code: 1, stdout: '', stderr: '' }) } }, io), { root: m.store.root, home: m.home });
      await expect(text).toMatchFileSnapshot(snapshot('empty.library', backend));
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/render/__tests__/boards.test.ts`
Expected: FAIL — snapshots are written on first run (vitest writes missing file snapshots), but the boards are fallback blocks because `REGISTRY['ls']` is absent; delete the written files after reading them: `rm src/lib/render/__tests__/__snapshots__/*.txt`.

- [ ] **Step 3: Implement `shared.ts`**

```ts
// src/lib/render/verbs/shared.ts
/** What every renderer needs: null-safe readers over an `unknown` value, the receipt sections, the skills table, the Next items. */
import { bar, bars, code, count, date, kv, table, text, textBlock, verdict, type Cell, type NextItem, type RenderContext, type Section, type Table } from '../board.js';
import { liftText, marketplaceOrder, parseVersionOrdinal, roiFractions, stripText, summariseReceipt, updateAvailable, shortDescription, displayName, type ReceiptLike } from '../policies.js';
import { relativeDate } from '../text.js';

export const asRecord = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const bool = (value: unknown): boolean => value === true;
export function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function versionText(folder: unknown): string { const n = parseVersionOrdinal(str(folder)); return n === null ? '—' : `Version ${n}`; }

function receiptLike(value: unknown): ReceiptLike | null {
  const r = asRecord(value);
  const verdictValue = r['verdict'];
  if (verdictValue !== 'PASS' && verdictValue !== 'NEUTRAL' && verdictValue !== 'FAIL') return null;
  const status = r['execution_status'];
  return { verdict: verdictValue, execution_status: status === 'partial' || status === 'failed' ? status : 'complete', expected_rows: num(r['expected_rows']) ?? 0, scored_rows: num(r['scored_rows']) ?? 0, comparisons: asRecord(r['comparisons']) as ReceiptLike['comparisons'] };
}

export function receiptVerdict(receipt: unknown, extra: { stale?: boolean; from?: string | null; invalid?: boolean } = {}): Cell {
  const summary = summariseReceipt(receiptLike(receipt));
  if (summary === null) return verdict({ verdict: null, stale: extra.stale, invalid: extra.invalid });
  return verdict({ verdict: summary.verdict, lift: summary.lift, partial: summary.partial, stale: extra.stale, from: extra.from ?? null, invalid: extra.invalid });
}

/** `✓ PASS +33% · 4W 2L 0T (n=6) · p=0.031 · complete · sonnet k=1 · @mira · 2026-09-01` */
export function receiptHeadline(receipt: unknown, ctx: RenderContext): string {
  const summary = summariseReceipt(receiptLike(receipt));
  if (summary === null) return '— not evaluated';
  const r = asRecord(receipt); const provenance = asRecord(r['provenance']);
  const glyph = summary.verdict === 'PASS' ? '✓' : summary.verdict === 'FAIL' ? '✗' : '●';
  const parts = [`${glyph} ${summary.verdict} ${liftText(summary.lift)}`, `${summary.w}W ${summary.l}L ${summary.t}T (n=${summary.n})`];
  if (summary.signP !== null) parts.push(`p=${summary.signP}`);
  parts.push(summary.partial ? `partial ${summary.partial[0]}/${summary.partial[1]}` : str(r['execution_status']) ?? 'complete');
  const model = str(provenance['model']); const k = num(provenance['k']);
  if (model !== null) parts.push(k === null ? model : `${model} k=${k}`);
  const runner = str(provenance['runner_handle']); if (runner !== null) parts.push(`@${runner}`);
  const when = str(provenance['timestamp']); if (when !== null) parts.push(relativeDate(when, ctx.now));
  return parts.join(' · ');
}

/** The receipt's own sections, one receipt only (never combined, §5): comparisons, arm scores, efficiency + ROI, triggers, provenance. */
export function receiptSections(receipt: unknown, triggers: unknown, ctx: RenderContext): Section[] {
  const r = asRecord(receipt); const sections: Section[] = [];
  const comparisons = Object.entries(asRecord(r['comparisons']));
  if (comparisons.length) {
    sections.push(table([{ key: 'name', label: 'Comparison', priority: 1 }, { key: 'w', label: 'W', priority: 1, align: 'right' }, { key: 'l', label: 'L', priority: 1, align: 'right' }, { key: 't', label: 'T', priority: 1, align: 'right' }, { key: 'lift', label: 'Lift', priority: 1 }, { key: 'p', label: 'p', priority: 2 }, { key: 'strip', label: 'Record', priority: 3 }],
      comparisons.map(([name, value]) => { const c = asRecord(value); const w = num(c['win']) ?? 0, l = num(c['loss']) ?? 0, t = num(c['tie']) ?? 0; const s = summariseReceipt({ verdict: 'NEUTRAL', execution_status: 'complete', expected_rows: 0, scored_rows: 0, comparisons: { 'candidate-vs-baseline': { win: w, loss: l, tie: t, ...(num(c['sign_p']) === null ? {} : { sign_p: num(c['sign_p'])! }) } } })!; return { name: text(name), w: count(w), l: count(l), t: count(t), lift: text(liftText(s.lift)), p: text(s.signP), strip: { kind: 'strip', text: stripText(w, l, t) } as Cell }; }),
      { title: 'Comparisons' }));
  }
  const scores = Object.entries(asRecord(r['arm_scores']));
  if (scores.length) sections.push(bars(scores.map(([arm, score]) => ({ label: arm, fraction: num(score), value: num(score) === null ? 'n/a' : num(score)!.toFixed(2) })), 'Arm scores'));
  const efficiency = Object.entries(asRecord(r['efficiency']));
  if (efficiency.length) {
    sections.push(table([{ key: 'arm', label: 'Arm', priority: 1 }, { key: 'turns', label: 'Turns', priority: 2, align: 'right' }, { key: 'time', label: 'Time', priority: 1 }, { key: 'cost', label: 'Cost', priority: 1 }],
      efficiency.map(([arm, value]) => { const e = asRecord(value); const turns = num(e['turns']); const ms = num(e['duration_ms']); const cost = num(e['cost_usd']); return { arm: text(arm), turns: text(turns === null ? null : turns.toFixed(1)), time: text(ms === null ? null : `${(ms / 1000).toFixed(1)}s`), cost: text(cost === null ? null : `$${cost.toFixed(2)}`) }; }),
      { title: 'Efficiency' }));
    const candidate = num(asRecord(asRecord(r['efficiency'])['candidate'])['cost_usd']); const baseline = num(asRecord(asRecord(r['efficiency'])['baseline'])['cost_usd']);
    const roi = roiFractions(candidate, baseline);
    if (roi !== null) sections.push(bars([{ label: 'candidate', fraction: roi[0], value: `$${candidate!.toFixed(2)}` }, { label: 'baseline', fraction: roi[1], value: `$${baseline!.toFixed(2)}` }], 'Cost, over the costlier arm'));
  }
  const trig = asRecord(triggers ?? r['triggers']);
  if (Object.keys(trig).length) {
    const f = (value: unknown): string => (num(value) === null ? 'n/a' : num(value)!.toFixed(2));
    const lines = [`recall ${f(trig['recall'])} · precision ${f(trig['precision'])} (tp ${num(trig['tp']) ?? '—'} fn ${num(trig['fn']) ?? '—'} fp ${num(trig['fp']) ?? '—'} tn ${num(trig['tn']) ?? '—'})`];
    for (const rowValue of asArray(trig['rows'])) { const row = asRecord(rowValue); if (row['correct'] === false) lines.push(`${row['expected'] === true ? 'MISS' : 'FALSE-FIRE'}: ${JSON.stringify(str(row['prompt']) ?? '')}${str(row['error']) === null ? '' : ` (selection call errored: ${str(row['error'])!.slice(0, 120)})`}`); }
    sections.push(textBlock(lines, { title: 'Triggers' }));
  }
  const provenance = asRecord(r['provenance']);
  if (Object.keys(provenance).length) sections.push(kv([['model', text(provenance['model'])], ['judge', text(provenance['judge_model'])], ['k', count(provenance['k'])], ['cases', text(asArray(provenance['cases']).length || null)], ['engine', text(str(provenance['engine_version']) === null ? null : `${provenance['engine_version']} (${provenance['engine_commit'] ?? '—'})`)], ['claude code', text(provenance['cc_version'])], ['runner', text(str(provenance['runner_handle']) === null ? null : `@${provenance['runner_handle']}`)], ['when', date(provenance['timestamp'])]], 'Provenance'));
  return sections;
}

export interface SkillRowInput { id: string | null; name: string; description: unknown; author: unknown; category: unknown; latest: unknown; installs: unknown; updated: unknown; receipt?: unknown; evalVersion?: unknown; latestEvalState?: unknown; team?: unknown }

/** Skill(1) · Desc(2, max 60) · Author(3) · Category(2) · Ver(1) · Installs(1, ▲) · Eval(1) · Updated(3) — the Marketplace shape, reused by Project and Search. */
export function skillsTable(rows: readonly SkillRowInput[], ctx: RenderContext, options: { title?: string; viewerInstalled?: ReadonlyMap<string, string | null>; eval: boolean; team?: boolean }): Table {
  const columns = [
    ...(options.team ? [{ key: 'team', label: 'Team', priority: 2 as const }] : []),
    { key: 'skill', label: 'Skill', priority: 1 as const }, { key: 'desc', label: 'Desc', priority: 2 as const, max: 60 }, { key: 'author', label: 'Author', priority: 3 as const }, { key: 'category', label: 'Category', priority: 2 as const },
    { key: 'ver', label: 'Ver', priority: 1 as const }, { key: 'installs', label: 'Installs', priority: 1 as const, align: 'right' as const },
    ...(options.eval ? [{ key: 'eval', label: 'Eval', priority: 1 as const }] : []), { key: 'updated', label: 'Updated', priority: 3 as const },
  ];
  const sorted = [...rows].sort((a, b) => marketplaceOrder({ installs: num(a.installs) ?? 0, name: a.name }, { installs: num(b.installs) ?? 0, name: b.name }));
  return table(columns, sorted.map((row) => {
    const held = row.id === null ? undefined : options.viewerInstalled?.get(row.id);
    const marker = held !== undefined && updateAvailable(str(row.latest) ?? '', held);
    const latestN = parseVersionOrdinal(str(row.latest)); const evalN = num(row.evalVersion);
    return {
      ...(options.team ? { team: text(row.team) } : {}),
      skill: text(row.name), desc: text(shortDescription(str(row.description), 60)), author: text(displayName(str(row.author))), category: text(row.category),
      ver: text(versionText(row.latest)), installs: marker ? text(`${num(row.installs) ?? '—'} ▲`) : count(row.installs),
      ...(options.eval ? { eval: receiptVerdict(row.receipt, { invalid: row.latestEvalState === 'invalid', from: evalN !== null && latestN !== null && evalN !== latestN ? `Version ${evalN}` : null }) } : {}),
      updated: date(row.updated),
    };
  }), { ...(options.title === undefined ? {} : { title: options.title }), cap: ctx.rows });
}

export const nextSkillInfo = (name: string): NextItem => ({ label: 'Details', skill: 'skill-info', verb: 'ls skill', args: [name] });
export const nextEval = (name: string, ...flags: string[]): NextItem => ({ label: 'Evaluate', skill: 'eval', verb: 'eval', args: [name, ...flags] });
export const nextEvalReport = (name: string): NextItem => ({ label: 'Eval report', skill: 'eval-report', verb: 'eval-report', args: [name] });
export const nextInstall = (...args: string[]): NextItem => ({ label: 'Install', verb: 'install', args });
export const nextListSkills = (local = false): NextItem => ({ label: local ? 'Library' : 'Marketplace', skill: 'list-skills', verb: 'ls', args: local ? ['--local'] : [] });
export const nextSearch = (term: string): NextItem => ({ label: 'Search', skill: 'search-skills', verb: 'search', args: [term] });
export const nextSync: NextItem = { label: 'Sync', skill: 'sync-skills', verb: 'sync', args: [] };
export const nextStatus: NextItem = { label: 'Status', skill: 'skill-status', verb: 'status', args: [] };
export const nextProjectAdd: NextItem = { label: 'Add a project', verb: 'project add', args: [] };
export { code, kv, table, text, textBlock, count, date, bar, bars };
```

- [ ] **Step 4: Implement `verbs/ls.ts`**

```ts
// src/lib/render/verbs/ls.ts
import { board, kv, path, status, table, text, textBlock, type Board, type NextItem, type RenderContext, type Section } from '../board.js';
import { attentionCounts, groupNotOffered, libraryOrder, libraryState, parseVersionOrdinal, peopleOrder, projectsOrder, shortDescription, verdictCounts, type Verdict } from '../policies.js';
import { tildePath } from '../text.js';
import type { Renderer } from '../registry.js';
import { asArray, asRecord, bool, num, receiptHeadline, receiptVerdict, skillsTable, str, versionText, nextEval, nextEvalReport, nextInstall, nextProjectAdd, nextSkillInfo, type SkillRowInput } from './shared.js';

const BODY_PREVIEW_LINES = 30;

function localVerdict(row: Record<string, unknown>): Verdict | null {
  const v = asRecord(row['localEval'])['verdict'] ?? asRecord(row['teamEval'])['verdict'];
  return v === 'PASS' || v === 'NEUTRAL' || v === 'FAIL' ? v : null;
}
function libraryRow(row: Record<string, unknown>) {
  return { name: str(row['name']) ?? '—', edited: bool(row['edited']), tracked: bool(row['tracked']), known: bool(row['knownToTeam']) || str(row['skillId']) !== null, ...(str(row['problem']) === null ? {} : { problem: str(row['problem'])! }) };
}
function stateText(row: Record<string, unknown>): string {
  const state = libraryState(libraryRow(row));
  const placement = asRecord(row['placement']); const placedN = parseVersionOrdinal(str(placement['version']));
  const matchedN = parseVersionOrdinal(str(row['matchedVersion']));
  const base = state === 'placed' ? (placedN === null ? 'placed' : `placed Version ${placedN}`) : state === 'edited' ? 'edited ✎' : state;
  return matchedN !== null && matchedN !== placedN ? `${base} = Version ${matchedN}` : base;
}
/** PR #208 (D3): a runner is named iff the shown receipt's `mine` is false; a `localEval` without `mine` comes from an older CLI and keeps its earlier reading (an own run). */
function runnerOf(receipt: Record<string, unknown>): string | undefined {
  if (receipt['mine'] === undefined || bool(receipt['mine'])) return undefined;
  return `@${str(asRecord(receipt['provenance'])['runner_handle']) ?? '?'}`;
}
function evalCell(row: Record<string, unknown>) {
  const local = asRecord(row['localEval']); const teamEval = asRecord(row['teamEval']);
  if (Object.keys(local).length) { const from = runnerOf(local); return receiptVerdict(local, from === undefined ? {} : { from }); }
  if (Object.keys(teamEval).length) return receiptVerdict(teamEval, { from: runnerOf(teamEval) ?? 'team' });
  return receiptVerdict(null, { stale: bool(row['localEvalStale']) });
}
function libraryRowLine(row: Record<string, unknown>): string {
  return `  ${row['name']} — ${row['state']}${str(row['problem']) === null ? '' : `; source problem: ${row['problem']}`}; path: ${row['path']}`;
}

function library(value: Record<string, unknown>, ctx: RenderContext): Board {
  const sections = asArray(value['local']).map(asRecord);
  const rows = sections.flatMap((section) => asArray(section['rows']).map(asRecord));
  const attention = attentionCounts(rows.map((row) => ({ localVerdict: localVerdict(row), edited: bool(row['edited']), broken: str(row['problem']) !== null })));
  const b = board('Library', { headline: `${rows.length} skill${rows.length === 1 ? '' : 's'} across ${sections.length} root${sections.length === 1 ? '' : 's'} · attention ${attention.failing} failing · ${attention.notEvaluated} not evaluated · ${attention.edited} edited` });
  for (const section of sections) {
    const root = str(section['root']) ?? '—'; const remote = asRecord(section['remote']); const slug = str(remote['slug']);
    const rootState = str(section['rootState']);
    const title = `${str(section['label']) ?? 'Root'} — ${tildePath(root, ctx.home)}${slug === null ? '' : ` (${slug})`}${rootState === null || rootState === 'scanned' ? '' : ` (${rootState})`}`;
    const sorted = asArray(section['rows']).map(asRecord).sort((a, c) => libraryOrder(libraryRow(a), libraryRow(c)));
    b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'state', label: 'State', priority: 1 }, { key: 'eval', label: 'Eval', priority: 2 }, { key: 'desc', label: 'Desc', priority: 2, max: 60 }, { key: 'path', label: 'Path', priority: 3 }],
      sorted.map((row) => ({ skill: text(row['name']), state: text(stateText(row)), eval: evalCell(row), desc: text(shortDescription(str(row['description']))), path: path(row['path']) })), { title, cap: ctx.rows }));
    const notOffered = asArray(section['notOffered']).map(asRecord);
    if (notOffered.length) {
      const grouped = groupNotOffered(notOffered.map((entry) => ({ reason: str(entry['reason']) ?? 'failed' })), ctx.rows);
      b.sections.push(grouped.grouped
        ? table([{ key: 'reason', label: 'Reason', priority: 1 }, { key: 'n', label: 'Folders', priority: 1, align: 'right' }], grouped.groups.map((group) => ({ reason: text(group.reason), n: text(`×${group.count}`) })), { title: 'Cannot be connected' })
        : table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'reason', label: 'Reason', priority: 1 }, { key: 'path', label: 'Path', priority: 3 }], notOffered.map((entry) => ({ skill: text(entry['name']), reason: text(entry['detail'] ?? entry['reason']), path: path(entry['path']) })), { title: 'Cannot be connected', cap: ctx.rows }));
    }
  }
  const firstUnevaluated = rows.find((row) => localVerdict(row) === null && str(row['problem']) === null);
  if (firstUnevaluated) { const name = str(firstUnevaluated['name']) ?? ''; b.next.push(nextSkillInfo(name), nextEval(name)); }
  if (!sections.some((section) => bool(section['registered']))) b.next.push(nextProjectAdd);
  return b;
}

function viewerInstalled(value: Record<string, unknown>): Map<string, string | null> {
  const viewer = asRecord(value['viewer']); const handle = str(viewer['handle']);
  const person = asArray(value['people']).map(asRecord).find((p) => str(p['handle']) === handle);
  return new Map(asArray(person?.['installed']).map(asRecord).map((item) => [str(item['id']) ?? '', str(item['version'])]));
}
function skillRows(value: Record<string, unknown>): SkillRowInput[] {
  return asArray(value['skills']).map(asRecord).map((s) => ({ id: str(s['id']), name: str(s['name']) ?? '—', description: s['description'], author: s['author'], category: s['category'], latest: s['latest'], installs: s['installs'], updated: s['updated'], receipt: s['receipt'], evalVersion: s['evalVersion'], latestEvalState: s['latestEvalState'] }));
}

function marketplace(value: Record<string, unknown>, ctx: RenderContext): Board {
  const viewer = asRecord(value['viewer']); const skills = skillRows(value); const people = asArray(value['people']).map(asRecord); const projects = asArray(value['projects']).map(asRecord);
  const verdicts = verdictCounts(asArray(value['skills']).map(asRecord).map((s) => (s['latestEvalState'] === 'invalid' ? null : (asRecord(s['receipt'])['verdict'] as Verdict | undefined) ?? null)));
  const b = board(`Marketplace — ${str(viewer['team']) ?? 'team'}`, { headline: `${skills.length} skills · ${asArray(value['roster']).length} members · ${projects.length} projects · PASS ${verdicts.PASS} · NEUTRAL ${verdicts.NEUTRAL} · FAIL ${verdicts.FAIL} · not evaluated ${verdicts.notEvaluated}` });
  const held = viewerInstalled(value);
  b.sections.push(skillsTable(skills, ctx, { title: 'Skills', viewerInstalled: held, eval: true }));
  const installs = new Map(skills.map((s) => [s.id ?? '', num(s.installs) ?? 0]));
  const peopleSorted = [...people].sort((a, c) => peopleOrder(installs)({ handle: str(a['handle']) ?? '', authored: asArray(a['authored']).map(String) }, { handle: str(c['handle']) ?? '', authored: asArray(c['authored']).map(String) }));
  if (people.length) b.sections.push(table([{ key: 'handle', label: 'Handle', priority: 1 }, { key: 'name', label: 'Name', priority: 2 }, { key: 'role', label: 'Role', priority: 3 }, { key: 'installed', label: 'Installed', priority: 1, align: 'right' }, { key: 'authored', label: 'Authored', priority: 1, align: 'right' }, { key: 'local', label: 'Local skills (self-reported)', priority: 3, align: 'right' }],
    peopleSorted.map((p) => ({ handle: text(`@${str(p['handle']) ?? '?'}`), name: text(p['display_name']), role: text(p['role']), installed: { kind: 'count', n: asArray(p['installed']).length }, authored: { kind: 'count', n: asArray(p['authored']).length }, local: { kind: 'count', n: num(p['local_skills']) } })), { title: 'People', cap: ctx.rows }));
  const members = new Map<string, number>();
  for (const person of asArray(value['roster']).map(asRecord)) for (const name of asArray(person['projects']).map(String)) members.set(name, (members.get(name) ?? 0) + 1);
  const projectsSorted = [...projects].sort((a, c) => projectsOrder(members)({ name: str(a['name']) ?? '' }, { name: str(c['name']) ?? '' }));
  if (projects.length) b.sections.push(table([{ key: 'project', label: 'Project', priority: 1 }, { key: 'skills', label: 'Skills', priority: 1, align: 'right' }, { key: 'members', label: 'Members', priority: 2, align: 'right' }, { key: 'remotes', label: 'Remotes', priority: 3 }],
    projectsSorted.map((p) => ({ project: text(p['name']), skills: { kind: 'count', n: asArray(p['skills']).length }, members: { kind: 'count', n: members.get(str(p['name']) ?? '') ?? 0 }, remotes: text(asArray(p['remotes']).join(', ') || null) })), { title: 'Projects', cap: ctx.rows }));
  const top = [...skills].sort((a, c) => (num(c.installs) ?? 0) - (num(a.installs) ?? 0) || a.name.localeCompare(c.name))[0];
  if (top) b.next.push(nextSkillInfo(top.name));
  const unevaluated = skills.find((s) => s.receipt === null || s.receipt === undefined);
  if (unevaluated) b.next.push(nextEval(unevaluated.name));
  const notInstalled = skills.find((s) => s.id !== null && !held.has(s.id));
  if (notInstalled) b.next.push(nextInstall(notInstalled.name));
  return b;
}

function member(value: Record<string, unknown>, ctx: RenderContext): Board {
  const m = asRecord(value['member']);
  const b = board(`@${str(m['handle']) ?? '?'} — ${str(m['displayName']) ?? '—'}`);
  b.sections.push(kv([['role', text(m['role'])], ['projects', text(asArray(m['projects']).join(', ') || null)], ['authored', text(asArray(value['skills']).map(asRecord).map((s) => str(s['name'])).join(', ') || null)]]));
  b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'since', label: 'Since', priority: 3 }],
    asArray(m['installed']).map(asRecord).map((i) => { const scope = asRecord(i['scope']); return { skill: text(str(i['name']) ?? str(i['id'])?.slice(0, 8)), version: text(versionText(i['version'])), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), since: { kind: 'date', iso: str(i['since']) } }; }), { title: 'Installed', cap: ctx.rows }));
  b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'via', label: 'Via', priority: 2 }, { key: 'added', label: 'Added', priority: 3 }],
    asArray(m['profile']).map(asRecord).map((p) => ({ skill: text(p['name']), version: text(versionText(p['version'])), via: text(p['via']), added: { kind: 'date', iso: str(p['added']) } })), { title: 'Profile', cap: ctx.rows }));
  const first = asRecord(asArray(value['skills'])[0])['name'];
  if (typeof first === 'string') b.next.push(nextSkillInfo(first));
  return b;
}

function project(value: Record<string, unknown>, ctx: RenderContext): Board {
  const selection = asRecord(value['selection']); const name = str(selection['name']) ?? '—';
  const record = asArray(value['projects']).map(asRecord).find((p) => str(p['name']) === name) ?? {};
  const members = asArray(value['roster']).map(asRecord).filter((p) => asArray(p['projects']).includes(name)).map((p) => `@${str(p['handle'])}`);
  const b = board(`Project ${name}`);
  b.sections.push(kv([['remotes', text(asArray(record['remotes']).join(', ') || null)], ['members', text(members.join(', ') || null)]]));
  b.sections.push(skillsTable(skillRows(value), ctx, { title: 'Skills', viewerInstalled: viewerInstalled(value), eval: true }));
  b.next.push(nextInstall('project', name));
  return b;
}

function detail(value: Record<string, unknown>, ctx: RenderContext): Board {
  const selection = asRecord(value['selection']); const name = str(selection['name']) ?? '—';
  const skill = asArray(value['skills']).map(asRecord)[0]; const row = asArray(value['local']).map(asRecord).flatMap((s) => asArray(s['rows']).map(asRecord)).find((r) => str(r['name']) === name);
  const b = board(name);
  const sections: Section[] = [];
  const body = str(skill?.['body'] ?? row?.['body']);
  if (skill) {
    const latestN = parseVersionOrdinal(str(skill['latest'])); const versions = num(skill['versionCount']) ?? 0;
    b.title = `${name} — ${latestN === null ? '—' : `Version ${latestN}`} (${versions} version${versions === 1 ? '' : 's'})`;
    const description = str(skill['description']); if (description !== null && description !== '') sections.push(textBlock([description]));
    const evalN = num(skill['evalVersion']); const from = evalN !== null && latestN !== null && evalN !== latestN ? `from Version ${evalN}` : null;
    sections.push(kv([['id', text(skill['id'])], ['author', text(skill['author'])], ['category', text(skill['category'])], ['endorsement', text(skill['endorsement'])], ['grants', text(skill['grants'])], ['installs', { kind: 'count', n: num(skill['installs']) }], ['updated', { kind: 'date', iso: str(skill['updated']) }], ['latest', text(versionText(skill['latest']))],
      ['eval', text(skill['latestEvalState'] === 'invalid' ? '⚠ invalid receipt at the latest version' : `${receiptHeadline(skill['receipt'], ctx)}${from === null ? '' : ` (${from})`}`)]]));
    const installedBy = asArray(skill['installedBy']).map(asRecord);
    if (installedBy.length) sections.push(table([{ key: 'handle', label: 'Handle', priority: 1 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'since', label: 'Since', priority: 3 }],
      installedBy.map((i) => { const scope = asRecord(i['scope']); return { handle: text(`@${str(i['handle']) ?? '?'}`), version: text(versionText(i['version'])), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), since: { kind: 'date', iso: str(i['since']) } }; }), { title: 'Installed by', cap: ctx.rows }));
  }
  if (row) {
    if (!skill) { b.title = `${name} — Library`; const description = str(row['description']); if (description !== null && description !== '') sections.push(textBlock([description])); }
    sections.push(kv([['state', text(stateText(row))], ['path', path(row['path'])], ['health', status(bool(row['edited']) ? 'warn' : 'ok', bool(row['edited']) ? 'edited since placement' : str(row['health']) === 'unknown' ? 'unchanged or untracked' : str(row['health']))], ['local eval', text(row['localEval'] ? receiptHeadline(row['localEval'], ctx) : bool(row['localEvalStale']) ? '⚠ stale — edited since the eval' : '— not evaluated')], ['team eval for these bytes', text(row['teamEval'] ? receiptHeadline(row['teamEval'], ctx) : null)]], skill ? 'Your copy' : undefined));
  }
  if (body !== null && body.trim() !== '') {
    const lines = body.trimEnd().split('\n');
    sections.push(textBlock(lines.slice(0, BODY_PREVIEW_LINES), { title: 'Body preview', fenced: 'md' }));
    if (lines.length > BODY_PREVIEW_LINES) b.notes.push(`… ${lines.length - BODY_PREVIEW_LINES} more lines in the body`);
  }
  b.sections.push(...sections);
  const held = viewerInstalled(value); const id = str(skill?.['id']);
  if (skill && id !== null && !held.has(id) && !row) b.next.push(nextInstall(name));
  b.next.push(nextEval(name));
  if (skill) b.next.push(nextEvalReport(name));
  return b;
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const selection = asRecord(value['selection']);
  if (selection['kind'] === 'skill') return detail(value, ctx);
  if (selection['kind'] === 'member') return member(value, ctx);
  if (selection['kind'] === 'project') return project(value, ctx);
  if (Array.isArray(value['local'])) return library(value, ctx);
  return marketplace(value, ctx);
};

/** The listing prints reproduced by the boards; everything else (problems, overlay notices, unreadable receipts) is a note. */
export const covered: RegExp[] = [
  /^Local Claude Code skills \(/, /^  GitHub: /, /^  .+ — .+; path: /, /^Could not inspect as skills:$/, /^  none( \(.+ does not exist\))?$/, /^  \d+ skill folders? \(\d+ connectable\)$/,
  /^Members:$/, /^  \S+( \(inactive\))?$/, /^Skills:$/, /^  .+ — .+; \d+ installs; /, /^Local skills: /, /^Member \S+:$/, /^  Authored: /, /^  Installed: /, /^Project .+:$/,
];

/** The detail prints its description and body verbatim: those lines are the board, not notes. */
export function uncovered(lines: readonly string[], raw: unknown): string[] {
  const value = asRecord(raw);
  if (asRecord(value['selection'])['kind'] !== 'skill') return lines.filter((line) => !covered.some((pattern) => pattern.test(line)));
  const skill = asArray(value['skills']).map(asRecord)[0]; const row = asArray(value['local']).map(asRecord).flatMap((s) => asArray(s['rows']).map(asRecord))[0];
  const shown = new Set<string>();
  const body = str(skill?.['body'] ?? row?.['body']); if (body !== null) for (const line of body.trimEnd().split('\n')) shown.add(line);
  const description = str(skill?.['description'] ?? row?.['description']); if (description !== null) shown.add(description);
  if (row) shown.add(libraryRowLine(row));
  return lines.filter((line) => !shown.has(line) && !covered.some((pattern) => pattern.test(line)));
}

export const renderer: Renderer = { render, covered, uncovered };
```
Register in `src/lib/render/registry.ts`: the registry must not import verbs (verbs import the registry's `Renderer` type — a cycle through a type import is fine, but keep values one-way): create `src/lib/render/verbs/index.ts` that imports every verb module and exports `VERB_RENDERERS: Record<string, Renderer>`, and have `registry.ts` populate `REGISTRY` from it: `import { VERB_RENDERERS } from './verbs/index.js'; export const REGISTRY: Record<string, Renderer> = { ...VERB_RENDERERS };` with the `Renderer` interface moved to `src/lib/render/renderer.ts` (a leaf) that both sides import — do this now so the cycle never exists.

```ts
// src/lib/render/renderer.ts
import type { Board, RenderContext } from './board.js';
export interface Renderer { render(value: unknown, ctx: RenderContext): Board; covered: RegExp[]; uncovered?(lines: readonly string[], value: unknown): string[] }
```
```ts
// src/lib/render/verbs/index.ts
import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';
export const VERB_RENDERERS: Record<string, Renderer> = { ls };
```
(Tasks 14–16 add their entries here.) `registry.ts` re-exports `type { Renderer }` so Task 7's test import keeps working.

- [ ] **Step 5: Run the snapshot test and review every file**

Run: `npx vitest run src/lib/render/__tests__/boards.test.ts`
Expected: PASS with new files under `src/lib/render/__tests__/__snapshots__/`. Open each `team.*.md.txt` and check against §7: the Library shows `deploy-check` as `placed Version 1` with `✗ FAIL −50%`, `tdd` as `edited ✎` with `⚠ stale — edited since the eval`, `notes` as `untracked`, `bad-yaml` and `linked` under Cannot be connected, the `proj` root with `diagnose` as `shared = Version 1`; the Marketplace headline reads `3 skills · 3 members · 2 projects · PASS 1 · NEUTRAL 1 · FAIL 0 · not evaluated 1`, Installs shows `2 ▲` on `deploy-check` for the viewer holding v1; the member board lists seed's install and profile; the detail board title is `deploy-check — Version 2 (2 versions)` and its Next holds install? (no — seed holds it), `/eval deploy-check`, `/eval-report deploy-check`; `team.skill-prefix` starts with the italic `Resolved: "DIAG" → diagnose (unique prefix)`; `team.skill-miss` is a failure board `> ❌ No skill named ghost.` with `--- exit 1 ---`. The `pretty-70` files must show `(columns not shown at this width: …)` on the wide tables. Fix the renderer, not the snapshot, when something reads wrong; delete the snapshot files and re-run after each fix.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add src/lib/render/verbs/shared.ts src/lib/render/verbs/ls.ts src/lib/render/verbs/index.ts src/lib/render/renderer.ts src/lib/render/registry.ts src/lib/render/__tests__/boards.test.ts src/lib/render/__tests__/__snapshots__
git commit -m "feat(render): the ls boards — Library, Marketplace, Member, Project, Skill detail — with file snapshots (§7)"
```

---

### Task 14: `status`, `update`, `sync` renderers

**Files:**
- Create: `src/lib/render/verbs/status.ts`, `src/lib/render/verbs/update.ts`, `src/lib/render/verbs/sync.ts`
- Modify: `src/lib/render/verbs/index.ts`
- Test: `src/lib/render/__tests__/boards.test.ts` (new describe blocks)

**Interfaces:**
- Consumes: `StatusResult`/`TeamStatus` (`src/commands/status.ts:21-41`), `UpdateReport` (`update.ts:11`), `SyncResult`/`RefreshTeam` (`refresh.ts:44-70`), `getStartedLines` (`src/lib/invocation.ts`), shared helpers (Task 13).

- [ ] **Step 1: Write the failing tests** — append to `boards.test.ts`:

```ts
import { run as status } from '../../../commands/status.js';

describe('status, update, sync boards', () => {
  for (const backend of Object.keys(BACKENDS)) {
    it(`team.status (${backend})`, async () => {
      const f = await fixture();
      const text = await boardOf('status', ['status'], backend, async (io) => {
        const result = await status({ config: f.store, runner: f.runner, now: () => DASHBOARD_NOW }, io);
        // Machine facts are overwritten so the snapshot is stable across hosts (§13).
        return result.value === undefined ? result : { ...result, value: { ...result.value, version: '0.16.0', hostArch: 'arm64', processArch: 'x64', tools: { git: true, gh: false } } };
      }, f);
      await expect(text).toMatchFileSnapshot(snapshot('team.status', backend));
    });
    it(`empty.status (${backend})`, async () => {
      const m = await emptyMachine();
      const text = await boardOf('status', ['status'], backend, async (io) => {
        const result = await status({ config: m.store, runner: { run: async (command) => (command === 'git' ? { code: 0, stdout: 'git version 2.45.0', stderr: '' } : Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))) } }, io);
        return result.value === undefined ? result : { ...result, value: { ...result.value, version: '0.16.0', hostArch: 'x64', processArch: 'x64' } };
      }, { root: m.store.root, home: m.home });
      await expect(text).toMatchFileSnapshot(snapshot('empty.status', backend));
    });
    it(`typed.update (${backend})`, async () => {
      const value = { running: '0.16.0', latest: '0.17.0', observation: 'older', launch: 'npx', description: 'Latest advertised release: 0.17.0 (observed 2026-09-13T08:00:00Z)', advice: ['Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'], lines: ['terum-skills 0.16.0', 'This copy: /home/seed/.npm/_npx/abc/node_modules/terum-skills', 'Latest advertised release: 0.17.0 (observed 2026-09-13T08:00:00Z)', 'Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'] };
      await expect(await typed('update', ['update'], backend, { ok: true, value, exitCode: 0 }, value.lines)).toMatchFileSnapshot(snapshot('typed.update', backend));
    });
    it(`typed.sync (${backend})`, async () => {
      const value = { changed: true, teams: [{ team: 'acme', state: 'refreshed', changed: true, head: 'a1b2c3d4e5f6' }, { team: 'old', state: 'unreachable', changed: false, head: null, detail: 'repository not found', missing: true, successors: [{ ownerRepo: 'acme/team-2', source: 'member' }], summary: 'old: the repository is gone; GitHub knows acme/team-2 (renamed).' }], notices: ['Updated your terum-skills skills for this CLI.'] };
      await expect(await typed('sync', ['sync'], backend, { ok: true, value, exitCode: 0 }, ['old: not refreshed (unreachable) — repository not found', 'old: the repository is gone; GitHub knows acme/team-2 (renamed).', 'To follow it, run `npx -y terum-skills@latest team move acme/team-2`.'])).toMatchFileSnapshot(snapshot('typed.sync', backend));
    });
  }
});
```
(`Successor` is `{ ownerRepo: string; source: 'invitation' | 'member' }`, `src/lib/successor.ts:14-20`.)

- [ ] **Step 2: Run to verify the boards are fallbacks** (`npx vitest run src/lib/render/__tests__/boards.test.ts -t "status, update, sync"`), then delete the written snapshots.

- [ ] **Step 3: Implement `status.ts`**

```ts
// src/lib/render/verbs/status.ts
import { getStartedLines } from '../../invocation.js';
import { board, kv, path, status as statusCell, table, text, textBlock, type Board, type Cell, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { relativeDate } from '../text.js';
import { asArray, asRecord, bool, escapeRegExp, num, str, versionText, nextInstall, nextSync } from './shared.js';

function cloneText(team: Record<string, unknown>): Cell {
  const clone = asRecord(team['clone']); const where = str(team['clonePath']) ?? '—';
  switch (clone['state']) {
    case 'ok': return statusCell('ok', 'ok');
    case 'absent': return statusCell('bad', `${where} is missing.`);
    case 'foreign': return statusCell('bad', `${where} is a clone of ${str(clone['origin']) ?? '?'}, not ${str(team['repository']) ?? '?'}.`);
    case 'incomplete': return statusCell('bad', clone['reason'] === 'unverifiable' ? `${where} could not be verified (${str(clone['error']) ?? 'unknown error'}); check that git is installed before repairing anything.` : `${where} exists but is not a complete clone.`);
    default: return statusCell('muted', null);
  }
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const version = str(value['version']);
  const b = board(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);
  const teams = asArray(value['teams']).map(asRecord);
  if (teams.length === 0) { b.headline = 'No team on this machine yet.'; b.sections.push(textBlock([...getStartedLines(ctx.form)])); b.next.push({ label: 'Set up', verb: 'setup', args: [] }, { label: 'Library', skill: 'list-skills', verb: 'ls', args: ['--local'] }); }
  for (const team of teams) {
    const handle = str(team['handle']) ?? '?'; const ok = asRecord(team['clone'])['state'] === 'ok';
    const synced = str(team['syncedAt']); const stale = bool(team['stale']);
    b.sections.push(kv([
      ['repository', text(team['repository'])], ['clone', cloneText(team)],
      ['synced', synced === null ? text(null) : statusCell(stale ? 'warn' : 'ok', `${relativeDate(synced, ctx.now)}${stale ? ' ⚠ stale' : ''}`)],
      ['membership', text(team['membership'])], ['policy license', text(asRecord(team['policy'])['skill_license'])], ['categories', text(asArray(team['categories']).join(', ') || null)],
    ], `Team ${str(team['team']) ?? '?'} — ${ok ? 'you are' : 'configured handle'} @${handle}`));
    const members = asArray(team['members']).map(asRecord);
    if (members.length) b.sections.push(table([{ key: 'handle', label: 'Handle', priority: 1 }, { key: 'name', label: 'Name', priority: 2 }, { key: 'role', label: 'Role', priority: 3 }, { key: 'joined', label: 'Joined', priority: 3 }],
      members.map((m) => ({ handle: text(`@${str(m['handle']) ?? '?'}${str(m['handle']) === handle ? ' (you)' : ''}`), name: text(m['displayName']), role: text(m['role']), joined: { kind: 'date', iso: str(m['joined']) } })), { title: `Members (${num(team['memberCount']) ?? members.length}${num(team['unreadableMembers']) ? `; ${team['unreadableMembers']} unreadable` : ''})`, cap: ctx.rows }));
    const pending = asArray(team['pending']).map(asRecord);
    if (pending.length) {
      b.sections.push(table([{ key: 'op', label: 'Op', priority: 1 }, { key: 'id', label: 'Skill id', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'version', label: 'Version', priority: 2 }, { key: 'started', label: 'Started', priority: 3 }],
        pending.map((p) => { const scope = asRecord(p['scope']); return { op: text(p['op']), id: text(str(p['id'])?.slice(0, 8)), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), version: text(versionText(p['version'])), started: { kind: 'date', iso: str(p['started']) } }; }), { title: 'Pending', cap: ctx.rows }));
      for (const p of pending) { const id = str(p['id']); if (id !== null) b.next.push(p['op'] === 'uninstall' ? { label: 'Retry', verb: 'uninstall-skill', args: [id] } : nextInstall(id)); }
    }
    if (stale) b.next.push(nextSync);
  }
  const placements = asArray(asRecord(value['ledger'])['placements']).map(asRecord);
  if (placements.length) b.sections.push(table([{ key: 'path', label: 'Path', priority: 1 }, { key: 'team', label: 'Team', priority: 2 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'placed', label: 'Placed', priority: 3 }],
    placements.map((p) => { const scope = asRecord(p['scope']); return { path: path(p['path']), team: text(p['team']), version: text(versionText(p['version'])), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), placed: { kind: 'date', iso: str(p['placed_at']) } }; }), { title: 'Placements', cap: ctx.rows }));
  const identity = asRecord(value['identity']);
  if (Object.keys(identity).length) b.sections.push(kv([['handle', text(identity['default_handle'])], ['name', text(identity['display_name'])], ['email', text(identity['email'])], ['github', text(identity['github'])]], 'Identity'));
  const tools = asRecord(value['tools']);
  if (Object.keys(tools).length) b.sections.push(kv([['git', statusCell(bool(tools['git']) ? 'ok' : 'bad', bool(tools['git']) ? 'installed' : 'not found')], ['gh', statusCell(bool(tools['gh']) ? 'ok' : 'bad', bool(tools['gh']) ? 'installed' : 'not found')]], 'Tools'));
  const host = str(value['hostArch']); const proc = str(value['processArch']);
  if (host !== null && proc !== null && host !== proc) b.sections.push(kv([['host', text(host)], ['node', text(proc)]], 'Architecture'));
  return b;
};

export const covered: RegExp[] = [
  /^terum-skills /, /^Team .+ \((you are|configured handle) @/, /^  Repository: /, /^  Clone: /, /^  Restore it: /, /^  From the local clone; GitHub access is not checked\.$/,
  /^  Members: \d+/, /^    @\S+ — /, /^    … and \d+ more$/, /^  Your membership: /, /^  Shared skills: \d+/, /^  Evaluated skills: not yet available$/, /^  \S+ may be stale; run /,
  ...[...getStartedLines(undefined), ...getStartedLines('bare')].map((line) => new RegExp(`^${escapeRegExp(line)}$`)),
];
export const renderer: Renderer = { render, covered };
```

- [ ] **Step 4: Implement `update.ts`**

```ts
// src/lib/render/verbs/update.ts
import { board, kv, status, text, textBlock, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, str } from './shared.js';

export const render = (raw: unknown, _ctx: RenderContext): Board => {
  const value = asRecord(raw); const running = str(value['running']); const observation = str(value['observation']);
  const b = board(`terum-skills ${running ?? 'version unknown'}`);
  const tone = observation === 'older' ? 'warn' : observation === 'same' ? 'ok' : 'muted';
  b.headline = observation === 'older' ? `A newer release is advertised: ${str(value['latest']) ?? '?'}` : observation === 'same' ? 'This copy matches the advertised release.' : observation === 'newer' ? 'This copy is ahead of the advertised release.' : 'No release advertisement is known.';
  b.sections.push(kv([['latest', status(tone, str(value['latest']) ?? 'unknown')], ['observation', text(observation)], ['launch', text(value['launch'])]]));
  const description = str(value['description']); if (description !== null && description !== '') b.sections.push(textBlock(description.split('\n'), { title: 'Release check' }));
  const advice = asArray(value['advice']).map(String); if (advice.length) b.sections.push(textBlock(advice, { title: 'How to update' }));
  const command = advice.find((line) => line.startsWith('  '))?.trim();
  if (command !== undefined) b.next.push({ label: 'Update', raw: command });
  return b;
};
/** Every line `update` prints is in `value.lines`; a line outside it is a note. */
export function uncovered(lines: readonly string[], raw: unknown): string[] { const printed = new Set(asArray(asRecord(raw)['lines']).map(String)); return lines.filter((line) => !printed.has(line)); }
export const renderer: Renderer = { render, covered: [], uncovered };
```

- [ ] **Step 5: Implement `sync.ts`**

```ts
// src/lib/render/verbs/sync.ts
import { board, code, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, str, nextListSkills } from './shared.js';

const TONE = { refreshed: 'ok', fresh: 'muted', busy: 'pending', unreachable: 'bad', 'no-clone': 'warn', error: 'bad' } as const; // `fresh`: hook mode left a clone fetched within the hour alone (PR #206)
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const teams = asArray(value['teams']).map(asRecord);
  const b = board('Sync', { headline: teams.length === 0 ? 'No team configured.' : bool(value['changed']) ? 'The read verbs see new commits.' : 'Nothing changed.' });
  b.sections.push(table([{ key: 'team', label: 'Team', priority: 1 }, { key: 'state', label: 'State', priority: 1 }, { key: 'changed', label: 'Changed', priority: 2 }, { key: 'head', label: 'HEAD', priority: 3 }, { key: 'detail', label: 'Detail', priority: 2 }],
    teams.map((t) => { const state = str(t['state']) ?? 'error'; return { team: text(t['team']), state: status(TONE[state as keyof typeof TONE] ?? 'bad', state), changed: text(bool(t['changed']) ? 'yes' : 'no'), head: code(str(t['head'])?.slice(0, 12)), detail: text(str(t['detail']) ?? str(t['summary'])) }; }), { cap: ctx.rows }));
  for (const t of teams) {
    const ownerRepo = str(asRecord(asArray(t['successors'])[0])['ownerRepo']);
    if (ownerRepo !== null) b.next.push({ label: 'Follow the move', verb: 'team move', args: [ownerRepo] });
  }
  b.notes.push(...asArray(value['notices']).map(String));
  if (b.next.length === 0) b.next.push(nextListSkills());
  return b;
};
export const covered: RegExp[] = [/^\S+: not refreshed \(/, /^To follow it, run /];
export const renderer: Renderer = { render, covered };
```
(The `summary` line is free text and stays a note — it is also the Detail cell when `detail` is absent; that duplication is acceptable and the snapshot shows it.) Register all three in `verbs/index.ts`: `{ ls, status, update, sync }`.

- [ ] **Step 6: Run the snapshot test, review the new files by eye, commit**

Run: `npx vitest run src/lib/render/__tests__/boards.test.ts && npm run lint && npm run typecheck`
Expected: PASS; `team.status.md.txt` shows the stale synced line, the Pending table with `install 33333333`, two placements, the Identity and Tools sections, the Architecture section (arm64 vs x64), and Next `/terum-skills install 33333333-…` then `/sync-skills`; `empty.status.md.txt` shows the three get-started lines and Next `setup`.

```bash
git add src/lib/render/verbs/status.ts src/lib/render/verbs/update.ts src/lib/render/verbs/sync.ts src/lib/render/verbs/index.ts src/lib/render/__tests__/boards.test.ts src/lib/render/__tests__/__snapshots__
git commit -m "feat(render): status, update and sync boards (§7)"
```

---

### Task 15: `search`, `eval-report`, `eval` renderers

**Files:**
- Create: `src/lib/render/verbs/search.ts`, `src/lib/render/verbs/eval-report.ts`, `src/lib/render/verbs/eval.ts`
- Modify: `src/lib/render/verbs/index.ts`
- Test: `src/lib/render/__tests__/boards.test.ts`

**Interfaces:**
- Consumes: `SearchHit[]` (`search.ts:16-24`), `EvalReport` (`evalReport.ts:20-33`), `EvalResult`/`EvalQueueResult` (Task 10), `receiptSections`/`receiptHeadline`/`skillsTable` (Task 13).

- [ ] **Step 1: Write the failing tests** — append to `boards.test.ts`:

```ts
import { run as search } from '../../../commands/search.js';
import { run as evalReport } from '../../../commands/evalReport.js';
import { dashboardReceipt, DASHBOARD_IDS } from '../../__tests__/fixtures.js';

describe('search, eval-report, eval boards', () => {
  for (const backend of Object.keys(BACKENDS)) {
    it(`team.search (${backend})`, async () => {
      const f = await fixture();
      await expect(await boardOf('search', ['search', 'deploy', '--category', 'ops'], backend, (io) => search({ term: 'deploy', category: 'ops', config: f.store, runner: f.runner, now: () => DASHBOARD_NOW }, io), f)).toMatchFileSnapshot(snapshot('team.search', backend));
      await expect(await boardOf('search', ['search', 'zzz'], backend, (io) => search({ term: 'zzz', config: f.store, runner: f.runner, now: () => DASHBOARD_NOW }, io), f)).toMatchFileSnapshot(snapshot('team.search-none', backend));
    });
    it.each([['team.eval-report', 'deploy-check'], ['team.eval-report-fallback', 'tdd'], ['team.eval-report-invalid', 'diagnose']])('%s (' + backend + ')', async (name, ref) => {
      const f = await fixture();
      await expect(await boardOf('eval-report', ['eval-report', ref], backend, (io) => evalReport({ ref, config: f.store, runner: f.runner, home: f.home }, io), f)).toMatchFileSnapshot(snapshot(name, backend));
    });
    it(`typed.eval (${backend})`, async () => {
      const receipt = dashboardReceipt({ skill_id: DASHBOARD_IDS.deploy, skill_name: 'deploy-check', version: null, run_id: '20260913T110000Z', content_digest: `sha256:${'a'.repeat(64)}`, w: 4, l: 2, t: 0, timestamp: '2026-09-13T11:00:00Z' });
      const aggregate = { verdict: receipt.verdict, attribution: receipt.attribution, execution_status: receipt.execution_status, expected_rows: receipt.expected_rows, scored_rows: receipt.scored_rows, comparisons: receipt.comparisons, arm_scores: receipt.arm_scores, efficiency: receipt.efficiency, environment_skips: { audit: ['docker'] } };
      const triggers = { kind: 'triggers', skill: 'deploy-check', rows: [{ prompt: 'ship it', expected: true, fired: false, selected: [], correct: false }], recall: 0.8, precision: 1, tp: 4, fn: 1, fp: 0, tn: 5 };
      const lines = ['warning HYG6 SKILL.md: description is long', 'verdict: PASS', 'why: The candidate answered every case with the checklist; the baseline skipped the rollback step twice.', 'skipped (environment): audit — missing docker', 'candidate-vs-baseline: 4W 2L 0T', 'arm scores: candidate 0.80 · baseline 0.50', 'triggers: recall=0.80 precision=1.00 (tp=4 fn=1 fp=0 tn=5)', '  MISS: "ship it"', 'efficiency: candidate 6.5 turns · 30.0s · $0.40 | baseline 5.0 turns · 20.0s · $0.30', 'Published this receipt to acme for Version 2 of deploy-check.'];
      const value = { team: 'acme', id: DASHBOARD_IDS.deploy, name: 'deploy-check', runDir: '/home/seed/.terum/skills/evals/local/aaaa/20260913T110000Z', ccVersion: '2.1.0', executionStatus: 'complete', receiptPath: '/home/seed/.terum/skills/evals/local/aaaa/20260913T110000Z/receipt.json', report: { aggregate, triggers }, publishedTo: 'v2' };
      await expect(await typed('eval', ['eval', 'deploy-check'], backend, { ok: true, value, exitCode: 0 }, lines)).toMatchFileSnapshot(snapshot('typed.eval', backend));
      await expect(await typed('eval', ['eval', 'deploy-check'], backend, { ok: true, value: { ...value, executionStatus: 'partial', publishedTo: undefined, shareHint: true, report: { aggregate: { ...aggregate, execution_status: 'partial', scored_rows: 4, expected_rows: 6 }, triggers: null } }, exitCode: 0 }, ['verdict: PASS [partial — 4/6 scored]', 'The eval is complete and saved locally, but publishing its receipt failed: origin refused the push'])).toMatchFileSnapshot(snapshot('typed.eval-partial', backend));
      await expect(await typed('eval', ['eval', 'deploy-check'], backend, { ok: true, value: { alreadyEvaluated: true, team: 'acme', id: DASHBOARD_IDS.deploy, name: 'deploy-check', runDir: '', ccVersion: '2.1.0', executionStatus: 'complete' }, exitCode: 0 }, ['Already evaluated these exact bytes of deploy-check.'])).toMatchFileSnapshot(snapshot('typed.eval-already', backend));
      const item = (skill: string, lastError?: string) => ({ skill, path: `/home/seed/.claude/skills/${skill}`, contentHash: `sha256:${'b'.repeat(64)}`, requestedAt: '2026-09-12T22:00:00Z', window: 'overnight', team: 'acme', ...(lastError === undefined ? {} : { lastError }) });
      await expect(await typed('eval', ['eval', '--queue-list'], backend, { ok: true, value: { items: [item('tdd'), item('notes', 'not signed in')] }, exitCode: 0 }, [`acme/tdd@sha256:${'b'.repeat(64)} · overnight · 2026-09-12T22:00:00Z`, `acme/notes@sha256:${'b'.repeat(64)} · overnight · 2026-09-12T22:00:00Z · not signed in`])).toMatchFileSnapshot(snapshot('typed.eval-queue', backend));
      await expect(await typed('eval', ['eval', '--drain'], backend, { ok: false, error: '1 queued evals failed; they remain queued.', value: { items: [item('notes', 'probe failed')], attempted: 2, completed: 1, failures: [{ item: item('notes'), error: 'probe failed' }], outcomes: [{ skill: 'tdd', team: 'acme', ok: true }, { skill: 'notes', team: 'acme', ok: false, error: 'probe failed' }] }, exitCode: 1 }, ['Evaluating 2 skills, 4 at a time…', '── tdd ──', 'verdict: PASS', '✓ tdd', '✗ notes: probe failed', 'Evaluated 1 of 2; 1 failed.'])).toMatchFileSnapshot(snapshot('typed.eval-drain', backend));
    });
  }
});
```

- [ ] **Step 2: Run to see the fallbacks, delete the written snapshots.**

- [ ] **Step 3: Implement `search.ts`**

```ts
// src/lib/render/verbs/search.ts
import { board, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, nextInstall, nextSkillInfo, skillsTable, str } from './shared.js';

/** The term and the active filters, read from the verb's own argv (`search <term> [--category x] [--author y] [--project z]`). */
function describe(argv: readonly string[]): string {
  const term = argv[1] ?? '';
  const filters: string[] = [];
  for (const flag of ['category', 'author', 'project']) { const at = argv.indexOf(`--${flag}`); if (at !== -1 && argv[at + 1] !== undefined) filters.push(`${flag} ${argv[at + 1]}`); }
  return `Search "${term}"${filters.length ? ` · ${filters.join(' · ')}` : ''}`;
}
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const hits = asArray(raw).map(asRecord);
  const teams = new Set(hits.map((h) => str(h['team'])));
  const b = board(describe(ctx.argv), { headline: hits.length === 0 ? 'No skills found.' : `${hits.length} hit${hits.length === 1 ? '' : 's'}` });
  if (hits.length) b.sections.push(skillsTable(hits.map((h) => ({ id: str(h['id']), name: str(h['name']) ?? '—', description: h['description'], author: h['author'], category: h['category'], latest: h['latest'], installs: h['installs'], updated: h['updated'], team: h['team'] })), ctx, { eval: false, team: teams.size > 1 }));
  const first = str(hits[0]?.['name']); if (first !== null) b.next.push(nextSkillInfo(first), nextInstall(first));
  return b;
};
export const covered: RegExp[] = [/^\S+:$/, /^  .+ — .+; \d+ installs; /, /^\S+ may be stale; run /, /^No skills found\.$/];
export const renderer: Renderer = { render, covered };
```

- [ ] **Step 4: Implement `eval-report.ts`**

```ts
// src/lib/render/verbs/eval-report.ts
import { board, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import { historyOrder, liftPercent, liftText, localRunsOrder } from '../policies.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, num, receiptHeadline, receiptSections, receiptVerdict, str, versionText, nextEval } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const skill = asRecord(value['skill']); const name = str(skill['name']) ?? '—';
  const versions = asRecord(value['versions']); const latest = value['latest']; const latestState = str(value['latestState']); const fallbackFrom = str(value['fallbackFrom']);
  const b = board(`Eval report — ${name}`);
  b.sections.push(kv([['placed', text(versionText(versions['placed']))], ['team current', text(versionText(versions['teamCurrent']))], ['evaluated', text(versionText(versions['evaluated']))], ['id', text(skill['id'])]]));
  if (fallbackFrom !== null) b.notes.push(`The receipt shown comes from ${versionText(fallbackFrom)}; the current version has none.`);
  if (latestState === 'invalid') b.notes.push('The newest receipt at the current version is invalid; older receipts are listed in history only.');
  if (latest !== null && latest !== undefined) {
    b.headline = receiptHeadline(latest, ctx);
    b.sections.push(...receiptSections(latest, asRecord(latest)['triggers'], ctx));
  } else b.headline = latestState === 'invalid' ? '⚠ invalid receipt' : '— not evaluated at the current version';
  const history = asArray(value['history']).map(asRecord).sort((a, c) => historyOrder({ version: str(a['version']) ?? '—', run_id: str(a['run_id']) ?? '' }, { version: str(c['version']) ?? '—', run_id: str(c['run_id']) ?? '' }));
  if (history.length) b.sections.push(table([{ key: 'version', label: 'Version', priority: 1 }, { key: 'run', label: 'Run', priority: 2 }, { key: 'verdict', label: 'Verdict', priority: 1 }, { key: 'lift', label: 'Lift', priority: 1 }, { key: 'wlt', label: 'W/L/T', priority: 2 }, { key: 'model', label: 'Model', priority: 3 }, { key: 'runner', label: 'Runner', priority: 3 }, { key: 'when', label: 'When', priority: 3 }],
    history.map((h) => { const c = asRecord(h['comparison']); const w = num(c['win']), l = num(c['loss']), t = num(c['tie']); const lift = w === null || l === null || t === null ? null : liftPercent(w, l, t); return { version: text(versionText(h['version'])), run: text(h['run_id']), verdict: receiptVerdict({ verdict: h['verdict'], execution_status: h['execution_status'], comparisons: {} }), lift: text(liftText(lift)), wlt: text(w === null ? null : `${w}/${l}/${t}`), model: text(h['model']), runner: text(str(h['runner_handle']) === null ? null : `@${h['runner_handle']}`), when: { kind: 'date', iso: str(h['timestamp']) } }; }), { title: 'History', cap: ctx.rows }));
  const localRuns = asArray(value['localRuns']).map(asRecord).sort((a, c) => localRunsOrder({ run_id: str(a['run_id']) ?? '' }, { run_id: str(c['run_id']) ?? '' }));
  if (localRuns.length) b.sections.push(table([{ key: 'run', label: 'Run', priority: 1 }, { key: 'status', label: 'Status', priority: 1 }, { key: 'committed', label: 'Committed', priority: 2 }, { key: 'verdict', label: 'Verdict', priority: 1 }, { key: 'dir', label: 'Run dir', priority: 3 }],
    localRuns.map((r) => ({ run: text(r['run_id']), status: status(r['execution_status'] === 'complete' ? 'ok' : r['execution_status'] === 'unknown' ? 'muted' : 'warn', r['execution_status']), committed: text(bool(r['committed']) ? 'yes' : 'no'), verdict: receiptVerdict(r['receipt']), dir: path(r['run_dir']) })), { title: 'Local runs', cap: ctx.rows }));
  b.next.push(nextEval(name, '--k', '3'), { label: 'Publish', verb: 'publish', args: [name] });
  return b;
};
export const renderer: Renderer = { render, covered: [] };
```

- [ ] **Step 5: Implement `eval.ts`**

```ts
// src/lib/render/verbs/eval.ts
import { board, code, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, num, receiptHeadline, receiptSections, str, versionText, nextEvalReport } from './shared.js';

function queueTable(items: Record<string, unknown>[], ctx: RenderContext, title: string) {
  return table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'team', label: 'Team', priority: 2 }, { key: 'digest', label: 'Digest', priority: 3 }, { key: 'window', label: 'Window', priority: 2 }, { key: 'queued', label: 'Queued', priority: 2 }, { key: 'error', label: 'Last error', priority: 1 }],
    items.map((i) => ({ skill: text(i['skill']), team: text(i['team']), digest: code(str(i['contentHash'])?.replace(/^sha256:/, '').slice(0, 12)), window: text(i['window']), queued: { kind: 'date', iso: str(i['requestedAt']) }, error: text(i['lastError']) })), { title, cap: ctx.rows });
}
function queue(value: Record<string, unknown>, ctx: RenderContext): Board {
  const items = asArray(value['items']).map(asRecord); const outcomes = asArray(value['outcomes']).map(asRecord);
  if (num(value['attempted']) === null) { const b = board('Eval queue', { headline: items.length === 0 ? 'No queued evals.' : `${items.length} queued` }); if (items.length) b.sections.push(queueTable(items, ctx, 'Queued')); b.next.push({ label: 'Drain', skill: 'eval', verb: 'eval', args: ['--drain'] }); return b; }
  const ok = outcomes.filter((o) => bool(o['ok'])).length;
  const b = board('Eval queue — drain', { headline: `Evaluated ${ok} of ${outcomes.length}; ${outcomes.length - ok} failed.` });
  if (outcomes.length) b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'outcome', label: 'Outcome', priority: 1 }, { key: 'detail', label: 'Detail', priority: 2 }], outcomes.map((o) => ({ skill: text(str(o['team']) === null ? str(o['skill']) : `${o['team']}/${o['skill']}`), outcome: status(bool(o['ok']) ? 'ok' : 'bad', bool(o['ok']) ? 'ok' : 'failed'), detail: text(o['error']) })), { title: 'Outcomes' }));
  if (items.length) b.sections.push(queueTable(items, ctx, 'Still queued'));
  const first = outcomes.find((o) => bool(o['ok'])); if (first) b.next.push(nextEvalReport(str(first['skill']) ?? ''));
  if (items.length) b.next.push({ label: 'Drain again', skill: 'eval', verb: 'eval', args: ['--drain'] });
  return b;
}
/** `runMany` (PR #206): several skills, `--batch`, `--window`, `--pending` — `EvalManyResult { mode: 'ran' | 'queued', team, skills, ok, failed, queued, stoppedAfter? }`. */
function many(value: Record<string, unknown>, ctx: RenderContext): Board {
  const skills = asArray(value['skills']).map(String); const queued = asArray(value['queued']).map(asRecord);
  const ok = num(value['ok']) ?? 0, failed = num(value['failed']) ?? 0, stopped = num(value['stoppedAfter']);
  const b = board(str(value['mode']) === 'queued' ? 'Eval — queued' : 'Eval — batch', { headline: str(value['mode']) === 'queued' ? `Queued ${queued.length} of ${skills.length}; nothing was run.` : `Evaluated ${ok + failed} of ${skills.length}; ${failed} failed.` });
  if (skills.length) b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }], skills.map((skill) => ({ skill: text(skill) })), { title: 'Requested', cap: ctx.rows }));
  if (queued.length) b.sections.push(queueTable(queued, ctx, 'Queued'));
  if (stopped !== null) b.notes.push(`Stopped after ${stopped} of ${skills.length}: a declined "Continue?" queued the rest for later.`);
  if (queued.length) b.next.push({ label: 'Drain the queue', skill: 'eval', verb: 'eval', args: ['--drain'] });
  for (const skill of skills.slice(0, 3)) b.next.push(nextEvalReport(skill));
  return b;
}
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  if (Array.isArray(value['items'])) return queue(value, ctx);
  if (str(value['mode']) !== null) return many(value, ctx);
  const name = str(value['name']) ?? '—';
  if (bool(value['alreadyEvaluated'])) { const b = board(`Eval — ${name}`, { headline: 'Already evaluated these exact bytes; nothing was run.' }); b.next.push(nextEvalReport(name)); return b; }
  const report = asRecord(value['report']); const aggregate = report['aggregate']; const b = board(`Eval — ${name}`);
  b.headline = aggregate === undefined ? `${str(value['executionStatus']) ?? '—'}` : receiptHeadline({ ...asRecord(aggregate), provenance: {} }, ctx);
  const why = str(asRecord(aggregate)['attribution']); if (why !== null && why !== '') b.sections.push({ kind: 'text', title: 'Why', lines: [why] });
  const skips = Object.entries(asRecord(asRecord(aggregate)['environment_skips'])); if (skips.length) b.sections.push({ kind: 'text', title: 'Skipped (environment)', lines: skips.map(([c, missing]) => `${c} — missing ${asArray(missing).join(', ')}`) });
  if (aggregate !== undefined) b.sections.push(...receiptSections(aggregate, report['triggers'], ctx));
  const published = str(value['publishedTo']);
  b.sections.push(kv([['run dir', path(value['runDir'])], ['receipt', path(value['receiptPath'])], ['claude code', text(value['ccVersion'])], ['execution', status(value['executionStatus'] === 'complete' ? 'ok' : 'warn', value['executionStatus'])], ['team', text(value['team'])], ['published to', text(published === null ? null : `${str(value['team']) ?? '?'} (${versionText(published)})`)]], 'Run'));
  if (bool(value['shareHint'])) b.next.push({ label: 'Publish', verb: 'publish', args: [name] });
  b.next.push(nextEvalReport(name));
  return b;
};
export const covered: RegExp[] = [
  /^verdict: /, /^why: /, /^skipped \(environment\): /, /^[\w-]+-vs-[\w-]+: /, /^arm scores: /, /^triggers: recall=/, /^  (MISS|FALSE-FIRE): /, /^efficiency: /, /^Published this receipt to /, /^Already evaluated these exact bytes of /,
  /^No queued evals\.$/, /^(\S+\/)?\S+@sha256:[0-9a-f]{64} · /, /^Evaluating \d+ skills?, \d+ at a time…$/, /^Evaluated \d+ of \d+; \d+ failed\.$/, /^Queued \d+ for (overnight|later): /, /^── .+ ──$/, /^[✓✗] /,
];
export const renderer: Renderer = { render, covered };
```
Register `search`, `'eval-report'`, `eval` in `verbs/index.ts`.

- [ ] **Step 6: Run, review the snapshots by eye, commit**

Run: `npx vitest run src/lib/render/__tests__/boards.test.ts && npm run lint && npm run typecheck`
Check: `team.eval-report.md.txt` headline `● NEUTRAL ±0% · 2W 2L 2T (n=6) · p=0.031 · partial 6/8 · sonnet k=1 · @seed · 8d ago`, a History table of two rows (Version 2 above Version 1), Local runs with the FAIL run; `team.eval-report-fallback.md.txt` notes `The receipt shown comes from Version 1…`; `team.eval-report-invalid.md.txt` carries the warning as a note and `⚠ invalid receipt`; `typed.eval.md.txt` has no `verdict:`/`why:` lines in Notes (all covered) but keeps `warning HYG6 …`; `typed.eval-drain.md.txt` ends with `> ❌ 1 queued evals failed; they remain queued. (partial result above)` and its Notes hold `verdict: PASS` from the buffered sub-run (a sub-run line inside the batch framing is not this board's own report — acceptable, and pinned).

```bash
git add src/lib/render/verbs/search.ts src/lib/render/verbs/eval-report.ts src/lib/render/verbs/eval.ts src/lib/render/verbs/index.ts src/lib/render/__tests__/boards.test.ts src/lib/render/__tests__/__snapshots__
git commit -m "feat(render): search, eval-report and eval boards, queue modes included (§7)"
```

---
### Task 16: `validate`, `install`, `uninstall-skill`, `project` renderers; registry exhaustiveness and null-safety

**Files:**
- Create: `src/lib/render/verbs/validate.ts`, `src/lib/render/verbs/install.ts`, `src/lib/render/verbs/uninstall-skill.ts`, `src/lib/render/verbs/project.ts`
- Modify: `src/lib/render/verbs/index.ts`, `src/lib/render/__tests__/registry.test.ts`, `src/lib/render/__tests__/boards.test.ts`

**Interfaces:**
- Consumes: `ValidateResult` (Task 11), `InstalledResult[]` (`install.ts:45`), `UninstalledResult[]` (`uninstall.ts:20`), `ProjectResult` (`project.ts:16-17`: `{ path, label, added } | { path, placementsRemaining } | { projects: ProjectRow[] }`, no discriminant — narrow by key presence).

- [ ] **Step 1: Write the failing tests**

Append to `boards.test.ts`:
```ts
describe('validate, install, uninstall-skill, project boards and fallbacks', () => {
  for (const backend of Object.keys(BACKENDS)) {
    it(`typed.validate (${backend})`, async () => {
      await expect(await typed('validate', ['validate', 'deploy-check'], backend, { ok: true, value: { name: 'deploy-check', findings: 0, warnings: 1, repairable: 0, directory: '/home/seed/.claude/skills/deploy-check' }, exitCode: 0 }, ['warning HYG6 SKILL.md: description is over 20,000 characters', 'deploy-check: hygiene passed (1 warning).'])).toMatchFileSnapshot(snapshot('typed.validate', backend));
      await expect(await typed('validate', ['validate', 'notes'], backend, { ok: false, error: 'Hygiene failed for notes:\nHYG1 SKILL.md:2: description must be quoted\nHYG4 bin/run.sh: executable', value: { name: 'notes', findings: 2, warnings: 0, repairable: 1, directory: '/home/seed/.claude/skills/notes' }, exitCode: 1 }, ['HYG1 SKILL.md:2: description must be quoted', 'HYG4 bin/run.sh: executable'])).toMatchFileSnapshot(snapshot('typed.validate-fail', backend));
    });
    it(`typed.install and uninstall (${backend})`, async () => {
      await expect(await typed('install', ['install', 'deploy-check'], backend, { ok: true, value: [{ id: DASHBOARD_IDS.deploy, team: 'acme', path: '/home/seed/.claude/skills/deploy-check', version: 'v2', profiled: false }], exitCode: 0 }, ['Your copy is kept at /home/seed/.claude/old-skills/deploy-check.'])).toMatchFileSnapshot(snapshot('typed.install', backend));
      await expect(await typed('install', ['install', 'deploy-check'], backend, { ok: false, error: 'Install deploy-check to ~/.claude/skills? (not interactive)', cancelled: true, exitCode: 1 }, [])).toMatchFileSnapshot(snapshot('typed.install-declined', backend));
      await expect(await typed('uninstall-skill', ['uninstall-skill', 'deploy-check'], backend, { ok: true, value: [{ id: DASHBOARD_IDS.deploy, team: 'acme', removed: 1 }], exitCode: 0 }, ['Your profile is unchanged.'])).toMatchFileSnapshot(snapshot('typed.uninstall-skill', backend));
    });
    it(`typed.project (${backend})`, async () => {
      await expect(await typed('project list', ['project', 'list'], backend, { ok: true, value: { projects: [{ path: '/home/seed/work/terum', label: 'terum', rootState: 'scanned', skillFolders: 2 }, { path: '/home/seed/work/gone', label: 'gone', rootState: 'absent', skillFolders: 0 }] }, exitCode: 0 }, ['terum — /home/seed/work/terum; scanned; 2 skill folders', 'gone — /home/seed/work/gone; absent; 0 skill folders'])).toMatchFileSnapshot(snapshot('typed.project-list', backend));
      await expect(await typed('project add', ['project', 'add', '/home/seed/work/terum'], backend, { ok: true, value: { path: '/home/seed/work/terum', label: 'terum', added: true }, exitCode: 0 }, ['Added /home/seed/work/terum to your library.'])).toMatchFileSnapshot(snapshot('typed.project-add', backend));
      await expect(await typed('project remove', ['project', 'remove', '/home/seed/work/terum'], backend, { ok: true, value: { path: '/home/seed/work/terum', placementsRemaining: 1 }, exitCode: 0 }, ['Removed /home/seed/work/terum from your library.', '1 placements recorded under /home/seed/work/terum stay in the ledger; uninstall-skill removes them.'])).toMatchFileSnapshot(snapshot('typed.project-remove', backend));
    });
    it(`typed.fallback (${backend})`, async () => {
      await expect(await typed('publish', ['publish', 'notes'], backend, { ok: true, value: { kind: 'published', version: 'v1' }, exitCode: 0 }, ['Published notes as Version 1.', 'Category: misc (fallback).'])).toMatchFileSnapshot(snapshot('typed.fallback-publish', backend));
      await expect(await typed('prune', ['prune'], backend, { ok: false, error: 'Delete 2 quarantined items? (not interactive)', cancelled: true, exitCode: 1 }, ['quarantine/notes-2026-09-01'])).toMatchFileSnapshot(snapshot('typed.fallback-declined', backend));
    });
  }
});
```

Replace the registry test's second case and add the null-safety case (`registry.test.ts`):
```ts
  it('every rendered verb has a renderer, and only those', () => {
    expect(Object.keys(REGISTRY).sort()).toEqual([...RENDERED_VERBS].sort());
  });
  it('no renderer throws on a missing, null or wrongly-shaped value (§12)', () => {
    const shapes: unknown[] = [undefined, null, {}, [], 'text', 42, { local: null, skills: null, selection: { kind: 'skill' } }, { selection: { kind: 'member' }, member: null }, { items: null }, { report: { aggregate: null } }, { teams: [{}], ledger: null }, { projects: [null] }, [{}], [null]];
    for (const [verb, renderer] of Object.entries(REGISTRY)) for (const shape of shapes) {
      const b = renderer.render(shape, CTX);
      expect(typeof b.title, `${verb} on ${JSON.stringify(shape)}`).toBe('string');
      expect(Array.isArray(b.sections) && Array.isArray(b.next) && Array.isArray(b.notes)).toBe(true);
      if (renderer.uncovered) expect(renderer.uncovered(['a line'], shape)).toEqual(expect.any(Array));
    }
  });
```

- [ ] **Step 2: Run; see the fallbacks and the failing exhaustiveness case; delete the written snapshots.**

- [ ] **Step 3: Implement the four renderers**

```ts
// src/lib/render/verbs/validate.ts
import { board, kv, path, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asRecord, num, str } from './shared.js';

export const render = (raw: unknown, _ctx: RenderContext): Board => {
  const value = asRecord(raw); const name = str(value['name']) ?? '—';
  const findings = num(value['findings']) ?? 0, warnings = num(value['warnings']) ?? 0, repairable = num(value['repairable']) ?? 0;
  const b = board(`Validate — ${name}`, { headline: findings === 0 && warnings === 0 ? 'No findings.' : `${findings} finding${findings === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${repairable} repairable` });
  b.sections.push(kv([['folder', path(value['directory'])], ['findings', text(findings)], ['warnings', text(warnings)], ['repairable', text(repairable)]]));
  const directory = str(value['directory']);
  if (repairable > 0 && directory !== null) b.next.push({ label: 'Fix', verb: 'skill fix', args: [directory] });
  if (findings === 0) b.next.push({ label: 'Publish', verb: 'publish', args: [name] });
  return b;
};
/** Only the pass line is the board's; every finding and warning line is a note, verbatim (§7). */
export const covered: RegExp[] = [/^\S+: hygiene passed( \(\d+ warnings?\))?\.$/];
export const renderer: Renderer = { render, covered };
```
```ts
// src/lib/render/verbs/install.ts
import { board, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, str, versionText, nextListSkills } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const rows = asArray(raw).map(asRecord);
  const b = board('Install', { headline: rows.length === 0 ? 'Nothing installed.' : `${rows.length} skill${rows.length === 1 ? '' : 's'} placed` });
  if (rows.length) b.sections.push(table([{ key: 'id', label: 'Id', priority: 2 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'path', label: 'Path', priority: 1 }, { key: 'team', label: 'Team', priority: 3 }, { key: 'profiled', label: 'Profiled', priority: 2 }],
    rows.map((r) => ({ id: text(str(r['id'])?.slice(0, 8)), version: text(versionText(r['version'])), path: path(r['path']), team: text(r['team']), profiled: status(bool(r['profiled']) ? 'ok' : 'muted', bool(r['profiled']) ? 'yes' : 'no') })), { cap: ctx.rows }));
  b.next.push(nextListSkills(true));
  return b;
};
export const renderer: Renderer = { render, covered: [] };
```
```ts
// src/lib/render/verbs/uninstall-skill.ts
import { board, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, num, str, nextListSkills } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const rows = asArray(raw).map(asRecord);
  const removed = rows.reduce((sum, r) => sum + (num(r['removed']) ?? 0), 0);
  const b = board('Uninstall', { headline: rows.length === 0 ? 'Nothing was placed on this machine.' : `${removed} folder${removed === 1 ? '' : 's'} removed` });
  if (rows.length) b.sections.push(table([{ key: 'id', label: 'Id', priority: 1 }, { key: 'team', label: 'Team', priority: 2 }, { key: 'removed', label: 'Removed', priority: 1, align: 'right' }], rows.map((r) => ({ id: text(str(r['id'])?.slice(0, 8)), team: text(r['team']), removed: { kind: 'count', n: num(r['removed']) } })), { cap: ctx.rows }));
  b.next.push(nextListSkills(true));
  return b;
};
export const renderer: Renderer = { render, covered: [] };
```
```ts
// src/lib/render/verbs/project.ts
import { board, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, num, str, nextListSkills, nextProjectAdd } from './shared.js';

/** `project list | add | remove` share one renderer: the value has no discriminant, so the keys decide. */
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  if (Array.isArray(value['projects'])) {
    const rows = value['projects'].map(asRecord);
    const b = board('Library projects', { headline: rows.length === 0 ? 'none' : `${rows.length} project${rows.length === 1 ? '' : 's'}` });
    if (rows.length) b.sections.push(table([{ key: 'label', label: 'Label', priority: 1 }, { key: 'path', label: 'Path', priority: 1 }, { key: 'state', label: 'State', priority: 1 }, { key: 'folders', label: 'Skill folders', priority: 2, align: 'right' }],
      rows.map((r) => { const state = str(r['rootState']) ?? '—'; return { label: text(r['label']), path: path(r['path']), state: status(state === 'scanned' ? 'ok' : state === 'absent' ? 'bad' : 'warn', state), folders: { kind: 'count', n: num(r['skillFolders']) } }; }), { cap: ctx.rows }));
    b.next.push(nextProjectAdd, nextListSkills(true));
    return b;
  }
  if ('placementsRemaining' in value) {
    const remaining = num(value['placementsRemaining']) ?? 0;
    const b = board('Project removed', { headline: `Removed ${str(value['path']) ?? '—'} from your library.` });
    b.sections.push(kv([['path', path(value['path'])], ['placements still recorded', text(remaining)]]));
    if (remaining > 0) { b.notes.push(`${remaining} placement${remaining === 1 ? '' : 's'} recorded under it stay in the ledger; uninstall-skill removes them.`); b.next.push({ label: 'Remove placements', verb: 'uninstall-skill', args: ['<ref>'] }); }
    b.next.push({ label: 'Projects', verb: 'project list', args: [] });
    return b;
  }
  const added = bool(value['added']);
  const b = board(added ? 'Project added' : 'Project already in your library', { headline: added ? `Added ${str(value['path']) ?? '—'} to your library.` : `${str(value['path']) ?? '—'} is already in your library.` });
  b.sections.push(kv([['path', path(value['path'])], ['label', text(value['label'])]]));
  b.next.push(nextListSkills(true));
  return b;
};
export const covered: RegExp[] = [/^.+ — .+; (scanned|absent|unreadable); \d+ skill folders$/, /^none$/, /^Added .+ to your library\.$/, /^.+ is already in your library\.$/, /^Removed .+ from your library\.$/, /^\d+ placements recorded under .+ stay in the ledger; uninstall-skill removes them\.$/];
export const renderer: Renderer = { render, covered };
```
`verbs/index.ts` becomes:
```ts
import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';
import { renderer as status } from './status.js';
import { renderer as update } from './update.js';
import { renderer as sync } from './sync.js';
import { renderer as search } from './search.js';
import { renderer as evalReport } from './eval-report.js';
import { renderer as evalRun } from './eval.js';
import { renderer as validate } from './validate.js';
import { renderer as install } from './install.js';
import { renderer as uninstallSkill } from './uninstall-skill.js';
import { renderer as project } from './project.js';
export const VERB_RENDERERS: Record<string, Renderer> = { ls, status, update, sync, search, 'eval-report': evalReport, eval: evalRun, validate, install, 'uninstall-skill': uninstallSkill, 'project list': project, 'project add': project, 'project remove': project };
```
(`uninstall-skill`'s `<ref>` in the project-remove Next is a placeholder the person fills; `quoteArg` keeps it as `"<ref>"` for a host — acceptable and visible in the snapshot.)

- [ ] **Step 4: Run every render test, review the snapshots, commit**

Run: `npx vitest run src/lib/render && npm run lint && npm run typecheck`
Expected: PASS; `typed.validate-fail.md.txt` carries both HYG lines as Notes and the failure block quoting the three-line error; `typed.fallback-publish.md.txt` is a `## publish` fenced block; `typed.fallback-declined.md.txt` ends `> ❌ Delete 2 quarantined items? (not interactive) (declined)`.

```bash
git add src/lib/render/verbs src/lib/render/__tests__
git commit -m "feat(render): validate, install, uninstall-skill and project boards; registry exhaustiveness and null-safety tests"
```

---

### Task 17: wire `--format` into the bin — pre-parser, refusals, board sink, help text; `format-cli` and bin tests

**Files:**
- Modify: `src/index.ts`, `src/cli.ts` (root and per-verb `addHelpText`)
- Create: `src/__tests__/format-cli.test.ts`
- Modify: `src/__tests__/bin.test.ts`, `src/__tests__/cli.test.ts` (help), `src/__tests__/cli-hints.test.ts` (help contains the Output paragraph)

**Interfaces:**
- Consumes: `parseRenderOptions`, `OUTPUT_HELP` (Task 3), `createBoardSink` (Task 7), `colorCapable` (`src/lib/banner.ts`), `invocation`, `attemptedVerb`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/format-cli.test.ts
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliVerbs } from '../cli.js';
import { createExecute } from '../lib/execute.js';
import { FRAME_VERBS } from '../lib/frames.js';
import type { Prompter } from '../lib/prompt.js';
import { RENDERED_VERBS } from '../lib/render/registry.js';
import { createBoardSink } from '../lib/render/sink.js';
import { success } from '../lib/result.js';

/** Mirrors frames-cli.test.ts: every one-shot verb through commander with the board sink in place of the terminal. */
const INVOCATIONS: Record<string, string[]> = {
  'skill move': ['skill', 'move', '/skills/a', '--to', 'global'], 'skill rename': ['skill', 'rename', '/skills/a', '--to', 'b'], 'skill delete': ['skill', 'delete', '/skills/a'], 'skill fix': ['skill', 'fix', '/skills/a'],
  'project add': ['project', 'add'], 'project remove': ['project', 'remove', '/project'], 'project list': ['project', 'list'], 'team project create': ['team', 'project', 'create', 'Payments'],
  'app-update': ['app-update', '--check'], app: ['app'], profile: ['profile', '--role', 'Platform'], login: ['login'], setup: ['setup'], 'team create': ['team', 'create', 'x'], 'team join': ['team', 'join', 'o/r'], 'team remove': ['team', 'remove', 'h'], 'team leave': ['team', 'leave', 'n'], 'team move': ['team', 'move', 'o/r2'], 'team workflow-update': ['team', 'workflow-update'],
  invite: ['invite', 'u'], ls: ['ls'], status: ['status'], publish: ['publish', 'ref'], validate: ['validate', 'x'], eval: ['eval', 'x'], 'eval-report': ['eval-report', 'x'], install: ['install', 'ref'], 'uninstall-skill': ['uninstall-skill', 'ref'], uninstall: ['uninstall'], sync: ['sync'], prune: ['prune'], search: ['search', 't'], update: ['update'],
};
const printing = (async (_args: unknown, io: Prompter) => { io.print('Resolved: x from the working directory'); io.print('hello'); return success({ ok: 1 }); }) as never;
const asking = (async (_args: unknown, io: Prompter) => { io.print('before'); await io.confirm('Proceed?'); return success({ ok: 1 }); }) as never;

function harness(verbs: CliVerbs, format: 'md' | 'pretty' | 'json' = 'md') {
  const written: string[] = []; const stderr: string[] = []; const codes: number[] = [];
  const sink = createBoardSink({ options: { format, formatGiven: true, host: 'claude', rows: 25, width: 100, color: false }, home: '/home/u', now: () => 0, argv: [], command: 'x', write: (text) => written.push(text), stderr: (line) => stderr.push(line), setExitCode: (code) => codes.push(code) });
  const program = buildProgram(createExecute(sink), verbs, { noUpdateCheck: true });
  program.exitOverride();
  return { written, stderr, codes, run: (argv: string[]) => program.parseAsync(['node', 'terum-skills', ...argv]) };
}
const stubs = (verb: unknown): CliVerbs => ({ skill: verb, project: verb, app: verb, profile: verb, login: verb, team: verb, setup: verb, install: verb, uninstall: verb, uninstallMachine: verb, sync: verb, prune: verb, search: verb, invite: verb, ls: verb, status: verb, readme: verb, publish: verb, leave: verb, guardPush: verb, validate: verb, eval: verb, evalReport: verb, update: verb, appUpdate: verb } as CliVerbs);
const ONE_SHOT = FRAME_VERBS.filter((verb) => verb !== 'serve');

describe('board mode through commander — every public verb', () => {
  for (const verb of ONE_SHOT) {
    it(`${verb}: prints become a board, one write, exit 0`, async () => {
      const h = harness(stubs(printing));
      await h.run(INVOCATIONS[verb]!);
      expect(h.written).toHaveLength(1);
      expect(h.written[0]!.startsWith('## ')).toBe(true);
      expect(h.written[0]).toContain('_Resolved: x from the working directory_');
      expect(h.written[0]!.endsWith('\n')).toBe(true);
      expect(RENDERED_VERBS.includes(verb) || h.written[0]!.includes('```\nhello\n```')).toBe(true);
      expect(h.stderr).toEqual([]); expect(h.codes).toEqual([]);
    });
    it(`${verb}: a question is refused as not interactive — failure board, one stderr line, exit 1`, async () => {
      const h = harness(stubs(asking));
      await h.run(INVOCATIONS[verb]!);
      expect(h.codes).toEqual([1]);
      expect(h.stderr).toHaveLength(1); expect(h.stderr[0]).toContain('Proceed?');
      expect(h.written[0]).toContain('> ❌ ');
      expect(h.written[0]).toContain('before');
    });
  }
  it('json mode writes one document per run with every printed line', async () => {
    const h = harness(stubs(printing), 'json');
    await h.run(['status']);
    expect(JSON.parse(h.written[0]!)).toEqual({ verb: 'status', ok: true, exitCode: 0, value: { ok: 1 }, lines: ['Resolved: x from the working directory', 'hello'] });
  });
});
```

`src/__tests__/bin.test.ts` — inside the existing describe, add:
```ts
  it.each([
    [['--format', 'yaml', 'status'], '--format must be one of plain, md, pretty, json, auto.'],
    [['--rows', '5', 'status'], '--rows, --width, --host and --no-color need --format.'],
    [['serve', '--format', 'md'], 'serve answers over --frames; drop --format.'],
    [['sync', '--hook', '--format', 'md'], "sync --hook's stdout is the reload directive; drop --format."],
  ])('refuses %j with one stderr line and exit 1, writing nothing to stdout', async (args, line) => {
    const failed = await run(process.execPath, [bin, ...args], { cwd: out, env }).then(() => { throw new Error('expected failure'); }, (error: { code: number; stdout: string; stderr: string }) => error);
    expect(failed.code).toBe(1); expect(failed.stdout).toBe(''); expect(failed.stderr.trim()).toBe(line);
  });
  it('--frames with --format is one framed refusal', async () => {
    const failed = await framedRun(['--frames', '--format', 'md', 'status']).then(() => { throw new Error('expected failure'); }, (error: { code: number; stdout: string }) => error);
    const frames = failed.stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(frames[0].t).toBe('hello');
    expect(frames.at(-1)).toMatchObject({ t: 'result', verb: 'status', ok: false, error: '--frames is already a machine format; drop --format.', exitCode: 1 });
  });
  it('renders md and json boards for the read verbs against dashboardTeam()', async () => {
    const f = await dashboardTeam({ storeUnderHome: true, localRemote: true });
    const child = { ...env, HOME: f.home, USERPROFILE: f.home, GH_CONFIG_DIR: resolve(f.home, '.config', 'gh') };
    for (const [argv, heading] of [[['status'], '## terum-skills '], [['ls', '--local'], '## Library'], [['ls'], '## Marketplace — acme'], [['ls', 'skill', 'deploy-check'], '## deploy-check — Version 2 (2 versions)'], [['search', 'deploy'], '## Search "deploy"'], [['eval-report', 'tdd'], '## Eval report — tdd'], [['update'], '## terum-skills ']] as const) {
      const md = await run(process.execPath, [bin, ...argv, '--format', 'md'], { cwd: f.home, env: child });
      expect(md.stdout.startsWith(heading), argv.join(' ')).toBe(true);
      expect(md.stdout).not.toMatch(/\x1b/);
      const json = await run(process.execPath, [bin, '--format', 'json', ...argv], { cwd: f.home, env: child });
      expect(JSON.parse(json.stdout)).toMatchObject({ verb: argv[0], ok: true, exitCode: 0 });
    }
    // plain is untouched: the same status bytes as without any flag.
    const plain = await run(process.execPath, [bin, 'status'], { cwd: f.home, env: child });
    const explicit = await run(process.execPath, [bin, 'status', '--format', 'plain'], { cwd: f.home, env: child });
    expect(explicit.stdout).toBe(plain.stdout);
  });
```
(`dashboardTeam` import from `../lib/__tests__/fixtures.js`; `update` under the bin without a network reaches the `Could not check release advertisements` path or the no-team-on-GitHub `nobody` policy — either way the board renders and `ok` is true.)

`src/__tests__/cli.test.ts`: extend the help assertion so `program.outputHelp()` contains `--format <plain|md|pretty|json|auto>`, and for each of `status`, `ls`, `search`, `eval-report`, `eval`, `update`, `sync`, `validate`, `install`, `uninstall-skill` the command's `outputHelp()` contains `Output:` (capture per command as the existing hidden-option test does).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/format-cli.test.ts src/__tests__/cli.test.ts`
Expected: FAIL (help lacks the paragraph; format-cli passes only partially — the harness works already; keep going).

- [ ] **Step 3: `src/cli.ts` help text**

Import `OUTPUT_HELP` from `./lib/render/options.js`. Root: append `OUTPUT_HELP` to the string the existing `program.addHelpText('after', [...].join('\n'))` builds (keep the get-started lines first). Per verb: chain `.addHelpText('after', OUTPUT_HELP)` on `ls` (the parent, and the three subcommands), `status`, `search`, `eval-report`, `eval`, `update`, `sync`, `validate` (append to its existing `after` text: `'\nDeterministic and offline …' + OUTPUT_HELP`), `install`, `uninstall-skill`, and the `project` `list` subcommand.

- [ ] **Step 4: `src/index.ts`**

Imports to add: `import { homedir } from 'node:os';`, `import { colorCapable } from './lib/banner.js';`, `import { invocation } from './lib/invocation.js';`, `import { parseRenderOptions } from './lib/render/options.js';`, `import { createBoardSink } from './lib/render/sink.js';`.

Replace from `const separator = process.argv.indexOf('--');` to the end of the file with:

```ts
const separator = process.argv.indexOf('--');
const prefixEnd = separator === -1 ? process.argv.length : separator;
const frames = process.argv.slice(0, prefixEnd).includes(FRAMES_FLAG);
const withoutFrames = process.argv.filter((argument, index) => index >= prefixEnd || argument !== FRAMES_FLAG);
// D1: the output flags come off argv the same way, before commander. A bad value is one stderr line and exit 1; nothing runs.
const rendered = parseRenderOptions(withoutFrames, process.env, { isTTY: process.stdout.isTTY === true, columns: process.stdout.columns, rows: process.stdout.rows, colorCapable: colorCapable() });
const stderrLine = (line: string) => { process.stderr.write(`${line}\n`); };
if (!rendered.ok) {
  stderrLine(rendered.error);
  process.exitCode = 1;
} else {
const argv = rendered.argv;
const render = rendered.options;
const hookRequested = argv.slice(0, argv.indexOf('--') === -1 ? argv.length : argv.indexOf('--')).includes('--hook');
if (argv[2] === 'serve') {
  if (render.formatGiven) { stderrLine('serve answers over --frames; drop --format.'); process.exitCode = 1; }
  else {
  // A session owns stdin and many results; never attach the one-shot channel/report sink.
  const diagnostic = stderrLine;
  const runSession = async () => {
    process.exitCode = await serve({
      frames, version: packageVersion(), input: process.stdin, output: process.stdout, diagnostic, form,
      onCancel: () => { runShutdownHooks(); process.exit(143); },
      buildProgram: execute => buildProgram(execute, undefined, { launch, form, noUpdateCheck: true }),
    });
  };
  try {
    await buildProgram(async () => undefined, undefined, { launch, form, serve: runSession })
      .configureOutput({ writeOut: diagnostic, writeErr: diagnostic }).parseAsync(argv);
  } catch (error) {
    const failure = frameChannel({ input: process.stdin, output: process.stdout, diagnostic });
    failure.result({ verb: 'serve', ok: false, error: error instanceof Error ? error.message : String(error), exitCode: 1 });
    process.exitCode = 1;
  }
  }
} else if (argv[2] === 'sync' && hookRequested && render.formatGiven) {
  stderrLine("sync --hook's stdout is the reload directive; drop --format.");
  process.exitCode = 1;
} else {
// A verb that never asks (eval) would otherwise keep running after cancel. Exit, never self-signal:
// on Windows process.kill(self) is TerminateProcess, which runs no 'exit' handler, so the clone's
// writer lock would be left behind for up to a minute. process.exit runs the hooks' children-killing
// and then lets signal-exit release every lock this process holds.
const channel = frames ? frameChannel({ onCancel: () => { runShutdownHooks(); process.exit(143); }, input: process.stdin, output: process.stdout, diagnostic: stderrLine }) : undefined;
let reported = false;
const report = (outcome: ResultOutcome) => {
  if (!channel || reported) return;
  reported = true;
  channel.result(outcome);
};
const noUpdateCheck = frames || Boolean(process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.TERUM_SKILLS_NO_UPDATE_NOTIFIER);
const afterVerb = process.stderr.isTTY && !noUpdateCheck
  ? async () => updateNotice({ state: createReleaseState(createConfigStore().root), launch, running: packageVersion(), stderr: stderrLine })
  : undefined;
const setExitCode = (code: number) => { process.exitCode = code; };
// D3: a board run swaps the terminal Prompter for the collecting sink; stderr and the exit code are unchanged.
const board = !frames && render.format !== 'plain';
const verb = argv[2] ?? '';
const execute = createExecute(board
  ? createBoardSink({
    options: render, form, home: homedir(), now: () => Date.now(), argv: argv.slice(2),
    command: invocation(form, verb, ...argv.slice(3).map((argument) => ({ raw: argument })), { raw: `--format ${render.format}` }),
    write: (text) => { process.stdout.write(text); }, stderr: stderrLine, setExitCode,
    progress: render.format === 'pretty' && process.stderr.isTTY ? (line) => { process.stderr.write(`\r\x1b[K${line}`); } : undefined,
    afterVerb,
  })
  : { afterVerb, form, io: channel?.io ?? terminalPrompter({ outputClosed }), stderr: stderrLine, setExitCode, result: channel ? report : undefined });

try {
  if (channel) {
    channel.hello(packageVersion());
    if (render.formatGiven) {
      report({ verb: attemptedVerb(argv.slice(2)), ok: false, error: '--frames is already a machine format; drop --format.', exitCode: 1 });
      process.exitCode = 1;
    } else if (hookRequested) {
      report({ verb: 'sync', ok: false, error: '`sync --hook` is the session hook and is not available over frames; run plain `sync`.', exitCode: 1 });
      process.exitCode = 1;
    } else {
      await buildProgram(execute, undefined, { launch, form, noUpdateCheck, frames: true }).parseAsync(argv);
    }
  } else {
    await buildProgram(execute, undefined, { launch, form, noUpdateCheck }).parseAsync(argv);
  }
} catch (error) {
  // commander's own exits (help, version, usage errors) — it has already printed; keep its code.
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
  // Commander also uses commander.help for missing arguments, with exitCode 1.
  const nonError = error instanceof CommanderError && error.exitCode === 0 && COMMANDER_NON_ERRORS.has(error.code);
  if (channel && !nonError && (!(error instanceof CommanderError) || error.exitCode !== 0)) {
    const verb = attemptedVerb(argv.slice(2));
    const message = error instanceof Error ? error.message : String(error);
    report({ verb, ok: false, error: message === '(outputHelp)' ? `Usage error: ${verb} needs an argument; run it without --frames for the full help.` : message, exitCode: 1 });
  }
}
}
}
```
The terminal branch now calls `parseAsync(argv)` — `argv` equals `process.argv` when no flag was given, so `plain` is byte-identical (the bin test's `explicit.stdout === plain.stdout` and the existing status pin prove it). The `hookRequested` check for `--format` sits outside frames so `sync --hook --format md` is refused whether or not `--frames` was given; the frames branch keeps its own `--hook` refusal first-come as before (`--format` first, then `--hook`, both one result frame).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/__tests__/format-cli.test.ts src/__tests__/cli.test.ts src/__tests__/cli-hints.test.ts src/__tests__/frames-cli.test.ts src/lib/__tests__/invocation-tripwire.test.ts` then, when the load allows, `npx vitest run src/__tests__/bin.test.ts src/__tests__/bundle.test.ts`.
Expected: PASS. The tripwire names the new `src/index.ts` refusal lines containing `terum-skills`? (they do not — `--frames is already…` carries no package literal; the `invocation(form, verb, …)` call is `routed`) — catalogue whatever it lists: the `OUTPUT_HELP` lines in `options.ts` contain no `terum-skills`; if the tripwire flags `src/lib/render/verbs/shared.ts` (no literal) nothing is needed. Add rows only for what the diff shows.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
git add src/index.ts src/cli.ts src/__tests__/format-cli.test.ts src/__tests__/bin.test.ts src/__tests__/cli.test.ts src/__tests__/cli-hints.test.ts src/lib/__tests__/invocation-catalog.ts
git commit -m "feat(cli): --format/--host/--rows/--width/--no-color — the board sink in the bin, three refusals, help text (D1–D3)"
```

---

### Task 18: docs, catalogue, GAPS line, full gates

**Files:**
- Modify: `README.md` (CLI Commands section), `docs/frame-protocol.md`, `desktop/GAPS.md`, `src/lib/__tests__/invocation-catalog.ts`

- [ ] **Step 1: README**

After the paragraph `` `npx -y terum-skills@latest --help` and `npx -y terum-skills@latest <verb> --help` list every option you are expected to use. `` add:

```markdown
**Boards.** Every command above takes `--format <plain|md|pretty|json|auto>` (default `plain`, the output the tables describe). `--format md` renders the result as a Markdown board — the form the shipped Claude Code and Codex skills ask for — `pretty` draws box tables with colour for a terminal, `json` writes one document (`{ verb, ok, exitCode, error?, value?, lines }`), and `auto` picks `pretty` on a TTY and `md` otherwise. `--rows <n|all>` caps table rows (default 25), `--width <n>` sets a pretty board's width, `--host <claude|codex|terminal>` phrases the board's **Next** line, `--no-color` drops ANSI. The flags go anywhere before `--`; they are refused with `--frames`, `serve`, and `sync --hook`, whose stdout is spoken for. `ls skill <name>` shows one skill whole, and `ls skill`, `eval-report` and `validate` accept a unique prefix; `eval` takes an exact or case-insensitive name; each of the four, run inside a skill folder, needs no name at all.
```

- [ ] **Step 2: `docs/frame-protocol.md`**

After the paragraph ending `so a shell that only watches the exit code and stderr still works.` add:
```markdown
`--format` (the Markdown / terminal / JSON boards of `README.md`) and `--frames` are exclusive: a run given both ends in one `result` frame with the error `--frames is already a machine format; drop --format.` and exit 1. `serve` refuses `--format` the same way on stderr.
```
After the line `` Team `ls` includes `people` with automatic `installed` records and curated `profile` entries. `` add:
```markdown
`ls` also carries `viewer: { handle, team }` on every team read and, on `ls member`, `ls project` and `ls skill`, a `selection` (`{ kind: 'member', handle }`, `{ kind: 'project', name }`, `{ kind: 'skill', name, source: 'team' | 'library' }`); `ls skill <name>` is the one-skill read — `skills` holds the team record (or nothing), `local` the Library row (or nothing), `projects` only the lists holding it. `member` gained `displayName`, per-install `name`/`version`, and `profile`; `installedBy` rows gained `version`. Additive; protocol stays 1.
```
In the eval-report section, after the `localRuns` bullet, add:
```markdown
`eval`'s own result (`EvalResult`) gained `report: { aggregate, triggers }` — the numbers `renderReport` prints, as data — and `receiptPath` on a completed run; `eval --drain` gained `outcomes: { skill, team?, ok, error? }[]`, one per attempted item in queue order. `validate` gained `directory`, the folder it checked. Additive; protocol stays 1.
```

- [ ] **Step 3: `desktop/GAPS.md`** — append:

```markdown
## 2026-09-13 — the CLI renders boards; `policies.ts` is the desktop's twin

- `src/lib/render/policies.ts` (a leaf: imports nothing) carries the verdict band, half-even lift, receipt summary, orderings and estimate rules the desktop keeps in `desktop/src/backend/mock/derive.ts`, `receipt-summary.ts` and `score-fractions.ts`, with the desktop's own examples as its tests. Follow-up: import it from the desktop and delete the copies, so a rule changes in one place.
```

- [ ] **Step 4: Catalogue and tripwire**

Run: `npx vitest run src/lib/__tests__/invocation-tripwire.test.ts` — add one row per line it names (README's new paragraph lines with `--format`/`terum-skills`, the frame-protocol lines mentioning `serve`/`ls skill`/`eval --drain`/`validate`), policy `prose`; the README row for `ls [--local]` was updated in Task 9. Re-run until it is green.

- [ ] **Step 5: Full gates**

Run (when the 1-minute load is under 8): `npm run lint && npm run typecheck && npm test`
Expected: all green. Then `git diff --stat main -- desktop/` shows only `desktop/GAPS.md`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/frame-protocol.md desktop/GAPS.md src/lib/__tests__/invocation-catalog.ts
git commit -m "docs: --format boards, ls skill and the additive result fields; policies.ts named as the desktop's twin"
```

Plan 1 ends here. Plan 2 (`2026-09-13-skill-dashboard-2-skills.md`) builds the eight skills and their placement on top of this branch.
