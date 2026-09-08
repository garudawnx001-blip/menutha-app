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
 *   screen=chat-loading     Chat, loading
 *   screen=chat-empty       Chat, no conversations
 *   screen=chat-error       Chat, load failed (with retry)
 *   screen=chat-populated   Chat, three conversations
 *   screen=chat-thread      Chat, one open conversation
 *   screen=settings         Restaurant settings (fixture restaurant)
 *   screen=plan             Plan & billing (fixture plans, ids blank)
 *
 * Without ?screen it lists them.
 */
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '../../components';
import { PartnerLogin } from './PartnerLogin';
import { Register } from './Register';
import { ChatView, type ThreadsState } from './Chat';
import { Settings } from './Settings';
import { PlanScreen } from './PlanScreen';
import { PartnerPreviewProvider } from './PartnerShell';
import type { ChatThread, PortalMessage } from '../../lib/portalApi';

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

const THREADS: ChatThread[] = [
  { table_id: 't6', table_label: 'Table 6', last_body: 'Can the biryani be made less spicy for one of us?', last_at: ago(2), last_from: 'diner', unread: 2, guest_name: 'Priya' },
  { table_id: 't2', table_label: 'Table 2', last_body: 'On its way — two minutes.', last_at: ago(14), last_from: 'restaurant', unread: 0, guest_name: null },
  { table_id: 'parcel', table_label: 'Parcel · #41', last_body: 'Please add extra raita, thank you!', last_at: ago(41), last_from: 'diner', unread: 0, guest_name: 'Arun' },
];

const MESSAGES: PortalMessage[] = [
  { id: 'm1', from_role: 'diner', body: 'Hi, can the biryani be made less spicy for one of us?', created_at: ago(9), guest_name: 'Priya', read_at: ago(8) },
  { id: 'm2', from_role: 'restaurant', body: 'Of course — mild for one, regular for the other?', created_at: ago(8), guest_name: null, read_at: null },
  { id: 'm3', from_role: 'diner', body: 'Yes please. And one extra plate.', created_at: ago(2), guest_name: 'Priya', read_at: null },
];

function ChatFixture({ state, thread }: { state: ThreadsState; thread?: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="partner-page" style={{ maxWidth: 760, margin: '0 auto', padding: '8px 20px 40px' }}>
      <ChatView
        state={state}
        onRetry={() => {}}
        openTable={thread ? 't6' : null}
        openLabel="Table 6"
        onOpen={() => {}}
        onBack={() => {}}
        messages={thread ? MESSAGES : []}
        messagesError=""
        text={text}
        onText={setText}
        onSend={() => setText('')}
        sending={false}
      />
    </div>
  );
}

export function DesignPreview() {
  const [params] = useSearchParams();
  const screen = params.get('screen');

  switch (screen) {
    case 'login': return <PartnerLogin />;
    case 'signup': return <PartnerLogin />;
    case 'finish': return <Register previewPhase="finish" />;
    case 'chat-loading': return <ChatFixture state={{ kind: 'loading' }} />;
    case 'chat-empty': return <ChatFixture state={{ kind: 'ready', threads: [] }} />;
    case 'chat-error': return <ChatFixture state={{ kind: 'error', message: 'The chat tables are not set up on the server yet.' }} />;
    case 'chat-populated': return <ChatFixture state={{ kind: 'ready', threads: THREADS }} />;
    case 'chat-thread': return <ChatFixture state={{ kind: 'ready', threads: THREADS }} thread />;
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
    ['chat-loading', 'Chat · loading'], ['chat-empty', 'Chat · empty'], ['chat-error', 'Chat · error'],
    ['chat-populated', 'Chat · conversations'], ['chat-thread', 'Chat · open thread'],
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
