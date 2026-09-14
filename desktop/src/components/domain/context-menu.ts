import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useBackend, useHostStatus } from '../../backend';
import type { Capabilities } from '../../backend/types';
import type { IconName } from '../ui/icon-paths';
import { revealLabel } from '../../lib/platform-labels';

/** One row of a right-click menu. A disabled row carries the reason it cannot run, the way the card's ⋯ menu does. */
export type ContextMenuItem =
  | { kind?: 'item'; key: string; label: string; icon?: IconName; onSelect: () => void; disabled?: boolean; reason?: string | null; danger?: boolean }
  | { kind: 'separator'; key: string };
export type ContextMenuBuilder = () => ContextMenuItem[];

export interface Registry {
  register(element: Element, build: ContextMenuBuilder): () => void;
  toast(next: { text: string; error: boolean }): void;
}
export const RegistryContext = createContext<Registry | null>(null);

/**
 * Whether the host's own right-click menu should be swallowed for an event that hit no registered target.
 * Text fields and a live selection keep the native menu (cut, copy, paste, spelling); everything else in the
 * Tauri shell shows nothing rather than the webview's Back/Reload/Save-as list. The browser mock (`cosmetic`)
 * keeps the browser's menu so dev tools stay one click away.
 */
export function suppressesNativeMenu(target: EventTarget | null, chrome: Capabilities['windowChrome'] | undefined, hasSelection: boolean): boolean {
  if (chrome === 'cosmetic' || chrome === undefined) return false;
  if (hasSelection) return false;
  if (!(target instanceof Element)) return true;
  if (target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
  return true;
}

/** Walks up from the event target to the nearest element that registered a menu. */
export function findRegistered(start: EventTarget | null, registry: Map<Element, ContextMenuBuilder>): { element: Element; build: ContextMenuBuilder } | null {
  let node: Element | null = start instanceof Element ? start : start instanceof Node ? start.parentElement : null;
  while (node) { const build = registry.get(node); if (build) return { element: node, build }; node = node.parentElement; }
  return null;
}

export function hasLiveSelection(): boolean {
  const selection = typeof getSelection === 'function' ? getSelection() : null;
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
}

/**
 * Without a provider (a component rendered on its own in a test) targets register nothing and a copy goes
 * straight to the seam with no toast, so a primitive that offers a menu stays renderable anywhere.
 */
function useRegistry(): Registry {
  const registry = useContext(RegistryContext);
  return useMemo<Registry>(() => registry ?? { register() { return () => {}; }, toast() {} }, [registry]);
}

/**
 * Gives an element a right-click menu. Returns a ref callback to put on the element; `build` runs at click time,
 * so it may read the latest props. Pass `null` to register nothing (a card with no actions).
 */
export function useContextMenu(build: ContextMenuBuilder | null): (element: Element | null) => (() => void) | undefined {
  const registry = useRegistry();
  const latest = useRef(build); useEffect(() => { latest.current = build; });
  // Always register: a builder that arrives after mount (status landing, a row gaining a path) must still
  // reach the element, and the ref callback's identity never changes. A null builder yields no rows, which the
  // provider treats as "no menu here".
  return useCallback((element: Element | null) => {
    if (!element) return undefined;
    return registry.register(element, () => latest.current?.() ?? []);
  }, [registry]);
}

/**
 * A menu for every row of a mapped list without a component per row: the returned factory takes the row's
 * value and yields the ref callback for that row's element, so a list can write `ref={menuFor(item)}`.
 */
export function useContextMenuFor<T>(build: (value: T) => ContextMenuItem[]): (value: T) => (element: Element | null) => (() => void) | undefined {
  const registry = useRegistry();
  const latest = useRef(build); useEffect(() => { latest.current = build; });
  return useCallback((value: T) => (element: Element | null) => {
    if (!element) return undefined;
    return registry.register(element, () => latest.current(value));
  }, [registry]);
}

/**
 * The host's file-browser verb for a component that does not hold `status` itself; until the answer lands it is
 * the drawn wording.
 */
export function useHostReveal(): string {
  // Its own key rather than the Shell's `['status', mock]`: this hook also serves hosts rendered outside the
  // router (the removal dialog), where the URL state is not available. `affects()` still invalidates it by prefix.
  const status = useHostStatus();
  return revealLabel(status?.ok ? status.value.machine.os : undefined);
}

/** The app-wide clipboard: writes through the seam and reports "Copied <what>" or the seam's error in the toast. */
export function useCopy(): (text: string, what: string) => Promise<void> {
  const backend = useBackend(), { toast } = useRegistry();
  return useCallback(async (text: string, what: string) => {
    try {
      const result = await backend.copyToClipboard(text);
      toast(result.ok ? { text: `Copied ${what}`, error: false } : { text: result.error, error: true });
    } catch (error) { toast({ text: error instanceof Error ? error.message : 'Clipboard unavailable.', error: true }); }
  }, [backend, toast]);
}


/**
 * A right-click menu with one row, "Copy <what>", for a block of text the user may want to take elsewhere — a
 * log pane, an error line, an advice paragraph (UI policy §1: anything the app prints is copyable). `text`
 * is read at click time so a streaming pane copies what is on screen then.
 */
export function useCopyMenu(text: () => string, what: string): (element: Element | null) => (() => void) | undefined {
  const copy = useCopy();
  return useContextMenu(() => [{ key: 'copy', label: `Copy ${what}`, icon: 'copy', onSelect: () => void copy(text(), what) }]);
}
