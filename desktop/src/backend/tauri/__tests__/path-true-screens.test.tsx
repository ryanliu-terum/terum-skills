import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import type { Backend } from '../../Backend';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { installedReplay } from './installed-fixture';

afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); vi.restoreAllMocks(); });
function open(route: string, backend: Backend) {
 useUiStore.setState({ railOpen: true, overviewHidden: false });
 location.hash = route;
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
}
it('reads the project-only occurrence path in the SKILL.md meta line', async () => {
 const backend = createTauriBackend(installedReplay('project').bridge);
 open('#/skill/deploy-check', backend);
 await screen.findByText('Installed · on this machine');
 expect(document.querySelector('.skill-md-meta')).toHaveTextContent('read from /work/project/.claude/skills/deploy-check');
 expect(document.querySelector('.skill-md-meta')).not.toHaveTextContent('~/.claude/skills/deploy-check');
 expect(screen.queryByRole('button', { name: /Remove from/ })).toBeNull();
});
it('uses the placed scope for Remove and its dialog location', async () => {
 const backend = createTauriBackend(installedReplay('placed').bridge), skill = backend.skill;
 vi.spyOn(backend, 'skill').mockImplementation(async (...args) => {
  const result = await skill(...args);
  return result.ok ? { ok: true, value: { ...result.value, scope: 'Workspace', path: '/work/project/.claude/skills/deploy-check', pathLabel: '/work/project/.claude/skills/deploy-check' } } : result;
 });
 open('#/skill/deploy-check', backend);
 fireEvent.click(await screen.findByRole('button', { name: 'Remove from Workspace' }));
 expect(await screen.findByRole('dialog')).toHaveTextContent('/work/project/.claude/skills');
 expect(screen.getByRole('dialog')).not.toHaveTextContent('~/.claude/skills');
});
it.each(['/nowhere/x','/nowhere/ssm','/nowhere/mrf'])('renders the No such checkout error for an unregistered root: %s',async root=>{
 const f=installedReplay(),backend=createTauriBackend(f.bridge);
 open('#/library/checkout?root='+encodeURIComponent(root),backend);
 expect(await screen.findByRole('alert')).toHaveTextContent('No such checkout: '+root);
 expect(f.spawns.some(spawn=>spawn.args[1]==='project')).toBe(false);
});
it('shows the installed person action when the real catalog has scan roots', async () => {
 const backend = createTauriBackend(installedReplay('placed', 'installed').bridge), catalog = backend.catalog;
 vi.spyOn(backend, 'catalog').mockImplementation(async (...args) => {
  const result = await catalog(...args);
  return result.ok ? { ok: true, value: { ...result.value, people: result.value.people.map(person => ({ ...person, onDisk: [2, 2] as [number, number] })) } } : result;
 });
 open('#/marketplace/people/mira', backend);
 await screen.findByRole('heading', { name: 'Mira Chen' });
 expect(screen.getByText('Installed')).toBeInTheDocument();
 expect(screen.queryByRole('button', { name: 'Install 2 skills' })).toBeNull();
 expect(screen.getByRole('button', { name: "Remove mira's 2 installed skills from this machine" })).toBeInTheDocument();
});
