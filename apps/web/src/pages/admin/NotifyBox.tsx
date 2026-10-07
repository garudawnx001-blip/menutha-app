/**
 * "TELL THE RESTAURANTS" — shared by price changes, feature changes and offers.
 *
 * One switch (on by default where the change affects what owners pay or get),
 * the message as the owner will read it, and exactly who it reaches: how many
 * restaurants, how many by email, and what happens to email while the domain
 * is not verified. The reach numbers come from the database's own audience
 * function (admin_notice_preview), so what is shown is what will be sent.
 */
import React, { useEffect, useState } from 'react';
import { Icon } from './icons';
import { plansApi, type EmailStatus, type NoticePreview } from './plansApi';

export interface NotifyValue { on: boolean; title: string; body: string }

export function NotifyBox({ value, onChange, sourceType, sourceId, email }: {
  value: NotifyValue;
  onChange: (v: NotifyValue) => void;
  sourceType: 'plan' | 'coupon' | 'all';
  sourceId: string | null;
  email: EmailStatus | null;
}) {
  const [reach, setReach] = useState<NoticePreview | null>(null);
  const [reachError, setReachError] = useState(false);
  useEffect(() => {
    let alive = true;
    setReach(null); setReachError(false);
    plansApi.noticePreview(sourceType, sourceId)
      .then((r) => { if (alive) setReach(r); })
      .catch(() => { if (alive) setReachError(true); });
    return () => { alive = false; };
  }, [sourceType, sourceId]);

  // Until one email has actually gone out, assume the domain is still waiting:
  // that is the honest default while menutha.com is unverified in Resend.
  const emailWaits = !email?.configured || (email?.counts?.pending_domain ?? 0) > 0
    || email?.last?.status === 'pending_domain' || !((email?.counts?.sent ?? 0) > 0);

  return (
    <div className="mc-notify">
      <label className={`mc-toggle${value.on ? ' is-on' : ''}`}>
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        <span className="mc-toggle-box" aria-hidden />
        <span>
          <strong>Notify affected restaurants (app + email)</strong>
          <small>
            {reach
              ? `${reach.restaurants} restaurant${reach.restaurants === 1 ? '' : 's'} — an alert in the app, a push to their phones and an email.`
              : reachError ? 'Could not count who is affected just now.' : 'Counting who is affected…'}
          </small>
        </span>
      </label>
      {value.on && (
        <div className="mc-notify-body">
          {reach && (
            <div className="mc-notify-reach">
              <span><Icon name="store" size={14} /><strong>{reach.restaurants}</strong> in the app</span>
              <span><Icon name="phone" size={14} />push to their phones</span>
              <span><Icon name="card" size={14} /><strong>{reach.with_email}</strong> by email</span>
              {reach.without_email > 0 && <span>{reach.without_email} have no email on file</span>}
            </div>
          )}
          <label className="mc-input">
            <span>Title</span>
            <input value={value.title} maxLength={120} onChange={(e) => onChange({ ...value, title: e.target.value })} />
          </label>
          <label className="mc-input">
            <span>Message <em>— what the owner reads. Edit freely.</em></span>
            <textarea rows={5} value={value.body} maxLength={1200} onChange={(e) => onChange({ ...value, body: e.target.value })} />
          </label>
          <div className="mc-phone-preview" aria-label="How it looks on a phone">
            <em>Menutha · now</em>
            <strong>{value.title || 'Title'}</strong>
            <span>{(value.body || 'Message').replace(/\s+/g, ' ').slice(0, 140)}{value.body.length > 140 ? '…' : ''}</span>
          </div>
          {emailWaits && (
            <p className="mc-note">
              <strong>Email pending: domain not verified.</strong> The app alert and push go out now. Emails are
              queued and will send automatically once menutha.com is verified in Resend — nothing else to do.
            </p>
          )}
          {reach && reach.restaurants === 0 && (
            <p className="mc-note">No restaurant is affected right now, so nothing will be sent.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One line on what was sent, for the toast after a save. */
export function deliverySummary(r: { restaurants: number; push?: { sent?: number; devices?: number } | null;
  email?: { sent?: number; pending_domain?: number; not_configured?: number } | null; deliveryError?: string }): string {
  const parts = [`${r.restaurants} restaurant${r.restaurants === 1 ? '' : 's'} told in the app`];
  if (r.push) parts.push(`push to ${r.push.sent ?? 0} of ${r.push.devices ?? 0} phone${r.push.devices === 1 ? '' : 's'}`);
  if (r.email) {
    if ((r.email.sent ?? 0) > 0) parts.push(`${r.email.sent} email${r.email.sent === 1 ? '' : 's'} sent`);
    if ((r.email.pending_domain ?? 0) > 0) parts.push(`${r.email.pending_domain} email${r.email.pending_domain === 1 ? '' : 's'} waiting for the domain`);
    if ((r.email.not_configured ?? 0) > 0) parts.push('email not set up yet');
  }
  if (r.deliveryError) parts.push('push could not be sent — the app alerts are saved');
  return parts.join(' · ') + '.';
}
