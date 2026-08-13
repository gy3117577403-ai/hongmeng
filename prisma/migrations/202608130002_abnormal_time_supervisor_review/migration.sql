ALTER TABLE "abnormal_time_events"
  ADD COLUMN "subcategory" TEXT,
  ADD COLUMN "approved_duration_milliseconds" INTEGER,
  ADD COLUMN "affected_quantity" INTEGER,
  ADD COLUMN "responsibility_object" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'BACKOFFICE',
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "reported_by_employee_id" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "abnormal_time_events"
  ADD CONSTRAINT "abnormal_time_events_approved_duration_check"
  CHECK (
    "approved_duration_milliseconds" IS NULL
    OR (
      "approved_duration_milliseconds" > 0
      AND "approved_duration_milliseconds" <= "duration_milliseconds"
    )
  ),
  ADD CONSTRAINT "abnormal_time_events_affected_quantity_check"
  CHECK ("affected_quantity" IS NULL OR "affected_quantity" > 0),
  ADD CONSTRAINT "abnormal_time_events_reported_by_employee_id_fkey"
  FOREIGN KEY ("reported_by_employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "abnormal_time_events_idempotency_key_key"
  ON "abnormal_time_events"("idempotency_key");

CREATE INDEX "abnormal_time_events_reported_by_employee_id_work_date_idx"
  ON "abnormal_time_events"("reported_by_employee_id", "work_date");

CREATE INDEX "abnormal_time_events_source_work_date_idx"
  ON "abnormal_time_events"("source", "work_date");
