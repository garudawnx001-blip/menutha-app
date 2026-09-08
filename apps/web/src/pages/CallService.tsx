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
import { useT } from '../lib/i18n';

/**
 * Whether this session can ask for anything at all.
 *
 * EXPORTED because the trigger no longer lives in this file. The chip moved
 * into the menu's filter row, where he marked it, so the menu has to answer the
 * same question before it draws a chip -- and a second copy of the rule in
 * another file is how the button and the sheet end up disagreeing about
 * whether a takeaway diner can ask for cutlery.
 */
export function canCallService(session: Session): boolean {
  return !session.demo && !!session.table?.id && !session.table.is_parcel;
}

/**
 * The sheet. CONTROLLED from outside now: the caller owns `open`, because the
 * caller owns the chip that opens it.
 */
export function CallService({ session, open, onClose }: {
  session: Session;
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<ServiceKind | null>(null);
  const [said, setSaid] = useState<string>('');
  const t = useT();

  if (!canCallService(session)) return null;
  const setOpen = (v: boolean) => { if (!v) onClose(); };

  /** "Language for this options also" — this sheet was the last English-only
   *  surface a diner could reach. The option labels are looked up by KIND
   *  rather than translated from their English text, so the label a diner reads
   *  and the value the staff feed stores stay independent: the ticket that
   *  reaches the counter is unchanged. */
  const nameOf = (kind: ServiceKind) => t(`svc.${kind}`);

  const ask = async (kind: ServiceKind) => {
    const label = nameOf(kind);
    setBusy(kind);
    setSaid('');
    try {
      const r = await requestService(session, kind);
      setSaid((r.deduped ? t('svc.onWay') : t('svc.asked')).replace('{item}', label));
      // Long enough to read, short enough that the sheet is not left open on a
      // table for the next person to find.
      setTimeout(() => { setOpen(false); setSaid(''); }, 1600);
    } catch {
      setSaid(t('svc.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* NO TRIGGER HERE ANY MORE. The chip that opens this used to sit on its
          own line under the table summary, and he crossed it out there and
          drew it into the filter row instead. Menu.tsx renders it now; this
          file is the sheet and the request, which is all it should ever have
          been. */}
      {open && (
        <div
          className="sheet-scrim"
          role="dialog"
          aria-label={t('svc.open')}
          onClick={() => setOpen(false)}
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber" />
            <p className="overline" style={{ marginBottom: 8 }}>{t('svc.title')}</p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SERVICE_OPTIONS.map((o) => (
                <button
                  key={o.kind}
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => ask(o.kind)}
                  style={{ minHeight: 44 }}
                >
                  <span aria-hidden>{o.icon}</span> {nameOf(o.kind)}
                </button>
              ))}
            </div>

            {said && (
              <p className="dim" style={{ fontSize: 13.5, marginTop: 12 }} role="status">
                {said}
              </p>
            )}

            <button className="chip" style={{ marginTop: 14 }} onClick={() => setOpen(false)}>
              {t('svc.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
