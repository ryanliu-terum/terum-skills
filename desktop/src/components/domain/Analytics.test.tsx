import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { design } from '../../backend/mock/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Providers } from '../../app/providers';
import { Analytics } from './Analytics';
import { overviewCopy } from '../../lib/overview-copy';

afterEach(cleanup);

it('renders the meter and provenance when populated, then only the supplied copy when empty (B1)',()=>{
 const overview={...design.LIBRARY_OVERVIEW,meter:{pass_:1,neutral:1,fail:1,total:4}},provenance='test-model · test-cli · k=3';
 const {container,rerender}=render(<Providers><Analytics overview={overview} provenance={provenance}/></Providers>);
 expect(container.querySelectorAll('.analytics-meter span')).toHaveLength(4);
 expect(screen.getByText(overview.meter_text)).toBeVisible();expect(screen.getByText(provenance)).toBeVisible();
 const empty={...overview,evaluated:'—',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:overviewCopy.evaluated};
 rerender(<Providers><Analytics overview={empty} provenance={provenance}/></Providers>);
 expect(screen.getByText('Nothing evaluated yet')).toBeVisible();
 expect(container.querySelector('.analytics-meter')).toBeNull();expect(screen.queryByText(provenance)).not.toBeInTheDocument();
 rerender(<Providers><Analytics overview={{...empty,meter_text:''}} provenance={provenance}/></Providers>);
 expect(screen.queryByText('Nothing evaluated yet')).not.toBeInTheDocument();
 expect(container.querySelector('.analytics-meter')).toBeNull();expect(screen.queryByText(provenance)).not.toBeInTheDocument();
});

it('renders population notes without a sparkline or delta arrows (RM-16)', () => {
  const { container } = render(<Providers><Analytics overview={design.LIBRARY_OVERVIEW}/></Providers>);
  expect(screen.getByText('7 endorsed to Global')).toBeInTheDocument();
  expect(screen.getByText('across every people file · 12 active teammates')).toBeInTheDocument();
  expect(container.querySelectorAll('svg, .analytics-delta')).toHaveLength(0);
  expect(container).not.toHaveTextContent('this month');
  expect(container).not.toHaveTextContent('this week');
});

it('keeps the zero-state notes (RM-16)', () => {
  render(<Providers><Analytics overview={design.LIBRARY_OVERVIEW} zero/></Providers>);
  for (const note of Object.values(design.LIBRARY_OVERVIEW.zero)) expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.queryByText(design.LIBRARY_OVERVIEW.skills_note)).not.toBeInTheDocument();
});

it.each([true,false])('omits an empty attention anchor when inbox=%s without dropping attention lines',inbox=>{
 const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});client.setQueryData(['surfaces'],{inbox});
 const {container}=render(<QueryClientProvider client={client}><Analytics overview={{...design.LIBRARY_OVERVIEW,attention_link:''}}/></QueryClientProvider>);
 expect(container.querySelector('a')).toBeNull();
 for(const line of design.LIBRARY_OVERVIEW.attention_lines)expect(screen.getByText(line)).toBeVisible();
});
