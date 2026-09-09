Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly, then ./CLAUDE.md.

You are implementing inside a git worktree of the terum-skills repo (npm package `terum-skills`, TypeScript, ESM, Node 22, vitest). `node_modules` is already in place. This is a CLI-only batch: touch nothing under `desktop/`.

# Standing constraints

- Do NOT run any `git` command (no status, no add, no commit, no stash, no fetch). The worktree's git metadata lives outside your writable root and every git write errors; the orchestrator owns version control. Verify your writes by reading files back.
- Do not commit, do not push, do not stage. Leave changes in the working tree.
- Grep for existing code before writing a new function; extend it in place. Never leave two paths doing the same thing (CLAUDE.md "Before implementing").
- Run `npm run lint`, `npm run typecheck`, `npm test` (all three; from the repo root, absolute paths, no `cd`) and report REAL counts in the report. `npm run build` must also pass (`tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs`).
- If the spec is ambiguous, record the question in `openQuestions` and implement the most conservative reading. Never resolve a design fork on your own; every fork in this spec is already resolved (F1, F2, F3, F5, F7, F10 below).
- Never weaken, delete or skip an existing test to get green. Existing tests that assert the exact `io.lines` of `ls --local` (src/commands/__tests__/ls.test.ts) WILL need their expected lines updated because the header and the final count line change; update them to the new exact text, do not loosen them to `toContain`.
- Two tripwires you must satisfy in the same change:
  1. `src/lib/__tests__/invocation-tripwire.test.ts` inventories every source line (outside `__tests__`) containing the literal `terum-skills`, and compares it to `src/lib/__tests__/invocation-catalog.ts` (file + exact trimmed line). If you add or change any such line (e.g. a `checkout add` hint that goes through `invocation(...)` does NOT contain the literal, but a description string mentioning `terum-skills` does), add/update the catalogue entry with the exact trimmed pattern and a `policy` ('routed' | 'fixed' | 'prose' | 'not-a-hint'). Prefer `invocation(form, 'checkout add', path)` from `src/lib/invocation.ts` for any printed command hint so no new literal appears.
  2. `src/__tests__/bin.test.ts` ("the build bundles the canonical /terum-skills skill ... byte for byte") requires `.claude/skills/terum-skills/SKILL.md` to be the file the build bundles; and `src/lib/__tests__/frames.test.ts` CP-19 requires every public commander verb (with an action) to appear in `FRAME_VERBS` in `src/lib/frames.ts` and every `FRAME_FEATURES` key to appear in the "`hello.features` names ..." sentence of `docs/frame-protocol.md`. So: add `'checkout add'`, `'checkout remove'`, `'checkout list'` to `FRAME_VERBS` (the bare `checkout` group has no action of its own, like `team`), add `checkouts` to the features sentence, and add the verbs to the bundled SKILL.md verb tables.
- Line numbers below refer to an older commit; anchor by symbol name, not by number. The code you find wins over a number.
- The `ls --local` row objects may already carry extra fields (e.g. `skillId`, `placed`, `connected`, `tracked`, `shared`, `placement`, `health`) from earlier batches. Keep every existing row field exactly as it is; this batch adds section-level fields and the `notOffered[].reason` code.

# THE SPEC — CLI-1 "checkouts registry and multi-root ls --local"

Locked spec (Ryan's 2026-09-09 Library ruling). Forks resolved: F1 = registration is automatic on writes, plus detected (unregistered) rows on reads; F2 = the skill-folder count counts every directory holding a SKILL.md file, name-mismatched ones included, shown as not connectable; F3 = non-git folders may be registered; F5 = `checkout remove` is registry-only (no ledger change, no file deletion); F7 = the terminal keeps the cwd repo as a labelled "not registered" section; F10 = registered means consented to refresh (future batches), nothing more.

Model in one breath: the Library is this machine's folders. `config.checkouts` (CLI-owned, in `~/.terum/skills/config.json`) lists the checkout roots this machine scans and refreshes. Registration grants NO connect consent and NO tool-grant consent (the 2026-09-07 per-folder connect ruling; see connect.ts `connectOne` consent y/N and install.ts's approvals gate). Reads never register; writes that land a Terum copy in a checkout do.

## 1. Schema (`src/lib/schema.ts`, `configSchema`)

`configSchema` gains `checkouts: z.array(z.string()).optional()`. Readers treat absent as `[]`. Writers assign the full array (`config.checkouts = [...]`), never `delete` the key (config.ts's `update()` writes the object back verbatim; the store's `preserveUnchanged`/key-appending behaviour must keep working). Entries are absolute realpaths of checkout roots (the folder that contains `.claude/`), unique. `emptyConfig()` stays as it is (no `checkouts` key) so a config without the key parses.

## 2. Verb `checkout` (`src/cli.ts` beside `team`; new `src/commands/checkout.ts`)

Follow the `team` pattern: `program.command('checkout')` group with three subcommands, each `run(args, io)` returning `Result`, wired through the `CliVerbs` map (`checkout?: typeof runCheckout`) and `execute(..., { verb: 'checkout add' | 'checkout remove' | 'checkout list', notices: true })`.

- `checkout add [path]` — with no path: asks (`io.text`) "Which folder?" defaulting to the nearest repo root of `cwd` (the same upward `.git` walk `localSkillRoots` does in `src/lib/local-skills.ts`; factor that walk into a reusable exported helper, e.g. `nearestRepoRoot(cwd)`, and use it from both places), else `cwd` itself when no ancestor is a repository. Refuses (failure Result, nothing written) a path inside the state root (`assertNotInsideStateRoot` from `src/lib/skill-source.ts`) and a path that realpaths to the parent of the home skills root (i.e. `home` itself, whose `.claude/skills` is the Global root — global precedence, the same dedupe `localSkillRoots` already does). A nonexistent path is refused too ("does not exist"). Git is NOT required (F3). Stores the realpath. Idempotent: adding an already-registered root prints "Already registered <path>" and succeeds. Prints "Registered <path>" on success. Result value: `{ path: string; registered: boolean /* false when already present */ }`.
- `checkout remove <path>` — registry only (F5): removes the realpath (or the literal string if realpath fails) from `config.checkouts`, assigns the resulting array (possibly `[]`; the key stays present). Prints "Removed <path> from your library." and then one line saying how many ledger placements remain under it: "N placements recorded under <path> stay in the ledger; uninstall-skill removes them." (count = `config.placements` keys whose realpath/lexical path is inside the root). A path not registered → failure "…is not registered." Result value: `{ path: string; placementsRemaining: number }`.
- `checkout list` — one line per registered entry: `<path> — <rootState>; <N> skill folders` where rootState is `scanned` | `absent` | `unreadable` for `<root>/.claude/skills` (reuse `localSkills`), followed by "none" when empty. Result value: `{ checkouts: { path: string; rootState: 'scanned'|'absent'|'unreadable'; skillFolders: number }[] }`.
- All three run WITHOUT `selectTeam` (ls.ts's `--local` precedent: local state needs no team), under `store.update` for the two writers (`createConfigStore()` default root, `args.config` injectable for tests; `args.home`, `args.cwd` injectable like `ls`). Over `--frames`, `add` with no path is an ordinary `ask` frame (it just uses `io.text`; nothing special to do).

## 3. Automatic registration on writes (F1)

`install --into <root>` does not exist yet (that is CLI-2), so in THIS batch:
- `connect` (src/commands/connect.ts, `connectOne`, at the point where it records `fresh.shared[id] = { source, team, baseline }`): if the connected folder's source lies under a checkout root — define "checkout root" as the nearest repo root of the source folder's parent, found by the same `nearestRepoRoot` walk, provided that root is not `home` (global) and not inside the state root — then register that root in the same `store.update` (append to `config.checkouts` if absent). Print exactly one line `Registered <root> in your library.` the first time (i.e. only when it was not already registered). A source under `~/.claude/skills` or anywhere with no repository ancestor registers nothing.
- `publish` (src/commands/publish.ts): a publish run FROM a checkout — i.e. `args.cwd` has a nearest repo root that is not `home` and not inside the state root — registers that root (same rule, same line, printed once, only when newly registered). Do this after the endorsement succeeded (after safeWrite/PR creation), never on a declined or failed publish. Note `notInTeam()` is a read path: it must not register.
- Reads (`ls`, `status`, `search`) never register. Add one shared helper (e.g. `registerCheckout(store, root, io)` in `src/lib/checkouts.ts` or inside `src/lib/local-skills.ts` — one place, exported) that both connect and publish and the `checkout add` verb use, so the realpath/uniqueness/print-once rule lives once.

## 4. Detected roots (F1)

`ls --local` also reports candidate roots that are NOT registered, derived (deduped by realpath against the registered list and the global root) from:
- the cwd's nearest repo root (terminal only — i.e. whenever `cwd` is passed, exactly as today);
- the repo roots of every `config.shared[*].source` (nearest repo root of the source's parent directory);
- the repo roots of every `config.placements` key whose `scope.kind === 'project'`.
Each appears as its own section with `registered: false, detected: true`. The terminal header for a detected section carries the suffix `; detected, not registered — \`<inv> checkout add <path>\` keeps it in your library` where `<inv> checkout add <path>` is `invocation(form, 'checkout add', path)` from `src/lib/invocation.ts` (pass `args.form` down into `showLocal`). No writes happen on a read.

## 5. Discovery (`localSkillRoots` in `src/lib/local-skills.ts`)

New signature: `localSkillRoots(home: string, cwd?: string, checkouts: readonly string[] = [], extraRoots: readonly string[] = [])`. Order of roots:
1. global first (`{ root: <home>/.claude/skills, scope: 'global', registered: false, detected: false }` — the global root is neither; keep `repoRoot` absent for it as today);
2. then one `{ root: <checkout>/.claude/skills, scope: 'project', repoRoot: <checkout>, registered: true, detected: false }` per registry entry, in registry order, deduped by realpath (a registered entry that realpaths to `home` is dropped — global precedence; duplicates within the registry collapse to the first);
3. then detected roots — the cwd repo root (existing behaviour) and `extraRoots` — deduped by realpath against the global root and the registered ones, with `registered: false, detected: true`.
`LocalRoot` gains `registered: boolean` and `detected: boolean`. The `noRepository` and `problems` behaviours of today stay exactly as they are (existing tests in `src/lib/__tests__/local-skills.test.ts` pin them; they will need the two new booleans added to their expected objects — that is the only change allowed to them). The callers in connect.ts and publish.ts (`notInTeam`) now pass `config.checkouts ?? []` as the third argument so their pickers see registered roots too (item 8).

## 6. Sections on the wire (`LocalSection` in `src/commands/ls.ts`, built in `showLocal`)

`LocalSection` gains:
- `registered: boolean`, `detected: boolean` (from the root);
- `rootState: 'scanned' | 'absent' | 'unreadable'` (already computed by `localSkills`, never serialised until now);
- `label: string` — basename of `repoRoot` for a project root; `'Global'` for the home root; display only;
- `counts: { skillFolders: number; connectable: number }`.
`notOffered[]` entries gain `reason: SourceProblem` (the typed code from `src/lib/skill-source.ts`) and keep the prose in a new `detail: string` field (today's `reason` string becomes `detail`; update the existing test expectations accordingly — the printed "Cannot be connected:" lines keep printing the prose).

Count rule (F2): `skillFolders` = `rows.length` + the number of `notOffered` entries whose `reason` is a frontmatter problem — one of `no-frontmatter`, `invalid-yaml`, `illegal-name`, `name-mismatch`, `description-missing`, `unsupported-field`, `malformed-allowed-tools`, `managed-wrapper` — i.e. a directory that holds a SKILL.md file. Excluded: `symlink`, `nested-symlink`, `not-a-directory`, `skill-md-missing`, `skill-md-not-a-file`, `inside-state-root`. `connectable` = `candidatesOf(inventory).length` (default, non-privileged).

Printed text: the section header becomes `Local Claude Code skills (<root>; <scope>; registered):` for a registered root, `Local Claude Code skills (<root>; <scope>; detected, not registered — \`<inv> checkout add <repoRoot>\` keeps it in your library):` for a detected root, and stays `Local Claude Code skills (<root>; global):` for the global root. After the rows / "Cannot be connected:" block / "none" line of each section, print a final line `  N skill folders (M connectable)` (singular `1 skill folder`). Row lines and "Cannot be connected:" lines are unchanged.

A registered root whose folder is missing altogether → `rootState: 'absent'`, zero rows, no throw, still listed (the `none (<root> does not exist)` line as today plus `0 skill folders (0 connectable)`). A registered folder with no `.claude/skills` → the same (`absent` on the skills root, checkout still listed).

## 7. Hello

`FRAME_FEATURES` in `src/lib/frames.ts` gains `checkouts: true` (single consumer: the desktop app's Add-checkout affordance). `docs/frame-protocol.md`: add `checkouts` to the "`hello.features` names …" sentence (say it is true and means the `checkout` verbs and the `registered`/`detected` section fields exist), and in rule 4 ("Set `cwd` deliberately") add the note that for reads (`ls --local`) `cwd` is a suggestion: the detected cwd repository is reported as not registered, and registered checkouts are listed regardless of `cwd`. Also add the three `checkout` verbs to whatever verb list the doc carries if it lists verbs.

## 8. Pickers

`connect`'s picker (the `choices` Map in `run()` built from `candidates`) and `publish`'s `notInTeam` keep calling `localSkillRoots` with `cwd` and now also pass `config.checkouts` so they see registered roots. The picker key becomes `Connect <name> (<label>)` — label = section label (`Global` or basename of repoRoot) — whenever two candidates share a name across roots, and is further qualified by path (`Connect <name> (<label>: <path>)`) when two roots share a basename; today two project roots with the same skill name collide in the Map, which must no longer happen. Carry the root's label on each candidate (`{ ...entry, scope, label, repoRoot }`).

## 9. Performance

`localSkills()` re-canonicalises `config.shared` and `config.placements` per root (the `sharedPaths` / `placementPaths` arrays). Compute them once per `showLocal` call (and once per connect picker loop iteration / notInTeam call) and pass them in — e.g. an optional `options.ledger` precomputed by an exported `canonicalLedger(config)` helper; when absent, `localSkills` computes it itself so existing direct callers and tests keep working.

## 10. uninstallMachine

`src/commands/uninstallMachine.ts` `store.remove(...)` predicate: a config whose only remaining content is `checkouts` is still removable (checkouts is machine-local; the backup record written earlier in that command already captures the whole config). Do not add `checkouts` to the "Kept … still configured" list.

## 11. Docs / spec text

- `.planning/specs/2026-09-02-phase-1-build.md`: on the rev line block at the top (the paragraph of `**Rev N …**` lines near line 5), append a new line: `**Rev 16 (Ryan, 2026-09-09):** the machine registers checkouts (\`config.checkouts\`); reads scan Global, every registered checkout and, in a terminal, the current repository labelled not registered.` (Use the next free rev number if 16 is taken.) In the `ls --local` paragraph of the verbs section (the one starting `- **\`ls\`** —` … "`ls --local` (not combinable with …"), append the sentence: `Every section carries \`registered\`, \`detected\`, \`rootState\`, \`label\` and \`counts { skillFolders, connectable }\`; a skill folder is a directory holding a \`SKILL.md\` file, counted whether or not \`connect\` would accept it; symlinks and non-skill shapes are not counted.` In the §5.4 `config.json` jsonc block, add after `"placements"` a line `"checkouts": ["/Users/ajay/code/app"],            // roots this machine scans and refreshes; written by checkout add|remove and by writes that place a copy there; grants no connect or tool consent`.
- `.planning/specs/m7-S7f.md`, the `- **AD-21 \`library({scope})\`:**` bullet: insert immediately after the bold label the sentence `Library rows are \`ls --local\` sections per root; team fields enrich rows by \`skillId\`; the read never depends on a readable team.` and keep the rest of the bullet.
- `README.md` Commands table: add a row under Team (after the `ls [--local]` row) `| | \`checkout add [<path>]\` / \`checkout remove <path>\` / \`checkout list\` | Register, forget, or list the checkout folders this machine scans (\`ls --local\` also shows the current repository, labelled not registered) |`; in the "How it works" section add one short paragraph `**Your library is your folders.** \`ls --local\` scans \`~/.claude/skills\` (Global), every checkout registered with \`checkout add\`, and the repository you run it from. Registering a folder only tells this machine to scan and refresh it; connecting a skill or approving a tool grant is still a separate yes.`
- `.claude/skills/terum-skills/SKILL.md`: add `checkout add|remove|list` to the description's run-here list and a Table A row `| \`checkout add <abs-path>\`, \`checkout remove <abs-path>\`, \`checkout list\` | \`add\`/\`remove\` write only \`~/.terum/skills/config.json\` (the registry); confirm with the user before \`add\` or \`remove\` | show stdout |` and a Table B row `| \`checkout add\` (no path) | none | \`npx -y terum-skills@latest checkout add\` — it asks "Which folder?" defaulting to the current repository |`. This file is bundled byte-for-byte; keep its frontmatter intact.
- `src/lib/__tests__/invocation-catalog.ts`: update for every changed/added source line containing `terum-skills` (see the tripwire note above).

## Tests — each must FAIL on the current tree and PASS after your change

Write them in the existing style (collocated `__tests__`, `temporaryDirectory()`, `createConfigStore(join(home,'state'))`, `ScriptedPrompter`, no network, no git for the local-only ones).

- `src/lib/__tests__/local-skills.test.ts`: (a) two registered roots + an unregistered cwd repo root → global then two `registered:true, detected:false` project sections in registry order then the cwd one `registered:false, detected:true`; (b) a registered root that realpaths to the home root is dropped (global precedence); (c) a missing registered root → the section exists, `localSkills` gives `rootState 'absent'`, zero entries, no throw; (d) a registered folder with no `.claude/skills` → listed with 0 folders (rootState 'absent').
- `src/commands/__tests__/ls.test.ts`: `--local` with `config.checkouts = [repoA]` and `cwd` inside a different repo B prints the registered section (header ends `; project; registered):`) and the detected cwd section (header carries `detected, not registered` and the `checkout add <repoB>` hint); `counts.skillFolders` counts a name-mismatched folder and excludes a symlink; `notOffered[].reason` carries the typed codes (`name-mismatch`, `symlink`); `label` values (`Global`, basename); the `N skill folders (M connectable)` line; the config file is byte-identical after the read (no registration on reads).
- New `src/commands/__tests__/checkout.test.ts`: `add` with no path asks "Which folder?" with the repo-root default (ScriptedPrompter answer `''` takes the default); idempotent second add prints "Already registered"; realpath stored (register through a symlink alias, expect the real path); refuses a path inside the state root and the home root and a nonexistent path; `remove` leaves `checkouts: []` (key present, `config.json` parses through `configSchema`, `placementsRemaining` counts a ledger entry under the root); `list` shows an absent root with `0 skill folders` and a scanned one with its count; none of them ask for a team (works with zero teams configured).
- `src/commands/__tests__/connect.test.ts`: connecting a folder that lives under an unregistered repo (create `<root>/.git` dir and `<root>/.claude/skills/<name>`) registers the root and prints `Registered <root> in your library.` exactly once; a second connect under the same root prints nothing about registration.
- `src/commands/__tests__/publish.test.ts`: a publish with `cwd` inside a repo root registers it and prints the line once; a declined publish (push policy, confirm false) registers nothing.
- `src/lib/__tests__/schema.test.ts`: a config JSON without `checkouts` parses and one with `checkouts: ['/a']` parses; `checkouts: 'x'` is rejected.
- `src/lib/__tests__/frames.test.ts`: hello `features.checkouts === true` (the existing hello test compares against `FRAME_FEATURES`, so add an explicit assertion).
- `src/commands/__tests__/uninstallMachine.test.ts`: a config with only `checkouts` left is removed (`configRemoved: true`).
- The invocation tripwire, `bin.test.ts` bundle test, and CP-19 frames tests must pass with the catalogue/bundle/doc updated.

Report in the schema you were given: real gate counts, every file changed, `openQuestions` for anything you had to read conservatively, `deviations` for anything not implemented.
