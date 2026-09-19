# Generated evals

A skill with no tests cannot be measured. Rather than report an empty verdict, `eval` writes the missing assets itself, into the skill folder, and tells you it did.

## When generation happens

Each asset kind is decided on its own, and only a missing kind is ever generated.

| Kind | Generated when |
| --- | --- |
| Execution assets, `evals/cases/*.yaml` or `evals/suite.yaml` | The folder holds no case file **and** no `evals/suite.yaml`. Which of the two is written is decided by the shape the generator returns. |
| `evals/triggers.yaml` | The folder holds no `evals/triggers.yaml`. |

`--no-gen` turns it off entirely. `--triggers-only` and `--execution-only` narrow which kinds the run wants at all, and generation follows.

A `suite.yaml` counts as an authored execution asset. Without that rule a suite-only skill would get three generated cases stacked on top of its suite.

Naming a case with `--case <stem>` never generates a case. If no authored file has that stem the run fails with `No eval case named <stem> for <name>.` before any model call, because naming a case asserts an authored expectation and generation does not rescue it. A missing `evals/triggers.yaml` is still generated: `--case` selects execution cases and says nothing about triggers.

There is no flag that forces regeneration. An asset that exists is yours to maintain.

## What gets generated

### The shape

One call asks for the execution assets, and the model decides what shape they take. It returns either one suite, `{"suite": ...}`, or a set of cases, `{"cases": [...]}`, and the validator refuses a response that is both or neither:

```
generated execution assets need exactly one of 'suite' or 'cases'
```

The prompt asks for a suite when the skill can be measured against a hidden ground truth it has to recover, and names three such worlds: a repository with planted defects for a skill that reviews or fixes code, a spec with planted contradictions for one that audits a document, a session log for one that summarises. It asks for cases when the skill's behaviour depends on how it is asked, `(flags, refusals, protocol steps, wrapping a command)`, one case per behaviour. When neither fits, it asks for cases that each carry a short `judge` rubric.

Frontmatter in your `SKILL.md` fixes the shape instead of leaving it to the model:

```yaml
metadata:
  eval:
    shape: suite
```

`suite` and `cases` are the only values. With one set, the prompt opens with `The shape is fixed: return {"suite": ...}.` and the validator refuses the other shape, which goes back to the model as a correction. Any other value fails before the model call:

```
Could not generate execution cases: SKILL.md metadata.eval.shape must be 'suite' or 'cases'. Retry the command or pass --no-gen.
```

Retrying that one does nothing, because the value the message objects to is in your folder rather than in the model's answer. Correct the frontmatter, or remove the key and let the generator choose.

### Cases

The generator chooses how many cases the skill needs, between 3 and 7 inclusive, from the skill's own complexity. The count is not a flag: if you want a specific number, edit `evals/cases/` afterwards. The bound is what makes a generator-chosen count safe, since it caps the bill and leaves the validator a hard numeric check.

Every generated case carries a `bucket`, and at least one case in the set must be `adversarial`. What the validator refuses is fixed: a count outside 3 to 7, a name that is not unique lowercase-hyphenated, a `fixture` key, a missing or off-list bucket, a check outside the whitelist, a body the case loader rejects, a `files` key the sandbox guard refuses, a `setup` that cannot start, and a set with no adversarial case.

A bucket is validated and then ignored. The generator's validator and the case loader both refuse a value outside the five, and nothing after that reads it: it is recorded in the file and never touched by scoring, so it is an authoring label for whoever reads the set later. The five read as:

| Bucket | The case asks |
| --- | --- |
| `explicit` | The user names the job the skill is for. |
| `implicit` | The user describes the job without naming it. |
| `contextual` | The right behaviour depends on the state of the sandbox rather than on the wording. |
| `negative` | The skill should hold back, or refuse, or do less than it could. |
| `adversarial` | The request pushes at the skill's rules, and the correct answer is not the obliging one. |

The generator is held to a narrower contract than an authored case. Checks may use only `transcript_mentions`, `transcript_omits`, `command_matching`, `no_command_matching`, `file_exists`, and `file_absent`. `command_succeeds` is excluded deliberately: it would make the generator author a verification program, and a wrong verifier silently corrupts the score in both arms. The other kinds are declarative and inspectable at a glance. A generated case may not carry a `fixture`, because there is no fixture tree for it to point at, so it seeds its sandbox with inline `files` and `setup` alone. Names must be lowercase and hyphenated, and unique.

A generated case may carry a `judge` rubric. The prompt asks for one in its third branch alone, for a skill whose output is judgment rather than a fact to be recovered, and the validator neither requires nor refuses the field. A case that carries one is still decided by its checks first and reaches the judge only on a tie. A generated suite never carries one, because `judge` is outside the suite key whitelist and no suite row is ever judged.

Before anything is written, every generated case is seeded once in a throwaway sandbox, exactly as an arm would seed it, with no skill staged: the `files` keys go through the same path guard, and `setup` is actually executed under `/bin/sh -ce`. That is the only way to catch prose in `setup`, because prose is valid shell. "Assume codex is logged in" runs a program named `Assume`, exits 127, and would have silently dropped the case at run time.

### Suites

A generated suite is a world with an answer key the skill has to find. The model returns five keys, and nothing else:

| Key | What it holds |
| --- | --- |
| `task` | One instruction, answerable with no human follow-up, that does not tell the agent what to look for. |
| `files` | The clean base, as a map of sandbox-relative path to full contents. It must be non-empty, and may not carry `.plants.diff` or anything under `.probes/`. |
| `plants_diff` | A unified diff over `files` that plants the defects and the one distractor. |
| `probes` | One one-line shell command per defect, keyed by a lowercase-hyphenated name, exiting 0 on the clean base and non-zero once the diff is applied. |
| `cases` | The rows. A `defect` row names its probe and checks `transcript_mentions`; the `distractor` row checks `transcript_omits`. |

The validator enforces the counts and the shape: between 2 and 6 defect rows, exactly one distractor row, unique lowercase-hyphenated row names, a non-empty check list per row, `transcript_mentions` on a defect and `transcript_omits` on a distractor and nothing else, a non-empty anchor on every check, a probe that exists for every defect, and no key beyond the five. A response that misses one is named for what it missed, for example `generated suite needs between 2 and 6 defect cases (got 7)` or `generated suite case 'swapped-args' uses a check outside the suite whitelist`.

The rest of the contract is asked for in the prompt and not checked by the engine: 3 to 6 source files in one language, defects spread across at least two files, nothing that needs a package install, a defect count below any finding cap your `SKILL.md` states, and an anchor that is an identifier or a `file:line` rather than prose the skill might paraphrase.

The model never writes shell that runs against an arm. The engine composes the suite's `setup` itself, and that setup is the suite's own self-check:

```sh
git init -q && git add -A -- . ':!.probes' ':!.plants.diff' && git -c user.name=t -c user.email=t@t commit -qm base
for p in .probes/*; do sh "$p" || exit 1; done
git apply .plants.diff
for p in .probes/*; do if sh "$p"; then exit 1; fi; done
rm -rf .probes .plants.diff
```

The clean base is committed without the probes and without the patch, every probe has to pass against it, the patch is applied, every probe has to fail after it, and both are deleted. An arm therefore opens on a repository whose only uncommitted change is the planted diff, with no probe and no patch left in the tree to read. A probe that disagrees with the diff makes `setup` exit non-zero, which drops the whole suite as `  suite: ABORTED (setup) — setup failed (rc=1): ...` and scores nothing, rather than scoring both arms against a defect that is not there.

Four things happen before a generated suite is written anywhere. The patch is checked with `git apply --check` against the files in a throwaway directory, and a patch that does not apply comes back as `plants_diff does not apply (rc=1): ...`, carrying git's own reason. The suite is materialized: the probes become `.probes/<name>.sh` and the patch becomes `.plants.diff` inside `files`, the engine's `setup` is added, `timeout_minutes: 120` and `requires: []` are set, and each row is reduced to its `name` and `checks`, so `kind` and `probe` do not reach the file. The result is loaded through the same loader an authored `evals/suite.yaml` goes through. Then the whole setup is run once in a throwaway sandbox, and a failure is reported as `generated suite dry run failed: ...`. Each of those is a correction the model gets a chance to fix.

### Triggers

Exactly five `should_trigger` prompts and exactly five `should_not_trigger` prompts, all non-empty. A near miss must be a plausible one drawn from the catalog the skill competes with, not an unrelated request, and the catalog is supplied to the model for exactly that reason.

The five-and-five rule is a generation rule. An authored `evals/triggers.yaml` may hold any number.

### Never generated

Fixtures are never generated. A generated case may not carry a `fixture` key, and `fixture` is outside a generated suite's five keys, so both seed their sandbox from inline `files` and from shell alone. `command_succeeds` is outside both whitelists for the same reason: a generated verifier that is wrong corrupts the score in both arms.

## The marker line

Every generated file opens with two YAML comment lines:

```
# generated by terum-skills eval-gen — review before trusting
# model: sonnet · engine: 0.20.1 · 2026-09-16T04:21:08.113Z
```

YAML comments survive the loaders untouched, and the header travels with the file if anyone copies it somewhere by hand.

## The model, and the call

Generation uses the run's own model, so `--model` covers it and the default is `sonnet`. The cost rides your subscription like every other token this product spends.

Each asset kind is one single-turn, tool-free call: `claude -p` with `--output-format json --max-turns 1 --disallowedTools '*' --setting-sources project --strict-mcp-config`, with the working directory pinned to a temporary directory. No tools, no sandbox, no skill staged.

The timeout is 300 seconds, raised from the 120-second default for tool-free calls because a 34 KB `SKILL.md` timed out three times at the lower value and produced no receipt at all.

A kind gets at most three model calls. A response that fails validation goes back with the validator's own error appended and a request for a corrected object. An infrastructure failure, such as a timeout or a non-zero exit, is not the model's to fix, so it is retried once with the prompt unchanged and then reported as itself, for example `model call timed out after 300000ms (twice, generating from a 34821-byte SKILL.md)`. A kind that never produces a usable answer fails the run:

```
Could not generate execution cases: generated cases need between 3 and 7 cases (got 9). Retry the command or pass --no-gen.
```

### What the model is shown

The full `SKILL.md`, frontmatter and body, unblinded. The candidate's file names, without their contents. For triggers, also the catalog of sibling skills in the same Library root, as `- name: description` lines.

Showing the whole skill is a deliberate accepted risk. A generator that reads the full text may write cases that reward restating the rulebook rather than doing the job. Nothing in the engine mitigates that. The safeguard is the same one authored cases get, which is that a person reads them.

### Hygiene on the generated bytes

Before the write-back, the generated files go through the HYG2 and HYG3 predicates with the folder's own author exemption, which is the same rule the next `validate`, `publish`, or `eval` will apply to them. A finding aborts and writes nothing:

```
The generated eval assets for my-skill failed hygiene, so nothing was written:
HYG3 evals/cases/seed-repo.yaml:6: Contains the email address sam@acme.io, …
This is a defect in generation, not in your skill. Run eval again to regenerate.
```

## Where the files land

Straight into your skill folder: `evals/cases/<name>.yaml`, `evals/suite.yaml`, and `evals/triggers.yaml`. The run also keeps its own copy under `<run dir>/generated/` for the record, and a generated suite runs from that copy in the same invocation that wrote it.

The write is staged and renamed. The files are written into a temporary directory beside the skill folder, then moved into place in one rename per asset: the cases first, then the suite, then the triggers. An interrupted run therefore leaves `evals/cases/` either absent or whole, never half-written, because a half-written directory would look authored to the next run and would ship on the next publish.

Three things block the write, one per asset, and each of them names the path:

```
/home/you/.claude/skills/my-skill/evals/cases already exists, so the generated eval cases were not written — a generated asset never overwrites an authored one. Rename or delete it, then run eval again.
```

```
/home/you/.claude/skills/my-skill/evals/suite.yaml already exists, so the generated eval suite was not written — a generated asset never overwrites an authored one. Rename or delete it, then run eval again.
```

The check asks the filesystem rather than the file list the run already read, because on a case-insensitive volume an authored `evals/Triggers.yaml` is invisible to a case-sensitive lookup and the write would have silently replaced its contents.

To regenerate, delete the asset and run `eval` again. Deleting `evals/cases/` or `evals/suite.yaml` regenerates the execution assets, and the shape is chosen again on that run, so cases can come back as a suite. Deleting `evals/triggers.yaml` regenerates the triggers.

## The line about a new version is wrong

Before it writes, `eval` prints this:

```
Writing generated evals/cases/ and evals/triggers.yaml into /home/you/.claude/skills/my-skill — they were missing, so this run made them. That changes the skill's content: the next publish mints a new version and the current local eval score blanks. To regenerate, delete evals/cases/ and run eval again.
```

The second sentence is not true, and it is a known defect in the product rather than a rule you should plan around.

`evals/` is excluded from the content digest that decides what a version is. Writing eval assets, generated or authored, cannot change that digest. So:

- The next publish does not mint a version because of them. If nothing else in the skill changed, publish writes the assets to `skills/<name>/evals/` and mints nothing.
- Receipts you already took of these bytes still match, because the digest they are keyed by has not moved. The local eval score does not blank.

Everything else in that line is accurate: the files were missing, the run made them, and deleting them is how you get new ones.

The last sentence names whichever asset this run wrote. A run that generated a suite ends with `To regenerate, delete evals/suite.yaml and run eval again.` instead.

## Review before you trust them

After the write, the run prints what ran and where its copy is:

```
eval assets: cases: generated (4) · triggers: generated
Generated assets: /home/you/.terum/skills/evals/local/<digest>/<run id>/generated — this run's copy, kept for the record; the skill folder now holds them too. Review before trusting them.
```

Read them before you lean on the verdict. Two things are worth checking first. Does each case test something the skill actually has to get right, or does it test that the skill's own vocabulary appears in the transcript? And is each `should_not_trigger` prompt a genuine near miss? Those are the two failure modes the generator has, and both are invisible in the verdict line.

A generated suite is announced under the same `cases:` label:

```
eval assets: cases: generated suite · triggers: generated
```

The label names the asset kind the run asked for, not the file it wrote. One suite landed at `evals/suite.yaml`, and it runs as one session per arm.

For a suite, three things are worth checking. Is each defect a bug a maintainer would fix, rather than a style preference? Is each anchor an identifier a correct finding has to cite, rather than a phrase the skill could reach by luck? And is the distractor genuinely correct code? A row that marks correct code as a defect turns every arm that reports it into a loss.

Once you are happy with them, publish the skill and the reviewed assets go to your team with it.

## Next

- [Test assets](test-assets.md) for the file formats and what you can write by hand.
- [How an eval works](overview.md) for what happens after the assets exist.
- [Hygiene checks](hygiene.md) for the gate the generated bytes pass through.
- [Versions and identity](../concepts/versions-and-identity.md) for what the content digest covers.
