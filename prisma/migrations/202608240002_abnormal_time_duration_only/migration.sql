-- Abnormal time is duration-only. Historical time points remain available for
-- audit, while all new and edited records intentionally store NULL intervals.
ALTER TABLE "abnormal_time_events"
  ALTER COLUMN "started_at" DROP NOT NULL,
  ALTER COLUMN "ended_at" DROP NOT NULL;
