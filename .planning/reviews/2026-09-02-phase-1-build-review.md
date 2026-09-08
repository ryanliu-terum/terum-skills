# Review: phase-1 build spec

**Status:** Review complete. Verdict: not build-ready as stamped; four blockers, nine significant, six minor.
**Date:** 2026-09-02
**Target:** `.planning/specs/2026-09-02-phase-1-build.md` at `631fa19` (parent ledger at `5a9ce4e`, D1–D38; walk unchanged).
**Reviewer:** Teddy, with Claude.
**Scope:** Issues intrinsic to the spec. Anything that only holds for one team's repos, accounts, or machines has been left out; every reproduction below was done on scratch repos with a redirected home directory, so it holds for any team.

## Method

Four independent finders (drift from the parent ledger; claims contradicted by verified facts; build-readiness; first-week use), then two adversarial skeptics per non-minor finding, one arguing as the spec's author and one as the implementer, each instructed to refute by default. Only findings that survived at least one skeptic appear below; findings both skeptics refuted are listed at the end for the record.

| Outcome | Count |
|---|---|
| Non-minor findings raised | 76 |
| Survived both skeptics | 20 |
| Refuted by one, kept by one | 20 |
| Refuted by both | 36 |

Overlapping findings from different finders are merged here, so the item count below is smaller than the tally.

Facts relied on throughout, verified 2026-09-02: `skills@1.5.23` (the borrowed Vercel CLI) declares `engines.node >=22.20.0`, has no library API, chooses copy mode whenever the install resolves to one target directory (`dist/cli.mjs` lines 4401 and 4915), uses NTFS junctions on win32 (line 2143), and skips lockfile and telemetry writes for local-path sources (line 5026). GitHub gates CODEOWNERS and protected branches to public repos on the Free plan and to paid plans for private repos. Repository invitations expire after seven days. Claude Code resolves personal and project skills by directory name, lets personal skills override project skills of the same name, and runs SessionStart hooks on startup, resume, clear, and compact with a 600-second default timeout.

---

## Blockers

### B1. No write policy for a shared branch

**Where:** §6 (`publish`, `use`, `unuse`, `join`, `promote`, `remove`), §8.
**Spec says:** "regenerates READMEs; commits `<handle>: publish <skill>` and pushes." / "Regenerated on every publish/promote/join/remove; committed in the same commit."
**Problem:** Six verbs commit and push to one branch. Three of them regenerate `README.md` in the same commit, and `join` appends to `team.json`. The words fetch, rebase, retry, conflict, and lock do not appear in the document. The README is a whole-file function of every `profile.json`, so two members regenerating from different bases produce different bytes for the same logical state.
**Evidence (reproduced on a bare-repo fixture):** two members publish before either pulls; the second push is rejected non-fast-forward; the next `sync` (plain `git pull`) fails with `fatal: Need to specify how to reconcile divergent branches`; `git pull --rebase` stops on `CONFLICT (add/add): Merge conflict in README.md` and leaves the clone mid-rebase. No verb in §6 repairs that state.
**Fix:** One write transaction used by every writing verb: `git fetch`; `git rebase --autostash origin/<default>`; apply the content change; regenerate README and CODEOWNERS from the post-rebase tree; commit; push; on rejection retry from the fetch up to three times, then exit with a named code. Set `pull.rebase=true` in the clone the CLI creates. Add a two-writer case to §11.

### B2. No identity model

**Where:** §5.1, §5.4, §6 (`login`, `team create`, `team join`, `invite`), §4.1 (CODEOWNERS).
**Spec says:** "Then adds self to `team.json members` (commit `<handle>: join`)" / "**`invite <handle>...`** — admin: `gh api` (or PAT) to add collaborators" / `login` "stores nothing".
**Problem:** `handle` names the member folder, is the guard's ownership predicate, prefixes every commit, is the left side of every CODEOWNERS line, and is a ref segment, yet no command assigns it. `invite` takes a handle, but GitHub's collaborator endpoint takes a login, and §5.1 keeps `handle` and `github` as two fields with no rule linking them and no moment at which the mapping is written (the member record is created at join, which is after invite). No charset rule, no uniqueness check, no reservation of the owner-level names `team` and `evals`.
**Consequence:** M1's exit criterion cannot be reached without the implementer choosing an identity model, and the choice has permanent repo-layout consequences.
**Fix:** `team create --as <handle>` and `team join --as <handle>`, defaulting through a stated order (flag, then `gh api user --jq .login`, then `git config user.email` local part, then prompt), persisted to `config.json`. `invite <github-login>[:<handle>]` writes the `{handle, github}` member record at invite time (a named guard exemption). Charset `^[a-z0-9][a-z0-9-]{0,38}$`, reserved set `{team, evals}`, hard failure on a handle already present with a different `github`.

### B3. The share ref cannot resolve for a first-time user

**Where:** §6 (Refs line and `use`), §5.4, §10 (M4 exit).
**Spec says:** "For a stranger with repo access, `npx terum-skills use <full-ref>` walks them through join first (D31/3.4 rules)." / M4: "`npx terum-skills use terum/<handle>/<skill>` works on a machine that has never seen the tool."
**Problem:** A ref is `<team>/<handle>/<skill>`, and the only place a team name maps to a clone URL is the local `config.json`, which a newcomer does not have. Nothing forces the team name to equal the GitHub owner (the spec's own example names the team `terum` and puts the repo under a differently named owner), `team create` names the repo `team-skills` regardless, and D5 forbids a registry that could do the lookup. M4 asserts a flow that cannot run.
**Fix:** Carry the remote in the shareable form: either extend the grammar to `<host>/<owner>/<repo>/<handle>/<skill>@<pin>` or accept `use --remote <clone-url> <handle>/<skill>@<pin>`, generated by the tool from the team's configured remote. Keep `<team>/…` as a shorthand valid only for teams already in `config.json`. Restate the M4 exit criterion in the emitted form.

### B4. Project-scoped placement writes over git-tracked content

**Where:** §4.3, §6 (`use`, `sync`), §7 (Placer).
**Spec says:** "`<product repo>/.claude/skills/` … project-scoped installs" / `sync`: "when run inside a repo matching a registered project, auto-install that project's `team/<project>/` skills (D14)".
**Problem:** Project skills in Claude Code live in the repo's `.claude/skills` precisely so they can be committed, so that directory is git-tracked in most real repositories. The Placer writes into it without checking what is there.
**Evidence (reproduced in a scratch repo with a committed `.claude/skills/<name>/SKILL.md`):** copy mode overwrote the committed file (`git status` shows ` M .claude/skills/<name>/SKILL.md`); symlink mode deleted the committed directory and replaced it with a symlink to `../../.agents/skills/<name>` (` D` plus `??` in `git status`); the tool also wrote `skills-lock.json` at the repo root.
**Partially addressed at `631fa19`:** the Placer now appends the placed path to `.git/info/exclude`. That keeps an untracked placement out of `git status` and out of an accidental `git add -A`. It does nothing for a path the repo already tracks, because exclude rules only apply to untracked files, so the overwrite and the delete above still happen.
**Fix:** Before any project-scoped placement, run `git ls-files --error-unmatch <path>`; if the path is tracked, refuse with a message naming the conflict (offer `--force` and `--as <name>`). Remove or restore `skills-lock.json` after the shell-out. Add "repo that already tracks its `.claude/skills`" to the M2 test matrix and to §11.

---

## Significant

### S1. The Placer call omits the agent flag

**Where:** §7.
**Spec says:** "Default impl shells `npx skills add <localPath> --skill <name> -g -y`".
**Problem:** Walk Decision 3's call carries `-a <agents...>`; the build spec dropped it while keeping `agents` in the `place()` signature. With no `-a`, the tool installs into every agent it knows.
**Evidence (reproduced):** the exact command on a clean home created about 57 agent directories (`~/.adal`, `~/.grok`, `~/.qwen`, `~/.trae`, `~/.kiro`, `~/.junie`, `~/.openclaw`, …), switched to symlink mode because more than one target now existed, printed two per-agent failures, and exited 0.
**Fix:** Write the call as `npx skills add <localPath> --skill <name> -a <agents...> -g -y`, make `agents` a required argument defaulting to `['claude-code']`, parse the child's "Failed to install" block instead of trusting the exit code, and assert that exactly the expected placement directories exist afterwards.

### S2. No placement ledger

**Where:** §4.2, §4.3, §5.4, §6 (`unuse`, `sync`), §7 (`remove`, `list`).
**Spec says:** "**`unuse <ref>`** — Placer remove + profile.json update, commit, push." / "`sync` reconciles 4.3 against 4.1: refreshes links, prunes any whose source folder vanished".
**Problem:** The borrowed tool writes no lockfile for local-path installs, so its `list` is a directory scan reporting `Source: local` and its `remove` works by directory name. Nothing in `config.json` (`handle`, `teams`, `github_token`) or `profile.json` `uses` (`ref`, `pin`, `scope`, `since`) records where a placement landed or under what applied name. Auto-installed `team/` skills are recorded nowhere at all.
**Evidence (reproduced):** after a local-path install, `skills update -g -y` printed "No global skills tracked in lock file"; `unuse` of a ref deleted a hand-written skill of the same name; `use … -y` silently overwrote a pre-existing same-named skill with no prompt, no backup, exit 0.
**Consequence:** `unuse` and prune are destructive to content the tool did not place; "prunes any whose source folder vanished" is unimplementable; a removed team skill stays installed forever.
**Fix:** Add `placements` to §5.4: `{ ref, pin, agent, scope, applied_name, path, mode, placed_at, auto }`, written on every successful `place()`. `unuse` and `sync --prune` operate only on the ledger and refuse any path not in it. Never pass `-y` to the borrowed tool over an existing path that is not in the ledger; show both descriptions and offer `--as <name>` or the `<handle>-<skill>` prefix.

### S3. Every install is a network write

**Where:** §5.2, §6 (`use`), §4.1.
**Spec says:** "`use`/`unuse` edit **your own** profile.json, commit … and push. This is deliberate write-traffic" / "A member folder exists only after that member's first publish".
**Problem:** Installing now needs push access and a reachable remote. Offline `use` fails; a recipient with read-only access (the D31 "stranger with repo access") installs but cannot record; a member who has joined but not published must have their folder created by `use`, contradicting §4.1's rule, and nothing says who fills `display_name` and `bio` then.
**Fix:** Place first, record second. On a rejected push keep the placement, warn once, mark the ledger entry unrecorded, and reconcile on the next successful write. State that `team join` creates `<handle>/profile.json` in its own commit, and amend §4.1.

### S4. Session-start hook is one sentence

**Where:** §7.
**Spec says:** "`team create`/`join` offer to add a Claude Code SessionStart hook running `terum-skills sync --quiet` to `~/.claude/settings.json`; never installed without a y/N."
**Problem:** No `timeout` (default 600 s), no `async`, no `matcher` (fires on startup, resume, clear, and compact), no rule for merging into an existing `hooks.SessionStart` array or removing the entry idempotently on `team leave`, nothing preventing a credential-helper prompt from blocking, no debounce, no offline behaviour, no statement of what a failing `--quiet` prints (SessionStart stdout is injected into the model's context).
**Fix:** Pin the literal JSON written (merged into the existing array with a stable marker object), `"timeout": 20`, `"async": true`, matcher limited to `startup` and `resume`; run the child with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`; debounce with a `~/.terum/skills/.last-sync` stamp; `--quiet` means zero stdout and exit 0 when offline; remove on `team leave` and uninstall. Add "sync fails silently when offline" to §11.

### S5. Remote normalization misses common forms

**Where:** §5.1.
**Spec says:** "normalize both sides — strip protocol, credentials, `.git` suffix, trailing slash, lowercase host — and compare."
**Problem:** Implemented literally, the rule does not match scp-style `git@host:owner/repo.git` (no protocol to strip, `:` where `/` is expected), never strips a port from `ssh://host:22/…`, and folds case only on the host, so a path-case difference never matches although GitHub treats owner and repo case-insensitively. Undefined: which remotes count (`origin` only or all), worktrees, submodules, subdirectories. A miss is indistinguishable from "no project registered here".
**Fix:** Give the algorithm with test vectors: lowercase the whole string; rewrite `git@<host>:<path>` to `<host>/<path>`; strip `ssh://`, `git://`, `http://`, `https://`, `<user>[:<pass>]@`, `:<port>`, trailing `/`, trailing `.git`. Consult every configured remote. Locate the repo with `git rev-parse --show-toplevel`. When nothing matches, print the normalized value and the registry entries compared.

### S6. CODEOWNERS claims more than it does

**Where:** §4.1, §6 (write guard).
**Spec says:** "GENERATED at team create: one line per member … makes cross-folder diffs ping the owner".
**Problem:** Four independent gaps. CODEOWNERS is unavailable on private repos under the Free plan. It acts only on pull requests, and `publish` pushes directly to the default branch, so it never fires even on a paid plan. It is generated only at team create, when there is one member, and the regeneration list in §8 never mentions it, so later members never get a line. And the guard's exemption list (team.json membership edits, `team/` writes by promote, README regeneration) does not include CODEOWNERS, so the tool cannot update it on join or remove without violating its own rule.
**Fix:** Regenerate CODEOWNERS with the READMEs on join and remove and add it to the guard exemptions. Downgrade the comment to: advisory; requests reviewers on pull requests only, on plans where CODEOWNERS is enabled for private repos. If review of `team/` is wanted, rely on `promote` always opening a PR, which works on every plan.

### S7. README usage counts go stale

**Where:** §8.
**Spec says:** "Regenerated on every publish/promote/join/remove … usage count (from all profile.json `uses`)".
**Problem:** `use` and `unuse` are the only verbs that change the usage column, and they are not in the regeneration list. D38 makes usage counts the meaning of "rated"; in steady state (publishing rare, using frequent) the committed README is wrong most of the time.
**Fix:** Add `use`/`unuse` to the list (both already push, so the README lands in the same commit), or compute the count at read time and drop it from the committed artifact. Say which.

### S8. Pin materialization

**Where:** §7 (Pin resolve), §4.2.
**Spec says:** "find a commit containing that tree (`git log --format=%H -- <path>` walked until `rev-parse <commit>:<path>` matches), then `git archive <commit> <path> | tar -x` into the cache."
**Problem:** Three defects. `git log -- <path>` applies history simplification and can drop the commit that carries the pinned tree; reproduced with a merged side branch resolved in the other side's favour: the pinned tree was a live object and `git archive <tree>` extracted it, but the log walk returned two commits, neither with the pin. `git archive` accepts a tree-ish directly, so the walk is unnecessary. `git archive <commit> <path>` emits full repo-relative paths, so extraction yields `cache/<pin>/<handle>/<scope>/<skill>/`, not the `cache/<pin>/<skill>/` drawn in §4.2. Separately, a short tree hash can collide with a commit hash in a large repo, and the ref does not carry the scope segment, so a skill that moved scope since the pin was cut has no reachable path.
**Fix:** "`git cat-file -t <pin>` to confirm a tree, then `git archive <pin> | tar -x` into `cache/<team>/<pin>/<skill>/`"; `git fetch` before resolution; define the not-found path. Use `<pin>^{tree}` to disambiguate. Record the full repo path in `uses` alongside the pin.

### S9. Global installs shadow project skills

**Where:** §6 (`use`), §4.3.
**Spec says:** "global-scoped → Placer installs to `~/.claude/skills` (`-g`); … else explains and offers `--global`."
**Problem:** Claude Code resolves a personal skill over a project skill of the same name. A global install of a skill that a repo also ships under `.claude/skills` silently replaces the repo's reviewed copy in every session inside that repo, and nothing warns. §7's collision rule covers only two team skills colliding with each other.
**Fix:** Before a global placement, check the current repo's `.claude/skills` for the same name and refuse with an explanation (or place project-scoped instead). Show a shadows warning in `ls`.

---

## Minor

- **M1. Node floor.** §3 says "Node 20+"; the borrowed tool declares `>=22.20.0`. It did run under Node 20 in a live test (npm only warns), so this is a documentation mismatch, but §7's fallback trigger ("unavailable or offline") does not name an engine mismatch. Either raise the floor or add the case.
- **M2. Bare `<handle>` form dropped.** The ratified §3.4 verb set has `use <handle>`; the build spec's grammar and §2 scope omit it without listing it as out. Add it or record the deferral.
- **M3. Category: validate or warn.** §5.1 says an unknown category "warns-and-suggests"; §6 says `publish` "validates frontmatter (category known …)". Pick one.
- **M4. No `doctor` or `uninstall`.** State lives in `config.json`, the clone, the cache, the agent directories, and the borrowed tool's own store; nothing reconciles them or removes the tool.
- **M5. Borrowed CLI unpinned.** `npx skills` resolves whatever npm tags `latest`. Pin `skills@1.5.23` and bump deliberately.
- **M6. File mode 0600 is a no-op on Windows.** §5.4's token protection needs an ACL or the OS credential store there.

---

## Refuted, for the record

Both skeptics rejected these; they are listed so they are not re-raised.

- "Unpinned placements symlink into the clone" (§4.2) is inaccurate for the borrowed tool, but not load-bearing: §6's `sync` re-runs the Placer for tracked skills, which is the correct mechanism. Fix the wording only.
- §6 `team create` "installs the session-start hook" versus §7 "never installed without a y/N" is a summary versus its owning section, not a contradiction.
- `team join` "never authenticates" while accepting an invitation via `gh api` is loose wording; both branches are specified.
- GitHub-only verbs versus D4 is a parent-ledger issue already recorded there; `promote` has a no-`gh` path.
- "No error paths anywhere" is false; the spec defines several (layout drift, guard refusal, permission failure on clone, unknown category, promote confirmation).
- LICENSE in M4 is still inside phase 1, which is what walk Decision 6 asked for.
- The `git archive` end-of-line conversion under `core.autocrlf` is real but identical to what `git checkout` does; a committed `.gitattributes` with `* text=auto eol=lf` in the scaffold fixes both.

## What holds up

The build spec improves on the ledger in ways worth keeping: zod-validated schemas for every JSON file with unknown fields preserved on write; a stated remote-matching rule (incomplete, but testable); consent before installing the hook, applying D19's standard to the tool itself; `layout_version` with refuse-on-drift; README markers that preserve hand edits; one definition of the pin; defaults marked veto-cheap with a deadline; a network-free E2E fixture in CI.

## Suggested order

1. B1 and B2 before M1 starts; both change what M1's exit criterion means.
2. S1, S2, S4 before M2; they are the Placer and the hook.
3. B4 and S9 before any project-scoped placement is built; S5 before `sync`-in-project.
4. B3 before M4; it is M4's exit criterion.
5. S6, S7, S8, and the minors can land as text edits alongside their milestones.
