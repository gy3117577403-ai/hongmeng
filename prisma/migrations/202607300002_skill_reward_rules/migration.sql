CREATE TABLE "skill_reward_rules" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "job_keyword" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "minimum_level" INTEGER NOT NULL DEFAULT 3,
  "reward_name" TEXT NOT NULL DEFAULT '关键岗位技能奖励',
  "reward_description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "skill_reward_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_reward_rules_minimum_level_check" CHECK ("minimum_level" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "skill_reward_rules_code_key"
  ON "skill_reward_rules"("code");
CREATE UNIQUE INDEX "skill_reward_rules_job_keyword_skill_id_key"
  ON "skill_reward_rules"("job_keyword", "skill_id");
CREATE INDEX "skill_reward_rules_is_active_sort_order_idx"
  ON "skill_reward_rules"("is_active", "sort_order");
CREATE INDEX "skill_reward_rules_skill_id_idx"
  ON "skill_reward_rules"("skill_id");

ALTER TABLE "skill_reward_rules"
  ADD CONSTRAINT "skill_reward_rules_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "skill_definitions" (
  "id", "code", "name", "category", "description", "is_critical",
  "default_validity_months", "is_active", "sort_order", "created_at", "updated_at"
)
SELECT
  'skill-reward-crimping', 'SK-REWARD-CRIMPING', '压接', 'PROCESS',
  '压接岗位关键技能，可用于岗位技能奖励规则。', true,
  12, true, 910, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "skill_definitions" WHERE "name" = '压接'
);

INSERT INTO "skill_definitions" (
  "id", "code", "name", "category", "description", "is_critical",
  "default_validity_months", "is_active", "sort_order", "created_at", "updated_at"
)
SELECT
  'skill-reward-soldering', 'SK-REWARD-SOLDERING', '焊接', 'PROCESS',
  '焊接岗位关键技能，可用于岗位技能奖励规则。', true,
  12, true, 920, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "skill_definitions" WHERE "name" = '焊接'
);

INSERT INTO "skill_definitions" (
  "id", "code", "name", "category", "description", "is_critical",
  "default_validity_months", "is_active", "sort_order", "created_at", "updated_at"
)
SELECT
  'skill-reward-mold-adjustment', 'SK-REWARD-MOLD-ADJUSTMENT', '调模', 'PROCESS',
  '调模岗位关键技能，可用于岗位技能奖励规则。', true,
  12, true, 930, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "skill_definitions" WHERE "name" = '调模'
);

INSERT INTO "skill_reward_rules" (
  "id", "code", "job_name", "job_keyword", "skill_id", "minimum_level",
  "reward_name", "reward_description", "is_active", "sort_order",
  "created_at", "updated_at"
)
SELECT
  'reward-rule-crimping-l3', 'RR-CRIMPING-L3', '压接岗', '压接', "id", 3,
  '压接关键技能奖励', '压接技能达到 L3 及以上后进入奖励名单，具体奖励标准可继续维护。',
  true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "skill_definitions"
WHERE "name" = '压接'
ORDER BY "is_active" DESC, "created_at" ASC
LIMIT 1
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "skill_reward_rules" (
  "id", "code", "job_name", "job_keyword", "skill_id", "minimum_level",
  "reward_name", "reward_description", "is_active", "sort_order",
  "created_at", "updated_at"
)
SELECT
  'reward-rule-soldering-l3', 'RR-SOLDERING-L3', '焊接岗', '焊接', "id", 3,
  '焊接关键技能奖励', '焊接技能达到 L3 及以上后进入奖励名单，具体奖励标准可继续维护。',
  true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "skill_definitions"
WHERE "name" = '焊接'
ORDER BY "is_active" DESC, "created_at" ASC
LIMIT 1
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "skill_reward_rules" (
  "id", "code", "job_name", "job_keyword", "skill_id", "minimum_level",
  "reward_name", "reward_description", "is_active", "sort_order",
  "created_at", "updated_at"
)
SELECT
  'reward-rule-mold-adjustment-l3', 'RR-MOLD-ADJUSTMENT-L3', '调模岗', '调模', "id", 3,
  '调模关键技能奖励', '调模技能达到 L3 及以上后进入奖励名单，具体奖励标准可继续维护。',
  true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "skill_definitions"
WHERE "name" = '调模'
ORDER BY "is_active" DESC, "created_at" ASC
LIMIT 1
ON CONFLICT ("code") DO NOTHING;
