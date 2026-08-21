ALTER TABLE "issues"
  ADD COLUMN "verifier_employee_id" TEXT;

CREATE INDEX "issues_verifier_employee_id_idx"
  ON "issues"("verifier_employee_id");

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_verifier_employee_id_fkey"
  FOREIGN KEY ("verifier_employee_id")
  REFERENCES "employees"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
