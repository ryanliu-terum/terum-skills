import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { driveRun, PromptContext, useBackend } from '../../backend';
import type { InboxItem, InboxKind, TokenKey } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { Avatar, BoardSkeleton, CenteredState, ErrorLine, IconButton, Small, TerminalHint } from '../../components/domain/Primitives';
import { token } from '../../components/domain/presentation';
import { verdictToken } from '../../components/domain/verdict';
import { Icon } from '../../components/ui/Icon';
import type { IconName } from '../../components/ui/icon-paths';
import { Button } from '../../components/ui/Button';
import { InboxReport } from './reports';
import './inbox.css';
const kinds: Record<InboxKind, [string, IconName, TokenKey]> = { share: ['Shared with you', 'arrow-down-to-line', 'brand'], update: ['Update', 'refresh', 'info'], alert: ['Alert', 'alert', 'warn'], eval: ['Eval finished', 'chart', 'good'], review: ['Review request', 'eye', 'text2'], author: ['Your skill', 'sparkle', 'text2'], team: ['Team', 'users', 'text3'] };
function KindMark({ item, acted = false }: { item: InboxItem; acted?: boolean }) { return <Icon name={acted ? 'check' : kinds[item.kind][1]} size={14} stroke={acted ? '2.5' : '1.75'} color={token(acted ? 'good' : item.kind === 'eval' ? verdictToken(item.summary).fg : kinds[item.kind][2])}/>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="inbox-field"><span>{label}</span><div>{children}</div></div>; }
function Fields({ item }: { item: InboxItem }) { return <div className="inbox-fields"><div><Field label="From">{item.actor ? <><Avatar initials={item.actor.initials} size={20}/><span>{item.actor.name}</span><Small>{item.actor.handle}</Small></> : <><span className="inbox-kind-badge"><KindMark item={item}/></span><span>terum-skills</span><Small>{kinds[item.kind][0].toLowerCase()}</Small></>}</Field><Field label="To"><Avatar initials="TZ" size={20}/><span>teddy</span><Small>in {item.scope}</Small></Field><Field label="Date"><span>{item.date}</span><Small>{item.when}</Small></Field></div><Field label="Subject"><span className="inbox-subject">{item.title}</span></Field></div>; }
function RowSkeleton() { return <div className="inbox-row-skeleton"><span className="inbox-dot-slot"/><BoardSkeleton width={24} height={24} radius={12}/><div>{[[55, 12, 18], [80, 10, 16], [40, 10, 16]].map(([w, h, box], i) => <div key={i} style={{ height: box }}><BoardSkeleton width={`${w}%`} height={h ?? 10}/></div>)}</div></div>; }
function PaneSkeleton() { const field = (a: number, b: number) => <div className="inbox-field"><BoardSkeleton width={a} height={10}/><BoardSkeleton width={b} height={12}/></div>; return <div className="inbox-pane" aria-label="Loading report"><div className="inbox-toolbar"><BoardSkeleton width={120} height={12}/><div className="inbox-actions"><BoardSkeleton width={72} height={28} radius={6}/><BoardSkeleton width={132} height={28} radius={6}/></div></div><div className="inbox-fields"><div>{field(30, 130)}{field(14, 110)}{field(28, 140)}</div>{field(44, 300)}</div><div className="inbox-skeleton-lines">{[[300, 16], [420, 10], [640, 12], [600, 12], [560, 12]].map(([w, h], i) => <BoardSkeleton key={i} width={w ?? 0} height={h ?? 0}/>)}</div><div className="inbox-skeleton-lines" style={{ paddingTop: 8 }}><BoardSkeleton width={96} height={12}/><BoardSkeleton width={640} height={22}/><BoardSkeleton width={400} height={10}/></div></div>; }
function Actions({ item, acted, busy, onPrimary, onSecondary }: { item: InboxItem; acted: boolean; busy: boolean; onPrimary: () => void; onSecondary: (label: string) => void }) {
  const kind = item.sub ?? item.kind;
  const pairs: Record<string, [string | null, string, IconName, boolean]> = { share: ['Decline', `Install to ${item.scope}`, 'arrow-down-to-line', true], update: [item.grants_added?.length ? 'Later' : null, item.grants_added?.length ? 'Approve and update' : 'Update now', 'refresh', true], offtarget: ['Disable', 'Re-run eval', 'play', true], regression: ['Disable', 'Open evals', 'chart', true], missing: ['Open in editor', 'Re-place from team', 'refresh', true], local: ['Open in editor', 'Restore team version', 'refresh', true], eval: [null, 'Open skill', 'arrow-up-right', false], review: ['Request changes', 'Approve and merge', 'check', true], author: [null, 'Open skill', 'arrow-up-right', false], team: [null, 'Open members', 'users', false] };
  const [secondary, primary, icon, filled] = acted ? [null, 'Open skill', 'arrow-up-right' as const, false] : pairs[kind] ?? [null, 'Open skill', 'arrow-up-right' as const, false];
  return <div className="inbox-actions">{secondary && <Button {...(secondary === 'Open in editor' ? { icon: 'arrow-up-right' as const } : {})} onClick={() => onSecondary(secondary)}>{secondary}</Button>}<Button kind={filled ? 'primary' : 'secondary'} icon={icon} disabled={busy} onClick={onPrimary}>{primary}</Button></div>;
}
export function InboxScreen() {
  const state = useUrlState(), backend = useBackend(), navigate = useNavigate(), [search] = useSearchParams(), prompt = useContext(PromptContext);
  const [acted, setActed] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['inbox', state.mock], queryFn:({signal})=>backend.inbox(undefined,{signal}) });
  const items = query.data?.ok ? query.data.value : [], item = items.find(it => it.id === state.inboxSelectedId);
  const needsDetail = item?.kind === 'eval' || (item?.kind === 'update' && !item.summary);
  const detail = useQuery({ queryKey: ['skill', item?.name, state.mock], queryFn:({signal})=>backend.skill({ ref: item?.name ?? '' },{signal}), enabled: needsDetail });
  const error = actionError ?? (query.data?.ok === false ? query.data.error : query.isError ? query.error.message : needsDetail ? detail.data?.ok === false ? detail.data.error : detail.isError ? detail.error.message : null : null);
  const loading = query.isPending || (needsDetail && detail.isPending), ready = state.mock === 'loading' || (!query.isPending && !(needsDetail && detail.isPending));
  function go(path: string) { const params = new URLSearchParams(search); navigate(path + (params.size ? '?' + params.toString() : '')); }
  async function primary() {
    if (!item || busy) return;
    const kind = item.sub ?? item.kind;
    if (acted[item.id] || kind === 'eval' || kind === 'author') { navigate('/skill/' + item.name); return; }
    if (kind === 'regression') { navigate('/skill/' + item.name + '?tab=evals'); return; }
    if (kind === 'team') { navigate('/share'); return; }
    setBusy(true);
    try {
      const run = kind === 'share' ? backend.install({ ref: item.name, scope: item.scope }) : kind === 'offtarget' ? backend.eval({ ref: item.name }) : kind === 'review' ? backend.publish({ ref: item.name }) : backend.sync({});
      const result = await driveRun<unknown>(run, { [`Approve these tools for ${item.name}?`]: true }, prompt);
      if (!result.ok) setActionError(result.error);
      else if (kind === 'share') setActed(old => ({ ...old, [item.id]: `Installed to ${item.scope} just now · ${item.version} in ~/.claude/skills/${item.name}` }));
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not complete the inbox action.'); }
    finally { setBusy(false); }
  }
  async function secondary(label: string) {
    if (!item || label === 'Request changes') return;
    try {
      if (label === 'Open in editor') { const result = await backend.openInEditor(`~/.claude/skills/${item.name}`); if (!result.ok) setActionError(result.error); }
      else if (label === 'Disable') backend.prefs.set('enabled:' + item.name, false);
      else if (label === 'Decline') backend.prefs.set('declined:' + item.name, true);
      else if (label === 'Later') backend.prefs.set('inbox-later:' + item.id, true);
      // These preferences do not change the inbox document or row until a new backend event arrives.
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not complete the inbox action.'); }
  }
  async function sync() { try { const result = await driveRun(backend.sync({}), {}, prompt); if (!result.ok) setActionError(result.error); else await query.refetch(); } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not sync your inbox.'); } }
  const unread = items.filter(it => it.unread).length;
  return <Shell selected="Inbox" counts={loading || error ? null : undefined}><ScreenFrame ready={ready}><div className="inbox-screen" data-selected-id={item?.id}>{error ? <CenteredState alert icon="alert" title="Couldn't sync your inbox" body="The team repo did not answer, so what is here may be stale. Check your network and your git access to the repository, then try again." primary="Try again" secondary="Copy error" onPrimary={() => { setActionError(null); void query.refetch(); if (needsDetail) void detail.refetch(); }} onSecondary={() => void backend.copyToClipboard(error).then(result => { if (!result.ok) setActionError(result.error); }, e => setActionError(e instanceof Error ? e.message : 'Could not copy error.'))}><ErrorLine>{error}</ErrorLine></CenteredState> : <><aside className="inbox-list" aria-label="Inbox items"><div className="inbox-list-head"><div><span>Inbox</span>{!loading && unread > 0 && <Small>{unread} unread</Small>}</div><div>{(['search', 'filter', 'sort'] as const).map(icon => <IconButton key={icon} icon={icon} label={`${icon} inbox`}/>)}</div></div><div className="inbox-rows">{loading ? Array.from({ length: 7 }, (_, i) => <RowSkeleton key={i}/>) : items.length ? items.map(it => <button type="button" key={it.id} className="inbox-row" data-testid={'inbox-row-' + it.id} data-selected={it.id === item?.id || undefined} data-unread={it.unread && !acted[it.id] || undefined} data-acted={!!acted[it.id] || undefined} onClick={() => go('/inbox/' + it.id)}><span className="inbox-dot-slot">{it.unread && !acted[it.id] && <span/>}</span>{it.actor ? <Avatar initials={it.actor.initials}/> : <span className="inbox-neutral-avatar"/>}<span className="inbox-row-content"><span className="inbox-row-title"><KindMark item={it} acted={!!acted[it.id]}/><span>{it.title}</span><span>{it.when.replace(' days ago', 'd').replace(' day ago', 'd').replace('yesterday', '1d').replace('today', 'now').replace('just now', 'now')}</span></span><span className="inbox-row-fact">{acted[it.id] ?? it.fact}</span><span className="inbox-row-state">{acted[it.id] ? `Installed · ${it.scope}` : it.state}</span></span></button>) : <span className="inbox-no-items">No items</span>}</div></aside>{loading ? <PaneSkeleton/> : item ? <section className="inbox-pane" aria-label="Inbox report"><div className="inbox-toolbar"><div><KindMark item={item}/><Small>{kinds[item.kind][0]}{item.sub ? ' · ' + ({ offtarget: 'off-target', regression: 'regressed eval', missing: 'missing files', local: 'edited locally' }[item.sub] ?? item.sub) : ''}</Small></div><Actions item={item} acted={!!acted[item.id]} busy={busy} onPrimary={() => void primary()} onSecondary={label => void secondary(label)}/></div><Fields item={item}/>{acted[item.id] && <div className="inbox-done" role="status"><Icon name="check-circle" size={14} color={token('good')} stroke="1.75"/><span>{acted[item.id]}</span></div>}<div className="inbox-document"><InboxReport item={item} acted={!!acted[item.id]} {...(detail.data?.ok ? { detail: detail.data.value } : {})}/></div></section> : <div className="inbox-empty-pane">{items.length ? <span className="inbox-empty-selection">Select an item to read it.</span> : <CenteredState icon="inbox" title="Nothing waiting" body="Skills shared with you, updates to the ones you use, alerts, finished evals and review requests land here." primary="Open library" secondary="Sync now" onPrimary={() => navigate('/library/global')} onSecondary={() => void sync()}><TerminalHint command="npx -y terum-skills@latest sync" prefix="Last sync 12 minutes ago"/></CenteredState>}</div>}</>}</div></ScreenFrame></Shell>;
}
