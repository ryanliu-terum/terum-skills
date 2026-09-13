# mock-vs-real-2026-09-09 notes

- Re-recorded 2026-09-13 from fixture.sh (layout 3) by record.sh with the CLI at f2089dd; kept as-is: none — all 21 frames are recordings (status-json.jsonl is the same plain `status` run: the verb has no --json flag; update.jsonl was recorded offline against the fixture's local bare remote, so it reports no release observation).
- Provenance of the nulls: before the layout-3 re-key (commit b721cc5) every `ls --local` row and `status` ledger entry for placement `11111111-1111-4111-8111-111111111111` carried the fixture tree hash `43bf7396d9edbdcfba751bc63dbe1c74055125ae`; §3.4 maps a 40-hex version to null, so the re-key's `"v1"` / `(Version 1)` was invented and is now `null` / no ordinal. No fixture.sh is committed for this set.
