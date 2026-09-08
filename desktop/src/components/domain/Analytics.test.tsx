import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { design } from '../../backend/mock/data';
import { Analytics } from './Analytics';

afterEach(cleanup);

it('renders population notes without a sparkline or delta arrows (RM-16)', () => {
  const { container } = render(<Analytics overview={design.LIBRARY_OVERVIEW}/>);
  expect(screen.getByText('7 endorsed to Global')).toBeInTheDocument();
  expect(screen.getByText('across every people file · 12 active teammates')).toBeInTheDocument();
  expect(container.querySelectorAll('svg, .analytics-delta')).toHaveLength(0);
  expect(container).not.toHaveTextContent('this month');
  expect(container).not.toHaveTextContent('this week');
});

it('keeps the zero-state notes (RM-16)', () => {
  render(<Analytics overview={design.LIBRARY_OVERVIEW} zero/>);
  for (const note of Object.values(design.LIBRARY_OVERVIEW.zero)) expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.queryByText(design.LIBRARY_OVERVIEW.skills_note)).not.toBeInTheDocument();
});
