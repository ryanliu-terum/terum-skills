const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path || '';

if (!file.endsWith('.ts') && !file.endsWith('.tsx')) process.exit(0);
if (file.includes('/extension/') || file.includes('/services/')) process.exit(0);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.env.CLAUDE_PROJECT_DIR;

// tsgo (native tsc), spawned directly so the timeout kill reaches the checker
// itself — a sh/npx chain leaves an orphaned 2 GB compiler running for minutes.
// No tsc fallback: tsc OOMs (exit 134) against Node's default heap on 8 GB
// machines, so a missing binary means skip, not degrade.
const exe = process.platform === 'win32' ? 'tsgo.exe' : 'tsgo';
const tsgo = path.join(root, 'node_modules',
  `@typescript/native-preview-${process.platform}-${process.arch}`, 'lib', exe);
if (!fs.existsSync(tsgo)) process.exit(0);

// Single-flight: rapid successive edits must not stack whole-repo checks
// (5 concurrent checks ≈ 10 GB on an 8 GB machine). Dead-pid locks are taken over.
const lock = path.join(os.tmpdir(),
  `terum-typecheck-${Buffer.from(root).toString('base64url')}.lock`);
try {
  process.kill(parseInt(fs.readFileSync(lock, 'utf8'), 10), 0);
  process.exit(0);
} catch {}
fs.writeFileSync(lock, String(process.pid));

try {
  const r = spawnSync(tsgo, ['--noEmit', '--pretty', 'false'], {
    cwd: root,
    timeout: 25000,
    killSignal: 'SIGKILL',
    // No GOMEMLIMIT: measured 2026-08-27 — a 1GiB soft cap tripled wall time and
    // 10x'd CPU while peak RSS stayed ~1.8 GB (live set > 1GiB, GC just thrashes).
    encoding: 'utf8',
  });
  const errors = r.stdout || '';
  const shortPath = path.relative(root, file).split(path.sep).join('/');
  if (errors.includes(shortPath)) {
    process.stdout.write(JSON.stringify({
      additionalContext: `Type errors in ${shortPath}:\n${errors.split('\n').filter(l => l.includes(shortPath) || l.startsWith(' ')).slice(0, 10).join('\n')}`
    }));
  }
} finally {
  try { fs.unlinkSync(lock); } catch {}
}
