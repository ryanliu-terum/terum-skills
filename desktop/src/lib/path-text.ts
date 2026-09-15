/**
 * Paths in the UI (2026-09-14 UI policy §2): a filesystem path is never prose. It renders in the mono face on one
 * line, shortened in the MIDDLE so both the root and the folder name stay legible, with the full path on hover and
 * on copy. Windows UNC (`\\wsl.localhost\Ubuntu\home\…`), drive (`C:\…`) and POSIX (`/home/…`, `~/…`) paths all
 * split on their own separator; a path with no separator is returned as is.
 */
export function pathSeparator(path: string): '\\' | '/' {
  const back = (path.match(/\\/g) ?? []).length, forward = (path.match(/\//g) ?? []).length;
  return back > forward ? '\\' : '/';
}

/** The last segment: the folder (or file) name, which is what a person recognises the path by. */
export function pathBase(path: string): string {
  const separator = pathSeparator(path);
  const trimmed = path.replace(new RegExp(`\\${separator}+$`), '');
  const index = trimmed.lastIndexOf(separator);
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** The path without its last segment, separator kept, so `root + base` re-forms the input. */
export function pathDir(path: string): string {
  const separator = pathSeparator(path);
  const trimmed = path.replace(new RegExp(`\\${separator}+$`), '');
  const index = trimmed.lastIndexOf(separator);
  return index === -1 ? '' : trimmed.slice(0, index + 1);
}

/**
 * Middle-ellipsis to at most `max` characters (the folder name always survives whole when it fits; the leading
 * segments are cut). `max` under the base name's length plus 2 returns the base name alone with a leading ellipsis.
 */
export function shortenPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const base = pathBase(path), dir = pathDir(path);
  if (base.length + 2 >= max) return '…' + base.slice(Math.max(0, base.length - (max - 1)));
  const room = max - base.length - 1;
  const head = Math.ceil(room * 0.6), tail = room - head;
  return dir.slice(0, head) + '…' + (tail > 0 ? dir.slice(dir.length - tail) : '') + base;
}

/**
 * Which skill root a placed folder lives under, for a list that names the same skill in two roots: the
 * `.claude/skills` under the home directory is "Global"; a project's `.claude/skills` is the project folder's
 * name; anything else is the parent folder's name. Never a full path (the row's PathText carries that).
 */
export function skillRootLabel(path: string): string {
  const separator = pathSeparator(path);
  const segments = path.split(separator).filter(segment => segment !== '');
  const index = segments.lastIndexOf('.claude');
  if (index === -1 || segments[index + 1] !== 'skills') { const parent = segments.at(-2); return parent === undefined ? '—' : parent; }
  const owner = segments[index - 1];
  if (owner === undefined) return 'Global';
  // The home directory: `/home/<user>`, `/Users/<user>`, `C:\Users\<user>`, `\\wsl.localhost\<distro>\home\<user>`, or `~`.
  const above = segments[index - 2];
  if (owner === '~' || above === 'home' || above === 'Users' || above === 'users') return 'Global';
  return owner;
}
