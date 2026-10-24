CREATE TABLE "sales_lead_research" (
  "leadId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "profile" JSONB NOT NULL,
  "contacts" JSONB NOT NULL,
  "technicalAudit" JSONB NOT NULL,
  "opportunities" JSONB NOT NULL,
  "outreach" JSONB NOT NULL,
  "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "researchedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_lead_research_pkey" PRIMARY KEY ("leadId"),
  CONSTRAINT "sales_lead_research_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sales_lead_research_status_expiresAt_idx" ON "sales_lead_research"("status", "expiresAt");

CREATE TABLE "sales_daily_suggestions" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "contactedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_daily_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_daily_suggestions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sales_daily_suggestions_leadId_scheduledDate_key" ON "sales_daily_suggestions"("leadId", "scheduledDate");
CREATE INDEX "sales_daily_suggestions_scheduledDate_status_idx" ON "sales_daily_suggestions"("scheduledDate", "status");
CREATE INDEX "sales_daily_suggestions_leadId_suggestedAt_idx" ON "sales_daily_suggestions"("leadId", "suggestedAt");
