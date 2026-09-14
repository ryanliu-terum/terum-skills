import { expect, it } from 'vitest';
import type { ReceiptSummary, SkillCard } from '../../backend/types';
import { activeLibraryFacetCount, cardVerdict, emptyFacets, libraryCategories, libraryFacetMatches, libraryQueryMatches, libraryVerdictCounts, LIBRARY_STATES, LIBRARY_STATE_LABELS, parseLibraryFacets, serializeLibraryFacets, stripLibraryFacets } from './library-facets';
import type { LibraryFacets } from './library-facets';

function summary(verdict: ReceiptSummary['verdict']): ReceiptSummary { return { w: 1, l: 0, t: 0, n: 1, lift: 100, verdict, partial: null, signP: '1.000' }; }
/** Only the fields the facets read. Everything else on a card is irrelevant to the predicate. */
function card(part: Partial<SkillCard> & { name: string }): SkillCard {
  return { category: 'infra', desc: '', teamed: false, edited: false, flags: [], summary: null, localEval: null, ...part } as unknown as SkillCard;
}
const facets = (part: Partial<LibraryFacets>): LibraryFacets => ({ ...emptyFacets(), ...part });

it('round-trips a selection through the URL with active in lockstep', () => {
  const selection = facets({ verdicts: ['PASS', 'FAIL'], categories: ['infra', 'docs'], states: ['edited'] });
  const params = serializeLibraryFacets(selection, new URLSearchParams('q=deploy&sort=name'));
  expect(params.get('verdicts')).toBe('PASS,FAIL');
  expect(params.get('category')).toBe('infra,docs');
  expect(params.get('state')).toBe('edited');
  expect(params.get('active')).toBe('3');
  // Params that are not facets survive the write.
  expect(params.get('q')).toBe('deploy');
  expect(params.get('sort')).toBe('name');
  expect(parseLibraryFacets(params)).toEqual(selection);
});

it('writes only constraining groups and deletes the neutral ones', () => {
  const params = serializeLibraryFacets(facets({ verdicts: ['PASS'] }), new URLSearchParams('category=infra&state=edited&active=9'));
  expect(params.get('verdicts')).toBe('PASS');
  expect(params.get('category')).toBeNull();
  expect(params.get('state')).toBeNull();
  expect(params.get('active')).toBe('1');
  const cleared = serializeLibraryFacets(emptyFacets(), params);
  expect([...cleared.keys()]).toEqual(['active']);
  expect(cleared.get('active')).toBe('0');
});

it('counts one active group per non-empty selection, never one per value', () => {
  expect(activeLibraryFacetCount(emptyFacets())).toBe(0);
  expect(activeLibraryFacetCount(facets({ verdicts: ['PASS', 'FAIL', 'NEUTRAL'] }))).toBe(1);
  expect(activeLibraryFacetCount(facets({ verdicts: ['PASS'], categories: ['infra'], states: ['edited'] }))).toBe(3);
});

it('reads nothing back when no facet key is present, and strips every facet key', () => {
  expect(parseLibraryFacets(new URLSearchParams())).toBeNull();
  expect(parseLibraryFacets(new URLSearchParams('q=deploy&active=2&filters=open'))).toBeNull();
  expect(parseLibraryFacets(new URLSearchParams('verdicts='))).toEqual(emptyFacets());
  const stripped = stripLibraryFacets(new URLSearchParams('verdicts=PASS&category=infra&state=edited&q=x&active=3'));
  expect([...stripped.keys()].sort()).toEqual(['active', 'q']);
});

it('degrades a malformed closed-set value to neutral instead of to "matches nothing"', () => {
  const parsed = parseLibraryFacets(new URLSearchParams('verdicts=PASS,NONSENSE&state=edited,teleported&category=infra'));
  expect(parsed).toEqual(facets({ verdicts: ['PASS'], categories: ['infra'], states: ['edited'] }));
  // Every member unrecognised: the group is empty, so it constrains nothing at all.
  expect(parseLibraryFacets(new URLSearchParams('verdicts=nope&state=nope'))).toEqual(emptyFacets());
  // A link written before the two team chips were withdrawn degrades the same way: neutral, not empty.
  expect(parseLibraryFacets(new URLSearchParams('state=shared'))).toEqual(emptyFacets());
  expect(parseLibraryFacets(new URLSearchParams('state=local,edited'))).toEqual(facets({ states: ['edited'] }));
});

it('round-trips a category whose own text contains the separator or an escape', () => {
  const odd = facets({ categories: ['data, ops', '100%', 'a&b'] });
  const params = serializeLibraryFacets(odd, new URLSearchParams());
  expect(parseLibraryFacets(params)).toEqual(odd);
  // A hand-typed malformed escape keeps its raw text rather than throwing away the whole group.
  expect(parseLibraryFacets(new URLSearchParams('category=%ZZ,infra'))).toEqual(facets({ categories: ['%ZZ', 'infra'] }));
});

it('files a card under its team receipt, else its local one, else "Not evaluated"', () => {
  expect(cardVerdict(card({ name: 'a', summary: summary('PASS') }))).toBe('PASS');
  expect(cardVerdict(card({ name: 'b', localEval: { ...summary('FAIL'), runnerHandle: null, version: null } }))).toBe('FAIL');
  expect(cardVerdict(card({ name: 'c' }))).toBe('Not evaluated');
  expect(libraryVerdictCounts([card({ name: 'a', summary: summary('PASS') }), card({ name: 'b' }), card({ name: 'c' })])).toEqual([['PASS', 1], ['NEUTRAL', 0], ['FAIL', 0], ['Not evaluated', 2]]);
});

it('matches each state predicate on its own datum', () => {
  const plainCard = card({ name: 'plain' });
  const edited = card({ name: 'edited', edited: true });
  const broken = card({ name: 'broken', flags: ['broken'] });
  expect(libraryFacetMatches(edited, facets({ states: ['edited'] }))).toBe(true);
  expect(libraryFacetMatches(plainCard, facets({ states: ['edited'] }))).toBe(false);
  expect(libraryFacetMatches(broken, facets({ states: ['attention'] }))).toBe(true);
  expect(libraryFacetMatches(plainCard, facets({ states: ['attention'] }))).toBe(false);
  expect(libraryFacetMatches(edited, facets({ states: ['attention'] }))).toBe(false);
  expect(libraryFacetMatches(card({ name: 'flagged-local', flags: ['local'] }), facets({ states: ['attention'] }))).toBe(false);
});

it('offers only the two states the Library read model can answer, and never reads team membership', () => {
  // Every Library card carries teamed:false on both backends — localCard/notOfferedCard on the real
  // adapter and localProjection on the mock — so a "Shared with team" chip could only ever match nothing
  // and a "Local only" chip could only ever match everything. Neither is offered (COMMON §7), and neither
  // datum is consulted: a card that somehow arrives teamed is filtered exactly like any other.
  expect([...LIBRARY_STATES]).toEqual(['edited', 'attention']);
  expect(Object.values(LIBRARY_STATE_LABELS)).toEqual(['Edited', 'Needs attention']);
  expect(Object.values(LIBRARY_STATE_LABELS).some(label => /team|shared|local/i.test(label))).toBe(false);
  const teamed = card({ name: 'teamed', teamed: true, edited: true });
  expect(libraryFacetMatches(teamed, facets({ states: ['edited'] }))).toBe(true);
  expect(libraryFacetMatches(card({ name: 'teamed-plain', teamed: true }), facets({ states: ['edited'] }))).toBe(false);
});

it('ORs inside a group and ANDs between groups', () => {
  const target = card({ name: 'deploy-check', category: 'infra', summary: summary('PASS'), edited: true });
  expect(libraryFacetMatches(target, facets({ verdicts: ['FAIL', 'PASS'] }))).toBe(true);
  expect(libraryFacetMatches(target, facets({ states: ['attention', 'edited'] }))).toBe(true);
  expect(libraryFacetMatches(target, facets({ verdicts: ['PASS'], categories: ['infra'] }))).toBe(true);
  expect(libraryFacetMatches(target, facets({ verdicts: ['PASS'], categories: ['docs'] }))).toBe(false);
  expect(libraryFacetMatches(target, facets({ verdicts: ['FAIL'], categories: ['infra'] }))).toBe(false);
});

it('never excludes a card for a datum a facet does not name', () => {
  // No receipt of either kind, and the em dash category the real adapter serves for an uncategorised folder.
  const bare = card({ name: 'bare', category: '—' });
  expect(libraryFacetMatches(bare, emptyFacets())).toBe(true);
  expect(libraryFacetMatches(bare, facets({ categories: ['infra'] }))).toBe(false);
  expect(libraryFacetMatches(bare, facets({ verdicts: ['Not evaluated'] }))).toBe(true);
  // `edited` and `broken` are data the card really carries, so a folder that is neither is genuinely
  // excluded by a facet that names them — unlike team membership, which the Library does not know and
  // therefore does not offer as a facet at all.
  expect(libraryFacetMatches(bare, facets({ states: ['edited', 'attention'] }))).toBe(false);
  // …and the placeholder is never offered as a chip, so the user cannot filter on "we do not know".
  expect(libraryCategories([bare, card({ name: 'x', category: 'ops' }), card({ name: 'y', category: 'docs' }), card({ name: 'z', category: 'ops' }), card({ name: 'w', category: '' })])).toEqual(['docs', 'ops']);
});

it('keeps the query predicate the screen has always used', () => {
  const target = card({ name: 'deploy-check', desc: 'Runs the pre-deploy checklist' });
  expect(libraryQueryMatches(target, '')).toBe(true);
  expect(libraryQueryMatches(target, 'DEPLOY')).toBe(true);
  expect(libraryQueryMatches(target, 'checklist')).toBe(true);
  expect(libraryQueryMatches(target, 'deploy prod')).toBe(false);
});
