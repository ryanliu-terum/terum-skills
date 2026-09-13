import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { cardOf, design } from '../../backend/mock/data';
import type { SkillCard as Card } from '../../backend/types';
import { SkillCard } from './SkillCard';
import { evalVersionLabel, installedVersionBehind, marketplaceVersionLabel } from './presentation';

afterEach(() => { cleanup(); localStorage.clear(); });
const card = (over:Partial<Card> = {}):Card => ({...cardOf(design.CATALOG[0]!),latestVersion:'v10',installedVersion:'v2',evalVersion:3,evalStale:true,latestEvalState:'none',...over});
function Route() { const location=useLocation(); return <output aria-label="route">{location.pathname+location.search}</output>; }
function show(skill:Card) {
 return render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/marketplace']}><SkillCard skill={skill}/><Route/></MemoryRouter></QueryClientProvider></BackendContext>);
}
it.each([
 [{},'from Version 3 · latest Version 10'],
 [{latestEvalState:'invalid'},'from Version 3 · Version 10 unreadable'],
 [{evalStale:false,evalVersion:10},null],
 [{evalVersion:null},null],
 [{latestVersion:null},null],
] satisfies [Partial<Card>,string|null][])('discloses the selected score version %j', (over,label) => {
 expect(evalVersionLabel(card(over))).toBe(label);
});
it('puts stale eval disclosure on the card face as a text node, never just a hover title', () => {
 show(card({latestEvalState:'invalid'}));
 const label=screen.getByText('from Version 3 · Version 10 unreadable');
 expect(label).toHaveClass('card-version-label');
 expect(label.closest('.skill-card-bottom')).not.toBeNull();
 expect(label).not.toHaveAttribute('title');
 expect(screen.getByText('Version 10 · you have Version 2')).toBeInTheDocument();
});
it('opens the latest-version install dialog from Reinstall while preserving the marketplace origin', () => {
 const skill=card();show(skill);
 fireEvent.click(screen.getByRole('button',{name:'Reinstall'}));
 expect(screen.getByLabelText('route')).toHaveTextContent('/skill/'+skill.name+'?dialog=install&root=marketplace');
});
it('shows parity without a Reinstall action and compares versions numerically', () => {
 const skill=card({installedVersion:'v10',evalVersion:10,evalStale:false});show(skill);
 expect(screen.getByText('Version 10 · installed')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Reinstall'})).toBeNull();
 expect(installedVersionBehind(card())).toBe(true);
 expect(installedVersionBehind(card({installedVersion:'v11'}))).toBe(false);
 expect(installedVersionBehind(card({installedVersion:null}))).toBe(false);
 // §8.3 names two states, both about a copy on this machine; a card the viewer never installed says nothing.
 expect(marketplaceVersionLabel(card({installedVersion:null}))).toBeNull();
});
it('keeps the project / category identity line in every version state and puts the version copy in the footer', () => {
 const skill=card();show(skill);
 expect(document.querySelector('.skill-card-ident span')?.textContent).toBe(skill.project+' / '+skill.category);
 const label=screen.getByText('Version 10 · you have Version 2');
 expect(label).toHaveClass('card-version-label');
 expect(label.closest('.skill-card-bottom')).not.toBeNull();
 cleanup();
 show(card({installedVersion:null}));
 expect(document.querySelector('.skill-card-ident span')?.textContent).toBe(skill.project+' / '+skill.category);
 expect(screen.queryByText('Version 10')).toBeNull();
});
it('renders the curated profile version independently of the latest version and eval', () => {
 show(card({profileVersion:'v1'}));
 expect(screen.getByText('On profile · Version 1')).toBeInTheDocument();
 expect(screen.getByText('from Version 3 · latest Version 10')).toBeInTheDocument();
});
