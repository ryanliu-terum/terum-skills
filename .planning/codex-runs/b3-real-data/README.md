# B3 — the reality proof (2026-09-12)

Every DTO B3 changed, taken from the **built** CLI (`dist/index.js`) driven over the frame protocol
against a real bare repo, a real clone and a real Library. Before this, no B3 DTO had been seen
coming out of a process: the batch's acceptance list calls that out by name.

The fixture: a three-member team (`mira`, `ravi`, `seed`), three published skills, one of them
published **twice** so `latest`, `versionCount` and a version-folder receipt are exercised by bytes
rather than asserted; one committed schema-2 receipt at `evals/<id>/v2/`; and a Library folder that
has never been published and carries **no managed fields at all** — §6.3's case.

What the frames show, and what each one proves:

| frame | proves |
| --- | --- |
| `ls.jsonl` | §8.4's `people[]` limb exists and is whole: handle, display_name, email, role, projects, `installed[]` (at `v2`), `profile[]`, `local_skills`, and D48's `authored[]`. `latest` is `Version 2`, `versionCount` is 2, `endorsement` is `project: Global`, and `unresolved` is gone |
| `status.jsonl` | `policy` is `{skill_license}` alone — §11.5's deletion, on the side the desktop mirrors non-passthrough |
| `search.jsonl` | a hit carries `Version N` and no `unresolved` |
| `eval-report-deploy-check.jsonl` | §6.4: `teamCurrent`/`evaluated` are `v2`, history is keyed by version folder, `fallbackFrom` is null when the current version has its own receipt |
| `ls-local.jsonl` | the never-published folder is an ordinary Library row |
| `publish-fresh.jsonl` | a first publish: `version: v1`, `created: true`, `identicalTo: null`, `projectAdded: true` |
| `publish-identical.jsonl` | a byte-identical republish: `version: null`, `created: false`, `identicalTo: v1` — §5.1 step 7's prefix strip is load-bearing and works on real bytes |
| `publish-unpublished.jsonl` | the same skill added to a project it was already in: nothing minted, nothing added, and the profile prompt answered yes |
| `ls-after-publish.jsonl` | the newly published folder appears with `Version 1`, and `people[].profile` carries the entry publish just wrote |

Recorded by `scripts/`-less ad-hoc drivers; the fixture is rebuilt from scratch each time, so these
files are evidence, not an input to any test.
