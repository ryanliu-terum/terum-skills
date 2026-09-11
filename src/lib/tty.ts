import { isatty } from 'node:tty';

/** Read-only stdout (fd 1) capability; this leaf never reads input or writes output. */
export function terminalOutputIsTTY(): boolean { return isatty(1); }
