# Study Bot

Private Telegram study assistant for text-based university PDFs. It stores the document in S3-compatible storage, extracts page text, creates source-grounded facts through the shared Ollama queue, writes a spoken lecture, synthesizes OGG/Opus audio with Piper, and returns a voice message.

Scanned or near-empty PDFs are rejected with an OCR-required message rather than sent to the model. Completion actions can resend audio, create a short summary, run a five-question cited quiz, or generate an Anki-compatible UTF-8 TSV deck with page citations.

## Commands

Upload a PDF to start. `/start` initializes the bot, `/help` shows the current guide, `/about` explains grounding, storage, and safety boundaries, `/status` reports the latest job, and `/cancel` stops it safely between stages.

## Configuration

Configure the database, Telegram token/allowlist, Ollama, Piper, `STUDY_S3_ENDPOINT`, application-specific S3 credentials, document/media buckets, PDF/page limits, and Czech TTS voice. RustFS permissions should be limited to `documents/study-bot/*` and `media/study-bot/*`.

See [the environment inventory](../../deploy/ENVIRONMENT.md).
