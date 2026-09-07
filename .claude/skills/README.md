# Skill library

Seeded 2026-09-01 from `conflict-detection/MVP/.claude` (canonical copy: `ryanliu-terum/Terum-MVP` → `.claude/`).
Eleven of these directories are the project-agnostic **workflow tools**, copied byte-identical; `harden` was added here on 2026-09-04. MVP's sixteen
`terum-*` knowledge skills were deliberately left behind — they encode Terum-MVP facts (auth guards, EVI scoring,
bug-log history, Supabase prod state) and would mislead an agent here.

**Harness assets are repo-level** — skills, commands, hooks, workflows, and the shareable half of `settings.json`
live in git so a teammate inherits them on clone. Only machine-specific paths, personal cost/UX preferences
(`model`, `effortLevel`, `theme`), and credentials stay in `~/.claude`.

## The thirteen tools

| Skill | Invoke | What it does |
|---|---|---|
| single-fix | `/single-fix` | Triage one bug through the 4-question diagnosis; auto-fix trivial/safe/isolated, escalate the rest with a briefing. |
| parallel-fix | skill | Fix many bugs from existing bug logs in parallel worktrees after a review. |
| ultrareview | `/ultrareview` | In-session multi-agent code-diff reviewer, 4 dimensions, 3-vote adversarial verify, then a triage of every confirmed finding into mechanical / clear / fork / declined. Engine: `workflows/ultrareview.js`. |
| hybrid-review | skill | Same review + triage, but the verify panel runs on OpenAI Codex so verifiers don't share the finders' blind spots. |
| codex-implement | skill | Hand a locked spec to Codex CLI in an isolated worktree, then verify the diff here. |
| codex-spec | `/codex-spec` | Spec auditor with Codex finders and a Claude verify panel (mirror of hybrid-review), then the same mechanical / clear / fork / declined triage. |
| harden | `/harden` | Review → fix → confirm loop. Code: one full hybrid-review pass, then fix-scoped confirmation passes over the fix diff until no critical/high remain (cap 3). Spec: full codex-spec rounds until no BLOCKER/DRIFT remain (cap 3). Applies triage's mechanical + clear fixes with one commit per pass; returns a converged end state. Bookkeeping: `workflows/harden-state.mjs`. |
| decision-walk | `/decision-walk` | Walk surfaced decisions to LOCK / GATE / DEFER / DELEGATE, written to a committed ledger. |
| spec-readable | skill | Plain-English companion for a dense spec, written to `.planning/spec_readable/`. |
| handoff | skill | Snapshot working context into `.claude/handoff.md` before `/clear`; `hooks/handoff-resume-marker.js` stamps it on read. |
| state | skill | Present-tense session state report: what changed, where it lives, what's decided, next steps. |
| ui-ux-pro-max | skill | UI/UX design intelligence (styles, palettes, font pairings, stacks). Third-party content; no LICENSE file shipped with it. |
| terum-skills | `/terum-skills` | Run a terum-skills CLI verb in-session (`npx -y terum-skills@latest …`) or hand the question-asking verbs to a terminal; the Bash tool has no TTY. Design: `.planning/reviews/2026-09-07-cli-skill-wrappers-feasibility.md`. |

`/ultraspec` (command only) runs `workflows/ultraspec.js`, the Claude-only spec auditor.

## Scoring and review posture (Ryan, 2026-09-06)

Every fix-option list in these tools (single-fix, parallel-fix, the ultrareview / hybrid-review /
codex-spec triage stages, harden's apply wave) rates options on two numbers, never summed:

- **Fit (0-4)** — how exactly the fixed behaviour is the behaviour the governing spec describes and
  the ratified North Star asks for. Cited by section and sentence; a Fit without a citation reads
  as 1. The spec is the latest `.planning/specs/*.md` covering the area (its "North Star check"
  line counts); the North Star is the `north_star:` frontmatter of the newest
  `.planning/decisions/*-decision-walk.md` for that area.
- **Depth (0-4)** — how much of the cause the fix removes (unchanged from the 2026-07-30 trial).
- **Effort** — one line of fact per option (hours, files, migrations, revert path). Reported so the
  reader knows what they are buying. It never decides: highest Fit wins, then highest Depth, and
  only a tie on both lets effort break it, out loud. Until 2026-09-06 the second axis was Cost;
  it let the model prefer the cheaper fix over the one the spec describes.

Review posture: the released tools are open source and there is no external-attacker model yet.
Reviewers and spec auditors judge what a well-meaning user experiences — data loss, crashes,
behaviour that differs from the spec or North Star. Hostile-caller findings (attacker, privilege
escalation, cross-tenant, malicious input, unspecified authorization contracts) are out of scope
until a threat model is adopted; ordinary input that breaks a step is still a bug. The canonical
wording lives in root `CLAUDE.md`; the engines carry it as `POSTURE` in `ultrareview.js`, refute
rule 5 in `codex-verify-rules.md`, and the Posture paragraph in `codex-spec-find-rules.md`.

## Conventions these tools assume (not yet created here)

The fix/review tools were written against MVP's planning layout. Create these as the project needs them:

- `.planning/debug/` — bug logs (`bug-NNN-slug.md`, `.resolved.md` / `.deferred.md` suffixes), with a
  `conventions.md` and `bug-groups.md`. MVP's versions are a reasonable starting point.
- `.planning/specs/` and `.planning/specs/reviews/` — specs and their review reports.
- `.planning/decisions/` — decision-walk ledgers.
- `.planning/harden/` — harden run state + end-state reports; `.planning/debug/harden/<slug>.deferred.md` — the deferrals ledger the review engines read.
- `npm run lint` / `typecheck` / `test` gates — the skills re-run these after Codex work.

Prose inside the skills still cites a few MVP-only paths (`terum-capture`, `terum-dashboard`, `extension/`,
`npm run check:bug-log-status`). They are examples, not requirements; trim them as the project's own
conventions firm up.
