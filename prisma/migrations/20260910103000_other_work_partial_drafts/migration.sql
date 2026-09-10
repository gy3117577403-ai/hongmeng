-- Only drafts may omit duration. Submitted and approved facts remain strictly positive.
ALTER TABLE "other_work_time_requests" DROP CONSTRAINT "other_work_minutes_valid";
ALTER TABLE "other_work_time_requests" ADD CONSTRAINT "other_work_minutes_valid"
CHECK (
  "requestedMinutes" BETWEEN 0 AND 1440
  AND (status = 'DRAFT' OR "requestedMinutes" >= 1)
  AND ("approvedMinutes" IS NULL OR "approvedMinutes" BETWEEN 1 AND "requestedMinutes")
);
