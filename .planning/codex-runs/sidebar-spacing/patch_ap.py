"""AP · the app's sidebar spacing, adopted into the canvas (Teddy, 2026-09-10: "adopt the spacing of the realistic
mock to the application").

The oracle is the single-file realistic build `terum-skills-mock-realistic.html` (2026-09-09). Its inlined CSS carries
exactly five sidebar deltas against the build it came from:

    .sidebar-inner{...gap:26px;...padding:28px 8px 0;...}
    .sidebar-inner>.nav-group:nth-child(2){margin-top:56px}
    .nav-group{flex-direction:column;gap:4px;display:flex}
    .nav-row{...height:34px;...}

The app side landed in `desktop/src/styles/app.css`; this patch moves the same five numbers into the canvas so the
boards can be redrawn and the fidelity rows re-locked.

ROW_H is deliberately NOT changed: `settings_nav_row` shares it (the app's Settings nav stays 28px), and
`desktop/tools/export-design.py` exports it into the generated `desktop/src/fixtures/design.json` LAYOUT block. The
sidebar gets its own constants instead, which the exporter does not read.

Run, from the canvas checkout:   python3 patch_ap.py /path/to/design/terum-skills
                        or:      TERUM_DESIGN_DIR=/path/to/design/terum-skills python3 patch_ap.py
                        or:      copy it into the canvas's .patches/ and run it there.
Then:  python3 build.py  &&  python3 fit_check.py  &&  ./render.sh --all
       (oracles for the fidelity gate must be re-rendered on the maintainer's Mac via render-mac.mjs — see NOTES.md.)

This file is written by the implementing agent and run only by a maintainer; it is never run from this repository.
"""
import os
import pathlib
import sys


def locate_build() -> pathlib.Path:
    """argv[1], then $TERUM_DESIGN_DIR, then a copy sitting in .patches/ or in the canvas root."""
    here = pathlib.Path(__file__).resolve().parent
    tried = []
    for base in (sys.argv[1] if len(sys.argv) > 1 else None, os.environ.get("TERUM_DESIGN_DIR"), here.parent, here):
        if base is None or base == "":
            continue
        path = pathlib.Path(base).expanduser()
        build = path if path.name == "build.py" else path / "build.py"
        tried.append(str(build))
        if build.is_file():
            return build.resolve()
    raise SystemExit(
        "patch_ap: no build.py found. Pass the design canvas directory as the first argument, or set "
        "TERUM_DESIGN_DIR.\n  tried: " + "\n         ".join(tried)
    )


BUILD = locate_build()


class Patch:
    """Anchor-asserting patcher (the house style of .patches/patch_an.py): a stale anchor aborts before any write."""

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
        if BUILD.read_text(encoding="utf-8") != self.src:
            raise SystemExit(f"[{self.name}] write verification failed: {BUILD}")
        print(f"patch applied: {self.name} ({self.n} replacements) -> {BUILD}")


p = Patch("AP · sidebar spacing from the realistic mock")

# ---- the sidebar's own numbers. ROW_H stays 28 (settings_nav_row shares it; design.json exports it) ---------------
# The anchor carries the following FONT line so a second run of this patch fails here instead of duplicating the block.
p.rep("TOPBAR_H, SIDEBAR_W, ROW_H, SECTION_H, NEST_INDENT = 40, 240, 28, 24, 24\nFONT = ",
      "TOPBAR_H, SIDEBAR_W, ROW_H, SECTION_H, NEST_INDENT = 40, 240, 28, 24, 24\n"
      "# Sidebar spacing adopted from the realistic mock build (Teddy, 2026-09-10). ROW_H stays 28: settings_nav_row\n"
      "# shares it and tools/export-design.py exports it into design.json's LAYOUT block.\n"
      "SIDEBAR_ROW_H, SIDEBAR_GROUP_GAP, SIDEBAR_STACK_GAP, SIDEBAR_TOP_PAD, TEAM_GROUP_GAP = 34, 4, 26, 28, 56\n"
      "FONT = ")

# ---- one sidebar row: 28 -> 34 (this anchor is nav_row's; settings_nav_row's ROW_H reads "height: {ROW_H}px; padding: 0 8px;")
p.rep("gap: 8px; height: {ROW_H}px; padding: 0 8px 0 {pad_left}px; ",
      "gap: 8px; height: {SIDEBAR_ROW_H}px; padding: 0 8px 0 {pad_left}px; ")

# ---- the stack: 16 -> 26 between the groups, 4 -> 28 above the first ----------------------------------------------
p.rep('      <div style="display: flex; flex-direction: column; gap: 16px; flex-grow: 1; min-height: 0; padding: 4px 8px 0 8px; box-sizing: border-box;">\n',
      '      <div style="display: flex; flex-direction: column; gap: {SIDEBAR_STACK_GAP}px; flex-grow: 1; min-height: 0; padding: {SIDEBAR_TOP_PAD}px 8px 0 8px; box-sizing: border-box;">\n')

# ---- 1 -> 4 inside each group; the Team group also carries the 56px margin (the app's nth-child(2) rule) ----------
p.rep('        <div style="display: flex; flex-direction: column; gap: 1px;">\n          {section_header(t, "Library"',
      '        <div style="display: flex; flex-direction: column; gap: {SIDEBAR_GROUP_GAP}px;">\n          {section_header(t, "Library"')
p.rep('        <div style="display: flex; flex-direction: column; gap: 1px;">\n          {section_header(t, "Team")}',
      '        <div style="display: flex; flex-direction: column; gap: {SIDEBAR_GROUP_GAP}px; margin-top: {TEAM_GROUP_GAP}px;">\n          {section_header(t, "Team")}')

p.write()
