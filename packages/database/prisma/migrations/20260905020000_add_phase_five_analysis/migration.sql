CREATE TABLE "CompanyThesisState" (
    "ticker" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "attentionScore" INTEGER NOT NULL,
    "bullScore" DOUBLE PRECISION NOT NULL,
    "bearScore" DOUBLE PRECISION NOT NULL,
    "netSignal" DOUBLE PRECISION NOT NULL,
    "signalGroups" JSONB NOT NULL,
    "catalysts" JSONB NOT NULL,
    "insiderConviction" DOUBLE PRECISION,
    "pricedIn" TEXT NOT NULL,
    "primaryDrivers" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "dataCoverage" DOUBLE PRECISION NOT NULL,
    "dataQuality" TEXT NOT NULL,
    "materialDataGaps" JSONB NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyThesisState_pkey" PRIMARY KEY ("ticker")
);

CREATE TABLE "ThesisRevision" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedItemId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "thesisChange" TEXT NOT NULL,
    "informationChange" TEXT NOT NULL,
    "fullAnalysisPerformed" BOOLEAN NOT NULL,
    "redundancyClass" TEXT NOT NULL,
    "redundancyMultiplier" DOUBLE PRECISION NOT NULL,
    "reliabilityWeight" DOUBLE PRECISION NOT NULL,
    "targetedAnalysis" JSONB NOT NULL,
    "resultingState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThesisRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyThesisState_attentionScore_updatedAt_idx" ON "CompanyThesisState"("attentionScore", "updatedAt");
CREATE INDEX "CompanyThesisState_verdict_updatedAt_idx" ON "CompanyThesisState"("verdict", "updatedAt");
CREATE UNIQUE INDEX "ThesisRevision_eventId_key" ON "ThesisRevision"("eventId");
CREATE UNIQUE INDEX "ThesisRevision_analysisId_key" ON "ThesisRevision"("analysisId");
CREATE INDEX "ThesisRevision_ticker_createdAt_idx" ON "ThesisRevision"("ticker", "createdAt");
CREATE INDEX "ThesisRevision_processedItemId_idx" ON "ThesisRevision"("processedItemId");

ALTER TABLE "ThesisRevision" ADD CONSTRAINT "ThesisRevision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThesisRevision" ADD CONSTRAINT "ThesisRevision_processedItemId_fkey" FOREIGN KEY ("processedItemId") REFERENCES "ProcessedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThesisRevision" ADD CONSTRAINT "ThesisRevision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
