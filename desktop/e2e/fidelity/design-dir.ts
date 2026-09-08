import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function resolveDesignDir(env: NodeJS.ProcessEnv = process.env): { dir: string; shots: string } | undefined {
  const dir = env.TERUM_DESIGN_DIR?.trim();
  if (!dir) return undefined;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`TERUM_DESIGN_DIR points at a missing directory: ${dir}`);
  }
  return { dir, shots: join(dir, '.shots') };
}

export function oraclePath(shots: string, boardName: string): string {
  return join(shots, boardName + '.png');
}
