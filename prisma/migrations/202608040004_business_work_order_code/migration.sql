ALTER TABLE "work_orders"
  ADD COLUMN "business_code" TEXT;

WITH normalized AS (
  SELECT
    "id",
    TO_CHAR(
      COALESCE("started_at", "planned_at", "order_date", "created_at") AT TIME ZONE 'Asia/Shanghai',
      'YYYYMMDD'
    ) AS "date_key",
    COALESCE(
      NULLIF(REGEXP_REPLACE(UPPER(COALESCE(NULLIF("specification", ''), NULLIF("product_name", ''))), '[^A-Z0-9]+', '-', 'g'), ''),
      'PRODUCT'
    ) AS "product_key",
    "created_at"
  FROM "work_orders"
), numbered AS (
  SELECT
    "id",
    'SC-HL-' || "date_key" || '-' || LEFT(TRIM(BOTH '-' FROM "product_key"), 32) || '-' ||
      LPAD(ROW_NUMBER() OVER (
        PARTITION BY "date_key", LEFT(TRIM(BOTH '-' FROM "product_key"), 32)
        ORDER BY "created_at", "id"
      )::TEXT, 2, '0') AS "business_code"
  FROM normalized
)
UPDATE "work_orders" AS work_order
SET "business_code" = numbered."business_code"
FROM numbered
WHERE work_order."id" = numbered."id";

CREATE UNIQUE INDEX "work_orders_business_code_key"
  ON "work_orders"("business_code");

CREATE INDEX "work_orders_business_code_idx"
  ON "work_orders"("business_code");
