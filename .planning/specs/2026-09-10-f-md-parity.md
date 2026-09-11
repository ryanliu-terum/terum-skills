# f-md-parity — the SKILL.md tab renders like the mock: frontmatter block + measured parity

Teddy (2026-09-10): "The skill.md's in app should render prettier (like they do in the mock)."

Base: origin/main after every 2026-09-10 batch has merged (W-05 `SkillMarkdown` is already in, PR #145).
Read `desktop/AGENTS.md` (eight invariants) and root `AGENTS.md` first. Real data only (Teddy 2026-09-09): the real
adapter serves what is on disk, never fixture values.

## 1. What is measured today

Screenshots taken 2026-09-10 at 1440×900 of the same skill on both sides:

- Mock (`terum-skills-mock-realistic.html#/skill/deploy-check`): meta line → **frontmatter block** (`.md-code.md-frontmatter`,
  monospace, `--tk-text3`, the `---` fences drawn) → `h2.md-h2` "When to use" → `p.md-p` → `h2` "Steps" → `ol.md-list` → …
- App on the real adapter (`#/skill/deploy-check?__mock=raw-md` drives the real component): identical vocabulary and
  spacing for headings, paragraphs, ordered/unordered lists, task lists, quotes, tables, code — **but no frontmatter
  block**, because `parseSkillFrontmatter` (`src/lib/schema.ts:183`) returns `body: source.slice(match[0].length)` and
  throws the matched frontmatter text away, so `ls` rows carry `body` only and the adapter sets
  `skillMd:{frontmatter:'', …}` (`desktop/src/backend/tauri/index.ts:138` and the `inventoryDetail` mapping).
  `desktop/GAPS.md` records this as the still-absent frontmatter block (AD-22).

The visible delta is the frontmatter block. Everything else is already the mock's vocabulary (spec
`.planning/specs/2026-09-10-w05-skill-markdown.md`). This batch closes the delta and adds a measured parity gate so it
cannot silently reopen.

## 2. Decisions (locked — take them, do not ask)

- D1 **The CLI returns the raw frontmatter text.** `parseSkillFrontmatter` gains `frontmatter: string` in its ok
  result = `match[0]` with the trailing newline trimmed, i.e. the exact text from the opening `---` through the closing
  `---`, fences included, original key order and quoting preserved (this is the file's own text, not a re-serialisation).
  Nothing else in the parse result changes.
- D2 **Every read verb that returns a skill body also returns its frontmatter.** `ls` team rows (`src/commands/ls.ts`,
  the `skills.push({… body: record.body ?? null …})` builder) gain `frontmatter: string | null` beside `body`;
  `ls --local` rows and `notOffered` entries gain the same field when they carry `body`/`description` today (verify
  which local row shapes carry `body`; add `frontmatter` wherever `body` is). `src/lib/skills.ts:36` threads
  `parsed.frontmatter` into the skill record. Protocol: no verb or feature added; the field is additive on existing
  result shapes (docs/frame-protocol.md: mention the new field in the `ls` result description).
- D3 **The adapter maps it verbatim.** `cliLsSkill` / the local row schema gain `frontmatter: z.string().nullish()`;
  `skillMd.frontmatter` = `row.frontmatter ?? ''` everywhere the adapter builds `skillMd` (team detail, scoped/local
  detail, by-path detail). `SkillScreen.tsx:40` already renders `s.skillMd.frontmatter` inside
  `<div className="md-code md-frontmatter" data-testid="frontmatter">` when non-empty — do not change that markup.
- D4 **The mock is untouched.** It already serves the fixture frontmatter; the locked `SkillDetail*` boards do not move.
- D5 **Parity is measured, not asserted by eye.** Add `desktop/e2e/routes/markdown-parity.spec.ts`: render
  `#/skill/deploy-check?__mock=raw-md` and `#/skill/deploy-check` (mock blocks) at 1440×900, and for the shared
  constructs (frontmatter block, h2, p, ol/ul rows, code block) assert computed styles are equal between the two
  renders: font-size, font-weight, line-height, color, margin-top, and the gap of `.skill-md-blocks`. The raw-md
  fixture (`desktop/src/backend/mock/raw-md.ts`) must begin with a frontmatter block equal to the fixture's so the
  frontmatter case is exercised (extend `RAW_MD`; the mock's `raw-md` branch feeds `frontmatter` from the same text).
- D6 **Air above sections follows the mock.** If D5 finds a delta in `margin-top` of `h2.md-h2` after a paragraph or
  list (the mock draws 16px of air: `.md-h2{margin-top:6px}` inside the 10px column gap), fix the app to match the
  mock; never the reverse. Values come from the mock's CSS only.
- D7 Inline code, links, images, tables, quotes keep the W-05 values (recorded as a deliberate deviation in
  `desktop/FIDELITY.md`); this batch does not restyle them.

## 3. Changes by file

CLI
- `src/lib/schema.ts` — `parseSkillFrontmatter` ok-result gains `frontmatter`.
- `src/lib/skills.ts` — skill record gains `frontmatter: string`.
- `src/commands/ls.ts` — team rows and local rows/notOffered gain `frontmatter: string | null` (null only when the
  body is null too).
- `src/lib/local-skills.ts` — if `LocalEntry` carries the body text today, add `frontmatter` next to it; if it carries
  only `description`, add both `frontmatter` and the raw body is NOT added (out of scope) — record which in the report.
- `docs/frame-protocol.md` — one sentence on the additive `frontmatter` field.

Desktop
- `desktop/src/backend/tauri/index.ts` — schemas + every `skillMd` construction.
- `desktop/src/backend/mock/raw-md.ts` — `RAW_MD` begins with the frontmatter block; `mock/index.ts` raw-md branch
  sets `frontmatter` from it (split on the closing fence) and `markdown` to the rest.
- `desktop/e2e/routes/markdown-parity.spec.ts` — new (D5). Model it on `e2e/routes/markdown.spec.ts`.
- `desktop/src/screens/skill/skill.css` — only if D6 finds a delta.

## 4. Tests (add beside the code; never delete or weaken)

- `src/lib/__tests__/schema.test.ts` (or the existing frontmatter test file): frontmatter text is returned verbatim with
  fences, for LF and CRLF files, and is absent from `body`.
- `src/commands/__tests__/ls.test.ts`: a team row and a local row carry `frontmatter`; the JSON snapshot test added by
  w02-perf ("byte-identical output") must be re-recorded deliberately and the change named in the report.
- `desktop/src/backend/tauri/__tests__/index.test.ts`: `skill()` maps `frontmatter`; missing field → `''`.
- `desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx`: the frontmatter block renders with the file's
  text on the real adapter.
- `desktop/e2e/routes/markdown-parity.spec.ts` (D5).

## 5. Gates

Root: `npm run lint && npm run typecheck && npx vitest run --maxWorkers=2 && npm run build`.
Desktop: `npm run typecheck && npm run lint && npx vitest run --maxWorkers=2 && npm run build`; `e2e:routes` and
`e2e:fidelity` are the orchestrator's (fidelity: zero rows change — the mock is untouched).

## 6. Contracts

No verb, feature key or seam method is added. `FRAME_VERBS`/`FRAME_FEATURES`/`FEATURE_KEYS` untouched. No version
bump. Files never edited by the implementing agent: `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`,
`desktop/README.md`, `desktop/package.json`, `desktop/src/styles/tokens.css`, `src/fixtures/design.json`.

**For the orchestrator:** `desktop/GAPS.md` — close item (c) of the W-05 section ("the frontmatter block … is still
absent"): the real adapter now renders it from the file's own text. No FIDELITY row moves.

## 7. Open questions — defaults taken

| # | Fork | Default |
|---|---|---|
| Q1 | Fences drawn or stripped? | Drawn (the mock draws `---`). |
| Q2 | Re-serialise the YAML for tidiness? | Never — the file's text is the truth. |
| Q3 | Parity spec compares against the live mock HTML file? | No: against the app's own mock adapter render (same CSS, same components); the realistic-mock HTML is a design artefact outside the repo. |
