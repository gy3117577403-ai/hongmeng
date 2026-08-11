CREATE TYPE "product_time_deployment_status" AS ENUM (
  'PENDING',
  'APPLYING',
  'ACTIVE',
  'FAILED'
);

CREATE TYPE "product_time_deployment_route_status" AS ENUM (
  'PENDING',
  'APPLYING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'UNCHANGED'
);

ALTER TABLE "work_order_process_steps"
  ADD COLUMN "product_time_deployment_route_id" TEXT,
  ADD COLUMN "retired_at" TIMESTAMP(3);

ALTER TABLE "process_supplement_obligations"
  ALTER COLUMN "change_id" DROP NOT NULL,
  ALTER COLUMN "diff_id" DROP NOT NULL,
  ADD COLUMN "deployment_route_id" TEXT,
  ADD COLUMN "occurrence_key" TEXT;

CREATE TABLE "product_time_deployments" (
  "id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "base_profile_id" TEXT,
  "profile_version" INTEGER NOT NULL,
  "expected_revision" INTEGER NOT NULL,
  "preview_token" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "product_time_deployment_status" NOT NULL DEFAULT 'PENDING',
  "impact" JSONB NOT NULL,
  "diffs" JSONB NOT NULL,
  "conflicts" JSONB NOT NULL,
  "actor_id" TEXT,
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_time_deployments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_time_deployment_routes" (
  "id" TEXT NOT NULL,
  "deployment_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "work_order_state" TEXT NOT NULL,
  "status" "product_time_deployment_route_status" NOT NULL DEFAULT 'PENDING',
  "route_version_before" INTEGER,
  "route_version_after" INTEGER,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_time_deployment_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_time_deployments_profile_id_key"
  ON "product_time_deployments"("profile_id");
CREATE UNIQUE INDEX "product_time_deployments_idempotency_key_key"
  ON "product_time_deployments"("idempotency_key");
CREATE INDEX "product_time_deployments_drawing_library_item_id_created_at_idx"
  ON "product_time_deployments"("drawing_library_item_id", "created_at");
CREATE INDEX "product_time_deployments_status_updated_at_idx"
  ON "product_time_deployments"("status", "updated_at");

CREATE UNIQUE INDEX "product_time_deployment_routes_deployment_id_route_id_key"
  ON "product_time_deployment_routes"("deployment_id", "route_id");
CREATE INDEX "product_time_deployment_routes_work_order_id_created_at_idx"
  ON "product_time_deployment_routes"("work_order_id", "created_at");
CREATE INDEX "product_time_deployment_routes_route_id_created_at_idx"
  ON "product_time_deployment_routes"("route_id", "created_at");
CREATE INDEX "product_time_deployment_routes_status_updated_at_idx"
  ON "product_time_deployment_routes"("status", "updated_at");

CREATE INDEX "work_order_process_steps_product_time_deployment_route_id_idx"
  ON "work_order_process_steps"("product_time_deployment_route_id");
CREATE INDEX "work_order_process_steps_route_id_retired_at_idx"
  ON "work_order_process_steps"("route_id", "retired_at");
CREATE INDEX "process_supplement_obligations_deployment_route_id_idx"
  ON "process_supplement_obligations"("deployment_route_id");
CREATE UNIQUE INDEX "process_supplement_obligations_deployment_route_id_occurrence_key_key"
  ON "process_supplement_obligations"("deployment_route_id", "occurrence_key");

ALTER TABLE "product_time_deployments"
  ADD CONSTRAINT "product_time_deployments_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "product_time_deployments_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "product_time_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_time_deployment_routes"
  ADD CONSTRAINT "product_time_deployment_routes_deployment_id_fkey"
  FOREIGN KEY ("deployment_id") REFERENCES "product_time_deployments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "product_time_deployment_routes_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "product_time_deployment_routes_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_process_steps"
  ADD CONSTRAINT "work_order_process_steps_product_time_deployment_route_id_fkey"
  FOREIGN KEY ("product_time_deployment_route_id") REFERENCES "product_time_deployment_routes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_supplement_obligations"
  ADD CONSTRAINT "process_supplement_obligations_deployment_route_id_fkey"
  FOREIGN KEY ("deployment_route_id") REFERENCES "product_time_deployment_routes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_supplement_obligations"
  ADD CONSTRAINT "process_supplement_obligations_source_check"
  CHECK (
    ("change_id" IS NOT NULL AND "diff_id" IS NOT NULL AND "deployment_route_id" IS NULL)
    OR
    ("change_id" IS NULL AND "diff_id" IS NULL AND "deployment_route_id" IS NOT NULL AND "occurrence_key" IS NOT NULL)
  );
