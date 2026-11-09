-- CreateTable
CREATE TABLE "material_losses" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "root_id" TEXT NOT NULL,
    "corrects_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "warehouse_task_id" TEXT,
    "target_label" TEXT NOT NULL DEFAULT '仓库公共损耗',
    "applicant_id" TEXT NOT NULL,
    "applicant_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "material_name" TEXT NOT NULL DEFAULT '',
    "material_model" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "supply_source" TEXT NOT NULL DEFAULT 'PURCHASED',
    "quantity" DECIMAL(18,6),
    "occurred_on" DATE,
    "category" TEXT NOT NULL DEFAULT '其他',
    "reason" TEXT NOT NULL DEFAULT '',
    "affects_kitting" BOOLEAN NOT NULL DEFAULT false,
    "need_replenishment" BOOLEAN NOT NULL DEFAULT false,
    "replenishment_quantity" DECIMAL(18,6),
    "expected_on" DATE,
    "correction_reason" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewer_id" TEXT,
    "reviewer_name" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_losses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_loss_events" (
    "id" TEXT NOT NULL,
    "loss_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_loss_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_loss_commands" (
    "key" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "loss_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_loss_commands_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "material_loss_attachments" (
    "id" TEXT NOT NULL,
    "loss_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_loss_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_loss_replenishments" (
    "id" TEXT NOT NULL,
    "loss_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "received_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" TEXT NOT NULL DEFAULT '',
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_loss_replenishments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_losses_number_key" ON "material_losses"("number");

-- CreateIndex
CREATE UNIQUE INDEX "material_losses_corrects_id_key" ON "material_losses"("corrects_id");

-- CreateIndex
CREATE INDEX "material_losses_status_occurred_on_id_idx" ON "material_losses"("status", "occurred_on", "id");

-- CreateIndex
CREATE INDEX "material_losses_applicant_id_created_at_idx" ON "material_losses"("applicant_id", "created_at");

-- CreateIndex
CREATE INDEX "material_losses_warehouse_task_id_status_idx" ON "material_losses"("warehouse_task_id", "status");

-- CreateIndex
CREATE INDEX "material_losses_root_id_idx" ON "material_losses"("root_id");

-- CreateIndex
CREATE INDEX "material_loss_events_loss_id_created_at_idx" ON "material_loss_events"("loss_id", "created_at");

-- CreateIndex
CREATE INDEX "material_loss_commands_loss_id_idx" ON "material_loss_commands"("loss_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_loss_attachments_object_key_key" ON "material_loss_attachments"("object_key");

-- CreateIndex
CREATE INDEX "material_loss_attachments_loss_id_deleted_at_idx" ON "material_loss_attachments"("loss_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_loss_replenishments_loss_id_key" ON "material_loss_replenishments"("loss_id");

-- CreateIndex
CREATE INDEX "material_loss_replenishments_status_updated_at_idx" ON "material_loss_replenishments"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "material_losses" ADD CONSTRAINT "material_losses_root_id_fkey" FOREIGN KEY ("root_id") REFERENCES "material_losses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "material_losses" ADD CONSTRAINT "material_losses_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "material_losses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "material_losses" ADD CONSTRAINT "material_losses_warehouse_task_id_fkey" FOREIGN KEY ("warehouse_task_id") REFERENCES "warehouse_material_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_loss_events" ADD CONSTRAINT "material_loss_events_loss_id_fkey" FOREIGN KEY ("loss_id") REFERENCES "material_losses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_loss_attachments" ADD CONSTRAINT "material_loss_attachments_loss_id_fkey" FOREIGN KEY ("loss_id") REFERENCES "material_losses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_loss_replenishments" ADD CONSTRAINT "material_loss_replenishments_loss_id_fkey" FOREIGN KEY ("loss_id") REFERENCES "material_losses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
