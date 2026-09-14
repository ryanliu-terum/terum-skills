import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec A (2026-09-13): the skill detail's tab BODY scrolls; the header, score row, tab strip, each tab's head
// row and the two rails stay put. vitest runs with css:false and jsdom lays nothing out, so the contract is
// pinned here as text (after the pattern of src/styles/__tests__/app-css.test.ts) and again, as computed
// style and real wheel input, in e2e/routes/scroll.spec.ts.
const SKILL_CSS = 'src/screens/skill/skill.css';
const REPORT_CSS = 'src/components/domain/EvaluationReport.css';
const FILES = [SKILL_CSS, REPORT_CSS] as const;

const source = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css: Record<string, string> = { [SKILL_CSS]: source(SKILL_CSS), [REPORT_CSS]: source(REPORT_CSS) };

interface Rule {
  selectors: string[];
  body: string;
}

// Neither file carries an at-rule, so every `… { … }` in them is a plain style rule.
function rules(path: string): Rule[] {
  const text = css[path];
  if (text === undefined) throw new Error(`No CSS read for ${path}`);
  if (/@media|@supports|@layer/.test(text)) throw new Error(`${path} grew an at-rule: this parser only reads flat rules`);
  const parsed: Rule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!
      .split(',')
      .map(selector => selector.trim().replace(/\s+/g, ' ').replace(/\s*>\s*/g, '>'))
      .filter(selector => selector.length > 0);
    parsed.push({ selectors, body: match[2]! });
  }
  if (parsed.length === 0) throw new Error(`${path} parsed to no rules`);
  return parsed;
}

/** Every declaration written for exactly this selector, joined — a selector may be split over several rules. */
function declarations(path: string, selector: string): string {
  const matched = rules(path).filter(rule => rule.selectors.includes(selector));
  expect(matched.length, `${path} has no rule for "${selector}"`).toBeGreaterThan(0);
  return matched.map(rule => rule.body).join(';');
}

function hasSelector(path: string, selector: string): boolean {
  return rules(path).some(rule => rule.selectors.includes(selector));
}

const declares = (property: string, value: string): RegExp =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:;|$)`);

const WINDOWED = '.detail-body:not(.full)';
const FULL = '.detail-body.full';

/**
 * Every windowed rule whose subject is `klass` — the last compound of the selector is that class, alone or
 * narrowed by a pseudo-class (`.evals-body:not(:has(.evals-main))`). A rule that only reaches a DESCENDANT of
 * the box (`… .evals-body>.centered-state`) is not a rule about the box itself and is excluded.
 */
function windowedRulesFor(path: string, klass: string): Rule[] {
  return rules(path).filter(rule => rule.selectors.some(selector => {
    if (!selector.startsWith(`${WINDOWED} `)) return false;
    const subject = selector.split(' ').at(-1) ?? '';
    return subject === klass || subject.startsWith(`${klass}:`);
  }));
}

// The four tab bodies of the skill detail, in the windowed (non-`?full=1`) modes.
const BODIES = ['.skill-md-blocks', '.evals-main', '.quality-tab', '.activity-tab'] as const;
// The bodies that live INSIDE a separate clipping tab box, so they may shrink to nothing…
const NESTED_BODIES = ['.skill-md-blocks', '.evals-main'] as const;
// …and the boxes that clip them, which is what keeps the head rows pinned.
const CONSTRAINING = ['.skill-md-tab', '.evals-tab', '.evals-body'] as const;
// Every box that is the direct child of `.detail-main` on some tab, i.e. the box that absorbs the column's
// flex deficit. Each needs a floor, or a short window shrinks it to a keyhole and `.detail-main` — whose
// `overflow:auto` is the spec's fallback — never develops any overflow to scroll. `.evals-body` is on this
// list only in the two states that render it WITHOUT an `.evals-main` inside (see NO_REPORT_BODY).
const TAB_BOXES = ['.skill-md-tab', '.evals-tab', '.quality-tab', '.activity-tab'] as const;
const NO_REPORT_BODY = `${WINDOWED} .evals-body:not(:has(.evals-main))`;
// 240px: a content-derived floor — the action stack of the two CenteredState bodies (199px at 1440px wide,
// 177px at the 960px minimum) plus this batch's 28px of clearance — which also leaves the Evals report pane
// 188px. Kept as one value so no tab can be floored differently from the others.
const FLOOR = '240px';

describe('the tab body is the scroll region', () => {
  it.each(BODIES)('%s scrolls itself with the repo’s hidden scrollbar', body => {
    const rule = declarations(SKILL_CSS, `${WINDOWED} ${body}`);
    expect(rule).toMatch(declares('overflow', 'auto'));
    expect(rule).toMatch(declares('scrollbar-width', 'none'));
  });

  it.each(NESTED_BODIES)('%s may shrink to nothing inside its clipping tab box', body => {
    // Without this a body cannot shrink inside its constraining box and the column overflows again. The other
    // two bodies ARE their tab box, so they carry the floor instead — asserted below.
    expect(declarations(SKILL_CSS, `${WINDOWED} ${body}`)).toMatch(declares('min-height', '0'));
  });

  it('scrolls the History rail on its own, from the file that owns the class', () => {
    const rule = declarations(REPORT_CSS, `${WINDOWED} .history-rail`);
    expect(rule).toMatch(declares('overflow', 'auto'));
    expect(rule).toMatch(declares('scrollbar-width', 'none'));
    expect(rule).toMatch(declares('min-height', '0'));
    expect(hasSelector(SKILL_CSS, `${WINDOWED} .history-rail`)).toBe(false);
  });

  it.each(CONSTRAINING)('%s keeps clipping so the rows above the body stay pinned', box => {
    expect(declarations(SKILL_CSS, box)).toMatch(declares('overflow', 'hidden'));
    // The 2026-09-09 column-scroll design re-opened these three with `overflow:visible`; that override is
    // gone, and no windowed rule may bring it back. (Windowed rules DO target these boxes now — for the
    // floor, and for the one `.evals-body` state that has no pane inside to scroll — so the pin is on the
    // declaration that broke the contract, not on the mere existence of a rule.)
    for (const rule of windowedRulesFor(SKILL_CSS, box)) {
      expect(rule.body, `${box}: ${rule.selectors.join(',')}`).not.toMatch(declares('overflow', 'visible'));
    }
  });

  it('leaves no windowed rule that makes a pane visible again', () => {
    for (const path of FILES) {
      for (const rule of rules(path)) {
        if (rule.selectors.some(selector => selector.startsWith(WINDOWED))) {
          expect(rule.body, `${path}: ${rule.selectors.join(',')}`).not.toMatch(declares('overflow', 'visible'));
        }
      }
    }
  });

  it('keeps .detail-main as the fallback scroller, unpadded', () => {
    const rule = declarations(SKILL_CSS, '.detail-main');
    expect(rule).toMatch(declares('overflow', 'auto'));
    expect(rule).toMatch(declares('scrollbar-width', 'none'));
    // A windowed rule here would scroll the whole column again, or pad a box the boards measure.
    expect(hasSelector(SKILL_CSS, `${WINDOWED} .detail-main`)).toBe(false);
    expect(rule).not.toMatch(/padding-bottom/);
  });
});

// Review fix (2026-09-13): the spec gives `.detail-main` the short-window fallback, but every other child of
// it is `flex-shrink:0`, so the tab box absorbed the whole deficit and the fallback could not engage — at
// 960x600, the app's own minimum window, the Evals body fell to 39px while `.detail-main` reported
// scrollHeight === clientHeight. A floor pushes the deficit back into the column.
describe('a short window scrolls the column instead of collapsing the pane', () => {
  it.each(TAB_BOXES)('%s cannot shrink past the floor', box => {
    expect(declarations(SKILL_CSS, `${WINDOWED} ${box}`)).toMatch(declares('min-height', FLOOR));
  });

  it('floors the Evals body only in the states where it IS the tab box', () => {
    // Floored unconditionally it would also apply to the `.evals-body` nested inside `.evals-tab`, which is
    // already floored — the nested body would then overflow its clipping parent by the head row's height.
    expect(declarations(SKILL_CSS, NO_REPORT_BODY)).toMatch(declares('min-height', FLOOR));
    expect(hasSelector(SKILL_CSS, `${WINDOWED} .evals-body`)).toBe(false);
  });

  it('floors no pane in full mode, where the document is printed in one piece', () => {
    for (const path of FILES) {
      for (const rule of rules(path)) {
        const scoped = rule.selectors.filter(selector => selector.startsWith(FULL));
        if (scoped.length > 0) expect(rule.body, `${path}: ${scoped.join(',')}`).not.toMatch(/min-height/);
      }
    }
  });
});

// Review fix (2026-09-13): two states render `.evals-body` with a CenteredState and no `.evals-main` inside
// (SkillScreen.tsx — an unreadable newest receipt, and a version with no receipt but older runs). The body
// then has to be the scroller itself, or the state is clipped with no scroll container in the subtree.
describe('the Evals body scrolls itself when it holds no report pane', () => {
  it('is a scroller with the repo’s hidden scrollbar', () => {
    const rule = declarations(SKILL_CSS, NO_REPORT_BODY);
    expect(rule).toMatch(declares('overflow', 'auto'));
    expect(rule).toMatch(declares('scrollbar-width', 'none'));
  });

  it('re-expresses the CenteredState’s centring as auto margins, so nothing overflows out of reach', () => {
    // `justify-content:center` overflows BOTH ways and the leading half is unreachable (scrollTop >= 0);
    // auto margins resolve to 0 when the free space is negative, so the state centres while it fits and
    // start-aligns when it does not. Measured 2026-09-13: identical geometry at 1440x900 and 1440x1900.
    expect(declarations(SKILL_CSS, `${WINDOWED} .evals-body>.centered-state`)).toMatch(declares('justify-content', 'flex-start'));
    expect(declarations(SKILL_CSS, `${WINDOWED} .evals-body>.centered-state>:first-child`)).toMatch(declares('margin-top', 'auto'));
    expect(declarations(SKILL_CSS, `${WINDOWED} .evals-body>.centered-state>:last-child`)).toMatch(declares('margin-bottom', 'auto'));
  });

  it('hangs its 28px of clearance out of flow, like SKILL.md', () => {
    // Padding would resize the centred box and move it while it still fits; an out-of-flow box under the last
    // row extends the scrollable overflow region without touching any intrinsic size.
    expect(declarations(SKILL_CSS, NO_REPORT_BODY)).not.toMatch(/padding/);
    const last = declarations(SKILL_CSS, `${WINDOWED} .evals-body>.centered-state>:last-child`);
    expect(last).toMatch(declares('position', 'relative'));
    const spacer = declarations(SKILL_CSS, `${WINDOWED} .evals-body>.centered-state>:last-child::after`);
    expect(spacer).toMatch(declares('content', '""'));
    expect(spacer).toMatch(declares('position', 'absolute'));
    expect(spacer).toMatch(declares('top', '100%'));
    expect(spacer).toMatch(declares('height', '28px'));
    expect(spacer).toMatch(declares('pointer-events', 'none'));
  });
});

describe('the last line never sits on the clipped edge', () => {
  it.each(['.evals-main', '.quality-tab', '.activity-tab'])('%s ends 28px above its own bottom', body => {
    expect(declarations(SKILL_CSS, `${WINDOWED} ${body}`)).toMatch(declares('padding-bottom', '28px'));
  });

  it('gives the History rail the same 28px (review fix, 2026-09-13)', () => {
    // The rail is a scroller too: once a skill has more runs than fit, its last line sat exactly on the
    // panel's clipped, rounded edge. Padding cannot move this box — the rail is `box-sizing:content-box` and
    // stretches to the body's height, so only its scrollable overflow region grows (measured: no box moves).
    expect(declarations(REPORT_CSS, `${WINDOWED} .history-rail`)).toMatch(declares('padding-bottom', '28px'));
    expect(declarations(REPORT_CSS, '.history-rail')).toMatch(declares('box-sizing', 'content-box'));
  });

  it('takes the SKILL.md clearance out of flow instead of as padding', () => {
    // `.skill-md-meta` is the one pinned head row that can still shrink (no 24px button on the not-installed
    // boards), and a pane's padding counts in its outer hypothetical size: measured on the dev server
    // 2026-09-13, `padding-bottom:28px` here squeezed that row from 22.625px to 21.375px and moved the whole
    // body up 1.25px on SkillDetailNotInstalled / SkillDetailInstall / SkillDetailInstallLight. An
    // out-of-flow box under the last block extends the scrollable overflow region without touching any
    // intrinsic size, so the pane still stops 28px short and no board moves.
    expect(declarations(SKILL_CSS, `${WINDOWED} .skill-md-blocks`)).not.toMatch(/padding-bottom/);
    expect(declarations(SKILL_CSS, '.skill-md-meta')).not.toMatch(/flex-shrink/);
    expect(declarations(SKILL_CSS, `${WINDOWED} .skill-md-blocks>:last-child`)).toMatch(declares('position', 'relative'));
    const spacer = declarations(SKILL_CSS, `${WINDOWED} .skill-md-blocks>:last-child::after`);
    expect(spacer).toMatch(declares('content', '""'));
    expect(spacer).toMatch(declares('position', 'absolute'));
    expect(spacer).toMatch(declares('top', '100%'));
    expect(spacer).toMatch(declares('height', '28px'));
    expect(spacer).toMatch(declares('pointer-events', 'none'));
  });
});

describe('?full=1 renders the whole document in one piece', () => {
  it.each(BODIES)('%s keeps visible overflow in full mode', body => {
    expect(declarations(SKILL_CSS, `${FULL} ${body}`)).toMatch(declares('overflow', 'visible'));
  });

  it.each(['.evals-tab', '.evals-body', '.skill-md-tab'])('%s keeps visible overflow in full mode', box => {
    // `.skill-md-tab` joined the list in batch F (2026-09-13): `?full=1&tab=skill` clipped at the tab box while
    // its blocks were already visible, so the tab printed in one piece only on the Evals boards.
    expect(declarations(SKILL_CSS, `${FULL} ${box}`)).toMatch(declares('overflow', 'visible'));
  });

  it('keeps the History rail visible in full mode', () => {
    expect(declarations(REPORT_CSS, `${FULL} .history-rail`)).toMatch(declares('overflow', 'visible'));
  });

  it('leaves the 28px on .detail-main and adds no other padding in full mode', () => {
    expect(declarations(SKILL_CSS, `${FULL} .detail-main`)).toMatch(declares('padding-bottom', '28px'));
    expect(declarations(SKILL_CSS, `${FULL} .detail-main`)).toMatch(declares('overflow', 'visible'));
    for (const path of FILES) {
      for (const rule of rules(path)) {
        const scoped = rule.selectors.filter(selector => selector.startsWith(FULL) && selector !== `${FULL} .detail-main`);
        if (scoped.length > 0) expect(rule.body, `${path}: ${scoped.join(',')}`).not.toMatch(/padding/);
      }
    }
  });

  it('scopes every pane rule to one mode, so no pane is left unscoped', () => {
    for (const body of [...BODIES, '.history-rail']) {
      const path = body === '.history-rail' ? REPORT_CSS : SKILL_CSS;
      expect(hasSelector(path, `${WINDOWED} ${body}`), `${body} has no windowed rule`).toBe(true);
      expect(hasSelector(path, `${FULL} ${body}`), `${body} has no full-mode rule`).toBe(true);
    }
  });
});

// Batch F (2026-09-13): the tab bodies are scroll containers with no focusable content of their own, so
// keyboard scrolling survived only through Chromium's keyboard-focusable-scroller heuristic and not on
// WKWebView. SkillScreen.tsx / EvaluationReport.tsx give each pane `tabIndex={0}` and a name (pinned in
// pane-focus.test.tsx); the ring is drawn INSIDE the box because the pane's parent clips it.
describe('a keyboard user can reach every pane', () => {
  it.each(BODIES)('%s shows the app’s focus ring inside its own box, on :focus-visible only', body => {
    const rule = declarations(SKILL_CSS, `${body}:focus-visible`);
    expect(rule).toMatch(declares('outline', '2px solid var(--tk-accent)'));
    expect(rule).toMatch(declares('outline-offset', '-2px'));
    // `:focus` would paint the ring on a mouse click too; only the keyboard-driven pseudo-class may.
    expect(hasSelector(SKILL_CSS, `${body}:focus`)).toBe(false);
  });

  it('rings the History rail from the file that owns the class', () => {
    const rule = declarations(REPORT_CSS, '.history-rail:focus-visible');
    expect(rule).toMatch(declares('outline', '2px solid var(--tk-accent)'));
    expect(rule).toMatch(declares('outline-offset', '-2px'));
    expect(hasSelector(SKILL_CSS, '.history-rail:focus-visible')).toBe(false);
  });

  it('lets Quality and Activity rows overflow into the pane instead of squashing', () => {
    // The rows are flex items of a `.board-column` inside a scrolling pane; without this a tab with more
    // rows than fit compressed them toward their min-content height and nothing scrolled.
    expect(declarations(SKILL_CSS, '.hygiene-row')).toMatch(declares('flex-shrink', '0'));
    expect(declarations(SKILL_CSS, '.activity-row')).toMatch(declares('flex-shrink', '0'));
  });
});

describe('the repo’s scrolling rules', () => {
  // `overflow-x`/`overflow-y` scroll exactly as the shorthand does, so the guard reads the longhands too — a
  // pane written as `overflow-y:auto` would otherwise have slipped past it (review fix, 2026-09-13).
  const scrolls = (body: string): boolean => ['overflow', 'overflow-x', 'overflow-y'].some(property => declares(property, 'auto').test(body));
  // The ONE scroller in these files that keeps its scrollbar, listed here so a new one cannot join it in
  // silence. `.md-table-wrap` scrolls a wide GFM table sideways on the real adapter; a horizontal scrollbar is
  // the only signal that the table continues past the column, and hiding it would leave the clipped columns
  // unreachable by mouse (COMMON §7: a control that cannot work must not pretend). The app's other table
  // wrapper, `.share-table-wrap` (share.css:1), shows its scrollbar for the same reason. Whether this one
  // should join the hidden-scrollbar pattern is a design call for the maintainer, not a polish batch.
  const SHOWS_ITS_SCROLLBAR = ['.md-table-wrap'];

  it('hides the scrollbar on every pane that scrolls, and reserves no gutter', () => {
    for (const path of FILES) {
      for (const rule of rules(path)) {
        const where = `${path}: ${rule.selectors.join(',')}`;
        expect(rule.body, where).not.toMatch(/scrollbar-gutter/);
        if (!scrolls(rule.body)) continue;
        if (rule.selectors.every(selector => SHOWS_ITS_SCROLLBAR.includes(selector))) continue;
        expect(rule.body, where).toMatch(declares('scrollbar-width', 'none'));
      }
    }
  });

  it('keeps the documented exception to one horizontal table wrapper', () => {
    // If the exception list ever stops matching the file, the rule above stops guarding what it claims to.
    const exempt = rules(SKILL_CSS).filter(rule => rule.selectors.some(selector => SHOWS_ITS_SCROLLBAR.includes(selector)) && scrolls(rule.body));
    expect(exempt.map(rule => rule.selectors.join(','))).toEqual(SHOWS_ITS_SCROLLBAR);
    expect(exempt[0]?.body).toMatch(declares('overflow-x', 'auto'));
    expect(exempt[0]?.body, 'an exempt scroller may only scroll sideways').not.toMatch(declares('overflow-y', 'auto'));
    expect(exempt[0]?.body, 'an exempt scroller may only scroll sideways').not.toMatch(declares('overflow', 'auto'));
  });

  it('never positions anything fixed', () => {
    for (const path of FILES) {
      for (const rule of rules(path)) {
        expect(rule.body, `${path}: ${rule.selectors.join(',')}`).not.toMatch(declares('position', 'fixed'));
      }
    }
  });
});
