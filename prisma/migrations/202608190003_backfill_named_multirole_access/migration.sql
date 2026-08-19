-- One-time, idempotent business-role backfill requested for the current staff.
-- Account ownership is resolved through the unique employee binding; display
-- names are only used for the explicitly named cross-functional staff.

-- The previous release persisted every password session for seven days. Force
-- existing administrator sessions through the new explicit device choice once.
UPDATE "users"
SET "session_version" = "session_version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "labor_role" = 'ADMIN'::"labor_access_role"
  AND "is_active" = TRUE;

-- 郭维贵 / employee 0003: planning collaboration plus drawing upload/edit.
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", 'DEPARTMENT_FULL'::"access_profile_key",
  planning."id", 'DEPARTMENT:PLANNING', 'CONCURRENT'::"access_grant_type",
  CURRENT_TIMESTAMP, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
JOIN "departments" planning ON planning."code" = 'PLANNING' AND planning."is_active" = TRUE
WHERE (e."employee_no" = '0003' OR e."name" = '郭维贵')
  AND u."is_active" = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" = 'DEPARTMENT_FULL'::"access_profile_key"
      AND g."scope_key" = 'DEPARTMENT:PLANNING'
      AND g."is_active" = TRUE
  );

INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", 'DRAWING_LIBRARY_EDITOR'::"access_profile_key",
  COALESCE(e."department_id", engineering."id"), 'GLOBAL:DRAWING_LIBRARY',
  'CONCURRENT'::"access_grant_type", CURRENT_TIMESTAMP, TRUE, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
LEFT JOIN "departments" engineering ON engineering."code" = 'ENGINEERING' AND engineering."is_active" = TRUE
WHERE (e."employee_no" = '0003' OR e."name" = '郭维贵')
  AND u."is_active" = TRUE
  AND COALESCE(e."department_id", engineering."id") IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" = 'DRAWING_LIBRARY_EDITOR'::"access_profile_key"
      AND g."scope_key" = 'GLOBAL:DRAWING_LIBRARY'
      AND g."is_active" = TRUE
  );

-- Every active quality account receives the shared drawing-library reader.
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", 'DRAWING_LIBRARY_READER'::"access_profile_key",
  COALESCE(e."department_id", quality."id"), 'GLOBAL:DRAWING_LIBRARY',
  'CONCURRENT'::"access_grant_type", CURRENT_TIMESTAMP, TRUE, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
LEFT JOIN "departments" bound_department ON bound_department."id" = e."department_id"
JOIN "departments" quality ON quality."code" = 'QUALITY' AND quality."is_active" = TRUE
WHERE u."is_active" = TRUE
  AND (bound_department."code" = 'QUALITY' OR e."department" ILIKE '%质量%')
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" IN (
        'DRAWING_LIBRARY_READER'::"access_profile_key",
        'DRAWING_LIBRARY_EDITOR'::"access_profile_key"
      )
      AND g."is_active" = TRUE
  );

-- Active HR accounts receive the personnel-efficiency section of reports.
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", 'REPORT_PEOPLE_READER'::"access_profile_key",
  COALESCE(e."department_id", hr."id"), 'GLOBAL:REPORT_PEOPLE',
  'CONCURRENT'::"access_grant_type", CURRENT_TIMESTAMP, TRUE, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
LEFT JOIN "departments" bound_department ON bound_department."id" = e."department_id"
JOIN "departments" hr ON hr."code" = 'HR' AND hr."is_active" = TRUE
WHERE u."is_active" = TRUE
  AND (bound_department."code" = 'HR' OR e."department" ILIKE '%人事%')
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" = 'REPORT_PEOPLE_READER'::"access_profile_key"
      AND g."scope_key" = 'GLOBAL:REPORT_PEOPLE'
      AND g."is_active" = TRUE
  );

-- 张豪: planning and process maintenance as two concurrent roles.
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", profile."profile_key"::"access_profile_key",
  d."id", profile."scope_key", 'CONCURRENT'::"access_grant_type",
  CURRENT_TIMESTAMP, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
CROSS JOIN (VALUES
  ('DEPARTMENT_FULL', 'PLANNING', 'DEPARTMENT:PLANNING'),
  ('PROCESS_SPECIALIST', 'PROCESS', 'DEPARTMENT:PROCESS')
) AS profile("profile_key", "department_code", "scope_key")
JOIN "departments" d ON d."code" = profile."department_code" AND d."is_active" = TRUE
WHERE e."name" = '张豪'
  AND u."is_active" = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" = profile."profile_key"::"access_profile_key"
      AND g."scope_key" = profile."scope_key"
      AND g."is_active" = TRUE
  );

-- 邓彬（业务称呼“邓总”）: quality review without destructive operations.
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, u."id", 'QUALITY_REVIEWER'::"access_profile_key",
  quality."id", 'GLOBAL:QUALITY_REVIEW', 'CONCURRENT'::"access_grant_type",
  CURRENT_TIMESTAMP, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
JOIN "employees" e ON e."id" = u."employee_id" AND e."is_active" = TRUE
JOIN "departments" quality ON quality."code" = 'QUALITY' AND quality."is_active" = TRUE
WHERE (e."name" IN ('邓彬', '邓总') OR u."display_name" IN ('邓彬', '邓总'))
  AND u."is_active" = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM "user_access_grants" g
    WHERE g."user_id" = u."id"
      AND g."profile_key" = 'QUALITY_REVIEWER'::"access_profile_key"
      AND g."scope_key" = 'GLOBAL:QUALITY_REVIEW'
      AND g."is_active" = TRUE
  );
