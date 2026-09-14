import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { PublishArgs, SkillCard } from '../../backend/types';

/**
 * Settings ▸ Publishing ▸ Defaults (Teddy, 2026-09-14). Two per-machine preferences the publish dialogs honour,
 * both mapped one-to-one onto what the CLI's `publish <ref>` really takes: `--project` (the target list) and
 * `--category` (skips the model suggestion). Nothing here invents a switch the CLI does not have.
 */
export const PUBLISH_TARGET_KEY = 'publish:target', PUBLISH_CATEGORY_KEY = 'publish:category';
/** The CLI's own behaviour with no flag: it asks which project when the team has more than one, else Global. */
export const TARGET_ASK = 'Ask each time';
export const GLOBAL_LIST = 'Global';
export const CATEGORY_SUGGEST = 'Model suggests', CATEGORY_ASK = 'Ask before publishing';
export const CATEGORY_OPTIONS = [CATEGORY_SUGGEST, CATEGORY_ASK] as const;

/** The target choices: the CLI's question, Global, then the team's projects (Global never listed twice). */
export function targetOptions(projects: readonly string[] | null | undefined): string[] {
  const rest = (projects ?? []).filter(name => name !== GLOBAL_LIST);
  return [TARGET_ASK, GLOBAL_LIST, ...rest];
}
/** A stored target the team no longer has falls back to the CLI's question rather than sending an unknown `--project`. */
export function effectiveTarget(stored: string, projects: readonly string[] | null | undefined): string {
  return targetOptions(projects).includes(stored) ? stored : TARGET_ASK;
}
/** The flags a publish sends: `project` unless the target is the CLI's question; `category` only when the user typed one. */
export function publishFlags(target: string, category: string | null): Pick<PublishArgs, 'project' | 'category'> {
  const trimmed = category?.trim() ?? '';
  return { ...(target === TARGET_ASK ? {} : { project: target }), ...(trimmed ? { category: trimmed } : {}) };
}

export type SharedState = 'In sync' | 'Edited since publish' | 'Not published yet' | 'Not shared' | '—';
/** Settings ▸ Publishing ▸ Shared from this machine: one state per Global folder, from the Library's own fields. */
export function sharedState(card: Pick<SkillCard, 'knownToTeam' | 'localMatch' | 'edited'>): SharedState {
  if (!card.knownToTeam) return 'Not shared';
  if (card.localMatch === 'identical') return 'In sync';
  if (card.localMatch === 'differs' || card.edited) return 'Edited since publish';
  if (card.localMatch === 'none') return 'Not published yet';
  return '—';
}

export interface PublishDefaults { target: string; category: string; projects: string[] | null; categories: string[] | null; ready: boolean }
/** The two preferences plus the team's project and category lists (from the `settings` read the Settings screen already makes). */
export function usePublishDefaults(): PublishDefaults {
  const backend = useBackend();
  const settings = useQuery({ queryKey: ['settings', 'publish-defaults'], staleTime: 60_000, queryFn: ({ signal }) => backend.settings(undefined, { signal }) });
  const policy = settings.data?.ok ? settings.data.value.TEAM_POLICY : null;
  const storedTarget = String(backend.prefs.get(PUBLISH_TARGET_KEY, TARGET_ASK));
  const storedCategory = String(backend.prefs.get(PUBLISH_CATEGORY_KEY, CATEGORY_SUGGEST));
  return {
    target: effectiveTarget(storedTarget, policy?.projects),
    category: (CATEGORY_OPTIONS as readonly string[]).includes(storedCategory) ? storedCategory : CATEGORY_SUGGEST,
    projects: policy?.projects ?? null,
    categories: policy?.categories ?? null,
    ready: !settings.isPending,
  };
}
