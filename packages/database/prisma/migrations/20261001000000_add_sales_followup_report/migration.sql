ALTER TABLE "sales_leads" ADD COLUMN "phone" TEXT;
ALTER TABLE "sales_leads" ADD COLUMN "phoneSourceUrl" TEXT;

ALTER TABLE "sales_webhook_events" ADD COLUMN "leadId" TEXT;
ALTER TABLE "sales_webhook_events" ADD COLUMN "occurredAt" TIMESTAMP(3);
CREATE INDEX "sales_webhook_events_event_occurredAt_idx" ON "sales_webhook_events"("event", "occurredAt");
ALTER TABLE "sales_webhook_events" ADD CONSTRAINT "sales_webhook_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
