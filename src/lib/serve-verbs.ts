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
 * anyway, so the per-process saving is noise there (subsecond spec §2).
 *
 * `usage` is the one entry that WRITES, and it is deliberate. It appends the firings it scanned to
 * `~/.terum/skills/run/usage-events.jsonl` on every run. That is safe here — the file is
 * machine-local, the append never takes the clone writer lock this list exists to protect, and it is
 * one `O_APPEND` write of whole lines, so concurrent requests cannot interleave a record. It is also
 * necessary: the desktop drives every read through `serve`, so a serve path that skipped the append
 * would mean a machine whose owner only uses the app never archives anything, and the archive is the
 * only thing standing between this feature and a permanent ~15-event visibility cap (build spec §3).
 * Membership in this list is the ONLY gate (`commands/serve.ts` checks it and nothing else), so the
 * exception is recorded here rather than left for a reader to infer.
 */
export const SERVE_READ_VERBS: readonly string[] = Object.freeze(['status', 'ls', 'eval-report', 'search', 'validate', 'update', 'usage']);
