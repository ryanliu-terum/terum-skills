# terum-skills — Phase 1 build spec

**Status:** BUILD-READY (rev 6, 2026-09-03).
**Parents:** `.planning/specs/2026-09-01-team-skill-sharing.md` (decision ledger) and the decision walk. **Inputs to rev 2:** Teddy's source-verified review of rev 1 (2026-09-03, `phase-1-build-review.md`) and Ajay's flat-store restructure. **Inputs to revs 3–5:** three `/codex-spec` cross-model audit rounds over revs 2, 3, and 4 (Codex finders, 2-vote Claude verify panel; report at `.planning/specs/reviews/2026-09-02-phase-1-build.codex-spec.review.md`) — every confirmed, contested, and unverified finding is resolved here. Design gaps closed here carry a stated default marked **[default — veto cheap]**. Where this spec and the ledger disagree, **this spec is authoritative**. **Inputs to rev 6:** the iflytek/skillhub comparison (2026-09-03) — the Vercel `skills` shell-out is replaced by a native Placer built on three vendored skillhub CLI modules (Apache-2.0, NOTICE); Ryan overrode Ajay's same-day ruling and walk Decision 3 (recorded in Terum and in the walk).

## 1. Context

Rev 2 made two structural changes over rev 1. **(a) Flat skill store with ID references** — skills live once under `skills/`; per-person installs, team endorsement, and project assignment are lists of skill IDs, not folder positions or copies. This supersedes the scoped folder layout ratified 2026-09-02 (same-day revision by its author; recorded in the parent ledger). **(b) The review's findings** — legal frontmatter, a concurrency-safe write path, a correct join flow, a hardened session hook, and install-time review of tool grants. **Rev 3 closes the cross-model audit:** an explicit membership predicate, a scope-correct collision check, a persisted tool-grant consent record that makes hook sync fail closed, self-locating refs, a defined reconciliation for shared sources, a generic-git join path, and handle bootstrap. **Rev 6 replaces the placement layer:** no third-party CLI on the install path; placement is a native Placer (§7) built on vendored skillhub pieces — an agent path table, a per-file fingerprint, and a per-target lock — with one on-disk layout (§4.3), fingerprints in the `placements` ledger, and defined handling for hand-edited copies (§6 `sync`).

Verb model (settled this session): **`share`** puts a skill into your authorship once, after which updates flow automatically on sync; **`publish`** is the deliberate act of endorsing a skill to the team (PR-gated); **`install`** places skills locally. "Promote" no longer exists.

North Star check: one command installs a skill; the repo records who authored, endorsed, and installed what; nothing runs anywhere but laptops and the git host (the optional GitHub Action runs on the host's compute, not a server of ours).

## 2. Scope

**In:** `login`, `team create|join|leave|remove`, `invite`, `share`, `publish`, `ls`, `install`, `uninstall`, `sync`; the metadata write guard; the version cache; the native Placer (§7; vendored skillhub modules under Apache NOTICE); the README generator + repo GitHub Action; the session-start hook; Apache-2.0 LICENSE + NOTICE; npm packaging.

**Out (gated/deferred):** `eval`, `eval show`, `ui`, share-card bundle, device-flow login, host-side rulesets, commands/agents/hooks in profiles, hosted tier, `follow` semantics for bulk installs.

## 3. Stack and product repo layout

Node **22+** (Node 20 is EOL), TypeScript, ESM. npm package `terum-skills`; every printed command uses `npx -y terum-skills@latest …` (`-y` so a first-run machine doesn't stall on npx's install prompt). Deps: `commander`, `zod`, `yaml`, `proper-lockfile` **[default — veto cheap]**. Everything else shells out to `git` and `gh`. No HTTP client, no server, no daemon, no third-party CLI on the install path.

```
src/
  index.ts              commander wiring only
  commands/<verb>.ts    one file per verb
  lib/
    config.ts           ~/.terum/skills/config.json read/write
    teamRepo.ts         clone locations, remote matching, and safeWrite() — see §6.0
    schema.ts           zod schemas: team.json, people/<handle>.json, config.json, frontmatter
    guard.ts            metadata-based write guard (D12) — see §6.0
    version.ts          tree-hash version resolution + cache checkout
    placer.ts           Placer: resolve target → lock → copy → ledger → exclude line (§7); native only
    placer/vendor/skillhub/   vendored from iflytek/skillhub `cli/` (Apache-2.0; headers kept; NOTICE entry):
                        agent-profiles.ts (path table), fingerprint.ts, target-lock.ts
    readme.ts           README generator (D22)
    auth.ts             gh detection + per-team token fallback (D7/D8)
    hook.ts             SessionStart hook install + non-interactive sync mode
src/**/__tests__/       vitest, collocated (e.g. src/lib/__tests__/guard.test.ts,
                        src/commands/__tests__/install.test.ts); bare-repo fixtures
                        drive E2E + concurrency. Adversarial cases enumerated in §12.
```

Prior art is settled (rev 6): the Placer's agent path table, fingerprint, and lock are vendored from iflytek/skillhub's CLI (Apache-2.0). Its agent auto-detection, interactive scope prompt, and in-folder metadata file are **not** vendored — scope comes from `team.json` lists, never from a prompt (D18), and provenance is the `placements` ledger (§5.4), never a file inside the placed folder. Vendoring rules: keep iFlytek's copyright header on each copied file, add a NOTICE entry, mark modified files (Apache-2.0 §4). `gh skill` (preview) remains worth a glance for `--pin`/`--scope` conventions only.

## 4. File trees

### 4.1 The team repo (shared truth)

```
team-skills/
├── README.md                    GENERATED between <!-- terum-skills:begin/end --> markers;
│                                regenerated by the repo Action on main (laptop fallback §9)
├── team.json                    team config + endorsement lists (schema §5.1); skill lists
│                                change only via publish PRs — low-churn shared file
├── .github/workflows/
│   └── terum-skills.yml         GENERATED at team create: regenerates README on main,
│                                comments on publish PRs (§9) [default — veto cheap]
├── skills/                      THE flat store — every shared skill, exactly once
│   ├── single-fix/
│   │   ├── SKILL.md             frontmatter: name/description/license + metadata{id, author, terum-category}
│   │   └── references/…         aux files travel inside the folder
│   ├── decision-walk/
│   └── …                        folder name == frontmatter name, unique repo-wide
├── people/                      one file per member — the ONLY file that member's installs touch
│   ├── ryan.json                identity + installed/declined skill-ID lists (schema §5.2)
│   └── ajay.json
└── evals/                       reserved for phase 3; keyed by ID
    └── <skill-id>/<version>.json
```

Rules the tree encodes:
- **A skill exists once.** Endorsement and project assignment reference its ID; nothing is ever copied within the repo.
- **Membership is derived**: you are an **active member iff `people/<handle>.json` exists AND your handle is absent from `team.json archived`**. Both halves are required — the file alone is not membership, because departures archive rather than delete (§6 `team remove`). `team create` writes the creator's people file as part of the scaffold, so the creator is a member from the first commit. No shared members array — the review's concurrency fix.
- **Skill folder name == frontmatter `name`** (1–64 lowercase alphanumerics/hyphens, no leading/trailing/double hyphens — Claude Code dispatches by directory name), unique repo-wide, enforced at `share`. Collisions surface at share time; the old install-time prefix machinery (D16) is gone.
- **Ownership is metadata, not geography**: only the author named in a skill's `metadata.author` may modify its folder; only you may write `people/<you>.json`; `team.json` skill lists change via publish PRs, its `archived` list only via `team remove` (append) and `team join` (removing **your own** handle on rejoin). `guard.ts` enforces all four (§6.0).
- No CODEOWNERS: it can't map metadata ownership, and it's decorative on GitHub Free anyway (review).

### 4.2 Local state (`~/.terum/skills/` — never committed, safe to delete)

```
~/.terum/skills/
├── config.json                  handle, email, per-team remotes+tokens, shared-skill tracking,
│                                tool-grant approvals (§5.4)
├── teams/<team>/                full clone — the working copy sync pulls
├── cache/<team>/<full-tree-hash>/<skill>/    immutable pinned checkouts (git archive <tree>)
├── run/<team>.lock, <team>.stamp             hook mutex + hourly rate-limit stamp (§8)
└── quarantine/<ISO8601>/<name>/              folders moved aside by orphan handling, --force, and
                                              local-changed (§6); only `sync prune` deletes here
```

### 4.3 Placement targets (Placer-owned; plain copies, no symlinks)

The Placer **copies** the skill folder straight into the agent's skills directory — no canonical copy elsewhere, no symlink, identical on Windows. A copy is not a link, so `git pull` does NOT update placements; **`sync` re-places every tracked unpinned skill whose fingerprint changed** (§7). The fingerprint of what was placed is stored on the `placements` ledger entry (§5.4); nothing is written inside the placed folder.

```
~/.claude/skills/<name>/                     global placements (copy of clone or cache content)
<product repo>/.claude/skills/<name>/        project-list installs (§6)
```

For every placement inside a product repo, the Placer appends `.claude/skills/<name>` to that repo's `.git/info/exclude` (per-clone ignore, never committed) — safe whether the org commits or ignores `.claude/`, and immune to `git add -A`. `.agents/skills` is not written in phase 1; it returns with the agent-selection flag (D18).

## 5. Data schemas

Zod-validated on read; unknown fields preserved on write.

### 5.1 `team.json`

```jsonc
{
  "layout_version": 2,
  "name": "terum",
  "categories": ["debugging", "testing", "docs", "workflow", "research", "infra", "misc"],
  "global": ["8f3a2c1d-…"],                          // team-endorsed skill IDs
  "projects": {
    "terum-mvp": { "remotes": ["github.com/ryanliu-terum/Terum-MVP"], "skills": ["b2e4…"] }
  },
  "archived": [],                                    // handles removed by team remove
  "policy": { "publish": "pr", "skill_license": "UNLICENSED" }
}
```

Remote matching: normalize (strip protocol/credentials/`.git`/trailing slash, lowercase host) and compare.

### 5.2 `people/<handle>.json`

```jsonc
{
  "handle": "ryan",
  "display_name": "Ryan Liu",
  "email": "ryan@terum.ai",                          // feeds metadata.author "Name <email>"
  "github": "ryanliu",
  "bio": "one line",
  "installed": [
    { "id": "8f3a2c1d-…", "version": null, "scope": { "kind": "global" }, "since": "2026-09-03" },
    { "id": "b2e4…", "version": null, "since": "2026-09-03",
      "scope": { "kind": "project", "project": "terum-mvp" } }
  ],
  "declined": ["c9d1…"]                              // suppresses ALL automatic placement of that ID (§6 `uninstall`)
}
```

`version` is the **full 40-char tree hash** when pinned, null when tracking latest (short forms are display-only). Install counts (D38) are computed across all `people/*.json`.

**`scope` is a discriminated union, not a string** — `{"kind":"global"}` or `{"kind":"project","project":"<name from the team.json registry>"}`. A bare `"global"` string is not valid. The committed record names the *project*, never a filesystem path: paths are per machine and per checkout, and committing one would leak a local directory layout into shared truth. The machine-local `placements` map in §5.4 is where a placement's actual path lives, so two checkouts of the same project on one laptop are two `placements` entries against one `installed` record.

**Project resolution** is by worktree, and it is the same procedure everywhere (`install`, `uninstall`, both sync modes): walk up from the current directory to the nearest `.git`, read its `origin` remote, normalize it (§5.1), and match it against `team.json projects[].remotes`. A match names the project. No match, or no `.git`, means there is no project context: `install project <name>` from outside says so and exits rather than guessing a directory, and both sync modes simply skip project placements — a hook firing in an unrelated repo must never place that repo's skills somewhere else. Multiple projects and multiple checkouts are therefore handled by construction: the answer always comes from where the command is standing.

`declined` is a **single rule with no scope qualifier**: an ID in `declined` is never placed by any automatic path — not the join offer, not a later global publish, not project auto-placement inside a matching repo. Only an explicit `install` of that ID places it, and doing so removes the ID from `declined`. This is the whole opt-out contract; there is no separate per-project decline. **[default — veto cheap]**

### 5.3 SKILL.md frontmatter

Only Agent-Skills-legal top-level fields; everything custom nests under `metadata` (top-level unknown keys hard-fail Claude Code packaging, and SkillEvaluator reads `metadata.author` only):

```yaml
name: single-fix                 # == directory name
description: one-line description
license: UNLICENSED              # from team.json policy.skill_license
metadata:
  id: 8f3a2c1d-4e5f-…            # UUID minted at share; stable across renames
  author: "Ryan Liu <ryan@terum.ai>"   # SkillEvaluator's required Name <email> format
  terum-category: workflow
```

`share` injects `license`, `metadata.id`, and `metadata.author` (from config; email collected at first run, `gh api user` when available) **into the user's own source file, in place** — it shows the three added lines and takes a y/N before writing. The repo copy is then a byte copy of the source, which is what makes `sync`'s reconciliation a raw byte compare instead of a normalizing re-render. It also means a skill carries its own identity if `~/.terum/` is ever deleted. This satisfies SkillEvaluator's author and license schema findings — no broader Tier-1 claim (Tier 1 also runs security/PII/quality checks that injection cannot guarantee; that's phase 3's concern).

**Reconciliation contract** — and it is **three-way, never two-way**. A byte compare of source against repo copy tells you *that* they differ, never *which side moved*; with two laptops and one author, "my source is newer" and "my other machine already pushed this" are the same inequality. So `shared[id].baseline` persists the digest of the tree at the last successful reconcile, and every decision is made against it.

**The digest is canonical, and that is what makes managed fields harmless.** Every digest here — `S`, `R`, and the stored `B` — is computed over the skill tree with the three managed frontmatter fields (`license`, `metadata.id`, `metadata.author`) **excluded from the hashed content**, all other frontmatter and every byte of every other file included. Re-injecting or refreshing a managed field therefore cannot move any digest, on either side, at any time. An earlier formulation tried to get this by ordering the re-injection before the digests were taken; that does not work, because the stored baseline `B` was hashed under the old rules and is never re-normalized — rewriting the source moves `S` away from `B`, rewriting both moves both, and a genuine concurrent repo edit then lands in the both-changed row for no reason. Excluding the fields from the hash is the fix; ordering is not.

Let `S` = canonical digest of the source tree now, `R` = canonical digest of the repo copy now, `B` = the stored canonical baseline.

| `S` vs `B` | `R` vs `B` | Meaning | Action |
|---|---|---|---|
| same | same | nothing moved | no-op |
| **changed** | same | local edit | commit source over the repo copy via safeWrite; `baseline := S` |
| same | **changed** | another machine (or a bypassed guard) pushed | **fast-forward the source from the repo copy**; `baseline := R` |
| **changed** | **changed** | concurrent divergence | **refuse both ways.** Report both digests and the diff path, place nothing, commit nothing. `share --keep-source <id>` or `share --keep-repo <id>` resolves it explicitly and sets the baseline to the winner. |

No baseline stored (a skill shared before this field existed, or a wiped `~/.terum/`) is **not** an excuse to guess: treat it as the both-changed row and make the user choose once, then record the baseline.

Other branches:
- **Source missing** → do not delete the repo copy; warn once per sync and keep tracking. `share --relocate <id> <new-path>` re-points the map; `share --forget <id>` stops tracking after a y/N (the repo copy and its history stay).
- **Repo copy missing** while the source is present → the skill was removed upstream; do not silently re-push it. Report and require `share` again.
- **Managed fields edited locally** (`metadata.id` changed or removed) → the repo copy's `metadata.id` always wins and is re-injected into the source; `author` and `license` are refreshed from config and `team.json policy`. Because they are outside the canonical digest this is invisible to the table above — it is a repair, not a change, and it never advances the baseline on its own.
- **Which copy is written, and when `B` advances:** the winning side of a row is copied over the loser, managed fields are then re-injected into both, and `B` advances to the canonical digest of the reconciled content — once, after the write succeeds. A refused row (both-changed) writes nothing and leaves `B` where it was.
- **A changed `name`/dirname** is a rename, not a new skill: it must still be unique repo-wide, and the ID carries across it.
- Every row above has a named adversarial test in §12.

### 5.4 `~/.terum/skills/config.json`

```jsonc
{
  "default_handle": "ajay",                          // the suggestion offered at each join, editable any time
  "email": "ajay@terum.ai",
  "teams": { "terum": { "remote": "github.com/ryanliu-terum/team-skills", "token": null,
                        "handle": "ajay" } },       // THE handle for this team; per-team tokens (fine-grained PATs are single-owner)
  "shared": {                                        // my authored skills; `baseline` is what makes §5.3 three-way
    "8f3a2c1d-…": { "source": "~/.claude/skills/single-fix",
                    "team": "terum", "baseline": "sha256:41ab…" }
  },
  "approvals": {                                     // tool-grant consent; the ONLY thing that licenses a placement
    "8f3a2c1d-…": { "grants": "sha256:9c1f…", "approved_at": "2026-09-03" }
  },
  "pending": [                                       // durable intent — written BEFORE any placement changes
    { "op": "uninstall", "id": "8f3a2c1d-…", "team": "terum",
      "scope": { "kind": "global" }, "started": "2026-09-03T04:12:00Z" }
  ],
  "placements": {                                    // provenance ledger — the ONLY paths prune may touch
    "~/.claude/skills/single-fix": { "id": "8f3a2c1d-…", "team": "terum", "version": null,
                                     "scope": { "kind": "global" }, "placed_at": "2026-09-03",
                                     "fingerprint": "sha256:…" }            // §7 fingerprint of the placed copy
  }
}
```

Tokens: mode 0600, passed to `gh` via `GH_TOKEN` in the child env — never `gh auth login --with-token` (gh's manual warns against it).

**Handles are per team, not global.** `default_handle` is only the suggestion offered at each join; the binding identity is `teams.<team>.handle`, and it is immutable for that team once its people file exists. This is what makes a collision recoverable: joining a second team whose roster already contains `ajay` lets you take `ajay-t` there without touching who you are in the first team. A single global handle would make that join unresolvable, since renaming to clear it would rewrite your identity in a team that was never in question.

The default is derived once (`gh api user -q .login`, else the git remote's owner, else prompt), shown for confirmation, and editable at the prompt. Syntax is GitHub's own: 1–39 characters, ASCII alphanumerics and single internal hyphens, case-insensitive, stored lowercased. At `team join` it is checked against that team's `people/*.json` **before** any write: a collision with a live member re-prompts; a collision with an **archived** handle is the rejoin path (§6 `team join`). The handle need not equal the GitHub login — `invite` takes GitHub logins, and `people/<handle>.json` carries `github` so the two stay linked. `metadata.author` is `Name <email>`, never the handle, so per-team handles never fragment authorship.

**`pending`** is the durable intent log, and it exists because a two-step operation cannot be reconciled by looking at its outcome. `install` and `uninstall` each append an entry **before** touching a placement and remove it only after both the placement and the people-file write have landed. `sync` then finishes or unwinds whatever the entry says, and it never infers intent from state. Inference is exactly what fails: "a recorded install whose placement is missing" is indistinguishable from "an uninstall that removed the placement and then died before clearing the record" — and the reinstall that inference produces silently resurrects a skill the user deliberately removed. With `pending`, the first case has no entry and is adopted, the second says `uninstall` and is completed. An entry whose process is gone is resumable by any later `sync`; entries are idempotent by construction, so replaying one is safe.

**`placements`** is the provenance ledger — see §6 `sync prune`.

**`approvals`** (F17/F10) is the tool-grant consent record. The key is the skill ID; `grants` is `sha256` over the skill's `allowed-tools` **normalized**. An entry authorizes exactly that grant set. Any placement whose computed hash differs from the stored one — a new skill, an added tool, a widened glob — has **no approval** and is treated as unapproved, whatever the previous entry said. Approvals are per-machine and never committed.

**The `allowed-tools` schema, and what happens when it is not met.** The field is optional. When present it must be either a YAML sequence of non-empty strings, or a single string of comma-separated tool patterns. Normalization is: split, trim, drop empties, de-duplicate, sort, join with `\n`. **Absent, or present and empty, ⇒ the literal `none`** — a real, hashable answer meaning "grants nothing." The two are the same answer and are treated identically everywhere.

**Consent is a predicate on the normalized grant set, never on whether the field is present.** `none` is a grant set like any other: it hashes, it can hold an approval, and because it grants nothing it is the one value that needs no approval to place — in `install`, at join, in interactive `sync`, and in `sync --hook` alike. Any wording of the form "declares no `allowed-tools`" means "normalizes to `none`". An implementer who branches on `'allowed-tools' in frontmatter` has implemented the wrong rule: an author who writes `allowed-tools: []` must not be prompted where an author who omitted the line is not.

Anything else — a mapping, a number, a boolean, a nested sequence, unparseable YAML, or frontmatter that fails to parse at all — is **malformed**, and malformed is not `none`. A malformed value never normalizes, never hashes, and never matches an approval. Concretely: automatic placement in either sync mode is refused and the skill is reported; interactive `install` prints the raw value verbatim, states that it could not be parsed, and requires an explicit y/N naming the risk; `share` rejects the skill outright and names the line. The failure mode this closes is the one an implementer reaches for naturally — treating an unparseable grant as an absent one, hashing it to `none`, and auto-placing a skill whose actual grants nobody read.

## 6. Command behavior

Refs come in three forms; names resolve to IDs via `skills/*/SKILL.md`, and an 8-char ID prefix is accepted anywhere a name is.

| Form | Example | Resolves how |
|---|---|---|
| `<name>` | `single-fix` | within the one configured team; ambiguous if several teams are configured → §6 `install` |
| `<team>/<name>` | `terum/single-fix` | `<team>` looked up in `config.teams` — **requires local config** |
| `<org>/<repo>/<skill>` | `ryanliu-terum/team-skills/single-fix` | **self-locating**: the ref carries its own repository, so it works on a machine that has never run the tool |

Every ref accepts an optional `@<version>`. The three-part form is what the printed one-liners and share cards use, because it is the only one that resolves with no prior state — a two-part ref on a fresh machine has nothing to look `terum` up in. **[default — veto cheap]**

### 6.0 Every write goes through `safeWrite()`

The review reproduced the failure: two clones pushing → rejected push → rebase → conflict in derived files. `teamRepo.safeWrite(mutate, { branch })` wraps every mutating verb and uses a **re-apply model, not a rebase**. `branch` defaults to `main`; `publish` under the PR policy is the one caller that passes something else, and the destination ref is a parameter precisely so that the generic algorithm cannot push an endorsement to `main` behind the review gate:

1. `fetch`, then **hard-reset the clone to `origin/main`** — no local commit is ever carried forward, so there is nothing to conflict.
2. Re-run `mutate` **as a pure function of the tree it is handed**. Every one-time value (a minted UUID, anything the user typed or confirmed) is produced by the caller *before* the loop and closed over, so replaying `mutate` cannot mint a second UUID or re-prompt. `mutate` performing any I/O of its own is a bug.
3. Regenerate derived files (README on the laptop-fallback path, §9) — derived content is rebuilt, never merged.
4. Commit, then push **to `refs/heads/<branch>`** — never to a ref the caller did not name. With the default `main` this is the ordinary path. With `branch: publish/<name>` the commit is created on top of the freshly reset `origin/main` and pushed to that branch only; **`origin/main` is not a push target in this mode and must be byte-identical before and after**. An existing remote `publish/<name>` from an abandoned attempt is reset to the new commit with `--force-with-lease` (safe: the branch is derived, and the lease fails if someone else moved it); a lease failure falls back to `publish/<name>-2` rather than clobbering. On success `publish` runs `gh pr create` against `main`.
5. On rejection, loop. **Retry until a 30-second deadline**, fresh fetch each attempt, exponential backoff with full jitter.

On exhaustion, a `finally` step runs whether the loop succeeded, failed, or threw: fetch once more and **hard-reset HEAD, index, and worktree to `origin/main`**, then remove the untracked paths this operation itself created (tracked by the mutate, never a blanket `git clean`, which would eat unrelated files). Only then fail, loudly, naming the remote head that beat us. The reset is not optional and not implied by step 1: by the time the push is rejected the clone is carrying the local commit made in step 4, so it is *not* still reset — without an explicit final reset the next command starts on a dirty clone, and §12 asserts HEAD equality and a clean status here. No partial state, never a silent success. **[default — veto cheap: the 30 s deadline]**

A fixed retry *count* was rejected: with N concurrent writers an adversarial-but-legal schedule makes one writer lose N−1 successive races, so any constant under N cannot satisfy §12's eight-writer acceptance. A deadline degrades to "slow", a count degrades to "lost your write".

The guard (`guard.ts`) runs inside the loop, on the staged diff, which may touch only:

| # | Path | Permitted on |
|---|---|---|
| a | `skills/<name>/**` where that skill's `metadata.author` is you | `share`, `sync` auto-update |
| b | `people/<you>.json` | `join`, `install`, `uninstall`, `sync` |
| c | `team.json` `global`/`projects[].skills` | `publish` only |
| d | `team.json` `archived` — append your target's handle | `team remove` only |
| e | `team.json` `archived` — remove **your own** handle | `team join` only (rejoin) |
| f | generated files (README) | any path, regenerated not hand-edited |

Rows (d) and (e) are separate because they are different authorizations: (d) removes someone else, (e) restores only yourself. Without (e) a rejoin is a write the guard's own whitelist forbids, and the archived member can never come back.

**Authorization for `team remove` is host-scoped, because authorization is a host capability.** `invite` and the access-revoking half of `team remove` are **GitHub-only** in phase 1. On a GitHub remote the CLI checks admin permission (`gh api repos/{owner}/{repo} -q .permissions.admin`) before revoking, and refuses otherwise — the honest gate, since the repo host is the only thing that actually enforces it.

On a **generic-git remote** (a team created with `--remote` and joined by URL, §6) there is no portable admin predicate, no collaborator API, and no invitation to cancel. Both commands therefore **fail before any mutation**, naming the remote and saying access is managed on the host. `team remove <handle> --archive-only` remains available and does the part that is actually ours: append the handle to `team.json archived` via safeWrite, so the roster reflects the departure while the CLI makes no claim about access it cannot revoke. Its only enforceable predicate is push access to the repo — which the safeWrite push itself already proves — and the spec says so rather than implying a stronger check. Host adapters with real admin checks are DEFERRED past phase 1; nothing here forecloses them. A `pre-push` hook installed in the clone runs the same path check. Threat model unchanged: **prevents accidents, not abuse** — the actor identity the guard reads comes from local config the user controls, so raw git bypass remains possible and attributed.

- **`login`** — admins. `gh auth status` → use gh. Else prompt for a **per-team** fine-grained PAT (repo Administration + Contents), verify with a probe, store per-team. Collects handle (§5.4 rules), name, and email for `metadata.author` on first run (any user, `gh api user` defaults).
- **`team create <name> [--org <org>] [--remote <url>]`** — creates the private repo (`gh repo create … --private`), scaffolds §4.1 (team.json, empty `skills/`+`evals/`, workflow file, README) **and `people/<creator>.json`, so the creator satisfies the §4.1 membership predicate from the first commit**, pushes, clones, offers the hook (§8). `--remote`: push scaffold to an existing empty remote instead (the generic-git path — joinable via `team join <remote-url>`).
- **`team join <org>/<repo> | <remote-url>`** — never authenticates *with our tool*; it needs ordinary git/GitHub credentials. Two input forms:
  - **`<org>/<repo>`** (GitHub). With `gh` logged in (OAuth): list invitations, accept via `PATCH /user/repository_invitations/{id}`; an empty list is treated as "already a collaborator" (fine-grained tokens **cannot** accept invitations — review). Without `gh`: check invitation state first and print the accept URL *before* attempting the clone.
  - **`<remote-url>`** (any git host — the counterpart to `team create --remote`, without which a generic-git team could be created but never joined). Accepted forms: `https://host/path.git`, `ssh://git@host/path`, `git@host:path`. There is no invitation API: access is whatever the user's ambient git credentials already grant. A clone that fails on authentication prints "ask a team admin to grant you access to <remote>" and exits non-zero — it never retries with different credentials. The team name is the repo basename unless `--as <name>` overrides; the normalized remote (§5.1) is stored in `config.teams`, and a second join of an already-configured remote updates that entry rather than creating a duplicate team.

  Both forms then: resolve the handle (§5.4), clone, and check `people/*.json` **before writing** — a live collision re-prompts; a handle in `team.json archived` is a **rejoin**, which removes it from `archived` and reuses the existing people file (guard row (e), §6.0). Create/refresh `people/<handle>.json` via safeWrite (this *is* joining), show the `team.json` global set and prompt **y/N** to install it — a single prompt for the whole set, except that **every skill carrying `allowed-tools` is prompted individually** and its approval recorded (§5.4 `approvals`) — then print the roster.
- **`invite <github-login>...`** — **GitHub-only** (§6.0); on a generic-git remote it fails before mutating and says access is managed on the host. Takes GitHub logins, not team handles — the invitee picks their own handle at join. Adds collaborators, branching 201 (invited — GitHub also emails them) vs 204 (already has access); prints **one Slack-ready block** containing `npx -y terum-skills@latest team join <org>/<repo>`. Caps: 50 invitations/repo/day.
- **`team leave <name>`** — uninstall this team's placements, drop clone + config entry; leaves no repo trace (you remain an active member until an admin runs `team remove`). **`team remove <handle>`** — admin-only (§6.0 authorization check, GitHub-only), refuses on self and on the last remaining admin. Revokes collaborator access, **cancels any pending invitation**, appends the handle to `team.json archived` via safeWrite. On a generic-git remote it fails before mutating unless `--archive-only`, which appends to `archived` and explicitly claims nothing about access (§6.0); their `people/` file and skills remain, so the member becomes inactive by the §4.1 predicate without losing history — **departures archive, never delete**. Org base permissions can still grant read; document it. Reversible by `team join` (rejoin).
- **`share <path>`** — one-time entry into authorship. Validates name (regex, ==dirname, unique repo-wide — collision → suggest a rename), **rejects folders containing `.claude-plugin/` or hook definitions** unless `--allow-privileged`, mints the UUID **before entering safeWrite** (§6.0 step 2), injects the §5.3 fields **into the source file after a y/N**, copies to `skills/<name>/`, records the id→source mapping in config `shared`, commits `ajay: share single-fix` via safeWrite. Reconciliation on later syncs — including missing, relocated, and locally-edited sources — is the §5.3 contract. Thereafter automatic: **`sync` diffs each `shared` source against the repo copy and auto-commits `ajay: update single-fix`** — you never re-share.
- **`publish <name> [--project <proj>]`** — the deliberate team-endorsement act: adds the skill's ID to `team.json global` (default) or the project list. `policy.publish: "pr"` (default): `safeWrite(mutate, { branch: "publish/<name>" })` then `gh pr create` — the branch parameter is what keeps the generic algorithm off `main` (§6.0); merge is the review, and the Action comments on the PR. **A missing `gh` does not downgrade the gate** — under `"pr"` the command pushes the branch, prints the compare URL, and exits telling the user to open the PR; it never falls through to a direct push, because a policy any member can bypass by not installing `gh` is not a policy. Direct commit happens only under `policy.publish: "push"`, a team-level setting in `team.json`, after a y/N showing the skill. **[default — veto cheap: "pr"]**
- **`ls`** — roster (from `people/*`), skills with author, category, install count, latest short version; `ls member <handle>` (authored + installed), `ls project <proj>`.
- **`install <ref>[@<version>] | member <handle> | project <name>`** — resolves ref→ID (§6 ref table). A bare `<name>` with several teams configured is an error listing the matching teams and the qualified refs to retry with; `--team <name>` selects explicitly. A three-part ref on an unconfigured machine performs the §6 bootstrap first (collect handle → resolve remote from the ref → `team join` → then install).
  **Consent:** before placing, parse frontmatter and compute the normalized grant hash (§5.4). Any skill whose hash has no matching `approvals` entry prints its `allowed-tools` in full and requires y/N; on yes the approval is recorded. Workspace trust does not gate this (review).
  **Collision check — at the destination, by reading it:** the Placer resolves the exact target directory (`~/.claude/skills/<name>` for global, `<repo>/.claude/skills/<name>` for project) and inspects it. Absent → place. Present and in our `placements` ledger with the same skill ID → re-place. Present and anything else → the install **aborts** with the conflicting path and the `--force` hint; it never silently overwrites, and `--force` moves the existing folder into `~/.terum/skills/quarantine/` rather than deleting it. There is no global listing to misuse, so the audit's wrong-scope failure cannot occur.
  Versioned: cache checkout, place from cache. Unversioned: place from clone (a copy; refreshed by sync). The agent is always an explicit argument to the Placer (`claude-code` in phase 1); the Placer never auto-detects agents and never prompts (D18). `member`/`project` are snapshot bulk forms with per-skill summaries; `@<version>` is single-skill only. Personal (non-endorsed) skills place globally; project-list skills place into the matching repo **[default — veto cheap: no per-install project flag in v1]**.
  **Ordering and failure (F20):** write a `pending` entry (§5.4) → consent → **acquire the target lock** (§7; a second process on the same target gets "target busy", exits non-zero, writes nothing) → collision check → place → **release the lock** → add the path to the `placements` ledger, with the placed fingerprint → record `{id, version, scope}` in `people/<you>.json`, one safeWrite → clear the `pending` entry. The intent is durable before anything observable changes, so every partial state is *named* rather than guessed at. If the safeWrite exhausts its deadline the skill is placed but untracked; the command says so, exits non-zero, and leaves the entry for the next `sync` to finish. `sync` is the single reconciler and it acts only on `pending` entries and the ledger — never on inference from what happens to be on disk. No command attempts its own rollback.
- **`uninstall <ref> | member <handle> | project <name>`** — write a `pending` entry with `op: "uninstall"` → Placer remove (under the target lock; refuses any path that is not in the `placements` ledger or not under the resolved skills root — skillhub's path-safety rule) → drop the `placements` entry → people-file update → clear `pending`. The entry is what makes an interrupted uninstall recoverable: without it, a removal that dies before the people-file write leaves a record with no placement, and any rule that re-places such a record would silently undo the removal the user asked for. `sync` reads the entry, finishes the removal, and clears it. Uninstalling **any** skill that an automatic path would otherwise place — team-endorsed global *or* project-list — records its ID in `declined`, which suppresses every automatic placement of it (§5.2). Re-installing explicitly clears the entry. The `approvals` record is left alone: it is consent for a grant set, not a request for the skill.
- **`sync [--hook]`** — pull (ff-only); auto-update owned `shared` skills per the §5.3 reconciliation contract; **complete every `pending` entry first** — an `install` entry finishes placing and recording, an `uninstall` entry finishes removing and unrecording; both are idempotent, and only then is the entry cleared. Untracked placements in the ledger with no `pending` entry and no `installed` record are orphans (§6 `sync prune`), offered for adoption, never silently re-placed. Every `placements` entry is then classified — **up-to-date**, **update-available**, **local-changed**, **blocked**, or **orphaned** — by comparing the placed copy's current fingerprint against the ledger's and against the clone's (§7; the vocabulary is skillhub's). Then place, subject to one rule.

  **The consent rule, and it is the same in both modes:** a skill is placed only if its normalized grant hash (§5.4) matches a stored `approvals` entry, **or** it declares no `allowed-tools` at all. A skill whose grants are new, added to, or widened has no approval by construction — the hash changed — so *re-placing an update is a fresh consent decision, not a continuation of the old one*. This is what makes an approved skill unable to silently acquire `Bash(*)` in its next version.

  | | interactive `sync` | `sync --hook` |
  |---|---|---|
  | update to a tracked skill, grants unchanged | re-place | re-place |
  | skill with no `allowed-tools` | place | place |
  | **new or widened grants** | print the diff, y/N, record on yes | **never places — announces** |
  | **new `team.json global` ID** (not installed, not declined) | y/N per batch | **never places — announces** |
  | project-list skill in a matching repo | place, subject to the same rule | subject to the same rule |

  `--hook` is non-interactive, so for it "requires consent" can only mean "defer": it accumulates the deferred items and announces `2 skills need review — run \`terum-skills sync\`` on stderr. It never prompts, never places on an unmatched hash, and never records an approval. Deferral is not a decline; nothing is written to `declined`, and interactive sync will offer it again. An ID in `declined` is skipped by both modes with no announcement (§5.2).

  **Orphans, and the only paths that may ever be deleted.** A placement is Terum's if and only if it appears in the machine-local `placements` ledger (§5.4), written at the moment we place and removed when we remove. The Placer's scope-wide listing is *not* a provenance signal — it returns every skill on the machine, most of which are none of our business. A path absent from the ledger is never quarantined, never deleted, and never counted as an orphan, no matter what it is named or where it sits; the worst it can do is cause an install to abort on collision (§6 `install`).

An **orphan** is a ledger entry whose corresponding `installed` record is gone from `people/<you>.json` and which no `pending` entry explains. Orphans are **moved** into `~/.terum/skills/quarantine/<ISO8601>/` — never deleted — and reported. Only `sync prune` deletes, only from that quarantine directory, only after a y/N that lists every path by name, and never recursively outside it. A placement the user declined to adopt is recorded as declined and left alone permanently.

**local-changed and blocked.** *local-changed* means the placed copy's current fingerprint differs from the one on its ledger entry — someone edited the copy by hand. Placed copies are generated output, not an authoring surface (Ryan, 2026-09-03), so sync **overwrites, moves the edited copy into `~/.terum/skills/quarantine/<ISO8601>/<name>/`, and prints one line naming it** — never a silent overwrite, never a stale copy left in place. **[default — veto cheap]** *blocked* means the ledger and the clone disagree in a way the tool should not resolve alone — the entry's skill ID is no longer in the repo, or the placed version is newer than the clone's — so sync reports it and touches nothing. Prints one line when anything changed; silent otherwise.

## 7. Pinning and placement

- **Version resolve:** `git rev-parse HEAD:skills/<name>` → full tree hash (stored). Short forms resolve via `git rev-parse --verify <short>^{tree}`. Materialize with `git archive <tree> | tar -x` — a tree hash is accepted directly; no history walk (review-verified).
- **Placer (native, one implementation):** `resolveTarget(agent, scope, repoRoot?) → dir`, `inspect(dir) → absent | ours (a placements-ledger entry) | foreign`, `place(localPath, dir) → fingerprint`, `remove(dir)`. Three vendored skillhub pieces plus our glue:
  - **Agent path table** (`placer/vendor/skillhub/agent-profiles.ts`): project and user skills directories for 15 agents plus a generic fallback. Phase 1 reads exactly one row, `claude-code` → `<project>/.claude/skills` and `~/.claude/skills`. The resolver's auto-detect and interactive-select branches are not vendored.
  - **Fingerprint** (`fingerprint.ts`): sorted relative paths → sha256 per file → aggregate sha256; `diff(baseline, current)` names the changed files. Two callers: §4.3 re-placement and §6 `sync` classification. (§5.3 shared-source reconciliation keeps its own *canonical* digest, default 30 — managed frontmatter fields excluded — and is not this function.)
  - **Target lock** (`target-lock.ts` over `proper-lockfile`): one lock per resolved target directory, in a private owner-checked lock dir under the OS temp root; stale after 10 s; contention fails fast with "target busy". This is the per-placement lock; the per-team hook mutex (§8, default 31) is separate and unchanged.
  - **Glue (ours):** copy into a temp sibling, then rename into place — never a half-copied folder; write the `placements` entry with the fingerprint; append the `.git/info/exclude` line for project scope. Windows is the same path. A rename-on-collision (rare now) stages a temp copy with the new dirname+`name` before placing.

## 8. Session-start hook

Installed only after y/N at create/join, into **`~/.claude/settings.json`**. The literal settings block (matcher limits it to real startups — an omitted matcher would fire on every `/clear` and compaction; async so a slow pull can't block session start; stdout must be only the reload directive because SessionStart stdout is injected into context):

```jsonc
{ "hooks": { "SessionStart": [ { "matcher": "startup", "hooks": [ {
  "type": "command",
  "command": "npx -y terum-skills@latest sync --hook",
  "async": true, "timeout": 60
} ] } ] } }
```

`sync --hook` additionally: takes the `run/<team>.lock` mutex, no-ops within an hour of `run/<team>.stamp`, sets `GIT_TERMINAL_PROMPT=0`, and prints exactly `{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}` on **stdout** when it placed skills (otherwise nothing) — without it, newly placed skills appear only next session.

What it may place is the §6 `sync` consent rule, unchanged: updates to skills whose grant hash still matches, and skills with no `allowed-tools`. It never places a new or widened grant. The deferral announcement goes to **stderr**, never stdout, because SessionStart stdout is injected into the session context and must carry only the reload directive. A hook run therefore has exactly two possible stdout states: the reload directive, or nothing.

**What the hook does not promise.** `async: true` means Claude Code starts the process and continues immediately; the hook's output is consumed on a later turn, so **a skill placed by the hook is not guaranteed to be usable in the turn that triggered it**. The spec keeps async — a network pull must never sit in front of session start — and drops the same-session claim rather than the safety property. The guarantee is: skills the hook places are active no later than the next session, and the stderr line tells a user who wants them now to run `terum-skills sync`. The `reloadSkills` directive is still emitted, best-effort, for whatever the runtime can honor. **V8 measures which it is**, and if an async SessionStart hook turns out never to honor `reloadSkills`, the directive is dropped rather than kept as decoration. Making the hook synchronous to force a same-session reload is explicitly rejected: it trades a guaranteed startup stall for a convenience.

**Mutex and rate-limit protocol** (`hook.ts`). Three windows opening at once must not run three pulls into one clone, so:
- **Acquire** by creating `run/<team>.lock` with `O_CREAT|O_EXCL` (atomic on every platform we target) containing `{pid, host, started}`. One lock **per team**, so unrelated teams never serialize behind each other.
- **Contention: exit, do not wait.** A hook that loses the race exits 0 in silence — another window is already doing the work, and a queue of blocked startup hooks is the failure this lock exists to prevent.
- **Stale recovery:** a lock is stale if `started` is more than 10 minutes old, or if `host` is this machine and `pid` is not alive. A stale lock is removed and re-acquired once; a lock held by another host is always respected. Without this rule a crashed process disables sync forever.
- **Release** in a `finally`, on every exit path including failure.
- **The stamp is written only after a sync that fully succeeded.** A failed or partial run leaves the old stamp so the next session retries, rather than rate-limiting the failure into an hour of silence.

**Settings-file mutation contract** (`hook.ts`). Installing and removing the hook edits a file the user owns and shares with every other tool, so the write is defined, not improvised:
- **Target** `~/.claude/settings.json`. Absent → create it, mode 0600, containing only this hook.
- **Parse before write.** Unparseable JSON → refuse, print the path, change nothing. Never rewrite a file we could not read.
- **Idempotency key** is a SessionStart hook entry whose `command` contains `terum-skills`. Present → replace **in place**; absent → append. Joining five teams therefore yields exactly one entry, because `sync` already loops over every configured team — the hook is per machine, not per team.
- **Preserve everything else** byte-for-byte where the JSON round-trips: other `SessionStart` entries, other events, unrelated top-level keys, key order.
- **Write atomically**: temp file in the same directory, `fsync`, `rename` over the target. An interrupted write can leave the old file or the new one, never a truncated one.
- **Back up** the previous contents to `~/.terum/skills/backups/settings.<ISO8601>.json` before the first modification on a machine.
- **Removal** (`team leave` of the last team) deletes only the entry matching the idempotency key, leaves the rest of the file alone, and removes nothing if the key is absent.
- `hook.test.ts` carries the adversarial cases: an existing unrelated SessionStart hook survives; repeated installs never duplicate; malformed JSON refuses; an interrupted rename leaves a valid file; leave-with-other-teams-remaining keeps the entry.

## 9. README generator and repo Action

README from the flat data: team header; roster; **per-author sections** (grouped by `metadata.author` — the browse-by-person view GitHub's file tree no longer gives); per skill: name, category, description, install count (IDs resolved to names at generation time), endorsement badge (global/project), latest short version, eval column ("—" until phase 3), one-line install command. Markers preserve hand-written text.

Regeneration: the scaffolded **GitHub Action** regenerates README on pushes to main and posts one edited-in-place comment on `publish/*` PRs — removing derived-file churn from laptop commits (the exact conflict the review reproduced) and giving publishes a push signal. Laptop fallback (non-GitHub remotes): regenerate inside safeWrite post-rebase. **[default — veto cheap: Action on]**

## 10. Verification tasks (before/during M1)

- **V2 and V7 — deleted in rev 6:** both existed only to characterize the Vercel CLI, which is no longer on the path.
- **V4 (rewritten):** with an ordinary `gh` OAuth login, list-then-PATCH invitation accept works end-to-end; confirm the fine-grained-token failure mode and the 204/empty-list "already collaborator" path.
- **V5 (new):** run `skillevaluator validate` against one real shared skill before writing injection logic; confirm `metadata.author` and `license` findings clear.
- **V6 (new):** `gh repo create --private` and `gh pr create` mechanics for `team create` and `publish` (unverified by the review).
- **V8 (new, rev 4):** does an `async: true` SessionStart hook's `hookSpecificOutput.reloadSkills` get honored at all, and if so on which turn? This decides whether §8 keeps emitting the directive or drops it. Measure before M4; the hook ships async either way.
- **V9 (new, rev 6):** confirm the vendored `claude-code` row's two paths (`~/.claude/skills`, `<project>/.claude/skills`) against current Claude Code docs, and confirm the NOTICE wording satisfies Apache-2.0 §4 for the three vendored files.
- (V1 and V3 from rev 1 are answered by the docs — deleted. Frontmatter must nest under `metadata`; Claude Code dispatches by directory name.)

## 11. Build order

- **M1 — plumbing:** scaffold, config, schemas, auth, `safeWrite()` + guard, `team create`/`join` against a real private repo. *Exit: two laptops joined; the join prompt flow works.*
- **M2 — the loop:** `share` (+auto-update), `install`/`uninstall`, `sync`, native Placer (vendored pieces first, glue second), version cache. *Exit: onboarding walkthrough works for two people, including a pinned install and an allowed-tools prompt.*
- **M3 — the team layer:** `invite`, `remove`, `leave`, `ls`, `publish` (both policies), README generator + Action. *Exit: a publish PR merges, teammate gets the y/N on next sync, README shows it all.*
- **M4 — ship:** hook (§8), Windows pass (same Placer code path — run the suite there), LICENSE (Apache-2.0) + NOTICE, npm metadata + publish dry-run, reserve name at 0.1.0. *Exit: `npx -y terum-skills@latest install <org>/<repo>/<skill>` works on a machine that has never seen the tool — the three-part ref carries its own repository, so the run bootstraps identity, joins, and installs in one command.*

## 12. Acceptance

The two-person E2E: create → invite → join (y/N prompt) → share ×2 → edit-then-sync auto-update → install (one pinned, one latest) → publish via PR → teammate prompted and accepts → project-list skill auto-places in a matching repo → README + Action comment reflect all of it. Plus a **rejoin**: remove a member, confirm they read as inactive, then have them `team join` again and land back on their existing people file.

The review's concurrency test: **eight clones of one bare repo running join/share/install concurrently — every write lands within the §6.0 deadline, no dirty clone, no conflict**, exercised with a synchronized worst-case schedule (all eight releasing on one barrier) rather than relying on favorable jitter.

Tests are **collocated** under `src/**/__tests__/` (vitest); bare-repo fixtures drive E2E and concurrency, no network. Named suites at minimum: `lib/__tests__/{guard,schema,version,readme,teamRepo,auth,placer,hook}.test.ts` and `commands/__tests__/{join,share,install,uninstall,sync,publish,remove}.test.ts`. Adversarial cases each suite must carry:
- **guard** — a diff touching another author's skill folder; another member's people file; `team.json global` from a non-publish path; `archived` append from `join`; `archived` removal of someone else's handle; a rename that moves a file out of an owned folder.
- **safeWrite** — the barrier-synchronized eight-writer race; deadline exhaustion leaves a clean clone and a non-zero exit; a replayed `mutate` mints no second UUID.
- **consent** — a previously approved skill whose next version adds a tool, widens a glob, or reorders an unchanged list (the last must still match: normalization is trim + de-dup + sort); `--hook` places none of the first two and announces on stderr with empty stdout.
- **collision** — a foreign folder at the exact destination aborts non-destructively; a folder that is in the `placements` ledger with the same ID re-places; a project-scope placement never consults the global directory.
- **placer** — `resolveTarget` for both scopes; copy-then-rename leaves no partial folder on a simulated crash; fingerprint diff names exactly the changed files; two processes on one target — the second gets "target busy" and writes nothing; a stale lock is reclaimed; one case per §6 sync status (up-to-date, update-available, local-changed → overwritten and quarantined, blocked → untouched, orphaned); `remove` refuses a path outside the skills root and a path absent from the ledger.
- **partial state** — placement succeeds then the record push exhausts; record lands then placement fails; interrupted mid-command. `sync` reconciles each **from the `pending` entry**. The named regression: interrupt an uninstall after the Placer removed the folder but before the people-file write, then run `sync` — the skill must stay gone. Replaying any `pending` entry twice must be a no-op.
- **publish branching** — under `policy.publish: "pr"`, `origin/main` is byte-identical before and after, with `gh` present and absent, and when `publish/<name>` already exists (force-with-lease succeeds; a failed lease falls back to `-2` and clobbers nothing).
- **prune provenance** — a user's own unrelated skill folder of the same name is never quarantined or deleted; a declined adoption survives prune; prune deletes only inside `~/.terum/skills/quarantine/`.
- **hook mutex** — two hook processes racing (second exits 0, silently); a stale lock from a dead pid is recovered; a lock from another host is respected; a failed sync leaves the old stamp so the next session retries; two teams do not serialize.
- **scope** — two projects on one machine, two checkouts of one project, and invocation outside any matching repo (project placements skipped, never guessed).
- **schema/refs** — `allowed-tools` absent, empty, a sequence, a comma-string, and **malformed** (mapping, number, unparseable): the first four hash, the last refuses placement in every mode and is never hashed as `none`. Unknown top-level frontmatter keys; a bare ref with two teams configured; a near-match remote that must not match.
- **reconciliation** — one test per row of the §5.3 table, including both-changed refusing in both directions, a missing baseline behaving as both-changed, a second-machine push fast-forwarding the source, and a managed-field refresh that must not read as a user edit.
- **identity** — joining a second team whose roster already holds your default handle; the per-team handle must diverge without touching team one.
- **host scoping** — `invite` and `team remove` on a generic-git remote fail before any mutation; `--archive-only` still lands the roster change.
- **hook install** — the §8 settings cases (unrelated hook preserved, repeat install idempotent, malformed JSON refused, interrupted rename leaves a valid file).

## 13. Defaults chosen here (veto before M1 ends)

1. Verb for entering authorship: `share` (over `track`/`add`).
2. Skill IDs: UUIDs minted at share; folder named by skill name; no file path in metadata (derivable).
3. Deps commander+zod+yaml+proper-lockfile; Node 22 floor (Node 20 EOL).
4. Starter categories (7); `policy.publish` = `"pr"`; `skill_license` default `"UNLICENSED"`.
5. GitHub Action on by default; laptop regeneration for non-GitHub remotes.
6. Personal skills install globally; only team project lists place into product repos (no `--project` on install in v1).
7. Team repos scaffold without a LICENSE file (team content isn't ours to license).

Added in rev 3, closing the audit:

8. Membership is a two-part predicate (people file exists AND handle not archived); departures archive, never delete; rejoin restores.
9. `safeWrite` is re-apply, not rebase, and retries to a **30-second deadline** rather than a fixed count.
10. Tool-grant consent is persisted per machine as `approvals[id] = sha256(normalized allowed-tools)`; a changed hash is no approval; `sync --hook` defers rather than prompts and never places an unapproved grant.
11. `share` mutates the user's **source** SKILL.md (after y/N) so reconciliation is a byte compare.
12. `declined` is one scope-free rule suppressing every automatic placement path.
13. Self-locating three-part refs `<org>/<repo>/<skill>` for fresh machines; two-part refs need local config; `--team` disambiguates.
14. Generic-git `team join <remote-url>` for teams created with `--remote`; no invitation API, ambient credentials only.
15. Handle defaults to the GitHub login, is confirmable at the prompt, and is collision-checked at join.
16. `team remove` is admin-only; a missing `gh` never downgrades a `"pr"` publish policy to a direct push.
17. Tests are collocated under `src/**/__tests__/` with the §12 adversarial cases.

Added in rev 4, closing the second audit round:

18. Handles are **per team** (`teams.<team>.handle`), with a global `default_handle` as the suggestion — the only shape in which a second-team collision is recoverable.
19. `shared[id].baseline` persists a digest so §5.3 reconciliation is three-way; concurrent divergence refuses rather than picking a winner, and a missing baseline is treated as divergence.
20. `allowed-tools` has a declared schema; **malformed is not `none`** and never auto-places.
21. `invite` and access-revoking `team remove` are GitHub-only; generic-git teams get `--archive-only` and an honest failure. Host adapters DEFERRED.
22. The session hook stays **async** and stops promising a same-session reload; V8 decides the fate of the `reloadSkills` directive.
23. `hook.ts` has a defined settings-file contract: `~/.claude/settings.json`, parse-before-write, one idempotent entry per machine, atomic rename, backup, targeted removal.
24. `safeWrite` resets to `origin/main` in a `finally`, so exhaustion genuinely leaves a clean clone.

Added in rev 5, closing the third audit round:

25. `config.pending` is a durable intent log written before any placement changes; `sync` reconciles from intent, never by inferring it from disk state — which is what let an interrupted uninstall be undone.
26. `safeWrite` takes a `branch`; PR-policy `publish` passes `publish/<name>` and provably never writes `origin/main`.
27. `config.placements` is the provenance ledger, and it is the **only** source of deletable paths: unknown folders are never quarantined or pruned. Orphans move to `~/.terum/skills/quarantine/`; `prune` deletes only from there, only after a y/N listing every path.
28. Consent is a predicate on the normalized grant set, not on field presence — `allowed-tools: []` and an omitted line behave identically.
29. `scope` is a discriminated union naming the *project*, not a path; placement paths are machine-local, and project context always comes from the worktree the command is standing in.
30. Reconciliation digests are **canonical** — managed frontmatter fields are excluded from the hash, so re-injection cannot manufacture a conflict.
31. The hook mutex is `O_EXCL` per team, losers exit rather than queue, stale locks recover on a 10-minute/dead-pid rule, and the rate-limit stamp advances only after a fully successful sync.

Added in rev 6, replacing the placement layer (iflytek/skillhub comparison):

32. The Placer is **native**, built on three vendored iflytek/skillhub CLI modules (agent path table, per-file fingerprint, per-target lock) under Apache-2.0 with NOTICE attribution. The Vercel `skills` shell-out is **removed, not kept as an option** — two placement paths would violate the repo's one-path rule. Reverses walk Decision 3 and Ajay's 2026-09-03 ruling; Ryan's override is recorded in Terum the same day.
33. Provenance stays the `placements` ledger (default 27), now carrying the placed copy's fingerprint; nothing is ever written inside a placed folder. A hand-edited placed copy (**local-changed**) is overwritten on sync and moved to quarantine, with one printed line — placed copies are generated output, not an authoring surface.
34. Every move-aside — orphan, `--force`, local-changed — lands in `~/.terum/skills/quarantine/<ISO8601>/<name>/`, never inside an agent's skills directory; only `sync prune` deletes there (default 27).
