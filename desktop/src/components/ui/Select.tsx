import type { ComponentProps } from 'react';
import { Select as Base } from '@base-ui/react/select';
export function Select(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props}/>;}
export function SelectTrigger(props:ComponentProps<typeof Base.Trigger>){return <Base.Trigger {...props} className="button" data-kind="secondary"/>;}
export function SelectValue(props:ComponentProps<typeof Base.Value>){return <Base.Value {...props}/>;}
export function SelectPopup(props:ComponentProps<typeof Base.Popup>){return <Base.Portal><Base.Positioner sideOffset={6}><Base.Popup {...props} className="floating-panel"/></Base.Positioner></Base.Portal>;}
export function SelectItem(props:ComponentProps<typeof Base.Item>){return <Base.Item {...props} className="menu-item"/>;}
