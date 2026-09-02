# Team skill sharing: distribution, membership, UI, and share flow

**Status:** Decision ledger, synced 2026-09-02 to the completed decision walk (`.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md`). Phase-1 build spec still to be written.
**Date:** 2026-09-01 (synced 2026-09-02)
**Author:** Ryan Liu, drafted with Claude in a design session
**Inputs:** Teddy and Ajay's verbal suggestion of a self-hosted Docker image over a per-person monorepo (not in Terum's record; taken from Ryan's summary). Terum records cited in section 8.
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
| D9 | `terum-skills invite <handle>...` adds each handle as a repo collaborator and prints the join command to paste into Slack. The invitee's profile folder is created on their first publish. | PROPOSED |
| D10 | `terum-skills team join acme/team-skills` never logs in: with `gh` present it auto-accepts the pending invite via API; otherwise it attempts the clone and on permission failure prints the invite URL and says to rerun after accepting. Then it clones, auto-installs the `team/` folder's skills, and prints the roster. | DECIDED |
| D11 | `terum-skills team remove <handle>` revokes repo access. The folder stays in history and is marked archived in `team.json`. | PROPOSED |
| D12 | Git hosts cannot scope write access to a folder. For small teams: a CODEOWNERS file plus a CLI warning when you touch someone else's folder. Review happens at promotion into `team/`. | PROPOSED |

### 3.3 Repo layout

Status: PROPOSED. Schemas for `team.json` and `profile.json` are OPEN.

```
team-skills/
  team.json                  team name, members (with archived flag), layout version
  team/
    skills/<name>/SKILL.md   promoted skills the team owns together
  <handle>/
    profile.json             display name, one-line bio, and the member's own `use` selections
    skills/<name>/SKILL.md   the member's published skills
  evals/
    <handle>/<skill>/<content-hash>.json   committed eval results (see 3.7)
```

Notes:
- `profile.json` carries the member's installed-skill selections so "who uses this skill" is visible from the repo alone (see D20).
- Whether a profile may also hold `commands/`, `agents/`, or `hooks/` is OPEN. Hooks, if allowed, are governed by D19.

### 3.4 CLI surface

Status: PROPOSED. Names are placeholders; verbs and their behavior are the proposal.

```
terum-skills login                          admins only: uses gh when present, else fine-grained token
terum-skills team create <name> [--remote <url>]
terum-skills team join <org>/<repo>
terum-skills team leave <name>
terum-skills team remove <handle>
terum-skills invite <handle>...
terum-skills publish <path-to-skill>        copy into own profile, commit "<handle>: publish <name>", push; rerun to update
terum-skills ls                             roster, each member's skills, what you have installed
terum-skills use <handle> | <handle>/<skill> | <team>/<handle>/<skill>[@<hash>]
terum-skills unuse <ref>
terum-skills sync                           git pull + relink; the session-start hook runs this too
terum-skills promote <handle>/<skill>       copy into team/, as a PR if team policy requires review
terum-skills eval <handle>/<skill> [--share]
terum-skills eval show <handle>/<skill>@<hash>
terum-skills ui                             local web UI on localhost (see 3.6)
```

Rules for `use` (PROPOSED, load-bearing for the share flow in 3.8):
- A fully qualified ref (`acme/ryan/single-fix`) works for someone who has never run the tool: it installs the CLI if missing (via `npx`), joins the team if the person has repo access but has not joined, then installs.
- `@<hash>` pins to the exact content that was evaluated. No hash means latest.

### 3.5 Materialization on disk

| # | Decision | Status |
|---|---|---|
| D13 | Where things live: `~/.terum/skills/config.json` (teams, selections, token), `~/.terum/skills/teams/<team>/` (the clone), `~/.terum/skills/cache/` (pinned checkouts by git tree hash). Placement into agent skill folders is delegated to the borrowed Vercel `skills` CLI (walk Decision 3), with a native Claude-Code-only fallback. | DECIDED |
| D14 | The team folder is installed automatically on join. Individual profiles are opt-in via `use`. | DECIDED |
| D15 | Symlink on macOS and Linux, managed copy on Windows (Teddy works on Windows) — both handled by the borrowed Vercel `skills` CLI; `sync` refreshes through it. | DECIDED |
| D16 | Name collisions get a handle prefix (`teddy-single-fix`, fixed by walk Decision 1) and the CLI tells the user. The rename is applied to the local pinned checkout before it is handed to the Vercel tool; directory rename vs frontmatter `name` rewrite still to be verified against how Claude Code resolves skill names. | DECIDED |
| D17 | Default scope is global (`~/.claude/skills`), enforced via the Vercel tool's `-g`. Project-scoped installs are OPEN. | OPEN |
| D18 | Cross-agent materialization (Codex, Cursor, ~75 others) comes free via the borrowed Vercel `skills` CLI (walk Decision 3). | DECIDED |
| D19 | `use` installs skills (and commands, if profiles carry them) only. Hooks run code on the recipient's machine, so they require an explicit flag and the CLI shows the files first. | PROPOSED |

### 3.6 UI

| # | Decision | Status |
|---|---|---|
| D20 | Everything the UI shows lives in the repo: roster, profiles, skills, eval results, and usage selections. The UI is a renderer with no second source of truth. | DECIDED |
| D21 | Primary UI is a local web UI served by the CLI (`terum-skills ui`). It reads the clone and calls the same functions as the CLI, so an Install button is the same code path as `terum-skills use`. Works offline, no auth, no hosting. | DECIDED |
| D22 | The CLI regenerates the repo README on publish: roster table, each member's skills, latest eval score per skill. Profile folders get their own README. Free baseline UI on GitHub. | PROPOSED |
| D23 | The frontend is built against a small data interface, not the filesystem, so a later hosted dashboard is the same frontend pointed at an API. | PROPOSED |
| D24 | Pages: Team (roster, per-member skill count, activity feed from git log), Profile (person, skills, who uses each), Skill (rendered SKILL.md, version history from git, latest evals, Install button), Evals (recent runs, filterable by person and skill). | PROPOSED |
| D25 | Known limit: the local UI shows the repo as of last pull and cannot give a teammate a link to your view. If that bites early, it is the signal that the hosted tier (section 4, deferred) is due. | DECIDED |

### 3.7 Evaluations

| # | Decision | Status |
|---|---|---|
| D26 | Evals run locally on the member's own API budget. Results are committed to the repo as JSON, keyed by skill path and content hash. That commit is the receipt. | DECIDED |
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
- Mapping SkillEvaluator's result JSON into `evals/<handle>/<skill>/<content-hash>.json`.
- The score summary shown on the share card (D29).
- Whether Jul-5-style routing probes supplement trigger-accuracy measurement.

### 3.8 Share

| # | Decision | Status |
|---|---|---|
| D28 | A PNG cannot carry a clickable link, so Share produces a bundle: the PNG card, the install one-liner as text, and a GitHub link to the skill folder at that commit. | DECIDED |
| D29 | The card shows skill name, author, team, date, score summary, short version hash, and the install line printed at the bottom so it survives if the text gets separated. Sized like a link-preview image so it sits well in Slack. | PROPOSED |
| D30 | The card is one SVG template. The browser rasterizes it through a canvas element (no dependency). The `terum-skills eval --share` terminal path renders the same template with a small SVG-to-PNG library. Library choice is OPEN. | PROPOSED |
| D31 | The one-liner is fully qualified and version-pinned: `npx terum-skills use acme/ryan/single-fix@a1b2c3d`. See the `use` rules in 3.4. | DECIDED |
| D32 | Recipient-side verify: `terum-skills eval show ryan/single-fix@a1b2c3d` reads the committed JSON, so the PNG can always be checked against the repo. | PROPOSED |

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
| Evals in CI on promotion PRs | OPEN | Needs an API key in repo secrets; cost model unclear. Delegated to the eval-integration spec (3.7). |

---

## 5. Open questions

Resolved by the decision walk (closed 2026-09-02): names (walk D1), the install layer and cross-agent support (walk D3), GitHub auth and device-flow ownership (walk D4), the eval engine (walk D5), repo and license (walk D6).

Still open:

- `team.json` and `profile.json` schemas.
- Whether profiles carry `commands/`, `agents/`, `hooks/` in addition to `skills/`.
- Project-scoped installs (D17).
- How D16 collision handling interacts with Claude Code's skill name resolution.
- `promote` policy: when a PR is required vs direct push.
- Versioning semantics beyond content hash (tags? semver?).
- Eval result schema and share-card score summary (delegated to the eval-integration spec, 3.7).
- SVG-to-PNG library for the terminal share path (D30).
- Windows specifics beyond D15.

## 6. Non-goals for v1

- Any server operated by us.
- Per-skill permissions finer than repo access.
- Usage analytics beyond what `profile.json` selections reveal.
- Sandboxing agent execution.

## 7. Onboarding walkthrough (for review, not normative)

First person:
```
npm install -g terum-skills
terum-skills login
terum-skills team create acme
terum-skills publish ~/.claude/skills/single-fix
terum-skills invite teddy ajay
```

Everyone else:
```
npm install -g terum-skills
terum-skills team join acme/team-skills
terum-skills use ryan/single-fix
```

Share a result:
```
terum-skills eval ryan/single-fix --share
```
produces the PNG, copies `npx terum-skills use acme/ryan/single-fix@<hash>`, and prints the GitHub link.

## 8. Related records (Terum, the team's shared memory)

- terum-memory individual product is local-first with no hosted database, container, port, or connection string (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/c0dc553b-cc8e-4b1e-833d-995d8bb269af
- OSS baseline local-first and solo by default; team connectivity is a choice between Terum Cloud and self-hosting (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/a24b2237-feaa-40c6-a728-26bd96c925b3
- Self-hosted open-source hosting remains an explicit product decision (Ryan, 2026-09-01): https://app.terum.ai/#/decisions/0772a829-e086-4978-a268-61e54f96b691
- Project-level harness files travel through git; user-level state under `~/.claude/` needs separate handling (Ryan, 2026-07-08): https://app.terum.ai/#/decisions/6a8ee9fd-ce7b-436c-9c49-04c24554998a. This CLI is that separate handling.
- Open conflict: repo-tracked harness for teammate access (2026-07-31) vs hoisting to `~/.claude` because repo copies go stale (2026-07-29): https://app.terum.ai/#/decisions/5f72380b-d098-4b23-8b26-ab9dd31f3ec6 and https://app.terum.ai/#/decisions/360d6c82-e4d6-472b-ba74-69e7aaf2de23. D15 (CLI-owned links refreshed by sync) is intended to dissolve it.
- Standing ruling not to write specs until likely to be built within the week (Ryan, 2026-07-22): https://app.terum.ai/#/decisions/bc22a235-3a4f-4631-8471-6bb3c782c6bf. This ledger was written anyway at Ryan's request; the drift risk that motivated the ruling does not apply to an empty repo.
- "terum-* skill efficacy validation" (Ryan, 2026-07-05): the routing-probe and skill-vs-baseline rig, now a reference for probe design only (see 3.7). Search Terum by that title.
- SkillEvaluator consistency rerun (Ajay, 2026-09-02): https://app.terum.ai/#/decisions/ccedbd52-9a3f-4cd6-b235-15d7753c0203. Together with the comparison artifacts in `~/skill-eval-comparison` (Ajay's machine), this grounds walk Decision 5.
