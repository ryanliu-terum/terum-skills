import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createConfigStore } from '../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed } from '../lib/__tests__/fixtures.js';

it.skipIf(process.platform === 'win32')('cancel during a built-bin eval kills the agent child and exits the leader', async () => {
  const fixture = await bareTeam();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript')), '..', 'bin', 'tsc');
  await promisify(execFile)(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json'), '--outDir', join(fixture.root, 'dist')], { cwd: root });
  await writeFile(join(fixture.root, 'package.json'), await readFile(join(root, 'package.json')));
  await symlink(join(root, 'node_modules'), join(fixture.root, 'node_modules'), 'dir');
  const SKILL = '---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nbody\n';
  const CASE = 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n';
  await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', SKILL);
  await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', CASE);
  const home = join(fixture.root, 'home');
  // §6.3: eval reads the folder in the LIBRARY, so the bytes under eval have to be on this machine.
  await mkdir(join(home, '.claude', 'skills', 'sample', 'evals', 'cases'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'sample', 'SKILL.md'), SKILL);
  await writeFile(join(home, '.claude', 'skills', 'sample', 'evals', 'cases', 'happy.yaml'), CASE);
  const store = createConfigStore(join(home, '.terum', 'skills'));
  await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update(c => { c.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  const stub = join(fixture.root, 'agent.sh'); const pidFile = join(fixture.root, 'agent.pid');
  await writeFile(stub, `#!/bin/sh
if [ "$1" = "--version" ]; then echo '1.0.0'; exit 0; fi
case "$2" in
  'Reply with the single word'*)
    echo '{"type":"system","subtype":"init","model":"stub","skills":[]}'
    echo '{"type":"result","result":"ok"}'
    exit 0 ;;
esac
echo $$ > "$AGENT_PID_FILE"
exec sleep 60
`);
  await chmod(stub, 0o755);
  const child = spawn(process.execPath, [join(fixture.root, 'dist', 'index.js'), '--frames', 'eval', '--execution-only', '--no-gen', '--', 'sample'], {
    cwd: fixture.root, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, TERUM_SKILLS_AGENT_CMD: stub, AGENT_PID_FILE: pidFile },
  });
  let stdout = ''; let stderr = ''; let exited = false;
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const exit = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', code => { exited = true; resolve(code); }); });
  let pid: number | undefined;
  try {
    await expect.poll(async () => {
      if (exited) throw new Error(`eval exited before spawning its agent: ${stdout}\n${stderr}`);
      try { pid = Number((await readFile(pidFile, 'utf8')).trim()); return pid > 0; } catch { return false; }
    }, { timeout: 15_000 }).toBe(true);
    const hello = JSON.parse(stdout.split('\n')[0]!) as { features: { runEvalInApp: boolean } };
    expect.soft(hello.features.runEvalInApp).toBe(true);
    child.stdin.write('{"t":"cancel"}\n');
    await expect.poll(() => {
      try { process.kill(pid!, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }, { timeout: 5_000 }).toBe(true);
    await expect.poll(() => exited, { timeout: 5_000 }).toBe(true);
    expect(await exit).toBe(143);
  } finally {
    // Also clean up the entire fixture process group when running this regression against the base tree.
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
    if (pid !== undefined) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    await exit;
  }
});
