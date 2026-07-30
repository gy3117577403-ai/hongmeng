ALTER TABLE "employee_skill_certifications"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ASSESSMENT',
  ADD COLUMN "evidence_type" TEXT,
  ADD COLUMN "requires_reassessment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_source_check"
  CHECK ("source" IN ('ASSESSMENT', 'LEGACY_ENTRY'));

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_evidence_type_check"
  CHECK (
    "evidence_type" IS NULL
    OR "evidence_type" IN (
      'LONG_TERM_PRACTICE',
      'SUPERVISOR_CONFIRMATION',
      'HISTORICAL_CERTIFICATE',
      'TRAINING_RECORD',
      'OTHER'
    )
  );

CREATE INDEX "employee_skill_certifications_source_status_idx"
  ON "employee_skill_certifications"("source", "status");
