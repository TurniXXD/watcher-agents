# Watcher Sales CRM Twenty App

This versioned Twenty App extends the native Company, Person, and Opportunity
objects with Watcher sales metadata. It also adds first-class Relationship and
Referral objects with bidirectional relations. It contains no scraping, sending,
or payment automation.

The app targets Twenty `>=2.43.0` and must be applied before setting
`TWENTY_APP_FIELDS_ENABLED=true` in the sales-bot environment.

## Apply to the self-hosted workspace

Authenticate the official Twenty CLI against the browser-facing Twenty URL:

```bash
pnpm --filter @watcher/twenty-sales-app twenty remote:add \
  --as watcher-production \
  --url https://your-twenty.example.com
```

Preview and apply the metadata from the repository root:

```bash
pnpm --filter @watcher/twenty-sales-app twenty plan apps/twenty-sales-app
pnpm --filter @watcher/twenty-sales-app twenty apply --no-delete apps/twenty-sales-app
```

Use `--api-key` with `remote:add` only for a protected non-interactive setup;
never commit the key. `--no-delete` prevents unrelated workspace metadata from
being removed. After a successful apply, create a least-privilege API key for the
sales bot, set `TWENTY_API_KEY`, and enable `TWENTY_APP_FIELDS_ENABLED=true`.

The configurable `WEB_DEVELOPMENT_REFERRAL_PERCENTAGE` defaults to 10. It is
metadata only: no commission becomes payable automatically, and paid revenue is
never inferred from an opportunity stage.
