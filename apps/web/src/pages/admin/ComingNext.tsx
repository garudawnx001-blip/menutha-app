import React from 'react';
import { Icon } from './icons';

const COPY: Record<string, { icon: string; title: string; text: string; points: string[] }> = {
  plans: { icon: 'tag', title: 'Plans & Prices', text: 'See and change what each plan costs and what it includes.',
    points: ['Prices for Basic, Growth and Enterprise', 'Monthly, 3, 6 and 12-month options', 'What each plan switches on'] },
  offers: { icon: 'sparkle', title: 'Offers', text: 'Create discount codes and special offers for restaurants.',
    points: ['Discount codes', 'Longer free trials for a campaign', 'See who used an offer'] },
  payments: { icon: 'card', title: 'Payments', text: 'Every payment from every restaurant, in one list.',
    points: ['Money received this month', 'Failed payments to follow up', 'Download for your accountant'] },
  website: { icon: 'globe', title: 'Website', text: 'Edit menutha.com without touching code.',
    points: ['Home page text and photos', 'Pricing page', 'Contact details'] },
  settings: { icon: 'phone', title: 'App Settings', text: 'Control the Menutha app for everyone.',
    points: ['Announcements to all restaurants', 'Turn features on or off', 'Minimum app version'] },
};

/** A friendly placeholder: says what is coming instead of a broken page. */
export function ComingNext({ section }: { section: keyof typeof COPY }) {
  const c = COPY[section];
  return (
    <div className="mc-page">
      <div className="mc-heading"><div><h1 className="mc-display">{c.title}</h1></div></div>
      <section className="mc-coming">
        <span className="mc-coming-icon"><Icon name={c.icon} size={30} /></span>
        <span className="mc-coming-badge">Coming next</span>
        <h2 className="mc-display">{c.text}</h2>
        <ul>{c.points.map((p) => <li key={p}><Icon name="check" size={16} />{p}</li>)}</ul>
        <p className="mc-muted">This part of the console is being built. Nothing here can break anything.</p>
      </section>
    </div>
  );
}
