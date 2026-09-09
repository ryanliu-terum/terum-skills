Follow-up on the spec you already implemented in this worktree (`.planning/specs/desktop-scroll-panes.md`; your CSS changes and `desktop/e2e/routes/scroll.spec.ts` are present in the working tree). Read `desktop/AGENTS.md` first. Work only inside `desktop/`.

The orchestrator ran your `e2e/routes/scroll.spec.ts` outside the sandbox. 5 of 7 cases pass. Two fail, exactly as your `leastConfidentClaim` predicted:

```
scroll.spec.ts:64 › SKILL.md scrolls to its last block while the details rail stays pinned
scroll.spec.ts:80 › Evals scrolls through provenance with its receipt head and History
  Error: expect(received).toBeGreaterThan(expected)   Expected: > 0   Received: 0
  at wheelPane (scroll.spec.ts:28)   — `.detail-main` scrollTop stays 0 after the wheel
```

Cause: the tab panes nested inside `.detail-main` still cap their own height and clip, so `.detail-main` never overflows:

```
.skill-md-tab{...;flex-grow:1;min-height:0;...;overflow:hidden}
.skill-md-blocks{...;flex-grow:1;min-height:0;overflow:hidden}
.evals-tab{...;flex-grow:1;min-height:0;...;overflow:hidden}
.quality-tab,.activity-tab{...;flex-grow:1;min-height:0;...;overflow:hidden}
.detail-body.full .evals-tab,.detail-body.full .evals-body{overflow:visible}
```

Fix, in `desktop/src/screens/skill/skill.css`, in the same shape you already used for `.evals-body`: when `.detail-body` is not `.full`, those panes (`.skill-md-tab`, `.skill-md-blocks`, `.evals-tab`, `.quality-tab`, `.activity-tab`) must be `overflow:visible;min-height:auto` so their full height flows into the `.detail-main` scroller. Keep every other declaration (gap, max-width, padding-top, flex-grow) and the `.full` rules untouched. Nothing above the fold may move: at scrollTop 0 the layout must be pixel-identical (the orchestrator re-runs the 88-board fidelity gate).

Then run, from `desktop/`: `npm run typecheck && npm run lint && npm test` and report real counts. Playwright cannot launch in the sandbox; do not fake its result. Do not weaken any assertion in `scroll.spec.ts`; if you believe an assertion is wrong, say so in `openQuestions` and leave it. No git commands, no edits to maintainer files (`GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md`, `package.json`, generated files). Verify each write by reading the file back.
