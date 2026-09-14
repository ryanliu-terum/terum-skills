import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { cardOf, design } from '../../backend/mock/data';
import type { SkillCard as Card } from '../../backend/types';
import { SkillCard } from './SkillCard';
import { evalVersionLabel, installedVersionBehind, libraryVersionLabel, marketplaceVersionLabel } from './presentation';

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
 // Cross-mirror overlays spec §3.2 state 1: a card the viewer never installed still names the team's version.
 expect(marketplaceVersionLabel(card({installedVersion:null}))).toBe('Version 10');
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
 expect(screen.getByText('Version 10')).toHaveClass('card-version-label');
});
it('renders the curated profile version independently of the latest version and eval', () => {
 show(card({profileVersion:'v1'}));
 expect(screen.getByText('On profile · Version 1')).toBeInTheDocument();
 expect(screen.getByText('from Version 3 · latest Version 10')).toBeInTheDocument();
});

// Cross-mirror overlays spec §3.2 — the Marketplace version slot is always filled once the latest is known.
it.each([
 [{installedVersion:null,localMatch:null},'Version 10'],
 [{installedVersion:null,localMatch:'identical'},'Version 10'],
 [{installedVersion:null,localMatch:'differs'},'Version 10 · your copy differs'],
 [{installedVersion:'v10',localMatch:'identical'},'Version 10 · installed'],
 [{installedVersion:'v2',localMatch:'identical'},'Version 10 · you have Version 2'],
 [{latestVersion:null,installedVersion:null},null],
] satisfies [Partial<Card>,string|null][])('fills the Marketplace version slot for %j', (over,label) => {
 expect(marketplaceVersionLabel(card(over))).toBe(label);
});
// §3.1 — the Library version slot, top to bottom, first match wins; a pre-overlay CLI (localMatch null) says nothing.
const libraryCard=(over:Partial<Card>={}):Card=>card({teamed:false,path:'/Users/x/.claude/skills/'+design.CATALOG[0]!.name,latestVersion:null,evalVersion:null,evalStale:false,latestEvalState:null,installs:'—',installsN:0,...over});
it.each([
 [{installedVersion:'v3',localMatch:'identical',placed:true},'Version 3'],
 [{installedVersion:'v3',localMatch:'identical',placed:false},'Version 3'],
 [{installedVersion:'v3',localMatch:'differs',placed:true},'Edited from Version 3'],
 [{installedVersion:null,localMatch:'differs',placed:true},'Edited'],
 [{installedVersion:null,localMatch:'differs',placed:false,knownToTeam:true},'Edited'],
 [{installedVersion:null,localMatch:'none',placed:false,knownToTeam:false},'Unpublished'],
 [{installedVersion:null,localMatch:null,placed:false},null],
] satisfies [Partial<Card>,string|null][])('fills the Library version slot for %j', (over,label) => {
 expect(libraryVersionLabel(libraryCard(over))).toBe(label);
});
it('puts the Library version line on the card face and never the installed check', () => {
 show(libraryCard({installedVersion:null,localMatch:'none',placed:false,installed:'placed',onDiskOnly:true}));
 expect(screen.getByText('Unpublished')).toHaveClass('card-version-label');
 expect(screen.queryByText('Installed · on this machine')).toBeNull();
 expect(screen.queryByRole('img',{name:'Installed on this machine'})).toBeNull();
});
// Ledger D5: the chip's words became the version line; the green check stays as the glanceable "you have this".
it('marks an installed Marketplace card with the check and no chip text', () => {
 show(card({installedVersion:'v10',localMatch:'identical',installed:'placed',placed:true,onDiskOnly:false}));
 expect(screen.getByText('Version 10 · installed')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Installed on this machine'})).toBeInTheDocument();
 expect(screen.queryByText('Installed · on this machine')).toBeNull();
 cleanup();
 show(card({installedVersion:null,localMatch:null,installed:'absent',placed:false,onDiskOnly:false}));
 expect(screen.queryByRole('img',{name:'Installed on this machine'})).toBeNull();
});
it('offers Publish for an on-disk copy whose bytes match no version, routed to the publish dialog', () => {
 const skill=card({installedVersion:null,localMatch:'differs',installed:'placed',placed:false,onDiskOnly:true,path:'/Users/x/.claude/skills/'+design.CATALOG[0]!.name});show(skill);
 expect(screen.getByText('Version 10 · your copy differs')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Installed on this machine'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Publish'}));
 expect(screen.getByLabelText('route')).toHaveTextContent('/skill/'+skill.name+'?dialog=publish&root=marketplace');
 cleanup();
 show(card({installedVersion:null,localMatch:'identical',installed:'placed',placed:false,onDiskOnly:true}));
 expect(screen.queryByRole('button',{name:'Publish'})).toBeNull();
});
