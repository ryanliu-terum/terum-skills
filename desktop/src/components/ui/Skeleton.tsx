import type { CSSProperties } from 'react';
export function Skeleton({width,height,radius=4}:{width:CSSProperties['width'];height:number;radius?:number}){return <div aria-hidden="true" style={{width,height,borderRadius:radius,background:'var(--tk-bg3)'}}/>;}
