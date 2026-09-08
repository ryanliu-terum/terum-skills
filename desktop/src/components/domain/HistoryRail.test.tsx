import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { skillByRef } from '../../backend/mock/data';
import { HistoryRail } from './EvaluationReport';

afterEach(cleanup);

it.each(['deploy-check', 'migration-guard'])('shows only the first run’s numbers and strip for %s (EV-20)', (ref) => {
  const result = skillByRef(ref);
  if (!result.ok) throw new Error(result.error);
  const older = skillByRef('deploy-check');
  if (!older.ok) throw new Error(older.error);
  const history = ref === 'migration-guard' ? [...result.value.history, ...older.value.history] : result.value.history;
  const { container } = render(<HistoryRail history={history}/>);
  const rows = container.querySelectorAll('.history-row');
  expect(rows).toHaveLength(history.length);
  expect(rows.length).toBeGreaterThan(1);
  rows.forEach((row, i) => {
    expect(row.querySelectorAll('.history-figure')).toHaveLength(i === 0 ? 1 : 0);
    expect(row.querySelectorAll('.row-strip')).toHaveLength(i === 0 ? 1 : 0);
    expect(row).toHaveTextContent(history[i]!.when);
    expect(row).toHaveTextContent(`${history[i]!.runner} · ${history[i]!.version}`);
    expect(row.hasAttribute('data-showing')).toBe(i === 0);
    expect(row).not.toHaveAttribute('data-selected');
    expect(row).not.toHaveAttribute('tabindex');
    expect(row.querySelector('button, a, [tabindex]')).toBeNull();
  });
  const partial = history[0]?.summary?.partial;
  if (partial) expect(rows[0]!.querySelector('.history-figure')).toHaveTextContent(partial.join('/'));
  expect(container).toHaveTextContent('One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged.');
});
