/**
 * Messages from Menutha set in /admin/settings: the maintenance notice and
 * announcement banners, at the top of every portal page. A banner can be
 * hidden with "Hide"; it comes back only if the admin edits it.
 *
 * HelpLine: the help contacts, as a quiet line at the bottom of the portal.
 */
import React, { useState } from 'react';
import { usePlatformNotices, type PlatformNotices as Notices } from '../../lib/appConfig';

const TONE: Record<string, { bg: string; fg: string; line: string }> = {
  info: { bg: '#e6eef9', fg: '#234a8a', line: '#c9d8f0' },
  success: { bg: '#e3f1e8', fg: '#1f6a43', line: '#c4e2cf' },
  warning: { bg: '#fbefd9', fg: '#7d4d0b', line: '#efd7a8' },
  danger: { bg: '#f9e3df', fg: '#9c2e21', line: '#f0c9c1' },
};
const KEY = 'menutha-hidden-banners';

function readHidden(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function PlatformNotices({ notices }: { notices: Notices }) {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const hide = (key: string) => {
    const next = [...hidden.filter((k) => k !== key), key].slice(-50);
    setHidden(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: hidden for this visit only */ }
  };
  const banners = notices.banners.filter((b) => !hidden.includes(`${b.id}@${b.updated_at}`));
  if (!notices.maintenance && !banners.length) return null;
  const strip = (t: { bg: string; fg: string; line: string }): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', margin: '10px 0',
    borderRadius: 12, background: t.bg, color: t.fg, border: `1px solid ${t.line}`, fontSize: 14, fontWeight: 600,
  });
  return (
    <div role="status" aria-live="polite">
      {notices.maintenance && (
        <div style={strip(TONE.warning)}><span aria-hidden>🛠️</span><span style={{ flex: 1 }}>{notices.maintenance.message}</span></div>
      )}
      {banners.map((b) => {
        const t = TONE[b.tone] ?? TONE.info;
        return (
          <div key={b.id} style={strip(t)}>
            <span aria-hidden>📣</span>
            <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{b.text}</span>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: t.fg, minHeight: 0, padding: '2px 8px' }}
              onClick={() => hide(`${b.id}@${b.updated_at}`)}>Hide</button>
          </div>
        );
      })}
    </div>
  );
}

export function HelpLine({ notices }: { notices: Notices }) {
  const s = notices.support;
  const digits = (p: string) => p.replace(/[^0-9+]/g, '');
  const items: React.ReactNode[] = [];
  if (s.phone && digits(s.phone).length >= 6) items.push(<a key="p" href={`tel:${digits(s.phone)}`}>Call {s.phone}</a>);
  if (s.whatsapp && digits(s.whatsapp).length >= 6) {
    items.push(<a key="w" href={`https://wa.me/${digits(s.whatsapp).replace('+', '')}`} target="_blank" rel="noreferrer">WhatsApp {s.whatsapp}</a>);
  }
  if (s.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) items.push(<a key="e" href={`mailto:${s.email}`}>{s.email}</a>);
  if (!items.length) return null;
  return (
    <p className="dim" style={{ fontSize: 12.5, margin: '28px 0 8px', textAlign: 'center' }}>
      Need help from Menutha?{' '}
      {items.map((x, i) => <React.Fragment key={i}>{i > 0 && ' · '}{x}</React.Fragment>)}
    </p>
  );
}

export { usePlatformNotices };
