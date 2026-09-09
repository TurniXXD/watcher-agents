export const newsHelp = `/about — what the news bot does and how to use it
/feed_add PROFILE URL [NAME] — add an optional custom RSS/Atom feed
/feed_disable ID — disable a feed without deleting it
/feed_enable ID — enable a disabled feed
/feed_remove ID — remove a feed
/feeds — list feeds and their IDs
/help — show this command list
/pause — pause scheduled runs
/resume — resume scheduled runs
/run [PROFILE] — run both profiles, or only czech/global
/schedule [CRON] [TIMEZONE] — view or update schedule
/start — initialize the bot and show this command list
/status — show watcher status and profile counts
/topic_add PROFILE TOPIC — add a ranking topic
/topic_remove PROFILE TOPIC — remove a ranking topic
/topics — list ranking topics

Profiles: czech, global`;

export const newsAbout = `*News Watcher*

News Watcher is one private, self-hosted Telegram bot with two editorial profiles: *Czech* for news centered on Czechia and *Global* for important international developments. Both profiles share one reliable ingestion and analysis engine while keeping their sources and topics separate. The curated Czech and Global source catalogs are configured and enabled automatically.

*What it does*
• Reads built-in official RSS/Atom feeds and GDELT discovery results, plus optional custom feeds, and normalizes their articles into one format.
• Deduplicates articles by stable source identity before analysis or delivery.
• Uses Ollama to assess importance, relevance, category, key facts, entities, and why a story matters.
• Ranks each story against the topics configured for its Czech or Global profile.
• Isolates feed failures, reports coverage, prevents overlapping runs, and persists scheduling state.
• Publishes important stories into the Personal Morning Briefing Bot through the durable briefing-event contract.

*Key advantages*
• One engine, two profiles: less duplicated code and consistent ranking, while Czech and Global sources can be paused independently.
• Private and self-hosted: Telegram is the only interface, PostgreSQL stores state, and analysis stays in your Ollama deployment.
• Source-transparent: digests link to the original article and surface feed or analysis failures.
• Briefing-ready: qualifying stories become deduplicated briefing events with their profile, source, scores, entities, and provenance intact.
• Safe and resilient: feed URLs are validated against local/private network access and one broken feed cannot cancel the run.

*How to use it*
1. Review the automatically enabled source catalog with \`/feeds\`; use \`/feed_disable ID\` or \`/feed_enable ID\` to change it.
2. Optionally add another feed with \`/feed_add czech URL NAME\` or \`/feed_add global URL NAME\`.
3. Add editorial interests with \`/topic_add czech TOPIC\` and \`/topic_add global TOPIC\`. With no topics, the bot ranks general significance for that profile.
4. Use \`/run\` for both profiles or \`/run czech\` / \`/run global\` for one.
5. Configure recurring checks with \`/schedule CRON TIMEZONE\`; pause or resume them without losing configuration.
6. In the Briefing Bot, enable the \`news\` subscription to include qualifying stories in morning briefings.

_Important:_ The bot summarizes feed-provided text. Open the linked source before relying on a story, especially when facts are developing or consequential.`;
