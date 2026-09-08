# terum-skills

Share private Claude Code skills across a team through one private git repo. No server.

Every skill lives once in a git repository your team owns. Members install copies into their Claude Code skill folders, a session-start hook keeps those copies current, and every change is an ordinary git commit with an author. Skills can carry evals, and a committed eval receipt is what a `publish` PR has to show before the team endorses a skill.

## Quick start

Requires Node 22.12+ and `git`. Creating a team on GitHub also needs an authenticated GitHub CLI (`gh auth login`).

Create a team (first person):

```sh
npx -y terum-skills@latest setup
```

Join a team you were invited to (`invite` prints this exact line for you to paste):

```sh
npx -y terum-skills@latest setup <org>/<repo>
```

Install one skill from a teammate's command, even before you have set anything up:

```sh
npx -y terum-skills@latest install <org>/<repo>/<skill>
```

The wizard asks before every write: which team, which skills to connect, whether to add the session-start hook. Re-run `setup` to resume. Prefer a bare `terum-skills` command? `npm install -g terum-skills`.

## Commands

| Group | Command | What it does |
|---|---|---|
| Team | `setup [<org>/<repo>]` | Create-or-join wizard; sequences the verbs below |
| | `login` | Check `gh` and record your name, email, and handle |
| | `team create` / `team join` / `team leave` / `team remove <handle>` | Manage the repo and its roster |
| | `invite <github-user>…` | Grant repo access and print the join line |
| | `ls [--local]` / `status` / `search <term>` | Read the team, your local skills, or the catalog |
| Skills | `connect [<path>]` | Put a local skill folder in the team repo and keep your later edits synced |
| | `install <ref>` / `uninstall-skill <ref>` | Place or remove a skill (`member <handle>` and `project <name>` install whole lists) |
| | `sync` | Pull, finish pending installs, mirror connected edits, refresh placed copies |
| | `publish <skill>` | Endorse a skill for the team: a PR (default policy) or a direct commit |
| Evals | `validate <path\|name>` | Deterministic safety and formatting checks, no model |
| | `eval <skill>` | Run the skill's evals on your own Claude Code login; `--commit` files a receipt |
| Machine | `update` / `uninstall` | Show the update command for this copy / remove everything from this machine |

`terum-skills --help` and `terum-skills <verb> --help` list every option.

## How it works

**One repo, one copy of each skill.** The team repo holds `skills/<name>/` (the flat store, folder name equals frontmatter `name`, unique repo-wide), `team.json` (endorsed lists and policy), `people/<handle>.json` (each member's identity and installed list, the only file that member's installs touch), and `evals/` (committed receipts, keyed by skill id). A generated GitHub workflow runs the eval checks on PRs.

**Ownership is metadata.** Only the author named in a skill's `metadata.author` may change its folder; only you may write your people file; endorsed lists change through `publish` PRs. A pre-push guard enforces all of this, and every write goes through one `safeWrite` path that fetches, resets to `origin/main`, re-applies the change, and pushes, so two members writing at once never produce a merge conflict in generated files.

**Placement is a plain copy.** `install` copies the skill into `~/.claude/skills/<name>` (or a project's `.claude/skills/`), records a per-file fingerprint, and `sync` refreshes it when the store changes. Hand-edited placed copies are moved to `~/.terum/skills/quarantine/`, never silently overwritten. `sync --prune` empties the quarantine.

**Connecting is consent.** `connect` shows the fields it will add to your SKILL.md (license, id, author, category) and asks y/N before writing anything. After that, `sync` mirrors your edits into the repo. If the repo copy and your source diverge, `sync` prints the remedy (`connect --keep-source <id>` or `--keep-repo <id>`) and does nothing until you choose. Skills containing hooks or plugin definitions need `--allow-privileged`.

**Nothing runs anywhere but laptops and the git host.** No HTTP client, no daemon, no API key. The CLI talks to git and, for GitHub teams, to `gh`.

## Evaluating skills

The eval design is Ajay Wadhwani's, built on a measured record from earlier skill-evaluation work: a simulated run is worthless (shimmed execution scored a mean lift of −0.08 where real execution scored +0.24), one run is inside the noise band (about ±0.1), and per-arm scores reproduce across identical runs (r = 0.97) while the difference between arms does not (r = 0.35). Every rule below follows from that: real execution only, repeated runs, banded verdicts instead of point estimates, and receipts that accumulate rather than overwrite.

### Two layers

**Hygiene** is deterministic and free. `validate`, `connect`, `sync`, `publish`, `eval`, and the team CI all run it before any skill content reaches the repo. Six checks, each with a stable code:

| Code | Fails when |
|---|---|
| HYG1 | Frontmatter does not parse, folder name differs from `name`, or `allowed-tools` grants are malformed |
| HYG2 | A text file contains bidi or zero-width characters, or a single token mixes scripts (the homoglyph shape) |
| HYG3 | A credential pattern, or an email address other than the author's own |
| HYG4 | An executable bit or shebang without `--allow-privileged` consent, or a file extension outside the allowlist |
| HYG5 | `license`, the team policy license, and any bundled `LICENSE` file disagree |
| HYG6 | `description` is empty. A SKILL.md over 20,000 characters is a warning, printed and never blocking |

**`eval`** runs the skill for real, on your own logged-in Claude Code, in throwaway sandboxes. It reads the team clone and writes only its local run tree, plus one receipt file if you pass `--commit`. It never touches `skills/`, `people/`, or your placed copies.

### Authoring evals

Evals live inside the skill folder and travel with it.

`skills/<name>/evals/cases/<case>.yaml`, one execution case per file:

```yaml
task: "Add a preflight check before deploy.sh runs and explain what it verifies."
files: { "deploy.sh": "#!/bin/sh\necho deploying" }   # optional inline seeds
setup: "git init -q"                                    # optional, 60 s cap
requires: ["python3"]                                   # optional host tools; missing → case skipped, visibly
checks:                                                  # all-or-nothing per arm
  - file_exists: "preflight.sh"
  - no_command_matching: "deploy\\.sh"
  - command_succeeds: "sh -n preflight.sh"
judge: "Prefer the transcript that names the concrete failure modes the preflight guards against."  # used only on check ties
```

Six check kinds: `transcript_mentions`, `command_matching`, `no_command_matching`, `file_exists`, `file_absent`, `command_succeeds`. Write tasks a headless agent can finish without asking a question, and phrase skill conventions as practice rather than magic strings, since an agent that stops to ask scores as a failure.

`skills/<name>/evals/triggers.yaml`, for whether the skill fires when it should:

```yaml
should_trigger:     ["prompts that must select this skill"]
should_not_trigger: ["near-miss prompts; unrelated ones tell you nothing"]
```

### What a run does

1. **Preflight.** `claude --version` is recorded and a one-turn smoke task runs, so a logged-out or broken CLI fails in seconds instead of after six paid trials.
2. **Triggers.** The catalog is the team's endorsed set plus the skill under test. One tool-free, one-turn call per prompt asks which skills apply; the report prints recall, precision, and each `MISS` or `FALSE-FIRE`.
3. **Three arms, k repetitions per case** (default 3, `--k 10` for depth). *Baseline* runs with no skill staged, *candidate* runs with the version under test, *incumbent* runs with the last version that has a committed receipt, so a re-publish is measured against what it replaces. Each arm runs `claude -p` in a fresh sandbox with `--setting-sources project`, so your user-level skills cannot leak in; the engine reads the resolved skill list from the run and refuses if the skill under test is present in baseline or missing from candidate.
4. **Per-row verdict.** Both arms failed → tie. One failed → the other wins. Checks disagree → decided by checks. Checks tie and a `judge` rubric exists → a pairwise judge over the transcripts, asked twice in both A/B orderings; the two answers must agree or the row is a tie labelled `judge-split`. An unparseable judge answer is retried once, then re-asked on a stronger model (`opus` by default), and a still-unparseable or refused answer is a labelled tie, never a coerced win. Every row records how it was decided.
5. **Headline.** Net lift on candidate-vs-baseline is (wins − losses) / rows. **PASS** at +1/3 or better, **FAIL** at −1/3 or worse, **NEUTRAL** between. Arm scores (mean fraction of checks passed) and efficiency (turns, seconds, cost per arm) print alongside. Unscored rows, from environment skips or double failures, stay visible as holes and grey the verdict instead of being averaged away.

A transient agent or judge failure is retried once in a fresh sandbox; a second failure is scored, never hidden. Credential patterns are redacted from every free-text field before anything is written.

### Receipts

`eval --commit` writes one immutable file, `evals/<skill-id>/<tree-hash>/<run-id>.json`, through the same guarded write path as everything else. The tree hash pins exactly which bytes were evaluated. Re-running the same version appends a new receipt beside the old; nothing is overwritten or deleted. Anyone may evaluate anyone's skill; the receipt records who ran it, the engine and Claude Code versions, the models actually resolved, k, and the case list. Numbers from receipts with a different model or Claude Code version are never compared.

`--working` evaluates your local connected source instead of the store copy, for the authoring loop. It cannot `--commit`, because receipts pin committed trees only.

### The publish gate

CI never runs a model and never holds an API key; every eval token is a member's own subscription. The generated team workflow has two deterministic jobs:

- **hygiene** on any PR touching `skills/**`: `validate` per changed skill. Error findings block.
- **receipt-check** on `publish` PRs: the PR must carry a schema-valid receipt at the skill's exact tree hash. If it includes a candidate-vs-incumbent comparison, that comparison must not be FAIL. If it includes none, CI confirms no prior version of the skill exists and lets the first publish through.

`publish` opens the PR and both jobs run on it, so a reviewer sees the verdict without re-running anything. `team workflow-update --print` prints the current workflow when the scaffold changes.

## Installing, updating, uninstalling

- **Global:** `npm install -g terum-skills`. If `terum-skills: command not found`, add `$(npm prefix -g)/bin` (the prefix itself on Windows) to PATH.
- **Project-local:** `npm install terum-skills` puts the binary under `node_modules/.bin`; run it as `npx terum-skills …` from that folder.
- **Update:** `terum-skills update` prints this copy's version, the newest advertised release, and the exact command that updates *this* copy. It never runs a package manager. `npx -y terum-skills@latest` fetches the newest release every run and updates nothing else.
- **Uninstall:** `terum-skills uninstall` removes every team from this machine (placed skills, clones, cache), the session-start hook, and `~/.terum/skills` except its recovery data (`quarantine/`, `backups/`), then prints the one package-manager line to finish. `uninstall-skill <skill>` removes one skill.

Release notices appear last on stderr, at most once per release per day, and are suppressed in CI, when stderr is piped, or when `NO_UPDATE_NOTIFIER` or `TERUM_SKILLS_NO_UPDATE_NOTIFIER` is set. Version checks read git tags from this repository only, never the npm registry, and only when a configured team is on GitHub.

## Releasing (maintainers)

A release is one deliberate action. Bump `version` in `package.json` and both `version` fields in `package-lock.json` in a reviewed PR, merge it, then run **Actions → Release** with the version and the full merged commit SHA (`dry_run` first). The workflow runs the gates, packs once with the commit stamped as `gitHead`, publishes to npm with provenance behind a reviewer-approved environment, verifies the registry serves those exact bytes, and only then creates the `v<version>` tag and a GitHub Release. Tags therefore advertise verified publications and are never moved; `release-drift.yml` checks every tag against the registry daily. A failed run is re-dispatched with the same inputs and finishes whatever step is missing.

## Troubleshooting

- **Created a team by mistake?** Join the right one with the line its owner sent you. If its repository name collides with a local team, `terum-skills team join <org>/<repo> --as <other-name>`. `team leave <accidental>` removes it from this machine; delete the repository on GitHub yourself.
- **git and gh signed in differently?** `gh auth setup-git --hostname github.com` makes git use gh's account.
- **A never-connected folder fails `validate` on HYG1.** The managed fields (`license`, `metadata.id`, `metadata.author`) are what `connect` adds; connect it first.
- **`sync` printed a divergence line.** Your source and the repo copy both changed. Pick `connect --keep-source <id>` or `connect --keep-repo <id>`; nothing moves until you do.

## License

Apache-2.0. `NOTICE` credits the skillhub modules the placer derives from.
