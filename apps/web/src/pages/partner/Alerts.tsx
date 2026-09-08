/**
 * Alerts — everything that happened in the last day, newest first.
 *
 * NEW ON THE WEB. Orders, service calls and diner messages each had their own
 * screen and no shared answer to "what needs me right now". This is that
 * answer, and it is deliberately a VIEW rather than a table: a notification
 * here is not a new fact, it is three existing ones read together. Storing a
 * row per event would create a second source of truth, and the first time it
 * disagreed with the board the inbox would be reporting work already done.
 *
 * EVERY ITEM OPENS THE EXACT THING IT IS ABOUT. He asked for deep links that
 * land right every time, so the target is computed with the item -- in
 * portalApi, once, so this page and the app cannot drift on where a service
 * call should go.
 *
 * LIVE. New orders and messages push in without a refresh; the same channel
 * the chat uses plus one on food_order.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchNotifications, subscribeRestaurantMessages, type Notification } from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const ICON: Record<string, string> = { order: '🧾', service: '🙋', chat: '💬' };

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function Alerts() {
  const { restaurant } = usePartner();
  const nav = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'order' | 'service' | 'chat'>('all');

  const load = () =>
    fetchNotifications(restaurant.id).then(setItems).catch(() => setError('Could not load alerts.'));

  useEffect(() => { load(); }, [restaurant.id]);

  useEffect(() => {
    // Messages come through the chat channel; orders through their own. Both
    // just re-read the feed -- it is three small queries and merging in place
    // would mean reimplementing the sort and the dedupe for one row.
    const offMsg = subscribeRestaurantMessages(restaurant.id, () => load());
    const ch = supabase
      .channel(`alerts:${restaurant.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'food_order', filter: `restaurant_id=eq.${restaurant.id}` },
        () => load())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'service_request', filter: `restaurant_id=eq.${restaurant.id}` },
        () => load())
      .subscribe();
    return () => { offMsg(); supabase.removeChannel(ch); };
  }, [restaurant.id]);

  const shown = (items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const unread = (items ?? []).filter((i) => i.unread).length;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Alerts</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>
        {unread > 0 ? `${unread} need${unread === 1 ? 's' : ''} you` : 'All caught up'}
      </h1>
      <p className="dim" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Orders, service calls and messages from the last 24 hours.
      </p>

      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginBottom: 10 }}>{error}</p>}

      <div className="chip-row" style={{ paddingBottom: 10 }}>
        {([['all', 'Everything'], ['order', 'Orders'], ['service', 'Service'], ['chat', 'Messages']] as const)
          .map(([k, lbl]) => (
            <button key={k} className={filter === k ? 'chip active' : 'chip'} onClick={() => setFilter(k)}>
              {lbl}
            </button>
          ))}
      </div>

      {items === null && <Spinner label="Loading alerts…" />}

      {items !== null && shown.length === 0 && (
        <div className="glass" style={{ padding: 18 }}>
          <strong>Nothing here.</strong>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
            New orders, service calls and diner messages appear here as they happen.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {shown.map((n) => (
          <button
            key={n.id}
            className="glass thread-row"
            onClick={() => nav(n.to)}
          >
            <span className="thread-head">
              <span aria-hidden>{ICON[n.kind]}</span>
              <strong>{n.title}</strong>
              {n.unread && <span className="alert-dot" aria-label="unread" />}
              <time className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{ago(n.at)}</time>
            </span>
            <span className="thread-last dim">{n.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
