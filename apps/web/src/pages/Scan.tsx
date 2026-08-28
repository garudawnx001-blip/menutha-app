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
