import React, { useEffect, useRef, useState } from 'react';
import type { CartLine, MenuItem } from './lib/types';
import { inr } from './lib/types';
import { LANGS, getLang, setLang, translate, type Lang } from './lib/i18n';
import { dishName } from './lib/translit';

export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      className={veg ? 'veg-mark' : 'veg-mark nonveg'}
      role="img"
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    />
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  const mark = Math.round(size * 1.2);
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <img className="brand-mark" src="/menutha-mark.svg" alt="" width={mark} height={mark} />
      <span><em>menu</em>tha</span>
    </span>
  );
}

export function Stepper({
  qty,
  onChange,
  min = 0,
}: {
  qty: number;
  onChange: (q: number) => void;
  min?: number;
}) {
  return (
    <span className="stepper">
      <button aria-label={translate(getLang(), 'common.decreaseQty')} onClick={() => onChange(Math.max(min, qty - 1))}>
        −
      </button>
      <span>{qty}</span>
      <button aria-label={translate(getLang(), 'common.increaseQty')} onClick={() => onChange(qty + 1)}>
        +
      </button>
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-fill">
      <div className="spinner" />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}

/** First-open identity gate — name + phone, no OTP, no account. Tags every
 *  order the diner places so the kitchen and the table bill stay attributed. */
export function IdentityGate({
  restaurantName,
  tableLabel,
  onSubmit,
}: {
  restaurantName?: string;
  tableLabel?: string;
  onSubmit: (g: { name: string; phone: string }) => void;
}) {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const digits = phone.replace(/\D/g, '');
  const validPhone = /^[6-9]\d{9}$/.test(digits);
  const validName = name.trim().length >= 2;
  const ok = validName && validPhone;
  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '12px 14px',
    borderRadius: 12, border: '1px solid var(--line-strong, #e7decc)',
    background: 'var(--surface, #fffdf8)', color: 'var(--ink)', fontSize: 16,
    fontFamily: 'inherit', outline: 'none',
  };
  const submit = () => ok && onSubmit({ name: name.trim(), phone: digits });
  return (
    <div className="modal-scrim">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="live-dot" aria-hidden style={{ marginBottom: 10 }} />
        <h2 className="display" style={{ fontSize: 25, lineHeight: 1.2 }}>
          {translate(getLang(), 'gate.welcome')}{restaurantName ? ` ${restaurantName}` : ''} 👋
        </h2>
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          {tableLabel ? `${translate(getLang(), 'gate.youreAt')} ${tableLabel}. ` : ''}
          {translate(getLang(), 'gate.why')}
        </p>

        <label className="overline" style={{ display: 'block', marginTop: 18 }}>{translate(getLang(), 'gate.name')}</label>
        <input
          style={field} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={translate(getLang(), 'gate.namePlaceholder')} autoComplete="given-name"
          aria-label={translate(getLang(), 'gate.name')}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <label className="overline" style={{ display: 'block', marginTop: 14 }}>{translate(getLang(), 'gate.phone')}</label>
        <input
          style={field} value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder={translate(getLang(), 'gate.phonePlaceholder')} inputMode="numeric" autoComplete="tel"
          aria-label={translate(getLang(), 'gate.phone')} maxLength={14}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {phone.length > 0 && !validPhone && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 6 }}>
            {translate(getLang(), 'gate.phoneInvalid')}
          </p>
        )}

        <button
          className="btn btn-primary btn-block" style={{ marginTop: 18 }}
          disabled={!ok} onClick={submit}
        >
          {translate(getLang(), 'gate.start')} →
        </button>
        <p className="dim" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>
          {translate(getLang(), 'gate.privacy')}
        </p>
      </div>
    </div>
  );
}

/** Item detail sheet: option groups (one choice per group), add-ons stack. */
export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [qty, setQty] = React.useState(1);
  const [picked, setPicked] = React.useState<Record<string, string>>({});

  const groups = React.useMemo(() => {
    const g = new Map<string, MenuItem['options']>();
    for (const o of item.options) {
      if (!g.has(o.name)) g.set(o.name, []);
      g.get(o.name)!.push(o);
    }
    return [...g.entries()];
  }, [item]);

  const chosen = item.options.filter((o) => picked[o.name] === o.id);
  const optionDelta = chosen.reduce((a, o) => a + o.price_delta, 0);
  const unit = item.price + optionDelta;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <VegMark veg={item.is_veg} />
          <div style={{ flex: 1 }}>
            <h2 className="display" style={{ fontSize: 24, lineHeight: 1.2 }}>{dishName(item, getLang())}</h2>
            {item.description && (
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>{item.description}</p>
            )}
          </div>
          <button className="chip" aria-label={translate(getLang(), 'sheet.close')} onClick={onClose}>✕</button>
        </div>

        {groups.map(([name, opts]) => (
          <div key={name} style={{ marginTop: 18 }}>
            <p className="overline" style={{ marginBottom: 8 }}>{name}</p>
            {opts.map((o) => {
              const active = picked[name] === o.id;
              return (
                <button
                  key={o.id}
                  className={active ? 'opt-row active' : 'opt-row'}
                  onClick={() =>
                    setPicked((p) => ({ ...p, [name]: active ? '' : o.id }))
                  }
                >
                  <span style={{ fontWeight: 600, fontSize: 14.5 }}>{o.choice}</span>
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    {o.price_delta > 0 ? `+ ${inr(o.price_delta)}` : translate(getLang(), 'sheet.free')}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 22,
            gap: 14,
          }}
        >
          <Stepper qty={qty} onChange={(q) => setQty(Math.max(1, q))} min={1} />
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              onAdd({
                menuItemId: item.id,
                name: item.name,
                price: item.price,
                qty,
                isVeg: item.is_veg,
                optionIds: chosen.map((o) => o.id),
                optionLabels: chosen.map((o) => o.choice),
                optionDelta,
              });
              onClose();
            }}
          >
            {translate(getLang(), 'menu.add')} {qty} · {inr(unit * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Language switch for diners. Sits in the menu's top bar, shows each language
 *  in its own script (a Kannada speaker looks for "ಕನ್ನಡ", not "Kannada"), and
 *  persists the choice. Only the app's own wording changes — dish names are
 *  the restaurant's data. */
const MENU_W = 148;

export function LanguagePicker() {
  const [lang, setL] = useState<Lang>(getLang);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The listbox, so the outside-click handler can tell a selection from a
  // dismissal. See the note in  below.
  const menuRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const current = LANGS.find((l) => l.key === lang) ?? LANGS[0];

  /* The menu used to be absolutely positioned at `right: 0`, which silently
     assumed the button sits near the right edge of the screen. It does not: on
     a phone the header's action group wraps onto its own line and the language
     chip lands at the far LEFT. Measured on the live site at 375px, the button
     was at x=16 and the menu opened from -36 to 92 — every option cut off, so
     "English ✓" read as "glish ✓", exactly what the client photographed.

     Anchoring to a fixed side cannot be right for both cases, so we measure
     instead: place the menu under the button, then clamp it into the viewport.
     Fixed positioning also frees it from any scrolling or clipping ancestor. */
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const pad = 8;
    const left = Math.min(
      Math.max(pad, b.right - MENU_W),          // prefer right-aligned to the chip
      Math.max(pad, window.innerWidth - MENU_W - pad), // but never past the right edge
    );
    setPos({ top: b.bottom + 6, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    /**
     * THE MENU COUNTS AS "INSIDE" TOO -- and this is why the switcher did
     * nothing.
     *
     * This checked only `btnRef`, which is the TRIGGER button. The listbox is
     * rendered as a fixed-position sibling, not a child of it, so a tap on a
     * language option looked like an outside click. mousedown fired first,
     * setOpen(false) unmounted the listbox, and the click event that would
     * have called setLang never reached anything. The menu opened, and every
     * tap inside it simply dismissed it.
     *
     * Reported as "tapping Kannada does not change the language" -- which was
     * exactly true, and had nothing to do with the translations.
     */
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Reposition rather than drift: the header is not fixed, so the button moves.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={translate(getLang(), 'common.changeLanguage')}
        onClick={() => setOpen((o) => !o)}
      >
        {current.native}
      </button>
      {open && pos && (
        <span
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 60,
            background: 'var(--surface)', border: '1px solid var(--line-strong)',
            borderRadius: 12, padding: 4, width: MENU_W,
            boxShadow: '0 12px 30px rgba(0,0,0,0.14)', display: 'block',
          }}
        >
          {LANGS.map((l) => (
            <button
              key={l.key}
              role="option"
              aria-selected={l.key === lang}
              className="chip"
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, marginBottom: 2 }}
              onClick={() => { setLang(l.key); setL(l.key); setOpen(false); }}
            >
              {l.native}
              {l.key === lang ? ' ✓' : ''}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

