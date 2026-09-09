import { expect, it } from 'vitest';
import { printedSetupStep, SETUP_STEP_TO_BOARD } from '../setup-session';
it.each([
 ['Welcome to terum-skills.','Welcome'],['GitHub: gh is not installed.','Team'],['Identity: @seed','Team'],
 ['Team acme is already configured on this machine.','Team'],['Connected tdd.','Basics'],['Next, from any terminal:','Basics'],
 ['Feedback and requests: https://example.com','Feedback'],['Skipped the session hook; re-run setup to install it later.','Done'],
 ['Installed the /terum-skills Claude Code skill at /fixture.','Done'],['Repository: /fixture/team.git','Done'],['Members:','Done'],['README: /fixture/team.git','Done'],
])('maps printed step %s to its drawn tour step',(line,board)=>{const step=printedSetupStep(line);expect(step&&SETUP_STEP_TO_BOARD[step]).toBe(board);});
it('keeps unrecognized CLI output as copy without inventing a step outcome',()=>{expect(printedSetupStep('An unexpected diagnostic.')).toBeNull();});
