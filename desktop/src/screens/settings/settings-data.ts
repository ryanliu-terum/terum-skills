import { z } from 'zod';
import type { IconName } from '../../components/ui/icon-paths';
// The navigation is also drawn while settings() is pending or has failed.
export const settingsSections: readonly [string,string,IconName][] = [
 ['account','Account','user'],['teams','Teams','users'],['machine','This machine','laptop'],['sync','Sync','refresh'],['updates','Updates','arrow-up-circle'],['inbox','Inbox','inbox'],['evals','Evals','flask'],['sharing','Sharing','upload'],['appearance','Appearance','sun'],['advanced','Advanced','sliders'],['about','About','info'],
];
export const inboxLabels:Record<string,string>={share:'Shared with you',update:'Update',alert:'Alert',eval:'Eval finished',review:'Review request',author:'Your skill',team:'Team'};

// The shared DTO exposes these as loose arrays. Reject malformed rows with their field path.
export const settingsRows = z.object({
 PLACEMENTS:z.array(z.tuple([z.string(),z.string(),z.string(),z.string().nullable(),z.string(),z.string()])),
 APPROVALS:z.array(z.tuple([z.string(),z.array(z.string()),z.string()])),
 QUARANTINE:z.array(z.tuple([z.string(),z.string(),z.string(),z.string()])),
 SHARED:z.array(z.tuple([z.string(),z.string(),z.string(),z.string()])),
 SHORTCUTS:z.array(z.tuple([z.string(),z.string()])),
});
