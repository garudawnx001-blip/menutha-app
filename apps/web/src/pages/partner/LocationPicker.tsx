/**
 * WHERE THE OUTLET IS — typed, or taken from the device, and shown on a map.
 *
 * Two ways in, because neither works on its own. An owner sitting IN the
 * restaurant gets the pin exactly right with one tap; an owner setting up a
 * second outlet from head office has to type the address. Both end at the same
 * pair of numbers on the restaurant row.
 *
 * THE MAP IS OPTIONAL AND THE PAGE SAYS SO. Google Maps needs a key, and the
 * key arrives from Google Cloud on its own schedule. Without it this renders
 * a plain card that states the saved coordinates rather than a grey box with
 * a JavaScript error behind it -- setting the location must work whether or
 * not the map can be drawn, because the location is what the diner needs and
 * the map is only how it is confirmed.
 *
 * Available on EVERY tier, by decision: knowing where a restaurant is is not
 * a premium feature.
 */
import React, { useEffect, useRef, useState } from 'react';

/** Build-time, and public by design: a Maps browser key is visible in any
 *  page that uses one. It is protected by an HTTP-referrer restriction in
 *  Google Cloud, not by secrecy. Set as an Actions VARIABLE, not a Secret --
 *  a Secret is masked at build and would inline as an empty string. */
const MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export interface LatLng { lat: number; lng: number }

/** Loads the Maps script once per page, no matter how many maps ask. */
let mapsPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (!MAPS_KEY) return Promise.reject(new Error('no key'));
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&libraries=geocoding`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { mapsPromise = null; reject(new Error('Maps failed to load')); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/** The pin, drawn when a key exists and the coordinates are real. */
function MapPin({ at, label }: { at: LatLng; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    loadMaps()
      .then(() => {
        if (dead || !box.current) return;
        const g = (window as any).google.maps;
        const map = new g.Map(box.current, {
          center: at, zoom: 16, mapTypeControl: false, streetViewControl: false,
        });
        new g.Marker({ position: at, map, title: label });
      })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [at.lat, at.lng, label]);

  if (!MAPS_KEY || failed) {
    return (
      <div className="state-card" style={{ padding: 18 }}>
        <strong>Location saved</strong>
        <p className="dim">
          {at.lat.toFixed(6)}, {at.lng.toFixed(6)}
          <br />
          The map appears once the Google Maps key is set on this deployment.
        </p>
      </div>
    );
  }
  return <div ref={box} style={{ height: 220, borderRadius: 12, overflow: 'hidden' }} />;
}

export function LocationPicker({ value, label, onChange, onLabelChange }: {
  value: LatLng | null;
  label: string;
  onChange: (v: LatLng | null) => void;
  onLabelChange: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  /** The device's own position. One tap, and the most accurate answer there
   *  is -- but it needs permission, and a refusal is a normal outcome rather
   *  than a fault, so it is said plainly. */
  const useMyLocation = () => {
    setError(''); setNote('');
    if (!('geolocation' in navigator)) { setError('This browser cannot report a location.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setNote('Pin set from this device.');
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED
          ? 'Location permission was declined — type the address instead.'
          : 'Could not read this device’s location — type the address instead.');
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
      setNote(`Found: ${res.formatted_address}`);
    } catch (e: any) {
      setError(MAPS_KEY
        ? 'That address could not be found. Try adding the city, or use this device’s location.'
        : 'Address lookup needs the Google Maps key. Use this device’s location, or set the key.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <label className="field-label" htmlFor="loc-address">Address or landmark</label>
      <input
        id="loc-address" className="code-input"
        placeholder="Station Road, Hospet"
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

      {note && <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>{note}</p>}
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}

      <div style={{ marginTop: 12 }}>
        {value
          ? <MapPin at={value} label={label || 'Your restaurant'} />
          : (
            <div className="state-card" style={{ padding: 18 }}>
              <strong>No pin yet</strong>
              <p className="dim">
                Diners see this on the menu, so they know which outlet they are ordering from.
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
