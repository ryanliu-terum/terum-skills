import { expect,it } from 'vitest';
import json from '../design.json';
import { parseDesign } from '../schema';
it('rejects a missing skill name with its full field path',()=>{const copy=structuredClone(json);Reflect.deleteProperty(copy.SKILLS[0]!,'name');expect(()=>parseDesign(copy)).toThrow('SKILLS.0.name');});
it('rejects an unsupported markdown block kind',()=>{const copy=structuredClone(json);copy.SKILL_MD_BODY[0]![0]='script';expect(()=>parseDesign(copy)).toThrow('SKILL_MD_BODY.0.0');});
