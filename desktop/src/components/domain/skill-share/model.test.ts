import { describe, it, expect } from 'vitest';
import { createMockBackend } from '../../../backend/mock';
import { chartMaximum, metricNumber, shareCardModel, shareFilename } from './model';
import { imageFile } from '../../../backend/image-sharing';
async function detail(){const result=await createMockBackend().skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);return result.value;}
describe('benchmark image data',()=>{
 it('uses this skill and its recorded counts and summary',async()=>{const skill=await detail(),model=shareCardModel(skill);expect(model.name).toBe(skill.name);expect(model.summary?.lift).toBe(44);expect(model.candidate).toEqual({passed:14,total:18});expect(model.metrics[0]?.candidate).toBe(.38);expect(model.metrics[1]?.baseline).toBe(53);});
 it('decodes the selected description and author without substituting defaults',async()=>{const skill=await detail();const model=shareCardModel({...skill,desc:'Check A &amp; B',author:{...skill.author,name:'Sam &amp; Jo',handle:'sam'}});expect(model.description).toBe('Check A & B');expect(model.author).toBe('Sam & Jo · @sam');expect(shareCardModel({...skill,author:{name:'',handle:'',role:'',initials:''}}).author).toBe('');});
 it('does not invent results for unevaluated skills',async()=>{const model=shareCardModel({...await detail(),receipt:null,summary:null,latestState:'none'});expect(model.status).toBe('Not evaluated');expect(model.candidate).toBeNull();expect(model.metrics.every(m=>m.candidate===null&&m.baseline===null)).toBe(true);});
 it('keeps partial and stale results explicit',async()=>{const skill=await detail();expect(shareCardModel({...skill,summary:{...skill.summary!,partial:[18,24]}}).status).toBe('Partial evaluation');expect(shareCardModel({...skill,evalStale:true,versions:{placed:'v3',teamCurrent:'v3',evaluated:'v2'}}).status).toBe('Evaluated v2');});
 it('does not infer pass counts from wins',async()=>{const skill=await detail(),receipt={...skill.receipt!};delete receipt.case_runs;expect(shareCardModel({...skill,receipt}).candidate).toBeNull();});
 it.each([-1,19,NaN,1.5])('rejects corrupt pass counts %s',async passed=>{const skill=await detail();expect(()=>shareCardModel({...skill,receipt:{...skill.receipt!,case_runs:{candidate:{passed,total:18}}}})).toThrow('pass counts');});
 it('surfaces receipt errors',async()=>{const skill=await detail();expect(()=>shareCardModel({...skill,evalReportError:'Unreadable receipt'})).toThrow('Unreadable receipt');expect(()=>shareCardModel({...skill,summary:{...skill.summary!,n:999}})).toThrow('summary');});
 it.each(['—','N/A','NaN','-1','Infinity','1,200 s'])('handles unavailable/malformed efficiency without fabricated zeros: %s',raw=>expect(metricNumber(raw,'time')).toBeNull());
 it('handles real zeros and keeps zero-based domains nonzero',()=>{expect(metricNumber('$0.00','cost')).toBe(0);expect(metricNumber('0 s','time')).toBe(0);expect(chartMaximum(0,0,'time')).toBe(10);expect(chartMaximum(.38,.51,'cost')).toBeCloseTo(.6);});
 it('sanitizes filenames',()=>{expect(shareFilename('../../my skill')).toBe('my-skill-benchmark.png');expect(shareFilename('💡')).toBe('skill-benchmark.png');});
 it.each(['light','dark','horizontal','horizontal-dark'] as const)('keeps long %s filenames within the native save limit',format=>{
  const filename=shareFilename('long-skill-name-'.repeat(30),format);
  expect(filename.length).toBeLessThanOrEqual(104);
  expect(imageFile(new Blob(['png'],{type:'image/png'}),filename).name).toBe(filename);
 });
});
