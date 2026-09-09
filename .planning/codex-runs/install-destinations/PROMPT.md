Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly, then ./CLAUDE.md.

# Task: CLI-2 of the Library model — `install --into` destinations, sync over registered checkouts, destination-aware `uninstall-skill --from`

This worktree is branch `feat/install-destinations`, based on `feat/checkouts-cli` (CLI-1: the registered-checkout library — `config.checkouts`, the `checkout` verb, `ls` over registered roots) with `feat/one-team-per-machine-cli` merged in. Both are already in this tree. Do not re-implement either; build on their symbols. `node_modules` is installed. All git commands are forbidden inside the sandbox (the worktree's git metadata lives outside your writable root); the orchestrator handles version control. Do not commit, stage, or push. Verify writes by reading files back.

## Ruling this implements (locked; Ryan, 2026-09-09 Library ruling)

- **F1** Automatic registration on writes: `install --into <root>` for a root not yet in `config.checkouts` registers it.
- **F4** A Global-package skill still asks where to go; default Global; the question is skipped only when there is exactly one candidate.
- **F6** Scope = the package: `scope` is which team.json list the skill came from (Global or a project), never derived from the folder or cwd.
- **F9** `uninstall-skill --from` names the copy; the people-file record and `declined` change only under the last-copy rule.
- **F10** Registered = consented. `sync` refreshes every placement under Global or a registered checkout from any cwd; placements under unregistered folders are skipped with ONE grouped notice; the exclude-line bug (line written into the cwd checkout rather than the checkout holding the copy) is fixed.

Standing rule from CLAUDE.md: correctness is spec + North Star, not cheapness. Grep for existing code before adding a function; extend or replace in the same change; never leave two paths doing the same thing.

## 1. `src/lib/schema.ts` — `configSchema.pending[]`

Add an optional `destination` to each pending entry:

```ts
destination: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('checkout'), root: z.string().min(1) }),
]).optional()
```

Old entries without it must still parse. `placements` is unchanged (its key is the path). Export the destination type (e.g. `export type Destination = { kind: 'global' } | { kind: 'checkout'; root: string }`) from schema.ts so install/sync/uninstall share one definition.

## 2. `src/commands/install.ts`

- `InstallArgs` gains `into?: string`.
- New exported `resolveDestination(store, teamJson, packageProject: string | undefined, io: Prompter, interactive: boolean, opts: { into?: string; cwd?: string; runner: Runner; home: string })` → `Destination`:
  - `--into global` → `{ kind: 'global' }`.
  - `--into <path>`: must be absolute and an existing directory, else throw `Checkout folder <p> is missing` (never create it — assert no mkdir on this path). Resolve through `realpath`. If the realpath is not in `config.checkouts` (compare realpath-to-realpath), register it under `store.update` using the SAME registration helper CLI-1's `checkout` verb uses (grep for it in the checkout/local-skills code — do not add a second registration path), and print `Registered <p> in your library.` exactly once (F1).
  - No `--into`, interactive: `io.select('Install to', choices)` where choices are `'Global (~/.claude/skills)'` followed by one `'<basename> · <path>'` per registered checkout. Default (the first choice offered / the pre-selected entry — follow how other selects in this repo express a default; if `Prompter.select` has no default parameter, order the default first and say so in openQuestions) = the one registered checkout whose git `origin` remote normalises (`normalizeRemote`, src/lib/remote.ts) to one of the package project's `remotes` in team.json — exactly one match; several matches → no default (Global first); a Global package defaults to Global (F4). The cwd checkout (`currentRepoRoot`) is labelled `current repository` in its choice line ONLY when it is registered; an unregistered cwd is never offered.
  - Interactive with exactly one candidate (Global and no registered checkouts) → use it without asking (F4).
  - Non-interactive, no `--into`: exactly one candidate → use it; else throw `Pass --into global or --into <checkout root>`.
- `installOne`:
  - Delete `matchingProject` and `selectScope` and the guard that throws `Install project … from a checkout registered for that project; no matching project context was found.` (F6). `scope = input.scope ?? (packageProject ? { kind: 'project', project: packageProject } : { kind: 'global' })` where `packageProject` is the project whose `skills` list contains the id when the install came from that list (`input.project`), else undefined.
  - Accept `destination: Destination` in its input (callers pass it). `repoRoot` for `resolveTarget` = `destination.kind === 'checkout' ? destination.root : undefined`; for a checkout destination the target root is `<root>/.claude/skills` regardless of scope kind (a Global-package skill may live in a checkout; a project-package skill may live in Global — scope and destination are independent).
  - The `pending` entry carries `destination`. `samePending` compares `destination` too (a pending with a different destination is a different pending). When a matching pending entry already exists, UPDATE its `version` in place instead of leaving it as-is.
  - Before `lockTarget`, `stat(destination.root)` for a checkout destination and throw `Checkout folder <root> is missing` if absent — `lockTarget` does `mkdir -p` and must never recreate a moved checkout.
  - Ownership lookup (`config.placements[destination]` before `inspect`) keys by `canonicalParentPath` (export it from `src/lib/local-skills.ts`): compare the canonical parent of the ledger key and of the target, so a ledger key under `/private/tmp/...` and a target under `/tmp/...` (macOS alias) find the same owned placement.
  - `place(...)` receives `projectRoot: checkoutRootOf(placedPath)` (see §3) so the exclude line lands in the checkout that holds the copy.
- Bulk forms in `run()` (`member <handle>`, `project <name>`) call `resolveDestination` ONCE and pass the same `destination` to every `installOne` in the batch (one question per batch). `team.ts` `join()`'s endorsement offer loop and `sync.ts`'s endorsed batch do the same: one `Install to` question per batch, default Global.
- The single-ref form resolves the destination once for that skill.

## 3. `src/lib/placer.ts` and `src/lib/placer/agent-paths.ts`

- `lockTarget` is unchanged. Every caller that places into a checkout stats the checkout root BEFORE `lockTarget` (install, sync refresh, sync pending replay).
- New `checkoutRootOf(path: string): string | undefined` in `agent-paths.ts`: when `isSkillsRoot(dirname(path))`, return `dirname(path)` minus the trailing `/.claude/skills` (i.e. `dirname(dirname(dirname(path)))`); otherwise undefined. Callers of `place()` pass `projectRoot: checkoutRootOf(path)`; a Global path (`~/.claude/skills/<name>`) yields the home dir — callers must pass `projectRoot` only for checkout destinations (compare against the home root: `checkoutRootOf(path) !== home` or destination.kind === 'checkout').

## 4. `src/commands/sync.ts`

- Refresh loop over `config.placements`: eligibility = `dirname(path)` is the home skills root (`AGENT_PATHS['claude-code'].global(home)`, realpath-compared) OR `checkoutRootOf(path)` ∈ `config.checkouts` (realpath compare). Otherwise push `path` into `unregistered[]` and `continue`. Delete the `matchingProjectRoot` function and the `entry.scope.kind === 'project' && !projectRoot` skip: a project-scope placement in a registered checkout is refreshed from ANY cwd.
- `projectRoot` passed to `place()` in the refresh = `checkoutRootOf(path)` (undefined for Global). This fixes the exclude line landing in the cwd checkout.
- Pending replay: pass `destination: pending.destination` to `installOne`. An old entry without `destination`: derive it once from the cwd (a cwd checkout that is registered → `{kind:'checkout', root}`; otherwise Global), rewrite the pending entry with that destination under `store.update`, then replay. Before replay of a checkout destination, if the root is missing, defer with a notice (`needs its checkout <root>`), never mkdir.
- `reconcileOrphans`: skip a placement whose path is not under Global or a registered checkout (same eligibility predicate — one helper, shared with the refresh loop) and count it in the same `unregistered[]`.
- After the walk (after reconcileOrphans, before the stamp), ONE grouped notice when `unregistered.length > 0`: `Skipped N placements under folders not in your library: <root1>, <root2>` — roots de-duplicated via `checkoutRootOf(path) ?? dirname(path)`, sorted. A skipped unregistered placement does NOT block the stamp (it is not undone work) — delete the stamp-comment clause "A project placement outside its checkout is not undone work: that placement belongs to another session." and replace it with the unregistered rule.
- The endorsed batch calls `resolveDestination` once per team batch (interactive only; it already skips non-interactive) and passes the destination to each `installOne`.

## 5. `src/commands/uninstall.ts`

- `UninstallArgs` gains `from?: string` (`global` or an absolute checkout root; realpath it; it need not be registered).
- `uninstallMany`: targets remain `(id, scope)`, but the matching placements filter additionally requires `dirname(path)` to equal the resolved `--from` root's skills dir (`<root>/.claude/skills` or home's) when `--from` is given, comparing realpaths. Interactive, no `--from`, more than one matching placement for a target → `io.select('Remove which copy?', <paths>)` (one question per target); non-interactive with more than one → throw `Pass --from global or --from <checkout root>`.
- Last-copy rule (F9): the people-file `installed` filter and the `declined` push run for a target ONLY when no placement of `(id, scope)` remains in the ledger after the removal. When a copy remains, the shared record is untouched and NO safeWrite runs for that target (if no target needs the people file, skip the safeWrite entirely — do not push an empty commit).
- `samePending` compares `destination` too; the pending entries `uninstallMany` writes carry the destination of the copy being removed (`{kind:'global'}` or `{kind:'checkout', root}` via `checkoutRootOf(path)`).
- `sync`'s uninstall replay passes `pending.destination` through.

## 6. `src/commands/status.ts`

Pending entries in `StatusResult.teams[].pending` gain `destination: e.destination ?? null` (serialised as `{kind:'global'} | {kind:'checkout', root} | null`). Update the `TeamStatus` type.

## 7. CLI surface, frames, docs

- `src/cli.ts`: `.option('--into <global|root>')` on the `install` command (all three forms share it); `.option('--from <global|root>')` on `uninstall-skill`. Pass them through as `into` / `from`.
- `src/lib/frames.ts` `FRAME_FEATURES.installScope: true`. Update `src/lib/__tests__/frames.test.ts` expectation and `docs/frame-protocol.md`: rule 4 becomes "**`cwd` is advisory; every write names its destination.** `install` asks `Install to` (or takes `--into`), `sync` refreshes every registered checkout from any cwd, `uninstall-skill` takes `--from`." and the Versioning paragraph's `installScope` note says it is true.
- `src/lib/__tests__/invocation-catalog.ts`: the tripwire matches `src/cli.ts` lines by exact content; update the `install` / `uninstall-skill` patterns if they are catalogued, and keep the catalogue in sync with the new lines (run the invocation-hints test to see what it demands).
- `.claude/skills/terum-skills/SKILL.md` Table A rows for `install` and `uninstall-skill`: add `[--into global|<checkout root>]` and `[--from global|<checkout root>]` to the command cells and one clause each explaining them. `README.md` line 71 (`install <ref>` / `uninstall-skill <ref>` row) and line 89 (`Placement is a plain copy` paragraph) mention `--into` / `--from` and that `sync` refreshes registered checkouts from anywhere.

## 8. Spec sentences (edit exactly these places; line numbers are from the base tree — anchor by the quoted text)

`.planning/specs/2026-09-02-phase-1-build.md`:
- The layout block line `<product repo>/.claude/skills/<name>/        project-list installs (§6)` → `<checkout>/.claude/skills/<name>/          a copy in a registered checkout, chosen at install (`--into`)`.
- Append to the paragraph starting `**`scope` is a discriminated union, not a string**`: ` A `pending` entry carries the machine-local destination; the shared record never does.`
- Replace the whole paragraph starting `**Project resolution** is by worktree` with: `**Destination is chosen, not resolved.** `install` asks 'Install to' among Global and the registered checkouts, defaulting to the one whose origin matches the package's `remotes` when exactly one does; cwd never decides. `sync` refreshes every placement under Global or a registered checkout from any cwd, skips the rest with one grouped notice, and writes the exclude line in the checkout that holds the copy.`
- Append to the paragraph starting `` `declined` is a **single rule with no scope qualifier** ``: ` `declined` is written by `uninstall-skill` only when the last copy at that scope leaves this machine.`
- Append to the `install <ref>[@<version>] | member <handle> | project <name>` bullet: ` `--into global | <absolute checkout root>`; an unregistered root is registered by the install; bulk forms ask once.`
- Append to the `uninstall-skill <ref> | member <handle> | project <name>` bullet: ` `--from global | <root>` names the copy; the shared record and `declined` change only when no copy at that scope remains.`
- In the `sync [--hook]` bullet, add a sentence citing the destination paragraph: ` Placement eligibility follows the "Destination is chosen, not resolved" rule in §5.4.`
- Table row `| project-list skill in a matching repo | place, subject to the same rule | subject to the same rule |` → `| project-list skill, any registered destination | place | place |`.
- Append to the paragraph starting `An **orphan** is a ledger entry`: ` A placement under an unregistered folder is *unregistered*, not an orphan; no automatic path touches it.`
- Defaults list item `6. Personal skills install globally; only team project lists place into product repos (no `--project` on install in v1).` → `6. Superseded 2026-09-09: destination is chosen; scope is the package.`

`.planning/specs/2026-09-01-team-skill-sharing.md`:
- D14 row: replace `Team **project** skills auto-place when `sync` runs inside a matching repo.` with `Team **project** skills place into the registered checkout the member chooses; sync refreshes registered checkouts from anywhere.`
- D17 row and the §3 bullet starting `- Scope is not a property of the skill and is not derived from any folder (D17)`: replace the sentence about placing into the matching repo with `**Scope is the package**: which team.json list the install came from (Global, or a project). The folder is machine-local and never shared.` Remove the `v1 has **no install-time scope override**` sentence from the bullet (it now has `--into`).

## 9. Tests (vitest, collocated). Each new test must FAIL on the base tree and PASS after — write them so the assertion is on the new behaviour, not on incidental output.

`src/commands/__tests__/install.test.ts`:
- a Global-package skill installed with `into: <checkout>` lands at `<checkout>/.claude/skills/<name>` with ledger scope `{kind:'global'}` (today the global scope forces home).
- the existing case that installs `project alpha` from an outside cwd and expects `no matching project context` now succeeds when `into: <alpha checkout>` is passed (rewrite that assertion; the outside cwd no longer matters).
- an unregistered root passed as `into` ends up in `config.checkouts` and `Registered <p> in your library.` is printed exactly once.
- a missing root is refused with `Checkout folder <p> is missing`, the folder is NOT created (assert ENOENT after), no pending entry remains, no placement.
- two registered checkouts whose origins both match the package's remotes → `Install to` is asked (ScriptedPrompter records `offered`) and no `current repository`/default marker; assert the choice list content.
- the pending entry carries `destination`; a rerun of the same install with `@<v2>` while the pending entry exists updates that entry's `version` in place (one entry, new version) rather than skipping.
- ledger ownership lookup through an aliased root: record a placement under the realpath (`/private/tmp/...` on macOS — use `realpath()` of a temporary dir vs the un-resolved path; on Linux create a symlink to the checkout and install through the symlink) and re-install through the alias: the copy is re-placed (`ours`), not refused as foreign.

`src/commands/__tests__/sync.test.ts`:
- flip the test `leaves a hand-edited project placement untouched outside its checkout, then repairs it in that checkout`: with checkout B registered, a sync from cwd A (or from an unrelated dir) repairs B's copy and the exclude line lands in B's `.git/info/exclude` (today A's).
- an unregistered checkout B is skipped, the copy untouched, and exactly one grouped notice `Skipped 1 placement… under folders not in your library: <B>` appears (check the notice appears once even with two unregistered placements).
- a pending install whose `destination` is a checkout replays into that checkout from any cwd.
- the orphan pass skips an unregistered root (no adopt/decline question for it, people file untouched).
- the endorsed batch asks `Install to` exactly once for a batch of two candidates.

`src/commands/__tests__/uninstall.test.ts`:
- Global + checkout copies of one skill (same scope): `from: <checkout>` removes only that copy; the people-file record and `declined` are untouched; then removing the last copy drops the record and writes `declined` (for an endorsed id).
- non-interactive with two copies and no `--from` → error naming `--from`.

`src/commands/__tests__/join.test.ts`: the post-join endorsement offer asks `Install to` exactly once for a batch (with one registered checkout present, so the question is not skipped).
`src/commands/__tests__/status.test.ts`: a pending entry's `destination` is serialised (`{kind:'checkout', root}`), and `null` when absent.
`src/lib/__tests__/frames.test.ts`: `installScope: true`.

Keep every existing test green unless the spec above changes its behaviour; when you change an existing test, say which and why in the report.

## Gates

Run and report real counts: `npm run lint && npm run typecheck && npm test && npm run build`. The invocation-catalog tripwire test (`src/commands/__tests__/invocation-hints.test.ts` / `src/lib/__tests__/invocation-catalog.ts`) and the bundled SKILL.md copy check (grep for the test that compares `.claude/skills/terum-skills/SKILL.md` with its bundled copy) both apply to the new flags: if a bundled copy of SKILL.md exists elsewhere in the tree (e.g. under `skill/` or `dist/`), update both copies.

If the spec is ambiguous, record the question in `openQuestions` and implement the most conservative reading; never resolve a design fork on your own. Do not run git. Do not commit. Leave changes in the working tree.

## Anchors in this tree (read before editing)


### CLI-1 helpers you MUST reuse (src/lib/checkouts.ts, src/lib/local-skills.ts)

- `config.checkouts?: string[]` (schema.ts) — the registry. Read it as `config.checkouts ?? []`.
- `checkoutPath(path)` = realpath with a lexical fallback; `underCheckout(path, root)` = prefix test on canonical paths. Use these for every "is this path under Global / a registered checkout" comparison — do not write a second realpath-compare helper.
- `registerCheckout(store, root, io, { home, explicit?: boolean, mutate? })` — THE registration transaction; with `explicit` unset it prints exactly `Registered <realpath> in your library.` when the root was new and nothing when it was already registered. `install --into <root>` calls this (F1). Its own errors (`<root> does not exist.` / `<root> is not a folder.`) are NOT the message the spec wants for a missing `--into` root: check existence yourself FIRST and throw `Checkout folder <p> is missing` before calling it.
- `writableCheckout(cwd, home, stateRoot)` — the cwd's repository root when it is a plausible checkout (not Global, not the state root). Use it to derive the destination for an old `pending` entry that has none (sync replay) and to find the cwd checkout for the `current repository` label.
- `nearestRepoRoot(cwd)`, `canonicalLedger(config)` and the module-private `canonicalParentPath(path)` in local-skills.ts — export `canonicalParentPath` and use it for the ledger ownership lookup in install (§2).
- The `checkout` verb (src/commands/checkout.ts) is the explicit registry UI; do not change its behaviour.

### Prompter default for `Install to`

`Prompter.select(question, choices)` (src/lib/prompt.ts) has no default today; the frames `AskFrame` already has an optional `default` field (src/lib/frames.ts). Add an optional third parameter `defaultChoice?: string` to `Prompter.select`: the terminal implementation accepts an empty answer as the default when one is given (otherwise unchanged: re-ask); the frames implementation passes it as `default` on the `ask` frame and accepts an empty/absent answer as the default; `ScriptedPrompter.select` in src/lib/__tests__/fixtures.ts returns `defaultChoice ?? choices[0]` on an empty scripted answer and records the default (e.g. push `{ choices, defaultChoice }` or keep `offered` as choices and add `offeredDefaults: (string | undefined)[]`). Global is always the first choice; the default is expressed only through `defaultChoice` — never by re-ordering. `NonInteractivePrompter.select` keeps throwing.

### Other anchors in this tree

- `src/commands/install.ts`: `installOne(input, io)` has the `matchingProject` / `selectScope` / `currentRepoRoot` helpers at the bottom of the file; `samePending` and `placementHome` are the last two lines. `run()` has three branches (member / project / single ref); `team.ts` `join()` calls `installOne({ team, id, store, runner }, io)` in a loop after `Install N team-endorsed skill(s)?`; `sync.ts` calls `installOne` twice (pending replay with `scope: pending.scope`, endorsed batch) and `uninstallOne` once.
- `src/commands/sync.ts`: the refresh loop is `for (const [path, entry] of Object.entries(currentConfig.placements))` and computes `projectRoot` via `matchingProjectRoot(clone, entry.scope.project, runner, args.cwd)`; `reconcileOrphans(store, runner, io, defer, notice, skipTeams, record)` is below `approved()`; `matchingProjectRoot` is the last helper before `plural()`.
- `src/commands/uninstall.ts`: `uninstallMany` filters `matching` by `entry.id === target.id && entry.team === input.team && sameScope(entry.scope, target.scope)`; `removePlacements` is the ledger-driven remover; `ledgerScopes` unions people-file and ledger scopes.
- `src/commands/status.ts`: `TeamStatus.pending` is built inline from `config.pending.filter(e => e.team === team)`.
- `src/cli.ts`: the `install` and `uninstall-skill` commands are one-liners with `.option('--team <team>')` (one-team may have removed `--team`; keep whatever is there and add the new option). `src/lib/__tests__/invocation-catalog.ts` lists `src/cli.ts` lines by exact content: run `npx vitest run src/commands/__tests__/invocation-hints.test.ts` and update the catalogue entries the tripwire names.
- The bundled `/terum-skills` skill doc is the single canonical file `.claude/skills/terum-skills/SKILL.md` (copied into `dist/` by `scripts/bundle-skill.mjs` at build time) — edit only that one.
- Home root for eligibility: `AGENT_PATHS['claude-code'].global(home)`; `install` derives `home` via `input.home ?? placementHome(input.store)`. Sync has `args.home?` — check; if it does not, add it the same way install does (test knob) and default to `placementHome(store)`.
