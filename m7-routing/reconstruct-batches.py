#!/usr/bin/env python3
"""Reconstruct the merged M7 batch list exactly as scratchpad/m7-close-the-canvas-gaps.js does:
winner design (dependency-first) + AMEND_LITERAL applied + dependsOn normalised (S7a edges cut) + S7a MOOT,
then attach every verifier's corrections from the journal(s). Writes merged-batches.json beside this script."""
import json, re, sys, os
from pathlib import Path
HERE = Path(__file__).parent
JOURNALS = [
    Path.home() / '.claude/projects/-home-teniroo-Projects-SSM/51e2c6bb-5612-4285-becd-7b1b38abf186/subagents/workflows/wf_ad77d70b-b74/journal.jsonl',
    Path.home() / '.claude/projects/-home-teniroo-Projects-SSM/7f851f32-e149-4a13-9205-90f176fdcb4a/subagents/workflows/wf_ad77d70b-b74/journal.jsonl',
]
AMEND = HERE / 'amend-literal.json'

def load(path):
    out = []
    if not path.exists(): return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line: continue
        try: out.append(json.loads(line))
        except json.JSONDecodeError as e: print(f'BAD JOURNAL LINE in {path}: {e}', file=sys.stderr)
    return out

entries = [e for p in JOURNALS for e in load(p)]
results = [e['result'] for e in entries if e.get('type') == 'result' and e.get('result') is not None]
designs = [r for r in results if isinstance(r, dict) and 'batches' in r and 'syncDesign' in r]
judges = [r for r in results if isinstance(r, dict) and 'winner' in r and 'scores' in r]
if not designs: sys.exit('no designs in journal')
tally = {}
for j in judges: tally[j['winner']] = tally.get(j['winner'], 0) + 1
winner_lens = max(tally.items(), key=lambda kv: kv[1])[0] if tally else None
# The journal does not store the lens; identify dependency-first by its batch signature (S7a..S7r, 18 batches, S7b = people file).
def lens_of(d):
    ids = [b['id'] for b in d['batches']]
    first = {b['id']: b['rows'] for b in d['batches']}
    if len(ids) == 18 and set(first.get('S7b', [])) == {'PF-03', 'PF-04', 'PF-07', 'PF-09'}: return 'dependency-first'
    if len(ids) == 12: return 'value-first'
    return 'approver-first'
winner = next((d for d in designs if lens_of(d) == winner_lens), None)
if winner is None: sys.exit(f'winner lens {winner_lens} not found among {[lens_of(d) for d in designs]}')
base = json.loads(json.dumps(winner))
amend = json.loads(AMEND.read_text())
by_id = {b['id']: b for b in base['batches']}
for bid in amend.get('removeBatches', []):
    if bid in by_id: base['batches'] = [b for b in base['batches'] if b['id'] != bid]; del by_id[bid]
for e in amend.get('batchEdits', []):
    b = by_id.get(e['id'])
    if not b: continue
    if e.get('addRows'): b['rows'] = list(dict.fromkeys([*b['rows'], *e['addRows']]))
    if e.get('removeRows'): b['rows'] = [r for r in b['rows'] if r not in e['removeRows']]
    if e.get('field') and e['field'] != 'none' and e.get('value') is not None:
        b[e['field']] = [s.strip() for s in e['value'].split(',') if s.strip()] if e['field'] == 'dependsOn' else e['value']
for nb in amend.get('newBatches', []):
    if nb['id'] not in by_id: base['batches'].append(nb); by_id[nb['id']] = nb
base['dispositions'] = [*(base.get('dispositions') or []), *(amend.get('dispositions') or [])]
base['unassigned'] = amend.get('unassigned') or []
base['decisionsForTeddy'] = list(dict.fromkeys([*(base.get('decisionsForTeddy') or []), *(amend.get('decisionsForTeddy') or [])]))

def parse_deps(d):
    items = d if isinstance(d, list) else [d]
    out = []
    for x in items:
        if not isinstance(x, str): continue
        s = x.strip()
        if s.startswith('['):
            try: out.extend(json.loads(s)); continue
            except json.JSONDecodeError: out.append(s); continue
        out.extend(y.strip() for y in s.split(',') if y.strip())
    return out
for b in base['batches']:
    b['dependsOn'] = [d for d in dict.fromkeys(parse_deps(b.get('dependsOn') or [])) if d != 'S7a']
    if b['id'] == 'S7a':
        b['status'] = 'MOOT: RM-11 exports map superseded by frame mode (80054f4); CP-19 re-specified as a hello-frame/FRAME_VERBS inventory in the batch the writer names'
# attach verifications (latest result per batch+lens wins; the lens is not stored, so keep all distinct corrections)
ver = {}
for r in results:
    if isinstance(r, dict) and 'batchId' in r and 'corrections' in r:
        ver.setdefault(r['batchId'], [])
        if r['corrections'] not in [v['corrections'] for v in ver[r['batchId']]]:
            ver[r['batchId']].append({'ok': r.get('ok'), 'corrections': r['corrections'], 'sources': [e.get('source') for e in (r.get('evidence') or [])][:8]})
for b in base['batches']:
    b['verification'] = ver.get(b['id'], [])
out = HERE / 'merged-batches.json'
out.write_text(json.dumps(base, indent=1))
print(f'winner={winner_lens} tally={tally} batches={len(base["batches"])} verified={sum(1 for b in base["batches"] if b["verification"])} -> {out}')
for b in base['batches']:
    print(f"  {b['id']:5} dep={b['dependsOn']} rows={b['rows']} ver={len(b['verification'])} status={b.get('status','')[:40]}")
