import { useCallback, useEffect, useState } from 'react';
import { fetchLiveNotifications, subscribeLiveNotifications, type LiveNotification } from './portalApi';

/**
 * The live list, kept current. Used by this page and by the shell's bell badge
 * (`tag` keeps their realtime channels apart). Besides realtime it re-reads
 * once a minute and on focus: an order inside its grace window becomes live
 * when its release time passes, and nothing writes a row at that moment.
 */
export function useLiveNotifications(restaurantId: string | null, tag: string) {
  const [items, setItems] = useState<LiveNotification[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!restaurantId) return Promise.resolve();
    return fetchLiveNotifications(restaurantId)
      .then((list) => { setItems(list); setError(''); })
      .catch(() => setError('Could not load notifications. Check your connection.'));
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;
    load();
    const off = subscribeLiveNotifications(restaurantId, tag, () => { load(); });
    const t = window.setInterval(() => { load(); }, 60_000);
    const onFocus = () => { load(); };
    window.addEventListener('focus', onFocus);
    return () => { off(); window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [restaurantId, tag, load]);

  return { items, error, reload: load, setItems };
}
