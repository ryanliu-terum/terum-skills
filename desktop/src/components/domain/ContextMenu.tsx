import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { Menu as Base } from '@base-ui/react/menu';
import { useCapabilities } from '../../backend';
import { Icon } from '../ui/Icon';
import { RegistryContext, findRegistered, hasLiveSelection, suppressesNativeMenu, useCopy } from './context-menu';
import type { ContextMenuBuilder, ContextMenuItem, Registry } from './context-menu';

interface OpenMenu { x: number; y: number; items: ContextMenuItem[] }
interface Toast { text: string; error: boolean }
const TOAST_MS = 1600, TOAST_ERROR_MS = 4000;

/**
 * App-wide right-click menus and the "Copied" toast. Targets register through `useContextMenu`; one document
 * listener resolves the click to the nearest registered ancestor and opens a Base UI menu anchored at the
 * pointer. Keyboard invocation (Shift+F10, the Menu key) lands at the target's own corner. Nothing here
 * changes a board's pixels: the popup is portalled and the toast is transient.
 */
export function ContextMenuProvider({ children }: PropsWithChildren) {
  const capabilities = useCapabilities();
  const [registry] = useState(() => new Map<Element, ContextMenuBuilder>());
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((next: Toast) => {
    setToast(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), next.error ? TOAST_ERROR_MS : TOAST_MS);
  }, []);
  const api = useMemo<Registry>(() => ({
    register(element, build) { registry.set(element, build); return () => { registry.delete(element); }; },
    toast: show,
  }), [registry, show]);
  const chrome = capabilities?.windowChrome;
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const hit = findRegistered(event.target, registry);
      if (!hit) { if (suppressesNativeMenu(event.target, chrome, hasLiveSelection())) event.preventDefault(); return; }
      // A field inside a registered target (the Add-a-project row) keeps its own menu.
      if (event.target instanceof Element && event.target.closest('input,textarea,select')) return;
      const items = hit.build();
      if (items.length === 0) return;
      event.preventDefault();
      // Shift+F10 / the Menu key report (0,0): anchor at the target instead of the window corner.
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const rect = hit.element.getBoundingClientRect();
      setOpen({ x: keyboard ? rect.left + 8 : event.clientX, y: keyboard ? rect.top + 8 : event.clientY, items });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [registry, chrome]);
  const anchor = useMemo(() => open ? { getBoundingClientRect: () => new DOMRect(open.x, open.y, 0, 0) } : null, [open]);
  return <RegistryContext value={api}>
    {children}
    <Base.Root open={open !== null} onOpenChange={next => { if (!next) setOpen(null); }} modal={false}>
      <Base.Portal><Base.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2}><Base.Popup className="floating-panel context-menu" aria-label="Context menu">
        {open?.items.map(item => item.kind === 'separator'
          ? <Base.Separator key={item.key} className="menu-separator" />
          : <Base.Item key={item.key} className="menu-item" disabled={item.disabled ?? false} data-danger={item.danger ? '' : undefined} title={item.reason ?? undefined} onClick={() => { if (!item.disabled) item.onSelect(); }}>
              {item.icon ? <Icon name={item.icon} size={14} stroke="1.75" /> : null}{item.label}{item.reason ? <span className="menu-item-reason">{item.reason}</span> : null}
            </Base.Item>)}
      </Base.Popup></Base.Positioner></Base.Portal>
    </Base.Root>
    {toast ? <div role={toast.error ? 'alert' : 'status'} className="copy-toast">{toast.text}</div> : null}
  </RegistryContext>;
}

/**
 * A value the user can copy with one click: renders the children exactly as the wrapped text would (the button is
 * inline and inherits every font metric) and copies `text` (default: the children's text) on click or Enter.
 */
export function CopyValue({ text, what, children, className, style }: { text?: string; what: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const copy = useCopy();
  const ref = useRef<HTMLSpanElement | null>(null);
  const run = () => void copy(text ?? ref.current?.textContent ?? '', what);
  // A span, not a <button>: the rows it sits in style their value through `span` selectors (`.detail-row>span`), so a
  // different element would lose those pixels. The role and the key handler give it the button's semantics.
  return <span ref={ref} role="button" tabIndex={0} className={'copy-value' + (className ? ' ' + className : '')} style={style} title="Click to copy" onClick={run} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(); } }}>{children}</span>;
}
