CREATE TABLE "trading212_schedules" (
    "chatId" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trading212_schedules_pkey" PRIMARY KEY ("chatId")
);
