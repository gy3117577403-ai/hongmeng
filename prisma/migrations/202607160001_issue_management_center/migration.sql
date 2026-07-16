-- Additive issue-management tables. Existing work-order and resource data is unchanged.
CREATE TABLE "issues" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sequence" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'production',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "description" TEXT,
  "source_type" TEXT,
  "source_id" TEXT,
  "source_code" TEXT,
  "source_route" TEXT,
  "source_alert_code" TEXT,
  "source_fingerprint" TEXT,
  "work_order_id" TEXT,
  "reporter_id" TEXT,
  "assignee_id" TEXT,
  "due_at" TIMESTAMP(3),
  "root_cause" TEXT,
  "solution" TEXT,
  "verification_result" TEXT,
  "resolved_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issues_type_check" CHECK ("type" IN ('production', 'planning', 'technical', 'quality', 'material', 'equipment', 'other')),
  CONSTRAINT "issues_priority_check" CHECK ("priority" IN ('urgent', 'high', 'normal')),
  CONSTRAINT "issues_status_check" CHECK ("status" IN ('pending', 'processing', 'verifying', 'closed'))
);

CREATE TABLE "issue_activities" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "issue_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "content" TEXT,
  "from_status" TEXT,
  "to_status" TEXT,
  "actor_id" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "issue_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "issue_attachments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "issue_id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "display_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "uploaded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "issue_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_attachments_size_check" CHECK ("size" >= 0)
);

CREATE UNIQUE INDEX "issues_sequence_key" ON "issues"("sequence");
CREATE UNIQUE INDEX "issues_source_fingerprint_key" ON "issues"("source_fingerprint");
CREATE INDEX "issues_status_idx" ON "issues"("status");
CREATE INDEX "issues_priority_idx" ON "issues"("priority");
CREATE INDEX "issues_type_idx" ON "issues"("type");
CREATE INDEX "issues_assignee_id_idx" ON "issues"("assignee_id");
CREATE INDEX "issues_reporter_id_idx" ON "issues"("reporter_id");
CREATE INDEX "issues_work_order_id_idx" ON "issues"("work_order_id");
CREATE INDEX "issues_source_type_source_id_idx" ON "issues"("source_type", "source_id");
CREATE INDEX "issues_due_at_idx" ON "issues"("due_at");
CREATE INDEX "issues_updated_at_idx" ON "issues"("updated_at");
CREATE INDEX "issues_deleted_at_idx" ON "issues"("deleted_at");

CREATE INDEX "issue_activities_issue_id_created_at_idx" ON "issue_activities"("issue_id", "created_at");
CREATE INDEX "issue_activities_actor_id_idx" ON "issue_activities"("actor_id");
CREATE INDEX "issue_activities_action_idx" ON "issue_activities"("action");

CREATE UNIQUE INDEX "issue_attachments_object_key_key" ON "issue_attachments"("object_key");
CREATE INDEX "issue_attachments_issue_id_created_at_idx" ON "issue_attachments"("issue_id", "created_at");
CREATE INDEX "issue_attachments_uploaded_by_id_idx" ON "issue_attachments"("uploaded_by_id");
CREATE INDEX "issue_attachments_deleted_at_idx" ON "issue_attachments"("deleted_at");

ALTER TABLE "issues"
ADD CONSTRAINT "issues_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "issues_reporter_id_fkey"
FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "issues_assignee_id_fkey"
FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_activities"
ADD CONSTRAINT "issue_activities_issue_id_fkey"
FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "issue_activities_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_attachments"
ADD CONSTRAINT "issue_attachments_issue_id_fkey"
FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "issue_attachments_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
