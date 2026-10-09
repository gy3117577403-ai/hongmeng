CREATE TABLE "business_approval_handoffs" (
  "id" TEXT NOT NULL,
  "from_user_id" TEXT NOT NULL,
  "to_user_id" TEXT NOT NULL,
  "excluded_sources" TEXT[] NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_approval_handoffs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_approval_handoffs_from_user_id_key" ON "business_approval_handoffs"("from_user_id");
CREATE INDEX "business_approval_handoffs_to_user_id_is_active_idx" ON "business_approval_handoffs"("to_user_id", "is_active");
ALTER TABLE "system_notification_recipients" ADD COLUMN "routed_away_at" TIMESTAMP(3), ADD COLUMN "routed_to_user_id" TEXT, ADD COLUMN "routing_reason" TEXT;

-- Freeze each active parent grant into its currently available children. No future module inherits access.
CREATE TEMP TABLE module_children_snapshot (parent TEXT, child TEXT, read_only BOOLEAN);
INSERT INTO module_children_snapshot VALUES ('production','production-execution',false),
('production','planning',false),
('production','sample-planning',false),
('production','order-pool',false),
('production','daily-shipment',false),
('production','weekly-process',false),
('production','reporting-recovery',false),
('quality','quality-review',false),
('quality','fixture-management',false),
('quality','quality-management',false),
('quality','quality-data',false),
('quality','quality-tasks',false),
('quality','quality-confirmation',false),
('materials','finished-goods',false),
('materials','material-follow-up',false),
('materials','purchasing',false),
('materials','warehouse',false),
('materials','wip',false),
('materials','material-library',false),
('technology','drawing-library',false),
('technology','assembly-manuals',false),
('technology','connector-parameters',false),
('technology','terminal-tooling',false),
('technology','product-times',false),
('technology','knowledge',false),
('technology','capability-showcase',false),
('people','employees',false),
('people','recruitment',false),
('people','training',false),
('people','employee-accounts',false),
('people','responsibilities',false),
('people','attendance',false),
('people','abnormal-time',false),
('people','other-hours',false),
('collaboration','issues',false),
('collaboration','major-approval',false),
('collaboration','other-hours-approval',false),
('collaboration','changes',false),
('collaboration','workflows',false),
('collaboration','messages',false),
('reports','report-weekly-plan-attainment',true),
('reports','report-process-bottlenecks',true),
('reports','report-attendance-attainment',true),
('reports','report-employee-attainment',true),
('reports','report-team-hours',true),
('reports','report-employee-matrix',true),
('reports','report-labor-ledger',true),
('reports','report-affected-labor',true),
('reports','report-cause-distribution',true),
('reports','report-open-events',true),
('reports','report-event-ledger',true),
('reports','report-completeness',true),
('reports','report-missing-route',true),
('reports','report-missing-standard',true),
('reports','report-missing-drawing',true),
('reports','report-missing-material',true),
('reports','report-sample-tasks',true),
('reports','report-sample-attainment',true),
('reports','report-pending-review',true),
('reports','report-published-materials',true),
('reports','report-review-attainment',true);
INSERT INTO user_access_grants (id,user_id,profile_key,department_id,scope_key,grant_type,effective_from,effective_to,is_active,granted_by_id,version,created_at,updated_at)
SELECT md5(g.id || ':' || c.child)::uuid::text,g.user_id,g.profile_key,g.department_id,
'MODULE:' || c.child || ':' || CASE WHEN c.read_only THEN 'READ' ELSE split_part(g.scope_key,':',3) END,
g.grant_type,g.effective_from,g.effective_to,g.is_active,g.granted_by_id,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM user_access_grants g JOIN module_children_snapshot c ON g.scope_key IN ('MODULE:' || c.parent || ':READ','MODULE:' || c.parent || ':COLLABORATE')
WHERE g.profile_key='MODULE_ACCESS' AND g.is_active AND NOT EXISTS (
 SELECT 1 FROM user_access_grants x JOIN module_children_snapshot s ON s.parent=c.parent AND x.scope_key IN ('MODULE:' || s.child || ':READ','MODULE:' || s.child || ':COLLABORATE')
 WHERE x.user_id=g.user_id AND x.profile_key='MODULE_ACCESS' AND x.is_active
)
ON CONFLICT DO NOTHING;
UPDATE users SET session_version=session_version+1 WHERE id IN (
 SELECT user_id FROM user_access_grants WHERE is_active AND profile_key='MODULE_ACCESS' AND split_part(scope_key,':',2) IN (SELECT DISTINCT parent FROM module_children_snapshot)
);
UPDATE user_access_grants SET is_active=false,version=version+1,updated_at=CURRENT_TIMESTAMP
WHERE is_active AND profile_key='MODULE_ACCESS' AND split_part(scope_key,':',2) IN (SELECT DISTINCT parent FROM module_children_snapshot);
DROP TABLE module_children_snapshot;
