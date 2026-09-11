# Auto-populate `terum-category` at connect

> **Amended 2026-09-11 by `.planning/specs/2026-09-11-library-marketplace-refactor.md` (§5.1 step 4, §16):** `connect` is deleted by that refactor. The suggestion now happens once, at a skill's **first publish**, with the same precedence (declared › `--category` › `suggestCategory` › `DEFAULT_CATEGORY`), the same disclosure table (a declared category prints no line), and the same write-back of the injected `SKILL.md` into the user's local folder. Read "connect" below as "publish"; the `--category` flag moves with it. A category remains ordinary content thereafter (§7), and is part of the skill's content identity.

**Status:** rev 1 (Claude Opus 5, 2026-09-10). LOCKED by the
`.planning/decisions/2026-09-10-auto-category-decision-walk.md` walk. Ready to build.

**North Star (ratified by Ryan, 2026-09-10):** browse actually works — someone scanning a
teammate's catalogue finds the right skill without reading every description.

**The problem, measured.** Every `terum-category` value that exists on this machine is
`misc`: 5 in `~/.terum/skills/teams`, 4 in this repo's `.claude/skills`, 1 in
`~/.claude/skills`. Zero authors have ever declared one and zero have corrected one after
the fact. `connect` stamps `DEFAULT_CATEGORY` when a SKILL.md declares nothing
(`skills.ts:153`), and R1's "edit SKILL.md any time" has a measured 0% uptake. The field is
dead, and browse-by-category has nothing to group on.

**Governing contracts (unchanged by this spec):**
- **R1** (`2026-09-06-phase1-rulings-decision-walk.md`, decision `74804670`): all four
  managed metadata fields are *generated* at share time, every generated value is shown
  before the existing y/N, there is **no separate category prompt**, and a **declared
  category is never overwritten**. This spec changes the default's *source*, not the policy.
- **Taxonomy** (decision `2e21eae8`, overriding `d15d09a6`): eight categories —
  `debugging, testing, docs, workflow, research, infra, review, misc`. Already shipped to
  `team.ts:42` and to `terum-shared-skills` (`15c57cb`).
- **`validate` is deterministic and offline** (`cli.ts:114`: "no model, no network call").
  Nothing in this spec may put a model call on that path.
- **CLAUDE.md:** no attacker model. Findings are about a well-meaning user losing data,
  hitting a crash, or getting behaviour the spec does not describe.

**Evidence this design rests on** (15 real SKILL.md files, graded 2026-09-10):
per-skill Haiku through `askJson` scored 11 clearly right / 4 contestable / 0 wrong,
0 invented categories, 0 parse failures, 0 timeouts; median 4.9s, max 7.5s, ~$0.009/skill.
Against the 8-category list the same run was **15/15 stable across a skill-order reversal**
with a 33% largest bucket. Dropping `misc` was measured to produce confidently wrong
answers (`ui-ux-pro-max → onboarding`), which is why the escape hatch is mandatory.

---

## 1. Behavior

Connecting a skill whose SKILL.md declares no category, online:

```
Will add:
license: UNLICENSED
metadata.id: 9f1c…
metadata.author: Ryan Liu <ryanliu@terum.ai>
metadata.terum-category: review (suggested from your SKILL.md; edit any time)
Connect ultrareview? [y/N]
```

The same connect with the model unreachable — offline, not logged in, timed out, rate
limited, or answering with something that is not one of the team's categories:

```
metadata.terum-category: misc (couldn't reach the model; edit SKILL.md any time)
```

With `--category review` passed explicitly, no model call happens at all:

```
metadata.terum-category: review (from --category; edit SKILL.md any time)
```

A SKILL.md that already declares a category prints **no category line**, exactly as today,
and no model call is made.

**The two failure lines are the point** (walk D2). A classifier that silently stops working
is indistinguishable from one that ran and chose `misc`; the catalogue then drifts back to
the state this whole effort exists to fix, and nobody notices. The distinction costs one
string and is read at the moment it can be acted on.

**Connect never blocks on the model.** Every failure path — binary absent, not logged in,
offline, timeout, non-JSON, JSON without a `category`, a category outside the team's list —
resolves to `DEFAULT_CATEGORY` and the confirmation proceeds. There is no retry, no prompt,
and no new exit code.

---

## 2. `src/lib/categorize.ts` (new)

```ts
export interface CategorySuggestion { category: string; suggested: boolean; }

/** Never throws. Any failure is { category: DEFAULT_CATEGORY, suggested: false }. */
export async function suggestCategory(
  skillMd: string,
  categories: readonly string[],
  agent?: AgentApi,
): Promise<CategorySuggestion>;
```

- `agent` defaults to `systemAgent` from `src/lib/evals/agent.js`. It is a parameter so tests
  stub `askJson` and never spawn a binary — the same injection seam `judge.ts`, `triggers.ts`
  and `generate.ts` already use.
- **An empty `categories` list makes no model call** and returns `DEFAULT_CATEGORY` with
  `suggested: false`. A team whose list is empty has nothing to classify into.
- Input is `skillMd.slice(0, 2000)`. The graded run used 2000 characters; the batched run
  used 900 and agreed 15/15, so the cap is not delicate.
- Model `'haiku'`, `timeoutMs` 20 000. The measured max was 7.5s; 20s is ~2.7× headroom for
  a cold CLI start, and it is a ceiling, not a target.
- `settingSources: ''` (see §3).

**Prompt** — this exact shape was the one graded; do not paraphrase it:

```
Classify this Claude Code skill into exactly one category.

Allowed categories (choose one verbatim): <comma-separated list>.

If none clearly fits, answer "misc".

Reply with only {"category": "<one of the allowed values>"}.

--- SKILL.md ---
<first 2000 chars>
```

**Answer handling.** Read `category` from the returned object; trim it; match
case-insensitively against `categories` and return the team's canonical spelling. Anything
that does not match — a missing key, a non-string, an invented bucket — is
`DEFAULT_CATEGORY` with `suggested: false`. **The model can never introduce a category**;
that is what keeps browse from fragmenting into one-off buckets.

`suggested` is `true` only when the model returned a value that matched the list.

---

## 3. `askJson` gains `settingSources`

`AskJsonOptions` in `src/lib/evals/agent.ts` gains `settingSources?: string`, defaulting to
`'project'` so every existing caller is byte-identical. `categorize.ts` passes `''`.

Why: `askJson` currently hardcodes `--setting-sources project`, which for this call would
load the *user's* project `CLAUDE.md` into a classification prompt — irrelevant latency at
best, and at worst a repo instruction steering the classifier. `--setting-sources ''` is
accepted by the CLI (verified 2026-09-10, rc=0, a trivial call in 1.35s).

This is the only change to the eval trust boundary. `runAgent` is untouched.

---

## 4. Wiring into `connect`

In `connectOne` (`src/commands/connect.ts`), after `teamDoc` is parsed and **before**
`injectManagedFields`, so hygiene inspects finished bytes and the write path is unchanged:

```ts
const declared = declaredCategory(raw);
const chosen: CategorySuggestion =
  declared !== undefined ? { category: declared, suggested: false }
  : args.category !== undefined ? { category: args.category, suggested: false }
  : await suggestCategory(raw, teamDoc.categories, ctx.agent);
const updated = injectManagedFields(raw, {
  license: teamDoc.policy.skill_license, id, author, category: chosen.category,
});
```

`injectManagedFields` already accepts `category` and already refuses to overwrite a declared
one (`skills.ts:145`, `:153`) — this spec supplies the argument `connect` never passed.

`ConnectContext` gains `agent?: AgentApi`; `ConnectArgs` gains `category?: string`. The
context field exists for tests; production leaves it undefined.

**The confirmation line** replaces `connect.ts:198`'s two-state `categoryLine` with four
states:

| Case | Line |
|---|---|
| declared in SKILL.md | *(no line — unchanged)* |
| `--category` given | `metadata.terum-category: X (from --category; edit SKILL.md any time)` |
| model suggested | `metadata.terum-category: X (suggested from your SKILL.md; edit any time)` |
| model unavailable | `metadata.terum-category: misc (couldn't reach the model; edit SKILL.md any time)` |

**Ordering.** The suggestion resolves before `assessHygiene`, so a suggested category is
subject to HYG7 like any other (§7) — in practice it never trips it, because the suggestion
is drawn from the list HYG7 checks against. That is a consistency property, not a
coincidence to rely on.

**Latency.** Each connect gains ~5s before its y/N. Accepted: `connect`'s no-path mode is an
interactive one-at-a-time menu (`connect.ts:117-127` — a `select`, one `connectOne`, menu
reappears), not a loop over every local skill, so the cost is one 5s pause per deliberate
connect and never a multi-minute stall. **Do not add a batched path here**: classifying
candidates the user has not chosen would spend tokens on skills they may never connect and
would delay the first menu. (Batching was measured — 15 skills in one call, identical
answers, 26s and $0.028 against $0.137 serial — and belongs to the re-label verb gated in
the walk's D1, which has a real batch to process.)

---

## 5. `--category <name>` on `connect`

`cli.ts:122` gains `.option('--category <name>', "the skill's terum-category; skips the
model suggestion")`, threaded into `ConnectArgs`.

- A non-empty string is required; an empty or whitespace-only value is a plain refusal
  before any work.
- It is **not** required to be in the team's list — HYG7 warns instead (§7). Forcing it here
  would be the refusal the walk explicitly rejected.
- A category declared in SKILL.md still wins over the flag: the flag supplies a default for
  a file that has none, exactly like the model does.
- This is the offline and scripted escape hatch, and the channel the desktop already has —
  it builds its connect invocation from flags (`desktop/src/backend/tauri/index.ts:732`), so
  a future category picker needs no new CLI surface.

---

## 6. HYG7 — an off-list category warns

`src/lib/evals/hygiene.ts`:

- `HygieneCode` gains `'HYG7'`. A new code rather than a warning under HYG1, because HYG1
  emits only errors today and the two would be indistinguishable in output.
- `HygieneInput` gains `categories?: readonly string[]`.
- `assessHygiene(name, input, license, allowExecutable = false, categories?: readonly string[])`
  — a fifth optional positional keeps all four existing call sites compiling unchanged.
- The check emits **one warning** when `categories` is provided and non-empty, the
  frontmatter parses, and its `metadata.terum-category` is a non-empty string that is not in
  the list (case-insensitive). It **no-ops when the list is unknown** — `validate <path>` on
  a folder that was never connected has no `team.json` to compare against, and must not warn
  about a list it cannot see.
- It is a **warning, never an error**: it gates nothing (`hygiene.ts:8`).

Message:

```
warning HYG7 SKILL.md:<line>: terum-category `ops` is not one of your team's categories (debugging, testing, docs, workflow, research, infra, review, misc). Browse will give it a bucket of its own; add it to team.json or change this line.
```

Use the existing `lineOf` helper against `/^\s*terum-category\s*:/m` for the line number;
omit the line if it cannot be found.

**Callers pass the list where they have it:** `connect.ts` (from `teamDoc`), `publish.ts:64`
and `:118`, `eval.ts:98`, and `validate.ts:42` when resolving a shared skill or a
`--cwd <team-checkout>`. `validate <path>` on an unconnected folder passes nothing.

`cli.ts:114`'s help text enumerates HYG1–HYG6 and gains HYG7. HYG7 is a list comparison —
**no model, no network** — so validate's deterministic-and-offline promise holds.

---

## 7. What this spec deliberately does not do

- **No back-fill verb.** The walk's D1 gated `terum-skills categorize` behind a team with
  more than ~15 stale skills or a taxonomy change forcing a catalogue-wide relabel. The five
  skills in `terum-shared-skills` get a manual pass instead.
- **No desktop change.** The Tauri backend parses validate as `{ name, findings, warnings }`
  (`desktop/src/backend/tauri/index.ts:52`) — a count with no text — so HYG7 renders as an
  uninformative badge until that schema is widened. Deferred to Teddy; out of scope here.
- **No refusal on an off-list category.** The walk chose warn over refuse.
- **No re-categorisation on later edits.** The suggestion happens once, at connect. A
  category is ordinary content thereafter and reconciles like any other edit.
- **No change to `publish`, `install`, `sync`, or the guard.** `publish` keeps printing the
  category it finds (`publish.ts:211`).
- **No second prompt anywhere.** R1.

---

## 8. Build order and exit

1. `askJson` gains `settingSources`; a test asserts the flag reaches the spawn and that the
   default is still `project`.
2. `src/lib/categorize.ts` + `src/lib/__tests__/categorize.test.ts` against a stubbed
   `AgentApi`: a matching answer; a case-mismatched answer canonicalising to the team's
   spelling; an invented category; a missing `category` key; a non-string; a thrown
   `AgentRunError`; a timeout; an empty category list making **no** call (assert the stub was
   not invoked).
3. Connect wiring, `ConnectArgs.category`, the four-state line, `--category` in `cli.ts` +
   tests in `src/commands/__tests__/connect.test.ts`: declared wins over both flag and model;
   flag wins over model and suppresses the call; suggestion path prints the suggested line;
   failure path prints the fallback line and still completes the connect.
4. HYG7 + the `categories` parameter threaded through all five call sites + tests in
   `src/lib/evals/__tests__/hygiene.test.ts`: warns on an off-list category; silent on an
   on-list one; silent when no list is supplied; case-insensitive; never an error.
5. `cli.ts:114` help text.

**Exit criteria.** `npm run lint`, `npm run typecheck`, and `npm test` all green from the
repo root. The suite is at 1121 tests / 71 files as of 2026-09-10; the count must rise and
nothing existing may turn red. Two pre-existing lint errors live in the untracked
`m7-routing/` scratch directory and are not this spec's to fix — lint must show no *new*
errors.

**Verification note for the orchestrator:** every gate Codex reports is a hypothesis. Re-run
lint, typecheck, and the full suite yourself before trusting the diff (CLAUDE.md).

---

## 9. Defaults chosen here (veto cheap)

- 2000-character input slice; 20 000 ms timeout; model alias `'haiku'`.
- A fourth confirmation state for `--category`. The walk locked only "distinguish success
  from failure"; telling the user the value came from their own flag is the same principle
  applied to the same line.
- A fifth optional positional on `assessHygiene` rather than converting it to an options
  object. Minimal diff over four call sites; convert it later if a sixth parameter appears.
- `HYG7` as its own code rather than a warning-flavoured HYG1.
- Canonicalising the model's answer to the team's spelling, so `Review` lands as `review`.
