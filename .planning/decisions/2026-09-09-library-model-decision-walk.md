---
title: Library model (personal Library, team Marketplace, registered checkouts) decision walk
date: 2026-09-09
north_star: The Library is this machine's folders and the Marketplace is the team's packages; the two meet only when a person chooses where a skill goes, and nothing on disk becomes a refresh target without an action that person took.
status: complete
deferred:
  - what: checkout remove --unplace (D5)
    gate: after destination-aware uninstall (D9) ships in CLI-2
  - what: Desktop-2 Marketplace packages and destination radios
    gate: Teddy draws the Global package card, checkout Library board, Settings Checkouts group and the destination dialogs
  - what: team project add-remote for forks with a different origin (D8)
    gate: first team with a forked checkout
  - what: sleep/resume and Windows second-launch are unrelated and not listed here
    gate: tracked in their own reports, not this walk
---

# Library model — Decision Walk

**North Star:** The Library is this machine's folders and the Marketplace is the team's packages; the two meet only when a person chooses where a skill goes, and nothing on disk becomes a refresh target without an action that person took.

Context: surfaced by Ryan's 2026-09-09 ruling while testing 0.1.7: "in the sidebar under the library category, thats YOUR own personal library. so it should take from global skills in your local computer and project skills from local folders/checkouts. projects in the team sense should have to each be manually created, and those should show up in the marketplace under the 'team' category in the projects category. in order to get skills into the team projects category, each skill has to be manually added. 'global' in the team sense should just act as almost the same as a project, just named global. when installing skills from team packages, users should specific which local folder the skills should install into." The model that the investigator and a Codex gpt-6-astra review converged on the same day (Option A) is: a CLI-owned `config.checkouts` registry; a Library sidebar of Global (`~/.claude/skills`) plus one row per registered checkout, keyed by canonical path; team packages = the `team.json` projects plus a Global package, shown under Marketplace ▸ Team ▸ Projects, with skills added only via `publish`; `install --into global|<root>` as a chosen destination with the remote match offered as the default suggestion; `sync` refreshing every registered checkout from any cwd; and a destination-aware `uninstall-skill --from`. Grounded against origin/main @ 279830d on 2026-09-09; key anchors are `src/lib/local-skills.ts:29-61` (global plus the one cwd-derived project root), `src/commands/sync.ts:206/:237/:270` (a cross-checkout refresh writes the exclude line into the wrong checkout today), `src/commands/uninstall.ts:85/:100` (destination-blind), `src/commands/install.ts:222-240` (origin-remote match and scope selection), `src/lib/schema.ts:26/:95-109` (`scopeSchema` and `configSchema`), `src/lib/guard.ts:174-182` (row c), `desktop/src/backend/tauri/index.ts:118/:257/:260` (`projects:null` and the `ls`-backed `library` read model) and `desktop/src/components/domain/Sidebar.tsx:15` (the Library nav). Sequencing by content: the installed-state content (skillId/placed/connected) → CLI-1 (registry plus multi-root `ls --local`) → Desktop-1 (sidebar/Library from the scan, a checkout route, Settings checkouts) → the one-team content → CLI-2 (`--into`, pending identity, the missing-root check, sync over registered roots with the exclude fix, `uninstall-skill --from`) → CLI-3 (the Global package read model, `team project connect`/`create` under guard row d) → Desktop-2 (Marketplace packages and destination radios) after Teddy's boards.

Ratified in effect by Ryan's 2026-09-09 ruling (North Star).

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Registration: how a checkout enters the registry | LOCK | Automatic on writes (`install --into`, `connect` from, `publish` from) plus "Detected · not registered" rows with a one-click Add for the cwd repo, shared sources' roots and placements' roots. Registration only follows an action where the person already chose that folder, so the F10 refresh consent is never widened silently; it never connects folders (2026-09-07 per-folder connect ruling) and never approves grants. | — |
| 2 | Row count: what a Library row counts as a skill folder | LOCK | A skill folder is a directory holding a `SKILL.md`; name-mismatched ones are included and shown as not connectable; symlinks and non-skill shapes are excluded; the label is "skill folders". Measured: `~/.claude/skills` = 88 folders (86 name-mismatch rejections); the primary checkout = 13 folders, 7 connectable. | — |
| 3 | Non-git folders as checkouts | LOCK | Allowed. The `.git/info/exclude` courtesy is written only when `git rev-parse` succeeds; a plain folder is a Library row like any other. | — |
| 4 | Global package install: where it asks | LOCK | Asks once, default Global, and skips the question only when exactly one candidate destination exists. | — |
| 5 | `checkout remove` semantics | LOCK | Registry-only. Placements stay on disk and `status` reports them as unregistered; `--unplace` waits for destination-aware uninstall (D9). | frontmatter deferred (D5) |
| 6 | Shared scope for off-model destinations | LOCK | Scope = the package. A project-package skill placed anywhere records `{kind:'project', project}`; a Global-package skill placed anywhere records `{kind:'global'}`. Honest because the shared record never names a path (spec :199); old readers parse; D17 is rewritten to say scope = package. No refusal, no new kind, counts and facepiles right, one owner per state (package owns scope, machine owns location). | — |
| 7 | Terminal treatment of the cwd repo | LOCK | The cwd repo stays a labelled "not registered" section in `ls --local` and stays the cwd-derived install default. | — |
| 8 | Team project creation | LOCK | `team project connect [path]` (origin remote via install's normaliser, name = basename and renamable, writes `projects[name] = {remotes:[origin], skills:[]}` under a new guard row d, registers the checkout; worktrees sharing an origin resolve to the existing project; the app's "Add a checkout" gains "Also share as a team project"), with `create` as the fallback for a project with no local checkout. D8b: Global keeps its sync auto-offer as the one documented asymmetry. | frontmatter deferred (add-remote for forks) |
| 9 | Destination-aware uninstall | LOCK | `uninstall-skill --from global\|<root>`; the people-file record drops only when no copy at that scope remains; ships in CLI-2 before multiple destinations are common. | — |
| 10 | Cross-checkout refresh consent | LOCK | Registered = consented. Unregistered roots are skipped with one grouped notice, uniformly across refresh, pending replay and the orphan pass; the exclude-root bug is fixed in the same batch. | — |
| 11 | Sidebar and route identity | LOCK | The canonical root path travels in `?root=`; the folder name is only a label. | — |

Also recorded: MC-07 (the team switcher) remains cancelled; the Library and Marketplace are keyed by folder and package, not by a selected team. The installed-state batch's single `machine:projectRoot` preference is withdrawn in favour of the registry: one preferred root cannot express several registered checkouts, and the registry is CLI-owned so the terminal and the app read the same list.

---

## Decision 1 — Registration: how a checkout enters the registry

**Verdict: LOCK**

### Plain English
- **What's at stake:** The Library sidebar shows one row per checkout this machine has registered, and `sync` refreshes every registered checkout from any cwd. So the registry is also the list of folders the tool is allowed to write into on a person's behalf. Who adds a folder to that list, and when, decides whether a refresh can ever touch a folder the person never chose.
- **Why it's a fork:** Ryan's steer was "should be automatic", but "automatic" can mean three different things: register whenever the tool writes into a folder, register only on writes and nothing else, or register any repo a verb happens to run inside. The third is the widest and the most convenient; it is also the one where a folder becomes a refresh target because someone ran `ls` there.
- **Options:**
  - **A — Automatic on writes, plus detected rows with one-click Add.** *(decides it: `install --into`, `connect` from a folder, and `publish` from a folder register that folder; the cwd repo, shared sources' roots and placements' roots that are not yet registered appear as "Detected · not registered" rows with an Add button.)*
  - **B — Writes only.** *(decides it: the same three verbs register; nothing is detected or offered, so a checkout the person used before the registry existed never shows up until they write into it again.)*
  - **C — Any verb's cwd repo.** *(decides it: running any verb inside a repo registers it; the Library fills itself, and so does the refresh list.)*
- **Recommendation:** A. Every write verb already had the person choose the folder (the `--into` answer, the connect target, the publish source), so registering it widens nothing. The detected rows cover the pre-registry checkouts without guessing; the Add click is the action the North Star asks for. C registers folders on reads, which is exactly a refresh target appearing without an action the person took.
- **Zoom-out:** A and B both keep "nothing on disk becomes a refresh target without an action that person took". Only A also gets the existing checkouts into the Library, which is the half of the North Star about the Library being this machine's folders. C fails the refresh half.
- **The call:** A. Registration follows a write the person chose or an explicit Add; it never connects folders (the 2026-09-07 per-folder connect ruling stands: connect is its own action per folder) and never approves grants (approval stays with the F10 dialog and `approvals`).

### Technical
- **Files / code paths:** new `config.checkouts` on `configSchema` (`src/lib/schema.ts:95-109`), keyed by canonical root path (`realpath`, the same canonicalisation `localSkillRoots` applies to the global and project roots at `src/lib/local-skills.ts:57-59`). `install.ts` registers the `--into` root after a successful place; `connect` and `publish` register their source root. `localSkillRoots` (`local-skills.ts:29-61`) grows from "global plus the one cwd-derived project root" to "global plus every registered root plus the cwd-derived root flagged unregistered", and the detected list is the union of the cwd repo root, `dirname` of each `config.shared[*].source` and `dirname(dirname(path))` of each `config.placements` key that is not already registered. The app's Settings checkouts group and the Library sidebar read that scan; the Add button calls a `checkout add <path>` verb. Registration writes no `approvals` entry and no `shared` entry.
- **Migration / schema:** additive; `checkouts` defaults to `{}` in `emptyConfig`. Older CLIs ignore the key through `.passthrough()`.
- **Effort / risk / blast radius:** one schema field, one verb, three registration hooks, one scan change; footnote only. Risk is a duplicate row for the same folder reached by two paths, which canonical-path keys prevent.
- **Grounding findings:** `local-skills.ts:29-61` on origin/main discovers exactly two roots (global and the nearest `.git` above cwd) and compares them by `realpath`; there is no registry today. Ryan's steer on registration: "should be automatic". The 2026-09-07 per-folder connect ruling is in the Terum record; registration must not collapse into it.

---

## Decision 2 — Row count: what a Library row counts as a skill folder

**Verdict: LOCK**

### Plain English
- **What's at stake:** Each Library row shows a count. If the count means "folders that pass every validation rule", `~/.claude/skills` shows 2 and the person wonders where the other 86 went. If it means "directories holding a `SKILL.md`", it shows 88 and the rows that cannot be connected are visibly marked. The count is the first thing the person reads, and it has to match what they see on disk.
- **Why it's a fork:** The validator rejects a folder whose directory name does not match its `SKILL.md` name; the connect path relies on that. Counting only connectable folders keeps the count equal to what connect would accept; counting every `SKILL.md` folder keeps the count equal to what the person sees in Finder. Symlinks and folders with no `SKILL.md` are a separate question: they are not skill folders at all.
- **Options:**
  - **A — Directories holding a `SKILL.md`, name-mismatched included and marked not connectable; symlinks and non-skill shapes excluded; label "skill folders".** *(decides it: the count matches the disk; the mismatch shows as a state on the row, not as a missing row.)*
  - **B — Connectable folders only.** *(decides it: the count matches what connect accepts; 86 folders in Ryan's global directory vanish from the Library.)*
  - **C — Every directory entry, symlinks included.** *(decides it: the count matches `ls`; symlinked and empty directories show as skills they are not.)*
- **Recommendation:** A, as recommended by the investigation. The Library is this machine's folders; a folder with a `SKILL.md` is a skill folder whether or not it is ready to share. The not-connectable state on the row tells the person what to fix. Symlinks stay out because the placer already rejects them as distinct entries.
- **Zoom-out:** A is the only option where the Library row and the person's folder agree, which is the Library half of the North Star. B hides folders; C invents them.
- **The call:** A. Measured on origin/main: `~/.claude/skills` = 88 skill folders with 86 name-mismatch rejections; the primary checkout = 13 skill folders, 7 connectable.

### Technical
- **Files / code paths:** the scan in `src/lib/local-skills.ts` already distinguishes a canonical parent from a child symlink (`canonicalParentPath`, `:63-65`, "a child symlink must remain a distinct, rejected entry"); the row count is the number of directory entries with a readable `SKILL.md`, and the per-folder validation result (name mismatch, missing fields) is carried on the entry as its connectable state rather than filtering it out. `ls --local` prints the count with the "skill folders" label; the app's `library` read model (`desktop/src/backend/tauri/index.ts:257-260`) reads it from the scan instead of from `ls --team`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** a count and a per-row state; footnote only.
- **Grounding findings:** measured 2026-09-09 on Ryan's machine: 88 folders under `~/.claude/skills`, 86 rejected for name mismatch; 13 folders under the primary checkout's `.claude/skills`, 7 connectable. `local-skills.ts:63-65` keeps symlinks as rejected entries today.

---

## Decision 3 — Non-git folders as checkouts

**Verdict: LOCK**

### Plain English
- **What's at stake:** Some people keep skills in a plain folder that is not a git checkout. If a checkout must be a git repo, those folders can never be Library rows or install destinations, and the person is pushed to `git init` for no reason of their own.
- **Why it's a fork:** The one thing the tool does that needs git is the `.git/info/exclude` courtesy line that keeps placed skills out of the person's diff. Without git there is nothing to exclude from; everything else (scan, place, refresh) is plain filesystem work.
- **Options:**
  - **A — Allowed; the exclude courtesy only when `git rev-parse` succeeds.** *(decides it: a plain folder is a full Library row and destination; git-only behaviour degrades to nothing rather than to an error.)*
  - **B — Git checkouts only.** *(decides it: simpler placer invariants; plain folders are refused at `--into` and at Add.)*
- **Recommendation:** A. The North Star says the Library is this machine's folders, not this machine's repositories. The courtesy is a courtesy.
- **Zoom-out:** A serves the Library half directly; B narrows it for an implementation convenience.
- **The call:** A.

### Technical
- **Files / code paths:** the exclude write in the placer (reached from `src/commands/sync.ts:270` `place(source, root, skill.name, {…projectRoot, runner…})` and from install) becomes conditional on a successful `git rev-parse --show-toplevel` for that root; `currentRepoRoot` (`src/commands/install.ts:230-234`) throws today when there is no worktree and stays the resolver for the cwd default only, not for a registered root. `checkout add` accepts any readable directory.
- **Migration / schema:** none; `checkouts` entries carry no `git` flag, the check is live.
- **Effort / risk / blast radius:** one conditional; footnote only.
- **Grounding findings:** `install.ts:230-234` on origin/main: `currentRepoRoot` errors with "No git worktree is available for project placement." — the only git dependency on the placement path besides the exclude line.

---

## Decision 4 — Global package install: where it asks

**Verdict: LOCK**

### Plain English
- **What's at stake:** A skill in the team's Global package has no natural folder on this machine; it could go to `~/.claude/skills` or into any registered checkout. Ryan's ruling: "users should specific which local folder the skills should install into". The question is how often the tool asks and what it suggests.
- **Why it's a fork:** Asking every time is the literal reading; never asking (always Global) is the 0.1.7 behaviour; asking only when there is a real choice is the middle. Each is a different amount of friction for the same consent.
- **Options:**
  - **A — Ask once per install, default Global, skip only when exactly one candidate exists.** *(decides it: with Global and at least one registered checkout the person picks; with nothing registered the only candidate is Global and the question is not asked.)*
  - **B — Always ask.** *(decides it: a one-option question on a fresh machine.)*
  - **C — Never ask; Global package skills go to Global.** *(decides it: the 0.1.7 behaviour, which is the one Ryan ruled against.)*
- **Recommendation:** A. The person chooses where the skill goes whenever there is a choice; a question with one answer is not a choice. Default Global matches the package's name and the terminal habit.
- **Zoom-out:** A is "the two meet only when a person chooses where a skill goes" with no dead questions. C removes the choice.
- **The call:** A.

### Technical
- **Files / code paths:** `install` gains `--into global|<root>`; without it, the prompt lists Global plus every `config.checkouts` root, defaulting to Global for a Global-package skill and to the origin-remote match (`matchingProject`, `src/commands/install.ts:222-228`) for a project-package skill; when the candidate list has one entry the prompt is skipped and that entry is used. `selectScope` (`install.ts:235-240`) stops deciding the location; it decides only the shared scope (see D6).
- **Migration / schema:** none in `team.json`; the Global package is a read model over the existing `global` array.
- **Effort / risk / blast radius:** one prompt and one flag; footnote only.
- **Grounding findings:** `install.ts:235-240` on origin/main returns `{kind:'global'}` for every skill not endorsed by the matched project, and the placement root follows that scope; there is no destination question today.

---

## Decision 5 — `checkout remove` semantics

**Verdict: LOCK**

### Plain English
- **What's at stake:** Removing a checkout from the registry could also delete the skills the tool placed in it. If it does, a person tidying their sidebar deletes files; if it does not, the placed skills stay and the tool has to be honest that it no longer refreshes them.
- **Why it's a fork:** The registry is consent to refresh (D10); the placements are files the person asked for. Removing consent and removing files are two different actions, and the second needs the destination-aware uninstall (D9) to do correctly.
- **Options:**
  - **A — Registry-only; placements stay; `status` reports them as unregistered.** *(decides it: nothing on disk changes; the row leaves the sidebar; `status` says "placed, checkout not registered".)*
  - **B — Remove and unplace together.** *(decides it: one command deletes files from a folder the person may still use; before D9 the people-file record cannot be dropped correctly.)*
- **Recommendation:** A. Data loss from a sidebar tidy is the wrong failure. `--unplace` is a later flag once `uninstall-skill --from` exists to do the removal per destination.
- **Zoom-out:** A keeps the person's disk as their own; B lets a registry edit delete files.
- **The call:** A. `--unplace` is deferred behind D9 (frontmatter).

### Technical
- **Files / code paths:** `checkout remove <path>` deletes the `config.checkouts` entry only. `status` cross-references `config.placements` keys against registered roots and reports the unregistered ones. `sync` skips them under D10's grouped notice.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one verb, one status line; footnote only.
- **Grounding findings:** `src/commands/uninstall.ts:85/:100` is destination-blind today, so an unplace bundled here would have no correct way to drop the people-file record for one destination while a copy elsewhere survives.

---

## Decision 6 — Shared scope for off-model destinations

**Verdict: LOCK**

### Plain English
- **What's at stake:** When a teammate installs a project-package skill into a folder that is not that project's checkout, or a Global-package skill into a checkout, the shared people file still has to say what they installed. The scope it records is what the team's counts and facepiles are built from. Today scope and location are the same thing; after D4 they are not.
- **Why it's a fork:** Ryan's steer was "resolve this better" than the first draft's refusal. Three honest shapes exist: keep scope meaning "which package", add a new scope kind for "somewhere local", or write nothing shared for an off-model placement.
- **Options:**
  - **A — Scope = the package.** *(decides it: a project-package skill anywhere records `{kind:'project', project}`; a Global-package skill anywhere records `{kind:'global'}`; the location lives only in this machine's `placements`.)*
  - **B — A new `'local'` kind, readers first, refusal for a release.** *(decides it: one release where old CLIs refuse to parse a teammate's file until everyone upgrades.)*
  - **C — No shared record for off-model placements.** *(decides it: counts and facepiles undercount; a teammate who installed the skill does not appear to have.)*
- **Recommendation:** A. The shared record never names a path (spec :199), so "scope" was always the package, not the folder; A makes that explicit. Old readers parse it unchanged; counts and facepiles stay right; each state has one owner: the package owns scope, the machine owns location. D17 is rewritten to say scope = package.
- **Zoom-out:** A is the Marketplace half of the North Star: the team's packages are the team's, this machine's folders are this machine's, and the shared record only ever speaks about the first.
- **The call:** A.

### Technical
- **Files / code paths:** `scopeSchema` (`src/lib/schema.ts:26-28`) is unchanged. `selectScope` (`src/commands/install.ts:235-240`) computes scope from the package the skill was chosen from (the project whose `skills` list endorses it, else Global), independent of `--into`. `config.placements[path].scope` keeps the package scope and the path key carries the location; `sync`'s people-file check (`src/commands/sync.ts:211`, `sameScope(item.scope, entry.scope)`) keeps working because both sides still say the package. The pending queue identity (`samePending`, `install.ts:241`) gains the destination so two placements of one skill at one scope are distinct pendings (CLI-2). Spec: D17 amended; :199 unchanged.
- **Migration / schema:** none in the shared record.
- **Effort / risk / blast radius:** a rule change in one selector plus the pending identity; footnote only.
- **Grounding findings:** `schema.ts:26-28` on origin/main declares exactly two kinds with `.passthrough()`; eval-engine and people-file specs record scope with no path (spec :199). `sync.ts:211` matches installed records by `id` and `sameScope`.

---

## Decision 7 — Terminal treatment of the cwd repo

**Verdict: LOCK**

### Plain English
- **What's at stake:** Someone in a terminal inside a repo expects `ls --local` to show that repo's skills and `install` to default to it. Registration (D1) says a read never registers. The two have to coexist without the terminal quietly registering the cwd.
- **Why it's a fork:** Either the cwd repo is treated like any other unregistered folder (invisible until added) or it keeps its place in the terminal output as a clearly labelled section.
- **Options:**
  - **A — A labelled "not registered" section, and the cwd-derived install default.** *(decides it: `ls --local` shows the cwd repo under its own heading; `install` without `--into` still suggests it.)*
  - **B — Registered rows only.** *(decides it: the terminal habit breaks until the person adds the repo.)*
- **Recommendation:** A. It is the terminal equivalent of the "Detected · not registered" row in D1.
- **Zoom-out:** A shows a folder the person is standing in without making it a refresh target; consistent with D1 and D10.
- **The call:** A.

### Technical
- **Files / code paths:** `localSkillRoots` (`src/lib/local-skills.ts:29-61`) keeps its cwd walk and marks the result `registered:false` when the canonical root is not in `config.checkouts`; `ls --local` renders that section with the label. `install`'s default keeps using `currentRepoRoot` + `matchingProject` (`install.ts:222-234`).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** a flag on the scan and a heading; footnote only.
- **Grounding findings:** `local-skills.ts:29-61` derives the project root from cwd today with no notion of registration; `install.ts:222-228` derives the default project from the cwd origin remote.

---

## Decision 8 — Team project creation

**Verdict: LOCK**

### Plain English
- **What's at stake:** Ryan's ruling: team projects "should have to each be manually created" and show under Marketplace ▸ Team ▸ Projects. A project in `team.json` is a name, a list of remotes and a list of skills. The question is what the creating action looks like, and Ryan's steer was "shouldn't this be connect project?".
- **Why it's a fork:** Creating from a checkout (the remote is read from the folder) is what people have in front of them; creating by name alone covers a project nobody has cloned yet. Offering only one of the two either types a remote by hand or leaves a project uncreatable.
- **Options:**
  - **A — `team project connect [path]` with `create` as the fallback.** *(decides it: `connect` reads the origin remote through the same normaliser install uses, names the project after the folder's basename (renamable), writes `projects[name] = {remotes:[origin], skills:[]}` under a new guard row d, and registers the checkout; worktrees sharing an origin resolve to the existing project; the app's "Add a checkout" gains "Also share as a team project"; `create <name>` covers a project with no local checkout.)*
  - **B — `create` only.** *(decides it: the remote is typed; the folder is registered separately.)*
  - **C — `connect` only.** *(decides it: a project with no local checkout cannot exist.)*
- **Recommendation:** A. It is the steer, with the one case `connect` cannot cover handled by `create`. Skills still enter the project only through `publish`, so creating a project never moves a skill.
- **Zoom-out:** A keeps the Marketplace the team's packages (a project is created on purpose, by a person, with an empty skill list) and the Library this machine's folders (the checkout is registered because the person just pointed at it).
- **The call:** A. D8b: the Global package keeps its `sync` auto-offer; it is the one documented asymmetry between Global and a project, and it is documented rather than removed.

### Technical
- **Files / code paths:** `team project connect [path]` resolves the origin remote via `normalizeRemote` (used at `src/commands/install.ts:227`), finds an existing project whose `remotes` include it (the worktree case), else writes `projects[name] = {remotes:[origin], skills:[]}` through `safeWrite`. `src/lib/guard.ts:174-182` (row c) forbids project keys and remotes changing; a new row d permits adding a project with an empty `skills` array and an origin remote, and nothing else. `checkout add` runs for the path. The Global package is a read model over `team.json.global` (CLI-3). `add-remote` for a fork with a different origin is deferred (frontmatter).
- **Migration / schema:** `team.json` shape unchanged; the guard gains a row.
- **Effort / risk / blast radius:** one verb pair, one guard row, one app checkbox; footnote only. Risk is a guard row that lets a remote list change; row d is scoped to a new key with an empty skills list.
- **Grounding findings:** `guard.ts:174-182` on origin/main: "Row c: `global` and `projects[].skills` only — project keys, remotes, and every other field are untouchable." `install.ts:222-228` already matches a checkout to a project by normalised origin remote.

---

## Decision 9 — Destination-aware uninstall

**Verdict: LOCK**

### Plain English
- **What's at stake:** Once a skill can be installed into more than one folder on the same machine, "uninstall" has to say which copy. Today it removes every placement matching the id and scope and drops the shared record, which after D4 would remove a copy the person did not ask about and tell the team they no longer have a skill they still have.
- **Why it's a fork:** The record can drop when any copy is removed, when the last copy at that scope is removed, or never. Only the middle is honest for both the machine and the team.
- **Options:**
  - **A — `uninstall-skill --from global|<root>`; the people-file record drops only when no copy at that scope remains.** *(decides it: one destination per call; the team record follows the last copy.)*
  - **B — Keep the scope-wide uninstall.** *(decides it: multiple destinations at one scope are removed together.)*
- **Recommendation:** A, shipped in CLI-2 before multiple destinations are common, so no release has the scope-wide behaviour meeting the per-destination install.
- **Zoom-out:** A keeps the person in charge of which folder changes and the shared record true; it is D6's "one owner per state" applied to removal.
- **The call:** A.

### Technical
- **Files / code paths:** `src/commands/uninstall.ts:85` filters placements by `id`, `team` and `sameScope` only; it gains a root filter from `--from`. The `safeWrite` at `:92-100` drops `person.installed` entries by id and scope; it now drops only when `placements` has no surviving entry with that id and scope on this machine. The `declined` guard already present (`:101-104`) stays.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** a filter and a condition; footnote only.
- **Grounding findings:** `uninstall.ts:85/:100` on origin/main are destination-blind; the comment at `:101-104` already notes the scope-wide suppression hazard for the `declined` list.

---

## Decision 10 — Cross-checkout refresh consent

**Verdict: LOCK**

### Plain English
- **What's at stake:** `sync` refreshes placed skills. Today it only inspects the project checkout matching the cwd; a placement in another checkout is skipped, and when it is reached the exclude courtesy line is written into the wrong checkout. After D1 the registry is the list of folders `sync` may refresh from any cwd. Anything placed in a folder that is not registered needs a rule.
- **Why it's a fork:** Unregistered roots could be refreshed anyway (they are in `placements`), skipped silently, or skipped with a notice. Refreshing them is a write into a folder without registration; silence hides a stale skill.
- **Options:**
  - **A — Registered = consented; unregistered roots skipped with one grouped notice, uniformly.** *(decides it: refresh, pending replay and the orphan pass all skip the same set and say so once.)*
  - **B — Refresh every placement regardless.** *(decides it: a folder the person removed from the registry is still written to.)*
  - **C — Skip silently.** *(decides it: a stale placement nobody is told about.)*
- **Recommendation:** A. The exclude-root bug is fixed in the same batch so the first cross-checkout refresh is a correct one.
- **Zoom-out:** A is the refresh half of the North Star verbatim: registration is the action that makes a folder a refresh target.
- **The call:** A.

### Technical
- **Files / code paths:** `src/commands/sync.ts:206` (`matchingProjectRoot(clone, entry.scope.project, runner, args.cwd)`) is replaced by the registered root containing the placement path; `:237` (`const root = dirname(path)`) stays the placement root, but the `projectRoot` passed to `place()` at `:270` must be that placement's own checkout root, not the cwd's, which is the exclude-root bug. The three passes (refresh at `:200-`, pending replay above it, the orphan pass) share one predicate and one grouped notice. Non-git roots skip the exclude line (D3).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** a resolver swap and a shared skip list; footnote only. Risk is a placement whose root is registered under a different canonical path, which canonical keys cover.
- **Grounding findings:** `sync.ts:206-208` on origin/main skips a project placement whenever the cwd does not match ("Project placement is worktree-local"); `:270` passes the cwd-derived `projectRoot` into `place()`, so the exclude line lands in the cwd checkout rather than the placement's.

---

## Decision 11 — Sidebar and route identity

**Verdict: LOCK**

### Plain English
- **What's at stake:** Two checkouts can share a folder name (two clones of the same repo, or `app` in two places). If the sidebar route uses the name, the two rows open the same screen.
- **Why it's a fork:** Name is readable; path is unique. The route can carry one or the other.
- **Options:**
  - **A — Canonical root path in `?root=`; the folder name only as the label.** *(decides it: rows are unique; the label is what the person recognises.)*
  - **B — Folder name in the route.** *(decides it: collisions; the app has to invent suffixes.)*
- **Recommendation:** A, matching the registry key.
- **Zoom-out:** A keeps the Library an honest list of this machine's folders, one row per folder.
- **The call:** A.

### Technical
- **Files / code paths:** `desktop/src/components/domain/Sidebar.tsx:15` today renders project rows from team project names (`#/library/project/<name>`); Desktop-1 renders one row per registered checkout from the scan, `href="#/library/checkout?root=<encoded canonical path>"`, label = basename. `desktop/src/backend/tauri/index.ts:118` (`projects:null`) and the `library` read model at `:257-260` (which runs `ls project <scope> --team`) switch to the multi-root scan keyed by root. Settings' checkouts group uses the same key.
- **Migration / schema:** none; the route is new.
- **Effort / risk / blast radius:** a route and a key; footnote only.
- **Grounding findings:** `Sidebar.tsx:15` on origin/main keys rows by `name` and compares `selected.toLowerCase()===name.toLowerCase()`; `tauri/index.ts:118` sets `projects:null` on the real adapter and `:257-260` derives the library from `ls`.

---
