/** B7: explicit source and documentation invocation policy.
 * Exact trimmed line patterns prevent file-wide exemptions, including the shipped manual.
 * Line numbers are informational; the tripwire matches file AND content and checks multiplicity.
 */
export const invocationLiteralCatalog: readonly { file: string; line: number; policy: 'routed' | 'fixed' | 'prose' | 'not-a-hint'; pattern: string }[] = [
  {
    file: 'src/commands/teamMigrate.ts',
    line: 26,
    policy: 'prose',
    pattern: '/** §13: terum-skills team migrate. Terminal-only; a human runs it after the B1 release propagates. */',
  },
  {
    "file": "src/cli.ts",
    "line": 44,
    "policy": "not-a-hint",
    "pattern": "program.name('terum-skills').description('Share private Claude Code skills through a team git repository.').exitOverride();"
  },
  {
    "file": "src/cli.ts",
    "line": 168,
    "policy": "prose",
    "pattern": "program.command('uninstall').description('Remove terum-skills from this machine: your team (placed skills, local clone, cache), the session-start hook and the /terum-skills Claude Code skill if present, and ~/.terum/skills except recovery data; then prints the package-manager step').allowExcessArguments().action(async (_options: Record<string, never>, command: Command) => execute(async (io) => command.args.length ? failure(`To remove a skill, use \\`${invocation(context.form, 'uninstall-skill <ref>')}\\`.`) : active.uninstallMachine({ launch: context.launch, form: context.form }, io), { verb: 'uninstall', notices: true }));"
  },
  {
    "file": "src/commands/eval.ts",
    "line": 341,
    "policy": "prose",
    "pattern": "// HEAD is not engine provenance (§5.3: \"terum-skills commit of the running CLI\"; review P2)."
  },
  {
    "file": "src/commands/guardPush.ts",
    "line": 68,
    "policy": "not-a-hint",
    "pattern": "if (checked) io.print(`terum-skills push guard: ${checked} path(s) to ${stripRemoteCredentials(args.url)} are yours.`);"
  },
  {
    "file": "src/commands/install.ts",
    "line": 40,
    "policy": "prose",
    "pattern": "/** Where that bootstrap offers the bundled /terum-skills Claude Code skill (test knob). */"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 57,
    "policy": "prose",
    "pattern": "/** Optional global install so the bare `terum-skills` command exists on the teammate's machine (Ryan, 2026-09-06); the npx line below works without it. */"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 58,
    "policy": "fixed",
    "pattern": "export const GLOBAL_INSTALL = 'npm install -g terum-skills';"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 60,
    "policy": "fixed",
    "pattern": "export function joinCommand(target: string): string { return `npx -y terum-skills@latest setup ${target}`; }"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 65,
    "policy": "fixed",
    "pattern": "return [`Send this to your teammate:`, '```', GLOBAL_INSTALL, joinCommand(ownerRepo), '', `Bare equivalent: npx -y terum-skills@latest team join ${ownerRepo}`, '```', 'If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.'];"
  },
  {
    "file": "src/commands/leave.ts",
    "line": 62,
    "policy": "not-a-hint",
    "pattern": "if (!releaseTeam) throw new Error(`Another terum-skills sync holds the session lock on ${name} (${lockPath(store.root, name)}); retry when it finishes, or remove that file if no session is syncing.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 171,
    "policy": "prose",
    "pattern": "if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/publish.ts",
    "line": 163,
    "policy": "prose",
    "pattern": "if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/readme.ts",
    "line": 38,
    "policy": "not-a-hint",
    "pattern": "const comment = ['<!-- terum-skills:pr-comment -->', '## terum-skills publish preview', ...(skills.length ? skills.map((skill) => `- ${inlineText(skill.name)} (${inlineText(skill.category)})`) : ['- No new endorsements.'])].join('\\n');"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 65,
    "policy": "prose",
    "pattern": "/** Where the bundled /terum-skills Claude Code skill is offered from and placed (test knob). */"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 81,
    "policy": "prose",
    "pattern": "'Welcome to terum-skills.',"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 83,
    "policy": "prose",
    "pattern": "'This wizard helps you create a team, join one, invite teammates, and offer the session hook, the /terum-skills Claude Code skill and a reminder to publish a skill after Claude edits one; re-run it any time to continue, and leave the invitation question blank to skip it.',"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 138,
    "policy": "prose",
    "pattern": "`Setup stopped here, so the project, eval, session hook, /terum-skills and edit-hook steps were not offered \u2014 run \\`${invocation(form, 'setup')}\\` again to finish.`,"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 425,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill ships inside this package, and setup is the one onboarding"
  },
  {
    "file": "src/commands/status.ts",
    "line": 51,
    "policy": "not-a-hint",
    "pattern": "io.print(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 81,
    "policy": "not-a-hint",
    "pattern": "io.print('Commit this to .github/workflows/terum-skills.yml in an ordinary PR by someone with push access.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 94,
    "policy": "fixed",
    "pattern": "if (targetHandle === binding.handle) throw new Error('You cannot remove yourself; run team leave <team> to leave this machine, or ask another admin to remove you.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 154,
    "policy": "fixed",
    "pattern": "throw new Error(`${targetHandle} is archived; @${login}'s access could not be revoked: ${reason}. Re-run team remove ${targetHandle} to retry.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 171,
    "policy": "prose",
    "pattern": "if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/refresh.ts",
    "line": 95,
    "policy": "prose",
    "pattern": "notices.push('Updated your /terum-skills manual for this CLI.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 402,
    "policy": "prose",
    "pattern": "if (teamJson === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 494,
    "policy": "prose",
    "pattern": "return 'Ignored the credential embedded in the remote URL: terum-skills never stores one or passes one to git. Git access uses your configured Git credentials.';"
  },
  {
    "file": "src/commands/team.ts",
    "line": 543,
    "policy": "not-a-hint",
    "pattern": "await writeFile(pathJoin(staging, 'README.md'), `# ${teamName} skills\\n\\n<!-- terum-skills:begin -->\\n<!-- terum-skills:end -->\\n`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 544,
    "policy": "not-a-hint",
    "pattern": "await writeFile(pathJoin(staging, '.github', 'workflows', 'terum-skills.yml'), WORKFLOW);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 560,
    "policy": "fixed",
    "pattern": "export const WORKFLOW = `# This workflow requires published terum-skills npm artifacts (M4)."
  },
  {
    "file": "src/commands/team.ts",
    "line": 561,
    "policy": "fixed",
    "pattern": "name: terum-skills"
  },
  {
    "file": "src/commands/team.ts",
    "line": 588,
    "policy": "fixed",
    "pattern": "[ -z \"$name\" ] || [ ! -d \"skills/$name\" ] || npx -y terum-skills@latest validate \"$name\" --cwd ."
  },
  {
    "file": "src/commands/team.ts",
    "line": 599,
    "policy": "fixed",
    "pattern": "- run: npx -y terum-skills@latest receipt-check --base origin/main"
  },
  {
    "file": "src/commands/team.ts",
    "line": 607,
    "policy": "fixed",
    "pattern": "- run: npx -y terum-skills@latest readme"
  },
  {
    "file": "src/commands/team.ts",
    "line": 628,
    "policy": "fixed",
    "pattern": "run: npx -y terum-skills@latest readme --pr-comment origin/main > /tmp/terum-skills-comment.md"
  },
  {
    "file": "src/commands/team.ts",
    "line": 633,
    "policy": "fixed",
    "pattern": "existing=$(gh api \"repos/\\${{ github.repository }}/issues/$PR/comments\" --paginate --jq '.[] | select(.body | contains(\"<!-- terum-skills:pr-comment -->\")) | .id' | head -n 1)"
  },
  {
    "file": "src/commands/team.ts",
    "line": 634,
    "policy": "fixed",
    "pattern": "body=$(cat /tmp/terum-skills-comment.md)"
  },
  {
    "file": "src/commands/team.ts",
    "line": 115,
    "policy": "fixed",
    "pattern": "if (typeof targetRaw.github !== 'string' || targetRaw.github.trim() === '') throw new Error(`${targetHandle} has no GitHub login on the roster, so there is no host access to revoke; run \\`team remove ${targetHandle} --archive-only\\` to archive the membership.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 361,
    "policy": "fixed",
    "pattern": "catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} Your roster entry people/${identity.handle}.json was already pushed to ${normalized}; run \\`${invocation(args.form, 'team join', args.target)}\\` again to continue under the existing entry, or ask an admin to \\`team remove ${identity.handle}\\` if you did not mean to join twice.`); }"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 34,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill setup placed: only a copy carrying our marker is ours to remove."
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 54,
    "policy": "prose",
    "pattern": "detail.push('terum-skills will be removed from this machine.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 67,
    "policy": "not-a-hint",
    "pattern": "if (wrapperPresence.kind === 'foreign') detail.push(`  ${wrapperDir} is not the bundled /terum-skills Claude Code skill (${wrapperPresence.why}); left alone`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 68,
    "policy": "not-a-hint",
    "pattern": "else detail.push(`  ${wrapperPresence.kind === 'managed' ? '/terum-skills Claude Code skill at' : 'No /terum-skills Claude Code skill at'} ${wrapperDir}`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 76,
    "policy": "fixed",
    "pattern": "detail.push('Your membership and installed-skill records in the team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 78,
    "policy": "prose",
    "pattern": "if (!(await io.confirm('Remove terum-skills from this machine?', { detail }))) return cancelled('Uninstall was cancelled.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 84,
    "policy": "prose",
    "pattern": "io.print(`Wrote a record of this machine's terum-skills state to ${record}.`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 96,
    "policy": "not-a-hint",
    "pattern": "catch (error) { return failure(`${message(error)}; the /terum-skills skill was left in place and nothing else was removed`); }"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 97,
    "policy": "not-a-hint",
    "pattern": "if (wrapperRemoved) io.print(`Removed the /terum-skills Claude Code skill from ${wrapperDir}.`);"
  },
  {
    "file": "src/commands/update.ts",
    "line": 26,
    "policy": "not-a-hint",
    "pattern": "const lines = [`terum-skills ${running ?? 'version unknown'}`, `This copy: ${path}`];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 46,
    "policy": "fixed",
    "pattern": "case 'global': return ['If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 47,
    "policy": "fixed",
    "pattern": "case 'local': return [`If managed with npm, run in ${launch.root}:`, `  npm install ${launch.dependencyKind === 'devDependencies' ? '--save-dev ' : ''}terum-skills@latest`];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 48,
    "policy": "fixed",
    "pattern": "case 'npx': return [`Cache request recorded as: ${launch.request ?? 'unknown'}`, \"To request the registry's latest release, run:\", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 50,
    "policy": "fixed",
    "pattern": "default: return ['Installation method could not be established.', 'Update this copy with the tool that installed it.', \"To run the registry's latest release:\", '  npx -y terum-skills@latest <command>'];"
  },
  {
    "file": "src/index.ts",
    "line": 25,
    "policy": "prose",
    "pattern": "// A reader that closes early (`terum-skills ls | head -5`) surfaces as an asynchronous 'error' on"
  },
  {
    "file": "src/lib/evals/generate.ts",
    "line": 11,
    "policy": "not-a-hint",
    "pattern": "const HEADER = '# generated by terum-skills eval-gen — review before trusting';"
  },
  {
    "file": "src/lib/frames.ts",
    "line": 71,
    "policy": "not-a-hint",
    "pattern": "return verb || operands[0] || 'terum-skills';"
  },
  {
    "file": "src/lib/hook.ts",
    "line": 12,
    "policy": "fixed",
    "pattern": "export const HOOK_COMMAND = 'npx -y terum-skills@latest sync --hook';"
  },
  {
    "file": "src/lib/hook.ts",
    "line": 29,
    "policy": "not-a-hint",
    "pattern": "return typeof command === 'string' && command.includes('terum-skills');"
  },
  {
    "file": "src/lib/invocation.ts",
    "line": 7,
    "policy": "routed",
    "pattern": "export const NPX_PREFIX = 'npx -y terum-skills@latest';"
  },
  {
    "file": "src/lib/invocation.ts",
    "line": 27,
    "policy": "not-a-hint",
    "pattern": "const candidate = join(entry, 'terum-skills');"
  },
  {
    "file": "src/lib/invocation.ts",
    "line": 49,
    "policy": "routed",
    "pattern": "return [form === 'bare' ? 'terum-skills' : NPX_PREFIX, verb, ...args.map((arg) => typeof arg === 'string' ? shellQuote(arg) : arg.raw)].join(' ');"
  },
  {
    "file": "src/lib/launch.ts",
    "line": 57,
    "policy": "prose",
    "pattern": "const location = `This copy of terum-skills runs from ${launch?.path || 'an unknown location'}.`;"
  },
  {
    "file": "src/lib/launch.ts",
    "line": 59,
    "policy": "fixed",
    "pattern": "case 'global': return [location, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)'];"
  },
  {
    "file": "src/lib/launch.ts",
    "line": 60,
    "policy": "fixed",
    "pattern": "case 'local': return [location, `It is a dependency of ${launch.root}: run npm uninstall terum-skills there, or remove it from that package.json.`];"
  },
  {
    "file": "src/lib/launch.ts",
    "line": 61,
    "policy": "fixed",
    "pattern": "case 'npx': return [location, 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.'];"
  },
  {
    "file": "src/lib/local-skills.ts",
    "line": 132,
    "policy": "prose",
    "pattern": "reject('inside-state-root', `inside the terum-skills state directory ${options.stateRoot}`);"
  },
  {
    "file": "src/lib/package.ts",
    "line": 5,
    "policy": "not-a-hint",
    "pattern": "export const PACKAGE_NAME = 'terum-skills';"
  },
  {
    "file": "src/lib/package.ts",
    "line": 6,
    "policy": "not-a-hint",
    "pattern": "export const APPROVED_UPSTREAM = 'https://github.com/ryanliu-terum/terum-skills.git';"
  },
  {
    "file": "src/lib/placer/vendor/skillhub/skill-target-lock.ts",
    "line": 61,
    "policy": "not-a-hint",
    "pattern": "const lockDir = join(tmpdir(), `terum-skills-target-locks-${uid}`)"
  },
  {
    "file": "src/lib/readme.ts",
    "line": 14,
    "policy": "not-a-hint",
    "pattern": "export const README_BEGIN = '<!-- terum-skills:begin -->';"
  },
  {
    "file": "src/lib/readme.ts",
    "line": 15,
    "policy": "not-a-hint",
    "pattern": "export const README_END = '<!-- terum-skills:end -->';"
  },
  {
    "file": "src/lib/readme.ts",
    "line": 115,
    "policy": "fixed",
    "pattern": "const command = repo && isSkillName(skill.name) ? `\\`npx -y terum-skills@latest install ${repo}/${skill.name}\\`` : '—';"
  },
  {
    "file": "src/lib/remote.ts",
    "line": 234,
    "policy": "prose",
    "pattern": "if (credentials) return \"Git has no usable HTTPS credentials for github.com (terum-skills runs git without a terminal prompt).\\nStore one with your Git credential helper, or run `gh auth setup-git --hostname github.com` so gh's active account supplies them, then retry.\";"
  },
  {
    "file": "src/lib/runner.ts",
    "line": 90,
    "policy": "not-a-hint",
    "pattern": "resolve({ code: expired ? 124 : code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: expired ? `terum-skills: ${command} ${verb} exceeded ${options.deadlineMs! / 1000} s` : Buffer.concat(err).toString('utf8') });"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 22,
    "policy": "prose",
    "pattern": "throw new Error(`${source} is inside the terum-skills state directory ${stateRoot}; move the folder elsewhere and connect that path.`);"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 58,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill ships inside this package and is placed by setup; it is not a"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 60,
    "policy": "not-a-hint",
    "pattern": "if (isManagedFrontmatter(parsed)) return reject('managed-wrapper', 'the /terum-skills Claude Code skill that ships with terum-skills; not a team skill', 'This folder is the /terum-skills Claude Code skill that ships with terum-skills and is placed by setup; it cannot be connected to a team.');"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 79,
    "policy": "prose",
    "pattern": "/** Another terum-skills process holds this clone's writer lock. A per-team caller (sync) skips the team and continues; a single-clone verb (publish) fails. */"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 503,
    "policy": "fixed",
    "pattern": "const launch = launcher ? `${shellQuote(launcher.node)} ${shellQuote(launcher.entry)} guard-push` : `npx -y ${shellQuote(`terum-skills@${packageVersion() ?? 'latest'}`)} guard-push`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 504,
    "policy": "fixed",
    "pattern": "const warning = `terum-skills push guard: ${launcher ? launcher.entry : 'npx'} is gone, so this push was NOT checked. Re-run \\`npx -y terum-skills@latest team join <remote>\\` to re-arm it.`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 507,
    "policy": "not-a-hint",
    "pattern": "'# terum-skills: the D12 ownership guard for a raw push from this clone. Regenerated on every join; do not edit.',"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 636,
    "policy": "not-a-hint",
    "pattern": "if (now() >= deadline) throw new CloneBusy(`Another terum-skills operation holds the write lock on ${options.label ?? root}; retry when it finishes.`);"
  },
  {
    "file": "src/lib/update.ts",
    "line": 167,
    "policy": "prose",
    "pattern": "const prefix = `Newer terum-skills release ${candidate.source === 'git-tags' ? 'advertised' : 'observed'}: ${candidate.version} (running ${running}). `;"
  },
  {
    "file": "src/lib/update.ts",
    "line": 168,
    "policy": "fixed",
    "pattern": "if (launch?.kind === 'local') return `${prefix}If installed locally with npm, run npm install ${launch.dependencyKind === 'devDependencies' ? '--save-dev ' : ''}terum-skills@latest in ${launch.root}.`;"
  },
  {
    "file": "src/lib/update.ts",
    "line": 169,
    "policy": "fixed",
    "pattern": "if (launch?.kind === 'global') return `${prefix}If installed globally with npm, run npm install -g terum-skills@latest.`;"
  },
  {
    "file": "src/lib/update.ts",
    "line": 170,
    "policy": "fixed",
    "pattern": "return `${prefix}This copy: ${launch?.path ?? 'unknown'}. Run the latest release with npx -y terum-skills@latest <command>.`;"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 13,
    "policy": "prose",
    "pattern": "* The `/terum-skills` Claude Code skill: the SKILL.md that teaches Claude Code which verbs it may"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 15,
    "policy": "prose",
    "pattern": "* `scripts/bundle-skill.mjs` into dist/claude/skills/terum-skills/SKILL.md at build time, from the"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 16,
    "policy": "prose",
    "pattern": "* one canonical copy at .claude/skills/terum-skills/SKILL.md) and is placed under the user's global"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 22,
    "policy": "not-a-hint",
    "pattern": "export const WRAPPER_NAME = 'terum-skills';"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 23,
    "policy": "not-a-hint",
    "pattern": "export const MANAGED_BY = 'terum-skills';"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 25,
    "policy": "not-a-hint",
    "pattern": "export const BUNDLED_WRAPPER = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills', 'terum-skills', 'SKILL.md');"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 35,
    "policy": "prose",
    "pattern": "/** The idempotency key on parsed frontmatter: `name: terum-skills` plus `metadata.managed-by: terum-skills`. */"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 55,
    "policy": "prose",
    "pattern": "* What sits at `<skillsRoot>/terum-skills`. Judged without following links (the repo's rule for"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 94,
    "policy": "not-a-hint",
    "pattern": "if (bundled === null) throw new Error(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}).`);"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 97,
    "policy": "not-a-hint",
    "pattern": "if (presence.kind === 'foreign') throw new Error(`${directory} exists and is not the bundled /terum-skills skill (${presence.why}); move it aside and re-run.`);"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 132,
    "policy": "not-a-hint",
    "pattern": "if (state === 'unavailable') { io.print(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}); skipped.`); return 'unavailable'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 133,
    "policy": "not-a-hint",
    "pattern": "if (state === 'foreign') { io.print(`${directory} exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.`); return 'foreign'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 134,
    "policy": "not-a-hint",
    "pattern": "if (state === 'current') { io.print(`The /terum-skills Claude Code skill at ${directory} is current.`); return 'present'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 135,
    "policy": "not-a-hint",
    "pattern": "if (state === 'outdated') { await installWrapper(options); io.print(`Updated the /terum-skills Claude Code skill at ${directory}.`); return 'replaced'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 136,
    "policy": "not-a-hint",
    "pattern": "if (!(await io.confirm(`Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${directory})`))) {"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 137,
    "policy": "not-a-hint",
    "pattern": "io.print('Skipped the /terum-skills skill; re-run setup to install it later.');"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 141,
    "policy": "not-a-hint",
    "pattern": "io.print(`Installed the /terum-skills Claude Code skill at ${directory}.`);"
  },
  {
    "file": "src/commands/app.ts",
    "line": 17,
    "policy": "prose",
    "pattern": "* `terum-skills app` (decision walk 2026-09-08, D1 D3 D7 D8): make sure this version's desktop app is on the"
  },
  {
    "file": "src/commands/app.ts",
    "line": 23,
    "policy": "not-a-hint",
    "pattern": "export const APP_REPOSITORY = 'ryanliu-terum/terum-skills';"
  },
  {
    "file": "src/commands/app.ts",
    "line": 24,
    "policy": "not-a-hint",
    "pattern": "export const APP_SLUG = 'terum-skills-desktop';"
  },
  {
    "file": "src/commands/app.ts",
    "line": 68,
    "policy": "prose",
    "pattern": "if (!version) return failure('This copy of terum-skills has no version; the desktop app is published per version.');"
  },
  {
    "file": "src/commands/app.ts",
    "line": 74,
    "policy": "prose",
    "pattern": "if (platform === 'wsl') io.print('The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal.');"
  },
  {
    "file": "src/commands/app.ts",
    "line": 107,
    "policy": "prose",
    "pattern": "if (!(await exists(file)) || !(await exists(`${file}.sha256`))) return failure(`No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(args.form)}`);"
  },
  {
    "file": "src/commands/app.ts",
    "line": 139,
    "policy": "routed",
    "pattern": "if (emulation) io.print(`This machine has an ARM64 processor but you are running an x64 build of Node, so terum-skills and everything the desktop app starts will run under emulation. Install the ARM64 build of Node from nodejs.org, then run \\`${invocation(args.form, 'app')}\\` again to record it.`);"
  },
  {
    "file": "src/commands/app.ts",
    "line": 183,
    "policy": "prose",
    "pattern": "if (RELEASE_ASSETS_MISSING.test(text)) return `No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(form)}`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 135,
    "policy": "not-a-hint",
    "pattern": "const waitingLine = (info: { label: string; elapsedMs: number }): string => `Waiting for another terum-skills operation on ${info.label} to finish… (${Math.round(info.elapsedMs / 1000)} s)`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 661,
    "policy": "not-a-hint",
    "pattern": "throw new CloneBusy(`The write lock on ${label ?? root} is stamped ${Math.round(aheadMs / 1000)} s in this machine's future (${lockPath}), so waiting cannot clear it; remove that directory if no terum-skills command is running.`);"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 2,
    "policy": "prose",
    "pattern": "name: terum-skills"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 3,
    "policy": "prose",
    "pattern": "description: \"Drive the terum-skills CLI from a Claude Code session: inspect the local Library or team Marketplace, fetch with sync, publish immutable skill versions, install the latest version into Global or an added project, evaluate local skills, and prepare terminal commands for project setup, skill move/rename/delete, pruning, and team administration. Use when the user wants to manage, evaluate, publish, or install skills; hand questions requiring a TTY to the user's terminal.\""
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 5,
    "policy": "prose",
    "pattern": "managed-by: terum-skills"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 8,
    "policy": "prose",
    "pattern": "Run one `terum-skills` verb on the user's behalf, or prepare it for them when the CLI would"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 10,
    "policy": "prose",
    "pattern": "skill only decides *whether* to run it here and *how* to show the result."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 12,
    "policy": "prose",
    "pattern": "This file ships inside the `terum-skills` npm package and is placed at"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 13,
    "policy": "prose",
    "pattern": "`~/.claude/skills/terum-skills/` by `terum-skills setup`. The `metadata.managed-by` marker identifies"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 14,
    "policy": "prose",
    "pattern": "Terum's copy. Setup can refresh it; `sync --hook` also refreshes an outdated managed copy and"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 15,
    "policy": "prose",
    "pattern": "announces `Updated your /terum-skills manual for this CLI.` A foreign copy is left alone."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 35,
    "policy": "fixed",
    "pattern": "- Always `npx -y terum-skills@latest <verb> …` for a runnable command."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 40,
    "policy": "prose",
    "pattern": "`validate` exits 1 on error findings; warnings alone are not a failure."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 41,
    "policy": "prose",
    "pattern": "- `$ARGUMENTS`: the command path can have multiple tokens (`skill move`, `team project create`)."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 43,
    "policy": "prose",
    "pattern": "`status`. Explain the tables below briefly; ask for the user's intent before assembling flags."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 45,
    "policy": "prose",
    "pattern": "`team migrate` exists but is terminal-only (Table B); do not invent any other migration invocation."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 51,
    "policy": "prose",
    "pattern": "| `status` | nothing | show stdout; exit 0 means the query succeeded, not that setup is complete. Pending work needs the matching install or removal retried, not a fetch |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 52,
    "policy": "prose",
    "pattern": "| `ls`, `ls member <h>`, `ls project <n>` | nothing | show the team inventory |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 53,
    "policy": "prose",
    "pattern": "| `ls --local` | nothing | show the requested project section; summarise other roots and rejected/unreadable folders by count and reason unless asked for all. This inventory is local-only |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 54,
    "policy": "prose",
    "pattern": "| `project add <abs-path>`, `project remove <abs-path>`, `project list` | confirm with the user before adding or forgetting a root | show stdout; removing a project leaves its files and placement ledger unchanged |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 55,
    "policy": "prose",
    "pattern": "| `search <term> [--category <c>] [--author <a>] [--project <p>]` | nothing | show stdout; `No skills found.` is a result |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 56,
    "policy": "prose",
    "pattern": "| `validate <abs-path or name> [--cwd <team-root>]` | requires team policy from the configured clone or explicit team root | show findings verbatim. Validation does not inject managed fields; an unpublished folder may fail strict frontmatter checks. Publish injects its managed fields before checking; local eval permits those fields to be absent |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 57,
    "policy": "prose",
    "pattern": "| `update` | nothing | show the update command; the CLI never runs a package manager |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 58,
    "policy": "prose",
    "pattern": "| `app` | confirm download/install and opening the desktop app | show stdout |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 59,
    "policy": "prose",
    "pattern": "| `app-update --check` | nothing | show cached advertisement and installed/staged state; `--force` on this check requests a release probe |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 60,
    "policy": "prose",
    "pattern": "| `app-update --stage [--release <version>]`, `app-update --apply [--release <version>] [--reason manual]` | confirm download or installation; on macOS quit the running app before terminal apply | staging verifies the download; apply hands installation to a detached process |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 61,
    "policy": "prose",
    "pattern": "| `sync` | say it fetches and resets each disposable team clone to `origin/main`; it never uploads, places, or edits the user's skill folders | show stdout; disclose each team reported as not refreshed. A successful fetch records its time and HEAD. Use `run_in_background` for a slow fetch |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 62,
    "policy": "prose",
    "pattern": "| `sync --hook` | do not run by hand; this is the SessionStart entry | stdout is the reload directive, notices go to stderr; only Terum's managed manual may be refreshed |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 63,
    "policy": "prose",
    "pattern": "| `install <ref> [--into global\\|<project root>]`, `install member <h> [--into global\\|<project root>]`, `install project <n> [--into global\\|<project root>]` | confirm the skill/list and destination: this places files and writes install records. Use an explicitly chosen `--into`; an unregistered project path refuses and needs `project add` first | installs the highest numbered version in the clone. A tool-grant question or replace question needs a terminal; report any completed work before handing off |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 64,
    "policy": "prose",
    "pattern": "| `invite <github-login…>` | confirm with the user: sends GitHub collaborator invitations | show stdout and the teammate join block |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 65,
    "policy": "prose",
    "pattern": "| `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]… [--remove <skill>]` | confirm the profile changes; project membership names team projects; `--remove` takes one skill off the profile list | show stdout |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 66,
    "policy": "prose",
    "pattern": "| `login --set <key=value>` | confirm the identity change; keys are `name`, `email`, `default-handle`; repeat the flag for multiple fields | show the identity notice; published versions keep their recorded author |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 67,
    "policy": "prose",
    "pattern": "| `team workflow-update --print` | nothing | show the workflow scaffold and its manual migration instruction; this does not migrate the team's skill layout |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 68,
    "policy": "prose",
    "pattern": "| `eval <skill> [--k <n>] [--triggers-only] [--execution-only] [--case <stem>] [--model <m>] [--judge-model <m>] [--no-gen]` | see the eval section | see the eval section |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 69,
    "policy": "prose",
    "pattern": "| `eval-report <skill> [--team <team>]` | nothing | show committed receipts and local run history for a skill in the team clone; no fetch |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 70,
    "policy": "prose",
    "pattern": "| `eval --queue-list` | nothing | show the local queue |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 71,
    "policy": "prose",
    "pattern": "| `eval --dequeue <skill>` | confirm removal from the queue | show remaining items; a team-qualified selector is also accepted |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 72,
    "policy": "prose",
    "pattern": "| `eval --drain [--parallel <n>] [--window overnight] [--max <n>]` | confirm paid runs, as below | show successes and failures; default parallelism is four |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 73,
    "policy": "prose",
    "pattern": "| `serve` | do not run as a one-shot Bash command; it requires `--frames` and a request/answer client | accepts only `status`, `ls`, `eval-report`, `search`, `validate`, `update`; every write uses its own process |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 82,
    "policy": "prose",
    "pattern": "that backup elsewhere yourself before retrying. Neither the Library nor `prune` cleans old-skills."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 104,
    "policy": "fixed",
    "pattern": "| `project add` (no path) | none | `npx -y terum-skills@latest project add` — asks for a folder |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 105,
    "policy": "fixed",
    "pattern": "| `publish <ref> [--project <p>] [--category <c>]` | none; confirm the local skill and team with the user | `npx -y terum-skills@latest publish <ref> --project <p> --category <c>` — omit optional flags the user has not chosen |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 106,
    "policy": "fixed",
    "pattern": "| `skill move <abs-path> --to global\\|<project root>` | none | `npx -y terum-skills@latest skill move <abs-path> --to <destination>` |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 107,
    "policy": "fixed",
    "pattern": "| `skill rename <abs-path> --to <new-name>` | none | `npx -y terum-skills@latest skill rename <abs-path> --to <new-name>` |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 108,
    "policy": "fixed",
    "pattern": "| `skill delete <abs-path>` | none | `npx -y terum-skills@latest skill delete <abs-path>` |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 56,
    "policy": "fixed",
    "pattern": "| `skill fix <abs-path>` | none; the folder is the user's own | show stdout; it applies the repairs with one right answer (quote a frontmatter value YAML refuses, `name` to the folder, `license` to team policy, strip invisible characters, clear an executable bit on a non-script) and prints `Still needs you` for the rest |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 109,
    "policy": "fixed",
    "pattern": "| `prune` | none; an empty quarantine simply returns | `npx -y terum-skills@latest prune` |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 110,
    "policy": "fixed",
    "pattern": "| `uninstall-skill <ref> [--from global\\|<project root>]` | none; the CLI previews before confirming | `npx -y terum-skills@latest uninstall-skill <ref> --from <destination>` — `member <h>` and `project <n>` selectors also exist |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 111,
    "policy": "fixed",
    "pattern": "| `uninstall` | none | `npx -y terum-skills@latest uninstall` — machine teardown, preserving recovery data and printing the package-manager step |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 112,
    "policy": "prose",
    "pattern": "| `team leave <name>`, `team remove <handle>` | none | the same command with the supported npx prefix |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 113,
    "policy": "fixed",
    "pattern": "| `team move <org>/<repo> [--from <team>] [--yes]` | none; one confirmation, then leave + join + re-place | `npx -y terum-skills@latest team move <org>/<repo>` — when a team's repository was recreated elsewhere (`sync` reports it and offers this) |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 113,
    "policy": "fixed",
    "pattern": "| `team project create [name] [--remote <url>]` | none | `npx -y terum-skills@latest team project create <name> --remote <url>` |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 114,
    "policy": "fixed",
    "pattern": "| `setup [target]`, `team create`, `team join <target>`, `login` | none; setup/join can clone before asking | `npx -y terum-skills@latest setup` / `setup <org>/<repo>` / `team create` / `team join <target>` / `login` with the same npx prefix |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 135,
    "policy": "prose",
    "pattern": "without asking — publishing is the endorsement (`profile --remove <name>` takes it back)."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 125,
    "policy": "prose",
    "pattern": "The three `skill` operations require a direct child of Global or an added project's skills root"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 131,
    "policy": "prose",
    "pattern": "unchanged. `prune` permanently deletes confirmed quarantine contents only."
  },
  {
    "file": "README.md",
    "line": 1,
    "policy": "prose",
    "pattern": "# terum-skills(Evaluating the best skills and sharing them)"
  },
  {
    "file": "README.md",
    "line": 50,
    "policy": "fixed",
    "pattern": "npx -y terum-skills@latest setup"
  },
  {
    "file": "README.md",
    "line": 51,
    "policy": "fixed",
    "pattern": "npx -y terum-skills@latest app"
  },
  {
    "file": "README.md",
    "line": 53,
    "policy": "fixed",
    "pattern": "The default setup command will lead you towards creating a team. To join a team, ask the owner of a team to use `npx -y terum-skills@latest invite <your github username>`. They will receive a command that you can paste into your terminal. Or, if you know the organization name and repo name and have already been invited, you can run:"
  },
  {
    "file": "README.md",
    "line": 56,
    "policy": "fixed",
    "pattern": "npx -y terum-skills@latest setup <org name>/<repo name>"
  },
  {
    "file": "README.md",
    "line": 57,
    "policy": "fixed",
    "pattern": "npx -y terum-skills@latest app"
  },
  {
    "file": "README.md",
    "line": 60,
    "policy": "prose",
    "pattern": "There is no install step — `npx -y` fetches and runs the latest release every time. (Prefer a permanent `terum-skills` binary? See [Installing, updating, uninstalling](#installing-updating-uninstalling).)"
  },
  {
    "file": "README.md",
    "line": 62,
    "policy": "fixed",
    "pattern": "Setup also offers the `/terum-skills` Claude Code skill, placed at `~/.claude/skills/terum-skills/`, so Claude Code can run these commands for you inside a session (and hand you the ones that need a terminal). It ships inside the npm package; re-running `npx -y terum-skills@latest setup` after an update refreshes it. The session hook also refreshes an outdated managed copy and announces the update; it leaves a foreign copy alone."
  },
  {
    "file": "README.md",
    "line": 120,
    "policy": "prose",
    "pattern": "Hygiene checks are deterministic and free. Use `validate` for a free check. `publish` checks its injected frontmatter before writing; `eval` checks local bytes while permitting missing managed fields. Validation uses team policy and does not inject fields."
  },
  {
    "file": "README.md",
    "line": 133,
    "policy": "prose",
    "pattern": "`eval` runs the skill through your logged-in Claude Code CLI. Each arm gets a fresh throwaway sandbox. The candidate is the folder on this machine. The command stores local run artifacts and writes missing generated eval assets into that folder, announcing the path first. Only publish shares skill bytes; a receipt for bytes that are already a published version is shared by `eval` itself."
  },
  {
    "file": "README.md",
    "line": 177,
    "policy": "prose",
    "pattern": "`files` seeds the sandbox, `setup` runs once with a 60-second limit, and `requires` lists host tools the case needs. If a required tool is missing, the case is visibly skipped."
  },
  {
    "file": "README.md",
    "line": 215,
    "policy": "prose",
    "pattern": "You can evaluate a skill even when it does not include eval files. By default, `eval` generates whatever is missing. Authored assets always take priority:"
  },
  {
    "file": "README.md",
    "line": 231,
    "policy": "prose",
    "pattern": "## generated by terum-skills eval-gen — review before trusting"
  },
  {
    "file": "README.md",
    "line": 301,
    "policy": "prose",
    "pattern": "`eval` writes a local receipt under `~/.terum/skills/evals/local/<digest>/<run-id>/`."
  },
  {
    "file": "README.md",
    "line": 306,
    "policy": "prose",
    "pattern": "When the evaluated bytes are already a published version, `eval` publishes the receipt itself — that is"
  },
  {
    "file": "README.md",
    "line": 308,
    "policy": "prose",
    "pattern": "command. `--no-commit` keeps the run to yourself. Otherwise `publish` attaches matching receipts at:"
  },
  {
    "file": "README.md",
    "line": 346,
    "policy": "fixed",
    "pattern": "- **Default (no install):** every documented command runs as `npx -y terum-skills@latest <verb>`. npx fetches the newest release on each run, so there is nothing to install, update, or add to PATH. The forms below are optional alternatives that give you a bare `terum-skills` binary."
  },
  {
    "file": "README.md",
    "line": 347,
    "policy": "fixed",
    "pattern": "- **Update:** `npx -y terum-skills@latest update` prints this copy's version, the newest advertised release, and the exact command that updates *this* copy. It never runs a package manager. `npx -y terum-skills@latest` fetches the newest release every run and updates nothing else."
  },
  {
    "file": "README.md",
    "line": 348,
    "policy": "fixed",
    "pattern": "- **Uninstall:** `npx -y terum-skills@latest uninstall` removes your team from this machine (placed skills, clone, cache), the session-start hook, the `/terum-skills` Claude Code skill it placed, and `~/.terum/skills` except its recovery data (`quarantine/`, `backups/`) and local eval runs (`evals/`); it also removes the downloaded desktop app bundle (`app/`), then prints the one package-manager line to finish. `uninstall-skill <skill>` removes one skill."
  },
  {
    "file": "README.md",
    "line": 362,
    "policy": "prose",
    "pattern": "| Team | `setup [<org>/<repo>] [--no-existing]` | Create-or-join wizard; sequences the verbs below, checks existing Library folders against the team, then offers the session hook and the `/terum-skills` Claude Code skill; `--no-existing` skips that check |"
  },
  {
    "file": "README.md",
    "line": 363,
    "policy": "prose",
    "pattern": "| | `login` | Check `gh` and record your name, email, and handle |"
  },
  {
    "file": "README.md",
    "line": 364,
    "policy": "prose",
    "pattern": "| | `team create` / `team join` / `team leave` / `team move <org>/<repo>` / `team remove <handle>` | Manage the repo and its roster; `move` follows a team whose repository was recreated elsewhere (leave, join, place the shared skills again) |"
  },
  {
    "file": "README.md",
    "line": 365,
    "policy": "prose",
    "pattern": "| | `invite <github-user>…` | Grant repo access and print the join line |"
  },
  {
    "file": "README.md",
    "line": 366,
    "policy": "prose",
    "pattern": "| | `ls [--local]` / `ls member <handle>` / `ls project <name>` / `status` / `search <term>` | Read the team, your local skills, or the catalog |"
  },
  {
    "file": "README.md",
    "line": 367,
    "policy": "prose",
    "pattern": "| | `project add [<path>]` / `project remove <path>` / `project list` | Add, forget, or list the projects in your library — the folders this machine reads local skills from. Nothing is added for you: setup offers one folder at first run (`--no-projects` / `--no-evals` skip the offers), and the Library adds the rest |"
  },
  {
    "file": "README.md",
    "line": 368,
    "policy": "prose",
    "pattern": "| | `team workflow-update` | Print the current team workflow scaffold with `--print` for manual migration |"
  },
  {
    "file": "README.md",
    "line": 369,
    "policy": "prose",
    "pattern": "| | `team project create [<name>] [--remote <url>]` | Create a team project: a name and the repository its skills place into (the skills themselves are added with `publish --project`) |"
  },
  {
    "file": "README.md",
    "line": 370,
    "policy": "prose",
    "pattern": "| | `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]… [--remove <skill>]` | Describe yourself in your own people file (job label, team projects); `--remove` takes a skill off the profile list publishing added |"
  },
  {
    "file": "README.md",
    "line": 371,
    "policy": "prose",
    "pattern": "| Skills | `install <ref> [--into global\\|<project root>] [--yes-profile]` / `install --adopt <path>` / `uninstall-skill <ref> [--from global\\|<project root>]` | Install the highest numbered version in the clone, or adopt an identical Library folder in place without copying it. Interactive installs offer Global and added projects; `--into` selects explicitly and refuses unregistered project roots. A replace prompt keeps the existing folder in the targeted root’s `.claude/old-skills/<name>`; an existing backup there must be moved elsewhere first; uninstall leaves your profile unchanged (`member <handle>` and `project <name>` install whole lists); `uninstall-skill` asks once, listing every folder it will remove |"
  },
  {
    "file": "README.md",
    "line": 372,
    "policy": "prose",
    "pattern": "| | `sync` | Fetch each team clone and reset it to `origin/main`; it never places, uploads, or edits local skills |"
  },
  {
    "file": "README.md",
    "line": 373,
    "policy": "prose",
    "pattern": "| | `prune` | List quarantined items and delete the ones you confirm |"
  },
  {
    "file": "README.md",
    "line": 381,
    "policy": "prose",
    "pattern": "| | `skill move <path> --to global\\|<project root>` / `skill copy <path> --to global\\|<project root>` / `skill rename <path> --to <new-name>` / `skill delete <path>` / `skill fix <path>` | Move, copy, rename, delete, or fix a folder in your Library. Copy leaves the source where it is, so one local skill can sit in two roots at once; the new folder keeps the source's `metadata.id` and is a plain Library folder with no install record of its own. Delete confirms by name; move, copy and rename ask nothing, because each is undone by running the verb the other way and none overwrites anything; fix applies the repairs with one right answer (quote a frontmatter value YAML refuses, set `name` to the folder, set `license` to the team policy, strip invisible characters, clear an executable bit on a non-script) and lists what still needs you. Delete removes an unmodified placement outright (the team repo still holds its bytes; reinstall restores them) and quarantines an edited placement or any folder that is not a placement; `prune` permanently deletes quarantine contents |"
  },
  {
    "file": "README.md",
    "line": 375,
    "policy": "prose",
    "pattern": "| | `serve` | Answer read requests on one long-lived process instead of starting a new one per call (`--frames` only; the desktop app drives it). Reads only: `status`, `ls`, `eval-report`, `search`, `validate`, `update` |"
  },
  {
    "file": "README.md",
    "line": 376,
    "policy": "prose",
    "pattern": "| | `publish <ref> [--project <name>] [--category <name>]` | Publish a local folder — named by its skill name or its folder path (\`~/…\` accepted) — as an immutable version directly to main, or reuse identical bytes and attach matching evals. Select a team project (Global by default). Category precedence: declared frontmatter, flag, model suggestion, misc fallback; undeclared categories get a source disclosure. Managed frontmatter is written back locally; publication adds the skill to your profile with no prompt (`profile --remove <skill>` takes it back) |"
  },
  {
    "file": "README.md",
    "line": 377,
    "policy": "prose",
    "pattern": "| Evals | `validate <path\\|name>` | Deterministic safety and formatting checks, no model |"
  },

  {
    "file": "README.md",
    "line": 379,
    "policy": "prose",
    "pattern": "| | `eval-report <skill>` | Show a skill's committed eval receipts and this machine's local runs (read-only, no fetch); the desktop app's Evals tab reads it |"
  },
  {
    "file": "README.md",
    "line": 380,
    "policy": "prose",
    "pattern": "| Machine | `update` / `uninstall` | Show the update command for this copy / confirm machine teardown, preserve recovery data, and print the package-manager removal step |"
  },
  {
    "file": "README.md",
    "line": 381,
    "policy": "prose",
    "pattern": "| | `app` | Install and open the desktop app for this CLI version |"
  },
  {
    "file": "README.md",
    "line": 382,
    "policy": "prose",
    "pattern": "| | `app-update [--check\\|--stage\\|--apply] [--release <version>] [--reason on-close\\|overnight\\|manual]` | Check for, download, or install a newer desktop app; Settings ▸ Updates offers Install now, When I quit, or Overnight (01:00–05:00 after 30 idle minutes) |"
  },
  {
    "file": "README.md",
    "line": 385,
    "policy": "prose",
    "pattern": "This CLI has no standalone refresh command: use `sync` to fetch. `team workflow-update --print` only prints workflow migration instructions; the skill-layout migration is `team migrate`, a terminal-only, once-per-team operation that refuses to run under `--frames`."
  },
  {
    "file": "README.md",
    "line": 386,
    "policy": "fixed",
    "pattern": "`npx -y terum-skills@latest --help` and `npx -y terum-skills@latest <verb> --help` list every option you are expected to use."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 1,
    "policy": "prose",
    "pattern": "# Frame mode: driving terum-skills from a program"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 3,
    "policy": "prose",
    "pattern": "`terum-skills --frames <verb> [options]` runs any verb with a program, not a person, on the other end. Every line the CLI writes to stdout is one JSON object (a frame); every line it reads from stdin is one JSON object. Nothing else is on stdout. Diagnostics about the channel itself go to stderr. Without `--frames`, nothing changes."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 7,
    "policy": "prose",
    "pattern": "The flag is position-independent before the first `--` (`--frames status` and `status --frames` are the same) and is removed before the verb's own options are parsed."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 18,
    "policy": "prose",
    "pattern": "| `progress` | `{\"t\":\"progress\",\"step\":\"...\",\"current\":n,\"total\":n}` | Coarse step reporting for a long verb. `install`, `publish` and eval batches (including setup’s `evals` step) emit it. `step` names the step (`evals`, `install`'s four phases, or `publish`'s five — refresh, category, check, publish, profile, of which the category rung is skipped when the folder already declares one or `--category` was passed); `current` counts what is done so far and `total` appears only when the verb knows it. `features.progress` is `true`. Never required, never ordered against `ask`; a shell that ignores it is unaffected. |"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 19,
    "policy": "prose",
    "pattern": "| `result` | `{\"t\":\"result\",\"verb\":\"install\",\"ok\":true,\"exitCode\":0,\"value\":{...}}` | Always last. `verb` is the invoked verb. `value` is the verb's own result object when it has one. A failing result may also carry `value`, the verb's partial result (for example, `eval` after a partially failed queue drain). On failure: `ok:false`, `exitCode:1`, `error` is the one-line message, and `declined:true` when set by the CLI's typed decline (the person said no) rather than by matching the error text, and `refused:true` when the CLI refused the operation before any side effect (one team per machine); a refusal is not a decline. After `result` the CLI stops reading stdin and exits. |"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 34,
    "policy": "prose",
    "pattern": "1. **The `gh auth login` offer never arrives over frames.** When `gh` is installed but logged out, the CLI in frame mode prints `GitHub CLI is installed but logged out. Run \\`gh auth login\\` in a terminal, then try again.` instead of asking (it would otherwise hand its stdio to `gh`, which here means the frame pipes). Likewise `setup` never asks the desktop-app opt-in question over frames. If a shell ever does see that confirm, the CLI is older than 0.1.6: answer `false`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 35,
    "policy": "prose",
    "pattern": "2. **Never use `sync --hook` over frames.** Its stdout is the Claude Code reload directive, not frames; the CLI refuses it with a `result` frame and exit 1. Call plain `sync` for both foreground and background use: it fetches and changes nothing on this machine (see `f-sync`)."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 37,
    "policy": "prose",
    "pattern": "4. **`cwd` is advisory; every write names its destination.** `install` asks `Install to` (or takes `--into`), `sync` fetches every team clone from any cwd, `uninstall-skill` takes `--from`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 38,
    "policy": "prose",
    "pattern": "5. **`uninstall`: the consent inventory is the confirm's detail.** Render `ask.detail` verbatim in the danger dialog; answer false to cancel. Its result includes cleanup outcomes, `kept`, `record`, and CLI-generated `advice`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 41,
    "policy": "prose",
    "pattern": "## Read sessions (`serve`)"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 43,
    "policy": "prose",
    "pattern": "`terum-skills --frames serve` starts one stdio session, advertising `features.serve: true`"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 44,
    "policy": "prose",
    "pattern": "in its single `hello`. Without `--frames`, `serve` immediately fails"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 45,
    "policy": "prose",
    "pattern": "with the error `serve requires --frames` and exits 1. This is an app-owned child, not a"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 51,
    "policy": "prose",
    "pattern": "{\"t\":\"request\",\"id\":\"r7\",\"argv\":[\"status\",\"--team\",\"acme\"],\"cwd\":\"/some/path\"}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 60,
    "policy": "prose",
    "pattern": "Only `status`, `ls`, `eval-report`, `search`, `validate`, and `update` are accepted. Any other"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 61,
    "policy": "prose",
    "pattern": "verb gets `ok:false` with `serve does not run <verb>; spawn it as its own process`, without"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 63,
    "policy": "prose",
    "pattern": "(including `update`'s release-advertisement probe and local release-state maintenance)."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 69,
    "policy": "prose",
    "pattern": "one-shot protocol states that `serve` deliberately breaks.** Rule 6 (\"one run per verb\")"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 70,
    "policy": "prose",
    "pattern": "continues to hold for every verb except `serve` itself."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 88,
    "policy": "prose",
    "pattern": "< {\"t\":\"request\",\"id\":\"r1\",\"argv\":[\"status\"]}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 89,
    "policy": "prose",
    "pattern": "< {\"t\":\"request\",\"id\":\"r2\",\"argv\":[\"ls\",\"--local\"],\"cwd\":\"/work/acme\"}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 90,
    "policy": "prose",
    "pattern": "> {\"t\":\"print\",\"id\":\"r1\",\"level\":\"info\",\"line\":\"terum-skills 0.14.0\"}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 93,
    "policy": "prose",
    "pattern": "< {\"t\":\"request\",\"id\":\"r3\",\"argv\":[\"install\",\"example\"]}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 111,
    "policy": "prose",
    "pattern": "$ printf '' | terum-skills --frames status"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 113,
    "policy": "prose",
    "pattern": "{\"t\":\"print\",\"level\":\"info\",\"line\":\"terum-skills 0.14.0\"}"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 119,
    "policy": "prose",
    "pattern": "An `install` whose tool grants are declined:"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 145,
    "policy": "prose",
    "pattern": "command: use `sync`. Neither belongs in the advertised verb list."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 146,
    "policy": "prose",
    "pattern": "`hello.features` names `libraryProjects`, `projects`, `memberRole`, `localIdentity`, `roles`, `favorites`, `follow`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `refresh`, `appUpdate`, `reconcile`, and `serve`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 149,
    "policy": "prose",
    "pattern": "`liftOnCards`, `runEvalInApp`, `progress`, `refresh`, `appUpdate`, `reconcile`, `serve`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 152,
    "policy": "prose",
    "pattern": "`libraryProjects` is the explicit local registry (`project add`, `project remove`, `project list`);"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 153,
    "policy": "prose",
    "pattern": "`projects` is team grouping (`team project create`). `memberRole` is the owner-written job label;"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 154,
    "policy": "prose",
    "pattern": "`roles` supports GitHub Admin/Member permissions from `status --permissions` (otherwise unknown)."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 155,
    "policy": "prose",
    "pattern": "`installScope` supports destinations and destination-aware removal. `appUpdate` and `serve`"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 160,
    "policy": "prose",
    "pattern": "Team `ls` includes `people` with automatic `installed` records and curated `profile` entries."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 178,
    "policy": "prose",
    "pattern": "`install <ref> [--into global|<project root>]` installs the highest numbered version in the clone,"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 179,
    "policy": "prose",
    "pattern": "including its eval assets. `install member <handle>` and `install project <name>` use the same"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 181,
    "policy": "prose",
    "pattern": "is refused with a `project add` hint; install never registers a root itself."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 204,
    "policy": "prose",
    "pattern": "`publish <ref> [--project <name>] [--category <name>]` resolves a local Library folder, checks"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 226,
    "policy": "prose",
    "pattern": "`skill move <path> --to global|<project root>`, `skill copy <path> --to global|<project root>`,"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 227,
    "policy": "prose",
    "pattern": "`skill rename <path> --to <new-name>`, and"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 108,
    "policy": "routed",
    "pattern": "| `skill copy <abs-path> --to global\\|<project root>` | none | `npx -y terum-skills@latest skill copy <abs-path> --to <destination>` \u2014 the source folder stays where it is |"
  },
  {
    // `copy` became a command name with `skill copy`, so this wrapped prose line now starts with a
    // verb the tripwire scans for. It is a sentence about install's kept copy, not an invocation.
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 82,
    "policy": "not-a-hint",
    "pattern": "copy stays under that project. If the kept-copy path already exists, the command refuses; move"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 227,
    "policy": "prose",
    "pattern": "`skill delete <path>` are one-shot frame writes. Only `skill delete` asks: its `text` ask is"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 236,
    "policy": "prose",
    "pattern": "`skill fix <path>` is a one-shot frame write with no ask. It applies every repair whose outcome is"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 239,
    "policy": "prose",
    "pattern": "team policy, removing HYG2's invisible characters, and clearing an executable mode on a non-script."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 238,
    "policy": "prose",
    "pattern": "(the `ls --local` `invalid-yaml` reason), setting `name` to the folder name, setting `license` to the"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 240,
    "policy": "prose",
    "pattern": "It then runs the same inspection and hygiene gate as `ls --local` and `validate` and prints what still"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 244,
    "policy": "prose",
    "pattern": "three, and `validate`'s result carries `repairs`, one sentence per change `skill fix` would make, and"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 235,
    "policy": "prose",
    "pattern": "`prune` lists quarantine paths and asks `Delete <n> quarantined item(s)?`; empty quarantine asks"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 238,
    "policy": "prose",
    "pattern": "Neither `skill` nor `project` is in `SERVE_READ_VERBS`: serve gates on the first argv token, so"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 239,
    "policy": "prose",
    "pattern": "even `project list` needs its own process. The six accepted read verbs are unchanged."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 241,
    "policy": "prose",
    "pattern": "## What `status` reports about this machine"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 243,
    "policy": "prose",
    "pattern": "`status`'s result carries two architecture fields, on success and on a failing read alike:"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 255,
    "policy": "prose",
    "pattern": "`app` reports the same condition as `emulation`, either `\"win32-arm64-on-x64\"` or `null`, and prints one"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 263,
    "policy": "prose",
    "pattern": "`eval-report <skill> [--team <team>]` is read-only: it reads the local clone and this machine's run tree without fetching, networking, or prompting. `result.value` is an `EvalReport`:"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 270,
    "policy": "prose",
    "pattern": "`sync [--team <team>]` fetches and resets the disposable clone under its writer lock and records"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 274,
    "policy": "prose",
    "pattern": "`project add [path]` · `project remove <path>` · `project list` are the Library's local project registry. `add` asks `Which folder?` as a `path` ask when no argument is given (default: the nearest git repository above the cwd) and returns `{ path, label, added, reconcile? }`; after a newly added project it scans only that project, and frame mode carries the non-writing reconcile result so the shell can open a dialog only when it is non-empty. `remove` returns `{ path, placementsRemaining }` and forgets the path only — nothing on disk changes; `list` returns `{ projects: { path, label, rootState, skillFolders }[] }`. A project is added only by an explicit act: no verb registers one as a side effect, and `install --into <path>` refuses a path that is not already a project rather than adding it."
  },

  {
    "file": "docs/frame-protocol.md",
    "line": 280,
    "policy": "prose",
    "pattern": "`app-update --stage [--release <version>]` downloads the selected release through `gh`, verifies its published SHA-256, and stages it without installing. The default release is this CLI's version. An advertised tag with missing release assets returns `ok: true, notPublished: true, staged: false`; the shell stays quiet and retries on the next launch."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 282,
    "policy": "prose",
    "pattern": "`app-update --apply [--release <version>] [--reason on-close|overnight|manual]` hands a staged install to a detached process. The public result values are:"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 302,
    "policy": "prose",
    "pattern": "`app-update --apply` returns as soon as the background installer process exists. The shell must then quit; it is the shell's job to quit and the CLI never kills it. `--apply` watches the CLI's parent process only in frame mode, where that parent is the shell itself; from a terminal it installs immediately."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 308,
    "policy": "prose",
    "pattern": "`ls` skill rows add `frontmatter: string | null` beside `body`; `ls --local` rows and `notOffered` entries also include the raw fenced frontmatter when readable (otherwise null), without adding body text to local inventory; key order, quoting, and internal line endings are preserved, and older CLIs may omit the field."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 311,
    "policy": "prose",
    "pattern": "`app-update --reason on-close|overnight|manual` records the install reason in every apply marker and forwards it from `--apply` to `--apply-now`. Omission remains compatible with old callers and displays the manual wording. No CLI verb or feature key is added."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 315,
    "policy": "prose",
    "pattern": "Native-command amendment: `app_update_on_close({ version: string | null })` arms or disarms one detached installer. This additional command is necessary because the installer must outlive the WebView. The base actually has six commands including `quit`, so this is its seventh (the original decision's “five” count predates `quit`). On the last window's CloseRequested or ExitRequested, the shell consumes the arm once and invokes the recorded Node/CLI with `app-update --apply-now --release <version> --reason on-close`, plus `--await-pid <shell-pid>` to preserve the CLI's Windows wait. It uses a new process group on macOS and CREATE_NO_WINDOW | DETACHED_PROCESS on Windows and stays outside the bridge's child cleanup. The command follows the existing application-command registration, without a separate app ACL permission. Before spawning, the shell writes a waiting marker; a spawn failure replaces it with a failed marker. A child that dies before executing the CLI leaves the waiting marker visible as an unfinished install on the next launch. An unwritable marker is logged without preventing close. A manual or overnight handoff first disarms the close action to prevent two installers; a failed handoff restores the previous arm unless the policy changed in the meantime."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 323,
    "policy": "prose",
    "pattern": "`eval --queue-list` returns `{ items }`, where each item has `skill`, `path`, `contentHash`, `requestedAt`, optional `team`,"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 324,
    "policy": "prose",
    "pattern": "`window: \"overnight\" | \"later\"`, and an optional `lastError`. `eval --dequeue <team>/<skill>` removes all queued"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 328,
    "policy": "prose",
    "pattern": "`eval --drain [--parallel n] [--window overnight] [--max n]` returns `{ items, attempted, completed, failures }`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 338,
    "policy": "prose",
    "pattern": "team clone: sum each arm mean multiplied by `provenance.cases.length * provenance.k`, for both cost and duration. Receipts with null arm measurements do not qualify. With fewer than three eligible receipts,"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 341,
    "policy": "prose",
    "pattern": "A declined batch continuation queues the remaining skills for `later`; `eval --drain` includes those items."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 345,
    "policy": "prose",
    "pattern": "between 01:00 and 05:00 after thirty minutes without pointer or keyboard activity. The app starts `eval --drain --parallel 4` once that night; Stop cancels that one process. Activity, the preference, and the window are checked before launch; an active batch may finish. This unfiltered drain includes later items too, as required by A1. The app must remain open. Closed-app scheduling is deferred; a person can run"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 346,
    "policy": "prose",
    "pattern": "`eval --drain` manually at any time. The overnight preference defaults to true."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 368,
    "policy": "prose",
    "pattern": "eval offer available. Batch-size input is limited to three attempts. An empty drain prints `No queued evals.`;"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 374,
    "policy": "prose",
    "pattern": "`sync` fetches each configured team clone and hard-resets it to `origin/main`, one team at a time,"
  },

  {
    "file": "docs/frame-protocol.md",
    "line": 392,
    "policy": "prose",
    "pattern": "`/terum-skills` manual when that copy is outdated, and nothing else."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 394,
    "policy": "prose",
    "pattern": "Work recorded in `pending` is drained by re-running the matching `install` or `uninstall-skill`, never"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 395,
    "policy": "prose",
    "pattern": "by `sync`."
  },
  {
    "file": "README.md",
    "line": 369,
    "policy": "prose",
    "pattern": "| | `team migrate` | Convert a team repo to the versioned layout (one commit per repo). Run **once per team, from a terminal**, and only after the release carrying the new CLI has reached everyone — an un-upgraded teammate cannot read a migrated repo |"
  },
  {
    "file": "docs/migration-layout-3.md",
    "line": 3,
    "policy": "prose",
    "pattern": "Batch B8 builds `terum-skills team migrate`. Shipping this command does not authorize running it."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 44,
    "policy": "prose",
    "pattern": "- Use the grammar below. This CLI has no standalone refresh command; use `sync` for fetching."
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 114,
    "policy": "fixed",
    "pattern": "| `team migrate [--team <name>]` | none | `npx -y terum-skills@latest team migrate` — once per team, from a terminal, only after the release carrying the new CLI has reached every teammate (an un-upgraded teammate cannot read a migrated repo); refuses under `--frames` |"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 143,
    "policy": "prose",
    "pattern": "`team migrate` is registered but terminal-only: under `--frames` it fails before doing any work and tells the"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 0,
    "policy": "prose",
    "pattern": "- Several skills at once: `eval <a> <b>…` runs them as one batch after one preflight (`--parallel <n>`, default"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 0,
    "policy": "prose",
    "pattern": "| `eval <skill> <skill>… [--batch <n>] [--parallel <n>]`, `eval --pending` | confirm the paid runs: several skills run as one batch after one agent probe; `--pending` means every shared skill with no receipt for its current version; `--batch <n>` asks before each further batch | show ✓/✗ per skill and the `Evaluated X of N` line; a declined continuation queues the rest for later |"
  },
  {
    "file": ".claude/skills/terum-skills/SKILL.md",
    "line": 0,
    "policy": "prose",
    "pattern": "| `eval <skill…> --window overnight\\|later`, `eval --pending --window overnight` | confirm queueing; nothing is paid for now | show the queued count; overnight items run in the desktop app between 01:00 and 05:00, later items wait for `eval --drain` |"
  },
  {
    "file": "README.md",
    "line": 0,
    "policy": "prose",
    "pattern": "| | `eval <skill>` | Evaluate the local skill, named by skill name or folder path, with your own Claude Code login; generate only missing assets (`--no-gen` disables generation). A receipt for bytes that are already a published version is published by `eval` itself (`--no-commit` keeps it on this machine). `eval <a> <b>… [--batch n] [--parallel n]` evaluates several skills as one batch (`--batch n` asks before each further batch); `eval <skill…> --window overnight\\|later` queues them instead, and `eval --pending` picks every shared skill without a receipt. `eval --drain [--parallel n] [--window overnight] [--max n]` runs queued evals; `eval --queue-list` lists them; `eval --dequeue <team>/<skill>` removes matching queued skills |"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "The desktop app is an unattended caller: it spawns plain `sync` at the first hello whose `features.refresh` is true and again whenever its window regains focus, at most once a minute, one at a time, and never while a foreground write verb of its own is running. It drives the run read-only and kills it rather than answer, so `sync` must never ask a question; it keeps only `changed`, each team's `state`/`detail`, and `notices`, so anything a person needs to act on has to be in those fields rather than in printed prose. Every completed automatic fetch refreshes the stamp-driven boards (Status, Settings ▸ Sync, Inbox); one that moved a clone also refreshes the Marketplace boards."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "The result is `{ changed, teams, notices }`. `notices` carries run-wide lines already phrased for a person — one concern per entry, no diagnostics — because a frame-driven caller may render them verbatim: the desktop app prints them under Settings ▸ Sync after an automatic fetch that did not refresh every team. Each attempted team reports `team`, its own `changed`,"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "`app-update --check` (the default) reads the cached release advertisement and local staged/installed versions, and keeps that advertisement fresh by itself: when the last probe is missing or a day old it probes release tags under the same GitHub-team policy and 10 s deadline as `update` (`probe: 'ok' | 'failed'`, at most once a day), otherwise it serves the cache (`probe: 'cached'`, or `'failed'` while the day's attempt failed). `--check --force` probes regardless of the cap. A check never touches the app or the CLI; its only write is the CLI's own release state in `run/latest-version.json` (the advertisement, the attempt, and the running observation every `sync` used to record). Checks always succeed, reporting probe failures as data. Until 0.15.0 the check was read-only and the advertisement was filled by the old sync; after the fetch-only sync collapse (§10) nothing on the app's path probed, so the app could never learn about a newer version by itself — the check owns the probe now."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "`eval <skill> <skill>… [--parallel n] [--batch n] [--window overnight|later] [--pending]` (past setup, 2026-09-13) runs the wizard's Now / In batches / Overnight choices as flags over any set of Library skills, or over `--pending`, the wizard's own candidate set (every shared skill with no receipt for its current version; needs a team). Several skills run as one batch after a single agent probe, `--parallel` deep (default four, never more than the batch). `--batch n` runs n at a time and asks `Continue with the next …?` before each further batch; a declined continuation queues the remainder for `later`, and a non-interactive caller runs every batch unasked. `--window` queues instead of running and never probes. The result is `{ mode: \"ran\" | \"queued\", team, skills, ok, failed, queued, stoppedAfter? }`; a run with failures is `ok:false` with that partial value, exactly like a drain. Print and `progress` frames name each skill and `progress.total` is the whole set. One skill with none of those flags is the ordinary single eval; the queue modes refuse skills, `--batch` and `--pending`."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "session-start hook left it alone (§8); a plain `sync` always fetches. Top-level `changed` is true when any team moved; a tracked tree that was"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "terum-skills process is writing the clone; a younger one is named in `detail` and never touched. Every prompt"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 0,
    "policy": "prose",
    "pattern": "// freeze on a working tree that never moves again. The writer lock held here proves no terum-skills process"
  },
  {
    "file": "README.md",
    "line": 0,
    "policy": "prose",
    "pattern": "| | `reconcile [--list]` | Compare unrecorded Library folders with published team skills; list the byte-identical, differing, and renamed matches, or ask which identical folders to adopt and which differing same-name folders to publish |"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "advertise their respective verbs. `reconcile` gates the Library's Check against the team action."
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "`install --adopt <path> [--team <team>]` records a direct child of the Global Library or a registered"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "`reconcile --list [--team <team>]` scans unrecorded Library folders once and returns"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "project as installed when its bytes equal exactly one published version in the selected team and its folder"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "renamed rows carry `version` and `teamName` and are reported only. Running `reconcile` without `--list` asks"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "summary and marks the step `printed`; the shell owns the choices by calling `reconcile --list` and then"
  },
  {
    "file": "docs/frame-protocol.md",
    "line": 0,
    "policy": "prose",
    "pattern": "`install --adopt` or `publish`. `--no-existing`, quiet and non-interactive setup mark it `skipped`."
  },
  {
    file: 'src/commands/refresh.ts',
    line: 171,
    policy: 'not-a-hint',
    pattern: 'notices.push(\'Updated your terum-skills edit hook for this CLI.\');'
  },
  {
    file: 'src/commands/uninstallMachine.ts',
    line: 75,
    policy: 'not-a-hint',
    pattern: 'if (editHookPresence.kind === \'foreign\') detail.push(`  ${editHookPath} is not the bundled terum-skills edit hook (${editHookPresence.why}); left alone`);'
  },
  {
    file: 'src/commands/uninstallMachine.ts',
    line: 111,
    policy: 'not-a-hint',
    pattern: 'try { if (await removeEditHook(editHook) === \'removed\') io.print(`Removed the terum-skills edit hook from ${editHookPath} and ${editHook.settingsFile}.`); }'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 13,
    policy: 'prose',
    pattern: '* dist/claude/hooks/ from assets/claude/hooks/terum-skills-edit.mjs) and is placed under the state'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 14,
    policy: 'prose',
    pattern: '* root by `setup`, on the same contract as the session hook and the `/terum-skills` manual: one'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 22,
    policy: 'prose',
    pattern: '* the author\'s machine, the `terum-skills` skill had 0 model-initiated invocations across 7,158'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 26,
    policy: 'not-a-hint',
    pattern: 'export const EDIT_HOOK_FILE = \'terum-skills-edit.mjs\';'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 28,
    policy: 'not-a-hint',
    pattern: 'export const EDIT_HOOK_MARKER = \'// terum-skills managed hook\';'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 87,
    policy: 'not-a-hint',
    pattern: 'if (bundled === null) throw new Error(`The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${options.source}).`);'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 90,
    policy: 'not-a-hint',
    pattern: 'if (presence.kind === \'foreign\') throw new Error(`${target} exists and is not the bundled terum-skills edit hook (${presence.why}); move it aside and re-run.`);'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 146,
    policy: 'not-a-hint',
    pattern: 'if (state === \'unavailable\') { io.print(`The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${options.source}); skipped.`); return \'unavailable\'; }'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 147,
    policy: 'not-a-hint',
    pattern: 'if (state === \'foreign\') { io.print(`${target} exists and is not the bundled terum-skills edit hook; left alone. Move it aside and re-run setup to install it.`); return \'foreign\'; }'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 150,
    policy: 'not-a-hint',
    pattern: 'if (state === \'current\' && await eventHookInstalled(options.settingsFile, \'PostToolUse\')) { io.print(`The terum-skills edit hook at ${target} is current.`); return \'present\'; }'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 151,
    policy: 'not-a-hint',
    pattern: 'if (state === \'outdated\' || state === \'current\') { await installEditHook(options); io.print(`Updated the terum-skills edit hook at ${target}.`); return \'replaced\'; }'
  },
  {
    file: 'src/lib/editHook.ts',
    line: 157,
    policy: 'not-a-hint',
    pattern: 'io.print(`Installed the terum-skills edit hook at ${target} and a Write/Edit hook in ${options.settingsFile}.`);'
  },
  {
    file: '.claude/skills/terum-skills/SKILL.md',
    line: 0,
    policy: 'prose',
    pattern: 'note beginning *"You edited <name>, a skill in this machine\'s terum-skills Library"* appears after an'
  },
  {
    file: '.claude/skills/terum-skills/SKILL.md',
    line: 0,
    policy: 'prose',
    pattern: 'publish hand-off it names. A skill edited and never published is a skill only that machine has.'
  },
];
