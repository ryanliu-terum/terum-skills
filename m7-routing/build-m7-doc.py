#!/usr/bin/env python3
"""build-m7-doc.py [--force]: assemble the M7 milestone document deterministically.

Inputs (all produced 2026-09-08):
  routed-batches.json      the verified, routed batch list the implementation queue reads (33 batches, 151 rows)
  synth-v2-pinned.json     the workflow's pinned synthesis: sections 1 and 2 are kept verbatim; its batch table is
                           discarded because it re-lettered the verified batches (twice), see section 4's note
  critic.json              the workflow critic: verdict on Teddy's premise, 13 gaps, 9 refutations
  rows-catalogue.json      every costed row the extractors saw (id, title, verdict, side)
  routing-section.md       section 10 (10.1 to 10.8) and Appendix B, the blank-map routing
Output: the .planning research document (refuses to overwrite without --force) and a mirror in the review folder.
"""
import json, re, sys, collections, datetime
from pathlib import Path

SC = Path('/tmp/claude-1000/-home-teniroo-Projects-SSM/667cfcd7-cc2c-4c6e-8fc8-866a9b55b649/scratchpad')
S = Path('/tmp/claude-1000/-home-teniroo-Projects-SSM/7f851f32-e149-4a13-9205-90f176fdcb4a/scratchpad')
OUT = Path('/home/teniroo/Projects/SSM/terum-skills/.planning/research/2026-09-08-m7-close-the-canvas-gaps.md')
MIRROR = Path('/home/teniroo/Projects/SSM/review/2026-09-08-desktop-blank-map/m7-routing/2026-09-08-m7-close-the-canvas-gaps.md')
FORCE = '--force' in sys.argv

routed = json.loads((S / 'routed-batches.json').read_text())
synth = json.loads((SC / 'synth-v2-pinned.json').read_text())
critic = json.loads((SC / 'critic.json').read_text())
catalogue = json.loads((SC / 'rows-catalogue.json').read_text())
routing = (S / 'routing-section.md').read_text()

batches = routed['batches']
by_id = {b['id']: b for b in batches}
placed = {r: b['id'] for b in batches for r in b['rows']}
assert len(placed) == sum(len(b['rows']) for b in batches), 'a row is placed twice'

def dash(t):
    """No em-dashes in prose: quoted agent text is normalised to a hyphen (punctuation only)."""
    return (t or '').replace(' — ', ' - ').replace('—', '-')

def skipped(b):
    return bool(re.search(r'\b(DONE|MOOT|DEFERRED)\b', b.get('status') or '', re.I)) or not b['rows']

def gated(b):
    return bool(re.search('gated', b.get('status') or '', re.I) or re.search('GATED', b.get('title') or ''))

run = [b for b in batches if not skipped(b)]
skips = [b for b in batches if skipped(b)]
drafts = [b for b in run if gated(b)]
ad_rows = sorted(r for r in placed if r.startswith('AD-'))
bm_rows = sorted(r for r in placed if r.startswith('BM-'))
simple_cli = sorted(k for k, v in catalogue.items() if v.get('verdict') == 'SIMPLE' and v.get('side') in ('cli', 'both'))
simple_cli_placed = [r for r in simple_cli if r in placed]
design_rows = sorted(k for k, v in catalogue.items() if v.get('side') == 'design')
dispositions = {d['id']: d for d in routed.get('dispositions', [])}
ryan_rows = sum(len(b['rows']) for b in run if (b.get('approver') or '').startswith('Ryan'))
ajay_rows = sum(len(b['rows']) for b in run if (b.get('approver') or '').startswith('Ajay'))

def section(doc, n, nxt):
    m = re.search(r'^## ' + re.escape(n) + r'\..*?(?=^## ' + re.escape(nxt) + r'\.)', doc, re.M | re.S)
    return m.group(0).rstrip() if m else f'## {n}. (missing in the synthesis)'

sdoc = synth['document']
sec1 = section(sdoc, '1', '2')
sec2 = section(sdoc, '2', '3')
assert not re.search(r'\bS7[a-z]{1,2}\b', sec1 + sec2), 'kept synthesis sections carry batch ids'

# Per-batch notes from the critic's refutations and gaps, keyed by the QUEUE's ids (the critic read the
# synthesizer's re-lettered table, so its batch letters are re-mapped here by row).
CRITIC_NOTES = {
    'S7k': 'Critic (refuted the synthesis): RM-41 `pending`, RM-48 `syncedAt` and RM-S1 `policy` are PER-TEAM members and belong on `TeamStatus` (`status.ts:17-22`), never on `StatusResult` (`:23`, two members: `version`, `teams`). The two failure-with-value returns are `status.ts:100` and `:101`. Critic (bar): this batch has two approvers in the PR body (Ryan for the status rows, Ajay for TJ-12); since Claude merges, that is a notification split, not a review split.',
    'S7af': 'Critic (corrected line numbers): the failing branch that drops `frame.value` is `run.ts:72-75`; there are TWO `schema.parse` sites, `run` at `tauri/index.ts:44` and `read` at `:48`, and AD-01 must cover both. Critic (unowned residuals, now owned here): re-anchor `desktop/GAPS.md` (still headed "pinned at b5c0507", 49 lines) to f8557c4 in this PR and add the missing PF-08 line (opt out of publishing install records: HARD, ships as drawn).',
    'S7b': 'Critic: the revert hazard for the new people-file fields is not sync (its two writers at `sync.ts:385-394` and `:398-405` touch only `installed` and `declined`) but `team join` at `team.ts:410-411`, which rewrites `display_name` and `email` from config identity on every join and reclaim while preserving `bio` at `:414`; thread `role` and `projects` through the same preservation. The bare `writeFile` calls at `team.ts:527` and `:529` sit inside `team create`\'s staging scaffold before the first commit, so they are not a second write surface. Critic: `FRAME_FEATURES.roles` (`frames.ts:39-42`) is ambiguous between PF-03\'s discipline label and TJ-02\'s permission role; flip it here only if the seam\'s `roles` capability means PF-03, otherwise leave it false and say so in the PR body.',
    'S7j': 'Critic (over-priced): `TeamOutcome`\'s skipped arm (`sync.ts:37`) already carries `unreachable | locked | busy | error | fresh`; CP-S3\'s absent clone reuses `unreachable` ("Skipping <team>: <clone> is missing") and adds nothing; only `--team` (a deliberate exclusion) needs a new reason. Names, not counts (decision taken under Teddy\'s "finish it" directive, 2026-09-08): `sync` returns the placed and removed skill NAMES beside the counts, taken from `recordPlacement`\'s per-team map before it is reduced; additive, so the adapter\'s placed/removed lists stop being empty.',
    'S7c': 'Critic: the costing refuses CP-D1 on the MERITS, not on price ("it should not be built at all": `team.json` already carries `name`, written from the same string at `team.ts:525` and published as the README heading). Implement MC-11 only; record CP-D1 as CLOSED by merits in the PR body and in the Appendix.',
    'S7aa': 'Critic: MC-01\'s costed route recommends no field and no flag; the app sets the child process cwd, which `lib.rs` already does. At spec time, verify `cli_spawn` sets cwd from the app; if it does, return status skipped with reason MOOT instead of building `--cwd`.',
    'S7e': 'Critic (S7ac residual, stronger than recorded): `app.ts:88` creates `~/.terum/skills/app/<version>/`, while `uninstallMachine.ts:135` sweeps exactly `run, cache, teams, quarantine` with `rmdir` (empty directories only), so machine uninstall leaves the whole desktop bundle on disk after saying it removed terum-skills. Add `app` to the sweep with a recursive remove and disclose it in MC-12\'s teardown sentence.',
    'S7t': 'Project heart (decision taken 2026-09-08 under Teddy\'s "finish it" directive): `favorites` stays `skillId[]` (`schema.ts:21` is `z.uuid()`), so the project heart is a DERIVED chip (any favourite skill in the project), no widened field; the `favorite-project:` preference is deleted. PF-02 stays gated on Teddy\'s written yes (draft PR).',
    'S7x': 'Window floor (design call, routed to the design walk): the shipped shell is minWidth 960 / minHeight 600 (`tauri.conf.json:18-19`), none of the three options the costing priced; raising to 1200x720 or drawing the icon-rail sidebar and single-pane Inbox is Teddy\'s call and not this batch\'s.',
    'S7i': 'Critic: TJ-10\'s costed route is a §5.1 documentation delta legitimising a hand-maintained `description` key on `team.json.projects` (alive only because `schema.ts:48` is passthrough); TJ-10 sits in S7p, so S7i carries none of it. RM-19 and RM-21 anchors verified exact at f8557c4 by the critic (`install.ts:47-53`, `:55-62`, `:77`, `:93-95`, `:141`, `:241`, `:106`, `result.ts:6`, `sync.ts:308-320`).',
    'S7p': 'Critic: TJ-10 is a documentation delta on §5.1 (the hand-maintained `description` key survives because `schema.ts:48` is passthrough); say so in the spec rather than adding a schema member.',
    'S7q': 'Critic: CP-D1 is not here (it is S7c\'s, closed by merits); this batch records refusals and wires flags only.',
}
DESIGN_WALK = [
    'Relabel the Library\'s New skill call to action to Connect (A3): canvas change plus re-lock; S7z is retired.',
    'The `TZ` avatar and the `Terum / SSM / MRF` sidebar literals (`build.py:247-249`, `:265`) on 75 of the 87 locked boards.',
    'CP-19\'s three refused command strings on the boards (`share <path>`, bare `share`, `uninstall deploy-check`): fix the strings, the CLI keeps its refusals (A8).',
    'The window floor (960x600 shipped vs 1200x720 or two new boards), critic finding on S7x.',
    'CP-03 (session-start sync prompt) as three honest strings (costing:1278); it breaks two bar conditions as code.',
    'The BootError rows and the six error boards\' fabricated cause sentences (shell hygiene, pixel-moving parts through the walk).',
]

def row_title(r):
    if r in catalogue:
        return catalogue[r].get('title') or ''
    if r.startswith('AD-'):
        for b in batches:
            for a in b.get('adapterHalf', []):
                if a.startswith(r + ':'):
                    return a.split(':', 1)[1].strip()[:110]
    if r.startswith('BM-'):
        m = re.search(r'\*\*' + re.escape(r) + r', ([^.]*?)\.', routing)
        return m.group(1) if m else 'blank-map ask (section 10.2)'
    if r == 'RM-17-producer':
        return 'progress frames on sync (the producer half of RM-17; consumer in S7r)'
    return ''

def placement(r):
    if r in placed:
        return f'batch {placed[r]}'
    v = catalogue.get(r, {})
    if v.get('side') == 'design':
        return 'design-side string (Teddy\'s call, BRIEF.md:28); not an M7 batch'
    if r in dispositions:
        return 'disposition: ' + dash(dispositions[r]['disposition'])[:160]
    if v.get('side') == 'app':
        hosts = [b['id'] for b in batches if re.search(r'\b' + re.escape(r) + r'\b', ' '.join(str(b.get(k) or '') for k in ('appHalf', 'cliChanges', 'tests', 'title')))]
        if hosts:
            return 'app half of ' + ', '.join(hosts)
        return 'app-side; no batch names it: UNPLACED (section 9)'
    if v.get('side') in ('closed', 'deferred', 'cut'):
        return f'{v.get("side")} (verdict {v.get("verdict")})'
    return 'UNPLACED (section 9)'

unplaced = sorted(r for r in catalogue if 'UNPLACED' in placement(r))

now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
L = []
w = L.append
w('# M7: close the canvas gaps in the CLI (metadata + intelligent sync)\n')
w(f'Generated {now} from the verified batch list the implementation queue reads (`routed-batches.json`, 33 batches, {len(placed)} rows placed once each), the workflow critic\'s output, and the blank-map routing (section 10). Baseline: `ryanliu-terum/terum-skills` main at f8557c4 (v0.1.6). Sections 1 and 2 are the workflow synthesizer\'s text, kept verbatim. Its own batch table was discarded: it re-lettered the verified batches twice (S7b for the ls payload, S7d for status), so it disagreed with the routing, the verifier corrections and the queue, all of which use the ids below. Every batch paragraph in section 4 is the verified design text plus its verifiers\' corrections, unparaphrased. Local by design: `.planning/` never leaves this machine.\n')

w('## 0. The answer in five lines\n')
w(f'1. **Teddy\'s premise, judged by the critic: confirmed for the bulk, contradicted for the greyed controls.** 166 of 196 rows are SIMPLE and 53 of the 62 SIMPLE CLI-side rows need no new field anywhere (Result fields, exports, flags, verb payloads). But "more intelligent sync" is not the lever: a committed field already propagates on the next sync with zero sync code (`safeWrite` re-fetches, every people-file writer re-serialises the parsed document), and ten of the twelve `FRAME_FEATURES` flags (`frames.ts:39-42`) are decisions, permissions or absent mechanisms, not metadata. The full verdict is quoted below.')
w(f'2. **What M7 is now:** {len(batches)} batches, S7a to S7ag. {len(run)} run through the queue, {len(skips)} are skipped ({", ".join(b["id"] + " " + re.match(r"\\w+", b.get("status") or "SKIP").group(0) for b in skips)}), {len(drafts)} open as draft pull requests ({", ".join(b["id"] for b in drafts)}). {len(placed)} rows: {len(simple_cli_placed)} of the {len(simple_cli)} SIMPLE CLI-side rows, the twelve BM rows from the desktop blank map, {len(ad_rows)} AD rows (the adapter and shell halves), the MEDIUM rows Teddy chose to build, and the app-only rows.')
w('3. **Connected surfaces (Teddy, 2026-09-08, binding):** the real app shows only real data. A batch is done when its surface shows real data end to end: CLI half, adapter mapping, mock, and the served-surface flip, in one pull request. A surface whose read model is still a gap stays hidden; the Inbox is the first case. Section 10.8.')
w(f'4. **Who builds and merges:** Codex (gpt-6-astra) writes every line in a worktree per batch; Claude writes the spec, runs the gates, and merges the PR itself after the checks are green (Teddy, 2026-09-08: "You can merge"). Ryan and Ajay are informed by the PR bodies: {ryan_rows} rows carry Ryan as the named approver and {ajay_rows} carry Ajay. Two batches stay drafts: S7t (PF-02 needs Teddy\'s written yes) and S7ab (Ryan\'s closed team guard).')
w(f'5. **From Teddy still:** {len(design_rows)} design-side string rows (his standing call), PF-02 in writing, and the design-walk items in section 6.\n')
w('**Critic\'s verdict, verbatim (2026-09-08, read against f8557c4):**\n')
w('> ' + dash(critic['teddyStatementVerdict']).replace('\n', '\n> ') + '\n')

w(sec1 + '\n')
w('**Exit criterion, amended for connected surfaces (10.8) and for the critic\'s measurability finding.** M7 is complete when every non-skipped batch in section 4 is merged on `main`; every SIMPLE CLI-side row\'s field is served by the real adapter and its surface is un-hidden; the mock still passes 87 of 87 locked boards; and each batch\'s run record carries the real-data proof: the batch\'s verbs replayed over `--frames` against the offline fixture team (`review/2026-09-08-desktop-blank-map/fixture.sh`) and the recorded frames fed through the adapter\'s read model in a vitest that asserts the served DTO carries the batch\'s fields and no design constant. The fidelity oracle proves the mock did not move; the replay proves the real adapter serves the data. S7ab (TJ-02) is outside "M7 complete": it is gated on Ryan reopening a closed table.\n')

w(sec2 + '\n')
w('**Critic corrections to this section (binding on any spec that cites `sync.ts`, `guard.ts`, `schema.ts` or `team.ts`):**\n')
for r in critic['refutations']:
    w('- ' + dash(r))
w('')

w('## 3. Where M7 sits now that M5 and M6 have shipped\n')
w('The M6 prerequisite is not a library entry. `package.json` declares only `bin`, `files` and `version` (no `main`, no `exports`, verified by the critic), so the app can only drive the CLI as a child process: it spawns `node <entry> --frames <verb>` (`desktop/src-tauri/src/lib.rs:42-48`), finds the CLI through `~/.terum/skills/run/app.json`, and reads the verb\'s result frame `value` (`src/lib/frames.ts:24`, `:171-175`). RM-11 (the exports map) is off every path and S7a is retired. Every widened Result member reaches the app the moment its batch merges, provided the adapter maps it, which is why every batch now carries its app half.\n')
w('Ten read models still return a hard-coded gap on the real adapter (`desktop/src/backend/tauri/index.ts:61-69`, `:85`). Each returns in the batch that first serves it from real data, and the surface is un-hidden in that same PR (10.8):\n')
w('| gap() read model | served by | fields filled later by |')
w('|---|---|---|')
GAPS = [
    ('`status`', 'S7k (AD-20)', 'S7k rows (pending, syncedAt, policy, clone path, join block, ledger, identity, tools); TJ-12 categories'),
    ('`settings`', 'S7k (AD-24)', 'S7g (placements, AD-23), S7l (hook), S7s (storage), S7e (update advice), S7c (account write half)'),
    ('`library`', 'S7f (AD-21)', 'S7g (health, tracked), S7f rows (description, grants, installers, last-changed, projects)'),
    ('`skill`', 'S7f (AD-22)', 'S7n (receipt), S7m (validate findings), S7f (SKILL.md body, RM-01)'),
    ('`receipts`', 'S7n (EV-13 `receipt` verb)', 'S7m (EV-08, EV-11), S7u (per_case, EV-03)'),
    ('`inbox`', 'S7r (IB-01, the feed; app-only)', 'derivable rows first: S7f (BM-04 declined), S7n (IB-02), S7o (IB-06), S7m (IB-05); the Inbox stays hidden until S7r serves it'),
    ('`catalog`', 'S7b (AD-26)', 'S7f (BM-01 projects), S7h (host reads)'),
    ('`roster`', 'S7b (AD-25)', 'S7h (admin column, invitations), S7b rows (role, projects)'),
    ('`onboarding`', 'S7r (first-run routing rule and a screen that calls `backend.setup`)', 'S7ad (join target, BM-12), S7ae (progress frames)'),
    ('`update`', 'S7e (RM-08 returns a report)', 'none'),
]
for a, b, c in GAPS:
    w(f'| {a} | {b} | {c} |')
w('')
w('Two adapter facts define "real", and both are S7af\'s first items: a failing result frame drops its `value` (`run.ts:72-75`), so any payload that rides a failure (status with one unreadable team, RM-19\'s partial installs) reaches the app only after AD-01; and one malformed row fails a whole call, since every result goes through `schema.parse` at two sites (`tauri/index.ts:44` and `:48`), so every new key is declared on the closed zod objects rather than left to passthrough.\n')
w('**First end-to-end run.** Only three platforms have a build (`aarch64.app.tar.gz`, `x64.app.tar.gz`, `arm64-setup.exe`; `platform.ts:15-33`), produced by `release.yml`\'s `desktop` matrix. The first real run is on the Windows ARM host after `gh auth login` there: `npx -y terum-skills@latest app` installs the NSIS build and launches it, and the app spawns `--frames status`. Today that renders the gap board; after S7af it renders a sidebar with every gap surface hidden, and after S7f and S7k the Library, Skill detail, status footer and Settings appear from real data. Proof on this box is the headless replay described in section 1; macOS is proven by the CI runner plus the checksum-verified install (`app.ts:96-126`). A release without Ryan: bump `package.json` on `main` and dispatch `release.yml` with `dry_run: true`; the desktop bundles and the npm tarball land as workflow artifacts. A public `npx` release still needs the `npm` environment\'s only reviewer, Ryan.\n')

w('## 4. The batches\n')
w('Section 10 records how these rows were routed (10.1 to 10.3), Teddy\'s decisions (10.6, and the ledger in the review folder), the second-pass corrections (10.7) and the connected-surfaces amendment (10.8). Where a batch paragraph and section 10 differ, section 10 wins. Order is the queue\'s priority order; a batch never starts before its dependencies have merged, at most two run at once.\n')
w('| # | id | title | rows | size | approver named in the PR body | dependsOn | status |')
w('|---|---|---|---|---|---|---|---|')
for i, b in enumerate(batches, 1):
    st = (b.get('status') or '').split(';')[0][:70]
    w(f'| {i} | {b["id"]} | {dash(b["title"])[:110]} | {", ".join(b["rows"]) or "(none)"} | {b.get("size") or ""} | {dash(b.get("approver") or "")[:60]} | {", ".join(b.get("dependsOn") or []) or "none"} | {dash(st)} |')
w('')
for b in batches:
    w(f'### {b["id"]}. {dash(b["title"])}\n')
    w(f'- **Rows:** {", ".join(b["rows"]) or "(none)"}')
    w(f'- **Depends on:** {", ".join(b.get("dependsOn") or []) or "none"}')
    w(f'- **Size / approver for the PR body:** {b.get("size") or "?"} / {dash(b.get("approver") or "none")}')
    if b.get('status'):
        w(f'- **Status:** {dash(b["status"])}')
    if b.get('decisionNotes'):
        w(f'- **Decisions applied (Teddy, 2026-09-08):** {dash(b["decisionNotes"])}')
    if b['id'] in CRITIC_NOTES:
        w(f'- **Critic and follow-up notes (binding):** {CRITIC_NOTES[b["id"]]}')
    w('')
    if b.get('cliChanges'):
        w(f'**CLI change.** {dash(b["cliChanges"])}\n')
    if b.get('appHalf') or b.get('adapterHalf'):
        w(f'**App half (connected surfaces, 10.8; ships in the same PR).** {dash(b.get("appHalf") or "")}')
        for a in b.get('adapterHalf', []):
            w(f'- {dash(a)}')
        w('')
    if b.get('syncRule'):
        w(f'**Sync rule.** {dash(b["syncRule"])}\n')
    if b.get('tests'):
        w(f'**Tests.** {dash(b["tests"])}\n')
    if b.get('rationale') or b.get('risk'):
        w(f'**Rationale and risk.** {dash(b.get("rationale") or "")} {dash(b.get("risk") or "")}\n')
    if b.get('verification'):
        w('**Verifier corrections (two adversarial lenses at 85cc276 and f8557c4; authoritative over the batch text above).**\n')
        for i, v in enumerate(b['verification'], 1):
            w(f'- Lens {i} ({"no material error" if v.get("ok") else "corrections apply"}): {dash(v.get("corrections") or "")}')
        w('')

w('## 5. Dispositions\n')
w('Every MEDIUM, HARD, CLOSED, DEFERRED and cut row, as the design and the amend dispositioned it. Rows Teddy later moved into batches (D-BM-1 progress frames, the MEDIUMs S7ae, S7s, S7aa, S7t) are marked in section 4.\n')
w('| row | disposition | why |')
w('|---|---|---|')
for d in routed.get('dispositions', []):
    w(f'| {d["id"]} | {dash(d["disposition"])[:220]} | {dash(d["why"])[:260]} |')
w('')
w('Additional dispositions from this session: CP-D1 is CLOSED by merits (section 4, S7c); CP-33 ("printed commands say @latest while the app would run a bundled library in-process") rests on the in-process-import premise frame mode retired with RM-11 and is retired with it; MC-01 is MOOT if `cli_spawn` already sets cwd (S7aa checks first); RM-37 is MOOT by relabel (A3).\n')
w(f'**The {len(design_rows)} design-side string rows (Teddy\'s calls, not batches):** ' + ', '.join(f'{r} ({dash(catalogue[r].get("title") or "")[:60]})' for r in design_rows) + '.\n')

w('## 6. Decisions\n')
w('**Answered by Teddy in-thread, 2026-09-08 (ledger: `review/2026-09-08-desktop-blank-map/m7-routing/decision-ledger-2026-09-08.md`):** D-BM-1 = B (S7ae ships the progress-frame producer); D-BM-2 = A (tool presence only, offline); D-BM-3 = A with the rider that the join target comes from the invite\'s generated wizard command and a joiner never types the team; D-BM-4 = A (`declined` on `ls member`); D-BM-5 = A (one S7k PR); D-BM-6 = A (RM-44 subset); D-BM-7 = A (`--runs`); A1 keep CP-30 as a note-composer; A2 confirm key casing before S7y; A3 relabel New skill to Connect; A4 derive RM-13; A5 hold PF-02 and the Follow tooltip\'s Inbox promise; A6 accept the TJ-02 interim; A7 nothing to decide; A8 the three refused strings stay design-side. Merging: Claude merges. Real data only: hide gap surfaces, show them when M7 connects them.\n')
w('**Taken by Claude under Teddy\'s "finish up the M7 and move to implementation" (reversible, each recorded on its batch):** names beside counts on `sync` (S7j); the project heart as a derived chip, no widened `favorites` (S7t); the window floor goes to the design walk (S7x); CP-D1 closed by merits (S7c); MC-01 checked for mootness first (S7aa).\n')
w('**Still Teddy\'s:** PF-02\'s written yes (S7t stays a draft until then). The design walk list: ' + ' '.join(f'({i}) {t}' for i, t in enumerate(DESIGN_WALK, 1)) + '\n')
w('**Ryan\'s, stated in the S7ad PR body:** the recorded launch PATH (BM-11) versus resolving a login-shell PATH at spawn time on the Rust side.\n')

w('## 7. Merging and delivery\n')
w('One batch, one Codex run, one worktree, one branch `codex/m7-<id>`, one PR into `ryanliu-terum/terum-skills` `main`, merged by the implementer after its own gates and the PR\'s CI checks pass; a dependent batch stacks on its dependency\'s branch until that merges. Gated batches open as drafts and are never merged by the queue. No direct push to `main`, no hook bypass, no force push. Gates per batch: the root battery (lint, typecheck, tests), the desktop battery (typecheck, lint, vitest, build, Playwright routes, the 87-board fidelity spec with `TERUM_DESIGN_DIR`), `cargo check` when `src-tauri` changes, and the real-data replay of section 1, all serialised on one lock because two batteries thrash this box. The approver column is the person the PR body addresses, not a merge gate. Delivery to a machine: bump `package.json` on `main`, dispatch `release.yml` with `dry_run: true`, download the desktop artifacts; the public `npx` path waits on Ryan\'s `npm` environment approval.\n')

w('## 8. First spec outline: S7af, adapter plumbing and the real-data rule\n')
w('App-only, no CLI change, first in the queue; every batch with an app half stacks on it. Base f8557c4. Files: `desktop/src/backend/tauri/{run,index,bridge}.ts`, `desktop/src/backend/types.ts`, `desktop/src/backend/mock/index.ts`, `desktop/src/components/domain/Sidebar.tsx`, `desktop/src/app/providers.tsx`, the four screens with `COUNTS` literals, `desktop/GAPS.md`.\n')
for a in by_id['S7af'].get('adapterHalf', []):
    w(f'1. {dash(a)}')
w('1. Re-anchor `desktop/GAPS.md` to f8557c4 and add the PF-08 line (critic).')
w('1. Tests: `run.test.ts` (value carried on ok:false; events kept after the first settle stay S7ag\'s), `index.test.ts` (print frames appended to a failing error; `--team` on every argv; `cliConnect.optional()`; publish `changed`), `mock.test.ts` (the strict `toEqual` at `:30` gains `surfaces`), a `Sidebar` test (a gap read model hides its group on the real adapter; the mock shows every group), a `providers` test (a settled run invalidates the queries). Acceptance: desktop battery green, 87 of 87 locked boards unchanged, the replay of `--frames status` through `read()` returns a typed gap for `settings` and the sidebar omits Settings and Inbox while the mock shows both.\n')

w('## 9. NOT VERIFIED and open\n')
NV = [
    'NOT VERIFIED whether the real team.json in Ryan\'s team uses capitalised project keys (Terum / SSM / MRF) or lowercase; S7y checks before its PR (A2).',
    'NOT VERIFIED: the seam `Receipt`\'s full field list against `src/lib/evals/receipt.ts`; S7n (the receipt verb) and S7u (per_case) both assume a CLI-receipt-to-seam-Receipt mapper nobody has written; S7n writes it.',
    'NOT VERIFIED that adding a Tauri filesystem or watch capability is acceptable: the shipped native surface is exactly five commands (`desktop/src-tauri/src/lib.rs:137`) with no fs plugin; S7w (change notification) may need a sixth and says so in its PR body.',
    'NOT VERIFIED that the axe gate and the reflow assertion battery (S7x) fit this box beside the fidelity battery; they run under the same lock.',
    'NOT VERIFIED: S7q\'s AC-08 `openUrl` needs no new Rust capability; `capabilities/default.json` grants `opener:default`, `allow-open-path` and `allow-reveal-item-in-dir` only.',
    'NOT VERIFIED on this box: the Rust lifecycle bugs (AD-11 to AD-13) cannot be reproduced here (no packaged app, `cargo check` only); S7ag\'s NOTES.md says so and the native leg on the Windows host is the proof.',
    'OPEN: `FRAME_FEATURES.roles` semantics (PF-03 label or TJ-02 permission role); S7b decides from the seam and records it.',
    'OPEN: macOS has never been walked by hand; the CI runner and the checksum-verified install are the evidence.',
    'OPEN: the `gh` network path from this box times out intermittently (`gh auth status` self-check; one `git fetch` hung during this session); implementers retry twice with a 20 s pause.',
]
for n in NV:
    w('- ' + n)
if unplaced:
    w(f'- UNPLACED rows after this routing ({len(unplaced)}): ' + ', '.join(unplaced) + '. Each is an app-side SIMPLE row no batch names; S7r (app-only) owns them by default until a batch claims one.')
w('')
w('**Critic gaps, verbatim, with their standing against this document\'s section 4 (the critic read the synthesizer\'s re-lettered table):**\n')
for g in critic['gaps']:
    w('- ' + dash(g))
w('')

w('## Appendix A. Row to placement index\n')
w('| row | title | verdict | side | placement |')
w('|---|---|---|---|---|')
all_rows = sorted(set(catalogue) | set(placed), key=lambda r: (r.split('-')[0], r))
for r in all_rows:
    v = catalogue.get(r, {})
    w(f'| {r} | {dash(row_title(r))[:90]} | {v.get("verdict") or ("adapter/shell" if r.startswith("AD-") else "blank-map" if r.startswith("BM-") else "")} | {v.get("side") or ""} | {placement(r)} |')
w('')

body = '\n'.join(L) + '\n' + routing.rstrip('\n') + '\n'
assert '## 10.' in body and '### 10.8' in body and 'Appendix B' in body
own = body.split('## 10.')[0]
em = own.count('—')
if OUT.exists() and not FORCE:
    sys.exit(f'{OUT} exists; pass --force to overwrite')
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(body)
MIRROR.parent.mkdir(parents=True, exist_ok=True)
MIRROR.write_text(body)
print(f'wrote {OUT} ({len(body.split())} words, {len(body)} chars); em-dashes outside section 10: {em}')
print(f'batches {len(batches)} run {len(run)} skipped {[b["id"] for b in skips]} drafts {[b["id"] for b in drafts]}')
print(f'rows placed {len(placed)}; SIMPLE cli/both placed {len(simple_cli_placed)}/{len(simple_cli)}; AD {len(ad_rows)} BM {len(bm_rows)}; design rows {len(design_rows)}; unplaced {unplaced}')
missing_simple = [r for r in simple_cli if r not in placed]
print('SIMPLE cli/both rows in no batch:', missing_simple)
