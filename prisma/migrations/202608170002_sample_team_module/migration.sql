CREATE TABLE "sample_tasks" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "qr_code" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "source_order_no" TEXT,
  "customer_name_snapshot" TEXT NOT NULL,
  "product_name_snapshot" TEXT,
  "specification_snapshot" TEXT NOT NULL,
  "customer_level_code" TEXT,
  "customer_level_label" TEXT,
  "customer_level_color" TEXT,
  "sample_quantity" INTEGER,
  "due_date" DATE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "data_status" TEXT NOT NULL DEFAULT 'NO_DATA',
  "plan_remark" TEXT,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "started_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sample_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_tasks_sample_quantity_check" CHECK ("sample_quantity" IS NULL OR "sample_quantity" >= 0),
  CONSTRAINT "sample_tasks_priority_check" CHECK ("priority" >= 0),
  CONSTRAINT "sample_tasks_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "sample_task_assignees" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "assigned_by_id" TEXT,
  "assigned_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sample_task_assignees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sample_data_entries" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "payload" JSONB NOT NULL,
  "review_status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publish_mode" TEXT,
  "review_comment" TEXT,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "reviewed_by_id" TEXT,
  "reviewed_by_name" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "published_by_id" TEXT,
  "published_by_name" TEXT,
  "published_at" TIMESTAMP(3),
  "published_entity_type" TEXT,
  "published_entity_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sample_data_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_data_entries_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "sample_photos" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  "caption" TEXT,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "object_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "capture_source" TEXT,
  "review_status" TEXT NOT NULL DEFAULT 'DRAFT',
  "review_comment" TEXT,
  "uploaded_by_id" TEXT,
  "uploaded_by_name" TEXT,
  "reviewed_by_id" TEXT,
  "reviewed_by_name" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "published_by_id" TEXT,
  "published_by_name" TEXT,
  "published_at" TIMESTAMP(3),
  "published_file_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sample_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_photos_size_check" CHECK ("size" >= 0),
  CONSTRAINT "sample_photos_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "product_data_records" (
  "id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "payload" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "source_type" TEXT NOT NULL DEFAULT 'SAMPLE_TASK',
  "source_sample_entry_id" TEXT,
  "supersedes_record_id" TEXT,
  "published_by_id" TEXT,
  "published_by_name" TEXT,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_data_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_data_records_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "product_connector_parameter_bindings" (
  "id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "connector_parameter_id" TEXT NOT NULL,
  "position_label" TEXT,
  "version" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "source_sample_entry_id" TEXT,
  "published_by_id" TEXT,
  "published_by_name" TEXT,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_connector_parameter_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_connector_parameter_bindings_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "sample_tasks_code_key" ON "sample_tasks"("code");
CREATE UNIQUE INDEX "sample_tasks_qr_code_key" ON "sample_tasks"("qr_code");
CREATE INDEX "sample_tasks_drawing_library_item_id_created_at_idx" ON "sample_tasks"("drawing_library_item_id", "created_at");
CREATE INDEX "sample_tasks_status_due_date_idx" ON "sample_tasks"("status", "due_date");
CREATE INDEX "sample_tasks_data_status_updated_at_idx" ON "sample_tasks"("data_status", "updated_at");
CREATE INDEX "sample_tasks_customer_level_code_idx" ON "sample_tasks"("customer_level_code");
CREATE INDEX "sample_tasks_deleted_at_idx" ON "sample_tasks"("deleted_at");

CREATE UNIQUE INDEX "sample_task_assignees_task_id_employee_id_key" ON "sample_task_assignees"("task_id", "employee_id");
CREATE INDEX "sample_task_assignees_employee_id_created_at_idx" ON "sample_task_assignees"("employee_id", "created_at");

CREATE INDEX "sample_data_entries_task_id_review_status_created_at_idx" ON "sample_data_entries"("task_id", "review_status", "created_at");
CREATE INDEX "sample_data_entries_kind_review_status_idx" ON "sample_data_entries"("kind", "review_status");
CREATE INDEX "sample_data_entries_published_entity_type_published_entity_id_idx" ON "sample_data_entries"("published_entity_type", "published_entity_id");
CREATE INDEX "sample_data_entries_deleted_at_idx" ON "sample_data_entries"("deleted_at");

CREATE UNIQUE INDEX "sample_photos_object_key_key" ON "sample_photos"("object_key");
CREATE UNIQUE INDEX "sample_photos_published_file_id_key" ON "sample_photos"("published_file_id");
CREATE INDEX "sample_photos_task_id_review_status_created_at_idx" ON "sample_photos"("task_id", "review_status", "created_at");
CREATE INDEX "sample_photos_category_review_status_idx" ON "sample_photos"("category", "review_status");
CREATE INDEX "sample_photos_deleted_at_idx" ON "sample_photos"("deleted_at");

CREATE UNIQUE INDEX "product_data_records_source_sample_entry_id_key" ON "product_data_records"("source_sample_entry_id");
CREATE UNIQUE INDEX "product_data_records_drawing_library_item_id_kind_version_key" ON "product_data_records"("drawing_library_item_id", "kind", "version");
CREATE INDEX "product_data_records_drawing_library_item_id_kind_status_idx" ON "product_data_records"("drawing_library_item_id", "kind", "status");
CREATE INDEX "product_data_records_published_at_idx" ON "product_data_records"("published_at");

CREATE UNIQUE INDEX "product_connector_parameter_bindings_source_sample_entry_id_key" ON "product_connector_parameter_bindings"("source_sample_entry_id");
CREATE UNIQUE INDEX "product_connector_parameter_bindings_drawing_library_item_id_version_key" ON "product_connector_parameter_bindings"("drawing_library_item_id", "version");
CREATE INDEX "product_connector_parameter_bindings_drawing_library_item_id_is_current_idx" ON "product_connector_parameter_bindings"("drawing_library_item_id", "is_current");
CREATE INDEX "product_connector_parameter_bindings_connector_parameter_id_idx" ON "product_connector_parameter_bindings"("connector_parameter_id");

ALTER TABLE "sample_tasks"
  ADD CONSTRAINT "sample_tasks_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sample_task_assignees"
  ADD CONSTRAINT "sample_task_assignees_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sample_task_assignees_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sample_data_entries"
  ADD CONSTRAINT "sample_data_entries_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sample_photos"
  ADD CONSTRAINT "sample_photos_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sample_photos_published_file_id_fkey"
  FOREIGN KEY ("published_file_id") REFERENCES "drawing_library_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_data_records"
  ADD CONSTRAINT "product_data_records_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_connector_parameter_bindings"
  ADD CONSTRAINT "product_connector_parameter_bindings_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "product_connector_parameter_bindings_connector_parameter_id_fkey"
  FOREIGN KEY ("connector_parameter_id") REFERENCES "connector_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "resource_categories" ("id", "name", "code", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, '剥皮参数', 'sample_parameters', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '样品过程图', 'sample_process', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '测量证据', 'sample_measurement', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;
