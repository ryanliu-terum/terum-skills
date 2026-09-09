# Round 4 (rebase conflicts only): resolve five conflicted files, keep BOTH sides, then run the gates

This working tree is a git rebase in progress: the installed-state batch (commit "feat(cli,desktop): installed =
present-or-placed by id; scan-based counts; People install fix", implemented by you in rounds 1–3 — read
`.planning/codex-runs/installed-state/PROMPT.md`, `PROMPT-round2.md`, `PROMPT-round3.md` for what it is) is being
replayed on top of branch `fix/first-run-in-app` ("first run in the app — creator onboarding, launch re-read,
honest zero-team board"), which adds: a `no-team` mock scenario and a "No team on this machine" Library board
(`query.data.reason==='no-team'`), `Backend.launchContext()` / `refreshLaunch()` / `onLaunchRequest()` on the seam
and the fake bridge, and tests for those.

**You must NOT run any git command** (not `git status`, not `git add`, not `git rebase --continue`) — the
orchestrator does that after you finish. Your job: edit exactly the five files below so that every
`<<<<<<< HEAD` / `=======` / `>>>>>>> 0594bda …` conflict region is replaced by a merge that keeps BOTH sides'
behaviour, then run the gates and report. In every conflict, the `HEAD` side is `fix/first-run-in-app` (the
no-team work) and the other side is this batch. Nothing from either side is dropped.

1. `desktop/src/backend/mock/scenario.ts` — `MockScenario` is the union of both lists (`… | 'not-installed' |
   'no-team' | 'on-disk-only'`) and `readScenario` accepts both `'no-team'` and `'on-disk-only'`.
2. `desktop/src/backend/tauri/__tests__/run.test.ts` — keep the HEAD side's three tests (`refreshes A to B …`,
   `re-reads after a request arrives …`, `delivers reopen events …`) verbatim; the batch side of that region is
   empty (it had deleted a §5 test that lived there), so the resolution is simply the HEAD text without markers.
3. `desktop/src/screens/library/LibraryScreen.tsx` — one `return` that has the batch's
   `{data&&!error?<ScanCoverage scanned={data.scanned} skills={data.skills}/>:null}` right after `</ViewHeader>`,
   then HEAD's `query.data?.ok===false&&query.data.reason==='no-team'?<CenteredState … "No team on this machine" …>`
   branch FIRST, then the batch's `error?<CenteredState alert … "Couldn't read your library" …>` branch, then the
   shared tail (overview / search row / grid) exactly as in the batch side. Read both sides in full before
   writing; keep every prop of both `CenteredState`s. Everything else in the file (the scope resolver without
   fixture names, imports incl. `ScanCoverage`) is the batch side's.
4. `desktop/src/backend/mock/index.ts` — `library:` keeps HEAD's leading
   `if(scenario==='no-team')return {ok:false,error:'No team is configured on this machine.',reason:'no-team'};`
   and then the batch side's body (`scanned:null`, the `projects` derived from `design.PROJECTS` /
   `sidebarProjects()`, the `on-disk-only` card override, the same `title`). `skill:` is the batch side (the HEAD
   side of `skill:` is identical to the pre-batch text).
5. `desktop/src/backend/tauri/__tests__/index.test.ts` — keep HEAD's tests (`classifies successful zero-team
   inventory without spawning ls`, `uses GitHub login for the footer …`, `invalidates every affected read model
   when %s fails` — keep the whole `it.each` including whatever follows the conflict region) AND the batch's
   tests (`derives installed identity from the %s replay` … through `abbreviates catalog card display paths`),
   with the `import { installedReplay } from './installed-fixture';` line moved up to the file's import block
   (imports must not sit mid-file under `verbatimModuleSyntax`/eslint import rules — check how the other imports are
   written and match). Order: HEAD's block first, then the batch's block.

After the five files carry no conflict markers (`grep -rn '^<<<<<<<\|^=======$\|^>>>>>>>' desktop src` must be
empty), do a semantic pass on the two files git auto-merged, `desktop/src/backend/tauri/index.ts` and
`desktop/src/backend/types.ts`: the HEAD branch added `launchContext`/`refreshLaunch`/`onLaunchRequest` and a
`reason` on the failing `Result` for `library`; the batch added `onDisk`/`inventoryCard(features)`/
`statusModel(features)`/`pathLabel`/`scanned`. Make sure both compile together (e.g. the batch's `library()` must
keep HEAD's zero-team early return that avoids spawning `ls`, and HEAD's tests `classifies successful zero-team
inventory without spawning ls` and `expect(f.spawns.map(spawn=>spawn.args)).toEqual([['status']])` must still
hold).

Then run and report REAL counts: `npm run lint && npm run typecheck && npm run build` at the root and
`npm --prefix desktop run typecheck && npm --prefix desktop run lint && NODE_OPTIONS=--no-experimental-webstorage npm --prefix desktop test`
(use `--configLoader runner` if the sandbox EPERMs on `.vite-temp`, and say so). Do not weaken or delete any test
from either side. Final answer: the JSON report matching the output schema; list every file you touched in
`filesChanged` and put "rebase conflict resolution, both sides kept" in `why`.
