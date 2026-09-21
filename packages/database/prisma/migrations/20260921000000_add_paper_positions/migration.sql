CREATE TYPE "PaperPositionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "paper_positions" (
    "id" TEXT NOT NULL,
    "chatConfigId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "status" "PaperPositionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "horizonDays" INTEGER NOT NULL,
    "amountCzk" DECIMAL(18,2) NOT NULL,
    "entryPrice" DECIMAL(24,8) NOT NULL,
    "entryPriceObservedAt" TIMESTAMP(3) NOT NULL,
    "exitPrice" DECIMAL(24,8),
    "exitPriceObservedAt" TIMESTAMP(3),
    "thesisSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_positions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paper_positions_chatConfigId_fkey" FOREIGN KEY ("chatConfigId") REFERENCES "TelegramChat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "paper_positions_chatConfigId_status_openedAt_idx" ON "paper_positions"("chatConfigId", "status", "openedAt");
CREATE INDEX "paper_positions_chatConfigId_ticker_status_idx" ON "paper_positions"("chatConfigId", "ticker", "status");
