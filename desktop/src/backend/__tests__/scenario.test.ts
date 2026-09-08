import { it, expect } from 'vitest';
import { readScenario } from '../mock/scenario';
it('parses the query after the first hash question mark',()=>{expect(readScenario('#/library/global?__mock=error')).toBe('error');expect(readScenario('#/inbox?q=hello&__mock=not-installed')).toBe('not-installed');});
it('defaults missing and unknown scenarios',()=>{expect(readScenario('#/frame')).toBe('default');expect(readScenario('#/frame?__mock=nonsense')).toBe('default');});
