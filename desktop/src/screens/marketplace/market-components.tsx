import { Fragment, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useBackend } from '../../backend';
import type { Catalog, Person, Project, SkillCard as Card } from '../../backend/types';
import { Avatar, IconButton, SectionLabel, ShareBlock, Small } from '../../components/domain/Primitives';
import { SkillCard } from '../../components/domain/SkillCard';
import { token } from '../../components/domain/presentation';
import { Icon } from '../../components/ui/Icon';
import { ICON_PATHS } from '../../components/ui/icon-paths';
import type { IconName } from '../../components/ui/icon-paths';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { activeFacets, plural } from './market-data';
import { Filters } from './market-filters';
function iconName(name: string): IconName { if (!Object.hasOwn(ICON_PATHS, name)) throw new Error(`Unknown marketplace icon: ${name}`); return name as IconName; }
export function CardRow({ names, catalog, cols = 3 }: { names: string[]; catalog: Catalog; cols?: number }) { const available = [...catalog.skills, ...catalog.extras]; return <div className="market-grid" data-columns={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{names.map(name => { const skill = available.find(s => s.name === name); if (!skill) throw new Error(`Catalog is missing skill ${name}.`); return <MarketplaceSkillCard key={name} skill={skill}/>; })}</div>; }

function MarketplaceSkillCard({ skill }: { skill: Card }) {
  const navigate = useNavigate();
  // The shared card has no install-hint slot. Keep its layout and reserve that button's space,
  // then supply the board's icon + label in this family wrapper (footer top = 13 + 50 + 8 + 32 + 8).
  return <div className="market-card-wrap"><SkillCard skill={skill}/>{!skill.installed && <button className="market-card-install" type="button" onClick={() => navigate('/skill/' + skill.name + '?__mock=not-installed&dialog=install')}><Icon name="arrow-down-to-line" size={14} stroke="1.75"/><span>Install</span></button>}</div>;
}
export function Mark({ name, small = false }: { name: string; small?: boolean }) { return <span className={'market-mark' + (small ? ' small' : '')}><Icon name={iconName(name)} size={small ? 15 : 16}/></span>; }
export function Follow({ person, compact = false }: { person: Person; compact?: boolean }) {
  const backend = useBackend(), [following, setFollowing] = useState(() => backend.prefs.get('following:' + person.handle, false)), [error, setError] = useState<string | null>(null);
  function toggle() { try { backend.prefs.set('following:' + person.handle, !following); setFollowing(!following); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save follow preference.'); } }
  return <span className="market-follow"><Button className={compact ? 'market-follow-compact' : ''} aria-label={`${following ? 'Unfollow' : 'Follow'} ${person.handle}`} aria-pressed={following} onClick={toggle} {...(!compact ? { icon: following ? 'check' as const : 'bell' as const } : {})}>{compact && <Icon name={following ? 'check-circle' : 'bell'} size={14} stroke="1.75" color={following ? token('good') : 'currentColor'}/>}<span>{following ? 'Following' : 'Follow'}</span></Button>{error && <span role="alert">{error}</span>}</span>;
}
function InstallMark({ installed }: { installed: boolean }) { return <span className="market-install-mark"><Icon name={installed ? 'check-circle' : 'arrow-down-to-line'} size={14} color={installed ? token('good') : 'currentColor'} stroke="1.75"/>{installed ? 'Installed' : 'Install'}</span>; }
export function ProjectCard({ project: q, expanded = false }: { project: Project; expanded?: boolean }) { return <Link to={'/marketplace/projects/' + q.key} className={'market-project-card' + (expanded ? ' expanded' : '')} data-testid={'project-card-' + q.key}><div className="market-card-head"><Mark name={q.ico}/><span>{q.name}</span>{expanded && <InstallMark installed={q.installed}/>}</div><span className="market-project-desc">{q.desc}</span><div className="market-card-chips"><div><Chip>{q.skills} skills</Chip><Chip>{q.members} members</Chip>{expanded && <Chip>{q.evaluated} of {q.skills} evaluated</Chip>}</div>{!expanded && <InstallMark installed={q.installed}/>}</div>{expanded && <div className="market-project-foot"><div><Avatar initials={q.admin.initials} size={20}/><span>{q.admin.name}</span><Small>admin · updated {q.updated}</Small></div><Small><span className="board-mono">{q.remote}</span></Small></div>}</Link>; }
export function PersonCard({ person: q }: { person: Person }) { return <article className="market-person-card" data-testid={'person-card-' + q.handle}><div className="market-card-head"><Link to={'/marketplace/people/' + q.handle} aria-label={q.name}><Avatar initials={q.initials} size={32}/></Link><div className="market-person-ident"><Link to={'/marketplace/people/' + q.handle}>{q.name}</Link><span>{q.role} · {q.handle}</span></div><Follow person={q} compact/></div><div className="market-person-lines"><span>{q.publishLine}</span><span>{q.teamsLine}</span></div><div className="market-inline"><Chip>{plural(q.skills.length, 'skill')}</Chip><Chip>{plural(q.adoption, 'install')}</Chip><Chip>{plural(q.followers, 'follower')}</Chip></div></article>; }
export function CategoryTile({ category: [key, icon, n] }: { category: Catalog['categories'][number] }) { return <Link to={'/marketplace/categories/' + key} className="market-category-tile"><Mark name={icon} small/><div><span>{key}</span><span>{plural(n, 'skill')}</span></div></Link>; }
export function CategoryRow({ category: [key, icon, n], catalog }: { category: Catalog['categories'][number]; catalog: Catalog }) { const remaining = catalog.categoryRemaining[key] ?? 0; return <Link to={'/marketplace/categories/' + key} className="market-category-row" data-testid={'category-row-' + key}><Mark name={icon} small/><div><span>{key}</span><span>{plural(n, 'skill')}</span></div><span>{catalog.categorySkills[key]?.join(' · ')}{remaining > 0 ? ` · +${remaining} more` : ''}</span><Icon name="chevron-right" size={14} stroke="2"/></Link>; }
export function Section({ title, subtitle, path, children }: PropsWithChildren<{ title: string; subtitle: string; path: string }>) { const navigate = useNavigate(); return <section className="market-section" aria-label={title}><div className="market-section-head"><div><h2>{title}</h2><span>{subtitle}</span></div><Button icon="chevron-right" iconOnly aria-label={'View all ' + title} onClick={() => navigate('/marketplace/' + path)}/></div>{children}</section>; }


export function MarketSearch({ placeholder = 'Search skills, people and projects', hero = false, catalog }: { placeholder?: string; hero?: boolean; catalog?: Catalog }) {
  const [params, setParams] = useSearchParams(), q = params.get('q') ?? '', [draft, setDraft] = useState(q), [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) { setLastQ(q); setDraft(q); }
  const open = params.get('filters') === 'open'; const rawActive = params.get('active'); const active = activeFacets(rawActive, open ? 4 : 0);
  function change(key: string, value?: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); }
  return <div className={'market-search' + (hero ? ' hero' : '')}><Icon name="search" size={16} color={token('text3')}/><input aria-label={placeholder} placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') change('q', draft); }}/>{q && <IconButton icon="x" size={20} iconSize={14} label="Clear search field" onClick={() => change('q')}/>}<span className="market-filter-button"><IconButton icon="filter" label="Filter marketplace" pressed={open} onClick={() => change('filters', open ? undefined : 'open')}/>{active > 0 && <span>{active}</span>}</span>{open && catalog && <Filters catalog={catalog} onClose={() => change('filters')}/>}</div>;
}
export function Crumbs({ parts, railOpen, onToggle }: { parts: string[]; railOpen?: boolean; onToggle?: () => void }) { const navigate = useNavigate(); return <div className="market-crumbs" data-rail-open={railOpen}><div><IconButton icon="arrow-left" size={28} label="Back to marketplace" onClick={() => navigate('/marketplace')}/><div>{parts.map((part, i) => <Fragment key={i}>{i > 0 && <span className="market-crumb-separator">/</span>}<span className={i === parts.length - 1 ? 'current' : ''}>{part}</span></Fragment>)}</div></div>{onToggle && <IconButton icon="panel-right" size={28} label={railOpen ? 'Close details rail' : 'Open details rail'} onClick={onToggle}/>}</div>; }


export function MarketRail({ project, person }: { project?: Project; person?: Person }) {
  if (!project && !person) throw new Error('A marketplace rail needs a project or person.');
  const q = project, p = person;
  const status = q ? q.installed ? ['Installed', `${q.skills} skills placed in ${q.path}`] : ['Not installed', 'Placed by install project, inside a checkout of this repo'] : p ? p.onDisk[0] === p.onDisk[1] ? ['Installed', `${p.onDisk[0]} of ${p.onDisk[1]} skills on this machine`] : ['Not installed', p.placeNote] : [];
  const rows: [string, string, boolean?][] = q ? [['Skills', String(q.skills)], ['Members', String(q.members)], ['Evaluated', `${q.evaluated} of ${q.skills}`], ['Updated', q.updated], ['Remote', q.remote, true]] : p ? [['Skills', String(p.onDisk[1])], ['Installs', `${p.adoption} · from people files`], ['Followers', String(p.followers)], ['Joined', p.joined], ['Last publish', p.lastPublish]] : [];
  return <aside className="market-rail"><div className="market-status"><span>Status</span><span>{status[0]}</span><span>{status[1]}</span></div><div className="market-rail-details"><SectionLabel>Details</SectionLabel><div>{rows.map(([label, value, mono]) => <div className="market-detail-row" key={label}><span>{label}</span><span className={mono ? 'board-mono' : ''}>{value}</span></div>)}</div></div><div className="market-repo"><SectionLabel>{q ? 'Repo' : 'People file'}</SectionLabel><div><a href="https://github.com/terum/team-skills" target="_blank" rel="noreferrer">terum/team-skills</a><span>{q ? `team.json · projects.${q.key}` : `people/${p?.handle}.json`}</span></div></div>{q && <div className="market-admin"><SectionLabel>Admin</SectionLabel><div><Avatar initials={q.admin.initials} size={28}/><div><span>{q.admin.name}</span><Small>{q.admin.role} · {q.admin.handle}</Small></div></div></div>}<div className="market-rail-spacer"/><ShareBlock command={`npx -y terum-skills@latest install ${q ? 'project ' + q.key : 'member ' + p?.handle}`}/></aside>;
}
