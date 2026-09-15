import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../../backend';
import { createTauriBackend } from '../../../backend/tauri';
import { detailReplay } from '../../../backend/tauri/__tests__/skill-detail-replay';
import { App } from '../../../app/App';
import { cardActions } from '../../../components/domain/skill-card-actions';
import type { SkillCard } from '../../../backend/types';

afterEach(() => { cleanup(); location.hash=''; localStorage.clear(); vi.restoreAllMocks(); });

/**
 * Retraction is destructive, team-wide and open to everyone (2026-09-14), so this dialog is the app's
 * only brake: it names every place the skill is removed from and stays disabled until the name is
 * typed, mirroring `skill delete`'s confirmation (Ryan, 2026-09-14).
 */
const REF='deploy-check';
function open(dialog=true){
 const backend=createTauriBackend(detailReplay().bridge);
 location.hash='#/skill/'+REF+'?root=marketplace'+(dialog?'&dialog=unpublish':'');
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return backend;
}

it('names everything the retraction reaches, and keeps Unpublish disabled until the name is typed',async()=>{
 open();
 const box=await screen.findByRole('dialog');
 expect(within(box).getByText(`Unpublish ${REF} from the team?`)).toBeVisible();
 expect(box).toHaveTextContent('Removes every version');
 expect(box).toHaveTextContent('every project list and member profile');
 expect(box).toHaveTextContent('cannot be undone from the app');
 expect(box).toHaveTextContent('until they sync');
 const confirm=within(box).getByRole('button',{name:'Unpublish'});
 const typed=within(box).getByRole('textbox',{name:'Skill name to confirm'});
 expect(confirm).toBeDisabled();
 fireEvent.change(typed,{target:{value:'deploy-chek'}});
 expect(confirm).toBeDisabled();
 fireEvent.change(typed,{target:{value:REF}});
 expect(confirm).toBeEnabled();
});

it('calls the backend once the name matches, and leaves the detail page behind',async()=>{
 const backend=open();
 const unpublish=vi.spyOn(backend,'unpublish');
 const box=await screen.findByRole('dialog');
 fireEvent.change(within(box).getByRole('textbox',{name:'Skill name to confirm'}),{target:{value:REF}});
 fireEvent.click(within(box).getByRole('button',{name:'Unpublish'}));
 await waitFor(()=>expect(unpublish).toHaveBeenCalledWith(expect.objectContaining({ref:REF})));
 // The team no longer has this skill, so the page it was showing describes nothing: go back.
 await waitFor(()=>expect(location.hash).not.toContain('dialog=unpublish'));
});

it('shows the terminal equivalent, so the same retraction is runnable without the app',async()=>{
 open();
 expect(await screen.findByRole('dialog')).toHaveTextContent(`npx -y terum-skills@latest unpublish ${REF}`);
});

it('offers the row on every card and says why when the team has nothing to retract',()=>{
 const base={flags:[],flagText:{},placed:true,installed:'placed',onDiskOnly:false} as unknown as SkillCard;
 const row=(skill:SkillCard)=>cardActions(skill).find(action=>action.key==='unpublish');
 expect(row({...base,name:REF,teamed:true,path:'~/.claude/skills/deploy-check'} as SkillCard))
  .toMatchObject({label:'Unpublish…',to:'/skill/deploy-check?dialog=unpublish',reason:null});
 expect(row({...base,name:'notes',teamed:false,path:'~/.claude/skills/notes'} as SkillCard))
  .toMatchObject({label:'Unpublish…',to:null,reason:'This skill is not in the team marketplace, so there is nothing to retract.'});
});
