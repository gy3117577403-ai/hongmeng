-- 李琴需要保留原主部门，同时并行获得计划、生产协同和物料跟进。
-- 姓名不是唯一键：只有恰好一个在职且绑定正常账号的员工匹配时才授权，
-- 否则在迁移日志中给出警告并保持零变更，避免误授给同名人员。
DO $$
DECLARE
  target_count integer;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM "users" u
  JOIN "employees" e ON e."id" = u."employee_id"
  WHERE e."name" = '李琴'
    AND e."is_active" = TRUE
    AND e."resigned_at" IS NULL
    AND u."is_active" = TRUE
    AND u."account_status" = 'ACTIVE'::"account_status";

  IF target_count <> 1 THEN
    RAISE WARNING '李琴兼岗授权未执行：匹配到 % 个在职且可登录账号，必须由管理员按员工编号确认', target_count;
  END IF;
END $$;

WITH target AS (
  SELECT MAX(u."id") AS "user_id"
  FROM "users" u
  JOIN "employees" e ON e."id" = u."employee_id"
  WHERE e."name" = '李琴'
    AND e."is_active" = TRUE
    AND e."resigned_at" IS NULL
    AND u."is_active" = TRUE
    AND u."account_status" = 'ACTIVE'::"account_status"
  HAVING COUNT(*) = 1
), requested_profile AS (
  SELECT * FROM (VALUES
    ('PLANNING_COLLABORATOR', 'PLANNING', 'GLOBAL:PLANNING_COLLABORATION'),
    ('PRODUCTION_COLLABORATOR', 'PRODUCTION', 'WORKSHOP:PRODUCTION_COLLABORATION'),
    ('MATERIAL_FOLLOW_UP_OPERATOR', 'PROCUREMENT', 'GLOBAL:MATERIAL_FOLLOW_UP')
  ) AS value("profile_key", "department_code", "scope_key")
)
INSERT INTO "user_access_grants" (
  "id", "user_id", "profile_key", "department_id", "scope_key",
  "grant_type", "effective_from", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  target."user_id",
  requested_profile."profile_key"::"access_profile_key",
  department."id",
  requested_profile."scope_key",
  'CONCURRENT'::"access_grant_type",
  CURRENT_TIMESTAMP,
  TRUE,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM target
CROSS JOIN requested_profile
JOIN "departments" department
  ON department."code" = requested_profile."department_code"
 AND department."is_active" = TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM "user_access_grants" existing
  WHERE existing."user_id" = target."user_id"
    AND existing."profile_key" = requested_profile."profile_key"::"access_profile_key"
    AND existing."scope_key" = requested_profile."scope_key"
    AND existing."is_active" = TRUE
);
