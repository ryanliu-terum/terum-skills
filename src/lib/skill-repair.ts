import YAML from 'yaml';
import { decodeText, INVISIBLE, normalizeLicense } from './evals/hygiene.js';
import { repairFrontmatter } from './frontmatter-repair.js';
import { FRONTMATTER, isSkillName } from './schema.js';

export interface RepairInput {
  /** The folder's name: the authority `name:` must equal. */
  name: string;
  files: ReadonlyMap<string, Buffer>;
  executable: ReadonlySet<string>;
  /** The team's `policy.skill_license`; null when no team is configured, and then license is never touched. */
  policyLicense: string | null;
}
export interface RepairPlan {
  /** Bytes to write, by path relative to the folder. */
  writes: Map<string, Buffer>;
  /** Files whose executable mode should be cleared. */
  clearExecutable: string[];
  /** One plain sentence per change, in application order. Empty means nothing here is a fault fix covers. */
  repaired: string[];
}

/**
 * Every repair `skill fix` performs, planned as pure data so validate can count them without writing
 * and the verb can apply them in one pass. A repair is on this list only when its outcome is fixed by
 * something the author did not type by hand in this file: YAML's own grammar (quoting a scalar that
 * holds `: `), the folder name (`name:` must equal it — Claude Code loads by folder), the team policy
 * (publish overwrites `license:` with it anyway), the HYG2 invisible set (never authored on purpose),
 * and a file mode. Anything whose right answer is a judgement — a description, a category, an extra
 * field, a credential-shaped token, a shebang script — is left for the author and reported instead.
 */
export function planRepairs(input: RepairInput): RepairPlan {
  const writes = new Map<string, Buffer>();
  const clearExecutable: string[] = [];
  const repaired: string[] = [];
  const skill = input.files.get('SKILL.md');
  let skillText = skill === undefined ? undefined : decodeText(skill);

  if (skillText !== undefined) {
    // 1. YAML that refuses a bare value holding `: ` (the ls --local `invalid-yaml` reason).
    const quoted = repairFrontmatter(skillText);
    if (quoted.ok) {
      skillText = quoted.source;
      const keys = quoted.rewritten.map(key => `\`${key}\``);
      repaired.push(`Quoted ${keys.length === 1 ? keys[0] : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`} in SKILL.md so the frontmatter parses; the text is unchanged.`);
    }
    // 2. name and license, edited through the YAML document so quoting, comments and order survive.
    const match = FRONTMATTER.exec(skillText);
    if (match) {
      const document = YAML.parseDocument(match[1]!);
      if (!document.errors.length && YAML.isMap(document.contents)) {
        let changed = false;
        const name = document.get('name');
        if (isSkillName(input.name) && name !== input.name) {
          document.set('name', input.name); changed = true;
          repaired.push(typeof name === 'string' ? `Set name to \`${input.name}\` to match the folder (was \`${name}\`).` : `Set name to \`${input.name}\` to match the folder.`);
        }
        const license = document.get('license');
        if (input.policyLicense !== null && typeof license === 'string' && normalizeLicense(license) !== normalizeLicense(input.policyLicense)) {
          document.set('license', input.policyLicense); changed = true;
          repaired.push(`Set license to \`${input.policyLicense}\`, the team's policy (was \`${license}\`).`);
        }
        if (changed) skillText = `---\n${document.toString()}---${skillText.slice(match[0].length - (match[0].endsWith('\n') ? 1 : 0))}`;
      }
    }
  }

  // 3. HYG2's invisible characters, in every text file (SKILL.md after the edits above).
  for (const [path, contents] of input.files) {
    const text = path === 'SKILL.md' ? skillText : decodeText(contents);
    if (text === undefined) continue;
    const stripped = text.replace(new RegExp(INVISIBLE.source, 'gu'), '');
    const removed = text.length - stripped.length;
    let next = stripped;
    if (removed > 0) repaired.push(`Removed ${removed} invisible character${removed === 1 ? '' : 's'} from ${path}.`);
    if (path === 'SKILL.md') { if (skill !== undefined && next !== decodeText(skill)) writes.set(path, Buffer.from(next, 'utf8')); }
    else if (removed > 0) writes.set(path, Buffer.from(next, 'utf8'));
    else next = text;
    // 4. An executable mode on a file that is not a script. A shebang file is a script the author
    //    meant to run; clearing its bit breaks it and leaves HYG4 standing, so it stays for the author.
    if (input.executable.has(path) && !next.startsWith('#!')) { clearExecutable.push(path); repaired.push(`Cleared the executable mode on ${path}.`); }
  }
  for (const path of input.executable) {
    if (clearExecutable.includes(path) || input.files.has(path) && decodeText(input.files.get(path)!) !== undefined) continue;
    // A binary with the bit set is not a script either.
    clearExecutable.push(path); repaired.push(`Cleared the executable mode on ${path}.`);
  }
  return { writes, clearExecutable, repaired };
}
