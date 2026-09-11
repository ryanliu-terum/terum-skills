import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); });
function open(route: string, change?: (frame: Record<string, unknown>, name: string) => void) {
  useUiStore.setState({ railOpen: true, overviewHidden: false });
  const f = fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0]!;
    const lines = readFileSync(resolve('../.planning/codex-runs/m7-S7b/frames', name + '.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      change?.(frame, name);
      emit({ kind: 'stdout', line: JSON.stringify(frame) });
    }
  });
  const backend = createTauriBackend(f.bridge);
  location.hash = route;
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return backend;
}
it('serves Members with committed labels, no project column, and the permission chip hidden', async () => {
  open('#/share');
  const row = await screen.findByTestId('member-row-0');
  expect(row).toHaveTextContent('Mira Chen');
  expect(row).toHaveTextContent('mira · Platform');
  // The Teams column is gone; a member's projects are no longer drawn on this screen.
  expect(within(row).queryByText('terum')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Role for mira' })).toBeNull();
  // The inert removal control was pulled; `terum-skills team remove` is the way until it works end to end.
  expect(within(row).queryByRole('button', { name: 'Remove from team' })).toBeNull();
});
// These frames were recorded from a CLI that reported neither field: the row must say '—', never 0 or a date.
it('shows no join date and no skill total when the CLI reports neither', async () => {
  open('#/share');
  const cells = within(await screen.findByTestId('member-row-0')).getAllByRole('cell');
  expect(cells[2]).toHaveTextContent('—');
  expect(cells[3]).toHaveTextContent('—');
});
it('renders the join date and the skill total the CLI reports', async () => {
  open('#/share', (frame, name) => {
    if (name !== 'status' || frame.t !== 'result') return;
    const value = frame.value as { teams: { members: { handle: string; joined?: string; skillsTotal?: number }[] }[] };
    const mira = value.teams[0]?.members.find(member => member.handle === 'mira');
    if (mira) { mira.joined = '2026-06-12'; mira.skillsTotal = 96; }
  });
  const cells = within(await screen.findByTestId('member-row-0')).getAllByRole('cell');
  expect(cells[2]).toHaveTextContent('2026-06-12');
  expect(cells[3]).toHaveTextContent('96');
});
it('drops the dangling role separator for a member without a role', async () => {
  open('#/share');
  const row = await screen.findByTestId('member-row-2');
  expect(row).toHaveTextContent('Seed');
  expect(within(row).getByText('seed')).toBeVisible();
  expect(row).not.toHaveTextContent('seed ·');
});
it('does not repeat the handle when the display name is just the handle', async () => {
  open('#/share', (frame, name) => {
    if (name !== 'status' || frame.t !== 'result') return;
    const value = frame.value as { teams: { members: { handle: string; displayName: string }[] }[] };
    const ravi = value.teams[0]?.members.find(member => member.handle === 'ravi');
    if (ravi) ravi.displayName = 'ravi';
  });
  const row = await screen.findByTestId('member-row-1');
  expect(within(row).getAllByText('ravi')).toHaveLength(1);
  expect(row).not.toHaveTextContent('·');
});
it('renders a person heading without a duplicate handle or a dangling role separator', async () => {
  open('#/marketplace/people/ravi', (frame, name) => {
    if (name !== 'status' || frame.t !== 'result') return;
    const value = frame.value as { teams: { members: { handle: string; displayName: string }[] }[] };
    const ravi = value.teams[0]?.members.find(member => member.handle === 'ravi');
    if (ravi) ravi.displayName = 'ravi';
  });
  await screen.findByRole('heading', { name: 'ravi' });
  const heading = document.querySelector('.market-person-heading') as HTMLElement;
  expect(within(heading).getAllByText('ravi')).toHaveLength(1);
  expect(heading.querySelector('.board-small')).toBeNull();
});
it('keeps a person card identity clean when the member has no role', async () => {
  open('#/marketplace/people');
  const card = await screen.findByTestId('person-card-ravi');
  expect(card).toHaveTextContent('Ravi Patel');
  expect(within(card).getByText('ravi')).toBeVisible();
  expect(card).not.toHaveTextContent('· ravi');
});
it('serves Marketplace people with real labels, installs and projects, and no follow control', async () => {
  open('#/marketplace/people');
  const card = await screen.findByTestId('person-card-mira');
  expect(card).toHaveTextContent('Platform · mira');
  expect(card).toHaveTextContent('2 installs');
  expect(card).toHaveTextContent('terum');
  expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull();
  expect(screen.queryByText('Teddy Zhang')).toBeNull();
});
it('opens a real project install dialog with counts from its skill tool grants', async () => {
  open('#/marketplace/projects/terum?dialog=install');
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Install project terum');
  expect(within(dialog).getByRole('button', { name: 'Install 1 skill' })).toBeVisible();
  expect(within(dialog).getByText('Tool grants to approve · 0 of 1 ask')).toBeVisible();
});

function openShare(route: string, invite?: {frame: object}, options: {joinBlock?: boolean} = {}) {
  useUiStore.setState({ railOpen: true, overviewHidden: false });
  const fake = fakeBridge((args, emit) => {
    if (args[0] === 'invite') {
      if (!invite) throw new Error('Unexpected invitation run');
      emit({ kind: 'stdout', line: JSON.stringify({t:'result',verb:'invite',...invite.frame}) });
      return;
    }
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0]!;
    const lines = readFileSync(resolve('../.planning/codex-runs/m7-S7b/frames', name + '.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines) {
      if (name === 'status' && options.joinBlock !== false) {
        const frame = JSON.parse(line);
        if (frame.t === 'result') {
          for (const team of frame.value.teams) {
            team.repository = 'https://github.com/terum/team-skills.git';
            team.joinCommand = 'npx -y terum-skills@latest setup terum/team-skills';
            team.joinBlock = ['Send this to your teammate:', '```', 'npm install -g terum-skills', 'npx -y terum-skills@latest setup terum/team-skills', '', 'Bare equivalent: npx -y terum-skills@latest team join terum/team-skills', '```', 'If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.'];
          }
          emit({kind:'stdout',line:JSON.stringify(frame)});
          continue;
        }
      }
      emit({ kind: 'stdout', line });
    }
  });
  const backend = createTauriBackend(fake.bridge);
  location.hash = route;
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return { backend, fake };
}
it('invite from status renders an empty real form using settings',async()=>{const {fake}=openShare('#/share?dialog=invite');expect(await screen.findByRole('textbox',{name:'GitHub logins'})).toHaveValue('');const dialog=screen.getByRole('dialog');expect(dialog).toHaveTextContent('npx -y terum-skills@latest setup terum/team-skills');const verbs=fake.spawns.map(s=>s.args[0]);expect(verbs).toContain('status');expect(verbs).not.toContain('onboarding');expect(verbs).not.toContain('invite');expect(dialog).not.toHaveTextContent('Onboarding data');});
it('invite from status drives the team verb and shows success on the page',async()=>{const {fake}=openShare('#/share?dialog=invite',{frame:{ok:true,value:{team:'acme',invited:['sortiz'],already:[]}}});fireEvent.change(await screen.findByRole('textbox',{name:'GitHub logins'}),{target:{value:'sortiz'}});fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Invite'}));await waitFor(()=>expect(fake.spawns.some(s=>s.args[0]==='invite')).toBe(true));expect(fake.spawns.find(s=>s.args[0]==='invite')?.args).toEqual(['invite','--team','acme','--','sortiz']);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(await screen.findByRole('status')).toHaveTextContent('Invited @sortiz.');});
it('invite from status reports invited and existing collaborators',async()=>{openShare('#/share?dialog=invite',{frame:{ok:true,value:{team:'acme',invited:['sortiz'],already:['mira']}}});fireEvent.change(await screen.findByRole('textbox',{name:'GitHub logins'}),{target:{value:'sortiz, mira'}});fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Invite'}));expect(await screen.findByRole('status')).toHaveTextContent('Invited @sortiz. @mira already has access.');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());});
it('invite from status keeps partial outcomes and the error in the dialog',async()=>{const error='Could not invite @bad (GitHub status 422). gh: Validation Failed (HTTP 422)';openShare('#/share?dialog=invite',{frame:{ok:false,error,value:{team:'acme',invited:['sortiz'],already:[],failed:[{login:'bad',error}]}}});fireEvent.change(await screen.findByRole('textbox',{name:'GitHub logins'}),{target:{value:'sortiz, bad'}});fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Invite'}));await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Invited @sortiz.'));const dialog=screen.getByRole('dialog');expect(dialog).toHaveTextContent('@bad: Could not invite @bad');expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not invite @bad');});
it('invite from status reports a missing join command without a CLI box',async()=>{openShare('#/share?dialog=invite',undefined,{joinBlock:false});await screen.findByRole('textbox',{name:'GitHub logins'});const dialog=screen.getByRole('dialog');expect(dialog.querySelector('.cli-box')).toBeNull();expect(dialog).toHaveTextContent('terum-skills reports no join command for');});
