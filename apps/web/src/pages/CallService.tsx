/**
 * "Call for service" — the small menu of things a diner can ask for.
 *
 * Deliberately NOT part of the cart. Asking for tissues is not ordering: there
 * is no price, no kitchen ticket and no bill line, and putting it in the cart
 * would mean a diner has to "place an order" to get a napkin. One tap, done.
 *
 * A SHEET, NOT A PAGE. This is a thirty-second interaction from the middle of
 * reading a menu; sending someone to another screen and back for it is the
 * kind of navigation that stops people using a feature at all.
 *
 * THE DEDUPE IS SHOWN, NOT HIDDEN. The server collapses a repeat request for
 * the same thing within ten minutes, and when it does, this says so. A diner
 * who taps twice because nothing visibly happened should be told it is already
 * coming — silently swallowing the second tap is what makes people tap a third
 * time.
 */
import React, { useState } from 'react';
import { requestService, SERVICE_OPTIONS, type ServiceKind } from '../lib/api';
import type { Session } from '../lib/types';

export function CallService({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ServiceKind | null>(null);
  const [said, setSaid] = useState<string>('');

  if (session.demo || !session.table?.id || session.table.is_parcel) return null;

  const ask = async (kind: ServiceKind, label: string) => {
    setBusy(kind);
    setSaid('');
    try {
      const r = await requestService(session, kind);
      setSaid(r.deduped ? `${label} is already on the way.` : `${label} — asked.`);
      // Long enough to read, short enough that the sheet is not left open on a
      // table for the next person to find.
      setTimeout(() => { setOpen(false); setSaid(''); }, 1600);
    } catch {
      setSaid('Could not reach the counter. Please wave someone down.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        className="chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Ask staff for something"
      >
        🙋 Call for service
      </button>

      {open && (
        <div
          className="sheet-scrim"
          role="dialog"
          aria-label="Call for service"
          onClick={() => setOpen(false)}
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber" />
            <p className="overline" style={{ marginBottom: 8 }}>Ask for</p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SERVICE_OPTIONS.map((o) => (
                <button
                  key={o.kind}
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => ask(o.kind, o.label)}
                  style={{ minHeight: 44 }}
                >
                  <span aria-hidden>{o.icon}</span> {o.label}
                </button>
              ))}
            </div>

            {said && (
              <p className="dim" style={{ fontSize: 13.5, marginTop: 12 }} role="status">
                {said}
              </p>
            )}

            <button className="chip" style={{ marginTop: 14 }} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
