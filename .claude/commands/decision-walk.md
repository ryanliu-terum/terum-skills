Invoke the `decision-walk` skill to walk a batch of already-surfaced decisions to recorded
resolutions — one at a time, plain-English first, each pick checked against the batch's
overarching objective, resolved as LOCK / GATE / DEFER / DELEGATE, and written to a
committed decision ledger.

Pass through any arguments: $ARGUMENTS

`$ARGUMENTS` may be empty (walk the decisions surfaced in this session), a path to a
review/fork-list/spec that lists the decisions, an inline paste of the decisions, or a path
to an existing `.planning/decisions/*-decision-walk.md` ledger to resume.
