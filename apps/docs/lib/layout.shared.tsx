import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitHubUrl } from './shared';

export const baseOptions = (): BaseLayoutProps => ({
  nav: {
    title: (
      <span className="flex items-center gap-2 font-semibold">
        <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.8)]" />
        {appName}
      </span>
    ),
  },
  githubUrl: gitHubUrl,
  links: [
    { text: 'Applications', url: '/docs/bots' },
    { text: 'Deployment', url: '/docs/development/deployment' },
  ],
});
