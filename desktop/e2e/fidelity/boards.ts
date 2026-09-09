import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

// Use Node's URL explicitly so Vite/Vitest do not rewrite this filesystem URL as a browser asset.
const design = JSON.parse(
  readFileSync(new NodeURL('../../src/fixtures/design.json', import.meta.url), 'utf8'),
) as { SKILLS: { name: string }[]; HOVER_INDEX: number };
if (!design || !Array.isArray(design.SKILLS)) {
  throw new Error('design.SKILLS must be an array.');
}
if (!Number.isInteger(design.HOVER_INDEX) || design.HOVER_INDEX < 0 || design.HOVER_INDEX >= design.SKILLS.length) {
  throw new Error('design.HOVER_INDEX does not identify a skill.');
}
const hoverSkill=design.SKILLS[design.HOVER_INDEX];
if (typeof hoverSkill?.name !== 'string') {
  throw new Error(`design.SKILLS[${design.HOVER_INDEX}].name must be a string.`);
}
export type BoardClass='screen'|'dialog'|'state'|'full';
export interface Board {name:string;route:string;klass:BoardClass;width:number;height:number;exact?:true;hover?:string}
export const BOARDS:readonly Board[]=[
  {
    "name": "Main",
    "route": "#/frame",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "exact": true
  },
  {
    "name": "Light",
    "route": "#/frame?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "exact": true
  },
  {
    "name": "Library",
    "route": "#/library/global",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "hover": `[data-testid="skill-card-${hoverSkill.name}"] [data-flag="update"]`
  },
  {
    "name": "LibraryLight",
    "route": "#/library/global?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "hover": `[data-testid="skill-card-${hoverSkill.name}"] [data-flag="update"]`
  },
  {
    "name": "LibraryEmpty",
    "route": "#/library/global?__mock=empty",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryNoResults",
    "route": "#/library/global?q=deploy%20prod",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryLoading",
    "route": "#/library/global?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryCollapsed",
    "route": "#/library/global?overview=0",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibrarySidebarHidden",
    "route": "#/library/global?sidebar=hidden",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryProjectsCollapsed",
    "route": "#/library/global?projects=collapsed",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryInboxCollapsed",
    "route": "#/library/global?inbox=collapsed",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "LibraryError",
    "route": "#/library/global?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetail",
    "route": "#/skill/deploy-check",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailLight",
    "route": "#/skill/deploy-check?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailRailClosed",
    "route": "#/skill/deploy-check?tab=evals&rail=closed",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailUsesHover",
    "route": "#/skill/deploy-check",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "hover": "[data-testid=\"uses-facepile\"]"
  },
  {
    "name": "SkillDetailEvals",
    "route": "#/skill/deploy-check?tab=evals",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailEvalsReport",
    "route": "#/skill/deploy-check?tab=evals&rail=closed&full=1",
    "klass": "full",
    "width": 1440,
    "height": 1900
  },
  {
    "name": "SkillDetailQuality",
    "route": "#/skill/deploy-check?tab=quality",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailActivity",
    "route": "#/skill/deploy-check?tab=activity",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailFiles",
    "route": "#/skill/deploy-check?menu=files",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailNoReceipt",
    "route": "#/skill/onboarding-tour?tab=evals",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailPartial",
    "route": "#/skill/migration-guard?tab=evals",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailDisabled",
    "route": "#/skill/deploy-check?__mock=disabled",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailNotInstalled",
    "route": "#/skill/deploy-check?__mock=not-installed",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailInstall",
    "route": "#/skill/deploy-check?__mock=not-installed&dialog=install",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailInstallLight",
    "route": "#/skill/deploy-check?__mock=not-installed&dialog=install&theme=light",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailRemove",
    "route": "#/skill/deploy-check?dialog=remove",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailRunEval",
    "route": "#/skill/deploy-check?tab=evals&dialog=run-eval",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailLoading",
    "route": "#/skill/deploy-check?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SkillDetailError",
    "route": "#/skill/deploy-check?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "Inbox",
    "route": "#/inbox",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxLight",
    "route": "#/inbox?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxUpdate",
    "route": "#/inbox/update-pr-review",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxAlert",
    "route": "#/inbox/alert-offtarget-deploy-check",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxEval",
    "route": "#/inbox/eval-deploy-check",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxLoading",
    "route": "#/inbox?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxEmpty",
    "route": "#/inbox?__mock=empty",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "InboxError",
    "route": "#/inbox?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "Marketplace",
    "route": "#/marketplace",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceFilters",
    "route": "#/marketplace?filters=open",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceLight",
    "route": "#/marketplace?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceLoading",
    "route": "#/marketplace?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceNoResults",
    "route": "#/marketplace?q=deploy%20prod&active=2",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceError",
    "route": "#/marketplace?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceFull",
    "route": "#/marketplace",
    "klass": "full",
    "width": 1440,
    "height": 1080
  },
  {
    "name": "MarketplaceProject",
    "route": "#/marketplace/projects/terum",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceProjectNotInstalled",
    "route": "#/marketplace/projects/docs",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceProjectInstall",
    "route": "#/marketplace/projects/docs?dialog=install",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplacePerson",
    "route": "#/marketplace/people/ryan",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplacePersonNotInstalled",
    "route": "#/marketplace/people/lena",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceSkills",
    "route": "#/marketplace/skills",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceProjects",
    "route": "#/marketplace/projects",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplacePeople",
    "route": "#/marketplace/people",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceCategories",
    "route": "#/marketplace/categories",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "MarketplaceCategory",
    "route": "#/marketplace/categories/infra",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "Share",
    "route": "#/share",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "hover": "[data-testid=\"member-row-5\"]"
  },
  {
    "name": "ShareInvite",
    "route": "#/share?dialog=invite",
    "klass": "dialog",
    "width": 1440,
    "height": 900
  },
  {
    "name": "ShareLight",
    "route": "#/share?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900,
    "hover": "[data-testid=\"member-row-5\"]"
  },
  {
    "name": "ShareLoading",
    "route": "#/share?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "ShareEmpty",
    "route": "#/share?__mock=empty",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "ShareError",
    "route": "#/share?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "Settings",
    "route": "#/settings/account",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsTeams",
    "route": "#/settings/teams",
    "klass": "full",
    "width": 1440,
    "height": 1000
  },
  {
    "name": "SettingsMachine",
    "route": "#/settings/machine",
    "klass": "full",
    "width": 1440,
    "height": 1340,
    "hover": "[data-testid=\"placement-row-1\"]"
  },
  {
    "name": "SettingsSync",
    "route": "#/settings/sync",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsUpdates",
    "route": "#/settings/updates",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsInbox",
    "route": "#/settings/inbox",
    "klass": "full",
    "width": 1440,
    "height": 960
  },
  {
    "name": "SettingsEvals",
    "route": "#/settings/evals",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsSharing",
    "route": "#/settings/sharing",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsAppearance",
    "route": "#/settings/appearance",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsAdvanced",
    "route": "#/settings/advanced",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsAbout",
    "route": "#/settings/about",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsLight",
    "route": "#/settings/account?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsLoading",
    "route": "#/settings/account?__mock=loading",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsError",
    "route": "#/settings/account?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  },
  {
    "name": "SettingsLeave",
    "route": "#/settings/teams?dialog=leave",
    "klass": "dialog",
    "width": 1440,
    "height": 1000
  },
  {
    "name": "SettingsPrune",
    "route": "#/settings/machine?dialog=prune",
    "klass": "dialog",
    "width": 1440,
    "height": 1340
  },
  {
    "name": "OnboardingBoot",
    "route": "#/onboarding/boot",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingWelcome",
    "route": "#/onboarding/welcome",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingStyle",
    "route": "#/onboarding/style",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingManage",
    "route": "#/onboarding/basics?tab=manage",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingEval",
    "route": "#/onboarding/basics?tab=eval",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingShare",
    "route": "#/onboarding/basics?tab=share",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingSearch",
    "route": "#/onboarding/basics?tab=search",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingMore",
    "route": "#/onboarding/basics?tab=more",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingTeam",
    "route": "#/onboarding/team",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingFeedback",
    "route": "#/onboarding/feedback",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingDone",
    "route": "#/onboarding/done",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingLight",
    "route": "#/onboarding/style?theme=light",
    "klass": "screen",
    "width": 1440,
    "height": 900
  },
  {
    "name": "OnboardingError",
    "route": "#/onboarding/boot?__mock=error",
    "klass": "state",
    "width": 1440,
    "height": 900
  }
];
