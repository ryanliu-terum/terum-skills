# Test assets

A skill's tests live inside the skill folder, in `evals/`.

```
my-skill/
  SKILL.md
  references/…
  evals/
    cases/<stem>.yaml      one execution case per file; the stem is the case name
    suite.yaml             optional; one shared session, many scored rows
    triggers.yaml          optional; should_trigger / should_not_trigger
    fixtures/<name>/…      sandbox seed trees, referenced by a case or the suite
```

Discovery is exact. Cases are `evals/cases/*.yaml` and `*.yml`, sorted by filename. The suite is exactly `evals/suite.yaml`. Triggers are exactly `evals/triggers.yaml`, looked up case-sensitively. `evals/fixtures/` is a convention, not a rule: a `fixture:` value is any directory path relative to the file that names it.

## How eval assets travel

Three facts about `evals/` follow from one design decision, and they are worth knowing before you write anything into it.

**The skill never sees them.** When an arm's sandbox is seeded, the skill tree is copied to `.claude/skills/<name>/` with the top-level `evals` and `fixtures` directories filtered out. The skill must not see its own answer key.

**They do not identify the skill.** `evals/` is skipped by the content digest that decides what a version is. Adding, changing, or generating eval assets cannot mint a new version and cannot invalidate a receipt taken of the same skill text.

**They are mutable in the team repo.** Every publish writes every `evals/**` file to `skills/<name>/evals/…`, outside the immutable `v<N>/` folders, add or modify, never remove. That is how an eval-only change reaches your team: publish the skill again, and the assets land even though no version is minted.

## Case files

One case per file under `evals/cases/`. The file stem is the case name, and there is no `name:` field.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `task` | string | Yes | The prompt handed to the agent. It must be answerable with no human in the loop. A case that fails to give a `task` is refused with `case '<name>' needs a 'task'`. |
| `checks` | list | No | Deterministic assertions. A value that is not a list becomes an empty list. Kinds are not validated at load; an unknown kind fails when it runs. |
| `judge` | string | No | A short rubric. Only a case carrying one can ever reach the LLM judge, and only on a check tie. |
| `files` | map of path to string | No | Inline files written into the sandbox before `setup`. Must be a map. Values are coerced to strings. |
| `fixture` | string | No | A directory copied into the sandbox first, resolved relative to the directory the file lives in. For a case that is `evals/cases/`, so a fixture under `evals/fixtures/` is `../fixtures/<name>`. A missing or non-directory path drops the case. |
| `setup` | string | No | POSIX shell run by `/bin/sh -ce` in the sandbox, after `files` and before the skill is staged. 60 second cap. A non-zero exit drops the case. |
| `bucket` | enum | No | One of `explicit`, `implicit`, `contextual`, `negative`, `adversarial`. Recorded in the file and never read by scoring. An unknown value is refused. |
| `requires` | list of strings | No | Host tools probed before any agent run. See [environment skips](#environment-skips). |
| `timeout_minutes` | number | No | The per-arm session cap. Must be above 0 and at most 120. Defaults to 120. |
| `max_turns` | integer | No | The session's turn cap. Must be a positive integer. Defaults to 200. |

Unknown keys are ignored rather than refused.

### Sandbox paths

Keys in `files` are sandbox-relative. Three shapes are refused, at generation time and again at run time: an absolute path, any path containing a `..` segment, and any path whose first real segment is `.claude`. The last one matters because the agent runs with `--setting-sources project` and the sandbox is the project, so a case that could write `.claude/settings.json` could run its own hooks on your machine.

A file whose name ends `.sh`, or whose first path segment is `bin`, is written with mode 0755. That is how a case stubs an external tool.

### Check kinds

A check is either a bare string, or a single-key map of kind to argument. Anything else fails with `unrecognized check spec`, an unknown kind fails with `unknown check kind '<k>'`, and a bad argument such as an invalid regex fails with `malformed check: …`. A check never errors the run.

| Kind | Argument | Passes when |
| --- | --- | --- |
| `transcript_mentions` | string | The string appears in the transcript, case-insensitively. |
| `transcript_omits` | string | It does not. |
| `command_matching` | regex | Some Bash command in the transcript matches. |
| `no_command_matching` | regex | None does. The failure detail lists up to three hits. |
| `file_exists` | sandbox-relative path | The path exists in the sandbox after the session. |
| `file_absent` | sandbox-relative path | It does not. |
| `command_succeeds` | shell | `/bin/sh -ce <arg>` in the sandbox exits 0, within 120 seconds. |

"The transcript" for the two text checks means the result text, every text block, and the JSON of every tool call's input. Tool inputs are searchable, so a check can assert on what the agent passed to a tool, not only on what it said.

A path that resolves outside the sandbox fails the check with `path escapes the sandbox`, and that includes `file_absent`, where the file is trivially absent. Containment beats literal semantics.

Checks are all-or-nothing per arm. An arm passes a case only if every check passes. Two arms passing different subsets are equal and fall through to the judge or to a tie.

`command_succeeds` cannot appear in a generated case. See [generated evals](generated-evals.md).

### A minimal case

```yaml
task: do it
```

That is valid. It runs both arms and ties every row, because with no checks both arms pass vacuously and there is no rubric.

A real one:

```yaml
task: Handle an unsafe deployment request.
checks:
  - file_absent: .env.leaked
bucket: adversarial
```

One that stubs an external tool so the case can test a branch that depends on outside state:

```yaml
task: Check codex login before running.
files:
  bin/codex: |
    #!/bin/sh
    test "$1 $2" = "login status" && echo "Logged in"
setup: export PATH="$PWD/bin:$PATH" && codex login status | grep -q "Logged in" && touch made.txt
checks: [{ transcript_mentions: "Logged in" }]
bucket: contextual
```

### Write tasks an unattended agent can finish

Every arm is told, identically, that no human can answer questions. A headless agent that stops to ask one dies silently and scores as a skill failure, so a task phrased as an unconditional incantation ("every report MUST start with the literal line X") reads as prompt injection, makes a cautious agent balk, and measures nothing. Phrase conventions as natural practice.

## Trigger files

`evals/triggers.yaml` holds two optional lists of prompts.

```yaml
should_trigger: ["a"]
should_not_trigger: ["b", "c"]
```

Both lists are optional, entries are coerced to strings, and an absent list is empty. There is no count requirement on an authored file: the eval runs exactly as many selection calls as the file holds, in order, should-trigger first. Invalid YAML is refused with `invalid triggers.yaml: …`.

The exactly-five-and-five rule applies to generated files only.

A `should_not_trigger` prompt earns its keep by being a plausible near miss drawn from the catalog your skill actually competes with. An unrelated request proves nothing, because nothing would have fired on it.

## Suite files

`evals/suite.yaml` exists for the case where one session can answer many questions. The engine runs one agent session per arm per repetition, and scores every sub-case against that single transcript. Ten planted defects become ten independently decided rows from two sessions rather than twenty.

A suite is hand-authored only. There is no generator for `evals/suite.yaml`, and no flag that asks for one.

The top level takes the same fields a case does, and `task` is required in exactly the same way. `fixture` is resolved relative to `evals/`, not `evals/cases/`, because that is where the file lives. `checks`, `judge`, and `bucket` are parsed at the top level and then discarded: checks belong to the sub-cases, and a suite is never judged, so a check tie on a sub-case is always an ordinary no-rubric tie.

`cases` must be a non-empty list. Each entry is a map carrying exactly two things:

| Field | Rule |
| --- | --- |
| `name` | Required, non-empty, unique within the suite. It is the row's name in the receipt. |
| `checks` | Required, and must be a list. Kinds are validated when they run, as everywhere else. |

A sub-case carrying any of `judge`, `task`, `files`, `fixture`, `setup`, or `bucket` is refused by name, for example `suite 'suite': sub-case must not carry 'judge'`. Everything a sub-case would need from those fields belongs to the shared session.

A minimal suite:

```yaml
task: x
cases:
  - name: unknown
    checks: []
```

The suite's own name is the file stem, so it is always `suite`. That is the name its transcripts, its skip line, and the receipt's case list use. The sub-case names are what appear as rows.

### What suite rows mean

Because every row comes from one shared session, each sub-case's arm sample carries that session's turn, duration, and cost figures. The per-arm means therefore still equal the session's own cost. The sign test, on the other hand, is pinned at 1.0 for any receipt containing suite rows, because rows from one session are not independent observations, and a p-value that pretended otherwise would be false precision.

If a session dies, every sub-case row for that arm is unscored at once.

### `--case` skips the suite

`--case <stem>` addresses authored case files only. A suite session can run to two hours per arm, and a named case is an authored assertion about one file, so the two do not mix:

```
Skipping evals/suite.yaml: --case my-case names an authored case; the suite runs only in a full run.
```

Naming a stem that no authored case file has fails with `No eval case named <stem> for <name>.`, and never falls back to generation.

## The worked example in this repository

`.claude/skills/hybrid-review/evals/` is a real authored suite.

```yaml
task: Use the hybrid-review skill to review the uncommitted diff in this repository before I commit it. Report every defect you find with the file and identifier.
fixture: fixtures/review-repo
setup: |
  git init -q && git add -A -- . ':!.plants.txt' && git -c user.name=t -c user.email=t@t commit -qm base
  git apply .plants.txt && rm .plants.txt
requires: [codex]
timeout_minutes: 120
cases:
  - name: broken-contract-applydiscount
    checks: [{ transcript_mentions: "applyDiscount" }]
  - name: swapped-clamp-args-cart
    checks: [{ transcript_mentions: "clamp" }]
  - name: off-by-one-isoverdue
    checks: [{ transcript_mentions: "isOverdue" }]
  - name: unchecked-null-resolveterms
    checks: [{ transcript_mentions: "resolveTerms" }]
  - name: stale-percent-us-tx
    checks: [{ transcript_mentions: "US-TX" }]
  - name: distractor-roundhalfup
    checks: [{ transcript_omits: "roundHalfUp" }]
```

The fixture at `evals/fixtures/review-repo/` is a small dependency-free Node ESM repository: `package.json`, five modules that call each other, and a test runner. Beside them sits `.plants.txt`, a `git diff` patch carrying five defects across five files, including one broken caller contract, plus one distractor, a correct decimal-shift `roundHalfUp` that reads odd at a glance.

The `setup` line is the interesting part. It commits the clean base with the patch file excluded by pathspec, applies the patch as uncommitted working-tree edits, and deletes the patch. When the agent starts, `git diff` in the sandbox is exactly the planted defects, and the patch is in neither the commit, the index, nor the worktree. The sub-case names, which are the answer key, live in `evals/`, which is never staged.

Each defect is one row, anchored on an identifier a real finding has to cite. The distractor is one row in the other direction: naming `roundHalfUp` is a false positive, so the row passes by omission. Together they measure precision as well as recall, which a set of `transcript_mentions` checks alone cannot do.

The task names the skill on purpose. On the first proof run a task that only said "review the diff" was answered inline by the candidate arm without ever invoking the skill, so nothing about the skill was measured. The baseline arm has no such skill to invoke and reviews however it likes. That is the comparison.

`requires: [codex]` is what keeps this suite honest on a machine that cannot run it: the whole suite is skipped and reported rather than run to a both-arms-flail tie.

## Environment skips

`requires` entries take two forms: a bare binary name, probed with `command -v`, or `python3:<module>`, probed with an import. Values are passed as arguments, never interpolated into a shell string. Each probe has a 30 second cap, generous enough that startup contention on a loaded machine cannot fake a missing tool.

The probes run before any agent session. If anything is missing, no session runs at all:

```
  suite: SKIPPED (environment) — missing codex
```

Those rows are never produced, so they widen the gap between expected and scored rows and grey the verdict. That is the point. A missing toolchain must never look like "the skill does not help".

## Naming rules

A case's name is its file stem. A suite's sub-case names must be unique within the suite, and must not collide with any authored case file stem:

```
suite 'suite': sub-case name 'review-diff' collides with authored case name
```

Generated case names have a stricter rule of their own. See [generated evals](generated-evals.md).

## Next

- [How an eval works](overview.md) for arms, decisions, and the verdict.
- [Generated evals](generated-evals.md) for what happens when `evals/` is empty.
- [Running an eval](running-evals.md) for the flags.
- [Versions and identity](../concepts/versions-and-identity.md) for why `evals/` sits outside the digest.
