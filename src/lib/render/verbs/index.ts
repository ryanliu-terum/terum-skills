import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';
import { renderer as status } from './status.js';
import { renderer as update } from './update.js';
import { renderer as sync } from './sync.js';

export const VERB_RENDERERS: Record<string, Renderer> = { ls, status, update, sync };
