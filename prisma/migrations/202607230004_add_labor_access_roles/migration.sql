CREATE TYPE "labor_access_role" AS ENUM ('ADMIN', 'TEAM_LEAD', 'EMPLOYEE');

ALTER TABLE "users"
  ADD COLUMN "labor_role" "labor_access_role" NOT NULL DEFAULT 'EMPLOYEE',
  ADD COLUMN "employee_id" TEXT;

-- Existing accounts were full-access operators before labor roles existed.
-- Preserve that access on upgrade; newly created accounts keep the EMPLOYEE default
-- until an administrator explicitly assigns their role and employee binding.
UPDATE "users"
SET "labor_role" = 'ADMIN';

CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
