-- Source-timed work may be corrected before review. Voiding it must not fabricate an approval.
ALTER TABLE "other_work_time_requests" DROP CONSTRAINT "other_work_approved_fact";
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_approved_fact" CHECK (
  status NOT IN ('APPROVED', 'VOIDED') OR ("approvedMinutes" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  OR (status = 'VOIDED' AND "toolingJobId" IS NOT NULL AND "voidedAt" IS NOT NULL)
);
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "tooling_reported_time_valid" CHECK (
  "reportedMilliseconds" IS NULL OR ("toolingJobId" IS NOT NULL AND "reportedMilliseconds" > 0 AND "reportedMilliseconds" <= 86400000)
);
