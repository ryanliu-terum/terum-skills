import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useBackend, useFeatures, githubUrl } from '../../backend';
import type { Catalog, Person, Project, SkillCard as Card } from '../../backend/types';
import { Avatar, IconButton, SectionLabel, ShareBlock, Small } from '../../components/domain/Primitives';
import { SkillCard } from '../../components/domain/SkillCard';
import { token } from '../../components/domain/presentation';
import { Icon } from '../../components/ui/Icon';
import { ICON_PATHS } from '../../components/ui/icon-paths';
import type { IconName } from '../../components/ui/icon-paths';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { activeFacets, personStatus, plural, pluralWord } from './market-data';
import { activeFacetCount, defaultFacets } from './market-facets';
import { Filters } from './market-filters';
const CATEGORY_ICONS: Record<string, IconName> = {infra:'box',docs:'book-open',review:'eye',ops:'terminal',testing:'flask',data:'database',git:'git-commit',onboarding:'users',research:'search',security:'shield'};
function iconName(name: string): IconName { return CATEGORY_ICONS[name] ?? (Object.hasOwn(ICON_PATHS,name)?name as IconName:'tag'); }
export function CardRow({ names, catalog, cols = 3, profileVersions }: { names: string[]; catalog: Catalog; cols?: number; profileVersions?: Record<string,string> | undefined }) { const available = [...catalog.skills, ...catalog.extras]; return <div className="market-grid" data-columns={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{names.map(name => { const skill = available.find(s => s.name === name); if (!skill) throw new Error(`Catalog is missing skill ${name}.`); return <MarketplaceSkillCard key={name} skill={profileVersions ? {...skill,profileVersion:profileVersions[name]??null} : skill}/>; })}</div>; }

function MarketplaceSkillCard({ skill }: { skill: Card }) {
  // Install lives in the card's ⋯ menu on every surface (Ryan, 2026-09-09): the menu is the only
  // home for install and uninstall, so this family no longer draws an install button of its own.
  return <div className="market-card-wrap"><SkillCard skill={skill}/></div>;}
export function Mark({ name, small = false }: { name: string; small?: boolean }) { return <span className={'market-mark' + (small ? ' small' : '')}><Icon name={iconName(name)} size={small ? 15 : 16}/></span>; }
function FollowControl({ person, compact = false }: { person: Person; compact?: boolean }) {
  const backend = useBackend(), [following, setFollowing] = useState(() => backend.prefs.get('following:' + person.handle, false)), [error, setError] = useState<string | null>(null);
  function toggle() { try { backend.prefs.set('following:' + person.handle, !following); setFollowing(!following); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save follow preference.'); } }
  return <span className="market-follow"><Button className={compact ? 'market-follow-compact' : ''} aria-label={`${following ? 'Unfollow' : 'Follow'} ${person.handle}`} aria-pressed={following} onClick={toggle} {...(!compact ? { icon: following ? 'check' as const : 'bell' as const } : {})}>{compact && <Icon name={following ? 'check-circle' : 'bell'} size={14} stroke="1.75" color={following ? token('good') : 'currentColor'}/>}<span>{following ? 'Following' : 'Follow'}</span></Button>{error && <span role="alert">{error}</span>}</span>;
}
export function Follow(props: {person:Person;compact?:boolean}){const features=useFeatures();return features?.follow?<FollowControl {...props}/>:null;}
function InstallMark({ installed }: { installed: boolean }) { return <span className="market-install-mark"><Icon name={installed ? 'check-circle' : 'arrow-down-to-line'} size={14} color={installed ? token('good') : 'currentColor'} stroke="1.75"/>{installed ? 'Installed' : 'Install'}</span>; }
export function ProjectCard({ project: q, expanded = false }: { project: Project; expanded?: boolean }) { const features=useFeatures();return <Link to={'/marketplace/projects/' + q.key} className={'market-project-card' + (expanded ? ' expanded' : '')} data-testid={'project-card-' + q.key}><div className="market-card-head"><Mark name={q.ico}/><span>{q.name}</span>{expanded && <InstallMark installed={q.installed}/>}</div>{q.desc && <span className="market-project-desc">{q.desc}</span>}<div className="market-card-chips"><div><Chip>{q.skills}{' ' + pluralWord(q.skills, 'skill')}</Chip>{features?.projectMembers?<Chip>{q.members} members</Chip>:null}{expanded && q.evaluated !== null && <Chip>{q.evaluated} of {q.skills} evaluated</Chip>}</div>{!expanded && <InstallMark installed={q.installed}/>}</div>{expanded && q.admin !== null && <div className="market-project-foot"><div><Avatar initials={q.admin.initials} size={20}/><span>{q.admin.name}</span><Small>{q.updated !== null ? 'admin · updated ' : 'admin'}{q.updated}</Small></div><Small><span className="board-mono">{q.remote}</span></Small></div>}</Link>; }
export function PersonCard({ person: q }: { person: Person }) { const features=useFeatures();const ident=[features?.memberRole?q.role:'',q.handle===q.name?'':q.handle].filter(Boolean).join(' · ');return <article className="market-person-card" data-testid={'person-card-' + q.handle}><div className="market-card-head"><div><Avatar initials={q.initials} size={32}/></div><div className="market-person-ident"><Link to={'/marketplace/people/' + q.handle}>{q.name}</Link>{ident?<span>{ident}</span>:null}</div><Follow person={q} compact/></div><div className="market-person-lines"><span>{q.publishLine}</span>{features?.memberRole?<span>{q.teamsLine}</span>:null}</div><div className="market-inline"><Chip>{plural(q.skills.length, 'skill')}</Chip><Chip>{plural(q.adoption, 'install')}</Chip>{features?.follow?<Chip>{q.followers===null?'—':plural(q.followers, 'follower')}</Chip>:null}</div></article>; }
export function CategoryTile({ category: [key, , n] }: { category: Catalog['categories'][number] }) { return <Link to={'/marketplace/categories/' + key} className="market-category-tile"><Mark name={key} small/><div><span>{key}</span><span>{plural(n, 'skill')}</span></div></Link>; }
export function CategoryRow({ category: [key, , n], catalog }: { category: Catalog['categories'][number]; catalog: Catalog }) { const remaining = catalog.categoryRemaining[key] ?? 0; return <Link to={'/marketplace/categories/' + key} className="market-category-row" data-testid={'category-row-' + key}><Mark name={key} small/><div><span>{key}</span><span>{plural(n, 'skill')}</span></div><span>{catalog.categorySkills[key]?.join(' · ')}{remaining > 0 ? ` · +${remaining} more` : ''}</span><Icon name="chevron-right" size={14} stroke="2"/></Link>; }
export function Section({ title, subtitle, path, action, children }: PropsWithChildren<{ title: string; subtitle: string; path: string; action?: ReactNode }>) { const navigate = useNavigate(); return <section className="market-section" aria-label={title}><div className="market-section-head"><div><h2>{title}</h2><span>{subtitle}</span></div><div className="market-section-actions">{action}<Button icon="chevron-right" iconOnly aria-label={'View all ' + title} onClick={() => navigate('/marketplace/' + path)}/></div></div>{children}</section>; }


const SEARCH_DEBOUNCE_MS = 250;
/**
 * Width reserved for the badge, so that the count appearing never resizes the trigger. The ghost button measures 73.38 px as
 * "Filter" and 92.72 px as "Filter · 9" with tabular digits (Chromium, 1280x800, against the mock dev server, 2026-09-13):
 * pinning it at 93 px holds the field — and the popover anchored under it — at one x whether the popover is shut, open or
 * badged, instead of sliding it 9.7 px (centred hero row) or shrinking it 19.4 px (list and detail rows, where the field grows
 * into the space) under the pointer on every open (review C4/C7). A two-digit count can only come from a hand-written
 * `?active=`; it widens the button rather than being clipped, and tabular digits keep every one-digit count the same width.
 */
const BADGE_SLOT_PX = 93;
/**
 * The filter popover's entry point. It sits BESIDE the field and never inside it: the icon button that
 * used to live inside `.market-search` was removed on 2026-09-10 and took the facet stack's only way in
 * with it, so "filters do not function" (Teddy, 2026-09-13). The popover itself still renders inside
 * `MarketSearch`, anchored under the field, exactly as the MarketplaceFilters board draws it — this
 * button only writes `?filters=open`.
 */
export function FilterButton({ catalog }: { catalog: Catalog }) {
  const [params, setParams] = useSearchParams();
  const open = params.get('filters') === 'open';
  /**
   * The badge is the committed facet count — `serializeFacets` writes `active` in lockstep with the facet params, so the button
   * and `MarketplaceScreen`'s no-results line can never disagree — and, with the popover open and nothing committed yet, the
   * selection the popover seeds ITSELF with: `defaultFacets(catalog)`. The mock's drawn default (PASS · lift >= 20 · <= 5k
   * tokens · installs >= 3) counts 4 there, while the real adapter's all-neutral `filterDefault` counts 0, so a real machine no
   * longer reads "Filter · 4" beside a popover with nothing checked and every slider at its neutral stop. The literal 4 this
   * replaces was a mock number shown on every adapter (review C1/C6), which is the value invention COMMON §7 forbids.
   */
  const active = activeFacets(params.get('active'), open ? activeFacetCount(defaultFacets(catalog)) : 0);
  const trigger = useRef<HTMLButtonElement | null>(null), wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || !trigger.current) return;
    // `MarketSearch` hands focus to the popover when this button opens it, so when the popover goes away (Commit, Escape, a
    // second click) focus is sitting on a node that has just left the document, or on <body>, and the next Tab would restart at
    // the top of the page. The trigger takes it back. Focus a user has since moved somewhere real is left where they put it.
    const focused = document.activeElement;
    if (focused === null || focused === document.body || !document.contains(focused)) trigger.current.focus();
  }, [open]);
  function toggle(node: HTMLButtonElement) {
    trigger.current = node;
    const next = new URLSearchParams(params);
    if (open) next.delete('filters'); else next.set('filters', 'open');
    // Replace, not push: opening or shutting a popover is not navigation, and pushing meant Back re-opened the drawer the user
    // had just closed instead of leaving the page (review C5). Committing a selection from inside the popover still pushes —
    // that one IS a state worth coming back to. The Library's own Filter button still pushes; its screen is another batch's.
    setParams(next, { replace: true });
  }
  // Escape also closes from here: focus starts inside the popover, but a user who shift-tabs back out to the trigger — or a
  // platform whose click never focused it — must still be able to close the drawer with the key that closes everything else.
  return <Button kind="ghost" icon="filter" aria-pressed={open} style={{ minWidth: BADGE_SLOT_PX, fontVariantNumeric: 'tabular-nums' }} onClick={event => toggle(event.currentTarget)} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); toggle(event.currentTarget); } }}>Filter{active > 0 ? ` · ${active}` : ''}</Button>;
}

export function MarketSearch({ placeholder = 'Search skills, people and projects', hero = false, catalog }: { placeholder?: string; hero?: boolean; catalog?: Catalog }) {
  const [params, setParams] = useSearchParams(), q = params.get('q') ?? '', [draft, setDraft] = useState(q), [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) { setLastQ(q); setDraft(q); }
  // The filter button was removed from the search bar (Ryan, 2026-09-10) and returned beside it as `FilterButton` (2026-09-13); the
  // drawer, its facets and every committed-facet URL param never moved, so ?filters=open still opens the popover under this field.
  const open = params.get('filters') === 'open';
  const box = useRef<HTMLDivElement>(null), wasOpen = useRef(open);
  /**
   * Focus follows the popover open. The popover is anchored under the field, so it renders INSIDE it while its trigger is the
   * field's next sibling: in tab order the trigger comes AFTER every filter control, and a keyboard user who opened the drawer
   * and pressed Tab walked straight past all of them — leaving an open popover behind, and leaving the Escape handler that
   * lives on the trigger with it (review C2). Focus starts inside the region instead, so Tab walks the filters in order and
   * Escape reaches the region's own handler; `FilterButton` takes focus back when the popover closes. `tabIndex` is set from
   * here because the region is rendered by `market-filters.tsx`, another batch's file, and an element has to be focusable
   * before it can be focused. Only a transition INTO open moves focus, so a board or a link opened straight at ?filters=open
   * draws exactly as it did before, and `preventScroll` leaves the page's scroll position where the user left it.
   */
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) return;
    const popover = box.current?.querySelector<HTMLElement>('.market-filters');
    if (!popover) return;
    popover.tabIndex = -1;
    popover.focus({ preventScroll: true });
  }, [open]);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => { if (pending.current !== null) { clearTimeout(pending.current); pending.current = null; } }, []);
  /**
   * Typing commits 250 ms after the last keystroke, replacing the entry so a sentence typed one letter at a time leaves one step to
   * go back over; Enter and the clear cross cancel the timer and commit at once, pushing. The timer is armed from an effect rather
   * than from the keystroke handler so that it always closes over the newest render's params: `setSearchParams` is memoised per
   * render and its updater form hands back that render's params too, so a timer armed mid-word and fired after the filter popover
   * opened wrote `q` on top of the params from before the popover and dropped `filters=open` (measured in a browser against the mock
   * on 2026-09-13, not reasoned about). A keystroke, a committed `q`, or any other URL write re-runs this effect; its cleanup clears
   * the timer it replaces, which also covers unmount. `draft === q` — mount, an externally cleared query, a just-committed one —
   * arms nothing, so the render-phase sync above can replace the draft without a keystroke in flight putting the old text back.
   */
  useEffect(() => {
    if (draft === q) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      const next = new URLSearchParams(params);
      if (draft) next.set('q', draft); else next.delete('q');
      setParams(next, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return cancel;
  }, [draft, q, params, setParams, cancel]);
  // `replace` is the popover's: shutting the drawer is not navigation (review C5, and the same reason the debounce above
  // replaces). A committed query — Enter, the clear cross — is, so it still pushes.
  function change(key: string, value?: string, replace = false) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace }); }
  function commit(value: string) { cancel(); change('q', value); }
  return <div ref={box} className={'market-search' + (hero ? ' hero' : '')}><Icon name="search" size={16} color={token('text3')}/><input aria-label={placeholder} placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commit(draft); }}/>{q && <IconButton icon="x" size={20} iconSize={14} label="Clear search field" onClick={() => commit('')}/>}{open && catalog && <Filters catalog={catalog} onClose={() => change('filters', undefined, true)}/>}</div>;
}
export function Crumbs({ parts, railOpen, onToggle }: { parts: string[]; railOpen?: boolean; onToggle?: () => void }) { const navigate = useNavigate(); return <div className="market-crumbs" data-rail-open={railOpen}><div><IconButton icon="arrow-left" size={28} label="Back to marketplace" onClick={() => navigate('/marketplace')}/><div>{parts.map((part, i) => <Fragment key={i}>{i > 0 && <span className="market-crumb-separator">/</span>}<span className={i === parts.length - 1 ? 'current' : ''}>{part}</span></Fragment>)}</div></div>{onToggle && <IconButton icon="panel-right" size={28} label={railOpen ? 'Close details rail' : 'Open details rail'} onClick={onToggle}/>}</div>; }


export function MarketRail({ project, person, repository }: { project?: Project; person?: Person; repository:string|null }) {
  const backend=useBackend(),features=useFeatures(),[error,setError]=useState<string|null>(null);
  const url=githubUrl(project?.remote??repository??'');
  if (!project && !person) throw new Error('A marketplace rail needs a project or person.');
  const q = project, p = person;
  const status = q ? q.installed ? ['Installed', q.path ? `${plural(q.skills, 'skill')} placed in ${q.path}` : `${plural(q.skills, 'skill')} placed on this machine`] : ['Not installed', 'Placed by install project, inside a checkout of this repo'] : p ? personStatus(p) : [];
  const rows: [string, string, boolean?][] = q ? [['Skills', String(q.skills)], ['Members', String(q.members)], ...(q.evaluated !== null ? [['Evaluated', `${q.evaluated} of ${q.skills}`] as [string, string]] : []), ...(q.updated !== null ? [['Updated', q.updated] as [string, string]] : []), ['Remote', q.remote, true]] : p ? [['Skills', String(p.onDisk[1])], ['Installs', `${p.adoption} · from people files`], ['Followers', String(p.followers)], ['Joined', p.joined], ['Last publish', p.lastPublish]] : [];
  return <aside className="market-rail"><div className="market-status"><span>Status</span><span>{status[0]}</span><span>{status[1]}</span></div><div className="market-rail-details"><SectionLabel>Details</SectionLabel><div>{rows.filter(([label])=>(label!=='Followers'||features?.follow)&&(label!=='Members'||features?.projectMembers)).map(([label, value, mono]) => <div className="market-detail-row" key={label}><span>{label}</span><span className={mono ? 'board-mono' : ''}>{value}</span></div>)}</div></div><div className="market-repo"><SectionLabel>{q ? 'Repo' : 'People file'}</SectionLabel><div><a {...(url?{href:url,onClick:(event:React.MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();void backend.openUrl(url).then(result=>{if(!result.ok)setError(result.error);},reason=>setError(String(reason)));}}:{})}>{repository?.replace(/^(?:https:\/\/)?github\.com\//,'')??'—'}</a>{error?<span role="alert">{error}</span>:null}<span>{q ? `team.json · projects.${q.key}` : `people/${p?.handle}.json`}</span></div></div>{q && q.admin !== null && <div className="market-admin"><SectionLabel>Admin</SectionLabel><div><Avatar initials={q.admin.initials} size={28}/><div><span>{q.admin.name}</span><Small>{features?.memberRole?`${q.admin.role} · `:''}{q.admin.handle}</Small></div></div></div>}<div className="market-rail-spacer"/><ShareBlock command={`npx -y terum-skills@latest install ${q ? 'project ' + q.key : 'member ' + p?.handle}`}/></aside>;
}
