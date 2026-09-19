ALTER TABLE "mu_monitor_state"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "brno_event_agent_state" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brno_event_agent_state_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscoverySignal"
ALTER COLUMN "stockId" DROP NOT NULL;
