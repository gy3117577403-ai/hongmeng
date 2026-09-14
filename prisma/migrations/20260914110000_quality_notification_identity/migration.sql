ALTER TABLE "employees" ADD COLUMN "wecom_user_id_verified_at" TIMESTAMP(3),
  ADD COLUMN "wecom_mention_check" JSONB;
ALTER TABLE "quality_risk_notifications"
  ADD COLUMN "short_code" TEXT,
  ADD COLUMN "delivery_group" TEXT,
  ADD COLUMN "delivery_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_snapshot" JSONB,
  ADD COLUMN "delivery_content" TEXT,
  ADD COLUMN "last_attempt_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "quality_risk_notifications_short_code_key" ON "quality_risk_notifications"("short_code");
CREATE INDEX "quality_risk_notifications_delivery_group_idx" ON "quality_risk_notifications"("delivery_group");
CREATE INDEX IF NOT EXISTS "process_supplement_obligations_insert_before_step_id_idx"
  ON "process_supplement_obligations"("insert_before_step_id");
