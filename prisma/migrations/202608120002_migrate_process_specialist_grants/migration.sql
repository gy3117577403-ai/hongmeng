UPDATE "user_access_grants" AS access_grant
SET
  "profile_key" = 'PROCESS_SPECIALIST'::"access_profile_key",
  "scope_key" = 'DEPARTMENT:PROCESS',
  "version" = access_grant."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "departments" AS department
WHERE access_grant."department_id" = department."id"
  AND department."code" = 'PROCESS'
  AND access_grant."profile_key" = 'DEPARTMENT_FULL'::"access_profile_key";

UPDATE "users" AS app_user
SET "session_version" = app_user."session_version" + 1
WHERE EXISTS (
  SELECT 1
  FROM "user_access_grants" AS access_grant
  JOIN "departments" AS department
    ON department."id" = access_grant."department_id"
  WHERE access_grant."user_id" = app_user."id"
    AND access_grant."profile_key" = 'PROCESS_SPECIALIST'::"access_profile_key"
    AND department."code" = 'PROCESS'
);
