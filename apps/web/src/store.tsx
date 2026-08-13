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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => read<Session>(SESSION_KEY));
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
          // Carry the diner identity across re-scans (same person, new table).
          return prev?.guest && !s.guest ? { ...s, guest: prev.guest } : s;
        });
      },
      setGuest: (guest) => setSession((prev) => (prev ? { ...prev, guest } : prev)),
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
