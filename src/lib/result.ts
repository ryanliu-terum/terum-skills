export type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string; cancelled?: true; refused?: true; permanent?: true; value?: T };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(error: string, value?: T): Result<T> => value === undefined ? { ok: false, error } : { ok: false, error, value };

export const failureWith = <T>(value: T, error: string): Result<T> => ({ ok: false, error, value });

/** A person declined the operation; the message remains the terminal-facing explanation. */
export function cancelled(message: string): Result<never> {
  return { ok: false, error: message, cancelled: true };
}

export class CancelledError extends Error { readonly cancelled = true; }

export class RefusedError extends Error { readonly refused = true; }

export function refused(message: string): Result<never> {
  return { ok: false, error: message, refused: true };
}

/**
 * The operation failed for a cause nothing later in the same run can change (nothing published for this version, a
 * download that was rejected or stopped). A caller that would otherwise try again before it exits should not.
 */
export function permanent(message: string): Result<never> {
  return { ok: false, error: message, permanent: true };
}

export function fromError(error: unknown): Result<never> {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof RefusedError ? refused(message) : error instanceof CancelledError ? cancelled(message) : failure(message);
}
