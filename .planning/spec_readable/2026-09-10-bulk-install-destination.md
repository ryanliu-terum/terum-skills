> readable companion to .planning/specs/2026-09-10-bulk-install-destination.md

# Letting people choose where bulk-installed skills go

## What this is

Today, when someone opens the Marketplace in the desktop app, picks a team project, and clicks
**Install 3 skills**, the app puts those skills in the machine-wide folder — switched on for every
project on the computer — and shows them a sentence saying it put them in their repository instead.
This spec adds a destination chooser to that dialog, and to the equivalent "install everything this
teammate shared" button, so the person decides where the files land and the app stops describing
something that never happened.

It helps anyone installing more than one skill at a time, and it closes a gap between the app and a
ruling Ryan made on 2026-09-09: installing a set of team skills is supposed to ask where they go,
never guess.

## What it does

**Where the problem lives.** The project dialog is a component called `InstallDialog` in
`desktop/src/screens/marketplace/MarketplaceScreen.tsx`. It shows which of the project's skills want
tool permissions, prints the equivalent terminal command, and offers Cancel and Install. Nothing in
it mentions a folder. When you confirm, the screen calls the app's install function without saying
where to put anything, and the layer that talks to the command-line tool fills in the blank with
"machine-wide" and runs `install --into global`. So the destination is decided by a default nobody
chose, three layers away from the button.

**The list the person will see.** The dialog grows a section headed *Install to*, listing:

- **Global** — the machine-wide folder, loaded in every session, described as `~/.claude/skills`.
- **One row per project folder the person has registered** with Terum, showing the folder's name and
  its path.
- **Add a project folder…** as the last row.

That list is the complete set of places the app can install to. Worth knowing why: when you run the
command-line tool in a terminal, it also notices whatever git repository you happen to be standing
in, even one it has never been told about. The app cannot do that, because it has no meaningful
"current folder" — the desktop shell launches the command-line tool from Terum's own storage
directory, or from the filesystem root when you start the app from the Dock. So in the app there is
no such thing as "the repo I'm in", only Global plus folders the person deliberately registered.

**Which row starts out chosen.** A team project in Terum records the address of the repository it
belongs to. Every registered folder on the machine reports the address of the repository it is a
copy of. The app compares the two:

- exactly one folder matches the project's repository → that folder is pre-selected, so the common
  case is a single click;
- no folder matches → Global is pre-selected;
- two or more folders match, meaning the person has two copies of the same repository → nothing is
  pre-selected and the Install button stays disabled until they pick one.

That is deliberately the same rule the command-line tool already applies when you run it by hand, so
the two stop giving different answers to the same question.

**Adding a folder without leaving the dialog.** The last row opens the standard macOS folder chooser.
If the person picks a folder, the app registers it with Terum, refreshes the list, and selects the
new folder as the destination. If they close the chooser without picking, nothing happens at all. If
registering fails, the dialog shows the command-line tool's own explanation in the error line it
already has, and whatever was selected before stays selected. Both pieces of machinery already exist
— this is exactly what the **Add project** button in the Library screen does.

**What the confirm button now sends.** Instead of calling install with no destination, the screen
passes the selected row's name along. "Global" keeps the existing machine-wide path; any other name
is looked up against the registered folders and becomes `install --into <that folder>`. The tool
permission questions that appear mid-install are untouched, and declining one still cancels the whole
thing, exactly as today.

**The teammate button gets the same dialog.** Clicking *Install 3 skills* on a person's page
currently installs immediately, with no dialog — you are never told or asked where the files go. That
button will now open the same dialog, with the same destination list. A person is not a repository,
so there is nothing to match against and Global is simply the default.

**When the CLI is too old to help.** The app and the command-line tool are separate programs, and the
app runs whichever copy is installed on the machine. On startup the tool announces what it can do.
If it does not claim support for install destinations, the dialog falls back to a plain "Global" line
with no choices — the same fallback the single-skill install dialog already shows. If it does not
claim support for registering folders, the **Add a project folder…** row is hidden. Each control is
gated on the capability it actually needs.

**One change beneath the surface.** The comparison described above cannot be written against the data
the app currently has. The layer that builds project data keeps only the *first* of a project's
repository addresses, and keeps it as a raw web address, while folders report theirs in a shortened
`owner/repository` form. Comparing those two never matches. So the spec adds a new field to the app's
project record holding *every* one of the project's addresses, each converted to the short form using
a conversion helper that already exists in that same file. The existing address field is left alone,
because other screens display it.

**What gets written.** A new small file holding the comparison logic as one plain function with no
dependencies, so it can be tested on its own; edits to the project data type, the layer that builds
it, the fake backend used in tests, the Marketplace screen itself, and the Marketplace stylesheet.

## Decisions made

- **The app asks instead of defaulting.** Not a fresh judgment — Ryan ruled on 2026-09-09 that
  installing a set of team skills asks for a destination, because people must control whether skills
  land machine-wide or in one project. The app never implemented it.
- **A pre-selected folder is still the person's choice.** The ruling banned the app silently guessing;
  a visibly ticked row anyone can change is different from a hidden decision, and it makes the normal
  case one click.
- **Copy the command-line tool's matching rule exactly**, including the awkward case where two copies
  of the same repository are registered and the app therefore refuses to guess — so that the app and
  the terminal never disagree about where a project belongs.
- **Always offer to add a folder**, rather than designing a special empty state. Someone who has
  registered nothing would otherwise see a list with one entry and no way forward at the exact moment
  they care, and both halves of the machinery already exist.
- **Teammate installs get the same treatment**, because the consequence is identical and two buttons
  that answer "where did my files go?" differently is the confusion this work exists to end.
- **No interim wording fix.** The dialog's false sentence stays until the chooser ships with truthful
  wording — unless the chooser has not merged by the next desktop release, at which point the wording
  fix ships alone. Reason: the dialog's appearance is pixel-locked against a design reference, so
  *any* wording change costs a design decision and a re-render; doing it twice buys a sentence that
  would then be retracted.
- **Add every repository address, not just the first.** Forced by the comparison rule: the current
  data would fail to match anything and would ignore a project's second address.

## Still to build

- A new file with the destination-list function: which rows to show, which one starts selected, and
  whether the add-a-folder row appears.
- Add the repository-address list to the app's project type.
- Fill that field in the layer that talks to the command-line tool, converting every address to the
  short form and dropping any that will not convert.
- Fill it in the fake backend used by tests, arranged so at least one fixture project pre-selects a
  folder and another falls back to Global.
- Rework the install dialog to take a project *or* a person, show the destination section above the
  permissions section, and reuse the same radio-button components the single-skill dialog uses.
- Reuse the status information the screen already loads rather than fetching the folder list a second
  time.
- Pass the chosen destination through to the install call.
- Make the teammate Install button open the dialog instead of installing immediately.
- Disable Install while nothing is selected, which happens only in the two-matching-folders case.
- Add stylesheet rules for the destination list and the add-a-folder row.
- Tests: the list function on its own; the dialog's behaviour including choosing, adding a folder,
  cancelling the chooser, a failed registration, the disabled state, and the old-CLI fallback; and the
  address-conversion behaviour. Every new test must be shown to fail before the fix.

## After you ship

- **Teddy has to write the dialog's new description.** The current sentence is false and the
  replacement must describe what the chooser does rather than where installs happen to land. The work
  cannot merge without it — shipping a chooser under contradictory wording is worse than today.
- **Teddy also owns three smaller strings:** the add-a-folder row's label, the teammate dialog's title
  and description, and the sentence explaining why nothing is pre-selected when two folders match. The
  spec suggests wording for all three so implementation is not blocked, but they are his call.
- **The design reference image has to be re-rendered on Ryan's Mac** once the wording is final. The
  project install dialog is compared pixel-for-pixel against a stored image with a very tight
  tolerance, and a whole new section is far outside it. Until that happens the visual test fails.
  The teammate dialog and the add-a-folder row need no reference image, because no design board draws
  them.
- **A deadline is already attached.** If this has not merged by the next desktop release, the wording
  fix ships on its own and this work rebases on top of it.

## Related specs

- `.planning/specs/2026-09-09-team-projects-in-app.md` — the work that created team projects in the
  app and their repository addresses in the first place. It records the same matching behaviour in
  the command-line tool, and it introduced the precedent this spec leans on: a new dialog that no
  design board draws sits outside the pixel-comparison test.
- `.planning/specs/2026-09-10-w03w04-skill-routing.md` (on `origin/main`) — the recently shipped work
  that made a skill open from the folder that actually holds it. It touches the same screens and the
  same idea that a folder, not a name, is what identifies a copy on this machine.
- `.planning/decisions/2026-09-10-marketplace-install-destination-decision-walk.md` — not a spec, but
  the record of the six decisions this spec implements, with the reasoning and the rejected options.

## Sanity-check flags — where to look hard

**Most questionable decision — 4/10: refusing to pre-select anything when two registered folders
point at the same repository.** It is copied faithfully from the command-line tool, which is the
argument for it, but a terminal prompt and a dialog are not the same thing: in the terminal the
person is already typing, whereas here they meet a dialog with a greyed-out button and must work out
why. Rated low because the situation is rare and the alternative — silently picking one of two
identical-looking folders — is worse. Worth deciding whether the explanatory sentence is enough.

**Most likely to break — the destination list going stale after a folder is added.** This is grounded
in how the screen fetches data: the folder list comes from a cached status request, and the same
screen already holds a second cached request for the catalog. After registering a new folder the
dialog has to invalidate and refetch that status, then re-derive the list *and* move the selection to
the new folder, all while the dialog stays open. The spec says to do it; it does not say what the
dialog shows during the refetch. The likely bug is a moment where the new folder is absent or the
selection resets to the pre-selected default, silently sending the install somewhere the person did
not choose. A second, smaller version of the same risk: the underlying radio component is a standard
controlled group, so the "nothing selected" state has to be a value it accepts rather than something
improvised.

**Hardest to implement — reshaping the install dialog to serve both a project and a person.** The
dialog currently assumes a project everywhere: its title, its description, its permissions list, and
the count on its button all read from project data. Making it accept either kind of subject touches
every line of it, and the surrounding screen is written in a deliberately dense one-line-per-component
style that must be matched. The teammate path also has no permissions preview today, so that data has
to be assembled for a person as well.

**Least clear part — 5/10: what the teammate dialog actually shows in its permissions section.** The
spec says the person dialog is "destination section + grants preview + Cancel/Install" and leaves it
there. For a project, that preview is built by looking up each of the project's skills and listing
the permissions they ask for. Nothing in the spec says where the equivalent list comes from for a
person, whether the same "2 of 3 ask" counter appears, or what it shows when the data is not
available. Worth pinning down before building, because it is the one place where the teammate path is
not simply the project path with a different label.
