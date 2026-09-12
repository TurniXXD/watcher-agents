CREATE TABLE "ollama_requests" (
    "id" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queueExpiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "timeoutMs" INTEGER NOT NULL,
    "queueWaitMs" INTEGER,
    "durationMs" INTEGER,
    "inputSize" INTEGER,
    "outputSize" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ollama_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ollama_requests_status_priority_queuedAt_idx"
ON "ollama_requests"("status", "priority", "queuedAt");

CREATE INDEX "ollama_requests_status_leaseExpiresAt_idx"
ON "ollama_requests"("status", "leaseExpiresAt");

CREATE INDEX "ollama_requests_finishedAt_idx"
ON "ollama_requests"("finishedAt");
