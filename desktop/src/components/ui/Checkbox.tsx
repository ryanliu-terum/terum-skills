import type { ComponentProps, ReactNode } from 'react';
import { Checkbox as Base } from '@base-ui/react/checkbox';
import { Icon } from './Icon';
export function Checkbox({label,count,...props}:ComponentProps<typeof Base.Root>&{label:ReactNode;count?:number}){return <label className="checkbox-row"><span className="checkbox-label"><Base.Root {...props} className="checkbox"><Base.Indicator><Icon name="check" size={12} color="#fff" stroke="3"/></Base.Indicator></Base.Root><span>{label}</span></span>{count===undefined?null:<span className="nav-count">{count}</span>}</label>;}
