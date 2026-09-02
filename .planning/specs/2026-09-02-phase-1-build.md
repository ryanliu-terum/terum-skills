# terum-skills — Phase 1 build spec

**Status:** BUILD-READY.
**Date:** 2026-09-02
**Parents:** `.planning/specs/2026-09-01-team-skill-sharing.md` (decision ledger, D1–D38) and `.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md` (walk verdicts). This spec adds no product forks; where the ledger left a design gap it states a default and marks it **[default — veto cheap]**.

## 1. Context

The decision ledger is complete: phase 1 is the CLI plus the generated README (walk Decision 2), covering ledger sections 3.1–3.5 and D22, with the scoped repo layout, skill schema, and usage signals ratified 2026-09-02. This spec turns those decisions into a buildable plan. Phases 2 (local web UI) and 3 (eval + share) stay behind their gates and appear here only where phase 1 must leave room for them.

North Star check: after phase 1, a teammate installs a skill with one command, the repo records who published and who uses what, and nothing runs anywhere but laptops and the git host.

## 2. Scope

**In:** `login`, `team create|join|leave|remove`, `invite`, `publish`, `ls`, `use`, `unuse`, `sync`, `promote`; the write guard; the pin cache; the Placer adapter (Vercel shell-out + native Claude Code fallback); the README generator; the session-start sync hook; Apache-2.0 LICENSE; npm packaging.

**Out (gated/deferred):** `eval`, `eval show`, `ui`, share bundle, device-flow login, host-side rulesets, commands/agents/hooks in profiles, project-scoped anything beyond what D14/D17 define, hosted tier.

## 3. Stack and product repo layout

Node 20+, TypeScript, ESM. Distributed as npm package `terum-skills` (binary `terum-skills`; `npx terum-skills …` is the canonical invocation). Minimal dependencies: `commander` (CLI parsing), `zod` (schema validation for the JSON files), `yaml` (SKILL.md frontmatter). Everything else — git, GitHub API, placement — is a shell-out to `git`, `gh`, `npx skills`. No HTTP client, no server, no daemon. **[default — veto cheap: the three deps]**

```
src/
  index.ts              commander wiring only
  commands/<verb>.ts    one file per verb
  lib/
    config.ts           ~/.terum/skills/config.json read/write
    teamRepo.ts         clone locations, git operations, remote matching
    schema.ts           zod schemas: team.json, profile.json, config.json, frontmatter
    guard.ts            own-folder write guard (D12)
    pin.ts              tree-hash pinning + cache checkout
    placer.ts           Placer interface + vercel-skills + native-claude-code impls
    readme.ts           README generator (D22)
    auth.ts             gh detection + token fallback (D7/D8)
test/                   vitest; unit for lib/, E2E against a local bare repo fixture
```

## 4. Data schemas

All JSON validated with zod on read; unknown fields preserved on write (forward compatibility for phases 2–3).

### 4.1 `team.json` (repo root)

```jsonc
{
  "layout_version": 1,
  "name": "terum",
  "members": [
    { "handle": "ryan", "github": "ryanliu", "archived": false }
  ],
  "categories": ["debugging", "testing", "docs", "workflow", "research", "infra", "misc"],
  "projects": {
    "terum-mvp": { "remotes": ["github.com/ryanliu-terum/Terum-MVP"] }
  },
  "policy": { "promote": "pr" }
}
```

- `categories`: the D37 fixed list; the seven above are the starter set **[default — veto cheap]**. Admins edit the file (or `terum-skills` warns-and-suggests on publish with an unknown category).
- `projects`: the D14/D17 registry. Remote matching rule: normalize both sides — strip protocol, credentials, `.git` suffix, trailing slash, lowercase host — and compare. A repo matches a project if any of its git remotes normalizes to an entry in `remotes`.
- `policy.promote`: `"pr"` (default) or `"push"`. See §5 promote.

### 4.2 `<handle>/profile.json`

```jsonc
{
  "handle": "ryan",
  "display_name": "Ryan Liu",
  "bio": "one line",
  "uses": [
    { "ref": "terum/ajay/single-fix", "pin": "a1b2c3d", "scope": "global", "since": "2026-09-02" }
  ]
}
```

- `uses` is the D20/D38 usage record: `use`/`unuse` edit **your own** profile.json, commit (`ryan: use ajay/single-fix`), and push. This is deliberate write-traffic — the receipt that powers "who uses this" in the README and later the marketplace. `pin` is null when tracking latest.

### 4.3 SKILL.md frontmatter (D37)

```yaml
name: single-fix
description: one-line description
author: ryan          # == SkillEvaluator metadata.author (walk Decision 5 condition 3)
category: workflow    # from team.json categories
```

Scope and repo path are derived from tree position (`<owner>/global/...` vs `<owner>/<project>/...`), never duplicated in frontmatter. `publish` validates frontmatter and injects `author` (from config handle) and a `license` line into packaging metadata if missing, so skills pass SkillEvaluator's Tier-1 gate by construction.

### 4.4 `~/.terum/skills/config.json` (local, never committed)

```jsonc
{
  "handle": "ajay",
  "teams": { "terum": { "remote": "github.com/ryanliu-terum/team-skills" } },
  "github_token": null
}
```

Clones live at `~/.terum/skills/teams/<team>/`; pin cache at `~/.terum/skills/cache/<team>/<pin>/<skill>/`. Token file mode 0600; keychain storage deferred.

## 5. Command behavior

Refs: `<team>/<handle>/<skill>[@<pin>]`; within a single joined team, `<handle>/<skill>` suffices. `@<pin>` is the skill folder's short git tree hash.

- **`login`** — runs `gh auth status`; if logged in, prints "using gh" and stores nothing. Else prompts for a fine-grained PAT (needs repository Administration + Contents on the team repo/org), verifies scopes with a probe call, stores in config. Only admins ever need this (D7/D8).
- **`team create <name> [--org <org>] [--remote <url>]`** — with GitHub auth: creates private repo `<org-or-user>/team-skills`, scaffolds layout (team.json with the caller as first member, `team/global/.gitkeep`, LICENSE-free — the *team* repo carries no license), pushes, clones to the cache location, installs the session-start hook. With `--remote`: skips creation, pushes scaffold to the given remote (non-GitHub path).
- **`team join <org>/<repo>`** — never authenticates (D10). With `gh`: auto-accepts the pending invite via `gh api /user/repository_invitations`. Clones; on permission failure prints the invite URL and says rerun after accepting. Then adds self to `team.json members` (commit `<handle>: join`), installs `team/global/` skills, prints roster.
- **`invite <handle>...`** — admin: `gh api` (or PAT) to add collaborators; prints the join command to paste into Slack (D9).
- **`team leave <name>` / `team remove <handle>`** — leave: uninstalls that team's skills, removes clone + config entry (access revocation is the admin's side). remove: revokes collaborator access, sets `archived: true` in team.json (D11).
- **`publish <path> [--project <name>]`** — validates frontmatter (category known, name legal); copies into `<handle>/global/<skill>/` or `<handle>/<project>/<skill>/`; regenerates READMEs; commits `<handle>: publish <skill>` and pushes. Rerun to update. Refuses paths that would land outside your own folder (guard).
- **`ls`** — roster, each member's skills grouped by scope, usage counts, what you have installed and at which pin.
- **`use <ref>[@pin] [--global]`** — resolves the skill; global-scoped → Placer installs to `~/.claude/skills` (`-g`); project-scoped → if cwd's repo matches the project, installs to that repo's `.claude/skills`, else explains and offers `--global`. Pinned: checks out the tree hash into the cache and installs from there; unpinned: installs from the clone (symlink → `sync` updates it). Records in profile.json `uses`, commits, pushes. For a stranger with repo access, `npx terum-skills use <full-ref>` walks them through join first (D31/3.4 rules).
- **`unuse <ref>`** — Placer remove + profile.json update, commit, push.
- **`sync`** — `git pull` each team clone; refresh placements (re-run Placer for tracked skills; prune links whose source vanished); when run inside a repo matching a registered project, auto-install that project's `team/<project>/` skills (D14). `--quiet` for the hook.
- **`promote <handle>/<skill> [--project <name>]`** — copies the skill at its current tree hash into `team/global/` or `team/<project>/`. With `policy.promote: "pr"` (default): pushes branch `promote/<skill>` and opens a PR via `gh` (title `promote: <handle>/<skill> @<pin>`); merge is the review (D12). With `"push"` or no `gh`: commits directly after a y/N confirmation showing the diff. **[default — veto cheap: "pr" as default]**
- **Versioning:** content tree hash only in v1; no tags/semver. `ls` shows short pins; nothing else is built. **[default — veto cheap]**

**Write guard (D12):** every git-writing code path goes through `guard.ts`, which diffs the staged tree and hard-fails if any path is outside `<own-handle>/` — except the named exemptions: `team.json` membership edits by join/remove, `team/` writes by promote, and README regeneration. `team create` also writes a CODEOWNERS mapping each `<handle>/` to its member.

## 6. Pinning and placement

- **Pin resolve:** a skill's pin is `git rev-parse HEAD:<path>` (tree hash, short). To materialize `@<pin>`: find a commit containing that tree (`git log --format=%H -- <path>` walked until `rev-parse <commit>:<path>` matches), then `git archive <commit> <path> | tar -x` into the cache. Cache entries are immutable and content-addressed; safe to reuse.
- **Placer:** `place(localPath, skillName, agents, scope)`, `remove`, `list`. Default impl shells `npx skills add <localPath> --skill <name> -g -y` with `DISABLE_TELEMETRY=1` in the child env (walk Decision 3); project scope drops `-g` and runs from the target repo root. Fallback impl (`native-claude-code`) symlinks (copies on Windows) into `~/.claude/skills/` or `<repo>/.claude/skills/`; used when `npx skills` is unavailable or offline. Collisions: prefix the *placement name* `<handle>-<skill>` and inform the user (D16) — see verification V3 for rename mechanics.
- **Session-start hook (D6):** `team create`/`join` offer to add a Claude Code SessionStart hook running `terum-skills sync --quiet` to `~/.claude/settings.json`; never installed without a y/N.

## 7. README generator (D22)

Regenerated on every publish/promote/join/remove; committed in the same commit. Repo README: team name, roster table (handle, display name, skill count, archived flag), then per-member sections grouped global/project — each skill row: name, category, description, usage count (from all profile.json `uses`), eval score column (shows "—" until phase 3), and the one-line install command. Profile folders get a mini-README (same rows, one member). Generated content sits between `<!-- terum-skills:begin/end -->` markers; anything outside the markers is preserved.

## 8. Verification tasks (do before or during M1)

- **V1:** Claude Code tolerates extra frontmatter keys (`author`, `category`) in SKILL.md — load a skill with both and confirm it still triggers.
- **V2:** `npx skills add <local path> --skill <name> -g -y` works with a local folder, and confirm the current flag names against the installed version (the ledger's grounding is from 2026-09-01).
- **V3:** whether Claude Code resolves a skill by directory name or frontmatter `name` — decides if D16 collision handling renames the folder, rewrites frontmatter `name`, or both.
- **V4:** `gh api /user/repository_invitations` accept flow works with a fine-grained-token `gh` login (not just OAuth).

## 9. Build order

- **M1 — plumbing:** scaffold package, config, schemas, auth, `team create`/`join` against a real private repo. *Exit: two laptops joined to one team repo.*
- **M2 — the loop:** `publish`, `use`/`unuse`, `sync`, Placer (both impls), pin cache. *Exit: the section-7 onboarding walkthrough from the parent spec works end-to-end for two people, including a pinned install.*
- **M3 — the team layer:** `invite`, `remove`, `leave`, `ls`, guard + CODEOWNERS, README generator, `promote` (both policies). *Exit: README on GitHub shows roster/skills/usage; a promote PR merges and syncs to the second laptop.*
- **M4 — ship:** session-start hook, Windows pass (copy placement), LICENSE (Apache-2.0), npm metadata, `npm publish` dry-run, reserve the name with 0.1.0. *Exit: `npx terum-skills use terum/<handle>/<skill>` works on a machine that has never seen the tool.*

## 10. Acceptance

Phase 1 is done when, with Ryan and Ajay on separate machines and one private GitHub repo: create → invite → join → publish (one global, one project-scoped) → use (one pinned, one latest) → sync-in-project auto-install → promote via PR → README reflects all of it — and every write lands via the guard, with `git log` reading as the team's activity feed. Tests: unit for schema/guard/pin/readme; E2E against a local bare-repo fixture in CI (no network).

## 11. Defaults chosen here (veto any before M1 ends)

1. Deps: commander + zod + yaml, nothing else.
2. Starter categories: debugging, testing, docs, workflow, research, infra, misc.
3. `policy.promote` defaults to `"pr"`.
4. Versioning is tree-hash-only in v1.
5. Team repos are scaffolded without a license file (private team content isn't ours to license).
