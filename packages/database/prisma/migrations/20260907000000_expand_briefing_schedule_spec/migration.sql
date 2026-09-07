ALTER TABLE "briefing_settings"
ALTER COLUMN "briefingTime" SET DEFAULT '07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00';

ALTER TABLE "briefing_settings"
DROP CONSTRAINT IF EXISTS "briefing_settings_time_check";

ALTER TABLE "briefing_settings"
ADD CONSTRAINT "briefing_settings_time_check"
CHECK (
  "briefingTime" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|weekly:(MON|TUE|WED|THU|FRI|SAT|SUN):([01][0-9]|2[0-3]):[0-5][0-9])(;(([01][0-9]|2[0-3]):[0-5][0-9]|weekly:(MON|TUE|WED|THU|FRI|SAT|SUN):([01][0-9]|2[0-3]):[0-5][0-9]))*$'
);

UPDATE "briefing_settings"
SET
  "briefingTime" = '07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00',
  "nextBriefingAt" = NULL
WHERE "briefingTime" = '07:00';
