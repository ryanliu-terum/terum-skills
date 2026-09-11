import type { Backend } from './Backend';
import { PromptCancelledError } from './types';
import type { LaunchContext, Run, Frame, PromptQuestion, Result, SetupResult, SetupStep } from './types';
import { repoIdentity } from './paths';
import { driveRun } from './drive';
// CLI keys map to the six drawn tour steps; print-only keys are copy, never placement counters.
export const SETUP_STEP_TO_BOARD = {
 welcome:'Welcome', app:'Style', role:'Team', github:'Team', team:'Team', actions:'Basics',
 invite:'Team', discover:'Done', evals:'Done', community:'Feedback', hook:'Done', wrapper:'Done', done:'Done',
} as const satisfies Record<SetupStep, string>;
export function printedSetupStep(line:string):SetupStep|null {
 if(line.startsWith('Welcome to terum-skills.')||line.startsWith("Your team's skills")||line.startsWith('This wizard'))return 'welcome';
 if(line.startsWith('GitHub'))return 'github';
 if(line.startsWith('Identity:')||line.startsWith('Team ')||line.startsWith('Joined '))return 'team';
 if(line.startsWith('Next, from any terminal:')||line.startsWith('Connected '))return 'actions';
 if(line.startsWith('Looking for skill folders')||line.startsWith('No skill folders found')||line.startsWith('Could not look')||/ — \d+ skill folders( · already registered)?$/.test(line))return 'discover';
 // The four ways the batch can end without running: everything receipted, nothing shared, the version reader
 // failed, or nothing could be checked. All four are the evals step reporting, not unrecognized copy.
 if(line.startsWith('✓ ')||line.startsWith('✗ ')||line.startsWith('Queued ')||line.startsWith('Evaluating ')||line.startsWith('Evaluated ')||line.startsWith('Every shared skill already has')||line.startsWith('Skipping the eval')
  ||line.startsWith('The team has no shared skills yet')||line.startsWith('Could not read the current skill versions')||line.startsWith('No shared skill could be checked'))return 'evals';
 if(line.startsWith('Feedback and requests:'))return 'community';
 if(line.includes('session hook'))return 'hook';
 if(line.includes('/terum-skills Claude Code skill')||line.includes('/terum-skills skill'))return 'wrapper';
 if(line.startsWith('Members:')||line.startsWith('Repository:')||line.startsWith('README:'))return 'done';
 return null;
}
export function askedSetupStep(question:string):SetupStep|null {
 if(question==='Use this identity?')return 'team';
 if(question==='Look for skill folders on this machine and add them to your library?'||question==='Look under which folder?'||question.startsWith('Add all ')||/^Add .+\?$/.test(question))return 'discover';
 if(question.startsWith('Evaluate the ')||question==='How many at a time?'||question.startsWith('Continue with the next '))return 'evals';
 return null;
}
export interface SetupSnapshot {
 attempt: number;
 outcome: 'running' | 'finished' | 'handoff' | 'cancelled' | 'refused' | 'failed';
 lines: readonly string[];
 activeStep: SetupStep | null;
 progress: Extract<Frame, {t:'progress'}> | null;
 result: Result<SetupResult> | null;
 persistenceError: string | null;
}
export interface SetupSession {
 retry(): Promise<void>;
 stop(): Promise<void>;
 snapshot(): SetupSnapshot;
 subscribe(listener: () => void): () => void;
 start(ask: (question: PromptQuestion) => Promise<string | boolean>): Promise<void>;
}
const sessions = new WeakMap<Backend, Map<string, SetupSession>>();
export function existingSetupSession(backend: Backend, launch: LaunchContext): SetupSession | null {
 return sessions.get(backend)?.get(launch.writtenAt) ?? null;
}
export function activeSetupSession(backend: Backend): SetupSession | null {
 return [...(sessions.get(backend)?.values() ?? [])].find(session => session.snapshot().outcome === 'running') ?? null;
}
export function setupSession(backend: Backend, launch: LaunchContext): SetupSession {
 const prior = existingSetupSession(backend, launch); if (prior) return prior;
 const initial = (attempt: number): SetupSnapshot => ({ attempt, outcome: 'running', lines: [], activeStep: null, progress: null, result: null, persistenceError: null });
 let current = initial(1);
 let running: Promise<void> | null = null;
 let run: Run<SetupResult> | null = null;
 let askHuman: ((question: PromptQuestion) => Promise<string | boolean>) | null = null;
 let stopped = false;
 let rejectPrompt: ((error: Error) => void) | null = null;
 const listeners = new Set<() => void>();
 const update = (patch: Partial<SetupSnapshot>) => { current = { ...current, ...patch }; for (const listener of listeners) listener(); };
 const session: SetupSession = {
  snapshot: () => current,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  retry() {
   if (current.outcome === 'running' || !askHuman) return running ?? Promise.resolve();
   running = null; run = null; stopped = false;
   update(initial(current.attempt + 1));
   return session.start(askHuman);
  },
  async stop() {
   if (current.outcome !== 'running') return;
   stopped = true;
   rejectPrompt?.(new PromptCancelledError('Cancelled.'));
   await run?.cancel();
  },
  start(ask) {
   askHuman = ask;
   // React remounts share an attempt; only explicit Retry starts another operation.
   return running ??= (async () => {
    let result: Result<SetupResult>;
    try {
     await backend.prefs.ready;
     let driven: Result<SetupResult> | null = null;
     const target = launch.target;
     if (target) {
      const status = await backend.status();
      if (status.ok && status.value.teams.length >= 1 && !status.value.teams.some(team => team.remote !== null && repoIdentity(team.remote) === repoIdentity(target))) {
       const team = status.value.teams[0]!;
       driven = { ok: false, error: `This machine is on team ${team.name}. To join ${launch.target}, leave ${team.name} first (Settings ▸ Team).`, refused: true };
      }
     }
     if (!driven) {
      run = backend.setup({ ...(launch.target ? { target: launch.target } : {}), offerConnect: true });
      if (stopped) await run.cancel();
      driven = await driveRun(run, {}, question => new Promise<string | boolean>((resolve, reject) => {
       rejectPrompt = reject;
       if (stopped) reject(new PromptCancelledError('Cancelled.'));
       else void ask(question).then(resolve, reject);
      }).finally(() => { rejectPrompt = null; }),
       line => update({ lines: [...current.lines, line], activeStep: printedSetupStep(line) ?? current.activeStep, ...(/^(Queued |Evaluated )/.test(line) ? { progress: null } : {}) }), progress => update({ progress }), question => update({ activeStep: askedSetupStep(question.question) ?? current.activeStep, ...(current.progress?.label === 'evals' ? { progress: null } : {}) }));
     }
     result = stopped ? { ok: false, error: 'Setup was cancelled.', cancelled: true } : driven;
    } catch (error) { result = { ok:false, error:error instanceof Error ? error.message : String(error) }; }
    if (!launch.writtenAt.startsWith('manual:')) {
      try { backend.prefs.set('launch:consumedWrittenAt', launch.writtenAt); await backend.prefs.flush?.(); }
      catch (error) { update({ persistenceError: error instanceof Error ? error.message : String(error) }); }
    }
    update({ result, progress: null, outcome: result.ok ? result.value.role === 'joiner' && result.value.team === '' ? 'handoff' : 'finished' : result.cancelled ? 'cancelled' : result.refused ? 'refused' : 'failed' });
   })();
  },
 };
 const map = sessions.get(backend) ?? new Map<string, SetupSession>(); map.set(launch.writtenAt, session); sessions.set(backend, map);
 return session;
}
