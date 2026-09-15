import { afterEach,expect,it } from 'vitest';
import { cleanup,render,screen } from '@testing-library/react';
import { skillByRef } from '../../backend/mock/data';
import { CaseRunGroup } from './ScoreRow';
import { CaseTable } from './EvaluationReport';
afterEach(cleanup);
const receiptOf=()=>{const r=skillByRef('deploy-check');if(!r.ok)throw new Error(r.error);return r.value.receipt!;};
it('rev 20: the Quality group states the receipt tally — case-runs at k>1, cases at k=1 — with one pip per (case × rep) while they fit, and a dash without the fields',()=>{
 const receipt=receiptOf();const {container,rerender}=render(<CaseRunGroup receipt={receipt}/>);
 expect(screen.getByText('case-runs passed · 6 cases × 3 reps')).toBeInTheDocument();expect(screen.getAllByText('case-runs')).toHaveLength(2);
 expect(screen.getByText(String(receipt.case_runs!['candidate']!.passed))).toBeInTheDocument();
 // 6 cases × 3 reps = 18 case-runs is past MAX_STRIP_PIPS: the count stands alone, Table 1 carries the pips.
 expect(container.querySelector('.case-run-pips')).toBeNull();
 const twelve={...receipt,case_rows:receipt.case_rows!.filter(row=>row.rep<2),case_runs:{candidate:{passed:9,total:12},baseline:{passed:6,total:12}}};rerender(<CaseRunGroup receipt={twelve}/>);
 const [candidate,baseline]=container.querySelectorAll('.case-run-pips');
 expect(candidate!.querySelectorAll('i')).toHaveLength(12);expect(candidate!.querySelectorAll(':scope>span')).toHaveLength(6);
 expect(candidate!.querySelectorAll('i[data-pass]')).toHaveLength(twelve.case_rows.filter(row=>row.arms['candidate']?.passed===true).length);expect(baseline!.querySelectorAll('i[data-pass]')).toHaveLength(twelve.case_rows.filter(row=>row.arms['baseline']?.passed===true).length);
 const one={...receipt,k:1,case_rows:receipt.case_rows!.filter(row=>row.rep===0),case_runs:{candidate:{passed:1,total:3},baseline:{passed:0,total:3}}};rerender(<CaseRunGroup receipt={one}/>);
 expect(screen.getByText('cases passed, every check green')).toBeInTheDocument();expect(screen.getAllByText('passed cases')).toHaveLength(2);expect(container.querySelector('.case-run-pips')!.querySelectorAll('i')).toHaveLength(6);
 const legacy={...receipt};delete legacy.case_rows;delete legacy.case_runs;rerender(<CaseRunGroup receipt={legacy}/>);expect(screen.getAllByText('—')).toHaveLength(2);expect(container.querySelector('.case-run-pips')).toBeNull();
 rerender(<CaseRunGroup receipt={null}/>);expect(screen.getAllByText('—')).toHaveLength(2);
});
it('rev 20: Table 1 has one expandable row per case with a pip per rep per arm, a glyph per rep per check, and the receipt tally in its totals row',()=>{
 const receipt=receiptOf();const {container}=render(<CaseTable rows={receipt.case_rows!} k={receipt.k} tally={receipt.case_runs!}/>);
 const rows=container.querySelectorAll('details.case-row');expect(rows).toHaveLength(6);
 const first=rows[0]!;expect(first.querySelector('summary .case-name')?.textContent).toContain('stale-env-vars');expect(first.querySelector('summary .case-name')?.textContent).toContain('2 checks');
 expect(first.querySelectorAll('summary .case-reps')).toHaveLength(2);expect(first.querySelectorAll('summary .case-reps i')).toHaveLength(6);
 expect(first.querySelectorAll('.case-check-row')).toHaveLength(2);expect(first.querySelectorAll('.case-check-row .case-check-glyphs>span')).toHaveLength(12);
 expect(first.querySelectorAll('.case-check-row .case-check-glyphs>span[data-v="pass"]').length+first.querySelectorAll('.case-check-row .case-check-glyphs>span[data-v="fail"]').length).toBe(12);
 expect(container.querySelector('.case-table-head')?.textContent).toContain('1 2 3');
 expect(container.querySelector('.case-table-sum')?.textContent).toBe(`passed case-runs${receipt.case_runs!['baseline']!.passed}/18${receipt.case_runs!['candidate']!.passed}/18`);
});
