"""AN · every count derives from the sample that exists, and the Library's overview is scoped (Teddy, 2026-09-09: "make sure all
numbers and other things are consistent" · "global and project stats should be scoped").

Before this patch the sample declared a team catalog of 30 skills but defined 17 (15 with cards); the sidebar, the overview tiles,
the Marketplace header, the project cards, the category tiles and the receipts' "catalog of 30 skills" were typed against the 30
while every per-skill and per-person number derived from the 17. After it:
- CATALOG_N is the length of CATALOG (17) and is gated;
- COUNTS' four scope numbers derive from SKILLS × LIST_OF (Global = every skill on this machine, a project = the SKILLS its
  team.json list references; Docs is not checked out here) — Pushes / Updates / Alerts stay typed (the mock already derives two);
- PROJECTS' skill counts derive from LIST_OF; CATEGORIES' counts derive from CATALOG (empty tiles are dropped);
- LIBRARY_OVERVIEW derives from the Global scope and OVERVIEW_BY_SCOPE carries one overview per scope for the app (skills, "N
  endorsed to Global", evaluated N of M with the verdict meter, team installs = the scope's installs summed, needs attention =
  failing evals + updates available + not evaluated). The Library header and search row print the scope's count ("15 skills").
Decisions recorded here rather than asked: Global = the 15 skills on this machine (what the Library lists), not team.json's global[]
(7); the Inbox digest "deploy-check · a skill you wrote" (author ajay) is NOT changed — that persona question is Teddy's.
Run: python3 .patches/patch_an.py   (then: python3 build.py; ./render.sh --all; npm run export in desktop/)."""
import pathlib
import re

BUILD = pathlib.Path(__file__).resolve().parent.parent / "build.py"


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


p = Patch("AN · derived counts, scoped overview")

# ---- the catalog size is a fact of the sample, defined early because the receipt texts print it -------------------------------
p.rep('COUNTS = {"Global": "30", "Terum": "22", "SSM": "15", "MRF": "32", "Pushes": "3", "Updates": "3", "Alerts": "8"}',
      'CATALOG_N = 17              # the team catalog: len(CATALOG), gated in check_market (the receipts print "catalog of N skills")\n'
      'SCOPE_N = "__scope_n__"     # sentinel: a header or search row printing the scope\'s own skill count (resolved from COUNTS at call time)\n'
      'COUNTS = {"Global": "", "Terum": "", "SSM": "", "MRF": "", "Pushes": "3", "Updates": "3", "Alerts": "8"}   # the four scope counts derive from SKILLS × LIST_OF (derive_counts, below CATEGORIES); the Inbox rows are typed')
p.rep('CATALOG_N = 30              # the team catalog (the receipt\'s "catalog of 30 skills"); the sample below renders 17 of them\n',
      '# CATALOG_N is defined beside COUNTS (the receipts above print it) and gated against len(CATALOG) in check_market\n')

# ---- header and search row print the scope's count ---------------------------------------------------------------------------
p.rep('def view_header(t, title="Global", subtitle: str | None = "15 of 30 skills", *,', 'def view_header(t, title="Global", subtitle: str | None = SCOPE_N, *,')
p.rep('''    sub = f'<span style="font-size: 13px; color: {t["text3"]};">{subtitle}</span>' if subtitle else ""''',
      '''    if subtitle == SCOPE_N:
        subtitle = f'{COUNTS[title] if title in COUNTS else len(SKILLS)} skills'
    sub = f'<span style="font-size: 13px; color: {t["text3"]};">{subtitle}</span>' if subtitle else ""''')
p.rep('def search_row(t, *, query: str | None = None, count_label="Search 30 skills", sort_label="Recently updated") -> str:',
      'def search_row(t, *, query: str | None = None, count_label=SCOPE_N, sort_label="Recently updated") -> str:\n'
      '    if count_label == SCOPE_N:\n'
      '        count_label = f"Search {COUNTS[\'Global\']} skills"')

# ---- the overview tiles derive (the literal becomes a placeholder rebound below GLOBAL_SET) ----------------------------------
start = p.src.index("LIBRARY_OVERVIEW = dict(   # the Global library's four overview tiles")
end = p.src.index("def analytics_row(t, *, zero=False) -> str:")
p.src = p.src[:start] + ('LIBRARY_OVERVIEW: dict = {}   # rebound below GLOBAL_SET: library_overview("Global"); OVERVIEW_BY_SCOPE carries every scope for the app\n'
                         'OVERVIEW_ZERO = dict(skills="Nothing added yet", evaluated="Nothing evaluated yet", installs="Share a skill to see installs here", attention="All clear")\n\n') + p.src[end:]
p.n += 1

# ---- receipts print the real catalog size -------------------------------------------------------------------------------------
p.rep('"against the team catalog of 30 skills. The candidate outperformed baseline in 11 of 18 rounds', 'f"against the team catalog of {CATALOG_N} skills. The candidate outperformed baseline in 11 of 18 rounds')
p.rep('trigger_text="Selecting from the team catalog of 30 skills, the agent chose the candidate on 6 of 6', 'trigger_text=f"Selecting from the team catalog of {CATALOG_N} skills, the agent chose the candidate on 6 of 6')
p.rep('"trigger selection measured against the team catalog of 30 skills. Two rounds hit the agent timeout', 'f"trigger selection measured against the team catalog of {CATALOG_N} skills. Two rounds hit the agent timeout')
p.rep('trigger_text="Selecting from the team catalog of 30 skills, the agent chose the candidate on 4 of 5', 'trigger_text=f"Selecting from the team catalog of {CATALOG_N} skills, the agent chose the candidate on 4 of 5')

# ---- project skill counts and category counts derive --------------------------------------------------------------------------
p.rep('PROJECTS = [   # team.json projects. Skill counts are the sidebar\'s (a skill can sit on several lists). Docs is not checked out on this machine.',
      'def list_size(name: str) -> int:\n'
      '    """How many catalog skills a team.json list references (a skill can sit on several lists)."""\n'
      '    return sum(1 for s in CATALOG if name in LIST_OF.get(s["name"], ()))\n\n'
      'PROJECTS = [   # team.json projects. Skill counts derive from LIST_OF. Docs is not checked out on this machine.')
for name, n in (("Terum", 22), ("SSM", 15), ("MRF", 32), ("Docs", 8)):
    p.rep(f'skills={n}, members=', f'skills=list_size("{name}"), members=')
p.rep('''CATEGORIES = [   # (key, icon, catalog count): the counts are the whole catalog's and sum to CATALOG_N; the sample renders a subset of each
    ("infra", "box", 6), ("docs", "book-open", 5), ("review", "eye", 5), ("ops", "terminal", 3), ("testing", "flask", 3),
    ("data", "database", 3), ("git", "git-commit", 2), ("onboarding", "users", 1), ("research", "search", 1), ("security", "shield", 1),
]''',
      '''CATEGORY_ICONS = [("infra", "box"), ("docs", "book-open"), ("review", "eye"), ("ops", "terminal"), ("testing", "flask"),
                  ("data", "database"), ("git", "git-commit"), ("onboarding", "users"), ("research", "search"), ("security", "shield")]
CATEGORIES = sorted(   # (key, icon, catalog count): derived from CATALOG, most skills first, an empty category has no tile
    [(k, ico, sum(1 for s in CATALOG if s["category"] == k)) for k, ico in CATEGORY_ICONS if any(s["category"] == k for s in CATALOG)],
    key=lambda c: (-c[2], c[0]))

def scope_skills(scope: str) -> list:
    """The Library's skills for a sidebar scope: Global is every skill on this machine; a project is the SKILLS its list references."""
    return list(SKILLS) if scope == "Global" else [s for s in SKILLS if s["project"] != "local" and scope in LIST_OF.get(s["name"], ())]

def derive_counts() -> None:
    for scope in ("Global", "Terum", "SSM", "MRF"):
        COUNTS[scope] = str(len(scope_skills(scope)))

derive_counts()''')

# ---- the scoped overview, bound once GLOBAL_SET exists ------------------------------------------------------------------------
p.rep('GLOBAL_SET = [k for k, v in LIST_OF.items() if "Global" in v]   # team.json\'s global[]: what a fresh machine places at its first sync (§6.1)',
      'GLOBAL_SET = [k for k, v in LIST_OF.items() if "Global" in v]   # team.json\'s global[]: what a fresh machine places at its first sync (§6.1)\n'
      '\n'
      'def library_overview(scope: str) -> dict:\n'
      '    """The four overview tiles for one sidebar scope, every number derived from that scope\'s skills (RM-16: the notes name facts\n'
      '    team.json and the people files carry; no date series exists)."""\n'
      '    skills = scope_skills(scope)\n'
      '    receipts = [receipt_of(s) for s in skills]\n'
      '    scored = [r for r in receipts if r is not None]\n'
      '    n, e = len(skills), len(scored)\n'
      '    verdicts = {v: sum(1 for r in scored if r["verdict"] == v) for v in ("PASS", "NEUTRAL", "FAIL")}\n'
      '    endorsed = len(GLOBAL_SET) if scope == "Global" else sum(1 for s in skills if "Global" in LIST_OF.get(s["name"], ()))\n'
      '    failing, updates, unscored = verdicts["FAIL"], sum(1 for s in skills if "update" in (s.get("flags") or [])), n - e\n'
      '    lines = [f"{plural(failing, \'failing eval\')}", f"{plural(updates, \'update\')} available", f"{unscored} not evaluated"]\n'
      '    return dict(\n'
      '        skills=str(n), skills_note=f"{endorsed} endorsed to Global" if scope == "Global" else f"{endorsed} also on Global",\n'
      '        evaluated=f"{e} of {n}", meter=dict(pass_=verdicts["PASS"], neutral=verdicts["NEUTRAL"], fail=verdicts["FAIL"], total=n),\n'
      '        meter_text=f"{verdicts[\'PASS\']} pass · {verdicts[\'NEUTRAL\']} neutral · {verdicts[\'FAIL\']} fail",\n'
      '        installs=str(sum(installs_of(s) for s in skills)), installs_note=f"across every people file · {TEAM_N} active teammates",\n'
      '        attention=str(failing + updates + unscored), attention_lines=lines, attention_link="Open alerts", zero=OVERVIEW_ZERO)\n'
      '\n'
      'OVERVIEW_BY_SCOPE = {scope: library_overview(scope) for scope in ("Global", "Terum", "SSM", "MRF")}\n'
      'LIBRARY_OVERVIEW = OVERVIEW_BY_SCOPE["Global"]')

# ---- Top rated expanded page: the whole catalog, so no "of" ------------------------------------------------------------------
p.rep('subtitle=f"{len(CATALOG)} of {CATALOG_N} skills · by installs, from people files"', 'subtitle=f"{CATALOG_N} skills · by installs, from people files"')

# ---- gates ---------------------------------------------------------------------------------------------------------------------
p.rep('''    total = sum(c[2] for c in CATEGORIES)
    if total != CATALOG_N:
        problems.append(f"category counts sum to {total}, not {CATALOG_N}")''',
      '''    total = sum(c[2] for c in CATEGORIES)
    if total != CATALOG_N:
        problems.append(f"category counts sum to {total}, not {CATALOG_N}")
    if CATALOG_N != len(CATALOG):
        problems.append(f"CATALOG_N is {CATALOG_N} but the catalog holds {len(CATALOG)} skills")
    for scope in ("Global", "Terum", "SSM", "MRF"):
        if COUNTS[scope] != str(len(scope_skills(scope))):
            problems.append(f"sidebar count for {scope} is {COUNTS[scope]!r}, the scope holds {len(scope_skills(scope))}")
        if int(OVERVIEW_BY_SCOPE[scope]["installs"]) != sum(installs_of(s) for s in scope_skills(scope)):
            problems.append(f"{scope} overview installs disagree with the scope's cards")
    for q in PROJECTS:
        if q["skills"] != list_size(q["name"]):
            problems.append(f'project {q["name"]} says {q["skills"]} skills, its list references {list_size(q["name"])}')''')

p.write()
