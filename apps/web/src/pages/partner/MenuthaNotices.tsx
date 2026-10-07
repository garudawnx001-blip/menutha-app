/**
 * NEWS FROM MENUTHA, at the top of every portal page until it is read.
 *
 * A plan's price or features changed, or an offer was published for this
 * restaurant. The same notice is also an item in Notifications and a push on
 * the owner's phone; this banner exists because Notifications is a Growth
 * feature, and an owner on Basic must still hear about their own plan.
 *
 * "Got it" clears it on every device (dismiss_notice). Live via realtime, so a
 * notice sent while the portal is open appears without a refresh.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { dismissNotice } from '../../lib/portalApi';

interface Notice { id: string; title: string; body: string; link: string | null; created_at: string }

export function MenuthaNotices({ restaurantId }: { restaurantId: string }) {
  const nav = useNavigate();
  const [list, setList] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('restaurant_notice')
      .select('id, title, body, link, created_at')
      .eq('restaurant_id', restaurantId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!error) setList((data ?? []) as Notice[]);
  }, [restaurantId]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`menutha-notices-${Math.random().toString(36).slice(2, 8)}:${restaurantId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_notice', filter: `restaurant_id=eq.${restaurantId}` },
        () => { void load(); })
      .subscribe();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { void supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); };
  }, [restaurantId, load]);

  const gotIt = async (id: string) => {
    setBusy(id);
    try {
      await dismissNotice(id);
      setList((l) => l.filter((n) => n.id !== id));
    } catch { /* stays; the next load shows the truth */ }
    finally { setBusy(null); }
  };

  if (list.length === 0) return null;
  const [first, ...rest] = list;
  const expanded = open === first.id;

  return (
    <div className="glass" role="status" aria-live="polite"
      style={{ padding: 14, margin: '10px 0', borderColor: 'var(--gold)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 18, lineHeight: '22px' }}>📣</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="overline" style={{ display: 'block', marginBottom: 2 }}>From Menutha</span>
          <strong style={{ display: 'block', fontSize: 15 }}>{first.title}</strong>
          <p className="muted" style={{
            fontSize: 13.5, margin: '4px 0 0', whiteSpace: 'pre-line',
            ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
          }}>
            {first.body}
          </p>
          {first.body.length > 140 && (
            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 0', minHeight: 0 }}
              onClick={() => setOpen(expanded ? null : first.id)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* One at a time; the next appears after "Got it". Not a link to
            Notifications, which a Basic plan does not include. */}
        {rest.length > 0 && (
          <span className="dim" style={{ fontSize: 12.5, alignSelf: 'center', marginRight: 'auto' }}>
            {rest.length} more after this
          </span>
        )}
        {first.link && (
          <button className="btn btn-glass btn-sm" onClick={() => nav(first.link!)}>See details</button>
        )}
        <button className={`btn btn-primary btn-sm${busy === first.id ? ' is-busy' : ''}`}
          disabled={busy === first.id} onClick={() => gotIt(first.id)}>
          Got it
        </button>
      </div>
    </div>
  );
}
