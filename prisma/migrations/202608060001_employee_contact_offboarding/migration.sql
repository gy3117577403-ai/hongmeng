-- Employee contact details and current offboarding state.
ALTER TABLE "employees"
  ADD COLUMN "mobile" TEXT,
  ADD COLUMN "wecom_user_id" TEXT,
  ADD COLUMN "notification_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "resigned_at" DATE,
  ADD COLUMN "resignation_reason" TEXT,
  ADD COLUMN "resignation_note" TEXT;

CREATE UNIQUE INDEX "employees_wecom_user_id_key" ON "employees"("wecom_user_id");
CREATE UNIQUE INDEX "employees_mobile_key" ON "employees"("mobile");
CREATE INDEX "employees_is_active_resigned_at_idx" ON "employees"("is_active", "resigned_at");

-- Employment history is append-only so a reinstatement never erases a past resignation.
CREATE TABLE "employee_employment_events" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "effective_date" DATE NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_employment_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_employment_events_employee_id_created_at_idx"
  ON "employee_employment_events"("employee_id", "created_at");
CREATE INDEX "employee_employment_events_event_type_effective_date_idx"
  ON "employee_employment_events"("event_type", "effective_date");
CREATE INDEX "employee_employment_events_actor_id_idx"
  ON "employee_employment_events"("actor_id");

ALTER TABLE "employee_employment_events"
  ADD CONSTRAINT "employee_employment_events_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_employment_events"
  ADD CONSTRAINT "employee_employment_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Give pre-existing personnel one factual baseline event without inventing a resignation.
INSERT INTO "employee_employment_events" (
  "id",
  "employee_id",
  "event_type",
  "effective_date",
  "reason"
)
SELECT
  'legacy-import-' || "id",
  "id",
  'IMPORTED',
  COALESCE("hire_date", "created_at"::date),
  '历史档案初始化'
FROM "employees";
