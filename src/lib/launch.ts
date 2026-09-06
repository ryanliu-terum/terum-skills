import { sep as pathSeparator } from 'node:path';

export type LaunchKind = 'npx' | 'global' | 'local' | 'unknown';
export interface Launch { kind: LaunchKind; path: string; projectDir?: string; }

/** Describe this executing copy only; no package-manager or installation inventory is inferred. */
export function describeLaunch(input: { argv1: string | undefined; env: Record<string, string | undefined>; cwd: string; sep?: string }): Launch {
  const path = input.argv1 ?? '';
  const sep = input.sep ?? pathSeparator;
  if (!path) return { kind: 'unknown', path };
  if (path.includes(`${sep}_npx${sep}`) || input.env.npm_lifecycle_event === 'npx') return { kind: 'npx', path };
  const index = path.lastIndexOf(`${sep}node_modules${sep}`);
  const cwd = input.cwd.endsWith(sep) ? input.cwd.slice(0, -sep.length) : input.cwd;
  if (index >= 0) {
    const projectDir = path.slice(0, index);
    if (projectDir === cwd || cwd.startsWith(projectDir + sep)) return { kind: 'local', path, projectDir };
  }
  if ((sep === '/' && path.includes('/lib/node_modules/terum-skills/')) || (sep === '\\' && path.includes('\\node_modules\\terum-skills\\'))) return { kind: 'global', path };
  return { kind: 'unknown', path };
}

export function packageRemovalLines(launch: Launch | undefined): string[] {
  const location = `This copy of terum-skills runs from ${launch?.path || 'an unknown location'}.`;
  switch (launch?.kind) {
    case 'global': return [location, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)'];
    case 'local': return [location, `It is a dependency of ${launch.projectDir}: run npm uninstall terum-skills there, or remove it from that package.json.`];
    case 'npx': return [location, 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.'];
    default: return [location, 'Remove it with whatever put it there.'];
  }
}
