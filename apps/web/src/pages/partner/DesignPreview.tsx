/**
 * DESIGN PREVIEW -- /partner/preview?screen=...
 *
 * The screens he asked to approve, drawn from fixtures so they can be looked
 * at (and screenshotted) without an account or a database behind them. No
 * real data is read or written here; the login screen is the real component
 * and works, the others are the presentational views with sample state.
 *
 *   screen=login            the log-in screen
 *   screen=signup           the create-account screen
 *   screen=finish           Register's "Finish setting up" step
 *   screen=settings         Restaurant settings (fixture restaurant)
 *   screen=plan             Plan & billing (fixture plans, ids blank)
 *
 * Without ?screen it lists them.
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '../../components';
import { PartnerLogin } from './PartnerLogin';
import { Register } from './Register';
import { Settings } from './Settings';
import { PlanScreen } from './PlanScreen';
import { PartnerPreviewProvider } from './PartnerShell';

export function DesignPreview() {
  const [params] = useSearchParams();
  const screen = params.get('screen');

  switch (screen) {
    case 'login': return <PartnerLogin />;
    case 'signup': return <PartnerLogin />;
    case 'finish': return <Register previewPhase="finish" />;
    case 'settings': return (
      <PartnerPreviewProvider>
        <div className="partner-page" style={{ maxWidth: 760, margin: '0 auto', padding: '8px 20px 40px' }}><Settings /></div>
      </PartnerPreviewProvider>
    );
    case 'plan': return <PlanScreen preview />;
    default: break;
  }

  const screens = [
    ['login', 'Log in'], ['signup', 'Create account (add ?mode=signup)'], ['finish', 'Finish setting up'],
    ['settings', 'Restaurant settings'], ['plan', 'Plan & billing'],
  ];
  return (
    <div className="page fade-in" style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <Wordmark size={24} />
      <p className="overline" style={{ marginTop: 20 }}>Design preview</p>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 6 }}>Screens for approval</h1>
      <p className="dim" style={{ fontSize: 14, marginBottom: 18 }}>Drawn from sample data. Nothing here touches a real account.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {screens.map(([k, label]) => (
          <Link key={k} className="glass thread-row" to={`/partner/preview?screen=${k}${k === 'signup' ? '&mode=signup' : ''}`}>
            <strong>{label}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
