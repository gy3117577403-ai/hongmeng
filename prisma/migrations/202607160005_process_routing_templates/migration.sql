-- Process definitions, versioned templates, and immutable work-order route snapshots.
CREATE TABLE "process_definitions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage_group" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_templates" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_template_steps" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "process_definition_id" TEXT,
    "process_code" TEXT NOT NULL,
    "process_name" TEXT NOT NULL,
    "stage_group" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_template_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_process_routes" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "template_id" TEXT,
    "template_name" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_order_process_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_process_steps" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "process_definition_id" TEXT,
    "process_code" TEXT NOT NULL,
    "process_name" TEXT NOT NULL,
    "stage_group" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_order_process_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_route_activities" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "step_id" TEXT,
    "action" TEXT NOT NULL,
    "content" TEXT,
    "detail" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_route_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_definitions_code_key" ON "process_definitions"("code");
CREATE INDEX "process_definitions_is_active_sort_order_idx" ON "process_definitions"("is_active", "sort_order");
CREATE INDEX "process_definitions_stage_group_idx" ON "process_definitions"("stage_group");
CREATE UNIQUE INDEX "process_templates_template_key_version_key" ON "process_templates"("template_key", "version");
CREATE INDEX "process_templates_is_default_is_active_idx" ON "process_templates"("is_default", "is_active");
CREATE INDEX "process_templates_created_at_idx" ON "process_templates"("created_at");
CREATE UNIQUE INDEX "process_template_steps_template_id_position_key" ON "process_template_steps"("template_id", "position");
CREATE INDEX "process_template_steps_process_definition_id_idx" ON "process_template_steps"("process_definition_id");
CREATE UNIQUE INDEX "work_order_process_routes_work_order_id_key" ON "work_order_process_routes"("work_order_id");
CREATE INDEX "work_order_process_routes_status_idx" ON "work_order_process_routes"("status");
CREATE INDEX "work_order_process_routes_template_id_idx" ON "work_order_process_routes"("template_id");
CREATE INDEX "work_order_process_routes_updated_at_idx" ON "work_order_process_routes"("updated_at");
CREATE UNIQUE INDEX "work_order_process_steps_route_id_position_key" ON "work_order_process_steps"("route_id", "position");
CREATE INDEX "work_order_process_steps_route_id_status_idx" ON "work_order_process_steps"("route_id", "status");
CREATE INDEX "work_order_process_steps_process_definition_id_idx" ON "work_order_process_steps"("process_definition_id");
CREATE INDEX "work_order_process_steps_completed_by_id_idx" ON "work_order_process_steps"("completed_by_id");
CREATE INDEX "process_route_activities_route_id_created_at_idx" ON "process_route_activities"("route_id", "created_at");
CREATE INDEX "process_route_activities_step_id_idx" ON "process_route_activities"("step_id");
CREATE INDEX "process_route_activities_actor_id_idx" ON "process_route_activities"("actor_id");
CREATE INDEX "process_route_activities_action_idx" ON "process_route_activities"("action");

ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_template_steps" ADD CONSTRAINT "process_template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_template_steps" ADD CONSTRAINT "process_template_steps_process_definition_id_fkey" FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_process_routes" ADD CONSTRAINT "work_order_process_routes_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_process_routes" ADD CONSTRAINT "work_order_process_routes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "process_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_process_routes" ADD CONSTRAINT "work_order_process_routes_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_process_steps" ADD CONSTRAINT "work_order_process_steps_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_process_steps" ADD CONSTRAINT "work_order_process_steps_process_definition_id_fkey" FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_process_steps" ADD CONSTRAINT "work_order_process_steps_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_activities" ADD CONSTRAINT "process_route_activities_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_route_activities" ADD CONSTRAINT "process_route_activities_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_activities" ADD CONSTRAINT "process_route_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "process_definitions" ("id", "code", "name", "stage_group", "sort_order") VALUES
('process-cutting', 'cutting', '裁线', 'frontend', 10),
('process-stripping', 'stripping', '剥皮', 'frontend', 20),
('process-number-tube', 'number_tube', '穿号码管', 'frontend', 30),
('process-crimping', 'crimping', '压接', 'frontend', 40),
('process-crimp-inspection', 'crimp_inspection', '压检', 'frontend', 50),
('process-soldering', 'soldering', '焊接', 'backend', 60),
('process-solder-inspection', 'solder_inspection', '焊检', 'backend', 70),
('process-heat-shrink-tube', 'heat_shrink_tube', '套热缩管', 'backend', 80),
('process-positioning', 'positioning', '定位', 'backend', 90),
('process-assembly', 'assembly', '组装', 'backend', 100),
('process-heat-shrink', 'heat_shrink', '热缩', 'backend', 110),
('process-continuity-test', 'continuity_test', '导通', 'backend', 120),
('process-inspection', 'inspection', '检验', 'backend', 130),
('process-packaging', 'packaging', '包装', 'finish', 140)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "process_templates" ("id", "template_key", "name", "version", "is_default", "is_active")
VALUES ('process-template-standard-v1', 'standard-harness', '标准全工序模板', 1, true, true)
ON CONFLICT ("template_key", "version") DO NOTHING;

INSERT INTO "process_template_steps" ("id", "template_id", "process_definition_id", "process_code", "process_name", "stage_group", "position")
SELECT
  'process-template-standard-step-' || LPAD(ROW_NUMBER() OVER (ORDER BY "sort_order")::TEXT, 2, '0'),
  'process-template-standard-v1',
  "id",
  "code",
  "name",
  "stage_group",
  ROW_NUMBER() OVER (ORDER BY "sort_order")::INTEGER
FROM "process_definitions"
WHERE "code" IN (
  'cutting', 'stripping', 'number_tube', 'crimping', 'crimp_inspection',
  'soldering', 'solder_inspection', 'heat_shrink_tube', 'positioning',
  'assembly', 'heat_shrink', 'continuity_test', 'inspection', 'packaging'
)
ON CONFLICT ("template_id", "position") DO NOTHING;
