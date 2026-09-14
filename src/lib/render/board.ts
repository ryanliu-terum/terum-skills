/**
 * The board model (spec §3): a renderer turns a verb's `value` into this data, a backend turns it
 * into text. Neither side reads disk, env or clock — everything arrives in `value` and `ctx` — so a
 * board is pure and snapshot-testable. Every constructor is null-safe: a missing limb is a `—`
 * cell, never a throw (spec §12).
 */
import type { InvocationForm } from '../invocation.js';
import { applyRowCap, type Verdict } from './policies.js';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info' | 'pending';

export type Cell =
  | { kind: 'text'; text: string }
  | { kind: 'count'; n: number | null }
  | { kind: 'verdict'; verdict: Verdict | null; lift: number | null; partial: [number, number] | null; stale: boolean; from: string | null; invalid: boolean }
  | { kind: 'status'; tone: Tone; text: string }
  | { kind: 'date'; iso: string | null }
  | { kind: 'path'; path: string }
  | { kind: 'code'; text: string }
  | { kind: 'bar'; fraction: number | null; label: string }
  | { kind: 'strip'; text: string };

/** Priority 1 is never dropped; 3 drops first when a pretty table exceeds the width. */
export interface Column { key: string; label: string; align?: 'left' | 'right'; priority: 1 | 2 | 3; max?: number }
export interface Table { kind: 'table'; title?: string; columns: Column[]; rows: Record<string, Cell>[]; more?: { count: number } }
export interface KV { kind: 'kv'; title?: string; rows: [string, Cell][] }
export interface TextBlock { kind: 'text'; title?: string; lines: string[]; fenced?: 'md' | 'text' }
export interface Bars { kind: 'bars'; title?: string; rows: { label: string; fraction: number | null; value: string }[] }
export type Section = Table | KV | TextBlock | Bars;

/** A next step: a named skill (`/skill-info x`, `$skill-info x`) or a verb (`/terum-skills install x`); `raw` is a command that is not a terum-skills verb. */
export type NextItem = { label: string; skill?: string; verb: string; args: string[] } | { label: string; raw: string };
export interface Failure { error: string; refused?: true; declined?: true; partial?: true }

export interface Board { title: string; headline?: string; resolved: string[]; sections: Section[]; notes: string[]; next: NextItem[]; failure?: Failure }

export type RenderFormat = 'md' | 'pretty' | 'json';
export type Host = 'claude' | 'codex' | 'terminal';
export interface RenderContext {
  format: RenderFormat; host: Host; rows: number | 'all'; width: number; color: boolean;
  form: InvocationForm | undefined; home: string;
  /** Epoch milliseconds; the only clock a renderer may read. */
  now: number;
  /** The verb's own argv (after the bin), e.g. `['search', 'deploy', '--category', 'ops']`, and the same joined for the `--rows all` footer. */
  argv: readonly string[]; command: string;
}

const dash = (): Cell => ({ kind: 'text', text: '—' });
const empty = (value: unknown): boolean => value === null || value === undefined || value === '';

export function text(value: unknown): Cell { return empty(value) ? dash() : { kind: 'text', text: String(value) }; }
export function count(value: unknown): Cell { return { kind: 'count', n: typeof value === 'number' && Number.isFinite(value) ? value : null }; }
export function status(tone: Tone, label: unknown): Cell { return { kind: 'status', tone, text: empty(label) ? '—' : String(label) }; }
export function date(iso: unknown): Cell { return { kind: 'date', iso: typeof iso === 'string' && iso !== '' ? iso : null }; }
export function path(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'path', path: value } : dash(); }
export function code(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'code', text: value } : dash(); }
export function strip(value: unknown): Cell { return typeof value === 'string' && value !== '' ? { kind: 'strip', text: value } : dash(); }
export function bar(fraction: unknown, label: unknown): Cell {
  const clamped = typeof fraction === 'number' && Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : null;
  return { kind: 'bar', fraction: clamped, label: empty(label) ? '' : String(label) };
}
export function verdict(input: { verdict?: unknown; lift?: number | null; partial?: [number, number] | null; stale?: boolean; from?: string | null; invalid?: boolean }): Cell {
  const banded = input.verdict === 'PASS' || input.verdict === 'NEUTRAL' || input.verdict === 'FAIL' ? input.verdict : null;
  return { kind: 'verdict', verdict: banded, lift: input.lift ?? null, partial: input.partial ?? null, stale: input.stale === true, from: input.from ?? null, invalid: input.invalid === true };
}

export function board(title: string, partial: Partial<Omit<Board, 'title'>> = {}): Board { return { title, resolved: [], sections: [], notes: [], next: [], ...partial }; }
export function table(columns: Column[], rows: Record<string, Cell>[], options: { title?: string; cap?: number | 'all' } = {}): Table {
  const capped = applyRowCap(rows, options.cap ?? 'all');
  return { kind: 'table', ...(options.title === undefined ? {} : { title: options.title }), columns, rows: capped.rows, ...(capped.more > 0 ? { more: { count: capped.more } } : {}) };
}
export function kv(rows: [string, Cell][], title?: string): KV { return { kind: 'kv', ...(title === undefined ? {} : { title }), rows }; }
export function textBlock(lines: string[], options: { title?: string; fenced?: 'md' | 'text' } = {}): TextBlock { return { kind: 'text', ...(options.title === undefined ? {} : { title: options.title }), lines, ...(options.fenced === undefined ? {} : { fenced: options.fenced }) }; }
export function bars(rows: Bars['rows'], title?: string): Bars { return { kind: 'bars', ...(title === undefined ? {} : { title }), rows }; }
