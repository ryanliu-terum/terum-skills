import type { ComponentProps, ReactNode } from 'react';
import { RadioGroup as BaseGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
export function RadioGroup(props:ComponentProps<typeof BaseGroup>){return <BaseGroup {...props}/>;}
export function RadioRow({label,caption,...props}:ComponentProps<typeof Radio.Root>&{label:ReactNode;caption?:ReactNode}){return <label className="radio-row"><Radio.Root {...props} className="radio"><Radio.Indicator className="radio-dot"/></Radio.Root><span>{label}</span><span className="radio-caption">{caption}</span></label>;}
