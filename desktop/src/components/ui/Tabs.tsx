import type { ComponentProps } from 'react';
import { Tabs as Base } from '@base-ui/react/tabs';
export function Tabs(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props}/>;}
export function TabList(props:ComponentProps<typeof Base.List>){return <Base.List {...props} className="tab-list"/>;}
export function Tab(props:ComponentProps<typeof Base.Tab>){return <Base.Tab {...props} className="tab"/>;}
export function TabPanel(props:ComponentProps<typeof Base.Panel>){return <Base.Panel {...props}/>;}
