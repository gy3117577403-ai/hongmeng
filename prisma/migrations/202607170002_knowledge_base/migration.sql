-- CreateTable
CREATE TABLE "knowledge_articles" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'published',
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "customer_name" TEXT,
    "specification" TEXT,
    "product_model" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_attachments" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "display_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_relations" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_label" TEXT,
    "source_href" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_articles_sequence_key" ON "knowledge_articles"("sequence");
CREATE INDEX "knowledge_articles_category_idx" ON "knowledge_articles"("category");
CREATE INDEX "knowledge_articles_status_idx" ON "knowledge_articles"("status");
CREATE INDEX "knowledge_articles_customer_name_idx" ON "knowledge_articles"("customer_name");
CREATE INDEX "knowledge_articles_specification_idx" ON "knowledge_articles"("specification");
CREATE INDEX "knowledge_articles_product_model_idx" ON "knowledge_articles"("product_model");
CREATE INDEX "knowledge_articles_updated_at_idx" ON "knowledge_articles"("updated_at");
CREATE INDEX "knowledge_articles_deleted_at_idx" ON "knowledge_articles"("deleted_at");
CREATE UNIQUE INDEX "knowledge_attachments_object_key_key" ON "knowledge_attachments"("object_key");
CREATE INDEX "knowledge_attachments_article_id_created_at_idx" ON "knowledge_attachments"("article_id", "created_at");
CREATE INDEX "knowledge_attachments_uploaded_by_id_idx" ON "knowledge_attachments"("uploaded_by_id");
CREATE INDEX "knowledge_attachments_deleted_at_idx" ON "knowledge_attachments"("deleted_at");
CREATE UNIQUE INDEX "knowledge_relations_article_id_source_type_source_id_key" ON "knowledge_relations"("article_id", "source_type", "source_id");
CREATE INDEX "knowledge_relations_source_type_source_id_idx" ON "knowledge_relations"("source_type", "source_id");
CREATE INDEX "knowledge_relations_created_at_idx" ON "knowledge_relations"("created_at");

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
