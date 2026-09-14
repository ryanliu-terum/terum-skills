"""AR · two more app-side facts the error boards (and every sidebar board) draw, found by the 2026-09-13 fidelity run
after AP+AQ:
  1. the Projects group ends in an "Add project" row (desktop #102, D1 registration by an explicit Add; ratified with the
     Connect removal, ajay 2026-09-10). Drawn nested, label and plus icon in text3, otherwise a nav row; hidden when the
     Projects group is collapsed, as in Sidebar.tsx.
  2. the skill read-failure header draws root / name ("Global / deploy-check"): the app keeps the root label it was
     opened from and the ref, nothing else. AQ drew the name alone; this corrects it.
Run: python3 .patches/patch_ar.py   (then: python3 build.py; ./render.sh)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from patchlib import Patch
p = Patch("AR")
p.rep('def nav_row(t, label, ico, *, count=None, selected=False, nested=False, expandable=False, collapsed=False) -> str:\n'
      '    pad_left = 8 + (NEST_INDENT if nested else 0)\n'
      '    bg = t["bg3"] if selected else "transparent"\n'
      '    color = t["text1"] if selected else t["text2"]\n'
      '    icon_color = t["text1"] if selected else t["text3"]',
      'def nav_row(t, label, ico, *, count=None, selected=False, nested=False, expandable=False, collapsed=False, muted=False) -> str:\n'
      '    """muted: the Add project affordance — label and icon both in text3 (Sidebar.tsx AddProjectRow)."""\n'
      '    pad_left = 8 + (NEST_INDENT if nested else 0)\n'
      '    bg = t["bg3"] if selected else "transparent"\n'
      '    color = t["text3"] if muted else (t["text1"] if selected else t["text2"])\n'
      '    icon_color = t["text1"] if selected else t["text3"]')
p.rep('                                                          + nav_row(t, "MRF", "box", count=c("MRF"), nested=True))',
      '                                                          + nav_row(t, "MRF", "box", count=c("MRF"), nested=True)\n'
      '                                                          + nav_row(t, "Add project", "plus", nested=True, muted=True))')
p.rep('    parts = [name] if crumbs == "name" else [dim(s.get("root", "Global")), dim(s["project"]), dim(s["category"]), name]',
      '    parts = [dim(s.get("root", "Global")), name] if crumbs == "root" else [dim(s.get("root", "Global")), dim(s["project"]), dim(s["category"]), name]')
p.rep('detail_header(t, DETAIL, rail_open=False, crumbs="name")', 'detail_header(t, DETAIL, rail_open=False, crumbs="root")')
p.write()
