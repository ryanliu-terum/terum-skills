# installed-state notes

- Re-recorded 2026-09-13 from fixture.sh (layout 3) by record.sh with the CLI at f2089dd; kept as-is: real-data-check-ls.jsonl and real-data-check-ls-local.jsonl (genuine captures of Ryan's own machine — his real team, skills and the gsa-* folders under his ~/.claude/skills; no fixture reproduces them and no desktop test reads them). The other six frames are recordings.
- Provenance of the nulls: before the layout-3 re-key (commit b721cc5) every `ls --local` row and `status` ledger entry for placement `11111111-1111-4111-8111-111111111111` carried the synthetic tree hash `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; §3.4 maps a 40-hex version to null, so the re-key's `"v1"` / `(Version 1)` was invented and is now `null` / no ordinal.
