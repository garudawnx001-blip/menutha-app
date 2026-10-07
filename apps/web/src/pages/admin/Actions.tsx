/**
 * The restaurant actions, each one a small dialog: say what will happen in
 * plain words, one big button to do it, a toast when it is done, and the list
 * refreshed straight away. Every action is re-checked in Postgres
 * (is_platform_admin + its own validation) and written to the activity log.
 */
import React, { useMemo, useState } from 'react';
import { ConsoleError, TIERS, type AdminRestaurant, type Credentials, type PlanStatus, type Tier } from './adminApi';
import { fmtDate, tierName } from './format';
import { BusyButton, CopyButton, Modal, useConsole, useToast } from './ui';

/** A request key for idempotent writes (RFC 4122 v4). */
function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ActionKind = 'plan' | 'trial' | 'comp-on' | 'comp-off' | 'suspend' | 'activate' | 'reset';

const STATUS_CHOICES: { v: PlanStatus; label: string; hint: string }[] = [
  { v: 'active', label: 'Active — paying', hint: 'Everything on. Use when they pay you outside Razorpay.' },
  { v: 'trialing', label: 'On free trial', hint: 'Free until the trial end date.' },
  { v: 'grace', label: 'Payment overdue', hint: 'Keeps working for 7 grace days, then stops.' },
  { v: 'cancelled', label: 'Stopped', hint: 'Orders switch off. Their data is kept.' },
];

const TIER_HINT: Record<Tier, string> = {
  basic: 'QR ordering, menu, billing, UPI',
  growth: 'Basic + reports, chat, staff, Excel',
  enterprise: 'Growth + many outlets, branding',
};

/** Runs an action with the standard toast / refresh / lost-access handling. */
function useRunner(onDone: () => void) {
  const { refresh, lostAccess } = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError('');
    try {
      await fn();
      toast('ok', success);
      onDone();
      void refresh();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      const msg = e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.';
      setError(msg); toast('bad', msg);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function ActionDialog({ kind, r, onClose }: { kind: ActionKind; r: AdminRestaurant; onClose: () => void }) {
  switch (kind) {
    case 'plan': return <PlanDialog r={r} onClose={onClose} />;
    case 'trial': return <TrialDialog r={r} onClose={onClose} />;
    case 'comp-on': return <CompOnDialog r={r} onClose={onClose} />;
    case 'comp-off': return <CompOffDialog r={r} onClose={onClose} />;
    case 'suspend': case 'activate': return <StatusDialog r={r} on={kind === 'activate'} onClose={onClose} />;
    case 'reset': return <ResetDialog r={r} onClose={onClose} />;
  }
}

function ErrorLine({ text }: { text: string }) {
  return text ? <p className="mc-form-error" role="alert">{text}</p> : null;
}

function TierChoice({ value, onChange }: { value: Tier; onChange: (t: Tier) => void }) {
  return (
    <div className="mc-choice-grid" role="radiogroup" aria-label="Plan">
      {TIERS.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t}
          className={`mc-choice mc-choice-${t}${value === t ? ' is-on' : ''}`} onClick={() => onChange(t)}>
          <strong>{tierName(t)}</strong>
          <span>{TIER_HINT[t]}</span>
        </button>
      ))}
    </div>
  );
}

function PlanDialog({ r, onClose }: { r: AdminRestaurant; onClose: () => void }) {
  const { api } = useConsole();
  const { busy, error, run } = useRunner(onClose);
  const [tier, setTier] = useState<Tier>((TIERS as string[]).includes(r.plan_tier ?? '') ? (r.plan_tier as Tier) : 'growth');
  const [status, setStatus] = useState<PlanStatus>(
    (['active', 'trialing', 'grace', 'cancelled'] as string[]).includes(r.plan_status ?? '') ? (r.plan_status as PlanStatus) : 'trialing');
  return (
    <Modal title="Change plan" icon="layers" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy}
          onClick={() => run(() => api.setPlan(r.id, tier, status), `${r.name} is now on ${tierName(tier)}.`)}>
          Save plan
        </BusyButton>
      </>}>
      <p className="mc-lead">Which plan should <strong>{r.name}</strong> be on?</p>
      <TierChoice value={tier} onChange={setTier} />
      <p className="mc-lead" style={{ marginTop: 18 }}>And what is its situation?</p>
      <div className="mc-radio-list" role="radiogroup" aria-label="Plan status">
        {STATUS_CHOICES.map((c) => (
          <label key={c.v} className={`mc-radio${status === c.v ? ' is-on' : ''}${r.is_complimentary && c.v !== 'active' ? ' is-off' : ''}`}>
            <input type="radio" name="status" checked={status === c.v} disabled={r.is_complimentary && c.v !== 'active'}
              onChange={() => setStatus(c.v)} />
            <span><strong>{c.label}</strong><small>{c.hint}</small></span>
          </label>
        ))}
      </div>
      {r.is_complimentary && <p className="mc-note">This restaurant is complimentary, so it always stays active. Remove complimentary first to change that.</p>}
      <ErrorLine text={error} />
    </Modal>
  );
}

function TrialDialog({ r, onClose }: { r: AdminRestaurant; onClose: () => void }) {
  const { api } = useConsole();
  const { busy, error, run } = useRunner(onClose);
  const [mode, setMode] = useState<'days' | 'date'>('days');
  const [days, setDays] = useState(14);
  const [date, setDate] = useState(() => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const currentEnd = r.trial_ends_at ? Date.parse(r.trial_ends_at) : 0;
  const newEnd = useMemo(() => (mode === 'days'
    ? new Date(Math.max(Date.now(), currentEnd) + days * 864e5)
    : new Date(`${date}T23:59:00`)), [mode, days, date, currentEnd]);
  const valid = mode === 'days' ? days >= 1 && days <= 365 : newEnd.getTime() > Date.now();
  // One key per distinct request: pressing again after an error (or a double
  // click) repeats the SAME request, which the server applies at most once.
  // Changing the days / date makes it a new request.
  const key = useMemo(() => newKey(), [mode, days, date]);
  const mandate = r.subscriptions.find((s) => ['authenticated', 'active', 'pending', 'halted'].includes(s.status ?? ''));
  return (
    <Modal title="Give more free days" icon="calendar" tone="green" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} disabled={!valid}
          onClick={() => run(async () => {
            const res = await api.extendTrial(r.id, mode === 'days' ? { days } : { until: newEnd.toISOString() }, key);
            return res;
          }, `Free trial for ${r.name} now ends ${fmtDate(newEnd.toISOString())}`
            + (mandate?.status === 'authenticated' ? ', and their first autopay charge moved to the same day.' : '.'))}>
          Extend free trial
        </BusyButton>
      </>}>
      <p className="mc-lead">
        {r.trial_ends_at
          ? <>The free trial {Date.parse(r.trial_ends_at) > Date.now() ? 'ends' : 'ended'} on <strong>{fmtDate(r.trial_ends_at)}</strong>.</>
          : <>There is no trial end date yet.</>}
      </p>
      <div className="mc-seg" role="tablist">
        <button role="tab" aria-selected={mode === 'days'} className={mode === 'days' ? 'is-on' : ''} onClick={() => setMode('days')}>Add days</button>
        <button role="tab" aria-selected={mode === 'date'} className={mode === 'date' ? 'is-on' : ''} onClick={() => setMode('date')}>Pick an end date</button>
      </div>
      {mode === 'days' ? (
        <div className="mc-days">
          {[7, 14, 30, 60, 90].map((d) => (
            <button key={d} type="button" className={`mc-chip-big${days === d ? ' is-on' : ''}`} onClick={() => setDays(d)}>+{d} days</button>
          ))}
          <label className="mc-input mc-input-sm">
            <span>Other</span>
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.round(Number(e.target.value)))} />
          </label>
        </div>
      ) : (
        <label className="mc-input">
          <span>Free until</span>
          <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      <div className="mc-preview">New end date: <strong>{valid ? fmtDate(newEnd.toISOString()) : '—'}</strong></div>
      {mandate?.status === 'authenticated' && (
        <p className="mc-note">They have autopay set up. Their first Razorpay charge will move to this same date. If Razorpay refuses (for example a UPI mandate), nothing is changed and you will see why.</p>
      )}
      {mandate && mandate.status !== 'authenticated' && (
        <p className="mc-note">Their autopay is already charging (Razorpay: {mandate.status}). Razorpay cannot move a charge date once billing has started, so this will be refused.</p>
      )}
      {!mandate && r.plan_status === 'active' && <p className="mc-note">They are already on an active plan, so this only moves the date.</p>}
      <ErrorLine text={error} />
    </Modal>
  );
}

function CompOnDialog({ r, onClose }: { r: AdminRestaurant; onClose: () => void }) {
  const { api } = useConsole();
  const { busy, error, run } = useRunner(onClose);
  const [tier, setTier] = useState<Tier>((TIERS as string[]).includes(r.plan_tier ?? '') ? (r.plan_tier as Tier) : 'growth');
  return (
    <Modal title="Make complimentary" icon="gift" tone="gold" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-gold mc-btn-lg" busy={busy}
          onClick={() => run(() => api.setComplimentary(r.id, true, { tier }), `${r.name} is now complimentary on ${tierName(tier)}.`)}>
          Make it free forever
        </BusyButton>
      </>}>
      <p className="mc-lead"><strong>{r.name}</strong> will use Menutha <strong>free, forever</strong>: never billed, never expiring, no payment screens.</p>
      <TierChoice value={tier} onChange={setTier} />
      {r.latest_subscription?.status && ['active', 'authenticated'].includes(r.latest_subscription.status) && (
        <p className="mc-note">They have a live Razorpay plan. Cancel it in Razorpay so they are not charged.</p>
      )}
      <ErrorLine text={error} />
    </Modal>
  );
}

function CompOffDialog({ r, onClose }: { r: AdminRestaurant; onClose: () => void }) {
  const { api } = useConsole();
  const { busy, error, run } = useRunner(onClose);
  const [days, setDays] = useState(7);
  return (
    <Modal title="Remove complimentary" icon="gift" tone="danger" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Keep it free</button>
        <BusyButton className="mc-btn mc-btn-danger mc-btn-lg" busy={busy}
          onClick={() => run(() => api.setComplimentary(r.id, false, { trialDays: days }), `${r.name} is no longer complimentary.`)}>
          Remove complimentary
        </BusyButton>
      </>}>
      <p className="mc-lead"><strong>{r.name}</strong> will need a paid plan again. How many free days should they get to choose one?</p>
      <div className="mc-days">
        {[0, 7, 14, 30].map((d) => (
          <button key={d} type="button" className={`mc-chip-big${days === d ? ' is-on' : ''}`} onClick={() => setDays(d)}>
            {d === 0 ? 'None — stop now' : `${d} days`}
          </button>
        ))}
      </div>
      {days === 0 && <p className="mc-note mc-note-bad">Orders will stop straight away until they pay.</p>}
      <ErrorLine text={error} />
    </Modal>
  );
}

function StatusDialog({ r, on, onClose }: { r: AdminRestaurant; on: boolean; onClose: () => void }) {
  const { api } = useConsole();
  const { busy, error, run } = useRunner(onClose);
  return (
    <Modal title={on ? 'Switch back on' : 'Suspend restaurant'} icon="power" tone={on ? 'green' : 'danger'} onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className={`mc-btn mc-btn-lg ${on ? 'mc-btn-primary' : 'mc-btn-danger'}`} busy={busy}
          onClick={() => run(() => api.setStatus(r.id, on ? 'active' : 'suspended'),
            on ? `${r.name} is switched back on.` : `${r.name} is suspended.`)}>
          {on ? 'Switch on' : 'Suspend now'}
        </BusyButton>
      </>}>
      {on
        ? <p className="mc-lead">Diners will be able to order from <strong>{r.name}</strong> again (as long as its plan is active).</p>
        : <p className="mc-lead">Diners will <strong>not</strong> be able to order from <strong>{r.name}</strong>. The owner can still sign in, and nothing is deleted.</p>}
      {r.parent_id && <p className="mc-note">This is an outlet of {r.parent_name}. Only this outlet changes.</p>}
      <ErrorLine text={error} />
    </Modal>
  );
}

function ResetDialog({ r, onClose }: { r: AdminRestaurant; onClose: () => void }) {
  const { api, lostAccess } = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creds, setCreds] = useState<Credentials | null>(null);
  if (creds) return <CredentialsModal title="New password ready" creds={creds} onDone={() => { setCreds(null); onClose(); }} />;
  return (
    <Modal title="Reset owner login" icon="key" tone="danger" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-danger mc-btn-lg" busy={busy} onClick={async () => {
          setBusy(true); setError('');
          try {
            const c = await api.resetLogin(r.id);
            toast('ok', 'New password created. Copy it now.');
            setCreds(c);
          } catch (e) {
            if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
            const m = e instanceof Error ? e.message : 'Could not reset. Nothing was changed.';
            setError(m); toast('bad', m);
          } finally { setBusy(false); }
        }}>Make a new password</BusyButton>
      </>}>
      <p className="mc-lead">
        This makes a brand-new password for <strong>{r.owner?.name || r.owner?.username || 'the owner'}</strong>
        {r.owner?.username ? <> (username <strong>{r.owner.username}</strong>)</> : null}.
      </p>
      <p className="mc-note">The old password stops working right away. You will see the new one <strong>only once</strong>.</p>
      {r.parent_id && <p className="mc-note">This is an outlet — the login belongs to {r.parent_name}.</p>}
      <ErrorLine text={error} />
    </Modal>
  );
}

/**
 * THE PASSWORD, SHOWN ONCE. It lives only in this component's props: closing
 * drops it, nothing stores it, and the server never logs it. Esc and the
 * backdrop do nothing here, so it cannot be lost by a stray click.
 */
export function CredentialsModal({ title, creds, onDone }: { title: string; creds: Credentials; onDone: () => void }) {
  const loginAt = 'menutha.com/partner and in the Menutha app';
  const all = `Username: ${creds.username ?? '—'}\nPassword: ${creds.password}\nLogin at: ${loginAt}`;
  return (
    <Modal title={title} icon="key" tone="green" dismissable={false} onClose={onDone}
      footer={<>
        <CopyButton text={all} label="Copy all" big />
        <button className="mc-btn mc-btn-primary mc-btn-lg" onClick={onDone}>I have saved it — close</button>
      </>}>
      <div className="mc-creds">
        <div className="mc-cred"><span>Username</span><code>{creds.username ?? '—'}</code>{creds.username && <CopyButton text={creds.username} />}</div>
        <div className="mc-cred"><span>Password</span><code className="mc-cred-pw">{creds.password}</code><CopyButton text={creds.password} /></div>
        <div className="mc-cred"><span>Login at</span><code>menutha.com/partner<small className="mc-cred-or">or in the Menutha app</small></code></div>
      </div>
      <p className="mc-note mc-note-bad">This password is shown <strong>only once</strong> and is not saved anywhere. Copy it now and send it to the owner.</p>
    </Modal>
  );
}
