import type { QueryKey } from '@tanstack/react-query';
import type { ChangeSource } from '../backend/types';

const prefixes: Record<ChangeSource, readonly string[]> = {
  config: ['status', 'settings', 'onboarding'],
  clone: ['library', 'skill', 'catalog', 'roster', 'inbox', 'receipts', 'status'],
  placed: ['library', 'skill', 'settings', 'status', 'catalog'],
  stamp: ['status', 'settings', 'inbox'],
};

export function affects(source: ChangeSource, queryKey: QueryKey): boolean {
  return typeof queryKey[0] === 'string' && prefixes[source].includes(queryKey[0]);
}
