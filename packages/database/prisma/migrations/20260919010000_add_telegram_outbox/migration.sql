-- Durable, deduplicated delivery queue for scheduled Telegram notifications.
CREATE TYPE "TelegramOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DEAD_LETTER');

CREATE TABLE "telegram_outbox_messages" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TelegramOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "telegramMessageId" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_outbox_messages_kind_deduplicationKey_key"
ON "telegram_outbox_messages"("kind", "deduplicationKey");

CREATE INDEX "telegram_outbox_messages_status_nextAttemptAt_idx"
ON "telegram_outbox_messages"("status", "nextAttemptAt");

CREATE INDEX "telegram_outbox_messages_status_leaseExpiresAt_idx"
ON "telegram_outbox_messages"("status", "leaseExpiresAt");
