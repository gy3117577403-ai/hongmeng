ALTER TABLE "quality_risk_reports"
  ADD COLUMN "workflow_version" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "problem_category" TEXT,
  ADD COLUMN "responsible_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewer_user_id" TEXT,
  ADD COLUMN "review_round" INTEGER NOT NULL DEFAULT 0;
-- Preserve historical archives. Existing open events can explicitly enter the new flow.
ALTER TABLE "quality_risk_reports" ALTER COLUMN "workflow_version" SET DEFAULT 3;
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_reviewer_user_id_fkey"
  FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "quality_risk_reports_reviewer_user_id_status_idx" ON "quality_risk_reports"("reviewer_user_id", "status");
CREATE INDEX "quality_risk_reports_problem_category_status_idx" ON "quality_risk_reports"("problem_category", "status");
ALTER TABLE "quality_risk_tasks" ADD COLUMN "action_taken" TEXT;
CREATE TABLE "quality_risk_reviews" (
  "id" TEXT NOT NULL, "report_id" TEXT NOT NULL, "round" INTEGER NOT NULL,
  "reviewer_id" TEXT NOT NULL, "submitted_by_id" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "result" TEXT, "decision" TEXT NOT NULL DEFAULT 'PENDING', "return_reason" TEXT,
  "returned_task_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "decided_at" TIMESTAMP(3),
  CONSTRAINT "quality_risk_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risk_reviews_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "quality_risk_reviews_report_id_round_key" ON "quality_risk_reviews"("report_id", "round");
CREATE TABLE "quality_risk_notifications" (
  "id" TEXT NOT NULL, "report_id" TEXT NOT NULL, "recipient_id" TEXT NOT NULL,
  "task_id" TEXT, "review_round" INTEGER, "dedupe_key" TEXT NOT NULL, "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "target_route" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT, "last_error" TEXT, "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_risk_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risk_notifications_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "quality_risk_notifications_dedupe_key_key" ON "quality_risk_notifications"("dedupe_key");
CREATE INDEX "quality_risk_notifications_state_available_at_idx" ON "quality_risk_notifications"("state", "available_at");
CREATE INDEX "quality_risk_notifications_report_id_created_at_idx" ON "quality_risk_notifications"("report_id", "created_at");
CREATE TABLE "quality_robot_dispatch_clock" ("id" TEXT NOT NULL, "last_attempt_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_robot_dispatch_clock_pkey" PRIMARY KEY ("id"));
