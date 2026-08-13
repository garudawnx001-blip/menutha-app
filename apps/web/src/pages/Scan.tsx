/** /scan/:token — the landing point of every printed QR. Resolves the table +
 *  restaurant, starts the session, and forwards to the menu. */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { resolveToken, ScanError } from '../lib/api';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';

export function Scan() {
  const { token = '' } = useParams();
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
          setError({ title: 'Not taking orders', body: e.message });
        } else if (e instanceof ScanError) {
          setError({
            title: 'QR not recognised',
            body: 'This code doesn’t match any table. Please re-scan the QR on your table, or ask the staff for a fresh card.',
          });
        } else {
          setError({
            title: 'Connection trouble',
            body: 'We couldn’t reach the restaurant’s menu. Check your internet connection and try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!error) return <Spinner label="Setting your table…" />;

  return (
    <div className="page center-fill fade-in">
      <Wordmark size={24} />
      <h1 className="display" style={{ fontSize: 28, marginTop: 10 }}>{error.title}</h1>
      <p className="muted" style={{ maxWidth: 380 }}>{error.body}</p>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  );
}
