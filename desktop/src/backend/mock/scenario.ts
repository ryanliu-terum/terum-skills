export type MockScenario='default'|'error'|'empty'|'loading'|'slow'|'disabled'|'not-installed';
export function readScenario(hash=location.hash):MockScenario {
 const index=hash.indexOf('?');if(index<0)return 'default';
 const value=new URLSearchParams(hash.slice(index+1)).get('__mock');
 switch(value){case 'error':case 'empty':case 'loading':case 'slow':case 'disabled':case 'not-installed':return value;default:return 'default';}
}
