import { describe, expect, it } from 'vitest';
import { bar, bars, board, code, count, date, kv, path, status, strip, table, text, textBlock, verdict, type RenderContext } from '../board.js';
import { barText, nextCommand, renderCell } from '../cells.js';
import { renderMd } from '../md.js';

const ctx: RenderContext = { format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined, home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['ls'], command: 'npx -y terum-skills@latest ls --format md' };

describe('cells', () => {
  it('renders every cell kind as the spec words it', () => {
    expect(renderCell(text('a|b\nc'), ctx).text).toBe('a|b c');
    expect(renderCell(count(null), ctx)).toEqual({ text: '—', align: 'right' });
    expect(renderCell(count(12), ctx)).toEqual({ text: '12', align: 'right' });
    expect(renderCell(verdict({ verdict: 'PASS', lift: 33 }), ctx)).toEqual({ text: '✓ PASS +33%', tone: 'ok', align: 'left' });
    expect(renderCell(verdict({ verdict: 'NEUTRAL', lift: 0, partial: [4, 6] }), ctx)).toEqual({ text: '● NEUTRAL ±0% (4/6 scored)', tone: 'muted', align: 'left' });
    expect(renderCell(verdict({ verdict: 'FAIL', lift: -20, stale: true, from: 'v2' }), ctx)).toEqual({ text: '✗ FAIL −20% ⚠ stale (v2)', tone: 'bad', align: 'left' });
    expect(renderCell(verdict({ verdict: null }), ctx)).toEqual({ text: '— not evaluated', tone: 'muted', align: 'left' });
    expect(renderCell(verdict({ verdict: null, stale: true }), ctx)).toEqual({ text: '⚠ stale — edited since the eval', tone: 'warn', align: 'left' });
    expect(renderCell(verdict({ verdict: null, invalid: true }), ctx)).toEqual({ text: '⚠ invalid receipt', tone: 'warn', align: 'left' });
    expect(renderCell(status('ok', 'git'), ctx).text).toBe('✓ git'); expect(renderCell(status('bad', 'gh'), ctx).text).toBe('✗ gh'); expect(renderCell(status('warn', 'x'), ctx).text).toBe('⚠ x');
    expect(renderCell(status('pending', 'x'), ctx).text).toBe('◔ x'); expect(renderCell(status('info', 'x'), ctx).text).toBe('● x'); expect(renderCell(status('muted', 'x'), ctx).text).toBe('— x');
    expect(renderCell(date('2026-09-11T12:00:00Z'), ctx).text).toBe('2d ago');
    expect(renderCell(path('/home/u/.claude/skills/x'), ctx)).toEqual({ text: '~/.claude/skills/x', mono: true, align: 'left' });
    expect(renderCell(code('v3'), ctx)).toEqual({ text: 'v3', mono: true, align: 'left' });
    expect(renderCell(strip('WWLT'), ctx)).toEqual({ text: 'WWLT', mono: true, align: 'left' });
    expect(barText(0.82, '82%')).toBe('████████░░ 82%'); expect(barText(0.25, '')).toBe('██░░░░░░░░'); expect(barText(null, 'n/a')).toBe('—————————— n/a');
    expect(renderCell(bar(1, '$1.00'), ctx).text).toBe('██████████ $1.00');
  });
  it('phrases a next step for each host', () => {
    const item = { label: 'Info', skill: 'skill-info', verb: 'ls skill', args: ['deploy-check'] };
    expect(nextCommand(item, ctx)).toBe('/skill-info deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'codex' })).toBe('$skill-info deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'terminal' })).toBe('npx -y terum-skills@latest ls skill deploy-check');
    expect(nextCommand(item, { ...ctx, host: 'terminal', form: 'bare' })).toBe('terum-skills ls skill deploy-check');
    expect(nextCommand({ label: 'Install', verb: 'install', args: ['my skill'] }, ctx)).toBe('/terum-skills install "my skill"');
    expect(nextCommand({ label: 'Install', verb: 'install', args: ['my skill'] }, { ...ctx, host: 'codex' })).toBe('$terum-skills install "my skill"');
    expect(nextCommand({ label: 'Install', verb: 'install', args: ['my skill'] }, { ...ctx, host: 'terminal' })).toBe("npx -y terum-skills@latest install 'my skill'");
    expect(nextCommand({ label: 'Update', raw: 'npm install -g terum-skills@latest' }, ctx)).toBe('npm install -g terum-skills@latest');
  });
});

describe('md backend', () => {
  it('renders title, resolved, headline, sections, failure, notes and next in order', () => {
    const b = board('Marketplace — acme', {
      headline: '2 skills · 3 members',
      resolved: ['Resolved: "dep" → deploy-check (unique prefix)'],
      sections: [
        table([{ key: 'skill', label: 'Skill', priority: 1 }, { key: 'installs', label: 'Installs', priority: 1, align: 'right' }, { key: 'eval', label: 'Eval', priority: 1 }],
          [{ skill: text('deploy-check'), installs: count(2), eval: verdict({ verdict: 'PASS', lift: 33 }) }, { skill: text('a|b'), installs: count(null), eval: verdict({ verdict: null }) }, { skill: text('third'), installs: count(0), eval: verdict({ verdict: null }) }],
          { title: 'Skills', cap: 2 }),
        kv([['role', text('Platform')], ['path', path('/home/u/proj')]], 'Identity'),
        textBlock(['# Body', 'line ``` inside'], { title: 'Body preview', fenced: 'md' }),
        bars([{ label: 'candidate', fraction: 0.8, value: '$0.40' }, { label: 'baseline', fraction: null, value: '—' }], 'ROI'),
        table([{ key: 'a', label: 'A', priority: 1 }], [], { title: 'Empty' }),
      ],
      notes: ['skills/bad: cannot parse'],
      next: [{ label: 'Info', skill: 'skill-info', verb: 'ls skill', args: ['deploy-check'] }, { label: 'Eval', skill: 'eval', verb: 'eval', args: ['deploy-check'] }],
      failure: { error: 'Hygiene failed for x:\nHYG1 SKILL.md: bad', partial: true },
    });
    expect(renderMd(b, ctx)).toBe([
      '## Marketplace — acme',
      '_Resolved: "dep" → deploy-check (unique prefix)_',
      '**2 skills · 3 members**',
      '',
      '### Skills',
      '',
      '| Skill | Installs | Eval |',
      '|---|---:|---|',
      '| deploy-check | 2 | ✓ PASS +33% |',
      '| a\\|b | — | — not evaluated |',
      '_… and 1 more — run `npx -y terum-skills@latest ls --format md --rows all`_',
      '',
      '### Identity',
      '',
      '- **role:** Platform',
      '- **path:** `~/proj`',
      '',
      '### Body preview',
      '',
      '````md',
      '# Body',
      'line ``` inside',
      '````',
      '',
      '### ROI',
      '',
      '| Label | Bar |',
      '|---|---|',
      '| candidate | ████████░░ $0.40 |',
      '| baseline | —————————— — |',
      '',
      '### Empty',
      '',
      '_none_',
      '',
      '> ❌ Hygiene failed for x: (partial result above)',
      '> HYG1 SKILL.md: bad',
      '',
      '**Notes**',
      '- skills/bad: cannot parse',
      '',
      '**Next:** `/skill-info deploy-check` · `/eval deploy-check`',
    ].join('\n'));
  });
  it('never emits an escape sequence and marks refusals and declines', () => {
    const md = renderMd(board('T', { failure: { error: 'no', refused: true } }), { ...ctx, color: true });
    expect(md).toBe('## T\n\n> ❌ no (refused)');
    expect(renderMd(board('T', { failure: { error: 'no', declined: true } }), ctx)).toBe('## T\n\n> ❌ no (declined)');
    expect(md).not.toMatch(/\x1b/);
  });
});
