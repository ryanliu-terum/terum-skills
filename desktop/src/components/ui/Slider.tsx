import type { ComponentProps, ReactNode } from 'react';
import { Slider as Base } from '@base-ui/react/slider';
export function Slider({label,...props}:ComponentProps<typeof Base.Root>&{label:ReactNode}){return <Base.Root {...props} className="slider"><div className="slider-header"><Base.Label>{label}</Base.Label><Base.Value/></div><Base.Control className="slider-control"><Base.Track className="slider-track"><Base.Indicator className="slider-indicator"/><Base.Thumb className="slider-thumb"/></Base.Track></Base.Control></Base.Root>;}
