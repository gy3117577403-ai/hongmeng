-- CreateTable
CREATE TABLE "quick_quality_records" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'SAVED',
    "scope" TEXT NOT NULL DEFAULT 'WORK_ORDER',
    "product_id" TEXT,
    "product_signature" TEXT,
    "process_name" TEXT NOT NULL DEFAULT '',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "print_policy" TEXT NOT NULL DEFAULT 'SYSTEM_ONLY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "escalated_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_quality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_quality_work_orders" (
    "record_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,

    CONSTRAINT "quick_quality_work_orders_pkey" PRIMARY KEY ("record_id","work_order_id")
);

-- CreateTable
CREATE TABLE "quick_quality_attachments" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "image_orientation" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_quality_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_quality_activities" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "mutation_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_quality_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_records_number_key" ON "quick_quality_records"("number");

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_records_request_key_key" ON "quick_quality_records"("request_key");

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_records_escalated_report_id_key" ON "quick_quality_records"("escalated_report_id");

-- CreateIndex
CREATE INDEX "quick_quality_records_deleted_at_state_updated_at_idx" ON "quick_quality_records"("deleted_at", "state", "updated_at");

-- CreateIndex
CREATE INDEX "quick_quality_records_product_id_state_idx" ON "quick_quality_records"("product_id", "state");

-- CreateIndex
CREATE INDEX "quick_quality_work_orders_work_order_id_idx" ON "quick_quality_work_orders"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_attachments_object_key_key" ON "quick_quality_attachments"("object_key");

-- CreateIndex
CREATE INDEX "quick_quality_attachments_record_id_deleted_at_idx" ON "quick_quality_attachments"("record_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_activities_mutation_key_key" ON "quick_quality_activities"("mutation_key");

-- CreateIndex
CREATE UNIQUE INDEX "quick_quality_activities_record_id_version_key" ON "quick_quality_activities"("record_id", "version");

-- AddForeignKey
ALTER TABLE "quick_quality_records" ADD CONSTRAINT "quick_quality_records_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_quality_work_orders" ADD CONSTRAINT "quick_quality_work_orders_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "quick_quality_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_quality_work_orders" ADD CONSTRAINT "quick_quality_work_orders_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_quality_attachments" ADD CONSTRAINT "quick_quality_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "quick_quality_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_quality_activities" ADD CONSTRAINT "quick_quality_activities_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "quick_quality_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
