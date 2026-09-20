import { it, expect, vi } from 'vitest';
import { scriptedPrompter } from '../prompter';
it('uses exact pre-answers and exposes exactly the six prompt members plus lines',async()=>{const unexpected=vi.fn();const p=scriptedPrompter({Approve:true,Name:'Teddy',Role:'Admin'},unexpected);expect(await p.confirm('Approve')).toBe(true);expect(await p.text('Name')).toBe('Teddy');expect(await p.select('Role',['Admin','Member'])).toBe('Admin');expect(unexpected).not.toHaveBeenCalled();expect(Object.keys(p).sort()).toEqual(['confirm','form','interactive','lines','print','select','text']);});
// A form (protocol 2) is keyed by its title and answered with one object or null (Skip); a string is not an answer to it.
it('answers a form from its pre-answer, forwards an unknown form whole, and refuses a string for it',async()=>{
 const fields=[{id:'team',kind:'text' as const,label:'Team name',required:true},{id:'hook',kind:'checkbox' as const,label:'Hook',default:true}];
 const unexpected=vi.fn().mockResolvedValue({team:'alpha',hook:false});
 const p=scriptedPrompter({'Create your team':{team:'beta',hook:true},'Invite teammates':null},unexpected);
 expect(await p.form('Create your team',fields,{submit:'Create team'})).toEqual({team:'beta',hook:true});
 expect(await p.form('Invite teammates',fields,{skippable:true})).toBeNull();
 expect(await p.form('Your identity',fields,{submit:'Join team',errors:{team:'taken'},detail:['One repository.']})).toEqual({team:'alpha',hook:false});
 expect(unexpected).toHaveBeenCalledExactlyOnceWith({kind:'form',question:'Your identity',fields,submit:'Join team',errors:{team:'taken'},detail:['One repository.']});
 await expect(scriptedPrompter({'Create your team':'alpha'},async()=>'still a string').form('Create your team',fields)).rejects.toThrow('Invalid answer');
});
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
