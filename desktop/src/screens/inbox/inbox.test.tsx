import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { pickBackend } from '../../backend';
import { design, inboxItems } from '../../backend/mock/data';
function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });
it('selects the share Subject by default with eight rows and the fixture unread count', async () => {
  open('#/inbox'); const pane = await screen.findByRole('region', { name: 'Inbox report' });
  expect(within(pane).getByText('ajay shared secret-scan with you')).toBeInTheDocument();
  expect(screen.getAllByTestId(/^inbox-row-/)).toHaveLength(8);
  expect(screen.getByText(`${inboxItems().filter(it => it.unread).length} unread`)).toBeInTheDocument();
  expect(screen.getByTestId('inbox-row-share-secret-scan')).toHaveAttribute('data-selected', 'true');
});
it('renders each FIRED line and the backend precision', async () => { open('#/inbox/alert-offtarget-deploy-check'); const lines = await screen.findAllByText(/^FIRED:/); expect(lines).toHaveLength(5); const item = design.INBOX.find(it => it.sub === 'offtarget'); for (const [prompt] of item?.fired ?? []) expect(lines.some(line => line.textContent?.includes(String(prompt)))).toBe(true); expect(screen.getAllByText(design.DERIVED.reportNumbers['deploy-check fired off-target 5 times'].precisionObserved)).toHaveLength(1); });
it('renders the full inbox evaluation report', async () => { open('#/inbox/eval-deploy-check'); expect(await screen.findByText(/Evaluation of deploy-check/)).toBeInTheDocument(); expect(screen.getByText('Coverage and provenance')).toBeInTheDocument(); });
it('renders the exact derived author digest and bold event actors', async () => { open('#/inbox/author-deploy-check'); expect(await screen.findByText(design.DERIVED.digestSentence)).toBeInTheDocument(); expect(screen.getAllByText('teddy', { selector: 'b' })[0]).toBeInTheDocument(); });
it('renders the team report with the actual later install date', async () => { open('#/inbox/team-mira'); expect(await screen.findByText(/Since then she installed deploy-check \(2026-08-28\)/)).toBeInTheDocument(); });
it('renders empty list and omits empty inbox badges from status', async () => { open('#/inbox?__mock=empty'); expect(await screen.findByText('No items')).toBeInTheDocument(); expect(screen.getByText('Nothing waiting')).toBeInTheDocument(); expect(screen.queryAllByTestId(/^inbox-row-/)).toHaveLength(0); expect(await screen.findByRole('link', { name: 'Global 15' })).toBeInTheDocument(); for (const name of ['Pushes', 'Updates', 'Alerts']) expect(screen.getByRole('link', { name }).querySelector('.nav-count')).toBeNull(); });
it('renders fatal failures in the centered alert', async () => { open('#/inbox?__mock=error'); expect(await screen.findByRole('alert')).toHaveTextContent("Skipping terum: could not fetch https://github.com/terum/team-skills.git: fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"); });
it('installs with consent pre-answered and replaces the document and row state', async () => {
  const install = vi.spyOn(pickBackend(), 'install'); open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Installed to Global just now · 8b2f6c1e0d94 in ~/.claude/skills/secret-scan');
  expect(screen.getByTestId('inbox-row-share-secret-scan')).toHaveTextContent('Installed · Global');
  expect(screen.getByText('Tool grants approved')).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(install).toHaveBeenCalledWith({ ref: 'secret-scan', scope: 'Global' }); expect(location.hash).toBe('#/inbox');
});
it('preserves mock query parameters when selecting a row', async () => { open('#/inbox?__mock=disabled'); fireEvent.click(await screen.findByTestId('inbox-row-alert-local-migration-guard')); await waitFor(() => expect(location.hash).toBe('#/inbox/alert-local-migration-guard?__mock=disabled')); });
it('leaves unknown ids unselected with the empty pane', async () => { open('#/inbox/unknown'); expect(await screen.findByText('Select an item to read it.')).toBeInTheDocument(); expect(screen.getAllByTestId(/^inbox-row-/).every(row => !row.hasAttribute('data-selected'))).toBe(true); });
it('marks committed loading skeletons ready', async () => { open('#/inbox?__mock=loading'); await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true')); expect(screen.getByLabelText('Loading report')).toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Inbox report' })).toBeNull(); });
it.each([
  ['alert-missing-incident-triage', 'Missing files'], ['alert-local-migration-guard', 'The difference'], ['alert-regression-env-audit', 'The record'],
])('renders the report for %s', async (id, text) => { open('#/inbox/' + id); expect(await screen.findByText(text)).toBeInTheDocument(); });
it('routes an off-target eval through the shared consent gate before starting', async () => { const evaluate = vi.spyOn(pickBackend(), 'eval'); open('#/inbox/alert-offtarget-deploy-check'); fireEvent.click(await screen.findByRole('button', { name: 'Re-run eval' })); const dialog=await screen.findByRole('dialog'); expect(evaluate).not.toHaveBeenCalled(); expect(location.hash).toBe('#/skill/deploy-check?tab=evals&dialog=run-eval'); fireEvent.click(within(dialog).getByRole('button',{name:'Run eval'})); await waitFor(() => expect(evaluate).toHaveBeenCalledExactlyOnceWith({ ref: 'deploy-check' })); });
it('handles install factory exceptions with the error layout', async () => { vi.spyOn(pickBackend(), 'install').mockImplementation(() => { throw new Error('Install failed.'); }); open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' })); expect(await screen.findByRole('alert')).toHaveTextContent('Install failed.'); });
it('handles editor failures explicitly', async () => { vi.spyOn(pickBackend(), 'openInEditor').mockResolvedValue({ ok: false, error: 'Editor unavailable.' }); open('#/inbox/alert-missing-incident-triage'); fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' })); expect(await screen.findByRole('alert')).toHaveTextContent('Editor unavailable.'); });
it('opens a dialog for an unexpected run prompt', async () => {
  const backend = pickBackend(), original = backend.install;
  vi.spyOn(backend, 'install').mockImplementation(() => original({ ref: 'deploy-check' }));
  open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' }));
  const dialog = await screen.findByRole('dialog'); expect(dialog).toHaveTextContent('Approve these tools for deploy-check?');
  fireEvent.click(within(dialog).getByRole('button', { name: 'No' })); expect(await screen.findByRole('alert')).toHaveTextContent('Install was declined.');
});

it.each([
 ['#/inbox/alert-offtarget-deploy-check', 'Disable', 'enabled:deploy-check', false],
] as const)('persists %s secondary %s without changing the report', async (route, label, key, value) => {
 open(route); const pane = await screen.findByRole('region', { name: 'Inbox report' }); const before = pane.textContent;
 fireEvent.click(within(pane).getByRole('button', { name: label })); expect(pickBackend().prefs.get(key, !value)).toBe(value); expect(pane.textContent).toBe(before);
});
it('uses status Global and checkout root counts on the empty scenario', async () => {
  const source = pickBackend();
  const status = await source.status();
  if (!status.ok) throw new Error(status.error);
  vi.spyOn(source, 'status').mockResolvedValue({ ...status, value: { ...status.value, counts: { Global: '71' } } });
  open('#/inbox?__mock=empty');
  expect(await screen.findByRole('link', { name: 'Global 71' })).toBeInTheDocument();
  expect([...document.querySelectorAll('.nav-count')].map(node=>node.textContent)).toEqual(['71','8','3','2']);
});
