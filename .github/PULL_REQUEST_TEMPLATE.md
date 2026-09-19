<!--
Title: a conventional commit with a scope, e.g. fix(cli,desktop): keep the adapter on registered verbs
Branch: feat/ fix/ docs/ ci/ refactor/ chore/ + a short slug
Merge: a merge commit, not a squash. See CONTRIBUTING.md.
-->

## What changed

In prose, before any list. What the reader would see differently after this.

## Why

The problem this solves, and the decision you made if there was a fork.

## Test plan

Real output and real counts, not a claim that they pass.

- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` N passed
- [ ] `node scripts/invocation-catalog.mjs --check` clean, or the regenerated catalogue is committed with the doc change
- [ ] CI green on this PR

<!-- Touching desktop/ as well? Add `npm run check` from desktop/ and its counts. -->
