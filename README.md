# terum-skills

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
- **Yes, it is**, and you should do that if you only work on one project and don't mind having your .claude in your project. However, if you're working on multiple projects with specialized skills, if the repo does not allow .claude in the repo itself(open source, enterprise projects), if you're trying to manage and separate global and project skills, or replicate a specific teammate's suite of skills with one click, then Terum will be useful. 


Aren't there open source frameworks for evaluating skills already? 
- **Yes, there are!** Like Nvidia's SkillEvaluator or the SkillsBench paper. Our evaluation methods are heavily based off of these proven methods. Terum doesn't try to reinvent the wheel, it just adopts the methods so that they're fully plug and play. SkillEvaluator requires Docker and an API key; SkillsBench requires you to bring your own tests. Terum runs using your subscription plan, with one terminal installation, using dynamically generated tests for the specific skill being tested(we're currently looking into dynamic generation along with category-specific tests). 

How are you evaluating skills?
- Answered above. For more specific notes on methodology, scroll to the bottom. 


Does any private information including skill usage, metadata, or information get out? 
- **Nope!** Fully open source, locally hosted. All skill data is yours and your team's. 




## Quick start

Requires Node 22.12+, `git`, and an authenticated GitHub CLI (`gh auth login`).

```sh
npx -y terum-skills@latest setup
```

There is no install step — `npx -y` fetches and runs the latest release every time. (Prefer a permanent `terum-skills` binary? See [Installing, updating, uninstalling](#installing-updating-uninstalling).)

Setup also offers the `/terum-skills` Claude Code skill, placed at `~/.claude/skills/terum-skills/`, so Claude Code can run these commands for you inside a session (and hand you the ones that need a terminal). It ships inside the npm package; re-running `npx -y terum-skills@latest setup` after an update refreshes it.

The default setup command will lead you towards creating a team. To join a team, ask the owner of a team to use `npx -y terum-skills@latest invite <your github username>`. They will receive a command that you can paste into your terminal. Or, if you know the organization name and repo name, you can run:

```sh
npx -y terum-skills@latest setup <org name>/<repo name>
```

## Commands

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

## How it works

**Your library is your folders.** `ls --local` scans `~/.claude/skills` (Global), every checkout registered with `checkout add`, and the repository you run it from. Each checkout also reports its `origin`, so the listing (and the app's Library header) says whether the folder has a GitHub home and which repository it is. Registering a folder only tells this machine to scan and refresh it; connecting a skill or approving a tool grant is still a separate yes.

**One repo, one copy of each skill.** The team repo holds `skills/<name>/` (the flat store, folder name equals frontmatter `name`, unique repo-wide), `team.json` (endorsed lists and policy), `people/<handle>.json` (each member's identity and installed list, the only file that member's installs touch), and `evals/` (committed receipts, keyed by skill id). A generated GitHub workflow runs the eval checks on PRs.

**Ownership is metadata.** Only the author named in a skill's `metadata.author` may change its folder; only you may write your people file; endorsed lists change through `publish` PRs. A pre-push guard enforces all of this, and every write goes through one `safeWrite` path that fetches, resets to `origin/main`, re-applies the change, and pushes, so two members writing at once never produce a merge conflict in generated files.

**Placement is a plain copy.** `install --into global` copies the skill into `~/.claude/skills/<name>`; `--into <checkout root>` chooses and registers a checkout’s `.claude/skills/`. `uninstall-skill --from global` or `--from <checkout root>` names the copy to remove. Each copy has a per-file fingerprint, and `sync` refreshes Global and registered checkouts from anywhere when the store changes. Hand-edited placed copies are moved to `~/.terum/skills/quarantine/`, never silently overwritten. `sync --prune` empties the quarantine.

**Connecting is consent.** `connect` shows the fields it will add to your SKILL.md (license, id, author, category) and asks y/N before writing anything. After that, `sync` mirrors your edits into the repo. If the repo copy and your source diverge, `sync` prints the remedy (`connect --keep-source <id>` or `--keep-repo <id>`) and does nothing until you choose. Skills containing hooks or plugin definitions need `--allow-privileged`.

**Global skills auto-share by ID check.** `sync` mirrors `~/.claude/skills` into the team repo by default (ratified 2026-09-10): a new skill folder there with no `metadata.id`, or an id the team repo does not know, is connected automatically — license, a freshly minted id (a foreign id is replaced; the skill uploads as the team's) and your authorship are stamped, and the folder is committed, with one summary line per run. A folder carrying a known team id is left alone: content changes flow only through the author's own connected-source sync, and installs live in your people file. Folders the connect machinery refuses (hygiene, a name collision) are skipped and reported by name. Project checkouts are never auto-shared — add them deliberately (the app's Add project, or `connect <path>`). To opt out, set `"auto_share": false` in `~/.terum/skills/config.json`.

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
- **Global:** `npm install -g terum-skills`. If `terum-skills: command not found`, add `$(npm prefix -g)/bin` (the prefix itself on Windows) to PATH.
- **Project-local:** `npm install terum-skills` puts the binary under `node_modules/.bin`; run it as `npx terum-skills …` from that folder.
- **Update:** `terum-skills update` prints this copy's version, the newest advertised release, and the exact command that updates *this* copy. It never runs a package manager. `npx -y terum-skills@latest` fetches the newest release every run and updates nothing else.
- **Uninstall:** `terum-skills uninstall` removes your team from this machine (placed skills, clone, cache), the session-start hook, the `/terum-skills` Claude Code skill it placed, and `~/.terum/skills` except its recovery data (`quarantine/`, `backups/`) and local eval runs (`evals/`); it also removes the downloaded desktop app bundle (`app/`), then prints the one package-manager line to finish. `uninstall-skill <skill>` removes one skill.

Release notices appear last on stderr, at most once per release per day, and are suppressed in CI, when stderr is piped, or when `NO_UPDATE_NOTIFIER` or `TERUM_SKILLS_NO_UPDATE_NOTIFIER` is set. Version checks read git tags from this repository only, never the npm registry, and only when a configured team is on GitHub.

## Desktop app (preview)

`terum-skills app` installs and opens the desktop app for the running CLI version, downloading the bundle
through `gh` when needed. The shipped Tauri shell drives the CLI over JSON frames; it records the CLI's
location on launch. The boards render real data as M7 lands, with unavailable read models reported explicitly.
Browser development still uses the mock backend. The app bundle is separate from the npm package.

Every app-spawned CLI child, including under `tauri dev`, has piped stderr and
`TERUM_SKILLS_NO_UPDATE_NOTIFIER=1`; `--frames` forces `noUpdateCheck`, and `update` is registered with
`notices: false`. Background terminal release notices are therefore suppressed in the app. Explicit update
checks still return release observations and installation-specific advice; and `app-update` gives the app its own channel for the app itself — it checks once per launch against the release advertisement the CLI already caches, downloads through `gh release download`, verifies the published SHA-256, and installs it the way Settings ▸ Updates says to: when you press Install now, when you quit, or overnight while the app is open and idle. It never updates the CLI.

## Releasing (maintainers)

A release is one deliberate action. Bump `version` in `package.json` and both `version` fields in `package-lock.json` in a reviewed PR, merge it, then run **Actions → Release** with the version and the full merged commit SHA (`dry_run` first). The workflow runs the gates, packs once with the commit stamped as `gitHead`, publishes to npm with provenance behind a reviewer-approved environment, verifies the registry serves those exact bytes, and only then creates the `v<version>` tag and a GitHub Release. Tags therefore advertise verified publications and are never moved; `release-drift.yml` checks every tag against the registry daily. A failed run is re-dispatched with the same inputs and finishes whatever step is missing.

## Troubleshooting

- **Created a team by mistake?** `npx -y terum-skills@latest team leave <accidental>` removes it from this machine, then run the setup command its owner sent you. Delete the repository on GitHub yourself.
- **git and gh signed in differently?** `gh auth setup-git --hostname github.com` makes git use gh's account.
- **A never-connected folder fails `validate` on HYG1.** The managed fields (`license`, `metadata.id`, `metadata.author`) are what `connect` adds; connect it first.
- **`sync` printed a divergence line.** Your source and the repo copy both changed. Pick `connect --keep-source <id>` or `connect --keep-repo <id>`; nothing moves until you do.

## License

Apache-2.0. `NOTICE` credits the skillhub modules the placer derives from.
