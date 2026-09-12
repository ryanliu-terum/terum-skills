/**
 * The desktop adapter parses every CLI result through a zod mirror of that verb's shape
 * (`desktop/src/backend/tauri/index.ts`). Those mirrors are hand-written copies of types that live in
 * the root CLI tree, and nothing has ever tied the copy to the original. When they drift, the two
 * directions fail in opposite ways and neither is caught by a gate:
 *
 *   - a mirror that requires a field the CLI stopped emitting, or reads it under the wrong name,
 *     throws at runtime in the app while every test stays green (`cliSync` required `timings` and
 *     read `message` where the CLI emits `detail`)
 *   - a `.strict()` mirror rejects a field the CLI started emitting
 *
 * This file closes the first direction at COMPILE time and costs nothing to run: each assertion says
 * "a value of the CLI's own result type is an acceptable input to this mirror". Rename a field in the
 * CLI, or mistype one in a mirror, and `npm run typecheck:mirrors` goes red naming the mirror.
 *
 * WHY ITS OWN tsconfig. `desktop/tsconfig.json` sets `exactOptionalPropertyTypes` and
 * `verbatimModuleSyntax`; the root tree is compiled under neither and does not satisfy them, so
 * pulling root types into desktop's normal typecheck produces ~26 errors in root source that have
 * nothing to do with the mirrors. `tsconfig.mirrors.json` compiles this one file with those two
 * options relaxed and everything else — `strict`, `noUncheckedIndexedAccess` — left on. That is also
 * why this file sits outside `desktop/src`, which desktop's own tsconfig includes wholesale.
 *
 * The type-only imports are exempt from the leaf rule pinned by
 * `desktop/src/backend/tauri/__tests__/cli-tree-imports.test.ts` — they are erased, so no root module
 * graph and no `node:` builtin can reach the browser bundle through this file.
 *
 * KNOWN GAP, deliberately left open: this does not catch the second direction. A CLI type that grows
 * a field a `.strict()` mirror would reject stays assignable here, because TypeScript only flags
 * excess properties on object literals. `cliLocalRow` is the `.strict()` one; a stale capture there
 * fails loudly at runtime, which is why that direction is the cheaper one to leave uncovered.
 */
import type { z } from 'zod';
import type {
  cliInstalled, cliUninstalled, cliMachine, cliPublish, cliSetup, cliEval, cliSearch,
  cliCardReceipt, cliLsSkill, cliProject, cliLocalRow, cliLocalSection, cliProjectAdded,
  cliProjectCreated, cliProjectRemoved, cliLs, cliStatusTeams, cliStatus,
} from '../src/backend/tauri/index';
import type { cliRefresh } from '../src/backend/tauri/refresh';

import type { LsResult, LsSkill, LocalSection, LsReceipt } from '../../src/commands/ls.js';
import type { StatusResult } from '../../src/commands/status.js';
import type { PublishResult } from '../../src/commands/publish.js';
import type { SearchHit } from '../../src/commands/search.js';
import type { EvalResult } from '../../src/commands/eval.js';
import type { SetupResult } from '../../src/commands/setup.js';
import type { InstalledResult } from '../../src/commands/install.js';
import type { UninstalledResult } from '../../src/commands/uninstall.js';
import type { MachineUninstallResult } from '../../src/commands/uninstallMachine.js';
import type { ProjectResult } from '../../src/commands/project.js';
import type { ProjectCreated } from '../../src/commands/team.js';
import type { SyncResult } from '../../src/commands/refresh.js';

/**
 * The CLI's types use `readonly` arrays where zod's inferred input is mutable, and a `readonly T[]`
 * is not assignable to `T[]`. That difference cannot survive JSON, so it is noise here, not signal.
 */
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends Date ? T
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> }
  : T;

/**
 * Records that `Mirror` accepts everything the CLI's `Emitted` type can be. A drift shows up as
 * "Type 'X' is not assignable to type 'Y'" on the offending line, naming the mirror.
 */
type Parses<Mirror, Emitted extends z.input<Mirror & z.ZodType>> = [Mirror, Emitted];

type Assertions = [
  Parses<typeof cliLs, Mutable<LsResult>>,
  Parses<typeof cliLsSkill, Mutable<LsSkill>>,
  Parses<typeof cliLocalSection, Mutable<LocalSection>>,
  Parses<typeof cliLocalRow, Mutable<LocalSection['rows'][number]>>,
  Parses<typeof cliCardReceipt, Mutable<LsReceipt>>,
  Parses<typeof cliProject, Mutable<NonNullable<LsResult['projects']>[number]>>,
  Parses<typeof cliStatus, Mutable<StatusResult>>,
  Parses<typeof cliStatusTeams, Mutable<StatusResult>>,
  Parses<typeof cliSearch, Mutable<SearchHit[]>>,
  Parses<typeof cliPublish, Mutable<PublishResult>>,
  Parses<typeof cliEval, Mutable<EvalResult>>,
  Parses<typeof cliSetup, Mutable<SetupResult>>,
  Parses<typeof cliInstalled, Mutable<InstalledResult[]>>,
  Parses<typeof cliUninstalled, Mutable<UninstalledResult[]>>,
  Parses<typeof cliMachine, Mutable<MachineUninstallResult>>,
  Parses<typeof cliProjectAdded, Mutable<Extract<ProjectResult, { added: boolean }>>>,
  Parses<typeof cliProjectRemoved, Mutable<Extract<ProjectResult, { placementsRemaining: number }>>>,
  Parses<typeof cliProjectCreated, Mutable<ProjectCreated>>,
  Parses<typeof cliRefresh, Mutable<SyncResult>>,
];

export type { Assertions };
