import type { Renderer } from '../renderer.js';
import { renderer as ls } from './ls.js';
import { renderer as status } from './status.js';
import { renderer as update } from './update.js';
import { renderer as sync } from './sync.js';
import { renderer as search } from './search.js';
import { renderer as evalReport } from './eval-report.js';
import { renderer as evalRun } from './eval.js';
import { renderer as validate } from './validate.js';
import { renderer as install } from './install.js';
import { renderer as uninstallSkill } from './uninstall-skill.js';
import { renderer as project } from './project.js';

export const VERB_RENDERERS: Record<string, Renderer> = { ls, status, update, sync, search, 'eval-report': evalReport, eval: evalRun, validate, install, 'uninstall-skill': uninstallSkill, 'project list': project, 'project add': project, 'project remove': project };
