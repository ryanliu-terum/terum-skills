# SPEC — batch `w05-skill-markdown` (Bugs.pdf **W-05**: "Skill.md does not render pretty (on brand font and sections)")

**Base commit: `9fb73e9`** (`Merge pull request #131 from ryanliu-terum/feat/card-menu-actions`). Every file path,
line number and quoted snippet below was read out of the worktree at `9fb73e9`. If a line you open does not match a
quote here, STOP and re-read — do not guess.

> This spec is the whole brief. There is no conversation behind it. Everything you need — evidence, exact strings,
> exact CSS, exact test titles — is written out below.

---

## 0. Summary (5 lines)

1. On the **real** adapter the SKILL.md tab renders the CLI's markdown through a bare `<ReactMarkdown>` with no
   `components` map and no stylesheet, so Tailwind's preflight defines the whole look: 16px body, headings flattened
   to body text, list markers and indent gone, code in the wrong font, `strong` at 700.
2. This batch adds `desktop/src/screens/skill/SkillMarkdown.tsx` — one component, a module-level components map — and a
   `.md-doc`-scoped block appended to `desktop/src/screens/skill/skill.css` that **re-uses the design's own
   `.md-h2 / .md-p / .md-list / .md-code` rules verbatim** and derives everything the boards never drew from the same tokens.
3. It also repairs `stripLeadingSkillHeading`, whose `^#\s+` anchor never fires because the CLI's body starts with a
   newline, and makes markdown links and images inert (no webview navigation, no remote image fetch).
4. For whom: Teddy on Windows and every teammate on a configured team — the mock/browser build is untouched, by
   construction, so all 19 locked `SkillDetail*` boards are pixel-neutral.
5. Why now: it is the surface a user reads first, it is the only screen in the app with no styling at all, and the
   monospace half of it is genuinely off-brand on every platform.

---

## Repo facts (verbatim from the shared brief — read before touching anything)

- Root: CLI package `terum-skills` (TS, ESM, Node 22+, commander, zod, yaml, proper-lockfile 4.1.2). Build:
  `npm run build` = `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs` → `dist/` (68 unbundled files today).
  Tests: vitest, collocated `src/**/__tests__/`, bare-repo fixtures, no network. Gates: `npm run lint && npm run typecheck && npm test`.
- Desktop: `desktop/` Vite 8 + React 19 + TS strict + Tauri 2.11. Code style is deliberately dense (single-line
  components, no blank lines inside components) — match the surrounding style. Mock backend `desktop/src/backend/mock/`,
  real adapter `desktop/src/backend/tauri/` (`index.ts` ≈ 700 long lines, `bridge.ts`, `frames.ts`, `run.ts`,
  `prepare-run.ts`, `cache.ts`?). Gates: `cd desktop && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e:routes`.
  `e2e:fidelity` needs the design canvas (`TERUM_DESIGN_DIR`) which Codex does not have — it skips; the orchestrator runs it.
- Rust shell `desktop/src-tauri/src/lib.rs` spawns `node <entry> --frames <verb…>` per call (8-child cap, CREATE_NO_WINDOW on
  Windows, tracked children killed on window destroy). Codex cannot run cargo; the orchestrator runs
  `cargo check` for aarch64-apple-darwin / x86_64-pc-windows-msvc / aarch64-pc-windows-msvc.
- Frame protocol: `src/lib/frames.ts` (FRAME_VERBS, FRAME_FEATURES, hello frame), `docs/frame-protocol.md`.
  Frames: hello | print | ask | progress | result (down), answer | cancel (up). `ProgressFrame { t:'progress'; step:string; current?:number; total?:number }`
  is declared but NO verb emits it yet (FRAME_FEATURES.progress=false). Desktop `Frame` type for progress is `{t:'progress';done:number;total:number;label?:string}` — check `desktop/src/backend/tauri/frames.ts` for the translation before assuming.
- Prompter (`src/lib/prompt.ts`): `interactive`, `channel?: 'terminal'|'frames'`, `confirm`, `text`, `select`, `print`. Exactly five members.
- Config lives in `~/.terum/skills/` (`config.json`, `run/app.json`, `run/terum.stamp`, teams clones under `teams/<team>/`).
- Node_modules are pre-populated in the worktree (root and desktop). `esbuild@0.28.2` is ALSO present in root
  `node_modules` (installed without saving) so a spec may add it to root `devDependencies` — the orchestrator syncs the lockfile afterwards. NOTHING else can be installed.
- **Codex constraints (restated, binding):** no git commands at all; do not commit/stage; do not run `npm install`/`npm ci`;
  never edit `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`,
  `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json` (generated), anything under `.shots`; root `package.json`
  may be edited ONLY where the spec lists the exact edit. **This spec lists no root `package.json` edit — do not touch it.**
  Report gates honestly: real counts, and say plainly what you could not run.

### Governing rules this batch is bound by

- Root `CLAUDE.md`: correctness = spec + North Star, never cheapness; no attacker model (hostile-caller findings out of
  scope); **grep for existing code before writing new**; one active path per behaviour.
- `desktop/AGENTS.md` invariant **1 (the seam)** — nothing outside `src/backend/` touches Tauri/I-O; screens never branch
  on platform. This batch adds no `@tauri-apps` import and no platform probe.
- `desktop/AGENTS.md` invariant **3 (generated files)** — `src/styles/tokens.css` and `src/fixtures/design.json` are not edited.
- `desktop/AGENTS.md` invariant **4 (the fidelity oracle is read-only, tolerances fixed)** — no tolerance, mask or
  snapshot change.
- `desktop/AGENTS.md` invariant **5 (pixels from the boards)** — see §3 D1/D2 and §13: the h2/p/ol/code vocabulary is the
  board's own rule, reused literally; every construct the canvas never drew is derived from `--text-*`, the
  400/500/510/590 weight ramp and `--tk-*`, and every one of those is recorded as a fork in §13.
- `desktop/AGENTS.md` invariant **7 (no shortcuts in tests or lint)**, quoted at `desktop/AGENTS.md:63-69`:
  > "Never delete or weaken a test to make a suite pass … No `eslint-disable` without a reason on the same line. No
  > test-only branches in components: every board state is reachable from the URL (`?tab=`, `?dialog=`, `?rail=closed`,
  > `?theme=`, `?menu=`, `?filters=open`, `?q=`, `?overview=0`) and the mock scenario switch `?__mock=`
  > (`error | empty | loading | slow | disabled | not-installed`)."
  The `raw-md` scenario added here is a **backend** branch reached from the URL, exactly like the eight scenarios already
  in `desktop/src/backend/mock/scenario.ts:2` beyond that list. **No component in this batch branches on a test flag.**
- `desktop/AGENTS.md` invariant **8** — "Ambiguity → implement the most conservative reading and record the fork in
  `openQuestions`; never resolve a design fork yourself." §13 records all thirteen forks.
- Teddy, 2026-09-09: the real adapter serves ONLY real data — no fixture literals, no plausible constants, honest absent
  state. This batch changes only how the CLI's own bytes are drawn; it invents no content.
- `desktop/GAPS.md` and `desktop/FIDELITY.md` are maintainer-owned. **Codex never edits them.** §10 tells the
  orchestrator what to write there.

---

## 1. Bugs / asks closed

| id | Reporter's words | User-visible symptom |
|---|---|---|
| **W-05** (Bugs.pdf p.3) | "Skill.md does not render pretty (on brand font and sections)" | On a configured team, opening a skill's SKILL.md tab shows an unstyled wall of text: paragraphs at ~16px instead of 13px, `## Principle 0 — Plain English, always, first` and `## Entry — where the decision list comes from` rendered at the **same size and weight as body text** (no sections at all), numbered steps with **no numbers and no indent**, `---` as a bright near-white full-width rule, `**bold**` heavier than anything else in the app, and code in Consolas rather than JetBrains Mono. |

Two latent defects on the same code path are closed with it, because the fix removes them for free (they are not new
features and they add no product surface):

- **W-05a** A markdown link in a SKILL.md today is a live `<a href>` with **no click handler**, so clicking it
  navigates the whole webview away from the SPA — inside a decorated Tauri window with no browser chrome and no back
  button. There is no recovery except relaunching the app.
- **W-05b** A markdown image today emits a real `<img src="https://…">` *and* a React 19
  `<link rel="preload" as="image">`. With `"csp": null` (`desktop/src-tauri/tauri.conf.json:33`) WebView2 fetches it, so
  anyone who can merge a SKILL.md into the team repo learns the IP, timestamp and skill of every teammate who opens the tab.

**Explicitly NOT claimed and NOT fixed:** there is **no Windows-only Inter bug**. Inter Variable loads and is used for
all sans text on Windows exactly as on Mac (13 bundled `@font-face` rules, `format("woff2-variations")`, served
same-origin from `http://tauri.localhost/assets/`). The "brand font" half of the report is *size, weight and leading*
for sans, and a **real** font defect for mono only. Do not add a font, a `@font-face`, or a fallback chain.

---

## 2. Root cause — the evidence, copied in

### 2.1 The CLI hands the app raw post-frontmatter markdown that **begins with a newline**

`src/lib/schema.ts:172` at 9fb73e9:

```ts
export const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
```

`src/lib/schema.ts:183`:

```ts
  return { ok: true, data: parsed.data, grants: allowedTools(parsed.data['allowed-tools']), body: source.slice(match[0].length) };
```

`(?:\r?\n|$)` consumes **exactly one** newline after the closing `---`. A conventionally formatted SKILL.md has a blank
line there, so `body` starts at that blank line — i.e. `body[0] === '\n'`. `src/commands/ls.ts:22` declares
`body: string | null` on `LsSkill`; `:83` fills it from the parsed record. Measured over the five skills in
`ryanliu-terum/terum-shared-skills`: **5/5 bodies start with `\n`**. Measured over the 45 local `~/.claude/skills/*/SKILL.md`:
**44/45**.

### 2.2 The real adapter passes it straight through

`desktop/src/backend/tauri/index.ts:200` (team detail):

```ts
    skillMd: { frontmatter: '', body: [], markdown: row.body ?? null },
```

`desktop/src/backend/tauri/index.ts:122` (a local-only folder) sets `markdown:null`. The **mock** never sets `markdown`
at all — `desktop/src/backend/mock/data.ts:17` returns `{...d,...s,…}` where `d` carries `skillMd:{frontmatter,body}`
from the fixture, and `grep -rn "markdown" desktop/src/backend/mock/` returns **zero hits**. So the mock and the real
adapter take **disjoint** branches at the render site. That is the whole reason this fix is pixel-neutral on the boards.

### 2.3 The defect: a bare `<ReactMarkdown>` with no `components` and no CSS

`desktop/src/screens/skill/SkillScreen.tsx:41`, the exact substring (verified unique in the file):

```tsx
{s.skillMd.markdown!==undefined&&s.skillMd.markdown!==null?<ReactMarkdown remarkPlugins={[remarkGfm]}>{stripLeadingSkillHeading(s.skillMd.markdown,s.name)}</ReactMarkdown>:null}
```

react-markdown puts **no class on any element**. The mock branch immediately after it, in the same line, does the
opposite — `{s.skillMd.body.map((block,i)=>block.kind==='ol'?<div key={i} className="md-list">…:<div key={i} className={'md-'+block.kind}>…)}`.
Every drawn style in this tab is class-driven, and none of those classes ever reaches the markdown output.

### 2.4 Tailwind preflight therefore defines the entire look

From `desktop/node_modules/tailwindcss/preflight.css` in this worktree (line numbers exact at 9fb73e9):

```css
/* :7-16 */   *, ::after, ::before, ::backdrop, ::file-selector-button {
                box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
/* :59-63 */  hr { height: 0; color: inherit; border-top-width: 1px; }
/* :78-86 */  h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
/* :102-105 */ b, strong { font-weight: bolder; }
/* :114-132 */ code, kbd, samp, pre {
                font-family: --theme(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo,
                  Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
                font-size: 1em; }
/* :202-206 */ ol, ul, menu { list-style: none; }
```

### 2.5 Nothing supplies a base `font-size`, so `inherit` resolves to the initial `medium` = 16px

`desktop/src/styles/app.css:46-47,55`:

```css
html, body, #root { height: 100%; }
body { margin: 0; background: var(--tk-chrome); color: var(--tk-text1); font-family: var(--font-sans); font-feature-settings: "cv01", "ss03"; -webkit-font-smoothing: antialiased; }
…
body { line-height: normal; }
```

No `font-size`. `grep font-size desktop/src/styles/tokens.css` → 0 hits. The only bare element selector in the app's
own CSS is `a { … }` at `desktop/src/styles/app.css:50`. Measured in a real Chromium against the shipped bundle, the
whole ancestor chain reports 16px: `.skill-md-blocks / .skill-md-tab / .detail-main / .detail-body / .panel /
.shell-row / .shell / #root / body / html`.

### 2.6 `@theme{--*: initial}` is why code lands on Consolas

`desktop/src/styles/app.css:5-9`:

```css
@theme {
  --*: initial;
  --spacing: 4px;
  --font-sans: "Inter Variable", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace;
```

Wiping the default theme clears Tailwind's `--default-mono-font-family`, so preflight's `--theme(…)` falls through to
the literal system chain at preflight `:120-127`. Chromium implements `ui-monospace` only on macOS, so **Windows lands
on Consolas and macOS on SF Mono — and neither gets JetBrains Mono Variable**, which every other mono surface in the
app uses. Measured in the same page: `document.fonts.check('400 12px "JetBrains Mono Variable"') === true` (the face
*is* loaded) while markdown `pre` computes to the `ui-monospace, …` chain and the mock's `.md-code` in the same document
computes to `JetBrains Mono Variable`.

### 2.7 What the drawn tab actually is (the target numbers)

From `desktop/src/screens/skill/skill.css` (one minified line, line 1), quoted verbatim:

```css
.skill-md-tab{display:flex;flex-direction:column;gap:10px;flex-grow:1;min-height:0;max-width:760px;padding-top:12px;overflow:hidden}
.skill-md-blocks{display:flex;flex-direction:column;gap:10px;flex-grow:1;min-height:0;overflow:hidden}
.skill-md-blocks>*{flex-shrink:0}
.md-h2{font-size:14px;font-weight:590;line-height:20px;color:var(--tk-text1);margin-top:6px}
.md-p,.md-list{font-size:13px;line-height:20px;color:var(--tk-text2);max-width:760px;text-wrap:pretty}
.md-list{display:flex;flex-direction:column;gap:2px}
.md-list>div{display:flex;gap:10px}
.md-list>div>span:first-child{width:16px;text-align:right;color:var(--tk-text3);flex-shrink:0;font-variant-numeric:tabular-nums}
.md-code{padding:8px 12px;border-radius:6px;background:var(--tk-bg2);border:1px solid var(--tk-border1);font-family:var(--font-mono);font-size:12px;line-height:18px;color:var(--tk-text2);white-space:pre-wrap;overflow-wrap:anywhere;max-width:760px;box-sizing:border-box}
.md-frontmatter{color:var(--tk-text3)}
```

Real path (measured, real Chromium) vs. these:

| construct | real path today | drawn | delta |
|---|---|---|---|
| `p` | 16px / 400 / `line-height:normal` / `--tk-text1` | 13 / 400 / 20px / `--tk-text2` | +23 % size, wrong colour, wrong leading |
| `h2` | 16 / 400 / normal / margin 0 | 14 / **590** / 20 / `margin-top:6px` | **no hierarchy, no section air** — the report |
| `h1`,`h3`–`h6` | identical to `p` | never drawn | no hierarchy at all |
| `ol`/`ul` | `list-style-type:none`, `padding-left:0` | 16px right-aligned tabular marker column, 10px gutter | **numbers and indent gone** |
| `pre`/`code` | 16px, `ui-monospace…Consolas`, no chrome | 12/18, `var(--font-mono)`, bg2, 1px border1, 6px radius | wrong face, wrong size, no block affordance |
| `hr` | 1px `currentColor` (= `--tk-text1`, near-white) full width, no margin | never drawn | the one thing that looks styled, and it looks wrong |
| `strong` | 700 | ramp tops out at 590 | off the type ramp |
| `table` | `border:0`, no cell padding, overflows past 760px | never drawn | run-together text, horizontal overflow |
| `a` | live `<a>`, `app.css:50` colour, **no click handler** | — | W-05a |
| `img` | real `<img>` + React 19 `<link rel=preload as=image>` | — | W-05b |

### 2.8 `stripLeadingSkillHeading` is dead code on real data

`desktop/src/screens/skill/skill-markdown.ts` in full at 9fb73e9:

```ts
/** The page already names the skill; remove only a matching opening Markdown H1. */
export function stripLeadingSkillHeading(markdown: string, name: string): string {
  const heading = /^#\s+([^\n]*?)\s*\n/.exec(markdown);
  return heading?.[1] === name ? markdown.slice(heading[0].length) : markdown;
}
```

`^#` cannot match a body that starts with `\n` (§2.1), so on real data the function is a no-op. The suite never caught
it because the replay recording it is exercised against does not have the leading newline — verified:
`.planning/codex-runs/mock-vs-real-2026-09-09/frames/ls.jsonl`, `value.skills[0].body` is
`"# deploy-check\n\nUse this skill when a deploy needs a pre-flight checklist.\n\n1. Step one.\n2. Step two.\n"`.
The sibling function written for the **same wire string** already gets this right —
`desktop/src/lib/body-excerpt.ts:22-29`:

```ts
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;
  // A leading H1 is the skill's title, not its summary.
  if (start < lines.length && /^#\s/.test(lines[start]!.trim())) {
```

and `desktop/src/lib/body-excerpt.test.ts:11` uses `'\n\n# deploy-check\n\nChecks the deploy pipeline…'`. Both are
called from the same real adapter on the same string (`desktop/src/backend/tauri/index.ts:196`,
`desc_long: bodyExcerpt(row.body) ?? row.description`). So today the card excerpt drops the leading H1 and the rendered
document does not — the two disagree on identical input.

### 2.9 The consequence is currently latent, and the spec says so

Measured over the 45 local skills: only **1/45** opens with `# <exact folder name>`; **0/5** of the team repo's skills
do; 33/45 open with an H1 that is a real document title (`# Test-Driven Development`) which
`stripLeadingSkillHeading` must **never** strip. So today's page already renders **two `<h1>`s** on most real files —
the page title plus the document title — and the regex repair fixes only ~2 % of them. **The load-bearing part of the
one-`<h1>` invariant is the `h1 → <h2 class="md-h1">` mapping in the components map, not the regex.** The regex is
still repaired here because it is cheap, correct, and its twin already behaves correctly on the same input.

### 2.10 Correction to the brief

The batch brief says *"links: http(s) open through `backend.openUrl` (existing pattern), everything else inert text"*.
**The code at 9fb73e9 refutes that as written**, and the code wins: `desktop/src-tauri/capabilities/default.json`
scopes `opener:allow-open-url` to exactly two hosts:

```json
    {
      "identifier": "opener:allow-open-url",
      "allow": [
        { "url": "https://github.com/*" },
        { "url": "https://discord.gg/*" }
      ]
    },
```

An arbitrary `https://` link from a SKILL.md is **rejected by Tauri's own permission scope** at runtime, so "http(s)
open through `backend.openUrl`" would ship a control that silently fails for almost every link. Widening the scope is a
capability-widening product decision, not a rendering detail. See §3 D6 for the closed fork.

---

## 3. Decisions taken — every fork closed

**DECISION D1 — Reuse the design's literal `.md-h2 / .md-p / .md-list / .md-code` classes rather than re-deriving
similar numbers.** Why: `desktop/AGENTS.md` invariant 5 ("pixels come from the boards") plus Teddy 2026-09-09 ("the
real adapter's interaction and fidelity must be identical to the mock"). Reusing the same *rule* makes the two paths
identical by construction instead of by coincidence; a measured control confirms the real path's `h2` is numerically
identical to the mock's. **Do not redefine `.md-h2`, `.md-p`, `.md-list` or `.md-code`.**

**DECISION D2 — Scope every new rule under a new `.md-doc` wrapper the mock never renders.** Why: the mock never sets
`skillMd.markdown` (§2.2), so `.md-doc` is unreachable on every board. This is what makes all 19 locked `SkillDetail*`
rows in `desktop/FIDELITY.md:19-37` pixel-neutral. The alternative — putting `font-size:13px` on `.skill-md-blocks` —
touches an element that **eleven** locked boards render (SkillDetail :19, SkillDetailLight :20, SkillDetailUsesHover :22,
SkillDetailFiles :27, SkillDetailDisabled :30, SkillDetailNotInstalled :31, SkillDetailInstall :32,
SkillDetailInstallLight :33, SkillDetailRemove :34, SkillDetailLoading :36, SkillDetailError :37, since SKILL.md is the
default tab) and is rejected on that ground.

**DECISION D3 — A `components` map, not element selectors alone.** A CSS-only variant (bare `h2{…}` scoped under
`.skill-md-blocks`) was built and measured and *does* fix the reported typography. It is rejected because it cannot
reach four things: the live `<a>` (W-05a), the `<img>` beacon (W-05b), the single-`<h1>` invariant, and the table
overflow wrapper — and because it cannot give the real path the mock's 16px right-aligned tabular marker column, only
the browser's native marker. Honest sizing note for the PR body: **roughly 70 % of this diff buys security and
mock-parity, not the reported symptom.**

**DECISION D4 — Shift `h1` only (`h1 → <h2 class="md-h1">`), not every level.** Why: real SKILL.md files are
overwhelmingly `##`-first (479 `h2` vs 56 `h1` across the 45-file corpus). Shifting every level would push the common
case to `h3` and skip a level under the page's `<h1>`. Shifting `h1` alone gives the correct outline for the common
case *and* guarantees the page keeps exactly one `<h1>` (pinned by
`desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx:31`). The **class** still names the authored level,
so the look follows the document while the tag keeps the outline honest.

**DECISION D5 — Images render as an inert text chip; never emit `<img>`.** Why: W-05b, and the 45-file corpus contains
**zero** images, so nothing real is lost. Loading only relative images is not an option either: the document is served
from `http://tauri.localhost/`, not the skill folder, so a relative path cannot resolve.
Do **not** add a native `title=` attribute to the chip: it is invisible to keyboard and touch, unstyled by the design
system, and would be app-authored user-facing copy without sign-off. The chip's own text carries the meaning.

**DECISION D6 — Markdown links render inert: the label as text, the destination beside it in muted mono; no `<a>`.**
Why, in order of force: (a) `opener:allow-open-url` is scoped to `https://github.com/*` and `https://discord.gg/*`
(§2.10), so a clickable link would fail for almost every href; (b) a markdown `<a>` today has no click handler and
navigating the webview is unrecoverable (W-05a); (c) grep confirms there is **no navigation interceptor** anywhere —
`desktop/src-tauri/src/lib.rs` registers only `tauri_plugin_opener::init()`.
**Honesty note the implementer must not garble:** R14 in `.planning/decisions/2026-09-06-phase1-rulings-decision-walk.md:40`
—
> "| R14 | Repo text rendering as a Markdown link | LOCK | No: escape the link brackets as the last step of both
> sanitizers, so no cell, heading, roster line or PR comment can render a link whose label lies; normal text is
> pixel-identical and a bare URL still auto-links | — |"
— is a LOCK on the CLI's two **sanitizers**, for repo text the tool *injects* into a document it authors (the generated
README, the Action's PR comment). A SKILL.md body is the author's own document. R14 is an **analogy** here, not binding
precedent; the binding reasons are (a) and (b). Recorded as fork §13-Q2 for Teddy.

**DECISION D7 — An in-document anchor (`href` starting with `#`) renders as plain label text with no destination
chip.** Why: a fragment is meaningless to a reader who cannot click it, and remark-gfm's own footnote plumbing emits
`#user-content-fn-1` / `#user-content-fnref-1` hrefs — without this rule every footnote would drag a URL chip through
the prose. Verified: with this rule a footnote renders as `Text with a footnote1.` and the backref as `↩`.

**DECISION D8 — Forward the incoming `className` on every heading override, and add a `.md-doc .sr-only` rule.** Why:
remark-gfm emits `<section class="footnotes"><h2 class="sr-only">Footnotes</h2>…`. Discarding `className` would drop
`sr-only` and print a stray visible "Footnotes" heading. `sr-only` is a Tailwind utility that is **not** in the bundle
(Tailwind only emits utilities it sees in source; `grep -rn "sr-only" desktop/src/` → 0 hits), so forwarding the class
is not enough on its own — the rule has to exist. Corpus has 0 footnotes today, so this is latent-correctness, and it
costs six declarations.

**DECISION D9 — Inline `code` gets the mono face, size and `--tk-text1`; NO background chip.** Why: the app's own
inline mono treatment is `.board-mono{font-family:var(--font-mono);min-width:0}`
(`desktop/src/components/domain/Primitives.css:1`) — font family only. Inline code is the single most common construct
in the corpus (5,551 occurrences across the 45 local SKILL.md files, measured at 9fb73e9); a bordered chip on every one of them would be visually loud, would invent a design
value no board drew, and produces a visible gap before a following period. Following the app's existing precedent
invents strictly less.

**DECISION D10 — `stripLeadingSkillHeading` becomes
`/^(?:\r?\n)* {0,3}#[ \t]+([^\n]*?)\s*\n/`.** Three deliberate parts, each with a reason:
- `(?:\r?\n)*` — skip leading blank lines, which is what §2.1 requires and what the twin `bodyExcerpt` already does.
- ` {0,3}` — **spaces only, never a tab.** CommonMark allows up to three spaces of indent before an ATX heading; a tab
  advances to column 4, which makes the line an *indented code block*. `[ \t]{0,3}` would strip a code block —
  data loss on a real-data-only surface. Verified: `'\t# deploy-check\nBody'` must NOT strip.
- `#[ \t]+` instead of `#\s+` — `\s` matched a newline, so `'#\ndeploy-check\n'` was previously read as the heading
  `deploy-check`. `[ \t]+` refuses it, which is CommonMark-correct. **This is a deliberate behaviour change; it is
  pinned by a new test row so it cannot be mistaken for a regression.**
- `\s*\n` is kept exactly as today, because existing row `['# deploy-check\n\nBody','Body']`
  (`skill-markdown.test.ts:5`) requires the blank line after the heading to be consumed too.
All 7 existing `it.each` rows and both assertions in the existing `it` still pass unchanged (verified by running the
new regex against every one of them). Matching stays **exact-name**; a normalised compare would start hiding real
document titles, and `skill-markdown.test.ts:8,17` pins the strictness deliberately.

**DECISION D11 — A heading at end-of-file with no trailing newline is NOT stripped.** `'# deploy-check'` (no `\n`)
keeps its heading. This is today's behaviour, kept unchanged and now pinned by a test, because a body always ends with
a newline in practice and loosening the anchor buys nothing.

**DECISION D12 — Add a test-only mock scenario `raw-md` (`?__mock=raw-md`).** Why: `desktop/vitest.config.ts` sets
`css:false`, so **vitest can never assert a computed style** — and a computed style is exactly where this bug lived.
Playwright can, but only against the mock backend, so the real component needs a URL-reachable route. Precedent: eight
scenarios already exist in `desktop/src/backend/mock/scenario.ts:2` beyond the six named in AGENTS invariant 7,
including `invalid-newest` and `version-mismatch`, which no board draws (`desktop/e2e/fidelity/boards.ts` uses only
`disabled | not-installed | loading | error | empty`). **No fidelity board may ever use `raw-md`** — §10 says so and
§12's PR body repeats it.

**DECISION D13 — Do NOT change the `read from …` meta line, even though `raw-md` flips it.**
`desktop/src/screens/skill/SkillScreen.tsx:41` uses `s.skillMd.markdown!==undefined` as a real-vs-mock discriminator:

```tsx
… · read from {s.skillMd.markdown!==undefined?(s.installed==='placed'?s.pathLabel:`the team repo clone · ${s.repo??'—'}`):s.installed==='placed'?`~/.claude/skills/${s.name}`:`the team repo clone · ${s.repo??'—'}`}
```

Because `desktop/src/backend/mock/data.ts:17` sets `pathLabel:d.path` and `design.DETAIL.path` is
`"skills/deploy-check"`, setting `markdown` under `raw-md` makes that line read **`read from skills/deploy-check`**
instead of `read from ~/.claude/skills/deploy-check`. That is correct and harmless on a route no board draws.
Making the expression read `pathLabel` unconditionally would change the text on three locked boards, so it is refused
here. `desktop/src/screens/skill/SkillScreen.tsx:58` (`dialogCopy`, merged in #131) is a second consumer of the same
discriminator and is likewise left alone. **The Playwright spec must not assert the meta line.** Recorded as fork §13-Q3.

**DECISION D14 — This batch adds no I/O, no seam method, no child process and no CLI change.** Consequently *cancel,
timeout, EACCES, "missing tool" and lockfile* failure modes do not arise on this path; §7.5 enumerates the failure
modes that *do* exist and tests every one of them. Do not invent an abort controller, a retry, or a timeout.

---

## 4. Changes per file

Nine files: 3 new, 6 edited. Nothing else.

### 4.1 NEW — `desktop/src/screens/skill/SkillMarkdown.tsx` (full contents, 45 lines)

Constraints this file must satisfy, all verified against the worktree:
- `desktop/tsconfig.json:3-7` — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`. `verbatimModuleSyntax` requires `import type` for type-only imports;
  `exactOptionalPropertyTypes` requires the conditional-spread form for the optional `start`/`style` props.
- `desktop/eslint.config.js:16` — `react-refresh/only-export-components` with `allowConstantExport:true`. The module
  therefore exports **exactly one component and nothing else**; `MARKDOWN` stays module-private.
- `desktop/eslint.config.js:18` — screens may import neither `**/backend/mock/**`, `**/backend/tauri/**`,
  `**/fixtures/**` nor `@tauri-apps/*`. This file imports only `react`, `react-markdown`, `remark-gfm`.
- `MARKDOWN` **must** be a module-level constant, never an object literal created inside the component: react-markdown
  derives element types from it, so a fresh object each render remounts the entire subtree. §7.1 test 25 pins this.
- react-markdown is `10.1.0` and remark-gfm `4.0.1` (`desktop/package.json:38,40`). `react-markdown@10.1.0`'s
  `index.d.ts` exports `Markdown as default` plus the `Components` type
  (`{ [Key in keyof JSX.IntrinsicElements]?: ComponentType<JSX.IntrinsicElements[Key] & ExtraProps> | keyof JSX.IntrinsicElements }`,
  `node_modules/react-markdown/lib/index.d.ts:68`), so `import ReactMarkdown, { type Components } from 'react-markdown'`
  is correct. `defaultUrlTransform` runs over `html-url-attributes`' `urlAttributes`, whose `src` list **does** include
  `img` — so `javascript:`, `data:`, `file:` and `vbscript:` are already neutralised to `''` for both `href` and `src`;
  the map relies on that and a test pins it.

```tsx
import type { ReactNode } from 'react';
import { Children, Fragment } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** The plain text of a node's children, used only to tell `[https://x](https://x)` from a labelled link. */
function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => (typeof child === 'string' ? child : '')).join('').trim();
}
/** Heading overrides forward the incoming class (remark-gfm's footnote header carries `sr-only`). */
function heading(Tag: 'h2'|'h3'|'h4'|'h5'|'h6', own: string) {
  return function Heading({children, className}: {children?: ReactNode; className?: string}) {
    return <Tag className={className ? own + ' ' + className : own}>{children}</Tag>;
  };
}

/**
 * Markdown → the SKILL.md tab's drawn vocabulary. `h2`, `p`, ordered/unordered lists and fenced code re-use the
 * board classes verbatim (`.md-h2`, `.md-p`, `.md-list`, `.md-code`); everything the canvas never drew is derived
 * from the same tokens in skill.css. A document H1 becomes `<h2 class="md-h1">` so the page keeps exactly one
 * <h1> (the skill name); the *class* still names the authored level, so the look follows the document.
 * Links and images are inert on purpose: `opener:allow-open-url` is scoped to github.com/discord.gg
 * (src-tauri/capabilities/default.json), a markdown <a> has no click handler and would navigate the whole webview
 * away, and a remote <img> in team-repo text is a tracking beacon under `csp: null`.
 * Sibling: `src/lib/body-excerpt.ts` drops *any* leading H1 for the card excerpt; `./skill-markdown.ts` drops only
 * the name-matching one for this document. Keep the two in step.
 */
const MARKDOWN: Components = {
  h1: heading('h2','md-h1'), h2: heading('h2','md-h2'), h3: heading('h3','md-h3'),
  h4: heading('h4','md-h4'), h5: heading('h5','md-h5'), h6: heading('h6','md-h6'),
  p: ({children}) => <p className="md-p">{children}</p>,
  hr: () => <hr className="md-hr"/>,
  blockquote: ({children}) => <blockquote className="md-quote">{children}</blockquote>,
  // `start` carries a list that does not begin at 1 (`3. …`); the CSS counter has to be seeded to match.
  ol: ({children, start}) => <ol className="md-list" {...(typeof start === 'number' && start !== 1 ? {start, style: {counterReset: `md-item ${start - 1}`}} : {})}>{children}</ol>,
  ul: ({children}) => <ul className="md-list">{children}</ul>,
  // The body wrapper keeps a nested list out of the flex row that carries the marker.
  li: ({children, className}) => <li {...(className ? {className} : {})}><div className="md-li-body">{children}</div></li>,
  pre: ({children}) => <pre className="md-code">{children}</pre>,
  table: ({children}) => <div className="md-table-wrap"><table className="md-table">{children}</table></div>,
  a: ({children, href}) => {
    const url = typeof href === 'string' ? href.trim() : '';
    // '' is a destination react-markdown already neutralised (javascript:, data:, file:, vbscript:);
    // '#…' is an in-document anchor, including remark-gfm's own footnote plumbing.
    if (url === '' || url.startsWith('#')) return <Fragment>{children}</Fragment>;
    return textOf(children) === url
      ? <span className="md-url">{url}</span>
      : <span className="md-link">{children} <span className="md-url">{url}</span></span>;
  },
  img: ({src, alt}) => <span className="md-img">{alt ? `image · ${alt}` : 'image'}<span className="md-url">{typeof src === 'string' ? src : ''}</span></span>,
};

export function SkillMarkdown({markdown}: {markdown: string}) {
  return <div className="md-doc"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>{markdown}</ReactMarkdown></div>;
}
```

**Deliberately NOT overridden** (react-markdown's default is already right, and the CSS in §4.4 styles them):
`strong`, `em`, `del`, `code`, `input` (the GFM task checkbox), `br`, `sup`, `section`, and
`thead`/`tbody`/`tr`/`th`/`td` — GFM column alignment arrives as an inline `style` on `th`/`td` and **must survive**,
so overriding them would silently drop alignment. Raw HTML is escaped to text by react-markdown (no `rehype-raw`),
which is exactly what the `<slug>` / `<repo>` / `<path>` placeholders in real SKILL.md prose need (7 of them sit outside any code span in the 45-file corpus, and would render as markup without the escaping; the triage's larger count of 241 included the ones already inside inline code, where they are literal either way). Do **not** add
`rehype-raw` or `rehype-sanitize`: `rehype-raw` would start *executing* those placeholders as markup, and both would
break the stack pins.

### 4.2 EDIT — `desktop/src/screens/skill/SkillScreen.tsx` (3 edits, all local; C5)

**(a) Line 24-25, current:**

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
```

**Replace those two lines with the single line:**

```tsx
import { SkillMarkdown } from './SkillMarkdown';
```

(`react-markdown` is imported in exactly one file in the whole desktop app — verified — and both symbols are used
exactly once each, at line 41, so nothing else breaks.)

**(b) Inside line 41 (`function SkillMd`), exact string replacement.** Find (verified unique in the file):

```tsx
{s.skillMd.markdown!==undefined&&s.skillMd.markdown!==null?<ReactMarkdown remarkPlugins={[remarkGfm]}>{stripLeadingSkillHeading(s.skillMd.markdown,s.name)}</ReactMarkdown>:null}
```

Replace with:

```tsx
{s.skillMd.markdown!==undefined&&s.skillMd.markdown!==null?<SkillMarkdown markdown={stripLeadingSkillHeading(s.skillMd.markdown,s.name)}/>:null}
```

**(c) Nothing else in this file changes.** Not the meta line (D13), not the `.md-frontmatter` branch, not the mock
`body.map`, not `dialogCopy` at :53-59, not the import at :2 (`stripLeadingSkillHeading` stays here). **Do not reformat
this file** — it is deliberately dense and four other batches edit it in the same window (C5).

### 4.3 EDIT — `desktop/src/screens/skill/skill-markdown.ts` (full new contents, 8 lines)

```ts
/**
 * The page already names the skill; remove only a matching opening Markdown H1.
 * The CLI's body starts at the newline after the closing `---` (src/lib/schema.ts:172,183), so leading blank
 * lines come first. Up to three *spaces* of indent is still an ATX heading; a tab reaches column 4 and makes the
 * line an indented code block, which must not be stripped. Sibling: `src/lib/body-excerpt.ts:22-29` drops *any*
 * leading H1 for the card excerpt; this one drops only the name-matching heading for the rendered document.
 */
export function stripLeadingSkillHeading(markdown: string, name: string): string {
  const heading = /^(?:\r?\n)* {0,3}#[ \t]+([^\n]*?)\s*\n/.exec(markdown);
  return heading?.[1] === name ? markdown.slice(heading[0].length) : markdown;
}
```

### 4.4 EDIT — `desktop/src/screens/skill/skill.css`

The file is 8 lines (7 content lines, ~8331 bytes, mostly one minified line 1) and ends with a newline.

**(a) Two exact string replacements inside line 1.** Both find-strings were verified to occur **exactly once** in the
file. Do not reformat, do not re-minify, do not reorder anything else on that line.

| # | find (exact) | replace with (exact) |
|---|---|---|
| 1 | `.md-list>div{display:flex;gap:10px}` | `.md-list>div,.md-list>li{display:flex;gap:10px}` |
| 2 | `.md-list>div>span:first-child{width:16px;text-align:right;color:var(--tk-text3);flex-shrink:0;font-variant-numeric:tabular-nums}` | `.md-list>div>span:first-child,.md-list>li::before{width:16px;text-align:right;color:var(--tk-text3);flex-shrink:0;font-variant-numeric:tabular-nums}` |

Both added arms are inert on every board: the mock's list rows are `<div>`s
(`SkillScreen.tsx:41`: `<div className="md-list">{…}<div key={n}><span>{n+1}.</span>…`), so **no `<li>` can exist under
`.md-list` on any board**.

**(b) Append this block after the last line of the file** (a new line 8 onward). Every value is either copied from a
design rule or derived from a rule named in the comment beside it.

```css
/* ── Real-adapter Markdown (the CLI's SKILL.md body) ───────────────────────────────────────────────
   `.md-doc` exists only on the real adapter — the mock feeds pre-parsed blocks and never mounts
   <ReactMarkdown> (SkillScreen.tsx:41 guards on `skillMd.markdown`), so nothing below can reach a locked
   board. The base font-size/line-height/colour here is the W-05 fix: without it every element inherits the
   browser's 16px, because Tailwind preflight resets h1-h6 to `inherit` and the app sets no base size. The
   ancestor `.skill-md-tab` already caps the column at 760px, so `.md-doc` sets no max-width of its own. */
.md-doc{display:flex;flex-direction:column;gap:10px;font-size:13px;font-weight:400;line-height:20px;color:var(--tk-text2);text-wrap:pretty;overflow-wrap:break-word}
.md-doc>*{min-width:0}
.md-doc>:first-child{margin-top:0}
/* Heading ramp. `.md-h2` is the design's own rule (14/590/20 + margin-top:6px) and is NOT redefined.
   h1 is --text-xl and sits under the page title (.detail-title h1 = 24/590/30); h3-h6 step down through
   the design's 590/510 weights and the --text-* sizes. */
.md-h1{font-size:18px;font-weight:590;line-height:24px;color:var(--tk-text1);margin-top:10px}
.md-h3{font-size:13px;font-weight:590;line-height:20px;color:var(--tk-text1);margin-top:4px}
.md-h4{font-size:13px;font-weight:510;line-height:20px;color:var(--tk-text2);margin-top:2px}
.md-h5,.md-h6{font-size:12px;font-weight:510;line-height:16px;color:var(--tk-text3);margin-top:2px}
/* Thematic break: the app's separator weight (.detail-row, .skill-tabs both use 1px solid --tk-border1). */
.md-hr{height:0;border:0;border-top:1px solid var(--tk-border1);margin:6px 0}
/* Blockquote: .report-abstract's rule (EvaluationReport.css:1) at this tab's muted text tier.
   `.md-quote .md-p` is needed because .md-p sets its own colour and would otherwise win. */
.md-quote{padding:2px 0 2px 14px;border-left:2px solid var(--tk-border2)}
.md-quote,.md-quote .md-p{color:var(--tk-text3)}
/* Preflight zeroes every margin, so stacked blocks inside a list item, a quote or the footnote section
   would collide; these are the only two air values this block introduces beyond the doc gap. */
.md-quote>*+*,.md-doc .footnotes>*+*{margin-top:10px}
.md-li-body{flex:1;min-width:0}
.md-li-body>*+*{margin-top:4px}
.md-li-body>.md-p{max-width:none}
/* Lists: the design's marker geometry, restored after preflight's `ol,ul,menu{list-style:none}`.
   `li` is display:flex (rule (a) above), which blockifies ::before into the 16px marker column. */
.md-doc ol.md-list{counter-reset:md-item}
.md-doc ol.md-list>li{counter-increment:md-item}
.md-doc ol.md-list>li::before{content:counter(md-item) "."}
.md-doc ul.md-list>li::before{content:"\2022"}
.md-doc .md-list>li.task-list-item::before{content:""}   /* the checkbox is the marker; keep the column */
.md-doc input[type=checkbox]{width:12px;height:12px;margin-right:4px;vertical-align:-1px;accent-color:var(--tk-brand)}
/* Code. Preflight points bare code/pre at `ui-monospace,…,Consolas` because `@theme{--*:initial}` clears
   --default-mono-font-family; these rules put both back on the brand face. Inline code follows the app's own
   .board-mono precedent (Primitives.css:1) — face only, no chip. */
.md-doc code{font-family:var(--font-mono);font-size:12px;line-height:18px}
.md-doc :not(pre)>code{color:var(--tk-text1)}
.md-code>code{font:inherit;color:inherit;white-space:inherit}
/* Emphasis: preflight's `bolder` resolves to 700, off the 400/500/510/590 ramp. */
.md-doc strong{font-weight:590;color:var(--tk-text1)}
.md-doc del{color:var(--tk-text3)}
/* Tables: no <table> exists anywhere else in the app; derived from .detail-row's 1px --tk-border1 and
   .detail-row>span:first-child's 12px --tk-text3 header tier. GFM alignment arrives as an inline style on
   th/td and overrides `text-align:left` here, which is why th/td are not overridden in the components map. */
.md-table-wrap{max-width:100%;overflow-x:auto}
.md-table{border-collapse:collapse;font-size:12px;line-height:18px;color:var(--tk-text2)}
.md-table th,.md-table td{padding:5px 10px;border:1px solid var(--tk-border1);text-align:left;vertical-align:top}
.md-table th{font-weight:510;color:var(--tk-text3);background:var(--tk-bg2)}
.md-table td:first-child{color:var(--tk-text1)}
/* Links and images are inert (see the spec's D5/D6); the destination is always visible as text. */
.md-link{color:var(--tk-text1)}
.md-url{color:var(--tk-text3);font-family:var(--font-mono);font-size:11px;overflow-wrap:anywhere}
.md-img{display:inline-flex;align-items:baseline;gap:6px;padding:0 6px;border-radius:4px;background:var(--tk-bg2);border:1px solid var(--tk-border1);color:var(--tk-text3);font-size:12px;line-height:18px}
/* remark-gfm's footnote section labels itself with Tailwind's `sr-only`, which this bundle does not emit
   (the utility appears in no source file), so the rule has to exist here or a stray heading shows. */
.md-doc .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
```

Every token named above exists twice (dark + light) in `desktop/src/styles/tokens.css`: `--tk-text1`, `--tk-text2`,
`--tk-text3`, `--tk-border1`, `--tk-border2`, `--tk-bg2`, `--tk-brand`. `--font-mono` is `desktop/src/styles/app.css:9`.
**Invent no token.** These rules are unlayered author CSS, so they beat preflight (which lives in `@layer base`) —
this is the same mechanism that already makes `.md-h2` work.

**Resulting section air** (`.md-doc` is a 10px-gap flex column and flex-item margins do not collapse, so gap + margin add):

| after → before | air | why |
|---|---|---|
| paragraph → `h2` | 10 + 6 = **16px** | identical to the drawn board |
| `h2` → paragraph | 10px | as drawn |
| `h2` → `h3` | 10 + 4 = 14px | one step under h2 |
| paragraph → `h1` | 10 + 10 = 20px | a document title outranks a section |
| paragraph → `h4`/`h5`/`h6` | 10 + 2 = 12px | sub-labels, barely above body rhythm |
| around `hr` | 16px each side; `---` immediately before an `h2` = 6+10+6 = 22px | the section break real docs use `---` for |
| first child of the doc | 0 | `.md-doc>:first-child` (0,2,0) beats `.md-h2` (0,1,0) |

### 4.5 EDIT — `desktop/src/backend/mock/scenario.ts` (2 edits)

Current line 2:

```ts
export type MockScenario='default'|'error'|'empty'|'loading'|'slow'|'disabled'|'not-installed'|'no-team'|'invalid-newest'|'version-mismatch'|'on-disk-only'|'partial'|'detected-root'|'missing-root'|'no-projects';
```

Append `|'raw-md'` at the end of the union (before the `;`).

Current line 9:

```ts
 switch(value){case 'error':case 'empty':case 'loading':case 'slow':case 'disabled':case 'not-installed':case 'no-team':case 'invalid-newest':case 'version-mismatch':case 'on-disk-only':case 'partial':case 'detected-root':case 'missing-root':case 'no-projects':return value;default:return 'default';}
```

Add `case 'raw-md':` immediately before `return value;`. Nothing else in this file changes — in particular
`if(isNativeShell())return 'default';` at line 6 stays, which is what guarantees `?__mock=raw-md` can never leak into
the shipped Tauri app.

### 4.6 NEW — `desktop/src/backend/mock/raw-md.ts` (full contents)

A construct-complete document, kept out of `mock/index.ts` so that file takes a one-line edit. Every construct the
45-file corpus actually uses is present, plus the two the fix hardens.

```ts
/**
 * A construct-complete Markdown document for the test-only `?__mock=raw-md` scenario. It exists so the
 * real render path (SkillMarkdown) is reachable from a browser, which is the only place a computed style
 * can be asserted — `vitest.config.ts` sets `css:false`. It is NOT fixture content for any board: no
 * FIDELITY row may ever use `raw-md`, and `readScenario` returns 'default' inside the native shell.
 */
export const RAW_MD = `## When to use

Before any deploy that touches migrations, with \`--dry-run\` first and a **rollback note** ready.

---

### Steps

1. Read the project config and the example env file.
2. List the migrations added on this branch.
   - Each needs a number.
   - Each needs a rollback note.
3. Diff the env vars the code reads against what is pinned.

#### Notes

- [ ] not done yet
- [x] done

> A quoted aside about the <slug> placeholder, which must render literally.

| Check | Result |
| --- | ---: |
| migrations | 3 |
| env vars | 12 |

\`\`\`bash
npx -y terum-skills@latest validate deploy-check
\`\`\`

See [the docs](https://example.com/docs) and https://example.com/bare and ![a screenshot](https://example.com/shot.png).
`;
```

### 4.7 EDIT — `desktop/src/backend/mock/index.ts` (one added line)

Current lines 115-118 (the `skill:` reader):

```ts
  skill:({ref})=>read('skill',scenario=>{if(scenario==='not-installed'&&ref==='deploy-check')return ok(removalState(detailOf(design.DETAIL_NOT_INSTALLED)));const result=skillByRef(ref);
   if(result.ok&&scenario==='invalid-newest')Object.assign(result.value,{latestState:'invalid',receipt:null,summary:null,reportNumbers:null,invalidReceiptFile:`evals/deploy-check/${design.DETAIL.version_full}/20260829T221500Z.json`});
   if(result.ok&&scenario==='version-mismatch')result.value.versions={placed:'a1b2c3d4'+'0'.repeat(32),teamCurrent:'5f0e12ab9c3d'+'0'.repeat(28),evaluated:'5f0e12ab9c3d'+'0'.repeat(28)};
   return result.ok?ok(removalState(withInstall({...result.value,…
```

Insert, as a new line immediately **after** line 117 (the `version-mismatch` line) and before the `return`:

```ts
   if(result.ok&&scenario==='raw-md')result.value.skillMd={frontmatter:'',body:[],markdown:RAW_MD};
```

The shape `{frontmatter:'',body:[],markdown:…}` is byte-for-byte the real adapter's shape at
`desktop/src/backend/tauri/index.ts:200`, so the scenario exercises the real branch and nothing else. `removalState`
(`mock/index.ts:50`) and `withInstall` only spread the value, so `skillMd` survives to the screen.

Add the import beside the file's existing imports:

```ts
import { RAW_MD } from './raw-md';
```

Nothing else in `mock/index.ts` changes.

### 4.8 NEW — `desktop/e2e/routes/markdown.spec.ts`

See §7.4 for the full test list. Structure follows `desktop/e2e/routes/scroll.spec.ts:1-15` exactly: same imports,
same local `openPane` helper (copy it — the existing one is module-private to `scroll.spec.ts` and this batch must not
restructure that file), same `prepare(page,{name,route,klass:'screen',width:1440,height:900})` from
`desktop/e2e/fidelity/determinism.ts:4`, same `expect(errors).toEqual([])` at the end of every test.

### 4.9 EDIT — tests

`desktop/src/screens/skill/skill-markdown.test.ts` (rows added, none removed) and
`desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx` (one `it` added, none changed). Plus the new
`desktop/src/screens/skill/SkillMarkdown.test.tsx`. Full detail in §7.

---

## 5. Copy strings — every user-visible string, verbatim

This batch introduces **exactly two** user-visible strings, both generated inside the image chip:

| string | where | note |
|---|---|---|
| `image · ` + the image's alt text | `SkillMarkdown.tsx`, `img` override, when `alt` is a non-empty string | The separator is U+00B7 MIDDLE DOT with a normal space on each side — the same separator the app already uses in `.skill-md-meta` (`SkillScreen.tsx:41`: `` ` · ${s.lines} lines` ``). |
| `image` | same, when `alt` is absent or empty | |

Everything else on the screen is the SKILL.md author's own bytes, drawn. **No new label, button, tooltip, empty state,
error message or `title=` attribute is added anywhere.** In particular, do **not** write an empty state for a
local-only skill whose `markdown` is `null` — that copy needs Teddy's sign-off and is listed in §10.

---

## 6. Types and seam changes

| Type | Change |
|---|---|
| `desktop/src/backend/types.ts` `SkillDetail['skillMd']` | **NO CHANGE.** It is already `{frontmatter:string;body:SkillMdBlock[];markdown?:string\|null}` (`types.ts:36`), which is exactly what both adapters need. |
| `desktop/src/backend/types.ts` `SkillMdBlock` | **NO CHANGE.** `{kind:'h2'\|'p'\|'ol'\|'code';content:string\|string[]}` (`types.ts:33`) stays the mock's vocabulary. A markdown→`SkillMdBlock[]` parser was costed and rejected in `.planning/research/2026-09-08-m7-close-the-canvas-gaps.md` — that vocabulary is `h2\|p\|ol\|code` only, so tables, nested lists, blockquotes, task lists and `hr` (all in heavy real use) would be silently dropped. That is data loss on a real-data-only surface. |
| `desktop/src/backend/types.ts` `FEATURE_KEYS` | **NO CHANGE.** Currently `['favorites','follow','roles','lastSeen','installScope','inviteScoping','disablePerMachine','projectMembers','liftOnCards','runEvalInApp','perCase','progress','memberRole','localIdentity','checkouts','projects']` (`types.ts:12`). This batch adds no flag: the fix is unconditional, correct for every CLI version, and a false switch would leave the tab unstyled. |
| `desktop/src/backend/mock/scenario.ts` `MockScenario` | `\|'raw-md'` appended at the END of the union (§4.5). |
| New exported signature | `export function SkillMarkdown({markdown}: {markdown: string}): JSX.Element` — the only export of `SkillMarkdown.tsx`. |
| New exported signature | `export const RAW_MD: string` — the only export of `desktop/src/backend/mock/raw-md.ts`. |
| Changed signature | none. `stripLeadingSkillHeading(markdown: string, name: string): string` keeps its exact signature; only the regex inside changes. |
| CLI (`src/**`) | **NO CHANGE AT ALL.** No verb, no frame, no schema, no `docs/frame-protocol.md` edit. `hello.protocol` stays `1`. |
| Rust (`desktop/src-tauri/**`) | **NO CHANGE AT ALL**, including `capabilities/default.json` and `tauri.conf.json`. |

---

## 7. Tests

Root (`src/**`) gains no tests: this batch touches no root file. All tests are under `desktop/`.
Existing-test policy (C9): **no test is deleted or weakened.** The only existing file whose *content* changes is
`skill-markdown.test.ts`, and only by **adding** rows to its `it.each` table; all 7 existing rows and both assertions
in its existing `it` stay byte-identical.

### 7.1 NEW — `desktop/src/screens/skill/SkillMarkdown.test.tsx`

Unit tests, no backend, no router: `render(<SkillMarkdown markdown={…}/>)` directly. Assertion style copies the
neighbouring `skill-mock-parity.test.tsx` / `skill-detail-screens.test.tsx` — `document.querySelector` +
`toHaveClass` / `textContent`, **no snapshots**. Imports: `{afterEach,expect,it} from 'vitest'`,
`{cleanup,render} from '@testing-library/react'`, `{SkillMarkdown} from './SkillMarkdown'`; `afterEach(cleanup)`.
`@testing-library/jest-dom/vitest` is already loaded by `desktop/src/test/setup.ts:1`.
**Reminder: `desktop/vitest.config.ts` sets `css:false`, so none of these may assert a computed style.**

| # | `it(...)` title | arrange / act / assert |
|---|---|---|
| 1 | `maps ## to the board's own h2 class` | `'## Steps'` → `document.querySelector('.md-doc > h2')` has class exactly `md-h2` and text `Steps`. |
| 2 | `renders a document H1 as h2.md-h1 so the page keeps one h1` | `'# Title'` → the element is an `H2` with class `md-h1`; `document.querySelectorAll('h1')` has length 0. |
| 3 | `maps h3 through h6 to the derived ramp` | `'### a\n\n#### b\n\n##### c\n\n###### d'` → tag/class pairs `h3.md-h3`, `h4.md-h4`, `h5.md-h5`, `h6.md-h6`. |
| 4 | `gives paragraphs the board class and leaves emphasis as real elements` | `'Plain **b** and *i* and ~~s~~ and `x`.'` → `p.md-p`; one `strong`, one `em`, one `del`; the `code` element's `closest('pre')` is `null`. |
| 5 | `renders ordered and unordered lists as md-list rows with a body wrapper` | `'1. a\n2. b'` → `ol.md-list` with two `li`, each with exactly one child `div.md-li-body`. `'- a\n- b'` → `ul.md-list` likewise. |
| 6 | `seeds the CSS counter when an ordered list does not start at 1` | `'3. a\n4. b'` → the `ol` has attribute `start="3"` and inline style `counter-reset: md-item 2`. Also assert `'1. a'` produces an `ol` with **no** `start` attribute and **no** inline `counter-reset` (the `exactOptionalPropertyTypes` conditional-spread path). |
| 7 | `keeps a nested list inside the parent item body` | `'1. a\n   - x\n   - y'` → `document.querySelector('.md-li-body > ul.md-list')` is non-null, and the nested `ul` is **not** a sibling of the marker (`ul.parentElement` has class `md-li-body`). |
| 8 | `renders a GFM task item with a disabled checkbox` | `'- [x] done\n- [ ] todo'` → two `li.task-list-item`; the first contains `input[type=checkbox]` that is `checked` and `disabled`; the checkbox's parent has class `md-li-body`. |
| 9 | `renders a fenced block as pre.md-code and keeps its language and newline` | ``'```bash\nverify.sh\n```'`` → `pre.md-code > code.language-bash`, and that `code`'s `textContent` is exactly `'verify.sh\n'`. |
| 10 | `renders a thematic break as hr.md-hr` | `'a\n\n---\n\nb'` → exactly one `hr`, class `md-hr`. |
| 11 | `renders a blockquote as blockquote.md-quote holding a board paragraph` | `'> q'` → `blockquote.md-quote > p.md-p` with text `q`. |
| 12 | `wraps a GFM table and keeps its column alignment` | `'\| A \| B \|\n\| --- \| ---: \|\n\| a \| 1 \|'` → `div.md-table-wrap > table.md-table`; two `th`; the second `th` and the second `td` both keep `style="text-align: right"`. |
| 13 | `renders a labelled link as inert text with the destination beside it` | `'[docs](https://x.dev/a)'` → `document.querySelectorAll('a')` length 0; `.md-link` textContent contains `docs`; `.md-url` textContent is `https://x.dev/a`. |
| 14 | `renders a bare autolink once, without a duplicated label` | `'<https://x.dev>'` → 0 `a` elements, exactly one `.md-url` with text `https://x.dev`, and **no** `.md-link`. |
| 15 | `renders an image as an inert chip with no img element and no preload link` | `'![alt text](https://evil.example/p.png)'` → 0 `img`; `document.querySelectorAll('link[rel=preload]')` length 0; `.md-img` textContent contains `image · alt text` **and** `https://evil.example/p.png`. |
| 16 | `renders an image with no alt text as a bare chip` | `'![](https://evil.example/q.png)'` → `.md-img` textContent starts with `image` and does not contain `·`. |
| 17 | `shows raw HTML placeholders literally` | `'A <slug> and a <repo>.'` → `document.querySelector('.md-doc')!.textContent` contains `<slug>` and `<repo>`; `document.querySelector('slug')` is null; there is no element whose tagName is `SLUG`. |
| 18 | `drops a javascript: destination and leaves the label as plain text` | `'[x](javascript:alert(1))'` → 0 `a`, 0 `.md-link`, 0 `.md-url`; the doc's `textContent` is `x`. Pins react-markdown's `defaultUrlTransform`, which the map relies on. |
| 19 | `drops a data: image source, keeping an empty destination` | `'![d](data:image/png;base64,AAA)'` → 0 `img`; `.md-img` present; the `.md-url` inside it has empty `textContent`. |
| 20 | `renders an in-document anchor as plain text with no destination chip` | `'[see](#section)'` → 0 `a`, 0 `.md-url`; the doc's `textContent` is `see`. |
| 21 | `keeps remark-gfm footnote plumbing hidden and renders the note` | `'Text[^1].\n\n[^1]: note text'` → `document.querySelector('section.footnotes h2')` has **both** classes `md-h2` and `sr-only`; the `sup` containing the ref has textContent `1` and contains no `a` and no `.md-url`; the footnote's own text `note text` is present. |
| 22 | `renders only the wrapper for an empty or whitespace-only document` | `''` → `.md-doc` exists and has 0 child elements. Re-render with `'   \n\n  \n'` → same. **Edge case the implementation has never seen.** |
| 23 | `renders an unterminated fence as a code block rather than throwing` | `'Text\n\n```bash\nnever closed\n'` → the render does not throw; `pre.md-code > code.language-bash` exists with textContent `'never closed\n'`. **Edge case.** |
| 24 | `leaves a Windows UNC path in prose as CommonMark renders it` | Write the markdown source in the test as a **String.raw** template so the backslashes are literal: ``const md = String.raw`A root at \\wsl.localhost\Ubuntu\home and a ` + '`' + String.raw`\\server\share` + '`' + ` path.`;`` — i.e. the document says `A root at \\wsl.localhost\Ubuntu\home and a \`\\server\share\` path.` Assert: the paragraph's `textContent` contains `\wsl.localhost\Ubuntu\home` — CommonMark turns the leading escaping `\\` into one `\`, and `\w`/`\U`/`\h` are not escapable punctuation so they survive verbatim — and the `code` element's `textContent` contains `\\server\share` **verbatim**, because escapes do not apply inside inline code. This is pre-existing CommonMark behaviour, unchanged by this batch; the test exists so nobody later "fixes" it. **Edge case.** |
| 25 | `reuses one components map across renders` | `const {rerender}=render(<SkillMarkdown markdown={'## Steps'}/>); const first=document.querySelector('.md-h2'); rerender(<SkillMarkdown markdown={'## Steps'}/>); expect(document.querySelector('.md-h2')).toBe(first);` — a components object rebuilt per render would give react-markdown new element types and force a remount, so the node identity would change. Pins the module-level `MARKDOWN` constant. **Edge case the implementation has never seen.** |
| 26 | `renders a very long unbroken destination without an anchor` | `'[x](https://example.com/' + 'a'.repeat(180) + ')'` → 0 `a`; the `.md-url` textContent has length 204 (`https://example.com/` is 20 chars + 180 + 4 for `.com`… assert with `toContain('a'.repeat(180))` rather than a magic length). **Edge case.** |

### 7.2 EDIT — `desktop/src/screens/skill/skill-markdown.test.ts`

Keep lines 1-18 exactly as they are and **append** these rows to the existing `it.each` table (all 14 verified against
the new regex; every one either is a case the old regex got wrong or pins a case it must keep getting right):

```ts
  ['\n# deploy-check\n\nBody','Body'],                       // the real CLI wire shape — fails on main
  ['\n\n  # deploy-check\nBody','Body'],                     // blank lines then 2-space indent
  ['   # deploy-check\nBody','Body'],                        // 3-space indent is still an ATX heading
  ['    # deploy-check\nBody','    # deploy-check\nBody'],    // 4 spaces is an indented code block
  ['\t# deploy-check\nBody','\t# deploy-check\nBody'],        // a tab reaches column 4 — also a code block
  ['\r\n# deploy-check\r\nBody','Body'],                     // CRLF
  ['\r\n# deploy-check\r\n\r\nBody','Body'],                 // CRLF with a blank line after the heading
  ['# deploy-check\t\nBody','Body'],                         // trailing tab
  ['\nIntro\n# deploy-check\n','\nIntro\n# deploy-check\n'],  // not the FIRST line: never strip
  ['# deploy-check','# deploy-check'],                       // heading at EOF, no newline: never strip (D11)
  ['#\ndeploy-check\nBody','#\ndeploy-check\nBody'],          // `#` alone is not `# name` (D10, `\s`→`[ \t]`)
  ['#deploy-check\nBody','#deploy-check\nBody'],              // no space after # is not an ATX heading
  ['# deploy-check #\nBody','# deploy-check #\nBody'],        // a closing sequence is not an exact name match
  ['\n\n\n','\n\n\n'],                                       // blank lines only
  ['',''],                                                    // empty body
```

Then add one new `it` (do not touch the existing one at :15-18):

```ts
it('leaves an indented heading alone because it is a code block, not a title',()=>{
  expect(stripLeadingSkillHeading('    # deploy-check\nBody','deploy-check')).toBe('    # deploy-check\nBody');
  expect(stripLeadingSkillHeading('\t# deploy-check\nBody','deploy-check')).toBe('\t# deploy-check\nBody');
});
```

### 7.3 EDIT — `desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx`

Add **one** `it` at the end of the file. Change nothing else — in particular leave the `h1` assertion at line 31 alone.
`open(route, amend?, launch?)` is declared at `:13`; the third parameter defaults to `'fresh'`, so `open(route, amend)`
compiles. `AmendResult` is `(name, value, frame) => void` (`skill-detail-replay.ts:8`), and the `ls` recording's
`value.skills[0].body` is the field to overwrite.

```ts
it('renders a team SKILL.md through the drawn Markdown vocabulary',async()=>{
  open('#/skill/deploy-check',(name,value)=>{
    if(name==='ls')(value.skills as Record<string,unknown>[])[0]!.body=
      '\n# deploy-check\n\n## When to use\n\nBefore a **deploy**, see [docs](https://x.dev/a).\n\n---\n\n1. one\n2. two\n\n```bash\nverify.sh\n```\n\n![shot](https://evil.example/p.png)\n';
  });
  await screen.findByRole('heading',{name:'deploy-check'});
  // The leading H1 is stripped (it matches the name) and a document H1 would become h2.md-h1 anyway.
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  expect(document.querySelector('.md-doc > h2')).toHaveClass('md-h2');
  expect(document.querySelector('.md-doc ol')).toHaveClass('md-list');
  expect(document.querySelector('.md-doc pre')).toHaveClass('md-code');
  expect(document.querySelector('.md-doc hr')).toHaveClass('md-hr');
  expect(document.querySelectorAll('.md-doc a')).toHaveLength(0);
  expect(document.querySelectorAll('.md-doc img')).toHaveLength(0);
  expect(document.querySelector('.skill-md-meta')).toHaveTextContent('17 lines');
});
```

The `'\n# deploy-check\n…'` prefix is the point of the test: **it fails on main** (the old regex cannot match past the
leading newline, so `deploy-check` appears twice and `document.querySelectorAll('h1')` would still be 1 only because the
components map now demotes it — assert both facts). `17` is `body.replace(/\n$/,'').split('\n').length` for that exact
string (`desktop/src/backend/tauri/index.ts:196`); recompute it if you change one character of the body.

### 7.4 NEW — `desktop/e2e/routes/markdown.spec.ts` (the only gate that can see a computed style)

Route: `#/skill/deploy-check?__mock=raw-md`. Copy `openPane` from `e2e/routes/scroll.spec.ts:7-15` verbatim (change the
`name` passed to `prepare` to `'Markdown'`) and start every test with `const errors=await openPane(page,route);`,
end with `expect(errors).toEqual([]);`.

| `test(...)` title | assertions |
|---|---|
| `real SKILL.md body renders at the drawn body size` | `await expect(page.locator('.md-doc p.md-p').first()).toHaveCSS('font-size','13px')` and `toHaveCSS('line-height','20px')`. |
| `section headings carry the board's own weight and air` | `.md-doc h2.md-h2` first → `font-size` `14px`, `font-weight` `590`, `line-height` `20px`, `margin-top` `6px`. |
| `code renders in the brand mono face` | `.md-doc pre.md-code` → `font-size` `12px`; its `font-family` **contains** `JetBrains Mono Variable` (use `evaluate(el=>getComputedStyle(el).fontFamily)` + `toContain`, not `toHaveCSS`, because the computed value is the whole stack). Also assert the inline `code` inside a paragraph resolves to the same family. |
| `list markers occupy the drawn 16px column` | `.md-doc ol.md-list > li` first → `toHaveCSS('display','flex')`; `evaluate(el=>getComputedStyle(el,'::before').width)` is `'16px'`; `getComputedStyle(el,'::before').content` contains `"."`. |
| `bold text stays on the type ramp` | `.md-doc strong` first → `font-weight` `590` (not `700`). |
| `links and images are inert` | `expect(page.locator('.md-doc a')).toHaveCount(0)`; `expect(page.locator('.md-doc img')).toHaveCount(0)`; `expect(page.locator('link[rel="preload"]')).toHaveCount(0)`; `expect(page.locator('.md-url').first()).toHaveText('https://example.com/docs')`. |
| `no request leaves the app for an image in the document` | register `page.on('request', …)` before `openPane` (or reuse the `errors` array's `requestfailed` hook plus a dedicated recorder) and assert no request URL host is `example.com`. This is the direct falsifier for W-05b. |
| `the document keeps exactly one h1 and no unstyled heading` | `expect(page.locator('h1')).toHaveCount(1)`; every `.md-doc h2, .md-doc h3, .md-doc h4, .md-doc h5, .md-doc h6` has a class starting `md-h`. |

**Do not** assert `.skill-md-meta` on this route (D13: `raw-md` legitimately makes it read `read from skills/deploy-check`).

### 7.5 Failure-mode coverage — the honest list

| failure mode | does it arise here? | where it is handled / tested |
|---|---|---|
| Empty or whitespace-only markdown | yes | §7.1 #22 — renders an empty `.md-doc`, no crash. |
| `markdown === null` (a local-only skill; `ls --local` carries no body) | yes | The existing guard at `SkillScreen.tsx:41` already skips the branch; unchanged. The tab shows only the meta line. **Not** given an empty state here — §10. |
| Malformed markdown (unterminated fence, stray `|`, lone `#`) | yes | §7.1 #23. CommonMark never fails to parse, so nothing throws. |
| `javascript:` / `data:` / `file:` / `vbscript:` destination in `href` or `src` | yes | Neutralised to `''` by react-markdown's `defaultUrlTransform` (which covers `img src` via `html-url-attributes`); the map then renders plain text / an empty chip. §7.1 #18, #19. |
| Remote image fetch | yes | No `<img>` is ever emitted, so no preload and no request. §7.1 #15, §7.4 network test. |
| Webview navigation from a link click | yes | No `<a>` is ever emitted. §7.1 #13, #14, §7.4. |
| Windows UNC path (`\\wsl.localhost\…`) in prose | yes | §7.1 #24 pins the CommonMark behaviour; nothing in this batch does path comparison, so the COMMON brief's `path.win32` warning does not bind here. |
| GFM footnotes (0 in the corpus, latent) | yes | D8 + §7.1 #21. |
| An ordered list not starting at 1 | yes | §7.1 #6, both branches. |
| Very long unbroken URL / token | yes | `overflow-wrap:anywhere` on `.md-url`, `break-word` on `.md-doc`; §7.1 #26. |
| Older CLI without the feature | yes | An `ls` result with no `body` → `row.body ?? null` → `markdown:null` → branch skipped. Unchanged behaviour, no crash, no fabricated content. |
| Cancel / timeout / EACCES / missing tool / lockfile | **no** | This batch adds no I/O, no child process, no seam method, no filesystem access (D14). Inventing a timeout or an abort here would add a second path for a behaviour that has none. |

---

## 8. Gates

Run these, in this order, from `desktop/`. Report the **real** numbers.

```
cd desktop
npm run typecheck        # tsc --noEmit
npm run lint             # eslint . --max-warnings 0
npm test                 # vitest run
npm run build            # vite build
npm run e2e:routes       # playwright test e2e/routes
```

- **Expected pre-existing failures: none.** Every gate above is green at 9fb73e9. If `npm run e2e:routes` cannot start
  a browser in your sandbox, say so plainly and do not fake a result (`desktop/AGENTS.md:70-77`, invariant 8).
- **Do not run** `npm install`, `npm ci`, `npx playwright install`, any `git` command, or anything under `src-tauri/`.
- **You cannot run** `cargo check` (no Rust toolchain in scope) or `npm run e2e:fidelity` (it needs the design canvas
  via `TERUM_DESIGN_DIR`, which you do not have — it will skip). **Say so in your report.** The orchestrator runs both:
  `cargo check` for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` (this batch touches no
  Rust, so all three must be unchanged), and `npx playwright test e2e/fidelity --workers=2`, which **must stay green
  with zero re-baselining** — the 19 `SkillDetail*` rows in `desktop/FIDELITY.md:19-37` all run on the mock, which
  never mounts `.md-doc`.
- The orchestrator additionally runs `npm run export:check`. This batch edits neither `src/fixtures/design.json` nor
  `tools/export-design.py`, so it must be unaffected.
- **Root gates are not run for this batch** — it touches no root file. If you find yourself editing anything outside
  `desktop/`, stop: you have gone off-spec.

---

## 9. Windows verification

Verifiable on Linux (and already measured in a real Chromium): every number in §4.4, the missing base font-size,
the flattened headings, the stripped list markers, the bright `hr`, `strong` at 700, the image preload, the live `<a>`,
and the fact that both brand faces load.

**Not verifiable on Linux — exactly one step:** which concrete face
`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace` resolves to inside
**WebView2 on Windows**. Chromium implements `ui-monospace` only on macOS, so the expectation is **Consolas** on
Windows and **SF Mono** on macOS. The family list demonstrably does not contain JetBrains Mono Variable on any
platform, so the defect and its fix are platform-independent; only the *before* face differs.

**Falsifier commands the reporter runs on Windows**, on a machine with a configured team, in the shipped app:

1. Open any real skill's SKILL.md tab (e.g. `#/skill/decision-walk`).
2. Expected after this batch: section headings render **14px / weight 590** with 16px of air above them; body text
   **13px / line-height 20px**; numbered steps show right-aligned numbers in a 16px column with a hanging indent;
   fenced code renders in **JetBrains Mono** inside a bordered, tinted block; `**bold**` is 590, not 700; `---` is a
   thin `--tk-border1` rule, not a bright near-white one.
3. Devtools falsifier (before/after):
   `getComputedStyle(document.querySelector('.skill-md-blocks p')).fontSize` → `"16px"` before, `"13px"` after.
   `getComputedStyle(document.querySelector('.skill-md-blocks pre')).fontFamily` → the `ui-monospace…` chain before,
   a stack beginning `"JetBrains Mono Variable"` after.
   `document.fonts.check('400 12px "JetBrains Mono Variable"')` → `true` both before and after (proving the font was
   never the problem).
4. Click a link inside a SKILL.md: **nothing must happen** and the app must not navigate. Before this batch it
   navigates the webview away with no way back.
5. `document.querySelectorAll('.skill-md-blocks img').length` → `0`, and the Network tab shows **no** request to any
   host named in the document.

Nothing in this batch touches `src-tauri/`, so NSIS/WebView2 packaging, the installer's `/S`, `/UPDATE` and `/R`
switches, and the 8-child spawn cap are all unaffected. The fix ships in the frontend bundle only.

---

## 10. Out of scope / do not touch

| Item | Why |
|---|---|
| `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json` | Maintainer-owned. **For the ORCHESTRATOR:** add a `GAPS.md` row for the SKILL.md tab naming (a) inert links and images with the destination shown as text, (b) the still-absent frontmatter block (AD-22), (c) `raw-md` as a third test-only scenario alongside `invalid-newest` and `version-mismatch`, and (d) the empty SKILL.md tab for a local-only skill. Add a `FIDELITY.md` "deliberate deviations" line for the nine invented Markdown constructs in §13. **No FIDELITY row moves and no board is added** — all 19 `SkillDetail*` rows stay `locked`. |
| `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json`, anything under `.shots` | Generated / oracle-owned (AGENTS invariants 3 and 4). |
| `desktop/src/styles/app.css` | A base `font-size` there would change every screen. `.md-doc` is the scoped answer. |
| Existing `.md-h2` / `.md-p` / `.md-list` / `.md-code` / `.md-frontmatter` rules | D1. Redefining any of them forks the two paths and risks 19 locked boards. |
| The `read from …` meta line and `dialogCopy` in `SkillScreen.tsx` | D13. Both read `skillMd.markdown!==undefined` as a real-vs-mock discriminator; changing either alters text on locked boards. |
| An empty state for a local-only skill (`markdown === null`) | Needs Teddy's copy and a CLI change (`ls --local` does not carry `body`). Report it; do not invent the sentence. |
| `desktop/src-tauri/capabilities/default.json`, `tauri.conf.json` | Widening `opener:allow-open-url` or setting a CSP is a product/security decision (§13-Q2), not a rendering detail. |
| `@tailwindcss/typography`, `rehype-raw`, `rehype-sanitize`, any new dependency | Barred by the stack pins in `desktop/AGENTS.md`; `rehype-raw` would additionally start executing the `<slug>`-style placeholders instead of showing them. |
| Any file under `src/` (the CLI), `docs/`, `.github/` | This batch is desktop-only. |
| `version` in either `package.json` | C8 — the orchestrator bumps 0.1.10 → 0.1.11 last. |
| Reformatting `SkillScreen.tsx`, `skill.css` or `mock/index.ts` | C5/C4: four other batches edit these in the same window. Keep every edit local to the lines named here. |

---

## 11. Cross-batch contracts used + merge-conflict watch list

Merge order (orchestrator): `w07-library-header → w08-refresh-receipts → w06-eval-lock → w03w04-skill-routing →`
**`w05-skill-markdown`** `→ sidebar-spacing → setup-discover-evals → w02-perf → w01-app-update`.

**Contract fields this batch OWNS:** none. It adds no verb, no feature key, no seam method, no CLI command.

- **C1 `refreshClone` / `RefreshOptions`** — not touched. For completeness, the contract text every batch that *does*
  touch it must copy verbatim, so a rebase can be checked against it:
  ```ts
  export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
  ```
  `refreshClone` gains ONE optional trailing parameter `options?: RefreshOptions`; positional parameters never change.
  w06-eval-lock owns `lockWaitMs`/`onWaiting`; w08-refresh-receipts owns `deadlineMs`. **w05 implements none of it.**
- **C2 `FRAME_VERBS` / `FRAME_FEATURES` / `FEATURE_KEYS`** — not touched. w05 appends nothing. For the rebase check:
  new verbs append at the END of `FRAME_VERBS` (`src/lib/frames.ts:32`) in the order `'refresh'` (w08),
  `'checkout discover'` (setup-discover-evals), `'app-update'` (w01); `FRAME_FEATURES` keys append at the END in the
  order `refresh: true` (w08), `discover: true` (setup-discover-evals), `appUpdate: true` (w01), and w02-perf flips the
  existing `progress: false` → `true`; desktop `FEATURE_KEYS` (`desktop/src/backend/types.ts:12`) appends in the same
  order, the mock answering `true` and the real adapter reading `hello.features.<key>` with a missing key = false.
  **If a rebase makes it look as though w05 must add a key, that is wrong — w05 adds none.**
- **C3 `src/cli.ts`** — not touched.
- **C4 `desktop/src/backend/tauri/index.ts`** — **not touched by w05.** Note for the orchestrator: w03w04 rewrites
  `skill()`/`inventoryDetail` in place; w05 depends on `index.ts:200`'s `skillMd:{frontmatter:'',body:[],markdown:row.body ?? null}`
  shape surviving that rewrite. If it does not, w05's Playwright `raw-md` shape must be re-synced with whatever shape
  w03w04 leaves behind — the mock must always mirror the real adapter exactly.
- **C5 `desktop/src/screens/skill/SkillScreen.tsx`** — **this is w05's contract surface.** w05 owns exactly three
  edits: the import block (lines 24-25 → one line) and the single `<ReactMarkdown>` expression inside line 41
  (§4.2). w03w04 changes crumb/root/not-found, w08 adds a `HistoryRail` in the not-evaluated state, w02-perf adds
  progress lines. All four edits are in different JSX. **Nobody reformats this file.**
- **C6 `RunEvalDialog.tsx`** — not touched.
- **C7 `LaunchCoordinator.tsx`** — not touched.
- **C8 versions** — not touched.
- **C9 tests** — satisfied: three test files gain tests, none is deleted or weakened; the one existing file whose
  content changes (`skill-markdown.test.ts`) only gains `it.each` rows.

**Merge-conflict watch list**

| file | who else touches it | risk |
|---|---|---|
| `desktop/src/screens/skill/SkillScreen.tsx` | w03w04, w08, w02-perf | Textual only. w05's hunks are the import block and one expression inside line 41; keep them minimal so a rebase is mechanical. |
| `desktop/src/screens/skill/skill.css` | w05 only, as far as this window goes | Low. The two in-line replacements are exact-string and each anchor is unique; the appended block is at end-of-file. |
| `desktop/src/screens/skill/skill-markdown.ts` / `.test.ts` | w05 only | None expected. |
| `desktop/src/backend/mock/scenario.ts`, `mock/index.ts` | setup-discover-evals and w01 may also add scenarios | Append-only in both files; if another batch also appends to `MockScenario`, keep both and re-order alphabetically **never** — append in merge order. |
| `desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx` | w03w04 (crumb/not-found assertions) | w05 appends one `it` at the end of the file; do not renumber or move existing tests. |
| `desktop/e2e/routes/` | w03w04, w08 may add specs | New file `markdown.spec.ts`; no conflict. |

---

## 12. PR

**Title** (conventional, 69 chars):

```
fix(skill): render the real SKILL.md in the drawn Markdown vocabulary
```

**Body outline**

- **What** — The real adapter's SKILL.md tab rendered a bare `<ReactMarkdown>` with no `components` map and no CSS, so
  Tailwind preflight defined the whole look. Adds `SkillMarkdown.tsx` (one component, a module-level components map)
  and a `.md-doc`-scoped block in `skill.css` that re-uses the design's `.md-h2 / .md-p / .md-list / .md-code` rules
  verbatim. Repairs `stripLeadingSkillHeading`, whose `^#\s+` anchor never fired because the CLI body starts with a
  newline. Renders markdown links and images inert.
- **Why** — Bugs.pdf W-05, plus two latent defects on the same path: a markdown `<a>` had no click handler and
  navigated the whole webview away (unrecoverable in a Tauri window), and a markdown `<img>` fetched a remote URL
  under `csp: null`, leaking IP/timestamp/skill to whoever merged the SKILL.md.
- **Scope honesty** — roughly 70 % of the diff buys security and mock parity, not the reported typography; a CSS-only
  variant fixes the reported symptom alone and is described in the spec's D3.
- **How verified** — `npm run typecheck / lint / test / build / e2e:routes` in `desktop/` (real counts here). New:
  26 unit tests in `SkillMarkdown.test.tsx`, 15 new rows + 1 new case in `skill-markdown.test.ts`, 1 real-adapter test
  in `skill-detail-screens.test.tsx`, 8 computed-style Playwright tests in `e2e/routes/markdown.spec.ts` — the last
  being the only gate that can see a computed style, since `vitest.config.ts` sets `css:false`.
- **Fidelity** — `.md-doc` is unreachable on the mock (the mock never sets `skillMd.markdown`), so all **19** locked
  `SkillDetail*` boards are pixel-neutral by construction; the two extended `.md-list` selectors add `li` arms that
  cannot match, because the mock's list rows are `<div>`s. `e2e/fidelity` must pass with zero re-baselining. The
  blast radius of a mistake in those two selector edits is 11 boards (SKILL.md is the default tab), so review them first.
- **Test-only scenario** — `?__mock=raw-md` feeds a markdown string through the real component so Playwright can read
  computed styles. **No fidelity board may ever use it**, and `readScenario` returns `'default'` inside the native shell.
  It legitimately makes the meta line read `read from skills/deploy-check`; that expression is a real-vs-mock
  discriminator and is deliberately left alone.
- **Windows notes** — There is no Inter bug: sans text was already Inter Variable. The real font defect is mono —
  `@theme{--*:initial}` clears Tailwind's mono default, so `code`/`pre` fell through to `ui-monospace,…,Consolas`
  (Consolas on Windows, SF Mono on macOS, JetBrains Mono nowhere). Falsifier on Windows with a configured team: open
  `#/skill/decision-walk`; expect 14px/590 headings, 13px/20px body, JetBrains Mono code, and a link click that does
  nothing.
- **Not included** — an empty state for a local-only skill whose `markdown` is `null` (needs copy and a CLI change),
  clickable links (needs `opener:allow-open-url` widened), and a frontmatter block on the real path (AD-22, accepted).

---

## 13. Open questions — each with the default the implementer MUST take without asking

**Every one of these is already resolved in the code above. Take the default; do not ask; do not deviate.** They are
recorded because `desktop/AGENTS.md` invariant 8 requires a design fork to be recorded rather than silently settled,
and the canvas draws only `frontmatter | h2 | p | ol | code`.

| # | Fork | **Default taken** |
|---|---|---|
| Q1 | Section air above an `h2`: design-exact 16px, or opened up now that real docs run to 263 lines? | **Design-exact 16px** (`.md-h2`'s own `margin-top:6px` inside the 10px column). Changing it is a design-side call and would fork the two paths. |
| Q2 | Links: inert with the URL shown, or widen `opener:allow-open-url` to `https://*` and route clicks through `backend.openUrl` (the `SkillScreen.tsx:29` `preventDefault` pattern)? | **Inert.** A middle path exists if Teddy wants clicks — make a link clickable only when its href already matches the existing allowlist (`https://github.com/*`, `https://discord.gg/*`) — and needs no capability change; it is deliberately not built here because it would ship a control that works for two hosts and silently does nothing for every other. |
| Q3 | `raw-md` flips the meta line to `read from skills/deploy-check`; decouple the discriminator, or accept it? | **Accept it** (D13). Decoupling changes text on three locked boards. |
| Q4 | Heading shift: `h1` only, or every level? | **`h1` only** (D4). |
| Q5 | `stripLeadingSkillHeading` match strictness: exact name, or a normalised compare so `# Deploy Check` strips for `deploy-check`? | **Exact** (D10). A normalised compare would start hiding real document titles; `skill-markdown.test.ts:8,17` pins the strictness. |
| Q6 | Images: inert chip, same-origin only, or load everything? | **Inert chip** (D5). Relative paths cannot resolve (the document is served from `tauri.localhost`) and remote ones are beacons under `csp: null`. |
| Q7 | The `md-h1` ramp value (18px/590/24px, `margin-top:10px`) | **Taken as written.** 18px is `--text-xl`; it sits under the page title's 24px/590/30px and above `.md-h2`'s 14px. No letter-spacing, to invent one value fewer. |
| Q8 | `md-h3` / `md-h4` / `md-h5` / `md-h6` values | **Taken as written** (13/590/20 +4, 13/510/20 +2, 12/510/16 +2). All sizes are `--text-*`; all weights are on the 400/500/510/590 ramp. |
| Q9 | `md-hr` (1px `--tk-border1`, 6px margins) | **Taken as written**, derived from `.detail-row` / `.skill-tabs`, which are the app's only separators. |
| Q10 | `md-quote` (`.report-abstract`'s padding/border at `--tk-text3`) | **Taken as written**, derived from `EvaluationReport.css:1`. |
| Q11 | Table vocabulary (12/18, 5px 10px cells, 1px `--tk-border1`, `th` 510 `--tk-text3` on `--tk-bg2`, first column `--tk-text1`, `overflow-x:auto` with a visible scrollbar) | **Taken as written.** No `<table>` exists anywhere else in the app. The scrollbar stays visible (the app hides scrollbars only on panes that also scroll by wheel and keyboard); a table's scrollbar is its only affordance. |
| Q12 | Inline code: chip or face-only? | **Face-only** (D9), following `.board-mono`. |
| Q13 | Task-list checkbox (12×12, `accent-color:var(--tk-brand)`) and the `.md-img` chip's box | **Taken as written**; both use only existing tokens. |

**For the orchestrator:** ask Teddy for a `SkillDetailMarkdown` board, or a "deliberate deviations" line in
`FIDELITY.md`, so Q7–Q13 stop being un-owned. Shipping derived values beats shipping unstyled markdown, but they
should be owned by the canvas, not by this spec.

---

## Appendix A — Corrections to the batch brief (the code at 9fb73e9 wins)

1. **"links: http(s) open through `backend.openUrl` (existing pattern)"** — refuted. `opener:allow-open-url` is scoped
   to `https://github.com/*` and `https://discord.gg/*` (`desktop/src-tauri/capabilities/default.json`), so this would
   ship a control that fails for nearly every link. Links are inert (D6); a scoped-clickable middle path is recorded as
   Q2 for Teddy.
2. **"`stripLeadingSkillHeading` never fires (the CLI body starts with `\n`)"** — true, but its stated consequence is
   overstated. Only 1/45 local skills and 0/5 team skills open with `# <exact name>`, so nobody sees a doubled name
   today; the double-`<h1>` the brief implies comes from **document-title** H1s (33/45), which the regex must never
   strip and which are fixed by the `h1 → h2.md-h1` mapping instead. The regex repair is still correct and is kept.
3. **Regex** — the brief proposes `/^(?:\r?\n)*[ \t]{0,3}#[ \t]+([^\n]*?)\s*\n/`. Changed to
   `/^(?:\r?\n)* {0,3}#[ \t]+([^\n]*?)\s*\n/`: a leading tab reaches column 4, which is an indented **code block** in
   CommonMark, and stripping it would delete content from a real-data-only surface (D10).
4. **"`img src` is not transformed"** (triage §3) — false. `react-markdown@10.1.0` runs `defaultUrlTransform` over
   `html-url-attributes`' `urlAttributes`, and `urlAttributes.src` includes `img` (verified in this worktree's
   `node_modules`). `javascript:`/`data:`/`file:` image sources are already neutralised to `''` today. The *beacon*
   finding survives intact: an `https://` source is still emitted **and preloaded** by React 19 and still fetched under
   `csp: null`. The fix is unchanged; only the justification is corrected, and §7.1 #19 pins the sanitiser.
5. **Locked-board count** — the brief and triage cite three `SkillDetail*` rows. SKILL.md is the **default** tab, so
   **eleven** boards render it and **nineteen** `SkillDetail*` rows exist at `desktop/FIDELITY.md:19-37`. Pixel-neutrality
   still holds for the same reason, but the blast radius of a mistake in the two `.md-list` selector edits is 11 boards.
6. **`.md-doc>:first-child` specificity** — the triage says "(0,1,1)". It is **(0,2,0)** (class + pseudo-class). It
   still beats `.md-h2`'s (0,1,0); the conclusion is unchanged.
7. **Existing test count** — the triage says "9 existing rows" in `skill-markdown.test.ts`. It is **7 `it.each` rows +
   one separate `it` with 2 assertions** (`skill-markdown.test.ts:4-18`), 8 tests total.
8. **`mock/index.ts` line numbers** — the triage cites 110-111. At 9fb73e9 the `skill:` scenario patches are at
   **115-118** (`invalid-newest` :116, `version-mismatch` :117).
9. **`skill-detail-screens.test.tsx` signature** — `open()` gained a third parameter in #135:
   `open(route:string, amend?:AmendResult, launch:'fresh'|'consumed'='fresh')` (`:13`). `open(route, amend)` still
   compiles. The triage's "18/18 in 6.66 s" baseline predates #131 and #135; measure your own.
10. **GAPS.md line 56** — the refute verdict quotes it as "Two mock scenarios exist only for tests, `__mock=invalid-newest`
    and `__mock=version-mismatch`; no board draws them". **That sentence is not in `desktop/GAPS.md` at 9fb73e9** —
    line 56 is the eval-in-app row. The *substance* still holds and is verified independently:
    `desktop/src/backend/mock/scenario.ts:2` carries eight scenarios beyond the six AGENTS names, and
    `desktop/e2e/fidelity/boards.ts` uses only `disabled | not-installed | loading | error | empty`. Do not cite the
    quoted sentence.
11. **R14** — it is a LOCK on the CLI's two sanitizers for text the tool *writes* into a document it authors, not a
    ruling on rendering a teammate's SKILL.md. Applying it here is an analogy. Do not present it as binding (D6).
12. **`title="Images in a shared SKILL.md are not loaded."`** (triage §6.1) — dropped. A native `title` is invisible to
    keyboard and touch, unstyled by the design system, and is app-authored user-facing copy without sign-off (D5).
13. **Block-parser rejection citation** — `.planning/research/2026-09-08-m7-close-the-canvas-gaps.md`, the passage
    about `skillMd:{frontmatter:string; body:SkillMdBlock[]}` being "a structured decomposition, not the file text".
    The triage's `:1342` is the wrong line (that is RM-13 / `desc_long`); do not quote a line number for it.
14. **Corpus counts** — re-measured at 9fb73e9 over the 45 local `~/.claude/skills/*/SKILL.md` files. Reproduced
    exactly: 45 files, **44** bodies starting with `\n`, **56** `h1`, **479** `h2`, **1** file opening with
    `# <exact folder name>`, **33** opening with a document-title H1, **0** images, **0** footnotes. Two did not:
    inline code is **5,551** (the triage says 5,601 — a tokenizer difference, immaterial), and the "241 raw HTML
    inline" figure counts placeholders *inside* inline code, where they are literal either way; only **7** sit in
    open prose. Neither number changes any decision.
15. **`desktop/AGENTS.md` line numbers** — invariant 7 is at `:63-69` and invariant 8 at `:70-77` (the triage cites
    neither). Quote those, not the invariant numbers alone.
