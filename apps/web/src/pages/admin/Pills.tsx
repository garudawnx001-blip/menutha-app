import React from 'react';
import type { AdminRestaurant } from './adminApi';
import { DISPLAY_LABEL, displayOf, tierName, type Display } from './format';
import { Icon } from './icons';

const STATUS_ICON: Record<Display, string> = {
  active: 'check', complimentary: 'gift', trialing: 'clock', trial_expired: 'alert',
  grace: 'alert', suspended: 'pause', lapsed: 'x',
};

/** The big status chip: colour + icon + plain words, so it reads at a glance. */
export function StatusChip({ r, size = 'md' }: { r: Pick<AdminRestaurant, 'lifecycle' | 'is_complimentary'>; size?: 'md' | 'lg' }) {
  const d = displayOf(r);
  return (
    <span className={`mc-status mc-status-${d}${size === 'lg' ? ' mc-status-lg' : ''}`}>
      <Icon name={STATUS_ICON[d]} size={size === 'lg' ? 17 : 15} strokeWidth={2.1} />
      {DISPLAY_LABEL[d]}
    </span>
  );
}

export function TierPill({ tier }: { tier: string | null }) {
  const t = (tier || 'none').toLowerCase().replace(/[^a-z0-9]/g, '');
  return <span className={`mc-tier mc-tier-${t}`}>{tierName(tier)}</span>;
}
