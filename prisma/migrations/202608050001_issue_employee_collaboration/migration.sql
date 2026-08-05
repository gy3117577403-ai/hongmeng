-- Issue responsibility belongs to HR employee records, not login accounts.
-- Keep the legacy user assignee for backward compatibility while new writes use
-- assignee_employee_id. Existing assignments are backfilled when the user is
-- already linked to an employee archive.
ALTER TABLE "issues"
  ADD COLUMN "assignee_employee_id" TEXT,
  ADD COLUMN "process_name" TEXT,
  ADD COLUMN "affected_quantity" INTEGER,
  ADD COLUMN "temporary_measure" TEXT;

-- The original issue center constraint predates the process-specific issue
-- type. Replace it in the same migration so application and database rules
-- stay aligned on every environment.
ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_type_check";
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_type_check"
  CHECK ("type" IN ('production', 'planning', 'technical', 'process', 'quality', 'material', 'equipment', 'other'));

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_affected_quantity_check"
  CHECK ("affected_quantity" IS NULL OR "affected_quantity" >= 0);

UPDATE "issues" AS issue
SET "assignee_employee_id" = app_user."employee_id"
FROM "users" AS app_user
WHERE issue."assignee_id" = app_user."id"
  AND app_user."employee_id" IS NOT NULL;

CREATE TABLE "issue_collaborators" (
  "id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "issue_collaborators_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "issues_assignee_employee_id_idx" ON "issues"("assignee_employee_id");
CREATE UNIQUE INDEX "issue_collaborators_issue_id_employee_id_key" ON "issue_collaborators"("issue_id", "employee_id");
CREATE INDEX "issue_collaborators_employee_id_idx" ON "issue_collaborators"("employee_id");

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_assignee_employee_id_fkey"
  FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_collaborators"
  ADD CONSTRAINT "issue_collaborators_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "issues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_collaborators"
  ADD CONSTRAINT "issue_collaborators_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
