# OSINT Bot

Private Telegram investigation bot for public-source, provenance-backed research. It accepts names, Czech company identifiers, domains, labelled addresses, cadastral selectors, public profile URLs, and supported public identifiers.

Name matches remain candidates rather than confirmed identities. Public-register birth dates and residential addresses are discarded. The bot never scrapes Nahlížení do KN, bypasses CAPTCHA, performs phone-number reverse lookup, or treats LLM inference as a stored fact.

Collectors include ARES, Registr smluv, RÚIAN, ČÚZK INSPIRE services, website metadata, DNS, RDAP, Certificate Transparency, Wayback, Wikipedia, GitHub, Reddit, ORCID, Crossref, selected public social metadata, and public Bitcoin/Ethereum summaries.

## Commands

Use `/start`, `/investigate`, `/investigations`, `/investigation`, `/evidence`, `/entity`, `/relations`, `/timeline`, `/expand`, `/report`, `/watch`, `/unwatch`, `/status`, `/sources`, `/pause`, `/resume`, `/stop`, `/about`, and `/help`. `/start` and `/help` both show the complete evidence and safety guide.

## Configuration

Use [the OSINT preset](../../deploy/presets/osint-bot.env.example). Set `DATABASE_URL`, a distinct `OSINT_TELEGRAM_TOKEN`, and `TELEGRAM_ALLOWED_USER_IDS`. Ollama is optional and only adds labelled inference after deterministic collection.

See [architecture and limitations](../../docs/osint-architecture.md).
