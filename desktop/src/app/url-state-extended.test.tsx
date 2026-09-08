import { afterEach,expect,it } from 'vitest';
import { cleanup,render,screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useUrlState } from './url-state';
import { useUiStore } from './store';
function Probe(){return <output>{JSON.stringify(useUrlState())}</output>;}
afterEach(cleanup);
it.each([['full=1','"full":true'],['full=0','"full":false'],['full=unknown','"full":false'],['rail=closed','"railOpen":false'],['overview=0','"overviewHidden":true'],['menu=files','"menu":"files"'],['dialog=run-eval','"dialog":"run-eval"'],['q=deploy%20prod','"q":"deploy prod"']])('reads URL state %s',(query,expected)=>{useUiStore.setState({railOpen:true,overviewHidden:false});render(<MemoryRouter initialEntries={['/skill/deploy-check?'+query]}><Probe/></MemoryRouter>);expect(screen.getByRole('status')).toHaveTextContent(expected);});
it('ignores unknown rail and overview values',()=>{useUiStore.setState({railOpen:true,overviewHidden:false});render(<MemoryRouter initialEntries={['/skill/deploy-check?rail=unknown&overview=wat']}><Probe/></MemoryRouter>);expect(screen.getByRole('status')).toHaveTextContent('"railOpen":true');expect(screen.getByRole('status')).toHaveTextContent('"overviewHidden":false');});
