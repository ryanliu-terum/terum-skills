# Library mirror + ID-based sync (proposal)

**Status: PARTIALLY RATIFIED BY OVERRIDE — rev 2.** Author: ajay, 2026-09-10, designed in-session with Claude.
Ajay explicitly overrode (2026-09-10, in-session confirmation: "Build as new default now" /
"Remove it now") the standing decisions this reverses: per-folder connect consent
(ryanliu, Terum 52d76c00) and global-as-placement-target (ryanliu, Terum 85c4ebd2).
The `record_override` MCP call errored repeatedly ("receipt is missing, not yours, or
expired"), so the override receipt lives in this session's capture and this file rather
than the decisions graph — **Ryan should review this section.** Scope ratified for
immediate build: the ID-check auto-share as default behavior + Library Connect button
removal. The rest of this document (two-page sidebar split, ownership-ledger Markdown
rendering) remains proposal.

## The model

Two sidebar pages replace today's connect-centric flow:

- **Library** — a one-to-one mirror of the skills on your machine. Your global skills
  (`~/.claude/skills`) auto-sync into your library, which auto-syncs to the team GitHub repo.
  Projects are added manually, whole-project at a time (**Add project**, no per-skill step);
  an added project's skills then sync the same way. Half-finished skills are welcome here:
  the library is your machine, not a quality claim.
- **Team** — where finished skills live: publish/endorse, evals, receipts. Publishing stays
  the manual, deliberate, PR-gated act. Quality gating happens HERE, not at share time.

The Connect button is removed; Add project covers projects in bulk and global is automatic.

## Core mechanism: the ID check

Every synced skill carries `metadata.id` (UUID — already the case today). When a skill
appears locally:

- **No ID, or ID unknown to the team repo** → upload it to the repo, minting a new ID.
- **ID already known** → the repo's skill content is untouched; only the ownership ledger
  updates (who has this skill installed).

Install/uninstall therefore changes only the ownership ledger, never skill content.
The ledger is per-person install lists in the repo (today's `people/<handle>.json
installed: [{id, scope, since}]` — already built; whether it stays JSON or becomes
Markdown is cosmetic).

The ID check is also the re-upload guard: a teammate's skill you installed carries a known
ID, so a library mirror can never re-share it under your name. This resolves the
global-is-a-placement-target concern (Terum 85c4ebd2) without a separate exclusion rule.

## Rules decided (ajay, 2026-09-10)

1. **Foreign skills upload as ours.** A skill copied from outside the team (vendored,
   another team, public repo) has no known ID → it gets an ID and uploads under our repo.
   Accepted risk, noted: this stamps our authorship/license onto third-party work
   (e.g. this repo vendors `ui-ux-pro-max`); the team is comfortable with that for a
   private team repo.
2. **Author-only content writes.** Only the skill's author can change its content in the
   repo. A non-author's local edits change nothing remotely. An author's local edits
   auto-commit to the shared repo (this is today's post-connect sync behavior, kept).
   *Standing carve-out preserved:* any member may `eval --commit` generated eval assets
   into a skill (Terum 6fafb8d3, 2026-09-07) — that exception is about eval assets, not
   skill content, and stands.

## Gates kept from today's model

- **Hygiene as an auto-sync filter:** a skill failing the credential/foreign-email scan
  (HYG3) does not auto-upload until clean — the scan already exists; it becomes a filter
  instead of advice.
- **Blanket consent at setup:** one y/N at `terum-skills setup` ("Mirror your global
  skills to the team repo?") replaces per-folder consent. This satisfies the terminal-less
  hook constraint (the reason for per-folder consent in 52d76c00) once, up front.
  License/metadata stamping is covered by the same setup agreement.
- **Privileged skills (hooks/plugins) stay excluded** from auto-sync, as they are from
  connect candidates today. Recommend keeping until a threat model exists.
- **allowed-tools install prompts unchanged** (Terum 994f89c3): placement on *other*
  machines still prompts.

## Open sub-questions (for the decision walk)

1. **Non-author divergence vs sync refresh.** A non-author edits a placed skill locally;
   remote is untouched (rule 2) — but today's sync *refreshes placed skills*, which would
   clobber their local edits on next pull. Recommended default: preserve local edits, show
   a drift badge in the Library, offer "fork as new skill" (which mints a new ID via the
   ID check). Needs a ruling.
2. **What happens to the `connect` verb.** RESOLVED in the first build (2026-09-10,
   feat/auto-share-id-check): the CLI verb REMAINS, unrenamed, as the manual path —
   project folders and paths outside the global root are connected with `connect <path>`
   or the bare picker exactly as before — and its per-folder machinery (`connectOne`) is
   what sync's auto-share pass reuses internally (blanket consent skips only the y/N and
   the "Will add" print; stamping, hygiene, name-invariant and safeWrite are the same
   code path). The verb's help text now says global skills auto-connect via sync's ID
   check unless `auto_share: false`. (The verb was already renamed share→connect on
   2026-09-07.)
3. **Fidelity boards.** Removing the Library Connect CTA and adding the Library/Team
   split moves locked boards — canvas change + re-lock required (same queue as the
   existing relabel item).
4. **Migration.** Existing shared skills already have IDs and people files — migration is
   mostly "start the mirror," but the first mirror run on a machine with many un-IDed
   global skills will mass-upload; needs a first-run review screen (list what's about to
   upload) even under blanket consent.

## Relation to the 2026-09-10 bug-fix PRs

The six PRs opened today (#105, #106, #108, #109, #110 + the stacked UI-cluster PR) fix
today's model and should merge regardless. If this proposal lands, the Connect workflow
surface (#109) and the install tri-state's "recorded" state become simpler or moot — they
are superseded, not wasted; the ID-join plumbing the tri-state added is exactly what the
ID check needs.
