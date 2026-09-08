import { useEffect } from 'react';
import { useSearchParams,useParams } from 'react-router';
import { mockScenario,selectedInboxId } from '../backend';
import { useUiStore } from './store';
export function useUrlState(){
 const route=useParams();const [params]=useSearchParams();const theme=params.get('theme');const setTheme=useUiStore(s=>s.setTheme);
 useEffect(()=>{if(theme==='dark'||theme==='light'||theme==='system')setTheme(theme);},[theme,setTheme]);
 const railOpen=useUiStore(s=>s.railOpen);const overviewHidden=useUiStore(s=>s.overviewHidden);
 return {inboxSelectedId:selectedInboxId(route.id),full:params.get('full')==='1',theme:theme??undefined,tab:params.get('tab')??undefined,dialog:params.get('dialog')??undefined,rail:params.get('rail')??undefined,menu:params.get('menu')??undefined,filters:params.get('filters')??undefined,q:params.get('q')??undefined,overview:params.get('overview')??undefined,active:params.get('active')??undefined,mock:mockScenario(),railOpen:params.get('rail')==='closed'?false:railOpen,overviewHidden:params.get('overview')==='0'?true:overviewHidden};
}
