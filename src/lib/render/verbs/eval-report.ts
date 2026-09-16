import { board, date, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import { historyOrder, liftPercent, liftText, localRunsOrder } from '../policies.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, nextEval, num, receiptHeadline, receiptSections, receiptVerdict, str, versionText } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  const skill = asRecord(value['skill']);
  const name = str(skill['name']) ?? '—';
  const versions = asRecord(value['versions']);
  const latest = value['latest'];
  const latestState = str(value['latestState']);
  const fallbackFrom = str(value['fallbackFrom']);
  const b = board(`Eval report — ${name}`);
  b.sections.push(kv([
    ['placed', text(versionText(versions['placed']))],
    ['team current', text(versionText(versions['teamCurrent']))],
    ['evaluated', text(versionText(versions['evaluated']))],
    ['id', text(skill['id'])],
  ]));
  if (fallbackFrom !== null) b.notes.push(`The receipt shown comes from ${versionText(fallbackFrom)}; the current version has none.`);
  if (latestState === 'invalid') b.notes.push('The newest receipt at the current version is invalid; older receipts are listed in history only.');
  if (latest !== null && latest !== undefined) {
    b.headline = receiptHeadline(latest, ctx);
    b.sections.push(...receiptSections(latest, asRecord(latest)['triggers'], ctx));
  } else {
    b.headline = latestState === 'invalid' ? '⚠ invalid receipt' : '— not evaluated at the current version';
  }
  const history = asArray(value['history']).map(asRecord).sort((left, right) => historyOrder(
    { version: str(left['version']) ?? '—', run_id: str(left['run_id']) ?? '' },
    { version: str(right['version']) ?? '—', run_id: str(right['run_id']) ?? '' },
  ));
  if (history.length) {
    b.sections.push(table([
      { key: 'version', label: 'Version', priority: 1 },
      { key: 'run', label: 'Run', priority: 2 },
      { key: 'verdict', label: 'Verdict', priority: 1 },
      { key: 'lift', label: 'Lift', priority: 1 },
      { key: 'wlt', label: 'W/L/T', priority: 2 },
      { key: 'model', label: 'Model', priority: 3 },
      { key: 'runner', label: 'Runner', priority: 3 },
      { key: 'when', label: 'When', priority: 3 },
    ], history.map((row) => {
      const comparison = asRecord(row['comparison']);
      // EV-20 (upstream, 2026-09-14): every committed history row carries its own receipt, so a partial run
      // shows its real scored/expected counts instead of "—/—"; rows written before EV-20 have no receipt.
      const receipt = asRecord(row['receipt']);
      const w = num(comparison['win']);
      const l = num(comparison['loss']);
      const t = num(comparison['tie']);
      const signP = num(comparison['sign_p']);
      const lift = w === null || l === null || t === null ? null : liftPercent(w, l, t);
      return {
        version: text(versionText(row['version'])),
        run: text(row['run_id']),
        verdict: receiptVerdict({ verdict: row['verdict'], execution_status: row['execution_status'], expected_rows: num(receipt['expected_rows']), scored_rows: num(receipt['scored_rows']), comparisons: { 'candidate-vs-baseline': { win: w, loss: l, tie: t, ...(signP === null ? {} : { sign_p: signP }) } } }),
        lift: text(liftText(lift)),
        wlt: text(w === null ? null : `${w}/${l}/${t}`),
        model: text(row['model']),
        runner: text(str(row['runner_handle']) === null ? null : `@${row['runner_handle']}`),
        when: date(row['timestamp']),
      };
    }), { title: 'History', cap: ctx.rows }));
  }
  const localRuns = asArray(value['localRuns']).map(asRecord).sort((left, right) => localRunsOrder(
    { run_id: str(left['run_id']) ?? '' },
    { run_id: str(right['run_id']) ?? '' },
  ));
  if (localRuns.length) {
    b.sections.push(table([
      { key: 'run', label: 'Run', priority: 1 },
      { key: 'status', label: 'Status', priority: 1 },
      { key: 'committed', label: 'Committed', priority: 2 },
      { key: 'verdict', label: 'Verdict', priority: 1 },
      { key: 'dir', label: 'Run dir', priority: 3 },
    ], localRuns.map((row) => ({
      run: text(row['run_id']),
      status: status(row['execution_status'] === 'complete' ? 'ok' : row['execution_status'] === 'unknown' ? 'muted' : 'warn', row['execution_status']),
      committed: text(bool(row['committed']) ? 'yes' : 'no'),
      verdict: receiptVerdict(row['receipt']),
      dir: path(row['run_dir']),
    })), { title: 'Local runs', cap: ctx.rows }));
  }
  if (str(skill['name']) !== null) b.next.push(nextEval(name, '--k', '3'), { label: 'Publish', verb: 'publish', args: [name] }); // a `—` name has nothing to run or publish
  return b;
};

export const renderer: Renderer = { render, covered: [] };
