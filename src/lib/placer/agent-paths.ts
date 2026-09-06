import { join, resolve, sep } from 'node:path';

/**
 * Our deliberately small agent path table. Derived from iflytek/skillhub
 * cli/src/agents/profiles/claude-code.ts @ 61aa957ecc45e6c3672d11e0c48c13bd601f15c5
 * (both entries there are `.claude/skills`). It is not a vendored profile: the upstream
 * profile factory includes agent auto-detection, which phase 1 expressly excludes.
 */
export const AGENT_PATHS = {
  'claude-code': {
    global: (home: string) => join(home, '.claude', 'skills'),
    project: (repoRoot: string) => join(repoRoot, '.claude', 'skills'),
  },
} as const;

export type SupportedAgent = keyof typeof AGENT_PATHS;

/**
 * True when `root` is a skills directory one of our agents owns (`…/.claude/skills`). The Placer
 * removes only directly under such a root: the ledger names the path, this names the only kind of
 * place a ledger path may point (D5a, 2026-09-05 close-out walk).
 */
export function isSkillsRoot(root: string): boolean {
  const resolved = resolve(root);
  return Object.values(AGENT_PATHS).some((agent) => resolved.endsWith(`${sep}${agent.global('')}`));
}

