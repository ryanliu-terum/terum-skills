import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { Catalog, LibraryScope, Project, SkillCard } from '../../backend/types';
import { useUrlState } from '../../app/url-state';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { BoardSkeleton, ErrorLine, SectionLabel, Small } from '../../components/domain/Primitives';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';

/**
 * What adding this row costs. `endorse` is one `publish --project`; `share` is two acts, because a
 * skill that is not in the team repo has to be put there (`connect`) before it can be endorsed —
 * and sharing publishes the folder's contents under the author's name, which is a bigger thing than
 * endorsing and is labelled as such rather than hidden behind one button.
 */
type RowState = 'in-project' | 'endorse' | 'share';
interface Row { name: string; desc: string; path: string | null; where: string; state: RowState }
interface Outcome { kind: 'done' | 'opened' | 'failed'; text: string; url?: string }

const ORDER: Record<RowState, number> = { endorse: 0, share: 1, 'in-project': 2 };

function rowsFrom(local: { root: string; skills: SkillCard[] }[], catalog: Catalog, project: Project): Row[] {
  const inTeam = new Set(catalog.skills.map(skill => skill.name));
  const inProject = new Set(project.skillsIn);
  const rows: Row[] = [];
  const seen = new Set<string>();
  // Global first, then each checkout, and the first copy of a name wins — the same precedence
  // `ls --local` applies, so the picker never offers one skill twice under two roots.
  for (const section of local) {
    for (const skill of section.skills) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      rows.push({ name: skill.name, desc: skill.desc, path: skill.path, where: section.root, state: inProject.has(skill.name) ? 'in-project' : inTeam.has(skill.name) ? 'endorse' : 'share' });
    }
  }
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}

export function AddSkillsDialog({ project, catalog, onClose }: { project: Project; catalog: Catalog; onClose: () => void }) {
  const backend = useBackend(), action = useWorkflow(), state = useUrlState();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [query, setQuery] = useState('');
  const status = useQuery({ queryKey: ['status', state.mock], queryFn: ({ signal }) => backend.status(undefined, { signal }) });
  const roots = status.data?.ok ? status.data.value.roots.filter(root => root.kind === 'checkout') : [];
  const local = useQuery({
    queryKey: ['library', 'add-skills', state.mock, roots.map(root => root.id).join('|')],
    enabled: status.isSuccess,
    queryFn: async ({ signal }) => {
      const scopes: LibraryScope[] = [{ kind: 'global' }, ...roots.map(root => ({ kind: 'checkout' as const, root: root.id }))];
      const results = await Promise.all(scopes.map(scope => backend.library({ scope }, { signal })));
      // One unreadable checkout is not a reason to show nothing: its skills are missing from the
      // list and the rest are offered, which is what `ls --local` does with a root it cannot read.
      return results.flatMap(result => result.ok ? [{ root: result.value.root.label, skills: result.value.skills }] : []);
    },
  });

  const rows = local.data ? rowsFrom(local.data, catalog, project) : [];
  const shown = rows.filter(row => !query || (row.name + ' ' + row.desc).toLowerCase().includes(query.toLowerCase()));
  const counts = { endorse: rows.filter(row => row.state === 'endorse').length, share: rows.filter(row => row.state === 'share').length };
  const error = local.data === undefined && local.isError ? local.error.message : status.data?.ok === false ? status.data.error : null;

  /**
   * Sequential, never nested: `useWorkflow` holds one action at a time and ignores a second `run`
   * started from inside the first one's success callback, so the endorsement waits for the share to
   * finish and only starts if it landed. A declined share leaves the skill exactly where it was.
   */
  async function add(row: Row) {
    if (action.busy) return;
    if (row.state === 'share') {
      if (row.path === null) return;
      const shared = await action.run(() => backend.connect({ path: row.path! }));
      if (!shared?.ok) return;
      setOutcomes(current => ({ ...current, [row.name]: { kind: 'done', text: 'Shared with the team' } }));
    }
    const result = await action.run(() => backend.publish({ ref: row.name, project: project.key }));
    if (!result?.ok) return;
    setOutcomes(current => ({ ...current, [row.name]: result.value.prUrl ? { kind: 'opened', text: 'Endorsement opened', url: result.value.prUrl } : { kind: 'done', text: `Added to ${project.name}` } }));
  }

  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}><DialogPopup>
    <DialogTitle>Add skills to {project.name}</DialogTitle>
    <DialogDescription>Skills on this machine. Adding one endorses it into {project.name}, so it places itself when a teammate syncs inside {project.remote === '—' ? "the project's repository" : project.remote}.</DialogDescription>
    <div className="market-picker-head">
      <SectionLabel>{counts.endorse} in the team · {counts.share} not shared yet</SectionLabel>
      <div className="market-search"><input value={query} placeholder="Search your skills" aria-label="Search your skills" onChange={event => setQuery(event.target.value)}/></div>
    </div>
    {error ? <ErrorLine>{error}</ErrorLine> : null}
    {action.error ? <ErrorLine>{action.error}</ErrorLine> : null}
    <div className="market-picker" role="list">
      {local.isPending ? [0, 1, 2].map(row => <div className="market-picker-row" key={row}><BoardSkeleton width="40%" height={12}/><BoardSkeleton width={64} height={24} radius={6}/></div>)
        : shown.length === 0 ? <Small>{rows.length === 0 ? 'No skill folders on this machine yet.' : `Nothing matches “${query}”.`}</Small>
        : shown.map(row => {
          const outcome = outcomes[row.name];
          return <div className="market-picker-row" role="listitem" key={row.name}>
            <div><span>{row.name}</span><Small>{row.state === 'share' ? `${row.where} · not shared with the team yet` : row.where}</Small></div>
            {outcome ? <div className="market-picker-outcome">{outcome.url
              ? <button type="button" className="market-picker-link" onClick={() => void backend.openUrl(outcome.url!)}>{outcome.text}</button>
              : <Small>{outcome.text}</Small>}</div>
              : row.state === 'in-project' ? <Small>In this project</Small>
              : <Button disabled={action.busy || (row.state === 'share' && row.path === null)} onClick={() => void add(row)}>{row.state === 'share' ? 'Share, then add' : 'Add'}</Button>}
          </div>;
        })}
    </div>
    <Small>Endorsements follow the team's publish policy. Under pull-request policy the skill joins {project.name} when its pull request merges, so the count here does not move yet.</Small>
    <div className="market-dialog-actions"><Button disabled={action.busy} onClick={onClose}>Done</Button></div>
  </DialogPopup></Dialog>;
}
