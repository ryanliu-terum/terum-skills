# What comes next for the public face of terum-skills

Notes left on 2026-09-15 when the README was cut from 408 lines to a landing page. None of this is
started. Each item should be written from the codebase and the product direction, not carved out of
the old README (the old text is in git history at `a01ccef0` if a fact needs checking).

## Asked for

- **Docs.** A `docs/` set written from scratch: evaluating skills (hygiene checks, case and trigger
  file formats, generated evals, the run phases, judge escalation, receipts), how the team repo
  works on disk (versions, people files, projects, install records), and a full CLI reference. The
  README has a `TODO(docs)` comment where the eval link goes.
- **Roadmap.** A public one, so the "Collaborate with us!" section has something to point
  collaborators at. Candidates already named in the README: the open skill marketplace ranked by
  effectiveness, category-specific generated tests.
- **Updated website.** terum.ai should say what the README says, with the same hero video and the
  one-line install.
- **Changelog / newsletter.** Releases already go through `release/<version>` PRs; a `CHANGELOG.md`
  can be generated from their bodies. A newsletter needs a home (Discord announcements channel is the
  zero-cost start).

## Suggestions

- **CONTRIBUTING.md.** The README invites collaborators but `AGENTS.md` is the only build/gate
  document, and it is written for agents. A short human one: clone, `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm test`,
  where the desktop app lives, how a PR gets merged.
- **Issue and PR templates** under `.github/`, so "feedback and things people want" arrive in a
  shape that can be triaged. A "skill request" template would match the marketplace direction.
- **Hero video and real screenshots.** The five images under `docs/images/` are mock-adapter
  renders with fixture names. Replace them with captures from a real team once one is presentable,
  at the same paths. The README's hero slot has instructions for the video.
- **Keep npm's README in step.** `package.json` ships `README.md` inside the tarball, so the npm
  page shows this file; relative image paths break there. Either use absolute
  `raw.githubusercontent.com` URLs for the images or accept broken images on npm.
- **Social preview image** for the repository (Settings ▸ Social preview), since the README is now
  something people will link to.
- **Version-pinned install line.** `@latest` is right for the README, but the docs should show
  `npx -y terum-skills@<version>` for teams that want reproducible setups.
- **Discord link ownership.** `https://discord.gg/SVVzejCf9` is in the README badge and prose; if
  the invite is regenerated, both spots need the new link.
