import { it, expect } from 'vitest';
import config from '../../../playwright.config';
it('pins full Chromium and the oracle pixel geometry',()=>{
 const project=config.projects?.find(project=>project.name==='chromium');
 expect(project).toBeDefined();
 expect(project?.use?.channel).toBe('chromium');
 expect(project?.use?.viewport).toEqual({width:1440,height:900});
 expect(project?.use?.deviceScaleFactor).toBe(1);
 expect(config.globalSetup).toBe('./e2e/fidelity/setup.ts');
});

