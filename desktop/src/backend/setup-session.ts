import type { Backend } from './Backend';
import type { Frame, PromptQuestion, Result, SetupResult, SetupStep } from './types';
import { driveRun } from './drive';
export interface LaunchTarget { target: string; writtenAt: string }
// CLI keys map to the six drawn tour steps; print-only keys are copy, never placement counters.
export const SETUP_STEP_TO_BOARD = {
 welcome:'Welcome', app:'Style', role:'Team', github:'Team', team:'Team', actions:'Basics',
 invite:'Team', community:'Feedback', hook:'Done', wrapper:'Done', done:'Done',
} as const satisfies Record<SetupStep, string>;
export function printedSetupStep(line:string):SetupStep|null {
 if(line.startsWith('Welcome to terum-skills.')||line.startsWith("Your team's skills")||line.startsWith('This wizard'))return 'welcome';
 if(line.startsWith('GitHub'))return 'github';
 if(line.startsWith('Identity:')||line.startsWith('Team ')||line.startsWith('Joined '))return 'team';
 if(line.startsWith('Next, from any terminal:')||line.startsWith('Connected '))return 'actions';
 if(line.startsWith('Feedback and requests:'))return 'community';
 if(line.includes('session hook'))return 'hook';
 if(line.includes('/terum-skills')&&line.includes('skill'))return 'wrapper';
 if(line.startsWith('Members:')||line.startsWith('Repository:')||line.startsWith('README:'))return 'done';
 return null;
}
export interface SetupSnapshot {
 lines: readonly string[];
 activeStep: SetupStep | null;
 progress: Extract<Frame, {t:'progress'}> | null;
 result: Result<SetupResult> | null;
 persistenceError: string | null;
}
export interface SetupSession {
 snapshot(): SetupSnapshot;
 subscribe(listener: () => void): () => void;
 start(ask: (question: PromptQuestion) => Promise<string | boolean>): Promise<void>;
}
const sessions = new WeakMap<Backend, Map<string, SetupSession>>();
export function existingSetupSession(backend: Backend, launch: LaunchTarget): SetupSession | null {
 return sessions.get(backend)?.get(launch.writtenAt) ?? null;
}
export function setupSession(backend: Backend, launch: LaunchTarget): SetupSession {
 const prior = existingSetupSession(backend, launch); if (prior) return prior;
 let current: SetupSnapshot = { lines: [], activeStep: null, progress: null, result: null, persistenceError: null };
 let running: Promise<void> | null = null;
 const listeners = new Set<() => void>();
 const update = (patch: Partial<SetupSnapshot>) => { current = { ...current, ...patch }; for (const listener of listeners) listener(); };
 const session: SetupSession = {
  snapshot: () => current,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  start(ask) {
   // React remounts and repeated launch-route visits share one operation and one consumption write.
   return running ??= (async () => {
    await backend.prefs.ready;
    if (backend.prefs.get('launch:consumedWrittenAt', '') === launch.writtenAt) return;
    try {
     const result = await driveRun(backend.setup({ target: launch.target, offerConnect: true }), {}, ask,
      line => update({ lines: [...current.lines, line], activeStep: printedSetupStep(line)??current.activeStep }), progress => update({ progress }));
     update({ result });
     if (result.ok || result.cancelled) {
      backend.prefs.set('launch:consumedWrittenAt', launch.writtenAt);
      try { await backend.prefs.flush?.(); }
      catch (error) { update({ persistenceError: error instanceof Error ? error.message : String(error) }); }
     }
    } catch (error) { update({ result: { ok:false, error:error instanceof Error ? error.message : String(error) } }); }
   })();
  },
 };
 const map = sessions.get(backend) ?? new Map<string, SetupSession>(); map.set(launch.writtenAt, session); sessions.set(backend, map);
 return session;
}
