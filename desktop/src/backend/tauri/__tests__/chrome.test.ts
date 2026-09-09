import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';
const window=vi.hoisted(()=>({setBackgroundColor:vi.fn(async()=>{})}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:()=>window}));
it('forwards the resolved chrome color to the native window API',async()=>{
 expect(await createTauriBackend(fakeBridge(()=>{}).bridge).setWindowBackground('#f8f8f8')).toEqual({ok:true,value:undefined});
 expect(window.setBackgroundColor).toHaveBeenCalledWith('#f8f8f8');
});
it('pins initial background to dark chrome, preserves minimum geometry and grants the runtime action',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8')) as {app:{windows:{backgroundColor:string;minWidth:number;minHeight:number}[]}};
 const css=readFileSync('src/styles/tokens.css','utf8');const chrome=css.match(/--tk-chrome:\s*(#[a-f\d]+)/i)?.[1];
 expect(config.app.windows[0]).toMatchObject({backgroundColor:chrome,minWidth:960,minHeight:600});
 expect(readFileSync('src-tauri/capabilities/default.json','utf8')).toContain('core:window:allow-set-background-color');
 expect(readFileSync('src-tauri/src/lib.rs','utf8')).toContain('tauri_plugin_window_state');
});

it('allows home paths including dot directories and GitHub and Discord URLs',()=>{
 const capability=JSON.parse(readFileSync('src-tauri/capabilities/default.json','utf8')) as {permissions:(string|{identifier:string;allow:unknown[]})[]};
 const path=capability.permissions.find(entry=>typeof entry!=='string'&&entry.identifier==='opener:allow-open-path');
 expect(path).toMatchObject({identifier:'opener:allow-open-path',allow:[{path:'$HOME/**'}]});
 expect(capability.permissions).not.toContain('opener:allow-open-path');
 const url=capability.permissions.find(entry=>typeof entry!=='string'&&entry.identifier==='opener:allow-open-url');
 expect(url).toEqual({identifier:'opener:allow-open-url',allow:[{url:'https://github.com/*'},{url:'https://discord.gg/*'}]});
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8')) as {plugins:{opener:{requireLiteralLeadingDot:boolean}}};
 expect(config.plugins.opener.requireLiteralLeadingDot).toBe(false);
});
