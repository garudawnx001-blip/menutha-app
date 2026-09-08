/**
 * The diner's conversation with the restaurant.
 *
 * "Call for service should also have a chat option." The canned asks answer
 * "bring me X"; this answers everything else, which turns out to be most of
 * what someone at a table actually wants to say -- is this spicy, can you make
 * it Jain, we are four not two. A diner who cannot ask gets up and finds
 * someone, which is the thing the whole product exists to stop.
 *
 * IN THE SAME SHEET AS THE ASKS, not a second chip beside it. He crossed out
 * one floating control on this screen already; adding another next to the one
 * that replaced it would undo that. "Ask for" and "Say something" are two tabs
 * of one sheet, because from the diner's side they are one intention: get the
 * restaurant's attention.
 *
 * LIVE IN BOTH DIRECTIONS. The insert subscription is filtered on this table
 * server-side, so a reply appears without a refresh and without shipping this
 * diner every other table's messages.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  fetchTableMessages, sendTableMessage, subscribeTableMessages, type ChatMessage,
} from '../lib/api';
import type { Session } from '../lib/types';
import { useT } from '../lib/i18n';

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
};

export function TableChat({ session }: { session: Session }) {
  const t = useT();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchTableMessages(session)
      .then((m) => { if (alive) setMsgs(m); })
      .catch(() => { if (alive) setFailed(t('chat.loadFail')); });

    /* DEDUPED ON ID. The sender also receives their own INSERT back over the
       channel, so appending blindly would show every sent message twice. */
    const off = subscribeTableMessages(session, (m) => {
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    });
    return () => { alive = false; off(); };
  }, [session.table?.id]);

  // Follow the conversation down as it grows, the way every chat does.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setFailed('');
    try {
      await sendTableMessage(session, body);
      // Cleared on success only: a failed send that empties the box loses what
      // the person typed, and they have to remember it to try again.
      setText('');
    } catch {
      setFailed(t('chat.sendFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-wrap">
      <div className="chat-log" role="log" aria-live="polite">
        {msgs.length === 0 && !failed && (
          <p className="dim" style={{ fontSize: 13, textAlign: 'center', padding: '18px 8px' }}>
            {t('chat.empty')}
          </p>
        )}
        {msgs.map((m) => {
          const mine = m.from_role === 'diner';
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

      {failed && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 6 }}>{failed}</p>}

      <div className="chat-compose">
        <input
          className="code-input"
          value={text}
          maxLength={500}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          aria-label={t('chat.placeholder')}
        />
        <button
          className={`btn btn-glass${busy ? ' is-busy' : ''}`}
          disabled={busy || !text.trim()}
          onClick={send}
        >
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}
