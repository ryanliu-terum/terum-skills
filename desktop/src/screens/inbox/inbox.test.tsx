import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { pickBackend } from '../../backend';
import { createRun } from '../../backend/mock/run';
import { design } from '../../backend/mock/data';
function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });
it('selects the share Subject by default with eleven rows and the fixture unread count', async () => {
  open('#/inbox'); const pane = await screen.findByRole('region', { name: 'Inbox report' });
  expect(within(pane).getByText('ajay shared secret-scan with you')).toBeInTheDocument();
  expect(screen.getAllByTestId(/^inbox-row-/)).toHaveLength(11);
  expect(screen.getByText(`${design.INBOX.filter(it => it.unread).length} unread`)).toBeInTheDocument();
  expect(screen.getByTestId('inbox-row-share-secret-scan')).toHaveAttribute('data-selected', 'true');
});
it('renders update Table 1 and both receipt matchups', async () => { open('#/inbox/update-pr-review'); expect(await screen.findByText(/Files changed between 4d9e0b7a2c15 and 7e8f9a0b1c2d/)).toHaveTextContent('Table 1'); expect(screen.getByText('vs installed')).toBeInTheDocument(); });
it('renders each FIRED line and the backend precision', async () => { open('#/inbox/alert-offtarget-deploy-check'); const lines = await screen.findAllByText(/^FIRED:/); expect(lines).toHaveLength(5); const item = design.INBOX.find(it => it.sub === 'offtarget'); for (const [prompt] of item?.fired ?? []) expect(lines.some(line => line.textContent?.includes(String(prompt)))).toBe(true); expect(screen.getAllByText(design.DERIVED.reportNumbers['deploy-check fired off-target 5 times'].precisionObserved)).toHaveLength(1); });
it('renders the full inbox evaluation report', async () => { open('#/inbox/eval-deploy-check'); expect(await screen.findByText(/Evaluation of deploy-check/)).toBeInTheDocument(); expect(screen.getByText('Coverage and provenance')).toBeInTheDocument(); });
it('renders the exact derived author digest and bold event actors', async () => { open('#/inbox/author-deploy-check'); expect(await screen.findByText(design.DERIVED.digestSentence)).toBeInTheDocument(); expect(screen.getAllByText('teddy', { selector: 'b' })[0]).toBeInTheDocument(); });
it('renders the team report with the actual later install date', async () => { open('#/inbox/team-mira'); expect(await screen.findByText(/Since then she installed deploy-check \(2026-08-28\)/)).toBeInTheDocument(); });
it('renders empty list and omits empty inbox badges from status', async () => { open('#/inbox?__mock=empty'); expect(await screen.findByText('No items')).toBeInTheDocument(); expect(screen.getByText('Nothing waiting')).toBeInTheDocument(); expect(screen.queryAllByTestId(/^inbox-row-/)).toHaveLength(0); expect(await screen.findByRole('link', { name: 'Global 30' })).toBeInTheDocument(); for (const name of ['Pushes', 'Updates', 'Alerts']) expect(screen.getByRole('link', { name }).querySelector('.nav-count')).toBeNull(); });
it('renders fatal failures in the centered alert', async () => { open('#/inbox?__mock=error'); expect(await screen.findByRole('alert')).toHaveTextContent("Skipping terum: could not fetch https://github.com/terum/team-skills.git: fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"); });
it('installs with consent pre-answered and replaces the document and row state', async () => {
  const install = vi.spyOn(pickBackend(), 'install'); open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Installed to Global just now · 8b2f6c1e0d94 in ~/.claude/skills/secret-scan');
  expect(screen.getByTestId('inbox-row-share-secret-scan')).toHaveTextContent('Installed · Global');
  expect(screen.getByText('Tool grants approved')).toBeInTheDocument(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(install).toHaveBeenCalledWith({ ref: 'secret-scan', scope: 'Global' }); expect(location.hash).toBe('#/inbox');
});
it('preserves mock query parameters when selecting a row', async () => { open('#/inbox?__mock=disabled'); fireEvent.click(await screen.findByTestId('inbox-row-update-pr-review')); await waitFor(() => expect(location.hash).toBe('#/inbox/update-pr-review?__mock=disabled')); });
it('leaves unknown ids unselected with the empty pane', async () => { open('#/inbox/unknown'); expect(await screen.findByText('Select an item to read it.')).toBeInTheDocument(); expect(screen.getAllByTestId(/^inbox-row-/).every(row => !row.hasAttribute('data-selected'))).toBe(true); });
it('marks committed loading skeletons ready', async () => { open('#/inbox?__mock=loading'); await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true')); expect(screen.getByLabelText('Loading report')).toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Inbox report' })).toBeNull(); });
it.each([
  ['alert-missing-incident-triage', 'Missing files'], ['alert-local-migration-guard', 'The difference'], ['alert-regression-env-audit', 'The record'], ['review-single-fix', 'Who uses it already'],
])('renders the report for %s', async (id, text) => { open('#/inbox/' + id); expect(await screen.findByText(text)).toBeInTheDocument(); });
it('runs updates without navigating', async () => { const sync = vi.spyOn(pickBackend(), 'sync'); open('#/inbox/update-pr-review'); fireEvent.click(await screen.findByRole('button', { name: 'Approve and update' })); await waitFor(() => expect(sync).toHaveBeenCalledWith({})); await waitFor(() => expect(screen.getByRole('button', { name: 'Approve and update' })).not.toBeDisabled()); expect(location.hash).toBe('#/inbox/update-pr-review'); });
it('runs an off-target eval and stays on the report', async () => { const evaluate = vi.spyOn(pickBackend(), 'eval'); open('#/inbox/alert-offtarget-deploy-check'); fireEvent.click(await screen.findByRole('button', { name: 'Re-run eval' })); await waitFor(() => expect(evaluate).toHaveBeenCalledWith({ ref: 'deploy-check' })); expect(location.hash).toBe('#/inbox/alert-offtarget-deploy-check'); });
it('handles install factory exceptions with the error layout', async () => { vi.spyOn(pickBackend(), 'install').mockImplementation(() => { throw new Error('Install failed.'); }); open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' })); expect(await screen.findByRole('alert')).toHaveTextContent('Install failed.'); });
it('handles editor failures explicitly', async () => { vi.spyOn(pickBackend(), 'openInEditor').mockResolvedValue({ ok: false, error: 'Editor unavailable.' }); open('#/inbox/alert-missing-incident-triage'); fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' })); expect(await screen.findByRole('alert')).toHaveTextContent('Editor unavailable.'); });
it('opens a dialog for an unexpected run prompt', async () => {
  const backend = pickBackend(), original = backend.install;
  vi.spyOn(backend, 'install').mockImplementation(() => original({ ref: 'deploy-check' }));
  open('#/inbox'); fireEvent.click(await screen.findByRole('button', { name: 'Install to Global' }));
  const dialog = await screen.findByRole('dialog'); expect(dialog).toHaveTextContent('Approve these tools for deploy-check?');
  fireEvent.click(within(dialog).getByRole('button', { name: 'No' })); expect(await screen.findByRole('alert')).toHaveTextContent('Install was declined.');
});
it('keeps secondary decline pixels unchanged', async () => { open('#/inbox'); const pane = await screen.findByRole('region', { name: 'Inbox report' }); const before = pane.textContent; fireEvent.click(within(pane).getByRole('button', { name: 'Decline' })); expect(pane.textContent).toBe(before); });

it('retains the installed score when an update has no new receipt', async () => { open('#/inbox/update-adr-writer'); expect(await screen.findByText(/No receipt for c41d0e9f8a27 yet\./)).toHaveTextContent('The installed version b7a2c15d4e9f scored +78% PASS on its last run.'); });

it.each([
 ['#/inbox/update-pr-review', 'Later', 'inbox-later:update-pr-review', true],
 ['#/inbox/alert-offtarget-deploy-check', 'Disable', 'enabled:deploy-check', false],
] as const)('persists %s secondary %s without changing the report', async (route, label, key, value) => {
 open(route); const pane = await screen.findByRole('region', { name: 'Inbox report' }); const before = pane.textContent;
 fireEvent.click(within(pane).getByRole('button', { name: label })); expect(pickBackend().prefs.get(key, !value)).toBe(value); expect(pane.textContent).toBe(before);
});
it('records a decline through the backend without creating a preference', async () => {
 const decline=vi.spyOn(pickBackend(),'decline');open('#/inbox');fireEvent.click(await screen.findByRole('button',{name:'Decline'}));
 await waitFor(()=>expect(decline).toHaveBeenCalledWith({ref:'terum/team-skills/secret-scan'}));
 expect(pickBackend().prefs.get('declined:secret-scan',false)).toBe(false);
});
it('surfaces failed decline results explicitly', async () => { open('#/inbox'); await screen.findByRole('button', { name: 'Decline' }); vi.spyOn(pickBackend(), 'decline').mockImplementation(() => createRun(async()=>({ok:false,error:'Decline write failed.'}))); fireEvent.click(screen.getByRole('button', { name: 'Decline' })); expect(await screen.findByRole('alert')).toHaveTextContent('Decline write failed.'); });

it('uses only status-supplied sidebar counts on the empty scenario', async () => {
  const source = pickBackend();
  const status = await source.status();
  if (!status.ok) throw new Error(status.error);
  vi.spyOn(source, 'status').mockResolvedValue({ ...status, value: { ...status.value, counts: { Global: '71' } } });
  open('#/inbox?__mock=empty');
  expect(await screen.findByRole('link', { name: 'Global 71' })).toBeInTheDocument();
  expect(document.querySelectorAll('.nav-count')).toHaveLength(1);
});
