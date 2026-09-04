# Team skill sharing: distribution, membership, UI, and share flow

**Status:** Decision ledger, synced 2026-09-03 to the completed decision walk (`.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md`) and to the phase-1 build spec. **The build spec `.planning/specs/2026-09-02-phase-1-build.md` (rev 8, 2026-09-03) exists and is BUILD-READY; where this ledger and that spec disagree, the build spec is authoritative.**
**Date:** 2026-09-01 (synced 2026-09-02)
**Author:** Ryan Liu, drafted with Claude in a design session
**Inputs:** Teddy and Ajay's verbal suggestion of a self-hosted Docker image over a per-person monorepo (not in Terum's record; taken from Ryan's summary). Team whiteboard session 2026-09-02 (photos: skill object schema, scoped repo layout, marketplace UI, skill detail page) — its scoping, categories, and usage-signal ideas ratified into D14/D17/D19/D37/D38 and section 3.3 the same day. Terum records cited in section 8.
**Names:** Locked by walk Decision 1: CLI binary and npm package `terum-skills`, state under `~/.terum/skills/`. `acme` stands in for a team, `ryan` and `teddy` for members.

## 0. How to read the status tags

- **DECIDED** — Ryan built subsequent design questions on it in the session. Treat as settled unless reopened.
- **PROPOSED** — recommended in the session, not yet confirmed. Cheap to change now.
- **OPEN** — still being decided. Left blank on purpose.
- **REJECTED** — considered and turned down, with the reason.
- **DEFERRED** — plausible later, out of v1.

---

## 1. Problem

The skill manager is fully open source. Teams need to share private skills, keep them in sync across machines, and add and remove people, without the open-source tool itself holding their data. The distribution model has to work for a regular developer who already runs Claude Code on their own machine.

## 2. The model in three sentences

A team is one private git repo. A skill lives in that repo exactly once, under a flat `skills/` store, and a person is one JSON file recording their identity, their installs, and their declines — authorship is not stored there, it is derived by matching each skill's `metadata.author`. Membership is access to the repo, made concrete by that file existing **and** the handle not appearing in `team.json archived` (D11).

---

## 3. Decision ledger

### 3.1 Distribution

| # | Decision | Status |
|---|---|---|
| D1 | Users install a host-native CLI. There is no Docker container in the user's path. | DECIDED |
| D2 | One shared monorepo is the content model, kept from the Teddy/Ajay proposal — but **not** with per-person folders. Superseded 2026-09-03 by D39: skills live once in a flat `skills/` store and people are ID lists (see 3.3). | DECIDED (revised 2026-09-03) |
| D3 | Docker is reserved for a possible future self-hosted registry server (`docker compose up`). Never for an environment the user codes inside. | DECIDED |
| D4 | The team needs a shared git remote, not GitHub specifically. GitHub, GitLab, Bitbucket, self-hosted Gitea, or a bare repo over SSH all work for **storing and syncing** skills. **Membership *administration* is a different matter:** `invite` and access-revoking `team remove` need a collaborator API and an admin predicate, which are host-specific, so phase 1 implements them for GitHub only and fails honestly elsewhere (`--archive-only` still records the departure). Host adapters DEFERRED. | DECIDED (scoped 2026-09-03) |
| D5 | The only thing outside the user's machine is the git host. No account with us, no server, no container. | DECIDED |

Why no container: a skill is a folder with a SKILL.md that Claude Code reads from the project's `.claude/skills` or the global skills directory. There is no runtime to isolate. Running Claude Code inside a container breaks host auth (macOS Keychain OAuth), host MCP servers, the VS Code and Chrome extensions, and the user's own global skills and hooks, and it adds Docker Desktop as a prerequisite with a paid license at larger companies. The repo carries the entire sharing load; the container carried none of it.

### 3.2 Team and membership

| # | Decision | Status |
|---|---|---|
| D6 | The CLI creates the repo. `terum-skills team create acme` calls the git host's API to make a private repo under the org (or personal account if no org), scaffolds the layout (including the creator's own `people/<handle>.json`), pushes, clones into the CLI cache, and **offers** a session-start pull hook — installed only after an explicit y/N, never silently (build spec §8). The hook is asynchronous by design, so it never blocks session start and correspondingly makes no promise that a skill it places is usable in that same turn; it is active by the next session at the latest. | DECIDED |
| D7 | Team create is GitHub-first using `gh` when logged in, else a fine-grained token scoped to repo creation and collaborator management, stored in `~/.terum/skills/config.json` after a scope check (walk Decision 4). Device-flow login DEFERRED behind a gate. Other hosts: admin creates the repo by hand and runs `terum-skills team create --remote <url>`. | DECIDED |
| D8 | Only the person who creates teams or invites needs GitHub auth. Joiners never do; join uses whatever git credentials they already have. | DECIDED |
| D9 | `terum-skills invite <github-login>...` adds each **GitHub login** as a repo collaborator and prints one Slack-ready join block. The argument is a host identity, not a terum handle: the invitee chooses their own team handle at join (defaulting to their GitHub login but overridable), and their `people/<handle>.json` is created then. Handles are **per team**, so someone whose preferred handle is already taken on a second team can differ there without changing who they are on the first — that file is what membership *is*. `people/<handle>.json` carries `github` so the two identities stay linked. | DECIDED |
| D10 | `terum-skills team join acme/team-skills` never authenticates *with our tool* (ordinary git/GitHub credentials are still needed). With a `gh` OAuth login it accepts the pending invite via list-then-PATCH (fine-grained tokens cannot accept invites); without `gh` it prints the accept URL before attempting the clone. Then it clones, creates `people/<handle>.json`, offers the team-endorsed set with a y/N prompt, and prints the roster. | DECIDED |
| D11 | `terum-skills team remove <handle>` revokes **direct collaborator** access and archives active membership; admin-only, and GitHub-only (D4) — on other hosts it refuses before mutating, offering `--archive-only` to record the departure without claiming to revoke access. It cannot promise the person loses all read access — organization base permissions may still grant it, and the CLI says so rather than implying otherwise. The member's file and skills stay in history and the handle is appended to `team.json archived` — departures archive, never delete. Active membership is therefore "people file exists AND handle not archived"; `team join` by an archived handle is a rejoin that removes it from the list. | DECIDED |
| D12 | Git hosts cannot scope write access. The CLI hard-refuses any write outside what you own — skills whose `metadata.author` is you, your own `people/` file, and `team.json` only via publish/remove paths — enforced in the write helper and a clone-local pre-push hook. Real review happens at `publish` into the team lists (PR). Threat model: prevents accidents, not abuse — raw `git push` bypass stays possible and attributed. CODEOWNERS dropped (can't map metadata ownership; decorative on GitHub Free). Host-side rulesets DEFERRED as a paid-plan add-on. | DECIDED |

### 3.3 Repo layout

Status: DECIDED (revised 2026-09-03 by Ajay — flat store with ID references; supersedes the scoped-folder layout ratified 2026-09-02 from the whiteboard). Skills live exactly once in a flat `skills/` store; per-person installs, team endorsement, and project assignment are lists of skill IDs, never copies or folder positions.

```
team-skills/
  team.json                  team config; `global` and per-project skill-ID lists; categories;
                             project registry (name → repo remotes); archived handles; policy
  skills/<name>/SKILL.md     every shared skill, once; folder name == frontmatter name, unique repo-wide
  people/<handle>.json       one file per member: identity + installed/declined skill-ID lists
  evals/<skill-id>/<version>.json   committed eval results (see 3.7)
```

Notes:
- A skill's identity is a UUID in `metadata.id`, minted at `share`; references survive renames. Scope is not a property of the skill — it is which lists reference it (a skill can serve two projects without copies).
- Frontmatter is Agent-Skills-legal: top-level `name`/`description`/`license` only; `id`, `author` ("Name <email>", SkillEvaluator's required shape), and `terum-category` nest under `metadata`.
- Active membership is derived from two things together: `people/<handle>.json` exists (created at join) **and** the handle is absent from `team.json archived` — no shared members array to contend on, and departures archive rather than delete (D11). "Who uses this skill" is computed across `people/*.json` (D20/D38).
- Ownership is metadata, not geography: only `metadata.author` may edit a skill's folder; only you write `people/<you>.json`; `team.json` lists change via publish PRs.
- Profiles carry skills only in v1 (ratified 2026-09-02). Commands, agents, and hooks are out; if hooks return, D19's flag-and-show rule governs them.

### 3.4 CLI surface

Status: DECIDED (ratified 2026-09-02; `setup` and `search` added 2026-09-03, build spec rev 7). Phase 1 builds every verb below except the gated `eval` and `ui`.

```
terum-skills setup [<org>/<repo> | <url>]   the onboarding wizard: creator with no argument, joiner with the target from the invite block (build spec §6.1)
terum-skills login                          admins only: uses gh when present (offers gh's own login if installed but logged out), else fine-grained token
terum-skills team create <name> [--org <org>] [--remote <url>]
terum-skills team join <org>/<repo> | <remote-url>       the URL form joins a team created with --remote
terum-skills team leave <name>
terum-skills team remove <handle>
terum-skills invite <github-login>...        host identity, not the team handle (D9)
terum-skills share <path-to-skill>          one-time: enter the skill into skills/; updates then flow automatically on sync
terum-skills publish <name> [--project <p>] endorse to the team: add its ID to team.json global or a project list, via PR
terum-skills ls                             roster, skills with author/category/install counts, what you have installed
terum-skills search <term> [--category <c>] [--author <h>] [--project <p>]   read-only substring search over the clone
terum-skills install <ref>[@<version>] | member <handle> | project <name>
terum-skills uninstall <ref> | member <handle> | project <name>
terum-skills sync                           pull, auto-update shared skills, re-place installs, prompt on new team skills
terum-skills eval <name> [--share]
terum-skills eval show <name>@<version>
terum-skills ui                             local web UI on localhost (see 3.6)
```

Rules for `install` (load-bearing for the share flow in 3.8):
- A **self-locating** three-part ref (`acme-org/team-skills/single-fix`) works for someone who has never run the tool: it carries its own repository, so `npx` can install the CLI, collect an identity, join the team if the person has repo access but has not joined, and install — with no pre-existing local config. A two-part `<team>/<skill>` ref is the shorthand for a machine that is already configured; it cannot bootstrap, because there is nothing to resolve `<team>` against.
- `@<version>` (the skill's content hash) pins to the exact content that was evaluated. No version means latest.
- Scope is not a property of the skill and is not derived from any folder (D17): it is which `team.json` list references the skill's ID. Personal and team-endorsed **global** skills place into `~/.claude/skills`; skills on a **project** list place into that project's repo, matched through the `team.json` project registry. v1 has **no install-time scope override** — no `--global`, no `--project` (build spec §13).
- `member <handle>` and `project <name>` are bulk selectors (keyword-marked because handles and project names can collide); details in the phase-1 build spec §6.

Rules for `setup` (normative text is build spec §6.1; added 2026-09-03 to match Ryan's eight-step onboarding flow):
- It sequences the verbs above and owns no write path and no consent prompt of its own; each y/N (hook, endorsed set, `allowed-tools`, `share` frontmatter) is asked by the verb that defines it.
- The team name is collected before any skill action because the repo must exist first; invites come after the first actions; the hook offer is the second-to-last step; a community link is printed, never opened.
- Steps that belong to the local UI (phase 2: the wizard ends by opening it) and to eval (phase 3) are absent from the phase-1 wizard, not stubbed. The phase gates from walk Decision 2 stand.
- Re-running it resumes at the first unfinished step by detecting outcomes (config, remote people file, settings entry) — it keeps no state file and never creates a second repo, people file, or hook entry.
- Joiners are never asked for a token (D8); the invite block now prints `setup <org>/<repo>`, with `team join` as the bare equivalent.

### 3.5 Materialization on disk

| # | Decision | Status |
|---|---|---|
| D13 | Where things live: `~/.terum/skills/config.json` (identity and per-team handles, per-team remotes and tokens, shared-skill tracking **with a last-synced baseline digest per skill**, and per-machine tool-grant approvals), `~/.terum/skills/teams/<team>/` (the clone), `~/.terum/skills/cache/` (pinned checkouts by full tree hash). Placement into agent skill folders is a **native Placer** built on vendored iflytek/skillhub modules (build spec §7; walk Decision 3 reopened and re-locked 2026-09-03). | DECIDED |
| D14 | Team-endorsed **global** skills are offered, never forced: a y/N prompt at join for the current set, and on later publishes at the next interactive sync (the hook only announces); declines are recorded and never re-asked; any skill carrying `allowed-tools` always prompts individually. Team **project** skills auto-place when `sync` runs inside a matching repo. Personal skills are opt-in via `install`. **All of it is subject to one consent rule (build spec §6/§5.4): a placement happens only if the skill's normalized `allowed-tools` hash matches a stored approval, or it grants no tools at all — so an update that widens a grant is a fresh decision, and `sync --hook` defers it rather than placing it.** A decline suppresses every automatic path, project placement included. (Revised 2026-09-03.) | DECIDED |
| D15 | Placement is a **plain copy** straight into the agent's skills directory (`~/.claude/skills/<name>` or `<repo>/.claude/skills/<name>`) — no canonical copy elsewhere, no symlink, same code path on Windows. A copy is not a link, so `sync` re-places changed unpinned installs (detected by per-file fingerprint, recorded on the machine-local `placements` ledger) rather than relying on `git pull`. (Revised 2026-09-03: the Vercel CLI is replaced by the native Placer, build spec §7.) | DECIDED (revised 2026-09-03) |
| D16 | Skill names are unique repo-wide, enforced at `share` (collision → rename suggestion). Install-time collisions with non-terum skills are pre-checked by **reading the exact destination directory** before placing — a folder on our `placements` ledger with the same ID re-places, anything else aborts — so a project placement never consults the global directory. A collision aborts rather than overwrites; `--force` moves the stranger into `~/.terum/skills/quarantine/`. (The old install-time handle-prefix scheme is superseded by the flat store.) | DECIDED |
| D17 | A skill has no inherent scope; scope is which `team.json` lists reference its ID. Personal skills install globally; team project-list skills install into the matching repo's `.claude/skills`. (Revised 2026-09-03; supersedes position-derived scope.) | DECIDED |
| D18 | skillhub's per-agent profile files cover 15 agents plus a generic fallback; phase 1 borrows only the Claude Code row's two paths (both `.claude/skills`, source-verified 2026-09-03) as a path table of our own, because skillhub's profile factory bundles the auto-detect that is not vendored. **Phase 1 deliberately targets Claude Code only**: the agent is an explicit argument to the Placer, which never auto-detects agents and never prompts — installing to every agent on a machine is not a choice the tool may make for a user (build spec §6/§7). Cross-agent placement is therefore one flag and one table row away, DEFERRED past phase 1. (Revised 2026-09-03.) | DECIDED |
| D19 | Profiles carry skills only in v1; commands, agents, and hooks are out entirely (ratified 2026-09-02). Standing principle for whenever hooks return: hooks run code on the recipient's machine, so they require an explicit flag and the CLI shows the files first. | DECIDED |

### 3.6 UI

| # | Decision | Status |
|---|---|---|
| D20 | Everything the UI shows lives in the repo: roster, profiles, skills, eval results, and usage selections. The UI is a renderer with no second source of truth. | DECIDED |
| D21 | Primary UI is a local web UI served by the CLI (`terum-skills ui`). It reads the clone and calls the same functions as the CLI, so an Install button is the same code path as `terum-skills install`. Works offline, no auth, no hosting. | DECIDED |
| D22 | The repo README is generated: roster, per-author skill sections (the browse-by-person view), install counts, endorsement badges, eval column ("—" until phase 3), install one-liners. A scaffolded GitHub Action regenerates it on main and comments on publish PRs (push signal; no derived-file churn in laptop commits); laptop regeneration inside the write helper is the non-GitHub fallback. | DECIDED |
| D23 | The frontend is built against a small data interface, not the filesystem, so a later hosted dashboard is the same frontend pointed at an API. **Made concrete in phase 1 as the library-first rule (build spec §3): every verb is `run(args, io)` over a `Prompter`, and `setup` and the phase-2 UI call the same functions — so "the app opens the UI" is a change to the wizard's last step, not a second implementation.** | DECIDED (2026-09-03) |
| D24 | Pages, enriched by the 2026-09-02 whiteboard marketplace mockup: Browse (search + filters; "new / most-used" card row; team skills bucketed by project and global; category card rows; people ranked by adoption), Profile (person, skills, who uses each), Skill (stats, rendered SKILL.md description, @author link, version history from git, latest evals, Install button), Evals (recent runs, filterable by person and skill). | PROPOSED |
| D37 | Skill metadata schema (whiteboard "Skill Object", revised 2026-09-03 for spec-legality and the flat store): top-level `name`/`description`/`license`; `metadata.id` (UUID minted at share), `metadata.author` ("Name <email>" — SkillEvaluator's required shape), `metadata.terum-category` (from the `team.json` list, admin-extendable). File path is derived (`skills/<name>/`), never stored. | DECIDED |
| D39 | Flat skill store with ID references: skills live once under `skills/`; installs, endorsement, and project assignment are skill-ID lists (`people/<handle>.json` per member — the per-writer concurrency primitive — and `team.json`). Supersedes the scoped-folder layout; kills promote-time copying and divergence. (Ajay, 2026-09-03.) | DECIDED |
| D38 | "Rated" throughout the UI means install counts — how many teammates have a skill installed, computed from committed `people/*.json` records. No separate rating machinery, no human votes; eval scores remain a distinct signal shown alongside. | DECIDED |
| D25 | Known limit: the local UI shows the repo as of last pull and cannot give a teammate a link to your view. If that bites early, it is the signal that the hosted tier (section 4, deferred) is due. | DECIDED |

### 3.7 Evaluations

| # | Decision | Status |
|---|---|---|
| D26 | Evals run locally on the member's own API budget. Results are committed to the repo as JSON at `evals/<skill-id>/<version>.json`. That commit is the receipt. | DECIDED |
| D27 | The Evaluate button in the UI either streams the run into a panel (the local server spawns it) or opens a terminal running `terum-skills eval`. Either is acceptable. Leaning: stream, with a "show in terminal" option, since a terminal is more honest about cost. | PROPOSED |

**Evaluation method: DECIDED (engine) — NVIDIA SkillEvaluator (walk Decision 5).** Grounded in the three-framework comparison over 14 SkillsBench skills plus a test–retest rerun (2026-09-01/02, `~/skill-eval-comparison`): architecturally closest of the third-party frameworks to SkillsBench's deterministic-verifier design, best rank-correlation with the SkillsBench reference even when degraded, and reproducible PASS verdicts (13/14 agreement across identical runs). The Jul 5 rig ("terum-* skill efficacy validation") is demoted to a reference for routing-probe design.

Conditions bound into the decision:
- Run in the framework's default condition: Docker env-mode with a raw API key (local/shim mode zeroes the discoverability and efficiency dimensions).
- Any number that reaches a share card uses `n_attempts > 1`; a single-run per-skill lift is ±0.1 noise and must not rank skills.
- **`share`** injects `metadata.author` and a license into the skill (in the author's own source file) so packaged skills pass SkillEvaluator's author/license schema checks by construction. `publish` only moves an ID onto an endorsement list and injects nothing.

Sub-questions delegated to the eval-integration spec (trigger: phase 3 is a week from being built):
- Cost per run and whether there is a cheap tier.
- Judge model choice.
- Whether evals ever run in CI on publish PRs (would need an API key in repo secrets).
- Mapping SkillEvaluator's result JSON into `evals/<skill-id>/<version>.json`.
- The score summary shown on the share card (D29).
- Whether Jul-5-style routing probes supplement trigger-accuracy measurement.

### 3.8 Share

| # | Decision | Status |
|---|---|---|
| D28 | A PNG cannot carry a clickable link, so Share produces a bundle: the PNG card, the install one-liner as text, and a GitHub link to the skill folder at that commit. | DECIDED |
| D29 | The card shows skill name, author, team, date, score summary, short version hash, and the install line printed at the bottom so it survives if the text gets separated. Sized like a link-preview image so it sits well in Slack. | PROPOSED |
| D30 | The card is one SVG template. The browser rasterizes it through a canvas element (no dependency). The `terum-skills eval --share` terminal path renders the same template with a small SVG-to-PNG library. Library choice is OPEN. | PROPOSED |
| D31 | The one-liner is **self-locating** and version-pinned: `npx -y terum-skills@latest install acme-org/team-skills/single-fix@a1b2c3d`. The three-part `<org>/<repo>/<skill>` form is required here, not the two-part shorthand — a pasted command lands on machines with no local config, which is exactly where a two-part ref has nothing to resolve `<team>` against. See the `install` rules in 3.4. | DECIDED |
| D32 | Recipient-side verify: `terum-skills eval show single-fix@a1b2c3d` reads the committed JSON, so the PNG can always be checked against the repo. | PROPOSED |

### 3.9 Open-source boundary

| # | Decision | Status |
|---|---|---|
| D33 | The tool is open. The team's skills live in the team's own private repo. Same split as dotfile managers and private Homebrew taps. | DECIDED |
| D34 | The paid or cloud tier, if any, is the hosted dashboard/registry (section 4, deferred), not the sync mechanism. | PROPOSED |
| D35 | License: Apache-2.0, for the explicit patent grant (walk Decision 6). | DECIDED |
| D36 | Repo: new `ryanliu-terum/terum-skills`; `origin` repointed there before any push; npm owner assigned before first publish. `oss-skills` archived at Ryan's leisure. | DECIDED |

---

## 4. Rejected and deferred

| Item | Status | Why |
|---|---|---|
| Containerized dev environment (the Docker proposal as stated) | REJECTED | Solves nothing the repo does not; breaks host auth, MCP, editor integration; Docker Desktop prerequisite. Wins only if target users have no local Claude Code setup, or if the real goal is sandboxing agent execution, which is a different product. |
| Shared folder (Dropbox, iCloud) as the team store | REJECTED | Silent conflicts past two people; no history or review. |
| GitHub Pages static site | REJECTED for v1 | On Free and Team plans, Pages sites are public even when the repo is private. Only viable on Enterprise Cloud. |
| Claude Code plugin marketplace as the only mechanism | NOT CHOSEN | Zero code and worth checking a manifest into the same repo for free, but Claude-Code-only, and the harness already targets Codex. |
| iflytek/skillhub adopted as the product (self-hosted registry server) | NOT CHOSEN | Hub-first: Spring Boot, Postgres, Redis, object store, its own identity and RBAC; its product-direction doc explicitly rejects the no-server premise D1–D5 rest on. Wins only for 50+-engineer platform teams already running Kubernetes that need SSO, audit, review queues, and cross-team search — not the ledger's target user. Two of its CLI modules (`skill-fingerprint.ts`, `skill-target-lock.ts`) are vendored and its Claude Code path row is borrowed instead (D13/D15, build spec §7). Compared 2026-09-03; paths source-verified the same day. |
| Vercel `skills` CLI on the install path (walk Decision 3; Ajay's 2026-09-03 ruling) | SUPERSEDED 2026-09-03 | An unpinned third-party CLI on the hot path of every install; installs to every detected agent unless flagged; copy-plus-symlink layout; two verification tasks existed only to characterize it. Its 75-agent reach is unused in a Claude-Code-only phase 1. Replaced by the native Placer; Ryan overrode the ruling, recorded in Terum. |
| Hosted dashboard / registry server, self-hostable via compose | DEFERRED | Adds shareable links, live state, non-git contributors, and a product surface for a paid tier. Cost 4. Reuses the D23 frontend. |
| Custom URL scheme (`terum-skills://install/...`) for click-to-install from Slack | DEFERRED | The only path to "click in Slack, skill installs." Needs OS protocol registration, a confirmation dialog, and a refusal for repos the user is not a member of. Pays off once most recipients have the CLI. |
| Direct "post to Slack" from Share | DEFERRED | Needs a Slack app token stored locally. After copy-paste sharing proves people use it. |
| Human star/vote ratings | NOT CHOSEN | Usage counts (D38) serve the browse UI with zero new machinery; votes would need a `rate` verb and committed rating files. Revisit if usage counts prove a poor quality signal. |
| Commands, agents, and hooks in profiles | DEFERRED | Skills only in v1 (D19). Commands are cheap to add when asked; hooks return only with D19's flag-and-show safety rule. |
| Host-side path rulesets for folder ownership | DEFERRED | Real enforcement for bigger teams on paid GitHub plans; the CLI hard-guard (D12) covers normal use. |
| Evals in CI on publish PRs | OPEN | Needs an API key in repo secrets; cost model unclear. Delegated to the eval-integration spec (3.7). |

---

## 5. Open questions

Resolved by the decision walk (closed 2026-09-02): names (walk D1), the install layer and cross-agent support (walk D3), GitHub auth and device-flow ownership (walk D4), the eval engine (walk D5), repo and license (walk D6).

Further resolved 2026-09-02 (spec walk + whiteboard ratification): D9, D11, D12, D14, D17, D19, D22, the 3.4 verb set, the scoped repo layout (3.3), skill metadata schema (D37), and the meaning of "rated" (D38).

Resolved 2026-09-03 in build spec rev 3 (cross-model audit): the starter category list (seven, admin-extendable); D16 collision handling versus Claude Code's name resolution (dispatch is by directory name, so uniqueness is enforced at `share` and collisions abort at install); `publish` policy (default `"pr"`, and a missing `gh` never downgrades it to a direct push); the membership predicate and rejoin; tool-grant consent persistence; generic-git join; and handle bootstrap.

Resolved 2026-09-03 in build spec rev 6 (iflytek/skillhub comparison): the placement layer — D13, D15, D16, D18 revised to a native Placer on vendored skillhub modules; fingerprints on the placements ledger; local-changed and blocked handling; one quarantine location for every move-aside.

Still open:

- Schema details settled in the phase-1 build spec §5 (team.json, people files, frontmatter, config); remaining open sliver: none at this level.
- Versioning semantics beyond content hash (tags? semver?).
- Eval result schema and share-card score summary (delegated to the eval-integration spec, 3.7).
- SVG-to-PNG library for the terminal share path (D30).
- Windows: none known after rev 6 — the native Placer copies on every platform; the M4 Windows pass runs the suite there.

## 6. Non-goals for v1

- Any server operated by us.
- Per-skill permissions finer than repo access.
- Usage analytics beyond what `people/*.json` install records reveal.
- Sandboxing agent execution.

## 7. Onboarding walkthrough (for review, not normative)

First person:
```
npx -y terum-skills@latest setup
```
walks the eight steps: welcome → GitHub (gh, or gh's own login, or a token) → team name → share a first skill and see the five one-liners → invite teddy ajay → community link → hook y/N → done (roster, repo URL, README URL). The bare verbs it sequences remain usable on their own:
```
terum-skills login
terum-skills team create acme
terum-skills share ~/.claude/skills/single-fix
terum-skills invite teddy ajay
```

Everyone else (pasting the block `invite` printed):
```
npx -y terum-skills@latest setup acme-org/team-skills
```
welcome → GitHub (optional; a logged-in gh auto-accepts the invite, no token is ever requested) → join, with the endorsed-set y/N and any `allowed-tools` prompts → the five one-liners → community link → hook y/N → done. Bare equivalent:
```
terum-skills team join acme-org/team-skills
terum-skills install single-fix
```

Phase 2 changes exactly one line of this: the done step opens the local UI (D21). Phase 3 adds an eval action to the first-actions step. Neither is stubbed in phase 1.

Share a result:
```
terum-skills eval single-fix --share
```
produces the PNG, copies `npx -y terum-skills@latest install acme-org/team-skills/single-fix@<version>` (self-locating, so it works for a recipient who has never run the tool), and prints the GitHub link.

## 8. Related records (Terum, the team's shared memory)

- terum-memory individual product is local-first with no hosted database, container, port, or connection string (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/c0dc553b-cc8e-4b1e-833d-995d8bb269af
- OSS baseline local-first and solo by default; team connectivity is a choice between Terum Cloud and self-hosting (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/a24b2237-feaa-40c6-a728-26bd96c925b3
- Self-hosted open-source hosting remains an explicit product decision (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/0772a829-e086-4978-a268-61e54f96b691
- Project-level harness files travel through git; user-level state under `~/.claude/` needs separate handling (Ryan, 2026-07-08): https://app.terum.ai/#/decisions/6a8ee9fd-ce7b-436c-9c49-04c24554998a. This CLI is that separate handling.
- Open conflict: repo-tracked harness for teammate access (2026-07-31) vs hoisting to `~/.claude` because repo copies go stale (2026-07-29): https://app.terum.ai/#/decisions/5f72380b-d098-4b23-8b26-ab9dd31f3ec6 and https://app.terum.ai/#/decisions/360d6c82-e4d6-472b-ba74-69e7aaf2de23. D15 (CLI-owned links refreshed by sync) is intended to dissolve it.
- Standing ruling not to write specs until likely to be built within the week (Ryan, 2026-07-22): https://app.terum.ai/#/decisions/bc22a235-3a4f-4631-8471-6bb3c782c6bf. This ledger was written anyway at Ryan's request; the drift risk that motivated the ruling does not apply to an empty repo.
- "terum-* skill efficacy validation" (Ryan, 2026-07-05): the routing-probe and skill-vs-baseline rig, now a reference for probe design only (see 3.7). Search Terum by that title.
- SkillEvaluator consistency rerun (Ajay, 2026-09-02): https://app.terum.ai/#/decisions/ccedbd52-9a3f-4cd6-b235-15d7753c0203. Together with the comparison artifacts in `~/skill-eval-comparison` (Ajay's machine), this grounds walk Decision 5.
