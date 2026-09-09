// Drive the built CLI over --frames and log its stdout verbatim.
// usage: node drive.mjs <cli dist/index.js> <HOME> <out.jsonl> <mode> [-- <argv...>]
//   mode = close-first-ask  : close stdin at the first ask (no answer)
//   mode = answers:<json>   : JSON object question-substring -> value; answered in arrival order
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const [cli, home, out, mode, dashdash, ...argv] = process.argv.slice(2);
if (dashdash !== '--') throw new Error('usage');
const answers = mode.startsWith('answers:') ? JSON.parse(mode.slice('answers:'.length)) : null;
writeFileSync(out, '');
const env = { ...process.env, HOME: home, GH_TOKEN: '', GITHUB_TOKEN: '', GH_CONFIG_DIR: `${home}/.config/gh` };
delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
const child = spawn(process.execPath, [cli, '--frames', ...argv], { env, stdio: ['pipe', 'pipe', 'pipe'], cwd: process.env.DRIVE_CWD ?? process.cwd() });
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    appendFileSync(out, line + '\n');
    let frame; try { frame = JSON.parse(line); } catch { process.stderr.write(`non-json stdout: ${line}\n`); continue; }
    if (frame.t === 'ask') {
      if (!answers) { process.stderr.write(`closing stdin at ask ${frame.id}: ${frame.question}\n`); child.stdin.end(); continue; }
      const key = Object.keys(answers).find((k) => frame.question.includes(k));
      if (key === undefined) { process.stderr.write(`no answer for: ${frame.question}\n`); child.stdin.end(); continue; }
      process.stderr.write(`answering ${frame.id} (${frame.question.slice(0, 40)}…) = ${JSON.stringify(answers[key])}\n`);
      child.stdin.write(JSON.stringify({ t: 'answer', id: frame.id, value: answers[key] }) + '\n');
    }
  }
});
child.stderr.on('data', (c) => process.stderr.write(`[cli stderr] ${c}`));
child.on('exit', (code) => { process.stderr.write(`exit ${code}\n`); process.exit(0); });
