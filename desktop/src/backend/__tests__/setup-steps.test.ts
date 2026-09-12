import { expect, it } from 'vitest';
import { askedSetupStep, printedSetupStep, SETUP_STEP_TO_BOARD } from '../setup-session';
it.each([
 ["Terum will track the skills in that project's .claude folder.",'Done'],['Added /Users/you/code/mrf to your library.','Done'],
 ['/Users/you/code/mrf is already in your library.','Done'],['Could not add that project: /x does not exist.','Done'],
 ['Evaluating 1 of 2 · deploy-check','Done'],['Evaluated 2 of 2; 0 failed.','Done'],
 ['Welcome to terum-skills.','Welcome'],['GitHub: gh is not installed.','Team'],['Identity: @seed','Team'],
 ['Team acme is already configured on this machine.','Team'],
 ['Feedback and requests: https://example.com','Feedback'],['Skipped the session hook; re-run setup to install it later.','Done'],
 ['Installed the /terum-skills Claude Code skill at /fixture.','Done'],['Repository: /fixture/team.git','Done'],['Members:','Done'],['README: /fixture/team.git','Done'],
])('maps printed step %s to its drawn tour step',(line,board)=>{const step=printedSetupStep(line);expect(step&&SETUP_STEP_TO_BOARD[step]).toBe(board);});
it('keeps unrecognized CLI output as copy without inventing a step outcome',()=>{expect(printedSetupStep('An unexpected diagnostic.')).toBeNull();});
// B1 deletes the actions step, so the terminal-hint block setup still prints after invite belongs to no
// step: it is copy in the output pane, and no tour row may claim it.
it('claims no step for the terminal hint block setup still prints',()=>{expect(printedSetupStep('Next, from any terminal:')).toBeNull();expect(printedSetupStep('  npx -y terum-skills@latest publish <skill>          — publish a local skill explicitly')).toBeNull();});

it('maps the identity ask to team without treating unrelated asks as setup steps',()=>{expect(askedSetupStep('Use this identity?')).toBe('team');expect(askedSetupStep('Join this team?')).toBeNull();});

// D13 replaced the scan's four questions with one confirm and one folder picker.
it('maps the projects and evals questions to their steps',()=>{
 for(const question of ['Add a project?','Which folder?'])expect(askedSetupStep(question)).toBe('projects');
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
 // The projects rules are checked first and must not claim any of them.
 expect(printedSetupStep('Could not add that project: /x does not exist.')).toBe('projects');
 expect(printedSetupStep('Added /x to your library.')).toBe('projects');
});
it('does not mistake an added project path for the wrapper step',()=>{
 expect(printedSetupStep('Added /home/teniroo/Projects/SSM/terum-skills to your library.')).toBe('projects');
 expect(printedSetupStep('Evaluating 1 of 1 · terum-skills')).toBe('evals');
 for(const line of [
  'The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at /x); skipped.',
  '/x exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.',
  'The /terum-skills Claude Code skill at /x is current.', 'Updated the /terum-skills Claude Code skill at /x.',
  'Skipped the /terum-skills skill; re-run setup to install it later.', 'Installed the /terum-skills Claude Code skill at /x.',
 ])expect(printedSetupStep(line)).toBe('wrapper');
});

it.each(['Queued 2 evals for later. Run them with `npx -y terum-skills@latest eval --drain`.', 'Evaluated 2 of 3; 1 failed.', 'Queued 3 evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle.'])('maps the new eval outcome %s', line => {
 expect(printedSetupStep(line)).toBe('evals');
});
it.each(['Queued 3 evals for overnight: …','Queued 2 evals for later. …','✓ deploy-check','✗ release-notes: Hygiene failed for release-notes','Evaluating 3 skills, 4 at a time…'])('classifies parallel eval output %s',line=>{expect(printedSetupStep(line)).toBe('evals');});
