import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { Catalog, LibraryScope, Project, SkillCard } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { BoardSkeleton, ErrorLine, SectionLabel, Small } from '../../components/domain/Primitives';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';

type RowState = 'in-project' | 'endorse' | 'share';
interface Row { name: string; desc: string; path: string | null; where: string; state: RowState }
interface Outcome { kind: 'done' | 'opened' | 'failed'; text: string; url?: string }
const ORDER: Record<RowState, number> = { endorse: 0, share: 1, 'in-project': 2 };

function rowsFrom(local: { root: string; skills: SkillCard[] }[], catalog: Catalog, project: Project): Row[] {
  const inTeam = new Set(catalog.skills.map(skill => skill.name));
  const inProject = new Set(project.skillsIn); const rows: Row[] = []; const seen = new Set<string>();
  for (const section of local) for (const skill of section.skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    rows.push({ name: skill.name, desc: skill.desc, path: skill.path, where: section.root, state: inProject.has(skill.name) ? 'in-project' : inTeam.has(skill.name) ? 'endorse' : 'share' });
  }
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}

export function AddSkillsDialog({ project, catalog, onClose }: { project: Project; catalog: Catalog; onClose: () => void }) {
  const backend = useBackend(), action = useWorkflow(), state = useUrlState();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmShare, setConfirmShare] = useState(false);
  /* Closing the share confirmation makes the picker's own Dialog fire onOpenChange(false), and
     action.busy has not flipped yet at that instant, so the picker would unmount mid-flow and
     useWorkflow would drop the in-flight run's result. A synchronous ref closes that race. */
  const working = useRef(false);
  const status = useQuery({ queryKey: ['status', state.mock], queryFn: ({ signal }) => backend.status(undefined, { signal }) });
  const roots = status.data?.ok ? status.data.value.roots.filter(root => root.kind === 'checkout') : [];
  const local = useQuery({
    queryKey: ['library', 'add-skills', state.mock, roots.map(root => root.id).join('|')], enabled: status.isSuccess,
    queryFn: async ({ signal }) => {
      const scopes: LibraryScope[] = [{ kind: 'global' }, ...roots.map(root => ({ kind: 'checkout' as const, root: root.id }))];
      const results = await Promise.all(scopes.map(scope => backend.library({ scope }, { signal })));
      return results.flatMap(result => result.ok ? [{ root: result.value.root.label, skills: result.value.skills }] : []);
    },
  });
  const rows = local.data ? rowsFrom(local.data, catalog, project) : [];
  const shown = rows.filter(row => !query || (row.name + ' ' + row.desc).toLowerCase().includes(query.toLowerCase()));
  const selectedRows = rows.filter(row => selected.has(row.name));
  const shareRows = selectedRows.filter(row => row.state === 'share');
  const counts = { endorse: rows.filter(row => row.state === 'endorse').length, share: rows.filter(row => row.state === 'share').length };
  const error = local.data === undefined && local.isError ? local.error.message : status.data?.ok === false ? status.data.error : null;
  const publishQuestion = `Publish ${selectedRows.length} skills to ${catalog.repository ?? 'the team'} (project ${project.key})?`;

  function toggle(name: string, checked: boolean) { setSelected(current => { const next = new Set(current); if (checked) next.add(name); else next.delete(name); return next; }); }
  async function publish() {
    if (!selectedRows.length || action.busy) return;
    working.current = true;
    try {
    /* connect remains a distinct, prior act. The CLI's current one-path Connect API is driven once
       per selected folder here; the publish itself is intentionally exactly one refs call. */
    for (const row of shareRows) {
      if (row.path === null) return;
      const shared = await action.run(() => backend.connect({ path: row.path! }), { [`Connect ${row.name}?`]: true });
      if (!shared?.ok) return;
      setOutcomes(current => ({ ...current, [row.name]: { kind: 'done', text: 'Shared with the team' } }));
    }
    const refs = selectedRows.map(row => row.name);
    const result = await action.run(() => backend.publish({ refs, project: project.key }), { [publishQuestion]: true });
    if (!result) return;
    const returned = result.value;
    if (returned?.outcomes) setOutcomes(current => {
      const next = { ...current };
      for (const item of returned.outcomes!) {
        if (item.outcome === 'added') next[item.name] = { kind: returned.prUrl ? 'opened' : 'done', text: returned.prUrl ? 'Added to project' : `Added to ${project.name}`, ...(returned.prUrl ? { url: returned.prUrl } : {}) };
        else if (item.outcome === 'not-found' || item.outcome === 'hygiene-failed' || item.outcome === 'check-failed') next[item.name] = { kind: 'failed', text: item.detail ?? item.outcome };
      }
      return next;
    });
    } finally { working.current = false; }
  }
  function add() { if (shareRows.length) { working.current = true; setConfirmShare(true); } else void publish(); }

  return <><Dialog open onOpenChange={open => { if (!open && !action.busy && !working.current) onClose(); }}><DialogPopup>
    <DialogTitle>Add skills to {project.name}</DialogTitle>
    <DialogDescription>Skills on this machine. Adding selected skills endorses them into {project.name}, so they place themselves when a teammate syncs inside {project.remote === '—' ? "the project's repository" : project.remote}.</DialogDescription>
    <div className="market-picker-head"><SectionLabel>{counts.endorse} in the team · {counts.share} not shared yet</SectionLabel><div className="market-search"><input value={query} placeholder="Search your skills" aria-label="Search your skills" onChange={event => setQuery(event.target.value)}/></div></div>
    {error ? <ErrorLine>{error}</ErrorLine> : null}{action.error ? <ErrorLine>{action.error}</ErrorLine> : null}
    <div className="market-picker" role="list">
      {local.isPending ? [0, 1, 2].map(row => <div className="market-picker-row" key={row}><BoardSkeleton width="40%" height={12}/><BoardSkeleton width={64} height={24} radius={6}/></div>)
        : shown.length === 0 ? <Small>{rows.length === 0 ? 'No skill folders on this machine yet.' : `Nothing matches “${query}”.`}</Small>
        : shown.map(row => { const outcome = outcomes[row.name]; const disabled = row.state === 'in-project' || (row.state === 'share' && row.path === null); return <div className="market-picker-row" role="listitem" key={row.name}>
          <label><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.name)} disabled={disabled || action.busy} onChange={event => toggle(row.name, event.target.checked)}/></label>
          <div><span>{row.name}</span><Small>{row.state === 'share' ? `${row.where} · not shared with the team yet` : row.where}</Small></div>
          {outcome ? <div className="market-picker-outcome">{outcome.url ? <button type="button" className="market-picker-link" onClick={() => void backend.openUrl(outcome.url!)}>{outcome.text}</button> : <Small>{outcome.text}</Small>}</div> : row.state === 'in-project' ? <Small>In this project</Small> : row.state === 'share' && row.path === null ? <Small>Cannot share this folder</Small> : null}
        </div>; })}
    </div>
    <Small>Endorsements auto-merge when the team’s own checks pass. GitHub conflicts and organization-required checks stay on GitHub.</Small>
    <div className="market-dialog-actions"><Button disabled={action.busy} onClick={onClose}>Done</Button><Button kind="primary" disabled={action.busy || selectedRows.length === 0} onClick={add}>Add {selectedRows.length} skills</Button></div>
  </DialogPopup></Dialog>
  {confirmShare ? <Dialog open onOpenChange={open => { if (!open) { working.current = false; setConfirmShare(false); } }}><DialogPopup>
    <DialogTitle>Share {shareRows.length} skills first?</DialogTitle>
    <DialogDescription>{shareRows.map(row => row.path ?? row.name).join(', ')} will be published under your name. Connect edits each local SKILL.md to add a metadata id before these skills can be endorsed.</DialogDescription>
    <div className="market-dialog-actions"><Button onClick={() => { working.current = false; setConfirmShare(false); }}>Cancel</Button><Button kind="primary" onClick={() => { working.current = true; setConfirmShare(false); void publish(); }}>Share, then add</Button></div>
  </DialogPopup></Dialog> : null}</>;
}
