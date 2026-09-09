# Implement: "Share ▸ Invite from status" (desktop app + two CLI companions)

You are OpenAI Codex implementing a LOCKED spec in this git worktree. You write the code; the orchestrator (a Claude session) re-runs every gate itself, commits, and opens the PR. Work only inside this worktree. **No git commands at all** (not even `git status`), no network, no `npm install`, no commits — leave every change in the working tree. Verify every write by reading the file back.

## Read first (the repo's conventions are NOT auto-loaded for you)

1. `./CLAUDE.md` (root) — especially "Before implementing": grep for existing code before writing a new function; never leave two active paths doing the same thing.
2. `./desktop/AGENTS.md` — the desktop's eight invariants. The ones this task touches: **1 (the seam)** — screens import only `src/backend/types` + `src/backend/index`, never `src/backend/mock/**`, `src/backend/tauri/**`, `src/fixtures/**`, and never `src/lib` of the CLI; **2 (flags)** — a screen reads a switch through `useFeatures()`; **7 (URL state)** — every state is reachable from the URL / `?__mock=`; **8 (gates)** — run `npm run typecheck && npm run lint && npm test` from `desktop/` and report real counts. An implementing agent never edits `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md` or any `package.json`.
3. `./desktop/src/backend/tauri/README.md` — the real adapter (frames over a Tauri bridge).

Node: this Mac runs Node 25; run the desktop tests as `NODE_OPTIONS=--no-experimental-webstorage npx vitest run` from `desktop/`. `desktop/node_modules` is a real directory; the root `node_modules` is a symlink and root vitest may hit EPERM on `.vite-temp` inside the sandbox — if it does, say so in the report and do not fake a result (the orchestrator runs the root gates).

## The bug (plain English)

Share ▸ Invite on the real app opens a fallback dialog whose Invite button re-runs a gap, because `ShareScreen` gates the dialog on `backend.onboarding()`, which the real adapter returns as `gap('Onboarding data')`. "Copy join block" on the team-of-one state fails the same way. Yet `backend.status()` / `backend.settings()` already carry `TeamStatus.joinCommand` / `joinBlock`, and `Backend.invite` already drives `invite <logins>` over frames. The fix: the invite dialog reads **Settings** (which carries `TEAMS: TeamStatus[]`), drives the `invite` verb, and shows its outcomes.

## HARD constraints (violating any of these fails the run)

- **Stacking rule.** Another open PR rewrites two lines that you must NOT touch. In `desktop/src/backend/tauri/index.ts`, inside `run()` (line ~211), the `onSettled` callback already reads `else if (result.ok || result.value !== undefined) notify(...touches);` — leave that line byte-identical (a failure that carries a value, like a partial invite, already notifies). In `desktop/src/components/domain/useWorkflow.ts`, the final `return { error, notice, lines, busy, stop: …, run, perform, pref, fail };` line must stay byte-identical.
- **Tests: append, never edit existing cases**, with exactly two sanctioned exceptions: (a) `desktop/src/screens/share/share.test.tsx` line 16 — the `toHaveBeenCalledWith({logins:['sortiz'],scope:'Terum',role:'member'})` expectation gains `team:'terum'` (the dialog now passes the team key) and nothing else changes on that line; (b) `src/commands/__tests__/invite.test.ts`, the test at lines 45-61 — its `/capped` fixture must now carry cap text in the response body (see CLI item B). **Never touch `share.test.tsx` line 54** (`const source = backend;`) or anything around lines 53-61. New desktop tests go at the END of `desktop/src/backend/tauri/__tests__/s7b-screens.test.tsx` and `desktop/src/screens/share/share.test.tsx`.
- Screens may not import fixtures or `src/lib`; adapters may hold authored string literals (the `settingsModel` precedent in `tauri/index.ts`).
- Do not re-derive printed command strings; `npx -y terum-skills@latest …` literals stay verbatim.
- Do not add dependencies. Do not touch `desktop/src/fixtures/*` or `desktop/src/styles/tokens.css` (generated).

## Spec items (desktop)

### 1. `desktop/src/backend/types.ts`
- `export interface InviteResult {invited:string[]}` → `export interface InviteResult {invited:string[];already:string[];failed:{login:string;error:string}[]}`.
- The `Settings` type is `Pick<Design, '…'|'FOLLOWING' > & {…}`. Add `'INVITE_TIP'|'JOIN_BLOCK_NOTE'` to that Pick (the `Onboarding` Pick keeps them too). Also add to the `Settings` intersection object an optional, mock-only key: `INVITEE?:string` with a short comment `// mock-only: the drawn specimen login (design INVITEE); the real adapter never sets it`. (Reason: the locked ShareInvite board draws "sortiz" in the logins field and existing tests assert it; the real form prefills empty.)

### 2. `desktop/src/backend/tauri/index.ts`
- `cliInvite` (line ~36) becomes `z.object({ team: z.string(), invited: z.array(z.string()), already: z.array(z.string()).default([]), failed: z.array(z.object({ login: z.string(), error: z.string() })).default([]) }).passthrough()`.
- The `invite:` entry (line ~379) maps to `{ invited: [...value.invited], already: [...value.already], failed: value.failed.map(f => ({ login: f.login, error: f.error })) }`; `touches` stays `['clone']`.
- `settingsModel` (line ~123) adds two adapter-side literals, copied VERBATIM from `desktop/src/fixtures/design.json` (entities included — `RichText` decodes them at render):
  - `INVITE_TIP:"GitHub emails the invitation; the block runs the joiner&#39;s wizard"`
  - `JOIN_BLOCK_NOTE:"GitHub emails the invitation. The block runs the joiner&#39;s wizard: with gh signed in it accepts the pending invitation, otherwise it asks them to accept it in the browser, and git must have access to this repository."`
  Do NOT set `INVITEE` in the adapter.
- Do not touch the `onSettled` line (see HARD constraints).

### 3. `desktop/src/backend/mock/index.ts` (+ `mock/scenario.ts`)
- The `settings:` read adds `INVITE_TIP:design.INVITE_TIP, JOIN_BLOCK_NOTE:design.JOIN_BLOCK_NOTE, INVITEE:design.INVITEE`.
- `mockTeams()` (line ~119) currently sets `joinCommand:null, joinBlock:null`. Set `joinCommand: cli(\`setup ${design.TEAM_REPO}\`)` (import `cli` from `./derive` — it already exists: `'npx -y terum-skills@latest '+command`) and `joinBlock` to the CLI's eight join lines for `design.TEAM_REPO`, authored as literals mirroring `src/commands/invite.ts` `joinLines()`: `['Send this to your teammate:', '```', 'npm install -g terum-skills', 'npx -y terum-skills@latest setup terum/team-skills', '', 'Bare equivalent: npx -y terum-skills@latest team join terum/team-skills', '```', 'If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.']` (build them from `design.TEAM_REPO` rather than hard-coding `terum/team-skills` twice).
- `invite:` returns `ok({invited:[...logins], already:[], failed:[]})` on the default path. Add a new `__mock=partial` scenario: add `'partial'` to `MockScenario` and the `switch` in `mock/scenario.ts` (the union already lists `invalid-newest` and `version-mismatch`; append `partial` beside `on-disk-only`); in `invite`, when `readScenario()==='partial'`, return a failure WITH a value: `{ok:false, error:<failed errors joined by '\n'>, value:{invited: first ? [first] : [], already:[], failed: rest.map(login=>({login, error:\`Could not invite @${login} (GitHub status 422). gh: Validation Failed (HTTP 422)\`}))}}` where `[first,...rest]=logins`. (The local `fail()` helper returns `Result<never>` with no value — write the object literal; `Result<T>`'s failure arm already allows `value?:T`.) Keep the existing "At least one GitHub login is required." guard and the `ctx.print` line.

### 4. `desktop/src/components/domain/useWorkflow.ts`
- `perform` returns the `Result<T> | undefined`: add `return result;` after the ok / cancelled-refused / error branches inside the `try` (so the caller sees the same Result the branches acted on); it returns `undefined` when locked or when the screen unmounted mid-run. `run` returns whatever `perform` returns. Leave the final return-object line alone (stacking rule).

### 5. `desktop/src/screens/share/ShareScreen.tsx`
- Replace the `onboarding` query with `settings`: `useQuery({queryKey:['settings',state.mock],enabled:state.dialog==='invite',queryFn:({signal})=>backend.settings(undefined,{signal})})`.
- `const features=useFeatures();` Keep `catalog` but `enabled: state.dialog==='invite' && features?.inviteScoping===true`. A disabled react-query v5 query stays `isPending` forever, so treat the catalog as *needed* only when `features?.inviteScoping ?? true` (unknown features ⇒ still waiting; this keeps the ready gate from flipping true before features resolve).
- `const TEAMS = settings.data?.ok ? settings.data.value.TEAMS : []; const team = TEAMS.length===1 ? TEAMS[0] : undefined;`
- Invitation error precedence: settings failed → its error; catalog failed (when needed) → its error; settings ok but `TEAMS.length!==1` → the screen's own selection message built from the TEAMS names, never `teams[0]` silently: 0 teams → `'No team is configured on this machine.'`; 2+ → `` `Choose a team first: this machine has ${names.join(' and ')}. terum-skills invites one team at a time.` ``; else thrown query errors as today.
- `data` passed to `ShareInvite` = `team && settings.data?.ok && (!catalogNeeded || catalog.data?.ok) ? { team, copy:{INVITE_TIP, JOIN_BLOCK_NOTE, INVITEE?}, catalog: catalog.data?.ok ? catalog.data.value : undefined } : undefined` (copy comes from the settings value; include `INVITEE` only when the settings value carries it — `exactOptionalPropertyTypes` is on, so spread conditionally).
- Ready gate: swap `onboarding.isPending` for `settings.isPending`, and the catalog term becomes `(!catalogNeeded || !catalog.isPending)`.
- `retry` refetches settings (and the catalog when needed).
- **Copy join block** (the team-of-one `CenteredState` secondary): `action.perform(()=>backend.settings(), value=>{ … })` — derive the team from `value.TEAMS` exactly as above; `TEAMS.length!==1` → `action.fail(<the same selection message>)`; `team.joinCommand` null → `action.fail(\`terum-skills reports no join command for ${team.remote ?? 'this team'}.\`)`; else `backend.copyToClipboard(team.joinCommand)` with the same `.then(result=>{if(!result.ok)action.fail(result.error);},action.fail)` as today. Add this code comment beside the payload: `// Teddy flag (GAPS.md:18): the payload is the one drawn line (joinCommand); switch to team.joinBlock.join('\n') only if Teddy rules byte-for-byte with the CLI. Never rebuild the 8 lines here.`
- Page-level notice: `const [notice,setNotice]=useState<string|null>(null);` render `{notice&&<div role="status" className="share-action-notice">{notice}</div>}` right beside the existing `share-action-error` div; `invite()` (opening the dialog) clears it. Pass `onDone={line=>setNotice(line)}` to `ShareInvite`. Add `.share-action-notice{font-size:13px;padding:12px 20px;color:var(--tk-text2)}` to `share.css` (append to the one-line file; keep the file one line if it is one).
- Remove the now-unused `onboarding` usage; `backend.onboarding` is no longer called anywhere in the share folder.

### 6. `desktop/src/screens/share/ShareInvite.tsx`
- Props: `{close:()=>void; data:{team:TeamStatus; copy:{INVITE_TIP:string;JOIN_BLOCK_NOTE:string;INVITEE?:string}; catalog?:Catalog}|undefined; error:string|null; retry:()=>void; onDone:(line:string)=>void}`. Import `TeamStatus`/`Catalog` types from `../../backend/types`.
- Fallback dialog (no data) unchanged in shape: title "Invite members", body `error ?? 'Loading invitation…'`, primary Invite, `busy={!error}`, `submit={retry}`.
- `InviteForm`: prefill `useState(copy.INVITEE ?? '')`. Projects come from `catalog?.projects ?? []`; the scoping block renders only when `features?.inviteScoping && catalog`.
- Submit, in this order: split on commas/whitespace (`/[\s,]+/`) → trim → drop empties → dedupe case-insensitively, FIRST spelling wins (`Sortiz, sortiz` → `['Sortiz']`) → validate ALL with the CLI's regex literal `/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/` (the app cannot import `src/lib`; a comment names `src/lib/schema.ts githubLoginSchema` as the source of truth). No logins or any invalid → `setInvalid('Enter valid GitHub logins, separated by commas or spaces.')` and return (no run). Keep the existing project-scope check. Only then:
  ```ts
  const result = await action.run(() => backend.invite({ team: team.key, logins, ...(features?.inviteScoping ? { scope: scope==='team' ? 'Global' : project } : {}), ...(features?.roles ? { role: role.toLowerCase() } : {}) }));
  if (!result) return;                       // locked or unmounted
  if (result.ok) { onDone(outcomeLine(result.value)); close(); return; }
  if (result.value) setOutcomes(perLoginLines(result.value));   // partial: keep the dialog open; action.error already shows the CLI's message
  // !ok without value (gh missing / logged out / host error): action.error renders in the dialog's alert as today
  ```
  Note: `submit` is now async; wire it as `submit={()=>void submit()}`.
- `outcomeLine(value)`: `invited.length ? \`Invited ${invited.map(l=>'@'+l).join(', ')}.\` : ''` plus, when `already.length`, `\` ${already.map(l=>'@'+l).join(', ')} already ${already.length===1?'has':'have'} access.\``, trimmed. Examples: `Invited @sortiz.`; `Invited @sortiz. @mira already has access.`
- `perLoginLines(value)`: invited → `Invited @a.`; already → `@c already has access.`; failed → `@b: <error>`.
- Render the per-login lines above the error: as the last child of the dialog body, `{outcomes.length>0 && <div className="invite-outcomes" role="status">{outcomes.map(line=><div key={line}>{line}</div>)}</div>}` (WorkflowDialog renders children before its error alert). Clear `outcomes` when the logins change.
- Body copy (a drawn-string change on a locked board; the PR flags it to Teddy — add a code comment saying so): `"Adds each login as a collaborator on the team repository. GitHub emails each invitation; they appear on the roster once they join."`
- "Send them this": `team.joinCommand ? <CliBox command={team.joinCommand}/> : <Small>{\`terum-skills reports no join command for ${team.remote ?? 'this team'}.\`}</Small>` followed by the existing `<Small><RichText text={copy.JOIN_BLOCK_NOTE}/></Small>`. (States the fact; a submit then surfaces the CLI's own host error.)
- The help tip uses `copy.INVITE_TIP`. The terminal hint stays `'npx -y terum-skills@latest invite '+(logins||'<github-login>...')`.

### 7. `.planning/specs/2026-09-08-design-strings-app-half.md`
In §0 item 4 (the `JOIN_BLOCK_NOTE` bullet, line ~14), append ONE sentence: `INVITE_TIP` and `JOIN_BLOCK_NOTE` are also served on `Settings` (adapter-side literals in `settingsModel`, the design values in the mock) so Share does not depend on the Onboarding read model.

## Spec items (CLI — `src/commands/invite.ts`; the orchestrator commits these separately, just leave them in the tree)

### A. Prevalidate the batch
Parse and dedupe ALL logins with `githubLoginSchema` (via `parseOrExplain`, trimmed) BEFORE any `gh api` call, so a bad login fails the batch with nothing sent (today `x/../repos/…` is only caught when its turn comes). Dedupe case-insensitively, first spelling wins. Then loop over the validated list. A thrown validation error keeps the existing `fromError` path (`Invalid GitHub login …` wording from `parseOrExplain`) and must name the bad login.

### B. Cap wording only on the cap
Attach the `GitHub caps invitations at 50 per repository per day.` sentence only when the response indicates the invitation limit: HTTP 403 AND the response text (`stdout` + `stderr`) matches `/invit/i`. Otherwise the message is `` `Could not invite @${login} (GitHub status ${status ?? 'unknown'}). ${(response.stderr || response.stdout).trim()}`.trim() ``. The 404 arm is unchanged. Write it as a small named helper (e.g. `invitationCapHit(status, response)`) with a one-line comment.

### C. Tests in `src/commands/__tests__/invite.test.ts`
- Append: `run({ logins: ['valid', 'a--b'], … })` → `ok:false`, error contains `a--b`, and `runner.calls` is empty (nothing sent).
- Append: a 422 non-owner failure produces `Could not invite @bad (GitHub status 422). gh: Validation Failed (HTTP 422)` and does NOT contain `caps invitations`.
- Append: dedupe — `logins: ['New', 'new']` → exactly one `gh api` call, `invited: ['New']`.
- Amend the existing test at lines 45-61 only as follows: the `/capped` fixture's stdout becomes `'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"You have exceeded the number of invitations for this repository"}'` (cap text in the body) so its existing cap-sentence assertion still holds; add one more login in that same test, e.g. `/blocked` → `{ code: 1, stdout: 'HTTP/2.0 403 Forbidden\r\n', stderr: 'gh: Forbidden (HTTP 403)' }`, and assert its line is `Could not invite @blocked (GitHub status 403). gh: Forbidden (HTTP 403)` with no cap sentence. Keep every other line of that test.

## Tests to APPEND (desktop) — each must fail on the pre-fix tree and pass after

### `desktop/src/backend/tauri/__tests__/s7b-screens.test.tsx` (real adapter over recorded frames)
Do not edit the existing `open()` helper. Add a second helper at the end of the file, e.g. `openShare(route, invite?: {frame: object})`, cloned from `open()` but: (1) when `args[0]==='invite'` it emits the given result frame line (`{"t":"result","ok":…,"value":…}` as one stdout line) instead of reading a file, and records nothing else; (2) when replaying `status.jsonl`, it rewrites the `{"t":"result"…}` line so each team gets `repository = 'https://github.com/terum/team-skills.git'`, `joinCommand = 'npx -y terum-skills@latest setup terum/team-skills'`, `joinBlock = <the 8 lines>` (an option `{joinBlock:false}` leaves status untouched for the null case). It returns `{ backend, fake }` so tests can read `fake.spawns`. The recorded team key is `acme`, so the expected spawn is `['invite','--team','acme','--','sortiz']`. Import `fireEvent`/`waitFor` from Testing Library as needed (append to the existing import line is allowed — that is not a test case).
1. Form renders from settings: open `#/share?dialog=invite`; `await screen.findByRole('textbox',{name:'GitHub logins'})` has value `''`; the dialog text contains `npx -y terum-skills@latest setup terum/team-skills`; `fake.spawns.map(s=>s.args[0])` contains `'status'` and no `'onboarding'`/`'invite'`; the dialog does NOT contain `Onboarding data`.
2. Invite drives the verb: type `sortiz`, click the dialog's Invite; `await waitFor(()=>expect(fake.spawns.some(s=>s.args[0]==='invite')).toBe(true))`; the invite spawn's `args` equal `['invite','--team','acme','--','sortiz']`; result frame `{ok:true, value:{team:'acme', invited:['sortiz'], already:[]}}` → dialog closes; `await screen.findByRole('status')` has text `Invited @sortiz.`
3. Already + success: result `{invited:['sortiz'], already:['mira']}` → status line `Invited @sortiz. @mira already has access.`
4. Partial failure keeps the dialog open: type `sortiz, bad`; result frame `{ok:false, error:'Could not invite @bad (GitHub status 422). gh: Validation Failed (HTTP 422)', value:{team:'acme', invited:['sortiz'], already:[], failed:[{login:'bad', error:'Could not invite @bad (GitHub status 422). gh: Validation Failed (HTTP 422)'}]}}` → dialog still present; contains `Invited @sortiz.` and `@bad: Could not invite @bad`; `within(dialog).getByRole('alert')` contains `Could not invite @bad`.
5. joinBlock null (status untouched, `joinCommand:null`): the dialog has no `.cli-box`, contains `terum-skills reports no join command for`.

### `desktop/src/screens/share/share.test.tsx` (mock)
6. `a--b` rejected before spawn: spy `backend.invite`; set the textbox to `a--b`; click Invite; alert contains `Enter valid GitHub logins`; spy not called.
7. Dedupe: set `Sortiz, sortiz`; click Invite; `await waitFor(()=>expect(invite).toHaveBeenCalledWith({team:'terum', logins:['Sortiz'], scope:'Terum', role:'member'}))`.
8. Two teams: `vi.spyOn(backend,'settings')` resolving the real value with `TEAMS:[t, {...t, name:'Acme', key:'acme'}]`; open `#/share?dialog=invite`; the dialog contains `Choose a team first` and `Terum and Acme`; no textbox `GitHub logins`; `backend.invite` spy not called after clicking the dialog's Invite.
9. joinCommand null on the mock: spy settings with `TEAMS:[{...t, joinCommand:null, joinBlock:null}]`; the dialog has no `.cli-box` and contains `terum-skills reports no join command for github.com/terum/team-skills`; then (fresh render) `#/share?__mock=empty` with the same spy → click `Copy join block` → `await screen.findByRole('alert')` contains `no join command`.
10. Copy join block → clipboard: `#/share?__mock=empty`; spy `backend.copyToClipboard`; click `Copy join block`; `await waitFor(()=>expect(copy).toHaveBeenCalledWith('npx -y terum-skills@latest setup terum/team-skills'))`.
11. `#/share?dialog=invite&__mock=partial`: set `sortiz, bad`; click Invite; the dialog stays; it contains `Invited @sortiz.` and `@bad: Could not invite @bad`; an alert is present.
12. Success notice on the page: default mock, click Invite (prefilled `sortiz`); dialog closes; `await screen.findByRole('status')` has text `Invited @sortiz.`

Use `await screen.findBy…` / `waitFor` for anything after a click. Match the file's existing one-line-per-test style where practical.

## Gates you run (from `desktop/`, then the root)
`npm run typecheck`, `npm run lint`, `NODE_OPTIONS=--no-experimental-webstorage npx vitest run` — report real pass/fail counts. Root: `npm run typecheck`, `npm run lint`, `npx vitest run src/commands/__tests__/invite.test.ts` (if EPERM, say so). Do not run Playwright.

## Report (final message, plain text)
- Files changed (absolute paths) and, for each spec item 1-7 and A-C, done / not done and why.
- `invariantsTouched` (AGENTS.md numbers), `deviations`, `openQuestions`.
- Gate output counts. Anything you could not verify in the sandbox.
