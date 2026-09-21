ALTER TABLE warehouse_material_exception_cases ADD COLUMN supply_source TEXT NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN material_model TEXT NOT NULL DEFAULT '', ADD COLUMN shortage_quantity DOUBLE PRECISION, ADD COLUMN received_quantity DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN unit TEXT NOT NULL DEFAULT '个';
ALTER TABLE warehouse_material_exception_cases ADD CONSTRAINT material_supply_source_valid CHECK (supply_source IN ('PURCHASED','CUSTOMER','UNKNOWN')), ADD CONSTRAINT material_quantity_valid CHECK ((shortage_quantity IS NULL OR (shortage_quantity >= 0 AND shortage_quantity <= 1000000000)) AND received_quantity >= 0 AND received_quantity <= 1000000000 AND (shortage_quantity IS NULL OR received_quantity <= shortage_quantity));
CREATE INDEX warehouse_material_exception_cases_supply_source_status_idx ON warehouse_material_exception_cases(supply_source,status);
ALTER TABLE fg_lots ADD COLUMN "productionCompletedAt" TIMESTAMP(3), ADD COLUMN "productionWorkDate" DATE, ADD COLUMN "transferredAt" TIMESTAMP(3);
-- Only source-backed production dates are reconstructed. Historical migration/receipt time is not completion time.
UPDATE fg_lots l SET "productionCompletedAt"=c.completed_at, "productionWorkDate"=c.work_date,
 "transferredAt"=(SELECT MIN(g."createdAt") FROM fg_ledger g WHERE g."lotId"=l.id AND g.kind='PRODUCTION_PENDING')
 FROM process_quantity_movements m JOIN process_completions c ON c.id=m.completion_id
 WHERE l."movementId"=m.id AND l."sourceKind"='PRODUCTION' AND m.type='FINISHED_GOOD';
CREATE FUNCTION fg_capture_production_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."sourceKind"='PRODUCTION' AND NEW."movementId" IS NOT NULL THEN
  SELECT c.completed_at,c.work_date INTO NEW."productionCompletedAt",NEW."productionWorkDate"
   FROM process_quantity_movements m JOIN process_completions c ON c.id=m.completion_id WHERE m.id=NEW."movementId" AND m.type='FINISHED_GOOD';
  NEW."transferredAt":=CURRENT_TIMESTAMP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fg_capture_production_dates BEFORE INSERT ON fg_lots FOR EACH ROW EXECUTE FUNCTION fg_capture_production_dates();
-- Preserve legacy open feedback that predates exception events; never infer purchased/customer source from notes.
INSERT INTO warehouse_material_exception_cases(id,warehouse_task_id,sequence,status,exception_type,exception_note,week_start_date,week_end_date,reported_at,reported_by_id,expected_arrival_at,created_at,updated_at)
 SELECT gen_random_uuid()::text,t.id,COALESCE((SELECT MAX(e.sequence) FROM warehouse_material_exception_cases e WHERE e.warehouse_task_id=t.id),0)+1,'OPEN',COALESCE(t.exception_type,'other'),COALESCE(NULLIF(t.exception_note,''),'历史仓库异常'),w.week_start_date,w.week_end_date,t.updated_at,t.updated_by_id,t.expected_at,t.created_at,t.updated_at
 FROM warehouse_material_tasks t JOIN work_orders w ON w.id=t.work_order_id WHERE t.status='exception' AND NOT EXISTS(SELECT 1 FROM warehouse_material_exception_cases e WHERE e.warehouse_task_id=t.id AND e.status='OPEN');
INSERT INTO material_follow_up_tasks(id,warehouse_task_id,warehouse_exception_id,status,latest_progress,expected_at,created_by_id,created_at,updated_at)
 SELECT gen_random_uuid()::text,e.warehouse_task_id,e.id,'PENDING',e.exception_note,e.expected_arrival_at,e.reported_by_id,e.created_at,e.updated_at FROM warehouse_material_exception_cases e WHERE e.status='OPEN' AND NOT EXISTS(SELECT 1 FROM material_follow_up_tasks f WHERE f.warehouse_exception_id=e.id);

-- Reconcile only the requested material collaboration grant; keep main department and existing owners.
-- 李琴保留原主部门及已有权限，新增两类物料跟进的兼岗权限。
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
