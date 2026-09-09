"""AL · the New skill CTA is Connect (Teddy's A3, 2026-09-08; applied on Ryan's Mac for M7 batch S7q).

RECONSTRUCTED 2026-09-09 on Teddy's box from the repo record (`.planning/codex-runs/m7-S7q/NOTES.md`: "two anchors: `view_header`'s
default action label and LibraryEmpty's primary") and the app's rendered strings (Library header button "Connect", LibraryEmpty
primary "Connect"); Ryan's original file never reached the repo. Both anchors must occur exactly once. The LibraryEmpty body
sentence stays as drawn (Ryan kept it when Codex reworded it).
Run: python3 .patches/patch_al.py   (then: python3 build.py; ./render.sh)."""
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


p = Patch("AL · New skill → Connect (reconstructed)")
# view_header's default action label
p.rep('action: tuple | None = ("New skill", "plus"),', 'action: tuple | None = ("Connect", "plus"),')
# LibraryEmpty's primary CTA
p.rep('''                                  "New skill", "Open marketplace",''', '''                                  "Connect", "Open marketplace",''')
p.write()
