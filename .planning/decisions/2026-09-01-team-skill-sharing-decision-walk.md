---
title: team skill sharing decision walk
date: 2026-09-01
north_star: A teammate can install your skill in one command, trust it because the receipt is in the repo, and nobody has to run a server.
status: complete
deferred:
  - item: "Phase 2 — local web UI (Decision 2)"
    trigger: "a teammate asks to browse skills without the terminal, or a third team joins"
  - item: "Phase 3 — eval and share (Decision 2)"
    trigger: "the eval-integration spec exists and phase 3 is a week from being built"
  - item: "Agent-selection flag for the native Placer (Decision 3, reopened 2026-09-03)"
    trigger: "a team needs Codex, Cursor, or another agent the vendored path table already covers"
  - item: "GitHub device-flow login (Decision 4)"
    trigger: "an admin turns up with neither gh nor patience for a token, or two support requests about token scopes"
  - item: "Eval-integration spec (Decision 5, delegated)"
    trigger: "phase 3 is a week from being built"
  - item: "npm org / package owner assignment (Decision 6)"
    trigger: "before the first npm publish"
---

# Team skill sharing — Decision Walk

**North Star:** A teammate can install your skill in one command, trust it because the receipt is in the repo, and nobody has to run a server.

**Source batch:** the six open calls identified against `.planning/specs/2026-09-01-team-skill-sharing.md` on 2026-09-01: names; what v1 is; Codex in v1; GitHub auth for create and invite; evaluation method; OSS repo location and license.

**Continuation note:** Decisions 1–3 were resolved 2026-09-01 on Ryan's machine. Decisions 4–6 were resolved 2026-09-02 in a continuation session after a handoff (working clone on Ajay's machine); the spec and this ledger were transferred by file copy.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Names | LOCK | `terum-skills`, following the Aug 30 family scheme; bare `skills` is taken by Vercel | — |
| 2 | What v1 is | GATE | Phase 1 is the CLI plus generated README; UI and eval+share wait behind named tripwires | UI when a teammate asks to browse without the terminal or a third team joins; eval+share when the eval-method spec exists |
| 3 | Build or borrow the install layer | LOCK | Borrow Vercel's `skills` CLI for placement into agents; terum-skills owns team, pinning, receipt, share. Codex comes free | native fallback beyond Claude Code only if the shell-out breaks twice on a contract change |
| 4 | GitHub auth for create and invite | LOCK | `gh` when present, fine-grained token fallback; nothing for Terum to own or run | device flow gated: an admin with neither `gh` nor a token, or two token-scope support requests |
| 5 | Evaluation method | LOCK + DELEGATE | NVIDIA SkillEvaluator is the engine, grounded in the 14-skill framework comparison and its test–retest rerun; integration details delegated to their own spec | eval-integration spec when phase 3 is a week from being built |
| 6 | OSS repo location and license | LOCK | Apache-2.0; new repo `ryanliu-terum/terum-skills`, origin repointed before any push | npm owner assigned before first publish |

---

## Decision 1 — Names

**Verdict: LOCK**

### Plain English
- **What's at stake:** the word a teammate types in the install line, the folder the tool keeps its state in, and whether the tool reads as part of Terum or as its own thing.
- **Why it's a fork:** the obvious generic name is taken by a bigger player; what remains is family branding versus a standalone identity, which is a product call.
- **Options:**
  - **A — `terum-skills`.** Binary and npm package `terum-skills`, state under the same home folder terum-memory uses. *(decides: follows the Aug 30 naming scheme for the Terum CLI family, free on npm today, renameable at 1.0)*
  - **B — Standalone name.** Un-branded. *(decides: needs a naming exercise now and a second identity forever)*
  - **C — Bare `skills`.** Not available. Taken by Vercel's "open agent skills ecosystem", an overlapping tool.
- **Recommendation:** A, because the family scheme is already decided and the name is free.
- **Zoom-out:** the install line becomes `npx terum-skills use acme/ryan/single-fix@hash`; slightly longer than the bare name, still one command. Serves the North Star.
- **The call:** A. `terum-skills`.

### Technical
- **Names fixed by this call:** npm package and binary `terum-skills`; state directory `~/.terum/skills/`; default team repo name `team-skills`; collision prefix `<handle>-<skill>`.
- **Grounding findings:** `npm view skills` returns Vercel's package at 1.5.x ("The open agent skills ecosystem", `npx skills add <owner/repo>` installs skills from a GitHub repo into several agents' skill folders). `terum-skills`, `@terum/skills`, and `terum-memory` all return 404 on npm as of 2026-09-01.
- **Effort / risk / blast radius:** none today; no code exists.

---

## Decision 2 — What v1 is

**Verdict: GATE** (LOCK phase 1; phases 2 and 3 gated)

### Plain English
- **What's at stake:** what the first build spec covers, and therefore what Teddy and Ajay can touch first.
- **Why it's a fork:** the UI and the share card make this feel like a product, but they depend on a data model the CLI has not settled, and the eval method is blank.
- **Options:**
  - **A — Phase 1 is the CLI plus the generated README.** *(decides: smallest surface that fully delivers the North Star, and keeps the first spec inside the Jul 22 rule about specs that age)*
  - **B — CLI plus the local web UI.** *(decides: frontend built against a data interface that will churn while the CLI settles)*
  - **C — Everything, including eval and share.** *(decides: the eval method is blank, so this cannot be specced yet)*
- **Recommendation:** A, as a gate with named tripwires.
- **Zoom-out:** phase 1 delivers "one command" and "no server" fully; the receipt in the repo is partial until evals exist. Honest state.
- **The call:** A.

### Technical
- **Phase 1 scope:** spec sections 3.1 through 3.5 plus the README generator (D22).
- **Tripwire, phase 2 (local web UI):** first time a teammate asks how to browse skills without the terminal, or a third team joins.
- **Tripwire, phase 3 (eval and share):** the eval-method spec exists and is a week from being built.
- **Grounding findings:** none; conceptual.

---

## Decision 3 — Build or borrow the install layer (reframed from "Codex in v1")

**Verdict: LOCK — reopened 2026-09-03 and re-locked on "borrow code, not a tool."** The original walk compared building from scratch with borrowing Vercel's CLI. A third option surfaced in the iflytek/skillhub comparison: vendor that project's Apache-licensed, registry-independent agent path table, per-file fingerprint, and target lock (about 150 lines) and own placement outright. Ryan overrode Ajay's same-day ruling for the Vercel shell-out — his words: "override ajay's decision, make the changes to the spec from skillhub" — and the override is recorded in Terum. **New call: native Placer, Vercel removed.** Sub-fork deferred: the agent-selection flag. Build spec §7 (rev 6) is authoritative; the walk text below is the original reasoning, kept for the record.

### Plain English
- **What's at stake:** whether terum-skills spends its effort on the part that already exists, putting files where each agent reads them, or on the part nobody has: the team model, the receipt, the share card.
- **Why it's a fork:** borrowing puts a third-party tool on the hot path of every install; building keeps control but re-implements a moving target and leaves Codex for later.
- **Reframe:** the original question was "Codex in v1?". Grounding showed Vercel's `skills` CLI already installs a skill from a subfolder of a private repo into Claude Code, Codex, Cursor and ~75 other agents by symlink. Borrowing makes the Codex question dissolve.
- **Options:**
  - **A — Borrow.** terum-skills owns create, invite, join, publish, sync, README, evals, share. For placement it checks out the pinned version locally and hands that folder to Vercel's tool. Small built-in fallback for Claude Code alone. *(decides: multi-agent and Windows symlink/copy handling for free)*
  - **B — Build, Claude Code only in v1.** *(decides: no dependency, but Codex waits and we rebuild what exists)*
  - **C — Build, Claude Code and Codex in v1.** *(decides: most work, still fewer agents than A)*
- **Recommendation:** A. The unique half of the product is trust and team, not file placement.
- **Zoom-out:** "one command to install from a private repo" is already solved by Vercel's tool. terum-skills earns its install by the second clause of the North Star: the receipt in the repo, plus invites, profiles, and the pinned share line. Vercel's tool has no pinning, no team, no usage record, no evals.
- **The call:** A. Borrow.

### Technical
- **Install call:** `npx skills add <local-pinned-path> --skill <name> -a <agents...> -g -y`, with `DISABLE_TELEMETRY=1` set in the child environment.
- **Pinning stays ours:** check out the skill's git tree hash into `~/.terum/skills/cache/`, then install from that local path (their tool accepts local folders).
- **Adapter interface:** `Placer { place(localPath, skillName, agents, scope) ; remove(...) ; list(...) }` with two implementations: `vercel-skills` (shell-out) and `native-claude-code` (symlink/copy into `~/.claude/skills/`). Default `vercel-skills`; fall back to native when `npx skills` is unavailable or offline.
- **Grounding findings (README at vercel-labs/skills, 2026-09-01):** supports GitHub shorthand, GitLab, SSH, subfolder URLs, local paths; private repos via git credentials then gh then SSH; symlink to canonical copy by default, `--copy` otherwise; `list`, `update` (latest only, no pin), `remove`, `find` (skills.sh directory), `init`, `use`; reads `.claude-plugin/marketplace.json`; recursive fallback discovery when no standard container matches; telemetry sends identifiers only for confirmed-public GitHub repos, off via `DISABLE_TELEMETRY=1`.
- **Spec impact:** D13–D16 and D18 in the spec are now satisfied by the borrowed tool; D15's Windows copy path is theirs. D17 (global-only scope) still ours to enforce via `-g`.
- **Sub-fork deferred:** expanding the native fallback beyond Claude Code. Trigger: the shell-out breaks twice on a contract change, or a team needs an agent their tool drops.

---

## Decision 4 — GitHub auth for create and invite

**Verdict: LOCK** (device flow gated)

### Plain English
- **What's at stake:** how the one admin proves to GitHub that the tool may do its only two privileged actions — create the private team repo, and add collaborators. Joiners never touch this; they clone with the git access they already have.
- **Why it's a fork:** the smoothest login (device flow) requires Terum to register and own a GitHub OAuth app forever; the cheapest (token only) makes every admin hand-build a token in GitHub's settings.
- **Options:**
  - **A — `gh` first, token fallback.** If the GitHub CLI is logged in, borrow its auth; otherwise prompt for a fine-grained personal access token scoped to the two actions. Device flow gated for later. *(decides: nothing for Terum to own or maintain; the admin creating a team is the person most likely to already have `gh`)*
  - **B — Own OAuth app with device flow.** *(decides: smoothest first run, but permanent app ownership, broader-than-needed token scopes, and org third-party-app restrictions can block it)*
  - **C — Token only.** *(decides: least code, worst first-run experience)*
- **Recommendation:** A, as a gate.
- **Zoom-out:** all three are server-free, so the North Star is safe under any of them; this call is purely about admin friction versus what Terum has to own.
- **The call:** A. `gh` first, fine-grained token fallback; device flow gated.

### Technical
- **Implementation:** detect `gh auth status`; when present use `gh repo create <org>/team-skills --private` and `gh api` for collaborator invites. Otherwise prompt for a fine-grained PAT with repository Administration (create, collaborators) permission, verify its scopes with a test call on first use, and store it in `~/.terum/skills/config.json`.
- **D8/D10 contradiction resolved by this call:** `join` never logs in. With `gh` present, `team join` auto-accepts the pending invite via `gh api /user/repository_invitations`. Without `gh`, it attempts the clone; on permission failure it prints the invite URL and says to rerun after accepting in the browser.
- **Spec impact:** D7 (device-flow-first) is superseded — device flow moves from the default to a gated later addition; D8 and D10 amended per the fix above. Non-GitHub hosts unchanged: admin creates the repo and adds members in the host's UI, `team create --remote <url>`.
- **Gate:** device flow. Trigger: an admin turns up with neither `gh` nor patience for a token, or two support requests about token scopes.

---

## Decision 5 — Evaluation method

**Verdict: LOCK + DELEGATE** (engine locked: NVIDIA SkillEvaluator; integration spec delegated)

### Plain English
- **What's at stake:** what proves a skill works before it is promoted or put on a share card — the "trust it because the receipt is in the repo" clause of the North Star.
- **Why it's a fork:** deciding the method inside this walk risked designing an eval rig without the focus it deserves; the original recommendation was to delegate the whole method to its own spec session.
- **What changed:** evidence already exists. A three-framework comparison (huggingface/upskill, agent-skills-eval, NVIDIA SkillEvaluator) over 14 SkillsBench-curated skills, plus a same-day test–retest rerun of SkillEvaluator, was completed 2026-09-01/02 (`~/skill-eval-comparison` on Ajay's machine; consistency rerun recorded in Terum). The engine question is answered; only integration remains.
- **Options:**
  - **A — DELEGATE everything to an eval spec session.** *(decides: nothing today; phase 3 stays blocked on a future session)*
  - **B — LOCK NVIDIA SkillEvaluator as the engine now, DELEGATE integration.** *(decides: the engine, with run-condition guardrails from the comparison; the spec session shrinks to integration questions)*
  - **C — Sketch the home-built Jul 5 rig into the spec.** *(decides: builds what a maintained OSS framework already provides)*
- **The call:** B. NVIDIA SkillEvaluator is the engine.
- **Zoom-out:** the receipt becomes "SkillEvaluator result JSON committed at the skill's content hash." The engine is third-party OSS run on the member's own machine and API budget (spec D26 intact); nobody runs a server.

### Technical
- **Why this engine (comparison findings):** of the three third-party frameworks it is architecturally closest to SkillsBench's deterministic-verifier gold standard (real agent trajectories, multi-dimension rubric), and even when degraded by the local shim its Effectiveness column was the best rank-correlate with SkillsBench's published results (Spearman ρ +0.38). upskill's substring grading inverted signs; agent-skills-eval measures recall of the skill's own content.
- **Reliability (test–retest, two identical runs, `n_attempts=1`):** PASS-verdict agreement 13/14 skills; mean lift nearly unchanged between runs; but per-skill lift moves within a ±0.1 noise band (mean |Δ| 0.083, max 0.222) — a single-run lift must not rank skills or headline a share card.
- **Conditions bound into the LOCK:**
  1. Run in the framework's default condition — Docker env-mode with a raw API key — not the local shim/`--env-mode local` path, which zeroed the Discoverability and Efficiency dimensions in every arm.
  2. Any number that reaches a share card uses `n_attempts > 1`.
  3. `terum-skills publish` emits `metadata.author` and a license in skill packaging: all 14 SkillsBench skills fail SkillEvaluator's Tier-1 schema gate for missing author, 3 for license. Our packaging passes the gate by construction.
- **Docker note:** this is the evaluator's sandbox on the member's machine, consistent with spec D3 (Docker never for an environment the user codes inside).
- **Delegated to the eval-integration spec** (trigger: phase 3 a week from being built): cost per run and a cheap tier; judge model choice; whether CI runs evals on promotion PRs; mapping SkillEvaluator's result JSON into `evals/<handle>/<skill>/<content-hash>.json`; the share-card score summary (spec D29); whether the Jul 5 rig's routing probes supplement trigger-accuracy measurement, since SkillEvaluator's discoverability dimension was untestable in local mode.
- **Terum records:** Ajay's 2026-09-02 consistency-rerun decision (https://app.terum.ai/#/decisions/ccedbd52-9a3f-4cd6-b235-15d7753c0203) closed the framework's remaining research question; "terum-* skill efficacy validation" (2026-07-05) remains a reference for probe design, no longer the candidate method.

---

## Decision 6 — OSS repo location and license

**Verdict: LOCK**

### Plain English
- **What's at stake:** where the open-source code lives, under what name, and under what license — the identity a company sees before adopting the tool.
- **Why it's a fork:** the working remote is a placeholder (`oss-skills`) that no longer matches the locked product name; and MIT versus Apache-2.0 is a one-way door once external contributions arrive.
- **Options:**
  - **A — Apache-2.0, new repo `ryanliu-terum/terum-skills`.** *(decides: explicit patent grant, the safer default for a tool companies run internally; repo named for the product; placeholder untouched)*
  - **B — MIT, rename `oss-skills` in place.** *(decides: shorter license, no patent grant; rename keeps the README-only history and the old URL redirects)*
  - **C — New dedicated GitHub org.** *(decides: cleanest family branding, one more thing to administer)*
- **Recommendation:** A.
- **Zoom-out:** no effect on the North Star's mechanics; the license is part of the trust story for orgs adopting an OSS tool.
- **The call:** A. Apache-2.0; new repo `ryanliu-terum/terum-skills`; repoint `origin` before any push.

### Technical
- **State at decision time:** remote `https://github.com/ryanliu-terum/oss-skills.git` @ `f0d4762` (two commits, README only). npm `terum-skills` free as of 2026-09-01; no npm owner assigned.
- **Actions:** create `ryanliu-terum/terum-skills`, repoint `origin`, add `LICENSE` (Apache-2.0) in the phase-1 scaffold; archive or delete `oss-skills` at Ryan's leisure.
- **Open sliver:** npm owner/org assignment — needed before the first `npm publish`, listed in `deferred:`.
