# skill-management-software

<!-- FILL: one paragraph — what this product is, who it is for, current stage. -->

## Response protocol

- **Intent-first** — live copy + dosage rules in `.claude/hooks/intent-check-reminder.js`. Before code, options, or any non-trivial change, lead with a short **Intent Check**: **Goal** (purpose hypothesis, who benefits) · **Strongest reason this is the wrong move** (a real, task-specific argument, not a hedge) · **Confidence** (can't state the Goal confidently → STOP and ask Ryan). Scale ceremony to stakes; skip on trivial turns.
- **Explain every bug and design decision in the `/single-fix` escalation-briefing style** (`.claude/skills/single-fix/SKILL.md` Phase 3B): What it is (plain English first) → Why (walk the real code path) → Options + trade-offs (Fit 0-4 against the governing spec + ratified North Star, and Depth 0-4, never summed; effort is a one-line footnote that never decides; each with a "Wins if" line) → Recommendation. Conceptual first, then technical.
- **Correctness is spec + North Star, not cheapness** (Ryan, 2026-09-06). A fix is right when it produces the behaviour the governing spec describes and the ratified North Star asks for. Implementation time and rework surface area are reported, never a reason to prefer a less correct fix.
- **No attacker model yet** (Ryan, 2026-09-06). The released tools are open source; a bad actor is an intra-company problem for later. Reviews and audits flag data loss, crashes, and spec non-conformance for a well-meaning user; hostile-caller findings (attacker, privilege escalation, cross-tenant, malicious input) are out of scope until a threat model is adopted. Ordinary input that breaks a step is still a bug, written up as such.
- **Close with a capture summary** — one plain-text paragraph (what you did, files changed, decisions) at the end of any response with real technical work. Read by Terum's session capture.

## Team knowledge (MCP)

Nothing is injected automatically; call the Terum tools at the right moment: `check_decision` before any architecture, library, schema, or destructive step; `search_team_knowledge` when the question is what was already decided or discussed (it lives only in the shared record, not this repo); `get_standing_decisions` to catch up before proposing something new. `record_decision` / `record_override` only on the human's explicit in-session confirmation.

## Claude Code harness (tracked in `.claude/`)

- `skills/` — eleven workflow tools; index and the planning conventions they assume: `.claude/skills/README.md`.
- `commands/` — `/single-fix`, `/ultrareview`, `/ultraspec`, `/codex-spec`, `/decision-walk`.
- `hooks/` — `intent-check-reminder.js` (UserPromptSubmit), `capture.js` (Terum capture shim, fail-open), `typecheck-on-edit.js` (no-ops unless `@typescript/native-preview` is installed), `handoff-resume-marker.js`, `no-verify-guard.js` (blocks `git push --no-verify`), `statusline.js`.
- `workflows/` — engines for ultrareview / ultraspec / codex-spec; standalone tests in `workflows/__tests__/`.
- `codex/` — the Codex invocation contract (`invoke.md`), rules, schemas, and `preamble.md` (a template — fill its `FILL` markers before the first `codex exec`).

## Cross-agent work (Codex)

Non-Claude agents do not run `.claude/hooks/*` or auto-load this file. Prefer a lint rule, git hook, or npm gate over a Claude hook for anything a second agent must obey. `codex-implement` hands a locked spec to Codex in an isolated worktree; **its self-reported gates are hypotheses — re-run lint/typecheck/test yourself.** Always `--sandbox workspace-write`; `--dangerously-bypass-approvals-and-sandbox` is banned (denied in `settings.json`).

## Before implementing

Grep for existing code that already does the same thing before writing a new function, component, or route. Extend or replace it in the same change — never leave two active paths doing the same thing.
