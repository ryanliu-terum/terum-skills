/**
 * The verbs `serve` will run on its long-lived session, and the single place both sides read them from.
 *
 * This file must import nothing, ever. The desktop adapter imports it directly, and the desktop bundle is a
 * browser bundle: one transitive import of a `node:` builtin anywhere in this module's graph externalises at
 * build time and throws in the page (`node:tty.isatty` did exactly that when this list lived in frames.ts).
 * Keeping it a leaf is what lets one constant serve both trees instead of a duplicate that drifts.
 *
 * Reads only, deliberately. A long-lived process shared with install, sync, eval, connect, publish or
 * uninstall would share the clone writer lock, the shutdown hooks that release it, agent children and
 * per-request working directories — all process-global today. Their latency is git, network or a model
 * anyway, so the per-process saving is noise there. See .planning/specs/2026-09-11-w02b-subsecond.md §2.
 */
export const SERVE_READ_VERBS: readonly string[] = Object.freeze(['status', 'ls', 'eval-report', 'search', 'validate', 'update']);
