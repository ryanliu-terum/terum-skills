import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';

export const VERB_RENDERERS: Record<string, Renderer> = { ls };
