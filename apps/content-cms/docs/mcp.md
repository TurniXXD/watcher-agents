# MCP server

The CMS exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server through the official `@payloadcms/plugin-mcp`, so AI assistants (Claude
Code, Claude Desktop, Cursor, …) can read and draft content.

- Endpoint: `POST /api/mcp` (Streamable HTTP; `GET` always answers
  "Method not allowed").
- Toggle: `MCP_ENABLED` (default `true`). When `false` the endpoint is not
  registered; the API-key collection stays so the schema and migrations do not
  change.

## Exposed tools

| Collection / global | MCP capabilities     |
| ------------------- | -------------------- |
| `events`            | find, create, update |
| `articles`          | find, create, update |
| `news`              | find, create, update |
| `publications`      | find, create, update |
| `social-posts`      | find, create, update |
| `media`             | find                 |
| `sources`           | find                 |
| `pending-updates`   | find                 |
| `settings` (global) | find                 |

Users, bot credentials, ingestion runs, and ingestion records are never
exposed. Deletes and the plugin's experimental tools (auth, config, collection,
and job editing) are disabled. The capabilities are configured in
`src/mcp/plugin.ts`.

## Security model

- Each request needs `Authorization: Bearer <key>`. Keys live in the
  `payload-mcp-api-keys` collection, stored as an HMAC index keyed by
  `PAYLOAD_SECRET` (rotating the secret invalidates every MCP key).
- A key is bound to the user who created it and cannot be re-bound. Every tool
  runs through the Local API with `overrideAccess: false` as that user, so the
  same collection access and editorial workflow hooks apply as in the admin:
  editors can draft content, only
  reviewers and admins can approve, reject, archive, publish, or unpublish.
- Each key additionally carries per-collection checkboxes, so a key can be
  narrowed further (for example read-only) in the admin.
- In production `/api/mcp` stays behind Cloudflare Access; remote clients need
  a service token (see [deployment](deployment.md)).

## Creating a key

1. Sign in at `/admin`, open _MCP → API Keys_, and create a key.
2. Give it a label, tick only the capabilities the client needs, enable the API
   key, and copy it.
3. Revoke a key by deleting it or disabling its API key.

## Client configuration

Claude Code (local development):

```bash
claude mcp add --transport http content-cms http://localhost:3100/api/mcp --header "Authorization: Bearer <key>"
```

Production through Cloudflare Access adds the service-token headers:

```json
{
  "mcpServers": {
    "content-cms": {
      "type": "http",
      "url": "https://cms.vantuch.dev/api/mcp",
      "headers": {
        "Authorization": "Bearer ${CONTENT_CMS_MCP_KEY}",
        "CF-Access-Client-Id": "${CF_ACCESS_CLIENT_ID}",
        "CF-Access-Client-Secret": "${CF_ACCESS_CLIENT_SECRET}"
      }
    }
  }
}
```

Keep keys in the client's environment, never in committed files.
