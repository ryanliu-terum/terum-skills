/**
 * The CLI's `advice` lines (update, uninstall) are prose with the runnable commands indented by two spaces
 * (`src/commands/update.ts` `advice()`). The app never re-derives a command from the CLI's verbs, so the only
 * safe way to make each one copyable is to split the CLI's own lines by that indent: an indented line is a
 * command, an unindented one is prose. Consecutive prose lines stay separate lines (the CLI meant them so).
 */
export type AdviceSegment = { kind: 'text'; text: string } | { kind: 'command'; text: string };

export function splitAdvice(lines: readonly string[]): AdviceSegment[] {
  const segments: AdviceSegment[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (/^\s+\S/.test(line)) segments.push({ kind: 'command', text: line.trim() });
    else segments.push({ kind: 'text', text: line.trim() });
  }
  return segments;
}

/** Every command in the advice, in order — what "Copy all" copies when there is more than one, and what the single Copy copies otherwise. */
export function adviceCommands(lines: readonly string[]): string[] {
  return splitAdvice(lines).filter((segment): segment is { kind: 'command'; text: string } => segment.kind === 'command').map(segment => segment.text);
}
