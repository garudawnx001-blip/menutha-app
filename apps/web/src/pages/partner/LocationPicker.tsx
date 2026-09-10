/**
 * WHERE THE RESTAURANT IS -- three ways in, one live map, nothing that leaves.
 *
 * The owner can (a) type an address and find it, (b) paste a Google Maps
 * link, or (c) tap the map to drop the pin and drag it to the exact door.
 * All three end in the same place: a pin the diner's menu shows, and a link
 * the diner taps to be driven there.
 *
 * WHAT CHANGED, from the tester's report ("tapping the map redirected out,
 * glitchy"): the map is now ALWAYS drawn (centred on India until there is a
 * pin), the marker is draggable, a tap on the map moves it, and the map's own
 * links out -- points of interest, the info windows -- are switched off.
 * Nothing on this card opens Google Maps; the phone matches (its map is the
 * same page in a WebView).
 *
 * SHORT LINKS. maps.app.goo.gl and goo.gl/maps links carry no coordinates;
 * the browser cannot follow their redirect from here (CORS), so on this
 * surface the link is saved for diners and the pin is set by the address or
 * the map. The phone CAN follow them, and does. A full Google Maps URL is
 * parsed on both.
 */
import React, { useEffect, useRef, useState } from 'react';

const MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export interface LatLng { lat: number; lng: number }

/** Somewhere to look before there is a pin: India, zoomed out. */
const INDIA: LatLng = { lat: 20.5937, lng: 78.9629 };

/** Coordinates out of a Google Maps URL, in every shape Maps hands out. */
export function coordsFromMapsUrl(u: string): LatLng | null {
  const s = u.trim();
  if (!s) return null;
  const pats = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|destination|center)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:[/?,]|$)/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    }
  }
  return null;
}

export const isShortMapsLink = (u: string) =>
  /(^|\/\/)(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(u.trim());

/**
 * Google calls this global on an auth or billing refusal -- the grey map with
 * "this page can't load Google Maps correctly" and the development-only
 * watermark. It is not a script error, so onerror never fires and the map
 * looks broken rather than absent. Recording it lets the picker show the
 * address form instead of a dead tile.
 */
let mapsAuthFailed = false;
(window as any).gm_authFailure = () => { mapsAuthFailed = true; };
export const mapsBlocked = () => mapsAuthFailed;

let mapsPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (!MAPS_KEY) return Promise.reject(new Error('no key'));
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&libraries=geocoding,places`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { mapsPromise = null; reject(new Error('Maps failed to load')); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/**
 * THE LIVE MAP. One instance for the life of the card; the pin moves on it
 * rather than the map being rebuilt. Tap to place, drag to adjust; both
 * report back through onChange.
 */
function LiveMap({ at, label, onChange }: { at: LatLng | null; label: string; onChange: (v: LatLng) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    loadMaps()
      .then(() => {
        if (dead || !box.current || mapRef.current) return;
        const g = (window as any).google.maps;
        const map = new g.Map(box.current, {
          center: at ?? INDIA, zoom: at ? 16 : 5,
          disableDefaultUI: true, zoomControl: true,
          // No POI clicks, no info windows: those are the links that opened
          // Google Maps from inside the card.
          clickableIcons: false, gestureHandling: 'greedy',
        });
        const marker = new g.Marker({ position: at ?? undefined, map: at ? map : null, title: label, draggable: true });
        const report = (ll: any) => {
          const v = { lat: Number(ll.lat().toFixed(6)), lng: Number(ll.lng().toFixed(6)) };
          marker.setPosition(v); marker.setMap(map);
          onChangeRef.current(v);
        };
        map.addListener('click', (e: any) => report(e.latLng));
        marker.addListener('dragend', () => report(marker.getPosition()));
        mapRef.current = map; markerRef.current = marker;
      })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pin set from the address or the device: move the marker, don't rebuild.
  useEffect(() => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    if (at) {
      marker.setPosition(at); marker.setMap(map); marker.setTitle(label);
      map.panTo(at); if (map.getZoom() < 15) map.setZoom(16);
    } else {
      marker.setMap(null);
    }
  }, [at?.lat, at?.lng, label]);

  if (!MAPS_KEY || failed || mapsBlocked()) {
    return (
      <div className="state-card" style={{ padding: 18 }}>
        <strong>{at ? 'Location saved' : 'No pin yet'}</strong>
        <p className="dim">
          {at ? `${at.lat.toFixed(6)}, ${at.lng.toFixed(6)}` : 'Diners see this on the menu, so they know which outlet they are ordering from.'}
          <br />
          {mapsBlocked()
            ? ' Google refused to draw the map for this key. That is a Google Cloud setting, not this site: billing has to be on for the project, the Maps JavaScript and Places APIs enabled, and menutha.com allowed under the key2019s HTTP referrers.'
            : ' The map appears once the Google Maps key is set on this deployment.'}
        </p>
      </div>
    );
  }
  return <div ref={box} style={{ height: 260, borderRadius: 12, overflow: 'hidden' }} />;
}

export function LocationPicker({ value, label, onChange, onLabelChange, mapsUrl, onMapsUrlChange }: {
  value: LatLng | null;
  label: string;
  onChange: (v: LatLng | null) => void;
  onLabelChange: (s: string) => void;
  /** The link a diner taps. Optional: pages without the column omit it. */
  mapsUrl?: string;
  onMapsUrlChange?: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const addrRef = useRef<HTMLInputElement>(null);

  /**
   * PLACES ON THE ADDRESS FIELD.
   *
   * Bound once, to the live input, and left alone: Autocomplete keeps its own
   * session token, and rebuilding it on every keystroke both loses the session
   * and bills each request separately. The listener writes through the same
   * two callbacks a click on the map uses, so a searched pin and a dropped pin
   * are the same event as far as the rest of the form is concerned.
   *
   * Wrapped in try/catch and gated on `places` actually being present, because
   * a key with Maps enabled but Places switched off loads the script fine and
   * then throws here -- which would take the whole panel down over a feature
   * that is meant to be a convenience.
   */
  useEffect(() => {
    let ac: any = null;
    let listener: any = null;
    loadMaps()
      .then(() => {
        const g = (window as any).google;
        if (!g?.maps?.places?.Autocomplete || !addrRef.current || mapsBlocked()) return;
        ac = new g.maps.places.Autocomplete(addrRef.current, {
          fields: ['geometry', 'name', 'formatted_address'],
          componentRestrictions: { country: 'in' },
        });
        listener = ac.addListener('place_changed', () => {
          const p = ac.getPlace();
          if (!p?.geometry?.location) return;
          onChange({
            lat: Number(p.geometry.location.lat().toFixed(6)),
            lng: Number(p.geometry.location.lng().toFixed(6)),
          });
          onLabelChange(p.formatted_address || p.name || '');
          setNote('Pin set from the search. Save to keep it.');
        });
      })
      .catch(() => { /* no key, or the script is blocked -- the fallback covers it */ });
    return () => { if (listener && (window as any).google) (window as any).google.maps.event.removeListener(listener); };
    // Bound once on purpose; the callbacks are read through the closure above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    setError(''); setNote('');
    if (!('geolocation' in navigator)) { setError('This browser cannot report a location.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setNote('Pin set from this device. Drag it to the exact door if it is off.');
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED
          ? 'Location permission was declined — type the address or tap the map instead.'
          : 'Could not read this device’s location — type the address or tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  /** The typed address, turned into a pin by Google's geocoder. */
  const findAddress = async () => {
    const q = label.trim();
    if (!q) { setError('Type the address first.'); return; }
    setError(''); setNote(''); setBusy(true);
    try {
      await loadMaps();
      const g = (window as any).google.maps;
      const res: any = await new Promise((resolve, reject) => {
        new g.Geocoder().geocode({ address: q }, (r: any, status: string) => {
          if (status === 'OK' && r?.[0]) resolve(r[0]); else reject(new Error(status));
        });
      });
      const loc = res.geometry.location;
      onChange({ lat: Number(loc.lat().toFixed(6)), lng: Number(loc.lng().toFixed(6)) });
      setNote(`Found: ${res.formatted_address}. Drag the pin if it is not quite right.`);
    } catch {
      setError(MAPS_KEY
        ? 'That address could not be found. Try adding the city, tap the map, or use this device’s location.'
        : 'Address lookup needs the Google Maps key. Use this device’s location, or set the key.');
    } finally { setBusy(false); }
  };

  /** A pasted Google Maps link: the pin from its coordinates, when it has them. */
  const onLink = (s: string) => {
    onMapsUrlChange?.(s);
    setError('');
    const c = coordsFromMapsUrl(s);
    if (c) { onChange(c); setNote('Pin set from the link. Drag it if it is not quite right.'); return; }
    if (isShortMapsLink(s)) {
      setNote('Saved for diners. A short link carries no position — set the pin by address, by tapping the map, or paste the full link from the browser’s address bar.');
    } else if (s.trim()) {
      setNote('');
    }
  };

  return (
    <div>
      <label className="field-label" htmlFor="loc-address">Address or landmark</label>
      {/* Type-ahead, not just a geocode on Enter. The picker had a search --
          Find on map -- but it only ran once you had typed the whole thing and
          guessed right. Places suggests as you type and returns the exact
          coordinates of the place chosen, so the pin lands without anyone
          dragging it. Enter still geocodes, for a key without Places. */}
      <input
        ref={addrRef}
        id="loc-address" className="code-input"
        placeholder="Search your restaurant, or type the address"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && findAddress()}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button type="button" className={`btn btn-ghost${busy ? ' is-busy' : ''}`} disabled={busy} onClick={findAddress}>
          Find on map
        </button>
        <button type="button" className={`btn btn-ghost${busy ? ' is-busy' : ''}`} disabled={busy} onClick={useMyLocation}>
          Use my current location
        </button>
        {value && (
          <button type="button" className="btn btn-link" onClick={() => { onChange(null); setNote(''); }}>
            Clear pin
          </button>
        )}
      </div>

      {onMapsUrlChange && (
        <>
          <label className="field-label" htmlFor="loc-link" style={{ marginTop: 12 }}>
            Google Maps link <span className="dim">(optional)</span>
          </label>
          <input
            id="loc-link" className="code-input" inputMode="url"
            placeholder="https://maps.app.goo.gl/…"
            value={mapsUrl ?? ''}
            onChange={(e) => onLink(e.target.value)}
          />
          <p className="dim" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Open your restaurant in Google Maps, tap Share, paste it here. Diners tap it to navigate;
            a full link also sets the pin.
          </p>
        </>
      )}

      {note && <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>{note}</p>}
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}

      <div style={{ marginTop: 12 }}>
        <LiveMap at={value} label={label || 'Your restaurant'} onChange={onChange} />
        {MAPS_KEY && (
          <p className="dim" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {value ? 'Drag the pin to the exact door, or tap the map to move it.' : 'Tap the map to drop the pin.'}
          </p>
        )}
      </div>
    </div>
  );
}
