import type { PropsWithChildren } from 'react';
/** `title` carries the full text when the chip may clip (a card bottom row); absent, the chip has no tooltip, as drawn. */
export function Chip({children,title,className}:PropsWithChildren<{title?:string;className?:string}>){return <span className={'chip'+(className?' '+className:'')} {...(title!==undefined?{title}:{})}><span className="chip-label">{children}</span></span>;}
