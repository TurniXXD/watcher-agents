CREATE TABLE "sales_prospects" (
  "id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "locality" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "websiteUrl" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "location" TEXT,
  "registrationId" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "contactSourceUrl" TEXT,
  "source" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "twentyCompanyId" TEXT,
  "twentyContactNoteId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "syncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sales_prospects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_prospects_domain_key"
  ON "sales_prospects"("domain");

CREATE UNIQUE INDEX "sales_prospects_registrationId_key"
  ON "sales_prospects"("registrationId");

CREATE UNIQUE INDEX "sales_prospects_source_sourceExternalId_key"
  ON "sales_prospects"("source", "sourceExternalId");

CREATE INDEX "sales_prospects_syncedAt_idx"
  ON "sales_prospects"("syncedAt");
