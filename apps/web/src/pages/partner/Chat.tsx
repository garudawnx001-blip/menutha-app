/**
 * Chat — the restaurant's side of the diner conversations.
 *
 * A LIST OF TABLES, NOT A LIST OF PEOPLE. A conversation belongs to a table
 * because that is the thing the diner scanned and the thing the counter can
 * walk to. Names ride along when a diner gave one, but the address is the
 * table -- "Table 6 wants the biryani less spicy" is actionable.
 *
 * ONE REALTIME CHANNEL for the whole restaurant, shared by the thread list and
 * the open conversation.
 *
 * CONTAINER + VIEW. `Chat` owns the data (queries, realtime, sending);
 * `ChatView` owns the drawing and takes every state as a prop. That is what
 * lets the design preview render loading, empty, error and populated without
 * a database behind it -- and what stopped the bug he photographed: the old
 * page set an error string on failure but never cleared the "loading" state,
 * so a failed query showed a red line AND a spinner for ever. Now the list
 * state is one value -- loading | error | ready -- and the view draws
 * exactly one of them.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchChatThreads, fetchThreadMessages, sendRestaurantMessage, markThreadRead,
  subscribeRestaurantMessages, type ChatThread, type PortalMessage,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
};

export type ThreadsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; threads: ChatThread[] };

export interface ChatViewProps {
  state: ThreadsState;
  onRetry: () => void;
  openTable: string | null;
  openLabel: string;
  onOpen: (tableId: string) => void;
  onBack: () => void;
  messages: PortalMessage[];
  messagesError: string;
  text: string;
  onText: (t: string) => void;
  onSend: () => void;
  sending: boolean;
}

/** The drawing. Every state is a prop; nothing here talks to the network. */
export function ChatView(p: ChatViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [p.messages.length]);

  const inThread = !!p.openTable;

  return (
    <div className="fade-in">
      <div className="section-head">
        <p className="overline">Messages</p>
        <h1 className="display section-title">{inThread ? p.openLabel : 'Chat'}</h1>
        <p className="dim section-sub">
          {inThread
            ? 'Replies reach the diner’s phone straight away.'
            : 'Conversations with the tables in your restaurant.'}
        </p>
      </div>

      {!inThread && (
        <>
          {p.state.kind === 'loading' && (
            <div className="state-card" role="status" aria-live="polite">
              <div className="spinner" />
              <p className="dim">Loading conversations…</p>
            </div>
          )}

          {p.state.kind === 'error' && (
            <div className="state-card state-error" role="alert">
              <div className="state-mark" aria-hidden>!</div>
              <strong>Couldn’t load conversations</strong>
              <p className="dim">{p.state.message}</p>
              <button className="btn btn-glass" onClick={p.onRetry}>Try again</button>
            </div>
          )}

          {p.state.kind === 'ready' && p.state.threads.length === 0 && (
            <div className="state-card">
              <div className="state-mark state-mark-soft" aria-hidden>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12c0 4.1-4 7.4-9 7.4-1.2 0-2.3-.2-3.3-.5L4 21l1.3-3.6C3.9 16 3 14.1 3 12c0-4.1 4-7.4 9-7.4s9 3.3 9 7.4z" />
                </svg>
              </div>
              <strong>No conversations yet</strong>
              <p className="dim">When a diner messages you from the menu on their phone, it appears here the moment they send it.</p>
            </div>
          )}

          {p.state.kind === 'ready' && p.state.threads.length > 0 && (
            <div className="thread-list">
              {p.state.threads.map((th) => (
                <button key={th.table_id} className="glass thread-row" onClick={() => p.onOpen(th.table_id)}>
                  <span className="thread-head">
                    <strong>{th.table_label}</strong>
                    {th.unread > 0 && <span className="thread-badge">{th.unread}</span>}
                    <time className="dim thread-time">{time(th.last_at)}</time>
                  </span>
                  <span className="thread-last dim">
                    {th.last_from === 'diner' ? '' : 'You: '}{th.last_body}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {inThread && (
        <>
          <button className="btn btn-link thread-back" onClick={p.onBack}>← All conversations</button>
          <div className="glass thread-pane">
            {p.messagesError && <p className="field-error" role="alert">{p.messagesError}</p>}
            <div className="chat-log" role="log" aria-live="polite">
              {p.messages.length === 0 && !p.messagesError && (
                <p className="dim chat-empty">No messages in this conversation yet.</p>
              )}
              {p.messages.map((m) => {
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
            <div className="chat-compose">
              <input
                className="code-input"
                value={p.text}
                maxLength={500}
                placeholder="Type a reply…"
                onChange={(e) => p.onText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') p.onSend(); }}
                aria-label="Type a reply"
              />
              <button
                className={`btn btn-glass${p.sending ? ' is-busy' : ''}`}
                disabled={p.sending || !p.text.trim()}
                onClick={p.onSend}
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

/** The data. */
export function Chat() {
  const { restaurant } = usePartner();
  const [params] = useSearchParams();
  const [state, setState] = useState<ThreadsState>({ kind: 'loading' });
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<PortalMessage[]>([]);
  const [msgsError, setMsgsError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** Read inside the realtime callback, which is created once and would
   *  otherwise close over the first value of openTable for ever. */
  const openRef = useRef<string | null>(null);
  openRef.current = openTable;

  /** `quiet` keeps the list on screen while it refreshes behind a realtime
   *  event; only the first load and a retry show the loading state. */
  const loadThreads = (quiet = false) => {
    if (!quiet) setState({ kind: 'loading' });
    return fetchChatThreads(restaurant.id)
      .then((threads) => setState({ kind: 'ready', threads }))
      .catch((e: any) => setState({
        kind: 'error',
        // The likeliest cause is the chat migration not having run yet
        // (message.table_id / read_at missing): say the real thing.
        message: /table_id|read_at|column/i.test(String(e?.message))
          ? 'The chat tables are not set up on the server yet.'
          : (e?.message || 'Check your connection and try again.'),
      }));
  };

  useEffect(() => { loadThreads(); }, [restaurant.id]);

  useEffect(() => {
    const off = subscribeRestaurantMessages(restaurant.id, (m) => {
      loadThreads(true);
      if (m.table_id && m.table_id === openRef.current) {
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        markThreadRead(m.table_id).catch(() => {});
      }
    });
    return off;
  }, [restaurant.id]);

  const open = async (tableId: string) => {
    setOpenTable(tableId);
    setMsgs([]);
    setMsgsError('');
    try {
      setMsgs(await fetchThreadMessages(tableId));
      await markThreadRead(tableId);
      loadThreads(true);
    } catch { setMsgsError('Could not load that conversation.'); }
  };

  /** ?table=<id> opens that conversation -- what makes an alert land on the
   *  exact thread. Waits for the list because the header wants the label. */
  const wanted = params.get('table');
  useEffect(() => {
    if (!wanted || state.kind !== 'ready') return;
    const th = state.threads.find((t) => t.table_id === wanted);
    if (th && openRef.current !== wanted) open(th.table_id);
  }, [wanted, state]);

  const send = async () => {
    const body = text.trim();
    if (!body || !openTable || busy) return;
    setBusy(true); setMsgsError('');
    try {
      await sendRestaurantMessage(restaurant.id, openTable, body);
      setText('');
    } catch { setMsgsError('Could not send that. Please try again.'); }
    finally { setBusy(false); }
  };

  const current = state.kind === 'ready' ? state.threads.find((t) => t.table_id === openTable) : undefined;

  return (
    <ChatView
      state={state}
      onRetry={() => loadThreads()}
      openTable={openTable}
      openLabel={current?.table_label ?? 'Conversation'}
      onOpen={open}
      onBack={() => { setOpenTable(null); loadThreads(true); }}
      messages={msgs}
      messagesError={msgsError}
      text={text}
      onText={setText}
      onSend={send}
      sending={busy}
    />
  );
}
