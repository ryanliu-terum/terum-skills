import { createContext, useContext } from 'react';
import type { Frame, PublishArgs, SkillCard } from '../backend/types';
import type { BulkPublishSummary, BulkRowState } from '../screens/library/bulk-publish';


export interface PublishRow { key: string; card: SkillCard; state: BulkRowState }

export interface PublishRunState {
 rows: readonly PublishRow[];
 /** Who started it: the Library reports (and ends its selection for) its own runs only; the skill page derives its notice by name. */
 origin: 'library' | 'skill';
 /** The Library scope key that started it, so a run started in one checkout is reported in that Library and no other. */
 scope?: string;
 /** Set by `acknowledge`: the screen that owns the run has reported its outcome; a remount must not report it again. */
 reported: boolean;
 flags: Pick<PublishArgs, 'project' | 'category'>;
 team?: string;
 startedAt: number;
 state: 'running' | 'stopping' | 'done' | 'failed' | 'stopped';
 progress?: Extract<Frame, { t: 'progress' }>;
 summary?: BulkPublishSummary;
}

/** What `start` hands back: the run's identity, and a promise for its final snapshot — settled, failed, stopped or force-abandoned. */
export interface PublishRunStart { startedAt: number; settled: Promise<PublishRunState> }

export interface PublishRunApi {
 current: PublishRunState | null;
 dialogOpen: boolean;
 /**
  * Throws a sentence while another publish is in flight. `openBoard: false` starts the run without
  * raising the app-level board: the caller is already showing a dialog for it (D4, the skill page), and
  * the run must never be drawn twice. That caller raises the board later by calling `show()` when its
  * own dialog is dismissed.
  */
 start(args: { cards: readonly SkillCard[]; flags: Pick<PublishArgs, 'project' | 'category'>; origin: PublishRunState['origin']; scope?: string; team?: string; openBoard?: boolean }): PublishRunStart;
 /** Marks the run reported (the Library's notice, the page's dialog standing down); a no-op for any other run. */
 acknowledge(startedAt: number): void;
 /**
  * Hears each run's final snapshot when it settles — done, failed, stopped or force-abandoned. A run that has already
  * settled is delivered at once, so a screen that mounts after the fact (the Library after a detour) still hears it.
  * Returns the unsubscribe. This is how a screen reports a run: from the callback, never from an effect body.
  */
 subscribe(listener: (final: PublishRunState) => void): () => void;
 isRunning(): boolean;
 stop(): Promise<void>;
 /** Closes the board and nothing else: a settled run keeps its top-bar chip until `clear` (UI policy §5). */
 dismiss(): void;
 /** Forgets a settled run (the chip's ✕). A running run is never cleared; Stop is the only way out of one. */
 clear(): void;
 show(): void;
}

export const PublishRunContext = createContext<PublishRunApi>({ current: null, dialogOpen: false, start: () => ({ startedAt: 0, settled: new Promise<PublishRunState>(() => {}) }), acknowledge: () => {}, subscribe: () => () => {}, isRunning: () => false, stop: async () => {}, dismiss: () => {}, clear: () => {}, show: () => {} });
export function usePublishRun() { return useContext(PublishRunContext); }
