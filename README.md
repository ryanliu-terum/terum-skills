# terum-skills(Evaluating the best skills and sharing them)

I've been searching for best skills and practices for using the amazing AI tools we have today from Claude Code to Cursor. While searching for best practices, I ended up personally evaluating skills I found via social media like superpowers or Matt Pocock by creating my own test framework. Then, when I wanted to share them with my team, I found myself having to manually zip files, send them over from my global folder(which I didn't want to link to my team's shared repo). All of this took quite a while, so I made this project, and hope it saves some time for others. 

## Quick start
**Core beliefs of the project:**

- Skills are extremely impactful at increasing efficiency with AI.
- The most impactful skills only work in the context of the project they were created for
- It should be easy to evaluate the best skills that work for a project and easy to distribute them among the contributors of that project.

As a result, we built Terum, a free, fully open source tool that lets you evaluate and share the best skills/workflows among a team! Two line terminal installation that installs a CLI package and a lightweight application for a simple UI that wraps the CLI. Fully self-hosted, no server, all skills live in a private GitHub repository that the CLI package calls from. 

Our purpose is it make it quick and easy to determine best AI practices through skills and share your findings with your team. 

## Why should I use this? Who would find this helpful? (And other FAQ)

**Who would find this helpful?**
- **Developers in an team** looking to discover and share best practices internally
- Individuals looking to evaluate the near infinite amount of publicly available skills and decide which ones are best for their own repo.

**Use cases**
- Measure ROI of skills and their workflows
  - Cost
  - Time
  - Quality of output
- Compare similar skills against each other (your developed skill vs public skill, 2 public skills, two versions of your skill)
- Share skills with team members easily

**Isn't it super easy to share skills by just pushing them to GitHub?**
- **Yes, it is**, and you should do that if you only work on one project and don't mind having your .claude in your project.
- However, if any of the following apply, Terum might be useful:
  - If you're working on multiple projects with specialized skills,
  - If the repo does not allow .claude in the repo itself(open source, enterprise projects),
  - If you're trying to manage and separate global and project skills while still sharing them easily with teammates 


**Aren't there open source frameworks for evaluating skills already?**
- **Yes, there are!** Like Nvidia's SkillEvaluator or the SkillsBench paper. Our evaluation methods are heavily based off of these proven methods. Terum doesn't try to reinvent the wheel, it just adopts the methods so that they are fully plug and play. SkillEvaluator requires Docker and an API key; SkillsBench requires you to bring your own tests. Terum runs using your subscription plan, with one terminal installation, using dynamically generated tests for the specific skill being tested(we're currently looking into dynamic generation along with category-specific tests). 

**How are you evaluating skills?**
- Answered above. For more specific notes on methodology, scroll to the bottom. 


**Does any private information including skill usage, metadata, or information get out?**
- **Nope!** Fully open source, locally hosted. All skill data is yours and your team's. We're working on a fully open skill marketplace(like skills.sh but with skills ranked by effectiveness, not downloads)




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

Setup also offers the `/terum-skills` Claude Code skill, placed at `~/.claude/skills/terum-skills/`, so Claude Code can run these commands for you inside a session (and hand you the ones that need a terminal). It ships inside the npm package; re-running `npx -y terum-skills@latest setup` after an update refreshes it. The session hook also refreshes an outdated managed copy and announces the update; it leaves a foreign copy alone.

## How it works

**Your library are your local folders.** Kind of just like a file explorer but just explicitly for your own skills. This is a direct mirror of your own local system. When a folder's bytes are identical to a version the team has published, its card also shows that version and the team's eval for those exact bytes, named after whoever ran it; a folder you have edited shows neither, because the score described the old bytes. 

**Local-first, with shared skills in a team Github, created on setup** The team repo holds every skill and their unique versions in GitHub along with each skill's associated eval. Each individual has their own .json detailing their personal profile along with the skills they have published or have installed. 

**Sharing skills with a team** To share a skill with a team, you must explicitly publish the skill. If no skill already exists in the shared repo with the same name, creates a Version 1 of that skill as you shared it. A fetch makes the published version visible in teammates’ local Marketplace clones; they explicitly install it to copy it into their Library. If a skill with the same name already exists, check if any of the versions are identical to the version you are trying to publish. If identical, attach any new local evals you have ran associated with that version to the shared repo. If not identical, create a new version of that skill by incrementally increasing the version number. 

**The team marketplace holds your teams shared skills** Marketplace shows you all of the published skills by your team members along with their evals

**Installation of a team's skill** Installing copies the skill from your local clone of the shared team repo into the folder you select. Uninstall removes the copy of that skill from the folder. 

**Nothing runs anywhere but laptops and the git host.** No HTTP client, no daemon, no API key. The CLI talks to git and, for GitHub teams, to `gh`.

## Evaluating skills
A skill is a set of instructions and files that changes how a coding agent behaves. A good one makes the agent faster and safer; a bad one quietly makes it worse. The trouble is that "it seemed to help" is exactly the kind of claim humans get wrong — agents are noisy, tasks vary, and a skill that shines on its author's machine can do nothing on yours.

So we treat skill evaluation the way medicine treats a new drug: with a control group, repeated trials, and a written record anyone can audit later. One command runs the whole study; one committed file preserves the result.

### How an evaluation works
An eval starts with a skill and a set of task cases. Each case runs repeatedly in fresh sandboxes, both without the skill and with it. The results are compared using checks, transcript judging when needed, and a small set of supporting metrics.

The question is never "what score did the skill get?" It's the only question that matters in practice: is the agent measurably better with this skill than without it — and better than the version we already had?

```mermaid

flowchart TD

    S["Skill"] --> C["Load test cases"]

    C --> B["Baseline: without skill"]

    C --> K["Candidate: with skill"]

    B --> R["Repeat each case k times"]

    K --> R

    R --> D["Compare outcomes"]

    D --> M["W / L / T by case"]

    D --> A["Arm scores"]

    D --> E["Efficiency and trigger metrics"]

    M --> L["Net lift = (wins - losses) / scored rows"]

```

By default, each case runs once. Use `--k 3` when you need a more stable estimate.

### Two layers
Evaluation has two parts: hygiene and execution.

#### Hygiene
Hygiene checks are deterministic and free. Use `validate` for a free check. `publish` checks its injected frontmatter before writing; `eval` checks local bytes while permitting missing managed fields. Validation uses team policy and does not inject fields.

| Code | Fails when |
| --- | --- |
| `HYG1` | Frontmatter does not parse, the folder name differs from `name`, or `allowed-tools` grants are malformed. |
| `HYG2` | A text file contains bidirectional or zero-width characters, or a token mixes scripts in a way that resembles a homoglyph attack. |
| `HYG3` | A file contains a credential pattern or an email address other than the author's own. |
| `HYG4` | A file has an executable bit or shebang in a check that disallows executables, or uses an extension outside the allowlist. Publish permits executable content; local eval and validate do not. |
| `HYG5` | The frontmatter license, team policy license, and any bundled `LICENSE` file disagree. |
| `HYG6` | `description` is empty. A `SKILL.md` longer than 20,000 characters produces a warning but does not block. |
| `HYG7` | At publish, a category outside the team list produces a warning. Eval and validate do not supply that list. |

#### Execution
`eval` runs the skill through your logged-in Claude Code CLI. Each arm gets a fresh throwaway sandbox. The candidate is the folder on this machine. The command stores local run artifacts and writes missing generated eval assets into that folder, announcing the path first. Only publish shares skill bytes; a receipt for bytes that are already a published version is shared by `eval` itself.

### Writing evals
Eval files live inside the skill folder and travel with the skill.

#### Execution cases
Put one case in each file under:

```text

skills/<name>/evals/cases/<case>.yaml

```

Example:

```yaml

task: "Add a preflight check before deploy.sh runs and explain what it verifies."

files:

  deploy.sh: |-

    #!/bin/sh

    echo deploying

setup: "git init -q"

requires: ["python3"]

checks:

  - file_exists: "preflight.sh"

  - no_command_matching: "deploy\\\\.sh"

  - command_succeeds: "sh -n preflight.sh"

judge: "Prefer the transcript that names the concrete failure modes the preflight guards against."

```

`files` seeds the sandbox, `setup` runs once with a 60-second limit, and `requires` lists host tools the case needs. If a required tool is missing, the case is visibly skipped.

The six supported check types are:

- `transcript_mentions`

- `command_matching`

- `no_command_matching`

- `file_exists`

- `file_absent`

- `command_succeeds`

All checks for an arm must pass for that arm to pass the case. Write tasks that a headless agent can complete without asking questions. Describe conventions as normal working practices instead of hiding magic strings in the prompt; an agent that stops to ask for clarification fails the case.

The optional `judge` is only used when the checks tie.

#### Trigger cases
Use `skills/<name>/evals/triggers.yaml` to test whether the skill is selected at the right time:

```yaml

should_trigger:

  - "prompts that must select this skill"

should_not_trigger:

  - "near-miss prompts that should select a sibling skill or no skill"

```

Good negative examples are near misses. Unrelated prompts provide little useful signal.

### Generated evals
You can evaluate a skill even when it does not include eval files. By default, `eval` generates whatever is missing. Authored assets always take priority:

- if execution cases exist, none are generated;

- if cases exist but `triggers.yaml` does not, only trigger prompts are generated; and

- if neither exists, generation creates between three and seven execution cases — the model sizes the set to the skill's complexity, one case per thing that can independently go wrong — including at least one adversarial case, plus five positive and five negative trigger prompts.

Generation reads the complete local skill and a local catalog of sibling skills. Negative trigger prompts are based on nearby sibling skills, so they test realistic confusion rather than random unrelated requests.

Every generated file is checked against the real case or trigger schema before it is used. Generated cases may use the five declarative checks, but not `command_succeeds`; this prevents the generator from inventing an incorrect verification program. If the files are still invalid after two correction attempts, the eval stops with an error.

Generated files begin with:

```text

## generated by terum-skills eval-gen — review before trusting
```

The header also records the model and generation time.



### What happens during a run
#### 1. Preflight
The runner records `claude --version` and sends a one-turn smoke task. A logged-out or broken CLI therefore fails before the full set of paid trials begins.

#### 2. Trigger evaluation
The selection catalog contains usable skills in the candidate’s Library root plus the candidate itself; it does not read the team catalog. For each trigger prompt, a tool-free one-turn call chooses which skills apply. The report shows recall, precision, and every `MISS` or `FALSE-FIRE`.

#### 3. Execution arms
Each case runs against baseline, with an incumbent arm when one is available, and `k` repetitions per arm:

| Arm | What it contains |
| --- | --- |
| Baseline | No copy of the skill under test. |
| Candidate | The version currently being evaluated. |
| Incumbent | The published version with the most recent receipt, excluding versions identical to the candidate bytes. Omitted when no eligible version exists. |

Every repetition runs `claude -p` in a fresh sandbox with `--setting-sources project`, preventing user-level skills from leaking into the run. The engine checks the resolved skill list and refuses to continue if the tested skill appears in baseline or is missing from candidate.

#### 4. Row verdicts
Each candidate-baseline row is decided in this order:

1\. If both arms fail, the row is a tie.

2\. If only one arm fails, the other wins.

3\. If their checks differ, the checks decide the row.

4\. If the checks tie and the case has a `judge`, a pairwise judge compares the transcripts twice, reversing the A/B order on the second pass.

Both judge passes must agree. Otherwise, the row is a tie marked `judge-split`.

If a judge response cannot be parsed, it is retried once. A second parse failure is sent to a stronger model—`opus` by default. If that response is also invalid or refuses the task, the result is a labelled tie. The runner never turns an unclear judgment into a win.

Every row records how it was decided.

#### 5. Headline and supporting metrics
Candidate lift over baseline is:

```text

(wins - losses) / scored rows

```

The result is grouped into three bands:

| Verdict | Net lift |
| --- | ---: |
| `PASS` | At least `+1/3` |
| `NEUTRAL` | Between `-1/3` and `+1/3` |
| `FAIL` | At most `-1/3` |

The report also includes:

- ****arm score:**** checks passed divided by total checks for each arm;

- ****efficiency:**** turns, elapsed time, and cost per arm; and

- ****trigger quality:**** precision and recall.



### Receipts
`eval` writes a local receipt under `~/.terum/skills/evals/local/<digest>/<run-id>/`.
Its content digest identifies the evaluated bytes; its version is null until it is attached to one.
When the evaluated bytes are already a published version, `eval` publishes the receipt itself — that is
how a teammate's skill you installed and evaluated gets a score the team can see, with no second
command. `--no-commit` keeps the run to yourself. Otherwise `publish` attaches matching receipts at:

```text
evals/<skill-id>/v<N>/<run-id>.json
```

Identical bytes reuse the existing version and can receive additional matching receipts.
Eval cases travel with the skill but are **not** part of its version identity: they live beside the
version folders at `skills/<name>/evals/`, so generating or editing a case never mints a version and
never blanks an existing score. A publish whose only change is an eval asset mints nothing — it
updates the dataset and attaches any matching receipts to the version that already holds those bytes.
Installed copies carry the skill, not its dataset.

Anyone can evaluate a local skill, including a copy installed from a teammate. A receipt records:

- who ran the eval;

- the engine and Claude Code versions;

- the models that were actually resolved;

- the repetition count `k`; and

- the cases included in the run.

Results are only compared when their model and Claude Code versions match.

To share a local run, publish the matching skill bytes. Runs remain on this machine until then.

### Where the design comes from
The framework's measurement discipline comes from [NVIDIA's SkillEvaluator](https://docs.nvidia.com/skills/skillevaluator). We didn't adopt it on reputation: we ran it end-to-end on our own skills first, and kept what survived that trial. The adoptions fall into three groups.

****Hygiene gates.**** The free deterministic tier is theirs in structure and substance: metadata schema validation, a scan for personal data, a security review of every bundled script, detection of hidden Unicode characters that could smuggle instructions past a human reader, and license reconciliation that fails closed when a skill's declared license conflicts with its LICENSE file. So is mandatory secret redaction of anything that crosses the sharing boundary — the rule the privacy note above enforces.

****Measurement design.**** Their four-bucket taxonomy for trigger prompts — explicit, implicit, contextual, and negative near-misses — is the structure every authored test set follows. The efficiency dimension comes straight from their insistence that a skill that wins but triples token burn has to say so. Verdict banding with a neutral dead-zone follows their asymmetric threshold pattern — a modest positive bar to pass, a stricter negative bar to fail — applied here to net lift. And contamination control is their rule verbatim: the arm under test contains exactly the skill under test, and the engine refuses to run if a stray global copy of that skill would silently zero out the measured lift.

****Operational robustness.**** Before any paid matrix runs, a runtime preflight performs one tiny real agent task — their preflight caught, in seconds, an infrastructure failure that would otherwise have burned six paid trials. Every result records its attempt policy and a digest of the exact test set that produced it, so no receipt can drift from its inputs. Partial results are labeled, never averaged into a clean-looking number. And the judge escalation chain — format-tolerant parsing, then retry, then a stronger judge model — exists because we watched a cheap judge fail deterministically on a single hard case.

****What we deliberately left behind.**** SkillEvaluator's live-execution tier requires containers and a raw API key — an onboarding tax we measured firsthand, and one that shuts out subscription-authenticated agents entirely. We also passed on its agent-agnostic harness, its embedding-based deduplication tier, its cloud sandbox backends, and its five-dimension 0-to-1 rubric as the headline score: at the sample sizes a team can actually afford, a win/loss record summarized as net lift is the more honest instrument.

The execution engine itself is our own: a three-arm, comparison-first harness that drives each member's own logged-in agent instead of containers or cloud sandboxes, plus the trigger evals measured against the local skill catalog, the incumbent regression arm, the committed receipt system, and the display rules above. SkillEvaluator supplied the discipline; our own measurements supplied every departure from it.

### Why it's built this way
Every rule above traces back to something we measured rather than assumed: that real execution is non-negotiable, that repetition is the price of a trustworthy verdict, that arm scores are stable where their differences are not, and that honest small-sample statistics mean saying "neutral" far more often than a marketing page would like. The framework's job is not to make skills look good. It's to make one command produce a verdict a teammate can commit, audit, and believe.

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
| Team | `setup [<org>/<repo>] [--no-existing]` | Create-or-join wizard; sequences the verbs below, checks existing Library folders against the team, then offers the session hook and the `/terum-skills` Claude Code skill; `--no-existing` skips that check |
| | `login` | Check `gh` and record your name, email, and handle |
| | `team create` / `team join` / `team leave` / `team move <org>/<repo>` / `team remove <handle>` | Manage the repo and its roster; `move` follows a team whose repository was recreated elsewhere (leave, join, place the shared skills again) |
| | `invite <github-user>…` | Grant repo access and print the join line |
| | `ls [--local]` / `ls member <handle>` / `ls project <name>` / `ls skill [name]` / `status` / `search <term>` | Read the team, your local skills, or the catalog |
| | `project add [<path>]` / `project remove <path>` / `project list` | Add, forget, or list the projects in your library — the folders this machine reads local skills from. Nothing is added for you: setup offers one folder at first run (`--no-projects` / `--no-evals` skip the offers), and the Library adds the rest |
| | `team workflow-update` | Print the current team workflow scaffold with `--print` for manual migration |
| | `team migrate` | Convert a team repo to the versioned layout (one commit per repo). Run **once per team, from a terminal**, and only after the release carrying the new CLI has reached everyone — an un-upgraded teammate cannot read a migrated repo |
| | `team project create [<name>] [--remote <url>]` | Create a team project: a name and the repository its skills place into (the skills themselves are added with `publish --project`) |
| | `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]… [--remove <skill>]` | Describe yourself in your own people file (job label, team projects); `--remove` takes a skill off the profile list publishing added |
| Skills | `install <ref> [--into global\|<project root>] [--yes-profile]` / `install --adopt <path>` / `uninstall-skill <ref> [--from global\|<project root>]` | Install the highest numbered version in the clone, or adopt an identical Library folder in place without copying it. Interactive installs offer Global and added projects; `--into` selects explicitly and refuses unregistered project roots. A replace prompt keeps the existing folder in the targeted root’s `.claude/old-skills/<name>`; an existing backup there must be moved elsewhere first; uninstall leaves your profile unchanged (`member <handle>` and `project <name>` install whole lists); `uninstall-skill` asks once, listing every folder it will remove |
| | `reconcile [--list]` | Compare unrecorded Library folders with published team skills; list the byte-identical, differing, and renamed matches, or ask which identical folders to adopt and which differing same-name folders to publish |
| | `sync` | Fetch each team clone and reset it to `origin/main`; it never places, uploads, or edits local skills |
| | `prune` | List quarantined items and delete the ones you confirm |
| | `skill move <path> --to global\|<project root>` / `skill copy <path> --to global\|<project root>` / `skill rename <path> --to <new-name>` / `skill delete <path>` / `skill fix <path>` | Move, copy, rename, delete, or fix a folder in your Library. Copy leaves the source where it is, so one local skill can sit in two roots at once; the new folder keeps the source's `metadata.id` and is a plain Library folder with no install record of its own. Delete confirms by name; move, copy and rename ask nothing, because each is undone by running the verb the other way and none overwrites anything; fix applies the repairs with one right answer (quote a frontmatter value YAML refuses, set `name` to the folder, set `license` to the team policy, strip invisible characters, clear an executable bit on a non-script) and lists what still needs you. Delete removes an unmodified placement outright (the team repo still holds its bytes; reinstall restores them) and quarantines an edited placement or any folder that is not a placement; `prune` permanently deletes quarantine contents |
| | `serve` | Answer read requests on one long-lived process instead of starting a new one per call (`--frames` only; the desktop app drives it). Reads only: `status`, `ls`, `eval-report`, `search`, `validate`, `update` |
| | `publish <ref> [--project <name>] [--category <name>]` | Publish a local folder — named by its skill name or its folder path (`~/…` accepted) — as an immutable version directly to main, or reuse identical bytes and attach matching evals. Select a team project (Global by default). Category precedence: declared frontmatter, flag, model suggestion, misc fallback; undeclared categories get a source disclosure. Managed frontmatter is written back locally; publication adds the skill to your profile with no prompt (`profile --remove <skill>` takes it back) |
| Evals | `validate [path\|name]` | Deterministic safety and formatting checks, no model |
| | `eval [skills...]` | Evaluate the local skill, named by skill name or folder path, with your own Claude Code login; generate only missing assets (`--no-gen` disables generation). A receipt for bytes that are already a published version is published by `eval` itself (`--no-commit` keeps it on this machine). `eval <a> <b>… [--batch n] [--parallel n]` evaluates several skills as one batch (`--batch n` asks before each further batch); `eval <skill…> --window overnight\|later` queues them instead, and `eval --pending` picks every shared skill without a receipt. `eval --drain [--parallel n] [--window overnight] [--max n]` runs queued evals; `eval --queue-list` lists them; `eval --dequeue <team>/<skill>` removes matching queued skills |
| | `eval-report [skill]` | Show a skill's committed eval receipts and this machine's local runs (read-only, no fetch); the desktop app's Evals tab reads it |
| Machine | `update` / `uninstall` | Show the update command for this copy / confirm machine teardown, preserve recovery data, and print the package-manager removal step |
| | `app` | Install and open the desktop app for this CLI version |
| | `app-update [--check\|--stage\|--apply] [--release <version>] [--reason on-close\|overnight\|manual]` | Check for, download, or install a newer desktop app; Settings ▸ Updates offers Install now, When I quit, or Overnight (01:00–05:00 after 30 idle minutes) |

This CLI has no standalone refresh command: use `sync` to fetch. `team workflow-update --print` only prints workflow migration instructions; the skill-layout migration is `team migrate`, a terminal-only, once-per-team operation that refuses to run under `--frames`.

`npx -y terum-skills@latest --help` and `npx -y terum-skills@latest <verb> --help` list every option you are expected to use.

**Boards.** Every command above takes `--format <plain|md|pretty|json|auto>` (default `plain`, the output the tables describe). `--format md` renders the result as a Markdown board — the form the shipped Claude Code and Codex skills ask for — `pretty` draws box tables with colour for a terminal, `json` writes one document (`{ verb, ok, exitCode, error?, declined?, refused?, value?, lines }`), and `auto` picks `pretty` on a TTY and `md` otherwise. `--rows <n|all>` caps table rows (default 25), `--width <n>` sets a pretty board's width, `--host <claude|codex|terminal>` phrases the board's **Next** line, `--no-color` drops ANSI. The flags go anywhere before `--`; they are refused with `--frames`, `serve`, and `sync --hook`, whose stdout is spoken for. `ls skill <name>` shows one skill whole, and `ls skill`, `eval-report` and `validate` accept a unique prefix; `eval` takes an exact or case-insensitive name; each of the four, run inside a Library skill folder, needs no name at all (`validate` also accepts any skill folder by path). A usage error (unknown verb, missing argument, bad option value) under any `--format` writes nothing to stdout — one stderr message and exit 1, nothing runs; a reader that sees exit 1 with empty stdout reads stderr.

For a program driving the CLI (the desktop app, a script), `--frames` turns any verb into one JSON object per line on stdout and stdin, questions included. See [docs/frame-protocol.md](docs/frame-protocol.md).

## License

Apache-2.0. `NOTICE` credits the skillhub modules the placer derives from.
