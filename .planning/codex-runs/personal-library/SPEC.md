# Personal Library v2 — rebuild of PR #88 on main (67f1f57)

Worktree: `/Users/ryanliu/Documents/Terum/skill-management-software-wt-library2`, branch `feat/personal-library-v2`, base `origin/main` @ 67f1f57 (includes #82 installed state, #83 eval-in-app, #84 collapse/derived counts, #85 checkouts CLI, #87 install destinations). Every file:line below is on that worktree. Desktop only; **no edits under `src/`** (the CLI is untouched) and no edits to `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`, `src/fixtures/design.json`, `src/styles/tokens.css` (maintainer-owned or generated).

Governing ruling (do not relitigate): `.planning/decisions/2026-09-09-library-model-decision-walk.md` — North Star "The Library is this machine's folders and the Marketplace is the team's packages". Ledger rows used here: **D1** registration = writes plus "Detected · not registered" rows with one-click Add, never a connect and never a grant; **D2** a Library row counts folders holding a `SKILL.md`, name-mismatched ones included and marked not connectable, label "skill folders"; **D5** `checkout remove` is registry-only, nothing on disk changes; **D7** the cwd repo is a labelled "not registered" section; **D11** the canonical root path travels in `?root=`, the folder name is only a label. Also: team projects are browsed under Marketplace ▸ Projects (already built); Marketplace ▸ Team ▸ Projects is Desktop-2 and is **not** built here.

Tier-2 review findings folded in (review of #88's diff, BUG 17 / BUG 19 "Missed"): **(a)** a per-folder error must never carry a button that forgets a whole checkout — the rebuilt local-detail error has no remove button at all; **(b)** a local-detail failure renders "Folder missing" only when the adapter reports a typed `not-in-library` reason, every other failure renders the honest generic board with the raw message; **(c)** registering a checkout is not sharing consent — no row's `connected`/`shared` state may change because a root was registered, and the Settings copy says so.

## 1. Contract on top of main

### 1.1 Types — `desktop/src/backend/types.ts`

- Line 2 `Result<T>`: extend `reason?:'no-team'|'ambiguous-team'` to `reason?:'no-team'|'ambiguous-team'|'not-in-library'`.
- Line 12 `FEATURE_KEYS`: append `'checkouts'` (the CLI's `hello.features.checkouts`, `src/lib/frames.ts:40`, is already `true`). Its single consumer is the registration affordance (Settings Add / detected-row Add).
- Line 15 `Surfaces`: add `checkouts:boolean` (real adapter `true`, mock `false` — the mock draws no Checkouts group because no board draws one; this keeps SettingsMachine / SettingsPrune pixel-identical).
- Line 22 `SkillCard`: add `path:string|null` (the on-disk folder this card represents; `null` for catalog/marketplace cards).
- Line 27 `SkillDetail`: add `path:string` to the intersection (the `Omit<Design['DETAIL'],keyof SkillCard…>` would otherwise let `SkillCard.path` widen it to `string|null`).
- New:
  ```ts
  export interface Root {id:string;kind:'global'|'checkout';label:string;root:string;rootState?:'scanned'|'absent'|'unreadable'|undefined;registered:boolean;detected:boolean;count?:string|undefined}
  export type LibraryScope={kind:'global'}|{kind:'checkout';root:string};
  export type LibraryTeam={kind:'ok';team:string}|{kind:'none'}|{kind:'unreadable';message:string};
  export interface CheckoutAdded {path:string;registered:boolean}
  export interface CheckoutRemoved {path:string;placementsRemaining:number}
  ```
  `Root.id` is the canonical root path for a checkout (`section.repoRoot`) and the literal string `'global'` for Global. `Root.root` is the folder the row stands for (the repo root for a checkout, `~/.claude/skills` — abbreviated — for Global). `Root.label` is the CLI's `label` (basename) and is display only (D11).
- Line 40 `Library`: remove `projects?`; add `root:Root` and `team:LibraryTeam`. Keep `scanned`, `skills`, `overview`, `title`, `provenance?`, `problems?`.
- Line 59 `StatusResult`: replace `projects:string[]|null` with `roots:Root[]`.

### 1.2 Seam — `desktop/src/backend/Backend.ts`

- Line 16: `library(q:{scope:LibraryScope;team?:string},options?):Promise<Result<Library>>`.
- Add `localSkill(q:{path:string},options?:ReadOptions):Promise<Result<SkillDetail>>` — detail for one on-disk folder, by path.
- Add `checkouts:{add(path:string):Run<CheckoutAdded>;remove(path:string):Run<CheckoutRemoved>}`.
- `Scope` (string) stays for `InstallArgs.scope`; it is no longer the Library's scope type.

### 1.3 Real adapter — `desktop/src/backend/tauri/index.ts`

**Schemas.** Replace the inline section object in `cliLs.local` (line 52) and `cliLocal` (line 107) with one shared `cliLocalSection` (they must not drift), with every CLI-1 field optional so an older CLI still parses:
```ts
const cliLocalSection = z.object({ root:z.string(), scope:z.enum(['global','project']), repoRoot:z.string().optional(), registered:z.boolean().optional(), detected:z.boolean().optional(), rootState:z.enum(['scanned','absent','unreadable']).optional(), label:z.string().optional(), counts:z.object({skillFolders:z.number(),connectable:z.number()}).optional(), rows:z.array(cliLocalRow), notOffered:z.array(z.object({skillId:z.string().nullable().optional(),name:z.string(),path:z.string(),reason:z.string(),detail:z.string().optional()})).optional(), problems:z.array(z.object({path:z.string(),reason:z.string()})) });
```
`cliLocalRow` (line 49) is unchanged (still `.strict()`; the three additive keys `skillId/placed/connected` stay optional). Add `cliCheckoutAdded = z.object({path:z.string(),registered:z.boolean()})` and `cliCheckoutRemoved = z.object({path:z.string(),placementsRemaining:z.number()})` (from `src/commands/checkout.ts:12`).

**`rootOf(section)`** → `Root`: `kind` from `scope`; `id` = `'global'` for the global section else `section.repoRoot ?? section.root`; `root` = abbreviated global root (`abbreviateHome`) or `repoRoot ?? root`; `label` = `section.label ?? (global ? 'Global' : basename(repoRoot))`; `rootState` passthrough; `registered = section.registered ?? false`, `detected = section.detected ?? false` (Global is `false/false` on the wire and never renders registration state — only `kind==='checkout'` rows do); `count = section.counts ? String(section.counts.skillFolders) : undefined` (D2: never computed app-side from rows; absent when the CLI sent no `counts`).

**`statusModel` (line 111-121).** `roots: local===null ? [] : local.local.map(rootOf)`. `counts.Global` = the global section's `String(counts.skillFolders)` when the CLI sent `counts`, otherwise **omit** `Global` (an older CLI renders no number, like the existing "renders no Global number when the served status omits its count" test). The #82 formula (placed/placement/skillId rows) is dropped — under D2 the Global row is a Library row and counts skill folders. Consequence, accepted: the Settings "Placed here" footer (`SettingsContent.tsx:68`, `{status.counts.Global??'—'} global`) now reads the skill-folder count.

**`library({scope,team},options)` (replace lines 305-324).** Argv order is fixed and asserted by tests:
1. `['ls','--local']` first (cwd rule unchanged: `run()` at line 210 keeps `cwd: cwd()` for every spawn — do not add a cwd mode). Failure → `{ok:false,error}` (no `reason`); the screen shows the drawn Library error board.
2. Resolve the section: `scope.kind==='global'` → the section with `scope==='global'`; `scope.kind==='checkout'` → the `project` section whose `normalizePath(repoRoot ?? root) === normalizePath(scope.root)` (`normalizePath` strips trailing `/` and `\`). None → `fail('No such checkout: '+scope.root+' · Register it under Settings ▸ This machine ▸ Checkouts.')` — no team spawn happens in that case.
3. Team enrichment, best effort: `inventoryTeam(team,options)` (spawns `['status']` or `['status','--team',t]`); when ok, `['ls','--team',t]`. `team: LibraryTeam` = `{kind:'ok',team}` when both succeed; `{kind:'none'}` when `inventoryTeam` fails with `reason==='no-team'`; `{kind:'unreadable',message}` for any other failure (ambiguous team, unreadable clone, ls failure). Never turn a team failure into a Library failure.
4. Cards, one per **row** of the section, in the CLI's row order, then one per **countable** `notOffered` entry (`reason` in the D2 frontmatter set `no-frontmatter | invalid-yaml | illegal-name | name-mismatch | description-missing | unsupported-field | malformed-allowed-tools | managed-wrapper` — this mirrors `src/lib/local-skills.ts:174-178` exactly; symlinks, inside-state-root, unreadable and other reasons are not skill folders and are not cards). Identity and React key are the on-disk `path` (D11); de-duplicate by path.
   - A row is **team-joined** when `team.kind==='ok'` and a team skill matches: by `row.skillId === skill.id` when `hello.features.localIdentity` is true and `row.skillId` is non-null, else by `row.placement?.id === skill.id && row.placement.team === team`. A joined row → `{...inventoryCard(skill, {...local, local:[{...section, rows:[row]}]}, team, features, home), path: row.path}` — the existing #82 function over just this occurrence, so `installed/placed/onDiskOnly/paths/projectRoots/connectedSources/flags` keep their #82 semantics and "Installed · on this machine" still appears for a present-by-id unplaced copy.
   - Otherwise `localCard(row, section, home)`: `{path:row.path, name:row.name, desc:'', project:'local', category:'—', installs:'—', installsN:0, installed:true, placed: row.placed ?? row.placement!==null, onDiskOnly:!placed, paths:[[abbreviateHome(row.path,home), section.scope]], connectedSources: row.connected||row.shared.length ? [row.path] : [], flags: (!row.connected && !row.shared.length && !placed) ? ['local'] : [], flagText: local ? {local:'Local · not shared with a team'} : {}, grants:null, normalizedGrants:null, grantsHash:null, size:'—', tokensK:0, wlt:null, summary:null, favorite:false, favorites:null, enabled:true, updated:null, indicators: <the same three entries inventoryCard builds>}`. A `row.problem` sets `flags:['broken'], flagText:{broken:row.problem}` instead. Nothing here reads registration (finding c).
   - A countable `notOffered` entry → the same shape with `installed:true, placed:false, onDiskOnly:true, flags:['broken'], flagText:{broken:'Not connectable · '+(entry.detail ?? entry.reason)}`.
5. `Library` value: `root: rootOf(section)`; `scanned`: every section's `repoRoot ?? root` (global abbreviated to `~/.claude/skills`) as today; `skills`; `team`; `problems`: the team inventory's `problems` when ok else `[]`; `provenance:null`; `title`: `` `${n} skill folder${n===1?'':'s'} in ${root.label}` `` plus `` ` · ${joined} shared with ${team}` `` when `team.kind==='ok' && joined>0`; `overview`: `{skills:String(n), skills_note:'—', evaluated:'—', meter:{pass_:0,neutral:0,fail:0,total:0}, meter_text:'', installs:String(sum installsN), installs_note:'—', attention:'—', attention_lines:[], attention_link:'', zero:{skills:'',evaluated:'',installs:'',attention:''}}`.

**`localSkill({path},options)`** (new): spawn `['ls','--local']`; find, across every section, the row whose `normalizePath(row.path)` equals `normalizePath(path)`, else the countable `notOffered` entry with that path. Not found → `{ok:false, error:'<abbreviated path> is not in any Library root (Global or a registered checkout), or no longer holds a SKILL.md.', reason:'not-in-library'}` — this is the only typed local failure. Found row with a joinable team skill (same join rule as above; team via `inventoryTeam(undefined)` then `['ls','--team',t]`, both best effort) → `inventoryDetail(skill, {...local, local:[{...section, rows:[row]}]}, selectedTeam, validation, inventory, features, home)` with `validation = backend.validate({ref:skill.name, team})` exactly as `skill()` does (lines 338-341), then the eval report merge exactly as lines 342-343. Otherwise `localDetail(card, section, path, home)`: `{...localCard(...), team:null, skillRef:'local:'+path, root:'Global', installScopes:[], projectNames:null, favorites:null, lines:null, hygieneCaption:null, path, pathLabel:abbreviateHome(path,home), repo:null, version:'—', version_full:null, scope: section.scope==='global' ? 'Global' : (section.label ?? basename), installs_n:0, used_by:[], users:[], author:{name:'',handle:'',role:'',initials:''}, files:['SKILL.md'], size_bytes:'—', desc_long:'', grants_approved:'', receipt:null, history:[], activity:[], hygiene:[], skillMd:{frontmatter:'', body:[], markdown:null}, evalEstimate:null, evalEstimateText:'', evalEstimateTip:'', evalCommand:'npx -y terum-skills@latest eval '+name, shareCommand:'npx -y terum-skills@latest connect '+pathLabel, incumbentLift:null, reportNumbers:null, scoreFractions:{routesExpected:null,roi:null,quality:null}, method:'', versions:null, latestState:'none', invalidReceiptFile:null, evalReportError:null, localRuns:[]}`. The CLI sends no body for a local row: the detail shows the path and "Open in editor" and never invents markdown.

**`checkouts`**: `add: path => run(['checkout','add','--',path], cliCheckoutAdded, v=>v, ['config'])`, `remove: path => run(['checkout','remove','--',path], cliCheckoutRemoved, v=>v, ['config'])`.

**`surfaces()`** (line 298-300): add `checkouts:true`. **`skill({ref})`** is unchanged (team refs).

### 1.4 Invalidation — `desktop/src/app/invalidation.ts:5`

`config: ['status','settings','onboarding','library','skill','catalog']` — `checkout add/remove` touches `config` and the Library/skill/catalog reads depend on the registry. Update `invalidation.test.ts` accordingly.

### 1.5 Mock adapter — `desktop/src/backend/mock/index.ts`, `scenario.ts`, `data.ts`

- `scenario.ts`: add `'detected-root' | 'missing-root'` to `MockScenario` and the switch.
- `mockRoots():Root[]` replaces `sidebarProjects()` (line 122): `[{id:'global',kind:'global',label:'Global',root:'~/.claude/skills',rootState:'scanned',registered:false,detected:false,count:design.COUNTS.Global}, ...['Terum','SSM','MRF'].map(name=>({id:'/Users/you/code/'+name.toLowerCase(), kind:'checkout', label:name, root:'/Users/you/code/'+name.toLowerCase(), rootState: scenario==='missing-root'&&name==='SSM' ? 'absent':'scanned', registered: !(scenario==='detected-root'&&name==='SSM'), detected: scenario==='detected-root'&&name==='SSM', count: scenario==='missing-root'&&name==='SSM' ? undefined : design.COUNTS[name]}))]`. Row order and labels are the boards' (Terum, SSM, MRF); the Global count for the `empty` scenario keeps coming from `statusCounts` (`counts.Global`), which the Sidebar still reads for the Global row.
- `status()` (line 69): `roots:mockRoots()` replaces `projects`.
- `library({scope})` (line 72): keep the `no-team` failure; resolve `root = mockRoots().find(r => scope.kind==='global' ? r.kind==='global' : r.id===scope.root)`; unknown → `fail('No such checkout: '+scope.root)`; `canonical = root.label`; skills, overview (`OVERVIEW_BY_SCOPE[canonical]`), title (`library_title(canonical)`) exactly as today; every card gets `path: root.kind==='global' ? '~/.claude/skills/'+s.name : root.root+'/.claude/skills/'+s.name`; add `root`, `team:{kind:'ok',team:design.TEAMS[0].name}`; drop `projects`.
- `localSkill({path})`: `read('skill', …)` — `name = basename(path)`, `skillByRef(name)`; ok → `{...detail, team:null, skillRef:'local:'+path, path, pathLabel:path}`; else `{ok:false, error:path+' is not in any Library root.', reason:'not-in-library'}`.
- `checkouts.add(path)` → `long('settings', ctx => { ctx.print('Registered '+path); notify listeners 'config'; return ok({path,registered:true}); })`; `remove(path)` → `long('settings', …ok({path,placementsRemaining:0}))` with the same `config` notification.
- `surfaces()` (line 68): add `checkouts:false`.
- `data.ts` `cardOf`: add `path:null`; `detailOf`: add `path:d.path`.

### 1.6 Sidebar — `desktop/src/components/domain/Sidebar.tsx`

Signature (line 11): replace `projects?:readonly string[]|undefined` with `roots?:readonly Root[]|undefined`; keep `collapsedSections`, `onToggleSection`, `onHide` (#84) and the `NavRow` chevron button exactly as they are (lines 8-9).

Rows (line 14-15):
- Global: unchanged (`href="#/library/global"`, `selected==='Global'`, `count={displayedCounts?.Global}`).
- Checkout rows: `checkoutRoots = roots?.filter(r=>r.kind==='checkout') ?? []`. When `surfaces?.library!==false && checkoutRoots.length`: the existing "Projects" header row (label `Projects`, icon `folder`, `href="#/marketplace/projects"`, `expandable`, `collapsed={collapsedSections.includes('projects')}`, `onToggle={()=>onToggleSection?.('projects')}`) — the header stays a link to the Marketplace projects page by design (team packages live there) — then, when not collapsed, one `<CheckoutRow key={root.id} …/>` per checkout root: `NavRow` with `label={root.label}`, icon `box`, `href={'#/library/checkout?root='+encodeURIComponent(root.id)}`, `selected={selected===root.id}`, `nested`, `count`: hidden when `counts===null` or the counts preference is off (the existing `displayedCounts` rule), else `'—'` when `rootState` is `absent`/`unreadable`, else `root.count` (undefined → no number).
- Detected row (D1): when `root.detected && !root.registered && features?.checkouts`, render after the count a `<button type="button" className="icon-button nav-add" aria-label={'Add '+root.label+' to your library'} disabled={action.busy} onClick={e=>{e.preventDefault();e.stopPropagation();void action.run(()=>backend.checkouts.add(root.id));}}>+ Add</button>` (via `useWorkflow()` inside `CheckoutRow`; `useFeatures()` for the gate) and, under the row, `action.error` as `<div role="alert">` when present. The mock never renders this outside `__mock=detected-root`, so no board moves.
- Selection is by `root.id`, never by label (D11): two checkouts labelled `app` are two rows with distinct hrefs.

### 1.7 Shell — `desktop/src/components/domain/Shell.tsx:13,27`

Prop `roots?:readonly Root[]|undefined` replaces `projects`; pass `roots={roots??value?.roots??undefined}`. Everything else (collapse state, `toggleSection`, `setSidebar`, `param`, the `__mock` link rewrite, `counts` rule) is unchanged.

### 1.8 Routes — `desktop/src/app/routes.tsx:21,40`

`{path:"/library/checkout",element:<LibraryScreen/>}` replaces `/library/project/:name`; update the AC-10 comment ("with Global and each /library/checkout?root= explicit scopes"). No redirect for the old route (it falls to NotFound; nothing outside the app links to it).

### 1.9 LibraryScreen — `desktop/src/screens/library/LibraryScreen.tsx:16-20`

- `scope: LibraryScope = location.pathname==='/library/checkout' ? {kind:'checkout', root: search.get('root') ?? ''} : {kind:'global'}`; `missing = scope.kind==='checkout' && !root`.
- `useQuery({queryKey:['library', scope.kind==='global'?'global':scope.root, state.mock], enabled:!missing, …backend.library({scope})})`.
- `title = data?.root.label ?? (scope.kind==='global' ? 'Global' : basename(root))`; `selected = scope.kind==='global' ? 'Global' : (data?.root.id ?? root)`; `<Shell counts={loading||error?null:undefined} selected={selected}>` (no `projects` prop).
- `missing` → the existing LibraryError-shaped `CenteredState` with `ErrorLine` "No checkout selected." and `ScreenFrame ready`; no CLI call.
- Boards: `no-team` board when `query.data?.ok===false && reason==='no-team'` **or** `data && data.skills.length===0 && data.team.kind==='none'` (a machine with no team and no skills: setup is the useful next step; a machine with skills always shows them). Error board otherwise on `error`. Empty board title: Global keeps "No skills in your global library"; a checkout reads `No skills in ${title}` with the same body/actions. When `data.team.kind==='unreadable'` render one `<ErrorLine>` under `ScanCoverage`: `Team unreadable: ${message} · cards show local state only`.
- `param()` must preserve `root` (it already copies the existing search params) — `q`, `overview`, `__mock`, `theme`, `root` all survive search and overview changes.
- `#84` overview toggle, `ScanCoverage`, search row, `Connect` button: unchanged.

### 1.10 SkillCard — `desktop/src/components/domain/SkillCard.tsx:15`

`href = skill.project==='local' && skill.path ? '#/skill/local?path='+encodeURIComponent(skill.path) : <today's href>`; the "Open" menu item navigates to the same target. Team-joined cards keep `#/skill/<name>` (their team detail already shows every placed path).

### 1.11 SkillScreen — `desktop/src/screens/skill/SkillScreen.tsx:36-48`

- `localPath = ref==='local' ? params.get('path') : null`. Query key `['skill', localPath!==null ? 'local:'+localPath : ref, state.mock]`; `queryFn` = `backend.localSkill({path})` when local, else `backend.skill({ref})`.
- Sidebar selection for a local detail: query `backend.status()` (enabled only when local) and select the registered checkout root whose `root` (trailing slash stripped) is `path` or a `/`-prefix of it (longest wins); else `'Global'`. The crumbs use that root's label.
- Error board for a local detail (findings a/b): when `query.data?.ok===false && query.data.reason==='not-in-library'` → `CenteredState alert icon="alert" title="Not in your library" body="This folder is not in ~/.claude/skills or a registered checkout, or it no longer holds a SKILL.md. Nothing was deleted; a checkout is forgotten under Settings ▸ This machine ▸ Checkouts." primary="Back to library" onPrimary=navigate('/library/global')` with `<ErrorLine>{error}</ErrorLine>`. Any other local failure (action or read) → `CenteredState alert title={"Couldn't read "+basename(path)} body="terum-skills could not read this folder. The message below is the CLI's own." primary="Try again" onPrimary={()=>{setActionError(null);void query.refetch();}} secondary="Back to library"` with the raw `ErrorLine`. **No remove/forget button on either board.** The team-ref error board (line 47's existing "listed in your people file" copy) is untouched.
- Actions on a local detail: `Edit` as today; `Remove from ${s.scope}` only when `s.placed` (unchanged rule); the `execute('remove')` path stays `uninstallSkill({ref})` — for a local detail `ref` is the team skill name, so pass `s.name` when `localPath!==null`. `Manage with Terum…` (connect) unchanged.
- Keep `key={(ref??'')+':'+mock}` on `SkillPage` and add `params.get('path')` to it so two local paths never share state.

### 1.12 Settings ▸ This machine ▸ Checkouts — `desktop/src/screens/settings/SettingsContent.tsx:66-70`, `SettingsScreen.tsx:32`

`SettingsContent` gains `surfaces:Surfaces|undefined` (passed from `SettingsScreen`'s existing `surfaces` query). Appended **after** the Quarantine group in `case 'machine'`, rendered only when `features?.checkouts && surfaces?.checkouts===true`:

```
<Group label="Checkouts" note={<Note>Folders this machine scans for skills and refreshes at sync. Registering a folder is not sharing: it connects nothing and approves no tool grant. Remove forgets the path only; nothing on disk changes.</Note>}>
  <Card>
    {status.roots.filter(r=>r.kind==='checkout').map(root=><Row key={root.id} title={root.root} desc={`${root.rootState??'—'} · ${root.count??'—'} skill folders${root.registered?'':' · Detected · not registered'}`}>
      {root.registered ? <Button kind="danger" disabled={action.busy} onClick={()=>void action.run(()=>backend.checkouts.remove(root.id))}>Remove</Button>
       : root.detected ? <Button disabled={action.busy} onClick={()=>void action.run(()=>backend.checkouts.add(root.id))}>Add</Button> : null}
    </Row>)}
    <Row title="Add a checkout…" desc="The folder's canonical path; a git checkout or a plain folder that holds .claude/skills.">
      <WorkflowField aria-label="Checkout path" style={{width:320}} value={checkoutPath} disabled={action.busy} onChange={e=>setCheckoutPath(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')add();}}/>
      <Button disabled={action.busy||!checkoutPath.trim()} onClick={add}>Add</Button>
    </Row>
  </Card>
</Group>
```
`add()` = `void action.run(()=>backend.checkouts.add(checkoutPath.trim()), {}, ()=>setCheckoutPath(''))`. `action.error` already renders through `SettingsScreen`'s existing `settings-action-error` alert (`SettingsScreen.tsx:33`) — do not add a second one. No folder picker (no Tauri dialog plugin is bundled). The section note mentions "Detected · not registered" verbatim (D1).

### 1.13 Things deliberately unchanged

`run()`'s cwd (`index.ts:208-211`), `readModels`, `settingsModel` beyond `counts.Global`, `skill({ref})`, `catalog`, `roster`, every Marketplace/Share/Inbox/Onboarding screen, `docs/frame-protocol.md`, the CLI.

## 2. What is kept, replaced, removed

**Kept verbatim from main:** #84's `NavRow` chevron button, `collapsedSections`/`onToggleSection`/`onHide` props and Shell's `toggleSection`/`setSidebar`/`param` (Sidebar.tsx:8-9,11; Shell.tsx:15-18); the mock's `statusCounts` derived counts (`mock/status-counts.ts`) and scoped overviews (`OVERVIEW_BY_SCOPE`, `library_title`); #82's `onDisk`/`inventoryCard`/`inventoryDetail` (index.ts:59-81) and the "Installed · on this machine" rail copy in `SkillScreen.tsx:28`; #83's eval button/report merge; #87's install destinations.

**Replaced (ledger D11, context line 21 "a Library sidebar of Global plus one row per registered checkout, keyed by canonical path"):** #82's per-team-project Library rows (`Sidebar.tsx:15` `projects.map(name=>…'#/library/project/'+name)`), the `/library/project/:name` route (`routes.tsx:40`), `StatusResult.projects` / `Library.projects`, the `ls project <name> --team` spawn (`index.ts:308-309`), and the mock's `sidebarProjects()`.

**Removed:** #82's `installed` Library scope (`index.ts:308,314`, `LibraryScreen.tsx:17`). No locked board in `desktop/FIDELITY.md` routes to it (the Library rows are `#/library/global…` only) and no mock scenario draws it (`on-disk-only` runs on `#/library/global`). Under the ruling every Library row already lists only what is on disk, so "installed" is the Global row itself. Tests that used `library({scope:'installed'})` to assert installed identity now use `{kind:'global'}` and assert the same card fields.

## 3. File-by-file plan (worktree paths)

| File | Change |
| --- | --- |
| `desktop/src/backend/types.ts` | §1.1 |
| `desktop/src/backend/Backend.ts` | §1.2 |
| `desktop/src/backend/tauri/index.ts` | §1.3 (schemas, `rootOf`, `localCard`, `localDetail`, `statusModel.roots/counts`, `library`, `localSkill`, `checkouts`, `surfaces.checkouts`) |
| `desktop/src/backend/mock/index.ts`, `mock/scenario.ts`, `mock/data.ts` | §1.5 |
| `desktop/src/app/invalidation.ts` | §1.4 |
| `desktop/src/app/routes.tsx` | §1.8 |
| `desktop/src/components/domain/Sidebar.tsx`, `Shell.tsx` | §1.6, §1.7 |
| `desktop/src/components/domain/SkillCard.tsx` | §1.10 |
| `desktop/src/screens/library/LibraryScreen.tsx` | §1.9 |
| `desktop/src/screens/skill/SkillScreen.tsx` | §1.11 |
| `desktop/src/screens/settings/SettingsContent.tsx`, `SettingsScreen.tsx` | §1.12 |
| `desktop/src/components/domain/Sidebar.css` or `Primitives.css` (whichever holds `.nav-row`) | a `.nav-add` rule for the detected-row button (12px, `var(--tk-text3)`, no background) |

## 4. Test plan

Recorded frames (already in the worktree, read-only, recorded 2026-09-09 with this branch's built CLI against a synthetic scratch HOME): `.planning/codex-runs/personal-library/frames/ls-local.jsonl` (Global: `alpha` connectable + `beta` name-mismatch in `notOffered` → `counts {skillFolders:2,connectable:1}`; registered checkout `…/fx/repo/app` label `app`, rows `delta`, `gamma`, `counts {2,2}`), `ls-local-detected.jsonl` (adds an unregistered cwd repo `…/fx/repo/other`, `registered:false, detected:true`, label `other`, one row `epsilon`), `ls-local-missing.jsonl` (the `app` checkout with `rootState:'absent'`, no rows), `checkout-add.jsonl` (`{path,registered:true}`), `checkout-remove.jsonl` (`{path,placementsRemaining:0}`). Read them with the same `readFileSync(resolve('../.planning/codex-runs/…'))` pattern as `replay.test.ts`.

Rewrite (never delete or weaken; declare every changed test in `testsModified`):

- `desktop/src/backend/tauri/__tests__/index.test.ts` — the three `library({scope:'…',team:'acme'})` cases (line 240-243) become `{kind:'global'}` / `{kind:'checkout',root}` and assert the new argv order `[['ls','--local'],['status','--team','acme'],['ls','--team','acme']]`, `title:'1 skill folder in Global · 1 shared with acme'`, `root:{id:'global',kind:'global',label:'Global'}`, `team:{kind:'ok',team:'acme'}`, the joined card keeping `installed:true, placed:true, project:'Global', installs:'1 installs', path:'/home/.claude/skills/a'`; line 257 `installed` → `{kind:'global'}` with `skills:[]` only when the scan is empty; line 262 (ambiguous team) → Library still succeeds with `team:{kind:'unreadable',…}` and the ambiguous-team `reason` asserted on `skill()` instead; line 382-388 no-team → `library({scope:{kind:'global'}})` succeeds with `team:{kind:'none'}` and spawns `ls --local` then `status`; installed-state cases (line 408-434) → `{kind:'global'}`; line 485-488 → `status.value.counts` equals `{}` when the recording has no `counts`, and `roots` has one global + one checkout root from the `project` recording; line 490-501 subtitle → `title:'1 skill folder in Global'`; new: `localSkill` by path returns the joined detail for `/home/.claude/skills/a` with argv `[['ls','--local'],['status'],['ls','--team','acme'],['validate','--team','acme','--','a'],['eval-report','--team','acme','--','a']]`, and `{ok:false,reason:'not-in-library'}` for an unknown path without spawning `status`; `checkouts.add/remove` argv `['checkout','add','--',path]` / `['checkout','remove','--',path]` and a `config` change notification; `surfaces()` includes `checkouts:true`; a section without `counts` yields `count:undefined`; trailing-slash roots resolve; `cliLocalRow` stays strict (the existing "surprise" key test).
- New `desktop/src/backend/tauri/__tests__/library-replay.test.ts` — replays the five recordings: `status().value.roots` = `[Global {count:'2'}, app {id:'…/fx/repo/app', registered:true, detected:false, count:'2', rootState:'scanned'}]`; `library({kind:'global'})` = 2 cards (`alpha` local, `beta` broken `Not connectable · SKILL.md name not-beta does not equal folder beta`), title `2 skill folders in Global`, `team:{kind:'none'}`; `library({kind:'checkout',root:'…/fx/repo/app'})` = `delta`, `gamma`; detected recording → the `other` root `registered:false, detected:true, count:'1'`; missing recording → `rootState:'absent'`, `count:'0'`, Library for it = 0 cards; `checkouts.add(path).done` / `remove(path).done` map the recorded results.
- `desktop/src/backend/tauri/__tests__/replay.test.ts` — the S7g `inventoryReplay` block (line 62-76): Library Global from the S7g `ls-local` (1 row `deploy-check`, no `counts` → title `1 skill folder in Global · 1 shared with acme`, `count:undefined`), the `project` scope call becomes `{kind:'checkout', root:<the seed repoRoot from the recording>}` = 0 cards; the endorsement-notes test (line 100-106) becomes a title/team assertion (the old `skills_note` strings are gone).
- `desktop/src/backend/tauri/__tests__/replay-screens.test.tsx` — the sidebar link assertion (line 31) becomes the `seed` checkout row `href='#/library/checkout?root='+encodeURIComponent(<repoRoot>)`; the project-route test (line 47-51) opens that href and asserts the title `0 skill folders in seed` and no `ls project` spawn.
- `desktop/src/backend/tauri/__tests__/path-true-screens.test.tsx:38-46` — "keeps an unknown Library route scope as typed" becomes "renders the No such checkout error for an unregistered root" (`#/library/checkout?root=/nowhere/x` → alert containing `No such checkout: /nowhere/x`).
- `desktop/src/components/domain/Shell.test.tsx` — count arrays unchanged (mock roots carry the design counts); the explicit-counts case (line 40-43) with `{Global:'99'}` renders `['99','8','3','2']` (Global from `counts`, checkouts from `roots`).
- `desktop/src/components/domain/Sidebar.test.tsx` — `roots={status.value.roots}` instead of `projects`; new: same-label roots `/a/app`,`/b/app` → two links `#/library/checkout?root=%2Fa%2Fapp` / `%2Fb%2Fapp`, `aria-current` only on the selected id; `__mock=detected-root` renders "Add SSM to your library" and calls `checkouts.add('/Users/you/code/ssm')`, error under the row, hash unchanged; `features.checkouts:false` hides it; `__mock=missing-root` renders `SSM —` and `counts={null}` hides every number.
- `desktop/src/components/domain/collapse.test.tsx:58` — `#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fssm`.
- `desktop/src/screens/library/library-skill.test.tsx` — new: checkout route keeps `root`, `q`, `overview`, `__mock`, `theme` through search + overview changes and selects `MRF 2`; `#/library/checkout` without root renders "No checkout selected." without calling `library`; a `project:'local'` card links to `#/skill/local?path=…` and its Open menu navigates there; `#/skill/local?path=…` with `reason:'not-in-library'` renders "Not in your library" and only "Back to library" (no remove/forget button, `checkouts.remove` never called); a plain failure renders "Couldn't read <name>" with the raw message and "Try again".
- `desktop/src/screens/settings/settings.test.tsx` — with `surfaces.checkouts:true` (spy) the machine section lists the three mock checkouts, Remove calls `checkouts.remove('/Users/you/code/terum')`, detected SSM shows Add, typing a path and pressing Add calls `checkouts.add('/tmp/x')` and clears the field; with the mock's `surfaces.checkouts:false` the group is absent.
- `desktop/src/backend/mock/__tests__/scoped-library.test.ts`, `status-counts.test.ts`, `desktop/src/backend/__tests__/mock.test.ts`, `desktop/src/components/domain/s7q-surfaces.test.tsx`, `desktop/src/app/invalidation.test.ts` — the scope objects, `roots` in the status shape, `#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum` routes, and the config invalidation set.
- `desktop/e2e/routes/scroll.spec.ts:33`, `collapse.spec.ts:90` — `#/library/project/Terum` → `#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum` (same title `8 skills`, same values).

Fail-before: the rewritten/new vitest files are copied onto a scratch worktree of `origin/main` and must fail there (the roots contract does not exist on main).

## 5. Fidelity note

Boards render on the mock, so the mock's sidebar rows (Global 15 · Projects ▸ Terum 8 / SSM 3 / MRF 2 · Inbox rows), the Library Global page, the Settings machine page and every dialog must not move a pixel. Locked rows in `desktop/FIDELITY.md` that this change touches through the shell: every locked board (all 88 draw the sidebar); the Library family (Library, LibraryLight, LibraryEmpty, LibraryLoading, LibraryCollapsed, LibraryError, LibraryNoResults, LibrarySidebarHidden, LibraryProjectsCollapsed, LibraryInboxCollapsed); SettingsMachine and SettingsPrune (the Checkouts group is hidden on the mock via `surfaces.checkouts:false`). Inherited failures on pristine main, not this change's: Main and Light (exact-0 boards), LibraryNoResults, six Marketplace* boards, and the three collapse boards (LibrarySidebarHidden, LibraryProjectsCollapsed, LibraryInboxCollapsed — no oracle PNG in `.shots`). Any other failing board is this change's.
