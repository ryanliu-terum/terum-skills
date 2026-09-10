import { it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useUrlState } from './url-state';
import { useUiStore } from './store';
afterEach(cleanup);
function View(){const state=useUrlState();return <output>{JSON.stringify(state)}</output>;}
it('applies URL theme and keeps layout overrides out of persisted preferences',async()=>{useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});render(<MemoryRouter initialEntries={['/frame?theme=light&rail=closed&overview=0&tab=evals&q=deploy']}><View/></MemoryRouter>);await waitFor(()=>expect(useUiStore.getState().theme).toBe('dark'));expect(screen.getByRole('status')).toHaveTextContent('"theme":"light"');expect(screen.getByRole('status')).toHaveTextContent('"railOpen":false');expect(screen.getByRole('status')).toHaveTextContent('"overviewHidden":true');expect(screen.getByRole('status')).toHaveTextContent('"tab":"evals"');expect(useUiStore.getState()).toMatchObject({railOpen:true,overviewHidden:false});});
