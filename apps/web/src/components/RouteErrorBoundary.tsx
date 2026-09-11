/**
 * THE THING THAT STOPS ONE BAD LINE TAKING THE WHOLE SITE.
 *
 * Three separate outages in one day, all the identical shape: a render-time
 * exception somewhere inside the routes, no boundary above it, and React 18
 * unmounting the entire root. Not a degraded page -- a white screen, with the
 * log-in form gone too.
 *
 *   1. a useMemo dependency array reading a `const` still in its temporal
 *      dead zone, on the plan screen
 *   2. `o.items.reduce(...)` where a loader had cast rows past the type
 *      checker without mapping them, on the orders board
 *   3. the same unmount again, from the same missing guard one line down
 *
 * Every one of them was a small mistake. What made each an OUTAGE was that
 * there was nothing between the mistake and the root. A pilot restaurant
 * mid-service could not open the log-in page because of a fault on a screen
 * they were not looking at.
 *
 * This does not make the bugs go away and is not meant to. It changes the
 * blast radius from "the product is gone" to "this panel is broken, the rest
 * still works" -- which is the difference between a restaurant carrying on
 * and a restaurant stopping.
 *
 * WHY A CLASS. There is still no hook equivalent of componentDidCatch; error
 * boundaries are the one part of React that has to be a class, so this is not
 * a style choice.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It does not retry by itself. A render that threw once usually throws
 *     again on the same data, and a boundary that loops is a frozen tab.
 *     The owner presses the button; that is a real decision to re-render.
 *   - It does not swallow the error. It goes to the console in full, because
 *     the next person debugging this needs the stack, not our summary.
 *   - It does not try to interpret the failure for the owner. They cannot act
 *     on a TypeError, so they get what they CAN act on: reload, or go to a
 *     screen that works.
 */
import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Full fidelity, on purpose. Whoever is looking at a white-ish panel at
    // 2am wants the component stack, not a tidied-up message.
    console.error('[RouteErrorBoundary] render failed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page center-fill fade-in" role="alert">
        <div className="state-card" style={{ maxWidth: 460 }}>
          <strong>This screen ran into a problem</strong>
          <p className="dim">
            Nothing has been lost and your restaurant is still running — it is just
            this page that failed to load. Try again, or go to your orders.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {/* A full reload rather than clearing the error state. Re-rendering
                the same broken data would throw again immediately; a reload at
                least refetches it. */}
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload this page
            </button>
            <button
              className="btn btn-glass"
              onClick={() => { window.location.href = '/partner/orders'; }}
            >
              Go to orders
            </button>
          </div>
          {/* The message, quietly, for when an owner is reading it out over the
              phone to whoever is fixing it. */}
          <p className="dim" style={{ fontSize: 11.5, marginTop: 10, wordBreak: 'break-word' }}>
            {String(error?.message ?? error)}
          </p>
        </div>
      </div>
    );
  }
}
