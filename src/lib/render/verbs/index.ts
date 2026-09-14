import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';
import { renderer as search } from './search.js';
import { renderer as evalReport } from './eval-report.js';
import { renderer as evalRenderer } from './eval.js';
import { renderer as status } from './status.js';
import { renderer as update } from './update.js';
import { renderer as sync } from './sync.js';

export const VERB_RENDERERS: Record<string, Renderer> = { ls, search, 'eval-report': evalReport, eval: evalRenderer, status, update, sync };
