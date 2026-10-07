/** The console frame: a sidebar on desktop, a bottom tab bar + "More" sheet on
 *  a phone. Every section is always reachable; unbuilt ones say "Coming next". */
import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from './icons';
import { fmtTime } from './format';
import { useConsole } from './ui';

export const SECTIONS = [
  { to: '/admin', label: 'Home', icon: 'home', end: true },
  { to: '/admin/restaurants', label: 'Restaurants', icon: 'store' },
  { to: '/admin/plans', label: 'Plans & Prices', icon: 'tag' },
  { to: '/admin/offers', label: 'Offers', icon: 'sparkle' },
  { to: '/admin/payments', label: 'Payments', icon: 'card' },
  { to: '/admin/website', label: 'Website', icon: 'globe' },
  { to: '/admin/settings', label: 'App Settings', icon: 'phone' },
  { to: '/admin/activity', label: 'Activity', icon: 'list' },
] as const;

/** On a phone the bar holds four; the rest live behind More. */
const MOBILE_PRIMARY = ['/admin', '/admin/restaurants', '/admin/payments', '/admin/activity'];

export function Shell({ children }: { children: React.ReactNode }) {
  const { email, data, refreshing, refresh, openCreate, signOut, mocked } = useConsole();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="mc-root mc-shell">
      <aside className="mc-side" aria-label="Sections">
        <div className="mc-brand">
          <img src="/menutha-mark.svg" alt="" width={30} height={30} />
          <span className="mc-brand-name">Menutha</span>
          <span className="mc-brand-tag">Admin</span>
        </div>
        <button className="mc-btn mc-btn-primary mc-side-new" onClick={openCreate}>
          <Icon name="plus" size={18} /> New restaurant
        </button>
        <nav className="mc-side-nav">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={'end' in s ? s.end : false}
              className={({ isActive }) => `mc-side-link${isActive ? ' is-on' : ''}`}>
              <Icon name={s.icon} size={19} />
              <span>{s.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mc-side-foot">
          <span className="mc-user" title={email}><Icon name="user" size={15} />{email}{mocked ? ' (preview)' : ''}</span>
          <button className="mc-side-link" onClick={signOut}><Icon name="logout" size={18} /><span>Sign out</span></button>
        </div>
      </aside>

      <div className="mc-body">
        <header className="mc-top">
          <div className="mc-brand mc-top-brand">
            <img src="/menutha-mark.svg" alt="" width={26} height={26} />
            <span className="mc-brand-name">Menutha</span>
          </div>
          <span className="mc-updated" aria-live="polite">
            {refreshing ? 'Updating…' : data ? `Updated ${fmtTime(data.generated_at)}` : ''}
          </span>
          <div className="mc-top-right">
            <button className="mc-btn mc-btn-ghost" onClick={() => void refresh()} disabled={refreshing} title="Get the latest">
              <Icon name="refresh" size={16} className={refreshing ? 'mc-spin' : ''} /><span className="mc-hide-sm">Refresh</span>
            </button>
            <button className="mc-btn mc-btn-primary mc-top-new" onClick={openCreate} aria-label="New restaurant">
              <Icon name="plus" size={18} /><span className="mc-hide-sm">New restaurant</span>
            </button>
          </div>
        </header>
        <main className="mc-main">{children}</main>
      </div>

      <nav className="mc-tabbar" aria-label="Sections">
        {SECTIONS.filter((s) => MOBILE_PRIMARY.includes(s.to)).map((s) => (
          <NavLink key={s.to} to={s.to} end={'end' in s ? s.end : false} className={({ isActive }) => `mc-tab${isActive ? ' is-on' : ''}`}>
            <Icon name={s.icon} size={21} /><span>{s.label}</span>
          </NavLink>
        ))}
        <button className={`mc-tab${more ? ' is-on' : ''}`} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <Icon name="menu" size={21} /><span>More</span>
        </button>
      </nav>
      {more && (
        <div className="mc-sheet-layer" role="presentation">
          <div className="mc-scrim" onClick={() => setMore(false)} />
          <div className="mc-sheet" role="dialog" aria-label="All sections">
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} end={'end' in s ? s.end : false} className={({ isActive }) => `mc-side-link${isActive ? ' is-on' : ''}`}>
                <Icon name={s.icon} size={20} /><span>{s.label}</span>
              </NavLink>
            ))}
            <button className="mc-side-link" onClick={signOut}><Icon name="logout" size={19} /><span>Sign out ({email})</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
