import { sep as pathSeparator } from 'node:path';
import { PACKAGE_NAME } from './package.js';

export interface LaunchEvidence { entry: string; realpath(p: string): Promise<string>; readJson(p: string): Promise<unknown | null>; sep?: string; }
export type Launch =
  | { kind: 'npx'; path: string; cacheDir: string; request: string | null }
  | { kind: 'local'; path: string; root: string; dependencyKind: 'dependencies' | 'devDependencies' }
  | { kind: 'global'; path: string }
  | { kind: 'source'; path: string; root: string }
  | { kind: 'unknown'; path: string };
export type LaunchKind = Launch['kind'];

/** Describe this canonical executing entry only; no environment or package-manager guessing. */
export async function describeLaunch(input: LaunchEvidence): Promise<Launch> {
  let path: string;
  try { path = await input.realpath(input.entry); } catch { return { kind: 'unknown', path: input.entry }; }
  const sep = input.sep ?? pathSeparator;
  const read = async (p: string): Promise<Record<string, unknown> | null> => {
    try { const value = await input.readJson(p); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
    catch { return null; }
  };
  const npx = path.indexOf(`${sep}_npx${sep}`);
  if (npx >= 0) {
    const hashEnd = path.indexOf(sep, npx + `${sep}_npx${sep}`.length);
    if (hashEnd < 0) return { kind: 'unknown', path };
    const cacheDir = path.slice(0, hashEnd);
    const manifest = await read(`${cacheDir}${sep}package.json`);
    const metadata = manifest?._npx;
    const packages = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).packages : null;
    const matches = Array.isArray(packages) ? packages.filter((p): p is string => typeof p === 'string' && (p === PACKAGE_NAME || p.startsWith(`${PACKAGE_NAME}@`))) : [];
    const request = matches.length === 1 ? matches[0]! : null;
    return { kind: 'npx', path, cacheDir, request };
  }
  const index = path.lastIndexOf(`${sep}node_modules${sep}`);
  if (index >= 0) {
    const root = path.slice(0, index);
    const manifest = await read(`${root}${sep}package.json`);
    const exact = path.slice(index) === `${sep}node_modules${sep}${PACKAGE_NAME}${sep}dist${sep}index.js`;
    if (exact) {
      for (const dependencyKind of ['dependencies', 'devDependencies'] as const) {
        const dependencies = manifest?.[dependencyKind];
        if (dependencies && typeof dependencies === 'object' && Object.hasOwn(dependencies, PACKAGE_NAME)) return { kind: 'local', path, root, dependencyKind };
      }
      return { kind: 'global', path };
    }
    return { kind: 'unknown', path };
  }
  const suffix = `${sep}dist${sep}index.js`;
  if (path.endsWith(suffix)) {
    const root = path.slice(0, -suffix.length);
    if ((await read(`${root}${sep}package.json`))?.name === PACKAGE_NAME) return { kind: 'source', path, root };
  }
  return { kind: 'unknown', path };
}

export function packageRemovalLines(launch: Launch | undefined): string[] {
  const location = `This copy of terum-skills runs from ${launch?.path || 'an unknown location'}.`;
  switch (launch?.kind) {
    case 'global': return [location, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)'];
    case 'local': return [location, `It is a dependency of ${launch.root}: run npm uninstall terum-skills there, or remove it from that package.json.`];
    case 'npx': return [location, 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.'];
    default: return [location, 'Remove it with whatever put it there.'];
  }
}
