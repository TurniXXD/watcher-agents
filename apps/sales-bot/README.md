# Sales Bot

Private lead-research and outreach-preparation Telegram service. It discovers Czech businesses through ARES and Geoapify, optionally falls back to Google Places, crawls public company websites, records evidence, scores leads, prepares grounded drafts, and integrates with Quickly and Twenty when configured.

`/link_to_lead <url>` (with `/lead` as an alias) safely researches a public website, shows the sourced preview in Telegram, and waits for an explicit 15-minute Save/Cancel confirmation. Only Save idempotently creates or updates the Twenty Company and its research Note. A lost or expired confirmation writes nothing and can be restarted safely. `/lead_analysis`, `/lead_refresh`, `/leads_today`, `/leads_next`, and `/leads_stats` expose the same research workflow. On working days at `SALES_INTELLIGENCE_TIME` (09:00 by default in `Europe/Prague`) the bot reserves up to five oldest eligible uncontacted leads, avoids repeatedly choosing already suggested records, refreshes stale research, and queues one summary plus detailed Telegram reports. Saturday and Sunday create no batch and send nothing. Suggestion never marks a lead contacted and never sends outreach.

Research and drafting never imply authorization to contact a recipient. Quickly enrollment fails closed unless a qualified, approved lead has valid `RECIPIENT_OPT_IN` or `EXISTING_CUSTOMER` evidence, no suppression, an enabled campaign, and available capacity. Public contact data or Telegram approval alone is not consent.

## Commands

Use `/start`, `/help`, or `/sales_help` for the current guide. Sales commands include `/sales_status`, `/sales_campaigns`, `/sales_prospects`, `/sales_search`, `/sales_searches`, `/sales_search_stop`, `/sales_find`, `/sales_calls`, `/sales_leads`, `/sales_lead`, `/sales_approve`, `/sales_reject`, and `/sales_run`.

Use `/link_to_lead https://firma.cz` to research one website. Review the Telegram report and press **Přidat do CRM** to write it to Twenty, or **Zrušit** to leave Twenty unchanged. `/lead` remains a backward-compatible alias.

`/sales_prospects <business type> | <location> | [limit]` is the campaign-free CRM workflow. The limit defaults to 10 and is bounded to 1–20. It searches ARES and Geoapify with the optional Google Places fallback, keeps candidates that have a website, audits their public website for an email and explicit `tel:` link, and creates or updates a Twenty Company plus a linked contact Note. PostgreSQL prevents repeat creation by provider identity, normalized domain, and IČO; a previously completed prospect is skipped. This command never enrolls a lead in Quickly and never sends outreach.

`/sales_search <business type> | <location> | <limit>` accepts a Czech or English business type. Known aliases are translated deterministically to Geoapify and CZ-NACE (for example, `farmy` becomes `commercial.food_and_drink.farm` plus CZ-NACE `01`); other descriptions are mapped by the configured Ollama model to a validated Geoapify category catalog. Every immediate and periodic result prints the categories actually used, followed by a compact lead list with clickable company and provider-detail links when valid public HTTP(S) URLs are available. Explicit `geo:<category>` and `nace:<code>` inputs remain supported.

The backward-compatible contact commands are `/network_help`, `/network_add`, `/network_search`, `/network_contact`, `/network_update`, `/network_intro`, `/network_followups`, and `/network_context`.

Personal contacts and business-card reading are also available in the separate [Networking Bot](../networking-bot/README.md). Sales keeps the same commands for backward compatibility, while networking events and event follow-ups belong only to Networking Bot.

## Configuration

Start from [sales](../../deploy/presets/sales-bot.env.example), [Quickly](../../deploy/presets/quickly.env.example), and [Twenty](../../deploy/presets/twenty.env.example) presets. Keep populated copies only in private runtime configuration. API/webhook tokens must be distinct. Twenty is required for `/sales_prospects` and inbound-mailbox ingestion; Quickly and the Google Sheets contact group remain optional until those integrations are enabled.

Apply the [Twenty Sales App](../twenty-sales-app/README.md) before enabling custom Twenty fields.

## New inbound CRM lead notifications

The applied Twenty Sales App listens for `person.created` and calls the private
Sales Bot webhook. Sales Bot sends a durable Telegram notification to every
authorized operator only when the new Person has one of these verified origins:

- Twenty actor source `EMAIL` (a Person created from synchronized incoming mail);
- explicit Person `leadSource=CONTACT_FORM` or a documented contact-form alias.

Manual Person creation is ignored. API-created Sales imports such as ARES,
Geoapify, Google Places, and `/sales_prospects` are also ignored unless an
external contact-form integration explicitly tags the Person as a contact-form
lead. The webhook event and per-chat outbox rows are idempotent, survive a bot
restart, and retry bounded Telegram delivery without sending duplicate alerts.

After applying the Twenty app, set its secret
`SALES_INBOUND_WEBHOOK_TOKEN` to exactly the Sales Bot
`SALES_WEBHOOK_TOKEN`. The non-secret `SALES_INBOUND_WEBHOOK_URL` defaults to
`http://sales-bot:4050/v1/webhooks/twenty/inbound-lead`, which is reachable from
the production Twenty worker on the private Compose network. Override it only
when Twenty and Sales Bot do not share that network.

## Dedicated inbound lead mailbox

Sales Bot can poll a dedicated TLS IMAP mailbox such as `hello@vantuch.dev` in
read-only mode. Configure the following values together only in the private
`deploy/runtime/sales-bot.env` source and rerender/redeploy:

```dotenv
SALES_INBOUND_EMAIL_ADDRESS=hello@vantuch.dev
SALES_INBOUND_IMAP_HOST=imap.example.com
SALES_INBOUND_IMAP_PORT=993
SALES_INBOUND_IMAP_USER=hello@vantuch.dev
SALES_INBOUND_IMAP_PASSWORD=<mailbox-app-password>
SALES_INBOUND_IMAP_MAILBOX=INBOX
SALES_INBOUND_IMAP_LOOKBACK_DAYS=7
SALES_INBOUND_IMAP_MAX_MESSAGES=100
SALES_INBOUND_IMAP_INTERVAL_MINUTES=5
```

The mailbox requires `TWENTY_BASE_URL` and `TWENTY_API_KEY`. Enable
`TWENTY_APP_FIELDS_ENABLED` after applying the Twenty Sales App so the Person is
explicitly typed as a lead. The mailbox writes the descriptive source marker
`MAILBOX_EMAIL` or `MAILBOX_CONTACT_FORM`; those markers intentionally do not
trigger the Twenty `person.created` webhook because the mailbox pipeline owns
the single durable Telegram notification. Ollama is optional: when configured,
it returns a validated structured classification; otherwise deterministic
contact-form, automation, and intent rules are used.

Messages are bounded by size/count, attachments are not processed, and the bot
never marks mail read or sends a reply. It respects an external `Reply-To`, so a
contact-form envelope from the website still creates the visitor as the CRM
Person. Clear automated/bulk mail is ignored and recorded idempotently.
Relevant messages and uncertain human enquiries are upserted by grounded e-mail
address, receive an analysis Note, and queue one durable Telegram notification
per authorized operator. Message-ID (or a stable content hash) plus PostgreSQL
constraints prevent duplicate CRM alerts across polls and restarts.
