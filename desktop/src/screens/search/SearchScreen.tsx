import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useBackend, useCapabilities, useFeatures } from '../../backend';
import type { Library, Result, Root, SkillCard } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { Avatar, BoardSkeleton, CenteredState, ErrorLine, SectionLabel, TerminalHint } from '../../components/domain/Primitives';
import { detailPath } from '../../components/domain/skill-card-actions';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { token } from '../../components/domain/presentation';
import { Icon } from '../../components/ui/Icon';
import type { IconName } from '../../components/ui/icon-paths';
import { Kbd } from '../../components/ui/Kbd';
import { searchShortcutLabel } from '../../lib/shortcuts';
import { plural } from '../marketplace/market-data';
import './search.css';

/** How long a keystroke waits before it reaches `?q=`. Every write replaces, so this costs no history. */
const DEBOUNCE_MS = 250;
const FIELD_LABEL = 'Search skills, people, projects';

interface Row {
  /** React key, and the flat keyboard order's identity. Unique across every group. */
  key: string;
  testId: string;
  name: string;
  /** '' when the source reports nothing to say — never a placeholder, a `null` or a dash chain. */
  meta: string;
  to: string;
  icon: IconName | null;
  initials: string | null;
}
interface Group {
  key: string;
  label: string;
  rows: Row[];
  /** The CLI's own messages for this group's failed sources. The other groups still render. */
  errors: string[];
}

/** The detail route for a Library folder: `detailPath` decides by-path vs by-name, and a checkout
 *  Library rides its root the way `SkillCard`'s `origin` does, so Back returns to that checkout. */
function libraryTarget(card: SkillCard, root: Root): string {
  const base = detailPath(card);
  if (root.kind !== 'checkout') return base;
  return base + (base.includes('?') ? '&' : '?') + 'root=' + encodeURIComponent(root.id);
}
/** The Library scope for a root, built exactly as `LibraryScreen` and the `Sidebar` build theirs. */
function scopeOf(root: Root) {
  return root.kind === 'global' ? ({ kind: 'global' } as const) : ({ kind: 'checkout', root: root.id } as const);
}
/** Why a read failed: the CLI's own message when the Result says so, the thrown one otherwise. */
function messageOf(result: Result<unknown> | undefined, thrown: Error | null): string | null {
  if (result && !result.ok) return result.error;
  return thrown ? thrown.message : null;
}
function isNoTeam(result: Result<unknown> | undefined): boolean {
  return result !== undefined && !result.ok && result.reason === 'no-team';
}
/** Join the parts a source actually reported, dropping the ones it does not have. */
function metaLine(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' · ');
}

export function SearchScreen() {
  const backend = useBackend(), state = useUrlState(), navigate = useNavigate(), action = useWorkflow();
  const capabilities = useCapabilities(), features = useFeatures();
  const [params, setParams] = useSearchParams();
  const raw = params.get('q') ?? '';
  const q = raw.trim();
  const enabled = q.length > 0;
  const needle = q.toLowerCase();

  // The field is uncontrolled: a keystroke paints through the DOM and the debounce carries it to `?q=`,
  // so the caret is never rewound by a render. `?q=` moving from anywhere else (the top bar's link, a
  // pasted deep link, Back) is pushed back into the field here, and only when the two actually differ.
  const field = useRef<HTMLInputElement | null>(null);
  // Which `?q=` this page wrote itself. The debounce commits from a timer, so React runs the sync effect
  // in a later task — a key that lands in that gap is already painted on the DOM node, and syncing then
  // would erase that character and throw the caret to the end of the field. A term the page wrote is
  // therefore never pushed back in; the effect clears the note, so only a `?q=` from somewhere else
  // (the top bar's link, a pasted deep link, Back) ever overwrites what the reader is typing.
  const wrote = useRef<string | null>(null);
  useEffect(() => {
    const input = field.current, ours = wrote.current === raw;
    wrote.current = null;
    if (input && !ours && input.value !== raw) input.value = raw;
  }, [raw]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  function commit(value: string) {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    wrote.current = value;
    setParams(current => { const next = new URLSearchParams(current); if (value) next.set('q', value); else next.delete('q'); return next; }, { replace: true });
  }
  function type(value: string) {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; commit(value); }, DEBOUNCE_MS);
  }

  // `placeholderData`: refining a term re-keys this query, and on the real adapter its answer is a CLI
  // spawn. The rows on screen are the previous term's real answer, so they stay — marked busy — instead
  // of the whole panel blanking to skeletons on every pause in typing. `ready` still waits for the new
  // answer: `isPlaceholderData` says this key has not settled, and `pending` below reads it.
  const hits = useQuery({ queryKey: ['search', q, state.mock], enabled, placeholderData: keepPreviousData, queryFn: ({ signal }) => backend.search({ q }, { signal }) });
  // The Shell reads `status` unconditionally, so this observer shares that cache rather than gating it.
  const status = useQuery({ queryKey: ['status', state.mock], queryFn: ({ signal }) => backend.status(undefined, { signal }) });
  const catalog = useQuery({ queryKey: ['catalog', state.mock], enabled, queryFn: ({ signal }) => backend.catalog(undefined, { signal }) });
  const roots: readonly Root[] = status.data?.ok ? status.data.value.roots : [];
  const libraries = useQueries({
    queries: roots.map(root => ({
      queryKey: ['library', root.kind === 'global' ? 'global' : root.id, state.mock],
      enabled,
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<Result<Library>> => backend.library({ scope: scopeOf(root) }, { signal }),
    })),
  });

  const searchError = messageOf(hits.data, hits.error);
  const statusError = messageOf(status.data, status.error);
  const catalogError = messageOf(catalog.data, catalog.error);
  const searchHits = hits.data?.ok ? hits.data.value : [];
  // `no-team` is an answer only the team-backed reads can give: `search` and `catalog` ask the CLI about
  // a team, while `status` and `library` are offline reads a machine with no team still answers — and the
  // folders they report are the only thing such a machine has to search. So a no-team sentence is that
  // source's own error line here, and it replaces the page (below) only when nothing else has anything.
  const searchNoTeam = isNoTeam(hits.data), catalogNoTeam = isNoTeam(catalog.data);

  // Skills: the CLI's own `search`, which is the only source for them. Its failure is reported here and
  // nowhere else — People and Projects keep a working source of their own, and repeating one CLI
  // sentence under four labels would say the page is broken when three quarters of it is not.
  const skills: Row[] = searchHits.filter(hit => hit.kind === 'skill').map(hit => ({
    key: 'skill:' + hit.ref,
    testId: 'search-hit-skill-' + hit.ref,
    name: hit.name,
    meta: metaLine([hit.author, hit.installs === null ? null : plural(hit.installs, 'install'), hit.category]),
    to: '/skill/' + encodeURIComponent(hit.ref) + '?root=marketplace',
    icon: 'box',
    initials: null,
  }));

  // Your library: folders the team does not hold. `search` never returns them (it reads the team clone),
  // so they come from the Library itself, one root at a time. A root that cannot be read says so by name
  // instead of silently shortening the list.
  const libraryRows: Row[] = [];
  const libraryErrors: string[] = statusError === null ? [] : [statusError];
  roots.forEach((root, index) => {
    const query = libraries[index];
    if (!query) return;
    const failure = messageOf(query.data, query.error);
    if (failure !== null) { libraryErrors.push(`${root.label}: ${failure}`); return; }
    if (!query.data?.ok) return;
    for (const card of query.data.value.skills) {
      if (card.teamed) continue;
      if (!(card.name + ' ' + card.desc).toLowerCase().includes(needle)) continue;
      const ref = card.path ?? root.id + '/' + card.name;
      libraryRows.push({ key: 'library:' + ref, testId: 'search-hit-library-' + ref, name: card.name, meta: root.label, to: libraryTarget(card, root), icon: 'box', initials: null });
    }
  });

  // People and Projects are a union: the mock's `search` answers all three kinds, while the real
  // adapter's `search` is skills-only — so the catalog is the source that works on both. `Map.set` keeps
  // the first insertion's position, so a hit the catalog also knows is enriched in place, not duplicated.
  const people = new Map<string, { handle: string; name: string; role: string | null; initials: string | null }>();
  for (const hit of searchHits) if (hit.kind === 'member') people.set(hit.ref, { handle: hit.ref, name: hit.name, role: hit.description || null, initials: null });
  if (catalog.data?.ok) for (const person of catalog.data.value.people) {
    if (!(person.name + ' ' + person.handle).toLowerCase().includes(needle)) continue;
    people.set(person.handle, { handle: person.handle, name: person.name, role: person.role, initials: person.initials });
  }
  const peopleRows: Row[] = [...people.values()].map(person => ({
    key: 'member:' + person.handle,
    testId: 'search-hit-member-' + person.handle,
    name: person.name,
    // The identity sub-line as `PersonCard` prints it: the role behind its flag, the handle unless it repeats the name.
    meta: metaLine([features?.memberRole ? person.role : null, person.handle === person.name ? null : person.handle]),
    to: '/marketplace/people/' + encodeURIComponent(person.handle),
    // No initials are invented for a hit the catalog does not hold; that row wears the generic person icon.
    icon: person.initials === null ? 'user' : null,
    initials: person.initials,
  }));

  const projects = new Map<string, { key: string; name: string; skills: number | null }>();
  for (const hit of searchHits) if (hit.kind === 'project') projects.set(hit.ref, { key: hit.ref, name: hit.name, skills: null });
  if (catalog.data?.ok) for (const project of catalog.data.value.projects) {
    if (!(project.name + ' ' + project.desc).toLowerCase().includes(needle)) continue;
    projects.set(project.key, { key: project.key, name: project.name, skills: project.skills });
  }
  const projectRows: Row[] = [...projects.values()].map(project => ({
    key: 'project:' + project.key,
    testId: 'search-hit-project-' + project.key,
    name: project.name,
    // No count from a hit the catalog does not hold: an invented 0 would read as an empty project.
    meta: project.skills === null ? '' : plural(project.skills, 'skill'),
    to: '/marketplace/projects/' + encodeURIComponent(project.key),
    icon: 'folder',
    initials: null,
  }));

  // People are the one group `search` can hold rows no other source has: the mock matches a member on
  // name+role, which the catalog's name/handle filter cannot reproduce, so `?q=founder` finds Ryan only
  // through `search`. A failed `search` is therefore reported under this label too, scoped the way a
  // failed Library root names itself, so the reader knows which source went missing. Not repeated when
  // the catalog already printed the same sentence, and not for a no-team answer — the page says that
  // whole below, and a machine with no team has no members for `search` to have found.
  const peopleErrors = catalogError === null ? [] : [catalogError];
  if (searchError !== null && !searchNoTeam && searchError !== catalogError) peopleErrors.push('Team search: ' + searchError);
  // Projects need no such line: both sources filter name+desc, and the catalog holds every project the
  // mock's `search` hits do, so a failed `search` cannot cost this group a row.
  const groups: Group[] = [
    { key: 'skills', label: 'Skills', rows: skills, errors: searchError === null ? [] : [searchError] },
    { key: 'library', label: 'Your library', rows: libraryRows, errors: libraryErrors },
    { key: 'people', label: 'People', rows: peopleRows, errors: peopleErrors },
    { key: 'projects', label: 'Projects', rows: projectRows, errors: catalogError === null ? [] : [catalogError] },
  ].filter(group => group.rows.length > 0 || group.errors.length > 0);
  const rows = groups.flatMap(group => group.rows);
  const order = new Map(rows.map((row, index) => [row.key, index]));

  // The highlight carries the term it was chosen under, so a new `?q=` drops it without an effect.
  const [pick, setPick] = useState<{ q: string; index: number }>({ q, index: -1 });
  const active = pick.q === q && pick.index >= 0 && pick.index < rows.length ? pick.index : -1;
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (event.key === 'ArrowDown') { event.preventDefault(); setPick({ q, index: Math.min(rows.length - 1, active + 1) }); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setPick({ q, index: Math.max(-1, active - 1) }); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = active === -1 ? undefined : rows[active];
      if (row) navigate(row.to); else commit(input.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (input.value) { input.value = ''; setPick({ q, index: -1 }); commit(''); } else history.back();
    }
  }

  // The walk must stay visible: the page itself is the scroller (`.search-page`) and the repo hides its
  // scrollbar, so a highlight that runs past the fold would leave Enter opening a row nobody can see.
  // `block:'nearest'` moves nothing while the row is already on screen, so the mouse, the first render
  // and every board-sized page are untouched. jsdom implements no `scrollIntoView`, and a screen must
  // not throw where it is missing — hence the check rather than an optional call.
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const activeKey = active === -1 ? null : rows[active]?.key ?? null;
  useEffect(() => {
    if (activeKey === null) return;
    const node = nodes.current.get(activeKey);
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  const rowIds = useId();
  const pending = enabled && (hits.isPending || hits.isPlaceholderData || status.isPending || catalog.isPending || libraries.some(query => query.isPending));
  // The full-page no-team state is for a machine that has nothing else to say. `status` and `library`
  // answer without a team, so when they reported folders — or any other source failed for a reason of
  // its own — those are shown instead, with the no-team sentence under the group whose source gave it.
  // `!pending` as well: a team-backed read answering first must not blank the page while the offline
  // reads that hold this machine's folders are still in flight.
  const otherMessages = [...libraryErrors, ...(searchError !== null && !searchNoTeam ? [searchError] : []), ...(catalogError !== null && !catalogNoTeam ? [catalogError] : [])];
  const noTeam = !pending && (searchNoTeam || catalogNoTeam) && rows.length === 0 && otherMessages.length === 0;
  const nothing = enabled && !pending && !noTeam && groups.length === 0;
  // Skeletons are for a page with nothing on it yet; a term being refined keeps the previous answer
  // (`isPlaceholderData`) and says it is busy instead of blanking.
  const loading = pending && (groups.length === 0 || !hits.isPlaceholderData);
  const stale = pending && !loading;
  return <Shell selected=""><ScreenFrame ready={!enabled || !pending || state.mock === 'loading'}>
    <div className="search-page">
      <div className="search-page-column">
        <div className="search-page-field">
          <Icon name="search" size={16} color={token('text3')}/>
          {/* autoFocus: the page exists to be typed into, and ⌘K / Ctrl+K is expected to land the caret in it. */}
          <input ref={field} autoFocus aria-label={FIELD_LABEL} placeholder={FIELD_LABEL} defaultValue={raw} onChange={event => type(event.currentTarget.value)} onKeyDown={keys}/>
          <Kbd>{searchShortcutLabel(capabilities?.windowChrome)}</Kbd>
        </div>
        {!enabled
          ? <div className="search-page-panel"><span className="search-page-hint">Type to search skills, people and projects.</span></div>
          : loading
            ? <div className="search-page-panel" aria-label="Loading results">{Array.from({ length: 6 }, (_, index) => <div className="search-page-skeleton" key={index}><BoardSkeleton width={16} height={16}/><BoardSkeleton width={index % 2 ? 168 : 132} height={12}/></div>)}</div>
            : noTeam
              ? <div className="search-page-panel search-page-empty"><CenteredState icon="users" title="No team on this machine" body="Create a team or join the one you were invited to. Setup runs here in the app." primary="Start setup" secondary="Copy terminal command" onPrimary={() => navigate('/onboarding/boot?start=1')} onSecondary={() => { void action.perform(() => backend.copyToClipboard('npx -y terum-skills@latest setup')); }}><TerminalHint command="npx -y terum-skills@latest setup" prefix="From the terminal"/></CenteredState></div>
              : nothing
                ? <div className="search-page-panel search-page-empty"><CenteredState icon="search" title={`No results for “${q}”`} body="Try a shorter term. Skills are searched by name, description and category."/></div>
                // `data-picked` turns the pointer's own `:hover` paint off while a row is highlighted, so a
                // pointer resting on one row and a walk on another never light two rows at once.
                : <div className="search-page-panel" data-picked={active === -1 ? undefined : true} {...(stale ? { 'aria-busy': true, 'data-stale': true } : {})}>{groups.map(group => <div className="search-page-group" key={group.key}>
                  <SectionLabel>{group.label}</SectionLabel>
                  {group.errors.map((message, index) => <ErrorLine key={index}>{message}</ErrorLine>)}
                  {group.rows.map(row => {
                    const index = order.get(row.key) ?? -1;
                    return <button
                      type="button"
                      key={row.key}
                      ref={node => { if (node) nodes.current.set(row.key, node); else nodes.current.delete(row.key); }}
                      className="search-page-row"
                      data-testid={row.testId}
                      data-hovered={index === active || undefined}
                      aria-labelledby={`${rowIds}-${index}-name`}
                      {...(row.meta ? { 'aria-describedby': `${rowIds}-${index}-meta` } : {})}
                      onMouseEnter={() => setPick({ q, index })}
                      onClick={() => navigate(row.to)}
                    >
                      {row.initials !== null ? <Avatar initials={row.initials} size={16}/> : row.icon !== null ? <Icon name={row.icon} size={16} color={token('text3')}/> : null}
                      <span className="search-page-name" id={`${rowIds}-${index}-name`}>{row.name}</span>
                      {row.meta ? <span className="search-page-meta" id={`${rowIds}-${index}-meta`}>{row.meta}</span> : null}
                    </button>;
                  })}
                </div>)}</div>}
        {/* The no-team state's copy action is the page's only write. A refusal is news, not an error. */}
        {action.error ? <div role="alert" className="search-page-hint">{action.error}</div> : null}
        {action.notice ? <div role="status" className="search-page-hint">{action.notice}</div> : null}
      </div>
    </div>
  </ScreenFrame></Shell>;
}
