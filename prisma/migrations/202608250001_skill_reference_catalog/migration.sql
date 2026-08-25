-- Skill matrix catalog is a stable employee level reference, not a mirror of
-- product-specific process definitions. Existing certifications, assessments,
-- requirements and training links remain attached to their original rows.
ALTER TABLE "skill_definitions"
  ADD COLUMN "is_core" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_subsidy_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "subsidy_minimum_level" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "skill_definitions"
  ADD CONSTRAINT "skill_definitions_subsidy_minimum_level_check"
    CHECK (
      ("is_subsidy_eligible" = false AND "subsidy_minimum_level" IS NULL)
      OR
      ("is_subsidy_eligible" = true AND "subsidy_minimum_level" BETWEEN 1 AND 4)
    );

DO $$
DECLARE
  core_record RECORD;
  chosen_id TEXT;
BEGIN
  FOR core_record IN
    SELECT *
    FROM (VALUES
      ('REF-CUTTING', '裁线', 10, '生产员工技能等级参考项：裁线'),
      ('REF-CRIMPING', '压接', 20, '生产员工技能等级参考项：压接'),
      ('REF-WELDING', '焊接', 30, '生产员工技能等级参考项：焊接'),
      ('REF-ASSEMBLY', '装配', 40, '生产员工技能等级参考项：装配'),
      ('REF-LARGE-WIRE', '大线', 50, '生产员工技能等级参考项：大线'),
      ('REF-INSPECTION', '检验', 60, '生产员工技能等级参考项：检验'),
      ('REF-PACKAGING', '包装', 70, '生产员工技能等级参考项：包装'),
      ('REF-DIE-SETTING', '调模', 80, '生产员工技能等级参考项：调模')
    ) AS core(code, name, sort_order, description)
  LOOP
    SELECT "id"
      INTO chosen_id
      FROM "skill_definitions"
     WHERE "code" = core_record.code OR "name" = core_record.name
     ORDER BY CASE WHEN "code" = core_record.code THEN 0 ELSE 1 END,
              CASE WHEN "is_active" THEN 0 ELSE 1 END,
              "created_at" ASC
     LIMIT 1;

    IF chosen_id IS NULL THEN
      INSERT INTO "skill_definitions" (
        "id", "code", "name", "category", "description",
        "source_process_definition_id", "is_core",
        "is_subsidy_eligible", "subsidy_minimum_level",
        "is_critical", "default_validity_months", "is_active",
        "sort_order", "version", "created_at", "updated_at"
      ) VALUES (
        'core-' || lower(replace(core_record.code, 'REF-', '')),
        core_record.code,
        core_record.name,
        'PROCESS',
        core_record.description,
        NULL,
        true,
        false,
        NULL,
        false,
        12,
        true,
        core_record.sort_order,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    ELSE
      UPDATE "skill_definitions"
         SET "code" = core_record.code,
             "name" = core_record.name,
             "category" = 'PROCESS',
             "description" = core_record.description,
             "source_process_definition_id" = NULL,
             "is_core" = true,
             "is_active" = true,
             "sort_order" = core_record.sort_order,
             "version" = "version" + 1,
             "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = chosen_id;
    END IF;

    chosen_id := NULL;
  END LOOP;
END $$;

-- Old process-synchronized entries are retained for historical joins but no
-- longer appear as active level-reference columns. Duplicate names are also
-- retained and hidden, so no certification or assessment fact is deleted.
UPDATE "skill_definitions"
   SET "is_active" = false,
       "version" = "version" + 1,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "is_core" = false
   AND (
     "source_process_definition_id" IS NOT NULL
     OR "name" IN ('裁线', '压接', '焊接', '装配', '大线', '检验', '包装', '调模')
   );

CREATE INDEX "skill_definitions_is_core_is_active_sort_order_idx"
  ON "skill_definitions"("is_core", "is_active", "sort_order");

CREATE INDEX "skill_definitions_is_subsidy_eligible_is_active_idx"
  ON "skill_definitions"("is_subsidy_eligible", "is_active");
