-- 8D reports are immutable PDF archives. Product and issue bindings are
-- deliberately modeled as independent many-to-many relations.
CREATE TABLE "eight_d_reports" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "report_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "report_date" TIMESTAMP(3),
    "responsible_department" TEXT,
    "keywords" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "current_version_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eight_d_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eight_d_reports_status_check" CHECK ("status" IN ('active', 'archived'))
);

CREATE TABLE "eight_d_report_versions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "display_name" TEXT,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "page_count" INTEGER,
    "note" TEXT,
    "uploaded_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eight_d_report_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eight_d_report_products" (
    "report_id" TEXT NOT NULL,
    "drawing_library_item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eight_d_report_products_pkey" PRIMARY KEY ("report_id", "drawing_library_item_id")
);

CREATE TABLE "eight_d_report_issues" (
    "report_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eight_d_report_issues_pkey" PRIMARY KEY ("report_id", "issue_id")
);

CREATE TABLE "eight_d_report_activities" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "content" TEXT,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eight_d_report_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eight_d_reports_sequence_key" ON "eight_d_reports"("sequence");
CREATE UNIQUE INDEX "eight_d_reports_report_no_key" ON "eight_d_reports"("report_no");
CREATE UNIQUE INDEX "eight_d_reports_current_version_id_key" ON "eight_d_reports"("current_version_id");
CREATE INDEX "eight_d_reports_status_updated_at_idx" ON "eight_d_reports"("status", "updated_at");
CREATE INDEX "eight_d_reports_report_date_idx" ON "eight_d_reports"("report_date");
CREATE INDEX "eight_d_reports_deleted_at_idx" ON "eight_d_reports"("deleted_at");
CREATE INDEX "eight_d_reports_created_by_id_idx" ON "eight_d_reports"("created_by_id");
CREATE INDEX "eight_d_reports_updated_by_id_idx" ON "eight_d_reports"("updated_by_id");

CREATE UNIQUE INDEX "eight_d_report_versions_object_key_key" ON "eight_d_report_versions"("object_key");
CREATE UNIQUE INDEX "eight_d_report_versions_report_id_version_number_key" ON "eight_d_report_versions"("report_id", "version_number");
CREATE UNIQUE INDEX "eight_d_report_versions_report_id_sha256_key" ON "eight_d_report_versions"("report_id", "sha256");
CREATE INDEX "eight_d_report_versions_report_id_deleted_at_version_number_idx" ON "eight_d_report_versions"("report_id", "deleted_at", "version_number");
CREATE INDEX "eight_d_report_versions_uploaded_by_id_idx" ON "eight_d_report_versions"("uploaded_by_id");
CREATE INDEX "eight_d_report_versions_deleted_at_idx" ON "eight_d_report_versions"("deleted_at");

CREATE INDEX "eight_d_report_products_drawing_library_item_id_report_id_idx" ON "eight_d_report_products"("drawing_library_item_id", "report_id");
CREATE INDEX "eight_d_report_issues_issue_id_report_id_idx" ON "eight_d_report_issues"("issue_id", "report_id");
CREATE INDEX "eight_d_report_activities_report_id_created_at_idx" ON "eight_d_report_activities"("report_id", "created_at");
CREATE INDEX "eight_d_report_activities_actor_id_idx" ON "eight_d_report_activities"("actor_id");
CREATE INDEX "eight_d_report_activities_action_idx" ON "eight_d_report_activities"("action");

ALTER TABLE "eight_d_reports"
    ADD CONSTRAINT "eight_d_reports_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eight_d_reports"
    ADD CONSTRAINT "eight_d_reports_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_versions"
    ADD CONSTRAINT "eight_d_report_versions_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "eight_d_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_versions"
    ADD CONSTRAINT "eight_d_report_versions_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eight_d_reports"
    ADD CONSTRAINT "eight_d_reports_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "eight_d_report_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_products"
    ADD CONSTRAINT "eight_d_report_products_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "eight_d_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_products"
    ADD CONSTRAINT "eight_d_report_products_drawing_library_item_id_fkey"
    FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_issues"
    ADD CONSTRAINT "eight_d_report_issues_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "eight_d_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_issues"
    ADD CONSTRAINT "eight_d_report_issues_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_activities"
    ADD CONSTRAINT "eight_d_report_activities_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "eight_d_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eight_d_report_activities"
    ADD CONSTRAINT "eight_d_report_activities_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
