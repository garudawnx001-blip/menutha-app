/** Console UI primitives: toasts, modal, the shared console context. */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AdminOverview, ConsoleApi } from './adminApi';
import { Icon } from './icons';

// ── Console context: data + api + refresh, shared by every page ────────────

export interface ConsoleCtx {
  email: string;
  data: AdminOverview | null;
  refreshing: boolean;
  loadError: string;
  refresh: () => Promise<void>;
  api: ConsoleApi;
  mocked: boolean;
  /** Opens a restaurant's detail panel from anywhere. */
  openRestaurant: (id: string) => void;
  openCreate: () => void;
  signOut: () => void;
  /** Called when an action finds we are no longer an admin. */
  lostAccess: () => void;
}
export const Ctx = createContext<ConsoleCtx | null>(null);
export const useConsole = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConsole outside the console');
  return c;
};

// ── Toasts ─────────────────────────────────────────────────────────────────

type Toast = { id: number; tone: 'ok' | 'bad'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++seq.current;
    setList((l) => [...l.slice(-2), { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="mc-toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`mc-toast mc-toast-${t.tone}`} role={t.tone === 'bad' ? 'alert' : 'status'}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={18} />
            <span>{t.text}</span>
            <button className="mc-toast-x" aria-label="Dismiss" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export function Modal({ title, icon, tone, onClose, children, footer, wide, dismissable = true }: {
  title: string; icon?: string; tone?: 'danger' | 'gold' | 'green';
  onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
  /** False for the password reveal: Esc / backdrop must not lose it. */
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, button.mc-btn-primary, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Always swallow Esc so the drawer underneath cannot close (and take a
      // one-time password with it); only a dismissable modal closes on it.
      if (e.key === 'Escape') { e.stopImmediatePropagation(); if (dismissable) onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'))
          .filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [dismissable, onClose]);

  return (
    <div className="mc-modal-layer" role="presentation">
      <div className="mc-scrim" onClick={dismissable ? onClose : undefined} />
      <div ref={ref} className={`mc-modal${wide ? ' mc-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mc-modal-head">
          {icon && <span className={`mc-modal-icon${tone ? ` mc-modal-icon-${tone}` : ''}`}><Icon name={icon} size={22} /></span>}
          <h2 className="mc-display">{title}</h2>
          {dismissable && (
            <button className="mc-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          )}
        </header>
        <div className="mc-modal-body">{children}</div>
        {footer && <footer className="mc-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Button that shows a spinner while its promise runs. */
export function BusyButton({ busy, children, className = 'mc-btn mc-btn-primary', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} className={className} disabled={busy || rest.disabled} aria-busy={busy}>
      {busy && <span className="mc-spinner mc-spinner-sm" aria-hidden />}
      {children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copy', big }: { text: string; label?: string; big?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={big ? 'mc-btn mc-btn-ghost' : 'mc-copy'}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* blocked */ }
      }}
    >
      {big && <Icon name="copy" size={16} />}{done ? 'Copied ✓' : label}
    </button>
  );
}
