import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.vantuch.dev',
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: 'Watcher Documentation',
    template: '%s · Watcher',
  },
  description:
    'Versioned technical documentation for the Watcher automation monorepo.',
  applicationName: 'Watcher Documentation',
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: 'Watcher Documentation',
    title: 'Watcher Documentation',
    description:
      'Architecture, configuration, integrations, and operations for Watcher.',
    url: siteUrl,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
