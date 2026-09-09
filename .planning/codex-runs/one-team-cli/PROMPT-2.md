Follow-up round on the "one team per machine" CLI implementation you produced in this worktree (your changes are in the working tree, uncommitted; read AGENTS.md first as before). Your report raised two open questions; the orchestrator has ruled on both. Apply exactly these changes, re-run the gates, and report.

=================== Ruling 1 — C1 vs C2 on legacy same-remote rejoins ===================

Your reading of C1 ("assertBindable throws RefusedError when config.teams holds any key other than the one being bound") is too literal and breaks the legacy rejoin C2/C5 require: on a legacy two-team machine, `team join <remote-of-A>` passes the pre-flight, pushes the roster entry, then hits `assertBindable(fresh, 'A', remote)` under the lock and is refused AFTER the durable write. The invariant C1 states is "new bindings never create a second team; a legacy count may only decrease" — rebinding an EXISTING own key does not increase the count.

Change `assertBindable` in `src/lib/auth.ts` so the RefusedError fires only when the key being bound is NEW, i.e.:

```ts
const isNewKey = !Object.hasOwn(config.teams, team);
if (isNewKey && Object.keys(config.teams).length > 0) refuseSecondTeam(config, { name: team }, retry, form);
```

(Object.keys / Object.entries give own keys only, as before.) Keep the two existing checks after it unchanged.

=================== Ruling 2 — the under-lock refusal must be invocation-aware ===================

`assertBindable` currently renders its retry as `invocation(undefined, 'team join', remote)`, which prints the npx form on a bare (global) install and names `team join` even when the caller is `team create`. Fix by giving `assertBindable` a trailing options parameter and threading the caller's form and retry through:

```ts
export function assertBindable(config: Config, team: string, remote: string, options: { form?: InvocationForm; retry?: string } = {}): void
```

- default `retry` = `invocation(options.form, 'team join', remote)`.
- `bindTeam(config, name, entry, options?)` accepts the same optional options object and passes it to its own `assertBindable` call (keep that belt-and-braces call).
- `src/commands/team.ts` create (`store.update` at the re-check under the lock) passes `{ form: args.form, retry: invocation(args.form, 'team create', name) }` to BOTH `assertBindable` and `bindTeam`; join passes `{ form: args.form, retry: invocation(args.form, 'team join', args.target) }` to both. Other callers of `bindTeam` / `assertBindable` (grep for them, including tests) may stay as they are.

=================== Tidy (small) ===================

- `team.ts` create: `refuseSecondTeam(config, { name: suppliedName ?? '' }, …)` — the empty-string name is a sentinel that reads as a bug. Change `refuseSecondTeam`'s target type to `{ remote?: string; create?: true }`, make create pass `{ create: true }`, and make `assertBindable` pass `{ create: true }` for the new-key case (the message is the same ONE-TEAM / LEGACY text; the field only says "this is a create-style binding, never a resume"). Update the `refuseSecondTeam` unit test (`src/lib/__tests__/auth.test.ts`) to the new field name; its assertions otherwise stay.

=================== Tests ===================

- `src/lib/__tests__/auth.test.ts`: extend the `assertBindable` test: with `t` bound to `github.com/acme/team` AND `other` bound to `github.com/acme/other` (a legacy pair), `assertBindable(config, 't', 'github.com/acme/team')` does NOT throw (a rejoin of an existing legacy key), while `assertBindable(config, 'third', 'github.com/acme/third')` throws `RefusedError` with the LEGACY message; on a single-team config, `assertBindable(config, 'other', 'github.com/acme/other', { form: 'bare', retry: 'terum-skills team create other' })` throws a message containing ``run `terum-skills team leave 't'` first, then re-run `terum-skills team create other`.`` (i.e. the bare form and the caller's retry are honoured).
- `src/commands/__tests__/join.test.ts`: NEW legacy rejoin test — configure TWO teams (the fixture's `team` bound to REMOTE via a first successful join, plus `config.teams.other = { remote: 'github.com/other/repo', handle: 'me' }` written directly with the legacy comment), then `join({ target: REMOTE, … })` again succeeds (`rejoined` false or true is fine; assert `ok: true`), `teams` still has exactly the two keys, and the roster still holds one `me.json`. This test must FAIL on your current tree (the under-lock refusal) and PASS after Ruling 1.
- `src/commands/__tests__/create.test.ts` `routes remaining create recoveries` (form=bare case) or a new small test: the under-lock refusal on a bare-form create names `terum-skills team leave …` and `terum-skills team create 'raced'` (never `npx`, never `team join`) — read the existing race test at ~`:330-352` (`re-checks under the config lock`) and add a `form: 'bare'` variant or extend it, asserting the retry text.

=================== Constraints (unchanged) ===================

- No git, no npm install, no network; `node_modules` is a symlink you must not edit. Gates from the repo root `/Users/ryanliu/Documents/Terum/skill-management-software-wt-oneteam`: `npm run lint && npm run typecheck && npm test` (use `--configLoader native --no-cache` for vitest if the default loader hits the sandbox write error you saw last round), report REAL counts. Previous counts: 75 files / 1281 tests.
- Never delete or weaken a test; declare every assertion change in `testsModified`.
- Do not commit. Leave everything in the working tree. Final message = the JSON report the output schema demands.
