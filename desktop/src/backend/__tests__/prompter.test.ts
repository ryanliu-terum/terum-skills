import { it, expect, vi } from 'vitest';
import { scriptedPrompter } from '../prompter';
it('uses exact pre-answers and exposes exactly the five prompt members plus lines',async()=>{const unexpected=vi.fn();const p=scriptedPrompter({Approve:true,Name:'Teddy',Role:'Admin'},unexpected);expect(await p.confirm('Approve')).toBe(true);expect(await p.text('Name')).toBe('Teddy');expect(await p.select('Role',['Admin','Member'])).toBe('Admin');expect(unexpected).not.toHaveBeenCalled();expect(Object.keys(p).sort()).toEqual(['confirm','interactive','lines','print','select','text']);});
it('forwards an unknown question once with its default',async()=>{const unexpected=vi.fn().mockResolvedValue('new');const p=scriptedPrompter({},unexpected);expect(await p.text('Name','old')).toBe('new');expect(unexpected).toHaveBeenCalledExactlyOnceWith({kind:'text',question:'Name',default:'old'});});
it('forwards invalid selections and validates the replacement',async()=>{const unexpected=vi.fn().mockResolvedValue('Member');const p=scriptedPrompter({Role:'Missing'},unexpected);expect(await p.select('Role',['Admin','Member'])).toBe('Member');expect(unexpected).toHaveBeenCalledOnce();await expect(scriptedPrompter({},async()=>false).select('Role',['Admin'])).rejects.toThrow('Invalid answer');});
it('collects printed lines in order and preserves false answers',async()=>{const p=scriptedPrompter({Approve:false},vi.fn());p.print('first');p.print('second');expect(p.lines).toEqual(['first','second']);expect(await p.confirm('Approve')).toBe(false);});

it('forwards detail on every unexpected question and omits empty detail',async()=>{
 const unexpected=vi.fn().mockResolvedValueOnce(true).mockResolvedValue('a');
 const p=scriptedPrompter({},unexpected),detail=['Context'];
 await p.confirm('Confirm',{detail});await p.text('Text','old',{detail});await p.select('Select',['a'],{detail});await p.text('Empty',undefined,{detail:[]});
 expect(unexpected.mock.calls).toEqual([
  [{kind:'confirm',question:'Confirm',detail}], [{kind:'text',question:'Text',default:'old',detail}],
  [{kind:'select',question:'Select',choices:['a'],detail}], [{kind:'text',question:'Empty'}],
 ]);
});
