ALTER TABLE "quality_risk_reports" ADD COLUMN "operator_assignments" JSONB;
ALTER TABLE "quality_risk_reports" ADD COLUMN "review_block_reason" TEXT;
ALTER TABLE "quality_risk_tasks" ADD COLUMN "analysis" JSONB;
ALTER TABLE "quality_risk_tasks" ADD COLUMN "operators" JSONB;
ALTER TABLE "quality_risk_reports" ALTER COLUMN "workflow_version" SET DEFAULT 4;

-- Preserve old task results and their authors. Historical shared analysis is identified,
-- rather than copied into each person's authored answer. Already submitted review rounds
-- and archived snapshots remain immutable.
UPDATE "quality_risk_tasks" t SET "analysis" = jsonb_build_object('legacy', true, 'legacyOccurrenceCause', coalesce(r."occurrence_cause", ''), 'legacyRootCause', coalesce(r."root_cause", ''))
FROM "quality_risk_reports" r WHERE t."report_id" = r."id" AND r."workflow_version" = 3;
INSERT INTO "quality_risk_activities" ("id", "report_id", "actor_name", "action", "content", "detail", "created_at")
SELECT md5(r."id" || ':direct-review-migration'), r."id", '系统', 'WORKFLOW_UPGRADED',
  '移除牵头汇总，保留责任任务与历史分析；内容齐全后直接送品质确认',
  jsonb_build_object('previousWorkflowVersion', r."workflow_version", 'previousOwnerUserId', r."owner_user_id"), now()
FROM "quality_risk_reports" r WHERE r."workflow_version" = 3
AND r."status" IN ('DRAFT','SUBMITTED','CONTAINMENT','COLLABORATING','REVISING');
UPDATE "quality_risk_reports" SET "workflow_version" = 4, "owner_user_id" = NULL, "version" = "version" + 1
WHERE "workflow_version" = 3 AND "status" IN ('DRAFT','SUBMITTED','CONTAINMENT','COLLABORATING','REVISING');
-- An old completed task can lack the analysis that used to be assigned to the lead.
-- Reopen only incomplete content; keep all original answers, photos and audit history.
UPDATE "quality_risk_tasks" t SET "status" = 'IN_PROGRESS', "version" = t."version" + 1,
  "review_note" = concat_ws(E'\n', t."review_note", '请补齐发生原因、根本原因、措施和结果，提交后直接送品质确认。')
FROM "quality_risk_reports" r WHERE r."id" = t."report_id" AND r."workflow_version" = 4
AND r."status" IN ('SUBMITTED','CONTAINMENT','COLLABORATING','REVISING') AND t."status" = 'COMPLETED'
AND (nullif(trim(r."occurrence_cause"), '') IS NULL OR nullif(trim(r."root_cause"), '') IS NULL
  OR nullif(trim(t."action_taken"), '') IS NULL OR nullif(trim(t."result"), '') IS NULL);
UPDATE "quality_risk_notifications" n SET "state" = 'SKIPPED', "lease_token" = NULL,
  "last_error" = '流程已移除牵头汇总，保留历史通知记录'
FROM "quality_risk_reports" r WHERE n."report_id" = r."id" AND r."workflow_version" = 4
AND n."event_type" = 'CONSOLIDATE' AND n."state" <> 'SENT';

-- Retire the obsolete in-app consolidation todo without deleting its audit history.
UPDATE "system_notification_recipients" recipient SET "completed_at" = now(),
  "completion_kind" = 'SOURCE_RESOLVED', "completion_reason" = '异常流程已移除牵头汇总'
FROM "system_notifications" n, "quality_risk_reports" r
WHERE recipient."notification_id" = n."id" AND n."source_id" = r."id"
AND n."source_type" = 'internal_quality_risk' AND n."event_type" = 'QUALITY_CONSOLIDATE'
AND r."workflow_version" = 4 AND recipient."completed_at" IS NULL;
