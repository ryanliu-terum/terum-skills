# LOCKED SPEC — batch `w03w04-skill-routing` (Bugs.pdf W-03 + W-04)

Baseline: `ryanliu-terum/terum-skills` @ **9fb73e9** (`Merge pull request #131 from ryanliu-terum/feat/card-menu-actions`).
Every line number and every quoted line in this document was read out of that commit. Where an input brief or a
triage report disagrees with the code at 9fb73e9, **the code wins** and the disagreement is called out in §13.

---

## 0. Summary

1. A skill's **name** is not the identity of a copy on this machine, and a URL segment is not the identity of a skill.
   Today the detail page treats both as identity, so it describes the wrong copy and mis-attributes its Library root.
2. W-04: a team skill's card in a project checkout links by bare name; `skill()` then resolves it against the whole
   machine and the CLI's global-first section order wins, so the page shows the **Global** copy — its crumb, sidebar,
   back arrow, `Edit`, `Remove from …` and `Move to …` all point at the wrong folder.
3. W-03: on the by-path route the screen resolves the checkout with a POSIX-only `root + '/'` prefix test, so on
   Windows and WSL-UNC paths it silently falls back to `Global`; the last crumb, `Validate`, `Run eval` and the
   preference keys all carry the literal route segment `local`; and a name the team does not share is reported with
   the misleading sentence "No unambiguous skill …" under a dead-end **Open marketplace** primary.
4. This batch: the backend reports the Library root it resolved (`SkillDetail.owningRoot`), a teamed card carries its
   origin root in the URL (`?root=<repoRoot>`) which `Backend.skill({at})` uses to restrict presence to that root,
   the screen stops doing path arithmetic entirely, and the not-found board is split from a new `ambiguous-ref` board.
5. For Teddy (Windows 11 x64 + WSL UNC roots) and Ajay. No CLI change, no frame-protocol change, no locked board moves.

---

## Repo facts Codex must know (from the batch COMMON brief, verbatim)

- Root: CLI package `terum-skills` (TS, ESM, Node 22+, commander, zod, yaml, proper-lockfile 4.1.2). Build:
  `npm run build` = `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs` → `dist/` (68 unbundled files today).
  Tests: vitest, collocated `src/**/__tests__/`, bare-repo fixtures, no network. Gates: `npm run lint && npm run typecheck && npm test`.
- Desktop: `desktop/` Vite 8 + React 19 + TS strict + Tauri 2.11. Code style is deliberately dense (single-line
  components, no blank lines inside components) — match the surrounding style. Mock backend `desktop/src/backend/mock/`,
  real adapter `desktop/src/backend/tauri/` (`index.ts` ≈ 700 long lines, `bridge.ts`, `frames.ts`, `run.ts`,
  `prepare-run.ts`, `cache.ts`?). Gates: `cd desktop && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e:routes`.
  `e2e:fidelity` needs the design canvas (`TERUM_DESIGN_DIR`) which Codex does not have — it skips; the orchestrator runs it.
- Rust shell `desktop/src-tauri/src/lib.rs` spawns `node <entry> --frames <verb…>` per call (8-child cap, CREATE_NO_WINDOW on
  Windows, tracked children killed on window destroy). Codex cannot run cargo; the orchestrator runs
  `cargo check` for aarch64-apple-darwin / x86_64-pc-windows-msvc / aarch64-pc-windows-msvc.
- Frame protocol: `src/lib/frames.ts` (FRAME_VERBS, FRAME_FEATURES, hello frame), `docs/frame-protocol.md`.
  Frames: hello | print | ask | progress | result (down), answer | cancel (up). `ProgressFrame { t:'progress'; step:string; current?:number; total?:number }`
  is declared but NO verb emits it yet (FRAME_FEATURES.progress=false). Desktop `Frame` type for progress is `{t:'progress';done:number;total:number;label?:string}` — check `desktop/src/backend/tauri/frames.ts` for the translation before assuming.
- Prompter (`src/lib/prompt.ts`): `interactive`, `channel?: 'terminal'|'frames'`, `confirm`, `text`, `select`, `print`. Exactly five members.
- Config lives in `~/.terum/skills/` (`config.json`, `run/app.json`, `run/terum.stamp`, teams clones under `teams/<team>/`).
- Node_modules are pre-populated in the worktree (root and desktop). `esbuild@0.28.2` is ALSO present in root
  `node_modules` (installed without saving) so a spec may add it to root `devDependencies` — the orchestrator syncs the lockfile afterwards. NOTHING else can be installed.
- Codex constraints to restate in the spec: no git commands at all; do not commit/stage; do not run `npm install`/`npm ci`;
  never edit `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`,
  `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json` (generated), anything under `.shots`; root `package.json`
  may be edited ONLY where the spec lists the exact edit. Report gates honestly.

**This batch adds no dependency**, so root `package.json` is NOT edited at all. This batch touches **no file under
`src/` at the repository root** (the CLI): it is entirely inside `desktop/`.

---

## 1. Bugs / asks closed

| id | reporter's words (Bugs.pdf, Teddy — Windows 11 x64 + WSL) | user-visible symptom |
|---|---|---|
| **W-03** | *"Unable to find listed skills (ambiguity issue)"* | A folder the Library lists opens on an error board titled `Couldn't find adopt-agent-tooling`, body `No skill named adopt-agent-tooling is shared in this team.`, buttons `Open marketplace` / `Back to library`, alert `No unambiguous skill adopt-agent-tooling in team terum-shared-skills.` The header above the grid read `32 skill folders in teniroo`. |
| **W-04** | *"Clicking on project skill redirects back to Global tab → install is mistaken as a result."* | Clicking a skill card inside a project checkout's Library opens a page whose breadcrumb starts `Global`, whose sidebar highlights **Global**, whose back arrow returns to the Global library, and whose actions (`Edit`, the trash button labelled `Remove from Global`, `Move to…`) operate on the **Global** copy of the skill, not the one that was clicked. |

**Status at 9fb73e9.** The *reported* W-03 crash (a listed card that will not open at all) was fixed by PR #126, which
is in this baseline. Seven residual defects of the same family survive, three of them Windows-only, and all of W-04
survives. Every residual below was re-read at 9fb73e9 for this spec.

---

## 2. Root cause — the evidence, at 9fb73e9

### RC-1 — a teamed card is addressed by name, and `skill()` answers machine-wide with the Global copy

`desktop/src/components/domain/skill-card-actions.ts:10-12`:

```ts
export function detailPath(skill:Pick<SkillCard,'teamed'|'path'|'name'>):string {
 return !skill.teamed&&skill.path?'/skill/local?path='+encodeURIComponent(skill.path):'/skill/'+encodeURIComponent(skill.name);
}
```

`desktop/src/components/domain/SkillCard.tsx:16` (the only producer of `origin`):

```ts
export function SkillCard({skill}:{skill:Card}){const backend=useBackend(),location=useLocation(),origin=location.pathname.startsWith('/marketplace')?'root=marketplace':'',navigate=useNavigate(),…
```

`origin` is `'root=marketplace'` or `''`. A checkout Library origin has **no representation**, so the URL loses which
copy was clicked. `desktop/src/backend/tauri/index.ts:535` shows the card *does* carry the folder:

```ts
        if(skill && enrichment.team.kind==='ok') {joined++;skills.push({...inventoryCard(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.team.team,features,directory,enrichment.selected?.handle??'',enrichment.selected?.placements??[]),path:row.path});}
```

`skill()` then passes the **whole machine's** inventory (`desktop/src/backend/tauri/index.ts:597`):

```ts
      const detail = inventoryDetail(row, local.value, selected.value, selected.value.placements, validation, inventory.value, { localIdentity: hello?.features.localIdentity ?? false }, await home());
```

and `inventoryDetail` picks the first matching row in section order and hard-codes the root
(`desktop/src/backend/tauri/index.ts:184-185`, and `:196`):

```ts
  const card = inventoryCard(row, local, team.team, features, home, team.handle, placements), rows = onDisk(local, team.team, row.id, features), placed = rows.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? rows[0]?.path ?? null;
```
```ts
  return { …, root: 'Global', …, scope: placed?.scope === 'global' ? 'Global' : placed?.label ?? placed?.scope ?? null, …
```

`onDisk` → `localRows` flattens sections in emission order (`desktop/src/backend/tauri/index.ts:140-141`) and the CLI
always emits the global root first (`src/lib/local-skills.ts:49`):

```ts
  const roots: LocalRoot[] = [{ root: AGENT_PATHS['claude-code'].global(home), scope: 'global', registered: false, detected: false }];
```

**Measured** (W-04 verifier, real `createTauriBackend` + the repo's `fakeBridge`, one skill placed in Global *and* in
`/work/ops`): `skill({ref:'a',team:'acme'})` → `scope "Global"`, `path "/home/.claude/skills/a"`, `version "aaaa…"`;
reversing the two sections in the payload flips the answer to `ops` — i.e. the winner is decided positionally.
With the copy **only** in `/work/ops`, `scope` is `ops` but `root` is still the literal `'Global'`.

### RC-2 — the by-path route resolves the checkout with a POSIX-only prefix test (Windows-only)

`desktop/src/screens/skill/SkillScreen.tsx:62-63`:

```ts
 const status=useQuery({queryKey:['status',state.mock],enabled:localPath!==null,queryFn:({signal})=>backend.status(undefined,{signal})});
 const checkout=localPath===null?undefined:status.data?.value?.roots.filter(root=>root.kind==='checkout'&&root.registered&&(localPath===root.root.replace(/[\\/]+$/,'')||localPath.startsWith(root.root.replace(/[\\/]+$/,'')+'/'))).sort((a,b)=>b.root.length-a.root.length)[0];
```

The root is trimmed separator-agnostically and then re-joined with `/` only. The CLI builds every emitted path with
`node:path.join` (`src/lib/placer/agent-paths.ts:11-12`, `src/lib/local-skills.ts:121`), so on Windows a row's path is
`C:\Users\teddy\Projects\terum\.claude\skills\x` and
`"C:\\Users\\teddy\\Projects\\terum\\.claude\\skills\\x".startsWith("C:\\Users\\teddy\\Projects\\terum/")` is `false`.
**Measured** (both verifiers, the real `App` over the real adapter with a UNC payload): POSIX separators → crumbs
`teniroo/teniroo/local`, sidebar `aria-current` on the checkout; the same section spelled with `\` → crumbs
`Global/teniroo/local`, sidebar `aria-current` on **Global**. The separator is the only difference.

### RC-3 — the same expression requires `root.registered`

`rootOf` sets `registered: section.registered ?? false` (`desktop/src/backend/tauri/index.ts:90`), but the sidebar
renders every checkout regardless (`desktop/src/components/domain/Sidebar.tsx:15`
`const checkoutRoots=roots?.filter(r=>r.kind==='checkout')??[];`). A cwd-detected repo is
`registered:false, detected:true`; the live `ls --local` on the author's box reports exactly that shape for
`/home/teniroo/Projects/SSM/terum-skills`. So a reader standing *inside* an unregistered checkout's Library is told
they are in Global.

### RC-4 — the URL segment is used as the skill's identity

`desktop/src/app/routes.tsx:41` is the single route `{path:"/skill/:ref",element:<SkillScreen/>}`, so on the by-path
route `ref` is the literal string `local`. That value is then used as the skill:

* crumbs (`desktop/src/screens/skill/SkillScreen.tsx:111`): `…{[root,s?.team??s?.project,s?.category,ref].filter(…)}` → last crumb reads `local`.
* preferences (`:66`): `function savePref(key:'enabled'|'favorite',value:boolean){try{backend.prefs.set(key+':'+ref,value);…` → every by-path detail shares the keys `enabled:local` / `favorite:local`. Latent on the shipped CLI (`src/lib/frames.ts:42-43` reports `favorites:false, disablePerMachine:false`), **live on the mock** (`desktop/src/backend/mock/index.ts:106` returns `disablePerMachine:true`).
* validate (`:68`): `const result=await backend.validate({ref,…})` → argv `['validate','--','local']`. **Measured**: with a throwaway `$HOME`, `node dist/index.js --frames validate -- local` returns `{"ok":false,…,"error":"…/teams/acme/skills/local is not a skill folder."}`; the same call with an absolute folder returns `{"ok":true,…}`. The CLI accepts a folder at `src/commands/validate.ts:30-35`:
  ```ts
      const absolute = resolve(args.target);
      let directory: string;
      try {
        const details = await lstat(absolute);
        directory = details.isDirectory() ? absolute : resolve(clone, 'skills', args.target);
      } catch { directory = resolve(clone, 'skills', args.target); }
  ```
* run eval (`desktop/src/screens/skill/RunEvalDialog.tsx:16-17,25`):
  ```ts
   const {ref:routeRef}=useParams();
   const ref=routeRef??s.name;
  ```
  ```ts
   function start(){try{evalRun.start({ref,name:s.name,...(s.team?{team:s.team}:{}),commit});onClose();}catch(reason){…}}
  ```
  **Measured**: the spawn is `["eval","--commit","--","local"]`. `runEvalInApp` is `true` on the shipped CLI
  (`src/lib/frames.ts:43`), so this is live, not latent.
* the same line `:68` invalidates `['skill',ref]`, which is not the key a by-path page uses
  (`:64` uses `['skill','local:'+localPath,state.mock]`), so even a successful validate does not refresh the page.

### RC-5 — one sentence for two different outcomes, under a dead-end primary

`desktop/src/backend/tauri/index.ts:592`:

```ts
        return { ok: false, error: `No unambiguous skill ${name} in team ${selected.value.team}.`, reason: matches.length === 0 ? 'not-found' : 'unreadable' };
```

`matches.length === 0` means "the team does not have it, and no readable folder on this machine has it" — nothing was
ambiguous. `matches.length > 1` is a real ID-prefix ambiguity but is reported as `'unreadable'`, whose board tells the
user to *"Check the path in Settings"* — wrong advice. The board's **primary** is `Open marketplace`
(`desktop/src/screens/skill/SkillScreen.tsx:113`), and the marketplace is a view of the same `ls --team` inventory that
just failed to contain the name — a guaranteed dead end.

PR #126's body promised this split; `git show` of that PR's file list does not include `SkillScreen.tsx`, and
`grep -rn "not-in-team\|Search the marketplace" desktop/src src` returns nothing at 9fb73e9. It was never shipped.

### RC-6 — install destinations are read from the presence inventory

`desktop/src/backend/tauri/index.ts:192-195`:

```ts
  const projects = (local.local ?? []).filter(section => section.scope === 'project' && section.rootState !== 'absent' && section.label);
  const installScopes: [string, string][] = [['Global', 'every session · ~/.claude/skills'], ...projects.map((section): [string, string] => [section.label!, `project · ${abbreviateHome(section.repoRoot ?? section.root, home)}`])];
  // Captions stay display-only; removal needs the original absolute destination.
  const installScopePaths = Object.fromEntries(projects.flatMap(section => section.repoRoot && projects.filter(other => other.label === section.label).length === 1 ? [[section.label!, section.repoRoot]] : []));
```

`localSkill` already restricts the inventory before calling this (`desktop/src/backend/tauri/index.ts:562`):

```ts
          const detail=inventoryDetail(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.selected,enrichment.selected.placements,validation,enrichment.inventory,features,directory);
```

so a by-path detail's `installScopes` / `installScopePaths` are **truncated to the clicked root**. **Measured**: a
Global-rooted `localSkill` yields `installScopes ['Global']` and `installScopePaths {}`; the same skill's
machine-wide read yields `['Global','ops']` and `{ops:'/work/ops'}`. Harmless today, load-bearing the moment a teamed
read becomes scoped — which is exactly what this batch does.

### RC-7 — the same one-character mistake on the Settings screen

`desktop/src/backend/tauri/index.ts:262`:

```ts
   const scanned=local?.local.some(section=>(section.rootState??'scanned')==='scanned'&&normalizePath(item.source).startsWith(normalizePath(section.root)+'/'))??false;
```

decides the Settings ▸ Sharing "Present / Missing / —" column at `:263`. On Windows every shared source that Terum
cannot match to a scanned row reads `—` ("outside every scanned root") instead of `Missing`. Same class, different
screen; fixed here with the same helper so the pattern is closed once.

---

## 3. Decisions taken

Every fork below is **closed**. Codex must implement exactly this and must not re-open any of them.

**DECISION D1 — `SkillDetail` gains `owningRoot:{id:string;label:string}|null`.** The backend, which owns path
semantics, reports the Library root a detail was resolved in; the screen reads it. Why: `desktop/AGENTS.md` invariant 1
("No component ever branches on `isTauri()` or any platform probe") — separator rules *are* platform probing, and
RC-2/RC-3 exist only because that logic lives in a screen.

**DECISION D2 — `owningRoot` is non-null exactly when the answer describes one identified root**, i.e. for
`localDetail` (both the by-path route and the bare-name local fallback) and for `inventoryDetail` **when a scope
section was supplied**. It is `null` for an unscoped machine-wide `inventoryDetail` and `null` by default on the mock.
Why: an unscoped read genuinely does not know which root the reader meant — claiming one is the W-04 lie. This is a
**deliberate widening of the batch brief**, which said "filled only for local resolutions; null in inventoryDetail" —
see §13 correction B1: without it the screen would have to resolve a checkout from `?root=` itself, which is the very
path arithmetic D1 removes.

**DECISION D3 — the `s?.root` term stays in the crumb precedence.** `desktop/src/backend/mock/index.ts:118` sets
`root:'Marketplace'` for the `not-installed` scenario, and three locked boards
(`SkillDetailNotInstalled`, `SkillDetailInstall`, `SkillDetailInstallLight`, `desktop/FIDELITY.md`) reach it with **no**
`?root=` param. Dropping `s.root` would repaint the sidebar (Marketplace → Global, 2 × 224 × 28 = 12,544 px against a
3,888 px allowance) and re-point the Back button. The precedence is `?root=marketplace` **or** `s.root==='Marketplace'`
first, then `s.owningRoot`, then `s.root`, then `'Global'`.

**DECISION D4 — `owningRoot.id` for the global root is the literal `'Global'` (capital G), for a checkout it is
`rootOf(section).id`.** `desktop/src/components/domain/Sidebar.tsx:31` selects Global on `selected==='Global'` and
`:32`/`CheckoutRow` selects a checkout on `selected===root.id`, while `rootOf` (`desktop/src/backend/tauri/index.ts:90`)
gives the global root the *lowercase* id `'global'`. Deriving the checkout id from `rootOf` makes it the sidebar's id
by construction; hand-normalising it (e.g. with `normalizePath`) would silently miss the moment the CLI emits a
trailing separator.

**DECISION D5 — `SkillScreen`'s `status` query and its `checkout` expression are deleted, not repaired.** With D2 the
screen has no reason to look at roots at all. This also removes the "longest root wins" heuristic: the CLI already
assigns each folder to exactly one section, so nested checkouts are resolved by the CLI, not guessed by the screen.
No spawn is saved — `desktop/src/components/domain/Shell.tsx:23` already issues
`useQuery({queryKey:['status',state.mock],…})` unconditionally and `SkillScreen`'s key was identical, so it was a
React-Query cache hit. (§13 correction B2 retires the triage's "removes one extra spawn" claim.)

**DECISION D6 — the last crumb is `s?.name ?? ref`, and the second crumb is dropped when it equals the first.**
Identity on every locked board (`s.name === ref` there), and `ref` still shows in the error state where `s` is
undefined. The dedupe removes today's `Global/Global/<name>` and the new `teniroo/teniroo/<name>`; it cannot fire on a
team detail, where `s.team` (the team name) differs from the root label.

**DECISION D7 — `validate()` sends `s?.path ?? ref` on the by-path route and `s?.name ?? ref` on the name route.**
NOT `s?.path ?? s?.name ?? ref` for both: `s.path` is non-null for an installed **team** skill too, so a blanket change
would silently switch the Quality tab's `Validate` button from the team clone's copy to the user's folder, disagreeing
with the `TerminalHint` printed directly beneath it (`npx -y terum-skills@latest validate <name>`) and with the
hygiene caption above it. The name-route half (`s.name` instead of `ref`) matches what `skill()` already does
internally (`desktop/src/backend/tauri/index.ts:594` validates `row.name`) and fixes the `skill({ref:'team/name'})`
form, where `ref` and `s.name` differ.

**DECISION D8 — `validate()` invalidates the query **prefix** `['skill', <local:path | ref>]`, not the full key.**
React Query invalidates by prefix, so this covers every `?root=` variant of the same skill, fixes the by-path key
(RC-4), and keeps the existing assertion at
`desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx:119` (`{queryKey:['skill','deploy-check']}`) green.

**DECISION D9 — `savePref` keys on `s?.name ?? ref`.** Aligns the detail page with the card, which already keys
`'enabled:'+skill.name` (`desktop/src/components/domain/SkillCard.tsx:16`), and kills the `enabled:local` collision.

**DECISION D10 — `RunEvalDialog` uses `s.name` as the run's ref; `EvalRunDialogHost`'s `fromUrl` is widened to match
the by-path detail route.** Without the second half, a by-path page would keep `?dialog=run-eval` in the URL after the
run is dismissed and re-open its own dialog. The widening is `location.pathname==='/skill/local'` as an alternative to
the exact-ref match — no wider than today's behaviour, where `current.ref==='local'` already matched any
`/skill/local`.

**DECISION D11 — the URL carries the origin root as `?root=<repoRoot>`, beside the existing `?root=marketplace`.**
A checkout root is always absolute (`rootOf` at `desktop/src/backend/tauri/index.ts:90` sets `id: repoRoot`), so it can
never collide with the literal `marketplace`. The value is byte-identical to the `?root=` the sidebar already emits
(`desktop/src/components/domain/Sidebar.tsx` `CheckoutRow`: `href={'#/library/checkout?root='+encodeURIComponent(root.id)}`)
and that `LibraryScreen.tsx:29` reads back, so back-navigation is a straight round trip. This applies the rule already
written in the in-tree navigation contract, `desktop/src/app/routes.tsx:21-22`:
*"Sidebar selection follows the route family, with Global and each /library/checkout?root= explicit scopes. … Marketplace skill links carry ?root=marketplace, including copied deep links."*

**DECISION D12 — Global-library cards do NOT stamp `?root=global`.** `desktop/e2e/routes/card-click.spec.ts:29`
asserts `/#\/skill\/deploy-check$/` (end-anchored) and `desktop/src/screens/library/library-skill.test.tsx:100,134`
assert `href="#/skill/deploy-check"`. The unscoped read already prefers Global by construction, and D16 makes that
explicit. Only `/library/checkout` stamps a root.

**DECISION D13 — `Backend.skill` gains one optional field: `at?: LibraryScope`.** Omitted = today's machine-wide
answer (deep links, bookmarks, marketplace, and every locked board keep it byte-for-byte). Supplied = "describe the
copy in this root". `LibraryScope` already exists (`desktop/src/backend/types.ts:61`); no new type is invented.

**DECISION D14 — a scoped read restricts **presence** to the named section and takes **destinations** from the full
inventory.** `inventoryDetail`'s `local` parameter keeps its meaning (presence evidence); a new trailing `scopes`
parameter supplies `installScopes`/`installScopePaths`. `unidentifiedLocal` stays on `local`: it is a presence claim
(*"a folder named X sits in …"*), and sourcing it from the whole machine would name a folder in a different root on a
page that claims to describe one root.

**DECISION D15 — a scoped read consults neither the status ledger nor the people file.** Both are root-blind: the
ledger records *that* a placement exists somewhere the scan cannot see, and the people file records *that* this user
installed the skill, never *into which root*. Under `at`, `'placed'` when the named root holds it, else `'absent'`.
Implemented by passing `''` for the handle and `[]` for the ledger — no new branch inside `inventoryCard`.

**DECISION D16 — the unscoped `placed` pick is explicitly global-first.** Today it depends on the CLI's emission
order (RC-1). Sorting global-first makes the documented behaviour ("Global wins when a bare name carries no root",
`desktop/src/backend/tauri/index.ts:124-128`) a property of the app rather than an accident of the payload.

**DECISION D17 — an `at` that names no `ls --local` section is IGNORED; the read answers machine-wide with
`owningRoot:null`.** A stale bookmark, a forgotten checkout or a hand-typed root must not produce a fabricated
absence ("Not installed") for a skill that is in fact placed in Global. This is W-04's own open-question-5 default
("degrade to the Global crumb with the machine-wide detail"). An `at` that *does* name a section restricts honestly,
including to an empty answer when that root holds no copy.

**DECISION D18 — one root-comparison helper, in `desktop/src/lib/skill-path.ts`, used at every site.**
`normalizeSeparators`, `samePath`, `isUnderRoot`. Screens may import `src/lib/**` (`desktop/eslint.config.js` restricts
screens from `**/backend/mock/**`, `**/backend/tauri/**`, `**/fixtures/**` and `@tauri-apps/*` only), and
`desktop/src/backend/tauri/index.ts:17,19,22,23` already imports from `../../lib/*`. Casing is **not** normalised:
both sides of every comparison come from the same `ls --local` payload, and lower-casing would be wrong on POSIX and
on WSL. Root `CLAUDE.md:31`: *"Grep for existing code that already does the same thing … never leave two active paths
doing the same thing."* — this replaces the three spellings that exist today.

**DECISION D19 — `?root=global` maps to `{kind:'global'}`.** One ternary. `Root.id` for the global root is the
literal `'global'` on both backends (`desktop/src/backend/tauri/index.ts:90`, `desktop/src/backend/mock/index.ts:200`),
so the value is reachable; without the ternary it would be treated as a checkout path matching nothing.

**DECISION D20 — `removeFrom(s)` prefers `s.owningRoot.id` over the display label.** `InstallArgs.scope` /
`installScopePaths` are keyed by label, and `desktop/src/backend/tauri/index.ts:195` deliberately drops any label two
projects share, which would leave `uninstall-skill` with no `--from` and the CLI asking *"Remove which copy?"*
(`src/commands/uninstall.ts:107-110`) in the one flow whose entire purpose is deleting the copy the reader clicked.
`src/commands/uninstall.ts:96` accepts exactly `global` or an absolute checkout root, which is what `owningRoot.id` is.
No signature change: `owningRoot` rides on `s`. The by-path branch of `execute('remove')` keeps passing `{}` unchanged.

**DECISION D21 — the install-scope-default limb is DROPPED.** No Library card can offer Install: `library()` only
builds a card for a row that is in that section (`desktop/src/backend/tauri/index.ts:532`), so `present` is always
true and `inventoryCard` (`:169-172`) always yields `installed:'placed'`; the detail page's install dialog is gated by
`(dialog!=='install'||(s.installed!=='placed'&&!s.unidentifiedLocal))` (`SkillScreen.tsx:113`). Seeding the radio from
the origin would therefore be an assertion about a state the real adapter cannot reach — the mock-only assertion
`desktop/AGENTS.md` invariant 7 exists to prevent. `const [scope,setScope]=useState('Global')` (`SkillScreen.tsx:60`)
is **unchanged**. Whether Install from a project card should preselect that project is a design-visible default and is
Teddy's call (invariant 8) — recorded in §13.

**DECISION D22 — a successful Move on a *scoped* page navigates to the destination's detail URL; an unscoped page
keeps today's refetch-in-place.** #131's `moveTo()` refetches in place; on a scoped key that re-reads the root the copy
just left, and D15 then renders **"Not installed"** with an Install button while the copy is on this machine. The
navigate removes the false statement *and* leaves the reader on the page describing the copy that now exists. The
unscoped path is left byte-identical because there the machine-wide answer is still correct after a move.

**DECISION D23 — no CLI change, no protocol change.** No new verb, no new `hello.features` key, no changed field
meaning, so `hello.protocol` stays 1 (`docs/frame-protocol.md` versioning rule: *"Additive changes … do not bump it. A
change that alters the meaning of an existing field does."*). `['validate','--',<absolute folder>]` is an existing
invocation shape (`src/commands/validate.ts:30-35`), and `--from <absolute root>` is an existing option
(`src/commands/uninstall.ts:95-97`). Cross-batch contract **C2 does not bind this batch**: `FRAME_VERBS`
(`src/lib/frames.ts:32`), `FRAME_FEATURES` (`src/lib/frames.ts:39-44`) and `FEATURE_KEYS`
(`desktop/src/backend/types.ts:12`) are **not touched**.

**DECISION D24 — the remount key gains `?root=`.** `SkillScreen.tsx:115`'s `key` already includes `path`; adding
`root` means switching origin resets `actionError`, `preferences`, `scope`, `destination` and `notice` exactly as
switching folder does. That is intended: the described copy changed.

**DECISION D25 — the mock gets the same behaviour, from its own roots.** `desktop/AGENTS.md` invariant 7 forbids a
behaviour split between the backends, and #131's `dialogCopy` interpolates `s.scope` into the Move and Remove
sentences — without a mock branch a project-origin page on the mock would say *"Remove from Global"* under a **Terum**
crumb, demonstrating the very bug. The mock resolves `owningRoot` from `mockRoots()` using the same
`isUnderRoot`/`samePath` helper. This is the fixture backend, so it is not a "real adapter serves fixture data"
violation (Teddy, 2026-09-09).

---

## 4. Changes per file

Eight files change. Two are new. `desktop/src/backend/types.ts`, `desktop/src/backend/Backend.ts`,
`desktop/src/backend/tauri/index.ts`, `desktop/src/backend/mock/index.ts`, `desktop/src/backend/mock/data.ts`,
`desktop/src/components/domain/SkillCard.tsx`, `desktop/src/screens/skill/SkillScreen.tsx`,
`desktop/src/screens/skill/RunEvalDialog.tsx`, `desktop/src/app/EvalRunDialogHost.tsx`, plus tests (§7).

**House style:** these files are deliberately dense (single-line components, no blank lines inside components,
`,` -separated `const` chains). Match the surrounding line exactly; do not reformat, do not re-wrap, do not add blank
lines. When a change is inside one of the 3,000-character lines, replace only the quoted substring.

---

### 4.1 NEW FILE — `desktop/src/lib/skill-path.ts` (full contents, 24 lines)

```ts
/** Root and path comparison for paths the CLI emitted. `ls --local` builds every path with
 *  node:path.join (src/lib/placer/agent-paths.ts:11-12, src/lib/local-skills.ts:121), so a Windows
 *  payload is `C:\…\.claude\skills\x` and a WSL one is `\\wsl.localhost\…\x`, while a POSIX payload
 *  is `/…/x`. These helpers compare the two spellings as one. They are pure string functions: no
 *  node:path, no platform probe, so screens may use them (desktop/AGENTS.md invariant 1). */

/** One spelling: every run of separators becomes a single `/`, and trailing separators are dropped.
 *  Casing is deliberately untouched — the section root and the row path in one `ls --local` payload
 *  always share a spelling, and lower-casing would be wrong on POSIX and on WSL. */
export function normalizeSeparators(path:string):string{return path.replace(/[\\/]+/g,'/').replace(/\/+$/,'');}

/** True when both strings name the same folder, whatever separators or trailing slashes they carry.
 *  Two empty strings are the same folder — callers that must reject an empty root use isUnderRoot. */
export function samePath(a:string,b:string):boolean{return normalizeSeparators(a)===normalizeSeparators(b);}

/** True when `path` is `root` itself or sits underneath it. An empty root matches nothing, so a
 *  section with no root cannot swallow the whole machine; a sibling whose name merely starts with
 *  the root's (`/repo-two` under `/repo`) is not inside it, because the boundary `/` is required. */
export function isUnderRoot(path:string,root:string):boolean{
 const a=normalizeSeparators(path),b=normalizeSeparators(root);
 return b!==''&&(a===b||a.startsWith(b+'/'));
}
```

Note the UNC case: `normalizeSeparators('\\\\wsl.localhost\\Ubuntu\\home\\teniroo')` is
`/wsl.localhost/Ubuntu/home/teniroo` — the leading `\\` collapses to one `/`. That is correct here because **both**
sides of every comparison go through the same function and both come from the same payload; the result is never used
to build a path that is handed back to the OS.

---

### 4.2 `desktop/src/backend/types.ts`

**(a)** Line 2 today:

```ts
export type Result<T> = {ok:true;value:T}|{ok:false;error:string;cancelled?:true;refused?:true;reason?:'no-team'|'ambiguous-team'|'not-in-library'|'not-found'|'unreadable'|'invalid-config';value?:T};
```

Add `'ambiguous-ref'` to the union, immediately after `'not-found'`:

```ts
export type Result<T> = {ok:true;value:T}|{ok:false;error:string;cancelled?:true;refused?:true;reason?:'no-team'|'ambiguous-team'|'not-in-library'|'not-found'|'ambiguous-ref'|'unreadable'|'invalid-config';value?:T};
```

**(b)** `SkillDetail` (line 36 opens the type; the block runs to line 48). Insert the new **required** member into the
block, immediately before the existing `viewerHandle` doc comment at lines 42-46, keeping the file's style:

```ts
 /** The Library root this detail describes, as the backend resolved it: `id` is the sidebar's root
  *  id — the literal 'Global', or a checkout's repo root — and `label` is the crumb's first part.
  *  Null when the read was not anchored to one root (a bare-name deep link answered machine-wide,
  *  or the marketplace), and the screen then falls back to `root`. A page must never derive this
  *  from a path: root membership is the backend's to decide (desktop/AGENTS.md invariant 1). */
 owningRoot:{id:string;label:string}|null;
```

`root:'Global'|'Marketplace'` on line 36 stays exactly as it is — it is what drives the Marketplace crumb and Back
button on three locked boards (D3).

---

### 4.3 `desktop/src/backend/Backend.ts`

Line 24 today:

```ts
  skill(q: { ref: string; team?: string }, options?: ReadOptions): Promise<Result<SkillDetail>>;
```

becomes:

```ts
  /** `at` restricts the answer to one Library root: presence, path, scope and version describe the
   *  copy in that root, while the install destinations still list every root on the machine.
   *  Omitted keeps the machine-wide answer a deep link, a bookmark or the marketplace needs. */
  skill(q: { ref: string; team?: string; at?: LibraryScope }, options?: ReadOptions): Promise<Result<SkillDetail>>;
```

`LibraryScope` is already imported on line 1 of this file. Nothing else in `Backend.ts` changes.

---

### 4.4 `desktop/src/backend/tauri/index.ts`

**(a) imports.** Line 12 begins `import type { Root, LibraryTeam, IdentityWrite, Catalog, … } from '../types';` —
add `LibraryScope` to that type-import list. Then add, beside the existing lib imports (`:17,:19,:22,:23`):

```ts
import { isUnderRoot, samePath } from '../../lib/skill-path';
```

**(b) new helper, placed immediately after `rootOf` (which ends at line 91).**

```ts
/** The root a detail was resolved in, in the sidebar's own terms. The checkout id comes from rootOf
 *  so it is byte-identical to the id Sidebar.tsx compares against; the global root uses the literal
 *  'Global' because Sidebar.tsx:31 matches that, not rootOf's lowercase 'global'. */
function owningRootOf(section:LocalSection):{id:string;label:string}{
  return section.scope==='global'?{id:'Global',label:'Global'}:{id:rootOf(section).id,label:labelOf(section)};
}
/** The one `ls --local` section a scoped read is anchored to. The comparison is separator- and
 *  trailing-separator-insensitive because the value arrives from a URL, and library() uses the same
 *  predicate, so any root that opens a checkout Library also opens a scoped detail. */
function sectionFor(local:Inventory,at:LibraryScope):LocalSection|undefined{
  return (local.local??[]).find(section=>at.kind==='global'?section.scope==='global':section.scope==='project'&&samePath(section.repoRoot??section.root,at.root));
}
/** Presence evidence narrowed to one root. Destinations are NOT narrowed — see inventoryDetail. */
function restrictLocal(local:Inventory,section:LocalSection):Inventory{return {...local,local:[section]};}
```

**(c) `localDetail` (line 120-123).** Current return, line 122, begins:

```ts
  return {...card,desc_long:card.desc,size_bytes:'—',team:null,skillRef:'local:'+path,root:'Global',installScopes:[],…
```

Insert `owningRoot:owningRootOf(section),` immediately after `root:'Global',` on that line. Everything else on line 122
is unchanged. (`localDetail` already receives `section`, so nothing else moves. This one edit covers **both** local
resolutions: the by-path route via `localSkill` and the bare-name fallback via `localDetailByName` at `:133`/`:135`.)

**(d) `inventoryDetail` — signature (line 183).** Current:

```ts
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, placements: LedgerPlacements, validation: Result<ValidateResult>, inventory: Inventory, features: Pick<Features, 'localIdentity'>, home: string): SkillDetail {
```

becomes (two new **trailing, defaulted** parameters, so the unscoped call sites are unchanged):

```ts
/** `local` is the presence evidence — restricted to one section for a scoped read. `scopes` is the
 *  full machine inventory the install destinations come from, so restricting presence never
 *  truncates the Install-to list. `at` names the root a scoped read was anchored to: non-null means
 *  the answer describes exactly that root, so the two root-blind fallbacks (the unfiltered status
 *  ledger and this user's people file) are not consulted — neither records WHICH root. */
function inventoryDetail(row: InventorySkill, local: Inventory, team: InventoryTeam, placements: LedgerPlacements, validation: Result<ValidateResult>, inventory: Inventory, features: Pick<Features, 'localIdentity'>, home: string, scopes: Inventory = local, at: {id:string;label:string} | null = null): SkillDetail {
```

**(e) `inventoryDetail` — body, line 184.** Current:

```ts
  const card = inventoryCard(row, local, team.team, features, home, team.handle, placements), rows = onDisk(local, team.team, row.id, features), placed = rows.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? rows[0]?.path ?? null;
```

becomes (D15 + D16):

```ts
  const card = inventoryCard(row, local, team.team, features, home, at ? '' : team.handle, at ? [] : placements), rows = onDisk(local, team.team, row.id, features);
  // Global first by rule, not by the CLI's emission order: a read that names no root answers with
  // the Global copy (the documented bare-name rule at :124-128), and a scoped read has one section.
  const ordered = [...rows].sort((a, b) => Number(b.scope === 'global') - Number(a.scope === 'global'));
  const placed = ordered.find(r => r.placement?.id === row.id && r.placement.team === team.team);
  const path = placed?.path ?? ordered[0]?.path ?? null;
```

**(f) `inventoryDetail` — destinations, lines 192-195.** Change the source inventory from `local` to `scopes` in the
`projects` line only (lines 193-195 then follow unchanged because they read `projects`):

```ts
  const projects = (scopes.local ?? []).filter(section => section.scope === 'project' && section.rootState !== 'absent' && section.label);
```

Line 197's `unidentifiedLocal(local, row.name, features, home)` **stays on `local`** (D14) — do not change it.

**(g) `inventoryDetail` — the returned object, line 196.** The line contains `…, skillRef: \`${team.team}/${row.name}\`, root: 'Global', desc_long: …`. Insert `owningRoot: at,` immediately after `root: 'Global',`. Nothing else on line 196 changes.

**(h) `library()` — the section lookup, line 526.** Current:

```ts
      const section = local.value.local?.find(section => scope.kind==='global' ? section.scope==='global' : section.scope==='project' && normalizePath(section.repoRoot??section.root)===normalizePath(scope.root));
```

becomes (one predicate for the whole app — D18; this can only *add* matches that differ by separator spelling, never
remove one, because `normalizePath(a)===normalizePath(b)` implies `samePath(a,b)`):

```ts
      const section = local.value.local?.find(section => scope.kind==='global' ? section.scope==='global' : section.scope==='project' && samePath(section.repoRoot??section.root,scope.root));
```

**(i) `localSkill()` — the path lookup, lines 553-554.** Current:

```ts
        const row=section.rows.find(row=>normalizePath(row.path)===normalizePath(path));
        const entry=row?undefined:section.notOffered?.find(entry=>countable(entry)&&normalizePath(entry.path)===normalizePath(path));
```

becomes (the `path` argument arrives from a URL, same reasoning as (h)):

```ts
        const row=section.rows.find(row=>samePath(row.path,path));
        const entry=row?undefined:section.notOffered?.find(entry=>countable(entry)&&samePath(entry.path,path));
```

**(j) `localSkill()` — the joined branch, line 562.** Current:

```ts
          const detail=inventoryDetail(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.selected,enrichment.selected.placements,validation,enrichment.inventory,features,directory);
```

becomes (fixes RC-6 and names the root):

```ts
          const detail=inventoryDetail(skill,{...local.value,local:[{...section,rows:[row]}]},enrichment.selected,enrichment.selected.placements,validation,enrichment.inventory,features,directory,local.value,owningRootOf(section));
```

**(k) `skill()` — lines 573-603 in full.** Current (`:573`, `:590`, `:592`, `:597`, `:600`) → new. Replace the whole
method body with this; every change is marked with a comment:

```ts
    async skill({ ref, team, at }, options) {
      const parts = ref.split('/');
      const explicitTeam = team ?? (parts.length === 2 ? parts[0] : undefined);
      const name = parts.length === 2 ? parts[1]! : ref;
      const selected = await inventoryTeam(explicitTeam, options);
      if (!selected.ok) return { ok: false, error: selected.error, reason: selected.reason ?? 'unreadable' };
      const inventory = await cached(['ls', '--team', selected.value.team], cliLs, options);
      if (!inventory.ok) return { ok: false, error: inventory.error, reason: 'unreadable' };
      const matches = inventory.value.skills.filter(row => row.name === name || row.id.startsWith(name));
      const row = inventory.value.skills.find(row => row.name === name) ?? (matches.length === 1 ? matches[0] : undefined);
      const local = await cached(['ls', '--local'], cliLs, options);
      if (!local.ok) return { ok: false, error: local.error, reason: 'unreadable' };
      const features = { localIdentity: hello?.features.localIdentity ?? false };
      // A root the scan does not report (a stale bookmark, a forgotten checkout, a hand-typed URL)
      // is ignored rather than answered with a fabricated absence: the machine-wide answer is what
      // an unscoped URL gives today, and it never claims a root it did not resolve.
      const section = at === undefined ? undefined : sectionFor(local.value, at);
      const presence = section ? restrictLocal(local.value, section) : local.value;
      const owning = section ? owningRootOf(section) : null;
      if (!row) {
        // A bare name the team does not offer may still name a folder on this machine — one nobody
        // shared, or one whose frontmatter the CLI could not parse. Deep links and bookmarks arrive
        // as a bare name with no path, so the local roots answer before the name is reported
        // unknown. A scoped read searches only the root it names. An ambiguous team prefix is a
        // team-side ambiguity and is reported as such, with the count and the way out.
        const onThisMachine = matches.length === 0 ? localDetailByName(presence, name, await home()) : undefined;
        if (onThisMachine) return { ok: true, value: onThisMachine };
        if (matches.length === 0) return { ok: false, reason: 'not-found', error: `No skill named ${name} is shared in team ${selected.value.team}, and no readable folder of that name is in your Library roots.` };
        return { ok: false, reason: 'ambiguous-ref', error: `${matches.length} team skills in ${selected.value.team} have an ID starting with ${name}; open the one you want from the marketplace.` };
      }
      const validation = await backend.validate({ ref: row.name, team: selected.value.team }, options);
      // A hygiene failure has a parsed value; an unreadable/cancelled validation is a read failure.
      if (!validation.ok && validation.value === undefined) return { ok: false, error: validation.error, reason: 'unreadable' };
      const detail = inventoryDetail(row, presence, selected.value, selected.value.placements, validation, inventory.value, features, await home(), local.value, owning);
      const report = await backend.evalReport({ref:row.name,team:selected.value.team},options);
      const merged = report.ok ? {...detail, ...report.value} : {...detail, evalReportError: report.error};
      // The version names the copy this page describes, so a scoped read reads the scoped placement.
      const placementVersion = onDisk(presence, selected.value.team, row.id, features).find(item => item.placement?.id === row.id && item.placement.team === selected.value.team)?.placement?.version;
      const version = placementVersion ?? merged.versions?.teamCurrent ?? detail.version_full;
      return {ok:true,value:{...merged,...detailVersionFields(detail.repo, row.name, version)}};
    },
```

**(l) the Settings shared-sources column, line 262 (RC-7 drive-by).** Current:

```ts
   const scanned=local?.local.some(section=>(section.rootState??'scanned')==='scanned'&&normalizePath(item.source).startsWith(normalizePath(section.root)+'/'))??false;
```

becomes:

```ts
   const scanned=local?.local.some(section=>(section.rootState??'scanned')==='scanned'&&isUnderRoot(item.source,section.root))??false;
```

Line 261 (`normalizePath(row.path)===normalizePath(item.source)`) is **left alone**: both sides come from the same
`status` payload, it is not URL-supplied, and changing it would widen a comparison no bug touches.

`normalizePath` (line 75) stays — it is still used at `:74`-adjacent sites and by `basename`. Do not delete it.

---

### 4.5 `desktop/src/backend/mock/data.ts`

Line 17 (the `detailOf` return) contains `…unidentifiedLocal:null,viewerHandle:design.ME.handle,…`. Add
`owningRoot:null,` immediately after `unidentifiedLocal:null,`. This is the single construction site for every mock
`SkillDetail`, so it satisfies the new required field everywhere and keeps every locked board on the `s.root` path (D3).

---

### 4.6 `desktop/src/backend/mock/index.ts`

**(a) imports.** Line 4 (`import type { Settings, SyncResult, ChangeSource, Features, Identity, Library, Project, Root } from '../types';`) — add `LibraryScope` and `SkillDetail`. Add beside the other lib imports (lines 5-6):

```ts
import { isUnderRoot, normalizeSeparators } from '../../lib/skill-path';
```

**(b) two module-level helpers, placed immediately after `mockRoots()` (which ends at line 202).**

```ts
/** Which mock Library root holds this folder — the longest match, so a checkout nested inside
 *  another names the inner one, exactly as the CLI's own section assignment would. Null when the
 *  path is under no mock root, and the page then falls back to `root` as it does today. */
function mockOwningRoot(path:string):{id:string;label:string}|null{
 const root=mockRoots().filter(r=>isUnderRoot(path,r.root)).sort((a,b)=>normalizeSeparators(b.root).length-normalizeSeparators(a.root).length)[0];
 return root?{id:root.kind==='global'?'Global':root.id,label:root.label}:null;
}
/** A scoped read names the root the reader clicked, as the real adapter does, so the crumb, the
 *  sidebar, the Remove destination and #131's dialog wording agree with the URL. `installScopes`
 *  is deliberately untouched: destinations come from the whole machine on both backends. */
function scopedDetail(detail:SkillDetail,at:LibraryScope|undefined):SkillDetail{
 if(at===undefined)return detail;
 const root=mockRoots().find(r=>at.kind==='global'?r.kind==='global':r.id===at.root);
 if(!root)return detail;
 const path=root.kind==='global'?'~/.claude/skills/'+detail.name:root.root+'/.claude/skills/'+detail.name;
 return {...detail,owningRoot:{id:root.kind==='global'?'Global':root.id,label:root.label},scope:root.label,path,pathLabel:path,installScopePaths:Object.fromEntries(mockRoots().flatMap(r=>r.kind==='checkout'?[[r.label,r.root]]:[]))};
}
```

**(c) `localSkill`, line 112.** Current:

```ts
  localSkill:({path})=>read('skill',()=>{const detail=skillByRef(path.split(/[\\/]/).filter(Boolean).at(-1)??'');return detail.ok?ok({...detail.value,team:null,skillRef:'local:'+path,path,pathLabel:path,repoPath:path}):{ok:false,error:path+' is not in any Library root.',reason:'not-in-library'};}),
```

becomes (adds `owningRoot` only):

```ts
  localSkill:({path})=>read('skill',()=>{const detail=skillByRef(path.split(/[\\/]/).filter(Boolean).at(-1)??'');return detail.ok?ok({...detail.value,team:null,skillRef:'local:'+path,path,pathLabel:path,repoPath:path,owningRoot:mockOwningRoot(path)}):{ok:false,error:path+' is not in any Library root.',reason:'not-in-library'};}),
```

**(d) `skill`, lines 115-118.** Change the destructure to `({ref,at})` on line 115 and wrap **both** return points in
`scopedDetail(…, at)`. Line 115 today ends with `…return ok(removalState(detailOf(design.DETAIL_NOT_INSTALLED)));const result=skillByRef(ref);` — the early return becomes
`…return ok(scopedDetail(removalState(detailOf(design.DETAIL_NOT_INSTALLED)),at));`. Line 118 today is:

```ts
   return result.ok?ok(removalState(withInstall({...result.value,…,favorite:backend.prefs.get('favorite:'+ref,result.value.favorite)}))):result;},ref),
```

becomes `…return result.ok?ok(scopedDetail(removalState(withInstall({…unchanged…})),at)):result;},ref),` — i.e. wrap the
existing `removalState(withInstall(…))` expression in `scopedDetail(…, at)` and change nothing inside it.

No board passes `at`, so every locked board's value is byte-identical.

---

### 4.7 `desktop/src/components/domain/SkillCard.tsx`

Line 4 today: `import { useLocation, useNavigate } from 'react-router';` → add `useSearchParams`.

Line 16 today begins:

```ts
export function SkillCard({skill}:{skill:Card}){const backend=useBackend(),location=useLocation(),origin=location.pathname.startsWith('/marketplace')?'root=marketplace':'',navigate=useNavigate(),features=useFeatures(),capabilities=useCapabilities();
```

Replace that leading fragment with (the rest of line 16 is unchanged):

```ts
export function SkillCard({skill}:{skill:Card}){const backend=useBackend(),location=useLocation(),[search]=useSearchParams(),origin=location.pathname.startsWith('/marketplace')?'root=marketplace':location.pathname==='/library/checkout'&&search.get('root')?'root='+encodeURIComponent(search.get('root')!):'',navigate=useNavigate(),features=useFeatures(),capabilities=useCapabilities();
```

`cardActions` already rides `origin` on every teamed action
(`desktop/src/components/domain/skill-card-actions.ts:21` `ridesOrigin=skill.teamed||!skill.path`), so Open, Run eval,
Move to…, Install…/Uninstall…/Reinstall… and Publish… all inherit this with no further edit. `skill-card-actions.ts`
is **not** modified except for one doc-comment line:

`skill-card-actions.ts:18-19` today reads *"`origin` is the `root=marketplace` crumb the detail page reads back, or ''
from the library."* Replace with: *"`origin` is the origin the detail page reads back — `root=marketplace`, or
`root=<checkout repo root>` from a project Library — or '' from the Global library."*

`/library/global` is not `/library/checkout`, so Global-library hrefs stay byte-identical (D12).

---

### 4.8 `desktop/src/screens/skill/SkillScreen.tsx`

**(a) imports — NO CHANGE.** Do **not** import `skill-path` here. D5 removes every path comparison from this screen,
so an import would be unused and `npm run lint` would reject it. `useQuery` stays imported: line 64 still uses it for
the skill query. Nothing else in the import block changes.

**(b) `removeFrom` — line 51.** Current:

```ts
/** The uninstall argument naming the scope a placed copy is removed from. */
function removeFrom(s:SkillDetail):{from?:string}{if(s.scope==='Global')return {from:'global'};const path=s.scope?s.installScopePaths?.[s.scope]:undefined;return path?{from:path}:{};}
```

becomes:

```ts
/** The uninstall argument naming the scope a placed copy is removed from. A read the backend
 *  anchored to one root already knows the absolute destination, so its id is used verbatim: the
 *  label map deliberately drops a label two checkouts share (tauri/index.ts:195), which would leave
 *  the CLI asking which copy to delete (src/commands/uninstall.ts:107-110). `--from` takes exactly
 *  `global` or an absolute checkout root (src/commands/uninstall.ts:96). */
function removeFrom(s:SkillDetail):{from?:string}{if(s.owningRoot)return {from:s.owningRoot.id==='Global'?'global':s.owningRoot.id};if(s.scope==='Global')return {from:'global'};const path=s.scope?s.installScopePaths?.[s.scope]:undefined;return path?{from:path}:{};}
```

**(c) new module-level helper, placed immediately after `removeFrom`.**

```ts
/** The Library list this page belongs to: the root the backend resolved, else the root the URL
 *  named, else Global. Every back-link on the page uses it, so an error board returns the reader to
 *  the list they came from instead of dropping them in Global. */
function libraryPath(id:string|null|undefined):string{return !id||id==='Global'||id==='global'?'/library/global':'/library/checkout?root='+encodeURIComponent(id);}
```

**(d) lines 61-64.** Current lines 61-63:

```ts
 const localPath=ref==='local'?params.get('path'):null;
 const status=useQuery({queryKey:['status',state.mock],enabled:localPath!==null,queryFn:({signal})=>backend.status(undefined,{signal})});
 const checkout=localPath===null?undefined:status.data?.value?.roots.filter(root=>root.kind==='checkout'&&root.registered&&(localPath===root.root.replace(/[\\/]+$/,'')||localPath.startsWith(root.root.replace(/[\\/]+$/,'')+'/'))).sort((a,b)=>b.root.length-a.root.length)[0];
```

Delete lines 62 and 63 entirely and replace line 61 with:

```ts
 const localPath=ref==='local'?params.get('path'):null;
 // ?root= carries the origin: the literal 'marketplace', or the checkout root the sidebar and the
 // Library already use (routes.tsx:21-22). Root membership itself is the backend's answer, never a
 // prefix test in this screen — that test was POSIX-only and reported Global on every Windows path.
 const originRoot=params.get('root'),scopeRoot=originRoot!==null&&originRoot!=='marketplace'?originRoot:null;
 const at=scopeRoot===null?undefined:scopeRoot==='global'?{kind:'global' as const}:{kind:'checkout' as const,root:scopeRoot};
```

**(e) line 64 — the query and the derived root.** Current line 64 opens with:

```ts
 const query=useQuery({queryKey:['skill',localPath!==null?'local:'+localPath:ref,state.mock],queryFn:({signal})=>localPath!==null?backend.localSkill({path:localPath},{signal}):backend.skill({ref},{signal})});
```

becomes (the scope goes **after** `ref` so prefix invalidation on `['skill',ref]` still reaches it):

```ts
 const query=useQuery({queryKey:['skill',localPath!==null?'local:'+localPath:ref,scopeRoot??'',state.mock],queryFn:({signal})=>localPath!==null?backend.localSkill({path:localPath},{signal}):backend.skill({ref,...(at?{at}:{})},{signal})});
```

The tail of line 64 today is:

```ts
const selected=localPath!==null?checkout?.id??'Global':undefined;const root=localPath!==null?checkout?.label??'Global':params.get('root')==='marketplace'?'Marketplace':s?.root??'Global';
```

becomes:

```ts
const marketplace=originRoot==='marketplace'||s?.root==='Marketplace';const rootLabel=marketplace?'Marketplace':s?.owningRoot?.label??s?.root??'Global';const selected=marketplace?undefined:s?.owningRoot?.id??(scopeRoot==='global'?'Global':scopeRoot)??(localPath!==null?'Global':undefined);const backTo=marketplace?'/marketplace':libraryPath(s?.owningRoot?.id??scopeRoot);
```

Everything between (`const raw=…` through `rail=state.railOpen&&!error;`) is unchanged. `s?.root==='Marketplace'` is
load-bearing: three locked boards reach the Marketplace crumb through the mock fixture, with no `?root=` in the URL (D3).

**(f) line 66 — `savePref`.** Replace `backend.prefs.set(key+':'+ref,value)` with `backend.prefs.set(key+':'+(s?.name??ref),value)`.

**(g) line 68 — `validate`.** Current:

```ts
 async function validate(){try{const result=await backend.validate({ref,...(s?.team?{team:s.team}:{})});setValidation(result);if(result.ok)void queryClient.invalidateQueries({queryKey:['skill',ref]});}catch(e){setValidation({ok:false,error:e instanceof Error?e.message:'Validation failed.'});}}
```

becomes:

```ts
 // The by-path page is about a folder, and the CLI validates a folder given an absolute path
 // (src/commands/validate.ts:30-35). The name route keeps validating the team's copy — s.path is
 // non-null for an installed team skill too, and switching that would silently disagree with the
 // hygiene caption and the TerminalHint on the same tab. Invalidate the key PREFIX so every ?root=
 // variant of this skill refreshes, including the by-path key the old call could never reach.
 async function validate(){const target=localPath!==null?(s?.path??ref):(s?.name??ref);try{const result=await backend.validate({ref:target,...(s?.team?{team:s.team}:{})});setValidation(result);if(result.ok)void queryClient.invalidateQueries({queryKey:['skill',localPath!==null?'local:'+localPath:ref]});}catch(e){setValidation({ok:false,error:e instanceof Error?e.message:'Validation failed.'});}}
```

**(h) `moveTo()` — line 88 (D22).** Current:

```ts
   setDestination(null);void query.refetch();
```

becomes:

```ts
   // A scoped page describes one root. After a move that root no longer holds the copy, so a
   // refetch in place would render an honest-but-useless "Not installed" for a skill that is on
   // this machine. Follow the copy instead; an unscoped page's machine-wide answer is still right.
   setDestination(null);
   if(scopeRoot===null){void query.refetch();return;}
   const moved=target==='Global'?null:s.installScopePaths?.[target]??null;
   navigate('/skill/'+encodeURIComponent(ref)+(moved?'?root='+encodeURIComponent(moved):''));
```

**(i) `execute()` — line 107, the tail.** Current:

```ts
if(kind==='remove')navigate('/library/global');else if(kind==='install')navigate('/skill/'+encodeURIComponent(ref)+(root==='Marketplace'?'?root=marketplace':''));else if(kind==='sync'){…}
```

becomes:

```ts
if(kind==='remove')navigate(backTo);else if(kind==='install')navigate('/skill/'+encodeURIComponent(ref)+(marketplace?'?root=marketplace':scopeRoot!==null?'?root='+encodeURIComponent(scopeRoot):''));else if(kind==='sync'){…}
```

**(j) every back-link.** In the JSX at lines 111-113, replace **all six** literal occurrences of
`navigate('/library/global')` with `navigate(backTo)`, and replace the back-arrow ternary
`onClick={()=>navigate(root==='Marketplace'?'/marketplace':'/library/global')}` with `onClick={()=>navigate(backTo)}`.
(Occurrences: line 111 × 3 — the not-in-library primary, the "Couldn't read <folder>" secondary, the no-team secondary;
line 112 × 1 — the ambiguous-team secondary; line 113 × 1 — inside the not-found `onSecondary` chain, which is rewritten
wholesale in (l); plus line 107 × 1, already covered in (i).)

**(k) the crumbs, line 111.** Replace:

```tsx
{[root,s?.team??s?.project,s?.category,ref].filter((part):part is string=>!!part&&part!=='—')
```

with:

```tsx
{[rootLabel,(s?.team??s?.project)===rootLabel?null:(s?.team??s?.project),s?.category,s?.name??ref].filter((part):part is string=>!!part&&part!=='—')
```

Also replace `<Shell counts={loading?null:undefined} selected={selected??root}>` with
`<Shell counts={loading?null:undefined} selected={selected??rootLabel}>`.

**(l) the error boards, line 113.** Replace the final `:<CenteredState …>` arm with an `ambiguous-ref` arm followed by
the rewritten fallback arm:

```tsx
 :failureReason==='ambiguous-ref'?<CenteredState alert icon="alert" title="More than one skill matches" body="This reference is the start of more than one skill ID in your team. Open the one you want from the marketplace, where each skill has its own page." primary="Open marketplace" secondary="Back to library" onPrimary={()=>navigate('/marketplace')} onSecondary={()=>navigate(backTo)}><ErrorLine>{error}</ErrorLine></CenteredState>
 :<CenteredState alert icon="alert" title={(failureReason==='not-found'?"Couldn't find ":"Couldn't read ")+ref} body={failureReason==='not-found'?'No team skill and no folder terum-skills can open carry this name. It may have been renamed, be a symlink, or live in a checkout that is not registered.':failureReason==='unreadable'?'terum-skills could not read the team clone or the skills folder. Check the path in Settings, then try again.':'The skill is listed in your people file but its folder is missing from this machine. Sync to place it again, or remove it from Global.'} primary={failureReason==='not-found'?'Back to library':failureReason==='unreadable'?'Try again':'Sync now'} secondary={failureReason==='not-found'?'Search the marketplace':failureReason==='unreadable'?'Open settings':'Remove from Global'} onPrimary={()=>{if(failureReason==='not-found')navigate(backTo);else if(failureReason==='unreadable')void query.refetch();else void execute('sync');}} onSecondary={()=>{if(failureReason==='not-found')navigate('/marketplace?q='+encodeURIComponent(ref));else if(failureReason==='unreadable')navigate('/settings/account');else void execute('remove');}}><ErrorLine>{error}</ErrorLine></CenteredState>}
```

`/marketplace?q=<term>` is the destination `LibraryScreen.tsx:43` already uses for its own "Search marketplace"
secondary (`navigate('/marketplace?q='+encodeURIComponent(state.q??''))`), and `MarketplaceScreen.tsx:126` renders
`<div className="market-search-results">` when `state.q` is set. `/marketplace/skills?q=` was **rejected**: that path
takes the `type` (ListPage) branch, which does not render a query's results.

**(m) the remount key, line 115.** Current:

```ts
export function SkillScreen(){const {ref}=useParams();const {mock}=useUrlState();const [params]=useSearchParams();return <SkillPage key={(ref??'')+':'+mock+':'+(params.get('path')??'')}/>;}
```

becomes:

```ts
export function SkillScreen(){const {ref}=useParams();const {mock}=useUrlState();const [params]=useSearchParams();return <SkillPage key={(ref??'')+':'+mock+':'+(params.get('path')??'')+':'+(params.get('root')??'')}/>;}
```

---

### 4.9 `desktop/src/screens/skill/RunEvalDialog.tsx`

Delete line 2 (`import { useParams } from 'react-router';`) and lines 16-17:

```ts
 const {ref:routeRef}=useParams();
 const ref=routeRef??s.name;
```

Line 25 today:

```ts
 function start(){try{evalRun.start({ref,name:s.name,...(s.team?{team:s.team}:{}),commit});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
```

becomes:

```ts
 // The CLI's `eval` verb takes the skill, never the URL segment: on the by-path route that segment
 // is the literal word `local`, which spawned ['eval','--commit','--','local'] and always failed.
 function start(){try{evalRun.start({ref:s.name,name:s.name,...(s.team?{team:s.team}:{}),commit});onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
```

---

### 4.10 `desktop/src/app/EvalRunDialogHost.tsx`

Line 17 today:

```ts
 const fromUrl=current!==null&&location.pathname==='/skill/'+encodeURIComponent(current.ref)&&params.get('dialog')==='run-eval';
```

becomes:

```ts
 // The run's ref is the skill's name now, so a by-path detail page — whose pathname is the literal
 // /skill/local — is matched by its route rather than by the ref. No wider than before: the ref
 // used to BE 'local' there, which already matched any /skill/local page.
 const fromUrl=current!==null&&params.get('dialog')==='run-eval'&&(location.pathname==='/skill/'+encodeURIComponent(current.ref)||location.pathname==='/skill/local');
```

---

## 5. Copy strings (verbatim)

Every string below is authored by the app. **None** of them is in `desktop/src/fixtures/design.json` — verified at
9fb73e9: `grep -c` for `No unambiguous skill`, `is shared in this team`, `Open marketplace`, `Back to library`,
`Search the marketplace`, `ambiguous-ref` each returns **0**. So invariant 3 (generated files) is untouched and no
oracle can contain them.

| where | string |
|---|---|
| `tauri/index.ts` `skill()`, `reason:'not-found'` | `No skill named ${name} is shared in team ${selected.value.team}, and no readable folder of that name is in your Library roots.` |
| `tauri/index.ts` `skill()`, `reason:'ambiguous-ref'` | `${matches.length} team skills in ${selected.value.team} have an ID starting with ${name}; open the one you want from the marketplace.` |
| SkillScreen not-found board — title | `Couldn't find ` + `ref` (unchanged) |
| SkillScreen not-found board — body | `No team skill and no folder terum-skills can open carry this name. It may have been renamed, be a symlink, or live in a checkout that is not registered.` |
| SkillScreen not-found board — primary | `Back to library` |
| SkillScreen not-found board — secondary | `Search the marketplace` |
| SkillScreen `ambiguous-ref` board — title | `More than one skill matches` |
| SkillScreen `ambiguous-ref` board — body | `This reference is the start of more than one skill ID in your team. Open the one you want from the marketplace, where each skill has its own page.` |
| SkillScreen `ambiguous-ref` board — primary | `Open marketplace` |
| SkillScreen `ambiguous-ref` board — secondary | `Back to library` |
| `skill-card-actions.ts:18-19` doc comment | `` `origin` is the origin the detail page reads back — `root=marketplace`, or `root=<checkout repo root>` from a project Library — or '' from the Global library. `` |

Two notes on the wording, both deliberate:

* The not-found body says *"no folder terum-skills can open"*, not *"no folder"*. A symlinked folder **is** on disk;
  `countable()` (`tauri/index.ts:95`) excludes `'symlink'`, so it draws no card and resolves by neither name nor path.
  13 of the 45 entries in Teddy's global root are symlinks. The sentence must stay true for them.
* The `ambiguous-ref` body does not repeat the count; the `ErrorLine` beneath it carries the adapter's own sentence,
  which names both the count and the team.

**Strings that must NOT change:** `No skill named ${ref} is shared in this team.` is *deleted* (replaced by the body
above); `terum-skills could not read the team clone or the skills folder. Check the path in Settings, then try again.`
and `The skill is listed in your people file but its folder is missing from this machine. Sync to place it again, or
remove it from Global.` and every other board's copy stay exactly as they are.

---

## 6. Types and seam changes

```ts
// desktop/src/backend/types.ts:2 — one new member of the reason union
reason?:'no-team'|'ambiguous-team'|'not-in-library'|'not-found'|'ambiguous-ref'|'unreadable'|'invalid-config'

// desktop/src/backend/types.ts, inside SkillDetail — one new REQUIRED member
owningRoot:{id:string;label:string}|null;

// desktop/src/backend/Backend.ts:24 — one new OPTIONAL query field
skill(q: { ref: string; team?: string; at?: LibraryScope }, options?: ReadOptions): Promise<Result<SkillDetail>>;

// desktop/src/lib/skill-path.ts — new module
export function normalizeSeparators(path:string):string
export function samePath(a:string,b:string):boolean
export function isUnderRoot(path:string,root:string):boolean

// desktop/src/backend/tauri/index.ts — new module-private helpers
function owningRootOf(section:LocalSection):{id:string;label:string}
function sectionFor(local:Inventory,at:LibraryScope):LocalSection|undefined
function restrictLocal(local:Inventory,section:LocalSection):Inventory
// and two new trailing, defaulted parameters on inventoryDetail:
//   scopes: Inventory = local        (destinations)
//   at: {id:string;label:string} | null = null   (the anchored root; null = machine-wide)

// desktop/src/backend/mock/index.ts — new module-private helpers
function mockOwningRoot(path:string):{id:string;label:string}|null
function scopedDetail(detail:SkillDetail,at:LibraryScope|undefined):SkillDetail
```

`LibraryScope` (`desktop/src/backend/types.ts:61`) is reused unchanged:
`export type LibraryScope={kind:'global'}|{kind:'checkout';root:string};`

No change to `Root`, `SkillCard`, `Library`, `InstallArgs`, `UninstallArgs`, `Features`, `Capabilities`, `FEATURE_KEYS`
or any CLI type.

---

## 7. Tests

Run the suites with `cd desktop && npx vitest run <file>` while iterating, and the full gate battery at the end (§8).
`desktop/AGENTS.md` invariant 7: no test may be deleted or weakened. Four existing tests are **modified**, each listed
below with the reason (contract C9).

### 7.1 NEW — `desktop/src/lib/skill-path.test.ts`

Plain vitest, no DOM. Use `String.raw` for every backslash path, as `desktop/src/backend/__tests__/paths.test.ts:7`
already does.

1. `it('collapses every separator run and trailing separator into one spelling')` — arrange the table
   `['/a/b','/a/b']`, `[String.raw`C:\a\b`,'C:/a/b']`, `[String.raw`\\wsl.localhost\Ubuntu\home\t`,'/wsl.localhost/Ubuntu/home/t']`,
   `['/a//b///','/a/b']`, `[String.raw`/a\b/c`,'/a/b/c']`, `['','']`, `['/','']`, `[String.raw`\\`,'']`.
   Assert `normalizeSeparators(input)===expected`.
2. `it('keeps case, because both sides come from one ls --local payload')` — `normalizeSeparators('/A/b')` is `'/A/b'`;
   `samePath('/a/b','/A/b')` is `false`.
3. `it('matches a folder under its root on POSIX, Windows and WSL UNC spellings')` — for each of
   `['/repo','/repo/.claude/skills/x']`, `[String.raw`C:\Users\t\Projects\terum`,String.raw`C:\Users\t\Projects\terum\.claude\skills\x`]`,
   `[String.raw`\\wsl.localhost\Ubuntu\home\teniroo`,String.raw`\\wsl.localhost\Ubuntu\home\teniroo\.claude\skills\adopt-agent-tooling`]`,
   and the mixed spelling `['/repo/',String.raw`\repo\.claude\skills\x`]`, assert `isUnderRoot(path,root)` is `true`.
4. `it('refuses a sibling whose name merely starts with the root')` — `isUnderRoot('/repo-two/.claude/skills/x','/repo')`
   and `isUnderRoot(String.raw`C:\repo-two\x`,String.raw`C:\repo`)` are both `false`.
5. `it('treats a path equal to its root as inside it, and an empty root as matching nothing')` —
   `isUnderRoot('/repo','/repo')` and `isUnderRoot('/repo/','/repo')` are `true`;
   `isUnderRoot('/anything','')`, `isUnderRoot('/anything','/')` and `isUnderRoot('','')` are `false`.
6. `it('compares two paths for the same folder across spellings and trailing slashes')` —
   `samePath('/a/b/','/a/b')`, `samePath(String.raw`C:\a\b`,'C:/a/b')` are `true`; `samePath('/a/b','/a/bc')` is `false`.

### 7.2 NEW + MODIFIED — `desktop/src/backend/tauri/__tests__/index.test.ts`

Reuse the file's own fixtures: `inventoryBridge({local})` (line 281), `unsharedLocal`/`unsharedRow` (lines 307-308),
`lsRow`/`lsValue` (lines 279-280). Build a two-copy payload as a local helper beside `unsharedLocal`:

```ts
function placedRow(name:string,path:string,version:string){return {name,path,state:'placement recorded from acme',tracked:true,shared:[],placement:{id:'id-a',team:'acme',version},health:'up-to-date'};}
function twoCopies(globalPath='/home/.claude/skills/a',projectRoot='/work/ops'){return {roster:[],skills:[],problems:[],local:[
 {root:'/home/.claude/skills',scope:'global',rows:[placedRow('a',globalPath,'a'.repeat(40))],notOffered:[],problems:[]},
 {root:projectRoot+'/.claude/skills',repoRoot:projectRoot,scope:'project',label:'ops',rootState:'scanned',registered:true,detected:false,rows:[placedRow('a',projectRoot+'/.claude/skills/a','b'.repeat(40))],notOffered:[],problems:[]},
]};}
```

**MODIFIED — line 327-330** `it('reports a name that is neither in the team nor on this machine as unknown, not unreadable')`.
Reason: the adapter's sentence changed (RC-5). New expectation:
`{ok:false,reason:'not-found',error:'No skill named nowhere is shared in team acme, and no readable folder of that name is in your Library roots.'}`.

**MODIFIED — line 331-339** `it('still reports an ambiguous team id prefix as ambiguous rather than searching local roots')`.
Reason: the reason code and the sentence changed. New expectation:
`{ok:false,reason:'ambiguous-ref',error:'2 team skills in acme have an ID starting with ab; open the one you want from the marketplace.'}`.

New tests, all in this file:

7. `it('describes the copy in the root the reader named, not the first one the CLI listed')` — `twoCopies()`;
   `skill({ref:'a',team:'acme',at:{kind:'checkout',root:'/work/ops'}})` → `scope:'ops'`,
   `path:'/work/ops/.claude/skills/a'`, `owningRoot:{id:'/work/ops',label:'ops'}`, and `version_full` is the `'b'*40`
   placement. **Fails on the pre-fix tree** (returns Global's path and version).
8. `it('keeps the machine-wide answer, and Global, for a read with no root')` — same payload,
   `skill({ref:'a',team:'acme'})` → `scope:'Global'`, `path:'/home/.claude/skills/a'`, `owningRoot:null`,
   `root:'Global'`. Pins today's deep-link behaviour so the fix cannot silently move it.
9. `it('prefers Global by rule, not by the order the CLI emitted its sections')` — the same payload with the two
   sections **reversed**; the unscoped read still answers `scope:'Global'` and the Global path. **Fails today**
   (today the answer flips to `ops`).
10. `it('lists every project as an install destination even when presence is scoped')` — `twoCopies()`,
    scoped to `/work/ops` → `installScopes` is `[['Global','every session · ~/.claude/skills'],['ops','project · /work/ops']]`
    and `installScopePaths` is `{ops:'/work/ops'}`. Same assertion for `localSkill({path:'/home/.claude/skills/a'})`,
    whose destinations must also be whole. **Fails today for `localSkill`** (RC-6 truncates it to `['Global']`/`{}`).
11. `it('reports a scoped read as absent when that root holds no copy, borrowing neither the ledger nor the people file')` —
    a payload with the copy **only** in Global plus a second, empty project section `/work/ops`;
    `inventoryBridge({local, ledger:[{id:'id-a',team:'acme'}]})` and an `installedBy` entry whose handle is the
    viewer's (`mira` in `lsRow`); scoped to `/work/ops` → `installed:'absent'`, `placed:false`, `path:null`,
    `owningRoot:{id:'/work/ops',label:'ops'}`. The same read **unscoped** → `installed:'placed'`.
12. `it('resolves a scoped read whose payload is spelled with Windows separators')` — `twoCopies` rebuilt with
    `String.raw`C:\Users\t\Projects\terum`` as the repo root and backslash row paths; `at:{kind:'checkout',root:String.raw`C:\Users\t\Projects\terum`}`
    → `scope` is the section's label and `owningRoot.id` is that root verbatim.
13. `it('resolves a scoped read on a WSL UNC root')` — same, with `String.raw`\\wsl.localhost\Ubuntu\home\teniroo\Projects\terum``.
14. `it('resolves a scoped read whose URL root carries a trailing separator the payload does not')` —
    `at:{kind:'checkout',root:'/work/ops/'}` against the `/work/ops` section. Guards the `samePath` boundary.
15. `it('resolves a project section that reports no repoRoot')` — a project section with `root:'/work/ops/.claude/skills'`
    and **no** `repoRoot`; `at:{kind:'checkout',root:'/work/ops/.claude/skills'}` matches it.
16. `it('resolves a scoped read for a checkout the CLI only detected, never registered')` — the project section with
    `registered:false, detected:true` (the live shape on this machine). **This is RC-3**; it must resolve.
17. `it('answers machine-wide, and names no root, when the requested root is not in the scan')` —
    `at:{kind:'checkout',root:'/gone'}` → the Global answer with `owningRoot:null`. Guards D17: never a fabricated absence.
18. `it('maps a global scope to the global section')` — `at:{kind:'global'}` → `owningRoot:{id:'Global',label:'Global'}`,
    `scope:'Global'`.
19. `it('names the owning root on a by-path local detail and on the bare-name fallback')` — extend the existing
    `unsharedLocal` fixtures: `localSkill({path:'/work/ops/.claude/skills/codex-implement'})` (a `notOffered`,
    `invalid-yaml` entry in a project section) → `owningRoot:{id:'/work/ops',label:'ops'}`; and
    `skill({ref:'shared-name',team:'acme'})` over the two-root payload at line 320-326 → `owningRoot:{id:'Global',label:'Global'}`.
    **Fails today** (the field does not exist).
20. `it('scopes a bare-name local fallback to the root it was given')` — the two-root `shared-name` payload,
    `skill({ref:'shared-name',team:'acme',at:{kind:'checkout',root:'/work/ops'}})` → `path:'/work/ops/.claude/skills/shared-name'`,
    `owningRoot:{id:'/work/ops',label:'ops'}`. **Fails today** (Global wins by fiat).
21. `it('does not name a folder in another root as the unidentified local copy of a scoped read')` — `fakeBridge`
    emits no `hello` frame (`desktop/src/backend/tauri/__tests__/fake-bridge.ts` has no hello handling), so every
    `inventoryBridge` test already runs with `localIdentity:false` — the older-CLI shape `unidentifiedLocal` needs.
    Arrange an untracked, same-named folder in the Global section, a `/work/ops` project section holding nothing, and
    a team row named `a`; read scoped to `/work/ops` → `unidentifiedLocal` is `null`. The same read **unscoped** →
    `unidentifiedLocal` names the Global folder. Guards D14: presence claims never leave the root the page describes.
22. `it('resolves a local path whose URL spelling differs only by separators from the payload')` —
    `localSkill({path:String.raw`\home\.claude\skills\a`})` against the default `/home/.claude/skills/a` payload → resolves.
23. `it('keeps a failed ls --local unreadable even when a root was named')` — `at` supplied and the `ls --local` frame
    failed (`ok:false,error:'EACCES: permission denied, scandir …'`) → `{ok:false,reason:'unreadable'}` with the CLI's
    own message. Guards the EACCES failure mode.
24. **Add a Windows sibling of the existing `it('marks a shared row Missing only when a scanned root should hold its source')`
    at line 258** — `it('marks a shared row Missing on a Windows-shaped payload too')`: the same `statusReplay` amendment,
    with the section root and the source spelled with backslashes → the state is `'Missing'`, not `'—'`. **Fails today**
    (RC-7). Do not modify the existing POSIX test; add the new one beside it.

### 7.3 NEW + MODIFIED — `desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx`

This file drives the **real** `App` over the **real** tauri adapter with the recorded frames
(`detailReplay`, `desktop/src/backend/tauri/__tests__/skill-detail-replay.ts`). The recording's `ls --local`
(`.planning/codex-runs/mock-vs-real-2026-09-09/frames/ls-local.jsonl`) holds a Global section
(`/Users/teddy/.claude/skills`, one placed `deploy-check`) and a project section
(`/Users/teddy/code/seed`, label `seed`, `registered:false, detected:true, rootState:'absent'`, no rows). The existing
test at line 146 already shows how to move the row into the project section by amending the frame.

**MODIFIED — lines 62-71** `it('renders a not-found board with the raw error and no Remove action')`. Reason: the
board's body, primary, secondary and the adapter's sentence all change (RC-5, D9). New body:

```ts
it('renders a not-found board that offers the library first and the marketplace second',async()=>{
  open('#/skill/nope');
  expect(await screen.findByText("Couldn't find nope")).toBeVisible();
  expect(screen.getByText('No team skill and no folder terum-skills can open carry this name. It may have been renamed, be a symlink, or live in a checkout that is not registered.')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('No skill named nope is shared in team acme, and no readable folder of that name is in your Library roots.');
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  expect(screen.queryByRole('button',{name:'Open marketplace'})).toBeNull();
  expect(screen.getAllByRole('button',{name:'Back to library'})).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Search the marketplace'}));
  await waitFor(()=>expect(location.hash).toBe('#/marketplace?q=nope'));
});
```

New tests in the same file:

25. `it('names the checkout in the crumb and the sidebar when a UNC payload holds the folder')` — amend `ls-local` so
    the project section is `root:String.raw`\\wsl.localhost\Ubuntu\home\teniroo\.claude\skills``,
    `repoRoot:String.raw`\\wsl.localhost\Ubuntu\home\teniroo``, `label:'teniroo'`, `rootState:'scanned'`, holding an
    untracked row `adopt-agent-tooling`; open `#/skill/local?path=<that row's path, encodeURIComponent'd>`. Assert the
    crumb text is exactly `teniroo/adopt-agent-tooling` (the duplicate `teniroo` is deduped by D6) and that the
    sidebar link named `/^teniroo/` carries `aria-current="page"`. **Fails today**: `Global/teniroo/local`, Global selected.
26. `it('keeps the same answer when the identical payload uses POSIX separators')` — the control for 25, with `/`
    spellings. Passes today and must keep passing.
27. `it('opens a folder the CLI could not parse, by path, and still names its checkout')` — the same UNC section with a
    `notOffered` entry (`reason:'invalid-yaml'`) instead of a row.
28. `it('sends the folder, not the route segment, to validate')` — open the UNC by-path detail, then
    `const validate=vi.spyOn(backend,'validate')` (the helper returns `backend`; the spy is installed before the
    click, exactly as the existing tests at lines 112-137 do). An untracked local folder takes `localSkill`'s
    non-joined branch, which issues **no** validate of its own, so the spy sees exactly one call. Click `Validate` on
    the Quality tab and assert it was called with `{ref:<the absolute UNC folder path>}`, never with `{ref:'local'}`.
    **Fails today** (`{ref:'local'}` → argv `['validate','--','local']`). Spying rather than reading `f.spawns` also
    avoids `detailReplay`'s recording lookup, which has no file for an arbitrary validate target.
29. `it('sends the skill name, not the route segment, to eval')` — the same page at `?tab=evals&dialog=run-eval`.
    **This test needs `EvalRunProvider`**: `desktop/src/app/eval-run-context.ts:9` defaults `start` to `()=>{}`, so a
    probe without the provider passes vacuously. `desktop/src/app/providers.tsx:22` includes it, but this file builds
    its own provider stack, so add `import { EvalRunProvider } from '../../../app/EvalRunProvider';` and wrap `<App/>`
    in the file's `open()` helper — the provider renders no DOM of its own until a run starts, so the file's other
    tests are unaffected; if any of them changes behaviour, add a separate local helper for this test instead. Then
    `vi.spyOn(backend,'eval')` returning a `createRun(...)` stub (`createRun` from `../../mock/run`, as
    `desktop/src/screens/skill/run-eval.test.tsx:28` does), click `Run eval`, and assert the spy was called with
    `{ref:'adopt-agent-tooling',commit:true}` — never `{ref:'local'}`. **Fails today** (`['eval','--commit','--','local']`);
    the recorded `hello` reports `runEvalInApp:true`, so this is a live path, not a latent one.
30. *(moved to §7.4 — see test 30 there: the preference switch needs `disablePerMachine`, which the recorded `hello`
    reports as `false`, so it can only be exercised on the mock backend.)*
31. `it('returns to the checkout library from a scoped page and from its error board')` — open
    `#/skill/deploy-check?root=<seed repoRoot>` with the row moved into the seed section, click the header
    `Back to library`, assert the hash is `#/library/checkout?root=%2FUsers%2Fteddy%2Fcode%2Fseed`. Then open
    `#/skill/nope?root=<seed repoRoot>` and assert the not-found board's `Back to library` lands on the same hash.
    **Fails today** (both land on `#/library/global`).
32. `it('renders the ambiguous board when two team ids share a prefix')` — amend the `ls` frame so two skills' ids both
    start with `ab` and open `#/skill/ab`. Assert the title `More than one skill matches`, the body, the alert text
    `2 team skills in acme have an ID starting with ab; open the one you want from the marketplace.`, and that
    `Open marketplace` is the primary. **Fails today** (renders the `unreadable` board telling the user to check
    Settings).
33. `it('removes the copy in the root the URL named')` — the row moved into the seed section, open
    `#/skill/deploy-check?root=%2FUsers%2Fteddy%2Fcode%2Fseed&dialog=remove`, confirm, and assert the spawn is
    `['uninstall-skill','--team','acme','--from','/Users/teddy/code/seed','--','deploy-check']`. Then the same skill
    placed in **both** roots, opened with the same `?root=`, still removes from `/Users/teddy/code/seed`.
    **Fails today** (`--from global`).
34. `it('keeps the by-path remove argv unchanged')` — a by-path page's Remove still spawns
    `['uninstall-skill','--team','acme','--','<name>']` with no `--from`. Pins the deliberate non-change in D20.

Do **not** touch the existing test at line 146-155 (`passes the selected %s copy to Remove`) — it is the unscoped
baseline and must keep passing byte-for-byte.

### 7.4 MODIFIED + NEW — `desktop/src/screens/library/library-skill.test.tsx` (mock backend)

**MODIFIED — lines 214-227** `it('never claims a missing folder or offers Sync/Remove when a name is not in the team')`.
Reason: line 226 asserts the CTA `Open marketplace`, which this batch replaces. Keep every other assertion; change the
final two to:

```ts
 expect(within(panel as HTMLElement).getByRole('button',{name:'Back to library'})).toBeVisible();
 expect(within(panel as HTMLElement).getByRole('button',{name:'Search the marketplace'})).toBeVisible();
 expect(within(panel as HTMLElement).queryByRole('button',{name:'Open marketplace'})).toBeNull();
```

**MODIFIED — lines 250-255** `it('selects the longest registered checkout for local details and uses its label in crumbs')`.
Reason: D5 deletes the screen's `status`-driven resolver, so a test that installs roots by spying on `status()` no
longer exercises anything. It is **replaced, not weakened**, by a test that drives the same assertion through the
mock's own roots (`mockRoots()` serves `/Users/you/code/{terum,ssm,mrf}` labelled Terum / SSM / MRF), and by
`skill-path.test.ts` cases 3-5 plus `index.test.ts` case 16, which cover longest-match, Windows and unregistered roots
where they now live:

```ts
it('names the checkout a local folder was resolved in, from the backend',async()=>{
 const backend=createMockBackend();
 openWith('#/skill/local?path='+encodeURIComponent('/Users/you/code/ssm/.claude/skills/deploy-check'),backend);
 await screen.findByRole('heading',{name:'deploy-check'});
 expect(screen.getByRole('link',{name:/^SSM/})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:/^Global/})).not.toHaveAttribute('aria-current');
 expect(document.querySelector('.detail-crumbs')).toHaveTextContent('SSM');
});
```

New tests in the same file:

35. `it('carries the checkout root from a project card into every menu row it links to')` — open
    `#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum`, find `skill-card-deploy-check`, assert its single link is
    `#/skill/deploy-check?root=%2FUsers%2Fyou%2Fcode%2Fterum`, then open the ⋯ menu and assert `Open`,
    `Run eval`, `Uninstall…` and `Move to…` all carry the same `root=` query. **Fails today** (`#/skill/deploy-check`).
36. `it('keeps Global-library and marketplace card links exactly as they were')` — `/library/global` →
    `href="#/skill/deploy-check"`; `/marketplace/people/lena` → `href="#/skill/a11y-audit?root=marketplace"`.
    Guards D12 and `card-click.spec.ts:29`.
37. `it('names the project in the crumb, the sidebar and the back arrow of a scoped page')` — open
    `#/skill/deploy-check?root=%2FUsers%2Fyou%2Fcode%2Fterum`; assert the crumb starts `Terum`, the sidebar row
    `/^Terum/` is `aria-current="page"`, the Global row is not, and clicking the header `Back to library` lands on
    `#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum`.
38. `it('says Remove from the project, not from Global, on a scoped page')` — the same URL with `&dialog=remove`;
    assert the dialog title is `Remove deploy-check?` and its description contains `Remove from Terum.`, and that the
    trash button's `aria-label` is `Remove from Terum`. **Fails today** (`Remove from Global`).
39. `it('keeps the Marketplace crumb and back arrow on the not-installed board')` — open
    `#/skill/deploy-check?__mock=not-installed` (no `root=`), assert the crumb starts `Marketplace`, the sidebar
    Marketplace row is current, and the back arrow goes to `#/marketplace`. Guards D3 and the three locked boards.
40. `it('preselects Global in the install dialog whatever the origin')` — `#/skill/deploy-check?__mock=not-installed&dialog=install`
    and the same route with `&root=%2FUsers%2Fyou%2Fcode%2Fterum`; in both, the checked radio is
    `Global · every session · ~/.claude/skills` and there are four radios. Guards D21 (the limb that was dropped) and
    board parity.
41. `it('follows a moved copy to its destination from a scoped page and stays put from an unscoped one')` — spy
    `install`/`uninstallSkill` as the existing move test at line 21 does; from
    `#/skill/deploy-check?root=%2FUsers%2Fyou%2Fcode%2Fterum&dialog=move` pick `SSM` and confirm → the hash becomes
    `#/skill/deploy-check?root=%2FUsers%2Fyou%2Fcode%2Fssm`; from `#/skill/deploy-check?dialog=move` the hash stays
    `#/skill/deploy-check`. Guards D22.
42. `it('leaves a cancelled move on the page it started from')` — spy `install` to return
    `{ok:false,cancelled:true,error:'…'}` (use `createRun` as line 41 of this file does); from the scoped move dialog,
    confirm → the hash keeps its `root=` param, `uninstallSkill` was never called, and the error line reads
    `Move cancelled; nothing was changed.` Failure-mode coverage for cancel.
30. `it('keeps preference keys on the skill, not on the route segment')` — the mock reports
    `disablePerMachine:true` (`desktop/src/backend/mock/index.ts:106`), so the rail switch is drawn. Open
    `#/skill/local?path=` + `encodeURIComponent('/Users/you/code/ssm/.claude/skills/deploy-check')`, toggle the rail
    switch, and assert `localStorage.getItem('terum-skills-app:pref:enabled:deploy-check')` is `'false'` while
    `localStorage.getItem('terum-skills-app:pref:enabled:local')` is `null`. **Fails today** (the key is
    `…:enabled:local`, shared by every by-path detail).
    *(This is the test listed as 30 in §7.3; it lives here because only the mock reports `disablePerMachine:true`.)*
43. `it('keeps the checkout crumb on a scoped page whose read failed')` — spy `skill` to resolve
    `{ok:false,error:"EACCES: permission denied, scandir '~/.terum/skills'",reason:'unreadable'}`; open the scoped URL
    and assert the crumb still starts `Terum`, the sidebar Terum row is current, and `Back to library` lands on the
    checkout Library. Guards the EACCES/error path of D5 (the URL, not `s`, carries the origin when `s` is absent).

### 7.5 MODIFIED — `desktop/src/components/domain/skill-card-actions.test.ts`

No change to the module's behaviour, so no test changes. Add one:

44. `it('rides a checkout origin exactly as it rides the marketplace one')` —
    `cardActions(card(),{origin:'root=%2FUsers%2Fyou%2Fcode%2Fterum'})` → the `open` row is
    `/skill/deploy-check?root=%2FUsers%2Fyou%2Fcode%2Fterum` and the `place` row appends
    `?dialog=remove&root=%2FUsers%2Fyou%2Fcode%2Fterum`. And the local-folder card
    (`{teamed:false,path:'~/.claude/skills/notes'}`) does **not** ride it, as it does not ride `root=marketplace` today.

### 7.6 NEW — `desktop/e2e/routes/card-click.spec.ts`

Append one Playwright test, in the file's own style:

```ts
test('project card click keeps the checkout root, crumb and sidebar',async({page})=>{
 const errors=await openCards(page,'#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum');
 await clickBody(page,page.getByTestId('skill-card-deploy-check').locator('.skill-card-desc'));
 await expect(page).toHaveURL(/#\/skill\/deploy-check\?root=%2FUsers%2Fyou%2Fcode%2Fterum$/);
 await expect(page.getByRole('link',{name:/^Terum/})).toHaveAttribute('aria-current','page');
 await expect(page.locator('.detail-crumbs')).toContainText('Terum');
 expect(errors).toEqual([]);
});
```

That route serves 8 cards on the mock (`desktop/e2e/routes/collapse.spec.ts:90` and `scroll.spec.ts:33` both use it).
Do not change `card-click.spec.ts:29` or `:69` — they pin the Global and marketplace URLs (D12).

### 7.7 Failure modes covered, and one that is not

| mode | test |
|---|---|
| cancel (a move refused mid-run) | 42 |
| permission error (EACCES from `ls --local`) | 23, 43 |
| missing tool / older CLI (`localIdentity` off, no `local` key, no `repoRoot`) | 15, 21 |
| Windows / WSL UNC paths | 3, 12, 13, 24, 25, 26, 27 |
| stale or hand-typed root | 17 |
| an ambiguous label two checkouts share | 33 (second half) + D20's code path |
| timeout | **not modelled.** The bridge (`desktop/src/backend/tauri/bridge.ts`) has no read timeout at 9fb73e9; adding one is another batch's contract (`RefreshOptions.deadlineMs`, C1, owned by w08-refresh-receipts). This batch adds no timeout and must not invent one. |

---

## 8. Gates

Run in this order, from the worktree root. Report **real** numbers.

```
cd desktop && npm run typecheck
cd desktop && npm run lint
cd desktop && npm test
cd desktop && npm run build
cd desktop && npm run e2e:routes
```

- Run **one battery at a time**. Two concurrent vitest/Playwright batteries thrash this box into spurious timeouts.
- `npm run e2e:fidelity` needs the private design canvas (`TERUM_DESIGN_DIR`), which Codex does not have. It will skip
  or fail with a one-line message. **Say so; do not fake a result.** The orchestrator runs it.
- `cargo` cannot run here. Nothing in this batch touches `desktop/src-tauri/**`, so there is nothing for it to check;
  the orchestrator still runs `cargo check` for aarch64-apple-darwin / x86_64-pc-windows-msvc / aarch64-pc-windows-msvc.
- The root CLI gates (`npm run lint && npm run typecheck && npm test` at the repository root) are **not needed**: this
  batch changes no file outside `desktop/`. Run them only if you touched something at the root — and you must not.
- No `npm install`, no `npm ci`, no git commands of any kind, no commits, no staging.
- **Baseline:** the spec author could not measure a pre-existing baseline (a gate battery was running in the primary
  checkout, which is read-only for spec work). If a failure looks pre-existing, name the test file and title in the
  report and state why you believe it predates this change — do not "fix" an unrelated test to make a suite green.
- `npm run export:check` is the maintainers' gate (`desktop/AGENTS.md` invariant 8). This batch edits neither
  `src/fixtures/design.json` nor `src/styles/tokens.css`, so it must pass unchanged; do not run it.

**Files an implementing agent must never edit** (`desktop/AGENTS.md` invariant 2): `desktop/GAPS.md`,
`desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`, `desktop/src/styles/tokens.css`,
`desktop/src/fixtures/design.json`, anything under `.shots`. Two of them are stale in ways this batch touches — see §10.

---

## 9. Windows verification

Nothing below can be verified on Linux; every one of them is the point of the batch.

**What could not be verified here.** That the CLI on Windows actually emits backslash paths in its JSON frames. The
code builds every emitted path with `node:path.join` (`src/lib/placer/agent-paths.ts:11-12`,
`src/lib/local-skills.ts:121`) and `node -e "path.win32.join(…)"` yields `C:\…\.claude\skills\x` and
`\\wsl.localhost\…\x`, and the app's predicate was driven with exactly those strings — but the CLI itself was never
run on Windows. Also unverified: the real pixels on Teddy's machine, and a real two-copy team skill end to end (there
is no configured team on the author's box: `~/.terum/skills/config.json` is absent).

**Falsifier commands for the reporter (Windows 11 x64, WSL UNC roots).**

1. `node dist/index.js --frames ls --local` in a shell on the Windows side. Read `local[].root`, `local[].repoRoot` and
   `local[].rows[].path`. If they carry `\` (and `\\wsl.localhost\…` for the WSL roots), RC-2 is confirmed as the
   mechanism; if they carry `/`, RC-2 never fired on his machine and this batch's Windows half is inert (but harmless).
2. In the app, open **Projects ▸ <his checkout>** in the sidebar and click a skill card.
   * The URL must read `#/skill/<name>?root=<his checkout root, percent-encoded>`.
   * The breadcrumb's first part must be the **project's** label, not `Global`.
   * The sidebar must keep the **project** row highlighted, not Global.
   * The back arrow must return to that project's Library, not to Global.
3. On that page, open the ⋯/trash affordance: the button's tooltip must read `Remove from <project>`, and the dialog
   must say `Remove <name>? Remove from <project>. Its files leave <the project's path>…`. **No Install button may
   appear for a skill that is installed** — that is the second half of W-04 ("install is mistaken").
4. Open a folder in that checkout that belongs to no team (an untracked one) from the same Library. The breadcrumb's
   last part must be the **folder's name**, never the word `local`. On the Quality tab press **Validate**: it must
   report hygiene, not `…\teams\<team>\skills\local is not a skill folder.`
5. On the Evals tab of that same folder press **Run eval** (the CLI reports `runEvalInApp:true`). The run must be for
   the folder's name; it must not fail with `No skill named or identified by local exists in team <team>.`
6. Deep-link a name that is in neither the team nor a readable Library folder (`#/skill/no-such-skill`). The board must
   be titled `Couldn't find no-such-skill`, the primary must be **Back to library**, the secondary
   **Search the marketplace**, and the alert beneath must read
   `No skill named no-such-skill is shared in team <team>, and no readable folder of that name is in your Library roots.`
7. Open **Settings ▸ Sharing**. A shared source that sits under a scanned root but is no longer on disk must read
   **Missing**, not **—** (RC-7).

---

## 10. Out of scope / do not touch

| item | why |
|---|---|
| The CLI (`src/**` at the repository root), `docs/frame-protocol.md`, `src/lib/frames.ts` | No new verb, no new feature key, no changed field meaning (D23). `FRAME_VERBS`, `FRAME_FEATURES` and `FEATURE_KEYS` are untouched, so cross-batch contract C2 does not bind this batch. |
| `desktop/src/backend/tauri/index.ts:261` (`normalizePath(row.path)===normalizePath(item.source)`) | Both sides come from the same `status` payload; not URL-supplied, no bug behind it. |
| Symlinked folders getting no card (`countable()` at `tauri/index.ts:95` excludes `'symlink'`; 13 of 45 entries in Teddy's global root) | A product decision about what the Library draws, not a routing bug. This batch only makes the not-found copy **true** for them (§5). File separately; do not widen `countable()` here. |
| `InstallArgs.scope` carrying a label rather than a root (`tauri/index.ts:650-657`, "Unknown install destination") | A seam change with its own blast radius. D20 fixes the destructive half (removal) using `owningRoot`; the install half stays as it is because no reachable flow offers Install from a project card (D21). |
| The install-scope radio default | D21: unreachable on the real adapter, and a design-visible default that is Teddy's call (`desktop/AGENTS.md` invariant 8). |
| Showing "also in <other root>" when a bare name exists in two roots | New design surface, no board draws it (`desktop/FIDELITY.md`), invariant 8 forbids an implementing agent resolving it. |
| `desktop/FIDELITY.md` | Maintainer-owned. **No row moves.** No locked board's route carries `root=<path>` (`grep -c "root=" desktop/e2e/fidelity/boards.ts` → 0; `desktop/FIDELITY.md` → 0), every SkillDetail board is `#/skill/deploy-check…` and every Library board is `#/library/global…`. The orchestrator has nothing to flip. |
| `desktop/GAPS.md` | Maintainer-owned, and **stale in two places this batch brushes**: `:42` says *"`InstallArgs` has no `scope`"* (false — `tauri/index.ts:650-658` resolves the label to a repo root and passes `--into`), and `:66` says the Library title uses the CLI's `counts.skillFolders` (false — `tauri/index.ts:542` is `const n=skills.length`). **The orchestrator should correct both.** Codex must not edit the file. |
| `desktop/src/backend/tauri/README.md:17` | Says *"`install.scope` … not passed"* — stale for the same reason. Maintainer-owned; flag, do not edit. |
| `desktop/src/fixtures/design.json`, `desktop/src/styles/tokens.css`, anything under `.shots` | Generated / read-only oracle (invariants 3 and 4). |
| `desktop/package.json`, root `package.json`, either lockfile | No dependency changes; C8 — no batch bumps a version. |
| `desktop/src/screens/library/LibraryScreen.tsx`, `Sidebar.tsx`, `Shell.tsx`, `routes.tsx` | Already correct: they emit and consume `?root=<root.id>` exactly as this batch needs. Reuse, do not duplicate. |

---

## 11. Cross-batch contracts and merge-conflict watch list

The orchestrator merges in this order:
`w07-library-header → w08-refresh-receipts → w06-eval-lock → **w03w04-skill-routing** → w05-skill-markdown → sidebar-spacing → setup-discover-evals → w02-perf → w01-app-update`.

**C1 `refreshClone` (`src/lib/teamRepo.ts`)** — **not used by this batch.** No file under the repository root `src/` is
touched. For the record, the shared interface every batch that does touch it must declare, identically:

```ts
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
```

with `refreshClone` taking it as ONE optional trailing parameter, `w06-eval-lock` owning `lockWaitMs`/`onWaiting`,
`w08-refresh-receipts` owning `deadlineMs`, other fields accepted and ignored, and the positional parameters never changed.

**C2 `FRAME_VERBS` / `FRAME_FEATURES` / `FEATURE_KEYS`** — **not used by this batch** (D23). For the record, the
ordering every batch that does touch them must honour: new verbs appended at the END of `FRAME_VERBS`
(`src/lib/frames.ts:32`) in the order `'refresh'` (w08), `'checkout discover'` (setup-discover-evals), `'app-update'` (w01);
new `FRAME_FEATURES` keys (`src/lib/frames.ts:39-44`) appended at the END in the order `refresh: true` (w08),
`discover: true` (setup-discover-evals), `appUpdate: true` (w01), with w02-perf flipping the existing
`progress: false` → `true`; desktop `FEATURE_KEYS` (`desktop/src/backend/types.ts:12`) appended in the same order, the
mock answering `true` and the real adapter reading `hello.features.<key>` with a missing key = `false`.

**C3 `src/cli.ts`** — not used. No new top-level command.

**C4 real adapter `desktop/src/backend/tauri/index.ts`** — **this batch OWNS the in-place rewrite of `skill()`
(`:573-603`) and of `inventoryDetail` (`:183-202`)**, plus `localDetail` (`:120-123`), `localSkill` (`:548-570`),
`library()`'s section lookup (`:526`) and the Settings shared-source predicate (`:262`). It adds three module-private
helpers after `rootOf` (`:91`) and creates **no new module** in `desktop/src/backend/tauri/`. w02-perf must NOT
restructure `skill()` beyond wrapping independent spawns in `Promise.all`; the orchestrator re-applies that
parallelisation on rebase. w08 → `refresh.ts`, w02-perf → `concurrency.ts`, w01 → `app-update.ts`,
setup-discover-evals → the `discover` seam method: none of those files exists here and none is touched.

**C5 `desktop/src/screens/skill/SkillScreen.tsx`** — this batch owns the crumb/root/not-found edits listed in §4.8.
w05 adds the markdown component, w08 adds `HistoryRail` in the not-evaluated state, w02-perf adds progress lines. Every
edit here is local to the JSX or the `const` it changes; **the file is not reformatted**. The lines this batch
rewrites are 51 (`removeFrom`), 61-64, 66, 68, 88, 107, 111, 112, 113, 115 — plus one new module-level function
(`libraryPath`) inserted after `removeFrom`.

**C6 `desktop/src/screens/skill/RunEvalDialog.tsx`** — this batch changes only the `ref` derivation (lines 2, 16-17, 25).
w06-eval-lock adds "Run eval again" elsewhere in the same file. Local edits only; no reformat.

**C7 `desktop/src/app/LaunchCoordinator.tsx`** — not touched.

**C8 versions** — no `version` bump in either `package.json`. The orchestrator bumps 0.1.10 → 0.1.11 last.

**C9 tests** — every change adds tests beside the code it changes. Four existing tests are **modified**, each named
with its reason in §7: `index.test.ts:327-330`, `index.test.ts:331-339`, `skill-detail-screens.test.tsx:62-71`,
`library-skill.test.tsx:214-227` (copy changes), and `library-skill.test.tsx:250-255` (**replaced**, because D5 deletes
the code it exercised; its coverage moves to `skill-path.test.ts` 3-5, `index.test.ts` 16 and the replacement test).
No test is deleted or weakened.

**Merge-conflict watch list** (files this batch changes that other batches also touch):

| file | also touched by | note |
|---|---|---|
| `desktop/src/backend/tauri/index.ts` | w08, w02-perf, w01, setup-discover-evals | They add new modules; this batch's edits are confined to `:91`, `:120-123`, `:183-202`, `:262`, `:526`, `:548-570`, `:573-603`. Expect line-number drift, not overlapping edits. |
| `desktop/src/backend/types.ts` | every batch adding a `FEATURE_KEYS` entry | This batch edits line 2 (reason union) and inserts one member into `SkillDetail`; it does **not** touch `FEATURE_KEYS` or `SkillCard`. |
| `desktop/src/screens/skill/SkillScreen.tsx` | w05, w08, w02-perf (C5) | Dense single-line file: any overlapping edit is a textual conflict with no useful 3-way merge. Merge this batch before w05 per the stated order. |
| `desktop/src/screens/skill/RunEvalDialog.tsx` | w06-eval-lock (C6) | w06 merges first; rebase on it. |
| `desktop/src/components/domain/SkillCard.tsx` | — | Only this batch, at 9fb73e9. |
| `desktop/src/backend/mock/index.ts`, `mock/data.ts` | setup-discover-evals, w08 | Different regions. |
| `desktop/src/screens/library/library-skill.test.tsx`, `desktop/src/backend/tauri/__tests__/index.test.ts`, `skill-detail-screens.test.tsx` | several | Test files; conflicts are additive. |
| `desktop/e2e/routes/card-click.spec.ts` | — | One appended test. |

---

## 12. PR

**Title** (conventional, 61 chars): `fix(desktop): open the skill copy the reader clicked`

**Body outline**

* **What.** A skill detail page now describes the copy in the Library root the reader came from, and never treats the
  URL segment as the skill. Closes Bugs.pdf W-03 ("Unable to find listed skills (ambiguity issue)") and W-04
  ("Clicking on project skill redirects back to Global tab → install is mistaken").
* **Why.** Three stacked defects: a teamed card is addressed by bare name, so `skill()` answers machine-wide and the
  CLI's global-first section order wins (`tauri/index.ts:184-185`, `src/lib/local-skills.ts:49`) — the page's `Edit`,
  `Remove from …` and #131's `Move to …` then act on the **Global** copy; the by-path route resolved its checkout with
  a POSIX-only `root + '/'` prefix test (`SkillScreen.tsx:63`), which is `false` for every Windows and WSL-UNC path, and
  additionally required `registered`, which a cwd-detected checkout is not; and the route segment `local` was being sent
  to the CLI as the skill's name by `validate` and `eval`, and used as the preference key.
* **How.** `SkillDetail.owningRoot` reports the root the backend resolved. Teamed cards in a project Library carry
  `?root=<repo root>` — the same value the sidebar and `/library/checkout` already use — and `Backend.skill({at})`
  restricts *presence* to that section while *destinations* still come from the whole machine. `SkillScreen` drops its
  root resolution entirely (no path arithmetic in a screen: `desktop/AGENTS.md` invariant 1); one helper module,
  `src/lib/skill-path.ts`, now owns separator-insensitive comparison and is used at the four sites that had three
  different spellings, including the same one-character bug on Settings ▸ Sharing (`tauri/index.ts:262`). The name
  route's error state splits: `not-found` offers **Back to library** / **Search the marketplace**, and a real ID-prefix
  collision gets its own `ambiguous-ref` board instead of being reported as "unreadable".
* **A note for Ryan.** On `main` today, #131's **Move to…** from a project card places into the destination and then
  removes the **Global** copy — `dialogCopy('move')` and `removeFrom()` both read `s.scope`, which is precisely the
  field this PR corrects. That makes this a prerequisite for #131 being safe, not merely adjacent to it.
* **How verified.** `cd desktop && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e:routes`,
  real counts reported. `npm run e2e:fidelity` needs the private design canvas and was not run by the implementing
  agent. **Expected fidelity delta: zero** — no locked board's route carries `root=<path>`
  (`grep -c "root=" desktop/e2e/fidelity/boards.ts` → 0, `desktop/FIDELITY.md` → 0), every SkillDetail board is
  `#/skill/deploy-check…`, `owningRoot` is `null` on every mock board so the Marketplace crumb keeps coming from
  `s.root`, and none of the new strings is in `src/fixtures/design.json`.
* **Windows notes.** The three Windows-only defects (crumb root, sidebar selection, root attribution) all came from one
  expression, now deleted. UNC paths already round-trip `encodeURIComponent` → `useSearchParams` losslessly; the
  encoding was not changed. §9 of the spec lists the seven falsifier steps for the reporter.
* **Protocol.** No CLI change, no new verb, no new `hello.features` key, no changed field meaning: `hello.protocol`
  stays 1.

---

## 13. Open questions — each with the default the implementer MUST take without asking

**OQ1 — Should Install from a project card preselect that project?** *Default: no; the radio stays `useState('Global')`
(D21).* Unreachable today on the real adapter and a design-visible default. For the maintainer: it becomes reachable
the day a project-scoped Install exists (#134's "add a skill to a project" direction) or if a reader hand-types a
`?root=` naming a root that does not hold the skill. Teddy's call.

**OQ2 — Should the detail page say "also in <other root>" when a bare name resolves in more than one root?**
*Default: no.* No board draws it; invariant 8 forbids an implementing agent inventing the surface. The crumb now names
the root that was chosen, which is the honest minimum.

**OQ3 — Symlinked folders get no card, no name resolution and no path resolution** (`countable()`,
`tauri/index.ts:95`) — 13 of the 45 entries in Teddy's global root, and skills he uses by name. *Default: out of scope;
file separately.* This batch only guarantees the not-found copy is **true** for them.

**OQ4 — A hand-typed `?root=` with different casing, or naming a root the scan no longer reports.** *Default: ignore
`at` and answer machine-wide with `owningRoot:null` (D17)* — today's unscoped behaviour, no error state, no new board.

**OQ5 — Should a scoped read consult the status ledger with a path filter, rather than not at all?** *Default: not at
all (D15).* Doing it properly needs `path`/`scope` on `cliStatusTeams.ledger.placements`
(`desktop/src/backend/tauri/index.ts:65`, today `{id,team}.passthrough()`) — a schema widening that deserves its own
change. A root that can be named in a URL came from an `ls --local` section by construction, so the scan covers it.

**OQ6 — `desktop/GAPS.md:42` and `:66`, and `desktop/src/backend/tauri/README.md:17`, are stale** (§10). *Default:
flag, do not edit* (invariant 2). For the orchestrator to correct.

### Corrections to the batch brief and the input reports (the code at 9fb73e9 wins)

**B1 — the brief says `owningRoot` is "filled only for local resolutions; null in inventoryDetail/mock".** This spec
fills it for a **scoped** `inventoryDetail` as well (D2). Without that, the screen would have to resolve the checkout
from `?root=` against `status().roots` itself — reintroducing the exact path arithmetic that produced RC-2 and RC-3.
It is still `null` for every unscoped read and on every board, so the fidelity argument is unchanged.

**B2 — the W-03 triage's "deleting SkillScreen's `status` query removes a duplicate CLI spawn" is false.**
`desktop/src/components/domain/Shell.tsx:23` already issues `useQuery({queryKey:['status',state.mock],…})`
unconditionally, and `SkillScreen` renders inside `<Shell>`; identical keys share one React-Query cache entry. The
query is deleted because the screen no longer needs roots (D5), not to save a spawn. The triage's related citation of
ledger decision D9/S7w ("never poll") does not apply to a one-shot `useQuery` either; the governing rule is
`desktop/AGENTS.md` invariant 1.

**B3 — the W-03 triage's F1 would have broken three locked boards.** It replaced the `s?.root` term outright;
`desktop/src/backend/mock/index.ts:118` sets `root:'Marketplace'` for the `not-installed` scenario and
`SkillDetailNotInstalled` / `SkillDetailInstall` / `SkillDetailInstallLight` reach it with no `?root=` param. D3 keeps
the term. (Independently reached by two of the three verifiers.)

**B4 — the W-03 triage's F3 (`validate({ref: s?.path ?? s?.name ?? ref})` for all routes) would regress team skills.**
`s.path` is non-null for an installed team skill. D7 scopes the path form to the by-path route only.

**B5 — the W-03 triage's F5 ("route every card that has a path by path") is dropped.** On the real adapter
`inventoryCard` returns `path:null` for every teamed card (`tauri/index.ts:174`), so the rule could not fire; on the
mock `library()` gives **every** card a path (`mock/index.ts:111`) and `cardOf` sets `teamed: s.project!=='local'`
(`mock/data.ts:11`), so it would flip 13 of 15 mock Library cards onto `/skill/local?path=…`, where mock `localSkill`
forces `team:null` and `skillRef:'local:'+path` — a backend behaviour split (invariant 7) and a break of
`card-click.spec.ts:29`. The `?root=` mechanism (D11) fixes the same symptom without touching any Global-library URL.

**B6 — the W-04 triage's "install is mistaken → the copy lands in Global" limb is not reachable on the real adapter.**
`library()` only builds a card for a row that is in that section (`tauri/index.ts:532`), so `installed` is always
`'placed'` and neither the card menu nor the detail page offers Install. Teddy's phrase is an accurate description of a
mis-**uninstall** and of a page that reports the wrong copy's state. D21 drops the limb; D20 fixes the destructive half.

**B7 — the W-04 triage's `installScopes` truncation claim is narrower than stated.** Restricting to the *checkout*
section keeps that project in `installScopes`; only sections **other than** the restricted one are lost. The fix (D14)
is still required, and becomes load-bearing the moment teamed reads become scoped, which is what this batch does.

**B8 — the W-04 triage's `tauri/index.ts:262` claim is narrower than stated.** `row!==undefined` short-circuits to
`'Present'` first at `:263`, so the Windows defect is "every source Terum cannot match to a scanned row reads `—`
instead of `Missing`", not "every source reads `—`".

**B9 — line numbers.** The W-03 and W-04 triage reports and all six verdicts were written against `cb67012` (and one
against `d369b3e`). At 9fb73e9 the adapter's lines have shifted by +1 to +2 (`skill()` starts at `:573` not `:573`
in one report and `:574` in another; `inventoryDetail` at `:183`; the error string at `:592`; the Settings predicate
at `:262`). **Every line number in this spec was re-read at 9fb73e9.** In particular, `SkillCard.tsx`'s `detailUrl`
no longer exists — #131 moved it to `desktop/src/components/domain/skill-card-actions.ts:10-12` as `detailPath`, and
`cardActions` already threads `origin` with `ridesOrigin=skill.teamed||!skill.path`, so the card-side change is the
single `origin` expression in §4.7 and nothing in `skill-card-actions.ts` needs to change.

**B10 — the brief's "invalidate/redirect the scoped key after a move" is implemented as a redirect, not an
invalidation** (D22), and only on a scoped page. An invalidation alone would re-render the same false
"Installed · not on this machine" that D15's honest-absence rule produces for the root the copy just left.
