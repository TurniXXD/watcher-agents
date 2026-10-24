# Watcher Sales CRM Twenty App

This versioned Twenty App extends the native Company, Person, and Opportunity
objects with Watcher sales metadata. It also adds first-class Relationship and
Referral objects with bidirectional relations and a `person.created` logic
function for private inbound-lead notifications. It contains no scraping,
outreach sending, or payment automation.

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

Configure the application variables in the installed app:

| Variable                      | Value                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `SALES_INBOUND_WEBHOOK_URL`   | Defaults to the private Compose endpoint `http://sales-bot:4050/v1/webhooks/twenty/inbound-lead`. |
| `SALES_INBOUND_WEBHOOK_TOKEN` | Required secret; set it to the exact value of Sales Bot `SALES_WEBHOOK_TOKEN`.                    |

The logic function notifies only for a Person created by Twenty's `EMAIL` actor
or a Person explicitly tagged with `leadSource=CONTACT_FORM` (including the
documented `WEB_FORM`, `WEB_CONTACT_FORM`, `WEBSITE_CONTACT_FORM`, and
`INBOUND_CONTACT_FORM` aliases). Manual records and ordinary API imports are
ignored. Each event uses the stable workspace and Person IDs, so Twenty retries
and webhook redelivery cannot enqueue a duplicate Telegram alert.

The configurable `WEB_DEVELOPMENT_REFERRAL_PERCENTAGE` defaults to 10. It is
metadata only: no commission becomes payable automatically, and paid revenue is
never inferred from an opportunity stage.
