ALTER TABLE "quality_risk_reports"
ADD COLUMN "archive_requirements" JSONB;

COMMENT ON COLUMN "quality_risk_reports"."archive_requirements" IS
'Per-report archive gate policy. Supported values are REQUIRED, OPTIONAL and NOT_APPLICABLE.';
