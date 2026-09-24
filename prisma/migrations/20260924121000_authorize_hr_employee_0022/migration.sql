-- User-requested delegation for one verified HR employee.
-- Runs separately from ADD VALUE so PostgreSQL can use the committed enum.
-- No account is created, enabled, rebound or promoted to administrator.
DO $$
DECLARE
  v_target_id text;
  hr_id text;
  target_count integer;
  module_config boolean;
BEGIN
  SELECT count(*), min(u.id), min(d.id) INTO target_count, v_target_id, hr_id
  FROM users u JOIN employees e ON e.id = u.employee_id
  JOIN departments d ON d.id = e.department_id
  WHERE e.employee_no = '0022' AND e.name = '潘丹丹' AND d.code = 'HR'
    AND e.is_active AND d.is_active AND u.is_active AND u.account_status = 'ACTIVE'
    AND NOT u.field_password_only AND u.labor_role <> 'ADMIN'
    AND NOT EXISTS (SELECT 1 FROM user_access_grants g WHERE g.user_id = u.id AND g.profile_key = 'ADMIN_GLOBAL');

  IF target_count <> 1 THEN
    RAISE NOTICE 'HR delegation skipped: exact active employee/account match not found.';
    RETURN;
  END IF;
  -- Once applied, a later intentional revocation must never be undone by replay.
  IF EXISTS (SELECT 1 FROM operation_logs WHERE action = 'ACCOUNT_HR_DELEGATION_BOOTSTRAPPED'
      AND target_id = v_target_id AND detail->>'migration' = '20260924121000_authorize_hr_employee_0022') THEN
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM user_access_grants WHERE user_id = v_target_id
    AND profile_key = 'MODULE_ACCESS' AND is_active AND effective_from <= now()
    AND (effective_to IS NULL OR effective_to > now())) INTO module_config;

  IF module_config THEN
    UPDATE user_access_grants SET is_active = false, version = version + 1, updated_at = now()
      WHERE user_id = v_target_id AND profile_key = 'MODULE_ACCESS' AND scope_key = 'MODULES:OFF' AND is_active;
    INSERT INTO user_access_grants (id,user_id,profile_key,scope_key,grant_type,effective_from,is_active,version,created_at,updated_at)
      SELECT gen_random_uuid()::text,v_target_id,'MODULE_ACCESS',scope,'CONCURRENT',now(),true,0,now(),now()
      FROM (VALUES ('MODULES:ON'),('MODULE:people:COLLABORATE')) AS required(scope)
      WHERE NOT EXISTS (SELECT 1 FROM user_access_grants WHERE user_id = v_target_id
        AND profile_key = 'MODULE_ACCESS' AND scope_key = scope AND is_active
        AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()));
  ELSE
    INSERT INTO user_access_grants (id,user_id,profile_key,department_id,scope_key,grant_type,effective_from,is_active,version,created_at,updated_at)
      SELECT gen_random_uuid()::text,v_target_id,'DEPARTMENT_FULL',hr_id,'DEPARTMENT:HR','CONCURRENT',now(),true,0,now(),now()
      WHERE NOT EXISTS (SELECT 1 FROM user_access_grants WHERE user_id = v_target_id
        AND profile_key = 'DEPARTMENT_FULL' AND department_id = hr_id AND is_active
        AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()));
  END IF;

  INSERT INTO user_access_grants (id,user_id,profile_key,scope_key,grant_type,effective_from,is_active,version,created_at,updated_at)
    SELECT gen_random_uuid()::text,v_target_id,'EMPLOYEE_ACCESS_MANAGER','EMPLOYEES:BUSINESS_ACCESS','CONCURRENT',now(),true,0,now(),now()
    WHERE NOT EXISTS (SELECT 1 FROM user_access_grants WHERE user_id = v_target_id
      AND profile_key = 'EMPLOYEE_ACCESS_MANAGER' AND is_active
      AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()));

  UPDATE users SET session_version = session_version + 1, updated_at = now() WHERE id = v_target_id;
  INSERT INTO operation_logs (id,action,target_type,target_id,detail,created_at)
    VALUES (gen_random_uuid()::text,'ACCOUNT_HR_DELEGATION_BOOTSTRAPPED','User',v_target_id,
      jsonb_build_object('migration','20260924121000_authorize_hr_employee_0022',
        'employeeNo','0022','employeeName','潘丹丹','department','HR',
        'authorization','Explicit user request','profile','EMPLOYEE_ACCESS_MANAGER',
        'existingBusinessGrantsPreserved',true),now());
END $$;
