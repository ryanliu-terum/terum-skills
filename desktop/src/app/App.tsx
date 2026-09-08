import { useEffect } from 'react';
import { useUiStore } from './store';
import { HashRouter, useLocation, useRoutes } from 'react-router';
import { routes } from './routes';
function RouteView(){const location=useLocation();const setLastRoute=useUiStore(s=>s.setLastRoute);useEffect(()=>setLastRoute(location.pathname+location.search),[location.pathname,location.search,setLastRoute]);return useRoutes(routes);}
export function App(){return <HashRouter><span aria-hidden="true" style={{position:'absolute',width:0,height:0,overflow:'hidden',fontFamily:'var(--font-mono)'}}>0</span><RouteView/></HashRouter>;}
