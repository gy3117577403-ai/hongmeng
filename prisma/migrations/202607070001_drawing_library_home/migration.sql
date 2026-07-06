CREATE TABLE "drawing_library_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "customer_name" TEXT NOT NULL,
  "customer_code" TEXT,
  "product_name" TEXT,
  "specification" TEXT NOT NULL,
  "library_key" TEXT NOT NULL,
  "remark" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_work_order_id" TEXT,
  "last_imported_at" TIMESTAMP(3),
  CONSTRAINT "drawing_library_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drawing_library_files" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "library_item_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "display_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'V1.0',
  "object_key" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "remark" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drawing_library_files_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "work_orders" ADD COLUMN "drawing_library_item_id" TEXT;

CREATE UNIQUE INDEX "drawing_library_items_library_key_key" ON "drawing_library_items"("library_key");
CREATE INDEX "drawing_library_items_customer_name_idx" ON "drawing_library_items"("customer_name");
CREATE INDEX "drawing_library_items_customer_code_idx" ON "drawing_library_items"("customer_code");
CREATE INDEX "drawing_library_items_product_name_idx" ON "drawing_library_items"("product_name");
CREATE INDEX "drawing_library_items_specification_idx" ON "drawing_library_items"("specification");
CREATE INDEX "drawing_library_items_deleted_at_idx" ON "drawing_library_items"("deleted_at");
CREATE INDEX "drawing_library_items_updated_at_idx" ON "drawing_library_items"("updated_at");
CREATE INDEX "drawing_library_items_last_work_order_id_idx" ON "drawing_library_items"("last_work_order_id");
CREATE INDEX "drawing_library_files_library_item_id_idx" ON "drawing_library_files"("library_item_id");
CREATE INDEX "drawing_library_files_category_id_idx" ON "drawing_library_files"("category_id");
CREATE INDEX "drawing_library_files_deleted_at_idx" ON "drawing_library_files"("deleted_at");
CREATE INDEX "drawing_library_files_created_at_idx" ON "drawing_library_files"("created_at");
CREATE INDEX "drawing_library_files_version_idx" ON "drawing_library_files"("version");
CREATE INDEX "drawing_library_files_object_key_idx" ON "drawing_library_files"("object_key");
CREATE INDEX "work_orders_drawing_library_item_id_idx" ON "work_orders"("drawing_library_item_id");

ALTER TABLE "drawing_library_items" ADD CONSTRAINT "drawing_library_items_last_work_order_id_fkey" FOREIGN KEY ("last_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drawing_library_files" ADD CONSTRAINT "drawing_library_files_library_item_id_fkey" FOREIGN KEY ("library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drawing_library_files" ADD CONSTRAINT "drawing_library_files_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "resource_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drawing_library_files" ADD CONSTRAINT "drawing_library_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_drawing_library_item_id_fkey" FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "drawing_library_items" (
  "customer_name",
  "customer_code",
  "product_name",
  "specification",
  "library_key",
  "last_work_order_id",
  "last_imported_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (
  CASE
    WHEN NULLIF(BTRIM("customer_name"), '') IS NULL THEN BTRIM("specification")
    ELSE BTRIM("customer_name") || '::' || BTRIM("specification")
  END
)
  COALESCE(NULLIF(BTRIM("customer_name"), ''), '未设置') AS "customer_name",
  substring(COALESCE("customer_name", '') from '\(([^()]*)\)\s*$') AS "customer_code",
  NULLIF(BTRIM("product_name"), '') AS "product_name",
  BTRIM("specification") AS "specification",
  CASE
    WHEN NULLIF(BTRIM("customer_name"), '') IS NULL THEN BTRIM("specification")
    ELSE BTRIM("customer_name") || '::' || BTRIM("specification")
  END AS "library_key",
  "id" AS "last_work_order_id",
  COALESCE("updated_at", "created_at") AS "last_imported_at",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "work_orders"
WHERE "deleted_at" IS NULL
  AND NULLIF(BTRIM("specification"), '') IS NOT NULL
ORDER BY
  CASE
    WHEN NULLIF(BTRIM("customer_name"), '') IS NULL THEN BTRIM("specification")
    ELSE BTRIM("customer_name") || '::' || BTRIM("specification")
  END,
  "updated_at" DESC;

UPDATE "work_orders" AS wo
SET "drawing_library_item_id" = item."id"
FROM "drawing_library_items" AS item
WHERE wo."deleted_at" IS NULL
  AND NULLIF(BTRIM(wo."specification"), '') IS NOT NULL
  AND item."library_key" = CASE
    WHEN NULLIF(BTRIM(wo."customer_name"), '') IS NULL THEN BTRIM(wo."specification")
    ELSE BTRIM(wo."customer_name") || '::' || BTRIM(wo."specification")
  END;
