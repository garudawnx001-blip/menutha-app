/**
 * Notifications — one list of what needs the restaurant right now.
 *
 * Replaces the separate Chat and Alerts sections. The owner's brief, kept
 * literally: one list, newest first; guest requests with Done, diner messages
 * with Reply, new orders with View; handled items disappear; no history page
 * and no date filters.
 *
 * What "live" means is decided in portalApi.fetchLiveNotifications, read off
 * the facts themselves, so this page cannot show something the board has
 * already dealt with.
 *
 * REPLY OPENS A SHEET over the list rather than another page. Opening it marks
 * the table's messages read, so the item leaves the list underneath while the
 * conversation stays open on top -- which is exactly "handled" without making
 * the owner go anywhere.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveNotifications } from '../../lib/useLiveNotifications';
import {
  resolveServiceRequest, dismissNotice,
  fetchThreadMessages, sendRestaurantMessage, markThreadRead, subscribeRestaurantMessages,
  type LiveNotification, type PortalMessage,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const QUICK_REPLIES = ['On it', 'Almost done', 'Your order is ready', 'Sorry for the wait', 'Not available today'];
const ICON: Record<string, string> = { order: '🧾', service: '🙋', chat: '💬', notice: '📣' };

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const clock = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  catch { return ''; }
};

export function Notifications() {
  const { restaurant, can } = usePartner();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { items, error, reload, setItems } = useLiveNotifications(restaurant.id, 'page');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [reply, setReply] = useState<{ tableId: string; label: string } | null>(null);

  /** ?table=<id> -- from an older link or a push: open that conversation. */
  const wanted = params.get('table');
  useEffect(() => {
    if (!wanted) return;
    const it = (items ?? []).find((i) => i.kind === 'chat' && i.tableId === wanted);
    setReply({ tableId: wanted, label: it?.tableLabel ?? 'Conversation' });
    params.delete('table');
    setParams(params, { replace: true });
  }, [wanted]);

  const done = async (n: LiveNotification) => {
    if (!n.requestId || busyId) return;
    setBusyId(n.id); setActionError('');
    try {
      await resolveServiceRequest(n.requestId);
      // Leave at once rather than waiting for the realtime echo.
      setItems((prev) => (prev ?? []).filter((x) => x.id !== n.id));
    } catch {
      setActionError('Could not mark that done. Please try again.');
    } finally { setBusyId(null); reload(); }
  };

  /** A Menutha notice: "Got it" clears it everywhere. */
  const gotIt = async (n: LiveNotification) => {
    if (!n.noticeId || busyId) return;
    setBusyId(n.id); setActionError('');
    try {
      await dismissNotice(n.noticeId);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== n.id));
    } catch {
      setActionError('Could not clear that. Please try again.');
    } finally { setBusyId(null); reload(); }
  };

  const act = (n: LiveNotification) => {
    if (n.kind === 'notice') { gotIt(n); return; }
    if (n.kind === 'order' && n.orderId) nav(`/partner/orders?order=${n.orderId}`);
    else if (n.kind === 'chat' && n.tableId) setReply({ tableId: n.tableId, label: n.tableLabel ?? 'Table' });
    else if (n.kind === 'service') done(n);
  };

  const list = (items ?? []).filter((n) => n.kind !== 'chat' || can('table_chat'));

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Notifications</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>
        {list.length > 0 ? `${list.length} need${list.length === 1 ? 's' : ''} you` : 'All caught up'}
      </h1>
      <p className="dim" style={{ fontSize: 13.5, marginBottom: 14 }}>
        New orders, guest requests and messages. Anything handled leaves this list.
      </p>

      {(error || actionError) && (
        <p style={{ color: 'var(--error)', fontSize: 13.5, marginBottom: 10 }} role="alert">{actionError || error}</p>
      )}

      {items === null && !error && <Spinner label="Loading notifications…" />}

      {items !== null && list.length === 0 && (
        <div className="glass" style={{ padding: 18 }}>
          <strong>Nothing needs you right now.</strong>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
            New orders, guest requests and diner messages appear here the moment they arrive.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {list.map((n) => (
          <div key={n.id} className="glass thread-row" style={{ cursor: 'default' }}>
            <span className="thread-head">
              <span aria-hidden>{ICON[n.kind]}</span>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</strong>
              {n.kind === 'chat' && (n.count ?? 0) > 1 && <span className="thread-badge">{n.count}</span>}
              <time className="dim" style={{ fontSize: 12, marginLeft: 'auto', flex: '0 0 auto' }}>{ago(n.at)}</time>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={n.kind === 'notice' ? 'dim' : 'thread-last dim'}
                style={{ flex: 1, minWidth: 0, ...(n.kind === 'notice' ? { whiteSpace: 'pre-line', fontSize: 13.5 } : {}) }}>
                {n.body}
              </span>
              {n.kind === 'notice' && n.link && (
                <button className="btn btn-glass" style={{ flex: '0 0 auto', minHeight: 40, padding: '6px 14px' }}
                  onClick={() => nav(n.link!)}>
                  See details
                </button>
              )}
              <button
                className={n.kind === 'service' || n.kind === 'notice' ? `btn btn-primary${busyId === n.id ? ' is-busy' : ''}` : 'btn btn-glass'}
                style={{ flex: '0 0 auto', minHeight: 40, padding: '6px 16px' }}
                disabled={busyId === n.id}
                onClick={() => act(n)}
              >
                {n.kind === 'service' ? 'Done' : n.kind === 'notice' ? 'Got it' : n.kind === 'chat' ? 'Reply' : 'View order'}
              </button>
            </span>
          </div>
        ))}
      </div>

      {reply && (
        <ReplySheet
          restaurantId={restaurant.id}
          tableId={reply.tableId}
          label={reply.label}
          onClose={() => { setReply(null); reload(); }}
        />
      )}
    </div>
  );
}

/** One conversation, over the list. Always shows the NEWEST messages. */
function ReplySheet({ restaurantId, tableId, label, onClose }: {
  restaurantId: string; tableId: string; label: string; onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<PortalMessage[] | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sendingRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchThreadMessages(tableId)
      .then((m) => { if (alive) setMsgs(m); })
      .catch(() => { if (alive) { setMsgs([]); setErr('Could not load that conversation.'); } });
    markThreadRead(tableId).catch(() => {});
    const off = subscribeRestaurantMessages(restaurantId, (m) => {
      if (m.table_id !== tableId) return;
      setMsgs((prev) => (prev ?? []).some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]);
      if (m.from_role === 'diner') markThreadRead(tableId).catch(() => {});
    });
    return () => { alive = false; off(); };
  }, [restaurantId, tableId]);

  // Pin the log to its newest line whenever one arrives.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length]);

  const deliver = async (body: string, clearBox: boolean) => {
    if (!body.trim() || sendingRef.current) return;
    sendingRef.current = true; setBusy(true); setErr('');
    try {
      await sendRestaurantMessage(restaurantId, tableId, body);
      if (clearBox) setText('');
    } catch { setErr('Could not send that. Please try again.'); }
    finally { sendingRef.current = false; setBusy(false); }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Conversation with ${label}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 className="display" style={{ fontSize: 22, flex: 1 }}>{label}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>Replies reach the diner’s phone straight away.</p>
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="chat-log" role="log" aria-live="polite" ref={logRef}>
          {msgs === null && <p className="dim chat-empty">Loading…</p>}
          {msgs !== null && msgs.length === 0 && !err && <p className="dim chat-empty">No messages yet.</p>}
          {(msgs ?? []).map((m) => {
            const mine = m.from_role !== 'diner';
            return (
              <div key={m.id} className={mine ? 'chat-row mine' : 'chat-row'}>
                <div className={mine ? 'chat-bubble mine' : 'chat-bubble'}>
                  <span>{m.body}</span>
                  <time className="chat-time">{clock(m.created_at)}</time>
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-quick">
          {QUICK_REPLIES.map((qr) => (
            <button key={qr} type="button" className="chip" disabled={busy} onClick={() => deliver(qr, false)}>{qr}</button>
          ))}
        </div>
        <div className="chat-compose">
          <input
            className="code-input"
            value={text}
            maxLength={500}
            placeholder="Type a reply…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') deliver(text, true); }}
            aria-label="Type a reply"
            autoFocus
          />
          <button
            className={`btn btn-primary${busy ? ' is-busy' : ''}`}
            disabled={busy || !text.trim()}
            onClick={() => deliver(text, true)}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
