# The join fork: should "Join an existing team" discover the team? — for Ryan

Raised 2026-09-14 out of a setup failure Ajay hit on his own machine. The two defects behind that
failure are fixed on `fix/setup-edithook-and-membership` and need no decision. This file is the one
question the fix deliberately did **not** answer, because answering it reverses a ruling already in
the code.

## What happened

Ajay ran setup from the app, chose "Join an existing team", and was told **"Ask your team owner to
invite you"** — by a tool that could have known he was already a member of `ryanliu-terum/shared-skills`.
He had accepted the invitation days earlier. An accepted invitation is no longer pending, and every
question the code asked was about pending invitations.

## What the fix already does (no decision needed)

1. `acceptOrDirect` (`src/commands/team.ts`) now probes `repos/<owner>/<repo>` before it says anything.
   A member with nothing pending is told "your account already has access; there is no pending
   invitation to accept", instead of being sent back to the person who already invited them. Someone
   with neither invitation nor access still gets the pre-clone warning D6 put there on 2026-09-08.
2. The app's hand-off screen no longer asserts the person was never invited. It is headed "Join an
   existing team" and asks for the one thing setup still needs — the repository — then re-enters the
   wizard with it as the target.

Both are the CLI answering honestly and the app asking for what it needs. Neither changes the shape
of the wizard.

## The fork

Today, choosing "Join" with no target is **a success exit that writes nothing**
(`src/commands/setup.ts`, the comment above the role select). That was chosen deliberately: a
mis-picked "create" costs you a private GitHub repository, a mis-picked "join" costs you a re-run, so
the asymmetry is priced into the fork having no default and join doing nothing.

The question is whether join should stop being a dead end and start **discovering** the team.

`src/lib/successor.ts` (`findSuccessors`) already asks GitHub both halves of the question — pending
invitations **and** repositories the account can already reach that carry a `team.json` at the root —
and labels each `source: 'invitation' | 'member'`. It is wired only to the "the team's repository was
deleted" path. Pointed at a cold join it would turn "Ask your team owner to invite you" into "These
teams are available to your GitHub account: …".

**Option 1 — leave it.** Join stays a hand-off; the new field covers the person who knows their
repository name, which is most joiners (it is in the invitation email). Fit 3 against "a wrong join is
a re-run": preserved exactly. Depth 1. Wins if the wizard's job is to be predictable rather than clever.

**Option 2 — discover and offer.** Join lists what the account can reach and lets them pick. Fit 4
against the North Star reading that the tool should not ask a person for something it can look up.
Depth 4. Costs: two GitHub calls plus up to eight `team.json` probes on a path that currently makes
none, a new failure mode when gh is logged out (the list is empty and the copy must not read as "you
have no team"), and join stops being a no-write exit — picking from the list *is* a join.

**Option 3 — discover, but only to inform.** Show what was found, still require the person to confirm
the repository. Fit 4, Depth 2. Keeps the no-write property; the list is copy, not a control.

## Recommendation for the walk

Option 3 if the no-write property is load-bearing, Option 2 if it is not. The fix as shipped is
compatible with all three.
