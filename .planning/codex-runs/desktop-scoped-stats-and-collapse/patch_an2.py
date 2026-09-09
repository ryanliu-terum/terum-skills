"""AN2 · the project pages' evaluated counts derive too, the states-sheet placement specimen follows PROJECTS, and an overview's
attention list prints only the lines that are non-zero ("All clear" when nothing needs attention). Companion to patch_an.py.
Run: python3 .patches/patch_an2.py"""
import pathlib
BUILD = pathlib.Path(__file__).resolve().parent.parent / "build.py"
src = BUILD.read_text(encoding="utf-8"); n = 0
def rep(old, new, count=1):
    global src, n
    if src.count(old) != count: raise SystemExit(f"anchor occurs {src.count(old)}x, expected {count}:\n{old[:200]}")
    src = src.replace(old, new); n += 1
rep('def list_size(name: str) -> int:', 'def list_evaluated(name: str) -> int:\n    """How many of a list\'s catalog skills carry a receipt."""\n    return sum(1 for s in CATALOG if name in LIST_OF.get(s["name"], ()) and receipt_of(s) is not None)\n\ndef list_size(name: str) -> int:')
for name, e in (("Terum", 19), ("SSM", 11), ("MRF", 27), ("Docs", 5)):
    rep(f'evaluated={e})', f'evaluated=list_evaluated("{name}"))')
rep('status_box(t, "Installed", "22 skills placed in ~/Projects/terum")', 'status_box(t, "Installed", f\'{PROJECTS[0]["skills"]} skills placed in {PROJECTS[0]["path"]}\')')
rep('''    lines = [f"{plural(failing, 'failing eval')}", f"{plural(updates, 'update')} available", f"{unscored} not evaluated"]''',
    '''    lines = [text for count, text in ((failing, plural(failing, "failing eval")), (updates, f"{plural(updates, 'update')} available"), (unscored, f"{unscored} not evaluated")) if count] or ["All clear"]''')
BUILD.write_text(src, encoding="utf-8"); print(f"patch applied: AN2 ({n} replacements)")
