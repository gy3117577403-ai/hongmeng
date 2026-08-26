CREATE TYPE "material_library_warning_state" AS ENUM ('NONE', 'ATTENTION', 'DEFECT');
CREATE TYPE "material_library_item_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "material_library_upload_mode" AS ENUM ('TEMPORARY', 'PERMANENT');
CREATE TYPE "material_library_upload_link_status" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "material_library_capture_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "material_library_categories" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_categories_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "material_library_items" (
  "id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "manufacturer_model" TEXT,
  "specification" TEXT,
  "material_composition" TEXT,
  "supplier_name" TEXT,
  "supplier_part_number" TEXT,
  "batch_number" TEXT,
  "warning_state" "material_library_warning_state" NOT NULL DEFAULT 'NONE',
  "warning_note" TEXT,
  "status" "material_library_item_status" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "last_captured_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "deleted_at" TIMESTAMP(3),
  "deleted_reason" TEXT,
  "deleted_by_id" TEXT,
  "deleted_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_items_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "material_library_upload_links" (
  "id" TEXT NOT NULL,
  "material_item_id" TEXT NOT NULL,
  "mode" "material_library_upload_mode" NOT NULL,
  "status" "material_library_upload_link_status" NOT NULL DEFAULT 'ACTIVE',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "last_scanned_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_upload_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_upload_links_generation_check" CHECK ("generation" >= 1),
  CONSTRAINT "material_library_upload_links_expiry_check" CHECK ("mode" = 'PERMANENT' OR "expires_at" IS NOT NULL)
);

CREATE TABLE "material_library_capture_sessions" (
  "id" TEXT NOT NULL,
  "session_no" TEXT NOT NULL,
  "upload_link_id" TEXT NOT NULL,
  "material_item_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "status" "material_library_capture_status" NOT NULL DEFAULT 'ACTIVE',
  "draft_manufacturer_model" TEXT,
  "draft_specification" TEXT,
  "draft_material_composition" TEXT,
  "draft_supplier_name" TEXT,
  "draft_supplier_part_number" TEXT,
  "draft_batch_number" TEXT,
  "draft_warning_state" "material_library_warning_state" NOT NULL DEFAULT 'NONE',
  "draft_warning_note" TEXT,
  "draft_notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "connected_by_id" TEXT,
  "connected_by_name" TEXT,
  "connected_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_capture_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_capture_sessions_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "material_library_photos" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "material_item_id" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "object_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_cover" BOOLEAN NOT NULL DEFAULT false,
  "caption" TEXT,
  "capture_source" TEXT,
  "uploaded_by_id" TEXT,
  "uploaded_by_name" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_photos_size_check" CHECK ("size" > 0),
  CONSTRAINT "material_library_photos_rotation_check" CHECK ("rotation" IN (0, 90, 180, 270)),
  CONSTRAINT "material_library_photos_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE UNIQUE INDEX "material_library_categories_code_key" ON "material_library_categories"("code");
CREATE INDEX "material_library_categories_deleted_at_sort_order_idx" ON "material_library_categories"("deleted_at", "sort_order");

CREATE UNIQUE INDEX "material_library_items_code_key" ON "material_library_items"("code");
CREATE INDEX "material_library_items_category_id_deleted_at_updated_at_idx" ON "material_library_items"("category_id", "deleted_at", "updated_at");
CREATE INDEX "material_library_items_warning_state_deleted_at_updated_at_idx" ON "material_library_items"("warning_state", "deleted_at", "updated_at");
CREATE INDEX "material_library_items_status_deleted_at_updated_at_idx" ON "material_library_items"("status", "deleted_at", "updated_at");

CREATE UNIQUE INDEX "material_library_upload_links_token_hash_key" ON "material_library_upload_links"("token_hash");
CREATE INDEX "material_library_upload_links_material_item_id_status_mode_created_at_idx" ON "material_library_upload_links"("material_item_id", "status", "mode", "created_at");
CREATE INDEX "material_library_upload_links_expires_at_status_idx" ON "material_library_upload_links"("expires_at", "status");
CREATE UNIQUE INDEX "material_library_upload_links_one_active_permanent_idx"
  ON "material_library_upload_links"("material_item_id")
  WHERE "mode" = 'PERMANENT' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "material_library_capture_sessions_session_no_key" ON "material_library_capture_sessions"("session_no");
CREATE UNIQUE INDEX "material_library_capture_sessions_one_active_per_item_idx"
  ON "material_library_capture_sessions"("material_item_id")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "material_library_capture_sessions_upload_link_id_status_created_at_idx" ON "material_library_capture_sessions"("upload_link_id", "status", "created_at");
CREATE INDEX "material_library_capture_sessions_material_item_id_status_updated_at_idx" ON "material_library_capture_sessions"("material_item_id", "status", "updated_at");
CREATE INDEX "material_library_capture_sessions_connected_by_id_status_updated_at_idx" ON "material_library_capture_sessions"("connected_by_id", "status", "updated_at");

CREATE UNIQUE INDEX "material_library_photos_object_key_key" ON "material_library_photos"("object_key");
CREATE INDEX "material_library_photos_session_id_deleted_at_sort_order_created_at_idx" ON "material_library_photos"("session_id", "deleted_at", "sort_order", "created_at");
CREATE INDEX "material_library_photos_material_item_id_deleted_at_is_cover_created_at_idx" ON "material_library_photos"("material_item_id", "deleted_at", "is_cover", "created_at");
CREATE INDEX "material_library_photos_sha256_material_item_id_idx" ON "material_library_photos"("sha256", "material_item_id");

ALTER TABLE "material_library_items"
  ADD CONSTRAINT "material_library_items_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "material_library_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_library_upload_links"
  ADD CONSTRAINT "material_library_upload_links_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_library_capture_sessions"
  ADD CONSTRAINT "material_library_capture_sessions_upload_link_id_fkey"
  FOREIGN KEY ("upload_link_id") REFERENCES "material_library_upload_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_library_capture_sessions_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_library_capture_sessions_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "material_library_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_library_photos"
  ADD CONSTRAINT "material_library_photos_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "material_library_capture_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_library_photos_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "material_library_categories" (
  "id", "code", "name", "sort_order", "is_system", "created_at", "updated_at"
) VALUES
  (gen_random_uuid()::text, 'TERMINAL', '端子', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CONNECTOR', '连接器', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AUXILIARY', '辅料', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sort_order" = EXCLUDED."sort_order",
  "is_system" = true,
  "updated_at" = CURRENT_TIMESTAMP;
