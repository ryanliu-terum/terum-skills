import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../../backend';
import { createMockBackend } from '../../../backend/mock';
import { App } from '../../../app/App';

afterEach(() => { cleanup(); location.hash=''; localStorage.clear(); vi.restoreAllMocks(); });

// The category crumb is the page's way into `skill category`. Only a folder the team has never seen
// may be rewritten here: a published category lives inside an immutable version, so the verb edits the
// local SKILL.md and stops, and the app must never turn that into a publish.
const PATH='~/.claude/skills/deploy-check';
async function open(){
 const backend=createMockBackend();
 const detail=await backend.localSkill({path:PATH});
 if(!detail.ok)throw new Error(detail.error);
 location.hash='#/skill/local?path='+encodeURIComponent(PATH);
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return {backend,category:detail.value.category};
}

it('changes the category from the crumb, sends only skill category, and shows the CLI’s notices',async()=>{
 const {backend,category}=await open();
 const change=vi.spyOn(backend.skillFile,'category'),publish=vi.spyOn(backend,'publish');
 fireEvent.click(await screen.findByRole('button',{name:`Change category (${category})`}));
 const dialog=await screen.findByRole('dialog');
 const field=within(dialog).getByLabelText('Category');
 // The field opens on the declared category, so the confirm is the no-op the CLI refuses until it is edited.
 expect(field).toHaveValue(category);
 expect(within(dialog).getByRole('button',{name:'Change category'})).toBeDisabled();
 fireEvent.change(field,{target:{value:' platform '}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Change category'}));
 await waitFor(()=>expect(change).toHaveBeenCalledWith({path:PATH,to:'platform'}));
 // The CLI's own notices are shown verbatim, and nothing was published to produce them.
 expect(await within(dialog).findByText(`Changed deploy-check from ${category} to platform.`)).toBeVisible();
 expect(publish).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Done'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});

it('offers the team’s categories as suggestions rather than a fixed set, and cancels without writing',async()=>{
 const {backend,category}=await open();
 const change=vi.spyOn(backend.skillFile,'category');
 fireEvent.click(await screen.findByRole('button',{name:`Change category (${category})`}));
 const dialog=await screen.findByRole('dialog');
 // A datalist, never a select: an off-list name is written as typed, so the control must accept one.
 expect(within(dialog).getByLabelText('Category')).toHaveAttribute('list','skill-category-options');
 expect(dialog.querySelector('select')).toBeNull();
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(change).not.toHaveBeenCalled();
});
