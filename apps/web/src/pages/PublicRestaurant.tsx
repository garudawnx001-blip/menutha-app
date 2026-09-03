/** /r/{slug} — public, indexable restaurant page: profile, VIEW-ONLY menu
 *  with filters, table reservation. No cart, no ordering — ordering requires
 *  a real table QR and is enforced server-side in place_order. Injects
 *  schema.org Restaurant JSON-LD + per-page meta for SEO. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { inr } from '../lib/types';
import { Spinner, VegMark, Wordmark } from '../components';

interface PublicDish { category: string; category_sort: number; name: string; description: string | null; price: number; is_veg: boolean; photo_url: string | null }
interface PublicRest {
  id: string; slug: string; name: string; city: string | null; address: string | null;
  cuisine_tags: string | null; logo_url: string | null; banner_url: string | null;
  open_time: string | null; close_time: string | null; is_open: boolean;
  own_website: string | null; rating: number | null; menu: PublicDish[];
}

/** Diner-facing headings for the three kinds the portal files uploads under.
 *  Menu card first: it is what a diner opening a restaurant page came for.
 *  Ordered here rather than by the query, so the page reads the same however
 *  the rows happen to come back. */
const SHOWCASE_KINDS: [string, string][] = [
  ['menu_card', 'The menu card'],
  ['certificate', 'Licences & awards'],
  ['photo', 'About this place'],
];

export function PublicRestaurant() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState<PublicRest | null>(null);
  const [failed, setFailed] = useState(false);
  const [diet, setDiet] = useState<'all' | 'veg' | 'nonveg'>('all');
  const [cat, setCat] = useState('All');
  const [reserve, setReserve] = useState({ date: '', time: '19:30', party: 2, name: '', phone: '' });
  const [reserved, setReserved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('get_public_restaurant', { p_slug: slug })
      .then(({ data, error: e }) => (e || !data ? setFailed(true) : setR(data as PublicRest)));
  }, [slug]);

  /* The showcase. Loaded SEPARATELY from the restaurant itself and failing
     silently to an empty list, so a page still renders in full if the
     showcase table is not there yet -- which is the state today, until the
     migration is run. A public page that 500s because an optional gallery is
     missing would be a poor trade for a nice-to-have. */
  const [media, setMedia] = useState<{ id: string; url: string; caption: string | null; kind: string }[]>([]);
  useEffect(() => {
    if (!r?.id) return;
    supabase
      .from('restaurant_media')
      .select('id, url, caption, kind, sort_order')
      .eq('restaurant_id', r.id)
      .order('kind')
      .order('sort_order')
      .then(({ data, error: e }) => setMedia(e ? [] : (data ?? []) as any));
  }, [r?.id]);

  // SEO: title, description, and Restaurant JSON-LD.
  useEffect(() => {
    if (!r) return;
    document.title = `${r.name} — menu & reservations | Menutha`;
    const meta = document.querySelector('meta[name="description"]') ?? (() => {
      const m = document.createElement('meta'); m.setAttribute('name', 'description');
      document.head.appendChild(m); return m;
    })();
    meta.setAttribute('content', `${r.name}${r.city ? ', ' + r.city : ''} — live menu${r.cuisine_tags ? ' (' + r.cuisine_tags + ')' : ''}, prices and table reservations on Menutha.`);
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'restaurant-jsonld';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Restaurant',
      name: r.name, address: r.address ?? undefined, servesCuisine: r.cuisine_tags ?? undefined,
      url: location.href, image: r.banner_url ?? undefined,
      aggregateRating: r.rating ? { '@type': 'AggregateRating', ratingValue: r.rating, bestRating: 5 } : undefined,
    });
    document.getElementById('restaurant-jsonld')?.remove();
    document.head.appendChild(ld);
    return () => { document.getElementById('restaurant-jsonld')?.remove(); };
  }, [r]);

  const cats = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of r?.menu ?? []) if (!seen.has(d.category)) seen.set(d.category, d.category_sort);
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }, [r]);

  const visible = (r?.menu ?? []).filter((d) =>
    (diet === 'all' || (diet === 'veg' ? d.is_veg : !d.is_veg)) &&
    (cat === 'All' || d.category === cat));

  const book = async () => {
    if (!reserve.date || !reserve.name.trim() || reserve.phone.replace(/\D/g, '').length < 10) {
      setError('Date, your name, and a 10-digit phone are needed.'); return;
    }
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('create_reservation', {
      p_slug: slug, p_party_size: reserve.party,
      p_booked_for: new Date(`${reserve.date}T${reserve.time}:00`).toISOString(),
      p_guest_name: reserve.name.trim(), p_guest_phone: reserve.phone.replace(/\D/g, ''),
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setReserved(true);
  };

  if (failed) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <p className="muted">This restaurant page doesn’t exist (or isn’t live yet).</p>
      </div>
    );
  }
  if (!r) return <Spinner label="Loading…" />;

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/restaurants')}>← Back</button>
        <span className="badge gold">Menu is view-only — order by scanning the table QR</span>
      </div>

      <div className="menu-hero">
        {r.banner_url
          ? <div className="hero-bg" style={{ backgroundImage: `url(${r.banner_url})` }} />
          : <div className="hero-bg" style={{ background: 'radial-gradient(120% 130% at 15% 0%, rgba(201,160,78,0.35), transparent 55%), linear-gradient(150deg, #1b5e3f, #0f3323)' }} />}
        <div className="hero-scrim" />
        <div className="hero-body">
          <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 38px)' }}>{r.name}</h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {r.city && <span className="badge">{r.city}</span>}
            <span className={r.is_open === false ? 'badge closed' : 'badge open'}>{r.is_open === false ? 'Closed now' : 'Open'}</span>
            {r.rating && <span className="badge gold">★ {r.rating}</span>}
            {r.open_time && r.close_time && <span className="badge">{r.open_time.slice(0, 5)}–{r.close_time.slice(0, 5)}</span>}
          </div>
          {r.cuisine_tags && <p style={{ fontSize: 13.5, marginTop: 8, opacity: 0.9 }}>{r.cuisine_tags}</p>}
        </div>
      </div>

      {(r.address || r.own_website) && (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>
          {r.address}
          {r.own_website && <> · <a href={r.own_website} target="_blank" rel="noreferrer">website ↗</a></>}
        </p>
      )}

      <div className="sticky-tools">
        <div className="chip-row" style={{ paddingTop: 10 }}>
          <button className={diet === 'veg' ? 'chip active' : 'chip'} onClick={() => setDiet(diet === 'veg' ? 'all' : 'veg')}>
            <span className="veg-mark" /> Veg
          </button>
          <button className={diet === 'nonveg' ? 'chip active' : 'chip'} onClick={() => setDiet(diet === 'nonveg' ? 'all' : 'nonveg')}>
            <span className="veg-mark nonveg" /> Non-veg
          </button>
          {['All', ...cats].map((c) => (
            <button key={c} className={cat === c ? 'chip active' : 'chip'} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="menu-grid" style={{ marginTop: 6 }}>
        {visible.map((d, i) => (
          <div key={i} className="dish glass" style={{ cursor: 'default' }}>
            {d.photo_url
              ? <img className="dish-photo" src={d.photo_url} alt="" loading="lazy" />
              : <span className="dish-photo placeholder" aria-hidden>🍛</span>}
            <span style={{ flex: 1 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <VegMark veg={d.is_veg} />
                <h3>{d.name}</h3>
              </span>
              {d.description && <span className="desc">{d.description}</span>}
              <span className="price">{inr(d.price)}</span>
            </span>
          </div>
        ))}
      </div>

      {/* THE SHOWCASE, between the menu and the booking form.
          That position is deliberate: someone has just read what the place
          serves and is deciding whether to come. The room, the menu card and
          the licences are exactly what answers that, and they answer it
          immediately before the button that asks them to commit.
          Silent when the restaurant has added nothing, so a page that has not
          been filled in does not show an empty gallery. */}
      {/* GROUPED THE WAY THE OWNER FILED IT.
          The portal makes them choose a kind for every upload -- menu card,
          certificate, photo -- and this page then poured all three into one
          strip under one heading, so the choice they were asked to make changed
          nothing a diner ever saw. The three are also not the same thing to a
          reader: a menu card is what they came for, a certificate is what makes
          them trust the place, and a photo is atmosphere. Menu first for that
          reason. A kind with nothing in it prints no heading. */}
      {SHOWCASE_KINDS.map(([kind, heading]) => {
        const of = media.filter((m) => m.kind === kind);
        if (!of.length) return null;
        return (
          <React.Fragment key={kind}>
            <h2 className="cat-heading">{heading}</h2>
            <div className="showcase-strip">
              {of.map((m) => (
                <figure key={m.id} className="showcase-item">
                  <img src={m.url} alt={m.caption ?? heading} loading="lazy" />
                  {m.caption && <figcaption>{m.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </React.Fragment>
        );
      })}

      <h2 className="cat-heading">Reserve a table</h2>
      {reserved ? (
        <div className="glass" style={{ padding: 18, borderColor: 'var(--primary)' }}>
          <strong style={{ color: 'var(--success)' }}>✓ Reservation requested</strong>
          <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
            {r.name} has it on their board — they may call {reserve.phone} to confirm.
          </p>
        </div>
      ) : (
        <div className="glass" style={{ padding: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="code-input" type="date" style={{ flex: 1, minWidth: 140 }} min={new Date().toISOString().slice(0, 10)}
            value={reserve.date} onChange={(e) => setReserve({ ...reserve, date: e.target.value })} />
          <input className="code-input" type="time" style={{ width: 110 }}
            value={reserve.time} onChange={(e) => setReserve({ ...reserve, time: e.target.value })} />
          <select className="code-input" style={{ width: 120, padding: '12px' }} value={reserve.party}
            onChange={(e) => setReserve({ ...reserve, party: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} guest{n > 1 ? 's' : ''}</option>)}
          </select>
          <input className="code-input" style={{ flex: 1, minWidth: 130 }} placeholder="Your name"
            value={reserve.name} onChange={(e) => setReserve({ ...reserve, name: e.target.value })} />
          <input className="code-input" style={{ flex: 1, minWidth: 140 }} inputMode="tel" placeholder="Phone"
            value={reserve.phone} onChange={(e) => setReserve({ ...reserve, phone: e.target.value })} />
          <button className="btn btn-primary btn-block" disabled={busy} onClick={book}>
            {busy ? 'Booking…' : 'Request reservation'}
          </button>
          {error && <p style={{ color: 'var(--error)', fontSize: 13.5 }}>{error}</p>}
          <p className="dim" style={{ fontSize: 12 }}>Reservation only — no pre-order, no payment, no cancellation online.</p>
        </div>
      )}
    </div>
  );
}
