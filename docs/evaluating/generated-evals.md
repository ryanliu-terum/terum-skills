# Generated evals

A skill with no tests cannot be measured. Rather than report an empty verdict, `eval` writes the missing assets itself, into the skill folder, and tells you it did.

## When generation happens

Each asset kind is decided on its own, and only a missing kind is ever generated.

| Kind | Generated when |
| --- | --- |
| `evals/cases/*.yaml` | The folder holds no case file **and** no `evals/suite.yaml`. |
| `evals/triggers.yaml` | The folder holds no `evals/triggers.yaml`. |

`--no-gen` turns it off entirely. `--triggers-only` and `--execution-only` narrow which kinds the run wants at all, and generation follows.

A `suite.yaml` counts as an authored execution asset. Without that rule a suite-only skill would get three generated cases stacked on top of its suite.

Naming a case with `--case <stem>` never generates a case. If no authored file has that stem the run fails with `No eval case named <stem> for <name>.` before any model call, because naming a case asserts an authored expectation and generation does not rescue it. A missing `evals/triggers.yaml` is still generated: `--case` selects execution cases and says nothing about triggers.

There is no flag that forces regeneration. An asset that exists is yours to maintain.

## What gets generated

### Cases

The generator chooses how many cases the skill needs, between 3 and 7 inclusive, from the skill's own complexity. A skill with one behaviour and one way to get it wrong wants 3. A skill with several distinct surfaces, decision branches, or refusal modes wants more, one case per thing that can independently go wrong. The count is not a flag: if you want a specific number, edit `evals/cases/` afterwards. The bound is what makes a generator-chosen count safe, since it caps the bill and leaves the validator a hard numeric check.

Every generated case carries a `bucket`, and at least one case in the set must be `adversarial`. A set larger than three is asked to spread across several buckets rather than repeat one, and that request is made in the prompt only. What the validator refuses is fixed: a count outside 3 to 7, a name that is not unique lowercase-hyphenated, a `fixture` key, a missing or off-list bucket, a check outside the whitelist, a body the case loader rejects, a `files` key the sandbox guard refuses, a `setup` that cannot start, and a set with no adversarial case.

A bucket is validated and then ignored. The generator's validator and the case loader both refuse a value outside the five, and nothing after that reads it: it is recorded in the file and never touched by scoring, so it is an authoring label for whoever reads the set later. The five read as:

| Bucket | The case asks |
| --- | --- |
| `explicit` | The user names the job the skill is for. |
| `implicit` | The user describes the job without naming it. |
| `contextual` | The right behaviour depends on the state of the sandbox rather than on the wording. |
| `negative` | The skill should hold back, or refuse, or do less than it could. |
| `adversarial` | The request pushes at the skill's rules, and the correct answer is not the obliging one. |

The generator is held to a narrower contract than an authored case. Checks may use only `transcript_mentions`, `transcript_omits`, `command_matching`, `no_command_matching`, `file_exists`, and `file_absent`. `command_succeeds` is excluded deliberately: it would make the generator author a verification program, and a wrong verifier silently corrupts the score in both arms. The other kinds are declarative and inspectable at a glance. A generated case may not carry a `fixture`, because there is no fixture tree for it to point at, so it seeds its sandbox with inline `files` and `setup` alone. Names must be lowercase and hyphenated, and unique.

Generated cases carry no `judge` rubric: the shape the generator is asked to return has no `judge` field, so a generated set is decided entirely by its checks.

Before anything is written, every generated case is seeded once in a throwaway sandbox, exactly as an arm would seed it, with no skill staged: the `files` keys go through the same path guard, and `setup` is actually executed under `/bin/sh -ce`. That is the only way to catch prose in `setup`, because prose is valid shell. "Assume codex is logged in" runs a program named `Assume`, exits 127, and would have silently dropped the case at run time.

### Triggers

Exactly five `should_trigger` prompts and exactly five `should_not_trigger` prompts, all non-empty. A near miss must be a plausible one drawn from the catalog the skill competes with, not an unrelated request, and the catalog is supplied to the model for exactly that reason.

The five-and-five rule is a generation rule. An authored `evals/triggers.yaml` may hold any number.

### Never generated

Suites are hand-authored only. There is no generator for `evals/suite.yaml`, so a skill that wants one session scored many times gets it by writing the file. Fixtures, judge rubrics, and `command_succeeds` checks are likewise not generated.

## The marker line

Every generated file opens with two YAML comment lines:

```
# generated by terum-skills eval-gen — review before trusting
# model: sonnet · engine: 0.20.0 · 2026-09-16T04:21:08.113Z
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

Straight into your skill folder: `evals/cases/<name>.yaml` and `evals/triggers.yaml`. The run also keeps its own copy under `<run dir>/generated/` for the record.

The write is staged and renamed. The files are written into a temporary directory beside the skill folder, then moved into place in one rename per asset, cases first. An interrupted run therefore leaves `evals/cases/` either absent or whole, never half-written, because a half-written directory would look authored to the next run and would ship on the next publish.

Two things block the write, and each of them names the path:

```
/home/you/.claude/skills/my-skill/evals/cases already exists, so the generated eval cases were not written — a generated asset never overwrites an authored one. Rename or delete it, then run eval again.
```

The check asks the filesystem rather than the file list the run already read, because on a case-insensitive volume an authored `evals/Triggers.yaml` is invisible to a case-sensitive lookup and the write would have silently replaced its contents.

To regenerate, delete the asset and run `eval` again. Deleting `evals/cases/` regenerates the cases. Deleting `evals/triggers.yaml` regenerates the triggers.

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

## Review before you trust them

After the write, the run prints what ran and where its copy is:

```
eval assets: cases: generated (4) · triggers: generated
Generated assets: /home/you/.terum/skills/evals/local/<digest>/<run id>/generated — this run's copy, kept for the record; the skill folder now holds them too. Review before trusting them.
```

Read them before you lean on the verdict. Two things are worth checking first. Does each case test something the skill actually has to get right, or does it test that the skill's own vocabulary appears in the transcript? And is each `should_not_trigger` prompt a genuine near miss? Those are the two failure modes the generator has, and both are invisible in the verdict line.

Once you are happy with them, publish the skill and the reviewed assets go to your team with it.

## Next

- [Test assets](test-assets.md) for the file formats and what you can write by hand.
- [How an eval works](overview.md) for what happens after the assets exist.
- [Hygiene checks](hygiene.md) for the gate the generated bytes pass through.
- [Versions and identity](../concepts/versions-and-identity.md) for what the content digest covers.
