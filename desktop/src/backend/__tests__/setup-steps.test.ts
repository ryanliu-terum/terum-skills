import { expect, it } from 'vitest';
import { askedSetupStep, printedSetupStep, SETUP_STEP_TO_BOARD } from '../setup-session';
it.each([
 ['Looking for skill folders on this machine…','Done'],['No skill folders found under ~.','Done'],
 ['/Users/you/code/mrf — 3 skill folders','Done'],['/Users/you/code/mrf — 1 skill folders · already registered','Done'],
 ['Could not look in /Users/you/Library: EACCES','Done'],['Evaluating 1 of 2 · deploy-check','Done'],['Evaluated 2 of 2; 0 failed.','Done'],
 ['Welcome to terum-skills.','Welcome'],['GitHub: gh is not installed.','Team'],['Identity: @seed','Team'],
 ['Team acme is already configured on this machine.','Team'],['Connected tdd.','Basics'],['Next, from any terminal:','Basics'],
 ['Feedback and requests: https://example.com','Feedback'],['Skipped the session hook; re-run setup to install it later.','Done'],
 ['Installed the /terum-skills Claude Code skill at /fixture.','Done'],['Repository: /fixture/team.git','Done'],['Members:','Done'],['README: /fixture/team.git','Done'],
])('maps printed step %s to its drawn tour step',(line,board)=>{const step=printedSetupStep(line);expect(step&&SETUP_STEP_TO_BOARD[step]).toBe(board);});
it('keeps unrecognized CLI output as copy without inventing a step outcome',()=>{expect(printedSetupStep('An unexpected diagnostic.')).toBeNull();});

it('maps the identity ask to team without treating unrelated asks as setup steps',()=>{expect(askedSetupStep('Use this identity?')).toBe('team');expect(askedSetupStep('Join this team?')).toBeNull();});

it('maps the discover and evals questions to their steps',()=>{
 for(const question of ['Look for skill folders on this machine and add them to your library?','Look under which folder?','Add all 2?','Add /Users/you/code/mrf?'])expect(askedSetupStep(question)).toBe('discover');
 expect(askedSetupStep('Evaluate the 3 shared skills that have no receipt yet? …')).toBe('evals');expect(askedSetupStep('Join this team?')).toBeNull();
});
it('maps every way the eval batch can end without running to the evals step',()=>{
 for(const line of [
  'Every shared skill already has an eval receipt for its current version.',
  'The team has no shared skills yet; nothing to evaluate.',
  'Could not read the current skill versions, so no shared skill could be checked for a receipt.',
  'No shared skill could be checked for a receipt; see the lines above.',
  'Skipping the eval offer: this machine has no joined handle for the team yet, so a receipt could not be committed.',
  'Skipping the evals: claude is not runnable',
 ])expect(printedSetupStep(line),line).toBe('evals');
 // The discover rules are checked first and must not claim any of them.
 expect(printedSetupStep('Could not look in /x: EACCES')).toBe('discover');
 expect(printedSetupStep('No skill folders found under /x.')).toBe('discover');
});
it('does not mistake a discovered folder path for the wrapper step',()=>{
 expect(printedSetupStep('/home/teniroo/Projects/SSM/terum-skills — 4 skill folders')).toBe('discover');
 expect(printedSetupStep('Registered /home/teniroo/Projects/SSM/terum-skills in your library.')).toBeNull();
 expect(printedSetupStep('Evaluating 1 of 1 · terum-skills')).toBe('evals');
 for(const line of [
  'The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at /x); skipped.',
  '/x exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.',
  'The /terum-skills Claude Code skill at /x is current.', 'Updated the /terum-skills Claude Code skill at /x.',
  'Skipped the /terum-skills skill; re-run setup to install it later.', 'Installed the /terum-skills Claude Code skill at /x.',
 ])expect(printedSetupStep(line)).toBe('wrapper');
});

it.each(['Queued for overnight', 'Evaluated in batches', 'Queued 3 evals for overnight: the app runs them one at a time between 01:00 and 05:00 while it is open and idle.'])('maps the new eval outcome %s', line => {
 expect(printedSetupStep(line)).toBe('evals');
});
it.each(['Queued 3 evals for overnight: …','Queued 2 evals for later. …','✓ deploy-check','✗ release-notes: Hygiene failed for release-notes','Evaluating 3 skills, 4 at a time…'])('classifies parallel eval output %s',line=>{expect(printedSetupStep(line)).toBe('evals');});
