import React from 'react';

/** A deliberately generic 404 — nothing here hints that /admin is anything. */
export function NotFound() {
  return (
    <div className="mc-root mc-center">
      <div className="mc-404">
        <p className="mc-404-code">404</p>
        <h1 className="mc-display">Page not found</h1>
        <p className="mc-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <a className="mc-btn mc-btn-primary" href="/">Go to menutha.com</a>
      </div>
    </div>
  );
}
