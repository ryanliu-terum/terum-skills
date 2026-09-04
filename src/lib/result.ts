export type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (error: string): Result<never> => ({ ok: false, error });
