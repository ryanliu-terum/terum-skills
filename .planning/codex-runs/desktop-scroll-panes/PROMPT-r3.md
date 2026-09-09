Third pass on `.planning/specs/desktop-scroll-panes.md` in this worktree (read `desktop/AGENTS.md` first; work only inside `desktop/`).

The orchestrator ran the 88-board fidelity gate on your last change. Three boards moved by exactly 1 px vertically (SkillDetailNotInstalled, SkillDetailInstall, SkillDetailInstallLight: the SKILL.md block below the tabs sits one pixel lower when the "Open in editor" button is absent). The cause is `min-height:auto` on the tab panes: it changes the flex item's size in the not-installed variant. The clip release alone is enough, because overflow that is `visible` still contributes to `.detail-main`'s scrollable area, so scrolling reaches the last block without changing any pane's size. The orchestrator verified this experimentally: with `min-height:auto` removed, those boards pass at 0 px and all 7 cases in `e2e/routes/scroll.spec.ts` pass.

Change exactly one thing in `desktop/src/screens/skill/skill.css`: in the rule

```
.detail-body:not(.full) .skill-md-tab,.detail-body:not(.full) .skill-md-blocks,.detail-body:not(.full) .evals-tab,.detail-body:not(.full) .evals-body,.detail-body:not(.full) .quality-tab,.detail-body:not(.full) .activity-tab{overflow:visible;min-height:auto}
```

drop `;min-height:auto` so the declaration block is `{overflow:visible}`. Touch nothing else. Read the file back to verify. Run from `desktop/`: `npm run typecheck && npm run lint && npm test` and report real counts. No git, no maintainer files, no changes to `scroll.spec.ts`.
