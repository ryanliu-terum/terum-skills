import { z } from 'zod';
import type { IconName } from '../../components/ui/icon-paths';
// The navigation is also drawn while settings() is pending or has failed.
export const settingsSections: readonly [string,string,IconName][] = [
 ['account','Account','user'],['teams','Team','users'],['machine','This machine','laptop'],['sync','Sync','refresh'],['updates','Updates','arrow-up-circle'],['inbox','Inbox','inbox'],['evals','Evals','flask'],['publishing','Publishing','upload'],['appearance','Appearance','sun'],['advanced','Advanced','sliders'],['about','About','info'],
];
// D22 drops the update and review kinds; design.json's INBOX_KIND_TEXT still carries their copy, so
// the Settings ▸ Inbox pane filters on these labels rather than on the fixture's key set.
export const inboxLabels:Record<string,string>={share:'Shared with you',alert:'Alert',eval:'Eval finished',author:'Your skill',team:'Team'};

// The shared DTO exposes these as loose arrays. Reject malformed rows with their field path.
export const settingsRows = z.object({
 PLACEMENTS:z.array(z.tuple([z.string(),z.string(),z.string(),z.string().nullable(),z.string(),z.string()])),
 APPROVALS:z.array(z.tuple([z.string(),z.array(z.string()),z.string()])),
 QUARANTINE:z.array(z.tuple([z.string(),z.string(),z.string(),z.string()])).nullable(),
 // `SHARED` was the "shared from this machine" list, projected from `config.shared`. §12 deletes
 // that ledger, so nothing supplies the key and no caller reads it — but a required key here is
 // parsed on every Settings render (SettingsContent parses unconditionally), so leaving it made
 // every Settings test fail with `expected array, received undefined`.
 SHORTCUTS:z.array(z.tuple([z.string(),z.string()])),
});
