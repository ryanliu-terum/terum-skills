import { defineConfig } from 'vitest/config';

// Tests are collocated under src/**/__tests__/ (build spec §3, §12); bare-repo fixtures, no network.
// The suite must not depend on, or touch, the developer's ambient state: no global or system
// gitconfig, no credential helpers, no terminal prompts, no ambient GitHub credentials, and a
// throwaway HOME so `createConfigStore()` defaults never reach the real ~/.terum. Variables that
// must be *unset* (GIT_DIR, GIT_AUTHOR_*, GITHUB_TOKEN, …) are deleted in setup.ts, because
// `env` can only set strings.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    setupFiles: ['src/lib/__tests__/setup.ts'],
    testTimeout: 120_000,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.excludesFile',
      GIT_CONFIG_VALUE_0: '/dev/null',
    },
  },
});
