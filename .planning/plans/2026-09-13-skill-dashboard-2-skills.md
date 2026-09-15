# Skill dashboard — Plan 2 of 2: the shipped skills and their placement (`wrapper.ts` × eight skills × two roots, bundle, release, docs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eight managed skills (`list-skills`, `skill-info`, `search-skills`, `eval`, `eval-report`, `skill-status`, `sync-skills`, `terum-skills`) ship inside the npm package, are offered once by `setup` for Claude Code (`~/.claude/skills`) and Codex (`<CODEX_HOME|~/.codex>/skills`), are refreshed by the session hook, removed by machine uninstall, and each runs one `--format md` command from Plan 1 and shows its board.

**Architecture:** `src/lib/wrapper.ts` generalises from one skill × one root to the bundled set × two roots: the set is discovered at runtime from `dist/claude/skills/*/SKILL.md` by the frontmatter marker, states are judged per (skill, root) with `lstat` and never follow links, writes stay atomic, and consent is asked once (a first install) and remembered by the presence of any managed copy. `scripts/bundle-skill.mjs` scans `.claude/skills/*/SKILL.md` and bundles every marked file after validating its frontmatter. The skills are plain Markdown with no host-specific tool names; the CLI autodetects the host (Plan 1 §6.2), so one file serves both roots.

**Tech Stack:** TypeScript ESM (node ≥ 22.12), `yaml`, vitest 4, the existing `scripts/*.mjs` build. No new dependencies.

**Spec:** `.planning/specs/2026-09-13-skill-dashboard.md` (baseline `main` @ `c05d240`), §9 (the skills), §10 (placement), §11 (build and release), §12 (failure modes: `~/.codex` absent, foreign folder, source checkout, Codex sandbox), the placement half of §13, and §14 (docs). **Plan 1 (`.planning/plans/2026-09-13-skill-dashboard-1-render.md`) must be complete first**: this plan's skills invoke `--format md`, `ls skill <name>`, and the boards' **Next:** line; `src/__tests__/skill-prose.test.ts` imports `parseRenderOptions` from `src/lib/render/options.ts` (Plan 1 Task 3).

## Global Constraints

- Worktree: `/home/teniroo/Projects/terum-skills-codex/skill-dashboard`, branch `feat/skill-dashboard`, on top of Plan 1's commits. Never touch the primary checkout (another session owns it). Absolute paths in every shell command; no `cd` (AGENTS.md).
- No new dependencies. No `console`/`process.stdin|stdout|stderr|exit|exitCode` outside `src/lib/prompt.ts` and `src/index.ts` (ESLint `PROMPTER_BOUNDARY`); `process.env`, `process.cwd()`, `process.platform` are allowed; `scripts/*.mjs` are outside `src/` and may use `console.error`/`process.exit` (they do today). Every relative import carries `.js`; `import type` for type-only imports. `noUncheckedIndexedAccess` is on.
- The frontmatter marker is the idempotency key: only a `SKILL.md` whose parsed frontmatter carries `metadata.managed-by: terum-skills` and a string `name` is ever written over or removed. Anything else at a destination — a symlink, a file, a folder without a regular `SKILL.md`, an unmarked `SKILL.md` — is `foreign`: named, never touched. Judged with `lstat`, never following links.
- Writes are atomic: temp file beside the target, `fsync`, `rename`; the temp file is removed on any failure.
- Every shipped skill's frontmatter is exactly `name` (= folder), a **quoted** `description`, and `metadata: { managed-by: terum-skills, short-description: "…" }` — no other top-level key, no other metadata key. The body never names a host-specific tool (`Bash(`, `AskUserQuestion`, `request_user_input`, `run_in_background`), never uses a bare binary, a checkout entry, or `node dist/index.js`, and carries `$ARGUMENTS` exactly once.
- Invocation literals: any new line in `src/**` (outside `__tests__`) containing `terum-skills`, and any `README.md` / `docs/**/*.md` / `.claude/skills/terum-skills/SKILL.md` line naming a verb after a backtick or at line start, must be catalogued in `src/lib/__tests__/invocation-catalog.ts` (`src/lib/__tests__/invocation-tripwire.test.ts` is an exact-set equality keyed on `file: pattern`; `line` is informational). Policy rule for new rows: a runnable `npx -y terum-skills@latest …` command a reader is meant to copy → `fixed`; a comment, doc sentence, or help text that merely names the package or a verb → `prose`; a print/error/question string, a constant, or a code line that is not a hint → `not-a-hint`. Run the tripwire after every edit that touches such a line: `npx vitest run src/lib/__tests__/invocation-tripwire.test.ts --maxWorkers=1` prints the exact diff (removed rows must be deleted, added rows inserted; keep the file's existing JSON-ish row style).
- The seven new skill files (`.claude/skills/{list-skills,skill-info,search-skills,eval,eval-report,skill-status,sync-skills}/SKILL.md`) are **not** added to the tripwire's document list (spec §13); `src/__tests__/skill-prose.test.ts` (Task 9) is their gate. The manual stays in the list.
- Gates before every commit: `npm run lint && npm run typecheck && npm test` — one vitest battery at a time on this machine, shared with other sessions: start a full `npm test` only when the 1-minute load average (`cut -d' ' -f1 /proc/loadavg`) is under 8; never two batteries at once; run gates in the **foreground** with an explicit `timeout` (the box swaps under load and the harness's low-memory watchdog kills background shells); if `bin.test.ts`/`bundle.test.ts` report 5 s timeouts, wait and re-run rather than raising timeouts. Per-file runs (`npx vitest run <file> --maxWorkers=1`) are fine between commits. `npm` needs `NODE_OPTIONS=--dns-result-order=ipv4first` on this box.
- Commit messages: `type(scope): subject`, a wrapped body naming files, a `Verified …` paragraph stating what was run. No attribution trailers (withdrawn 2026-09-14: the `` and `` arguments in the commit commands below are to be omitted). Commit at the end of each task; never push.
- `desktop/` stays untouched except one added line in `desktop/GAPS.md` (Task 5); `git diff --stat desktop/` shows only that file. The desktop reads `wrapperRemoved` (boolean) through a `.passthrough()` zod object, so the additive `wrappersRemoved: string[]` needs no desktop change.

## File map

| File | Responsibility |
|---|---|
| `src/lib/wrapper.ts` (rewrite) | the managed set × roots: `managedSkillRoots`, `defaultWrapperOptions`, `readBundledSkills`, `inspectManagedSkill`, `listManagedSkills`, `managedSkillStates`, `installManagedSkill`, `removeManagedSkill`, `offerWrapper`, `refreshManagedSkills`, `managedSkillInventory` |
| `src/lib/__tests__/fixtures.ts` (modify) | `wrapperFor(home, env?)` → `Required<WrapperOptions>` over the canonical `.claude/skills`; `CANONICAL_SKILLS` |
| `src/lib/__tests__/wrapper.test.ts` (rewrite) | the set × two roots, the absent-Codex case, the migration of the old single copy, foreign entries, unavailable bundle, the one question |
| `src/lib/skill-source.ts` (modify) | the generalised `managed-wrapper` rejection wording |
| `src/commands/setup.ts`, `src/commands/install.ts`, `src/cli.ts` (modify) | wording: "the terum-skills skills for Claude Code and Codex" |
| `src/commands/refresh.ts` (modify) | `SyncArgs.wrapper`; the hook writes missing and refreshes outdated copies in consented roots; notice `Updated your terum-skills skills for this CLI.` |
| `src/commands/uninstallMachine.ts` (modify) | inventory per root, removal after the hook, `wrappersRemoved: string[]` |
| `scripts/bundle-skill.mjs` (rewrite) | scan `.claude/skills/*/SKILL.md`, validate every marked file, bundle to `dist/claude/skills/<name>/SKILL.md`, one stderr line each |
| `.github/workflows/release.yml` (modify) | the tarball must-list names the eight paths |
| `src/__tests__/release-tarball-list.test.ts` (new) | the must-list ⇔ the marked skills under `.claude/skills` |
| `.claude/skills/{list-skills,skill-info,search-skills,eval,eval-report,skill-status,sync-skills}/SKILL.md` (new) | the seven named skills |
| `.claude/skills/terum-skills/SKILL.md` (rewrite) | the manual: named-skill rule, `--format md` invocation, Tables A/B, never-does |
| `src/__tests__/skill-prose.test.ts` (new) | every marked skill: frontmatter contract, commands ⊆ the registered commander commands (`buildProgram`'s tree — a superset of `FRAME_VERBS` that includes `team migrate`), `--format md` commands parse, no host tool names, the four rules verbatim, `$ARGUMENTS` once, the sandbox rule |
| `.claude/commands/{eval,install,invite,ls,publish,search,sync,update,validate,terum-skills}.md` (modify) | repointed at the named skills |
| `.claude/skills/README.md`, `README.md`, `docs/frame-protocol.md`, `desktop/GAPS.md` (modify) | docs |
| `src/lib/__tests__/invocation-catalog.ts` (modify) | every changed or added catalogued line |

## Shared vocabulary (used by every task)

- **Skill names** (sorted): `eval`, `eval-report`, `list-skills`, `search-skills`, `skill-info`, `skill-status`, `sync-skills`, `terum-skills`.
- **Roots**: `ManagedRoot { host: 'claude' | 'codex'; root: string }`. Claude: `AGENT_PATHS['claude-code'].global(home)` = `<home>/.claude/skills`. Codex: `<CODEX_HOME or <home>/.codex>/skills` (`CODEX_HOME` empty counts as unset). The Claude root is always eligible; the Codex root is eligible only when `dirname(root)` (`~/.codex` or `CODEX_HOME`) is a directory (`stat`, following links: the root's *parent* is a place, not a skill folder).
- **Bundle**: `BUNDLED_SKILLS` = `<packageRoot>/dist/claude/skills`. `readBundledSkills(bundle)` returns `Map<name, raw>` of every `<bundle>/<name>/SKILL.md` whose parsed frontmatter carries the marker and whose `name` equals the folder; `null` when the directory is missing or holds no such file (`unavailable`). Tests point `bundle` at the repo's own `.claude/skills` (`CANONICAL_SKILLS`), where the unmarked review tools are skipped by the same rule.
- **Presence** of `<root>/<name>`: `{ kind: 'absent' } | { kind: 'managed'; raw } | { kind: 'foreign'; why }`, `why` ∈ `it is a symbolic link` · `it is not a directory` · `it has no SKILL.md` · `its SKILL.md is not a regular file` · `it is a different skill`.
- **State** of (root, name): `absent` | `current` (bytes equal the bundle) | `outdated` (managed, bytes differ) | `foreign`.
- **Consent**: a root or machine "has consent on record" when any managed copy exists there. `offerWrapper` asks only when *no* eligible root holds any managed copy; the hook writes only into roots that hold at least one.
- PR #213 (`feat/skill-copy-to`, MERGED 2026-09-14 as 4cf8e30, in the base) adds `skill copy <path> --to <destination>` (a `FRAME_VERBS` entry) and edits `.claude/skills/terum-skills/SKILL.md`, `README.md`, `docs/frame-protocol.md` and the catalogue. Task 8 (manual) adds the manual row `| \`skill copy <abs-path> --to global\|<project root>\` | none | \`npx -y terum-skills@latest skill copy <abs-path> --to <destination>\` |` beside `skill move`, keeping the tripwire catalogue in step. Ruling: the manual's verb table lists `skill copy` beside `skill move` — cost if wrong: one extra row.
- PR #218 (`feat/skill-verb-routing`, Ryan, MERGED 2026-09-14 as 00e1870 and rebased into this branch — every item below is in the base; diff saved at `/tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/pr218.KJJX.diff`) overlaps this plan broadly: `scripts/bundle-skill.mjs` also copies `assets/claude/hooks/terum-skills-edit.mjs` → `dist/claude/hooks/terum-skills-edit.mjs` after asserting its `// terum-skills managed hook` marker (Task 6's bundler rewrite keeps that step verbatim, never clears `dist/claude/hooks`, and the release must-list + `release-tarball-list.test.ts` include the hook file); `src/lib/hook.ts` is generalised per event (`MANAGED_EVENTS = ['SessionStart', 'PostToolUse']`, `installEventHook`, `removeEventHook`, `eventHookInstalled`) and a new `src/lib/editHook.ts` (`defaultEditHookOptions`, `editHookDestination`, `inspectEditHook`, `removeEditHook`, `EditHookOptions`) is placed under the state root by `setup` with its own y/N (Tasks 3 and 4: the managed-skills question and the refresh block sit beside the edit-hook question and its notice `Updated your terum-skills edit hook for this CLI.`); `uninstallMachine.ts` gains `editHook?: Partial<EditHookOptions>` and inventories the edit hook (Task 5's `managedSkillInventory`/`wrappersRemoved` are additive beside it); `.claude/skills/terum-skills/SKILL.md` gains two paragraphs — the edit-hook note beginning *"You edited <name>, a skill in this machine's terum-skills Library"* and **The report's last line may be the next step; act on it.** — which Tasks 7 and 8 carry verbatim into the rewritten manual; the catalogue gains rows. Ruling: before each Plan 2 task, fetch and rebase when main moved; every Plan 2 change is additive beside #218's code (hook events, edit hook, bundler hook copy, manual paragraphs).
- PR #220 (`feat/cross-mirror-m2`, Ryan, MERGED 2026-09-14 ~10:10 as 4362465 — rebased into this branch after Task 17 closed; `reconcile` is the 36th `FRAME_VERBS` entry, so Task 18 adds its `format-cli` INVOCATIONS row, its catalogue rows and its manual/doc rows, and Plan 2 Tasks 8/10 add its manual paragraph and README rows; diff saved at `/tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/pr220.diff`) adds a `reconcile` verb (a `FRAME_VERBS` entry), `install --adopt`, and edits `README.md`, `docs/frame-protocol.md`, `src/cli.ts` and the catalogue. Ruling: if it has merged when Task 8 (manual) or Task 10 (READMEs/catalogue) dispatches, rebase first and add a manual row for `reconcile` (argument shape from its `src/cli.ts` registration) beside the other Table B verbs, keeping the tripwire catalogue in step; until it merges, the manual does not mention `reconcile` — cost if wrong: one missing row.

---

### Task 1: `src/lib/wrapper.ts` — the managed set × two roots

**Files:**
- Rewrite: `src/lib/wrapper.ts`
- Modify: `src/lib/__tests__/fixtures.ts` (`wrapperFor`, `CANONICAL_SKILLS`)
- Rewrite: `src/lib/__tests__/wrapper.test.ts`
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: `packageRoot()` (`src/lib/package-root.ts`), `AGENT_PATHS` (`src/lib/placer/agent-paths.ts`), `FRONTMATTER` (`src/lib/schema.ts`), `Prompter` (`src/lib/prompt.ts`).
- Produces (all exported from `src/lib/wrapper.ts`):
  - `MANAGED_BY = 'terum-skills'`, `BUNDLED_SKILLS: string`
  - `type ManagedHost = 'claude' | 'codex'`, `interface ManagedRoot { host: ManagedHost; root: string }`, `interface WrapperOptions { roots?: ManagedRoot[]; bundle?: string }`
  - `managedSkillRoots(home?: string, env?: NodeJS.ProcessEnv): ManagedRoot[]`, `defaultWrapperOptions(home?: string, env?: NodeJS.ProcessEnv): Required<WrapperOptions>`, `managedSkillDirectory(root: string, name: string): string`
  - `isManagedFrontmatter(parsed: unknown): boolean`, `isManagedSkill(raw: string): boolean`
  - `type SkillPresence`, `inspectManagedSkill(root: string, name: string): Promise<SkillPresence>`, `listManagedSkills(root: string): Promise<{ name: string; directory: string }[]>`
  - `readBundledSkills(bundle: string): Promise<Map<string, string> | null>`
  - `type SkillState = 'absent' | 'current' | 'outdated' | 'foreign'`, `interface ManagedSkillStatus { name; root; directory; state: SkillState; why?: string }`, `interface RootStatus { host; root; eligible: boolean; skills: ManagedSkillStatus[] }`, `type ManagedStates = { kind: 'unavailable'; bundle: string } | { kind: 'ready'; bundled: Map<string, string>; roots: RootStatus[] }`, `managedSkillStates(options: Required<WrapperOptions>): Promise<ManagedStates>`
  - `installManagedSkill(root: string, name: string, raw: string): Promise<'installed' | 'replaced'>`, `removeManagedSkill(root: string, name: string): Promise<'removed' | 'absent' | 'foreign'>`
  - `type WrapperOffer = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable'`, `offerWrapper(io: Prompter, options: Required<WrapperOptions>): Promise<WrapperOffer>`
  - `refreshManagedSkills(options: Required<WrapperOptions>): Promise<string[]>` (directories written)
  - `interface ManagedInventory { roots: { host: ManagedHost; root: string; managed: { name: string; directory: string }[]; foreign: { name: string; directory: string; why: string }[] }[] }`, `managedSkillInventory(options: Required<WrapperOptions>): Promise<ManagedInventory>`
- Removed: `WRAPPER_NAME`, `BUNDLED_WRAPPER`, `wrapperDestination`, `isManagedWrapper`, `inspectWrapper`, `wrapperState`, `installWrapper`, `removeWrapper`, `WrapperPresence`, `WrapperState`. Their importers (`setup.ts`, `install.ts`, `refresh.ts`, `uninstallMachine.ts`, `skill-source.ts`, and their tests) are updated in Tasks 2–5; until then `npm run typecheck` fails on those files — expected mid-plan, so this task's gate is `npx vitest run src/lib/__tests__/wrapper.test.ts src/lib/__tests__/local-skills.test.ts` plus `npx eslint src/lib/wrapper.ts src/lib/__tests__/wrapper.test.ts src/lib/__tests__/fixtures.ts`, and the full gates run at the end of Task 5. Ruling (controller, 2026-09-14): every commit stays typecheck-green — Task 1 keeps each removed name as a one-line `/** @deprecated shim until its last importer migrates; deleted in Task 5 */` export delegating to the new API, and Task 5 deletes the shims.

- [ ] **Step 1: Fixture helpers**

In `src/lib/__tests__/fixtures.ts`, replace the `wrapperFor` function (keep `BUNDLED_SKILL_SOURCE`, which `local-skills.test.ts` still reads):

```ts
/** The repo's own skill folder: the bundle's source of truth. Reading it as a bundle skips the unmarked review tools by the same rule the runtime applies to dist/. */
export const CANONICAL_SKILLS = fileURLToPath(new URL('../../../.claude/skills', import.meta.url));
/** Both managed roots under `home`, judged against the canonical skills; `env` decides `CODEX_HOME` (default: unset). */
export function wrapperFor(home: string, env: NodeJS.ProcessEnv = {}): Required<WrapperOptions> {
  return { roots: managedSkillRoots(home, env), bundle: CANONICAL_SKILLS };
}
```

Add to the imports of `fixtures.ts`: `import { managedSkillRoots, type WrapperOptions } from '../wrapper.js';`.

- [ ] **Step 2: Write the failing tests**

Replace `src/lib/__tests__/wrapper.test.ts` with:

```ts
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_SKILLS, defaultWrapperOptions, inspectManagedSkill, installManagedSkill, isManagedFrontmatter, isManagedSkill, listManagedSkills, managedSkillInventory, managedSkillRoots, managedSkillStates, offerWrapper, readBundledSkills, refreshManagedSkills, removeManagedSkill } from '../wrapper.js';
import { BUNDLED_SKILL_SOURCE, CANONICAL_SKILLS, ScriptedPrompter, temporaryDirectory, wrapperFor } from './fixtures.js';

const OLD_COPY = '---\nname: terum-skills\ndescription: an older bundled copy\nmetadata:\n  managed-by: terum-skills\n---\nold body\n';
const SOMEONE_ELSES = '---\nname: terum-skills\ndescription: someone else\'s skill under the same name\n---\n';

async function fresh(codex = true) {
  const root = await temporaryDirectory('terum-wrapper-');
  const home = join(root, 'home');
  await mkdir(join(home, '.claude'), { recursive: true });
  if (codex) await mkdir(join(home, '.codex'), { recursive: true });
  const options = wrapperFor(home);
  const claude = options.roots[0]!.root, codexRoot = options.roots[1]!.root;
  const bundled = (await readBundledSkills(CANONICAL_SKILLS))!;
  const names = [...bundled.keys()].sort();
  return { root, home, options, claude, codexRoot, bundled, names };
}
const brace = (root: string, names: string[]) => `${root}/{${names.join(', ')}}`;

describe('the bundled terum-skills skills', () => {
  it('reads the bundle by the marker: every marked folder whose name matches, the review tools skipped, nothing when the folder is missing or unmarked', async () => {
    const bundled = await readBundledSkills(CANONICAL_SKILLS);
    expect(bundled).not.toBeNull();
    expect(bundled!.has('terum-skills')).toBe(true);
    expect(bundled!.get('terum-skills')).toBe(await readFile(BUNDLED_SKILL_SOURCE, 'utf8'));
    for (const [name, raw] of bundled!) { expect(isManagedSkill(raw), name).toBe(true); expect(raw).toMatch(new RegExp(`^---\\s*\\r?\\nname: ${name}\\s*$`, 'm')); }
    const canonical = (await readdir(CANONICAL_SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(canonical).toContain('single-fix'); expect(bundled!.has('single-fix')).toBe(false);
    expect(BUNDLED_SKILLS).toMatch(/[\\/]dist[\\/]claude[\\/]skills$/);
    const root = await temporaryDirectory('terum-bundle-');
    expect(await readBundledSkills(join(root, 'nowhere'))).toBeNull();
    await mkdir(join(root, 'unmarked', 'x'), { recursive: true }); await writeFile(join(root, 'unmarked', 'x', 'SKILL.md'), SOMEONE_ELSES);
    expect(await readBundledSkills(join(root, 'unmarked'))).toBeNull();
    // A marked file under the wrong folder is a build defect the bundler refuses; at runtime it is simply not bundled.
    await mkdir(join(root, 'misnamed', 'other'), { recursive: true }); await writeFile(join(root, 'misnamed', 'other', 'SKILL.md'), OLD_COPY);
    expect(await readBundledSkills(join(root, 'misnamed'))).toBeNull();
  });

  it('the marker is metadata.managed-by plus a string name, under any name; unmarked or broken frontmatter is not ours', () => {
    expect(isManagedSkill(OLD_COPY)).toBe(true);
    expect(isManagedSkill('---\nname: other\nmetadata:\n  managed-by: terum-skills\n---\n')).toBe(true);
    for (const raw of ['no frontmatter', '---\nname: terum-skills\n---\n', SOMEONE_ELSES, '---\nmetadata:\n  managed-by: terum-skills\n---\n', '---\nname: terum-skills\nmetadata: [x]\n---\n', '---\nname: [\n---\n']) expect(isManagedSkill(raw), raw).toBe(false);
    expect(isManagedFrontmatter(null)).toBe(false); expect(isManagedFrontmatter([])).toBe(false); expect(isManagedFrontmatter({ name: 7, metadata: { 'managed-by': 'terum-skills' } })).toBe(false);
  });

  it('roots: Claude under home, Codex under CODEX_HOME or ~/.codex; the Codex root is eligible only when its parent exists', async () => {
    expect(managedSkillRoots('/h', {})).toEqual([{ host: 'claude', root: join('/h', '.claude', 'skills') }, { host: 'codex', root: join('/h', '.codex', 'skills') }]);
    expect(managedSkillRoots('/h', { CODEX_HOME: '/elsewhere/codex' })[1]).toEqual({ host: 'codex', root: join('/elsewhere/codex', 'skills') });
    expect(managedSkillRoots('/h', { CODEX_HOME: '' })[1]).toEqual({ host: 'codex', root: join('/h', '.codex', 'skills') });
    expect(defaultWrapperOptions('/h', {})).toEqual({ roots: managedSkillRoots('/h', {}), bundle: BUNDLED_SKILLS });
    const { options, names } = await fresh(false);
    const states = await managedSkillStates(options);
    if (states.kind !== 'ready') throw new Error(states.kind);
    expect(states.roots.map((r) => [r.host, r.eligible])).toEqual([['claude', true], ['codex', false]]);
    expect(states.roots[0]!.skills.map((s) => [s.name, s.state])).toEqual(names.map((name) => [name, 'absent']));
    expect(states.roots[1]!.skills.map((s) => s.state)).toEqual(names.map(() => 'absent'));
  });

  it('installs a skill byte for byte, reports current, refreshes an outdated copy of its own, and removes only what it placed', async () => {
    const { options, claude, bundled } = await fresh();
    const raw = bundled.get('terum-skills')!; const directory = join(claude, 'terum-skills');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'absent' });
    expect(await installManagedSkill(claude, 'terum-skills', raw)).toBe('installed');
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(raw);
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'managed', raw });
    let states = await managedSkillStates(options);
    expect(states.kind === 'ready' && states.roots[0]!.skills.find((s) => s.name === 'terum-skills')?.state).toBe('current');
    await writeFile(join(directory, 'SKILL.md'), OLD_COPY);
    states = await managedSkillStates(options);
    expect(states.kind === 'ready' && states.roots[0]!.skills.find((s) => s.name === 'terum-skills')?.state).toBe('outdated');
    expect(await installManagedSkill(claude, 'terum-skills', raw)).toBe('replaced');
    expect(await listManagedSkills(claude)).toEqual([{ name: 'terum-skills', directory }]);
    expect(await listManagedSkills(join(claude, 'missing-root'))).toEqual([]);
    // Removal takes the marked SKILL.md and the folder; a file the user added keeps the folder, and is theirs.
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('removed');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'absent' });
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('absent');
    await installManagedSkill(claude, 'terum-skills', raw);
    await writeFile(join(directory, 'notes.md'), 'mine');
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('removed');
    expect(await inspectManagedSkill(claude, 'terum-skills')).toEqual({ kind: 'foreign', why: 'it has no SKILL.md' });
    expect(await readFile(join(directory, 'notes.md'), 'utf8')).toBe('mine');
    expect(await removeManagedSkill(claude, 'terum-skills')).toBe('foreign');
  });

  it('never writes to or removes anything that is not its own copy: another skill, a symlink, a plain file', async () => {
    const other = await fresh(); const theirs = join(other.claude, 'list-skills');
    await mkdir(theirs, { recursive: true }); await writeFile(join(theirs, 'SKILL.md'), SOMEONE_ELSES);
    await expect(installManagedSkill(other.claude, 'list-skills', other.bundled.get('list-skills')!)).rejects.toThrow(`${theirs} exists and is not a bundled terum-skills skill (it is a different skill); move it aside and re-run.`);
    expect(await removeManagedSkill(other.claude, 'list-skills')).toBe('foreign');
    expect(await readFile(join(theirs, 'SKILL.md'), 'utf8')).toBe(SOMEONE_ELSES);
    expect(await listManagedSkills(other.claude)).toEqual([]);

    const linked = await fresh(); const real = join(linked.root, 'real');
    await mkdir(real, { recursive: true }); await writeFile(join(real, 'SKILL.md'), linked.bundled.get('eval')!);
    await mkdir(linked.claude, { recursive: true }); await symlink(real, join(linked.claude, 'eval'));
    expect(await inspectManagedSkill(linked.claude, 'eval')).toEqual({ kind: 'foreign', why: 'it is a symbolic link' });
    expect(await removeManagedSkill(linked.claude, 'eval')).toBe('foreign');
    expect(await listManagedSkills(linked.claude)).toEqual([]);
    expect(await readFile(join(real, 'SKILL.md'), 'utf8')).toBe(linked.bundled.get('eval'));

    const file = await fresh(); await mkdir(file.claude, { recursive: true }); await writeFile(join(file.claude, 'eval'), 'x');
    expect(await inspectManagedSkill(file.claude, 'eval')).toEqual({ kind: 'foreign', why: 'it is not a directory' });
    expect(await removeManagedSkill(file.claude, 'eval')).toBe('foreign');
    expect(await readFile(join(file.claude, 'eval'), 'utf8')).toBe('x');
    await mkdir(join(file.claude, 'sync-skills')); await mkdir(join(file.claude, 'sync-skills', 'SKILL.md'));
    expect(await inspectManagedSkill(file.claude, 'sync-skills')).toEqual({ kind: 'foreign', why: 'its SKILL.md is not a regular file' });
  });

  it('a copy of the package built without the bundle is unavailable: it says so, asks nothing, writes nothing', async () => {
    const { root, options, claude } = await fresh();
    const missing = { ...options, bundle: join(root, 'nowhere') };
    expect(await managedSkillStates(missing)).toEqual({ kind: 'unavailable', bundle: missing.bundle });
    const io = new ScriptedPrompter([], []);
    expect(await offerWrapper(io, missing)).toBe('unavailable');
    expect(io.asked).toEqual([]);
    expect(io.lines).toEqual([`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${missing.bundle}); skipped.`]);
    expect(await refreshManagedSkills(missing)).toEqual([]);
    expect(await listManagedSkills(claude)).toEqual([]);
    expect(await managedSkillInventory(missing)).toEqual({ roots: options.roots.map((r) => ({ ...r, managed: [], foreign: [] })) });
  });

  it('the offer asks exactly once, for a first install, naming both roots and every skill; a re-run refreshes or reports without asking', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh();
    const question = `Install the terum-skills skills for Claude Code and Codex so they can run terum-skills for you? (writes ${brace(claude, names)} and ${brace(codexRoot, names)})`;
    const declined = new ScriptedPrompter([], [false]);
    expect(await offerWrapper(declined, options)).toBe('declined');
    expect(declined.asked).toEqual([question]);
    expect(declined.lines).toEqual(['Skipped the terum-skills skills; re-run setup to install them later.']);
    expect(await listManagedSkills(claude)).toEqual([]); expect(await listManagedSkills(codexRoot)).toEqual([]);

    const accepted = new ScriptedPrompter([], [true]);
    expect(await offerWrapper(accepted, options)).toBe('installed');
    expect(accepted.asked).toEqual([question]);
    expect(accepted.lines).toEqual([`Installed the terum-skills skills at ${claude}: ${names.join(', ')}.`, `Installed the terum-skills skills at ${codexRoot}: ${names.join(', ')}.`]);
    for (const root of [claude, codexRoot]) for (const name of names) expect(await readFile(join(root, name, 'SKILL.md'), 'utf8')).toBe(bundled.get(name));

    const again = new ScriptedPrompter([], []);
    expect(await offerWrapper(again, options)).toBe('present');
    expect(again.asked).toEqual([]);
    expect(again.lines).toEqual([`The terum-skills skills at ${claude} and ${codexRoot} are current.`]);

    await writeFile(join(codexRoot, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const refreshed = new ScriptedPrompter([], []);
    expect(await offerWrapper(refreshed, options)).toBe('replaced');
    expect(refreshed.asked).toEqual([]);
    expect(refreshed.lines).toEqual([`Updated the terum-skills skills at ${codexRoot}: terum-skills.`]);
    expect(await readFile(join(codexRoot, 'terum-skills', 'SKILL.md'), 'utf8')).toBe(bundled.get('terum-skills'));
  });

  it('migration: a machine holding the old single copy is consent on record — the manual is replaced and the other skills written without a question', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh();
    await mkdir(join(claude, 'terum-skills'), { recursive: true }); await writeFile(join(claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const io = new ScriptedPrompter([], []);
    expect(await offerWrapper(io, options)).toBe('installed');
    expect(io.asked).toEqual([]);
    const others = names.filter((name) => name !== 'terum-skills');
    expect(io.lines).toEqual([`Installed the terum-skills skills at ${claude}: ${others.join(', ')}.`, `Updated the terum-skills skills at ${claude}: terum-skills.`, `Installed the terum-skills skills at ${codexRoot}: ${names.join(', ')}.`]);
    for (const name of names) expect(await readFile(join(claude, name, 'SKILL.md'), 'utf8')).toBe(bundled.get(name));
  });

  it('without ~/.codex the offer names the Claude root alone and says why; foreign entries are named and left alone, and an all-foreign machine is foreign', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh(false);
    const io = new ScriptedPrompter([], [true]);
    expect(await offerWrapper(io, options)).toBe('installed');
    expect(io.asked).toEqual([`Install the terum-skills skills for Claude Code so it can run terum-skills for you? (writes ${brace(claude, names)})`]);
    expect(io.lines).toEqual([`No ${dirname(codexRoot)} on this machine; Codex skills skipped.`, `Installed the terum-skills skills at ${claude}: ${names.join(', ')}.`]);
    expect(await listManagedSkills(codexRoot)).toEqual([]);

    const mixed = await fresh(); const theirs = join(mixed.claude, 'eval');
    await mkdir(theirs, { recursive: true }); await writeFile(join(theirs, 'SKILL.md'), SOMEONE_ELSES);
    const mixedIo = new ScriptedPrompter([], [true]);
    const rest = mixed.names.filter((name) => name !== 'eval');
    expect(await offerWrapper(mixedIo, mixed.options)).toBe('installed');
    expect(mixedIo.lines[0]).toBe(`${theirs} exists and is not a bundled terum-skills skill (it is a different skill); left alone. Move it aside and re-run setup to install the bundled one.`);
    expect(mixedIo.asked).toEqual([`Install the terum-skills skills for Claude Code and Codex so they can run terum-skills for you? (writes ${brace(mixed.claude, rest)} and ${brace(mixed.codexRoot, mixed.names)})`]);
    expect(await readFile(join(theirs, 'SKILL.md'), 'utf8')).toBe(SOMEONE_ELSES);
    expect(await readFile(join(mixed.codexRoot, 'eval', 'SKILL.md'), 'utf8')).toBe(bundled.get('eval'));

    const all = await fresh(false);
    for (const name of all.names) { await mkdir(join(all.claude, name), { recursive: true }); await writeFile(join(all.claude, name, 'SKILL.md'), SOMEONE_ELSES); }
    const allIo = new ScriptedPrompter([], []);
    expect(await offerWrapper(allIo, all.options)).toBe('foreign');
    expect(allIo.asked).toEqual([]);
    expect(allIo.lines).toHaveLength(all.names.length + 1);
  });

  it('the hook refresh writes missing and outdated copies only into a root that already holds a managed copy', async () => {
    const { options, claude, codexRoot, names, bundled } = await fresh();
    expect(await refreshManagedSkills(options)).toEqual([]);
    await mkdir(join(claude, 'terum-skills'), { recursive: true }); await writeFile(join(claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const theirs = join(claude, 'skill-info'); await mkdir(theirs); await writeFile(join(theirs, 'SKILL.md'), SOMEONE_ELSES);
    const written = await refreshManagedSkills(options);
    expect(written.sort()).toEqual(names.filter((name) => name !== 'skill-info').map((name) => join(claude, name)).sort());
    expect(await readFile(join(claude, 'terum-skills', 'SKILL.md'), 'utf8')).toBe(bundled.get('terum-skills'));
    expect(await readFile(join(theirs, 'SKILL.md'), 'utf8')).toBe(SOMEONE_ELSES);
    expect(await listManagedSkills(codexRoot)).toEqual([]);
    expect(await refreshManagedSkills(options)).toEqual([]);
  });

  it('the inventory lists managed copies by the marker under any name, and foreign folders at bundled names', async () => {
    const { options, claude, codexRoot, bundled } = await fresh();
    await installManagedSkill(claude, 'eval', bundled.get('eval')!);
    await mkdir(join(claude, 'renamed-copy')); await writeFile(join(claude, 'renamed-copy', 'SKILL.md'), OLD_COPY);
    await mkdir(join(claude, 'plain')); await writeFile(join(claude, 'plain', 'SKILL.md'), SOMEONE_ELSES);
    await mkdir(join(codexRoot, 'sync-skills'), { recursive: true }); await writeFile(join(codexRoot, 'sync-skills', 'SKILL.md'), SOMEONE_ELSES);
    expect(await managedSkillInventory(options)).toEqual({ roots: [
      { host: 'claude', root: claude, managed: [{ name: 'eval', directory: join(claude, 'eval') }, { name: 'renamed-copy', directory: join(claude, 'renamed-copy') }], foreign: [] },
      { host: 'codex', root: codexRoot, managed: [], foreign: [{ name: 'sync-skills', directory: join(codexRoot, 'sync-skills'), why: 'it is a different skill' }] },
    ] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/wrapper.test.ts --maxWorkers=1`
Expected: FAIL — `readBundledSkills`, `managedSkillRoots`, … are not exported (the old module has `installWrapper`/`wrapperState`).

- [ ] **Step 4: Rewrite `src/lib/wrapper.ts`**

```ts
import { packageRoot } from './package-root.js';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { AGENT_PATHS } from './placer/agent-paths.js';
import { Prompter } from './prompt.js';
import { FRONTMATTER } from './schema.js';

/**
 * The terum-skills skills: the SKILL.md files that teach Claude Code and Codex which verbs to run in a
 * session (`list-skills`, `skill-info`, …, and the `terum-skills` manual). They ship inside this
 * package (bundled by `scripts/bundle-skill.mjs` into dist/claude/skills/<name>/SKILL.md at build
 * time, from the canonical copies under .claude/skills/) and are placed under both hosts' global
 * skills roots by `setup`, the way the session hook is offered there. Same contract as the hook: one
 * offer with its own y/N, an idempotency key the tool can recognise later (the frontmatter marker
 * below), an in-place refresh of its own copies, removal on machine uninstall, and hands off anything
 * else found at a destination. The set is discovered from the bundle at runtime, so a release that
 * adds a skill needs no code change here.
 */
export const MANAGED_BY = 'terum-skills';
/** Where `npm run build` puts the bundled copies, resolved from the package root for dist/lib, a bundled entry, and a checkout. */
export const BUNDLED_SKILLS = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills');

export type ManagedHost = 'claude' | 'codex';
export interface ManagedRoot { host: ManagedHost; root: string }
export interface WrapperOptions { roots?: ManagedRoot[]; bundle?: string }

/** Claude Code's global skills root and Codex's (`CODEX_HOME`, else `~/.codex`); `AGENT_PATHS` is not extended, so the Placer's rules are untouched. */
export function managedSkillRoots(home = homedir(), env: NodeJS.ProcessEnv = process.env): ManagedRoot[] {
  const codexHome = env['CODEX_HOME'] || join(home, '.codex');
  return [{ host: 'claude', root: AGENT_PATHS['claude-code'].global(home) }, { host: 'codex', root: join(codexHome, 'skills') }];
}

export function defaultWrapperOptions(home = homedir(), env: NodeJS.ProcessEnv = process.env): Required<WrapperOptions> {
  return { roots: managedSkillRoots(home, env), bundle: BUNDLED_SKILLS };
}

export function managedSkillDirectory(root: string, name: string): string { return join(root, name); }

/** The idempotency key on parsed frontmatter: a string `name` plus `metadata.managed-by: terum-skills`, under any name. */
export function isManagedFrontmatter(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const data = parsed as Record<string, unknown>;
  const metadata = data['metadata'];
  return typeof data['name'] === 'string' && data['name'] !== '' && !!metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata as Record<string, unknown>)['managed-by'] === MANAGED_BY;
}

/** The same key read from a whole SKILL.md; anything unparseable is not ours. */
export function isManagedSkill(raw: string): boolean {
  const match = FRONTMATTER.exec(raw);
  if (!match) return false;
  try { return isManagedFrontmatter(YAML.parse(match[1]!)); } catch { return false; } // a YAML error means it is not our file, which is the answer
}

function frontmatterName(raw: string): string | null {
  const match = FRONTMATTER.exec(raw);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = YAML.parse(match[1]!); } catch { return null; } // unparseable frontmatter has no name
  return isManagedFrontmatter(parsed) ? (parsed as { name: string }).name : null;
}

export type SkillPresence = { kind: 'absent' } | { kind: 'managed'; raw: string } | { kind: 'foreign'; why: string };

function isMissing(error: unknown): boolean { const code = (error as NodeJS.ErrnoException).code; return code === 'ENOENT' || code === 'ENOTDIR'; }

/**
 * What sits at `<root>/<name>`. Judged without following links (the repo's rule for symlinks
 * everywhere: refuse, never follow): a link, a file, a folder without a regular SKILL.md, or a
 * SKILL.md without the marker is `foreign` and is never written to or removed.
 */
export async function inspectManagedSkill(root: string, name: string): Promise<SkillPresence> {
  const directory = managedSkillDirectory(root, name);
  let details;
  try { details = await lstat(directory); } catch (error) { if (isMissing(error)) return { kind: 'absent' }; throw error; }
  if (details.isSymbolicLink()) return { kind: 'foreign', why: 'it is a symbolic link' };
  if (!details.isDirectory()) return { kind: 'foreign', why: 'it is not a directory' };
  const file = join(directory, 'SKILL.md');
  let fileDetails;
  try { fileDetails = await lstat(file); } catch (error) { if (isMissing(error)) return { kind: 'foreign', why: 'it has no SKILL.md' }; throw error; }
  if (!fileDetails.isFile()) return { kind: 'foreign', why: 'its SKILL.md is not a regular file' };
  const raw = await readFile(file, 'utf8');
  return isManagedSkill(raw) ? { kind: 'managed', raw } : { kind: 'foreign', why: 'it is a different skill' };
}

/** Every managed copy under `root`, by the marker and under any folder name (what uninstall removes); a missing root holds none. */
export async function listManagedSkills(root: string): Promise<{ name: string; directory: string }[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (isMissing(error)) return []; throw error; }
  const managed: { name: string; directory: string }[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue; // links and files are foreign by the same rule inspectManagedSkill applies
    const presence = await inspectManagedSkill(root, entry.name);
    if (presence.kind === 'managed') managed.push({ name: entry.name, directory: managedSkillDirectory(root, entry.name) });
  }
  return managed;
}

/**
 * The bundled set: every `<bundle>/<name>/SKILL.md` carrying the marker under its own name. Null when
 * this copy of the package was not built with it (a source checkout, a test run from src/) or holds
 * no such file. A marked file under another folder name is a build defect the bundler refuses; here
 * it is simply not part of the set.
 */
export async function readBundledSkills(bundle: string): Promise<Map<string, string> | null> {
  let entries;
  try { entries = await readdir(bundle, { withFileTypes: true }); } catch (error) { if (isMissing(error)) return null; throw error; }
  const skills = new Map<string, string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try { raw = await readFile(join(bundle, entry.name, 'SKILL.md'), 'utf8'); } catch (error) { if (isMissing(error)) continue; throw error; }
    if (frontmatterName(raw) === entry.name) skills.set(entry.name, raw);
  }
  return skills.size ? skills : null;
}

export type SkillState = 'absent' | 'current' | 'outdated' | 'foreign';
export interface ManagedSkillStatus { name: string; root: string; directory: string; state: SkillState; why?: string }
export interface RootStatus { host: ManagedHost; root: string; /** The Claude root always; the Codex root only when its parent (`~/.codex` or CODEX_HOME) is a directory. */ eligible: boolean; skills: ManagedSkillStatus[] }
export type ManagedStates = { kind: 'unavailable'; bundle: string } | { kind: 'ready'; bundled: Map<string, string>; roots: RootStatus[] };

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch (error) { if (isMissing(error)) return false; throw error; }
}

async function eligible(root: ManagedRoot): Promise<boolean> {
  return root.host === 'claude' ? true : isDirectory(dirname(root.root));
}

/** Every (root, bundled skill) pair's state; the bundle decides the set, the marker decides ownership. */
export async function managedSkillStates(options: Required<WrapperOptions>): Promise<ManagedStates> {
  const bundled = await readBundledSkills(options.bundle);
  if (bundled === null) return { kind: 'unavailable', bundle: options.bundle };
  const roots: RootStatus[] = [];
  for (const root of options.roots) {
    const skills: ManagedSkillStatus[] = [];
    for (const [name, raw] of bundled) {
      const directory = managedSkillDirectory(root.root, name);
      const presence = await inspectManagedSkill(root.root, name);
      if (presence.kind === 'absent') skills.push({ name, root: root.root, directory, state: 'absent' });
      else if (presence.kind === 'foreign') skills.push({ name, root: root.root, directory, state: 'foreign', why: presence.why });
      else skills.push({ name, root: root.root, directory, state: presence.raw === raw ? 'current' : 'outdated' });
    }
    roots.push({ host: root.host, root: root.root, eligible: await eligible(root), skills });
  }
  return { kind: 'ready', bundled, roots };
}

/** Write one bundled skill atomically (temp file beside the target, fsync, rename). Refuses a foreign destination. */
export async function installManagedSkill(root: string, name: string, raw: string): Promise<'installed' | 'replaced'> {
  const directory = managedSkillDirectory(root, name);
  const presence = await inspectManagedSkill(root, name);
  if (presence.kind === 'foreign') throw new Error(`${directory} exists and is not a bundled terum-skills skill (${presence.why}); move it aside and re-run.`);
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'SKILL.md');
  const temporary = join(directory, `.SKILL.md.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'w');
    try { await handle.writeFile(raw, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return presence.kind === 'managed' ? 'replaced' : 'installed';
}

/** Remove only our own copy: the marked SKILL.md, then the folder if nothing else is in it. A foreign folder is left alone. */
export async function removeManagedSkill(root: string, name: string): Promise<'removed' | 'absent' | 'foreign'> {
  const presence = await inspectManagedSkill(root, name);
  if (presence.kind !== 'managed') return presence.kind;
  const directory = managedSkillDirectory(root, name);
  await rm(join(directory, 'SKILL.md'));
  try { await rmdir(directory); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error; } // the user's own files keep the folder, and are theirs
  return 'removed';
}

export type WrapperOffer = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable';

const HOST_LABEL: Record<ManagedHost, string> = { claude: 'Claude Code', codex: 'Codex' };
const listNames = (skills: ManagedSkillStatus[]): string => skills.map((skill) => skill.name).join(', ');

/**
 * The offer `setup` makes right after the hook. Asks exactly once, and only for a first install (no
 * eligible root holds any managed copy): once any does, missing copies are written and outdated ones
 * replaced without a question (the consent was given when the first copy was installed; a stale copy
 * teaches the assistant the wrong verbs). Foreign entries are named and left alone; a machine without
 * ~/.codex gets the Claude root alone and one line saying so; a copy of the package built without the
 * bundle says so and writes nothing.
 */
export async function offerWrapper(io: Prompter, options: Required<WrapperOptions>): Promise<WrapperOffer> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') { io.print(`The terum-skills skills are not bundled in this copy of terum-skills (expected under ${states.bundle}); skipped.`); return 'unavailable'; }
  const roots = states.roots.filter((root) => root.eligible);
  for (const root of states.roots) if (!root.eligible) io.print(`No ${dirname(root.root)} on this machine; Codex skills skipped.`);
  for (const root of roots) for (const skill of root.skills) if (skill.state === 'foreign') io.print(`${skill.directory} exists and is not a bundled terum-skills skill (${skill.why}); left alone. Move it aside and re-run setup to install the bundled one.`);
  const consented = roots.some((root) => root.skills.some((skill) => skill.state === 'current' || skill.state === 'outdated'));
  if (!consented) {
    const targets = roots.map((root) => ({ root, absent: root.skills.filter((skill) => skill.state === 'absent') })).filter((target) => target.absent.length);
    if (!targets.length) return 'foreign';
    const hosts = targets.map((target) => HOST_LABEL[target.root.host]).join(' and ');
    const where = targets.map((target) => `${target.root.root}/{${listNames(target.absent)}}`).join(' and ');
    if (!(await io.confirm(`Install the terum-skills skills for ${hosts} so ${targets.length > 1 ? 'they' : 'it'} can run terum-skills for you? (writes ${where})`))) {
      io.print('Skipped the terum-skills skills; re-run setup to install them later.');
      return 'declined';
    }
  }
  let installed = 0, replaced = 0;
  for (const root of roots) {
    const written: ManagedSkillStatus[] = [], refreshed: ManagedSkillStatus[] = [];
    for (const skill of root.skills) {
      if (skill.state !== 'absent' && skill.state !== 'outdated') continue;
      const outcome = await installManagedSkill(root.root, skill.name, states.bundled.get(skill.name)!);
      if (outcome === 'installed') written.push(skill); else refreshed.push(skill);
    }
    if (written.length) io.print(`Installed the terum-skills skills at ${root.root}: ${listNames(written)}.`);
    if (refreshed.length) io.print(`Updated the terum-skills skills at ${root.root}: ${listNames(refreshed)}.`);
    installed += written.length; replaced += refreshed.length;
  }
  if (installed) return 'installed';
  if (replaced) return 'replaced';
  io.print(`The terum-skills skills at ${roots.map((root) => root.root).join(' and ')} are current.`);
  return 'present';
}

/**
 * The session hook's half: in every root that already holds a managed copy (consent on record) write
 * every missing skill and replace every outdated one, so a CLI upgrade that adds a skill reaches a
 * machine that never re-runs setup. A root with no managed copy is left alone (never a first install
 * without the question); foreign entries are skipped (the hook cannot talk). Returns the directories written.
 */
export async function refreshManagedSkills(options: Required<WrapperOptions>): Promise<string[]> {
  const states = await managedSkillStates(options);
  if (states.kind === 'unavailable') return [];
  const written: string[] = [];
  for (const root of states.roots) {
    if (!root.skills.some((skill) => skill.state === 'current' || skill.state === 'outdated')) continue;
    for (const skill of root.skills) {
      if (skill.state !== 'absent' && skill.state !== 'outdated') continue;
      await installManagedSkill(root.root, skill.name, states.bundled.get(skill.name)!);
      written.push(skill.directory);
    }
  }
  return written;
}

export interface ManagedInventory { roots: { host: ManagedHost; root: string; managed: { name: string; directory: string }[]; foreign: { name: string; directory: string; why: string }[] }[] }

/**
 * What machine uninstall shows and removes: every managed copy per root by the marker (under any
 * name, so a copy from an older or newer release is still ours), and every foreign entry at a bundled
 * name (left alone). Without a bundle there are no bundled names to check for foreign entries.
 */
export async function managedSkillInventory(options: Required<WrapperOptions>): Promise<ManagedInventory> {
  const bundled = await readBundledSkills(options.bundle);
  const roots: ManagedInventory['roots'] = [];
  for (const root of options.roots) {
    const managed = await listManagedSkills(root.root);
    const foreign: { name: string; directory: string; why: string }[] = [];
    for (const name of bundled?.keys() ?? []) {
      const presence = await inspectManagedSkill(root.root, name);
      if (presence.kind === 'foreign') foreign.push({ name, directory: managedSkillDirectory(root.root, name), why: presence.why });
    }
    roots.push({ host: root.host, root: root.root, managed, foreign });
  }
  return { roots };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/wrapper.test.ts src/lib/__tests__/local-skills.test.ts --maxWorkers=1`
Expected: PASS (the `local-skills` managed-wrapper case still passes: the bundled manual is marked, and `skill-source.ts` still imports `isManagedFrontmatter`). If the migration test's expected line order differs, the order is: per root, `Installed …` before `Updated …`; roots in `options.roots` order.

Run: `npx eslint src/lib/wrapper.ts src/lib/__tests__/wrapper.test.ts src/lib/__tests__/fixtures.ts`
Expected: clean. `npm run typecheck` is expected to fail in `setup.ts`, `install.ts`, `refresh.ts`, `uninstallMachine.ts` and their tests until Tasks 2–5 land.

- [ ] **Step 6: Catalogue**

Run: `npx vitest run src/lib/__tests__/invocation-tripwire.test.ts --maxWorkers=1`. Remove the 17 `src/lib/wrapper.ts` rows and add one row per new line the diff names. The policies: the doc comment lines that name the package (`* The terum-skills skills: …`, `* offer with its own y/N …` etc.) → `prose`; `export const MANAGED_BY = 'terum-skills';` → `not-a-hint`; every `io.print(...)`, `io.confirm(...)`, `throw new Error(...)` line containing `terum-skills` → `not-a-hint`; `const codexHome = …` has no literal and is not a hit. Re-run until the tripwire is green.

- [ ] **Step 7: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/lib/wrapper.ts src/lib/__tests__/wrapper.test.ts src/lib/__tests__/fixtures.ts src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "feat(wrapper): manage the bundled skill set across the Claude Code and Codex roots" -m "src/lib/wrapper.ts discovers the bundled set from dist/claude/skills by the frontmatter marker, judges every (skill, root) with lstat, asks once for a first install, and refreshes or adds copies in roots that already hold one. Codex root is CODEX_HOME or ~/.codex, eligible only when its parent exists. Fixtures gain CANONICAL_SKILLS and the two-root wrapperFor." -m "Verified: npx vitest run src/lib/__tests__/wrapper.test.ts src/lib/__tests__/local-skills.test.ts src/lib/__tests__/invocation-tripwire.test.ts (green); eslint on the touched files (clean). Typecheck fails in the importers until Tasks 2–5."
```

---

### Task 2: `skill-source.ts` — the generalised rejection

**Files:**
- Modify: `src/lib/skill-source.ts:58-60`
- Modify: `src/lib/__tests__/local-skills.test.ts:232-248`
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: `isManagedFrontmatter` (Task 1; unchanged name, now any-name).
- Produces: the `managed-wrapper` rejection reason `a terum-skills skill that ships with terum-skills; not a team skill` (reason code unchanged, so the desktop's rejection kinds are untouched).

- [ ] **Step 1: Update the test**

In `src/lib/__tests__/local-skills.test.ts`, the `describe('the bundled /terum-skills Claude Code skill is not a team skill')` block: rename it to `'a bundled terum-skills skill is not a team skill'`, change the expected rejection to

```ts
    const rejected = { kind: 'rejected', reason: 'managed-wrapper', detail: 'a terum-skills skill that ships with terum-skills; not a team skill' };
```

and add a third candidate from another bundled skill so the any-name rule is covered end to end:

```ts
    await candidate(root, 'list-skills', await readFile(join(CANONICAL_SKILLS, 'list-skills', 'SKILL.md'), 'utf8'));
```

with `'list-skills'` added to the `for (const name of [...])` loop and `CANONICAL_SKILLS` added to the fixtures import. (Until Task 7 creates `.claude/skills/list-skills/SKILL.md` this read fails — so order this step's *addition* after Task 7, or write the third candidate as `OLD_COPY`-style inline marked frontmatter under the folder name `list-skills`: `'---\nname: list-skills\ndescription: a marked copy\nmetadata:\n  managed-by: terum-skills\n---\n'`. Use the inline form; it does not depend on Task 6.)

Run: `npx vitest run src/lib/__tests__/local-skills.test.ts --maxWorkers=1`
Expected: FAIL on the `detail` text.

- [ ] **Step 2: Change the wording**

In `src/lib/skill-source.ts` replace the comment and the rejection:

```ts
  // The terum-skills skills ship inside this package and are placed by setup; none is a team skill,
  // so discovery never offers one and connect refuses it under any folder name.
  if (isManagedFrontmatter(parsed)) return reject('managed-wrapper', 'a terum-skills skill that ships with terum-skills; not a team skill', 'This folder is a terum-skills skill that ships with terum-skills and is placed by setup; it cannot be connected to a team.');
```

Run: `npx vitest run src/lib/__tests__/local-skills.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 3: Catalogue and commit**

Run the tripwire; replace the two `src/lib/skill-source.ts` rows (`// The /terum-skills Claude Code skill ships inside …` → the new comment's first line, `prose`; the `reject('managed-wrapper', …)` line, `not-a-hint`). Then:

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/lib/skill-source.ts src/lib/__tests__/local-skills.test.ts src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "fix(skill-source): reject any bundled terum-skills skill, not only the manual" -m "The managed-wrapper rejection wording no longer names /terum-skills; the marker already matched under any name." -m "Verified: npx vitest run src/lib/__tests__/local-skills.test.ts src/lib/__tests__/invocation-tripwire.test.ts (green)."
```

---
### Task 3: `setup`, `install`, `cli` — the wording and the offer's tests

**Files:**
- Modify: `src/commands/setup.ts:66, 86, 138, 156, 472-478`
- Modify: `src/commands/install.ts:41`
- Modify: `src/cli.ts:182`
- Modify: `src/lib/__tests__/fixtures.ts` (`bundledNames()`)
- Modify: `src/commands/__tests__/setup.test.ts:31-37, 161, 403, 407, 423-424, 485, 530-531, 557`
- Modify: `src/commands/__tests__/install.test.ts:37-39, 68, 76`
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: `defaultWrapperOptions`, `offerWrapper`, `WrapperOptions` (Task 1) — `setup.ts:478` (`verbs.offerWrapper(io, { ...defaultWrapperOptions(args.home), ...args.wrapper })`) and `install.ts:85` (`wrapper: args.wrapper`) compile unchanged because `WrapperOptions` kept its name and stays all-optional.
- Produces: `bundledNames(): Promise<string[]>` in fixtures — the sorted names of the marked skills under `CANONICAL_SKILLS` (count-agnostic tests through Task 7).

- [ ] **Step 1: Fixture**

Add to `src/lib/__tests__/fixtures.ts` (imports: `readBundledSkills` from `'../wrapper.js'`):

```ts
/** The names the bundle would carry, from the canonical folder: tests written before every skill exists stay true after. */
export async function bundledNames(): Promise<string[]> {
  const bundled = await readBundledSkills(CANONICAL_SKILLS);
  if (bundled === null) throw new Error(`${CANONICAL_SKILLS} holds no marked skill`);
  return [...bundled.keys()].sort();
}
```

- [ ] **Step 2: Update the tests first**

`src/commands/__tests__/setup.test.ts`:

- Replace the `noBundledWrapper` comment block and constant (lines 31–37) with:

```ts
/**
 * Wrapper options for the cases that are not about the skills: a bundle folder that cannot exist, so
 * `offerWrapper` reports 'unavailable', prints one line and asks nothing. Explicit because the default
 * bundle (BUNDLED_SKILLS) is resolved from the package root, so whether it exists depends on whether
 * this checkout happens to have been built — a fixture must never depend on that. `roots` is left to
 * defaultWrapperOptions(home): an unavailable bundle is reported before anything reads them.
 */
const noBundledWrapper = { bundle: join(tmpdir(), `terum-skills-unbundled-${randomUUID()}`) };
/** The first-install question for a home without ~/.codex: the Claude root alone, every bundled name. */
const skillsQuestion = async (home: string) => `Install the terum-skills skills for Claude Code so it can run terum-skills for you? (writes ${join(home, '.claude', 'skills')}/{${(await bundledNames()).join(', ')}})`;
```

  and add `bundledNames` to the fixtures import.
- Lines 161 and 407 (the WELCOME line): `'This wizard helps you create a team, join one, invite teammates, and offer the session hook and the terum-skills skills for Claude Code and Codex; re-run it any time to continue, and leave the invitation question blank to skip it.'`.
- Line 403: `await skillsQuestion(home),`.
- Lines 423–424:

```ts
    for (const name of await bundledNames()) expect(await readFile(join(home, '.claude', 'skills', name, 'SKILL.md'), 'utf8')).toBe(await readFile(join(CANONICAL_SKILLS, name, 'SKILL.md'), 'utf8'));
    expect(io.lines).toContain(`No ${join(home, '.codex')} on this machine; Codex skills skipped.`);
    expect(io.lines).toContain(`Installed the terum-skills skills at ${join(home, '.claude', 'skills')}: ${(await bundledNames()).join(', ')}.`);
```

  (`CANONICAL_SKILLS` joins the fixtures import.)
- Line 485: `expect(io.countAsked('Install the terum-skills skills')).toBe(1);` and the line after it: `expect(await exists(join(home, '.claude', 'skills', 'terum-skills', 'SKILL.md'))).toBe(true);` stays.
- Lines 530–531: `await skillsQuestion(home), await skillsQuestion(joinHome),`.
- Line 557: `expect(io.lines.join('\n')).toContain('The terum-skills skills are not bundled in this copy of terum-skills');`.

`src/commands/__tests__/install.test.ts`:

- Lines 37–39:

```ts
      // The bundle is resolved from the package root (W-02), so whether it exists depends on whether this
      // checkout was built; an unavailable bundle keeps the skills step from asking and makes the case build-independent.
      const wrapper = { roots: managedSkillRoots(home, {}), bundle: join(fixture.root, 'no-bundle') };
```

  with `import { managedSkillRoots } from '../../lib/wrapper.js';`.
- Line 68 comment: `// Identity: GitHub login and handle default to gh's login, then name and email; the §8 hook offer and the terum-skills skills offer are declined.`
- Line 76: `expect(io.countAsked('Install the terum-skills skills')).toBe(1);` (line 77's ENOENT check on `terum-skills/SKILL.md` stays: declined writes nothing).

`src/__tests__/m3-setup-walkthrough.test.ts:29` needs no change (`wrapperFor(home)` keeps its shape; the walkthrough declines the one question).

Run: `npx vitest run src/commands/__tests__/setup.test.ts src/commands/__tests__/install.test.ts --maxWorkers=1`
Expected: FAIL on the WELCOME line and the question text (the source still says "/terum-skills Claude Code skill"); type errors from `noBundledWrapper.bundle` are gone once Step 1's import lands.

- [ ] **Step 3: Source wording**

`src/commands/setup.ts`:
- line 66: `/** Where the bundled terum-skills skills are offered from and placed (test knob). */`
- line 86: `'This wizard helps you create a team, join one, invite teammates, and offer the session hook and the terum-skills skills for Claude Code and Codex; re-run it any time to continue, and leave the invitation question blank to skip it.',`
- line 138: `` `Setup stopped here, so the project, eval, session hook and terum-skills skills steps were not offered — run \`${invocation(form, 'setup')}\` again to finish.`, ``
- line 156: the `wrapper: 'Wrapper'` title becomes `wrapper: 'Skills'`.
- lines 472–476, the comment above `section('wrapper')`:

```ts
    // The terum-skills skills ship inside this package, and setup is the one onboarding step
    // (npm-first, Ryan 2026-09-08), so the skills that let Claude Code and Codex run these verbs are
    // offered here, right after the hook and in the hook's shape: one offer with its own y/N on the same
    // io, copies the tool recognises by their frontmatter marker (refreshed or added on a re-run without
    // asking, removed by machine uninstall), and anything else at a destination left alone (src/lib/wrapper.ts).
```

`src/commands/install.ts:41`: `/** Where that bootstrap offers the bundled terum-skills skills (test knob). */`

`src/cli.ts:182`: the `uninstall` description becomes `'Remove terum-skills from this machine: your team (placed skills, local clone, cache), the session-start hook and the terum-skills skills for Claude Code and Codex if present, and ~/.terum/skills except recovery data; then prints the package-manager step'`.

Run: `npx vitest run src/commands/__tests__/setup.test.ts src/commands/__tests__/install.test.ts src/__tests__/m3-setup-walkthrough.test.ts src/__tests__/cli.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 4: Catalogue and commit**

Run the tripwire; replace the `src/commands/setup.ts` rows (the test-knob comment, the WELCOME line, the `Setup stopped here` line, the new comment's first line `// The terum-skills skills ship inside this package, and setup is the one onboarding step` — all `prose`), the `src/commands/install.ts` row (`prose`), and the `src/cli.ts` uninstall description row (`prose`).

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/commands/setup.ts src/commands/install.ts src/cli.ts src/lib/__tests__/fixtures.ts src/commands/__tests__/setup.test.ts src/commands/__tests__/install.test.ts src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "feat(setup): offer the terum-skills skills for Claude Code and Codex" -m "Setup, install's bootstrap and the uninstall help text name the skill set instead of the single /terum-skills skill; the tests read the bundled names from the canonical folder so they stay true as skills are added." -m "Verified: npx vitest run src/commands/__tests__/setup.test.ts src/commands/__tests__/install.test.ts src/__tests__/m3-setup-walkthrough.test.ts src/__tests__/cli.test.ts src/lib/__tests__/invocation-tripwire.test.ts (green)."
```

---

### Task 4: the session hook adds and refreshes the skills

**Files:**
- Modify: `src/commands/refresh.ts:22, 36-37, 161-164` (line numbers after PR #206; `const notices: string[] = []` is already declared at line 112 — do not redeclare it)
- Modify: `src/commands/__tests__/refresh.test.ts`
- Modify: `src/lib/__tests__/execute.test.ts:37-41`
- Modify: `docs/frame-protocol.md:413-415`
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: `defaultWrapperOptions`, `refreshManagedSkills`, `WrapperOptions` (Task 1).
- Produces: `SyncArgs.wrapper?: WrapperOptions`; the notice `Updated your terum-skills skills for this CLI.` (routed to stderr by `src/lib/execute.ts` exactly as the old notice was; nothing changes there).

- [ ] **Step 1: Write the failing test**

Add to `src/commands/__tests__/refresh.test.ts` (imports: `mkdir`, `readFile`, `writeFile` are already there; add `listManagedSkills`, `readBundledSkills` from `'../../lib/wrapper.js'` and `CANONICAL_SKILLS`, `wrapperFor`, `temporaryDirectory` from fixtures — `temporaryDirectory` is already imported):

```ts
  it('in hook mode adds and refreshes the bundled skills only where a managed copy already exists, says so once, and never touches them outside hook mode', async () => {
    const OLD_COPY = '---\nname: terum-skills\ndescription: an older bundled copy\nmetadata:\n  managed-by: terum-skills\n---\nold body\n';
    const { store } = await setup(['a']);
    const home = await temporaryDirectory('terum-hook-home-'); await mkdir(join(home, '.claude'), { recursive: true });
    const wrapper = wrapperFor(home); const claude = wrapper.roots[0]!.root;
    const bundled = (await readBundledSkills(CANONICAL_SKILLS))!;
    // No managed copy anywhere: consent is not on record, so the hook writes nothing and says nothing.
    const silent = await run({ config: store, hook: true, wrapper }, new ScriptedPrompter());
    expect(silent).toMatchObject({ ok: true, value: { notices: [] } });
    expect(await listManagedSkills(claude)).toEqual([]);
    // An old single copy: the manual is refreshed and the other skills added, with one notice on the hook's stderr channel.
    await mkdir(join(claude, 'terum-skills'), { recursive: true }); await writeFile(join(claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    const io = new ScriptedPrompter();
    const outcome = await run({ config: store, hook: true, wrapper }, io);
    expect(io.lines).toEqual(['{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}']);
    expect(outcome).toMatchObject({ ok: true, value: { notices: ['Updated your terum-skills skills for this CLI.'] } });
    expect((await listManagedSkills(claude)).map((skill) => skill.name)).toEqual([...bundled.keys()].sort());
    expect(await readFile(join(claude, 'terum-skills', 'SKILL.md'), 'utf8')).toBe(bundled.get('terum-skills'));
    expect(await listManagedSkills(wrapper.roots[1]!.root)).toEqual([]);
    // Current copies: no notice (the clone is `fresh` now — hook mode left it alone, which adds no notice either). Plain sync: never a skills write, even with an outdated copy.
    expect(await run({ config: store, hook: true, wrapper }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { notices: [], teams: [{ team: 'a', state: 'fresh' }] } });
    await writeFile(join(claude, 'terum-skills', 'SKILL.md'), OLD_COPY);
    expect(await run({ config: store, wrapper }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { notices: [] } });
    expect(await readFile(join(claude, 'terum-skills', 'SKILL.md'), 'utf8')).toBe(OLD_COPY);
  });
```

Run: `npx vitest run src/commands/__tests__/refresh.test.ts --maxWorkers=1`
Expected: FAIL — `wrapper` is not a `SyncArgs` field (type error) / the notice text differs.

- [ ] **Step 2: Implement**

`src/commands/refresh.ts`:
- line 22: `import { defaultWrapperOptions, refreshManagedSkills, type WrapperOptions } from '../lib/wrapper.js';`
- in `SyncArgs`, replace the `hook?` comment and add the knob:

```ts
  /** Session-start hook mode; it may add or refresh only Terum's managed bundled skills. */
  hook?: boolean;
  /** Test knob: where the bundled skills are read from and placed; defaults to defaultWrapperOptions(). */
  wrapper?: WrapperOptions;
```

- lines 161–164 (the `if (args.hook && await wrapperState(defaultWrapperOptions()) === 'outdated') { … }` block; `notices` was declared at line 112 and already holds the fetch-stamp notices):

```ts
    if (args.hook) {
      const written = await refreshManagedSkills({ ...defaultWrapperOptions(), ...args.wrapper });
      if (written.length) notices.push('Updated your terum-skills skills for this CLI.');
    }
```

`src/lib/__tests__/execute.test.ts:37-41`: replace the four occurrences of `'Updated your /terum-skills manual for this CLI.'` with `'Updated your terum-skills skills for this CLI.'` (sample data for the notice-routing test; the routing is unchanged).

`docs/frame-protocol.md:413-415`:

```
`--hook` is the session-start entry and must never be driven over frames (rule 2). It is also the one
carve-out from "nothing on this machine is changed": in a skills root that already holds one of Terum's
own bundled skills it may replace an outdated copy and add a missing one (`~/.claude/skills/<name>`,
`~/.codex/skills/<name>`), and nothing else.
```

Run: `npx vitest run src/commands/__tests__/refresh.test.ts src/lib/__tests__/execute.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 3: Catalogue and commit**

Run the tripwire: replace the `src/commands/refresh.ts` notice row (`not-a-hint`), drop the `docs/frame-protocol.md` row for the old `/terum-skills` manual line (the new sentence carries no package literal or verb span; if the tripwire reports a new `docs/frame-protocol.md` line, add it as `prose`).

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/commands/refresh.ts src/commands/__tests__/refresh.test.ts src/lib/__tests__/execute.test.ts docs/frame-protocol.md src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "feat(sync): the session hook adds and refreshes the bundled skills where consent is on record" -m "sync --hook writes every missing bundled skill and replaces every outdated one in a root that already holds a managed copy, and reports one notice; SyncArgs gains the wrapper knob." -m "Verified: npx vitest run src/commands/__tests__/refresh.test.ts src/lib/__tests__/execute.test.ts src/lib/__tests__/invocation-tripwire.test.ts (green)."
```

---

### Task 5: machine uninstall — inventory and removal per root; bin/bundle tests; full gates

**Files:**
- Modify: `src/commands/uninstallMachine.ts:7, 18, 34-39, 67-68, 93-97, 179`
- Modify: `src/commands/__tests__/uninstallMachine.test.ts:6, 10, 25, 45-82, 236-246`
- Modify: `src/__tests__/bin.test.ts:87-99`
- Modify: `src/__tests__/bundle.test.ts` (the `resolves the bundled wrapper SKILL.md` case)
- Modify: `desktop/GAPS.md` (one added line)
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: `defaultWrapperOptions`, `managedSkillInventory`, `ManagedInventory`, `removeManagedSkill`, `readBundledSkills`, `installManagedSkill`, `WrapperOptions` (Task 1); `bundledNames`, `CANONICAL_SKILLS`, `wrapperFor` (fixtures).
- Produces: `MachineUninstallResult.wrappersRemoved: string[]` (additive; `wrapperRemoved` stays a boolean = `wrappersRemoved.length > 0`).

- [ ] **Step 1: Update the uninstall tests**

`src/commands/__tests__/uninstallMachine.test.ts`:
- line 6: `import { installManagedSkill, readBundledSkills } from '../../lib/wrapper.js';`
- line 10: add `bundledNames`, `CANONICAL_SKILLS` to the fixtures import.
- line 25 (inside `prepared`): replace `const wrapper = wrapperFor(join(fixture.root, 'home')); await installWrapper(wrapper);` with

```ts
  const home = join(fixture.root, 'home'); await mkdir(join(home, '.codex'), { recursive: true });
  const wrapper = wrapperFor(home); const claude = wrapper.roots[0]!.root, codex = wrapper.roots[1]!.root;
  for (const [name, raw] of (await readBundledSkills(CANONICAL_SKILLS))!) await installManagedSkill(claude, name, raw);
```

  and return `claude, codex` from `prepared` alongside `wrapper`.
- The first case (lines 45–63): destructure `claude, codex` too; delete the `wrapperDir` line; expect `wrapperRemoved: true` and `wrappersRemoved: (await bundledNames()).map((name) => join(claude, name))` in the `toMatchObject`; replace `await gone(wrapperDir);` with `for (const name of await bundledNames()) await gone(join(claude, name));`; replace the two wrapper assertions at the end with

```ts
    const names = (await bundledNames()).join(', ');
    expect(io.details['Remove terum-skills from this machine?']).toContain(`  terum-skills skills in ${claude}: ${names}`);
    expect(io.details['Remove terum-skills from this machine?']).toContain(`  No terum-skills skills in ${codex}`);
    expect(io.lines).toContain(`Removed the terum-skills skills from ${claude}: ${names}.`);
```

- The second case (lines 68–74) becomes:

```ts
  it('leaves a folder at a bundled name that is not the bundled skill alone, says so, and still removes the copies that are ours', async () => {
    const { store, hook, wrapper, claude } = await prepared(); const theirs = join(claude, 'terum-skills');
    const someoneElses = '---\nname: terum-skills\ndescription: someone else\'s skill under our name\n---\n'; await writeFile(join(theirs, 'SKILL.md'), someoneElses);
    const io = new ScriptedPrompter([], [true]); const result = await run({ config: store, hook, wrapper }, io);
    const ours = (await bundledNames()).filter((name) => name !== 'terum-skills');
    expect(result).toMatchObject({ ok: true, value: { teams: ['team'], wrapperRemoved: ours.length > 0, wrappersRemoved: ours.map((name) => join(claude, name)) } });
    expect(await readFile(join(theirs, 'SKILL.md'), 'utf8')).toBe(someoneElses);
    expect(io.details['Remove terum-skills from this machine?']).toContain(`  ${theirs} is not a bundled terum-skills skill (it is a different skill); left alone`);
  });
```

- The third case (lines 78–82):

```ts
  it('reports no skills on a machine that never had them', async () => {
    const { store, hook } = await minimal(); const wrapper = wrapperFor(join(store.root, '..', 'home'));
    const io = new ScriptedPrompter([], [true]);
    expect(await run({ config: store, hook, wrapper }, io)).toMatchObject({ ok: true, value: { wrapperRemoved: false, wrappersRemoved: [] } });
    for (const root of wrapper.roots) expect(io.details['Remove terum-skills from this machine?']).toContain(`  No terum-skills skills in ${root.root}`);
  });
```

- Lines 236–246 (the full-detail `toEqual`): replace the `/terum-skills Claude Code skill at …` entry with the two entries `` `  terum-skills skills in ${claude}: ${(await bundledNames()).join(', ')}` `` and `` `  No terum-skills skills in ${codex}` `` (destructure `claude, codex` from `prepared(['team', 'other'])` at line 230).

Run: `npx vitest run src/commands/__tests__/uninstallMachine.test.ts --maxWorkers=1`
Expected: FAIL (type errors on the removed wrapper exports and the missing `wrappersRemoved`).

- [ ] **Step 2: Implement**

`src/commands/uninstallMachine.ts`:
- line 7: `import { defaultWrapperOptions, type ManagedInventory, managedSkillInventory, removeManagedSkill, type WrapperOptions } from '../lib/wrapper.js';`
- line 18: after `wrapperRemoved: boolean;` insert `/** The bundled skill folders removed, per host root; `wrapperRemoved` is their non-emptiness (the desktop reads the boolean). */ wrappersRemoved: string[];`
- lines 34–39:

```ts
    // The terum-skills skills setup placed under each host's skills root: only a copy carrying our marker is ours to remove.
    const wrapper = { ...defaultWrapperOptions(args.home), ...args.wrapper };
    let skills: ManagedInventory;
    try { skills = await managedSkillInventory(wrapper); }
    catch (error) { return failure(`${message(error)}; nothing was removed`); }
```

- lines 67–68:

```ts
    for (const root of skills.roots) {
      detail.push(root.managed.length ? `  terum-skills skills in ${root.root}: ${root.managed.map((skill) => skill.name).join(', ')}` : `  No terum-skills skills in ${root.root}`);
      for (const entry of root.foreign) detail.push(`  ${entry.directory} is not a bundled terum-skills skill (${entry.why}); left alone`);
    }
```

- lines 93–97:

```ts
    const wrappersRemoved: string[] = [];
    for (const root of skills.roots) {
      const removed: string[] = [];
      for (const skill of root.managed) {
        try { if ((await removeManagedSkill(root.root, skill.name)) === 'removed') { removed.push(skill.name); wrappersRemoved.push(skill.directory); } }
        catch (error) { return failure(`${message(error)}; removing the terum-skills skills stopped at ${skill.directory} and the teams were left in place`); }
      }
      if (removed.length) io.print(`Removed the terum-skills skills from ${root.root}: ${removed.join(', ')}.`);
    }
    const wrapperRemoved = wrappersRemoved.length > 0;
```

- line 179: `return success({ teams, removedPlacements, hookRemoved, wrapperRemoved, wrappersRemoved, configRemoved, kept, record, advice, launch: args.launch ?? null });`

Run: `npx vitest run src/commands/__tests__/uninstallMachine.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 3: bin and bundle tests, count-agnostic**

`src/__tests__/bin.test.ts`, the case at lines 87–99, becomes (add `import { readBundledSkills } from '../lib/wrapper.js';` and `CANONICAL_SKILLS` from `'../lib/__tests__/fixtures.js'` to the imports; `mkdir` is already imported by the file — check, add if not):

```ts
  it('the build bundles every marked canonical skill where the built wrapper module resolves it, byte for byte, markers intact', async () => {
    const bundle = await run(process.execPath, [resolve(root, 'scripts', 'bundle-skill.mjs'), '--out', resolve(out, 'dist')], { cwd: root });
    const canonical = (await readBundledSkills(CANONICAL_SKILLS))!;
    const names = [...canonical.keys()].sort();
    const bundled = (name: string) => resolve(out, 'dist', 'claude', 'skills', name, 'SKILL.md');
    expect(bundle.stderr.trim().split('\n')).toEqual(names.map((name) => `Bundled ${resolve(root, '.claude', 'skills', name, 'SKILL.md')} -> ${bundled(name)}`));
    for (const name of names) expect(await readFile(bundled(name), 'utf8'), name).toBe(canonical.get(name));
    const wrapper = await import(pathToFileURL(resolve(out, 'dist', 'lib', 'wrapper.js')).href) as typeof import('../lib/wrapper.js');
    expect(wrapper.BUNDLED_SKILLS).toBe(resolve(out, 'dist', 'claude', 'skills'));
    const fromDist = await wrapper.readBundledSkills(wrapper.BUNDLED_SKILLS);
    expect(fromDist && [...fromDist.keys()].sort()).toEqual(names);
    const home = resolve(out, 'bundle-home'); await mkdir(resolve(home, '.codex'), { recursive: true });
    const options = wrapper.defaultWrapperOptions(home, {});
    expect(options.roots).toEqual([{ host: 'claude', root: resolve(home, '.claude', 'skills') }, { host: 'codex', root: resolve(home, '.codex', 'skills') }]);
    expect(await wrapper.refreshManagedSkills(options)).toEqual([]);
    for (const name of names) expect(await wrapper.installManagedSkill(options.roots[0]!.root, name, fromDist!.get(name)!)).toBe('installed');
    for (const name of names) expect(await readFile(resolve(home, '.claude', 'skills', name, 'SKILL.md'), 'utf8')).toBe(canonical.get(name));
    expect(await wrapper.refreshManagedSkills(options)).toEqual([]);
    expect((await wrapper.listManagedSkills(options.roots[1]!.root))).toEqual([]);
  });
```

`src/__tests__/bundle.test.ts`: replace the `resolves the bundled wrapper SKILL.md` case with (add `readBundledSkills` from `'../lib/wrapper.js'` and `CANONICAL_SKILLS` to the fixtures import; keep the file's dense style):

```ts
  it('resolves every bundled skill byte for byte',async()=>{const canonical=(await readBundledSkills(CANONICAL_SKILLS))!;expect(canonical.size).toBeGreaterThan(0);for(const [name,raw] of canonical)expect(await readFile(join(out,'dist/claude/skills',name,'SKILL.md'),'utf8'),name).toBe(raw);expect(JSON.stringify(await framed(['status']))).not.toMatch(/wrapper source missing/i);});
```

With the old bundler (one skill) and the canonical folder holding one marked skill, both pass now and keep passing as Tasks 6–8 add skills.

- [ ] **Step 4: `desktop/GAPS.md`**

Append one line at the end of the file:

```
- MachineRemovalHost labels `wrapperRemoved` "/terum-skills skill"; since the CLI's skill-dashboard work (2026-09-13) machine uninstall removes up to eight bundled skills per host root (`~/.claude/skills`, `~/.codex/skills`) and names them in the additive `wrappersRemoved: string[]`; the label and the list are a desktop follow-up.
```

- [ ] **Step 5: Catalogue, full gates, commit**

Run the tripwire; replace the nine `src/commands/uninstallMachine.ts` rows: the comment (`prose`), `detail.push('terum-skills will be removed from this machine.');` (unchanged, keep), the two inventory `detail.push` lines and the foreign line (`not-a-hint`), the membership line (unchanged, keep), the confirm and record lines (unchanged, keep), the `failure(…removing the terum-skills skills stopped at…)` line and the `io.print(\`Removed the terum-skills skills from…\`)` line (`not-a-hint`).

Full gates (foreground; wait for load < 8 first):

```bash
cut -d' ' -f1 /proc/loadavg
NODE_OPTIONS=--dns-result-order=ipv4first timeout 600 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard run lint && NODE_OPTIONS=--dns-result-order=ipv4first timeout 600 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard run typecheck && NODE_OPTIONS=--dns-result-order=ipv4first timeout 900 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard test -- --maxWorkers=4
```

Expected: all green — the typecheck failures of Tasks 1–4 are gone (every importer of the removed exports is updated), `bin.test.ts`/`bundle.test.ts` pass with the one marked skill.

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/commands/uninstallMachine.ts src/commands/__tests__/uninstallMachine.test.ts src/__tests__/bin.test.ts src/__tests__/bundle.test.ts desktop/GAPS.md src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "feat(uninstall): inventory and remove the bundled skills per host root" -m "Machine uninstall lists every managed copy under ~/.claude/skills and ~/.codex/skills (and foreign folders at bundled names, left alone), removes the copies after the hook, and reports wrappersRemoved beside the boolean the desktop reads. bin and bundle tests read the bundled set from the canonical folder." -m "Verified: npm run lint, npm run typecheck, npm test -- --maxWorkers=4 (all green, load < 8 at start)."
```

---
### Task 6: `scripts/bundle-skill.mjs` — bundle every marked skill after validating it; the tarball-list test

**Files:**
- Rewrite: `scripts/bundle-skill.mjs`
- Modify: `.claude/skills/terum-skills/SKILL.md` (frontmatter only: `metadata.short-description`)
- Create: `src/__tests__/release-tarball-list.test.ts`
- Modify: `src/__tests__/bin.test.ts` (one new case for the bundler's refusals)

**Interfaces:**
- Consumes: the marker regex and `FRONTMATTER` shape (`src/lib/schema.ts:334`), `isManagedSkill` (Task 1) in the test.
- Produces: `dist/claude/skills/<name>/SKILL.md` for every marked canonical skill; one stderr line per file `Bundled <src> -> <dst>` in folder-name order; exit 1 with one line per problem and a final `N problem(s); nothing bundled.` line; the `dist/claude/skills` folder is emptied before bundling.

- [ ] **Step 1: The manual gains `short-description`**

In `.claude/skills/terum-skills/SKILL.md`, the frontmatter's `metadata:` block becomes

```yaml
metadata:
  managed-by: terum-skills
  short-description: "Run any terum-skills verb from a session"
```

(Task 8 rewrites the whole file; this keeps the bundler's contract satisfied in between.)

- [ ] **Step 2: Write the failing tests**

Add to `src/__tests__/bin.test.ts`, after the bundle case from Task 5 (imports: `writeFile`, `mkdir`, `rm` from `node:fs/promises` — add any missing):

```ts
  it('the bundler refuses a marked skill whose frontmatter breaks the contract, names every problem, and bundles nothing', async () => {
    const scratch = resolve(out, 'bundler-scratch'); await rm(scratch, { recursive: true, force: true });
    const skills = resolve(scratch, '.claude', 'skills');
    const write = async (folder: string, raw: string) => { await mkdir(resolve(skills, folder), { recursive: true }); await writeFile(resolve(skills, folder, 'SKILL.md'), raw); };
    await write('good', '---\nname: good\ndescription: "quoted: fine"\nmetadata:\n  managed-by: terum-skills\n  short-description: "Good"\n---\nbody\n');
    await write('review-tool', '---\nname: review-tool\ndescription: not ours\n---\nbody\n');
    await write('misnamed', '---\nname: other\ndescription: "x"\nmetadata:\n  managed-by: terum-skills\n  short-description: "x"\n---\n');
    await write('bare', '---\nname: bare\ndescription: bare scalar\nmetadata:\n  managed-by: terum-skills\n  short-description: "x"\n---\n');
    await write('extra', '---\nname: extra\ndescription: "x"\nlicense: MIT\nmetadata:\n  managed-by: terum-skills\n  short-description: "x"\n---\n');
    await write('short', '---\nname: short\ndescription: "x"\nmetadata:\n  managed-by: terum-skills\n---\n');
    await write('broken', '---\nname: [\nmetadata:\n  managed-by: terum-skills\n---\n');
    const script = await readFile(resolve(root, 'scripts', 'bundle-skill.mjs'), 'utf8');
    // The script resolves its sources from its own location; run a copy planted beside the scratch tree.
    await mkdir(resolve(scratch, 'scripts'), { recursive: true }); await writeFile(resolve(scratch, 'scripts', 'bundle-skill.mjs'), script);
    await symlink(resolve(root, 'node_modules'), resolve(scratch, 'node_modules'), 'dir');
    const attempt = await run(process.execPath, [resolve(scratch, 'scripts', 'bundle-skill.mjs'), '--out', resolve(scratch, 'dist')], { cwd: scratch }).then(() => null, (error: { code: number; stderr: string }) => error);
    expect(attempt?.code).toBe(1);
    const lines = attempt!.stderr.trim().split('\n');
    expect(lines.at(-1)).toBe('5 problems; nothing bundled.');
    expect(lines.filter((line) => line.startsWith(resolve(skills, 'misnamed', 'SKILL.md')))).toEqual([`${resolve(skills, 'misnamed', 'SKILL.md')}: name must equal the folder name misnamed (found "other")`]);
    expect(lines.filter((line) => line.startsWith(resolve(skills, 'bare', 'SKILL.md')))).toEqual([`${resolve(skills, 'bare', 'SKILL.md')}: description must be a quoted or block scalar (HYG1: a bare scalar with a colon breaks YAML readers)`]);
    expect(lines.filter((line) => line.startsWith(resolve(skills, 'extra', 'SKILL.md')))).toEqual([`${resolve(skills, 'extra', 'SKILL.md')}: top-level key license is not allowed (only name, description, metadata)`]);
    expect(lines.filter((line) => line.startsWith(resolve(skills, 'short', 'SKILL.md')))).toEqual([`${resolve(skills, 'short', 'SKILL.md')}: metadata.short-description is required (Codex reads it)`]);
    expect(lines.filter((line) => line.startsWith(resolve(skills, 'broken', 'SKILL.md')))).toHaveLength(1);
    expect(lines.some((line) => line.includes('review-tool'))).toBe(false);
    await expect(access(resolve(scratch, 'dist', 'claude', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    // With the faulty files gone, the good one bundles, the unmarked one is skipped, and a stale bundled folder is cleared.
    for (const folder of ['misnamed', 'bare', 'extra', 'short', 'broken']) await rm(resolve(skills, folder), { recursive: true });
    await mkdir(resolve(scratch, 'dist', 'claude', 'skills', 'stale'), { recursive: true }); await writeFile(resolve(scratch, 'dist', 'claude', 'skills', 'stale', 'SKILL.md'), 'old');
    const ok = await run(process.execPath, [resolve(scratch, 'scripts', 'bundle-skill.mjs'), '--out', resolve(scratch, 'dist')], { cwd: scratch });
    expect(ok.stderr.trim()).toBe(`Bundled ${resolve(skills, 'good', 'SKILL.md')} -> ${resolve(scratch, 'dist', 'claude', 'skills', 'good', 'SKILL.md')}`);
    expect(await readdir(resolve(scratch, 'dist', 'claude', 'skills'))).toEqual(['good']);
  });
```

(`access`, `readdir`, `symlink` join the `node:fs/promises` import if absent. `run` is the file's promisified `execFile`; a non-zero exit rejects with `{ code, stderr }`.)

Create `src/__tests__/release-tarball-list.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isManagedSkill } from '../lib/wrapper.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

/** The paths the release workflow refuses to publish without: parsed out of the literal array in release.yml. */
async function mustList(): Promise<string[]> {
  const workflow = await readFile(resolve(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const match = /for \(const must of (\[[^\]]*\])\)/.exec(workflow);
  if (!match) throw new Error('release.yml no longer carries the tarball must-list (`for (const must of [...])`)');
  return JSON.parse(match[1]!) as string[];
}

/** Every marked skill under .claude/skills — what scripts/bundle-skill.mjs bundles. */
async function markedSkills(): Promise<string[]> {
  const skills = resolve(root, '.claude', 'skills');
  const names: string[] = [];
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try { raw = await readFile(resolve(skills, entry.name, 'SKILL.md'), 'utf8'); } catch (error) { if (isMissing(error)) continue; throw error; }
    if (isManagedSkill(raw)) names.push(entry.name);
  }
  return names.sort();
}

it('the release tarball must-list names every marked skill under .claude/skills, nothing else under dist/claude/skills, and the fixed files', async () => {
  const must = await mustList();
  const marked = await markedSkills();
  expect(marked.length).toBeGreaterThan(0);
  expect(must.filter((path) => path.startsWith('dist/claude/skills/')).sort()).toEqual(marked.map((name) => `dist/claude/skills/${name}/SKILL.md`));
  for (const fixed of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js']) expect(must).toContain(fixed);
});
```

Run: `npx vitest run src/__tests__/bin.test.ts src/__tests__/release-tarball-list.test.ts --maxWorkers=1`
Expected: the release-list test PASSES already (one marked skill, one listed path); the new bin case FAILS (the old script bundles the single fixed path and knows no problems list).

- [ ] **Step 3: Rewrite the bundler**

`scripts/bundle-skill.mjs`:

```js
#!/usr/bin/env node
// Bundle the terum-skills skills into the build output. Reports on stderr: this runs under prepack,
// and `npm pack --json` output must stay parseable.
//
// The canonical copies are .claude/skills/<name>/SKILL.md — the files this repository's own Claude
// Code harness loads. npm cannot ship them from there (listing a dot-directory in `files` also drags
// the harness README and the review tools along), so `npm run build` copies every file carrying the
// `metadata.managed-by: terum-skills` marker, byte for byte, to dist/claude/skills/<name>/SKILL.md,
// where src/lib/wrapper.ts resolves them from dist/lib. Unmarked skills (the review tools) are never
// bundled. A marked file is checked here because setup and uninstall recognise their copies by the
// marker, Codex reads `metadata.short-description`, and an unquoted description is the HYG1 defect
// that would keep the skill from ever being shared.
//
//   node scripts/bundle-skill.mjs [--out <dist-dir>]
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : join(root, 'dist');
const sources = join(root, '.claude', 'skills');
const target = join(out, 'claude', 'skills');
const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MARKER = /^\s+managed-by:\s*terum-skills\s*$/m;
const QUOTED_OR_BLOCK_DESCRIPTION = /^description:[ \t]*(["'|>])/m;
const ALLOWED_KEYS = ['name', 'description', 'metadata'];
const ALLOWED_METADATA = ['managed-by', 'short-description'];

const problems = [];
const bundled = [];
const entries = (await readdir(sources, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
for (const entry of entries) {
  const source = join(sources, entry.name, 'SKILL.md');
  let raw;
  try { raw = await readFile(source, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const match = FRONTMATTER.exec(raw);
  if (!match || !MARKER.test(match[1])) continue;
  const fail = (why) => problems.push(`${source}: ${why}`);
  let parsed;
  try { parsed = YAML.parse(match[1]); } catch (error) { fail(`frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`); continue; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { fail('frontmatter must be a mapping'); continue; }
  if (parsed.name !== entry.name) fail(`name must equal the folder name ${entry.name} (found ${JSON.stringify(parsed.name)})`);
  if (typeof parsed.description !== 'string' || !parsed.description.trim()) fail('description is required');
  else if (!QUOTED_OR_BLOCK_DESCRIPTION.test(match[1])) fail('description must be a quoted or block scalar (HYG1: a bare scalar with a colon breaks YAML readers)');
  for (const key of Object.keys(parsed)) if (!ALLOWED_KEYS.includes(key)) fail(`top-level key ${key} is not allowed (only ${ALLOWED_KEYS.join(', ')})`);
  const metadata = parsed.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('metadata must be a mapping');
  else {
    if (metadata['managed-by'] !== 'terum-skills') fail('metadata.managed-by must be terum-skills; setup could not recognise its own copy without it');
    if (typeof metadata['short-description'] !== 'string' || !metadata['short-description'].trim()) fail('metadata.short-description is required (Codex reads it)');
    for (const key of Object.keys(metadata)) if (!ALLOWED_METADATA.includes(key)) fail(`metadata key ${key} is not allowed (only ${ALLOWED_METADATA.join(', ')})`);
  }
  bundled.push({ name: entry.name, source, raw });
}
if (!bundled.length && !problems.length) problems.push(`${sources}: no SKILL.md carries metadata.managed-by: terum-skills; nothing to bundle`);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing bundled.`);
  process.exit(1);
}
// The folder is entirely this script's: a skill removed from the set must not linger in dist/ from an earlier build.
await rm(target, { recursive: true, force: true });
for (const skill of bundled) {
  const destination = join(target, skill.name, 'SKILL.md');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, skill.raw);
  console.error(`Bundled ${skill.source} -> ${destination}`);
}
```

Note the `misnamed` fixture in Step 2 reports one problem (the name) and the `broken` fixture one (YAML), `bare` one, `extra` one, `short` one — five in total, matching `5 problems; nothing bundled.`. Every problem for one file is reported (no early `continue` after the first) so an author fixes a file once.

Run: `npx vitest run src/__tests__/bin.test.ts src/__tests__/bundle.test.ts src/__tests__/release-tarball-list.test.ts --maxWorkers=1`
Expected: PASS. Also run `node /home/teniroo/Projects/terum-skills-codex/skill-dashboard/scripts/bundle-skill.mjs --out /tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/bundle-check` and confirm exactly one `Bundled …/terum-skills/SKILL.md -> …` line and exit 0. `npx eslint scripts/bundle-skill.mjs` clean.

- [ ] **Step 4: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add scripts/bundle-skill.mjs .claude/skills/terum-skills/SKILL.md src/__tests__/bin.test.ts src/__tests__/release-tarball-list.test.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "build(bundle): bundle every marked skill after validating its frontmatter" -m "scripts/bundle-skill.mjs scans .claude/skills, refuses a marked file whose name, description scalar, keys or short-description break the contract (every problem listed), clears dist/claude/skills and copies the rest byte for byte. release-tarball-list.test.ts pins release.yml's must-list to the marked set." -m "Verified: npx vitest run src/__tests__/bin.test.ts src/__tests__/bundle.test.ts src/__tests__/release-tarball-list.test.ts (green); node scripts/bundle-skill.mjs --out <scratch> (one Bundled line, exit 0); eslint scripts/bundle-skill.mjs (clean)."
```

---
### Task 7: the seven named skills; the release must-list

**Files:**
- Create: `.claude/skills/list-skills/SKILL.md`, `.claude/skills/skill-info/SKILL.md`, `.claude/skills/search-skills/SKILL.md`, `.claude/skills/eval/SKILL.md`, `.claude/skills/eval-report/SKILL.md`, `.claude/skills/skill-status/SKILL.md`, `.claude/skills/sync-skills/SKILL.md`
- Modify: `.github/workflows/release.yml:160`
- Modify: `src/__tests__/release-tarball-list.test.ts` (pin the eight names)

**Interfaces:**
- Consumes: the `--format md` boards and their **Next:** line (Plan 1), `ls skill <name>` (Plan 1 Task 9), the autofill ladder (Plan 1 Task 8: a name, a unique prefix, or nothing inside a Library skill folder), the bundler contract (Task 6).
- Produces: seven marked skills whose bodies share two verbatim blocks — **Rules** and **Sandbox** below — that Task 9's test pins character for character. The manual (Task 8) carries the same two blocks.

The two shared blocks, verbatim (copy them exactly, including the final newline after the last bullet/sentence):

````markdown
## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.
````

````markdown
## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

(Task 10 verifies `--prefer-offline` against a warm cache before this ships; if the check fails, Task 10 replaces the block's first sentence in all eight files and in the test constant.)

- [ ] **Step 1: `.claude/skills/list-skills/SKILL.md`**

````markdown
---
name: list-skills
description: "List the skills on this machine (your Library) and the skills your team shares (the Marketplace) as Markdown boards from the terum-skills CLI. Use when the user asks what skills they have, what the team shares, what is installed, edited, untracked or missing an eval, or wants an overview of their terum-skills state."
metadata:
  managed-by: terum-skills
  short-description: "List your local skills and the team's shared skills"
---

Show the user's skills as boards. The terum-skills CLI renders them with `--format md`; the board it prints is the answer.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"). `--local` shows only your Library, `--team` only the team Marketplace, and `--team <name>` names a configured team (passed through unchanged); with no arguments show both.

## Command

Run with your shell tool, from the current working directory:

    npx -y terum-skills@latest ls --local --format md
    npx -y terum-skills@latest ls --format md

With `--local`, run only the first; with `--team`, only the second; with `--team <name>`, only the second with `--team <name>` appended. Add `--rows all` to either when the user asks for every row.

## Before

Nothing to confirm: both commands only read this machine and the local team clone.

## After

Show each board verbatim as the answer; do not re-summarise unless asked. The board's **Next:** line are the follow-ups to offer. A machine without a team gets a Library board and a get-started headline instead of a Marketplace: say so in one sentence. If a board ends with a **Notes** or failure block naming a hand-off, say plainly "run this in a terminal" and give the command.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 2: `.claude/skills/skill-info/SKILL.md`**

````markdown
---
name: skill-info
description: "Show one skill in full — its team record or Library folder, versions, installs, health, and its eval report when it is a team skill — as Markdown boards from the terum-skills CLI. Use when the user names a skill and asks what it is, who installed it, how it scored, or what its receipt says."
metadata:
  managed-by: terum-skills
  short-description: "Show one skill's details and eval report"
---

Show one skill: the detail board, then its eval report when the skill is shared with the team.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): the skill's name, a unique prefix of it, or nothing when the working directory is inside a Library skill folder; `--team <name>` is passed through.

## Command

    npx -y terum-skills@latest ls skill <name> --format md

Then, only when that board's **Next:** line offers `eval-report`, also run

    npx -y terum-skills@latest eval-report <name> --format md

and show both boards, detail first. A failure naming several candidates (`Ambiguous skill name …`) is a result: show it and ask which one.

## Before

Nothing to confirm: both commands only read.

## After

Show the boards verbatim; do not re-summarise unless asked. Offer the **Next:** line. `No skill named …` is a result, not something to retry: offer the list-skills skill so the user can find the name. A board line beginning `Resolved:` says which folder or record answered a prefix or a bare invocation; keep it.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 3: `.claude/skills/search-skills/SKILL.md`**

````markdown
---
name: search-skills
description: "Search the team's shared skills by name, description or category, optionally narrowed by author or project, and show the matches as a Markdown board from the terum-skills CLI. Use when the user asks whether the team has a skill for something or wants to find one by keyword."
metadata:
  managed-by: terum-skills
  short-description: "Search the team's shared skills"
---

Find skills in the team Marketplace.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): the search term, then any of `--category <c>`, `--author <a>`, `--project <p>`, `--team <name>`, passed through unchanged. Ask for a term when none is given.

## Command

    npx -y terum-skills@latest search <term> [--category <c>] [--author <a>] [--project <p>] --format md

Quote a term that contains spaces.

## Before

Nothing to confirm: the command only reads the local team clone. When the user wants the newest catalogue, run the sync-skills skill first.

## After

Show the board verbatim. `No skills found.` is a result: say so and offer a broader term or the list-skills skill. Offer the **Next:** line (the skill-info skill for a match; installing goes through the terum-skills skill, which confirms the destination first).

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 4: `.claude/skills/eval/SKILL.md`**

````markdown
---
name: eval
description: "Evaluate a local skill with the terum-skills CLI — hygiene, trigger evals and execution cases against a baseline, billed to the user's own Claude Code — after confirming the cost, and show the result as a Markdown board. Use when the user asks to eval, test, score or benchmark a skill, or to see whether an edit made it better."
metadata:
  managed-by: terum-skills
  short-description: "Evaluate a local skill (confirms the cost first)"
---

Run one evaluation of a Library skill and show its board. Eval never publishes anything.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): one skill name (or nothing when the working directory is inside a Library skill folder) or several, then any of `--k <n>`, `--triggers-only`, `--execution-only`, `--case <stem>`, `--model <m>`, `--judge-model <m>`, `--no-gen`, `--parallel <n>`, `--pending` (every shared skill with no receipt for its current version), `--window overnight|later` (queue instead of running; nothing is paid), passed through unchanged. Leave `--batch <n>` out: it asks "Continue?" before each further batch, which needs a terminal. The queue flags (`--queue-list`, `--dequeue <skill>`, `--drain …`) belong to the terum-skills skill; `--dequeue` and `--drain` need a confirmation first.

## Command

    npx -y terum-skills@latest eval <skill> [flags] --format md

Run it in the background when your shell tool can, or with a long timeout: a full matrix takes minutes. Show the board when it finishes.

## Before

Confirm with the user first: trials and generation run their logged-in Claude Code and bill their account. State what the run buys — cases × k × arms (k defaults to 1; two arms, three when a published incumbent exists) plus generation calls for any missing cases or triggers, times the number of skills for a batch (several skills run as one batch after one preflight, `--parallel <n>` at a time, default four; confirm once for the whole batch) — and, when the skill-info board shows a previous run, quote its cost and duration as the estimate. `--window overnight|later` queues instead of running and costs nothing now. Suggest `--triggers-only` or `--case <stem>` for a first look. What eval does, so the user knows:

1. Finds the local folder by name; it need not belong to a team. When a team is configured, the clone is fetched for policy and incumbent history, never for the candidate bytes.
2. Runs hygiene on the local bytes, allowing absent managed fields; errors stop before any agent call.
3. Preflight checks `claude --version` and a one-turn smoke task before paid trials.
4. Uses existing cases and triggers, generating only the missing assets for the requested tiers; it prints the target path and the content-change consequence before writing them into the folder. Generating assets changes content identity and can mint a version on the next publish; `--no-gen` uses only existing assets, and regenerating cases means deleting `evals/cases/` and re-running.
5. Runs trigger evals and execution cases, each k times, comparing the candidate with the baseline and, when available, a digest-different published incumbent chosen by receipt recency.
6. Stores receipts and run artifacts under `~/.terum/skills/evals/local/<digest>/<run-id>/` and prints the report; a later publish attaches receipts whose digest matches the published bytes.

## After

Show the board verbatim: the verdict band, the comparison table and any `⚠` marks stay as printed; never average holes into a clean number. `Already evaluated these exact bytes` is a result — the earlier receipt stands. A batch shows one board with `Evaluated X of N` and the queued remainder; offer the eval-report skill for each skill afterwards. Model flags pass through unchanged (`--model`, `--judge-model`; default `sonnet`). Editing the skill changes its digest, so the Library's score belongs to the bytes that were evaluated; installed receipts keep their original runner and are not proof this user ran anything.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 5: `.claude/skills/eval-report/SKILL.md`**

````markdown
---
name: eval-report
description: "Show a team skill's eval history — committed receipts per version and this machine's local runs — as a Markdown board from the terum-skills CLI, without fetching. Use when the user asks how a shared skill scored, which version passed, or what its receipts say."
metadata:
  managed-by: terum-skills
  short-description: "Show a team skill's eval receipts and local runs"
---

Show the eval history of one shared skill.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): the skill's name (a unique prefix works, and nothing is needed inside a Library skill folder) and `--team <name>` when the user names a team, passed through.

## Command

    npx -y terum-skills@latest eval-report <skill> --format md

It reads the local team clone and this machine's run history; it never fetches. When the user wants the newest receipts, run the sync-skills skill first.

## Before

Nothing to confirm: the command only reads.

## After

Show the board verbatim. A skill that lives only in the Library (never published) has no team report: the failure says so — offer the eval skill instead. Offer the **Next:** line.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 6: `.claude/skills/skill-status/SKILL.md`**

````markdown
---
name: skill-status
description: "Show the state of terum-skills on this machine — team, clone, session hook, pending work, machine facts — and whether a newer CLI release exists, as Markdown boards. Use when the user asks whether terum-skills is set up, in sync or up to date, or when something about it seems off."
metadata:
  managed-by: terum-skills
  short-description: "Show terum-skills setup state and available updates"
---

Show where this machine stands.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): none are expected; ignore any.

## Command

    npx -y terum-skills@latest status --format md
    npx -y terum-skills@latest update --format md

Run both and show both boards, status first. Without network access (see Sandbox) run only the first and say the release check was skipped.

## Before

Nothing to confirm: `status` reads; `update` reads git tags from the team repository and prints the command that would update this copy — it never runs a package manager.

## After

Show the boards verbatim. Exit 0 from `status` means the query succeeded, not that setup is complete: a get-started headline means there is no team yet. Pending work on the status board needs the matching install or removal retried, not a fetch. Offer the **Next:** line; the update board's command is for the user to run in a terminal, never for you.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 7: `.claude/skills/sync-skills/SKILL.md`**

````markdown
---
name: sync-skills
description: "Fetch the team's shared skills — reset each disposable team clone to origin/main — and show the outcome per team as a Markdown board from the terum-skills CLI. Use when the user wants the newest catalogue, receipts or roster before listing, searching or installing."
metadata:
  managed-by: terum-skills
  short-description: "Fetch the team's latest shared skills"
---

Refresh the local team clone.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"): `--team <name>` when the user names a team, passed through; nothing else is expected.

## Command

    npx -y terum-skills@latest sync --format md

Run it in the background when your shell tool can: a slow fetch takes a while. Never run `sync --hook` by hand; that is the session-start entry.

## Before

Say what it does in one sentence before running: it fetches and resets each disposable team clone to `origin/main`; it never uploads, places or edits the user's skill folders.

## After

Show the board verbatim. Disclose each team the board reports as not refreshed, with its reason. A team whose repository was recreated elsewhere is offered `team move` on the board: that verb asks a question, so hand it to a terminal.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.
````

- [ ] **Step 8: the release must-list and its test**

`.github/workflows/release.yml:160` becomes one line:

```js
            for (const must of ["package.json","README.md","LICENSE","NOTICE","dist/index.js","dist/claude/skills/eval/SKILL.md","dist/claude/skills/eval-report/SKILL.md","dist/claude/skills/list-skills/SKILL.md","dist/claude/skills/search-skills/SKILL.md","dist/claude/skills/skill-info/SKILL.md","dist/claude/skills/skill-status/SKILL.md","dist/claude/skills/sync-skills/SKILL.md","dist/claude/skills/terum-skills/SKILL.md"])
```

In `src/__tests__/release-tarball-list.test.ts` replace `expect(marked.length).toBeGreaterThan(0);` with

```ts
  expect(marked).toEqual(['eval', 'eval-report', 'list-skills', 'search-skills', 'skill-info', 'skill-status', 'sync-skills', 'terum-skills']);
```

- [ ] **Step 9: Verify**

Run: `node /home/teniroo/Projects/terum-skills-codex/skill-dashboard/scripts/bundle-skill.mjs --out /tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/bundle-check`
Expected: eight `Bundled` lines in name order, exit 0. A frontmatter slip (an unquoted description, a stray key) fails here with the file and the reason — fix the file, never the bundler.

Run: `npx vitest run src/__tests__/release-tarball-list.test.ts src/__tests__/bin.test.ts src/__tests__/bundle.test.ts src/lib/__tests__/wrapper.test.ts src/lib/__tests__/local-skills.test.ts src/lib/__tests__/invocation-tripwire.test.ts --maxWorkers=1`
Expected: PASS — the count-agnostic tests now see eight skills; the tripwire is unaffected (the new files are not in its document list).

- [ ] **Step 10: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add .claude/skills/list-skills .claude/skills/skill-info .claude/skills/search-skills .claude/skills/eval .claude/skills/eval-report .claude/skills/skill-status .claude/skills/sync-skills .github/workflows/release.yml src/__tests__/release-tarball-list.test.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "feat(skills): ship list-skills, skill-info, search-skills, eval, eval-report, skill-status and sync-skills" -m "Seven marked skills under .claude/skills, one file each for Claude Code and Codex: the exact --format md command, what to confirm, how to show the board, the four rules and the Codex sandbox rule. release.yml's must-list names all eight bundled paths." -m "Verified: node scripts/bundle-skill.mjs --out <scratch> (eight Bundled lines); npx vitest run on release-tarball-list, bin, bundle, wrapper, local-skills and the tripwire (green)."
```

---
### Task 8: the manual — `.claude/skills/terum-skills/SKILL.md` rewritten for `--format md` and the named skills

**Files:**
- Rewrite: `.claude/skills/terum-skills/SKILL.md`
- Modify: `src/lib/__tests__/invocation-catalog.ts` (the manual's ~55 rows are regenerated)

**Interfaces:**
- Consumes: the two shared blocks of Task 7 (verbatim), `--format md` on every verb (Plan 1: rendered verbs get a board, the rest a fenced fallback block), `skill fix` (PR #195), `team move`.
- Produces: the manual, still the only skill in the tripwire's document list.

- [ ] **Step 0: Rebase check**

PR #206 (`fix/auto-update-auto-sync-refactor`) merged on 2026-09-14 and is already in this worktree's base (`16d53b0`); its two `eval` rows (batch `eval <skill> <skill>…`, `--pending`, `--batch <n>`, `--window overnight|later`) are carried into Table A below and its flags into the eval skill (Task 7). Before starting, run `git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard fetch origin main && git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard log --oneline HEAD..origin/main`; if main moved again and touched `.claude/skills/terum-skills/SKILL.md` or `README.md`, rebase first and carry the new rows into the rewrite — do not drop them.

- [ ] **Step 1: Write the file**

````markdown
---
name: terum-skills
description: "Drive the terum-skills CLI from a Claude Code or Codex session: run any verb with --format md and show its board — inspect the Library or the team Marketplace, search, fetch with sync, validate or fix a local skill, install the latest version into Global or an added project, manage the eval queue — and prepare the verbs that need a terminal because they ask a question (publish, project setup, skill move/rename/delete, prune, machine uninstall, team administration). Use when the user wants to manage, evaluate, publish or install skills and no narrower terum-skills skill fits."
metadata:
  managed-by: terum-skills
  short-description: "Run any terum-skills verb from a session"
---

Run one `terum-skills` verb on the user's behalf and show its board, or prepare the verb for a
terminal when the CLI would ask a question the session cannot answer. This is a thin wrapper: the
CLI is the product, the skill only decides *whether* to run it here and *how* to show the result.

**When the request maps to a named skill, use that skill's command instead**: list-skills (your
Library and the team Marketplace), skill-info (one skill in full, with its eval report), search-skills,
eval (with the cost confirmation), eval-report, skill-status (`status` then `update`), sync-skills.
Everything else is here.

This file ships inside the `terum-skills` npm package with those seven skills. Setup places them at
`~/.claude/skills/<name>/` for Claude Code and `~/.codex/skills/<name>/` for Codex; the
`metadata.managed-by` marker identifies Terum's copies. Setup refreshes them on a re-run, and
`sync --hook` refreshes or adds them in a root that already holds one, announcing
`Updated your terum-skills skills for this CLI.` A foreign folder at one of those names is left alone.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"). The command
path can have several tokens (`skill move`, `team project create`); pass the remaining arguments
unchanged. With no arguments, ask which verb, defaulting to `status`. Explain the tables below
briefly and ask for the user's intent before assembling flags.

## The one rule that shapes everything

Your shell tool has no TTY. The CLI refuses a question with
`Cannot ask "…": this command needs an interactive terminal (stdin is not a TTY).` and, under
`--format md`, shows that refusal as the board's failure block. A refusal does **not** prove nothing
happened: a verb may already have cloned, recorded intent, or completed a write before a later
question, and the completed work is listed in the board's **Notes**. Read the whole board before
reporting the outcome. So:

- Verbs that never ask run here (Table A).
- Verbs needing a human answer are prepared and handed to the user to run in a terminal (Table B).
- Verbs that ask only sometimes can run here; if the refusal appears, hand off with the board and
  any completed work clearly stated.

## Invocation

- Always `npx -y terum-skills@latest ls --format md`-shaped — a real verb, `--format md` last — for a runnable command. Never a bare
  binary, a checkout entry, or `node dist/index.js`. `--format md` renders the result as a Markdown
  board; verbs without a board show their printed lines in a fenced block, which you show as is.
- Run from the current working directory; do not `cd`; use absolute path arguments. The Library
  reads Global and explicitly added project roots; the working directory does not add a project.
- An italic board line `_Resolved: …_` says which skill answered a prefix, a case-insensitive match,
  or a bare invocation from inside a skill folder; keep it. A failure naming several candidates
  (`Ambiguous skill name …`) is a result: show it and ask which one.
- Add `--rows all` when the user asks for every row of a capped table.
- This CLI has no standalone refresh command; `sync` fetches. `team migrate` exists but is
  terminal-only (Table B); do not invent any other migration invocation.

## Table A: verbs that run here

| Verb | Before running | After running |
|---|---|---|
| `status` | nothing | show the board; exit 0 means the query succeeded, not that setup is complete. Pending work needs the matching install or removal retried, not a fetch |
| `ls`, `ls --local`, `ls member <h>`, `ls project <n>`, `ls skill <name>` | nothing | show the board (the list-skills and skill-info skills exist for the common cases) |
| `project add <abs-path>`, `project remove <abs-path>`, `project list` | confirm with the user before adding or forgetting a root | show the board; removing a project leaves its files and placement ledger unchanged |
| `search <term> [--category <c>] [--author <a>] [--project <p>]` | nothing | show the board; `No skills found.` is a result |
| `skill fix <abs-path>` | confirm with the user, as for install: it rewrites the folder's SKILL.md | it applies the repairs with one right answer (quote a frontmatter value YAML refuses, `name` to the folder, `license` to team policy, strip invisible characters, clear an executable bit on a non-script) and prints `Still needs you` for the rest; show the fenced block |
| `validate <abs-path or name> [--cwd <team-root>]` | requires team policy from the configured clone or an explicit team root | show the board's findings verbatim. Validation does not inject managed fields; an unpublished folder may fail strict frontmatter checks. Publish injects its managed fields before checking; local eval permits those fields to be absent |
| `update` | nothing | show the board; the CLI never runs a package manager, and the command it prints is for the user's terminal |
| `app` | confirm download/install and opening the desktop app | show the fenced block |
| `app-update --check` | nothing | show cached advertisement and installed/staged state; `--force` on this check requests a release probe |
| `app-update --stage [--release <version>]`, `app-update --apply [--release <version>] [--reason manual]` | confirm download or installation; on macOS quit the running app before terminal apply | staging verifies the download; apply hands installation to a detached process |
| `sync` | say it fetches and resets each disposable team clone to `origin/main`; it never uploads, places, or edits the user's skill folders | show the board; disclose each team reported as not refreshed. Run it in the background when your shell tool can |
| `sync --hook` | do not run by hand; this is the SessionStart entry and refuses `--format` | stdout is the reload directive, notices go to stderr; only Terum's managed skills may be refreshed |
| `install <ref> [--into global\|<project root>]`, `install member <h> [--into global\|<project root>]`, `install project <n> [--into global\|<project root>]` | confirm the skill/list and destination: this places files and writes install records. Use an explicitly chosen `--into`; an unregistered project path refuses and needs `project add` first | installs the highest numbered version in the clone. A tool-grant question or replace question needs a terminal; report any completed work from the board's **Notes** before handing off |
| `invite <github-login…>` | confirm with the user: sends GitHub collaborator invitations | show the fenced block and the teammate join line |
| `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]…` | confirm the profile changes; project membership names team projects | show the fenced block |
| `login --set <key=value>` | confirm the identity change; keys are `name`, `email`, `default-handle`; repeat the flag for multiple fields | show the identity notice; published versions keep their recorded author |
| `team workflow-update --print` | nothing | show the workflow scaffold and its manual migration instruction; this does not migrate the team's skill layout |
| `eval <skill> [flags]` | use the eval skill: it confirms the cost first | the eval skill shows the board |
| `eval <skill> <skill>… [--batch <n>] [--parallel <n>]`, `eval --pending` | confirm the paid runs once for the whole batch: several skills run as one batch after one agent probe; `--pending` means every shared skill with no receipt for its current version; `--batch <n>` asks before each further batch (a question — hand it to a terminal, or run without `--batch`) | show the batch board (`Evaluated X of N`); a declined continuation queues the rest for later |
| `eval <skill…> --window overnight\|later`, `eval --pending --window overnight` | confirm queueing; nothing is paid for now | show the queued board; overnight items run in the desktop app between 01:00 and 05:00, later items wait for `eval --drain` |
| `eval-report <skill> [--team <team>]` | nothing | show the board: committed receipts and local run history for a skill in the team clone; no fetch |
| `eval --queue-list` | nothing | show the queue board |
| `eval --dequeue <skill>` | confirm removal from the queue | show the remaining items; a team-qualified selector is also accepted |
| `eval --drain [--parallel <n>] [--window overnight] [--max <n>]` | confirm paid runs, as the eval skill does | show the drain board's successes and failures; default parallelism is four |
| `uninstall-skill <ref> [--from global\|<project root>]` | confirm the removal; `member <h>` and `project <n>` selectors also exist | show the board; a question about a placement means a terminal |
| `serve` | do not run as a one-shot command; it requires `--frames` and a request/answer client, and refuses `--format` | accepts only `status`, `ls`, `eval-report`, `search`, `validate`, `update`; every write uses its own process |

Interactive install always asks `Install to`, offering Global and every added project, even if
Global is the only choice. Without a TTY, omitting `--into` defaults to Global only when no
projects are registered; otherwise it refuses. Previous-version skill refs are refused.

If a destination already contains that name, install asks before keeping the existing folder
at the targeted root's sibling `.claude/old-skills/<name>` and placing the new version. A project
copy stays under that project. If the kept-copy path already exists, the command refuses; move
that backup elsewhere yourself before retrying. Neither the Library nor `prune` cleans old-skills.
Install seeds local eval receipts under each receipt's own content digest, preserving the runner's
attribution. A receipt without a digest is skipped with a notice. Interactive install offers adding
the skill to your profile (default no); noninteractive install skips that offer unless the user
explicitly requests `--yes-profile`.

Output handling for every verb in Table A:

- Show the board verbatim as the answer; do not re-summarise unless asked. Offer its **Next:** line.
- A **Notes** block holds the lines the board did not draw (problems, notices, completed work);
  show it. A failure block (`❌ …`) ends a failed verb; `(partial result above)` means the board
  above it is real work that stands.
- Quote stderr failures and explain them in one sentence. Hook notices also use stderr.
- Exit 1 is a failed operation, not a broken wrapper. Do not retry it automatically, and do not
  claim earlier steps were rolled back. Publish can succeed even if its later profile offer fails.
- No update-notice tail appears when stderr has no TTY.

## Table B: verbs that are handed to the user

These workflows need a terminal answer, or can write before their first question. Prepare the
exact command without treating a real run as a dry run. Say plainly: *run this in a terminal;
the CLI will ask you questions the session cannot answer.*

| Verb | Free dry run first | Command to hand over |
|---|---|---|
| `project add` (no path) | none | `npx -y terum-skills@latest project add` — asks for a folder |
| `publish <ref> [--project <p>] [--category <c>]` | none; confirm the local skill and team with the user | `npx -y terum-skills@latest publish <ref> --project <p> --category <c>` — omit optional flags the user has not chosen |
| `skill move <abs-path> --to global\|<project root>` | none | `npx -y terum-skills@latest skill move <abs-path> --to <destination>` |
| `skill rename <abs-path> --to <new-name>` | none | `npx -y terum-skills@latest skill rename <abs-path> --to <new-name>` |
| `skill delete <abs-path>` | none | `npx -y terum-skills@latest skill delete <abs-path>` |
| `prune` | none; an empty quarantine simply returns | `npx -y terum-skills@latest prune` |
| `uninstall` | none | `npx -y terum-skills@latest uninstall` — machine teardown, preserving recovery data and printing the package-manager step |
| `team leave <name>`, `team remove <handle>` | none | the same command with the supported npx prefix |
| `team move <org>/<repo> [--from <team>] [--yes]` | none; one confirmation, then leave + join + re-place | `npx -y terum-skills@latest team move <org>/<repo>` — when a team's repository was recreated elsewhere (`sync` reports it and offers this) |
| `team project create [name] [--remote <url>]` | none | `npx -y terum-skills@latest team project create <name> --remote <url>` |
| `team migrate [--team <name>]` | none | `npx -y terum-skills@latest team migrate` — once per team, from a terminal, only after the release carrying the new CLI has reached every teammate (an un-upgraded teammate cannot read a migrated repo); refuses under `--frames` |
| `setup [target]`, `team create`, `team join <target>`, `login` | none; setup/join can clone before asking | `npx -y terum-skills@latest setup` / `setup <org>/<repo>` / `team create` / `team join <target>` / `login` with the same npx prefix |

Publish writes the local folder as an immutable `skills/<name>/v<N>/` version directly to team
main and attaches matching local eval receipts. Identical bytes reuse the existing version;
`--project` can still add it to another team project. This is not a pull-request workflow.
Publish resolves category from the declared frontmatter first, then `--category`, then a model
suggestion, falling back to `misc`. A declared category makes no model call and prints no category
line. Otherwise the CLI discloses the source before writing. It writes managed frontmatter back
locally after its refusal-capable checks, then publishes, then asks about adding to your profile.
A failed team write can leave that frontmatter on disk. Do not treat publish as a dry run.

The three `skill` operations require a direct child of Global or an added project's skills root
and require typing its name. Move preserves local edits and keeps a destination collision in
old-skills. Rename changes the folder and readable frontmatter name; that changes the invocation
name, and publishing a new name starts a new lineage. Delete quarantines an untracked folder or
an edited placement, but removes an unmodified placement outright (reinstall to restore it).
Deleting a placement also removes its install bookkeeping. Uninstall leaves the curated profile
unchanged. `prune` permanently deletes confirmed quarantine contents only.

Whether your shell tool has a TTY is unverified; do not promise it. "A terminal" means a real terminal.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set, add `--prefer-offline` after `npx` (`npx --prefer-offline -y terum-skills@latest …`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.

## What this skill never does

- Answer a CLI question by any means.
- Run Table B workflows as supposed dry runs.
- Add consent-bypassing flags on the user's behalf.
- Call git to infer a project or register roots behind the user's back.
- Retry a verb that exited 1 with a failure block.
````

- [ ] **Step 2: Bundle and catalogue**

Run: `node /home/teniroo/Projects/terum-skills-codex/skill-dashboard/scripts/bundle-skill.mjs --out /tmp/claude-1000/-home-teniroo-Projects-SSM/5aa8e792-8e19-415a-9725-a4aa72747012/scratchpad/bundle-check`
Expected: eight `Bundled` lines, exit 0 (the description is quoted; the keys are the three allowed).

Run the tripwire. Every removed manual line's row is deleted and every new line naming `terum-skills` or a verb span gets a row: table cells and prose sentences → `prose`; the runnable `npx -y terum-skills@latest …` commands in Table B's third column and the Invocation bullet → `fixed`; keep the file's existing row style. Expect roughly 60 rows for `.claude/skills/terum-skills/SKILL.md`. Re-run until green.

Run: `npx vitest run src/lib/__tests__/invocation-tripwire.test.ts src/lib/__tests__/local-skills.test.ts src/lib/__tests__/wrapper.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add .claude/skills/terum-skills/SKILL.md src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "docs(skills): rewrite the terum-skills manual for --format md boards and the named skills" -m "The manual now routes common requests to the seven named skills, invokes every verb with --format md, adds skill fix and ls skill to Table A and team move to Table B, and carries the same Rules and Sandbox blocks as the other skills; its eval section moved into the eval skill." -m "Verified: node scripts/bundle-skill.mjs --out <scratch> (eight Bundled lines); npx vitest run on the tripwire, local-skills and wrapper tests (green)."
```

---
### Task 9: `src/__tests__/skill-prose.test.ts` — the gate for every shipped skill

**Files:**
- Create: `src/__tests__/skill-prose.test.ts`

**Interfaces:**
- Consumes: `FRONTMATTER` (`src/lib/schema.ts`), `isManagedSkill` (Task 1), `parseRenderOptions` and `TerminalFacts` (`src/lib/render/options.ts`, Plan 1 Task 3: `parseRenderOptions(argv, env, terminal)` → `{ ok: true; argv; options } | { ok: false; error }`), `buildProgram` (`src/cli.ts`; called as the tripwire calls it, `buildProgram(async () => {})`, to walk the command tree), the two shared blocks (Task 7).
- Produces: the test.

- [ ] **Step 1: Write the test**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';
import { parseRenderOptions } from '../lib/render/options.js';
import { FRONTMATTER } from '../lib/schema.js';
import { isManagedSkill } from '../lib/wrapper.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skillsRoot = resolve(root, '.claude', 'skills');
const EXPECTED = ['eval', 'eval-report', 'list-skills', 'search-skills', 'skill-info', 'skill-status', 'sync-skills', 'terum-skills'];

/** The four rules every shipped skill carries, verbatim (spec §9 item 4). */
const RULES = `## Rules

- No TTY: never pipe \`y\`, never drive the CLI with \`expect\`, never add \`--frames\` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file \`\` !\`command\` \`\` injection; run every command with your shell tool and read its output.
- Do not \`cd\`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.
`;
/** The Codex sandbox rule (spec §9 item 5), verbatim; Task 10 of the plan verified --prefer-offline before this shipped. */
const SANDBOX = `## Sandbox

When \`CODEX_SANDBOX_NETWORK_DISABLED=1\` is set, add \`--prefer-offline\` after \`npx\` (\`npx --prefer-offline -y terum-skills@latest …\`) so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — \`sync\`, \`install\`, \`publish\`, \`invite\`, \`eval\`, and \`update\`'s release probe — are handed to a terminal with the reason.
`;
/** Host-specific tool names a one-file-both-hosts skill must never use (spec D13). */
const HOST_TOOLS = /Bash\(|AskUserQuestion|request_user_input|run_in_background/;
/** A bare binary, a checkout entry, or the built entry: never an invocation form (spec §9 item 1). */
const FORBIDDEN_INVOCATIONS = /node dist\/index\.js|`terum-skills [a-z-]+/;
const COMMAND = /npx (?:--prefer-offline )?-y terum-skills@latest ([^\n`]+)/g;
const TERMINAL = { isTTY: false, colorCapable: false };

interface Skill { name: string; raw: string; frontmatter: string; parsed: Record<string, unknown>; body: string }

async function shipped(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try { raw = await readFile(resolve(skillsRoot, entry.name, 'SKILL.md'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!isManagedSkill(raw)) continue;
    const match = FRONTMATTER.exec(raw)!;
    skills.push({ name: entry.name, raw, frontmatter: match[1]!, parsed: YAML.parse(match[1]!) as Record<string, unknown>, body: raw.slice(match[0].length) });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether `tokens` starts with a command registered on the CLI (one or two levels: `ls`, `ls skill`, `team project create`). */
function registered(program: Command, tokens: string[]): boolean {
  let commands = program.commands;
  let depth = 0;
  for (const token of tokens) {
    const found = commands.find((command) => command.name() === token);
    if (!found) return depth > 0;
    commands = found.commands; depth += 1;
    if (!commands.length) return true;
  }
  return depth > 0;
}

describe('the shipped skills', () => {
  it('are exactly the eight, each marked and named after its folder, with the frontmatter contract', async () => {
    const skills = await shipped();
    expect(skills.map((skill) => skill.name)).toEqual(EXPECTED);
    for (const { name, parsed, frontmatter } of skills) {
      expect(Object.keys(parsed).sort(), name).toEqual(['description', 'metadata', 'name']);
      expect(parsed['name'], name).toBe(name);
      expect(frontmatter, `${name}: description must be a quoted scalar`).toMatch(/^description: "/m);
      const description = parsed['description'];
      expect(typeof description === 'string' && description.trim().length > 0, name).toBe(true);
      expect([...(description as string)].length, `${name}: Claude Code caps description at 1024 characters`).toBeLessThanOrEqual(1024);
      const metadata = parsed['metadata'] as Record<string, unknown>;
      expect(Object.keys(metadata).sort(), name).toEqual(['managed-by', 'short-description']);
      const short = metadata['short-description'];
      expect(typeof short === 'string' && short.trim().length > 0, name).toBe(true);
      expect([...(short as string)].length, `${name}: short-description is meant to be short`).toBeLessThanOrEqual(100);
    }
  });

  it('carry the Rules and Sandbox blocks verbatim, Rules first, and $ARGUMENTS exactly once', async () => {
    for (const { name, body } of await shipped()) {
      expect(body, name).toContain(RULES);
      expect(body, name).toContain(SANDBOX);
      expect(body.indexOf(RULES), name).toBeLessThan(body.indexOf(SANDBOX));
      expect(body.split('$ARGUMENTS').length - 1, name).toBe(1);
      expect(body, name).toContain('Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS")');
    }
  });

  it('never name a host-specific tool, a bare binary, a checkout entry, or node dist/index.js', async () => {
    for (const { name, body } of await shipped()) {
      expect(body, name).not.toMatch(HOST_TOOLS);
      expect(body, name).not.toMatch(FORBIDDEN_INVOCATIONS);
    }
  });

  it('every npx command names a registered verb, and every --format md command parses through the pre-parser', async () => {
    const program = buildProgram(async () => {});
    for (const { name, body } of await shipped()) {
      const commands = [...body.matchAll(COMMAND)].map((match) => match[1]!.trim());
      expect(commands.length, name).toBeGreaterThan(0);
      for (const command of commands) {
        const tokens = command.split(/\s+/);
        if (tokens[0] === '…') continue; // the Sandbox block's elided example
        expect(registered(program, tokens.slice(0, 3)), `${name}: ${command}`).toBe(true);
        if (!tokens.includes('--format')) continue;
        const parsed = parseRenderOptions(tokens, {}, TERMINAL);
        expect(parsed.ok, `${name}: ${command}`).toBe(true);
        if (parsed.ok) expect(parsed.options.format, `${name}: ${command}`).toBe('md');
      }
    }
  });

  it('the named skills run --format md; the manual invokes --format md for its runnable verbs', async () => {
    for (const { name, body } of await shipped()) {
      const commands = [...body.matchAll(COMMAND)].map((match) => match[1]!.trim()).filter((command) => !command.startsWith('…'));
      if (name === 'terum-skills') { expect(commands.some((command) => command.includes('--format md')), name).toBe(true); continue; }
      for (const command of commands) expect(command, `${name}: ${command}`).toContain('--format md');
    }
  });
});
```

`registered()` walks the commander tree the way the tripwire's `names()` does; `ls skill <name>` and `team project create` resolve through their parents, `eval-report` and `uninstall-skill` at the top, and the manual's Table B commands (`skill move`, `project add`, `team migrate`, `setup`, `login`, …) all exist on the program. Placeholders such as `<skill>` or `[flags]` are tokens the pre-parser passes through untouched, so `parseRenderOptions` sees only the `--format md` it owns.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/__tests__/skill-prose.test.ts --maxWorkers=1`
Expected: PASS. A failure names the skill and the rule; fix the skill file (or, for a legitimate new invocation form, this test — never by loosening the shared blocks).

- [ ] **Step 3: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add src/__tests__/skill-prose.test.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "test(skills): pin the shipped skills' frontmatter, commands, shared rules and host neutrality" -m "skill-prose.test.ts is the gate for the eight bundled skills: exact set, quoted descriptions, allowed keys, short-description, the Rules and Sandbox blocks verbatim, one \$ARGUMENTS, registered verbs, --format md commands that parse, and no host-specific tool names." -m "Verified: npx vitest run src/__tests__/skill-prose.test.ts (green)."
```

---

### Task 10: commands, READMEs, catalogue, the `--prefer-offline` check, the manual host checks, full gates

**Files:**
- Modify: `.claude/commands/eval.md`, `.claude/commands/ls.md`, `.claude/commands/{install,invite,publish,search,sync,update,validate}.md`, `.claude/commands/terum-skills.md`
- Modify: `.claude/skills/README.md:4, 12-28`
- Modify: `README.md:68, 360, 374`
- Modify: `src/lib/__tests__/invocation-catalog.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the docs; the `--prefer-offline` verification recorded in this task's commit body (and later the PR description); the manual `claude -p` / `codex exec` checks recorded the same way.

- [ ] **Step 1: The repo-local commands**

`.claude/commands/ls.md`:

```
Invoke the `list-skills` skill: run `npx -y terum-skills@latest ls --local --format md` and `npx -y terum-skills@latest ls --format md` (only one of them when `--local` or `--team` is given) from inside the session, following that skill's rules, and show the boards. Pass through any arguments: $ARGUMENTS
```

`.claude/commands/eval.md`:

```
Invoke the `eval` skill: confirm the cost with the user as that skill says, then run `npx -y terum-skills@latest eval … --format md` from inside the session and show the board. Pass through any arguments: $ARGUMENTS
```

Each of `install.md`, `invite.md`, `publish.md`, `search.md`, `sync.md`, `update.md`, `validate.md` keeps its one line with two changes — `… --format md` after the ellipsis and "and show the board" — e.g. `install.md`:

```
Invoke the `terum-skills` skill with the verb `install`: run `npx -y terum-skills@latest install … --format md` from inside the session, following that skill's run-here / hand-off rules, and show the board. Pass through any arguments after the verb: `install $ARGUMENTS`
```

(same shape with `invite`, `publish`, `search`, `sync`, `update`, `validate`; `publish` is a Table B verb, so the manual hands it to a terminal — the command file still routes through the manual, as before.)

`.claude/commands/terum-skills.md`:

```
Invoke the `terum-skills` skill to run one terum-skills CLI verb from inside the session
(`npx -y terum-skills@latest <verb> … --format md`) and show its board, or to prepare and hand
over the verbs that need a terminal because they ask a question. When the request maps to a named
skill (list-skills, skill-info, search-skills, eval, eval-report, skill-status, sync-skills), that
skill's command is the one to run. Pass through any arguments: $ARGUMENTS

`$ARGUMENTS` may be empty (the skill asks which verb, default `status`), a verb with its
arguments (`ls --local`, `validate /abs/path`, `publish my-skill`, `eval my-skill --triggers-only`),
or a hand-off verb (`connect /abs/path`, `setup`) that the skill prepares for a terminal.
```

- [ ] **Step 2: `.claude/skills/README.md`**

- Line 12: `## The thirteen tools` → `## The twelve tools`.
- Delete the `terum-skills` row from that table (line 28).
- Insert, before `\`/ultraspec\` (command only) …`, a new section:

```markdown
## The terum-skills skills (shipped in the npm package)

Eight of these directories are not workflow tools but the skills the `terum-skills` CLI ships to its
users: `npm run build` bundles every SKILL.md carrying `metadata.managed-by: terum-skills` into
`dist/claude/skills/<name>/` (`scripts/bundle-skill.mjs`, which also validates the frontmatter), and
`terum-skills setup` places them under `~/.claude/skills/` and `~/.codex/skills/`; the marker is how
setup, the session hook and uninstall recognise their copies (`src/lib/wrapper.ts`). Each runs one CLI
verb with `--format md` and shows the board; `src/__tests__/skill-prose.test.ts` is their gate. Design:
`.planning/specs/2026-09-13-skill-dashboard.md` §9–§11.

| Skill | Invoke (Claude Code / Codex) | Runs |
|---|---|---|
| list-skills | `/list-skills [--local\|--team]` / `$list-skills` | `ls --local --format md`, `ls --format md` — the Library and the Marketplace boards |
| skill-info | `/skill-info <name>` | `ls skill <name> --format md`, then `eval-report <name> --format md` for a team skill |
| search-skills | `/search-skills <term> [--category --author --project]` | `search … --format md` |
| eval | `/eval <skill> [flags]` | `eval … --format md`, after confirming the cost |
| eval-report | `/eval-report <skill>` | `eval-report … --format md` |
| skill-status | `/skill-status` | `status --format md`, then `update --format md` |
| sync-skills | `/sync-skills` | `sync --format md` |
| terum-skills | `/terum-skills <verb …>` | any verb with `--format md`; hands the question-asking verbs to a terminal. The one canonical manual |
```

- [ ] **Step 3: `README.md`**

- Replace the paragraph at line 68 (`Setup also offers the \`/terum-skills\` Claude Code skill, …`) with:

```
Setup also offers eight skills for Claude Code and Codex, so either assistant can run these commands for you inside a session and show the result as a board — see [From Claude Code and Codex](#from-claude-code-and-codex).
```

- Insert, immediately before `## How it works` (line 70), the section:

```markdown
## From Claude Code and Codex

Setup places eight skills at `~/.claude/skills/<name>/` for Claude Code and `~/.codex/skills/<name>/` for Codex (when `~/.codex` exists), so either assistant can run terum-skills for you inside a session and show the result as a Markdown board. They ship inside the npm package; re-running `npx -y terum-skills@latest setup` after an update refreshes them, and the session hook refreshes or adds them on a machine that already holds one. Invoke them as `/name` in Claude Code and `$name` in Codex:

| Skill | What it runs |
|---|---|
| `list-skills [--local\|--team]` | `ls --local --format md` and `ls --format md` — your Library and the team Marketplace |
| `skill-info <name>` | `ls skill <name> --format md`, then `eval-report <name> --format md` for a team skill |
| `search-skills <term>` | `search <term> --format md` |
| `eval <skill> [flags]` | `eval <skill> --format md`, after confirming the cost with you |
| `eval-report <skill>` | `eval-report <skill> --format md` |
| `skill-status` | `status --format md`, then `update --format md` |
| `sync-skills` | `sync --format md` |
| `terum-skills <verb …>` | any verb with `--format md`; the verbs that ask a question are handed to your terminal |

Uninstall removes the copies it placed; a folder at one of those names that is not the bundled skill is left alone.

```

- Line 360 (the **Uninstall** bullet): `the \`/terum-skills\` Claude Code skill it placed` → `the terum-skills skills it placed for Claude Code and Codex`.
- Line 374 (the `setup` row): `then offers the session hook and the \`/terum-skills\` Claude Code skill` → `then offers the session hook and the terum-skills skills for Claude Code and Codex`.

- [ ] **Step 4: Catalogue**

Run the tripwire. Every README line above that names the package or a verb span is a hit: the table rows and the sentences → `prose`; the `npx -y terum-skills@latest setup` mention inside a sentence → `prose` (it is a doc sentence, not a copyable block — match how the existing line-68 row is classified and keep that policy). Delete the rows of the replaced lines. Re-run until green.

- [ ] **Step 5: Verify `--prefer-offline` (spec §9 item 5) and record it**

The Sandbox block claims a warm npx cache resolves `terum-skills@latest` without the registry. Prove it on this machine and paste the transcript into the commit body:

```bash
export NODE_OPTIONS=--dns-result-order=ipv4first
# 1. Warm the cache online.
npx -y terum-skills@latest --version
# 2. Wait until the registry packument is stale (npm caches it with max-age=300 s), so the next step cannot pass on freshness alone.
sleep 330
# 3. Cut the network with a dead proxy (changing the registry URL would change npm's cache key and invalidate the probe) and fail fast.
NPM_CONFIG_FETCH_RETRIES=0 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=1 NPM_CONFIG_FETCH_TIMEOUT=3000 npm_config_proxy=http://127.0.0.1:9 npm_config_https_proxy=http://127.0.0.1:9 npx --prefer-offline -y terum-skills@latest --version
# 4. The control: the same without --prefer-offline.
NPM_CONFIG_FETCH_RETRIES=0 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=1 NPM_CONFIG_FETCH_TIMEOUT=3000 npm_config_proxy=http://127.0.0.1:9 npm_config_https_proxy=http://127.0.0.1:9 npx -y terum-skills@latest --version
```

Expected: step 3 prints the version and exits 0. (Planning-time probe, 2026-09-14 on this box, npm 11.12.1 / node 24.15.0: warmed 04:52, probed 05:30 — 38 minutes later, packument long stale — step 3 printed `0.16.0`, exit 0, as did `--offline`; the control also printed `0.16.0` with retries forced to 0, so npm falls back to the stale cache on a network error too. The flag's value in the sandbox is that it skips the staleness fetch altogether — with default retry settings the control waits through npm's retry backoff first — so the line stands as written.) If step 3 fails after a real wait, the spec's fallback applies: in all eight skill files and in `SANDBOX` of `src/__tests__/skill-prose.test.ts`, replace the block's first sentence with `When \`CODEX_SANDBOX_NETWORK_DISABLED=1\` is set, ask the user to run Codex with network access for terum-skills, or to run the command in a terminal.` and keep the second sentence; re-run `skill-prose.test.ts` and the bundler.

- [ ] **Step 6: The manual host checks (recorded, not CI)**

Run only on a machine where placing the skills into the real `~/.claude/skills` and `~/.codex/skills` is acceptable (they are removable; they are exactly what setup would place). Build first (`npm run build`), then:

```bash
node -e '
  const w = await import("/home/teniroo/Projects/terum-skills-codex/skill-dashboard/dist/lib/wrapper.js");
  const options = w.defaultWrapperOptions();
  const bundled = await w.readBundledSkills(options.bundle);
  for (const root of options.roots) for (const [name, raw] of bundled) console.log(name, root.root, await w.installManagedSkill(root.root, name, raw));
' --input-type=module
claude -p "/skill-status"
codex exec '$skill-status'
```

Expected: each assistant runs `npx -y terum-skills@latest status --format md` (and `update --format md`) and shows the boards verbatim (a get-started board on a team-less machine is fine). Record the two transcripts' first lines in the commit body. Then remove the placed copies:

```bash
node -e '
  const w = await import("/home/teniroo/Projects/terum-skills-codex/skill-dashboard/dist/lib/wrapper.js");
  const inventory = await w.managedSkillInventory(w.defaultWrapperOptions());
  for (const root of inventory.roots) for (const skill of root.managed) console.log(skill.directory, await w.removeManagedSkill(root.root, skill.name));
' --input-type=module
```

If `claude` or `codex` is not installed here, say so in the commit body instead of claiming the check.

- [ ] **Step 7: Full gates and the desktop check**

```bash
cut -d' ' -f1 /proc/loadavg
NODE_OPTIONS=--dns-result-order=ipv4first timeout 600 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard run lint && NODE_OPTIONS=--dns-result-order=ipv4first timeout 600 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard run typecheck && NODE_OPTIONS=--dns-result-order=ipv4first timeout 900 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard test -- --maxWorkers=4
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard diff --stat "$(git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard merge-base HEAD origin/main)" -- desktop/
NODE_OPTIONS=--dns-result-order=ipv4first timeout 600 npm --prefix /home/teniroo/Projects/terum-skills-codex/skill-dashboard run build && ls /home/teniroo/Projects/terum-skills-codex/skill-dashboard/dist/claude/skills
```

Expected: gates green (load < 8 at start); the desktop diff lists only `desktop/GAPS.md`; `dist/claude/skills` lists the eight folders.

- [ ] **Step 8: Commit**

```bash
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard add .claude/commands .claude/skills/README.md README.md src/lib/__tests__/invocation-catalog.ts
git -C /home/teniroo/Projects/terum-skills-codex/skill-dashboard commit -m "docs: point the repo commands and READMEs at the shipped skills" -m "The repo-local commands route ls to list-skills and eval to eval and add --format md to the rest; README gains 'From Claude Code and Codex'; the skills README documents the shipped set and the bundle contract. Includes the --prefer-offline transcript and the claude -p / codex exec check outcomes." -m "Verified: npm run lint, npm run typecheck, npm test -- --maxWorkers=4 (green, load < 8 at start); git diff --stat main -- desktop/ shows only desktop/GAPS.md; npm run build lists eight dist/claude/skills folders; --prefer-offline probe: <paste>; host checks: <paste or 'not installed here'>."
```

---

## Self-review (run once, fix inline)

1. **Spec coverage.** §9 D12 eight skills (Tasks 7–8), frontmatter contract (Tasks 6, 9), D13 one file both hosts and `$ARGUMENTS` once (Tasks 7–9), body contract order Command → Before → After → Rules → Sandbox (Tasks 7–8, order pinned by Task 9's Rules-before-Sandbox check), the manual's new opening rule, `skill fix` in Table A, `team move` in Table B, the eval section moved (Task 8), commands repointed (Task 10). §10 D14 `wrapper.ts` generalised, roots, states per (skill, root), atomic writes, the one question naming roots and names, Codex root skipped with one line, consent-once, foreign named and left alone, unavailable one line, outcomes (Task 1); hook rule and notice (Task 4); uninstall inventory/removal/`wrappersRemoved` (Task 5); `skill-source.ts` wording (Task 2); migration of the old copy (Task 1 test). §11 D15 bundler scan and refusals, one line per file, unmarked skipped (Task 6); release must-list and `release-tarball-list.test.ts` (Tasks 6–7); `bin.test.ts`/`bundle.test.ts` over the set (Tasks 5, 7). §12 rows `~/.codex` absent, foreign folder, source checkout, Codex sandbox (Tasks 1, 7, 10). §13 placement tests extended (Tasks 1–5), `skill-prose.test.ts` (Task 9), the seven files outside the tripwire list (Global Constraints), manual `claude -p`/`codex exec` and `--prefer-offline` (Task 10). §14 README section, manual rewrite, skills README rows, commands (Tasks 8, 10); `docs/frame-protocol.md` hook sentence (Task 4); `desktop/GAPS.md` (Task 5).
2. **Placeholder scan.** No TBD/TODO; every code step carries its code; the catalogue steps name the policy per line rather than the row text because the tripwire prints the exact rows to add.
3. **Type consistency.** `WrapperOptions { roots?: ManagedRoot[]; bundle?: string }` everywhere; `wrapperFor(home, env?)` returns `Required<WrapperOptions>`; `bundledNames()`/`CANONICAL_SKILLS` used by Tasks 3, 5, 7; `readBundledSkills` returns `Map<string, string> | null`; `managedSkillStates` returns the `ManagedStates` union; `installManagedSkill(root, name, raw)`; `removeManagedSkill(root, name)`; `refreshManagedSkills` returns `string[]`; `managedSkillInventory` returns `{ roots: [...] }` with `managed`/`foreign` arrays; `MachineUninstallResult.wrappersRemoved: string[]`; `SyncArgs.wrapper?: WrapperOptions`; `parseRenderOptions(argv, env, terminal)` with `terminal: { isTTY, colorCapable }` (the optional `columns`/`rows` omitted).
