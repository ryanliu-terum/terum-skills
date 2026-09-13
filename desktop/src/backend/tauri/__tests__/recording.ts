import { FAKE_HOME } from './fake-bridge';

/**
 * The frames under .planning/codex-runs/ are recorded by each set's record.sh against a scratch fixture:
 * HOME is `<fx>/home` and the fixture's other trees (`<fx>/repo/…`, `<fx>/work/…`) sit beside it. Every
 * path the CLI prints or returns is a function of those two roots, so moving `<fx>/home` under the fake
 * shell's HOME and the fixture root to `/` gives the recording the same CLI would have made there — and
 * the paths these tests were written against (`/Users/teddy/.claude/skills/…`, `/work/project/…`).
 * A file that names no home directory is returned untouched.
 */
export function underFakeHome(lines: readonly string[], home = FAKE_HOME): string[] {
  const hit = lines.map(line => /(\/[^"\s;()]*?)\/(home(?:-[a-z]+)?)\/\.(?:claude|terum)\//.exec(line)).find(match => match !== null);
  if (!hit) return [...lines];
  const fixture = hit[1]!, recordedHome = `${fixture}/${hit[2]!}`;
  return lines.map(line => line.split(recordedHome).join(home).split(fixture).join(''));
}

/**
 * The project section `ls --local` records for a registered checkout whose folder is not on disk
 * (personal-library/frames/ls-local-missing.jsonl; installed-state/frames/ls-local-project.jsonl for a
 * scanned one). §7.2 made `ls --local` Library-only: the mock-vs-real and m7-S7g fixtures register no
 * checkout, so their re-recordings carry the Global root alone, where the derived frames they replaced
 * carried the recording machine's cwd as a detected `seed` checkout. The tests that exercise checkout
 * behaviour (absent roots, install destinations, scoped removal, UNC paths) append this section — the
 * shape the CLI emits today, at the root those tests already name.
 */
export function seedCheckout(home = FAKE_HOME, rootState: 'scanned' | 'absent' | 'unreadable' = 'absent') {
  const repoRoot = `${home}/code/seed`;
  return { root: `${repoRoot}/.claude/skills`, scope: 'project' as const, repoRoot, registered: true, label: 'seed', rootState, remote: null, counts: { skillFolders: 0, connectable: 0 }, rows: [] as Record<string, unknown>[], notOffered: [] as Record<string, unknown>[], problems: [] as { path: string; reason: string }[] };
}
/** `lines` with the seed checkout appended to the `ls --local` result's sections. */
export function withSeedCheckout(lines: readonly string[], home = FAKE_HOME): string[] {
  return lines.map(line => {
    const frame = JSON.parse(line) as { t: string; verb?: string; value?: { local?: unknown[] } };
    if (frame.t !== 'result' || !Array.isArray(frame.value?.local)) return line;
    frame.value.local.push(seedCheckout(home));
    return JSON.stringify(frame);
  });
}
