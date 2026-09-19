import type { Backend } from '../../../backend/Backend';
import type { LibraryScope, SkillCard, SkillDetail } from '../../../backend/types';
import type { ShareCardFormat } from './model';
import { shareCardModel } from './model';
import { renderShareCard } from './render';

export const SHARE_DESTINATIONS=[
 {name:'Reddit',url:'https://www.reddit.com/submit',method:'save'},
 {name:'X',url:'https://twitter.com/intent/tweet',method:'copy'},
 {name:'Instagram',url:'https://www.instagram.com/',method:'save'},
 {name:'LinkedIn',url:'https://www.linkedin.com/feed/',method:'copy'},
] as const;
export type ShareSkillSource=SkillCard & Partial<Pick<SkillDetail,'skillRef'>>;
export async function loadSharePng(backend:Backend,skill:ShareSkillSource,scope:LibraryScope|undefined,signal:AbortSignal,format:ShareCardFormat='light'):Promise<Blob> {
 if(signal.aborted)throw new DOMException('Cancelled','AbortError');
 if(!skill.teamed&&!skill.path)throw new Error('This skill has no source path. Refresh the Library and try again.');
 const result=!skill.teamed&&skill.path?await backend.localSkill({path:skill.path},{signal}):await backend.skill({ref:skill.skillRef??skill.name,...(scope?{at:scope}:{})},{signal});
 if(signal.aborted)throw new DOMException('Cancelled','AbortError');
 if(!result.ok)throw new Error(result.error);
 return renderShareCard(shareCardModel(result.value),{format});
}
