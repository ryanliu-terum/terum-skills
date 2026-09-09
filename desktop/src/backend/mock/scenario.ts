export type MockScenario='default'|'error'|'empty'|'loading'|'slow'|'disabled'|'not-installed'|'no-team'|'invalid-newest'|'version-mismatch'|'on-disk-only'|'partial';
export function readScenario(hash=location.hash):MockScenario {
 const index=hash.indexOf('?');if(index<0)return 'default';
 const value=new URLSearchParams(hash.slice(index+1)).get('__mock');
 switch(value){case 'error':case 'empty':case 'loading':case 'slow':case 'disabled':case 'not-installed':case 'no-team':case 'invalid-newest':case 'version-mismatch':case 'on-disk-only':case 'partial':return value;default:return 'default';}
}
