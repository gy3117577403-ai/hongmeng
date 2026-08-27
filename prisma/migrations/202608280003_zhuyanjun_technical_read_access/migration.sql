-- Explicitly requested account only. Never grant all trainees or match a display
-- name alone. Ambiguous/missing employee bindings are recorded without mutation.
DO $$
DECLARE
  target_count integer;
  target_user text;
  target_employee text;
  target_department text;
  inserted_count integer;
BEGIN
  SELECT COUNT(*), MAX(u."id"), MAX(e."id"), MAX(e."department_id")
    INTO target_count, target_user, target_employee, target_department
  FROM "users" u
  JOIN "employees" e ON e."id" = u."employee_id"
  WHERE e."name" = '朱艳军'
    AND e."is_active" = TRUE AND e."resigned_at" IS NULL
    AND u."is_active" = TRUE AND u."account_status" = 'ACTIVE'::"account_status"
    AND u."labor_role" <> 'ADMIN'::"labor_access_role";

  IF target_count <> 1 THEN
    RAISE WARNING '朱艳军技术查看授权未执行：匹配到 % 个在职绑定账号，需按员工编号确认', target_count;
    INSERT INTO "operation_logs" ("id", "action", "target_type", "detail", "created_at")
    VALUES (gen_random_uuid()::text, 'named_technical_access_skipped', 'system',
      jsonb_build_object('migration', '202608280003', 'employeeName', '朱艳军', 'matchedAccounts', target_count), CURRENT_TIMESTAMP(3));
    RETURN;
  END IF;

  WITH requested("profile", "scope") AS (VALUES
    ('DRAWING_LIBRARY_READER', 'GLOBAL:DRAWING_LIBRARY'),
    ('PRODUCT_TIME_READER', 'GLOBAL:PRODUCT_TIME')
  )
  INSERT INTO "user_access_grants" (
    "id", "user_id", "profile_key", "department_id", "scope_key", "grant_type",
    "effective_from", "is_active", "version", "created_at", "updated_at"
  )
  SELECT gen_random_uuid()::text, target_user, requested."profile"::"access_profile_key",
    target_department, requested."scope", 'CONCURRENT'::"access_grant_type",
    CURRENT_TIMESTAMP(3), TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM requested
  WHERE NOT EXISTS (
    SELECT 1 FROM "user_access_grants" existing
    WHERE existing."user_id" = target_user
      AND existing."profile_key" = requested."profile"::"access_profile_key"
      AND existing."scope_key" = requested."scope"
      AND existing."is_active" = TRUE
      AND existing."effective_from" <= CURRENT_TIMESTAMP(3)
      AND (existing."effective_to" IS NULL OR existing."effective_to" > CURRENT_TIMESTAMP(3))
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count > 0 THEN
    -- Do not change the password or field_password_only: a weak field credential
    -- still requires a safe password reset before any workbench login is allowed.
    UPDATE "users" SET "session_version" = "session_version" + 1,
      "updated_at" = CURRENT_TIMESTAMP(3) WHERE "id" = target_user;
    INSERT INTO "operation_logs" ("id", "action", "target_type", "target_id", "detail", "created_at")
    VALUES (gen_random_uuid()::text, 'grant_named_technical_read_access', 'user', target_user,
      jsonb_build_object('migration', '202608280003', 'employeeId', target_employee,
        'employeeName', '朱艳军', 'addedGrants', inserted_count,
        'profiles', jsonb_build_array('DRAWING_LIBRARY_READER', 'PRODUCT_TIME_READER')), CURRENT_TIMESTAMP(3));
  END IF;
END $$;
