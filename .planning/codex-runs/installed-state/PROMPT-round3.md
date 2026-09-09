# Follow-up round 3 (last): §9.1 in its GENERALISED form — sidebar counts from the scan; gate fixes

You already implemented §1–§4, §6, §7 and §9.2 of the installed-state spec in this working tree and reverted §5 in
round 2 (read `.planning/codex-runs/installed-state/PROMPT.md` and `PROMPT-round2.md` for the full spec, the
standing constraints and the pre-resolved decisions; every rule there still applies: read `AGENTS.md`, `CLAUDE.md`,
`desktop/AGENTS.md` first; no git, no network, no `npm install`, no Playwright; keep every locked board
pixel-identical on the mock; never weaken a test; final answer is the JSON report matching the output schema).
Do NOT redo earlier sections. Build on the tree as it is. §5 stays OUT: no `machine:projectRoot` pref, no
`Surfaces.projectRoot`, no `Settings.projectRoot`, no Settings row, no `scanCwd`; `ls --local` reads pass no cwd
from the app beyond what origin/main passes. If you find any §5 remnant, remove it and list it in `deviations`.

## §9.1 (generalised; converged with Ryan's 2026-09-09 Library-model ruling)

Ryan reports the Library sidebar shows "Global 0" although the team has 4 skills present on disk. Same root fact
as §3 (placements-only), different derivation site.

- `statusModel(value, local, platform)` in `desktop/src/backend/tauri/index.ts` receives the `ls --local` value
  (`readModels` passes it) and today ignores it (`_local`) — `counts` come from `placementCounts(value.ledger.placements)`,
  the ledger. Replace that: sidebar counts come from the SCAN SECTIONS. `counts.Global` = the number of rows in the
  `scope:'global'` section that are present-or-placed — `row.placed === true || row.placement !== null ||
  (features.localIdentity && row.skillId !== null)` (the cached hello's `localIdentity`, exactly the §3 rule). When
  `local` is `null` (the scan failed or was unreadable) emit NO `Global` key at all (not `'0'`), so the Sidebar
  renders no number, exactly as it does while loading. Do NOT add per-project counts (the app cannot join a
  section's `repoRoot` to a team project's remotes; GAPS.md says so). Delete `placementCounts` if nothing else
  uses it (grep first).
- The `scanned: string[] | null` seam you added on `Library` and `Catalog` stays as it is: it lists the sections
  the CLI actually scanned (`~/.claude/skills` for the global section, the `repoRoot` (else `root`) for a project
  section). No change unless a test needs it.
- Library subtitle (`library()`'s `title`): keep `"<n> of <m> skills"` as the first segment and append
  ` · <g> in ~/.claude/skills` and, when a project section was scanned, ` · <p> in <repoRoot basename>` — where
  `g` / `p` are the number of THIS library's skills whose `paths` include an occurrence in that section
  (`paths[i][1] === 'global'` / `'project'`). The mock's title is unchanged (the mock returns `scanned: null` and
  its own title; do not touch the mock title logic).
- Tests (`desktop/src/backend/tauri/__tests__/index.test.ts`, fail-before/pass-after, using your replay fixtures /
  `installed-fixture.ts` helper):
  1. replay with ledger placements `[]` and one global row carrying a UUID `skillId` (hello
     `features.localIdentity: true`) → `status().value.counts.Global === '1'`;
  2. the same rows with no `skillId` and no `localIdentity` (old CLI) → `counts.Global === '0'`;
  3. `ls --local` failing (`ok:false`) → `status().value.counts` has no `Global` key; and in
     `desktop/src/components/domain/Sidebar.test.tsx` a status whose `counts` lacks `Global` renders the Global row
     with no number (read `Sidebar.tsx` first: if it already renders nothing for a missing key, the test only pins
     that; if it prints `undefined`/`—`, fix it to render nothing);
  4. `library()` title carries both per-root numbers when a project section is present, and only the global number
     when it is not.
- `desktop/GAPS.md`: if the file mentions that sidebar counts come from the ledger, update that one sentence to say
  they come from the scan's global section; otherwise add nothing.

## Gate fixes from the orchestrator's own round-2 gate run

(Appended below this line if any gate failed; if nothing is appended, round 2 was green on lint/typecheck and the
suites were still running when this round launched — run the desktop suite and the root suite yourself after your
change and report real counts.)

## Rulings on your round-2 open questions (§9.2) — implement these

1. DTO paths stay ABSOLUTE. `SkillDetail.path` is handed to `connect <path>` ("Manage with Terum…") and to
   `openInEditor`, which need a real path; the adapter abbreviates only print/error lines today, and that stays.
   For display, add one additive field `SkillDetail.pathLabel: string` = `abbreviateHome(path, await home())` on the
   real adapter (the fake bridge's home is `/Users/teddy`, so a test can pin `~/...`); the mock fills
   `pathLabel` with its existing `path` value so nothing drawn changes. The meta line ("read from …") and the rail's
   "This copy is yours … Connected: yes/no · <path>" and the Remove dialog's "Its files leave <path>" render
   `pathLabel`; `SkillCard.paths[i][0]` (display-only, no verb consumes it) is abbreviated the same way in the
   adapter — update the existing `paths` expectations in `index.test.ts` to the `~/`-form and declare that in
   `testsModified` as a deliberate contract change (display strings), not a weakening.
2. The mock keeps its two drawn strings (rail `skills/deploy-check`, meta `~/.claude/skills/deploy-check`) through
   the pre-existing `s.skillMd.markdown!==undefined` discriminator; do not touch that branch.

## Round-2 gate results (orchestrator)

Root and desktop lint/typecheck green. Desktop vitest (full suite, orchestrator's run) is pasted below; fix any
failure listed there in this round.
 Test Files  70 passed (70)
      Tests  944 passed | 88 skipped (1032)
