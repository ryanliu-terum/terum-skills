export type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string; cancelled?: true; value?: T };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(error: string, value?: T): Result<T> => value === undefined ? { ok: false, error } : { ok: false, error, value };

/** A person declined the operation; the message remains the terminal-facing explanation. */
export function cancelled(message: string): Result<never> {
  return { ok: false, error: message, cancelled: true };
}

export class CancelledError extends Error { readonly cancelled = true; }

export function fromError(error: unknown): Result<never> {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof CancelledError ? cancelled(message) : failure(message);
}
