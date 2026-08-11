-- A process definition is reusable routing vocabulary.  A product route may
-- legitimately contain the same definition more than once, so occurrence_key
-- (not process_definition_id) is the stable identity within a profile version.
ALTER TABLE "product_process_time_entries"
ADD COLUMN "occurrence_key" TEXT;

UPDATE "product_process_time_entries" AS "entry"
SET "occurrence_key" = CONCAT(
  'legacy:',
  "profile"."drawing_library_item_id",
  ':',
  "entry"."process_definition_id"
)
FROM "product_time_profiles" AS "profile"
WHERE "entry"."profile_id" = "profile"."id"
  AND "entry"."occurrence_key" IS NULL;

ALTER TABLE "product_process_time_entries"
ALTER COLUMN "occurrence_key" SET NOT NULL;

DROP INDEX IF EXISTS "product_process_time_entries_profile_id_process_definition_id_key";

CREATE UNIQUE INDEX "product_process_time_entries_profile_id_occurrence_key_key"
ON "product_process_time_entries"("profile_id", "occurrence_key");

CREATE INDEX "product_process_time_entries_profile_id_process_definition_id_idx"
ON "product_process_time_entries"("profile_id", "process_definition_id");
