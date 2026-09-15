import { describe, expect, it } from 'vitest';
import { publishChip } from './publish-run-status';
import type { PublishRow, PublishRunState } from './publish-run-context';
import type { SkillCard } from '../backend/types';

const card = (name: string) => ({ name, path: '/skills/' + name, teamed: false } as unknown as SkillCard);
const row = (name: string, state: PublishRow['state']): PublishRow => ({ key: '/skills/' + name, card: card(name), state });
const run = (rows: PublishRow[], extra: Partial<PublishRunState> = {}): PublishRunState => ({ rows, origin: 'library', reported: false, flags: {}, startedAt: 0, state: 'running', ...extra });
const done = (name: string) => row(name, { kind: 'done', text: `${name} was published to the marketplace as Version 3.` });

describe('publishChip', () => {
  it('is null with no run', () => { expect(publishChip(null)).toBeNull(); });

  it('one skill running: the verb is the state, the name (and the CLI step, when there is one) the subject', () => {
    const one = run([row('deploy-check', { kind: 'publishing', label: null })]);
    expect(publishChip(one)).toMatchObject({ state: 'Publishing', subject: 'deploy-check', label: 'Publishing · deploy-check', tone: 'running', running: true });
    expect(publishChip({ ...one, progress: { t: 'progress', done: 1, total: 4, label: 'Committing the version' } })).toMatchObject({ subject: 'deploy-check · Committing the version', label: 'Publishing · deploy-check · Committing the version' });
  });

  it('several skills running: the count is the whole story and counts only rows the queue can send', () => {
    const rows = [done('a'), row('b', { kind: 'publishing', label: null }), row('c', { kind: 'queued' }), row('d', { kind: 'skipped', reason: 'no folder' })];
    expect(publishChip(run(rows))).toMatchObject({ state: 'Publishing · 1 of 3', subject: null, label: 'Publishing · 1 of 3', running: true });
    // A failed or cancelled row has settled too: the count moves on.
    expect(publishChip(run([done('a'), row('b', { kind: 'failed', error: 'x' }), row('c', { kind: 'cancelled' }), row('d', { kind: 'publishing', label: null })]))).toMatchObject({ state: 'Publishing · 3 of 4' });
  });

  it('stopping still runs: Stop stays offered so a second press can force-abandon (D2)', () => {
    expect(publishChip(run([row('deploy-check', { kind: 'publishing', label: null })], { state: 'stopping' }))).toMatchObject({ state: 'Stopping', subject: 'deploy-check', tone: 'running', running: true });
    expect(publishChip(run([row('a', { kind: 'publishing', label: null }), row('b', { kind: 'not-started' })], { state: 'stopping' }))).toMatchObject({ label: 'Stopping · 2 skills' });
  });

  it('stopped counts what landed, including a publish that finished before its cancel', () => {
    const rows = [done('a'), row('b', { kind: 'cancelled' }), row('c', { kind: 'not-started' })];
    expect(publishChip(run(rows, { state: 'stopped', summary: { published: 1, attempted: 3, failed: 0 } }))).toMatchObject({ label: 'Publish stopped · 1 published', tone: 'stopped', running: false });
    expect(publishChip(run(rows, { state: 'stopped' }))).toMatchObject({ label: 'Publish stopped · 0 published' });
  });

  it('a failed single publish names the skill and carries the CLI sentence in the title', () => {
    const chip = publishChip(run([row('deploy-check', { kind: 'failed', error: 'fatal: the team clone is locked by another publish' })], { state: 'failed', summary: { published: 0, attempted: 1, failed: 1 } }));
    expect(chip).toMatchObject({ label: 'Publish failed · deploy-check', title: 'Publish failed · deploy-check — fatal: the team clone is locked by another publish', tone: 'failed', running: false });
  });

  it('a failed publish is named for the row that failed, not for a skipped row ahead of it', () => {
    const rows = [row('bundled-manual', { kind: 'skipped', reason: 'bundled' }), row('deploy-check', { kind: 'failed', error: 'fatal: nope' })];
    expect(publishChip(run(rows, { state: 'failed', summary: { published: 0, attempted: 1, failed: 1 } }))).toMatchObject({ label: 'Publish failed · deploy-check', title: 'Publish failed · deploy-check — fatal: nope' });
  });

  it('a finished single publish carries the outcome sentence in the title, so it is one hover away after the board is closed', () => {
    const chip = publishChip(run([done('deploy-check')], { state: 'done', summary: { published: 1, attempted: 1, failed: 0 } }));
    expect(chip).toMatchObject({ label: 'Publish finished · deploy-check', title: 'Publish finished · deploy-check — deploy-check was published to the marketplace as Version 3.', tone: 'done', running: false });
  });

  it('a finished bulk publish reads the summary; a failure among the rows turns the tone', () => {
    const rows = [done('a'), row('b', { kind: 'failed', error: 'x' }), done('c')];
    expect(publishChip(run(rows, { state: 'done', summary: { published: 2, attempted: 3, failed: 1 } }))).toMatchObject({ state: 'Published · 2 of 3', subject: '1 failed', label: 'Published · 2 of 3 · 1 failed', tone: 'failed' });
    expect(publishChip(run([done('a'), done('c')], { state: 'done', summary: { published: 2, attempted: 2, failed: 0 } }))).toMatchObject({ label: 'Published · 2 of 2', subject: null, tone: 'done' });
  });
});
