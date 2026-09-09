"""AO · the sidebar's collapse controls get real states (D9 of the 2026-09-08 design-strings walk, LOCK: "chevrons and the collapse
button get real states, and three new boards are drawn (sidebar hidden, Projects collapsed, Inbox collapsed)"; Teddy, 2026-09-09:
"make sure the collapse buttons work too").

Boards: LibrarySidebarHidden (the sidebar is gone, 240 → 0, not an icon rail; the panel keeps its 8px inset on the left too; the
reopen control is the same panel-left button, now in the top bar's left block after the history arrows — ASSUMPTION for Teddy),
LibraryProjectsCollapsed and LibraryInboxCollapsed (the section row shows chevron-right, its nested rows are gone, the Library /
Team section headers do not collapse: they carry no rows of their own worth hiding — ASSUMPTION for Teddy).
Run: python3 .patches/patch_ao.py   (then: python3 build.py; ./render.sh)."""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
BUILD = HERE / "build.py"
CANVAS = HERE / "canvas.json"


class Patch:
    def __init__(self, name: str):
        self.name = name
        self.src = BUILD.read_text(encoding="utf-8")
        self.n = 0

    def rep(self, old: str, new: str, count: int = 1) -> None:
        found = self.src.count(old)
        if found != count:
            raise SystemExit(f"[{self.name}] anchor occurs {found}x, expected {count}:\n{old[:240]}")
        self.src = self.src.replace(old, new)
        self.n += 1

    def write(self) -> None:
        BUILD.write_text(self.src, encoding="utf-8")
        print(f"patch applied: {self.name} ({self.n} replacements)")


p = Patch("AO · sidebar collapse states")

# ---- nav_row: a collapsed expandable row shows chevron-right ------------------------------------------------------------------
p.rep('def nav_row(t, label, ico, *, count=None, selected=False, nested=False, expandable=False) -> str:',
      'def nav_row(t, label, ico, *, count=None, selected=False, nested=False, expandable=False, collapsed=False) -> str:')
p.rep('''    chevron = icon("chevron-down", 12, t["text4"], "2") if expandable else ""''',
      '''    chevron = icon("chevron-right" if collapsed else "chevron-down", 12, t["text4"], "2") if expandable else ""''')

# ---- sidebar: collapsed sections drop their nested rows -----------------------------------------------------------------------
p.rep('def sidebar(t, selected: str = "Global", counts: dict | None = COUNTS) -> str:\n'
      '    """counts=None renders no numbers (loading); pass a dict to override individual scopes."""\n'
      '    s = lambda k: k == selected\n'
      '    c = (lambda k: None) if counts is None else (lambda k: counts.get(k))\n',
      'def sidebar(t, selected: str = "Global", counts: dict | None = COUNTS, *, collapsed: tuple = ()) -> str:\n'
      '    """counts=None renders no numbers (loading); pass a dict to override individual scopes.\n'
      '    collapsed names the expandable sections (Projects, Inbox) drawn closed: chevron-right, nested rows gone (D9)."""\n'
      '    s = lambda k: k == selected\n'
      '    c = (lambda k: None) if counts is None else (lambda k: counts.get(k))\n'
      '    projects_rows = "" if "Projects" in collapsed else (nav_row(t, "Terum", "box", count=c("Terum"), nested=True) + nav_row(t, "SSM", "box", count=c("SSM"), nested=True)\n'
      '                                                          + nav_row(t, "MRF", "box", count=c("MRF"), nested=True))\n'
      '    inbox_rows = "" if "Inbox" in collapsed else (nav_row(t, "Pushes", "arrow-down-to-line", count=c("Pushes"), nested=True) + nav_row(t, "Updates", "refresh", count=c("Updates"), nested=True)\n'
      '                                                    + nav_row(t, "Alerts", "alert", count=c("Alerts"), nested=True))\n')
p.rep('''          {nav_row(t, "Projects", "folder", expandable=True)}
          {nav_row(t, "Terum", "box", count=c("Terum"), nested=True)}
          {nav_row(t, "SSM", "box", count=c("SSM"), nested=True)}
          {nav_row(t, "MRF", "box", count=c("MRF"), nested=True)}
          {nav_row(t, "Inbox", "inbox", expandable=True, selected=s("Inbox"))}
          {nav_row(t, "Pushes", "arrow-down-to-line", count=c("Pushes"), nested=True)}
          {nav_row(t, "Updates", "refresh", count=c("Updates"), nested=True)}
          {nav_row(t, "Alerts", "alert", count=c("Alerts"), nested=True)}''',
      '''          {nav_row(t, "Projects", "folder", expandable=True, collapsed="Projects" in collapsed)}{projects_rows}
          {nav_row(t, "Inbox", "inbox", expandable=True, selected=s("Inbox"), collapsed="Inbox" in collapsed)}{inbox_rows}''')

# ---- top bar: the reopen control when the sidebar is hidden -------------------------------------------------------------------
p.rep('def top_bar(t) -> str:\n    return f"""', 'def top_bar(t, *, sidebar_hidden: bool = False) -> str:\n    reopen = icon_button(t, "panel-left", 20, 4, 14, t["text4"]) if sidebar_hidden else ""\n    return f"""')
p.rep('''      {icon_button(t, "chevron-left")}{icon_button(t, "chevron-right")}
    </div>''', '''      {icon_button(t, "chevron-left")}{icon_button(t, "chevron-right")}{reopen}
    </div>''')

# ---- shell: a hidden sidebar (240 → 0) and collapsed sections -----------------------------------------------------------------
p.rep('def shell(t, panel_inner: str, *, selected: str = "Global", counts: dict | None = COUNTS, overlay: str = "", height: int = FRAME_H) -> str:',
      'def shell(t, panel_inner: str, *, selected: str = "Global", counts: dict | None = COUNTS, overlay: str = "", height: int = FRAME_H,\n'
      '          sidebar_hidden: bool = False, collapsed: tuple = ()) -> str:')
p.rep('''  <div style="display: flex; flex-grow: 1; min-height: 0;">{sidebar(t, selected, counts)}
    <div style="display: flex; flex-direction: column; flex-grow: 1; margin: 0 8px 8px 0; border-radius: 8px;''',
      '''  <div style="display: flex; flex-grow: 1; min-height: 0;">{"" if sidebar_hidden else sidebar(t, selected, counts, collapsed=collapsed)}
    <div style="display: flex; flex-direction: column; flex-grow: 1; margin: 0 8px 8px {8 if sidebar_hidden else 0}px; border-radius: 8px;''')
top_bar_call = p.src.count("{top_bar(t)}")
if top_bar_call != 1:
    raise SystemExit(f"[AO] top_bar(t) is called {top_bar_call}x inside shell's body, expected 1")
p.rep("{top_bar(t)}", "{top_bar(t, sidebar_hidden=sidebar_hidden)}")

# ---- the three boards ---------------------------------------------------------------------------------------------------------
p.rep('def library_collapsed(t) -> str:\n    return shell(t, view_header(t, overview="show") + search_row(t) + card_grid(t, SKILLS))\n',
      'def library_collapsed(t) -> str:\n    return shell(t, view_header(t, overview="show") + search_row(t) + card_grid(t, SKILLS))\n'
      '\n'
      'def library_sidebar_hidden(t) -> str:\n'
      '    """D9: the sidebar collapse button hides the sidebar entirely; the reopen control sits in the top bar."""\n'
      '    return shell(t, view_header(t, overview="hide") + analytics_row(t) + analytics_divider(t) + search_row(t) + card_grid(t, SKILLS), sidebar_hidden=True)\n'
      '\n'
      'def library_section_collapsed(t, section: str) -> str:\n'
      '    """D9: a section chevron folds its nested rows (Projects or Inbox)."""\n'
      '    return shell(t, view_header(t, overview="hide") + analytics_row(t) + analytics_divider(t) + search_row(t) + card_grid(t, SKILLS), collapsed=(section,))\n')
p.rep('    "LibraryCollapsed":  lambda: library_collapsed(theme("dark")),',
      '    "LibraryCollapsed":  lambda: library_collapsed(theme("dark")),\n'
      '    "LibrarySidebarHidden":     lambda: library_sidebar_hidden(theme("dark")),\n'
      '    "LibraryProjectsCollapsed": lambda: library_section_collapsed(theme("dark"), "Projects"),\n'
      '    "LibraryInboxCollapsed":    lambda: library_section_collapsed(theme("dark"), "Inbox"),')
p.write()

# ---- canvas.json: three frames on the Library page, below the existing rows ------------------------------------------------
canvas = json.loads(CANVAS.read_text(encoding="utf-8"))
files = {a["file"] for a in canvas["artboards"]}
new = ["LibrarySidebarHidden.dc.html", "LibraryProjectsCollapsed.dc.html", "LibraryInboxCollapsed.dc.html"]
if any(f in files for f in new):
    raise SystemExit("[AO] canvas.json already lists one of the new boards")
row_y = max(a["y"] for a in canvas["artboards"] if a.get("page") == "library") + 1020
slots = [(1560, row_y - 1020) if not any(a.get("page") == "library" and a["x"] == 1560 and a["y"] == row_y - 1020 for a in canvas["artboards"]) else None]
positions = []
if slots[0]:
    positions.append(slots[0])
x = 0
while len(positions) < 3:
    positions.append((x, row_y)); x += 1560
    if x > 1560:
        x = 0; row_y += 1020
for f, (x, y) in zip(new, positions):
    canvas["artboards"].append({"file": f, "x": x, "y": y, "w": 1440, "h": 900, "page": "library"})
canvas["launch"] = {"view": "canvas", "page": "library"}
CANVAS.write_text(json.dumps(canvas, indent=2) + "\n", encoding="utf-8")
print("canvas.json: three Library boards added at", positions)
