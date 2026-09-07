import { ConfigStore, createConfigStore } from '../lib/config.js';
import type { Launch } from '../lib/launch.js';
import { packageVersion } from '../lib/package.js';
import type { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { createReleaseState, describeUpdate, maintainReleaseState, ProbePolicy, probePolicy, ReleaseStateStore } from '../lib/update.js';

export interface UpdateArgs { config?: ConfigStore; runner?: Runner; launch?: Launch; noUpdateCheck?: boolean; probe?: ProbePolicy; upstream?: string; state?: ReleaseStateStore; running?: string | null; now?: () => number; }

/** Exit 0 means advice was produced. Package managers are printed, never executed. */
export async function run(args: UpdateArgs, io: Prompter): Promise<Result<void>> {
  try {
    const store = args.config ?? createConfigStore();
    const state = args.state ?? createReleaseState(store.root, args.upstream);
    const running = args.running === undefined ? packageVersion() : args.running;
    const launch = args.launch ?? { kind: 'unknown', path: 'unknown' };
    const policy = probePolicy(await store.read(), args.probe);
    const result = await maintainReleaseState({ state, running, launch, now: args.now, runner: args.runner ?? systemRunner, upstream: args.upstream, probe: policy, force: true });
    const description = describeUpdate(await state.read(), running, (args.now ?? Date.now)());
    const observation = description.advertisement;
    const observed = observation ? `${observation.version} (observed ${observation.at})` : 'unknown';
    const path = launch.kind === 'source' || launch.kind === 'unknown' ? launch.path : launch.path.replace(/[\\/]dist[\\/]index\.js$/, '');
    const lines = [`terum-skills ${running ?? 'version unknown'}`, `This copy: ${path}`];
    if (launch.kind === 'local' && !description.matches) lines.push(`Declared dependency of: ${launch.root}`);
    if (policy === 'nobody') lines.push('Release advertisements are not checked on this machine.');
    else if (result && !result.ok) lines.push(`Could not check release advertisements: ${result.error}`, `Last successful observation: ${observation ? observed : 'none'}`, 'npm availability was not checked.');
    else if (description.matches || launch.kind === 'global' || launch.kind === 'local' || !observation) lines.push(`Latest advertised release: ${observed}`);
    if (result?.ok && result.prereleases) lines.push('pre-release tags are not compared');
    const registry = description.registry;
    if (registry && description.registryNewer) lines.push(`Latest observed registry release: ${registry.version} (npx cache, ${registry.at})`);
    if (description.matches && policy !== 'nobody' && result?.ok) lines.push('This copy matches the release advertisement. npm availability was not checked.');
    else lines.push(...advice(launch));
    for (const line of lines) io.print(line);
    return success(undefined);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

function advice(launch: Launch): string[] {
  switch (launch.kind) {
    case 'global': return ['If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'];
    case 'local': return [`If managed with npm, run in ${launch.root}:`, `  npm install ${launch.dependencyKind === 'devDependencies' ? '--save-dev ' : ''}terum-skills@latest`];
    case 'npx': return [`Cache request recorded as: ${launch.request ?? 'unknown'}`, "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'];
    case 'source': return ['Running from a source checkout.', 'Update the checkout through its normal git workflow, then run:', '  npm run build', "The checkout's version does not establish npm publication."];
    default: return ['Installation method could not be established.', 'Update this copy with the tool that installed it.', "To run the registry's latest release:", '  npx -y terum-skills@latest <command>'];
  }
}
