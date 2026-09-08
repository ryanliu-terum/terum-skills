import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { Providers } from './providers';

afterEach(()=>{cleanup();location.hash='';});

it.each(['#/onboarding/welcome','#/frame'])('renders exactly one zero-size mono probe before the routed view at %s',async route=>{
 location.hash=route;
 const {container}=render(<Providers><App/></Providers>);
 await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
 expect(screen.getByRole('main')).toBeInTheDocument();
 const probes=[...container.querySelectorAll<HTMLElement>('[style]')].filter(element=>element.style.fontFamily==='var(--font-mono)'&&element.textContent==='0');
 expect(probes).toHaveLength(1);
 const probe=probes[0]!;
 expect(probe.closest('main, aside, .shell')).toBeNull();
 expect(container.firstElementChild).toBe(probe);
 expect(probe.nextElementSibling).not.toBeNull();
 expect(probe).toHaveAttribute('aria-hidden','true');
 expect(probe).toHaveStyle({position:'absolute',width:'0px',height:'0px',overflow:'hidden',fontFamily:'var(--font-mono)'});
});
