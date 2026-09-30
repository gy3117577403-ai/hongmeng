ALTER TABLE "tooling_jobs" ADD COLUMN "tooling_mode" TEXT NOT NULL DEFAULT 'BLADE', ADD COLUMN "record_source" TEXT NOT NULL DEFAULT 'REALTIME';
UPDATE "tooling_jobs" j SET "record_source" = 'BACKFILL' WHERE EXISTS (SELECT 1 FROM "tooling_events" e WHERE e."job_id" = j.id AND e.action = 'BACKFILL');
CREATE TABLE "tooling_molds" (
  "id" TEXT NOT NULL, "model" TEXT NOT NULL, "normalized_key" TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL DEFAULT '', "note" TEXT NOT NULL DEFAULT '',
  "home_position" INTEGER NOT NULL CHECK ("home_position" BETWEEN 1 AND 20),
  "current_position" INTEGER CHECK ("current_position" BETWEEN 1 AND 20),
  "state" TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK ("state" IN ('AVAILABLE','IN_USE','RESTORE','MAINTENANCE','RETIRED')),
  "version" INTEGER NOT NULL DEFAULT 1, "in_use_job_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tooling_molds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tooling_molds_in_use_job_id_fkey" FOREIGN KEY ("in_use_job_id") REFERENCES "tooling_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tooling_molds_normalized_key_key" ON "tooling_molds"("normalized_key");
CREATE INDEX "tooling_molds_state_home_position_idx" ON "tooling_molds"("state", "home_position");
CREATE TABLE "tooling_mold_usages" (
  "id" TEXT NOT NULL, "job_id" TEXT NOT NULL, "mold_id" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "disposition" TEXT, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMP(3),
  CONSTRAINT "tooling_mold_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tooling_mold_usages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "tooling_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tooling_mold_usages_mold_id_fkey" FOREIGN KEY ("mold_id") REFERENCES "tooling_molds"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tooling_mold_usages_job_id_key" ON "tooling_mold_usages"("job_id");
CREATE INDEX "tooling_mold_usages_mold_id_idx" ON "tooling_mold_usages"("mold_id");
