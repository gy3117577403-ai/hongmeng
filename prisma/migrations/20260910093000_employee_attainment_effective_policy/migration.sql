CREATE TABLE "employee_attainment_policy_changes" (
  "id" TEXT NOT NULL,
  "revision" SERIAL NOT NULL,
  "employee_id" TEXT NOT NULL,
  "effective_date" DATE NOT NULL,
  "before_policy" JSONB NOT NULL,
  "after_policy" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "impact" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_attainment_policy_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_attainment_policy_changes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_attainment_policy_changes_reason_check" CHECK (length(trim("reason")) > 0)
);
CREATE UNIQUE INDEX "employee_attainment_policy_changes_revision_key" ON "employee_attainment_policy_changes"("revision");
CREATE UNIQUE INDEX "employee_attainment_policy_changes_employee_id_request_id_key" ON "employee_attainment_policy_changes"("employee_id", "request_id");
CREATE INDEX "employee_attainment_policy_changes_employee_id_effective_date_i" ON "employee_attainment_policy_changes"("employee_id", "effective_date", "revision");
ALTER TABLE "attendance_records" ADD COLUMN "attainment_policy_override" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attainment_policy_reason" TEXT;
