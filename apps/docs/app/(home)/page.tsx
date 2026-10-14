import Link from 'next/link';
import { ArrowRight, Bot, Boxes, Database, ShieldCheck } from 'lucide-react';

const areas = [
  {
    title: 'Applications',
    description:
      'Operational guides for every bot, monitor, agent, and CRM extension.',
    href: '/docs/bots',
    icon: Bot,
  },
  {
    title: 'Architecture',
    description:
      'Service boundaries, shared packages, pipelines, and deployment model.',
    href: '/docs/architecture',
    icon: Boxes,
  },
  {
    title: 'Integrations',
    description:
      'Telegram, PostgreSQL, Ollama, Notion, Google, and provider contracts.',
    href: '/docs/integrations',
    icon: Database,
  },
  {
    title: 'Operations',
    description:
      'Private-by-default deployment, secrets, migrations, health, and rollback.',
    href: '/docs/development/deployment',
    icon: ShieldCheck,
  },
];

export default function HomePage() {
  return (
    <main className="watcher-grid flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Git-versioned · private by default · source-grounded
          </p>
          <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-7xl">
            Operate Watcher with confidence.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-fd-muted-foreground sm:text-xl">
            Technical documentation for the private Telegram automation stack:
            architecture, application behavior, integrations, configuration, and
            production operations.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white transition hover:bg-emerald-500"
            >
              Read the docs <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-lg border bg-fd-background/80 px-5 py-3 font-medium transition hover:bg-fd-accent"
            >
              Local setup
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {areas.map(({ title, description, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-2xl border bg-fd-card/80 p-5 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg"
            >
              <Icon className="mb-8 size-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
