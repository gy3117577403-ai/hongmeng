-- Reuse the existing drawing identity. Ambiguous legacy links retain their scope.
ALTER TABLE "quick_quality_records" ALTER COLUMN "scope" SET DEFAULT 'PRODUCT';
ALTER TABLE "quick_quality_records" ALTER COLUMN "print_policy" SET DEFAULT 'REQUIRED';
WITH candidates AS (
  SELECT l."record_id", min(p."id") AS product_id
  FROM "quick_quality_work_orders" l
  JOIN "work_orders" w ON w."id" = l."work_order_id"
  LEFT JOIN "drawing_library_items" p ON p."id" = w."drawing_library_item_id" AND p."deleted_at" IS NULL
  GROUP BY l."record_id"
  HAVING count(*) = count(p."id") AND count(DISTINCT p."id") = 1
), updated AS (
  UPDATE "quick_quality_records" r SET "scope" = 'PRODUCT', "product_id" = c.product_id,
    "product_signature" = NULL, "version" = r."version" + 1
  FROM candidates c WHERE r."id" = c."record_id" AND r."product_id" IS NULL AND r."scope" = 'WORK_ORDER'
  RETURNING r.*
)
INSERT INTO "quick_quality_activities" ("id", "record_id", "mutation_key", "payload_hash", "version", "action", "reason", "actor_id", "actor_name", "snapshot")
SELECT 'drawing-link-' || r."id", r."id", 'drawing-link-' || r."id", md5(r."id" || r."product_id"), r."version",
  'DRAWING_LINK_MIGRATED', '原工单唯一关联图纸，补齐图纸警示关联；原生效状态与打印设置保留', 'system-migration', '系统迁移',
  coalesce((SELECT a."snapshot" FROM "quick_quality_activities" a WHERE a."record_id" = r."id" ORDER BY a."version" DESC LIMIT 1), '{}'::jsonb)
  || jsonb_build_object('id',r."id",'number',r."number",'description',r."description",'version',r."version",'scope','PRODUCT','productId',r."product_id",'state',r."state",'deletedAt',r."deleted_at",'printPolicy',r."print_policy")
FROM updated r;
