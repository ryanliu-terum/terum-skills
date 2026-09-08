import type { ReactElement, ReactNode } from 'react';
import { Tooltip as Base } from '@base-ui/react/tooltip';
export function Tooltip({children,content}:{children:ReactElement;content:ReactNode}){return <Base.Root><Base.Trigger render={children}/><Base.Portal><Base.Positioner sideOffset={6}><Base.Popup className="tooltip">{content}</Base.Popup></Base.Positioner></Base.Portal></Base.Root>;}
