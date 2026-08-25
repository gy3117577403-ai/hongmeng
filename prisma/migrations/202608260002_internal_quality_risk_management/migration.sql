-- Internal major quality risks aggregate existing issue facts and project an
-- immutable archived revision into work-order quality alerts. Deletion is a
-- reversible business operation; hard deletion is guarded in the service.
CREATE TABLE "quality_risk_reports" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "report_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "occurrence_date" TIMESTAMP(3),
    "workshop_area" TEXT,
    "process_name" TEXT,
    "responsible_department" TEXT,
    "defect_phenomenon" TEXT,
    "occurrence_cause" TEXT,
    "escape_cause" TEXT,
    "system_cause" TEXT,
    "root_cause" TEXT,
    "secondary_cause" TEXT,
    "containment_action" TEXT,
    "disposition" TEXT,
    "corrective_action" TEXT,
    "preventive_action" TEXT,
    "verification_result" TEXT,
    "final_conclusion" TEXT,
    "evidence_summary" TEXT,
    "risk_scope" TEXT,
    "applicable_process" TEXT,
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "current_revision_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "archived_by_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_risk_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quality_risk_reports_severity_check" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT "quality_risk_reports_status_check" CHECK ("status" IN ('DRAFT', 'REVISING', 'ARCHIVED')),
    CONSTRAINT "quality_risk_reports_effective_range_check" CHECK ("effective_until" IS NULL OR "effective_from" IS NULL OR "effective_until" >= "effective_from")
);

CREATE TABLE "quality_risk_revisions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "archived_by_id" TEXT,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quality_risk_issues" (
    "report_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_issues_pkey" PRIMARY KEY ("report_id", "issue_id")
);

CREATE TABLE "quality_risk_work_orders" (
    "report_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DIRECT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_work_orders_pkey" PRIMARY KEY ("report_id", "work_order_id"),
    CONSTRAINT "quality_risk_work_orders_source_check" CHECK ("source" IN ('DIRECT', 'PRODUCT_CONFIRMATION'))
);

CREATE TABLE "quality_risk_products" (
    "report_id" TEXT NOT NULL,
    "drawing_library_item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_products_pkey" PRIMARY KEY ("report_id", "drawing_library_item_id")
);

CREATE TABLE "quality_risk_8d_reports" (
    "report_id" TEXT NOT NULL,
    "eight_d_report_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_8d_reports_pkey" PRIMARY KEY ("report_id", "eight_d_report_id")
);

CREATE TABLE "quality_risk_activities" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "content" TEXT,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_risk_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_quality_alerts" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'DIRECT_ARCHIVE',
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "defect_phenomenon" TEXT,
    "root_cause" TEXT,
    "final_conclusion" TEXT,
    "control_requirement" TEXT,
    "applicable_process" TEXT,
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3) NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_quality_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_order_quality_alerts_state_check" CHECK ("state" IN ('ACTIVE', 'ACKNOWLEDGED', 'SUPERSEDED', 'REVOKED', 'EXPIRED')),
    CONSTRAINT "work_order_quality_alerts_source_check" CHECK ("source" IN ('DIRECT_ARCHIVE', 'PRODUCT_SUGGESTION_CONFIRMED')),
    CONSTRAINT "work_order_quality_alerts_severity_check" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

CREATE TABLE "work_order_quality_alert_acknowledgements" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "acknowledged_by_id" TEXT NOT NULL,
    "note" TEXT,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_quality_alert_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quality_risk_reports_sequence_key" ON "quality_risk_reports"("sequence");
CREATE UNIQUE INDEX "quality_risk_reports_report_no_key" ON "quality_risk_reports"("report_no");
CREATE UNIQUE INDEX "quality_risk_reports_current_revision_id_key" ON "quality_risk_reports"("current_revision_id");
CREATE INDEX "quality_risk_reports_status_updated_at_idx" ON "quality_risk_reports"("status", "updated_at");
CREATE INDEX "quality_risk_reports_severity_status_idx" ON "quality_risk_reports"("severity", "status");
CREATE INDEX "quality_risk_reports_occurrence_date_idx" ON "quality_risk_reports"("occurrence_date");
CREATE INDEX "quality_risk_reports_deleted_at_idx" ON "quality_risk_reports"("deleted_at");
CREATE INDEX "quality_risk_reports_created_by_id_idx" ON "quality_risk_reports"("created_by_id");
CREATE INDEX "quality_risk_reports_updated_by_id_idx" ON "quality_risk_reports"("updated_by_id");
CREATE INDEX "quality_risk_reports_archived_by_id_idx" ON "quality_risk_reports"("archived_by_id");
CREATE INDEX "quality_risk_reports_deleted_by_id_idx" ON "quality_risk_reports"("deleted_by_id");

CREATE UNIQUE INDEX "quality_risk_revisions_report_id_revision_number_key" ON "quality_risk_revisions"("report_id", "revision_number");
CREATE INDEX "quality_risk_revisions_report_id_archived_at_idx" ON "quality_risk_revisions"("report_id", "archived_at");
CREATE INDEX "quality_risk_revisions_archived_by_id_idx" ON "quality_risk_revisions"("archived_by_id");

CREATE INDEX "quality_risk_issues_issue_id_report_id_idx" ON "quality_risk_issues"("issue_id", "report_id");
CREATE INDEX "quality_risk_work_orders_work_order_id_report_id_idx" ON "quality_risk_work_orders"("work_order_id", "report_id");
CREATE INDEX "quality_risk_products_drawing_library_item_id_report_id_idx" ON "quality_risk_products"("drawing_library_item_id", "report_id");
CREATE INDEX "quality_risk_8d_reports_eight_d_report_id_report_id_idx" ON "quality_risk_8d_reports"("eight_d_report_id", "report_id");
CREATE INDEX "quality_risk_activities_report_id_created_at_idx" ON "quality_risk_activities"("report_id", "created_at");
CREATE INDEX "quality_risk_activities_actor_id_idx" ON "quality_risk_activities"("actor_id");
CREATE INDEX "quality_risk_activities_action_idx" ON "quality_risk_activities"("action");

CREATE UNIQUE INDEX "work_order_quality_alerts_revision_id_work_order_id_key" ON "work_order_quality_alerts"("revision_id", "work_order_id");
CREATE INDEX "work_order_quality_alerts_work_order_id_state_updated_at_idx" ON "work_order_quality_alerts"("work_order_id", "state", "updated_at");
CREATE INDEX "work_order_quality_alerts_report_id_state_idx" ON "work_order_quality_alerts"("report_id", "state");
CREATE INDEX "work_order_quality_alerts_revision_id_idx" ON "work_order_quality_alerts"("revision_id");
CREATE INDEX "work_order_quality_alerts_effective_until_idx" ON "work_order_quality_alerts"("effective_until");

CREATE UNIQUE INDEX "work_order_quality_alert_acknowledgements_alert_id_acknowledged_by_id_key" ON "work_order_quality_alert_acknowledgements"("alert_id", "acknowledged_by_id");
CREATE INDEX "work_order_quality_alert_acknowledgements_acknowledged_by_id_acknowledged_at_idx" ON "work_order_quality_alert_acknowledgements"("acknowledged_by_id", "acknowledged_at");

ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quality_risk_revisions" ADD CONSTRAINT "quality_risk_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_revisions" ADD CONSTRAINT "quality_risk_revisions_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "quality_risk_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quality_risk_issues" ADD CONSTRAINT "quality_risk_issues_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_issues" ADD CONSTRAINT "quality_risk_issues_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_work_orders" ADD CONSTRAINT "quality_risk_work_orders_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_work_orders" ADD CONSTRAINT "quality_risk_work_orders_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_products" ADD CONSTRAINT "quality_risk_products_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_products" ADD CONSTRAINT "quality_risk_products_drawing_library_item_id_fkey" FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_8d_reports" ADD CONSTRAINT "quality_risk_8d_reports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_8d_reports" ADD CONSTRAINT "quality_risk_8d_reports_eight_d_report_id_fkey" FOREIGN KEY ("eight_d_report_id") REFERENCES "eight_d_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_activities" ADD CONSTRAINT "quality_risk_activities_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_activities" ADD CONSTRAINT "quality_risk_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_order_quality_alerts" ADD CONSTRAINT "work_order_quality_alerts_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_quality_alerts" ADD CONSTRAINT "work_order_quality_alerts_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "quality_risk_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_quality_alerts" ADD CONSTRAINT "work_order_quality_alerts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_quality_alert_acknowledgements" ADD CONSTRAINT "work_order_quality_alert_acknowledgements_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "work_order_quality_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_quality_alert_acknowledgements" ADD CONSTRAINT "work_order_quality_alert_acknowledgements_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
