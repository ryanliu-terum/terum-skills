/** Explicit source literal policy. Exact trimmed line patterns prevent file-wide exemptions.
 * Line numbers are informational; the tripwire matches file AND content and checks multiplicity.
 */
export const invocationLiteralCatalog: readonly { file: string; line: number; policy: 'routed' | 'fixed' | 'prose' | 'not-a-hint'; pattern: string }[] = [
  {
    "file": "src/cli.ts",
    "line": 39,
    "policy": "not-a-hint",
    "pattern": "program.name('terum-skills').description('Share private Claude Code skills through a team git repository.').exitOverride();"
  },
  {
    "file": "src/cli.ts",
    "line": 127,
    "policy": "prose",
    "pattern": "program.command('uninstall').description('Remove terum-skills from this machine: your team (placed skills, local clone, cache), the session-start hook and the /terum-skills Claude Code skill if present, and ~/.terum/skills except recovery data; then prints the package-manager step').allowExcessArguments().action(async (_options: Record<string, never>, command: Command) => execute(async (io) => command.args.length ? failure(`To remove a skill, use \\`${invocation(context.form, 'uninstall-skill <ref>')}\\`.`) : active.uninstallMachine({ launch: context.launch, form: context.form }, io), { verb: 'uninstall', notices: true }));"
  },
  {
    "file": "src/commands/eval.ts",
    "line": 264,
    "policy": "prose",
    "pattern": "// HEAD is not engine provenance (§5.3: \"terum-skills commit of the running CLI\"; review P2)."
  },
  {
    "file": "src/commands/guardPush.ts",
    "line": 69,
    "policy": "not-a-hint",
    "pattern": "if (checked) io.print(`terum-skills push guard: ${checked} path(s) to ${stripRemoteCredentials(args.url)} are yours.`);"
  },
  {
    "file": "src/commands/install.ts",
    "line": 31,
    "policy": "prose",
    "pattern": "/** Where that bootstrap offers the bundled /terum-skills Claude Code skill (test knob). */"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 48,
    "policy": "prose",
    "pattern": "/** Optional global install so the bare `terum-skills` command exists on the teammate's machine (Ryan, 2026-09-06); the npx line below works without it. */"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 49,
    "policy": "fixed",
    "pattern": "export const GLOBAL_INSTALL = 'npm install -g terum-skills';"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 51,
    "policy": "fixed",
    "pattern": "export function joinCommand(target: string): string { return `npx -y terum-skills@latest setup ${target}`; }"
  },
  {
    "file": "src/commands/invite.ts",
    "line": 54,
    "policy": "fixed",
    "pattern": "return [`Send this to your teammate:`, '```', GLOBAL_INSTALL, joinCommand(ownerRepo), '', `Bare equivalent: npx -y terum-skills@latest team join ${ownerRepo}`, '```', 'If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.'];"
  },
  {
    "file": "src/commands/leave.ts",
    "line": 64,
    "policy": "not-a-hint",
    "pattern": "if (!releaseTeam) throw new Error(`Another terum-skills sync holds the session lock on ${name} (${lockPath(store.root, name)}); retry when it finishes, or remove that file if no session is syncing.`);"
  },
  {
    "file": "src/commands/project.ts",
    "line": 55,
    "policy": "prose",
    "pattern": "if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/publish.ts",
    "line": 90,
    "policy": "prose",
    "pattern": "if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/publish.ts",
    "line": 131,
    "policy": "not-a-hint",
    "pattern": "'--body', `Endorse ${record.name} (${record.id.slice(0, 8)}) for ${team}: ${scopeLabel}.\\n\\nOpened by terum-skills publish; merge to endorse.`,"
  },
  {
    "file": "src/commands/readme.ts",
    "line": 29,
    "policy": "not-a-hint",
    "pattern": "const comment = ['<!-- terum-skills:pr-comment -->', '## terum-skills publish preview', ...(skills.length ? skills.map((skill) => `- ${inlineText(skill.name)} (${inlineText(skill.category)})`) : ['- No new endorsements.'])].join('\\n');"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 36,
    "policy": "prose",
    "pattern": "/** Where the bundled /terum-skills Claude Code skill is offered from and placed (test knob). */"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 52,
    "policy": "prose",
    "pattern": "'Welcome to terum-skills.',"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 54,
    "policy": "prose",
    "pattern": "'This wizard helps you create a team, join an existing team, or resume setup. It checks GitHub, sets up your team, invites teammates, offers your local skills to connect, and offers the session hook and the /terum-skills Claude Code skill; re-run it any time to continue, and leave the invitation question blank to skip it.',"
  },
  {
    "file": "src/commands/setup.ts",
    "line": 216,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill ships inside this package, and setup is the one onboarding"
  },
  {
    "file": "src/commands/status.ts",
    "line": 30,
    "policy": "not-a-hint",
    "pattern": "io.print(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);"
  },
  {
    "file": "src/commands/sync.ts",
    "line": 138,
    "policy": "not-a-hint",
    "pattern": "if (!args.hook) notice(`Skipping ${team}: another terum-skills sync holds its session lock (${lockPath(store.root, team)}); retry when it finishes.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 66,
    "policy": "not-a-hint",
    "pattern": "io.print('Commit this to .github/workflows/terum-skills.yml in an ordinary PR by someone with push access.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 79,
    "policy": "fixed",
    "pattern": "if (targetHandle === binding.handle) throw new Error('You cannot remove yourself; run team leave <team> to leave this machine, or ask another admin to remove you.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 97,
    "policy": "fixed",
    "pattern": "if (typeof targetRaw.github !== 'string' || targetRaw.github.trim() === '') throw new Error(`${targetHandle} has no GitHub login on the roster, so there is no host access to revoke; run \\`team remove ${targetHandle} --archive-only\\` to archive the membership.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 137,
    "policy": "fixed",
    "pattern": "throw new Error(`${targetHandle} is archived; @${login}'s access could not be revoked: ${reason}. Re-run team remove ${targetHandle} to retry.`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 161,
    "policy": "prose",
    "pattern": "if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 348,
    "policy": "fixed",
    "pattern": "catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} Your roster entry people/${identity.handle}.json was already pushed to ${normalized}; run \\`${invocation(args.form, 'team join', args.target)}\\` again to continue under the existing entry, or ask an admin to \\`team remove ${identity.handle}\\` if you did not mean to join twice.`); }"
  },
  {
    "file": "src/commands/team.ts",
    "line": 396,
    "policy": "prose",
    "pattern": "if (teamJson === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');"
  },
  {
    "file": "src/commands/team.ts",
    "line": 486,
    "policy": "prose",
    "pattern": "return 'Ignored the credential embedded in the remote URL: terum-skills never stores one or passes one to git. Git access uses your configured Git credentials.';"
  },
  {
    "file": "src/commands/team.ts",
    "line": 533,
    "policy": "not-a-hint",
    "pattern": "await writeFile(pathJoin(staging, 'README.md'), `# ${teamName} skills\\n\\n<!-- terum-skills:begin -->\\n<!-- terum-skills:end -->\\n`);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 534,
    "policy": "not-a-hint",
    "pattern": "await writeFile(pathJoin(staging, '.github', 'workflows', 'terum-skills.yml'), WORKFLOW);"
  },
  {
    "file": "src/commands/team.ts",
    "line": 550,
    "policy": "fixed",
    "pattern": "export const WORKFLOW = `# This workflow requires published terum-skills npm artifacts (M4)."
  },
  {
    "file": "src/commands/team.ts",
    "line": 551,
    "policy": "fixed",
    "pattern": "name: terum-skills"
  },
  {
    "file": "src/commands/team.ts",
    "line": 576,
    "policy": "fixed",
    "pattern": "[ -z \"$name\" ] || [ ! -d \"skills/$name\" ] || npx -y terum-skills@latest validate \"skills/$name\" --cwd ."
  },
  {
    "file": "src/commands/team.ts",
    "line": 587,
    "policy": "fixed",
    "pattern": "- run: npx -y terum-skills@latest receipt-check --base origin/main"
  },
  {
    "file": "src/commands/team.ts",
    "line": 595,
    "policy": "fixed",
    "pattern": "- run: npx -y terum-skills@latest readme"
  },
  {
    "file": "src/commands/team.ts",
    "line": 616,
    "policy": "fixed",
    "pattern": "run: npx -y terum-skills@latest readme --pr-comment origin/main > /tmp/terum-skills-comment.md"
  },
  {
    "file": "src/commands/team.ts",
    "line": 621,
    "policy": "fixed",
    "pattern": "existing=$(gh api \"repos/\\${{ github.repository }}/issues/$PR/comments\" --paginate --jq '.[] | select(.body | contains(\"<!-- terum-skills:pr-comment -->\")) | .id' | head -n 1)"
  },
  {
    "file": "src/commands/team.ts",
    "line": 622,
    "policy": "fixed",
    "pattern": "body=$(cat /tmp/terum-skills-comment.md)"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 36,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill setup placed: only a copy carrying our marker is ours to remove."
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 49,
    "policy": "prose",
    "pattern": "detail.push('terum-skills will be removed from this machine.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 58,
    "policy": "not-a-hint",
    "pattern": "if (wrapperPresence.kind === 'foreign') detail.push(`  ${wrapperDir} is not the bundled /terum-skills Claude Code skill (${wrapperPresence.why}); left alone`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 59,
    "policy": "not-a-hint",
    "pattern": "else detail.push(`  ${wrapperPresence.kind === 'managed' ? '/terum-skills Claude Code skill at' : 'No /terum-skills Claude Code skill at'} ${wrapperDir}`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 65,
    "policy": "fixed",
    "pattern": "detail.push('Your membership and installed-skill records in the team repo are unchanged. Rejoining does not re-place skills; `npx -y terum-skills@latest install member <handle>` does.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 67,
    "policy": "prose",
    "pattern": "if (!(await io.confirm('Remove terum-skills from this machine?', { detail }))) return cancelled('Uninstall was cancelled.');"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 73,
    "policy": "prose",
    "pattern": "io.print(`Wrote a record of this machine's terum-skills state to ${record}.`);"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 85,
    "policy": "not-a-hint",
    "pattern": "catch (error) { return failure(`${message(error)}; the /terum-skills skill was left in place and nothing else was removed`); }"
  },
  {
    "file": "src/commands/uninstallMachine.ts",
    "line": 86,
    "policy": "not-a-hint",
    "pattern": "if (wrapperRemoved) io.print(`Removed the /terum-skills Claude Code skill from ${wrapperDir}.`);"
  },
  {
    "file": "src/commands/update.ts",
    "line": 24,
    "policy": "not-a-hint",
    "pattern": "const lines = [`terum-skills ${running ?? 'version unknown'}`, `This copy: ${path}`];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 41,
    "policy": "fixed",
    "pattern": "case 'global': return ['If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 42,
    "policy": "fixed",
    "pattern": "case 'local': return [`If managed with npm, run in ${launch.root}:`, `  npm install ${launch.dependencyKind === 'devDependencies' ? '--save-dev ' : ''}terum-skills@latest`];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 43,
    "policy": "fixed",
    "pattern": "case 'npx': return [`Cache request recorded as: ${launch.request ?? 'unknown'}`, \"To request the registry's latest release, run:\", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'];"
  },
  {
    "file": "src/commands/update.ts",
    "line": 45,
    "policy": "fixed",
    "pattern": "default: return ['Installation method could not be established.', 'Update this copy with the tool that installed it.', \"To run the registry's latest release:\", '  npx -y terum-skills@latest <command>'];"
  },
  {
    "file": "src/index.ts",
    "line": 16,
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
    "line": 55,
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
    "line": 99,
    "policy": "prose",
    "pattern": "reject('inside-state-root', `inside the terum-skills state directory ${options.stateRoot}`);"
  },
  {
    "file": "src/lib/package.ts",
    "line": 3,
    "policy": "not-a-hint",
    "pattern": "export const PACKAGE_NAME = 'terum-skills';"
  },
  {
    "file": "src/lib/package.ts",
    "line": 4,
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
    "line": 12,
    "policy": "not-a-hint",
    "pattern": "export const README_BEGIN = '<!-- terum-skills:begin -->';"
  },
  {
    "file": "src/lib/readme.ts",
    "line": 13,
    "policy": "not-a-hint",
    "pattern": "export const README_END = '<!-- terum-skills:end -->';"
  },
  {
    "file": "src/lib/readme.ts",
    "line": 82,
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
    "line": 67,
    "policy": "not-a-hint",
    "pattern": "resolve({ code: expired ? 124 : code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: expired ? `terum-skills: ${command} ${verb} exceeded ${options.deadlineMs! / 1000} s` : Buffer.concat(err).toString('utf8') });"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 21,
    "policy": "prose",
    "pattern": "throw new Error(`${source} is inside the terum-skills state directory ${stateRoot}; move the folder elsewhere and connect that path.`);"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 50,
    "policy": "prose",
    "pattern": "// The /terum-skills Claude Code skill ships inside this package and is placed by setup; it is not a"
  },
  {
    "file": "src/lib/skill-source.ts",
    "line": 52,
    "policy": "not-a-hint",
    "pattern": "if (isManagedFrontmatter(parsed)) return reject('managed-wrapper', 'the /terum-skills Claude Code skill that ships with terum-skills; not a team skill', 'This folder is the /terum-skills Claude Code skill that ships with terum-skills and is placed by setup; it cannot be connected to a team.');"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 60,
    "policy": "prose",
    "pattern": "/** Another terum-skills process holds this clone's writer lock. A per-team caller (sync) skips the team and continues; a single-clone verb (publish) fails. */"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 389,
    "policy": "fixed",
    "pattern": "const launch = launcher ? `${shellQuote(launcher.node)} ${shellQuote(launcher.entry)} guard-push` : `npx -y ${shellQuote(`terum-skills@${packageVersion() ?? 'latest'}`)} guard-push`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 390,
    "policy": "fixed",
    "pattern": "const warning = `terum-skills push guard: ${launcher ? launcher.entry : 'npx'} is gone, so this push was NOT checked. Re-run \\`npx -y terum-skills@latest team join <remote>\\` to re-arm it.`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 393,
    "policy": "not-a-hint",
    "pattern": "'# terum-skills: the D12 ownership guard for a raw push from this clone. Regenerated on every join; do not edit.',"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 578,
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
    "line": 12,
    "policy": "prose",
    "pattern": "* The `/terum-skills` Claude Code skill: the SKILL.md that teaches Claude Code which verbs it may"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 14,
    "policy": "prose",
    "pattern": "* `scripts/bundle-skill.mjs` into dist/claude/skills/terum-skills/SKILL.md at build time, from the"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 15,
    "policy": "prose",
    "pattern": "* one canonical copy at .claude/skills/terum-skills/SKILL.md) and is placed under the user's global"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 21,
    "policy": "not-a-hint",
    "pattern": "export const WRAPPER_NAME = 'terum-skills';"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 22,
    "policy": "not-a-hint",
    "pattern": "export const MANAGED_BY = 'terum-skills';"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 24,
    "policy": "not-a-hint",
    "pattern": "export const BUNDLED_WRAPPER = join(packageRoot() ?? fileURLToPath(new URL('../../', import.meta.url)), 'dist', 'claude', 'skills', 'terum-skills', 'SKILL.md');"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 34,
    "policy": "prose",
    "pattern": "/** The idempotency key on parsed frontmatter: `name: terum-skills` plus `metadata.managed-by: terum-skills`. */"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 54,
    "policy": "prose",
    "pattern": "* What sits at `<skillsRoot>/terum-skills`. Judged without following links (the repo's rule for"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 93,
    "policy": "not-a-hint",
    "pattern": "if (bundled === null) throw new Error(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}).`);"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 96,
    "policy": "not-a-hint",
    "pattern": "if (presence.kind === 'foreign') throw new Error(`${directory} exists and is not the bundled /terum-skills skill (${presence.why}); move it aside and re-run.`);"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 131,
    "policy": "not-a-hint",
    "pattern": "if (state === 'unavailable') { io.print(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.source}); skipped.`); return 'unavailable'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 132,
    "policy": "not-a-hint",
    "pattern": "if (state === 'foreign') { io.print(`${directory} exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.`); return 'foreign'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 133,
    "policy": "not-a-hint",
    "pattern": "if (state === 'current') { io.print(`The /terum-skills Claude Code skill at ${directory} is current.`); return 'present'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 134,
    "policy": "not-a-hint",
    "pattern": "if (state === 'outdated') { await installWrapper(options); io.print(`Updated the /terum-skills Claude Code skill at ${directory}.`); return 'replaced'; }"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 135,
    "policy": "not-a-hint",
    "pattern": "if (!(await io.confirm(`Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ${directory})`))) {"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 136,
    "policy": "not-a-hint",
    "pattern": "io.print('Skipped the /terum-skills skill; re-run setup to install it later.');"
  },
  {
    "file": "src/lib/wrapper.ts",
    "line": 140,
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
    "line": 59,
    "policy": "prose",
    "pattern": "if (!version) return failure('This copy of terum-skills has no version; the desktop app is published per version.');"
  },
  {
    "file": "src/commands/app.ts",
    "line": 64,
    "policy": "prose",
    "pattern": "if (platform === 'wsl') io.print('The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal.');"
  },
  {
    "file": "src/commands/app.ts",
    "line": 90,
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
    "line": 166,
    "policy": "prose",
    "pattern": "if (RELEASE_ASSETS_MISSING.test(text)) return `No desktop app is published for terum-skills ${version} (looked for ${asset} on release v${version} of ${APP_REPOSITORY}). ${tail(form)}`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 126,
    "policy": "not-a-hint",
    "pattern": "const waitingLine = (info: { label: string; elapsedMs: number }): string => `Waiting for another terum-skills operation on ${info.label} to finish… (${Math.round(info.elapsedMs / 1000)} s)`;"
  },
  {
    "file": "src/lib/teamRepo.ts",
    "line": 601,
    "policy": "not-a-hint",
    "pattern": "throw new CloneBusy(`The write lock on ${label ?? root} is stamped ${Math.round(aheadMs / 1000)} s in this machine's future (${lockPath}), so waiting cannot clear it; remove that directory if no terum-skills command is running.`);"
  },
];
