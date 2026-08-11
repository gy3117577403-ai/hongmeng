ALTER TABLE "users"
  ADD COLUMN "field_password_only" BOOLEAN NOT NULL DEFAULT false;

-- Preserve every existing password hash. Mark pure reporters plus accounts
-- promoted from a PRIMARY FIELD_REPORTER grant. A strong non-field account that
-- merely adds a concurrent field-report grant is intentionally left unchanged.
-- Scheduled promotions are marked immediately, before their start date.
UPDATE "users" AS "u"
SET "field_password_only" = true,
    "must_change_password" = false,
    "session_version" = "session_version" + 1
WHERE EXISTS (
  SELECT 1
  FROM "user_access_grants" AS "field_grant"
  WHERE "field_grant"."user_id" = "u"."id"
    AND "field_grant"."profile_key" = 'FIELD_REPORTER'
)
AND (
  EXISTS (
    SELECT 1
    FROM "user_access_grants" AS "primary_field_grant"
    WHERE "primary_field_grant"."user_id" = "u"."id"
      AND "primary_field_grant"."profile_key" = 'FIELD_REPORTER'
      AND "primary_field_grant"."grant_type" = 'PRIMARY'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM "user_access_grants" AS "workbench_grant"
    WHERE "workbench_grant"."user_id" = "u"."id"
      AND "workbench_grant"."profile_key" <> 'FIELD_REPORTER'
      AND "workbench_grant"."is_active" = true
      AND "workbench_grant"."effective_from" <= CURRENT_TIMESTAMP
      AND (
        "workbench_grant"."effective_to" IS NULL
        OR "workbench_grant"."effective_to" > CURRENT_TIMESTAMP
      )
  )
);
