# Contributing to terum-skills

## Welcome

terum-skills is an Apache-2.0 CLI that lets a team share private Claude Code skills through one private git repository, with no server, plus a desktop app under `desktop/`. Contributions, bug reports and the things you want added are all welcome: join the Discord at [discord.gg/SVVzejCf9](https://discord.gg/SVVzejCf9) to talk to the maintainers, open a [GitHub issue](https://github.com/ryanliu-terum/terum-skills/issues), or email ryanliu@terum.ai directly. A security vulnerability goes to the private channel in [SECURITY.md](SECURITY.md) rather than a public issue.

## Setting up

The repository is one git checkout with two npm packages in it: the CLI at the root and the desktop app under `desktop/`. They have separate lockfiles, separate gates, and different Node versions.

```sh
git clone https://github.com/ryanliu-terum/terum-skills.git
cd terum-skills
npm ci
```

Use Node 22 for the root package (`engines.node` is `>=22.12.0`, and CI runs the root gates on Node 22) and Node 24 for `desktop/` (`engines.node` is `>=24`). Install with `npm ci`, not `npm install`: the lockfiles are what CI installs from.

The root has three gate commands:

```sh
npm run lint
npm run typecheck
npm test
```

There is no `npm run check` at the root. The three commands above, run after `npm ci`, are exactly what the `cli-gates` job in `.github/workflows/ci.yml` runs. Report their real output in your pull request. A self-reported green gate is a hypothesis the reviewer re-runs.

`ci.yml` runs three further jobs you cannot reproduce with those three commands: `mirrors` installs both trees on Node 24 and runs the desktop's `typecheck:mirrors`, `package` packs the tarball and installs it into a throwaway project, and `actionlint` lints the workflows in a pinned container (`ci.yml:41`, `:62`, `:94`).

The desktop package has its own aggregate gate:

```sh
cd desktop
npm ci
npm run check
```

`check` runs `typecheck`, `typecheck:mirrors`, `lint`, `test` and `e2e:routes` in that order. If you touch the CLI/desktop mirrors contract you need both trees installed, because `typecheck:mirrors` imports the desktop's zod schemas and the root commands' result types.

Two desktop gates are design-dependent and maintainer-only: `npm run check:design` runs `export:check` and `e2e:fidelity`, both of which read a private design canvas named by `TERUM_DESIGN_DIR`. That canvas is not part of this repository, so those gates skip or fail with a one-line message without it, and CI does not run them.

`e2e:routes` drives Playwright, so it needs a Chromium. The `Desktop` workflow installs its own with `npx playwright install --with-deps chromium` (`.github/workflows/desktop-ci.yml:44`). An agent working inside this repository's sandbox never installs one on a maintainer's machine (`desktop/AGENTS.md:70-73`).

## Repository layout

```
src/index.ts                      the bin entry: shebang, terminal Prompter, frame mode, exit code
src/cli.ts                        commander wiring only (buildProgram)
src/commands/                     the verb implementations, each exporting one run(args, io) entry point
src/lib/                          the seams and the domain (runner, prompt, teamRepo, guard, frames, …)
src/lib/evals/                    the eval engine: hygiene, generation, execution, judging, receipts
src/lib/misses/                   the miss screener behind `misses`: harvest, catalog, judge, reconcile
src/lib/placer.ts                 placement itself
src/lib/placer/                   agent-paths.ts and vendor/skillhub/ (two vendored files)
desktop/                          the desktop app: a separate npm package with its own gates and lockfile
scripts/                          build and release tooling (bundle-cli, bundle-skill, release-plan, …)
docs/                             the public documentation set, including docs/frame-protocol.md
.claude/skills/terum-skills/SKILL.md   the shipped manual, bundled into dist/ by npm run build
assets/claude/hooks/              the managed PostToolUse edit hook, also bundled into dist/
```

`.claude/` and `.planning/` are otherwise untracked harness directories. Three paths inside them are un-ignored explicitly in `.gitignore`: the skill manual that `npm run build` reads, the `hybrid-review` skill's authored eval assets, and `.planning/codex-runs/` for the frame recordings the tests replay (`.gitignore:11-31`).

## How the code is shaped

Every verb is one exported function with the same signature: `run(args, io)`, where `io` is a `Prompter`. It returns a `Result`, it never exits, and it never writes to a stream. `unpublish` exports the same shape under the name `runUnpublish`. The one real exception is `serve`, which owns the frame loop: `src/index.ts` calls it with the streams and it returns an exit code (`src/commands/serve.ts:16`, `src/index.ts:54-58`). Verbs are wired to commander in `src/cli.ts` and nowhere else, which is why `src/cli.ts` can be tested with stubbed verbs.

The Prompter is a boundary, and ESLint enforces it. `src/lib/prompt.ts` is the one implementation of the human channel and `src/index.ts` is the bin entry that owns the exit code. Both are exempt, as are the tests and the vendored files (`eslint.config.js:16`). Every other module under `src/` is banned from importing `readline`, `process` or `console`, from touching `process.stdin`, `process.stdout`, `process.stderr`, `process.exit` or `process.exitCode`, from reaching any of them through `globalThis`, and from aliasing or destructuring `process` first. The rule block is `PROMPTER_BOUNDARY` in `eslint.config.js`; it bans each of those in every spelling the tests probe, so working around it is a lint failure rather than a review argument.

Spawning has the same shape. `Runner` in `src/lib/runner.ts` narrows the product to exactly two commands, `git` and `gh`, and every verb takes one by injection so no test ever spawns the real `gh`. `Exec` is the single underlying spawner; only `app` and `app-update` inject it, to run the platform's own tools for unpacking, installing and opening the desktop app.

Every write to a team repository goes through `safeWrite()` in `src/lib/teamRepo.ts`: fetch, hard-reset the clone to `origin/main`, re-run a pure mutation, commit, push, and retry to a 30-second deadline. The mutation you pass it must be pure. One that does I/O, mints an ID or prompts is a bug, because it will be re-run. Inside that loop the write guard in `src/lib/guard.ts` checks the tree the mutation produced against the paths the caller is allowed to own, and `teamRepo` additionally proves the staged diff equals that tree's changes.

## The invariants

`AGENTS.md` owns these in full, and it wins over any comment or document that contradicts it. Read it before your first change. Its opening description of the repository predates `src/` and is out of date; the invariants are what it is read for. Abridged, one sentence each:

- Nothing runs anywhere but laptops and the git host: no HTTP client, no server, no daemon, no third-party CLI on the install path, and shelling out only to `git` and `gh`, with the `Exec` seam above as the one recorded exception.
- Every write to the team repo goes through `safeWrite()`, with a pure mutation that is safe to re-run.
- The guard is the authorization model: a diff may touch only the paths the caller owns, and no write path may bypass it.
- Consent is a predicate on the normalized `allowed-tools` set, so a changed grant hash is no approval.
- The `placements` ledger is provenance and the only source of deletable paths, so ownership is never inferred from what happens to be on disk.
- Placement is native and explicit: copy into a temp sibling and rename into place under the per-target lock, into the directory the agent path table names, never by auto-detecting an agent.
- Vendored code keeps its provenance, as an attribution header plus a `NOTICE` entry.
- Frontmatter is Agent-Skills-legal: top-level `name`, `description` and `license` only, with everything custom nested under `metadata`, and the skill folder name equal to the frontmatter `name`.
- One active path per behaviour: before writing a function, grep for one that already does the job and extend or replace it in the same change.

`AGENTS.md` also has a "Things that look wrong and are not" section. Read it before filing something as a bug or proposing to "fix" it in review.

## Tests

Tests are collocated: vitest collects `src/**/__tests__/**/*.test.ts` and nothing else. A verb's tests live beside the verb.

The suite is hermetic by construction, and that is a rule rather than a habit. It must not depend on, or touch, your ambient state. `vitest.config.ts` neutralizes git's global and system configuration, disables terminal prompts, and `src/lib/__tests__/setup.ts` deletes every `GIT_*` and `GH_*` variable that could leak in, then points `HOME`, `USERPROFILE` and `GH_CONFIG_DIR` at a throwaway directory created per worker. Every fixture directory is registered and removed after the test that created it.

Nothing in the suite touches the network. `bareTeam()` in `src/lib/__tests__/fixtures.ts` builds a local bare repository with a seeded `team.json`, `people/` and empty `skills/` and `evals/`, and clones from it. A test that reaches a network remote is a policy violation, not a slow test.

The seams have named fakes, all in `src/lib/__tests__/fixtures.ts`:

| Fake | What it is for |
| --- | --- |
| `ScriptedPrompter` | Scripted answers, and it records every question. It throws `PromptClosedError` when the script runs out, so an over-asking verb fails loudly. |
| `NonInteractivePrompter` | A non-TTY channel where any prompt is a test failure. |
| `mappedRunner` | Maps a public-looking remote to the local bare fixture in both directions and records every call. |
| `fakeGh` | Models gh's real auth semantics: an `api` call succeeds only when logged in or when `GH_TOKEN` is in the child env. |
| `noGhRunner` | A machine with no `gh` at all, where the spawn fails with `ENOENT`. |
| `denyingRunner` | Refuses every spawn that is not explicitly allow-listed, so an unexpected child process is a loud failure. |
| `wrapRunner` | Wraps a runner so a hook can act before, or instead of, a matching command. |

Some tests are slow because they build the package. `src/__tests__/bin.test.ts` compiles the whole tree with the repo's own `tsc` into a scratch directory in `beforeAll`, and `src/__tests__/bundle.test.ts` does that and then runs `scripts/bundle-cli.mjs` and `scripts/bundle-skill.mjs` into it. Both build into their own scratch directory on purpose, so the suite never reads the repository's `dist/`. This is why the vitest hook timeout is raised to 120 seconds alongside the test timeout.

On a small machine, run the suite with fewer workers:

```sh
npm test -- --maxWorkers=2
```

## Documentation gates

Several tests in the root suite read documentation as text and fail when it drifts from the code. They are gates, not style checks, and they run on every batch.

### The invocation tripwire

`src/lib/__tests__/invocation-tripwire.test.ts` inventories every line of `README.md`, `SECURITY.md`, every `*.md` under `docs/`, and the shipped manual at `.claude/skills/terum-skills/SKILL.md` that names the package, names any verb in the commander tree, or carries an `"argv"` key. Every such line must have a matching row in `src/lib/__tests__/invocation-catalog.ts`. The comparison is on file plus trimmed line content, and it checks multiplicity, so adding, removing or editing one of those lines requires a catalogue edit in the same commit.

Regenerate the document rows rather than hand-editing them:

```sh
npm run build
node scripts/invocation-catalog.mjs
```

`npm run build` first, because the generator loads the command tree from `dist/cli.js`. Without it the script exits 2 and says so on stderr. `node scripts/invocation-catalog.mjs --check` reports drift without writing, which is what you run when you want to know whether a doc change needs a catalogue commit. Commit the catalogue diff together with the documentation change.

The source half of the catalogue, the rows for files under `src/`, stays hand-maintained. The generator does not touch it. When you add a line in `src/` that names the package or a verb, add its row yourself and give it the right `policy` value. `SECURITY.md` is in the generator's document list, like `README.md` and the shipped manual, so its rows regenerate with the rest.

### The README command-coverage test

`src/__tests__/cli.test.ts` walks the commander tree and, for each command, builds its full path such as `team project create`. That path must appear in a single-backtick code span in `README.md`, either as the whole span or as the span's prefix followed by a space, if and only if the command is visible in help. A hidden verb that shows up in a code span fails the same test. If you make a verb visible, hidden, or renamed, the README's "All commands" table changes in the same commit.

### The documentation-link gate

`src/lib/__tests__/docs-links.test.ts` reads `README.md`, every `*.md` under `docs/`, and `CONTRIBUTING.md` and `CHANGELOG.md` when they exist. Every relative link in them must resolve to a file in the repository, and every `#fragment` must name a heading in the target file, slugged the way GitHub slugs one. Links inside fenced blocks and inline code spans are ignored, and no external link is fetched: this is a rot check for the tree, not a network check. Renaming a heading another page links to fails here.

### The two frame-protocol gates

`src/lib/__tests__/frames.test.ts` reads `docs/frame-protocol.md` twice. The line that begins `` `hello.features` names `` must name every key of `FRAME_FEATURES` as a code span. The first JSON block under the `## Versioning` heading must parse to exactly `FRAME_VERBS`. A third test in the same file pins `FRAME_VERBS` itself to the commander inventory of non-hidden action-bearing commands, minus `team migrate`, which is excluded from the app protocol because migration is a human's terminal operation.

### The release-asset gate

`src/lib/__tests__/platform.test.ts` reads `.github/workflows/release.yml` and asserts that it names exactly the four asset suffixes the platform module derives, and exactly four of them. A renamed or added desktop matrix entry fails the unit suite here rather than failing a user's download.

### The two desktop tripwires

`src/lib/__tests__/feature-keys-tripwire.test.ts` and `src/lib/__tests__/desktop-verbs-tripwire.test.ts` read `desktop/src/backend/types.ts` and `desktop/src/backend/tauri/index.ts` as text from the root suite. The first requires `FEATURE_KEYS` and `FRAME_FEATURES` to hold the same keys in both directions. The second requires every verb prefix the desktop adapter spawns to be a verb in `FRAME_VERBS`.

They live in the root suite deliberately. Root gates run on every change; the `Desktop` workflow's `desktop-gates` job is path-filtered to `desktop/**` and its own workflow file, and the break these catch is usually a CLI-side rename made in a batch that never opens the desktop tree.

## Adding or renaming a verb

Beyond its own file under `src/commands/`, a verb has a five-place blast radius. Touch all five in the same change:

1. `src/cli.ts`, for the commander registration.
2. `FRAME_VERBS` in `src/lib/frames.ts`, the inventory the `hello` frame advertises.
3. The JSON block under `## Versioning` in `docs/frame-protocol.md`.
4. The "All commands" table in `README.md`.
5. `src/lib/__tests__/invocation-catalog.ts`, regenerated for the document rows.

`misses` is the most recent verb to go through that list, and it touched those five places and nothing else outside its own files and tests (`git show --stat 903c5611`).

A verb the desktop app should be able to run joins one more list: `SERVE_READ_VERBS` in `src/lib/serve-verbs.ts`, which is the only thing `serve` checks before it refuses a request (`src/commands/serve.ts:61`). Leave a verb out of it when it takes the clone writer lock or spends model calls; `misses` is out for the second reason.

Adding a feature key adds three more: `FRAME_FEATURES` in `src/lib/frames.ts`, the line that begins `` `hello.features` names `` in `docs/frame-protocol.md`, which `frames.test.ts` pins to every key, and `FEATURE_KEYS` in `desktop/src/backend/types.ts`. That documentation line names verbs, so the catalogue in place 5 regenerates with it. Nothing guards the desktop's read of a feature key at runtime, so a key renamed on one side and not the other reads `false` forever and hides the control it gates. The tripwire is the only thing that catches it.

## Pull requests

Branch from `main`. Name the branch by kind: `feat/`, `fix/`, `docs/`, `ci/`, `refactor/` or `chore/`, plus a short slug. Releases use `release/<version>`.

Title the pull request as a conventional commit, with a scope where one applies, for example `fix(cli,desktop): keep the adapter on registered verbs`. Use the same convention for commits on the branch.

Write a body that says what changed and why, in prose, before any list. Then a `## Test plan` checklist with the real output of the gates you ran, counts included, not a claim that they pass:

```md
## Test plan

- [x] `npm run lint` clean
- [x] `npm run typecheck` clean
- [x] `npm test` N passed
- [x] `node scripts/invocation-catalog.mjs --check` clean
- [ ] CI green on this PR
```

Merge with a merge commit rather than a squash. The `validate` job in `release.yml` will only release a commit that GitHub reports a merged pull request for, or that has two parents, so the history this repository releases from has to be a reviewed-merge history. Merge commits satisfy that gate unambiguously.

Never `git push --no-verify`.

Releases are their own procedure, and a maintainer runs them. See [docs/contributing/release.md](docs/contributing/release.md).

## Vendored code

`src/lib/placer/vendor/skillhub/` holds exactly two files copied from [iflytek/skillhub](https://github.com/iflytek/skillhub) `cli/src/services/` at the pinned commit `61aa957ecc45e6c3672d11e0c48c13bd601f15c5`: `skill-fingerprint.ts` and `skill-target-lock.ts`, both Apache-2.0.

Upstream carries no per-file copyright header, so each copy gets one. The header names the upstream source path, the pinned commit, the license, whether the file was modified, and what the modification was. `NOTICE` carries a matching entry for each file. If you add a vendored file, or change what a vendored file was modified to do, update both the header and `NOTICE` in the same commit.

The directory is excluded from ESLint, so the copies keep upstream's style. Do not reformat them and do not vendor skillhub's auto-detect, prompt, or in-folder metadata code. The Claude Code path row in `src/lib/placer/agent-paths.ts` is derived from skillhub's profile, not copied from it.

## License

Apache-2.0. The full text is in `LICENSE`. `NOTICE` carries this project's copyright line and the skillhub attribution. Both ship in the npm tarball, and both the `package` job in `ci.yml` and the `build` job in `release.yml` fail if either is missing from it. By contributing you agree that your contribution is licensed under Apache-2.0.
