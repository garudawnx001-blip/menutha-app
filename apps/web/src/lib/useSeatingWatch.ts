/**
 * PHASE 3: THE SEATING ENDS WHEN THE PASS ENDS.
 *
 * Replaces the old "is the whole table settled?" poll, which needed every
 * diner's name and number to answer. The server now answers one question --
 * is this phone's visit pass still good? -- and it stops being good the moment
 * the counter settles or clears the table, or after four hours.
 *
 * A failed check (offline) never logs anyone out.
 */
import { useEffect } from 'react';
import { checkVisit } from './api';
import { startPoll } from './poll';
import { useStore } from '../store';

export function useSeatingWatch() {
  const { session, endSeating } = useStore();
  useEffect(() => {
    if (!session?.visit || session.demo) return;
    let alive = true;
    const check = () =>
      checkVisit(session)
        .then((r) => { if (alive && r === 'expired') endSeating(); })
        .catch(() => {});
    check();
    const t = startPoll(check, 8000);
    return () => { alive = false; t.stop(); };
    // endSeating deliberately not a dependency (store is memoised on cart).
  }, [session?.visit]);
}
