import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Chip } from './Chip';
import { Icon } from './Icon';

afterEach(cleanup);

it('wraps text in the chip label used for truncation', () => {
  render(<Chip>in ~/Documents/Terum/skill-management-software</Chip>);
  const label = screen.getByText('in ~/Documents/Terum/skill-management-software');
  expect(label).toHaveClass('chip-label');
  expect(label.parentElement).toHaveClass('chip');
});

it('keeps the installed tick and text together inside the chip label', () => {
  render(<Chip><Icon name="check" size={12}/>Installed · on this machine</Chip>);
  const label = screen.getByText('Installed · on this machine');
  expect(label).toHaveClass('chip-label');
  expect(label.firstChild).toBe(label.querySelector('svg'));
  expect(label.querySelector('svg')).toHaveAttribute('width', '12');
  expect(label.lastChild?.textContent).toBe('Installed · on this machine');
});
