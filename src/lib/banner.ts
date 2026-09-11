import type { Prompter } from './prompt.js';
import { terminalOutputIsTTY } from './tty.js';
import { PACKAGE_NAME } from './package.js';

/** Circled t, from desktop/src-tauri/icons/icon.png; regenerate with scripts/ascii-mark.mjs. */
export const MARK = `@@@@*=:           .......            :=*@@@@
@@+.         .::....   .....::.         .+@@
@:       .::..      .:        ..::.       :@
-      .:.         *@@%=          .:.      -
     .-.          #@@@@@=           .-.
    :-           +@*#@@@@:            -:
   ::           .@-  +@%@*             ::
  :-            =#    #@@%              -:
  =    .==.     =:    +@%@:              =
 ::   -@%             -@%@= .=*###*+:    ::
 -.   %@%+:     .:--  :@@@+ %@@@@@@@@#   .-
 -.   -@@@@%%#%%@@@@. .@@@* =*+:..:*@@*  .-
 ::    .+#@@@@@@@#+    %@@+         *@#  ::
  -       .:---:.      %@@=         *+   -
  ::             -    .@@@:        .    ::
   -.            %:   =@@#             .-
    -:           =@-.-%@@-            :-
     .-.          *@@@@@*           .-.
-      ::.         =%@@*          .::      -
@:       .::.        ..        .::.       :@
@@+.        .::....      ....::.        .+@@
@@@@*=:          ..........          :=*@@@@`;
export type StyleKind = 'bold' | 'dim' | 'cyan' | 'green' | 'red';
export function colorCapable(): boolean {
  return terminalOutputIsTTY() && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}
export function decorate(io: Prompter, args: { quiet?: boolean }): boolean {
  return io.channel !== 'frames' && io.interactive && !args.quiet && colorCapable();
}
export function style(kind: StyleKind, line: string): string {
  const codes: Record<StyleKind, number> = { bold: 1, dim: 2, cyan: 36, green: 32, red: 31 };
  return colorCapable() ? `\x1b[${codes[kind]}m${line}\x1b[0m` : line;
}
export function header(title: string): string { return `\n> ${style('bold', title)}`; }
export function welcome(): string { return `  Welcome to ${style('bold', PACKAGE_NAME)}, your team's skill library.`; }
export function ok(line: string): string { return colorCapable() ? style('green', `✓ ${line}`) : line; }
export function bad(line: string): string { return colorCapable() ? style('red', `✗ ${line}`) : line; }
export function body(line: string): string {
  const bullet = line.startsWith('  • ');
  if (bullet) line = line.slice(4);
  let formatted = line;
  if (line.startsWith('✓ ')) formatted = style('green', line);
  else if (line.startsWith('✗ ')) formatted = style('red', line);
  else if (line === 'GitHub: gh is logged in.' || /^(Created team |Joined |Invited |Connected |Registered |Installed the session hook |Queued .* evals )/.test(line) || line.startsWith(`Installed the /${PACKAGE_NAME} Claude Code skill `) || /^Evaluated \d+ of \d+; 0 failed\.$/.test(line)) formatted = ok(line);
  else if (/^(Could not look in |Could not evaluate the shared skills: |Skipping the evals: )/.test(line) || /^Evaluated \d+ of \d+; [1-9]\d* failed\.$/.test(line)) formatted = bad(line);
  return `${bullet ? '  • ' : '  '}${formatted}`;
}
export function box(lines: readonly string[]): string[] {
  const clean = lines.flatMap(line => line.split('\n')).map(line => line.trimEnd());
  const width = Math.max(0, ...clean.map(line => [...line].length));
  return [`╭${'─'.repeat(width + 2)}╮`, ...clean.map(line => `│ ${line}${' '.repeat(width - [...line].length)} │`), `╰${'─'.repeat(width + 2)}╯`];
}
export function sessionBox(input: { version: string; team: string; handle?: string; roster: readonly { handle: string; displayName: string }[]; repository: string; readme: string; next: string }): string[] {
  const teammates = input.roster.filter(person => person.handle !== input.handle).length;
  const row = (label: string, value: string) => `${label.padEnd(13)}${value}`;
  return box([`>_ ${PACKAGE_NAME} (v${input.version})`, '',
    row('team:', `${input.team} · ${teammates ? `you and ${teammates} teammate${teammates === 1 ? '' : 's'}` : 'just you'}`),
    ...input.roster.map((person, index) => row(index ? '' : 'members:', `@${person.handle} — ${person.displayName}`)),
    row('repository:', input.repository), row('readme:', input.readme), row('next:', input.next),
  ]);
}
