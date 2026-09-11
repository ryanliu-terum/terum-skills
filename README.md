# terum-skills(Evaluating the best skills and sharing them)

I've been searching for best skills and practices for using the amazing AI tools we have today from Claude Code to Cursor. While searching for best practices, I ended up personally evaluating skills I found via social media like superpowers or Matt Pocock by creating my own test framework. Then, when I wanted to share them with my team, I found myself having to manually zip files, send them over from my global folder(which I didn't want to link to my team's shared repo). All of this took quite a while, so I made this project, and hope it saves some time for others. 

## Quick start
Core beliefs of the project:

- Skills are extremely impactful at increasing efficiency with AI.
- The most impactful skills only work in the context of the project they were created for
- It should be easy to evaluate the best skills that work for a project and easy to distribute them among the contributors of that project.

As a result, we built Terum, a free, fully open source tool that lets you evaluate and share the best skills/workflows among a team! Two line terminal installation that installs a CLI package and a lightweight application for a simple UI that wraps the CLI. Fully self-hosted, no server, all skills live in a private GitHub repository that the CLI package calls from. 

Our purpose is it make it quick and easy to determine best AI practices through skills and share your findings with your team. 

## Why should I use this? Who would find this helpful?

Who would find this helpful?
- **Developers in an team** looking to discover and share best practices internally
- Individuals looking to evaluate the near infinite amount of publicly available skills and decide which ones are best for their own repo.



Isn't it super easy to share skills by just pushing them to GitHub? 
- **Yes, it is**, and you should do that if you only work on one project and don't mind having your .claude in your project.
- However, if any of the following apply, Terum might be useful:
  - If you're working on multiple projects with specialized skills,
  - If the repo does not allow .claude in the repo itself(open source, enterprise projects),
  - If you're trying to manage and separate global and project skills while still sharing them easily with teammates 


Aren't there open source frameworks for evaluating skills already? 
- **Yes, there are!** Like Nvidia's SkillEvaluator or the SkillsBench paper. Our evaluation methods are heavily based off of these proven methods. Terum doesn't try to reinvent the wheel, it just adopts the methods so that they are fully plug and play. SkillEvaluator requires Docker and an API key; SkillsBench requires you to bring your own tests. Terum runs using your subscription plan, with one terminal installation, using dynamically generated tests for the specific skill being tested(we're currently looking into dynamic generation along with category-specific tests). 

How are you evaluating skills?
- Answered above. For more specific notes on methodology, scroll to the bottom. 


Does any private information including skill usage, metadata, or information get out? 
- **Nope!** Fully open source, locally hosted. All skill data is yours and your team's. 




## Quick start

Requires Node 22.12+, `git`, and an authenticated GitHub CLI (`gh auth login`).

```sh
npx -y terum-skills@latest setup
npx -y terum-skills@latest app
```
The default setup command will lead you towards creating a team. To join a team, ask the owner of a team to use `npx -y terum-skills@latest invite <your github username>`. They will receive a command that you can paste into your terminal. Or, if you know the organization name and repo name and have already been invited, you can run:

```sh
npx -y terum-skills@latest setup <org name>/<repo name>
npx -y terum-skills@latest app
```

There is no install step — `npx -y` fetches and runs the latest release every time. (Prefer a permanent `terum-skills` binary? See [Installing, updating, uninstalling](#installing-updating-uninstalling).)

Setup also offers the `/terum-skills` Claude Code skill, placed at `~/.claude/skills/terum-skills/`, so Claude Code can run these commands for you inside a session (and hand you the ones that need a terminal). It ships inside the npm package; re-running `npx -y terum-skills@latest setup` after an update refreshes it.

## How it works

**Your library are your local folders.** Kind of just like a file explorer but just explicitly for your own skills. This is a direct mirror of your own local system. 

**Local-first, with shared skills in a team Github, created on setup** The team repo holds every skill and their unique versions in GitHub along with each skill's associated eval. Each individual has their own .json detailing their personal profile along with the skills they have published or have installed. 

**Sharing skills with a team** To share a skill with a team, you must explicitly publish the skill. If no skill already exists in the shared repo with the same name, creates a Version 1 of that skill as you shared it. Team members get the shared skill on the next git pull from the remote repo(every 1hr, can manually sync on demand). If a skill with the same name already exists, check if any of the versions are identical to the version you are trying to publish. If identical, attach any new local evals you have ran associated with that version to the shared repo. If not identical, create a new version of that skill by incrementally increasing the version number. 

**The team marketplace holds your teams shared skills** Marketplace shows you all of the published skills by your team members along with their evals

**Installation of a team's skill** Installing copies the skill from your local clone of the shared team repo into the folder you select. Uninstall removes the copy of that skill from the folder. 

**Nothing runs anywhere but laptops and the git host.** No HTTP client, no daemon, no API key. The CLI talks to git and, for GitHub teams, to `gh`.

## Evaluating skills

The eval design is built on a measured record from earlier skill-evaluation work: a simulated run is worthless (shimmed execution scored a mean lift of −0.08 where real execution scored +0.24), one run is inside the noise band (about ±0.1), and per-arm scores reproduce across identical runs (r = 0.97) while the difference between arms does not (r = 0.35). Every rule below follows from that: real execution only, repeated runs, banded verdicts instead of point estimates, and receipts that accumulate rather than overwrite.

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

### Generated evals

A skill with no evals can still be evaluated: `eval` generates what's missing, on your own subscription, and authored assets always win — if cases exist, none are generated; if only the trigger file is missing, only triggers are generated.

Generation reads the full skill text and the team catalog, then writes 3 execution cases (at least one adversarial) and 5 + 5 trigger prompts with near-misses drawn from sibling skills. Every file is validated against the real case and trigger schemas before use — generated checks are limited to the five declarative kinds (`command_succeeds` is excluded, so a generator can never author a wrong verification program), and every file opens with `# generated by terum-skills eval-gen — review before trusting` plus model and timestamp provenance. A generation that can't produce valid files after two corrections fails the run rather than reporting an empty result.

Where the files go depends on who you are:

- **Not your skill:** generated assets live only in the local run tree. The run prints a verdict and the review path; it never writes the team repo and never files a receipt — a receipt must name a version that contains the cases that judged it.
- **Your skill, one command:** `eval <skill> --commit` shows you the generated files and asks one question — *Commit generated eval assets for `<skill>`? [y/N]*. **y** commits them into your skill through the ordinary sync commit, re-runs at that new version, and files the receipt, now genuinely pinned to its dataset. **N** keeps everything local: the eval still runs and prints a verdict, and the files wait in the run tree for you to edit.
- **Your skill, deliberately:** `eval --working --save` writes reviewed generated assets into your source folder without committing anything; the next `sync` carries them up, and `eval --commit` then receipts them like any authored case.

Flags: `--no-gen` restores the old empty-asset behavior (and is the escape hatch when you want `--commit` untouched by generation); `--gen` produces a fresh second-opinion set for one run without reading or touching your authored files — it never commits and can't be combined with `--case`.

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

- **Default (no install):** every documented command runs as `npx -y terum-skills@latest <verb>`. npx fetches the newest release on each run, so there is nothing to install, update, or add to PATH. The forms below are optional alternatives that give you a bare `terum-skills` binary.
- **Update:** `npx -y terum-skills@latest update` prints this copy's version, the newest advertised release, and the exact command that updates *this* copy. It never runs a package manager. `npx -y terum-skills@latest` fetches the newest release every run and updates nothing else.
- **Uninstall:** `npx -y terum-skills@latest uninstall` removes your team from this machine (placed skills, clone, cache), the session-start hook, the `/terum-skills` Claude Code skill it placed, and `~/.terum/skills` except its recovery data (`quarantine/`, `backups/`) and local eval runs (`evals/`); it also removes the downloaded desktop app bundle (`app/`), then prints the one package-manager line to finish. `uninstall-skill <skill>` removes one skill.

Release notices appear last on stderr, at most once per release per day, and are suppressed in CI, when stderr is piped, or when `NO_UPDATE_NOTIFIER` or `TERUM_SKILLS_NO_UPDATE_NOTIFIER` is set. Version checks read git tags from this repository only, never the npm registry, and only when a configured team is on GitHub.

## Troubleshooting

- email ryanliu@terum.ai directly for bugs/feature requests, we'll get back to you within 12 hours.



## CLI Commands(assuming not using the app)

| Group | Command | What it does |
|---|---|---|
| Team | `setup [<org>/<repo>]` | Create-or-join wizard; sequences the verbs below, then offers the session hook and the `/terum-skills` Claude Code skill |
| | `login` | Check `gh` and record your name, email, and handle |
| | `team create` / `team join` / `team leave` / `team remove <handle>` | Manage the repo and its roster |
| | `invite <github-user>…` | Grant repo access and print the join line |
| | `ls [--local]` / `ls member <handle>` / `ls project <name>` / `status` / `search <term>` | Read the team, your local skills, or the catalog |
| | `checkout add [<path>]` / `checkout remove <path>` / `checkout list` | Register, forget, or list the checkout folders this machine scans (`ls --local` also shows the current repository, labelled not registered) |
| | `checkout discover [--under <dir>…] [--depth <n>] [--budget-ms <n>] [--register]` | Find local folders holding `.claude/skills`; optionally register them. Setup offers this search and opt-in evaluation of shared skills with no current receipt (`--no-discover` / `--no-evals` skip the offers) |
| | `team workflow-update` | Print the current team workflow scaffold with `--print` for manual migration |
| | `project create [<name>] [--remote <url>]` | Create a team project: a name and the repository its skills place into (the skills themselves are added with `publish --project`) |
| | `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]…` / `decline <ref>` | Describe yourself in your own people file (job label, projects) / record a shared skill you decline |
| Skills | `connect [<path>]` | Put a local skill folder in the team repo and keep your later edits synced |
| | `install <ref> [--into global\|<checkout root>]` / `uninstall-skill <ref> [--from global\|<checkout root>]` | Place or remove a skill (`member <handle>` and `project <name>` install whole lists); `uninstall-skill` asks once, listing every folder it will remove |
| | `sync` | Pull, finish pending installs, mirror connected edits, refresh placed copies; `--auto` runs without prompts, `--fresh-ms <n>` sets its freshness window |
| | `refresh` | Fetch the team clone to `origin/main` and nothing else — no placement, no sharing, no stamp; the desktop app runs it in the background so a teammate's committed work becomes visible |
| | `serve` | Answer read requests on one long-lived process instead of starting a new one per call (`--frames` only; the desktop app drives it). Reads only: `status`, `ls`, `eval-report`, `search`, `validate`, `update` |
| | `publish <skill>` | Endorse a skill for the team: a PR (default policy) or a direct commit |
| Evals | `validate <path\|name>` | Deterministic safety and formatting checks, no model |
| | `eval <skill>` | Run the skill's evals on your own Claude Code login; `--commit` files a receipt. `eval --drain [--parallel n] [--window overnight] [--max n]` runs queued evals; `eval --queue-list` lists them; `eval --dequeue <team>/<skill>` removes queued versions |
| | `eval-report <skill>` | Show a skill's committed eval receipts and this machine's local runs (read-only, no fetch); the desktop app's Evals tab reads it |
| Machine | `update` / `uninstall` | Show the update command for this copy / remove everything from this machine |
| | `app` | Install and open the desktop app for this CLI version |
| | `app-update [--check\|--stage\|--apply] [--release <version>] [--reason on-close\|overnight\|manual]` | Check for, download, or install a newer desktop app; Settings ▸ Updates offers Install now, When I quit, or Overnight (01:00–05:00 after 30 idle minutes) |

`npx -y terum-skills@latest --help` and `npx -y terum-skills@latest <verb> --help` list every option you are expected to use.

For a program driving the CLI (the desktop app, a script), `--frames` turns any verb into one JSON object per line on stdout and stdin, questions included. See [docs/frame-protocol.md](docs/frame-protocol.md).

## License

Apache-2.0. `NOTICE` credits the skillhub modules the placer derives from.
