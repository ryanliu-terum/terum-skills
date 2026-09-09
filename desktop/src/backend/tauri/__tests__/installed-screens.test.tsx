import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { installedReplay } from './installed-fixture';
afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
function open(member:string,route='#/marketplace/people/mira',local='on-disk-only',change?:(frame:Record<string,unknown>)=>void) {
 useUiStore.setState({railOpen:true,overviewHidden:false});
 const f=installedReplay(local,member,change),backend=createTauriBackend(f.bridge);
 location.hash=route;
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return {backend,f};
}
it('shows the same empty-install status on the page and rail and no bulk button',async()=>{
 open('none');await screen.findByRole('heading',{name:'Mira Chen'});
 expect(screen.getAllByText('Nothing to install')).toHaveLength(2);
 expect(screen.getAllByText('mira has no recorded installs to copy')).toHaveLength(2);
 expect(screen.queryByRole('button',{name:/Install \d+ skills/})).toBeNull();
 expect(screen.getByRole('region',{name:'Authored'})).toHaveTextContent('deploy-check');
});
it('uses two recorded install ids for one member install call',async()=>{
 const {backend}=open('installed');const install=vi.spyOn(backend,'install');
 fireEvent.click(await screen.findByRole('button',{name:'Install 2 skills'}));
 await waitFor(()=>expect(install).toHaveBeenCalledTimes(1));
 expect(install).toHaveBeenCalledWith({ref:'mira',kind:'member',member:'mira'});
});

it.each(['placed','placed-problem'])('shows placement actions and status for %s',async mode=>{
 open('none','#/skill/deploy-check',mode);
 expect(await screen.findByText(mode==='placed'?'Installed':'Installed · needs attention')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Remove from Global'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Install'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Manage with Terum…'})).toBeNull();
 if(mode==='placed-problem')expect(document.querySelector('.detail-rail')).toHaveTextContent('SKILL.md missing');
});

it('abbreviates the real detail labels while Edit and Manage keep the absolute occurrence path',async()=>{
 const {backend}=open('none','#/skill/deploy-check');
 const edit=vi.spyOn(backend,'openInEditor').mockResolvedValue({ok:true,value:undefined});
 const connect=vi.spyOn(backend,'connect');
 await screen.findByText('Installed · on this machine');
 expect(document.querySelector('.skill-md-meta')).toHaveTextContent('read from ~/.claude/skills/deploy-check');
 expect(document.querySelector('.detail-rail')).toHaveTextContent('Connected: no · ~/.claude/skills/deploy-check');
 fireEvent.click(screen.getByRole('button',{name:'Open in editor'}));
 expect(edit).toHaveBeenCalledWith('/Users/teddy/.claude/skills/deploy-check');
 fireEvent.click(screen.getByRole('button',{name:'Manage with Terum…'}));
 fireEvent.click(await screen.findByRole('button',{name:'Continue'}));
 await waitFor(()=>expect(connect).toHaveBeenCalledWith({path:'/Users/teddy/.claude/skills/deploy-check',team:'acme'}));
});
it('uses the resolved path label in the real Global Remove dialog',async()=>{
 open('none','#/skill/deploy-check?dialog=remove','placed');
 expect(await screen.findByRole('dialog')).toHaveTextContent('Its files leave ~/.claude/skills/deploy-check on this machine');
});

// The old-CLI ambiguity must read as unknown on the page, with no Install to collide with the folder.
it('states an unknown install rather than offering an Install that would collide',async()=>{
 open('none','#/skill/deploy-check','on-disk-only',frame=>{
  if(frame.t==='hello')delete (frame.features as Record<string,unknown>).localIdentity;
 });
 expect(await screen.findByText('Install state unknown')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Install'})).toBeNull();
 expect(document.querySelector('.detail-rail')).toHaveTextContent('~/.claude/skills/deploy-check');
 expect(document.querySelector('.detail-flags')).toHaveTextContent('Install state unknown');
});
