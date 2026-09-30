CREATE TYPE "SalesLeadStage" AS ENUM ('DISCOVERED', 'ANALYZED', 'QUALIFIED', 'SYNCING', 'REJECTED', 'SYNCED_TO_QUICKLY', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NOT_INTERESTED', 'BOUNCED', 'UNSUBSCRIBED');
CREATE TYPE "SalesAuthorizationBasis" AS ENUM ('RECIPIENT_OPT_IN', 'EXISTING_CUSTOMER');
CREATE TYPE "SalesAuthorizationAction" AS ENUM ('RECORDED', 'REVOKED');
CREATE TYPE "SalesDecisionSource" AS ENUM ('TELEGRAM', 'API');

CREATE TABLE "sales_campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "offer" TEXT NOT NULL,
  "subjectTemplate" TEXT NOT NULL,
  "bodyTemplate" TEXT NOT NULL,
  "discoveryFeedUrl" TEXT,
  "minimumLeadScore" INTEGER NOT NULL DEFAULT 70,
  "dailyOutreachLimit" INTEGER NOT NULL DEFAULT 20,
  "quicklyCampaignId" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "pausedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_campaigns_name_key" ON "sales_campaigns"("name");

CREATE TABLE "sales_leads" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "websiteUrl" TEXT,
  "domain" TEXT,
  "email" TEXT,
  "emailSyntaxValid" BOOLEAN NOT NULL DEFAULT false,
  "contactSourceUrl" TEXT,
  "source" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "stage" "SalesLeadStage" NOT NULL DEFAULT 'DISCOVERED',
  "baseScore" INTEGER,
  "llmAdjustment" INTEGER,
  "finalScore" INTEGER,
  "audit" JSONB,
  "analysis" JSONB,
  "draftSubject" TEXT,
  "draftBody" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedVia" "SalesDecisionSource",
  "rejectedAt" TIMESTAMP(3),
  "quicklyLeadId" INTEGER,
  "quicklyEnrolledAt" TIMESTAMP(3),
  "twentyCompanyId" TEXT,
  "twentyPersonId" TEXT,
  "twentyOpportunityId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_leads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_leads_campaignId_source_sourceExternalId_key" ON "sales_leads"("campaignId", "source", "sourceExternalId");
CREATE UNIQUE INDEX "sales_leads_campaignId_domain_key" ON "sales_leads"("campaignId", "domain");
CREATE UNIQUE INDEX "sales_leads_campaignId_email_key" ON "sales_leads"("campaignId", "email");
CREATE INDEX "sales_leads_stage_nextAttemptAt_idx" ON "sales_leads"("stage", "nextAttemptAt");
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "sales_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sales_lead_decisions" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "source" "SalesDecisionSource" NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_lead_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sales_lead_decisions_leadId_createdAt_idx" ON "sales_lead_decisions"("leadId", "createdAt");
ALTER TABLE "sales_lead_decisions" ADD CONSTRAINT "sales_lead_decisions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sales_contact_authorizations" (
  "campaignId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "basis" "SalesAuthorizationBasis" NOT NULL,
  "evidenceSource" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_contact_authorizations_pkey" PRIMARY KEY ("campaignId", "email")
);
ALTER TABLE "sales_contact_authorizations" ADD CONSTRAINT "sales_contact_authorizations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "sales_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sales_authorization_events" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "action" "SalesAuthorizationAction" NOT NULL,
  "basis" "SalesAuthorizationBasis",
  "evidenceSource" TEXT,
  "evidenceReference" TEXT,
  "capturedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_authorization_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sales_authorization_events_campaignId_email_createdAt_idx" ON "sales_authorization_events"("campaignId", "email", "createdAt");
ALTER TABLE "sales_authorization_events" ADD CONSTRAINT "sales_authorization_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "sales_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sales_suppressions" (
  "key" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_suppressions_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "sales_webhook_events" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_discovery_cursors" (
  "key" TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3) NOT NULL,
  "contentHash" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_discovery_cursors_pkey" PRIMARY KEY ("key")
);
