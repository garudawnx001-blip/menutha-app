/**
 * Chat — the restaurant's side of the diner conversations.
 *
 * NEW ON THE WEB. The portal has never had a chat of any kind; the app had a
 * manager↔kitchen one, which is going away with staff. What replaces both is
 * the conversation that actually matters to a restaurant: the people sitting
 * at its tables.
 *
 * A LIST OF TABLES, NOT A LIST OF PEOPLE. A conversation belongs to a table
 * because that is the thing the diner scanned and the thing the counter can
 * walk to. Names ride along when a diner gave one, but the address is the
 * table -- "Table 6 wants the biryani less spicy" is actionable, "Priya wants
 * the biryani less spicy" is not.
 *
 * ONE REALTIME CHANNEL for the whole restaurant, shared by the thread list and
 * the open conversation. Three subscriptions to the same rows would be three
 * times the traffic and three places for a reconnect to be missed.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  fetchChatThreads, fetchThreadMessages, sendRestaurantMessage, markThreadRead,
  subscribeRestaurantMessages, type ChatThread, type PortalMessage,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
};

export function Chat() {
  const { restaurant } = usePartner();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<PortalMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  /** Read inside the realtime callback, which is created once and would
   *  otherwise close over the first value of openTable for ever. */
  const openRef = useRef<string | null>(null);
  openRef.current = openTable;

  const loadThreads = () =>
    fetchChatThreads(restaurant.id).then(setThreads).catch(() => setError('Could not load conversations.'));

  useEffect(() => { loadThreads(); }, [restaurant.id]);

  useEffect(() => {
    const off = subscribeRestaurantMessages(restaurant.id, (m) => {
      // The list always moves; the open thread only when the message is its own.
      loadThreads();
      if (m.table_id && m.table_id === openRef.current) {
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        // Reading it as it lands is what stops the badge counting a message
        // the owner is looking at.
        markThreadRead(m.table_id).catch(() => {});
      }
    });
    return off;
  }, [restaurant.id]);

  const open = async (tableId: string) => {
    setOpenTable(tableId);
    setMsgs([]);
    setError('');
    try {
      setMsgs(await fetchThreadMessages(tableId));
      await markThreadRead(tableId);
      loadThreads();
    } catch { setError('Could not load that conversation.'); }
  };

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !openTable || busy) return;
    setBusy(true); setError('');
    try {
      await sendRestaurantMessage(restaurant.id, openTable, body);
      setText('');
    } catch { setError('Could not send that. Please try again.'); }
    finally { setBusy(false); }
  };

  const current = threads?.find((t) => t.table_id === openTable);

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Messages</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>
        {openTable && current ? current.table_label : 'Chat'}
      </h1>
      <p className="dim" style={{ fontSize: 13.5, marginBottom: 14 }}>
        {openTable
          ? 'Replies reach the diner’s phone straight away.'
          : 'Conversations with the tables in your restaurant.'}
      </p>

      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginBottom: 10 }}>{error}</p>}

      {!openTable && (
        <>
          {threads === null && <Spinner label="Loading conversations…" />}
          {threads?.length === 0 && (
            <div className="glass" style={{ padding: 18 }}>
              <strong>No messages yet.</strong>
              <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
                Diners can message you from the menu on their phone — it appears here
                the moment they send it.
              </p>
            </div>
          )}
          <div style={{ display: 'grid', gap: 10 }}>
            {(threads ?? []).map((th) => (
              <button
                key={th.table_id}
                className="glass thread-row"
                onClick={() => open(th.table_id)}
              >
                <span className="thread-head">
                  <strong>{th.table_label}</strong>
                  {th.unread > 0 && <span className="thread-badge">{th.unread}</span>}
                  <time className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{time(th.last_at)}</time>
                </span>
                <span className="thread-last dim">
                  {th.last_from === 'diner' ? '' : 'You: '}{th.last_body}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {openTable && (
        <>
          <button className="chip" style={{ marginBottom: 10 }} onClick={() => { setOpenTable(null); loadThreads(); }}>
            ← All conversations
          </button>
          <div className="glass" style={{ padding: 12 }}>
            <div className="chat-log" role="log" aria-live="polite">
              {msgs.map((m) => {
                const mine = m.from_role !== 'diner';
                return (
                  <div key={m.id} className={mine ? 'chat-row mine' : 'chat-row'}>
                    <div className={mine ? 'chat-bubble mine' : 'chat-bubble'}>
                      <span>{m.body}</span>
                      <time className="chat-time">{time(m.created_at)}</time>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="chat-compose" style={{ marginTop: 10 }}>
              <input
                className="code-input"
                value={text}
                maxLength={500}
                placeholder="Type a reply…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                aria-label="Type a reply"
              />
              <button
                className={`btn btn-glass${busy ? ' is-busy' : ''}`}
                disabled={busy || !text.trim()}
                onClick={send}
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
