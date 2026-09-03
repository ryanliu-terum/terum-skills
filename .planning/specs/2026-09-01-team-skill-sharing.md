# Team skill sharing: distribution, membership, UI, and share flow

**Status:** Decision ledger, synced 2026-09-02 to the completed decision walk (`.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md`). Phase-1 build spec still to be written.
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

A team is one private git repo. A profile is one person's folder in that repo. Membership is access to the repo.

---

## 3. Decision ledger

### 3.1 Distribution

| # | Decision | Status |
|---|---|---|
| D1 | Users install a host-native CLI. There is no Docker container in the user's path. | DECIDED |
| D2 | The monorepo with per-person folders is the content model. Kept from the Teddy/Ajay proposal. | DECIDED |
| D3 | Docker is reserved for a possible future self-hosted registry server (`docker compose up`). Never for an environment the user codes inside. | DECIDED |
| D4 | The team needs a shared git remote, not GitHub specifically. GitHub, GitLab, Bitbucket, self-hosted Gitea, or a bare repo over SSH all work. | DECIDED |
| D5 | The only thing outside the user's machine is the git host. No account with us, no server, no container. | DECIDED |

Why no container: a skill is a folder with a SKILL.md that Claude Code reads from the project's `.claude/skills` or the global skills directory. There is no runtime to isolate. Running Claude Code inside a container breaks host auth (macOS Keychain OAuth), host MCP servers, the VS Code and Chrome extensions, and the user's own global skills and hooks, and it adds Docker Desktop as a prerequisite with a paid license at larger companies. The repo carries the entire sharing load; the container carried none of it.

### 3.2 Team and membership

| # | Decision | Status |
|---|---|---|
| D6 | The CLI creates the repo. `terum-skills team create acme` calls the git host's API to make a private repo under the org (or personal account if no org), scaffolds the layout, pushes, clones into the CLI cache, and installs a session-start pull hook. | DECIDED |
| D7 | Team create is GitHub-first using `gh` when logged in, else a fine-grained token scoped to repo creation and collaborator management, stored in `~/.terum/skills/config.json` after a scope check (walk Decision 4). Device-flow login DEFERRED behind a gate. Other hosts: admin creates the repo by hand and runs `terum-skills team create --remote <url>`. | DECIDED |
| D8 | Only the person who creates teams or invites needs GitHub auth. Joiners never do; join uses whatever git credentials they already have. | DECIDED |
| D9 | `terum-skills invite <handle>...` adds each handle as a repo collaborator and prints one Slack-ready join block. The invitee's `people/<handle>.json` is created at join (this is what membership *is*). | DECIDED |
| D10 | `terum-skills team join acme/team-skills` never authenticates *with our tool* (ordinary git/GitHub credentials are still needed). With a `gh` OAuth login it accepts the pending invite via list-then-PATCH (fine-grained tokens cannot accept invites); without `gh` it prints the accept URL before attempting the clone. Then it clones, creates `people/<handle>.json`, offers the team-endorsed set with a y/N prompt, and prints the roster. | DECIDED |
| D11 | `terum-skills team remove <handle>` revokes repo access. The folder stays in history and is marked archived in `team.json`. | DECIDED |
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
- Membership is derived from the presence of `people/<handle>.json` (created at join) — no shared members array to contend on. "Who uses this skill" is computed across `people/*.json` (D20/D38).
- Ownership is metadata, not geography: only `metadata.author` may edit a skill's folder; only you write `people/<you>.json`; `team.json` lists change via publish PRs.
- Profiles carry skills only in v1 (ratified 2026-09-02). Commands, agents, and hooks are out; if hooks return, D19's flag-and-show rule governs them.

### 3.4 CLI surface

Status: DECIDED (ratified 2026-09-02). Phase 1 builds every verb below except the gated `eval` and `ui`.

```
terum-skills login                          admins only: uses gh when present, else fine-grained token
terum-skills team create <name> [--remote <url>]
terum-skills team join <org>/<repo>
terum-skills team leave <name>
terum-skills team remove <handle>
terum-skills invite <handle>...
terum-skills share <path-to-skill>          one-time: enter the skill into skills/; updates then flow automatically on sync
terum-skills publish <name> [--project <p>] endorse to the team: add its ID to team.json global or a project list, via PR
terum-skills ls                             roster, skills with author/category/install counts, what you have installed
terum-skills install <ref>[@<version>] | member <handle> | project <name>
terum-skills uninstall <ref> | member <handle> | project <name>
terum-skills sync                           pull, auto-update shared skills, re-place installs, prompt on new team skills
terum-skills eval <name> [--share]
terum-skills eval show <name>@<version>
terum-skills ui                             local web UI on localhost (see 3.6)
```

Rules for `install` (load-bearing for the share flow in 3.8):
- A fully qualified ref (`acme/single-fix`) works for someone who has never run the tool: it installs the CLI if missing (via `npx`), joins the team if the person has repo access but has not joined, then installs.
- `@<version>` (the skill's content hash) pins to the exact content that was evaluated. No version means latest.
- Scope follows the skill's folder (D17): a global skill installs to `~/.claude/skills`; a project skill installs into the matching repo's `.claude/skills` (using the `team.json` project registry), and `install` outside that repo says so and offers `--global` to override.
- `member <handle>` and `project <name>` are bulk selectors (keyword-marked because handles and project names can collide); details in the phase-1 build spec §6.

### 3.5 Materialization on disk

| # | Decision | Status |
|---|---|---|
| D13 | Where things live: `~/.terum/skills/config.json` (identity, per-team remotes and tokens, shared-skill tracking), `~/.terum/skills/teams/<team>/` (the clone), `~/.terum/skills/cache/` (pinned checkouts by full tree hash). Placement into agent skill folders is delegated to the borrowed Vercel `skills` CLI (walk Decision 3), with a native fallback. | DECIDED |
| D14 | Team-endorsed **global** skills are offered, never forced: a y/N prompt at join for the current set, and on later publishes at the next interactive sync (the hook only announces); declines are recorded and never re-asked; any skill carrying `allowed-tools` always prompts individually. Team **project** skills auto-place when `sync` runs inside a matching repo. Personal skills are opt-in via `install`. (Revised 2026-09-03.) | DECIDED |
| D15 | Placement is by the borrowed Vercel `skills` CLI, which **copies** (canonical copy under `~/.agents/skills/`, `--copy` on Windows) — it never links into our clone, so `sync` re-places changed unpinned installs rather than relying on `git pull`. (Corrected 2026-09-03 per review.) | DECIDED |
| D16 | Skill names are unique repo-wide, enforced at `share` (collision → rename suggestion). Install-time collisions with non-terum skills are pre-checked via the Vercel tool's list before placing. (The old install-time handle-prefix scheme is superseded by the flat store.) | DECIDED |
| D17 | A skill has no inherent scope; scope is which `team.json` lists reference its ID. Personal skills install globally; team project-list skills install into the matching repo's `.claude/skills`. (Revised 2026-09-03; supersedes position-derived scope.) | DECIDED |
| D18 | Cross-agent materialization (Codex, Cursor, ~75 others) comes free via the borrowed Vercel `skills` CLI (walk Decision 3). | DECIDED |
| D19 | Profiles carry skills only in v1; commands, agents, and hooks are out entirely (ratified 2026-09-02). Standing principle for whenever hooks return: hooks run code on the recipient's machine, so they require an explicit flag and the CLI shows the files first. | DECIDED |

### 3.6 UI

| # | Decision | Status |
|---|---|---|
| D20 | Everything the UI shows lives in the repo: roster, profiles, skills, eval results, and usage selections. The UI is a renderer with no second source of truth. | DECIDED |
| D21 | Primary UI is a local web UI served by the CLI (`terum-skills ui`). It reads the clone and calls the same functions as the CLI, so an Install button is the same code path as `terum-skills install`. Works offline, no auth, no hosting. | DECIDED |
| D22 | The repo README is generated: roster, per-author skill sections (the browse-by-person view), install counts, endorsement badges, eval column ("—" until phase 3), install one-liners. A scaffolded GitHub Action regenerates it on main and comments on publish PRs (push signal; no derived-file churn in laptop commits); laptop regeneration inside the write helper is the non-GitHub fallback. | DECIDED |
| D23 | The frontend is built against a small data interface, not the filesystem, so a later hosted dashboard is the same frontend pointed at an API. | PROPOSED |
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
- `publish` emits `metadata.author` and a license so packaged skills pass SkillEvaluator's Tier-1 schema gate by construction.

Sub-questions delegated to the eval-integration spec (trigger: phase 3 is a week from being built):
- Cost per run and whether there is a cheap tier.
- Judge model choice.
- Whether evals ever run in CI on promotion PRs (would need an API key in repo secrets).
- Mapping SkillEvaluator's result JSON into `evals/<skill-id>/<version>.json`.
- The score summary shown on the share card (D29).
- Whether Jul-5-style routing probes supplement trigger-accuracy measurement.

### 3.8 Share

| # | Decision | Status |
|---|---|---|
| D28 | A PNG cannot carry a clickable link, so Share produces a bundle: the PNG card, the install one-liner as text, and a GitHub link to the skill folder at that commit. | DECIDED |
| D29 | The card shows skill name, author, team, date, score summary, short version hash, and the install line printed at the bottom so it survives if the text gets separated. Sized like a link-preview image so it sits well in Slack. | PROPOSED |
| D30 | The card is one SVG template. The browser rasterizes it through a canvas element (no dependency). The `terum-skills eval --share` terminal path renders the same template with a small SVG-to-PNG library. Library choice is OPEN. | PROPOSED |
| D31 | The one-liner is fully qualified and version-pinned: `npx -y terum-skills@latest install acme/single-fix@a1b2c3d`. See the `install` rules in 3.4. | DECIDED |
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
| Hosted dashboard / registry server, self-hostable via compose | DEFERRED | Adds shareable links, live state, non-git contributors, and a product surface for a paid tier. Cost 4. Reuses the D23 frontend. |
| Custom URL scheme (`terum-skills://install/...`) for click-to-install from Slack | DEFERRED | The only path to "click in Slack, skill installs." Needs OS protocol registration, a confirmation dialog, and a refusal for repos the user is not a member of. Pays off once most recipients have the CLI. |
| Direct "post to Slack" from Share | DEFERRED | Needs a Slack app token stored locally. After copy-paste sharing proves people use it. |
| Human star/vote ratings | NOT CHOSEN | Usage counts (D38) serve the browse UI with zero new machinery; votes would need a `rate` verb and committed rating files. Revisit if usage counts prove a poor quality signal. |
| Commands, agents, and hooks in profiles | DEFERRED | Skills only in v1 (D19). Commands are cheap to add when asked; hooks return only with D19's flag-and-show safety rule. |
| Host-side path rulesets for folder ownership | DEFERRED | Real enforcement for bigger teams on paid GitHub plans; the CLI hard-guard (D12) covers normal use. |
| Evals in CI on promotion PRs | OPEN | Needs an API key in repo secrets; cost model unclear. Delegated to the eval-integration spec (3.7). |

---

## 5. Open questions

Resolved by the decision walk (closed 2026-09-02): names (walk D1), the install layer and cross-agent support (walk D3), GitHub auth and device-flow ownership (walk D4), the eval engine (walk D5), repo and license (walk D6).

Further resolved 2026-09-02 (spec walk + whiteboard ratification): D9, D11, D12, D14, D17, D19, D22, the 3.4 verb set, the scoped repo layout (3.3), skill metadata schema (D37), and the meaning of "rated" (D38).

Still open:

- Schema details settled in the phase-1 build spec §5 (team.json, people files, frontmatter, config); remaining open sliver: none at this level.
- The starter category list.
- How D16 collision handling interacts with Claude Code's skill name resolution.
- `publish` policy: when a PR is required vs direct push (default "pr" per build spec).
- Versioning semantics beyond content hash (tags? semver?).
- Eval result schema and share-card score summary (delegated to the eval-integration spec, 3.7).
- SVG-to-PNG library for the terminal share path (D30).
- Windows specifics beyond D15.

## 6. Non-goals for v1

- Any server operated by us.
- Per-skill permissions finer than repo access.
- Usage analytics beyond what `people/*.json` install records reveal.
- Sandboxing agent execution.

## 7. Onboarding walkthrough (for review, not normative)

First person:
```
npm install -g terum-skills
terum-skills login
terum-skills team create acme
terum-skills share ~/.claude/skills/single-fix
terum-skills invite teddy ajay
```

Everyone else:
```
npm install -g terum-skills
terum-skills team join acme/team-skills
terum-skills install single-fix
```

Share a result:
```
terum-skills eval single-fix --share
```
produces the PNG, copies `npx -y terum-skills@latest install acme/single-fix@<version>`, and prints the GitHub link.

## 8. Related records (Terum, the team's shared memory)

- terum-memory individual product is local-first with no hosted database, container, port, or connection string (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/c0dc553b-cc8e-4b1e-833d-995d8bb269af
- OSS baseline local-first and solo by default; team connectivity is a choice between Terum Cloud and self-hosting (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/a24b2237-feaa-40c6-a728-26bd96c925b3
- Self-hosted open-source hosting remains an explicit product decision (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/0772a829-e086-4978-a268-61e54f96b691
- Project-level harness files travel through git; user-level state under `~/.claude/` needs separate handling (Ryan, 2026-07-08): https://app.terum.ai/#/decisions/6a8ee9fd-ce7b-436c-9c49-04c24554998a. This CLI is that separate handling.
- Open conflict: repo-tracked harness for teammate access (2026-07-31) vs hoisting to `~/.claude` because repo copies go stale (2026-07-29): https://app.terum.ai/#/decisions/5f72380b-d098-4b23-8b26-ab9dd31f3ec6 and https://app.terum.ai/#/decisions/360d6c82-e4d6-472b-ba74-69e7aaf2de23. D15 (CLI-owned links refreshed by sync) is intended to dissolve it.
- Standing ruling not to write specs until likely to be built within the week (Ryan, 2026-07-22): https://app.terum.ai/#/decisions/bc22a235-3a4f-4631-8471-6bb3c782c6bf. This ledger was written anyway at Ryan's request; the drift risk that motivated the ruling does not apply to an empty repo.
- "terum-* skill efficacy validation" (Ryan, 2026-07-05): the routing-probe and skill-vs-baseline rig, now a reference for probe design only (see 3.7). Search Terum by that title.
- SkillEvaluator consistency rerun (Ajay, 2026-09-02): https://app.terum.ai/#/decisions/ccedbd52-9a3f-4cd6-b235-15d7753c0203. Together with the comparison artifacts in `~/skill-eval-comparison` (Ajay's machine), this grounds walk Decision 5.
