CREATE TABLE "PcPushConfig" (
  "id" TEXT NOT NULL DEFAULT 'purchasing', "enabled" BOOLEAN NOT NULL DEFAULT true,
  "webhookEncrypted" TEXT NOT NULL DEFAULT '', "origin" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PcPushConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PcNotification" (
  "id" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "action" TEXT NOT NULL,
  "recordIds" TEXT[], "recipientIds" TEXT[], "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseToken" TEXT,
  "lastError" TEXT NOT NULL DEFAULT '', "content" TEXT NOT NULL DEFAULT '',
  "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PcNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PcNotification_state_check" CHECK ("state" IN ('PENDING','SENDING','SENT','FAILED','WAITING_CONFIG','UNCERTAIN','SKIPPED')),
  CONSTRAINT "PcNotification_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "PcNotification_dedupeKey_key" ON "PcNotification"("dedupeKey");
CREATE INDEX "PcNotification_state_availableAt_idx" ON "PcNotification"("state", "availableAt");
CREATE INDEX "PcNotification_createdAt_idx" ON "PcNotification"("createdAt");
CREATE INDEX "PcNotification_recordIds_idx" ON "PcNotification" USING GIN ("recordIds");
CREATE TABLE "PcPushClock" ("id" TEXT NOT NULL, "lastAttemptAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PcPushClock_pkey" PRIMARY KEY ("id"));
