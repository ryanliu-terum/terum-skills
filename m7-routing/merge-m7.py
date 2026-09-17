#!/usr/bin/env python3
"""merge-m7.py <task-output-file> : take the M7 workflow's return (document + sidecar fields), append the routing
section (section 10 + Appendix B), write the milestone document to the repo's .planning/research path, and dump the
sidecar fields (definitionRow, decisionsForTeddy, criticVerdict, notVerified, mergedBatches) beside this script."""
import json, sys, re
from pathlib import Path
HERE = Path(__file__).parent
OUT = Path('/home/teniroo/Projects/SSM/terum-skills/.planning/research/2026-09-08-m7-close-the-canvas-gaps.md')
if len(sys.argv) != 2: sys.exit('usage: merge-m7.py <task-output-file>')
raw = Path(sys.argv[1]).read_text()
try:
    wrapper = json.loads(raw)
except json.JSONDecodeError:
    # the output file may carry a prefix line; find the first '{'
    wrapper = json.loads(raw[raw.index('{'):])
result = wrapper.get('result', wrapper)
if isinstance(result, str):
    try: result = json.loads(result)
    except json.JSONDecodeError: sys.exit('result is a non-JSON string; inspect the output file')
doc = result.get('document')
if not doc or len(doc) < 2000: sys.exit(f'document missing or too short ({len(doc or "")} chars); read the journal before merging')
section = (HERE / 'routing-section.md').read_text()
if '## 10.' not in doc:
    merged = doc.rstrip('\n') + '\n\n' + section.rstrip('\n') + '\n'
else:
    sys.exit('document already has a section 10; refusing to append twice')
OUT.parent.mkdir(parents=True, exist_ok=True)
if OUT.exists(): sys.exit(f'{OUT} already exists; refusing to overwrite (move it aside first)')
OUT.write_text(merged)
side = {k: result.get(k) for k in ('definitionRow', 'decisionsForTeddy', 'firstSpecOutline', 'notVerified', 'criticVerdict', 'critic', 'batches', 'mergedBatches', 'unassigned', 'dispositions', 'winnerLens', 'judgeTally')}
(HERE / 'm7-sidecar.json').write_text(json.dumps(side, indent=1))
words = len(merged.split())
print(f'wrote {OUT} ({words} words; document {len(doc.split())} + routing {len(section.split())}); sidecar -> {HERE / "m7-sidecar.json"}')
print('headings:'); [print('  ', h) for h in re.findall(r'^#{1,3} .*$', merged, re.M)]
