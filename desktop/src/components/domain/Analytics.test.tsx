import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { design } from '../../backend/mock/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Providers } from '../../app/providers';
import { Analytics, AnalyticsSkeleton } from './Analytics';
import { overviewCopy } from '../../lib/overview-copy';
import type { LibraryOverview } from '../../backend/types';

afterEach(cleanup);

/** design.json predates the Unpublished tile (AGENTS.md invariant 3 forbids hand-editing it), so the
 *  fixture overview is lifted into the app shape here exactly as the backends lift it. */
const overviewOf=(over:Partial<LibraryOverview>={}):LibraryOverview=>
 ({...design.LIBRARY_OVERVIEW,unpublished:'0',unpublished_note:'',...over,zero:{...design.LIBRARY_OVERVIEW.zero,unpublished:overviewCopy.unpublished,...over.zero}});

it('renders the meter and provenance when populated, then only the supplied copy when empty (B1)',()=>{
 const overview=overviewOf({meter:{pass_:1,neutral:1,fail:1,total:4}}),provenance='test-model · test-cli · k=3';
 const {container,rerender}=render(<Providers><Analytics overview={overview} provenance={provenance}/></Providers>);
 expect(container.querySelectorAll('.analytics-meter span')).toHaveLength(4);
 expect(screen.getByText(overview.meter_text)).toBeVisible();expect(screen.getByText(provenance)).toBeVisible();
 // A zero count reads '0'; the row-wide `zero` prop is what draws the '—' glyph (and is covered below).
 const empty=overviewOf({evaluated:'0',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated});
 rerender(<Providers><Analytics overview={empty} provenance={provenance}/></Providers>);
 expect(screen.getByText('Nothing evaluated yet')).toBeVisible();
 expect(container.querySelector('.analytics-meter')).toBeNull();expect(screen.queryByText(provenance)).not.toBeInTheDocument();
 rerender(<Providers><Analytics overview={{...empty,meter_text:''}} provenance={provenance}/></Providers>);
 expect(screen.queryByText('Nothing evaluated yet')).not.toBeInTheDocument();
 expect(container.querySelector('.analytics-meter')).toBeNull();expect(screen.queryByText(provenance)).not.toBeInTheDocument();
});

// The bug: the Evaluated tile drew its count from the eval receipts and its caption from the meter,
// so a backend that reported a count with an unfilled meter rendered "2" over "Nothing evaluated yet".
// The count is the tile's own authority for its empty state now, whatever the meter says.
it.each(['2','13 of 15','1,024'])('never shows the zero caption over a nonzero count (%s)',value=>{
 render(<Providers><Analytics overview={overviewOf({evaluated:value,meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated})}/></Providers>);
 const tile=screen.getByText('Evaluated').closest('.stat-tile');
 expect(tile).toHaveTextContent(value);
 expect(tile).not.toHaveTextContent('Nothing evaluated yet');
});

it('shows the zero caption when the count is genuinely zero',()=>{
 render(<Providers><Analytics overview={overviewOf({evaluated:'0',meter:{pass_:0,neutral:0,fail:0,total:9},meter_text:overviewCopy.evaluated})}/></Providers>);
 const tile=screen.getByText('Evaluated').closest('.stat-tile');
 expect(tile).toHaveTextContent('Nothing evaluated yet');
 expect(tile?.querySelector('.analytics-meter')).toBeNull();
});

// A dash is what a backend draws when it cannot support a number. It is an unknown, not a zero, so no
// tile may pair it with its zero caption — the same contradiction as "2 · Nothing evaluated yet".
it.each(['—','','unknown'])('never pairs an unknown count with a zero caption (%s)',value=>{
 render(<Providers><Analytics overview={overviewOf({evaluated:value,meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated,unpublished:value})}/></Providers>);
 expect(screen.getByText('Evaluated').closest('.stat-tile')).not.toHaveTextContent('Nothing evaluated yet');
 expect(screen.getByText('Unpublished').closest('.stat-tile')).not.toHaveTextContent(overviewCopy.unpublished);
});

it('draws the count with no zero claim when the number is an unknown, not a zero',()=>{
 render(<Providers><Analytics overview={overviewOf({evaluated:'unknown',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:''})}/></Providers>);
 const tile=screen.getByText('Evaluated').closest('.stat-tile');
 expect(tile).toHaveTextContent('unknown');
 expect(tile).not.toHaveTextContent('Nothing evaluated yet');
});

// Loading is a third state, never a zero: LibraryScreen draws the skeleton while the read is pending,
// so no tile can assert "nothing yet" about data it does not have.
it('keeps loading distinct from zero — the skeleton asserts no counts or captions',()=>{
 const {container}=render(<AnalyticsSkeleton/>);
 expect(container.querySelectorAll('.stat-tile')).toHaveLength(4);
 expect(container).toHaveTextContent('');
 for(const note of Object.values(overviewCopy))expect(screen.queryByText(note)).not.toBeInTheDocument();
 expect(screen.queryByText('Evaluated')).not.toBeInTheDocument();
});

it('counts unpublished skills in the fourth tile and captions zero without contradicting it',()=>{
 const {rerender}=render(<Providers><Analytics overview={overviewOf({unpublished:'3',unpublished_note:'never published to the marketplace'})}/></Providers>);
 let tile=screen.getByText('Unpublished').closest('.stat-tile');
 expect(tile).toHaveTextContent('3');expect(tile).toHaveTextContent('never published to the marketplace');
 expect(tile).not.toHaveTextContent(overviewCopy.unpublished);
 rerender(<Providers><Analytics overview={overviewOf({unpublished:'0',unpublished_note:''})}/></Providers>);
 tile=screen.getByText('Unpublished').closest('.stat-tile');
 expect(tile).toHaveTextContent('0');expect(tile).toHaveTextContent(overviewCopy.unpublished);
 rerender(<Providers><Analytics overview={overviewOf({unpublished:'—',unpublished_note:''})}/></Providers>);
 tile=screen.getByText('Unpublished').closest('.stat-tile');
 expect(tile).toHaveTextContent('—');
 expect(tile).not.toHaveTextContent(overviewCopy.unpublished);
 expect(screen.queryByText('Team installs')).not.toBeInTheDocument();
});

it('renders population notes without a sparkline or delta arrows (RM-16)', () => {
  const { container } = render(<Providers><Analytics overview={overviewOf({unpublished:'2',unpublished_note:'never published to the marketplace'})}/></Providers>);
  expect(screen.getByText('7 endorsed to Global')).toBeInTheDocument();
  expect(screen.getByText('never published to the marketplace')).toBeInTheDocument();
  expect(container.querySelectorAll('svg, .analytics-delta')).toHaveLength(0);
  expect(container).not.toHaveTextContent('this month');
  expect(container).not.toHaveTextContent('this week');
});

it('keeps the zero-state notes (RM-16)', () => {
  const overview=overviewOf();
  render(<Providers><Analytics overview={overview} zero/></Providers>);
  for (const note of [overview.zero.skills,overview.zero.evaluated,overview.zero.unpublished,overview.zero.attention]) expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.queryByText(design.LIBRARY_OVERVIEW.skills_note)).not.toBeInTheDocument();
});

it.each([true,false])('omits an empty attention anchor when inbox=%s without dropping attention lines',inbox=>{
 const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});client.setQueryData(['surfaces'],{inbox});
 const {container}=render(<QueryClientProvider client={client}><Analytics overview={overviewOf({attention_link:''})}/></QueryClientProvider>);
 expect(container.querySelector('a')).toBeNull();
 for(const line of design.LIBRARY_OVERVIEW.attention_lines)expect(screen.getByText(line)).toBeVisible();
});
