Follow-up round on the same worktree (your previous changes are in place, unstaged; do not revert anything). Read desktop/AGENTS.md before editing. Sandbox rules as before: no git, no network, no npm install, absolute paths, no `cd`.

One gate is red. The orchestrator ran `NODE_OPTIONS=--no-experimental-webstorage npm --prefix desktop test` outside the sandbox:

  FAIL src/screens/library/library-skill.test.tsx > keeps switch and favorite clicks on the library route
  AssertionError: expected 'SPAN' to be 'BUTTON'
    53|  expect(toggle.tagName).toBe('BUTTON');

The Base UI Switch (desktop/src/components/ui/Switch.tsx) renders `role="switch"` on a `span`, not a `button`. The spec never asked for a tag-name assertion; it asked that clicking the Switch and the favorite heart does not change `location.hash`. Fix: in that test, remove the `expect(toggle.tagName).toBe('BUTTON');` line (keep `expect(toggle.closest('a')).toBeNull();`, the click, the `aria-checked` flip, and the hash assertions). The favorite heart IS a `<button>` (SkillCard.tsx FavoriteHeart), so its `tagName` assertion may stay. Change nothing else in any file. Re-run `npm --prefix <repo>/desktop run typecheck` and `npm --prefix <repo>/desktop run lint`; attempt the focused vitest run and report honestly if the sandbox EPERM blocks it. Final message: the JSON report per the schema.
