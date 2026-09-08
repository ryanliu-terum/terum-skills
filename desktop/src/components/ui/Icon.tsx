import { ICON_PATHS } from './icon-paths';
import type { IconName } from './icon-paths';
export function Icon({name,size=16,color='inherit',stroke='1.5',filled=false}:{name:IconName;size?:number;color?:string;stroke?:string;filled?:boolean}) {
 // Trusted path constants from build.py; this markup never includes user input.
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={filled?'currentColor':'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{color,flexShrink:0,display:'block'}} dangerouslySetInnerHTML={{__html:ICON_PATHS[name]}} />;
}
