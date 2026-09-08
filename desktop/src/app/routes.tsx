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
export const routes:RouteObject[]=[
{path:"/",element:<Navigate to="/library/global" replace/>},
{path:"/frame",element:<FrameScreen/>},
{path:"/library/global",element:<LibraryScreen/>},
{path:"/library/project/:name",element:<LibraryScreen/>},
{path:"/skill/:ref",element:<SkillScreen/>},
{path:"/inbox",element:<InboxScreen/>},
{path:"/inbox/:id",element:<InboxScreen/>},
{path:"/marketplace",element:<MarketplaceScreen/>},
{path:"/marketplace/skills",element:<MarketplaceScreen/>},
{path:"/marketplace/projects",element:<MarketplaceScreen/>},
{path:"/marketplace/projects/:key",element:<MarketplaceScreen/>},
{path:"/marketplace/people",element:<MarketplaceScreen/>},
{path:"/marketplace/people/:handle",element:<MarketplaceScreen/>},
{path:"/marketplace/categories",element:<MarketplaceScreen/>},
{path:"/marketplace/categories/:key",element:<MarketplaceScreen/>},
{path:"/share",element:<ShareScreen/>},
{path:"/settings/:section",element:<SettingsScreen/>},
{path:"/onboarding/:step",element:<OnboardingScreen/>},
{path:"/search",element:<SearchScreen/>},
{path:"*",element:<NotFoundScreen/>}];
