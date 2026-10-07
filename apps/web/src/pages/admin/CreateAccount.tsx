/** "New restaurant" — makes the owner login and the restaurant in one go, then
 *  shows the username and password exactly once. */
import React, { useState } from 'react';
import { ConsoleError, type Credentials, type Tier } from './adminApi';
import { CredentialsModal } from './Actions';
import { tierName } from './format';
import { BusyButton, Modal, useConsole, useToast } from './ui';

const USERNAME = /^[a-z0-9._]{3,30}$/;
const usernameProblem = (u: string) =>
  !u ? '' : !USERNAME.test(u) ? 'Use 3–30 letters, numbers, dots or underscores.'
    : u.startsWith('.') || u.endsWith('.') || u.includes('..') ? 'No dot at the start or end, and no two dots together.' : '';

const suggest = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.').slice(0, 24);

export function CreateAccount({ onClose }: { onClose: () => void }) {
  const { api, refresh, lostAccess } = useConsole();
  const toast = useToast();
  const [f, setF] = useState({ restaurant_name: '', city: '', owner_name: '', phone: '', username: '', tier: 'growth' as Tier, complimentary: false });
  const [touchedUser, setTouchedUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creds, setCreds] = useState<(Credentials & { name: string }) | null>(null);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const uProblem = usernameProblem(f.username);
  const ready = f.restaurant_name.trim() && f.city.trim() && f.owner_name.trim() && f.username && !uProblem;

  if (creds) {
    return <CredentialsModal title={`${creds.name} is ready`} creds={creds} onDone={() => { setCreds(null); onClose(); }} />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const c = await api.createRestaurant({ ...f, restaurant_name: f.restaurant_name.trim(), city: f.city.trim(), owner_name: f.owner_name.trim(), phone: f.phone.trim() });
      toast('ok', `${f.restaurant_name.trim()} created. Copy the login now.`);
      setCreds({ ...c, name: f.restaurant_name.trim() });
      void refresh();
    } catch (err) {
      if (err instanceof ConsoleError && err.denied) { lostAccess(); return; }
      const m = err instanceof Error ? err.message : 'Could not create the restaurant. Nothing was created.';
      setError(m); toast('bad', m);
    } finally { setBusy(false); }
  };

  return (
    <Modal title="New restaurant" icon="plus" tone="green" wide onClose={onClose}
      footer={<>
        <button type="button" className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton type="submit" form="mc-create" className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} disabled={!ready}>
          Create restaurant
        </BusyButton>
      </>}>
      <form id="mc-create" onSubmit={submit} className="mc-form">
        <p className="mc-lead">This makes the restaurant and the owner's login. You will see the password once at the end.</p>
        <div className="mc-form-grid">
          <label className="mc-input"><span>Restaurant name</span>
            <input value={f.restaurant_name} autoFocus required maxLength={80}
              onChange={(e) => { set('restaurant_name', e.target.value); if (!touchedUser) set('username', suggest(e.target.value)); }} />
          </label>
          <label className="mc-input"><span>City</span>
            <input value={f.city} required maxLength={60} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className="mc-input"><span>Owner name</span>
            <input value={f.owner_name} required maxLength={80} onChange={(e) => set('owner_name', e.target.value)} />
          </label>
          <label className="mc-input"><span>Owner phone <em>(optional)</em></span>
            <input value={f.phone} inputMode="tel" maxLength={20} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className="mc-input mc-span-2"><span>Username they will sign in with</span>
            <input value={f.username} required autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30}
              onChange={(e) => { setTouchedUser(true); set('username', e.target.value.toLowerCase().replace(/\s+/g, '')); }}
              aria-invalid={!!uProblem} />
            {uProblem ? <small className="mc-field-bad">{uProblem}</small> : <small>Lower-case letters, numbers, dots or underscores.</small>}
          </label>
        </div>

        <p className="mc-lead" style={{ marginTop: 6 }}>Plan</p>
        <div className="mc-choice-grid" role="radiogroup" aria-label="Plan">
          {(['basic', 'growth', 'enterprise'] as Tier[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={f.tier === t}
              className={`mc-choice mc-choice-${t}${f.tier === t ? ' is-on' : ''}`} onClick={() => set('tier', t)}>
              <strong>{tierName(t)}</strong>
            </button>
          ))}
        </div>

        <label className={`mc-toggle${f.complimentary ? ' is-on' : ''}`}>
          <input type="checkbox" checked={f.complimentary} onChange={(e) => set('complimentary', e.target.checked)} />
          <span className="mc-toggle-box" aria-hidden />
          <span><strong>Complimentary</strong><small>Free forever — never billed, never expires. Leave off for a normal 30-day free trial.</small></span>
        </label>
        {error && <p className="mc-form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
