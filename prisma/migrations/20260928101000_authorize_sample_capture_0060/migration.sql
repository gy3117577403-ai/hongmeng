-- Explicitly requested by the account owner. The live verified employee is
-- 0060 / 周迅 / ENGINEERING. Preserve every existing business and reporting grant.
-- Separate from enum creation so PostgreSQL can use the committed enum value.
DO $$
DECLARE
  target_user_id text;
  matches integer;
BEGIN
  SELECT count(*), min(u.id) INTO matches, target_user_id
  FROM users u JOIN employees e ON e.id = u.employee_id
  JOIN departments d ON d.id = e.department_id
  WHERE u.username = '0060' AND e.employee_no = '0060' AND e.name = '周迅'
    AND d.code = 'ENGINEERING' AND e.is_active AND d.is_active
    AND u.is_active AND u.account_status = 'ACTIVE'
    AND NOT u.field_password_only AND u.labor_role <> 'ADMIN'
    AND NOT EXISTS (SELECT 1 FROM user_access_grants g WHERE g.user_id = u.id AND g.profile_key = 'ADMIN_GLOBAL');

  IF matches <> 1 THEN
    RAISE NOTICE 'Sample capture grant skipped: exact active employee/account not found.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM operation_logs WHERE action = 'ACCOUNT_SAMPLE_CAPTURE_BOOTSTRAPPED'
    AND target_id = target_user_id AND detail->>'migration' = '20260928101000_authorize_sample_capture_0060') THEN
    RETURN;
  END IF;

  INSERT INTO user_access_grants (id,user_id,profile_key,scope_key,grant_type,effective_from,is_active,version,created_at,updated_at)
    SELECT gen_random_uuid()::text,target_user_id,'SAMPLE_CAPTURE_COLLABORATOR','MOBILE:SAMPLE_CAPTURE','CONCURRENT',now(),true,0,now(),now()
    WHERE NOT EXISTS (SELECT 1 FROM user_access_grants WHERE user_id = target_user_id
      AND profile_key = 'SAMPLE_CAPTURE_COLLABORATOR' AND is_active
      AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()));
  UPDATE users SET session_version = session_version + 1, updated_at = now() WHERE id = target_user_id;
  INSERT INTO operation_logs (id,action,target_type,target_id,detail,created_at)
    VALUES (gen_random_uuid()::text,'ACCOUNT_SAMPLE_CAPTURE_BOOTSTRAPPED','User',target_user_id,
      jsonb_build_object('migration','20260928101000_authorize_sample_capture_0060',
        'employeeNo','0060','employeeName','周迅','department','ENGINEERING',
        'authorization','Explicit user request','profile','SAMPLE_CAPTURE_COLLABORATOR',
        'existingBusinessGrantsPreserved',true),now());
END $$;
