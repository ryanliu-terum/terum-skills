import { isNativeShell } from '../tauri/detect';
export type MockScenario='default'|'error'|'empty'|'loading'|'slow'|'disabled'|'not-installed'|'no-team'|'invalid-newest'|'version-mismatch'|'on-disk-only'|'partial'|'detected-root'|'missing-root'|'no-projects';
export function readScenario(hash=location.hash):MockScenario {
 // Scenarios are a browser/fixture affordance (dev, gates, fidelity boards). Inside the Tauri shell the
 // real adapter drives the CLI, so a stray `__mock` param must never flip the session into fixture data.
 if(isNativeShell())return 'default';
 const index=hash.indexOf('?');if(index<0)return 'default';
 const value=new URLSearchParams(hash.slice(index+1)).get('__mock');
 switch(value){case 'error':case 'empty':case 'loading':case 'slow':case 'disabled':case 'not-installed':case 'no-team':case 'invalid-newest':case 'version-mismatch':case 'on-disk-only':case 'partial':case 'detected-root':case 'missing-root':case 'no-projects':return value;default:return 'default';}
}
