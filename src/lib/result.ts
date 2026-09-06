export type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string; value?: T };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(error: string, value?: T): Result<T> => value === undefined ? { ok: false, error } : { ok: false, error, value };
