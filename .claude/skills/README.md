# Skill library

Seeded 2026-09-01 from `conflict-detection/MVP/.claude` (canonical copy: `ryanliu-terum/Terum-MVP` → `.claude/`).
These eleven directories are the project-agnostic **workflow tools**, copied byte-identical. MVP's sixteen
`terum-*` knowledge skills were deliberately left behind — they encode Terum-MVP facts (auth guards, EVI scoring,
bug-log history, Supabase prod state) and would mislead an agent here.

**Harness assets are repo-level** — skills, commands, hooks, workflows, and the shareable half of `settings.json`
live in git so a teammate inherits them on clone. Only machine-specific paths, personal cost/UX preferences
(`model`, `effortLevel`, `theme`), and credentials stay in `~/.claude`.

## The eleven tools

| Skill | Invoke | What it does |
|---|---|---|
| single-fix | `/single-fix` | Triage one bug through the 4-question diagnosis; auto-fix trivial/safe/isolated, escalate the rest with a briefing. |
| parallel-fix | skill | Fix many bugs from existing bug logs in parallel worktrees after a review. |
| ultrareview | `/ultrareview` | In-session multi-agent code-diff reviewer, 4 dimensions, 3-vote adversarial verify. Engine: `workflows/ultrareview.js`. |
| hybrid-review | skill | Same review, but the verify panel runs on OpenAI Codex so verifiers don't share the finders' blind spots. |
| codex-implement | skill | Hand a locked spec to Codex CLI in an isolated worktree, then verify the diff here. |
| codex-spec | `/codex-spec` | Spec auditor with Codex finders and a Claude verify panel (mirror of hybrid-review). |
| decision-walk | `/decision-walk` | Walk surfaced decisions to LOCK / GATE / DEFER / DELEGATE, written to a committed ledger. |
| spec-readable | skill | Plain-English companion for a dense spec, written to `.planning/spec_readable/`. |
| handoff | skill | Snapshot working context into `.claude/handoff.md` before `/clear`; `hooks/handoff-resume-marker.js` stamps it on read. |
| state | skill | Present-tense session state report: what changed, where it lives, what's decided, next steps. |
| ui-ux-pro-max | skill | UI/UX design intelligence (styles, palettes, font pairings, stacks). Third-party content; no LICENSE file shipped with it. |

`/ultraspec` (command only) runs `workflows/ultraspec.js`, the Claude-only spec auditor.

## Conventions these tools assume (not yet created here)

The fix/review tools were written against MVP's planning layout. Create these as the project needs them:

- `.planning/debug/` — bug logs (`bug-NNN-slug.md`, `.resolved.md` / `.deferred.md` suffixes), with a
  `conventions.md` and `bug-groups.md`. MVP's versions are a reasonable starting point.
- `.planning/specs/` and `.planning/specs/reviews/` — specs and their review reports.
- `.planning/decisions/` — decision-walk ledgers.
- `npm run lint` / `typecheck` / `test` gates — the skills re-run these after Codex work.

Prose inside the skills still cites a few MVP-only paths (`terum-capture`, `terum-dashboard`, `extension/`,
`npm run check:bug-log-status`). They are examples, not requirements; trim them as the project's own
conventions firm up.
