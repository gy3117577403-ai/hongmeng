BEGIN;
ALTER TABLE "QfPackage"
  ADD COLUMN IF NOT EXISTS "supervisorAsAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "qualityAsAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QfPackage" DROP CONSTRAINT "QfPackage_status";
ALTER TABLE "QfPackage" ADD CONSTRAINT "QfPackage_status"
  CHECK ("status" IN ('DRAFT','REVIEWING','SUPERVISOR','QUALITY','APPROVED','RETURNED','REVOKED','SUPERSEDED'));

-- Pending legacy submissions become available to both reviewers. Existing signatures remain intact.
UPDATE "QfPackage" SET "status" = 'REVIEWING', "version" = "version" + 1
WHERE "status" = 'SUPERVISOR' AND "supervisorAt" IS NULL AND "qualityAt" IS NULL;
COMMIT;
