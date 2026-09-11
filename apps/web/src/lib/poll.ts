/**
 * A POLL THAT STOPS WHEN NOBODY IS LOOKING.
 *
 * Eleven `setInterval`s run across this app, and on the partner Orders board
 * three of them overlap: the orders themselves every ten seconds, the table
 * signals every eight, and the service strip every eight again. None of them
 * knew whether the tab was even on screen, so a counter PC with the board open
 * behind nine other tabs made three requests every eight seconds, all day,
 * that nobody could see the results of. That is the restaurant's data, the
 * laptop's battery, and our Supabase quota, spent on a hidden tab.
 *
 * `document.hidden` is the signal, and it is the right one: a backgrounded tab
 * is exactly the case where a stale screen costs nothing, because there is no
 * screen. The moment it comes back the poll fires IMMEDIATELY rather than
 * waiting out the remaining interval, so returning to the tab shows current
 * data at once -- which is also better than the old behaviour, where coming
 * back could mean staring at a board up to ten seconds out of date.
 *
 * Deliberately NOT a hook. The eight call sites each have their own `alive`
 * flag, realtime channel, or ref to tear down, and rewriting those effects to
 * fit a hook's shape would risk far more than this saves. `startPoll` is a
 * drop-in for `setInterval` and `.stop()` is a drop-in for `clearInterval`.
 */

export interface Poll {
  /** Stop polling and detach the visibility listener. Idempotent. */
  stop(): void;
}

export function startPoll(fn: () => void, ms: number): Poll {
  let id: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const begin = () => {
    if (stopped || id !== null) return;
    id = setInterval(fn, ms);
  };
  const halt = () => {
    if (id !== null) { clearInterval(id); id = null; }
  };

  const onVisibility = () => {
    if (document.hidden) { halt(); return; }
    // Catch up first, then resume. Waiting out the interval would leave a
    // just-restored tab showing the state it had when it was hidden, which is
    // the one moment somebody is definitely reading it.
    fn();
    begin();
  };

  // Start suspended if the tab is already in the background -- a board opened
  // in a background tab should not poll until it is looked at.
  if (!document.hidden) begin();
  document.addEventListener('visibilitychange', onVisibility);

  return {
    stop() {
      stopped = true;
      halt();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
