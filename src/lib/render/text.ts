/**
 * Width and wording helpers the backends share. Widths are code points (the `box()` rule in
 * banner.ts); East-Asian double-width glyphs are a documented rough edge (spec §4.2). Nothing here
 * reads the clock, the environment or the disk: `now` and `home` arrive as arguments.
 */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string { return text.replace(ANSI, ''); }

export function visibleWidth(text: string): number { return [...stripAnsi(text)].length; }

/** At most `max` code points, the last one `…` when anything was cut; a string that fits is returned unchanged. */
export function truncate(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  return max <= 1 ? '…' : `${points.slice(0, max - 1).join('')}…`;
}

export function padVisible(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - visibleWidth(text));
  return align === 'right' ? `${' '.repeat(gap)}${text}` : `${text}${' '.repeat(gap)}`;
}

/** One line: every line break becomes a single space; ends trimmed. */
export function singleLine(text: string): string { return text.replace(/\s*\r?\n\s*/g, ' ').trim(); }

/** `today` / `Nd ago` within 30 days of `now` (epoch ms); the ISO date otherwise; `—` for nothing usable. */
export function relativeDate(iso: string | null | undefined, now: number): string {
  if (typeof iso !== 'string' || iso === '' || iso === '—') return '—';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const days = Math.floor((now - at) / 86_400_000);
  if (days < 0 || days >= 30) return new Date(at).toISOString().slice(0, 10);
  return days === 0 ? 'today' : `${days}d ago`;
}

/** `~/…` for a path under `home` (separators shown as `/`); the path itself otherwise. */
export function tildePath(path: string, home: string): string {
  const root = home.replace(/[\\/]+$/, '');
  if (path === root) return '~';
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) return `~${path.slice(root.length).replaceAll('\\', '/')}`;
  return path;
}
