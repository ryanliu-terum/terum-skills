import { useLaunchContext, usePreference, useBackend } from '../backend';
import { useUrlState } from './url-state';
import { decide, needsLaunchStatus } from './launch-decision';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FrameScreen } from '../screens/frame/FrameScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { SkillScreen } from '../screens/skill/SkillScreen';
import { InboxScreen } from '../screens/inbox/InboxScreen';
import { MarketplaceScreen } from '../screens/marketplace/MarketplaceScreen';
import { ShareScreen } from '../screens/share/ShareScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { SearchScreen } from '../screens/search/SearchScreen';
import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { Shell } from '../components/domain/Shell';
import { ScreenFrame } from '../components/domain/ScreenFrame';
function NotFoundScreen(){return <Shell><ScreenFrame><div className="not-found">No such page<a href="#/library/global">Library</a></div></ScreenFrame></Shell>;}
// Navigation contract (AC-10): native hash history owns Back/Forward; links push and launch redirects replace.
// Sidebar selection follows the route family, with Global and each /library/project/:name explicit scopes.
// Settings defaults to Account. Marketplace skill links carry ?root=marketplace, including copied deep links.
// The tour order is boot → welcome → style → basics → team → feedback → done; only Boot has a real setup read model.
function LaunchRoute(){
 const backend=useBackend(),{mock}=useUrlState(),launch=useLaunchContext(),consumed=usePreference('launch:consumedWrittenAt','');
 const ctx=launch.data??null,needsStatus=needsLaunchStatus(ctx,consumed);
 const status=useQuery({queryKey:['status',mock],queryFn:({signal})=>backend.status(undefined,{signal}),enabled:needsStatus});
 if(launch.isPending||(needsStatus&&status.isPending))return <ScreenFrame ready={false}/>;
 return <Navigate to={decide(ctx,consumed,status.data)==='boot'?'/onboarding/boot':'/library/global'} replace/>;
}
function InboxRoute({children}:{children:ReactNode}){
 const backend=useBackend(),surfaces=useQuery({queryKey:['surfaces'],queryFn:()=>backend.surfaces()});
 if(surfaces.isPending)return <ScreenFrame ready={false}/>;
 return surfaces.data?.inbox?children:<Navigate to="/library/global" replace/>;
}
export const routes:RouteObject[]=[
{path:"/",element:<LaunchRoute/>},
{path:"/frame",element:<FrameScreen/>},
{path:"/library/global",element:<LibraryScreen/>},
{path:"/library/project/:name",element:<LibraryScreen/>},
{path:"/skill/:ref",element:<SkillScreen/>},
{path:"/inbox",element:<InboxRoute><InboxScreen/></InboxRoute>},
{path:"/inbox/:id",element:<InboxRoute><InboxScreen/></InboxRoute>},
{path:"/marketplace",element:<MarketplaceScreen/>},
{path:"/marketplace/skills",element:<MarketplaceScreen/>},
{path:"/marketplace/projects",element:<MarketplaceScreen/>},
{path:"/marketplace/projects/:key",element:<MarketplaceScreen/>},
{path:"/marketplace/people",element:<MarketplaceScreen/>},
{path:"/marketplace/people/:handle",element:<MarketplaceScreen/>},
{path:"/marketplace/categories",element:<MarketplaceScreen/>},
{path:"/marketplace/categories/:key",element:<MarketplaceScreen/>},
{path:"/share",element:<ShareScreen/>},
{path:"/settings",element:<Navigate to="/settings/account" replace/>},
{path:"/settings/:section",element:<SettingsScreen/>},
{path:"/onboarding/:step",element:<OnboardingScreen/>},
{path:"/search",element:<SearchScreen/>},
{path:"*",element:<NotFoundScreen/>}];
