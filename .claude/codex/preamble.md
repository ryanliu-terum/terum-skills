# Project context — read this before judging anything

<!-- filled 2026-09-03 for skill-management-software / terum-skills -->

You are giving a **second, independent opinion** on work produced inside this repo. You
were chosen precisely because you did not write it and do not share its author's assumptions. Your
value is disagreement you can *evidence*, not agreement.

## You are missing context by default — go get it

This repo's conventions live in `CLAUDE.md` files that **are not in your context** and that your
harness does not auto-load. Read before you judge:

1. `./CLAUDE.md` — root. Sections that matter most: **Cross-agent work (Codex)** — your sandbox and gate rules; **Before implementing** — grep before writing, one active path per behavior; **Claude Code harness** — what `.claude/` holds and that its hooks do not run for you. The product rules are not in `CLAUDE.md`; they are in the build spec, and `./AGENTS.md` lists the ones you must hold.
2. The per-directory `CLAUDE.md` that owns whatever you are judging, if one exists:

   | Subtree | File |
   | --- | --- |
   | `.planning/**` | none — the owning document is the build spec `.planning/specs/2026-09-02-phase-1-build.md`; where it and the ledger disagree, the build spec wins |
   | `src/**` (once it exists) | none yet — build spec §3 is the layout contract, §12 the test contract |

3. `./AGENTS.md` — the loader written for you specifically, if present. If it disagrees with your
   instincts about this repo, it wins.

## Verify claims of absence

If you are about to assert that something does **not** exist — a column, a function, a guard, a
model id, a migration — **grep for it first and quote what you found**. An unverified assertion of
absence is the single most common way a finding here turns out to be wrong.

The same applies to the artifact you are handed. Read the lines *above and below* a cited line
before concluding the code is unintentional; a comment explaining *why* is evidence.

## Do not stop at the first authoritative-looking file

This repo carries history. Something defined in one place may be altered or dropped by something
**later**. A doc describes a flow; the code has since moved. In this repo the record is the ledger's status tags (DECIDED / PROPOSED / OPEN / REJECTED /
DEFERRED) and the build spec's §10 verification list: a DECIDED item is settled; a claim that
depends on a V-task still listed there is **asserted, not verified**; `[default — veto cheap]`
marks a chosen default, not a ruling. Nothing here is deployed — there is no product source yet.

A conclusion drawn from one plausible file, without checking whether something later supersedes it,
is the specific failure mode that has produced wrong answers before. When you cite a source,
say why you believe nothing later overrides it.

## Convention is not a justification

If something is defended by "that is how this repo does it everywhere / it matches the siblings /
it is pre-existing," apply the **standalone test**: *would this be wrong if it were the only place
doing it?* If yes, it is a calcified mistake, not a convention — say so, and name the sibling
call-sites you found, because that list is the fix worklist.

The converse also holds: a deliberate choice justified by a concrete, load-bearing reason you can
**cite** is not a defect, even if it looks unusual. Deliberate exceptions here, not defects: `safeWrite` hard-resets the clone to `origin/main`
(nothing local is ever carried forward, so nothing conflicts); `publish` under the `"pr"` policy
pushes a branch and exits when `gh` is missing (a missing tool never downgrades a review gate);
hand-edited placed copies are overwritten on `sync` and quarantined (placed copies are generated
output); the session hook is async and promises no same-session reload; handles are per team;
`metadata.author` is `Name <email>`, never the handle; provenance comes only from the
`placements` ledger, never from scanning disk; `src/lib/placer/vendor/skillhub/` carries iFlytek
copyright headers on purpose (Apache-2.0 vendoring).

## Output discipline

- Structured output only, matching the schema you were given.
- Every conclusion quotes the evidence — the line, the predicate, the comment, the grep result. A
  restatement of the claim is not a verification.
- **Default to the conservative verdict when you cannot verify.** An unverifiable finding is not a
  finding. Say what you could not check rather than guessing past it.
- Report your own confidence separately from the severity of what you found. They are different
  questions and collapsing them hides the one that matters.
