# Security

What terum-skills runs on your machine, when, and how a release is built and checked. Written so
you can verify each claim yourself; every command below is one you can run.

## What runs on your machine

The two hooks are opt-in at `terum-skills setup`, each with its own y/N; the eight skills are placed
by every `setup` run. Everything is removed by `terum-skills uninstall`.

| Piece | When it runs | What it runs | What it touches |
| --- | --- | --- | --- |
| Session hook | Once per Claude Code session start, in the background, at most once an hour per team | The copy of the CLI that set it up (see *Pinned, not latest*) with `sync --hook` | Fetches your team's private git repository into `~/.terum/skills`; refreshes skills it placed under `~/.claude/skills/` and the two files below; uploads nothing |
| The eight skills | Only when Claude Code or Codex decides one applies, or you invoke it | The CLI verb the skill describes, in the same pinned spelling | Whatever the verb does; verbs that ask a question are handed to your terminal instead |
| Edit hook | After Claude Code writes or edits a file | A small script placed under `~/.terum/skills`, run with the `node` on your PATH | Prints one reminder when the file is inside a `.claude/skills/` folder; writes nothing |
| Desktop app | When you open it | The app bundle, which drives the same CLI as a separate process | The same paths as the CLI |

The CLI never runs a package manager on your behalf. `terum-skills update` prints the command that
updates your copy; you run it.

## Pinned, not latest

The session hook and the placed skills name the copy of the CLI that installed them:
the bare `terum-skills` binary when you installed the package globally, otherwise
`npx -y terum-skills@<version>` with the exact version that ran `setup`. Nothing on this machine
fetches a newer CLI at session start. A newer release reaches you when you update the package
yourself and, for the pinned `npx` spelling, re-run `setup` so the hook and the skills move with it.

Releases before 0.21 wrote `npx -y terum-skills@latest` into the hook. The first session hook run of
0.21 or later re-points that entry at the running copy, once, and says so on stderr; it edits only
its own entry in `~/.claude/settings.json`, keeps a backup under `~/.terum/skills/backups/`, and
installs nothing where you declined the hook.

To see what your hook runs:

```sh
grep -n terum-skills ~/.claude/settings.json
```

## How a release is built

- **One workflow, dispatched by hand.** `.github/workflows/release.yml` runs only on a manual
  dispatch naming a version and the full commit SHA on `main`, behind a GitHub environment with a
  required reviewer. No tag, Release, or npm publish happens any other way.
- **No long-lived npm token.** The package is published with npm trusted publishing (OIDC from that
  workflow), so there is no npm credential to steal. Every version carries an npm provenance
  attestation, and the workflow refuses to tag until the registry serves the exact bytes it packed
  with a `gitHead` equal to the dispatched commit.
- **The desktop app is built in the same run**, on GitHub-hosted macOS and Windows runners, and
  attached to the same GitHub Release. Each asset gets a build-provenance attestation
  (`actions/attest-build-provenance`) recorded by GitHub against this repository.

## How a download is checked

`terum-skills app` and `app-update` download the app for the CLI's own version through
`gh release download` and then require two independent checks to pass, or the download is
discarded and named:

1. The asset's SHA-256 matches the `.sha256` file beside it. This catches a damaged download.
2. `gh attestation verify <asset> --repo ryanliu-terum/terum-skills` succeeds. This checks the
   build-provenance attestation GitHub recorded when the release workflow produced those bytes, so
   an asset replaced on the Release, even together with its checksum, is refused. It needs gh 2.49
   or newer.

To check a release yourself, for the npm package and for an app asset:

```sh
npm audit signatures            # in a project where terum-skills is installed
gh attestation verify terum-skills-desktop_<version>_<suffix> --repo ryanliu-terum/terum-skills
```

## What is not covered yet

- **The macOS app is ad-hoc signed and not notarized**, and the CLI installs it through gh, which
  leaves no quarantine flag, so Gatekeeper never assesses it. The attestation check above is the
  check that stands in. Developer ID signing and notarization are an open decision.
- **A malicious commit on `main`** by someone holding the maintainer's GitHub account would be
  built and attested like any other. Provenance ties a release to a public commit; it does not
  judge the commit. Review the diff between tags before updating if that matters to you.
- **Skill content itself.** A skill your team publishes is text Claude Code reads; terum-skills
  validates its shape and refuses hooks and plugin definitions without `--allow-privileged`, and
  does not otherwise judge what a skill asks Claude to do.

## Reporting

Report a vulnerability privately through GitHub's *Report a vulnerability* on this repository, or
by email to the address on the npm package page. Please do not open a public issue for it first.
