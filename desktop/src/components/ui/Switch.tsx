import type { ComponentProps } from 'react';
import { Switch as Base } from '@base-ui/react/switch';
export function Switch(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props} className="switch"><Base.Thumb className="switch-thumb"/></Base.Root>;}
