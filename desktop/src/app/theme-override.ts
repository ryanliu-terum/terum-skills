import { createContext } from 'react';
import type { Theme } from '../backend/types';
// URL state belongs to this render, never to the persisted chrome preferences.
export const ThemeOverrideContext = createContext<(theme:Theme|null)=>void>(()=>{});
export function themeOverride(search:string):Theme|null {
 const value=new URLSearchParams(search).get('theme');
 return value==='dark'||value==='light'||value==='system'?value:null;
}
