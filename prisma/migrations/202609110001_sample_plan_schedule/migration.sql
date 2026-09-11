-- Historical task creation is not proof of a plan issue date; leave it unknown.
ALTER TABLE "sample_tasks" ADD COLUMN "issued_date" DATE,
  ADD COLUMN "warning_days" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "schedule_history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "sample_tasks" ADD CONSTRAINT "sample_tasks_warning_days_check" CHECK ("warning_days" BETWEEN 0 AND 30);
CREATE INDEX "sample_tasks_deleted_at_status_issued_date_idx" ON "sample_tasks"("deleted_at", "status", "issued_date");
