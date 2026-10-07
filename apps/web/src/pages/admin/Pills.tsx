import React from 'react';
import type { Lifecycle } from './adminApi';
import { LIFECYCLE_LABEL, titleCase } from './format';

export function StatusPill({ lifecycle }: { lifecycle: Lifecycle }) {
  return <span className={`mc-pill mc-pill-${lifecycle}`}><i aria-hidden />{LIFECYCLE_LABEL[lifecycle]}</span>;
}

export function TierPill({ tier }: { tier: string | null }) {
  const t = (tier || 'none').toLowerCase().replace(/[^a-z0-9]/g, '');
  return <span className={`mc-tier mc-tier-${t}`}>{titleCase(tier || 'none')}</span>;
}
