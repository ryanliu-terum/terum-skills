---
title: marketplace bulk-install destination decision walk
date: 2026-09-10
north_star: When someone installs a team project's skills, they choose where the skills land, and the app's own words match what actually happened.
status: complete
deferred:
  - what: The interim copy fix for the project install dialog, which says today that skills go into the current repo and that running outside a checkout copies nothing — both false (D5)
    gate: the picker has not merged by the next desktop release dispatch — then the copy fix ships on its own, board re-render included
  - what: The final wording of the install dialog once the picker exists; Teddy's call, constrained only to describe what the picker does rather than where installs happen to land (D5)
    gate: the picker implementation reaching a reviewable state
---

# Marketplace bulk-install destination — Decision Walk

**North Star:** When someone installs a team project's skills, they choose where the
skills land, and the app's own words match what actually happened. *(Ratified by Ryan,
2026-09-10, over the narrower "the app never says anything false about where it put
files" — the narrow framing would have made the copy-only fix sufficient.)*

**Widened at D4 (Ryan, 2026-09-10):** read as *any bulk install*, not only a project's.
The reason the goal was chosen — nobody should be surprised by where files land — applies
identically to "install everything <teammate> shared", so person installs are in scope.

Context: surfaced 2026-09-10 from Ryan's question *"what does bulk installing from a
project in marketplace look like? does it give you the option to select which local
folder to install to?"* Answer: it does not. Code read from `origin/main` 296fa00; the
primary checkout is on `feat/frame-mode`, which has no `desktop/`.

## What is actually happening today

Marketplace ▸ Projects ▸ *a project* ▸ **Install N skills** opens `InstallDialog`
(`desktop/src/screens/marketplace/MarketplaceScreen.tsx:76`), which shows the tool grants
the project's skills ask for, a terminal hint, and Cancel / Install. There is no
destination control. The confirm calls `backend.install({ ref, kind: 'project', project:
ref })` with no `scope` (`MarketplaceScreen.tsx:91`), and the adapter defaults a missing
scope to `into = 'global'`, running `install --into global -- project <key>`
(`desktop/src/backend/tauri/index.ts:718`). Every app-driven project install therefore
lands in `~/.claude/skills`, machine-wide.

The dialog's own description says the opposite — that the skills are placed into "this
repo's `.claude/skills`" and that running from outside a checkout "exits and copies
nothing". Neither is true of the app.

**Standing team decision this violates** (Terum, ryanliu, 2026-09-09, verified,
`0a469233-b579-4957-9328-206139e14bdb`):

> Decided that team-package installation asks for a local destination instead of guessing
> from the current working directory or team metadata, because users must control whether
> skills land in Global or a specific checkout.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Does an app project install ask where the skills go? | LOCK | Already ruled 2026-09-09; the app is simply non-conforming | — |
| 2 | What the picker pre-selects | LOCK | Pre-tick the folder matching the project's remote — the CLI's own rule; a visible default is still the person's call | — |
| 3 | No registered checkouts at all | LOCK | End the list with "Add a project folder…" so the empty case stops being a special case | — |
| 4 | Member ("install everything from X") bulk installs | LOCK | Same dialog, same picker, default Global — both bulk buttons answer "where did this go?" the same way | — |
| 5 | Interim dialog copy + the locked board | GATE | No interim rewrite; the true sentence ships with the picker | interim copy fix ships alone if the picker has not merged by the next desktop release dispatch |
| 6 | Does the picker sit behind `features.installScope`? | LOCK | Yes — not a real fork; without it an app newer than its CLI draws a picker whose choice the CLI would reject | — |

---

## Decision 1 — Does an app project install ask where the skills go?

**Verdict: LOCK — it asks.**

### Plain English
- **What's at stake:** whether clicking Install on a team project silently switches those
  skills on for every project on the machine, or puts them where the person wanted them.
- **Why it's not really a fork:** Ryan already decided this on 2026-09-09 — team-package
  installs ask for a destination, because the person must control whether skills land in
  Global or a specific checkout. The app not asking isn't an open design question; it's a
  gap between the app and a standing ruling.
- **The call:** the app asks. What stays open is *how* it asks — the default, the
  empty-library case, and whether teammate installs get the same treatment (D2–D4).
- **Zoom-out:** this is the North Star's first half almost verbatim, so it fits by
  construction.

### Technical
- **Files / code paths:** `MarketplaceScreen.tsx:76` (`InstallDialog`), `:91` (`install()`
  with no `scope`), `desktop/src/backend/tauri/index.ts:718` (`into = 'global'` default).
- **Already built:** `InstallArgs.scope` is a Library-root label the adapter resolves
  through `ls --local` and passes as `install --into <root>`; the single-skill dialog
  already renders it as an "Install to" radio group
  (`desktop/src/screens/skill/SkillScreen.tsx:131`). The plumbing exists; the bulk path
  skips it.
- **Blast radius:** `#/marketplace/projects/docs?dialog=install` is a locked fidelity
  board (`desktop/e2e/fidelity/boards.ts:363`, 0.35% dialog tolerance in
  `tolerance.ts`), so the dialog cannot change shape without a re-rendered board.
- **Grounding findings:** verified against `origin/main` 296fa00 by reading the four files
  above plus `src/commands/install.ts`.

---

## Decision 2 — what the picker pre-selects

**Verdict: LOCK — option A.**

### Plain English
- **What's at stake:** the picker lists Global plus the folders the person registered.
  Whichever row is already ticked is where most installs actually land, because most
  people accept the default and press the button. This choice, not the picker, decides
  the real outcome.
- **Why it's a fork:** the 2026-09-09 ruling's words say installs should ask *"instead of
  guessing from the current working directory or team metadata"*, and pre-ticking the
  folder that matches the project's remote is a guess from team metadata. Its stated
  reason — *"users must control"* — points the other way: a tick mark you can see and
  change is control; the invisible guess is what was banned.
- **Options:**
  - **A — pre-tick the folder whose git origin matches the project's remote**, Global when
    none matches, nothing when two match. *(The difference that decides: the only option
    where the common case is one click, and it makes the app agree with the CLI.)*
  - **B — nothing pre-ticked**, Install disabled until a row is chosen. *(The difference:
    no guess at all, at the price of a forced decision on every install, forever.)*
  - **C — always pre-tick Global.** *(The difference: defaults are what people accept, so
    project skills keep landing machine-wide and the picker is decorative.)*
- **Recommendation:** A — the ruling's purpose is that the person controls the outcome,
  and a visible pre-tick they can change is control.
- **Zoom-out:** B and C both satisfy "they choose" on paper; C satisfies it in name only.
  A satisfies it and makes the right thing the easy thing.
- **The call (Ryan, 2026-09-10):** A. Fits the North Star for the reason the 2026-09-09
  ruling gave — the person still decides, and the app's guess is visible and one click
  from being overruled, which is control rather than a decision made for them.

### Technical
- **No new data needed.** `Root` carries `remote?: RootRemote|null` on `status().roots`
  (`desktop/src/backend/types.ts:66`), sourced from `ls --local`'s per-section `remote`,
  which the CLI derives from `git remote get-url origin` per registered root
  (`src/commands/ls.ts:26,116-118,180`). Project remotes are already on the catalog card.
- **The CLI's rule, to copy:** `resolveDestination` normalises each registered root's
  origin against the project's `remotes` and pre-selects the single match; no match →
  Global; several matches → no default (`src/commands/install.ts:257-262`).
- **Cost:** A is the match plus three tests (one match / none / several). B is cheapest —
  no matching logic. C is nearly free.

### Grounding — what "registered checkout" means *in the app* (verified 2026-09-10)

Asked by Ryan mid-walk; the answer reshapes D3.

- There is one registry, the CLI's: the `checkouts` list in `~/.terum/skills/config.json`.
  The app has no registry of its own; it reads and writes that one.
- A folder joins it from inside the app three ways: **Library ▸ Add project** (native
  folder chooser → `backend.checkouts.add`, `LibraryScreen.tsx:41`, `Sidebar.tsx:28`);
  **Settings ▸ Checkouts** (paste a path, or Add a *Detected · not registered* row,
  `SettingsContent.tsx:31,80`); or implicitly, by being chosen as an install destination
  (`registerCheckout` inside `resolveDestination`).
- Registration is explicitly not sharing: it connects nothing and approves no grant, and
  removing it forgets the path without touching disk (Settings copy, today).
- **The app cannot do CWD discovery at all.** The CLI in a terminal also picks up the
  nearest git repo above the working directory as a *detected* root
  (`src/lib/local-skills.ts:70-76`); the Tauri shell spawns the CLI with its cwd set to
  `~/.terum/skills`, or `/` on a Dock launch (`desktop/src-tauri/src/lib.rs:84-87`), so
  nothing is ever auto-discovered in the app. The picker list is exactly **Global + what
  the person registered**.
- Consequence for D3: a person who has registered nothing sees a one-row picker. Whether
  that dialog should appear at all is now the live question, not a corner case.

---

## Decision 3 — what the destination section shows when there is nothing but Global

**Verdict: LOCK — option B.**

### Plain English
- **What's at stake:** someone who has registered no folders — every new user — would see a
  destination list with one row. For them "you choose where it lands" is true on paper and
  empty in practice. The dialog itself is not in question; it exists anyway, because it is
  also where tool grants are approved. Only the **Install to** section is.
- **Why it's a fork:** a one-row radio group is a question with one answer. But hiding the
  section tells that person machine-wide is their only option, when the truth is they have
  options they have not set up — and the moment they most want their Docs checkout
  registered is the moment they are installing Docs' skills.
- **Options:**
  - **A — a plain "Global · ~/.claude/skills" line, no radios**, exactly what
    `SkillScreen.tsx:131` already renders when there are no other scopes. *(The difference:
    free and consistent, but that person cannot reach a project folder without cancelling,
    going to Library, adding it, and starting over.)*
  - **B — always end the list with "Add a project folder…"**, which opens the native
    chooser, registers the pick and selects it. *(The difference: the only option where the
    person who cannot currently choose gets to, in the moment they care.)*
  - **C — render the single radio anyway.** *(The difference: none — A with worse manners.)*
- **Recommendation:** B — it removes the special case instead of designing for it.
- **Argument against B, recorded:** it puts a filesystem chooser inside a modal that is also
  asking for tool-grant approval — two consequential, unrelated asks in one dialog — and it
  adds a control no design board has drawn, a larger ask of Teddy than radios, which at
  least exist on `SkillDetailInstall`.
- **Zoom-out:** A and C serve the North Star only for people who have already done setup
  work. B makes "they choose" true for everyone.
- **The call (Ryan, 2026-09-10):** B.

### Technical
- **Both halves are on the seam already:** `backend.pickFolder()` → `backend.checkouts.add()`
  is what Library's **Add project** does (`LibraryScreen.tsx:35-42`, `Sidebar.tsx:28`).
- **Conceptually free:** `resolveDestination` already registers a folder as a side effect of
  `install --into <path>` (`src/commands/install.ts:245-248`), so choosing a new folder here
  invents no new rule.
- **Gating:** Library hides its own Add project on a CLI without `checkout add`
  (`features.checkouts`); the row here must hide the same way, leaving A's static line as
  the degraded shape on an older CLI.

---

## Decision 4 — do teammate ("install everything from X") bulk installs get the same picker?

**Verdict: LOCK — option A, the same dialog and picker, default Global.**

### Plain English
- **What's at stake:** the Marketplace has two bulk-install buttons. The project one now
  asks where skills go. The person one opens no dialog at all — it fires straight into
  Global (`MarketplaceScreen.tsx:95`, `q ? param('dialog','install') : void install()`).
  Tool-grant approvals still appear, because those come from the CLI mid-run, but nothing
  tells or asks the person where the files are going.
- **Why it's a fork:** the 2026-09-09 ruling names *team-package* installs. "Everything
  Lena shared" is a multi-skill install with the same consequence, so the ruling's reason
  applies word for word — but a person is not a repository, their skills span projects,
  there is no remote to match, and D2's matching rule can never fire. The answer will be
  Global nearly every time, so this adds a modal whose default is almost always right.
- **Options:**
  - **A — same dialog, same picker, default Global.** *(The difference: the only option
    where a teammate's skills can go into one repo instead of being switched on
    everywhere, and where the two Install buttons stop behaving differently for no visible
    reason.)*
  - **B — leave person installs alone.** *(The difference: stays one click, at the cost of
    two bulk paths answering the same question differently — the exact confusion this walk
    exists to end.)*
- **Recommendation:** A, with the person dialog deliberately thin — destination and the
  grants preview, no project-specific copy.
- **Zoom-out:** strictly read, the ratified North Star covered projects only. Ryan widened
  it rather than stretching the frame silently (see the North Star note above).
- **The call (Ryan, 2026-09-10):** A.

### Technical
- **No new board needed.** `boards.ts` draws `MarketplacePerson` and
  `MarketplacePersonNotInstalled` and nothing else — no person install dialog exists. The
  team-projects work already set the precedent for this exact case: a new dialog with no
  design-canvas board sits outside the fidelity gate. So A means writing a dialog, not
  commissioning a board; the render is needed only for the project dialog, already drawn.
- **Seam:** unchanged — `install({ ref, kind: 'member', member, scope })`; the adapter's
  existing label→root resolution covers it.

---

## Decision 5 — what the dialog says between now and when the picker ships

**Verdict: GATE — no interim rewrite; the true sentence ships with the picker.**
**Tripwire: if the picker has not merged by the next desktop release dispatch, the copy
fix ships on its own.**

### Plain English
- **What's at stake:** the sentence on screen is false in two specific ways — it says the
  skills go into the current repo's `.claude/skills`, and that running from outside a
  checkout copies nothing. Once the picker ships, that text is rewritten anyway, so this is
  only about the gap in between.
- **Why it's a fork:** there is no free copy fix. The project install dialog is a locked
  board at 0.35% tolerance (`boards.ts:363`, `tolerance.ts`), so any reworded sentence
  needs a design call and a board render — and an interim means paying that twice, to say
  two different things, the first of which documents as intentional the behaviour ruled
  against on 2026-09-09.
- **Options:**
  - **A — no interim; correct copy ships with the picker.** *(The difference: one design
    conversation and one render, at the price of misleading everyone who installs a project
    before then.)*
  - **B — interim copy fix now.** *(The difference: the lie stops today, at two renders and
    two copy decisions for one paragraph.)*
- **Recommendation:** A, gated — A is only defensible while the picker is actually coming,
  so the tripwire stops "we'll fix it with the feature" becoming "we shipped a false dialog
  for a month."
- **Zoom-out:** this is the North Star's second half. A satisfies it later, B satisfies it
  now and then costs it again; the tripwire is what keeps A honest.
- **The call (Ryan, 2026-09-10):** A, gated as proposed.

### Technical
- **Only the project dialog is gate-bound.** The D3 **Add a project folder…** row and the
  D4 person dialog have no design board, and the team-projects precedent puts an undrawn
  dialog outside the fidelity gate.
- **Final wording is Teddy's**, with one constraint from this walk: it must describe what
  the picker does, not where installs happen to land.

---

## Decision 6 — does the picker sit behind `features.installScope`?

**Verdict: LOCK — yes, gated; and the Add-folder row gates on `features.checkouts`.**

### Plain English
- **What's at stake:** whether the picker draws unconditionally or only when the CLI on the
  machine has announced it can honour install scopes.
- **Not a real fork, recorded as such:** without the gate, someone running an app newer
  than their CLI sees radios, picks a repo, and gets an error from the CLI at the end of
  the run instead of a graceful fallback before the click. Ryan's own framing: *"isn't it
  necessary to gate it then?"* — yes.
- **The one genuine judgment:** which switch gates which control. The picker needs the CLI
  to honour `install --into`, which is what `installScope` announces; the D3 **Add a
  project folder…** row needs `checkout add`, which is what `checkouts` announces. Two
  flags, each gating the capability it actually names — the rule Library already follows
  for its own Add project button.
- **The call (Ryan, 2026-09-10):** gated.

### Technical
- **How the gate works:** the CLI's first frame on every app-launched run is `hello`,
  carrying versions, public verbs and the `FRAME_FEATURES` switches
  (`src/lib/frames.ts:42`); the adapter caches it and serves `useFeatures()`, and a key an
  older frame omits reads as `false`. `SkillScreen.tsx:131` is the pattern to copy:
  switch on → `RadioGroup` of `installScopes`; switch off → the static `Global` block.
- **Live meaning is version skew only.** `installScope` is hard-coded `true` in
  `FRAME_FEATURES`, and the app launches whichever CLI `~/.terum/skills/run/app.json`
  records, which can predate it. App and CLI ship together, so only a hand-mixed pair ever
  sees the fallback.
- **Fallback shape is already written** — D3's option A line — so the degraded path costs
  nothing new.
