import type { PropsWithChildren } from 'react';
/** `title` carries the full text when the chip may clip (a card bottom row); absent, the chip has no tooltip, as drawn. */
export function Chip({children,title}:PropsWithChildren<{title?:string}>){return <span className="chip" {...(title!==undefined?{title}:{})}><span className="chip-label">{children}</span></span>;}
