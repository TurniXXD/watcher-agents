const scheduleExample = '/schedule 0 8 * * * Europe/Prague';

export const publicationsHelp = `/about — what the publications bot does and how to use it
/add_queries — import topics from an attached CSV file
/add_query TOPIC — add a topic using the global source settings
/help — show this command list
/list_sources — list available sources and provider links
/pause — pause scheduled runs
/queries — list topics
/remove_query TOPIC — remove a topic
/resume — resume scheduled runs
/run — run now
/schedule [CRON] [TIMEZONE] — view or update schedule
  Example: ${scheduleExample}
/sources — configure sources with buttons
/start — initialize the bot and show this command list
/status — watcher status`;

export const publicationsAbout = `*Publications Watcher*

Publications Watcher is a private, self-hosted Telegram research assistant for following scientific and biomedical topics. It searches PubMed, bioRxiv, ClinicalTrials.gov, and openFDA, then turns newly discovered records into concise, structured research digests with Ollama.

*What it does*
• Watches any topics you configure, from a single research question to a CSV-imported topic list.
• Normalizes records from different providers and deduplicates them by stable source identity.
• Analyzes new publications for relevance, importance, key findings, methods, limitations, confidence, and why the result matters.
• Stores processed records and analysis outcomes so the same content is not repeatedly delivered.
• Runs all configured sources independently and reports partial coverage when a provider fails.
• Uses the same pipeline for manual and scheduled runs, with overlap prevention and persisted scheduling state.

*Key advantages*
• Private and self-hosted: Telegram is the only interface, PostgreSQL stores state, and Ollama performs analysis under your control.
• Broad discovery: one topic can be checked across literature, preprints, trials, and regulatory data.
• Source-resilient: one unavailable provider does not discard results from healthy providers.
• Transparent: every digest links to its source and reports source or analysis failures.
• Efficient: durable deduplication and bounded analysis prevent repeated processing.

*How to use it*
1. Add a topic with \`/add_query TOPIC\`, or import many topics by attaching a CSV to \`/add_queries\`.
2. Review configured topics with \`/queries\`.
3. Use \`/sources\` to control providers globally for every current and future topic, and \`/list_sources\` to review provider coverage.
4. Run \`/run\` for an immediate search, or configure recurring checks with \`/schedule CRON TIMEZONE\`.
5. Check \`/status\` for scheduling state. Use \`/pause\` and \`/resume\` without losing topics or source settings.
6. Remove a topic with \`/remove_query TOPIC\` when it is no longer relevant.

_Important:_ The bot summarizes available source material. Always consult the linked record and primary evidence before relying on a result for research, clinical, or regulatory decisions.`;

export { scheduleExample };
