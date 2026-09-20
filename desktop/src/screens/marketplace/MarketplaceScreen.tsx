import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { driveRun, PrintContext, PromptContext, useBackend, useFeatures } from '../../backend';
import type { Catalog, Person, Project, Run, Scope } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { useSyncAction } from '../../components/domain/useSyncAction';
import { useAddLibraryProject } from '../../components/domain/useAddLibraryProject';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { useUiStore } from '../../app/store';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { AlertText, Avatar, BoardSkeleton, CenteredState, ErrorLine, Facepile, SectionLabel, Small, TerminalHint } from '../../components/domain/Primitives';
import { SkillCardSkeleton } from '../../components/domain/SkillCard';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Chip } from '../../components/ui/Chip';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { CardRow, CategoryRow, CategoryTile, Crumbs, Follow, Mark, MarketRail, MarketSearch, PersonCard, ProjectCard, Section } from './market-components';
import { plural, pluralWord, rawGrants, personStatus } from './market-data';
import { destinationsFor } from './install-destinations';
import { RadioGroup, RadioRow } from '../../components/ui/RadioGroup';
import './marketplace.css';
function Hero() { return <div className="market-hero"><h1>Marketplace</h1><span>Your team's best skills, all in one place.</span><div><MarketSearch hero/></div></div>; }
function Home({ catalog: c }: { catalog: Catalog }) { return <><Section title="Top rated" subtitle={`by installs, from people files · ${c.catalogN} skills`} path="skills"><CardRow catalog={c} names={c.topRated.slice(0, 3)}/></Section><Section title="Teams / Projects" subtitle={`${plural(c.projects.length, 'project')} · their skills place when you sync inside the repo`} action={<AddProjectButton/>}><div className="market-grid four">{c.projects.map(p => <ProjectCard key={p.key} project={p}/>)}</div></Section><Section title="People" subtitle={`${plural(c.teamN, 'teammate')} · ranked by adoption`} path="people"><div className="market-grid four">{c.peopleByAdoption.slice(0, 4).map(handle => { const person = c.people.find(p => p.handle === handle); if (!person) throw new Error(`Catalog is missing teammate ${handle}.`); return <PersonCard key={handle} person={person}/>; })}</div></Section><Section title="Browse by category" subtitle={`${plural(c.categories.length, 'category', 'categories')} · from SKILL.md frontmatter`} path="categories"><div className="market-grid five">{c.categories.map(category => <CategoryTile key={category[0]} category={category}/>)}</div></Section></>; }
function Loading() { return <div className="market-home" aria-label="Loading marketplace"><div className="market-hero"><div className="market-loading-title"><BoardSkeleton width={150} height={24}/></div><div className="market-loading-tagline"><BoardSkeleton width={280} height={12}/></div><div><BoardSkeleton width={560} height={32} radius={8}/></div></div>{[0, 1, 2].map(section => <div className="market-section" key={section}><div className="market-section-head"><BoardSkeleton width={160} height={14}/><BoardSkeleton width={28} height={28} radius={6}/></div><div className={'market-grid ' + (section ? 'four' : '')}>{Array.from({ length: section ? 4 : 3 }, (_, i) => section === 0 ? <SkillCardSkeleton key={i}/> : section === 1 ? <div className="market-project-card" key={i}><div className="market-card-head"><BoardSkeleton width={32} height={32} radius={8}/><BoardSkeleton width="50%" height={14}/></div><BoardSkeleton width="100%" height={10}/><BoardSkeleton width="70%" height={10}/><div className="market-inline" style={{ paddingTop: 2 }}><BoardSkeleton width={56} height={20}/><BoardSkeleton width={64} height={20}/></div></div> : <div className="market-person-card" key={i}><div className="market-card-head"><BoardSkeleton width={32} height={32} radius={16}/><div className="market-loading-person"><BoardSkeleton width="45%" height={14}/><BoardSkeleton width="35%" height={10}/></div><BoardSkeleton width={56} height={20}/></div><div className="market-loading-person-lines"><BoardSkeleton width="85%" height={10}/><BoardSkeleton width="50%" height={10}/></div><div className="market-inline"><BoardSkeleton width={52} height={20}/><BoardSkeleton width={66} height={20}/><BoardSkeleton width={70} height={20}/></div></div>)}</div></div>)}</div>; }
function matches(text: string, query: string) { return text.toLowerCase().includes(query.toLowerCase()); }
function skillNames(catalog: Catalog, names: string[], query: string) {
  return names.filter(name => {
    const skill = [...catalog.skills, ...catalog.extras].find(s => s.name === name);
    // A name with no catalog card passes when unqueried, as before — with no card there is no name or description to match against.
    return !query || (skill !== undefined && matches(skill.name + ' ' + skill.desc, query));
  });
}
/**
 * Add: the team-project half of "project". The sidebar's Add project registers a local checkout
 * folder; this one names a shared project in team.json. Hidden when the CLI has no `project create`,
 * the same way the sidebar hides its own button on an older CLI.
 */
function AddProjectButton() {
  const features = useFeatures(), [search, setSearch] = useSearchParams();
  if (!features?.projects) return null;
  return <Button icon="plus" onClick={() => { const next = new URLSearchParams(search); next.set('dialog', 'new-project'); setSearch(next); }}>Add</Button>;
}

/**
 * The name rule itself is the CLI's (`projectNameSchema`) and its refusal is shown verbatim, so the
 * two never drift. What the app checks first is only what the app already knows: a name was typed,
 * and no card in this catalog already carries it (compared case-insensitively, because every reader
 * of team.json matches project keys exactly).
 */
function NewProjectDialog({ catalog, onClose, onCreated }: { catalog: Catalog; onClose: () => void; onCreated: (name: string) => void }) {
  const backend = useBackend(), action = useWorkflow();
  const [name, setName] = useState(''), [remote, setRemote] = useState('');
  const trimmed = name.trim(), taken = catalog.projects.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  const problem = taken ? `This team already has a project named ${taken.name}.` : null;
  const message = problem ?? action.error;
  function create() {
    if (!trimmed || problem || action.busy) return;
    void action.run(() => backend.teamProjects.create({ name: trimmed, ...(remote.trim() ? { remote: remote.trim() } : {}) }), {}, created => onCreated(created.name));
  }
  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}><DialogPopup>
    <DialogTitle>New project</DialogTitle>
    <DialogDescription>A team project is a name and a repository. Skills endorsed into it place themselves when a teammate syncs inside that repo's checkout.</DialogDescription>
    <div className="market-form">
      <label className="market-field"><SectionLabel>Project name</SectionLabel><input autoFocus value={name} placeholder="Payments" aria-label="Project name" onChange={event => { setName(event.target.value); action.clear(); }} onKeyDown={event => { if (event.key === 'Enter') create(); }}/></label>
      <label className="market-field"><SectionLabel>GitHub repository · optional</SectionLabel><input value={remote} placeholder="https://github.com/org/repo" aria-label="GitHub repository" onChange={event => { setRemote(event.target.value); action.clear(); }} onKeyDown={event => { if (event.key === 'Enter') create(); }}/><Small>Leave it empty to name the project now and give it a home later.</Small></label>
    </div>
    {message ? <ErrorLine>{message}</ErrorLine> : null}
    <TerminalHint command={`npx -y terum-skills@latest project create ${trimmed || '<name>'}`}/>
    <div className="market-dialog-actions"><Button disabled={action.busy} onClick={onClose}>Cancel</Button><Button kind="primary" disabled={!trimmed || problem !== null || action.busy} onClick={create}><span>Create project</span></Button></div>
  </DialogPopup></Dialog>;
}
/** A failed action names the action that failed. The read board below speaks for the catalog read alone, so an install
 *  the CLI refuses is never drawn as "Couldn't read the marketplace" - the headline names the verb the user pressed. */
export type ActionError = { op: string; message: string };
function InstallDialog({ project, catalog, busy, actionError, onClose, onInstall }: { project: Project; catalog: Catalog; busy: boolean; actionError: ActionError | null; onClose: () => void; onInstall: (scope: Scope) => void }) {
  const backend = useBackend(), features = useFeatures(), projectAdd = useAddLibraryProject(), state = useUrlState();
  const status = useQuery({ queryKey: ['status', state.mock], queryFn: ({ signal }) => backend.status(undefined, { signal }) });
  const roots = status.data?.ok ? status.data.value.roots : [];
  const model = destinationsFor(roots, project.remoteSlugs, { libraryProjects: features?.libraryProjects ?? false });
  const [chosen, setChosen] = useState<string | undefined>();
  const scope = chosen ?? model.preselected;
  const counts = catalog.bulkInstall[project.key];
  const asking = counts ? project.skillsIn.map(name => [...catalog.skills, ...catalog.extras].find(s => s.name === name)).filter(s => s !== undefined).filter(s => rawGrants(s).length > 0) : [];
  const error = projectAdd.error ?? (status.data?.ok === false ? status.data.error : status.error?.message);
  return <><Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogPopup><DialogTitle>Install project {project.name}</DialogTitle><DialogDescription>Copies the latest version of the project's {project.skills} {pluralWord(project.skills, 'skill')} to the destination you choose and records your installs. Replacing an existing copy asks first and keeps it in that destination's .claude/old-skills folder. Each installed skill is added to your profile.</DialogDescription>
    <SectionLabel>Install to</SectionLabel>
    <RadioGroup value={scope ?? ''} onValueChange={value => setChosen(String(value))}>{model.rows.map(([label, caption]) => <RadioRow key={label} value={label} label={label} caption={caption}/>)}</RadioGroup>
    {model.addRow ? <Button icon="plus" disabled={busy || projectAdd.busy} onClick={() => void projectAdd.add(undefined, added => { setChosen(added.label); void status.refetch(); })}>Add project…</Button> : null}
    {error ? <ErrorLine>{error}</ErrorLine> : null}
    {actionError ? <AlertText className="board-error-line">{`Couldn't ${actionError.op} \u2014 ${actionError.message}`}</AlertText> : null}
    {counts && <div className="market-install-grants"><SectionLabel>Tool grants to approve · {counts.asking} of {counts.total} ask</SectionLabel><div>{asking.map(s => <div className="market-install-grant-row" key={s.name}><span>{s.name}</span><div>{rawGrants(s).map(g => <Chip key={g}>{g}</Chip>)}</div></div>)}</div><Small>Approved once per machine; changed grants ask again.</Small></div>}<TerminalHint command={`npx -y terum-skills@latest install project ${project.key}`}/><div className="market-dialog-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button kind="primary" disabled={busy || status.isPending || !status.data?.ok || scope === null} onClick={() => { if (scope !== null) onInstall(scope); }}><span>{`Install ${plural(project.skills, 'skill')}`}</span></Button></div></DialogPopup></Dialog>{projectAdd.dialog}</>;
}
function DetailPage({ catalog: c, project, person, busy, actionError, onRun, onError }: { catalog: Catalog; project?: Project; person?: Person; busy: boolean; actionError: ActionError | null; onRun: (start: () => Run<unknown>, answers: Record<string, string | boolean> | undefined, done: (() => void) | undefined, op: string) => Promise<boolean>; onError: (op: string, message: string) => void }) {
  const state = useUrlState(), [params, setParams] = useSearchParams(), backend = useBackend(), features=useFeatures(), [favoriteOverride, setFavorite] = useState<boolean|null>(null);
  const favorite=features?.favorites?(favoriteOverride??backend.prefs.get('favorite-project:'+(project?.key??''),false)):false;
  const q = project, p = person, name = q?.name ?? p?.handle ?? '', total = q?.skills ?? p?.installable.length ?? 0, ref = q?.key ?? p?.handle ?? '', names = q?.skillsIn ?? p?.skills ?? [], query = state.q ?? '';
  const status = useQuery({ queryKey: ['status', state.mock], queryFn: ({signal}) => backend.status(undefined, {signal}) });
  const ownHandle = status.data?.ok ? status.data.value.me.handle : undefined;
  const removable = q ? q.skillsIn : p?.installable ?? [];
  const installed = q ? q.installed : !!p && personStatus(p)[0] === 'Installed';
  function param(key: string, value?: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); }
  function remove() { return onRun(() => backend.uninstallSkill(q ? { ref, kind: 'project', project: ref } : { ref, kind: 'member', member: ref }), {}, () => {}, `remove ${name}`); }
  function install(scope?: Scope) { return onRun(() => backend.install(q ? { ref, kind: 'project', project: ref, ...(scope === undefined ? {} : { scope }) } : { ref, kind: 'member', member: ref }), {}, () => { param('dialog'); }, `install ${name}`); }
  function fav() { try { backend.prefs.set('favorite-project:' + ref, !favorite); setFavorite(!favorite); } catch (e) { onError('save this favorite', e instanceof Error ? e.message : 'Could not save favorite.'); } }
  // Edit opens the project's placed checkout; with no recorded path there is nothing on this machine to open, so the button hides (the SkillScreen path!==null pattern) instead of guessing a relative people-file path the editor cannot resolve.
  async function edit() { if (!q?.path) return; try { const result = await backend.openInEditor(q.path); if (!result.ok) onError('open the editor', result.error); } catch (e) { onError('open the editor', e instanceof Error ? e.message : 'Could not open editor.'); } }
  return <><Crumbs parts={['Team', 'Marketplace', q ? 'Projects' : 'People', name]} railOpen={state.railOpen} onToggle={() => { if (state.railOpen) param('rail', 'closed'); else { useUiStore.setState({ railOpen: true }); param('rail'); } }}/><div className="market-detail"><div className="market-page-main"><div className="market-page-head">{q ? <div className="market-project-heading"><div><Mark name={q.ico}/><h1>{q.name}</h1>{features?.projectMembers?<Facepile initials={q.memberInitials.slice(0, 3)} total={q.members} label={`${q.members} teammates use this project`}/>:null}</div>{q.desc && <span>{q.desc}</span>}</div> : p ? <div className="market-person-heading"><Avatar initials={p.initials} size={64}/><div><h1>{p.name}</h1>{p.handle!==p.name?<span>{p.handle}</span>:null}{features?.memberRole&&(p.role||p.organization)?<Small>{[p.role,p.organization].filter(Boolean).join(' · ')}</Small>:null}<div className="market-inline">{features?.follow?<Chip>{p.followers===null?'—':plural(p.followers, 'follower')}</Chip>:null}<Chip>{plural(total, 'skill')}</Chip></div></div></div> : null}<div className="market-page-actions">{q ? features?.favorites?<button className="market-favorite" type="button" aria-label={`♡ ${q.favorites}`} aria-pressed={favorite} onClick={fav}><Icon name="heart" size={14} filled={favorite}/><span>{q.favorites}</span></button>:null : p && <Follow key={p.handle} person={p}/>} {p&&total===0?<div className="market-page-empty"><span>{personStatus(p)[0]}</span><Small>{personStatus(p)[1]}</Small></div>:q&&total===0?<div className="market-page-empty"><span>No skills yet</span><Small>{`Endorse a skill into ${q.name} and it places itself when a teammate syncs inside the repo.`}</Small></div>:installed && removable.length > 0 ? <>{q && q.path !== null && <Button icon="pencil" onClick={() => void edit()}>Edit</Button>}<Button className="market-remove" icon="trash" iconOnly disabled={busy} aria-label={q ? `Remove ${name}'s ${plural(total, 'skill')} from this machine` : ref === ownHandle ? `Remove the ${plural(total, 'skill')} on your profile from this machine` : `Remove ${ref}'s ${plural(total, 'skill')} from this machine`} onClick={() => void remove()}/></> : <Button kind="primary" icon="arrow-down-to-line" disabled={busy} state={state.dialog === 'install' ? 'pressed' : 'default'} onClick={() => q ? param('dialog', 'install') : void install()}><span>{`Install ${plural(total, 'skill')}`}</span></Button>}</div></div><div className="market-rule"/>{actionError && !(q && state.dialog === 'install') ? <AlertText className="board-error-line">{`Couldn't ${actionError.op} \u2014 ${actionError.message}`}</AlertText> : null}<div className="market-page-search"><MarketSearch placeholder={`Search ${name}'s ${plural(total, 'skill')}`}/></div>{q ? <CardRow catalog={c} names={skillNames(c, names, query)} cols={state.railOpen ? 2 : 3}/> : p?.buckets.map(([bucket, bucketNames]) => <section className="market-bucket" aria-label={bucket} key={bucket}><div className="market-bucket-head"><span>{bucket}</span></div><CardRow catalog={c} names={skillNames(c, bucketNames, query)} profileVersions={bucket==='On their profile'?p.profileVersions:undefined} cols={state.railOpen ? 2 : 3}/></section>)}</div>{state.railOpen && <MarketRail repository={c.repository} {...(q ? { project: q } : p ? { person: p } : {})}/>}</div>{q && state.dialog === 'install' && <InstallDialog project={q} catalog={c} busy={busy} actionError={actionError} onClose={() => param('dialog')} onInstall={scope => void install(scope)}/>}</>;
}
function ListPage({ catalog: c, type, categoryKey, rosterOrder }: { catalog: Catalog; type: string; categoryKey?: string; rosterOrder: string[] }) {
  const { q = '' } = useUrlState(), [listParams, setListParams] = useSearchParams(); let title: string, subtitle: string, search: string, sort: string, icon = 'folder', trail: string[], body: ReactNode;
  // The boards draw the sort control with one ranking per list (its default label), so the button toggles between that drawn ranking and A–Z; the default URL state renders exactly the drawn label and order.
  const byName = listParams.get('sort') === 'name';
  function toggleSort() { const next = new URLSearchParams(listParams); if (byName) next.delete('sort'); else next.set('sort', 'name'); setListParams(next); }
  const order = <T,>(rows: T[], key: (row: T) => string): T[] => byName ? [...rows].sort((a, b) => key(a).localeCompare(key(b))) : rows;
  const category = c.categories.find(cat => cat[0] === categoryKey);
  if (categoryKey && !category) throw new Error(`No category named ${categoryKey}.`);
  if (type === 'skills') { title = 'Top rated'; subtitle = `${c.skills.length} of ${c.catalogN} skills · by installs, from people files`; search = `Search ${c.catalogN} skills`; sort = 'Most installed'; icon = 'store'; trail = ['Top rated']; body = <CardRow catalog={c} names={order(skillNames(c, c.topRated, q), name => name)}/>; }
  else if (type === 'people') { title = 'People'; subtitle = `${plural(c.teamN, 'teammate')} · ranked by adoption: installs of the skills they authored, from people files`; search = `Search ${plural(c.teamN, 'person', 'people')}`; sort = 'Most installs'; icon = 'users'; trail = ['People']; body = <div className="market-grid four">{order(rosterOrder.map(handle => c.people.find(p => p.handle === handle)).filter(p => p !== undefined).filter(p => matches(p.name + ' ' + p.handle, q)), p => p.name).map(p => <PersonCard key={p.handle} person={p}/>)}</div>; }
  else if (category) { title = category[0]; subtitle = `${(c.categorySkills[category[0]] ?? []).length} of ${plural(category[2], 'skill')} · category from SKILL.md frontmatter · by installs`; search = `Search ${plural(category[2], 'skill')}`; sort = 'Most installed'; icon = category[0]; trail = ['Categories', category[0]]; body = <CardRow catalog={c} names={order(skillNames(c, c.categorySkills[category[0]] ?? [], q), name => name)}/>; }
  else { title = 'Browse by category'; subtitle = `${plural(c.categories.length, 'category', 'categories')} · from SKILL.md frontmatter · counts are the whole catalog's`; search = `Search ${plural(c.categories.length, 'category', 'categories')}`; sort = 'Most skills'; trail = ['Categories']; body = <div className="market-category-rows">{order(c.categories.filter(category => matches(category[0], q)), category => category[0]).map(category => <CategoryRow key={category[0]} category={category} catalog={c}/>)}</div>; }
  return <><Crumbs parts={['Team', 'Marketplace', ...trail]}/><div className="market-page-main"><div className="market-list-head"><Mark name={icon}/><div><h1>{title}</h1><span>{subtitle}</span></div></div><div className="market-rule"/><div className="market-list-tools"><MarketSearch placeholder={search}/><Button kind="ghost" icon="sort" aria-pressed={byName} onClick={toggleSort}>{byName ? 'Name' : sort}</Button></div>{body}</div></>;
}
export function MarketplaceScreen() {
  const backend = useBackend(), state = useUrlState(), params = useParams(), location = useLocation(), navigate = useNavigate(), [search, setSearch] = useSearchParams(), print=useContext(PrintContext), prompt = useContext(PromptContext);
  const syncAction=useSyncAction();
  const [actionError, setActionError] = useState<ActionError | null>(null), [busy, setBusy] = useState(false);
  const type = location.pathname.split('/')[2] ?? '', isPeopleList = type === 'people' && !params.handle;
  const query = useQuery({ queryKey: ['catalog', state.mock], queryFn:({signal})=>backend.catalog(undefined,{signal}) });
  const roster = useQuery({ queryKey: ['roster', state.mock], queryFn:({signal})=>backend.roster(undefined,{signal}), enabled: isPeopleList });
  const catalog = query.data?.ok ? query.data.value : undefined, project = type === 'projects' ? catalog?.projects.find(p => p.key === params.key) : undefined, person = type === 'people' ? catalog?.people.find(p => p.handle === params.handle) : undefined;
  const unknown = catalog && params.key && type === 'projects' && !project ? `No project named ${params.key}.` : catalog && params.handle && !person ? `No teammate named ${params.handle}.` : catalog && params.key && type === 'categories' && !catalog.categories.some(c => c[0] === params.key) ? `No category named ${params.key}.` : null;
  // Only a failed catalog (or roster) read may blank the page behind "Couldn't read the marketplace". An action's failure
  // is the action's to report: it keeps its verb, and draws next to the control that started it.
  const readError = query.data?.ok === false ? query.data.error : query.isError ? query.error.message : isPeopleList ? roster.data?.ok === false ? roster.data.error : roster.isError ? roster.error.message : null : null;
  const pending = query.isPending || (isPeopleList && roster.isPending), ready = state.mock === 'loading' || !pending;
  async function run(start: () => Run<unknown>, answers: Record<string, string | boolean> = {}, done?: () => void, op = 'complete that') { if (busy) return false; setBusy(true); setActionError(null); try { const result = await driveRun(start(), answers, prompt, print); if (!result.ok) { if (!result.cancelled) setActionError({ op, message: result.error }); return false; } done?.(); return true; } catch (e) { setActionError({ op, message: e instanceof Error ? e.message : 'Marketplace operation failed.' }); return false; } finally { setBusy(false); } }
  function clear(key: string) { const next = new URLSearchParams(search); next.delete(key); setSearch(next); }
  const names = catalog ? skillNames(catalog, catalog.topRated, state.q ?? '') : [];
  return <Shell selected="Marketplace" counts={pending && !readError ? null : undefined}><ScreenFrame ready={ready}>{readError ? <div className="market-home"><Hero/><CenteredState alert icon="alert" title="Couldn't read the marketplace" body="terum-skills could not read the team catalog, so this page shows nothing rather than a stale catalog. The message below is the CLI's own." primary="Sync now" secondary="Open settings" onPrimary={syncAction.open} onSecondary={() => navigate('/settings/account')}><ErrorLine>{readError}</ErrorLine></CenteredState></div> : unknown ? <CenteredState icon="search" title="Not found" body={unknown} primary="Back to marketplace" onPrimary={() => navigate('/marketplace')}/> : pending || !catalog ? <Loading/> : project || person ? <DetailPage key={project?.key ?? person?.handle} catalog={catalog} {...(project ? { project } : person ? { person } : {})} busy={busy} actionError={actionError} onRun={run} onError={(op, message) => setActionError({ op, message })}/> : type ? <ListPage catalog={catalog} type={type} {...(params.key ? { categoryKey: params.key } : {})} rosterOrder={roster.data?.ok ? catalog.peopleByAdoption : []}/> : <div className="market-home"><Hero/>{state.q && !names.length ? <CenteredState icon="search" title={`No skills match “${state.q}”`} body="Try a shorter query, or browse the catalog by team, person or category." primary="Clear search" onPrimary={() => clear('q')}/> : state.q ? <div className="market-search-results"><CardRow catalog={catalog} names={names}/></div> : <Home catalog={catalog}/>}</div>}{catalog && state.dialog === 'new-project' ? <NewProjectDialog catalog={catalog} onClose={() => clear('dialog')} onCreated={name => { clear('dialog'); navigate('/marketplace/projects/' + encodeURIComponent(name)); }}/> : null}{syncAction.popup}</ScreenFrame></Shell>;
}
