"""AQ · the seven error boards follow the ratified app (Teddy, 2026-09-13: "go through all error cards on the desktop and fix
their fidelity and rendering"). Every change below mirrors a decision already recorded in desktop/FIDELITY.md's
"Deliberate deviations" or a ratified spec; none is new design:

  1. sidebar Team row reads Members, not Share (Ryan, 2026-09-10; the board key stays "Share").
  2. the Library view header has no Connect action (ratified override, ajay 2026-09-10, library-mirror-id-sync spec).
  3. the marketplace search bar draws no filter button (Ryan, 2026-09-10); the popover boards still pass `popover`.
  4. ShareError body stops asserting an invented cause (desktop 72aaf87: "The message below is the CLI's own.").
  5. MarketplaceError title/body likewise (FIDELITY.md 2026-09-09 interim copy; ASSUMPTION: Teddy's final copy is the app's).
  6. SkillDetailError crumbs draw only the ref: the app has no team/category when the read fails (research
     2026-09-08 "fabricated crumbs"), so the canvas stops drawing terum / infra.
  7. Settings nav reads Team and Publishing (desktop d883689 / bad2f5c, library-marketplace-refactor spec); the two
     section heads follow.
Run: python3 .patches/patch_aq.py   (then: python3 build.py; python3 fit_check.py; ./render.sh)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from patchlib import Patch

p = Patch("AQ")
# 1. Members
p.rep('{nav_row(t, "Share", "users", selected=s("Share"))}', '{nav_row(t, "Members", "users", selected=s("Share"))}')
# 2. no Connect action by default (Members passes its Invite action explicitly)
p.rep('ico: str = "globe", action: tuple | None = ("Connect", "plus"),', 'ico: str = "globe", action: tuple | None = None,')
# 3. no filter button by default
p.rep('placeholder="Search skills, people and projects", popover: str = "", filter: bool = True) -> str:',
      'placeholder="Search skills, people and projects", popover: str = "", filter: bool = False) -> str:')
# 4. ShareError copy
p.rep('"terum-skills could not read the people files in the team clone, so this page shows nothing rather than a stale roster. Sync again, or check the clone in Settings.",',
      '"terum-skills could not read the team roster, so this page shows nothing rather than a stale one. The message below is the CLI&#39;s own.",')
# 5. MarketplaceError copy
p.rep('centered_state(t, "alert", "Couldn&#39;t reach the team repo",\n'
      '                                              "terum-skills could not pull terum/team-skills, so this page shows nothing rather than a stale catalog. Check your network and git credentials, then sync again.",',
      'centered_state(t, "alert", "Couldn&#39;t read the marketplace",\n'
      '                                              "terum-skills could not read the team catalog, so this page shows nothing rather than a stale catalog. The message below is the CLI&#39;s own.",')
# 6. SkillDetailError crumbs = the ref alone
p.rep('    parts = [dim(s.get("root", "Global")), dim(s["project"]), dim(s["category"]),\n'
      '             f\'<span style="font-size: 13px; font-weight: 510; color: {t["text1"]}; white-space: nowrap;">{s["name"]}</span>\']',
      '    name = f\'<span style="font-size: 13px; font-weight: 510; color: {t["text1"]}; white-space: nowrap;">{s["name"]}</span>\'\n'
      '    parts = [name] if crumbs == "name" else [dim(s.get("root", "Global")), dim(s["project"]), dim(s["category"]), name]')
p.rep('    return shell(t, detail_header(t, DETAIL, rail_open=False) + f\'<div style="display: flex; flex-grow: 1; min-height: 0;">{body}</div>\')',
      '    return shell(t, detail_header(t, DETAIL, rail_open=False, crumbs="name") + f\'<div style="display: flex; flex-grow: 1; min-height: 0;">{body}</div>\')')
# 7. Settings nav + heads
p.rep('SETTINGS_NAV = [("Account", "user"), ("Teams", "users"),', 'SETTINGS_NAV = [("Account", "user"), ("Team", "users"),')
p.rep('("Inbox", "inbox"), ("Evals", "flask"), ("Sharing", "upload"),', '("Inbox", "inbox"), ("Evals", "flask"), ("Publishing", "upload"),')
p.rep('settings_head(t, "Teams", "The teams this machine', 'settings_head(t, "Team", "The teams this machine')
p.rep('settings_head(t, "Sharing", "The skills you author', 'settings_head(t, "Publishing", "The skills you author')
p.write()
