CREATE TYPE "account_status" AS ENUM (
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED'
);

CREATE TYPE "access_profile_key" AS ENUM (
  'ADMIN_GLOBAL',
  'DEPARTMENT_FULL',
  'FIELD_REPORTER',
  'GM_OFFICE_READER_APPROVER',
  'FINANCE_ACCOUNT_ONLY',
  'WORKSHOP_SUPERVISOR',
  'WORKSHOP_TEAM_LEADER'
);

CREATE TYPE "access_grant_type" AS ENUM (
  'PRIMARY',
  'CONCURRENT',
  'ACTING'
);

CREATE TABLE "departments" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "users"
  ADD COLUMN "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_login_at" TIMESTAMP(3),
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3);

ALTER TABLE "users"
  ADD CONSTRAINT "users_session_version_nonnegative" CHECK ("session_version" >= 0);

ALTER TABLE "users"
  ADD CONSTRAINT "users_failed_login_attempts_nonnegative" CHECK ("failed_login_attempts" >= 0);

ALTER TABLE "employees"
  ADD COLUMN "department_id" TEXT;

CREATE TABLE "user_access_grants" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "profile_key" "access_profile_key" NOT NULL,
  "department_id" TEXT,
  "scope_key" TEXT NOT NULL,
  "grant_type" "access_grant_type" NOT NULL DEFAULT 'PRIMARY',
  "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effective_to" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "granted_by_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_access_grants_scope_key_nonempty" CHECK (LENGTH(BTRIM("scope_key")) > 0),
  CONSTRAINT "user_access_grants_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "user_access_grants_version_nonnegative" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");
CREATE INDEX "departments_is_active_sort_order_idx" ON "departments"("is_active", "sort_order");
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");
CREATE UNIQUE INDEX "user_access_grants_identity_key"
  ON "user_access_grants"("user_id", "profile_key", "scope_key", "grant_type", "effective_from");
CREATE INDEX "user_access_grants_user_active_window_idx"
  ON "user_access_grants"("user_id", "is_active", "effective_from", "effective_to");
CREATE INDEX "user_access_grants_profile_scope_active_idx"
  ON "user_access_grants"("profile_key", "scope_key", "is_active");
CREATE INDEX "user_access_grants_department_active_idx"
  ON "user_access_grants"("department_id", "is_active");
CREATE INDEX "user_access_grants_granted_by_idx"
  ON "user_access_grants"("granted_by_id");
CREATE INDEX "user_access_grants_expiry_active_idx"
  ON "user_access_grants"("effective_to", "is_active");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_access_grants"
  ADD CONSTRAINT "user_access_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_access_grants"
  ADD CONSTRAINT "user_access_grants_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_access_grants"
  ADD CONSTRAINT "user_access_grants_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "departments" (
  "id",
  "code",
  "name",
  "sort_order",
  "updated_at"
)
VALUES
  ('department-production', 'PRODUCTION', '生产部', 10, CURRENT_TIMESTAMP),
  ('department-business', 'BUSINESS', '业务部', 20, CURRENT_TIMESTAMP),
  ('department-procurement', 'PROCUREMENT', '采购部', 30, CURRENT_TIMESTAMP),
  ('department-warehouse', 'WAREHOUSE', '仓储部', 40, CURRENT_TIMESTAMP),
  ('department-engineering', 'ENGINEERING', '工程部', 50, CURRENT_TIMESTAMP),
  ('department-quality', 'QUALITY', '质量部', 60, CURRENT_TIMESTAMP),
  ('department-gm-office', 'GM_OFFICE', '总经办', 70, CURRENT_TIMESTAMP),
  ('department-finance', 'FINANCE', '财务部', 80, CURRENT_TIMESTAMP),
  ('department-process', 'PROCESS', '工艺部', 90, CURRENT_TIMESTAMP),
  ('department-planning', 'PLANNING', '计划部', 100, CURRENT_TIMESTAMP),
  ('department-hr', 'HR', '人事部', 110, CURRENT_TIMESTAMP);

WITH normalized_employee_departments AS (
  SELECT
    employee."id" AS "employee_id",
    CASE
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '生产', '生产部', '生产车间', '车间', '制造部'
      ) THEN 'PRODUCTION'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '业务', '业务部', '商务', '商务部', '销售', '销售部'
      ) THEN 'BUSINESS'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '采购', '采购部'
      ) THEN 'PROCUREMENT'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '仓储', '仓储部', '仓库', '仓库部', '物料仓库'
      ) THEN 'WAREHOUSE'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '工程', '工程部', '技术', '技术部', '研发', '研发部'
      ) THEN 'ENGINEERING'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '质量', '质量部', '品质', '品质部', '质检', '质检部'
      ) THEN 'QUALITY'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '总经办', '总经理办公室', '总经理办', '经理办'
      ) THEN 'GM_OFFICE'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '财务', '财务部', '会计', '会计部'
      ) THEN 'FINANCE'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '工艺', '工艺部', '工艺技术部'
      ) THEN 'PROCESS'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '计划', '计划部', '生产计划', '生产计划部', '计划物控部'
      ) THEN 'PLANNING'
      WHEN REGEXP_REPLACE(BTRIM(employee."department"), '\s+', '', 'g') IN (
        '人事', '人事部', '人力资源', '人力资源部', '行政人事', '行政人事部'
      ) THEN 'HR'
      ELSE NULL
    END AS "department_code"
  FROM "employees" AS employee
  WHERE employee."department" IS NOT NULL
)
UPDATE "employees" AS employee
SET "department_id" = department."id"
FROM normalized_employee_departments AS normalized
JOIN "departments" AS department
  ON department."code" = normalized."department_code"
WHERE employee."id" = normalized."employee_id"
  AND normalized."department_code" IS NOT NULL
  AND employee."department_id" IS NULL;

UPDATE "users" AS app_user
SET
  "account_status" = 'DISABLED',
  "is_active" = false,
  "session_version" = app_user."session_version" + 1
WHERE app_user."is_active" = false
   OR EXISTS (
     SELECT 1
     FROM "employees" AS employee
     WHERE employee."id" = app_user."employee_id"
       AND employee."is_active" = false
   );

INSERT INTO "user_access_grants" (
  "id",
  "user_id",
  "profile_key",
  "department_id",
  "scope_key",
  "grant_type",
  "effective_from",
  "is_active",
  "granted_by_id",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  'legacy-admin-' || app_user."id",
  app_user."id",
  'ADMIN_GLOBAL'::"access_profile_key",
  NULL,
  'GLOBAL',
  'PRIMARY'::"access_grant_type",
  app_user."created_at",
  app_user."is_active",
  NULL,
  0,
  app_user."created_at",
  app_user."updated_at"
FROM "users" AS app_user
WHERE app_user."labor_role" = 'ADMIN'::"labor_access_role"
ON CONFLICT ("user_id", "profile_key", "scope_key", "grant_type", "effective_from") DO NOTHING;

INSERT INTO "user_access_grants" (
  "id",
  "user_id",
  "profile_key",
  "department_id",
  "scope_key",
  "grant_type",
  "effective_from",
  "is_active",
  "granted_by_id",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  'legacy-field-reporter-' || app_user."id",
  app_user."id",
  'FIELD_REPORTER'::"access_profile_key",
  employee."department_id",
  'EMPLOYEE:' || employee."id",
  'PRIMARY'::"access_grant_type",
  app_user."created_at",
  app_user."is_active" AND employee."is_active",
  NULL,
  0,
  app_user."created_at",
  app_user."updated_at"
FROM "users" AS app_user
JOIN "employees" AS employee
  ON employee."id" = app_user."employee_id"
JOIN "departments" AS department
  ON department."id" = employee."department_id"
 AND department."code" = 'PRODUCTION'
WHERE app_user."labor_role" <> 'ADMIN'::"labor_access_role"
ON CONFLICT ("user_id", "profile_key", "scope_key", "grant_type", "effective_from") DO NOTHING;
