CREATE TABLE "maintenance_debug_subscriptions" (
    "chatId" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_debug_subscriptions_pkey" PRIMARY KEY ("chatId")
);

CREATE TABLE "maintenance_debug_deliveries" (
    "chatId" BIGINT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_debug_deliveries_pkey" PRIMARY KEY ("chatId", "agentRunId")
);

CREATE INDEX "maintenance_debug_subscriptions_enabled_updatedAt_idx"
ON "maintenance_debug_subscriptions"("enabled", "updatedAt");

CREATE INDEX "maintenance_debug_deliveries_agentRunId_idx"
ON "maintenance_debug_deliveries"("agentRunId");

CREATE INDEX "maintenance_debug_deliveries_deliveredAt_idx"
ON "maintenance_debug_deliveries"("deliveredAt");

ALTER TABLE "maintenance_debug_deliveries"
ADD CONSTRAINT "maintenance_debug_deliveries_chatId_fkey"
FOREIGN KEY ("chatId") REFERENCES "maintenance_debug_subscriptions"("chatId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "maintenance_debug_deliveries"
ADD CONSTRAINT "maintenance_debug_deliveries_agentRunId_fkey"
FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
