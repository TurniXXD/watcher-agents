'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

export const Mermaid = ({
  chart,
  label = 'Workflow diagram',
}: {
  chart: string;
  label?: string;
}) => {
  const id = useId().replaceAll(':', '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let active = true;
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: resolvedTheme === 'dark' ? 'dark' : 'neutral',
        fontFamily: 'inherit',
        flowchart: { useMaxWidth: false },
      });
      const result = await mermaid.render(`watcher-${id}`, chart.trim());
      if (active) setSvg(result.svg);
    });
    return () => {
      active = false;
    };
  }, [chart, id, resolvedTheme]);

  if (!svg) {
    return <div className="my-6 h-40 animate-pulse rounded-xl bg-fd-muted" />;
  }

  return (
    <div
      aria-label={label}
      className="my-6 overflow-x-auto rounded-xl border bg-fd-card p-4 [&_svg]:mx-auto [&_svg]:max-w-none"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
