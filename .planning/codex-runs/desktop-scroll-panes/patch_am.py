"""AM · Settings ▸ Account GitHub row is tool presence only (Teddy's D-BM-2 = A, 2026-09-08; RM-45; applied on Ryan's Mac for M7 batch S7k).

RECONSTRUCTED 2026-09-09 on Teddy's box from the repo record (`.planning/codex-runs/m7-S7k/NOTES.md`: "rewrites the row's 'ok' state
to `git present · gh present` with a description that says authentication is not checked") and the app's own strings
(`desktop/src/screens/settings/SettingsContent.tsx`, Row title="GitHub"). Ryan's original file never reached the repo. The "out"
and "absent" states of gh_status_row are left as drawn (the app renders one quiet value naming the absent tool; no board draws it).
Run: python3 .patches/patch_am.py   (then: python3 build.py; ./render.sh)."""
import pathlib

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


p = Patch("AM · GitHub row presence only (reconstructed)")
p.rep('''        ctl = status_value(t, "ok", f'Signed in as {MACHINE["gh_login"]}') + button(t, "Open gh", kind="ghost", ico="external-link", state=button_state)
        desc = f'Through the GitHub CLI (gh {MACHINE["gh_version"]}). Creating a team or inviting needs it; joining and syncing use the git credentials this machine already has.\'''',
      '''        ctl = status_value(t, "ok", "git present · gh present") + button(t, "Open gh", kind="ghost", ico="external-link", state=button_state)
        desc = "Tool presence only; authentication is not checked. Creating a team or inviting needs gh; joining and syncing use the git credentials this machine already has."''')
p.write()
