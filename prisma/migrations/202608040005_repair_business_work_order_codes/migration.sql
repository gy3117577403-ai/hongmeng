-- Rebuild human-facing work order numbers so Chinese-only specifications do not
-- collapse into an empty product segment. System linkage continues to use id/code.
UPDATE "work_orders" SET "business_code" = NULL;

WITH normalized_roots AS (
  SELECT
    "id",
    TO_CHAR(
      COALESCE("started_at", "planned_at", "order_date", "created_at") AT TIME ZONE 'Asia/Shanghai',
      'YYYYMMDD'
    ) AS "date_key",
    COALESCE(
      NULLIF(
        LEFT(
          TRIM(BOTH '-' FROM REGEXP_REPLACE(
            UPPER(COALESCE(NULLIF("specification", ''), NULLIF("product_name", ''))),
            '[^A-Z0-9一-龥]+',
            '-',
            'g'
          )),
          32
        ),
        ''
      ),
      'PRODUCT'
    ) AS "product_key",
    "created_at"
  FROM "work_orders"
  WHERE "parent_work_order_id" IS NULL
), numbered_roots AS (
  SELECT
    "id",
    'SC-HL-' || "date_key" || '-' || "product_key" || '-' ||
      LPAD(ROW_NUMBER() OVER (
        PARTITION BY "date_key", "product_key"
        ORDER BY "created_at", "id"
      )::TEXT, 2, '0') AS "business_code"
  FROM normalized_roots
)
UPDATE "work_orders" AS work_order
SET "business_code" = numbered_roots."business_code"
FROM numbered_roots
WHERE work_order."id" = numbered_roots."id";

WITH RECURSIVE branch_codes AS (
  SELECT
    child."id",
    parent."business_code" || '-' ||
      CASE child."branch_type"::TEXT
        WHEN 'REWORK' THEN 'RW'
        WHEN 'SCRAP_REPLENISH' THEN 'RP'
        WHEN 'QUALITY_PENDING' THEN 'QH'
        ELSE 'BR'
      END || LPAD(COALESCE(child."branch_sequence", 1)::TEXT, 2, '0') AS "business_code"
  FROM "work_orders" child
  JOIN "work_orders" parent ON parent."id" = child."parent_work_order_id"
  WHERE parent."parent_work_order_id" IS NULL

  UNION ALL

  SELECT
    child."id",
    parent_code."business_code" || '-' ||
      CASE child."branch_type"::TEXT
        WHEN 'REWORK' THEN 'RW'
        WHEN 'SCRAP_REPLENISH' THEN 'RP'
        WHEN 'QUALITY_PENDING' THEN 'QH'
        ELSE 'BR'
      END || LPAD(COALESCE(child."branch_sequence", 1)::TEXT, 2, '0') AS "business_code"
  FROM "work_orders" child
  JOIN branch_codes parent_code ON parent_code."id" = child."parent_work_order_id"
)
UPDATE "work_orders" AS work_order
SET "business_code" = LEFT(branch_codes."business_code", 120)
FROM branch_codes
WHERE work_order."id" = branch_codes."id";
