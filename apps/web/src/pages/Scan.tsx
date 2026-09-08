/** /scan/:token — the landing point of every printed QR. Resolves the table +
 *  restaurant, starts the session, and forwards to the menu. */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { resolveToken, ScanError } from '../lib/api';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';
import { useT } from '../lib/i18n';

export function Scan() {
  const { token = '' } = useParams();
  const t = useT();
  const nav = useNavigate();
  const { startSession } = useStore();
  const [error, setError] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await resolveToken(token);
        if (cancelled) return;
        startSession(session);
        // STRAIGHT TO THE MENU. "Remove this page bro after scanning only menu
        // should open" -- and he is right about what a scan means. Someone who
        // has just pointed a camera at the code on their table wants the food;
        // asking them "what would you like to do?" first put a decision in
        // front of the one thing they had already decided.
        //
        // Buffet and Call for service did not go away with the door page: they
        // moved INTO the menu's own filter row, where he marked them, so all
        // three things the restaurant sells are still one tap from the scan --
        // they just no longer cost a tap each to reach the food.
        nav('/menu', { replace: true });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ScanError && e.kind === 'not_accepting') {
          setError({ title: t('scan.closed'), body: e.message });
        } else if (e instanceof ScanError) {
          setError({
            title: t('scan.badQr'),
            body: t('scan.badQrBody'),
          });
        } else {
          setError({
            title: t('scan.offline'),
            body: t('scan.offlineBody'),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!error) return <Spinner label={t('scan.loading')} />;

  return (
    <div className="page center-fill fade-in">
      <Wordmark size={24} />
      <h1 className="display" style={{ fontSize: 28, marginTop: 10 }}>{error.title}</h1>
      <p className="muted" style={{ maxWidth: 380 }}>{error.body}</p>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => window.location.reload()}>
        {t('common.retry')}
      </button>
    </div>
  );
}
