import React from 'react';
import type { CartLine, MenuItem } from './lib/types';
import { inr } from './lib/types';

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
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <em>menu</em>tha
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
