-- Add product-specific unit-time profiles without rewriting historical process snapshots.

CREATE TABLE "product_time_profiles" (
    "id" TEXT NOT NULL,
    "drawing_library_item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source_type" TEXT NOT NULL DEFAULT 'manual',
    "remark" TEXT,
    "published_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "published_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_time_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_time_profiles_version_positive" CHECK ("version" > 0),
    CONSTRAINT "product_time_profiles_revision_nonnegative" CHECK ("revision" >= 0),
    CONSTRAINT "product_time_profiles_status_check" CHECK ("status" IN ('draft', 'published', 'archived'))
);

CREATE TABLE "product_process_time_entries" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "process_definition_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "unit_milliseconds" INTEGER NOT NULL,
    "action_milliseconds" INTEGER,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "unit_label" TEXT NOT NULL DEFAULT '件',
    "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_process_time_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_process_time_entries_position_positive" CHECK ("position" > 0),
    CONSTRAINT "product_process_time_entries_unit_positive" CHECK ("unit_milliseconds" > 0),
    CONSTRAINT "product_process_time_entries_action_positive" CHECK ("action_milliseconds" IS NULL OR "action_milliseconds" > 0),
    CONSTRAINT "product_process_time_entries_occurrences_positive" CHECK ("occurrences" > 0),
    CONSTRAINT "product_process_time_entries_setup_nonnegative" CHECK ("setup_milliseconds" >= 0)
);

ALTER TABLE "work_order_process_routes"
ADD COLUMN "product_time_profile_id" TEXT,
ADD COLUMN "product_time_profile_version" INTEGER,
ADD COLUMN "route_source" TEXT NOT NULL DEFAULT 'process_template';

ALTER TABLE "work_order_process_steps"
ADD COLUMN "product_time_profile_id" TEXT,
ADD COLUMN "product_time_entry_id" TEXT,
ADD COLUMN "product_time_profile_version" INTEGER,
ADD COLUMN "standard_source" TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE "process_executions"
ADD COLUMN "standard_source" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "product_time_profile_version" INTEGER;

ALTER TABLE "work_order_process_routes"
ADD CONSTRAINT "work_order_process_routes_product_time_profile_version_positive"
CHECK ("product_time_profile_version" IS NULL OR "product_time_profile_version" > 0);

ALTER TABLE "work_order_process_steps"
ADD CONSTRAINT "work_order_process_steps_product_time_profile_version_positive"
CHECK ("product_time_profile_version" IS NULL OR "product_time_profile_version" > 0);

ALTER TABLE "process_executions"
ADD CONSTRAINT "process_executions_product_time_profile_version_positive"
CHECK ("product_time_profile_version" IS NULL OR "product_time_profile_version" > 0);

CREATE UNIQUE INDEX "product_time_profiles_drawing_library_item_id_version_key"
ON "product_time_profiles"("drawing_library_item_id", "version");
CREATE UNIQUE INDEX "product_time_profiles_one_draft_per_item"
ON "product_time_profiles"("drawing_library_item_id") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "product_time_profiles_one_published_per_item"
ON "product_time_profiles"("drawing_library_item_id") WHERE "status" = 'published';
CREATE INDEX "product_time_profiles_drawing_library_item_id_status_idx"
ON "product_time_profiles"("drawing_library_item_id", "status");
CREATE INDEX "product_time_profiles_status_updated_at_idx"
ON "product_time_profiles"("status", "updated_at");
CREATE INDEX "product_time_profiles_published_at_idx"
ON "product_time_profiles"("published_at");

CREATE UNIQUE INDEX "product_process_time_entries_profile_id_process_definition_id_key"
ON "product_process_time_entries"("profile_id", "process_definition_id");
CREATE UNIQUE INDEX "product_process_time_entries_profile_id_position_key"
ON "product_process_time_entries"("profile_id", "position");
CREATE INDEX "product_process_time_entries_process_definition_id_idx"
ON "product_process_time_entries"("process_definition_id");

CREATE INDEX "work_order_process_routes_product_time_profile_id_idx"
ON "work_order_process_routes"("product_time_profile_id");
CREATE INDEX "work_order_process_steps_product_time_profile_id_idx"
ON "work_order_process_steps"("product_time_profile_id");
CREATE INDEX "work_order_process_steps_product_time_entry_id_idx"
ON "work_order_process_steps"("product_time_entry_id");

ALTER TABLE "product_time_profiles"
ADD CONSTRAINT "product_time_profiles_drawing_library_item_id_fkey"
FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "product_time_profiles_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "product_time_profiles_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "product_time_profiles_published_by_id_fkey"
FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_process_time_entries"
ADD CONSTRAINT "product_process_time_entries_profile_id_fkey"
FOREIGN KEY ("profile_id") REFERENCES "product_time_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "product_process_time_entries_process_definition_id_fkey"
FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_process_routes"
ADD CONSTRAINT "work_order_process_routes_product_time_profile_id_fkey"
FOREIGN KEY ("product_time_profile_id") REFERENCES "product_time_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_order_process_steps"
ADD CONSTRAINT "work_order_process_steps_product_time_profile_id_fkey"
FOREIGN KEY ("product_time_profile_id") REFERENCES "product_time_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "work_order_process_steps_product_time_entry_id_fkey"
FOREIGN KEY ("product_time_entry_id") REFERENCES "product_process_time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
