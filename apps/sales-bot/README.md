# Sales Bot

Private lead-research, outreach-preparation, and personal-network Telegram service. It discovers Czech businesses through ARES and Geoapify, optionally falls back to Google Places, crawls public company websites, records evidence, scores leads, prepares grounded drafts, and integrates with Quickly and Twenty when configured.

Research and drafting never imply authorization to contact a recipient. Quickly enrollment fails closed unless a qualified, approved lead has valid `RECIPIENT_OPT_IN` or `EXISTING_CUSTOMER` evidence, no suppression, an enabled campaign, and available capacity. Public contact data or Telegram approval alone is not consent.

## Personal network

The same bot can manage an existing private Google Sheet named `Contact list` with the exact configured eleven columns. A dedicated Google service account should be shared only with that spreadsheet. Adds, updates, and business-card imports always show a preview and require save confirmation.

## Commands

Sales commands include `/sales_status`, `/sales_campaigns`, `/sales_search`, `/sales_searches`, `/sales_search_stop`, `/sales_find`, `/sales_calls`, `/sales_leads`, `/sales_lead`, `/sales_approve`, `/sales_reject`, and `/sales_run`.

Network commands include `/network_help`, `/network_add`, `/network_search`, `/network_contact`, `/network_update`, `/network_intro`, `/network_followups`, and `/network_context`.

## Configuration

Start from [sales](../../deploy/presets/sales-bot.env.example), [Quickly](../../deploy/presets/quickly.env.example), and [Twenty](../../deploy/presets/twenty.env.example) presets. Keep populated copies only in private runtime configuration. API/webhook tokens must be distinct. Quickly and Twenty credentials remain optional until those integrations are enabled.

Apply the [Twenty Sales App](../twenty-sales-app/README.md) before enabling custom Twenty fields.
