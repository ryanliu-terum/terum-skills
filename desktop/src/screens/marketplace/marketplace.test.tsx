import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { pickBackend } from '../../backend';
import { design } from '../../backend/mock/data';
import { createRun } from '../../backend/mock/run';
function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
function names(prefix: string) { return screen.getAllByTestId(new RegExp('^' + prefix)).map(el => el.getAttribute('data-testid')?.slice(prefix.length)); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });
it('renders all four home sections and the first three top-rated skills in DTO order', async () => { open('#/marketplace'); await screen.findByRole('region', { name: 'Top rated' }); for (const title of ['Top rated', 'Teams / Projects', 'People', 'Browse by category']) expect(screen.getByRole('region', { name: title })).toBeInTheDocument(); expect(names('skill-card-')).toEqual(design.DERIVED.topRated.slice(0, 3)); });
it('renders filter verdict counts and the supplied matching count', async () => { open('#/marketplace?filters=open'); const filters = await screen.findByRole('region', { name: 'Marketplace filters' }); for (const [verdict, count] of Object.entries(design.DERIVED.verdictCounts)) expect(within(filters).getByTestId('verdict-count-' + verdict)).toHaveTextContent(verdict + count); expect(within(filters).getByRole('button', { name: `Show ${design.DERIVED.filterCount} skills` })).toBeInTheDocument(); expect(within(filters).getByRole('checkbox', { name: /PASS/ })).toBeChecked(); });
it('renders the no-results query and both active filters', async () => { open('#/marketplace?q=deploy%20prod&active=2'); expect(await screen.findByText('No skills match “deploy prod” with 2 filters on')).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Search skills, people and projects' })).toHaveValue('deploy prod'); });
it('keeps a single active filter singular in the no-results title', async () => { open('#/marketplace?q=deploy%20prod&active=1'); expect(await screen.findByText('No skills match “deploy prod” with 1 filter on')).toBeInTheDocument(); });
it('renders Terum counts and the two-column project grid', async () => { open('#/marketplace/projects/terum'); expect(await screen.findByText('8 skills placed in ~/Projects/terum')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '♡ 11' })).toBeInTheDocument(); expect(screen.getAllByTestId(/^skill-card-/)[0]?.closest('.market-grid')).toHaveAttribute('data-columns', '2'); expect(names('skill-card-')).toEqual(design.DERIVED.skillsIn.Terum); });
it('renders the Docs placement note', async () => { open('#/marketplace/projects/docs'); expect(await screen.findByText('Placed by install project, inside a checkout of this repo')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Install 3 skills' })).toBeInTheDocument(); });
it('renders the Docs asking count and exact raw grants', async () => { open('#/marketplace/projects/docs?dialog=install'); const dialog = await screen.findByRole('dialog'); expect(dialog).toHaveTextContent(`${design.DERIVED.bulkInstall.docs.asking} of 3 ask`); expect(within(dialog).getByText('a11y-audit')).toBeInTheDocument(); expect(within(dialog).getByText('bundle-budget')).toBeInTheDocument(); expect(within(dialog).getAllByText('Read')).toHaveLength(2); expect(within(dialog).getByText('Bash')).toBeInTheDocument(); });
it('renders Ryan buckets in the supplied order', async () => { open('#/marketplace/people/ryan'); await screen.findByRole('heading', { name: 'Ryan Liu' }); const buckets = design.DERIVED.personBuckets.ryan; expect(screen.getAllByRole('region').map(el => el.getAttribute('aria-label'))).toEqual(buckets.map(([bucket]) => bucket)); expect(names('skill-card-')).toEqual(buckets.flatMap(([, skills]) => skills)); });
it('renders Lena placement note', async () => { open('#/marketplace/people/lena'); expect(await screen.findByText('Placed when you sync in Docs')).toBeInTheDocument(); });
it('renders all seventeen catalog cards in topRated order', async () => { open('#/marketplace/skills'); await screen.findByRole('heading', { name: 'Top rated' }); expect(names('skill-card-')).toEqual(design.DERIVED.topRated); expect(names('skill-card-')).toHaveLength(17); });
it('toggles the sort button between the drawn ranking and Name, reordering the list A–Z and back', async () => {
  open('#/marketplace/skills');
  await screen.findByRole('heading', { name: 'Top rated' });
  fireEvent.click(screen.getByRole('button', { name: 'Most installed' }));
  await waitFor(() => expect(location.hash).toContain('sort=name'));
  expect(names('skill-card-')).toEqual([...design.DERIVED.topRated].sort((a, b) => a.localeCompare(b)));
  const byName = screen.getByRole('button', { name: 'Name' });
  expect(byName).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(byName);
  await waitFor(() => expect(names('skill-card-')).toEqual(design.DERIVED.topRated));
  expect(screen.getByRole('button', { name: 'Most installed' })).toBeInTheDocument();
});
it('renders projects in projectsByMembers order', async () => { open('#/marketplace/projects'); await screen.findByRole('heading', { name: 'Teams / Projects' }); const expected = design.DERIVED.projectsByMembers.map(name => design.PROJECTS.find(p => p.name === name)?.key); expect(names('project-card-')).toEqual(expected); });
it('renders all twelve people in rosterByAdoption order', async () => { open('#/marketplace/people'); await screen.findByRole('heading', { name: 'People' }); expect(names('person-card-')).toEqual(design.DERIVED.rosterByAdoption); expect(names('person-card-')).toHaveLength(12); });
it('renders ten category rows with supplied remaining counts', async () => { open('#/marketplace/categories'); await screen.findByRole('heading', { name: 'Browse by category' }); expect(names('category-row-')).toEqual(design.CATEGORIES.map(c => c[0])); for(const [category] of design.CATEGORIES){expect(design.DERIVED.categoryRemaining[category as keyof typeof design.DERIVED.categoryRemaining]).toBe(0);const row=screen.getByTestId('category-row-'+category);expect(within(row).queryByText(/\+\d+ more/)).toBeNull();expect(row.lastElementChild?.previousElementSibling).toHaveTextContent(design.DERIVED.categorySkills[category as keyof typeof design.DERIVED.categorySkills].join(' · '));} });
it('renders infra skills in categorySkills order', async () => { open('#/marketplace/categories/infra'); await screen.findByRole('heading', { name: 'infra' }); expect(names('skill-card-')).toEqual(design.DERIVED.categorySkills.infra); });
it.each([['projects/nothing', 'No project named nothing.'], ['people/nobody', 'No teammate named nobody.'], ['categories/nothing', 'No category named nothing.']])('renders unknown %s errors', async (path, error) => { open('#/marketplace/' + path); expect(await screen.findByText('Not found')).toBeInTheDocument(); expect(screen.getByText(error)).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull(); await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true')); });
it('marks loading content ready without waiting for the pending backend', async () => { open('#/marketplace?__mock=loading'); expect(screen.getByLabelText('Loading marketplace')).toBeInTheDocument(); await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true')); });
it('renders fatal backend errors as an alert', async () => { open('#/marketplace?__mock=error'); expect(await screen.findByRole('alert')).toHaveTextContent('Could not resolve host: github.com'); });
it('hides project Edit when no checkout path is recorded instead of opening a guessed relative path', async () => {
  const backend = pickBackend(); const before = await backend.catalog(); if (!before.ok) throw new Error(before.error);
  vi.spyOn(backend, 'catalog').mockResolvedValue({ ...before, value: { ...before.value, projects: before.value.projects.map(p => p.key === 'terum' ? { ...p, path: null } : p) } });
  open('#/marketplace/projects/terum');
  await screen.findByRole('heading', { name: 'Terum' });
  expect(await screen.findByRole('button', { name: "Remove Terum's 8 skills from this machine" })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});
it('keeps the home populated for the empty scenario', async () => { open('#/marketplace?__mock=empty'); await screen.findByRole('region', { name: 'Top rated' }); expect(names('skill-card-')).toEqual(design.DERIVED.topRated.slice(0, 3)); expect(await screen.findByRole('link', { name: 'Global 15' })).toBeInTheDocument(); for (const name of ['Pushes 3', 'Updates 3', 'Alerts 8']) expect(screen.getByRole('link', { name })).toBeInTheDocument(); });
it('applies hero search only on Enter and preserves URL state', async () => { open('#/marketplace?theme=light'); const input = await screen.findByRole('textbox', { name: 'Search skills, people and projects' }); fireEvent.change(input, { target: { value: 'deploy prod' } }); expect(location.hash).toBe('#/marketplace?theme=light'); fireEvent.keyDown(input, { key: 'Enter' }); expect(await screen.findByText('No skills match “deploy prod”')).toBeInTheDocument(); expect(location.hash).toContain('theme=light'); expect(location.hash).toContain('q=deploy+prod'); });
it('applies project search and preserves rail state', async () => { open('#/marketplace/projects/terum?rail=closed'); const input = await screen.findByRole('textbox', { name: "Search Terum's 8 skills" }); fireEvent.change(input, { target: { value: 'deploy-check' } }); fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(names('skill-card-')).toEqual(['deploy-check'])); expect(screen.getByTestId('skill-card-deploy-check').closest('.market-grid')).toHaveAttribute('data-columns', '3'); });
it('toggles the filter popover with URL state', async () => { open('#/marketplace'); await screen.findByRole('region', { name: 'Top rated' }); fireEvent.click(screen.getByRole('button', { name: 'Filter marketplace' })); expect(await screen.findByRole('region', { name: 'Marketplace filters' })).toBeInTheDocument(); expect(location.hash).toContain('filters=open'); fireEvent.click(screen.getByRole('button', { name: 'Filter marketplace' })); await waitFor(() => expect(screen.queryByRole('region', { name: 'Marketplace filters' })).toBeNull()); });
it.each([['Top rated', 'skills'], ['Teams / Projects', 'projects'], ['People', 'people'], ['Browse by category', 'categories']])('navigates %s pager to the expanded list', async (title, path) => { open('#/marketplace'); fireEvent.click(await screen.findByRole('button', { name: 'View all ' + title })); await waitFor(() => expect(location.hash).toBe('#/marketplace/' + path)); });
it('persists Follow and re-renders Following', async () => { open('#/marketplace/people/ryan'); fireEvent.click(await screen.findByRole('button', { name: 'Follow ryan' })); expect(screen.getByRole('button', { name: 'Unfollow ryan' })).toHaveTextContent('Following'); expect(pickBackend().prefs.get('following:ryan', false)).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Unfollow ryan' })); expect(screen.getByRole('button', { name: 'Follow ryan' })).toHaveTextContent('Follow'); });
it('handles failed Follow preferences without changing following state', async () => { open('#/marketplace/people/ryan'); await screen.findByRole('button', { name: 'Follow ryan' }); vi.spyOn(pickBackend().prefs, 'set').mockImplementation(() => { throw new Error('Preferences unavailable.'); }); fireEvent.click(screen.getByRole('button', { name: 'Follow ryan' })); expect(await screen.findByRole('alert')).toHaveTextContent('Preferences unavailable.'); expect(screen.getByRole('button', { name: 'Follow ryan' })).toHaveAttribute('aria-pressed', 'false'); });
it('opens project install from its primary and closes after successful run', async () => { const install = vi.spyOn(pickBackend(), 'install'); open('#/marketplace/projects/docs'); fireEvent.click(await screen.findByRole('button', { name: 'Install 3 skills' })); const dialog = await screen.findByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Install 3 skills' })); const consent = await screen.findByRole('dialog', { name: 'Approve these tools for docs?' }); fireEvent.click(within(consent).getByRole('button', { name: 'Yes' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(install).toHaveBeenCalledWith({ ref: 'docs', kind: 'project', project: 'docs' }); expect(location.hash).toBe('#/marketplace/projects/docs'); });
it('cancels the bulk dialog without invoking install', async () => { const install = vi.spyOn(pickBackend(), 'install'); open('#/marketplace/projects/docs?dialog=install&rail=closed'); const dialog = await screen.findByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(location.hash).toBe('#/marketplace/projects/docs?rail=closed'); expect(install).not.toHaveBeenCalled(); });
it('installs a person through the member verb without navigation', async () => { const install = vi.spyOn(pickBackend(), 'install'); open('#/marketplace/people/lena'); fireEvent.click(await screen.findByRole('button', { name: 'Install 3 skills' })); await waitFor(() => expect(install).toHaveBeenCalledWith({ ref: 'lena', kind: 'member', member: 'lena' })); const consent = await screen.findByRole('dialog', { name: 'Approve these tools for lena?' }); fireEvent.click(within(consent).getByRole('button', { name: 'Yes' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(location.hash).toBe('#/marketplace/people/lena'); });
it('uses status identity and the installed list for own-handle removal', async () => {
  const backend = pickBackend(), status = await backend.status(), catalog = await backend.catalog();
  if (!status.ok || !catalog.ok) throw new Error('Fixture unavailable.');
  const person = catalog.value.people.find(p => p.handle === 'ryan')!;
  // A status identity different from the fixture proves the screen reads the seam.
  vi.spyOn(backend, 'status').mockResolvedValue({ ...status, value: { ...status.value, me: { ...status.value.me, handle: person.handle } } });
  vi.spyOn(backend, 'catalog').mockResolvedValue({ ...catalog, value: { ...catalog.value, people: catalog.value.people.map(p => p.handle === person.handle ? { ...p, skills: [], buckets: [] } : p) } });
  const remove = vi.spyOn(backend, 'uninstallSkill');
  open('#/marketplace/people/' + person.handle);
  fireEvent.click(await screen.findByRole('button', { name: `Remove everything you installed (${person.installable.length} skills)` }));
  const dialog = await screen.findByRole('dialog');
  expect(remove).toHaveBeenCalledExactlyOnceWith({ ref: person.handle, kind: 'member', member: person.handle });
  expect(dialog).toHaveTextContent(`Install records dropped from your people file (${person.installable.length}): ${person.installable.join(', ')}`);
  fireEvent.click(within(dialog).getByRole('button', { name: 'No' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps backend cancellation out of the error board', async () => {
  const remove = vi.spyOn(pickBackend(), 'uninstallSkill').mockImplementation(() => createRun(async () => ({ ok: false, cancelled: true, error: 'Remove was declined.' })));
  open('#/marketplace/projects/terum');
  const trash = await screen.findByRole('button', { name: "Remove Terum's 8 skills from this machine" });
  fireEvent.click(trash);
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(trash).not.toBeDisabled());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText("Couldn't reach the team repo")).toBeNull();
});

it('asks once per project run, writes nothing before Yes, and keeps No silent', async () => {
  const backend = pickBackend(), before = await backend.catalog();
  if (!before.ok) throw new Error(before.error);
  const project = before.value.projects.find(p => p.key === 'terum')!;
  const targets = before.value.skills.filter(s => project.skillsIn.includes(s.name) && s.placed);
  const remove = vi.spyOn(backend, 'uninstallSkill'), seen = vi.fn(), off = backend.subscribe(seen);
  open('#/marketplace/projects/terum');
  fireEvent.click(await screen.findByRole('button', { name: "Remove Terum's 8 skills from this machine" }));
  let dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: `Remove terum's ${targets.length} skills from this machine?` })).toBeInTheDocument();
  const paths = targets.flatMap(s => s.paths);
  expect(paths.length).toBeGreaterThan(0);
  for (const [path, scope] of paths) expect(dialog).toHaveTextContent(`${path} · ${scope === 'global' ? 'Global' : `project ${scope}`}`);
  expect(remove).toHaveBeenCalledExactlyOnceWith({ ref: 'terum', kind: 'project', project: 'terum' });
  expect(await backend.catalog()).toEqual(before); expect(seen).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'No' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText("Couldn't reach the team repo")).toBeNull();
  expect(await backend.catalog()).toEqual(before); expect(seen).not.toHaveBeenCalled();
  const first = remove.mock.results[0]!;
  if (first.type !== 'return') throw new Error('Missing run.');
  expect(await first.value.done).toMatchObject({ ok: false, cancelled: true });
  fireEvent.click(screen.getByRole('button', { name: "Remove Terum's 8 skills from this machine" }));
  dialog = await screen.findByRole('dialog');
  expect(await backend.catalog()).toEqual(before);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Yes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const second = remove.mock.results[1]!;
  if (second.type !== 'return') throw new Error('Missing run.');
  expect(await second.value.done).toEqual({ ok: true, value: project.skillsIn.filter(name => targets.some(s => s.name === name)).map(name => ({ id: name, name })) });
  expect(remove).toHaveBeenCalledTimes(2); expect(seen.mock.calls).toEqual([['placed'], ['config']]);
  const after = await backend.catalog(), library = await backend.library({ scope: { kind: 'global' } });
  if (!after.ok || !library.ok) throw new Error('Fixture unavailable.');
  for (const target of targets) {
    expect(after.value.skills.find(s => s.name === target.name)).toMatchObject({ installed: 'absent', placed: false, onDiskOnly: false, paths: [] });
    const detail = await backend.skill({ ref: target.name });
    expect(detail).toMatchObject({ ok: true, value: { installed: 'absent', placed: false, onDiskOnly: false, paths: [] } });
    const local = library.value.skills.find(s => s.name === target.name);
    if (local) expect(local).toMatchObject({ installed: 'absent', placed: false, onDiskOnly: false, paths: [] });
  }
  off();
});
it('shows failures from install in the centered error layout', async () => { vi.spyOn(pickBackend(), 'install').mockImplementation(() => { throw new Error('Cannot install project.'); }); open('#/marketplace/projects/docs?dialog=install'); const dialog = await screen.findByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Install 3 skills' })); expect(await screen.findByRole('alert')).toHaveTextContent('Cannot install project.'); });

it.each(['-1', 'abc', '9'.repeat(400)])('treats invalid active facet count %s as zero', async active => { open('#/marketplace?q=deploy%20prod&active=' + active); expect(await screen.findByText('No skills match “deploy prod”')).toBeInTheDocument(); expect(screen.queryByText(/with .* filters on/)).toBeNull(); });

it('commits a changed facet selection and shrinks the list to the CTA count', async () => {
  open('#/marketplace/skills?filters=open');
  const filters = await screen.findByRole('region', { name: 'Marketplace filters' });
  fireEvent.change(within(filters).getByLabelText('Installed by · at least'), { target: { value: '12' } });
  fireEvent.click(within(filters).getByRole('button', { name: 'Show 1 skill' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Marketplace filters' })).toBeNull());
  await waitFor(() => expect(names('skill-card-')).toEqual(['deploy-check']));
  expect(location.hash).toContain('installs=12');
  expect(location.hash).toContain('active=4');
});

it('keeps the list unchanged when the untouched default selection is committed', async () => {
  open('#/marketplace/skills?filters=open');
  const filters = await screen.findByRole('region', { name: 'Marketplace filters' });
  fireEvent.click(within(filters).getByRole('button', { name: `Show ${design.DERIVED.filterCount} skills` }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Marketplace filters' })).toBeNull());
  expect(location.hash).toContain('active=4');
  expect(names('skill-card-')).toEqual(design.DERIVED.topRated);
});

it('clears committed facets and restores the full list', async () => {
  open('#/marketplace/skills?filters=open');
  const filters = await screen.findByRole('region', { name: 'Marketplace filters' });
  fireEvent.change(within(filters).getByLabelText('Installed by · at least'), { target: { value: '12' } });
  fireEvent.click(within(filters).getByRole('button', { name: 'Show 1 skill' }));
  await waitFor(() => expect(names('skill-card-')).toEqual(['deploy-check']));
  fireEvent.click(screen.getByRole('button', { name: 'Filter marketplace' }));
  const reopened = await screen.findByRole('region', { name: 'Marketplace filters' });
  fireEvent.click(within(reopened).getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(names('skill-card-')).toEqual(design.DERIVED.topRated));
  expect(within(reopened).getByRole('button', { name: `Show ${design.CATALOG.length} skills` })).toBeInTheDocument();
  expect(location.hash).toContain('active=0');
  expect(location.hash).not.toContain('installs=');
});

it('hides installed skills when committed with the hide switch on', async () => {
  open('#/marketplace/skills?filters=open');
  const filters = await screen.findByRole('region', { name: 'Marketplace filters' });
  fireEvent.click(within(filters).getByRole('switch'));
  fireEvent.click(within(filters).getByRole('button', { name: 'Show 2 skills' }));
  await waitFor(() => expect(names('skill-card-')).toEqual(['a11y-audit', 'secret-scan']));
});

it('installs from a marketplace card via the install dialog without entering a mock scenario', async () => {
  open('#/marketplace/skills');
  await screen.findByRole('heading', { name: 'Top rated' });
  const wrap = screen.getByTestId('skill-card-a11y-audit').closest('.market-card-wrap') as HTMLElement;
  fireEvent.click(wrap.querySelector('.market-card-install')!);
  await waitFor(() => expect(location.hash).toBe('#/skill/a11y-audit?dialog=install&root=marketplace'));
  expect(location.hash).not.toContain('__mock');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

it('uses status Global and checkout root counts on the empty scenario', async () => {
  const source = pickBackend();
  const status = await source.status();
  if (!status.ok) throw new Error(status.error);
  vi.spyOn(source, 'status').mockResolvedValue({ ...status, value: { ...status.value, counts: { Global: '71' } } });
  open('#/marketplace?__mock=empty');
  expect(await screen.findByRole('link', { name: 'Global 71' })).toBeInTheDocument();
  expect([...document.querySelectorAll('.nav-count')].map(node=>node.textContent)).toEqual(['71','8','3','2']);
});

it('keeps one person link and follows without leaving the people list', async () => {
  open('#/marketplace/people');
  const card = await screen.findByTestId('person-card-ryan');
  expect(within(card).getAllByRole('link')).toHaveLength(1);
  expect(within(card).getByRole('link', { name: 'Ryan Liu' })).toHaveAttribute('href', '#/marketplace/people/ryan');
  fireEvent.click(within(card).getByRole('button', { name: 'Follow ryan' }));
  expect(within(card).getByRole('button', { name: 'Unfollow ryan' })).toHaveAttribute('aria-pressed', 'true');
  expect(location.hash).toBe('#/marketplace/people');
});

it('preserves the mock role line and project description/admin foot', async () => {
  open('#/marketplace/people');
  expect(await screen.findByText('founder · ryan')).toBeVisible();
  cleanup();
  open('#/marketplace/projects');
  const card = await screen.findByTestId('project-card-terum');
  const project = design.PROJECTS.find(p => p.key === 'terum')!;
  expect(card.querySelector('.market-project-desc')?.textContent).toBe(project.desc);
  expect(card.querySelector('.market-project-foot')).toHaveTextContent(project.admin.name);
  expect(card.querySelector('.market-project-foot')).toHaveTextContent(`admin · updated ${project.updated}`);
});
it('asks every bulk-install tool question and treats declined consent as cancellation', async () => {
  const answers: unknown[] = [];
  vi.spyOn(pickBackend(), 'install').mockImplementation(() => createRun(async ctx => {
    const first = await ctx.ask('confirm', 'Approve these tools for one?'); answers.push(first);
    if (!first) return { ok: false, cancelled: true, error: 'Declined.' };
    const second = await ctx.ask('confirm', 'Approve these tools for two?'); answers.push(second);
    return second ? { ok: true, value: [] } : { ok: false, cancelled: true, error: 'Declined.' };
  }));
  open('#/marketplace/people/lena');
  fireEvent.click(await screen.findByRole('button', { name: 'Install 3 skills' }));
  const first = await screen.findByRole('dialog', { name: 'Approve these tools for one?' });
  expect(answers).toEqual([]);
  fireEvent.click(within(first).getByRole('button', { name: 'Yes' }));
  const second = await screen.findByRole('dialog', { name: 'Approve these tools for two?' });
  expect(answers).toEqual([true]);
  fireEvent.click(within(second).getByRole('button', { name: 'No' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(answers).toEqual([true, false]);
  expect(screen.queryByRole('alert')).toBeNull();
});
