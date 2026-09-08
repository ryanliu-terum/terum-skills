"""AK · design-side strings (Teddy's 2026-09-08 design-strings decision walk, applied by the M7 launch overseer on Ryan's Mac, 2026-09-08).

Closes, as one patch: D14's 28 mechanical wording rows (CP-01, CP-04, CP-05, CP-06, CP-O4, RM-43, CP-08, CP-10, CP-12, CP-27, CP-34,
CP-44, CP-46, CP-42, CP-17, CP-45, EV-20, EV-21, CP-18, CP-22, CP-36, TJ-13, TJ-O2, CP-32, CP-S2, CP-S6, CP-O2, RM-16, RM-14),
CP-19's three refused commands, D11 (CP-O1 boot follows a join that already asked), D13 (CP-S5 Settings error is the CLI's real
message with a tilde) and D17 (CP-03's three honest strings). Every replacement names an anchor that must occur exactly once (or
`count` times) in the live build.py, so a stale anchor aborts before anything is written. Values verified against the costing §3.2
and the walk; where a row left Teddy a choice, the walk's ledger value is taken and the alternative is named in a comment.

Deliberately NOT applied here (recorded for the PR body): CP-08's two inventory JSON files are not on this machine; CP-10 (d)'s
generic disclosure gate; CP-12's second (person-bucket) gate, refuted as vacuous; CP-46's version VALUE change and per-detail ids
(D14 locks "identical output": the hoist and the gate only); RM-43 (6) neutral command form (BRIEF.md:32 / CP-33 keep npx);
CP-O1's Share→Connect tab relabel (the product noun Share is Teddy's, GAPS.md:11); TJ-O2 (3) Settings ▸ Teams Join gate (a board
drawing, not a string); CP-S5's second wrap specimen on the states sheet; D9/D10's eleven new boards.
Run: python3 .patches/patch_ak.py   (then: python3 build.py; node render-mac.mjs; npm run export in desktop/)."""
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


p = Patch("AK · design-side strings")

# ---- CP-01 · SkillDetailRemove: the per-skill verb, no scope promise, the decline suppression named ----------------------------
p.rep('''    d = dialog(t, "Remove deploy-check from Global?",
               "Its files leave ~/.claude/skills on this machine and your people file stops listing it. The team copy stays, and you can install it again any time.",
               primary="Remove", primary_kind="danger", command=cli("uninstall deploy-check"))''',
      '''    d = dialog(t, "Remove deploy-check?",
               "Its files leave ~/.claude/skills on this machine and your people file stops listing it. Because the team endorses it, your people file also records that you declined it, so sync stops offering it back; installing it again clears that.",
               primary="Remove", primary_kind="danger", command=cli(f"uninstall-skill {skill_ref(DETAIL)}"))''')

# ---- CP-04 · SkillDetailQuality: the verb is connect; validate's six callers ---------------------------------------------------
p.rep("Hygiene checks · passed on share, 12 days ago · free, no model calls", "Hygiene checks · passed on connect, 12 days ago · free, no model calls")
p.rep('prefix="Runs on share, publish and in CI"', 'prefix="Runs on connect, publish, sync and in CI"')

# ---- CP-05 + TJ-O2 (1) · the join-block captions say what the CLI's trailing paragraph says (invite.ts slackBlock) -------------
p.rep('INVITE_TIP = "GitHub emails the invitation; the block runs the joiner&#39;s wizard"',
      'INVITE_TIP = "GitHub emails the invitation; the block runs the joiner&#39;s wizard"\n'
      'JOIN_BLOCK_NOTE = ("GitHub emails the invitation. The block runs the joiner&#39;s wizard: with gh signed in it accepts the pending invitation, "\n'
      '                   "otherwise it asks them to accept it in the browser, and git must have access to this repository.")   # invite.ts:54, spec §6 :339')
p.rep('''small(t, "GitHub emails the invitation; this runs the joiner&#39;s wizard, which accepts it and offers the Global set.")''',
      '''small(t, JOIN_BLOCK_NOTE)''')
p.rep('''f"{INVITE_TIP}, which accepts the invitation and offers the Global set."''', '''JOIN_BLOCK_NOTE''')
p.rep('''"Invite teammates by their GitHub login. GitHub emails each one, and the join block runs the wizard that offers them the team&#39;s Global set.",''',
      '''"Invite teammates by their GitHub login. GitHub emails each one; the join block runs the wizard, which accepts the pending invitation with gh signed in and otherwise asks them to accept it in the browser.",''')
p.rep('''"""The Slack-ready block `invite` prints: the joiner's wizard, which accepts the invitation and offers the Global set (build spec §6.1)."""''',
      '''"""The Slack-ready block `invite` prints: the joiner's wizard, which accepts the pending invitation with gh signed in or asks them to accept it in the browser (invite.ts slackBlock; build spec §6.1)."""''')

# ---- CP-06 + CP-O4 + RM-43 + CP-19 · placeholders, the dead `share` verb, the variadic invite operand ---------------------------
p.rep('terminal_hint(t, cli("install &lt;skill&gt;"), prefix="From the terminal")', 'terminal_hint(t, cli("install &lt;ref&gt;"), prefix="From the terminal")')
p.rep('''BASICS_HINT = {"Manage": cli("install &lt;skill&gt;"), "Eval": cli(f'eval {SKILLS[0]["name"]} --commit'), "Share": cli("share"),''',
      '''BASICS_HINT = {"Manage": cli("install &lt;ref&gt;"), "Eval": cli(f'eval {SKILLS[0]["name"]} --commit'), "Share": cli("connect"),''')
p.rep('cli(f"share ~/.claude/skills/{LOCAL_UNSHARED[0]}")', 'cli(f"connect ~/.claude/skills/{LOCAL_UNSHARED[0]}")')
p.rep('"share adds license, id and author to your SKILL.md, after showing the three lines and asking."',
      '"connect adds license, id and author to your SKILL.md, after showing the three lines and asking."')
p.rep("of 6 checks passed on share: frontmatter", "of 6 checks passed on connect: frontmatter")
p.rep("installed it from {who}\\'s share before this proposal", "installed it from {who}\\'s connect before this proposal")
p.rep('cli("invite &lt;github-login&gt;")', 'cli("invite &lt;github-login&gt;...")', count=2)
p.rep("invites, a first share, the session hook", "invites, a first connect, the session hook")
p.rep('''    """The one spelling of every printed command (phase-1 spec: `npx -y terum-skills@latest …`, -y so a first-run machine never stalls on npx's prompt)."""''',
      '''    """The boards' one spelling of every printed command: the npx form (`npx -y terum-skills@latest …`, -y so a first-run machine never stalls on npx's
    prompt). The CLI itself prints two forms (bare `terum-skills` when the PATH bin is a global install, npx otherwise; src/lib/invocation.ts); the app
    has no launch evidence, so every board keeps the npx form (BRIEF.md:32, CP-33)."""''')

# ---- CP-10 · every page that prints a universe count discloses the sample it renders -------------------------------------------
p.rep('subtitle: str | None = "30 skills"', 'subtitle: str | None = "15 of 30 skills"')
p.rep('subtitle=f"{CATALOG_N} skills · by installs, from people files"', 'subtitle=f"{len(CATALOG)} of {CATALOG_N} skills · by installs, from people files"')
p.rep('''subtitle=f"{plural(n, 'skill')} · category from SKILL.md frontmatter · by installs"''',
      '''subtitle=f"{len(category_skills(key))} of {plural(n, 'skill')} · category from SKILL.md frontmatter · by installs"''')

# ---- CP-12 · a person's buckets sort by installs; the categories index gate (edit order: bucket first) --------------------------
p.rep('''    return [(name, [s for s in mine if LIST_OF[s["name"]][0] == name]) for name in ["Global"] + [q["name"] for q in PROJECTS] if any(LIST_OF[s["name"]][0] == name for s in mine)]''',
      '''    return [(name, sorted((s for s in mine if LIST_OF[s["name"]][0] == name), key=lambda s: -installs_of(s))) for name in ["Global"] + [q["name"] for q in PROJECTS] if any(LIST_OF[s["name"]][0] == name for s in mine)]''')
p.rep('''        problems.append("top rated is not sorted by installs")''',
      '''        problems.append("top rated is not sorted by installs")
    cat_counts = [c[2] for c in CATEGORIES]
    if cat_counts != sorted(cat_counts, reverse=True):
        problems.append('the categories index is not sorted by count, but its label says "Most skills"')''')

# ---- CP-27 · one skill, one category; the inbox cross-check gate ---------------------------------------------------------------
p.rep('dict(kind="share", name="secret-scan", origin="terum", category="infra", days=1,', 'dict(kind="share", name="secret-scan", origin="terum", category="security", days=1,')
p.rep('''    if [it["days"] for it in INBOX] != sorted(it["days"] for it in INBOX):
        problems.append("items are not newest first")''',
      '''    if [it["days"] for it in INBOX] != sorted(it["days"] for it in INBOX):
        problems.append("items are not newest first")
    for it in INBOX:   # CP-27: an item that names a catalog skill carries that skill's category, never a second one
        s = SK.get(it["name"]) or next((x for x in MARKET_EXTRA if x["name"] == it["name"]), None)
        if s and it.get("category") and it["category"] != s["category"]:
            problems.append(f'{it["title"]}: category {it["category"]!r} disagrees with the catalog ({s["category"]!r})')''')

# ---- CP-34 + CP-44 · no ref to a team this machine never joined; skill_ref reads the configured remote -------------------------
p.rep('used_by=["AP", "RL", "TZ"], users=[], repo="mrf/team-skills", path="skills/migration-guard"', 'used_by=["AP", "RL", "TZ"], users=[], path="skills/migration-guard"')
p.rep('''    """The self-locating three-part ref <org>/<repo>/<skill>: it carries its own repository, so a pasted command works on a machine with no local config."""
    repo = s.get("repo") or f'{s["origin"]}/team-skills\'''',
      '''    """The self-locating three-part ref <owner>/<repo>/<skill>. The repository is READ from the team's configured remote (config.teams[<team>].remote →
    githubOwnerRepo; schema.ts:72, remote.ts:192), never built from a team, project or list name: `team create` ASKS for it and merely suggests
    `<team>-shared-skills`, and a joiner's local team name IS the repository basename (phase-1-build.md:333). `project` is a LIST key, not a GitHub owner."""
    repo = s.get("repo") or TEAM_REPO''')

# ---- CP-46 · the displayed version and the tree hash are named constants (values unchanged: D14 locks identical output) --------
p.rep('''DETAIL = dict(
    SKILLS[0],''',
      '''DEPLOY_CHECK_V = "5f0e12ab9c3d"                                       # the DISPLAYED version: the first 12 of the tree hash (eval-engine.md:491)
DEPLOY_CHECK_V40 = "5f0e12ab9c3d4e7ab1f28a6d0c3e9b47d2f1a8c0"           # git rev-parse HEAD:skills/deploy-check (readme.ts:119); unrelated to metadata.id
# CP-46: the sample version happens to be a slice of SKILL_MD_ID; the costing's fix re-mints it as 7ad3f1c05e92. D14 (2026-09-08) locked the
# hoist with identical output, so the value stays until a design session re-renders every board that prints it.

DETAIL = dict(
    SKILLS[0],''')
p.rep('version="5f0e12ab9c3d", version_full="5f0e12ab9c3d4e7ab1f28a6d0c3e9b47d2f1a8c0"', 'version=DEPLOY_CHECK_V, version_full=DEPLOY_CHECK_V40')
p.rep('dict(when="8 days ago", runner="ajay", version="5f0e12ab9c3d", wlt=(11, 3, 4), rows=None)', 'dict(when="8 days ago", runner="ajay", version=DEPLOY_CHECK_V, wlt=(11, 3, 4), rows=None)')
p.rep('("RL", "<b>ryan</b> pushed 5f0e12ab9c3d · checklist.md, scripts/verify.sh", "12 days ago")', '("RL", f"<b>ryan</b> pushed {DEPLOY_CHECK_V} · checklist.md, scripts/verify.sh", "12 days ago")')
p.rep('         version="5f0e12ab9c3d", sessions=14, on_target=9,', '         version=DEPLOY_CHECK_V, sessions=14, on_target=9,')
p.rep('fact="ajay · 18 rounds · 11W 3L 4T · v 5f0e12ab9c3d"', 'fact=f"ajay · 18 rounds · 11W 3L 4T · v {DEPLOY_CHECK_V}"')
p.rep('dict(DETAIL, kind="author", days=9, actor=None, author=AJAY, scope="Global", version="5f0e12ab9c3d", installs_n=12,',
      'dict(DETAIL, kind="author", days=9, actor=None, author=AJAY, scope="Global", version=DEPLOY_CHECK_V, installs_n=12,')

# ---- CP-42 · where Governance went -----------------------------------------------------------------------------------------------
p.rep('SETTINGS_NAV = [', "# 'Sharing ▸ Governance' from the source sketch is this: Team policy, read-only, changed by PR (settings_teams' policy card).\nSETTINGS_NAV = [")

# ---- CP-17 · the record cell spells itself in the CLI's order (W L T) ------------------------------------------------------------
p.rep('        record = f"{w}–{ti}–{l}"', '        record = f"{w}W–{l}L–{ti}T"')
p.rep('''f'<span style="width: 56px; text-align: right; font-family: {MONO}; font-size: 12px; color: {t["text1"]}; font-variant-numeric: tabular-nums; flex-shrink: 0;">{record}</span>\'''',
      '''f'<span style="width: 76px; text-align: right; font-family: {MONO}; font-size: 12px; color: {t["text1"]}; font-variant-numeric: tabular-nums; flex-shrink: 0;">{record}</span>\'''')
p.rep("{iw}–{it_}–{il} against the installed version.')", "{iw}W–{il}L–{it_}T against the incumbent.')")

# ---- CP-45 · one wording per fact: "Not evaluated" (skill), "No receipt for <version> yet" (version), "Never" (date slot) ----------
p.rep('empty = centered_state(t, "chart", "No receipt yet",', 'empty = centered_state(t, "chart", "Not evaluated",')
p.rep('evaluated = "Never · no receipt" if rc is None else', 'evaluated = "Never" if rc is None else')
p.rep('''ev = rp_bold(t, "Not evaluated yet;") + (''', '''ev = rp_bold(t, f'No receipt for {it["version"]} yet;') + (''')

# ---- EV-20 · the history rail shows one receipt's numbers; older rows are listed, never compared (eval-engine §12) ---------------
p.rep('''def history_row(t, h, *, state="default") -> str:
    """state: default | hover | selected | focus (selected + focus compose: bg4 plus the ring). The selected fill is stronger, so the
    quiet 12px text (runner · version, and a greyed partial number) steps from text3 up to text2 — the sidebar's rule for counts."""
    r = receipt_of(h)
    selected = state in ("selected", "focus")
    bg = t["bg4"] if selected else (t["bg3"] if state == "hover" else "transparent")
    ring = f" box-shadow: 0 0 0 2px {t['accent']};" if state == "focus" else ""
    quiet = t["text2"] if selected else t["text3"]
    color = figure_color(t, r)
    if color == t["text3"]:
        color = quiet
    fraction = f'<span style="font-weight: 400; margin-left: 4px;">{r["partial"][0]}/{r["partial"][1]}</span>' if r.get("partial") else ""
    return (f'<div style="display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-radius: 6px; background: {bg};{ring}">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">'
            f'<span style="font-size: 13px; font-weight: 500; color: {t["text1"]};">{h["when"]}</span>'
            f'<span style="font-size: 12px; font-weight: 510; color: {color}; font-variant-numeric: tabular-nums;">{lift_number(r["lift"])}{fraction}</span></div>'
            f'<span style="font-size: 12px; color: {quiet}; font-family: {MONO}; white-space: nowrap;">{h["runner"]} · {h["version"]}</span>'
            f'{row_strip(t, h["rows"])}</div>')''',
      '''def history_row(t, h, *, state="default") -> str:
    """state: default | showing. Rows are not interactive (EV-20, eval-engine §12: the page never puts two receipts' numbers side by side):
    only the row whose receipt the page renders ("showing", the newest) carries its figure, partial fraction and strip; every other row
    keeps when and runner · version. The showing fill is stronger, so its quiet 12px text steps from text3 up to text2 — the sidebar's rule."""
    r = receipt_of(h)
    showing = state == "showing"
    bg = t["bg4"] if showing else "transparent"
    quiet = t["text2"] if showing else t["text3"]
    color = figure_color(t, r)
    if color == t["text3"]:
        color = quiet
    fraction = f'<span style="font-weight: 400; margin-left: 4px;">{r["partial"][0]}/{r["partial"][1]}</span>' if r.get("partial") else ""
    figure = f'<span style="font-size: 12px; font-weight: 510; color: {color}; font-variant-numeric: tabular-nums;">{lift_number(r["lift"])}{fraction}</span>' if showing else ""
    strip = row_strip(t, h["rows"]) if showing else ""
    return (f'<div style="display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-radius: 6px; background: {bg};">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">'
            f'<span style="font-size: 13px; font-weight: 500; color: {t["text1"]};">{h["when"]}</span>{figure}</div>'
            f'<span style="font-size: 12px; color: {quiet}; font-family: {MONO}; white-space: nowrap;">{h["runner"]} · {h["version"]}</span>'
            f'{strip}</div>')''')
p.rep('rows = "".join(history_row(t, h, state="selected" if i == 0 else "default") for i, h in enumerate(s["history"]))',
      'rows = "".join(history_row(t, h, state="showing" if i == 0 else "default") for i, h in enumerate(s["history"]))')
p.rep('"One row per committed run, newest first. The page renders the latest run for this version; older runs are kept, never merged."',
      '"One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged."')
p.rep('''hist = [cell(f"history row · {st}", f'<div style="width: 210px;">{history_row(t, DETAIL["history"][1], state=st)}</div>') for st in ("default", "hover", "selected", "focus")]
    hist.append(cell("history row · partial run · selected", f'<div style="width: 210px;">{history_row(t, DETAIL_PARTIAL["history"][0], state="selected")}</div>'))''',
      '''hist = [cell(f"history row · {st}", f'<div style="width: 210px;">{history_row(t, DETAIL["history"][1 if st == "default" else 0], state=st)}</div>') for st in ("default", "showing")]
    hist.append(cell("history row · partial run · showing", f'<div style="width: 210px;">{history_row(t, DETAIL_PARTIAL["history"][0], state="showing")}</div>'))''')

# ---- EV-21 · per-round decided_by specimens; the counted-attribution prose goes (no receipt field carries it) ---------------------
p.rep('''        cell("History strip cell · hovered", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge, both orderings"), span=2),''',
      '''        cell("History strip cell · hovered · decided by checks (the common case)", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by checks"), span=2),
        cell("… · decided by judge", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge, both orderings"), span=2),
        cell("… · judge-split", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge-split, both orderings"), span=2),
        cell("… · opponent-run-failed", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by opponent-run-failed"), span=2),''')
p.rep('(net lift +0.44, p = {P_BASE}; 12 rounds settled by checks, 2 by judge). Against the incumbent ', '(net lift +0.44, p = {P_BASE}). Against the incumbent ')
p.rep('''f"baseline the candidate won 5, lost 0, and tied 2 of 7 scored rounds (net lift +0.71, p = {P_PARTIAL}; 4 rounds settled by checks, "
                                           "1 by judge) (Fig. 2). no-rollback carries both unscored rounds (Table 1).",''',
      '''f"baseline the candidate won 5, lost 0, and tied 2 of 7 scored rounds (net lift +0.71, p = {P_PARTIAL}) (Fig. 2). "
                                           "no-rollback carries both unscored rounds (Table 1).",''')

# ---- CP-18 · ShareError keeps Invite; Find members has no facet control ------------------------------------------------------------
p.rep('return shell(t, view_header(t, "Members", None, ico="users", action=None)', 'return shell(t, view_header(t, "Members", None, ico="users", action=("Invite", "user-plus"))')
p.rep('''                  placeholder="Search skills, people and projects", popover: str = "") -> str:''',
      '''                  placeholder="Search skills, people and projects", popover: str = "", filter: bool = True) -> str:''')
p.rep('''            f'{filter_button(t, active=active, state="pressed" if popover else "default")}{popover}</div>')''',
      '''            f'{filter_button(t, active=active, state="pressed" if popover else "default") if filter else ""}{popover}</div>')''')
p.rep('{market_search(t, width=None, placeholder="Find members")}', '{market_search(t, width=None, placeholder="Find members", filter=False)}')
p.rep("Invite, Find members with the filter control, and the roster with the invitation last.", "Invite, Find members (no facets: the product's only filter popover filters skills), and the roster with the invitation last.")

# ---- CP-22 + CP-36 · the two error boards name the failure that is drawn and the remedy that exists --------------------------------
p.rep('''                          "The team repo did not answer, so what is here may be stale. Check your connection or the token in Settings, then try again.",
                          "Try again", "Open settings",
                          error_line(t, "fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"))''',
      '''                          "The team repo did not answer, so what is here may be stale. Check your network and your git access to the repository, then try again.",
                          "Try again", "Copy error",
                          error_line(t, ONBOARD_FETCH_ERROR))''')
p.rep('''                                  "terum-skills could not open the skills folder. Check the path in Settings, then try again.",
                                  "Try again", "Open settings",
                                  error_line(t, "ENOENT: no such file or directory, scandir '~/.terum/skills'")),''',
      '''                                  "terum-skills could not read ~/.terum/skills. Check the folder still exists and is readable, then try again.",
                                  "Try again", "Show in Finder",
                                  error_line(t, "EACCES: permission denied, scandir '~/.terum/skills'")),''')

# ---- TJ-13 · the count is installs over every people file, archived members included: tense, not noun -----------------------------
p.rep('''detail_row(t, "Installs", f'{s["installs_n"]} teammate{"" if s["installs_n"] == 1 else "s"}'),''', '''detail_row(t, "Installs", str(s["installs_n"])),''')
p.rep('''label=f'{n} teammate{"" if n == 1 else "s"} use{"s" if n == 1 else ""} this\'''', '''label=f'{n} teammate{"" if n == 1 else "s"} ha{"s" if n == 1 else "ve"} installed this\'''')
p.rep('>Used by {s["installs_n"]} teammates</span>', '>Installed by {s["installs_n"]} teammates</span>')
p.rep('''cell("“12 teammates use this” · hovered", f'<div style="width: 300px;">{facepile(t, s["used_by"], 12, label="12 teammates use this", hovered=True''',
      '''cell("“12 teammates have installed this” · hovered", f'<div style="width: 300px;">{facepile(t, s["used_by"], 12, label="12 teammates have installed this", hovered=True''')
p.rep('''label=f'{DETAIL["installs_n"]} teammates use this')''', '''label=f'{DETAIL["installs_n"]} teammates have installed this')''')
p.rep("TEAM_N = 12                 # teammates (install counts come from their people files, so none exceeds 12)",
      "TEAM_N = 12                 # active teammates. Install counts come from EVERY people file, archived members included (readme.ts:35), so a count may exceed this")
p.rep('''f'{f["installs_min"]} teammates', f["installs_min"] / TEAM_N))''', '''f'{f["installs_min"]} teammates', min(1, f["installs_min"] / TEAM_N)))''')

# ---- TJ-O2 (2) · the joiner's invitation gate, in the CLI's words, on the states sheet -----------------------------------------------
p.rep('''              cell("logins · rejected (invite&#39;s line)", box(text_field(t, INVITEE, width=240, error=f"Could not invite @{INVITEE} (GitHub status 403). GitHub caps invitations at 50 per repository per day."), 240))]''',
      '''              cell("logins · rejected (invite&#39;s line)", box(text_field(t, INVITEE, width=240, error=f"Could not invite @{INVITEE} (GitHub status 403). GitHub caps invitations at 50 per repository per day."), 240)),
              cell("join gate · the browser hand-off (team.ts:492)", box(ob_error_line(t, f"Accept the invitation at https://github.com/{TEAM_REPO}/invitations before continuing."), ONBOARD_W), span=3),
              cell("join gate · the blocking confirm (team.ts:493)", box(ob_error_line(t, "Continue after accepting the invitation? (y/N) · on no: Invitation acceptance was declined."), ONBOARD_W), span=3)]''')

# ---- CP-32 · the release-probe disclosure, corrected on timing and sources ---------------------------------------------------------
p.rep('''setting_row(t, "Release notice", "One line after a command when a newer release is advertised. Silenced by the CI or NO_UPDATE_NOTIFIER environment variables, not from here.", value_text(t, "On", quiet=True)),''',
      '''setting_row(t, "Release notice", "One line after a command when a newer release is advertised or observed, at most once a day per release. Silenced by the CI, NO_UPDATE_NOTIFIER or TERUM_SKILLS_NO_UPDATE_NOTIFIER environment variables, not from here.", value_text(t, "On", quiet=True)),''')
p.rep('''setting_row(t, "Release probe", "Reads release tags from github.com/ryanliu-terum/terum-skills at sync. Runs no package manager and reads no registry.", value_text(t, "GitHub tags", quiet=True)),''',
      '''setting_row(t, "Release probe", "Reads release tags from github.com/ryanliu-terum/terum-skills on an interactive sync, at most once a day, and whenever you run update — never from the session hook or a prune, and only while a team on this machine lives on GitHub. It runs no package manager and makes no registry request; a copy launched with npx also reads that cache&#39;s @latest entry, which can be the newer of the two.", value_text(t, "GitHub tags", quiet=True)),''')

# ---- CP-S2 · config.json is the ledger, not disposable ------------------------------------------------------------------------------
p.rep('''"~/.terum/skills · config, team clones, cache, quarantine, run stamps, eval runs. Safe to delete: nothing in it is team truth, and placed skills stay on disk."''',
      '''"~/.terum/skills · config, team clones, cache, quarantine, run stamps, eval runs. Nothing in it is team truth. The clones, cache and run stamps are disposable — setup and team join rebuild them. config.json is not: delete it and every skill Terum placed goes invisible to the tool (no ledger entry, so sync neither refreshes nor adopts those folders and install refuses their targets until you re-install each one with --force), every tool approval is asked again, every connected skill&#39;s baseline is lost, and your handle, email and display name are re-asked."''')

# ---- CP-S6 · the Leave dialog lists what team leave does -------------------------------------------------------------------------------
p.rep('''    extra = bullet_list(t, [f'Its placed skills leave ~/.claude/skills and the project checkouts on this machine ({COUNTS["Global"]} global, {PLACEMENTS_N - int(COUNTS["Global"])} in checkouts)',
                            f'The clone at {q["clone"]} and this team&#39;s entry in config.json',
                            "Your people file in the team repo stays: you remain a member, and setup brings this machine back"])''',
      '''    extra = bullet_list(t, [f'Its placed skills leave ~/.claude/skills and the project checkouts on this machine ({COUNTS["Global"]} global, {PLACEMENTS_N - int(COUNTS["Global"])} in checkouts) — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill&#39;s authoring source is left where it is',
                            f'The clone at {q["clone"]} and this team&#39;s entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead',
                            "Its connected skill records and any pending operations on this machine",
                            "This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so",
                            f'Your people file in the team repo stays: you remain a member (an admin archives that with team remove {ME["handle"]}), and setup brings this machine back'])''')
p.rep('"Removes its placed skills, the clone and this entry here. You stay a member; run setup again to come back."',
      '"Removes its placed skills, the clone and this entry here, and the session-start hook when this was the last team. You stay a member; run setup again to come back."')

# ---- CP-O2 · the Done card names the hook and where its answer shows -------------------------------------------------------------------
p.rep('''Sharing and the Marketplace are in the sidebar; evals live on each skill&#39;s page.")''',
      '''Sharing and the Marketplace are in the sidebar; evals live on each skill&#39;s page. The Claude Code session-start hook is set up by `setup` in the terminal; Settings ▸ Sync shows this machine&#39;s answer.")''')

# ---- RM-16 · the overview tiles carry no time series and name their populations ---------------------------------------------------------
p.rep('''    skills="30", skills_delta="+3 this month",''',
      '''    skills="30", skills_note="7 endorsed to Global",   # RM-16: no committed date on a skill (schema.ts:43-51); a fact from team.json's global[] instead (gated in check_onboarding)''')
p.rep('''    installs="148", installs_delta="+9 this week · 12 teammates · last 12 weeks", sparkline=[4, 6, 3, 8, 5, 9, 7, 11, 8, 12, 10, 9],''',
      '''    installs="148", installs_note="across every people file · 12 active teammates",   # RM-16: installed[].since is restamped by install and sync, so no honest series exists; both populations named''')
p.rep('''            stat_tile(t, "Skills", o["skills"], delta_line(t, "arrow-up-right", t["good"], o["skills_delta"])),''',
      '''            stat_tile(t, "Skills", o["skills"], small(t, o["skills_note"])),''')
p.rep('''            stat_tile(t, "Team installs", o["installs"],
                      delta_line(t, "arrow-up-right", t["good"], o["installs_delta"])
                      + sparkline(t, o["sparkline"]), grow=2),''',
      '''            stat_tile(t, "Team installs", o["installs"], small(t, o["installs_note"]), grow=2),''')

# ---- RM-14 · the card line is PROJECT membership: the sample key is `project` (values unchanged) --------------------------------------------
p.rep('origin="', 'project="', count=22)
p.rep('{s["origin"]} / {s["category"]}', '{s["project"]} / {s["category"]}')
p.rep('dim(s["origin"])', 'dim(s["project"])')
p.rep('CATALOG = [s for s in SKILLS if s["origin"] != "local"] + MARKET_EXTRA   # local skills are not shared, so the marketplace never lists them',
      'CATALOG = [s for s in SKILLS if s["project"] != "local"] + MARKET_EXTRA   # `project` is the team.json list the skill is endorsed on (or the machine-local "local", RM-14): local skills are not shared, so the marketplace never lists them')
p.rep('LOCAL_UNSHARED = [s["name"] for s in SKILLS if s["origin"] == "local"]', 'LOCAL_UNSHARED = [s["name"] for s in SKILLS if s["project"] == "local"]')
p.rep('''f'{SKILLS[0]["origin"]} / {SKILLS[0]["category"]} · skill\'''', '''f'{SKILLS[0]["project"]} / {SKILLS[0]["category"]} · skill\'''')

# ---- CP-O1 (D11) · the boot follows a join that already asked: status rows, no placement counter, the one interruption drawn -------------
p.rep("ONBOARD_PLACED = 4                    # placements written so far on the boot board, of len(GLOBAL_SET)",
      "BOOT_STEPS = 4                        # the boot board's status rows: found, fetched, nothing new to place, recording (the join already asked; CP-O1 shape a, D11)")
p.rep('''    if not 0 < ONBOARD_PLACED < len(GLOBAL_SET):
        problems.append("the boot board places the whole Global set, or none of it")
''',
      '''    if not LIBRARY_OVERVIEW["skills_note"].startswith(f"{len(GLOBAL_SET)} "):
        problems.append("the Library's Skills tile note disagrees with the Global set (RM-16)")
''')
p.rep('''def boot_rows(t, *, failed=False) -> list:
    n = len(GLOBAL_SET)
    if failed:
        return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("failed", f"Couldn&#39;t fetch {TEAM_REPO}", "not reached"),
                ("pending", "Placing the team&#39;s Global set into ~/.claude/skills", f"0 of {n}"), ("pending", "Recording the sync", "")]
    return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("done", f"Fetched {TEAM_REPO}", "main"),
            ("current", "Placing the team&#39;s Global set into ~/.claude/skills", f"{ONBOARD_PLACED} of {n}"), ("pending", "Recording the sync", "run/terum.stamp")]''',
      '''def boot_rows(t, *, failed=False) -> list:
    """Status rows for a boot that FOLLOWS a join which already asked (CP-O1 shape a, D11): nothing is placed unattended, so there is no
    placement counter. The one question sync can still ask (an upstream grant change, sync.ts:190) is drawn as a possible interruption."""
    if failed:
        return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("failed", f"Couldn&#39;t fetch {TEAM_REPO}", "not reached"),
                ("pending", "Nothing new to place", ""), ("pending", "Recording the sync", "")]
    return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("done", f"Fetched {TEAM_REPO}", "main"),
            ("done", "Nothing new to place", "the join placed the Global set"), ("current", "Recording the sync", "run/terum.stamp"),
            ("pending", "Approve updated tools for &lt;skill&gt;? · asked only when a grant changed upstream", "")]''')
p.rep("progress_card(t, boot_rows(t), placed=ONBOARD_PLACED, total=len(GLOBAL_SET)),", "progress_card(t, boot_rows(t), placed=3, total=BOOT_STEPS),")
p.rep("progress_card(t, boot_rows(t, failed=True), placed=0, total=len(GLOBAL_SET), failed=True)", "progress_card(t, boot_rows(t, failed=True), placed=1, total=BOOT_STEPS, failed=True)")
p.rep('''("current", "Placing the team&#39;s Global set into ~/.claude/skills", f"{ONBOARD_PLACED} of {len(GLOBAL_SET)}"),''',
      '''("done", "Nothing new to place", "the join placed the Global set"), ("pending", "Approve updated tools for &lt;skill&gt;? · asked only when a grant changed upstream", ""),''')
p.rep("progress_bar(t, ONBOARD_PLACED, len(GLOBAL_SET))", "progress_bar(t, 3, BOOT_STEPS)")
p.rep("progress_bar(t, 0, len(GLOBAL_SET), failed=True)", "progress_bar(t, 1, BOOT_STEPS, failed=True)")

# ---- CP-S5 (D13) · the Settings error is the CLI's real line, the home directory abbreviated under one app-wide rule; error lines wrap ---
p.rep('''error_line(t, "SyntaxError: Unexpected token } in JSON at position 412 · ~/.terum/skills/config.json")''',
      '''error_line(t, "Invalid ~/.terum/skills/config.json: Expected property name or &#39;}&#39; in JSON at position 412 (line 14 column 3)")''')   # config.ts:37-38, V8 >= 22.12; the tilde is the app's home-abbreviation rule (D13), applied to every CLI message the app renders
p.rep('''            f'font-family: {MONO}; font-size: 12px; color: {t["text3"]}; white-space: nowrap;">{text}</div>')''',
      '''            f'font-family: {MONO}; font-size: 12px; color: {t["text3"]}; max-width: 100%; overflow-wrap: anywhere; text-align: left; box-sizing: border-box;">{text}</div>')''')

# ---- CP-03 (D17) · the project-install copy says when and where the skills land -----------------------------------------------------------
p.rep('''    body = (f'Adds the project&#39;s {n} skills to your people file. They are placed into the repo&#39;s .claude/skills the next time you sync inside a checkout '
            f'of {q["remote"]}; nothing is copied until then.')''',
      '''    body = (f'Adds the project&#39;s {n} skills to your people file and places them into this repo&#39;s .claude/skills. Run it inside a checkout '
            f'of {q["remote"]} — from anywhere else it exits and copies nothing.')''')
p.rep('"Placed when you sync in the repo"', '"Placed by install project, inside a checkout of this repo"', count=2)

p.write()
