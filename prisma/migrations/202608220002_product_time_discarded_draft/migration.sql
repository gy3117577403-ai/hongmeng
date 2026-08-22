ALTER TABLE "product_time_profiles"
  DROP CONSTRAINT IF EXISTS "product_time_profiles_status_check";

ALTER TABLE "product_time_profiles"
  ADD CONSTRAINT "product_time_profiles_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived', 'discarded'));
