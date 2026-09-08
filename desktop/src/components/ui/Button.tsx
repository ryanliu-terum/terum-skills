import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-paths';
export function Button({kind='secondary',state='default',height=28,icon,iconOnly=false,children,className='',style,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{kind?:'primary'|'secondary'|'danger'|'ghost';state?:'default'|'hover'|'pressed'|'focus';height?:number;icon?:IconName;iconOnly?:boolean}){return <button type="button" {...props} className={'button '+className} data-kind={kind} data-state={state} style={{height,...(iconOnly?{width:height,padding:0,justifyContent:'center'}:{}),...style}}>{icon?<Icon name={icon} size={14}/>:null}{children}</button>;}
