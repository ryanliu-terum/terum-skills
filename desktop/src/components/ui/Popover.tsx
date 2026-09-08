import type { ComponentProps } from 'react';
import { Popover as Base } from '@base-ui/react/popover';
export function Popover(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props}/>;}
export function PopoverTrigger(props:ComponentProps<typeof Base.Trigger>){return <Base.Trigger {...props}/>;}
export function PopoverPopup(props:ComponentProps<typeof Base.Popup>){return <Base.Portal><Base.Positioner sideOffset={6}><Base.Popup {...props} className="floating-panel"/></Base.Positioner></Base.Portal>;}
