import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env';
import { mcpCollections } from '../mcp/plugin';

const base = {
  DATABASE_URI: 'postgresql://user:pass@localhost:5432/cms',
  NODE_ENV: 'test' as const,
  PAYLOAD_SECRET: 'x'.repeat(32),
};

describe('MCP server', () => {
  it('never exposes credentials, ingestion logs, or users', () => {
    const slugs = Object.keys(mcpCollections);
    for (const hidden of [
      'users',
      'ingestion-clients',
      'ingestion-runs',
      'ingestion-records',
    ])
      expect(slugs).not.toContain(hidden);
  });

  it('never allows deletes', () => {
    for (const { enabled } of Object.values(mcpCollections))
      expect(enabled.delete).toBe(false);
  });

  it('is enabled by default and can be switched off', () => {
    expect(loadEnv({ ...base }).MCP_ENABLED).toBe(true);
    expect(loadEnv({ ...base, MCP_ENABLED: 'false' }).MCP_ENABLED).toBe(false);
  });
});
