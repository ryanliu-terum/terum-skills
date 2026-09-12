import { expect,it } from 'vitest';
import { inboxItems,selectedInboxId } from '../mock/data';
it('assigns eight unique kind/sub/name ids',()=>{const items=inboxItems();expect(items).toHaveLength(8);expect(new Set(items.map(it=>it.id)).size).toBe(8);for(const item of items)expect(item.id).toBe([item.kind,item.sub,item.name].filter(Boolean).join('-'));});
it('selects the share item for the unqualified inbox URL',()=>expect(selectedInboxId()).toBe('share-secret-scan'));
it('selects known ids and leaves the pane empty for unknown ids',()=>{for(const it of inboxItems())expect(selectedInboxId(it.id)).toBe(it.id);expect(selectedInboxId('missing')).toBeNull();});
