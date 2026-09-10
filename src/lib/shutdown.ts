/**
 * One shutdown path for the whole bin. A cancel (docs/frame-protocol.md's `cancel` frame) and a POSIX
 * SIGTERM both mean the same thing — stop now, but clean up first — and both must reach the same code,
 * because on Windows there is no signal at all: terminating the process runs nothing.
 *
 * Hooks are synchronous and best effort. They are what kills tracked child processes; releasing file
 * locks is NOT their job — `process.exit` in src/index.ts emits 'exit', which is what signal-exit and
 * proper-lockfile hang their own cleanup off (verified: a held clone lock is removed by process.exit
 * on this platform). This module deliberately does not reference `process`: eslint.config.js:24 gives
 * src/index.ts sole ownership of the exit, and keeping it out of here means no rule exception and a
 * unit test that needs no process.
 */
const hooks = new Set<() => void>();

/** Register work that must happen before the bin exits. Registration order is run order. */
export function onShutdown(hook: () => void): void { hooks.add(hook); }

/** Run every registered hook exactly once, in registration order. Never throws. */
export function runShutdownHooks(): void {
  for (const hook of [...hooks]) {
    hooks.delete(hook);
    // A hook that throws must not take the remaining hooks — or the exit — down with it: this is the
    // last code that runs, there is no channel left to report on, and the next line is process.exit.
    try { hook(); } catch { /* see above */ }
  }
}
