import React, { useState } from 'react';
import type { CartLine, MenuItem } from './lib/types';
import { inr } from './lib/types';
import { LANGS, getLang, setLang, translate, type Lang } from './lib/i18n';

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
      <button aria-label="Decrease quantity" onClick={() => onChange(Math.max(min, qty - 1))}>
        −
      </button>
      <span>{qty}</span>
      <button aria-label="Increase quantity" onClick={() => onChange(qty + 1)}>
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
          Welcome{restaurantName ? ` to ${restaurantName}` : ''} 👋
        </h2>
        <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
          {tableLabel ? `You're at ${tableLabel}. ` : ''}Tell us who's ordering so the
          kitchen knows whose dish is whose and your bill stays yours. No OTP, no account.
        </p>

        <label className="overline" style={{ display: 'block', marginTop: 18 }}>{translate(getLang(), 'gate.name')}</label>
        <input
          style={field} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Aarav" autoComplete="given-name" aria-label="Your name"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <label className="overline" style={{ display: 'block', marginTop: 14 }}>{translate(getLang(), 'gate.phone')}</label>
        <input
          style={field} value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="10-digit mobile" inputMode="numeric" autoComplete="tel"
          aria-label="Mobile number" maxLength={14}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {phone.length > 0 && !validPhone && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 6 }}>
            Enter a valid 10-digit Indian mobile number.
          </p>
        )}

        <button
          className="btn btn-primary btn-block" style={{ marginTop: 18 }}
          disabled={!ok} onClick={submit}
        >
          {translate(getLang(), 'gate.start')} →
        </button>
        <p className="dim" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>
          We use this only to route your order and bill at this restaurant.
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
            <h2 className="display" style={{ fontSize: 24, lineHeight: 1.2 }}>{item.name}</h2>
            {item.description && (
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>{item.description}</p>
            )}
          </div>
          <button className="chip" aria-label="Close" onClick={onClose}>✕</button>
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
                    {o.price_delta > 0 ? `+ ${inr(o.price_delta)}` : 'Free'}
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
            Add {qty} · {inr(unit * qty)}
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
export function LanguagePicker() {
  const [lang, setL] = useState<Lang>(getLang);
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.key === lang) ?? LANGS[0];
  return (
    <span style={{ position: 'relative' }}>
      <button
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        onClick={() => setOpen((o) => !o)}
      >
        {current.native}
      </button>
      {open && (
        <span
          role="listbox"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 40,
            background: 'var(--surface)', border: '1px solid var(--line-strong)',
            borderRadius: 12, padding: 4, minWidth: 128,
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
