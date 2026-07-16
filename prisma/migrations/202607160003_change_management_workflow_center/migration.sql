-- Additive change-management tables. Existing issue, production and resource data is unchanged.
CREATE TABLE "change_requests" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sequence" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'drawing',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "reason" TEXT,
  "description" TEXT,
  "impact_areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "impact_scope" TEXT,
  "implementation_plan" TEXT,
  "implementation_result" TEXT,
  "validation_result" TEXT,
  "rollback_plan" TEXT,
  "source_issue_id" TEXT,
  "work_order_id" TEXT,
  "requester_id" TEXT,
  "owner_id" TEXT,
  "due_at" TIMESTAMP(3),
  "effective_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_requests_type_check" CHECK ("type" IN ('drawing', 'process', 'plan', 'material', 'document', 'other')),
  CONSTRAINT "change_requests_priority_check" CHECK ("priority" IN ('urgent', 'high', 'normal')),
  CONSTRAINT "change_requests_status_check" CHECK ("status" IN ('draft', 'assessing', 'implementing', 'verifying', 'closed')),
  CONSTRAINT "change_requests_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "change_activities" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "change_request_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "content" TEXT,
  "from_status" TEXT,
  "to_status" TEXT,
  "actor_id" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "change_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "change_attachments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "change_request_id" TEXT NOT NULL,
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
  CONSTRAINT "change_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_attachments_size_check" CHECK ("size" >= 0)
);

CREATE UNIQUE INDEX "change_requests_sequence_key" ON "change_requests"("sequence");
CREATE INDEX "change_requests_status_idx" ON "change_requests"("status");
CREATE INDEX "change_requests_priority_idx" ON "change_requests"("priority");
CREATE INDEX "change_requests_type_idx" ON "change_requests"("type");
CREATE INDEX "change_requests_owner_id_idx" ON "change_requests"("owner_id");
CREATE INDEX "change_requests_requester_id_idx" ON "change_requests"("requester_id");
CREATE INDEX "change_requests_work_order_id_idx" ON "change_requests"("work_order_id");
CREATE INDEX "change_requests_source_issue_id_idx" ON "change_requests"("source_issue_id");
CREATE INDEX "change_requests_due_at_idx" ON "change_requests"("due_at");
CREATE INDEX "change_requests_updated_at_idx" ON "change_requests"("updated_at");
CREATE INDEX "change_requests_deleted_at_idx" ON "change_requests"("deleted_at");
CREATE INDEX "change_activities_change_request_id_created_at_idx" ON "change_activities"("change_request_id", "created_at");
CREATE INDEX "change_activities_actor_id_idx" ON "change_activities"("actor_id");
CREATE INDEX "change_activities_action_idx" ON "change_activities"("action");
CREATE UNIQUE INDEX "change_attachments_object_key_key" ON "change_attachments"("object_key");
CREATE INDEX "change_attachments_change_request_id_created_at_idx" ON "change_attachments"("change_request_id", "created_at");
CREATE INDEX "change_attachments_uploaded_by_id_idx" ON "change_attachments"("uploaded_by_id");
CREATE INDEX "change_attachments_deleted_at_idx" ON "change_attachments"("deleted_at");

ALTER TABLE "change_requests"
ADD CONSTRAINT "change_requests_source_issue_id_fkey"
FOREIGN KEY ("source_issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "change_requests_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "change_requests_requester_id_fkey"
FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "change_requests_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "change_activities"
ADD CONSTRAINT "change_activities_change_request_id_fkey"
FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "change_activities_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "change_attachments"
ADD CONSTRAINT "change_attachments_change_request_id_fkey"
FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "change_attachments_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
