import type { Runner } from './runner.js';

/** gh --paginate --slurp returns an array of response pages; accept one-page fixture output too. */
export function paginatedItems<T>(source: string): T[] {
  const parsed = JSON.parse(source || '[]') as unknown;
  if (!Array.isArray(parsed)) throw new Error('GitHub returned an invalid paginated response.');
  return parsed.flatMap((page) => Array.isArray(page) ? page : [page]) as T[];
}

/**
 * GitHub logins holding admin permission on `ownerRepo`, lowercased. Returns null when the lookup
 * is unavailable — gh absent, offline, unauthenticated, or a malformed response — and never throws:
 * callers use it inside offline-tolerant reads (`status`), where "unknown" must stay distinguishable
 * from "not an admin".
 */
export async function adminLogins(runner: Runner, ownerRepo: string): Promise<string[] | null> {
  try {
    const admins = await runner.run('gh', ['api', `repos/${ownerRepo}/collaborators?permission=admin`, '--paginate', '--slurp']);
    if (admins.code !== 0) return null;
    return paginatedItems<{ login?: string }>(admins.stdout).map((member) => member.login?.toLowerCase()).filter((value): value is string => Boolean(value));
  } catch { return null; }
}
