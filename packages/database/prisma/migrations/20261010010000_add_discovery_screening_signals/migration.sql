ALTER TABLE "DiscoverySignal"
  ADD COLUMN "screeningSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
