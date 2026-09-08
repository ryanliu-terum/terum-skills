import type { ComponentProps } from 'react';
import { Menu as Base } from '@base-ui/react/menu';
export function Menu(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props}/>;}
export function MenuTrigger(props:ComponentProps<typeof Base.Trigger>){return <Base.Trigger {...props}/>;}
export function MenuPopup(props:ComponentProps<typeof Base.Popup>){return <Base.Portal><Base.Positioner sideOffset={6}><Base.Popup {...props} className="floating-panel"/></Base.Positioner></Base.Portal>;}
export function MenuItem(props:ComponentProps<typeof Base.Item>){return <Base.Item {...props} className="menu-item"/>;}
