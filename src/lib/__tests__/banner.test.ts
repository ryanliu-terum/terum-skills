import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MARK, bad, body, box, decorate, header, ok, sessionBox, style, welcome } from '../banner.js';
import * as tty from '../tty.js';
import { ScriptedPrompter } from './fixtures.js';
beforeEach(() => { vi.stubEnv('TERM', 'xterm'); vi.stubEnv('NO_COLOR', undefined); vi.spyOn(tty, 'terminalOutputIsTTY').mockReturnValue(true); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('keeps the generated mark within a 44 by 22 cell without trailing spaces', () => {
 const lines = MARK.split('\n'); expect(lines).toHaveLength(22); expect(Math.max(...lines.map(line => line.length))).toBe(44);
 expect(lines.every(line => line.length <= 44 && line === line.trimEnd())).toBe(true);
});
it('uses unnumbered headers and the welcome product emphasis', () => {
 expect(header('Team')).toBe('\n> \x1b[1mTeam\x1b[0m'); expect(header('Invite')).not.toMatch(/Step|of \d/);
 expect(welcome()).toBe("  Welcome to \x1b[1mterum-skills\x1b[0m, your team's skill library.");
});
it('boxes multiline text with equal-width borders and no trailing spaces', () => {
 expect(box(['Set up', 'a\nb  '])).toEqual(['╭────────╮', '│ Set up │', '│ a      │', '│ b      │', '╰────────╯']); expect(box([])).toEqual(['╭──╮','╰──╯']);
});
it('never decorates frames, pipes, quiet mode, NO_COLOR, dumb terminals, or non-TTY output', () => {
 const io = new ScriptedPrompter([], [], true); expect(decorate(io, {})).toBe(true);
 expect(decorate(Object.assign(new ScriptedPrompter([], [], true), { channel: 'frames' as const }), {})).toBe(false);
 expect(decorate(new ScriptedPrompter(), {})).toBe(false); expect(decorate(io, {quiet:true})).toBe(false);
 vi.stubEnv('TERM','dumb');expect(decorate(io,{})).toBe(false);vi.stubEnv('TERM','xterm');
 vi.stubEnv('NO_COLOR','');expect(decorate(io,{})).toBe(false);vi.stubEnv('NO_COLOR',undefined);
 vi.mocked(tty.terminalOutputIsTTY).mockReturnValue(false);expect(decorate(io,{})).toBe(false);
});
it('uses only the five specified styles and reset', () => {
 for(const [kind,code] of [['bold',1],['dim',2],['cyan',36],['green',32],['red',31]] as const)expect(style(kind,'line')).toBe(`\x1b[${code}mline\x1b[0m`);
 expect(ok('Connected a')).toBe('\x1b[32m✓ Connected a\x1b[0m');expect(bad('Oops')).toBe('\x1b[31m✗ Oops\x1b[0m');
 expect(body('✓ alpha')).toBe('  \x1b[32m✓ alpha\x1b[0m');expect(body('  command')).toBe('    command');expect(body('  • item')).toBe('  • item');expect(body('  • Could not look in /gone')).toBe('  • \x1b[31m✗ Could not look in /gone\x1b[0m');
});
it.each(['NO_COLOR','notTTY'])('keeps style helpers plain for %s', mode => {
 if(mode==='NO_COLOR')vi.stubEnv('NO_COLOR','1');else vi.mocked(tty.terminalOutputIsTTY).mockReturnValue(false);
 expect(header('Team')).toBe('\n> Team');expect(ok('done')).toBe('done');expect(bad('error')).toBe('error');expect(style('cyan','choice')).toBe('choice');
});
it('renders the complete session box with a thirteen-column label gutter and no truncation', () => {
 expect(sessionBox({version:'0.12.2',team:'alpha',handle:'alice',roster:[{handle:'alice',displayName:'Alice'},{handle:'bob',displayName:'Bob'}],repository:'https://github.com/alice/alpha-repo',readme:'https://github.com/alice/alpha-repo/blob/main/README.md',next:'npx -y terum-skills@latest ls'})).toEqual([
 '╭──────────────────────────────────────────────────────────────────────╮',
 '│ >_ terum-skills (v0.12.2)                                            │',
 '│                                                                      │',
 '│ team:        alpha · you and 1 teammate                              │',
 '│ members:     @alice — Alice                                          │',
 '│              @bob — Bob                                              │',
 '│ repository:  https://github.com/alice/alpha-repo                     │',
 '│ readme:      https://github.com/alice/alpha-repo/blob/main/README.md │',
 '│ next:        npx -y terum-skills@latest ls                           │',
 '╰──────────────────────────────────────────────────────────────────────╯',
 ]);
 expect(sessionBox({version:'1',team:'alpha',handle:'alice',roster:[{handle:'alice',displayName:'Alice'}],repository:'r',readme:'r',next:'ls'}).join('\n')).toContain('alpha · just you');
});
it.each([
 ['GitHub: gh is logged in.',32],['Created team alpha at remote.',32],['Joined alpha.',32],['Invited bob.',32],['Connected alpha.',32],['Registered /work in your library.',32],['Installed the session hook at /settings.',32],['Installed the /terum-skills Claude Code skill at /skills.',32],['Queued 2 evals for later.',32],['Evaluated 3 of 3; 0 failed.',32],
 ['Could not look in /gone: EACCES',31],['Could not evaluate the shared skills: failed',31],['Skipping the evals: offline',31],['Evaluated 0 of 3; 3 failed.',31],['✗ alpha: failed',31],
 ['Evaluated 3 of 3; 0 failed',null],['GitHub: gh is installed but logged out.',null],
] as const)('styles the enumerated outcome %s only as specified', (line,code)=>{
 const marked=code===null?line:line.startsWith('✗ ')?line:`${code===32?'✓':'✗'} ${line}`;
 expect(body(line)).toBe(code===null?`  ${line}`:`  \x1b[${code}m${marked}\x1b[0m`);
});
