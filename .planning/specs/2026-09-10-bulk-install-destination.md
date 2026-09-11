# SPEC — bulk-install destination picker (Marketplace projects + people)

Baseline: `ryanliu-terum/terum-skills` @ **296fa00** (`Merge pull request #144 … fix/win-w03w04-skill-routing`).
Every line number and quoted line below was read out of that commit. Where a brief disagrees with
the code at 296fa00, **the code wins**.

Governing decisions: `.planning/decisions/2026-09-10-marketplace-install-destination-decision-walk.md`
(commit `755d4b7`). North Star: *when someone bulk-installs skills, they choose where the skills land,
and the app's own words match what actually happened.*

**Status: ready for review, NOT yet locked for `/codex-implement`.** Two human gates in §9 must close
first — Teddy's copy and the fidelity board render. Everything else is specified.

---

## 0. Summary

1. Clicking **Install N skills** on a Marketplace project silently installs machine-wide and tells
   the user it installed into their repo. Both halves are wrong.
2. This batch gives both bulk-install paths — project and person — the destination picker the
   single-skill dialog already has, pre-selecting the registered checkout whose git origin matches
   the project's remote, and ends the list with **Add a project folder…** so a machine with nothing
   registered still has a real choice.
3. Desktop-only. No CLI change: `install --into <root>`, `checkout add`, and `ls --local`'s per-root
   `remote` all exist and are already consumed by the adapter.
4. It closes the gap between the app and the standing team decision of 2026-09-09 (ryanliu): *team
   package installation asks for a local destination instead of guessing … users must control whether
   skills land in Global or a specific checkout.*

---

## 1. Current behaviour at 296fa00

| where | what happens |
|---|---|
| `MarketplaceScreen.tsx:76` `InstallDialog` | project dialog: grants preview + terminal hint + Cancel/Install. **No destination control.** |
| `MarketplaceScreen.tsx:91` `install()` | `backend.install({ ref, kind:'project', project:ref })` — **no `scope`** |
| `MarketplaceScreen.tsx:95` person branch | `q ? param('dialog','install') : void install()` — a person install opens **no dialog at all** |
| `tauri/index.ts:718` `install` | `args.scope === undefined` → `into = 'global'` → `install --into global -- project <key>` |
| `SkillScreen.tsx:131` | the pattern to copy: `features?.installScope && s.installScopes.length ? <RadioGroup className="skill-install-scopes">…</RadioGroup> : <div className="skill-install-scopes" style={{height:123}}>Global</div>` |

Dialog copy today, false in two clauses: *"…places them into this repo's `.claude/skills`. Run it
inside a checkout of `<remote>` — from anywhere else it exits and copies nothing."*

The app cannot do working-directory discovery: the Tauri shell spawns the CLI with cwd
`~/.terum/skills`, or `/` on a Dock launch (`desktop/src-tauri/src/lib.rs:84-87`). The destination
list is therefore exactly **Global + registered checkouts**, never a detected one.

---

## 2. Behaviour contract

**C1 — the project dialog has an Install to section.** Rows: `Global · every session ·
~/.claude/skills`, then one row per registered checkout (`label · project · <abbreviated path>`),
then the **Add a project folder…** row.

**C2 — pre-selection.** The checkout whose origin slug matches any of the project's remotes is
pre-selected. No match → Global. **More than one match → nothing pre-selected and Install is
disabled until the user picks** (the CLI's rule, `src/commands/install.ts:263`).

**C3 — Add a project folder…** opens `backend.pickFolder()`; a non-null result goes to
`backend.checkouts.add(path)`; on success the roots query is invalidated and the new root becomes the
selected destination. A cancelled chooser (`value === null`) is a no-op. A failed add shows the CLI's
own message in the dialog's existing error line and leaves the previous selection intact.

**C4 — the person dialog.** `Install N skills` on a person opens the same dialog: destination section
+ grants preview + Cancel/Install. Default Global (a person has no remote to match). Title
`Install <handle>'s skills`.

**C5 — the run.** Confirm passes the selected row's label as `scope`:
`install({ ref, kind, project|member, scope })`. `scope: 'Global'` keeps the adapter's existing
global branch; any other label resolves through the adapter's `ls --local` label→`repoRoot` lookup
and becomes `--into <root>`. Grant consent prompts are unchanged; declining still cancels the run.

**C6 — degradation.** `features.installScope` false → no radios, the static `Global` block, exactly
as `SkillScreen.tsx:131` does. `features.checkouts` false → the **Add a project folder…** row is
hidden (Library hides its own Add project on the same flag). Both false → today's dialog plus a
truthful sentence.

**C7 — nothing else about the dialog changes.** Grants preview, terminal hint, Cancel/Install, and
the cancel-on-declined-consent behaviour are untouched.

---

## 3. Required model change — `Project.remotes`

**The matching rule cannot be written against the current model.** `tauri/index.ts:322` sets
`remote: project.remotes[0] ?? '—'` — the raw remote **URL** from `team.json`, and only the first of
them. `Root.remote` is `{url, slug|null}` (`types.ts:65`), already normalised by the CLI. So:

- comparing `project.remote` to `root.remote.slug` compares a URL to a slug — never matches;
- a project with two remotes would match on only one of them, where the CLI matches on any
  (`install.ts:257-262`).

**Change:** add `remoteSlugs: string[]` to `Project` (`desktop/src/backend/types.ts`), filled by the
adapter from **all** of `project.remotes` through the `repoSlug` helper that already exists at
`tauri/index.ts:196`, dropping entries that normalise to null. `Project.remote` stays exactly as it
is — it is display copy and several screens read it. The mock fills `remoteSlugs` from its fixture
remotes. Normalisation stays in the adapter so one rule serves every screen.

---

## 4. Changes per file

### 4.1 NEW — `desktop/src/screens/marketplace/install-destinations.ts`

One pure function, unit-testable without a backend:

```
destinationsFor(roots: Root[], remoteSlugs: string[], features: {checkouts: boolean})
  → { rows: [label: string, caption: string][]; preselected: string | null; addRow: boolean }
```

- `rows[0]` is always `['Global', 'every session · ~/.claude/skills']`.
- one row per `root.kind === 'checkout' && root.registered`, `[root.label, 'project · ' + root.root]`
  (`root.root` is already home-abbreviated by the adapter, `tauri/index.ts:95`).
- `preselected`: the single checkout row whose `root.remote?.slug` is in `remoteSlugs`; `'Global'`
  when there are none; `null` when there are two or more.
- `addRow`: `features.checkouts`.
- An unreadable or absent root (`rootState !== 'scanned'`) is still listed — the CLI accepts it as a
  destination and refuses with its own message, which is better than the app hiding the folder the
  user is looking for.

### 4.2 `desktop/src/backend/types.ts`

`Project` gains `remoteSlugs: string[]`. No other type changes: `InstallArgs.scope` already exists.

### 4.3 `desktop/src/backend/tauri/index.ts`

Line 322 project mapping: add `remoteSlugs: project.remotes.map(repoSlug).filter(s => s !== null)`.
Nothing else — the `install` adapter at :718 already resolves a non-`Global` scope label to a
`repoRoot` and passes `--into`.

### 4.4 `desktop/src/backend/mock/data.ts`

Fill `remoteSlugs` for each fixture project so the mock pre-selects a checkout on at least one
project and Global on another; the locked boards' default selection must stay whatever the
re-rendered board shows (§9).

### 4.5 `desktop/src/screens/marketplace/MarketplaceScreen.tsx`

- `InstallDialog` takes `project?`, `person?`, `roots`, `features`, `scope`, `onScope`, `onAddFolder`
  and renders the destination section above the existing grants block, using `RadioGroup`/`RadioRow`
  from `../../components/ui/RadioGroup` — the same components `SkillScreen.tsx:23` imports.
- `DetailPage` already queries `status` for `ownHandle` (`:96`); reuse that result for
  `roots` rather than adding a second query. Hold `scope` in state, seeded from
  `destinationsFor(...).preselected` once the status query resolves, and reset when the dialog closes.
- `install()` passes `scope`.
- The person branch at `:95` opens the dialog instead of installing directly:
  `onClick={() => param('dialog','install')}` for both, and the dialog renders for `q || p`.
- Install is disabled while `scope === null` (the two-match case) or `action.busy`.

### 4.6 `desktop/src/screens/marketplace/marketplace.css`

Add `.market-install-scopes` mirroring `.skill-install-scopes`, and a row style for
**Add a project folder…**. Do not restyle `.market-install-grants` or `.market-dialog-actions`.

---

## 5. Copy

| id | string | owner |
|---|---|---|
| S1 | destination section label — `Install to` | fixed, matches `SkillScreen` |
| S2 | Global row caption — `every session · ~/.claude/skills` | fixed, matches `SkillScreen` |
| S3 | checkout row caption — `project · <path>` | fixed, matches `SkillScreen` |
| S4 | `Add a project folder…` | **Teddy** |
| S5 | project dialog description — replaces the two false clauses; must describe what the picker does, not where installs happen to land | **Teddy** (D5) |
| S6 | person dialog title + description | **Teddy** |
| S7 | two-match hint, e.g. "Two registered folders point at this repository — pick one." | **Teddy** |

Implementation may proceed with S4/S6/S7 as written above; **S5 blocks the PR** (§9).

---

## 6. Tests

`desktop/src/screens/marketplace/install-destinations.test.ts` (new): one match → that label; no
match → `Global`; two matches → `null`; `checkouts:false` → `addRow:false`; unregistered root absent
from rows; `remoteSlugs: []` → `Global`.

`desktop/src/screens/marketplace/marketplace.test.tsx` (extend): the existing assertion at `:164`
(`install` called with `{ref:'docs',kind:'project',project:'docs'}`) becomes `scope:'Global'` or the
matching label per fixture, and `:166`'s person assertion moves behind the new dialog. Add: dialog
renders the destination rows; changing the selection changes the `scope` passed; Add-a-folder calls
`pickFolder` then `checkouts.add` and selects the result; a cancelled chooser installs nothing; a
failed add leaves the selection unchanged; Install disabled in the two-match case;
`features.installScope:false` renders the static Global block and passes `scope:'Global'`.

`desktop/src/backend/tauri/__tests__/index.test.ts` (extend): `remoteSlugs` is populated from all of
a project's remotes and drops unparseable ones.

Every new test must be shown to fail on the pre-fix tree.

---

## 7. Gates

Root: `npm run lint && npm run typecheck && npm test`.
Desktop: `npm run typecheck --prefix desktop && npm run lint --prefix desktop && npm test --prefix desktop && npm run build --prefix desktop && npm run e2e:routes --prefix desktop`.
Node 25 needs `--no-experimental-webstorage` for the desktop suite. `e2e:fidelity` needs the design
canvas and is the orchestrator's gate, not Codex's — and it **will fail until §9.2 closes**.

---

## 8. Out of scope

- The CLI. No verb, flag, or frame change.
- Single-skill install (`SkillScreen`) — already has its picker; do not refactor it into the shared
  helper in this batch.
- Moving an already-installed project between roots (there is no bulk `move`).
- `Project.remote`'s display use anywhere else.
- Anything under `.shots`, `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/src/fixtures/design.json`.

---

## 9. Human gates before this spec can be locked

**9.1 — S5, the project dialog's description (Teddy).** D5 gated the rewrite to ship with this
change; the sentence must describe the picker. Until it exists the PR cannot merge, because merging
with today's text would ship a picker under copy that contradicts it.

**9.2 — the fidelity board (Ryan's Mac).** `MarketplaceProjectInstall`
(`desktop/e2e/fidelity/boards.ts:363`) is locked at 0.35% dialog tolerance; a destination section is
far past that. The board needs re-rendering from the design canvas after S5 lands. The **person**
dialog and the Add-folder row need no board — no board draws them, and the team-projects precedent
puts an undrawn dialog outside the gate.

**9.3 — D5's tripwire.** If this spec has not merged by the next desktop release dispatch, the
interim copy fix ships on its own and this spec rebases onto it.
