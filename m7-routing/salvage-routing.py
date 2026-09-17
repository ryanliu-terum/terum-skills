#!/usr/bin/env python3
"""Collect the routing workflow's outputs: journal results first, then for every FAILED agent the last
StructuredOutput attempt from its transcript (complete answers that only exceeded a maxLength cap).
Writes routing-results.json: {confirms: {id: {...}}, refutes: {id: [ {...} ]}, order: {...}|null, salvaged: [ids]}."""
import json, re, sys
from pathlib import Path
D = Path.home() / '.claude/projects/-home-teniroo-Projects-SSM/7f851f32-e149-4a13-9205-90f176fdcb4a/subagents/workflows/wf_6b9665b6-498'
OUT = Path(__file__).parent / 'routing-results.json'
def jl(p):
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line: continue
        try: yield json.loads(line)
        except json.JSONDecodeError as e: print(f'bad line in {p.name}: {e}', file=sys.stderr)
journal = list(jl(D / 'journal.jsonl'))
key_agent = {}
status = {}
for e in journal:
    if e.get('type') == 'started': key_agent[e['agentId']] = e['key']
    if e.get('type') in ('result', 'failed'): status[e.get('key')] = e['type']
confirms, refutes, order, salvaged = {}, {}, None, []
def take(r, source):
    global order
    if not isinstance(r, dict): return
    if 'order' in r and 'lightsAfter' in r: order = r; return
    if 'lens' in r and 'refuted' in r: refutes.setdefault(r['id'], []).append(r | {'_source': source}); return
    if 'verdict' in r and 'anchors' in r:
        if r['id'] not in confirms or source == 'journal': confirms[r['id']] = r | {'_source': source}
for e in journal:
    if e.get('type') == 'result': take(e.get('result'), 'journal')
# salvage: any agent transcript whose key is not a journal result
for t in sorted(D.glob('agent-*.jsonl')):
    aid = t.stem.replace('agent-', '')
    key = key_agent.get(aid)
    if key and status.get(key) == 'result': continue  # already have the real result
    last = None
    for e in jl(t):
        msg = e.get('message') or {}
        content = msg.get('content') if isinstance(msg, dict) else None
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get('type') == 'tool_use' and part.get('name') == 'StructuredOutput':
                    last = part.get('input')
    if not last: continue
    # only salvage if the workflow has given up on this agent (failed) or it is not tracked
    if key and status.get(key) not in ('failed', None): continue
    rid = last.get('id') or last.get('batchId')
    take(last, f'salvaged:{aid}')
    salvaged.append(f"{rid}:{'refute:' + last['lens'] if 'lens' in last else ('order' if 'order' in last else 'confirm')}")
OUT.write_text(json.dumps({'confirms': confirms, 'refutes': refutes, 'order': order, 'salvaged': salvaged}, indent=1))
print(f'confirms={len(confirms)} refutes={sum(len(v) for v in refutes.values())} order={"yes" if order else "no"} salvaged={salvaged}')
print('confirmed ids:', sorted(confirms))
