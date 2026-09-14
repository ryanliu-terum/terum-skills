import type { PrefStore } from '../types';

/**
 * Settings ▸ Evals defaults as CLI flags. One producer for every eval the app starts — a single run, a queue
 * drain, a batch — so the flags the settings copy promises ("the flags the app passes") are the flags passed.
 */
export function evalPrefFlags(prefs: PrefStore): string[] {
  const k = prefs.get('eval:k', ''), model = prefs.get('eval:model', ''), judge = prefs.get('eval:judge', '');
  return [...(k && k !== '—' ? ['--k', k] : []), ...(model ? ['--model', model] : []), ...(judge ? ['--judge-model', judge] : [])];
}
