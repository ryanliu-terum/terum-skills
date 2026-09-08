import { createContext, useContext, useRef } from 'react';
import type { ComponentProps, CSSProperties, PropsWithChildren } from 'react';
import { Dialog as Base } from '@base-ui/react/dialog';

const ContainerContext = createContext<HTMLElement | null | undefined>(undefined);

export function DialogContainer({ container, children }: PropsWithChildren<{ container: HTMLElement | null }>) {
  return <ContainerContext value={container}>{children}</ContainerContext>;
}

const overlayStyle: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'var(--tk-scrim)',
};
const popupStyle: CSSProperties = {
  position: 'relative', top: 'auto', left: 'auto', transform: 'none',
};

function tabStops(popup: HTMLElement): HTMLElement[] {
  return Array.from(popup.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable="true"], audio[controls], video[controls]',
  )).filter(element => {
    if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert]')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (ancestor === popup) break;
    }
    return true;
  }).sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

export function Dialog(props:ComponentProps<typeof Base.Root>){return <Base.Root {...props} modal={false}/>;}
export function DialogTrigger(props:ComponentProps<typeof Base.Trigger>){return <Base.Trigger {...props}/>;}
export function DialogPopup({ onKeyDown, style, ref, ...props }: ComponentProps<typeof Base.Popup>) {
  const container = useContext(ContainerContext);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // A Shell container must commit before Portal mounts; null must never fall back to body.
  if (container === null) return null;
  return <Base.Portal container={container}>
    <div style={overlayStyle}>
      <Base.Backdrop className="dialog-backdrop" style={{ position: 'absolute', inset: 0, background: 'transparent' }} />
      <Base.Popup {...props} ref={element => {
        popupRef.current = element;
        if (typeof ref === 'function') return ref(element);
        if (ref) ref.current = element;
      }} className="dialog-popup" role="dialog" aria-modal="true"
        style={state => ({ ...(typeof style === 'function' ? style(state) : style), ...popupStyle })}
        // Ignore caller-supplied initialFocus so opening always focuses the popup without a control ring.
        initialFocus={() => popupRef.current ?? false}
        onKeyDown={event => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== 'Tab') return;
          const popup = event.currentTarget;
          const stops = tabStops(popup);
          const first = stops[0];
          const last = stops.at(-1);
          const active = popup.ownerDocument.activeElement;
          if (!first || !last) {
            event.preventDefault();
            popup.focus();
          } else if (event.shiftKey && (active === first || active === popup)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || active === popup)) {
            event.preventDefault();
            first.focus();
          }
        }} />
    </div>
  </Base.Portal>;
}
export function DialogTitle(props:ComponentProps<typeof Base.Title>){return <Base.Title {...props} className="dialog-title"/>;}
export function DialogDescription(props:ComponentProps<typeof Base.Description>){return <Base.Description {...props} className="dialog-description"/>;}
export function DialogClose(props:ComponentProps<typeof Base.Close>){return <Base.Close {...props} className="button" data-kind="secondary"/>;}
