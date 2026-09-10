import { abbreviateHome } from '../paths';

export function scannedRoots(local: {local?: readonly {root: string; repoRoot?: string | undefined; rootState?: string | undefined}[] | undefined}, home: string): string[] {
 return (local.local ?? []).filter(section => section.rootState !== 'absent').map(section => abbreviateHome(section.repoRoot ?? section.root, home));
}
