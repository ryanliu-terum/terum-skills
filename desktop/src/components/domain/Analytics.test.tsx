import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { design } from '../../backend/mock/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Providers } from '../../app/providers';
import { Analytics } from './Analytics';

afterEach(cleanup);

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
