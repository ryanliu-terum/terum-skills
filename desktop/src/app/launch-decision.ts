import type { LaunchContext, Result, StatusResult } from '../backend/types';
export function needsLaunchStatus(ctx: LaunchContext | null, consumed: string): boolean {
 return ctx !== null && ctx.writtenAt !== consumed && !ctx.target && ctx.intent !== 'setup';
}
export function decide(ctx: LaunchContext | null, consumed: string, status: Result<StatusResult> | undefined): 'boot' | 'none' {
 if (ctx === null || ctx.writtenAt === consumed) return 'none';
 if (ctx.target || ctx.intent === 'setup') return 'boot';
 return status?.ok && status.value.teams.length === 0 ? 'boot' : 'none';
}
