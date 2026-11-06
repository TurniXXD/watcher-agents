import React from 'react';

export const Logo = () => (
  <div className="vch-logo">
    <span aria-hidden className="vch-mark">
      V
    </span>
    <span>Vantuch Content Hub</span>
  </div>
);

export const Icon = () => (
  <span aria-label="Vantuch Content Hub" className="vch-mark" role="img">
    V
  </span>
);

const links: Array<[string, string]> = [
  [
    'Events needing review',
    '/admin/collections/events?where[reviewStatus][equals]=needs_review',
  ],
  [
    'Freshly ingested events',
    '/admin/collections/events?where[reviewStatus][equals]=ingested',
  ],
  [
    'Pending bot updates',
    '/admin/collections/pending-updates?where[status][equals]=pending',
  ],
  [
    'Failed ingestion runs',
    '/admin/collections/ingestion-runs?where[status][in][0]=failed&where[status][in][1]=partial',
  ],
];

export const DashboardIntro = () => (
  <section className="vch-dashboard-intro">
    <strong>Editorial queue</strong>
    <p>
      Bot content arrives unpublished. Approve it before publishing; reject
      anything inaccurate or not cleared for republication.
    </p>
    <ul>
      {links.map(([label, href]) => (
        <li key={href}>
          <a href={href}>{label}</a>
        </li>
      ))}
    </ul>
  </section>
);
