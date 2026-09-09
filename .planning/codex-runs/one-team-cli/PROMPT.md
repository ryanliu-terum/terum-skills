Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly (its text is also inlined at the end of this prompt), then ./CLAUDE.md. Every line number below was verified against origin/main at 279830d, which is exactly the tree you are in; where a number and the code disagree, the code wins: find the quoted code.

This is the CLI half of "one team per machine". The desktop half is a separate PR and is out of scope (never edit `desktop/**`).

=================== THE RULING (locked; Ryan, 2026-09-08/09) ===================

Terum Skills keeps ONE team per machine. A machine that already has a team REFUSES any attempt to bind a second one (setup with a different target, `team join` of a different remote, `team create`, an `install` of a three-part ref naming another repository) BEFORE any side effect — no prompt, no gh probe, no app hand-off, no invitation, no clone, no repo creation, no push. The way to change team is `team leave <A>` then join. Leaving the last team also clears every `approvals` (skill consent) record. No forced sync on leave. Machines that already hold 2+ teams from before this rule ("legacy") keep working for reads, syncs, `team leave`, and writes that name a team explicitly; only NEW bindings are refused, and a bare single-team verb on such a machine gets a rewritten message. `--team` and `--as` stay parsed and validated but are hidden from help and from every printed hint. The `teams` record in config stays a record (no schema change, no migration). The session hook is unchanged.

=================== C1 — Invariant ===================

New bindings never create a second team; a legacy count may only decrease. Enforced at
(i) the shared pre-flight predicate (C2), and
(ii) `assertBindable` / `bindTeam` in `src/lib/auth.ts:194` and `:213`, which are already re-checked under the config lock at `src/commands/team.ts:286-287` (create) and `:347` (join). `assertBindable(config, team, remote)` ADDITIONALLY throws `RefusedError` (C3) when `config.teams` holds any own key other than `team` (the one being bound). Schema unchanged (`src/lib/schema.ts:84-92` teams stays a record; no migration).

=================== C2 — Shared pre-flight `refuseSecondTeam` ===================

Add to `src/lib/auth.ts`:

```ts
/** One team per machine (Ryan, 2026-09-08). Throws RefusedError before any side effect when binding `target` would add a second team. */
export function refuseSecondTeam(config: Config, target: { remote?: string; name?: string }, retry: string, form?: InvocationForm): void
```

- `retry` is the caller's own re-run command, ALREADY rendered through `invocation(form, ...)` by the caller (e.g. `invocation(form, 'setup', args.target)`, `invocation(form, 'team join', args.target)`, `invocation(form, 'team create', name)`), so the message can end with "then re-run `<that>`".
- Semantics, with `entries = Object.entries(config.teams)` (own keys only — the record inherits Object.prototype; use `Object.entries`, never `in`):
  - zero teams → return (nothing to refuse).
  - `target.remote` given and one team whose remote matches (BOTH sides normalised, see "remote matching") → return (same team: the caller resumes / updates as today).
  - `target.remote` given, exactly one team, remote differs → throw the ONE-TEAM message.
  - `target.name` given (create) and teams non-empty → throw (one team → ONE-TEAM message; 2+ → LEGACY message). `team create` never resumes.
  - no remote and no name (bare `setup`): exactly one team → return (resume); 2+ → throw the LEGACY message.
  - 2+ teams and a remote: throw the LEGACY message even when one of them matches? NO — if one of the legacy teams matches the remote, return (that is today's rejoin/update of an existing entry, which never increases the count). Otherwise throw the LEGACY message.
- Messages (executable form via `src/lib/invocation.ts`; `<inv>` is `invocation(form, ...)`), and the error string MUST start with the stable prefix `One team per machine: `:
  - ONE-TEAM: `One team per machine: This machine is on team <A> (<remote, credential-stripped via stripRemoteCredentials>). Terum Skills keeps one team per machine: run \`<inv> team leave <A>\` first, then re-run \`<retry>\`.`
  - LEGACY (2+): `One team per machine: This machine is configured for teams <a>, <b>; Terum Skills keeps one team per machine. Run \`<inv> team leave <name>\` for each team you no longer want, then re-run.` (`<name>` is a literal placeholder there; team names joined with `, ` in object-enumeration order.)
- Remote matching: `teamByRemote` (`auth.ts:203-206`) currently normalises only its argument and compares against the STORED string raw; stored strings are not canonicalised by the schema. Change it to normalise BOTH sides, exactly the pattern `install.ts:208` already uses (`normalizeRemote(entry.remote) === normalizeRemote(remote)`). Guard the stored-side call: if `normalizeRemote` throws on a malformed stored value, fall back to comparing that entry's raw string. `refuseSecondTeam` and `teamForReference` use the same comparison (one path: make `teamForReference` call `teamByRemote` instead of its own inline find).

Call sites (each: immediately after `store.read()` + target/name parse, BEFORE any prompt, gh probe, app hand-off, invitation, clone, repo creation or push):

1. `setup` — `src/commands/setup.ts`. Today the config is read at `:127-128` AFTER the app step (`:107-119`). Move the `const before = await store.read()` ABOVE the app step (right after the welcome lines) and call `refuseSecondTeam` there:
   - joiner (`args.target` given): `parseJoinTarget(args.target)` (already imported from `./team.js`) then `refuseSecondTeam(before, { remote: target.remote }, invocation(args.form, 'setup', args.target), args.form)`. Same remote → resume as today (`:165-169`, "Team <A> is already configured on this machine."). Different remote → refused (typed, see C3) before the app step runs.
   - bare setup: `refuseSecondTeam(before, {}, invocation(args.form, 'setup'), args.form)`: exactly one team → resume as today; 2+ → refused with the LEGACY message.
   - The resume line at `:129` becomes: `Resuming setup for team <A>. Terum Skills keeps one team per machine; to move this machine to another team run \`<inv> team leave <A>\` first.`
   - `failed()` at `:81-83`: it must preserve the typed flags. Make it accept either a thrown error or a child `Result` (both shapes reach it today: `failed(error, …)` from the catch and `failed(result.error, …)` from child verbs). Change the child-verb call sites (`:145`, `:158`, `:172`, `:196`, `:198`, `:215`, `:226`) to pass the child `Result` itself where one exists (so `refused` AND `cancelled` are copied onto the returned failure), and in the catch path map `RefusedError` → `refused: true` and `CancelledError` → `cancelled: true` (use/extend `fromError` from `src/lib/result.ts` rather than re-deriving). Keep the `value` payload (`{ role, team, remote, steps }`) on every failure as today. NOTE for the reviewer: a sibling PR (fix/first-run-in-app) makes the identical `cancelled` change to `failed()` and adds `intent: 'setup'` to the app call at `:111`; keep your change minimal and local to `failed()` and its callers.
2. `team join` — `src/commands/team.ts:310`, after `parseJoinTarget` (`:305`) and `store.read()` (`:308`), before `:311`: `refuseSecondTeam(configBefore, { remote: normalized }, invocation(args.form, 'team join', args.target), args.form)`. Different remote with teams non-empty → refused before `detectOrOfferGh` (`:321`), `acceptOrDirect` (`:322`), `ensureClone` (`:325`) and the roster push. Same remote → today's update/rejoin path (`:311-313`) unchanged.
3. `team create` — `src/commands/team.ts:219`, after the name question (`:214`) and `store.read()` (`:219`), before identity/gh (`:236` / `:243`): `refuseSecondTeam(config, { name }, invocation(args.form, 'team create', name), args.form)`. Teams non-empty → refused (create never resumes). The existing name/remote rejections at `:221` and `:234` stay for the zero-team case (they are unreachable with a team configured once the refusal precedes them; leave them in place).
4. `install` three-part ref — `src/commands/install.ts:206-210` `teamForReference`: when `remote` is given and no configured team matches, a machine WITH at least one team gets `RefusedError` carrying the C2 ONE-TEAM (or LEGACY) message (retry = `invocation(form, 'setup', remote.replace(/^github\.com\//, ''))`) — i.e. call `refuseSecondTeam(config, { remote }, retry, form)` first, and only when it returns (zero teams) throw today's `NotJoinedError` for the zero-team bootstrap. The zero-team bootstrap at `:64-75` is kept; it must rethrow the child setup's TYPED outcome: `bootstrapped.refused` → throw `new RefusedError(bootstrapped.error)`, `bootstrapped.cancelled` → throw `new CancelledError(bootstrapped.error)`, else `new Error(bootstrapped.error)`. `publish`, `decline`, `uninstall-skill` inherit through `teamForReference`; check each caller compiles.

=================== C3 — Typed refusal ===================

- `src/lib/result.ts`: add `export class RefusedError extends Error { readonly refused = true; }`; the `Result` failure shape gains `refused?: true` (beside `cancelled?: true`); add `export function refused(message: string): Result<never>`; `fromError` maps `RefusedError` → `refused(message)` (and keeps `CancelledError` → `cancelled`).
- `src/lib/frames.ts`: `ResultOutcome` (`:66`) gains `refused?: true`; `ResultFrame` (`:24`) gains `refused?: boolean`; in `result(outcome)` (`:184`, the line `if (outcome.cancelled === true) frame.declined = true;`) add `if (outcome.refused === true) frame.refused = true;`. `FRAME_PROTOCOL` stays 1 (additive).
- `src/lib/execute.ts:33` and `:43`: pass `refused` through exactly like `cancelled` (`...(outcome.refused ? { refused: true } : {})`).
- `setup.ts` `failed()` preserves `refused` and `cancelled` (C2 item 1).
- `docs/frame-protocol.md:19`: document `refused:true` beside `declined:true` — "and `refused:true` when the CLI refused the operation before any side effect (one team per machine); a refusal is not a decline". Add one example line near `:58` if the file has an examples block. Protocol number unchanged.
- Exit code stays 1.

=================== C4 — `team leave` ===================

`src/commands/leave.ts`:
- `teardownTeam` (`:113-118`, the final `store.update`): after `delete fresh.teams[name]`, `if (Object.keys(fresh.teams).length === 0) fresh.approvals = {};`.
- Inventory (`:32-35`): when this is the LAST team (`Object.keys(config.teams).length === 1` at inventory time) and `Object.keys(config.approvals).length > 0`, print `Skill consent records will be cleared (<N>); the next team asks again for skills that need tool permissions.` (N = that count).
- The ask (`:37`) when it is the last team: `Leave <A>? This removes <n> placed skill(s), the local clone and your skill consent records; your membership in <remote> is unchanged.` When other teams remain (legacy), the ask stays exactly as today (consent records are not mentioned and not cleared).
- Keep: dirty-clone quarantine, authoring-source protection, no final sync, evals preserved, and the partial-failure behaviour `leave.test.ts:146-158` pins.
- Hook-tail race: today the last-team hook removal (`:42-48`) runs OUTSIDE the team mutex after `teardownTeam` released it (`:120`). Fix: `teardownTeam` gains an optional trailing parameter `onLastTeam?: () => Promise<void>`, invoked INSIDE the `try` (so before the `finally` release) right after the final `store.update`, only when the fresh config has zero teams. `leave.ts` passes the hook-removal closure (with its existing try/catch and both print lines) as that callback and drops the post-release block. `uninstallMachine.ts:117` passes nothing (it removes the hook itself before tearing teams down). `LeaveResult` unchanged.

=================== C5 — Legacy 2+ machines: what keeps working (do NOT gate) ===================

status (`status.ts:60`), search (`search.ts:29-31`, `:80`), sync / sync --hook (`sync.ts:130/294/337/352/472`), `ls --local` (`ls.ts:109`), machine uninstall (`uninstallMachine.ts:26/97/107/126`), `guardPush.ts:34`, `update.ts:90`; writes with explicit `--team` or a qualified `<team>/<skill>` ref (`config.ts:25`, `install.ts:207/:220`); `connect --forget/--relocate/--keep-*` (`connect.ts:64-66`); `team leave <name>`. Only NEW bindings are refused.

Bare single-team verbs on 2+ get `selectTeam`'s rewritten message (`src/lib/config.ts:29`): `This machine is configured for teams a, b; Terum Skills keeps one team per machine. Run \`<inv> team leave <name>\` for each you no longer want; until then name one with --team.` (`<name>` literal; `<inv>` via `invocation(form, 'team leave', { raw: '<name>' })` or equivalent — a placeholder is a RawFragment, never quoted). This is a plain `Error` (not refused): the verb did not try to bind anything.

=================== C6 — Flags and text ===================

- Hide from help, keep parsing and validation: every `--team` option in `src/cli.ts` (`:79, :95, :97, :99, :100, :101, :115, :118, :120, :126, :129, :130, :146, :151`) and `--as` (`:74`) become `.addOption(new Option('--team <team>', '<same description>').hideHelp())` (import `Option` from `commander`). `config.ts:25` validation and `team.ts:312-313` ("ignoring --as") stay. `cli.test.ts:47-59` (the parse test) must keep passing.
- Visible advice loses the flags:
  - `connect.ts:113` → `No skill selected. In an interactive terminal, run \`<inv connect>\` (from the project whose skills you mean), or pass an explicit skill folder path.` — exactly: ``throw new Error(`No skill selected. In an interactive terminal, run \`${printable(invocation(args.form, 'connect'))}\`, or pass an explicit skill folder path.`);``
  - `publish.ts:224-230`: delete `teamOption` from the retry, `ls`, and `connect` hints (three places).
  - `cli.ts:128` share notice: `(same options: --allow-privileged, --keep-source, --keep-repo, --relocate, --forget)`.
  - `auth.ts:220` drop `; pass --as <other-name>` → `Team ${team} is configured for ${existing.remote}, not ${normalized}.`
  - `team.ts:286` → ``…the repository ${remote} is scaffolded, run \`${invocation(args.form, 'team leave', name)}\` then \`${invocation(args.form, 'team join', remote)}\` to use it.`` ; `:315` → `Team name ${team} is already used for ${configBefore.teams[team]!.remote}.`; `:439` foreign clone → `${clone} is a clone of ${described.origin}, not ${normalized}; move it aside and retry.`
  - `setup.ts:129` resume line (C2 item 1).
  - `install.ts:209` message = the C2 text (C2 item 4).
  - `uninstallMachine.ts:54`: one team → `  Team: <A> (<remote>, handle <h>)`; zero → `  No team`; 2+ → keep today's `  Teams (N): …` wording. `:71` → `Your membership and installed-skill records in the team repo are unchanged. …` (rest of the line unchanged).
  - `cli.ts:60` setup description → `Onboarding wizard: on a new machine, asks whether to create a team or join one; re-run to resume your team; pass <org>/<repo> or a remote URL to join directly (one team per machine: leave the current team first)`.
  - `cli.ts:73` join description → `Join a team: <org>/<repo> on GitHub, or any git remote URL (one team per machine; re-running it for the configured team updates your entry)`.
  - `cli.ts:131` uninstall description: `every team you joined (placed skills, local clones, cache)` → `your team (placed skills, local clone, cache)`.
- `README.md:79` → `` `npx -y terum-skills@latest --help` and `npx -y terum-skills@latest <verb> --help` list every option you are expected to use. ``; `:186` `removes every team from this machine (placed skills, clones, cache)` → `removes your team from this machine (placed skills, clone, cache)`; `:208` → `- **Created a team by mistake?** \`npx -y terum-skills@latest team leave <accidental>\` removes it from this machine, then run the setup command its owner sent you. Delete the repository on GitHub yourself.`
- Bundled `.claude/skills/terum-skills/SKILL.md`: lines `49, 50, 53, 57, 60, 61` drop ` [--team <t>]`; `:55` "say it will pull every configured team, place approved skills…" → "say it will pull the team repository, place approved skills…" and "`Sync complete: …` means every team was stamped" → "`Sync complete: …` means the team was stamped"; `:80` hand-off → `` `npx -y terum-skills@latest connect` — run it from the project whose skills you mean ``. The build copies this file byte-for-byte via `scripts/bundle-skill.mjs` (`bin.test.ts:87-91`) — the frontmatter marker must stay intact.
- `src/lib/__tests__/invocation-catalog.ts`: the tripwire (`invocation-tripwire.test.ts`) matches file AND exact trimmed line content for every source line containing `terum-skills` (plus a few fixed admin phrases). Update the catalogue entries for exactly the lines whose content you changed (`cli.ts` uninstall description at catalogue `:15`; the `setup.ts` entries at catalogue `:84-102` if their content moved or changed — line numbers there are informational, patterns are what must match) and add entries for any NEW source line that contains the literal `terum-skills`. Note `Terum Skills` (capital, space) in the new messages does not trip it. Never add a file-wide exemption.

=================== Spec amendments (edit these files; paste the text) ===================

`.planning/specs/2026-09-02-phase-1-build.md`:
- `:435` "…or a configured machine, which resumes its first team and is told how to reach another." → "…or a configured machine, which resumes its team. A target naming a different repository is refused before any side effect: `This machine is on team <A> …; run team leave <A> first` (one team per machine, Ryan 2026-09-08); the refusal is a typed `refused` result (frame field `refused`), not a decline."
- `:439` the `Resuming setup for team <…` sentence → "Bare setup on a configured machine prints `Resuming setup for team <name>. Terum Skills keeps one team per machine; to move this machine to another team run team leave <name> first.`; on a machine configured for several teams before this rule it refuses and names `team leave <name>` for each."
- `:441` "resumes the first configured team" → "resumes the configured team"; `:445` any "first team" → "the configured team".
- `:253-254` add after the `teams` example: "`teams` holds at most one entry on machines bound since 2026-09-08; new bindings never create a second team, a legacy count may only decrease. Legacy machines keep reads, syncs, `team leave`, and explicit `--team`/qualified-ref writes."
- `:276` → "**Handles are per team entry.** A machine moves to another team only by `team leave` then join, so a roster collision in the new team is resolved at that join without touching the record you left behind."
- `:305` drop the "ambiguous if several teams are configured → §6 `install`" clause → "within the configured team".
- `:356`, `:359` add "`--as` is a hidden override of the local name" where `--as` is described (if `:356`/`:359` do not mention `--as`, put the sentence at the end of the `team join` bullet `:357`).
- `:363` leave: "drop clone + config entry" → "drops clone + config entry and, when it was the last team, every `approvals` record (consent is asked again in the next team)".
- `:392` "All configured teams in object-enumeration order" → "The configured team (legacy machines list each, in object-enumeration order)".
- `:406` "A bare `<name>` with several teams configured is an error…" → prefix "Legacy machines only: ".
- `:553`, `:557`, `:586`: "second team" → "legacy machines" (rephrase each sentence so it still reads: e.g. `:553` "identity — on legacy machines, a roster that already holds your default handle…"; `:557` "two teams (legacy machines) → grouped output"; `:586` "…the only shape in which a collision on legacy machines is recoverable").
- `:578` → "…two-part refs need local config; `--team` is a hidden override."
- `:612` "a configured machine that resumes" → "a configured machine that resumes; a different target is refused".

`.planning/specs/2026-09-05-m3-publish-leave.md`: `:122` "`approvals` are left alone — they are consent for grant sets, not team membership." → "`approvals` are cleared when the last team leaves (Ryan 2026-09-08, F3); leaving one of several legacy teams leaves them alone."; `:134` the ask text → the new C4 text (last team) with a note that other-teams-remaining keeps the old text; `:45`, `:92`, `:167` add "(legacy machines only)" after each "several/two teams configured" phrase.

`.planning/specs/2026-09-05-m3-setup-hook.md` `:10`, `:101`: "first team"/"first configured team" → "the configured team"; `:10` resume sentence → the new C2 resume text.

`.planning/specs/m7-S7af.md:25`: append "`--team` hidden in help, still emitted."

`.planning/specs/m7-S7c.md:4`: append "MC-07 cancelled (one team per machine); only its argv half remains, as S7af AD-06."

`.planning/decisions/2026-09-08-m7-takeover-decision-walk.md`: add ledger row 14 and a section `## Decision 14 — One team per machine (F1-F8; MC-07 cancelled)` in the file's existing Plain English / Technical shape, Verdict LOCK, recording Ryan's rulings (2026-09-08/09): F1 one team per machine; F2 REFUSE model (a second binding is refused before any side effect, never auto-left or switched); F3 leaving the last team clears `approvals`; F4 no forced sync on leave; F5 legacy 2+ machines are read/sync/leave-only with a hint, only new bindings refused; F6 `--team`/`--as` hidden but accepted; F7 the `teams` record stays (no migration); F8 the session hook is unchanged; MC-07 (`--team` everywhere as a product feature) cancelled, its argv half remains as S7af AD-06. Technical: the files this PR touches (auth.ts refuseSecondTeam/assertBindable/teamByRemote, result.ts RefusedError, frames.ts `refused`, setup/team/install/leave call sites, cli.ts hideHelp).

Desktop-side spec lines (`m7-S7r.md:30/:40`, `desktop/GAPS.md:54`, canvas) belong to the desktop PR — leave them.

=================== Tests (each must FAIL on origin/main and PASS after) ===================

Existing layouts: `src/commands/__tests__/*.test.ts`, `src/lib/__tests__/*.test.ts`, `src/__tests__/*.test.ts`; fixtures in `src/lib/__tests__/fixtures.ts` (`bareTeam`, `cloneWithIdentity`, `mappedRunner`, `fakeGh`, `ScriptedPrompter`, `wrapRunner`, `createConfigStore` from `../../lib/config.js`). Vitest, bare-repo fixtures, no network.

- `setup.test.ts` NEW: on a one-team fixture (see `configuredCreator`), `setup <other>` (a target whose remote differs) → `{ ok: false, refused: true, error: /One team per machine/ }`, and: the runner recorded NO `gh` call and NO `git clone`; the `app` verb stub was never called (pass `verbs.app` as a counting stub and `app: undefined`, or assert on the events); no clone directory for the other team appears; config is byte-identical before/after. Same-remote target still resumes (`Team team is already configured on this machine.`). Bare setup on a 2+ fixture refuses with the LEGACY message (fail-before: it resumes teams[0]).
- `join.test.ts:222-235` INVERTED (rename the test): after joining REMOTE, a second remote is refused BEFORE `acceptOrDirect`/clone/push — assert the runner saw no `git clone` and no `git push` for the second remote, the other bare's `main:people` still lacks `me.json`, `(await store.read()).teams` still equals only the first team, result has `refused: true` and error `/One team per machine/`. `:139`: the message no longer contains `--as` (assert on the new `Team team is configured for … not …` or the refusal, whichever that fixture now hits — read the code path: store2 has one team bound to `github.com/someone/team`, joining REMOTE is a different remote → now refused; assert `refused: true`).
- `create.test.ts` NEW: create on a configured machine (one team in config) refuses before `gh repo create` — runner (fakeGh) sees no `gh` call at all; result `refused: true`.
- `install.test.ts:78-81`: the second-state case becomes `{ ok: false, refused: true, error: /One team per machine/ }` (fail-before: plain failure with the `team join` message). NEW: over frames (or through `createExecute` with a `result` sink), the result carries `refused: true`. NEW: zero-team bootstrap propagates the child's typed outcome (stub setup via a Result with `refused: true` → install result `refused: true`; `cancelled: true` → `cancelled: true`). If the bootstrap's `import('./setup.js')` cannot be stubbed cleanly, drive it through a fixture where setup refuses naturally (e.g. seed a second team after the pre-flight? — no: pick the simplest honest path and record the choice in `deviations`).
- NEW `auth.test.ts` (extend): `assertBindable` throws `RefusedError` when another own key exists; `teamByRemote` matches a raw-stored `https://github.com/acme/x.git` against `github.com/acme/x` (fail-before: compares the stored raw string).
- `leave.test.ts:40`: `expect(config.approvals.keep).toBeDefined()` flips to `expect(config.approvals).toEqual({})`; NEW legacy: with two teams configured, leaving one keeps `approvals`; the ask text on the last team contains `skill consent records`; the inventory prints `Skill consent records will be cleared (1)`.
- `frames.test.ts` (`src/lib/__tests__`): a result outcome with `refused: true` yields a frame with `refused: true` (and no `declined`); `frames-cli.test.ts` or `setup.test.ts`: setup over frames / through `createExecute` preserves `refused` (fail-before: `setup.ts:82` drops it).
- `cli.test.ts:300`, `:348`, `cli-hints.test.ts:36`: hints without `--team`. NEW hidden-help assertions: `--help` output for `install`, `ls`, `status` lacks `--team`; `team join --help` lacks `--as` (use commander's `helpInformation()` on the subcommand); `cli.test.ts:47-59` parse test stays.
- `invocation-tripwire.test.ts` passes with the catalogue updated.
- Keep as LEGACY fixtures, each with a one-line comment `// legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working`: `sync.test.ts:810`, `:1001`, `search.test.ts:45`, `uninstallMachine.test.ts:42`, `local-skills.test.ts:42`, `config.test.ts:66`, `install.test.ts:376`.

=================== STANDING CONSTRAINTS ===================

- Work only under `src/`, `docs/frame-protocol.md`, `README.md`, `.claude/skills/terum-skills/SKILL.md`, and the named `.planning/` files. Never edit `desktop/**`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `package-lock.json`, `scripts/**`, `.claude/**` other than the bundled SKILL.md.
- Grep before writing a function (CLAUDE.md "Before implementing"): one active path per behaviour — `refuseSecondTeam` is the only pre-flight, `teamByRemote` the only remote match, `fromError` the only error→Result mapping.
- Gates: `npm run lint && npm run typecheck && npm test` from the repo root (absolute path `/Users/ryanliu/Documents/Terum/skill-management-software-wt-oneteam`), and report REAL counts. Baseline on this tree: lint 0, typecheck 0, vitest 75 files / 1263 tests green (~260 s). `node_modules` is already in place (a symlink) and must not be edited; no `npm install`, no network, no git (not even `git status` — the worktree's git metadata lives outside your writable root and any git call errors; verify each write by reading the file back).
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth the spec names and declare each in `testsModified`. No `eslint-disable` without a same-line reason. No test-only branches in product code.
- If the spec is ambiguous, record the question in `openQuestions` and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged.
- Your final message must be the JSON report the output schema demands: `status: complete` only if every item above was implemented and the gates ran.

=================== AGENTS.md (repo root, inlined) ===================

# AGENTS.md — loader for non-Claude agents (Codex)

You do not run this repo's Claude hooks and nothing auto-loads `CLAUDE.md` for you. Read this
file first, then `./CLAUDE.md`, then the document that owns what you are touching.

## What this repo is

The planning and harness repo for **terum-skills**, an open-source CLI (npm `terum-skills`,
Apache-2.0) that lets a team share private Claude Code skills through one private git repo, with
no server. **There is no product source yet.** When implementation starts, code lands under
`src/` in the layout the build spec §3 defines. Until then, "the code" means the spec.

## Which document wins

1. `.planning/specs/2026-09-02-phase-1-build.md` — the **build spec**. Authoritative. Rev and
   date are in its status line; every rev is a full replacement, not a delta.
2. `.planning/specs/2026-09-01-team-skill-sharing.md` — the **decision ledger** (D1…D39).
   Background and rationale. Where it and the build spec disagree, the build spec wins.
3. `.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md` — the decision walk.
   History of how forks were closed. Decision 3 was reopened 2026-09-03; its reopen note wins
   over the original text below it.
4. `.planning/specs/reviews/*.codex-spec.r*.review.md` — prior audit rounds. Evidence, not rules.

Status tags in the ledger mean what they say: DECIDED is settled; PROPOSED is a recommendation;
OPEN is blank on purpose. In the build spec, **`[default — veto cheap]`** marks a default the
author chose to close a gap — implement it as written, do not treat it as undecided.

## Invariants you must hold when you write code here

- **Nothing runs anywhere but laptops and the git host.** No HTTP client, no server, no daemon,
  no third-party CLI on the install path. Shell out only to `git` and `gh`. One exception, recorded
  in `.planning/decisions/2026-09-08-desktop-app-cli-decision-walk.md` (D7, D8): `terum-skills app`
  also runs the platform's own tools to unpack and open the desktop app (`tar`, `open`, the NSIS
  installer it downloaded through `gh`), through the `Exec` seam in `src/lib/runner.ts`.
- **Every write to the team repo goes through `safeWrite()`** (build spec §6.0): fetch, hard-reset
  the clone to `origin/main`, re-run a *pure* mutation, commit, push, retry to a 30-second deadline.
  A mutation that does I/O, mints an ID, or prompts is a bug.
- **The guard is the authorization model** (§6.0 table): a diff may touch only the paths the
  caller owns. Do not add a write path that bypasses it.
- **Consent is a predicate on the normalized `allowed-tools` set** (§5.4 `approvals`). A changed
  grant hash is no approval. `sync --hook` never places an unapproved grant; it announces on
  stderr and prints nothing else but the reload directive on stdout.
- **Provenance is the `placements` ledger** (§5.4). It is the only source of deletable paths.
  Never infer ownership from what happens to be on disk; never write a marker inside a placed
  folder; never delete outside `~/.terum/skills/quarantine/`.
- **Placement is native and explicit** (§7): copy into a temp sibling, rename into place, under
  the per-target lock, into the directory the agent path table names for the agent the caller
  passed. Never auto-detect agents, never prompt for scope, never write `.agents/skills` in
  phase 1.
- **Vendored code keeps its provenance.** `src/lib/placer/vendor/skillhub/` holds two files copied
  from iflytek/skillhub `cli/src/services/` (Apache-2.0): `skill-fingerprint.ts` and
  `skill-target-lock.ts`. Upstream carries no per-file copyright header, so each copy gets an
  attribution header naming the source path, the pinned commit, the license, and whether it was
  modified, plus a NOTICE entry (build spec §3). The Claude Code path row is *derived* from
  skillhub's profile (both paths are `.claude/skills`), not copied — its profile factory bundles
  auto-detect, which is not vendored. Do not vendor its auto-detect, prompt, or in-folder
  metadata code.
- **Frontmatter is Agent-Skills-legal** (§5.3): top-level `name`/`description`/`license` only;
  everything custom nests under `metadata`. Skill folder name equals frontmatter `name`.
- **One active path per behavior.** Before writing a function, grep for one that already does the
  job and extend or replace it in the same change. Never leave two paths doing the same thing.

## Gates and sandbox

- Run with `--sandbox workspace-write`. `--dangerously-bypass-approvals-and-sandbox` is banned.
- Never `git push --no-verify`. Never push at all unless the task says so.
- Once `src/` exists: `npm run lint`, `npm run typecheck`, `npm test` (vitest, collocated under
  `src/**/__tests__/`, bare-repo fixtures, no network). Report their real output; a self-reported
  green gate is a hypothesis the reviewer re-runs.
- Use absolute paths in shell commands; do not `cd`.

## Things that look wrong and are not

- `safeWrite` hard-resets the clone. Deliberate: no local commit is ever carried forward, so there
  is nothing to rebase or conflict.
- `publish` under the `"pr"` policy pushes a branch and exits when `gh` is missing. Deliberate: a
  missing tool never downgrades a review gate to a direct push.
- A hand-edited placed copy is overwritten on `sync` and moved to quarantine. Deliberate: placed
  copies are generated output, not an authoring surface; the source is what you edit.
- The session hook is async and promises no same-session reload. Deliberate: a network pull must
  never sit in front of session start.
- Handles are per team, not global. Deliberate: it is the only shape in which a second-team
  collision is recoverable.
- `metadata.author` is `Name <email>`, never the handle. Deliberate: SkillEvaluator's schema.
- The hidden `readme` verb writes `README.md` in the current clone directly, not through `safeWrite`.
  Deliberate: it is the GitHub Action's entry point on the host's compute, where there is no
  `~/.terum` config and the Action itself commits; on a laptop, README regeneration for
  non-GitHub remotes still happens inside `safeWrite` (§9).
- `guard.ts` accepts a `previousAuthor` for `sync` only, and only for a write that touches
  `SKILL.md` alone with canonical content unchanged. Deliberate: it is the §5.3 managed-field
  refresh after a config email or license change; it can never carry a content change.

