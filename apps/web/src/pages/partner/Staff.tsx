/** Staff management (owner only): invite by phone with a role; invites are
 *  claimed automatically the first time that phone signs in to the portal. */
import React, { useEffect, useState } from 'react';
import {
  fetchStaff, fetchInvites, inviteStaff, removeStaff, revokeInvite, type StaffRow,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const ROLE_HELP: Record<string, string> = {
  manager: 'Orders, menu, tables & QR, billing, reservations',
  waiter: 'Live orders board + mark paid only',
  kitchen: 'Kitchen board (also works in the Menuva app)',
};

export function Staff() {
  const { restaurant } = usePartner();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [invites, setInvites] = useState<any[]>([]);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'manager' | 'waiter' | 'kitchen'>('waiter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [s, i] = await Promise.all([fetchStaff(restaurant.id), fetchInvites(restaurant.id)]);
      setStaff(s); setInvites(i);
    } catch (e: any) { setError(e?.message ?? 'Could not load staff.'); setStaff([]); }
  };
  useEffect(() => { load(); }, [restaurant.id]);

  const invite = async () => {
    setBusy(true); setError('');
    try {
      await inviteStaff(restaurant.id, phone, role);
      setPhone('');
      await load();
    } catch (e: any) { setError(e?.message ?? 'Invite failed.'); }
    finally { setBusy(false); }
  };

  if (staff === null) return <Spinner label="Loading team…" />;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Team</p>
      <h1 className="display" style={{ fontSize: 26 }}>Staff & roles</h1>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, margin: '10px 0' }}>{error}</p>}

      <div className="glass" style={{ padding: 14, margin: '14px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="code-input" style={{ flex: 1, minWidth: 170 }} inputMode="tel"
          placeholder="Staff phone — e.g. 98765 43210"
          value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select className="code-input" style={{ width: 130, padding: '10px 12px' }} value={role}
          onChange={(e) => setRole(e.target.value as any)}>
          <option value="manager">Manager</option>
          <option value="waiter">Waiter</option>
          <option value="kitchen">Kitchen</option>
        </select>
        <button className="btn btn-primary" style={{ padding: '11px 16px' }} disabled={busy || phone.replace(/\D/g, '').length < 10} onClick={invite}>
          Invite
        </button>
        <p className="dim" style={{ fontSize: 12.5, width: '100%' }}>
          {ROLE_HELP[role]}. They sign in at this site → Restaurant Portal with
          phone OTP; access activates automatically.
        </p>
      </div>

      <div className="glass" style={{ padding: '4px 16px' }}>
        {staff.map((s) => (
          <div key={s.id} className="row-item">
            <span>
              <strong style={{ fontSize: 14.5 }}>{s.user?.name || s.user?.phone || s.user?.email || 'Team member'}</strong>
              <span className="badge gold" style={{ marginLeft: 8 }}>{s.member_role}</span>
            </span>
            {s.member_role !== 'owner' && (
              <button className="chip" onClick={async () => {
                if (confirm('Remove this team member?')) { await removeStaff(s.id); load(); }
              }}>Remove</button>
            )}
          </div>
        ))}
        {invites.map((i) => (
          <div key={i.id} className="row-item">
            <span className="muted" style={{ fontSize: 14 }}>
              {i.phone} <span className="badge" style={{ marginLeft: 6 }}>invited · {i.invite_role}</span>
            </span>
            <button className="chip" onClick={async () => { await revokeInvite(i.id); load(); }}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}
