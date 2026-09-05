-- CreateTable
CREATE TABLE "quality_references" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CRIMP',
    "terminal_id" TEXT,
    "terminal_name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "search_text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "delete_reason" TEXT,

    CONSTRAINT "quality_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_reference_attachments" (
    "id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "quality_reference_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_reference_revisions" (
    "id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_reference_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_reference_favorites" (
    "reference_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_reference_favorites_pkey" PRIMARY KEY ("reference_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_references_code_key" ON "quality_references"("code");

-- CreateIndex
CREATE INDEX "quality_references_deleted_at_updated_at_idx" ON "quality_references"("deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "quality_references_terminal_id_deleted_at_idx" ON "quality_references"("terminal_id", "deleted_at");

-- CreateIndex
CREATE INDEX "quality_references_terminal_name_manufacturer_idx" ON "quality_references"("terminal_name", "manufacturer");

-- CreateIndex
CREATE UNIQUE INDEX "quality_references_created_by_id_idempotency_key_key" ON "quality_references"("created_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "quality_reference_attachments_object_key_key" ON "quality_reference_attachments"("object_key");

-- CreateIndex
CREATE INDEX "quality_reference_attachments_reference_id_deleted_at_idx" ON "quality_reference_attachments"("reference_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quality_reference_attachments_reference_id_sha256_original__key" ON "quality_reference_attachments"("reference_id", "sha256", "original_name");

-- CreateIndex
CREATE UNIQUE INDEX "quality_reference_revisions_reference_id_version_key" ON "quality_reference_revisions"("reference_id", "version");

-- CreateIndex
CREATE INDEX "quality_reference_favorites_user_id_idx" ON "quality_reference_favorites"("user_id");

-- AddForeignKey
ALTER TABLE "quality_references" ADD CONSTRAINT "quality_references_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal_tooling_terminals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quality_reference_attachments" ADD CONSTRAINT "quality_reference_attachments_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "quality_references"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quality_reference_revisions" ADD CONSTRAINT "quality_reference_revisions_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "quality_references"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quality_reference_favorites" ADD CONSTRAINT "quality_reference_favorites_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "quality_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;
