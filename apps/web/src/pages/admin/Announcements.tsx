/**
 * What has been told to restaurants, and whether it arrived — plus the strip
 * at the top of Plans and Offers saying whether Razorpay and email are ready.
 *
 * Email is the part most likely to be "waiting": while menutha.com is not a
 * verified Resend domain every email is held as `pending_domain` and retried
 * every 30 minutes, so the row says that plainly instead of "failed".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ConsoleError } from './adminApi';
import { fmtDateTime, relDays } from './format';
import { Icon } from './icons';
import { plansApi, type Broadcast, type EmailStatus, type RazorpayMode } from './plansApi';
import { BusyButton, useConsole, useToast } from './ui';

export function useDeliveryStatus() {
  const { lostAccess, mocked } = useConsole();
  const [rzp, setRzp] = useState<RazorpayMode | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const load = useCallback(async () => {
    if (mocked) { setRzp('test'); setEmail({ configured: true, from: 'Menutha <updates@menutha.com>', domain: 'menutha.com', counts: { pending_domain: 3 }, last: null }); return; }
    try {
      const [m, e] = await Promise.all([plansApi.razorpayMode(), plansApi.emailStatus()]);
      setRzp(m); setEmail(e);
    } catch (err) { if (err instanceof ConsoleError && err.denied) lostAccess(); }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);
  return { rzp, email, reloadStatus: load };
}

export function DeliveryStrip({ rzp, email }: { rzp: RazorpayMode | null; email: EmailStatus | null }) {
  const waiting = (email?.counts?.pending_domain ?? 0) + (email?.counts?.not_configured ?? 0);
  const sentEver = (email?.counts?.sent ?? 0) > 0;
  const emailTone = !email ? '' : !email.configured ? 'is-red' : waiting > 0 || !sentEver ? 'is-amber' : 'is-green';
  return (
    <div className="mc-status-strip" aria-label="Payments and email status">
      <span className="mc-strip-item">
        <span className={`mc-strip-dot ${rzp === 'live' ? 'is-green' : rzp === 'test' ? 'is-blue' : rzp === 'missing' ? 'is-red' : ''}`} />
        Razorpay: <strong>{rzp === null ? 'checking…' : rzp === 'live' ? 'Live account' : rzp === 'test' ? 'Test mode' : rzp === 'missing' ? 'Keys missing' : 'Unknown'}</strong>
      </span>
      <span className="mc-strip-item" title={email?.last?.last_error ?? undefined}>
        <span className={`mc-strip-dot ${emailTone}`} />
        Email: <strong>{!email ? 'checking…'
          : !email.configured ? 'Not set up (no Resend key)'
          : waiting > 0 || !sentEver ? 'Email pending: domain not verified'
          : 'Working'}</strong>
        {waiting > 0 && <span>· {waiting} waiting</span>}
      </span>
      <span className="mc-strip-item">
        <span className="mc-strip-dot is-green" />App alerts &amp; push: <strong>Ready</strong>
      </span>
    </div>
  );
}

const KIND_ICON: Record<string, string> = { price_update: 'rupee', plan_update: 'layers', offer: 'sparkle', general: 'list' };

export function Announcements({ version }: { version: number }) {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [list, setList] = useState<Broadcast[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (mocked) { setList([]); return; }
    try { setList(await plansApi.broadcasts()); }
    catch (e) { if (e instanceof ConsoleError && e.denied) lostAccess(); else setList([]); }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load, version]);

  const waiting = (list ?? []).reduce((n, b) => n + (b.email?.pending_domain ?? 0) + (b.email?.failed ?? 0)
    + (b.email?.not_configured ?? 0) + (b.email?.queued ?? 0), 0);

  return (
    <section className="mc-panel" aria-label="Messages sent to restaurants">
      <div className="mc-panel-head">
        <h2 className="mc-display">Messages sent to restaurants</h2>
        <span style={{ marginLeft: 'auto' }} />
        {waiting > 0 && (
          <BusyButton className="mc-btn mc-btn-ghost" busy={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await plansApi.retryEmails();
              toast(r.sent > 0 ? 'ok' : 'bad', r.sent > 0 ? `${r.sent} email${r.sent === 1 ? '' : 's'} sent.`
                : r.pending_domain > 0 ? 'Still waiting: menutha.com is not verified in Resend yet.' : 'Nothing could be sent yet.');
              void load();
            } catch (e) {
              if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
              toast('bad', e instanceof Error ? e.message : 'Could not retry.');
            } finally { setBusy(false); }
          }}><Icon name="refresh" size={16} />Try emails again</BusyButton>
        )}
      </div>
      {!list ? <div className="mc-attn-empty"><span className="mc-spinner" /></div>
        : list.length === 0 ? (
          <div className="mc-attn-empty"><Icon name="list" size={26} />
            <p>Nothing sent yet. When you change a price or a plan, or publish an offer, the message appears here with how it was delivered.</p></div>
        ) : (
          <ul className="mc-bc-list">
            {list.map((b) => {
              const e = b.email ?? {};
              const sent = e.sent ?? 0;
              const wait = (e.pending_domain ?? 0) + (e.queued ?? 0);
              const bad = (e.failed ?? 0) + (e.not_configured ?? 0);
              const push = b.push_result;
              return (
                <li key={b.id} className="mc-bc">
                  <span className="mc-bc-icon"><Icon name={KIND_ICON[b.kind] ?? 'list'} size={17} /></span>
                  <div>
                    <strong>{b.title}</strong>
                    <p>{b.body}</p>
                    <div className="mc-bc-chips">
                      <span className="mc-bc-chip is-ok">In the app: {b.audience_count} restaurant{b.audience_count === 1 ? '' : 's'}</span>
                      <span className="mc-bc-chip">Read by {b.read_count}</span>
                      {push ? (
                        <span className={`mc-bc-chip ${(push.sent ?? 0) > 0 ? 'is-ok' : push.devices ? 'is-bad' : ''}`}>
                          Push: {push.devices ? `${push.sent ?? 0} of ${push.devices} phones` : 'no phones registered'}
                        </span>
                      ) : <span className="mc-bc-chip is-wait">Push: not sent</span>}
                      {sent > 0 && <span className="mc-bc-chip is-ok">Email: {sent} sent</span>}
                      {wait > 0 && <span className="mc-bc-chip is-wait">Email pending: domain not verified ({wait})</span>}
                      {bad > 0 && <span className="mc-bc-chip is-bad">Email failed: {bad}</span>}
                      {(e.skipped ?? 0) > 0 && <span className="mc-bc-chip">No email on file: {e.skipped}</span>}
                    </div>
                  </div>
                  <span className="mc-bc-when" title={fmtDateTime(b.created_at)}>
                    {relDays(b.created_at) === 'today' ? fmtDateTime(b.created_at).split(', ').pop() : relDays(b.created_at)}
                    <br /><small>{b.created_by_email}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
