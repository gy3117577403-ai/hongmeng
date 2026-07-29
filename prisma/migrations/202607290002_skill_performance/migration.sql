CREATE TABLE "skill_definitions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'PROCESS',
  "description" TEXT,
  "source_process_definition_id" TEXT,
  "is_critical" BOOLEAN NOT NULL DEFAULT false,
  "default_validity_months" INTEGER NOT NULL DEFAULT 12,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_definitions_category_check" CHECK ("category" IN ('PROCESS', 'QUALITY', 'WAREHOUSE', 'SAFETY', 'MANAGEMENT', 'GENERAL')),
  CONSTRAINT "skill_definitions_validity_check" CHECK ("default_validity_months" BETWEEN 1 AND 120)
);

CREATE TABLE "position_skill_requirements" (
  "id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "team" TEXT NOT NULL DEFAULT '',
  "skill_id" TEXT NOT NULL,
  "target_level" INTEGER NOT NULL DEFAULT 1,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "position_skill_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "position_skill_requirements_level_check" CHECK ("target_level" BETWEEN 1 AND 4)
);

CREATE TABLE "employee_skill_certifications" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "score" INTEGER,
  "assessment_id" TEXT,
  "assessor_id" TEXT,
  "reviewer_id" TEXT,
  "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
  "expires_at" DATE,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_skill_certifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_skill_certifications_status_check" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  CONSTRAINT "employee_skill_certifications_level_check" CHECK ("level" BETWEEN 0 AND 4),
  CONSTRAINT "employee_skill_certifications_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100)
);

CREATE TABLE "skill_assessment_templates" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "team" TEXT NOT NULL DEFAULT '',
  "skill_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "pass_score" INTEGER NOT NULL DEFAULT 80,
  "target_level" INTEGER NOT NULL DEFAULT 1,
  "validity_months" INTEGER NOT NULL DEFAULT 12,
  "instructions" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_assessment_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_assessment_templates_status_check" CHECK ("status" IN ('ACTIVE', 'REPLACED', 'DISABLED')),
  CONSTRAINT "skill_assessment_templates_pass_score_check" CHECK ("pass_score" BETWEEN 0 AND 100),
  CONSTRAINT "skill_assessment_templates_level_check" CHECK ("target_level" BETWEEN 1 AND 4),
  CONSTRAINT "skill_assessment_templates_validity_check" CHECK ("validity_months" BETWEEN 1 AND 120)
);

CREATE TABLE "skill_assessment_items" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "section" TEXT NOT NULL DEFAULT '岗位实操',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "max_score" INTEGER NOT NULL DEFAULT 100,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "is_critical" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_assessment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_assessment_items_weight_check" CHECK ("weight" BETWEEN 1 AND 1000),
  CONSTRAINT "skill_assessment_items_score_check" CHECK ("max_score" BETWEEN 1 AND 1000)
);

CREATE TABLE "skill_assessments" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "template_version" INTEGER NOT NULL,
  "assessor_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "result" TEXT NOT NULL DEFAULT 'PENDING',
  "total_score" INTEGER,
  "proposed_level" INTEGER NOT NULL DEFAULT 1,
  "review_comment" TEXT,
  "submitted_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "valid_from" DATE,
  "expires_at" DATE,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_assessments_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_REVIEW', 'RETURNED', 'APPROVED', 'CANCELLED')),
  CONSTRAINT "skill_assessments_result_check" CHECK ("result" IN ('PENDING', 'PASSED', 'FAILED')),
  CONSTRAINT "skill_assessments_independent_reviewer_check" CHECK ("reviewer_id" <> "employee_id" AND "reviewer_id" <> "assessor_id"),
  CONSTRAINT "skill_assessments_level_check" CHECK ("proposed_level" BETWEEN 1 AND 4),
  CONSTRAINT "skill_assessments_score_check" CHECK ("total_score" IS NULL OR "total_score" BETWEEN 0 AND 100)
);

CREATE TABLE "skill_assessment_answers" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "score" INTEGER,
  "passed" BOOLEAN,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_assessment_answers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_assessment_answers_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

CREATE TABLE "skill_assessment_activities" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "content" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "skill_assessment_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_definitions_code_key" ON "skill_definitions"("code");
CREATE UNIQUE INDEX "skill_definitions_source_process_definition_id_key" ON "skill_definitions"("source_process_definition_id");
CREATE INDEX "skill_definitions_category_is_active_sort_order_idx" ON "skill_definitions"("category", "is_active", "sort_order");
CREATE INDEX "skill_definitions_name_idx" ON "skill_definitions"("name");

CREATE UNIQUE INDEX "position_skill_requirements_scope_key_skill_id_key" ON "position_skill_requirements"("scope_key", "skill_id");
CREATE INDEX "position_skill_requirements_department_position_team_idx" ON "position_skill_requirements"("department", "position", "team");
CREATE INDEX "position_skill_requirements_skill_id_idx" ON "position_skill_requirements"("skill_id");

CREATE UNIQUE INDEX "employee_skill_certifications_employee_id_skill_id_key" ON "employee_skill_certifications"("employee_id", "skill_id");
CREATE UNIQUE INDEX "employee_skill_certifications_assessment_id_key" ON "employee_skill_certifications"("assessment_id");
CREATE INDEX "employee_skill_certifications_skill_id_status_idx" ON "employee_skill_certifications"("skill_id", "status");
CREATE INDEX "employee_skill_certifications_expires_at_idx" ON "employee_skill_certifications"("expires_at");

CREATE UNIQUE INDEX "skill_assessment_templates_code_key" ON "skill_assessment_templates"("code");
CREATE INDEX "skill_assessment_templates_department_position_status_idx" ON "skill_assessment_templates"("department", "position", "status");
CREATE INDEX "skill_assessment_templates_skill_id_idx" ON "skill_assessment_templates"("skill_id");

CREATE UNIQUE INDEX "skill_assessment_items_template_id_code_key" ON "skill_assessment_items"("template_id", "code");
CREATE INDEX "skill_assessment_items_template_id_sort_order_idx" ON "skill_assessment_items"("template_id", "sort_order");

CREATE UNIQUE INDEX "skill_assessments_code_key" ON "skill_assessments"("code");
CREATE INDEX "skill_assessments_employee_id_status_idx" ON "skill_assessments"("employee_id", "status");
CREATE INDEX "skill_assessments_skill_id_status_idx" ON "skill_assessments"("skill_id", "status");
CREATE INDEX "skill_assessments_reviewer_id_status_idx" ON "skill_assessments"("reviewer_id", "status");
CREATE INDEX "skill_assessments_created_at_idx" ON "skill_assessments"("created_at");

CREATE UNIQUE INDEX "skill_assessment_answers_assessment_id_item_id_key" ON "skill_assessment_answers"("assessment_id", "item_id");
CREATE INDEX "skill_assessment_answers_item_id_idx" ON "skill_assessment_answers"("item_id");

CREATE INDEX "skill_assessment_activities_assessment_id_created_at_idx" ON "skill_assessment_activities"("assessment_id", "created_at");

ALTER TABLE "position_skill_requirements"
  ADD CONSTRAINT "position_skill_requirements_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "skill_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_assessor_id_fkey"
  FOREIGN KEY ("assessor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "skill_assessment_templates"
  ADD CONSTRAINT "skill_assessment_templates_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "skill_assessment_items"
  ADD CONSTRAINT "skill_assessment_items_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "skill_assessment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_assessments"
  ADD CONSTRAINT "skill_assessments_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_assessments"
  ADD CONSTRAINT "skill_assessments_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_assessments"
  ADD CONSTRAINT "skill_assessments_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "skill_assessment_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_assessments"
  ADD CONSTRAINT "skill_assessments_assessor_id_fkey"
  FOREIGN KEY ("assessor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_assessments"
  ADD CONSTRAINT "skill_assessments_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_assessment_answers"
  ADD CONSTRAINT "skill_assessment_answers_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "skill_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_assessment_answers"
  ADD CONSTRAINT "skill_assessment_answers_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "skill_assessment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_assessment_activities"
  ADD CONSTRAINT "skill_assessment_activities_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "skill_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
