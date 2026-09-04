/** Session (scanned table) + cart, persisted to localStorage so a page reload
 *  mid-meal keeps the table context — one restaurant per session, switching
 *  restaurants clears the cart (same rule as the mobile app's cartSlice). */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CartLine, Guest, Session } from './lib/types';

const SESSION_KEY = 'menutha-web:session';
const CART_KEY = 'menutha-web:cart';

interface Store {
  session: Session | null;
  cart: CartLine[];
  startSession: (s: Session) => void;
  setGuest: (guest: Guest) => void;
  /** #Q -- mark that this device ordered in the current seating. */
  noteOrdered: () => void;
  /** #Q -- settlement ended the seating: forget who was sitting here. */
  endSeating: () => void;
  endSession: () => void;
  addLine: (line: CartLine) => void;
  setQty: (index: number, qty: number) => void;
  clearCart: () => void;
}

const Ctx = createContext<Store | null>(null);

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * HOW LONG A DINER'S NAME AND PHONE STAY VALID. His rule: two hours after a
 * scan, settled or not, re-scanning asks again.
 *
 * WHY THIS IS NOT THE BILL'S CLOCK, and the distinction is the whole point.
 * Identity going stale is harmless -- the diner types their name again. A BILL
 * expiring would delete a debt. So this only ever clears `guest`; it never
 * touches an order, a session boundary, or anything the restaurant is owed.
 * Unsettled orders stay open indefinitely and are the counter's business, via
 * the uncleared-table alert that already exists.
 *
 * Two hours is his number and it fits the use: a table turns over well inside
 * it, so the next party is asked who they are rather than inheriting the last
 * party's name.
 */
const IDENTITY_TTL_MS = 2 * 60 * 60 * 1000;

/** Drop a stale identity at read time.
 *
 *  A session with no stamp is treated as EXPIRED rather than fresh: every
 *  session saved before this shipped would otherwise be immortal, which is the
 *  exact behaviour the rule exists to end. The cost is one extra name prompt,
 *  once, for anyone mid-session at deploy. */
function withFreshIdentity(s: Session | null): Session | null {
  if (!s?.guest) return s;
  const age = Date.now() - (s.guestAt ?? 0);
  if (age <= IDENTITY_TTL_MS) return s;
  const { guest, guestAt, ...rest } = s;
  return rest as Session;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(
    () => withFreshIdentity(read<Session>(SESSION_KEY)),
  );
  const [cart, setCart] = useState<CartLine[]>(() => read<CartLine[]>(CART_KEY) ?? []);

  useEffect(() => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }, [session]);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const store = useMemo<Store>(
    () => ({
      session,
      cart,
      startSession: (s) => {
        setSession((prev) => {
          if (prev?.restaurant.id !== s.restaurant.id) setCart([]);
          // Carry the diner identity across re-scans (same person, new table)
          // -- but only while it is still fresh. Past IDENTITY_TTL_MS a
          // re-scan is treated as a new party, which is exactly the case this
          // rule exists for: the next diner at that table should be asked who
          // they are rather than silently inheriting the last one's name.
          const carried = withFreshIdentity(prev);
          return carried?.guest && !s.guest
            ? { ...s, guest: carried.guest, guestAt: carried.guestAt }
            : s;
        });
      },
      // Stamped on the way in, so the clock starts when the diner actually
      // identifies themselves rather than when the page happened to load.
      setGuest: (guest) => setSession((prev) => (prev ? { ...prev, guest, guestAt: Date.now() } : prev)),
      /** #Q — this device has ordered in this seating, so settlement may end it. */
      noteOrdered: () => setSession((prev) => (prev ? { ...prev, orderedAt: Date.now() } : prev)),
      /**
       * #Q — THE SEATING IS OVER, so the diner is logged out of it.
       *
       * Clears WHO, and only who: the name, the identity stamp and the ordered
       * marker. The table, the restaurant and the QR token stay, so the phone
       * still shows the right restaurant and the next scan of the same table
       * does not have to resolve the token again -- it simply asks for a name
       * first, which is the point.
       *
       * The cart goes with it. A half-built cart belonging to the party that
       * just paid and left has no owner, and letting it survive into the next
       * seating is how somebody else's dosa ends up on your bill.
       */
      endSeating: () => {
        setSession((prev) => {
          if (!prev) return prev;
          const { guest, guestAt, orderedAt, ...rest } = prev;
          return rest as Session;
        });
        setCart([]);
      },
      endSession: () => {
        setSession(null);
        setCart([]);
      },
      addLine: (line) => {
        setCart((prev) => {
          const key = (l: CartLine) => l.menuItemId + '|' + [...l.optionIds].sort().join(',');
          const i = prev.findIndex((l) => key(l) === key(line));
          if (i >= 0) {
            const next = [...prev];
            next[i] = { ...next[i], qty: next[i].qty + line.qty };
            return next;
          }
          return [...prev, line];
        });
      },
      setQty: (index, qty) => {
        setCart((prev) =>
          qty <= 0
            ? prev.filter((_, i) => i !== index)
            : prev.map((l, i) => (i === index ? { ...l, qty } : l)),
        );
      },
      clearCart: () => setCart([]),
    }),
    [session, cart],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
