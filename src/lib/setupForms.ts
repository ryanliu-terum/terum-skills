import { GITHUB_LOGIN_RULE, type Identity, type IdentityDefaults } from './auth.js';
import type { FormAnswers, FormField, FormTextField } from './prompt.js';
import { emailSchema, githubLoginSchema, HANDLE_RULE, handleSchema, TEAM_NAME_RULE, teamNameSchema } from './schema.js';

/**
 * The three forms `setup` asks (Ryan, 2026-09-19), one per kind of consequence: the team and identity form
 * creates a repository and publishes a roster entry; the invitation form emails other people; the Claude
 * Code form edits this machine's Claude Code settings (src/lib/claudeCode.ts). Each is one screen with one
 * Confirm in the app and the same fields one line at a time in a terminal (prompt.ts askForm). The titles
 * are what a shell keys its step tracking on, so they are constants and change nowhere else.
 */
export const CREATE_FORM_TITLE = 'Create your team';
export const IDENTITY_FORM_TITLE = 'Your identity';
export const INVITE_FORM_TITLE = 'Invite teammates';

/** `<team>-shared-skills` while that fits the name rule (team.ts suggestedRepoName spells the same rule). */
export const REPO_TEMPLATE = '{value}-shared-skills';

export interface IdentityValues { github: string; handle: string; displayName: string; email: string; }

export function identityValues(defaults: IdentityDefaults): IdentityValues {
  return { github: defaults.github, handle: defaults.handle ?? '', displayName: defaults.displayName ?? '', email: defaults.email ?? '' };
}

/**
 * The identity fields every member fills in. The GitHub login is read-only when gh already told us who is
 * signed in: it is identity evidence at join (§5.4) and cannot be typed to something else. The handle note
 * says the one thing a person cannot undo; the email note says where the value goes.
 */
export function identityFields(values: IdentityValues, options: { githubKnown: boolean; fixedHandle?: string }): FormField[] {
  const github: FormTextField = options.githubKnown && values.github !== ''
    ? { id: 'github', kind: 'text', label: 'GitHub login', default: values.github, readOnly: true, note: 'Who gh is signed in as.' }
    : { id: 'github', kind: 'text', label: 'GitHub login', default: values.github, note: 'Optional; enter - if you have none.' };
  const handle: FormTextField = options.fixedHandle === undefined
    ? { id: 'handle', kind: 'text', label: 'Handle', default: values.handle, required: true, note: 'How teammates see you; it cannot be changed once you join.' }
    : { id: 'handle', kind: 'text', label: 'Handle', default: options.fixedHandle, readOnly: true, note: 'Already bound on this machine.' };
  return [
    github,
    handle,
    { id: 'displayName', kind: 'text', label: 'Your name', default: values.displayName, required: true, note: 'Published to the team roster.' },
    { id: 'email', kind: 'text', label: 'Your email', default: values.email, required: true, note: 'Published to the team roster.' },
  ];
}

export interface CreateValues extends IdentityValues { team: string; repo: string; }

/** The creator's form: team and repository first, then the identity fields. */
export function createFields(values: CreateValues, options: { githubKnown: boolean }): FormField[] {
  return [
    { id: 'team', kind: 'text', label: 'Team name', default: values.team, required: true, note: 'Names the team here and in the sidebar.' },
    { id: 'repo', kind: 'text', label: 'GitHub repository name', default: values.repo, required: true, follows: { field: 'team', template: REPO_TEMPLATE }, note: 'A private repository under your account.' },
    ...identityFields(values, options),
  ];
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const text = (answers: FormAnswers, id: string): string => (typeof answers[id] === 'string' ? (answers[id] as string).trim() : '');

/** The identity rules §5.4 already enforces one question at a time, applied to a whole form at once. */
export function validateIdentity(answers: FormAnswers, options: { fixedHandle?: string } = {}): Validated<Identity> {
  const errors: Record<string, string> = {};
  const rawGithub = text(answers, 'github');
  const github = rawGithub === '' || rawGithub === '-' ? '' : rawGithub;
  if (github !== '' && !githubLoginSchema.safeParse(github).success) errors.github = GITHUB_LOGIN_RULE;
  const handleParsed = handleSchema.safeParse(options.fixedHandle ?? text(answers, 'handle'));
  if (!handleParsed.success) errors.handle = HANDLE_RULE;
  const displayName = text(answers, 'displayName');
  if (displayName === '') errors.displayName = 'a name is required';
  const email = text(answers, 'email');
  if (!emailSchema.safeParse(email).success) errors.email = 'enter a valid email address';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { handle: handleParsed.success ? handleParsed.data : '', displayName, email, github } };
}

export interface CreateInput { name: string; repo: string; identity: Identity; }

export function validateCreate(answers: FormAnswers, taken: { teams: readonly string[]; cloneExists: (team: string) => Promise<boolean> }): Promise<Validated<CreateInput>> {
  return (async () => {
    const errors: Record<string, string> = {};
    const nameParsed = teamNameSchema.safeParse(text(answers, 'team'));
    let name = '';
    if (!nameParsed.success) errors.team = TEAM_NAME_RULE;
    else {
      name = nameParsed.data;
      if (taken.teams.includes(name)) errors.team = `team ${name} is already configured on this machine`;
      else if (await taken.cloneExists(name)) errors.team = `a clone for a team named ${name} already exists on this machine`;
    }
    const repoParsed = teamNameSchema.safeParse(text(answers, 'repo'));
    if (!repoParsed.success) errors.repo = TEAM_NAME_RULE;
    const identity = validateIdentity(answers);
    if (!identity.ok) Object.assign(errors, identity.errors);
    if (Object.keys(errors).length > 0 || !identity.ok || !repoParsed.success) return { ok: false, errors };
    return { ok: true, value: { name, repo: repoParsed.data, identity: identity.value } };
  })();
}

/** The values to prefill on a re-ask: what the person typed, not the original defaults. */
export function createValuesFrom(answers: FormAnswers, previous: CreateValues): CreateValues {
  return { team: text(answers, 'team') || previous.team, repo: text(answers, 'repo'), github: text(answers, 'github'), handle: text(answers, 'handle'), displayName: text(answers, 'displayName'), email: text(answers, 'email') };
}
export function identityValuesFrom(answers: FormAnswers): IdentityValues {
  return { github: text(answers, 'github'), handle: text(answers, 'handle'), displayName: text(answers, 'displayName'), email: text(answers, 'email') };
}

/** One text field; blank or Skip leaves nobody invited. The join command travels as the form's detail so the owner can paste it instead. */
export function inviteFields(logins = ''): FormField[] {
  return [{ id: 'logins', kind: 'text', label: 'GitHub logins', default: logins, note: 'Comma or space separated. GitHub emails each invitation; the join command below runs the wizard for them.' }];
}
export function inviteLogins(answers: FormAnswers | null): string[] {
  return answers === null ? [] : text(answers, 'logins').split(/[\s,]+/).filter(Boolean);
}
