# Study Bot

Private Telegram study assistant for text-based university PDFs and the operator's Notion book library. It stores the document in S3-compatible storage, extracts page text, creates source-grounded facts through the shared Ollama queue, writes a spoken lecture, synthesizes OGG/Opus audio with Piper, and returns a voice message.

Scanned or near-empty PDFs are rejected with an OCR-required message rather than sent to the model. Completion actions can resend audio, create a short summary, run a five-question cited quiz, or generate an Anki-compatible UTF-8 TSV deck with page citations.

## Commands

Upload a PDF to start. `/start` initializes the bot, `/help` shows the current guide, `/about` explains grounding, storage, and safety boundaries, `/status` reports the latest job, and `/cancel` stops it safely between stages.

The optional Notion book-library commands are:

- `/book_add TITLE` — find structured Open Library metadata, show a preview, and save it only after the initiating operator confirms.
- `/books` — list the complete Notion library.
- `/books_category CATEGORY` and `/books_author AUTHOR` — filter the library.
- `/books_next` and `/books_favorites` — list `Next to read` or favorite books.
- `/books_categories` and `/books_authors` — list supported Notion category options and author values currently present in the library.

The confirmation draft expires after 30 minutes and is bound to the originating Telegram chat and user. Exact-title duplicates are returned as already existing instead of creating a second row. Notion is authoritative for saved books; PostgreSQL stores only the restart-safe confirmation state.

## Configuration

Configure the database, Telegram token/allowlist, Ollama, Piper, `STUDY_S3_ENDPOINT`, application-specific S3 credentials, document/media buckets, PDF/page limits, and Czech TTS voice. RustFS permissions should be limited to `documents/study-bot/*` and `media/study-bot/*`.

Book commands are enabled only when both `NOTION_API_KEY` and `STUDY_NOTION_BOOKS_DATA_SOURCE_ID` are set. Share the `Learning/Books` database with that Notion integration. `NOTION_API_VERSION` defaults to `2026-03-11`. Open Library lookup is public and has a bounded 15-second request timeout.

The expected Notion fields are `Kniha`, `Autor`, `Kategorie`, `Žánr`, `Stran`, `Složitost`, `Poznámka`, `Přidáno`, and the boolean fields `Priorita`, `Přečteno`, `Next to read`, and `Oblíbená`. The bot never changes those flags while importing a title; new books start with all four set to false.

Known limitations: provider metadata can be incomplete, category/genre mapping is deterministic and may need a manual Notion correction, and the bot will not create a record without explicit confirmation. It never sends books or PDF-derived content to unauthorized Telegram users.

See [the environment inventory](../../deploy/ENVIRONMENT.md).
