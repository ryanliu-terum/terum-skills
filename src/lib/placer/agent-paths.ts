import { join } from 'node:path';

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

