# Spec — whole-card click target for SkillCard and PersonCard (desktop)

Repo: terum-skills (`skill-management-software`), branch `fix/whole-card-click` off `origin/main` at 279830d. Everything below lives under `desktop/`; paths are repo-relative. Line numbers refer to origin/main 279830d — where a number and the code disagree, the code wins: find the quoted code.

## Bug

The skill card (`desktop/src/components/domain/SkillCard.tsx`) opens the skill only from its title link (`.skill-card-ident>a`), while the whole card lights on hover (`.skill-card:hover` in `SkillCard.css`). The maintainer wants the whole card to open the skill. The Marketplace PersonCard (`desktop/src/screens/marketplace/market-components.tsx:35`) has the same defect: only the avatar link and the name link navigate, the card body does not. The design canvas draws card-level hover / focus / pressed states with the title as plain text.

## Fix — "stretched title link"

CSS-only, one accessible link per card, valid HTML (no nested interactive content, no `<a>` around buttons), pixel-neutral on the 88 locked fidelity boards. Do not add `z-index` anywhere. Do not add `role`, `tabindex`, or an `onClick` to the `<article>`.

### 1. `desktop/src/components/domain/SkillCard.css`

The card is already `position:relative`. The title anchor lives in `.skill-card-ident`, which has `overflow:hidden` on the anchor — that does not clip a `::after` whose containing block is the card (the anchor and `.skill-card-ident` are not positioned, so the pseudo-element's containing block is `.skill-card`).

Add, in this order (keep the file's one-line minified style — append rules to the end of the existing line, or as a second line; do not reformat the existing rules):

- `.skill-card-ident>a::after{content:'';position:absolute;inset:0}` — the overlay that makes the whole card the link's hit area.
- `.skill-card-buttons,.skill-card-bottom>div:last-child{position:relative}` — raises the More trigger, FavoriteHeart, the enable Switch and `.card-install` above the overlay (later in DOM + positioned = painted above a positioned element earlier in DOM, with no z-index). `.card-flag` is already `position:relative` and later in DOM; `.board-hover-tip` and the error alert are absolute with `z-index:10` already; LiftFigure ends up under the overlay, which is fine because it is presentational.
- `.skill-card-ident>a{-webkit-user-drag:none}` — an anchor spanning the card would otherwise start a link drag on mousedown-drag in WKWebView.
- `.skill-card-ident>a:hover{text-decoration:none}` — `src/styles/app.css:51` underlines every `a:hover`; with the stretched overlay the title would underline whenever the pointer is anywhere on the card, and the canvas draws the card hover state with the title as plain text. (Colour is already inline on the anchor, so only the underline leaks.) Merge this into the existing `.skill-card-ident>a` block if you prefer — one declaration either way.
- Focus and pressed states, GUARDED so keyboard users never lose the ring on WKWebViews without `:has()` (`src-tauri/tauri.conf.json:52` minimumSystemVersion 11.0; `src/styles/app.css:52` provides the global `a:focus-visible` ring that stays in force outside the guard):

```css
@supports selector(:has(a)) {
  .skill-card-ident>a:focus-visible{outline:none}
  .skill-card:has(.skill-card-ident>a:focus-visible){box-shadow:0 0 0 2px var(--tk-accent)}
  .skill-card:has(.skill-card-ident>a:active){background:var(--tk-bg3);border-color:var(--tk-border2)}
}
```

Do not change `SkillCard.tsx` (anchor, href, `data-testid` unchanged).

### 2. Marketplace PersonCard

`desktop/src/screens/marketplace/marketplace.css` (NOT `market.css`, which does not exist):

- `.market-person-card{position:relative}` — it is not positioned today (its rule is `display:flex;flex-direction:column;gap:8px;height:124px;...`). Add `position:relative` to that existing rule.
- `.market-person-ident>a::after{content:'';position:absolute;inset:0}`.
- `.market-person-ident>a{-webkit-user-drag:none}` and `.market-person-ident>a:hover{text-decoration:none}` (same reasons as the skill card).
- `.market-follow` is already `position:relative`; leave it — it sits above the overlay.
- The same `@supports selector(:has(a))`-guarded rules for `.market-person-card`: `.market-person-ident>a:focus-visible{outline:none}`, `.market-person-card:has(.market-person-ident>a:focus-visible){box-shadow:0 0 0 2px var(--tk-accent)}`, `.market-person-card:has(.market-person-ident>a:active){background:var(--tk-bg3);border-color:var(--tk-border2)}`.

`desktop/src/screens/marketplace/market-components.tsx:35` `PersonCard`: drop the duplicate avatar `<Link to={'/marketplace/people/'+q.handle} aria-label={q.name}>` so the card has exactly one link (the name); the stretched name link covers the avatar. GEOMETRY HAZARD: `.market-card-head>span:not(.market-mark):not(.market-install-mark)` (marketplace.css) styles every direct `span` child of the head with `flex-grow:1`, `line-height:20px`, `overflow:hidden`, etc. If `<Avatar/>` (which renders `span.board-avatar`) became a direct child of `.market-card-head` it would pick those up and the MarketplacePeople / Marketplace / MarketplaceFull boards would move. So keep a wrapper element in the Link's place: replace the `<Link ...>` with a plain `<div>` (no class, no attributes) around `<Avatar initials={q.initials} size={32}/>`. The blockified `<a>` flex item and a `<div>` flex item have identical geometry. Verify with the existing marketplace tests (`desktop/src/screens/marketplace/marketplace.test.tsx`).

### 3. Onboarding preview is inert

`desktop/src/screens/onboarding/OnboardingBasics.tsx:10`: `if(tab==='Manage')return <div style={{width:440}}><SkillCard skill={d.skill}/></div>;` — add `inert` and `aria-label="Skill card preview"` to that wrapper `<div>`. Reason: `OnboardingScreen.tsx:75`'s document keydown handler owns Enter there and the canvas draws the preview as a static default-state card; with a stretched link a body click anywhere on the preview would eject the user from onboarding into the skill. React 19.2 supports the `inert` boolean attribute (`<div inert>`); if the typecheck rejects the bare boolean, use whatever form typechecks (`inert=""` is the fallback), never a cast.

### 4. Tests

#### 4a. jsdom (vitest) — `desktop/src/screens/library/library-skill.test.tsx`

Keep every existing test. Add invariants (model on the scratch assertions below, which were written against the pre-fix tree and must still hold after it):

- the `deploy-check` card on `#/library/global` contains exactly one link, and it has `href="#/skill/deploy-check"`;
- the `<article>` has no `role` and no `tabindex` attribute;
- clicking the Switch and clicking the favorite heart do not change `location.hash` (jsdom does not run CSS, so this is the DOM-level invariant: the controls are buttons, not links, and they do not navigate);
- on `#/marketplace/people/lena`, the `a11y-audit` card (not installed) contains exactly one link with `href="#/skill/a11y-audit?root=marketplace"`, and clicking its `.card-install` button navigates to `#/skill/a11y-audit?__mock=not-installed&dialog=install&root=marketplace` (this is the Library-style `.card-install` button; the mock Library shows only installed skills, so the button is only reachable in a marketplace list).
- in `desktop/src/screens/marketplace/marketplace.test.tsx` (extend, keep every existing test): on `#/marketplace/people`, `person-card-ryan` contains exactly one link with `href="#/marketplace/people/ryan"`, and clicking its Follow button (`Follow ryan`) leaves `location.hash` at `#/marketplace/people`.

Scratch assertions to port (they were run against the same test harness — `open(route)` + `screen.findByTestId`; do not copy the absolute imports):

```tsx
it('control: the title is the link',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');expect(within(card).getByRole('link',{name:'deploy-check'})).toHaveAttribute('href','#/skill/deploy-check');});
it('inventory: the only link in the card is the title',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');expect(within(card).getAllByRole('link')).toHaveLength(1);expect(card.getAttribute('role')).toBeNull();expect(card.getAttribute('tabindex')).toBeNull();});
```

#### 4b. Playwright — new spec `desktop/e2e/routes/card-click.spec.ts`

Same harness as `desktop/e2e/routes/routes.spec.ts`: import `prepare` from `../fidelity/determinism` and call it with a `Board`-shaped object (`{name, route, klass:'screen', width:1440, height:900}`), collect console errors / pageerrors like `routes.spec.ts` does and assert `errors` is empty at the end of each test. Mock backend (the dev server on port 1420; the Playwright config starts it). Use `test.describe.configure({mode:'parallel'})` like the sibling spec.

Tests (each its own `test()`):

1. Body click opens the skill: open `#/library/global`; take the bounding box of `[data-testid="skill-card-deploy-check"] .skill-card-desc` and `page.mouse.click()` at its centre (NOT `locator.click()` — Playwright's actionability check sees the `::after` overlay intercepting the pointer and retries to timeout); expect `page` URL to match `/#\/skill\/deploy-check$/`.
2. Switch click: on `#/library/global`, click the `deploy-check` card's `role=switch` (`locator.click()` is fine here — the Switch is above the overlay); expect the URL still matches `/#\/library\/global$/` and `aria-checked` flipped from `true` to `false`.
3. Favorite click: `getByRole('button',{name:'Favorite deploy-check'})` click; URL unchanged; `aria-pressed` flipped.
4. Flag hover: hover the `pr-review` card's `[data-flag="update"]` (that is `design.SKILLS[design.HOVER_INDEX]`, the Library board's hover target); expect its `.board-hover-tip` to be visible; URL unchanged.
5. Marketplace install button: open `#/marketplace/skills`; the `a11y-audit` card is not installed, so its wrapper `.market-card-wrap` carries a `button.market-card-install` (absolute, later in DOM than the card, so it sits above the overlay); hover the card, click that button; expect the URL to match `/#\/skill\/a11y-audit\?__mock=not-installed&dialog=install&root=marketplace$/` and a `role=dialog` to be visible.
6. More → Remove: on `#/library/global`, hover the `deploy-check` card (the `.card-more` trigger is `visibility:hidden` until hover), click `getByRole('button',{name:'More actions for deploy-check'})`, click the `Remove` menu item; expect the URL to contain `dialog=remove`.
7. Keyboard focus ring lands on the card: on `#/library/global`, move focus to the `deploy-check` title link by keyboard (press `Tab` repeatedly, bounded at ~60 presses, until `document.activeElement` is that anchor — keyboard-driven focus is what makes `:focus-visible` match; `locator.focus()` may not). If `await page.evaluate(()=>CSS.supports('selector(:has(a))'))` is false, `test.skip()` gracefully with a message; otherwise assert the computed `box-shadow` of the `<article>` is not `none` and contains `0px 0px 0px 2px`, and the anchor's computed `outline-style` is `none`. Chromium 153 supports `:has()`, so this assertion runs on the gate machine.
8. Marketplace-origin card click keeps root: open `#/marketplace/people/ryan`; body-click (mouse, centre of `.skill-card-desc`) the first `[data-testid^="skill-card-"]` card; expect the URL to contain `root=marketplace` and match `/#\/skill\/[^?]+\?root=marketplace$/`.
9. PersonCard body click navigates: open `#/marketplace/people`; mouse-click the centre of `[data-testid="person-card-ryan"] .market-person-lines`; expect the URL to match `/#\/marketplace\/people\/ryan$/`.
10. PersonCard Follow does not navigate: on `#/marketplace/people`, click `getByRole('button',{name:'Follow ryan'})`; expect the URL still matches `/#\/marketplace\/people$/` and the button is now `Unfollow ryan`.

This spec must FAIL on origin/main (test 1, 8 and 9: the body click stays on the list page) and PASS after the fix. You cannot launch a browser inside the sandbox; write the spec carefully and say in the report that the orchestrator runs it.

### 5. Docs

Do NOT edit `desktop/GAPS.md`, `desktop/README.md`, `desktop/AGENTS.md`, `desktop/FIDELITY.md` or `desktop/package.json` (desktop/AGENTS.md invariant 2). The orchestrator adds the one-line convention note itself.

## Acceptance

- `npm --prefix desktop run typecheck`, `npm --prefix desktop run lint` (`--max-warnings 0`), `NODE_OPTIONS=--no-experimental-webstorage npm --prefix desktop test` all green; report real counts (baseline on the untouched tree: 67 files, 922 passed, 88 skipped).
- `git diff --stat origin/main` touches only: `desktop/src/components/domain/SkillCard.css`, `desktop/src/screens/marketplace/marketplace.css`, `desktop/src/screens/marketplace/market-components.tsx`, `desktop/src/screens/onboarding/OnboardingBasics.tsx`, `desktop/src/screens/library/library-skill.test.tsx`, `desktop/src/screens/marketplace/marketplace.test.tsx`, `desktop/e2e/routes/card-click.spec.ts`.
- No `eslint-disable`, no `as any`, no skipped or weakened existing test.
