import { type MCPPluginConfig, mcpPlugin } from '@payloadcms/plugin-mcp';

const editorial = { find: true, create: true, update: true, delete: false };
const readOnly = { find: true, create: false, update: false, delete: false };

/**
 * Model Context Protocol server at `POST /api/mcp`.
 *
 * Each request authenticates with a per-user API key (`Authorization: Bearer`)
 * stored HMAC-hashed in `payload-mcp-api-keys`. Tools run through the Local API
 * with `overrideAccess: false` as the key's owner, so collection access, the
 * editorial workflow hooks, and role checks (only admins/reviewers approve or
 * publish) apply exactly as in the admin UI. Ingestion credentials, ingestion
 * logs, and users are never exposed; nothing can be deleted over MCP.
 *
 * `disabled` keeps the API-key collection registered so the schema and
 * migrations stay identical whether the endpoint is on or off.
 */
export const mcpCollections = {
  events: {
    enabled: editorial,
    description:
      'Events (Brno and others) with schedule, venue, and review status.',
  },
  articles: {
    enabled: editorial,
    description: 'Long-form editorial articles.',
  },
  news: { enabled: editorial, description: 'News items.' },
  publications: {
    enabled: editorial,
    description: 'Research publications.',
  },
  'social-posts': {
    enabled: editorial,
    description: 'Social media posts.',
  },
  media: {
    enabled: readOnly,
    description: 'Uploaded images and files (read-only).',
  },
  sources: {
    enabled: readOnly,
    description: 'Content sources and attribution (read-only).',
  },
  'pending-updates': {
    enabled: readOnly,
    description: 'Bot-proposed updates awaiting human review (read-only).',
  },
} satisfies NonNullable<MCPPluginConfig['collections']>;

export const contentMcpPlugin = (enabled: boolean) =>
  mcpPlugin({
    disabled: !enabled,
    userCollection: 'users',
    collections: mcpCollections,
    globals: {
      settings: {
        enabled: { find: true, update: false },
        description: 'Site settings.',
      },
    },
    mcp: {
      serverOptions: {
        serverInfo: { name: 'Vantuch Content Hub', version: '1.0.0' },
        instructions:
          'Editorial CMS for vantuch.dev. Create and edit drafts; approval and publishing require a reviewer or admin key owner. Never invent facts or copy full third-party texts; keep attribution.',
      },
    },
  });
