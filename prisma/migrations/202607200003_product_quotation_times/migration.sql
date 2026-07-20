-- Keep commercial quotation labor separate from internal process and planning snapshots.

CREATE TABLE "product_quotation_times" (
    "id" TEXT NOT NULL,
    "drawing_library_item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "unit_milliseconds" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'manual',
    "source_ref_id" TEXT,
    "remark" TEXT,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_quotation_times_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_quotation_times_version_positive" CHECK ("version" > 0),
    CONSTRAINT "product_quotation_times_unit_range" CHECK ("unit_milliseconds" > 0 AND "unit_milliseconds" <= 86400000),
    CONSTRAINT "product_quotation_times_status_check" CHECK ("status" IN ('active', 'archived')),
    CONSTRAINT "product_quotation_times_source_type_check" CHECK ("source_type" IN ('manual', 'import', 'quotation'))
);

CREATE UNIQUE INDEX "product_quotation_times_drawing_library_item_id_version_key"
ON "product_quotation_times"("drawing_library_item_id", "version");

CREATE UNIQUE INDEX "product_quotation_times_one_active_per_item"
ON "product_quotation_times"("drawing_library_item_id") WHERE "status" = 'active';

CREATE INDEX "product_quotation_times_drawing_library_item_id_status_idx"
ON "product_quotation_times"("drawing_library_item_id", "status");

CREATE INDEX "product_quotation_times_status_effective_at_idx"
ON "product_quotation_times"("status", "effective_at");

ALTER TABLE "product_quotation_times"
ADD CONSTRAINT "product_quotation_times_drawing_library_item_id_fkey"
FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "product_quotation_times_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
