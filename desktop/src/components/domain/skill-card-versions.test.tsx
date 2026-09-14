import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { cardOf, design } from '../../backend/mock/data';
import type { SkillCard as Card } from '../../backend/types';
import { SkillCard } from './SkillCard';
import { cardVersionLabel } from '../../../../src/lib/versions.js';
import { evalVersionLabel, installedVersionBehind, installsChip, libraryVersionLabel, localEvalNote, marketplaceVersionLabel } from './presentation';

afterEach(() => { cleanup(); localStorage.clear(); });
const card = (over:Partial<Card> = {}):Card => ({...cardOf(design.CATALOG[0]!),latestVersion:'v10',installedVersion:'v2',evalVersion:3,evalStale:true,latestEvalState:'none',...over});
function Route() { const location=useLocation(); return <output aria-label="route">{location.pathname+location.search}</output>; }
function show(skill:Card) {
 return render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/marketplace']}><SkillCard skill={skill}/><Route/></MemoryRouter></QueryClientProvider></BackendContext>);
}
// Cross-mirror overlays review walk D4b: a CARD says `vN`; prose (dialogs, terminal, README) keeps "Version N".
it('abbreviates a version to vN on cards only', () => {
 expect(cardVersionLabel(10)).toBe('v10');
});
it.each([
 [{},'from v3 · latest v10'],
 [{latestEvalState:'invalid'},'from v3 · v10 unreadable'],
 [{evalStale:false,evalVersion:10},null],
 [{evalVersion:null},null],
 [{latestVersion:null},null],
] satisfies [Partial<Card>,string|null][])('discloses the selected score version %j', (over,label) => {
 expect(evalVersionLabel(card(over))).toBe(label);
});
it('puts stale eval disclosure on the card face as a text node, never just a hover title', () => {
 show(card({latestEvalState:'invalid'}));
 const label=screen.getByText('from v3 · v10 unreadable');
 expect(label).toHaveClass('card-version-label');
 expect(label.closest('.skill-card-bottom')).not.toBeNull();
 expect(label).not.toHaveAttribute('title');
 expect(screen.getByText('v10 · you have v2')).toBeInTheDocument();
});
it('opens the latest-version install dialog from Reinstall while preserving the marketplace origin', () => {
 const skill=card();show(skill);
 fireEvent.click(screen.getByRole('button',{name:'Reinstall'}));
 expect(screen.getByLabelText('route')).toHaveTextContent('/skill/'+skill.name+'?dialog=install&root=marketplace');
});
it('shows parity without a Reinstall action and compares versions numerically', () => {
 const skill=card({installedVersion:'v10',evalVersion:10,evalStale:false});show(skill);
 expect(screen.getByText('v10 · installed')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Reinstall'})).toBeNull();
 expect(installedVersionBehind(card())).toBe(true);
 expect(installedVersionBehind(card({installedVersion:'v11'}))).toBe(false);
 expect(installedVersionBehind(card({installedVersion:null}))).toBe(false);
 // Cross-mirror overlays spec §3.2 state 1: a card the viewer never installed still names the team's version.
 expect(marketplaceVersionLabel(card({installedVersion:null}))).toBe('v10');
});
it('keeps the project / category identity line in every version state and puts the version copy in the footer', () => {
 const skill=card();show(skill);
 expect(document.querySelector('.skill-card-ident span')?.textContent).toBe(skill.project+' / '+skill.category);
 const label=screen.getByText('v10 · you have v2');
 expect(label).toHaveClass('card-version-label');
 expect(label.closest('.skill-card-bottom')).not.toBeNull();
 cleanup();
 show(card({installedVersion:null}));
 expect(document.querySelector('.skill-card-ident span')?.textContent).toBe(skill.project+' / '+skill.category);
 expect(screen.getByText('v10')).toHaveClass('card-version-label');
});
it('renders the curated profile version independently of the latest version and eval', () => {
 show(card({profileVersion:'v1'}));
 expect(screen.getByText('On profile · v1')).toBeInTheDocument();
 expect(screen.getByText('from v3 · latest v10')).toBeInTheDocument();
});

// Cross-mirror overlays spec §3.2 — the Marketplace version slot is always filled once the latest is known.
// State 3b (review walk D2b): an installed copy whose bytes match no version says so, even on the latest —
// "installed" is reserved for exact bytes.
it.each([
 [{installedVersion:null,localMatch:null},'v10'],
 [{installedVersion:null,localMatch:'identical'},'v10'],
 [{installedVersion:null,localMatch:'differs'},'v10 · your copy differs'],
 [{installedVersion:'v10',localMatch:'identical'},'v10 · installed'],
 [{installedVersion:'v2',localMatch:'identical'},'v10 · you have v2'],
 [{installedVersion:'v2',localMatch:null},'v10 · you have v2'],
 [{installedVersion:'v2',localMatch:'differs'},'v10 · you have v2 (edited)'],
 [{installedVersion:'v10',localMatch:'differs'},'v10 · you have v10 (edited)'],
 [{latestVersion:null,installedVersion:null},null],
] satisfies [Partial<Card>,string|null][])('fills the Marketplace version slot for %j', (over,label) => {
 expect(marketplaceVersionLabel(card(over))).toBe(label);
});
// §3.1 — the Library version slot, top to bottom, first match wins; a pre-overlay CLI (localMatch null) says nothing.
const libraryCard=(over:Partial<Card>={}):Card=>card({teamed:false,path:'/Users/x/.claude/skills/'+design.CATALOG[0]!.name,latestVersion:null,evalVersion:null,evalStale:false,latestEvalState:null,installs:'—',installsN:0,...over});
it.each([
 [{installedVersion:'v3',localMatch:'identical',placed:true},'v3'],
 [{installedVersion:'v3',localMatch:'identical',placed:false},'v3'],
 [{installedVersion:'v3',localMatch:'differs',placed:true},'v3 (edited)'],
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
// The `in <root>` chip is a team-card affordance (Ryan, 2026-09-14): a Marketplace card's identity line names the
// endorsement, so the root is news; a Library card's identity line already IS the root. A local project card must
// therefore draw no chip, so moving a folder between Global and a checkout changes nothing but the identity line.
const ROOT='~/Documents/Terum/skill-management-software';
it('draws the in-root chip on a team card only, so a local project card matches its Global twin', () => {
 show(card({teamed:true,installedVersion:null,localMatch:'differs',installed:'placed',placed:false,onDiskOnly:true,projectRoots:[ROOT]}));
 expect(screen.getByText('in '+ROOT)).toBeInTheDocument();
 cleanup();
 show(libraryCard({installedVersion:null,localMatch:'none',placed:false,installed:'placed',onDiskOnly:true,projectRoots:[ROOT]}));
 expect(screen.queryByText('in '+ROOT)).toBeNull();
 expect(screen.getByText('Unpublished')).toHaveClass('card-version-label');
 cleanup();
 // The Global twin of that same folder: no repoRoot upstream, hence no chip either — the two boards now agree.
 show(libraryCard({installedVersion:null,localMatch:'none',placed:false,installed:'placed',onDiskOnly:true,projectRoots:[]}));
 expect(screen.queryByText(/^in /)).toBeNull();
});
// Ledger D5 + review walk D4: the chip's words became the version line, and the green check sits INSIDE the
// version unit (one `.card-version` element in the left group), so the words and the check never split rows.
it('marks an installed Marketplace card with the check inside the version unit and no chip text', () => {
 show(card({installedVersion:'v10',localMatch:'identical',installed:'placed',placed:true,onDiskOnly:false}));
 const label=screen.getByText('v10 · installed'),check=screen.getByRole('img',{name:'Installed on this machine'});
 const unit=label.closest('.card-version');
 expect(unit).not.toBeNull();
 expect(check.closest('.card-version')).toBe(unit);
 expect(unit!.parentElement).toBe(unit!.closest('.skill-card-bottom')!.firstElementChild);
 expect(screen.queryByText('Installed · on this machine')).toBeNull();
 cleanup();
 show(card({installedVersion:null,localMatch:null,installed:'absent',placed:false,onDiskOnly:false}));
 expect(screen.queryByRole('img',{name:'Installed on this machine'})).toBeNull();
});
it('offers Publish for an on-disk copy whose bytes match no version, routed to the publish dialog', () => {
 const skill=card({installedVersion:null,localMatch:'differs',installed:'placed',placed:false,onDiskOnly:true,path:'/Users/x/.claude/skills/'+design.CATALOG[0]!.name});show(skill);
 expect(screen.getByText('v10 · your copy differs')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Installed on this machine'}).closest('.card-version')).toBe(screen.getByText('v10 · your copy differs').closest('.card-version'));
 fireEvent.click(screen.getByRole('button',{name:'Publish'}));
 expect(screen.getByLabelText('route')).toHaveTextContent('/skill/'+skill.name+'?dialog=publish&root=marketplace');
 cleanup();
 show(card({installedVersion:null,localMatch:'identical',installed:'placed',placed:false,onDiskOnly:true}));
 expect(screen.queryByRole('button',{name:'Publish'})).toBeNull();
});
// Review walk D2 / D2b: an edited install shows the check and Reinstall (when behind) and never Publish — two
// opposing write buttons on one row is a footgun; edits are published from the Library.
it('labels an edited install, keeps Reinstall only when behind, and offers no Publish', () => {
 const path='/Users/x/.claude/skills/'+design.CATALOG[0]!.name;
 show(card({installedVersion:'v2',localMatch:'differs',installed:'placed',placed:true,onDiskOnly:false,path}));
 expect(screen.getByText('v10 · you have v2 (edited)')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Installed on this machine'}).closest('.card-version')).toBe(screen.getByText('v10 · you have v2 (edited)').closest('.card-version'));
 expect(screen.getByRole('button',{name:'Reinstall'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Publish'})).toBeNull();
 cleanup();
 show(card({installedVersion:'v10',localMatch:'differs',installed:'placed',placed:true,onDiskOnly:false,path}));
 expect(screen.getByText('v10 · you have v10 (edited)')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Reinstall'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Publish'})).toBeNull();
});
// Review walk D1: the bytes decide. A placed folder whose bytes equal a published version shows that version
// and no Edited chip even when the ledger's fingerprint says it changed; a drifted one keeps the chip.
it('shows no Edited chip on a Library folder whose bytes equal a published version, whatever the ledger recorded', () => {
 show(libraryCard({installedVersion:'v1',localMatch:'identical',placed:true,edited:true}));
 expect(screen.getByText('v1')).toHaveClass('card-version-label');
 expect(screen.queryByText('Edited')).toBeNull();
 cleanup();
 show(libraryCard({installedVersion:'v2',localMatch:'differs',placed:true,edited:true}));
 expect(screen.getByText('v2 (edited)')).toBeInTheDocument();
 expect(screen.getByText('Edited')).toBeInTheDocument();
});
it('writes the eval attribution line in card form', () => {
 show(libraryCard({installedVersion:'v3',localMatch:'identical',placed:false,localEval:{w:7,l:2,t:3,n:12,lift:42,verdict:'PASS',partial:null,signP:'0.090',runnerHandle:'ajayw36',version:'v3'}}));
 expect(screen.getByText('run by ajayw36 · v3')).toBeInTheDocument();
});

// The card footer says each true thing once (2026-09-14). The lift figure owns the verdict wherever `liftOnCards`
// draws it, so the footer's note defers; a receipt older than the last edit states that alone, never prefixed by
// "Not evaluated", which is the opposite claim.
it.each([
 [{teamed:true},true,null],
 [{teamed:true,localEvalStale:true},true,null],
 [{teamed:false,localEval:{w:1,l:0,t:0,n:1,lift:0.4,verdict:'PASS' as const,partial:null,signP:'0.03',runnerHandle:'mira',version:'v4'},localEvalStale:true},true,null],
 [{teamed:false,localEval:null,localEvalStale:true},true,'Evaluated before your last edit'],
 [{teamed:false,localEval:null,localEvalStale:true},false,'Evaluated before your last edit'],
 [{teamed:false,localEval:null,localEvalStale:false},true,null],
 [{teamed:false,localEval:null,localEvalStale:false},false,'Not evaluated'],
] satisfies [Partial<Card>,boolean,string|null][])('writes the local eval note %j (verdict drawn: %s)',(over,verdictShown,note)=>{
 expect(localEvalNote(card(over),verdictShown)).toBe(note);
});
// A Library card's installs is always the `—` sentinel (the adapter cannot count installs of a local folder), so
// the chip drew a dash that said nothing; a real count, `0 installs` included, still draws.
it.each([
 ['—',null],
 ['0 installs','0 installs'],
 ['12 installs','12 installs'],
] satisfies [string,string|null][])('draws the installs chip only with a count (%s)',(installs,label)=>{
 expect(installsChip(card({installs}))).toBe(label);
});
it('drops the dash chip from a local card and keeps the count on a team card',()=>{
 show(card({teamed:false,installs:'—',size:'~3.2k tokens'}));
 const chips=[...document.querySelectorAll('.skill-card-bottom .chip')].map(chip=>chip.textContent);
 expect(chips).toContain('~3.2k tokens');
 expect(chips).not.toContain('—');
 cleanup();
 show(card({teamed:true,installs:'12 installs'}));
 expect([...document.querySelectorAll('.skill-card-bottom .chip')].map(chip=>chip.textContent)).toContain('12 installs');
});
