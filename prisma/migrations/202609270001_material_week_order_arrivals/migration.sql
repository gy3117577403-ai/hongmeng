CREATE TABLE "material_arrival_batches" (
  "id" TEXT NOT NULL, "exception_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'SHIPPED',
  "quantity" DOUBLE PRECISION NOT NULL, "accepted_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0, "logistics_mode" TEXT NOT NULL DEFAULT 'EXPRESS',
  "carrier" TEXT NOT NULL DEFAULT '', "tracking_number" TEXT NOT NULL DEFAULT '',
  "shipped_at" TIMESTAMP(3), "expected_at" TIMESTAMP(3), "arrived_at" TIMESTAMP(3), "verified_at" TIMESTAMP(3),
  "note" TEXT NOT NULL DEFAULT '', "recorded_by_id" TEXT, "verified_by_id" TEXT,
  "legacy" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_arrival_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_arrival_batches_exception_id_fkey" FOREIGN KEY ("exception_id") REFERENCES "warehouse_material_exception_cases"("id") ON DELETE CASCADE,
  CONSTRAINT "material_arrival_amounts" CHECK (quantity > 0 AND quantity < 'Infinity'::float8 AND accepted_quantity >= 0 AND rejected_quantity >= 0 AND accepted_quantity + rejected_quantity <= quantity),
  CONSTRAINT "material_arrival_state" CHECK (status IN ('SHIPPED','ARRIVED','VERIFIED','CANCELLED'))
);
CREATE INDEX "material_arrival_batches_exception_id_status_idx" ON "material_arrival_batches"("exception_id","status");
CREATE INDEX "material_arrival_batches_tracking_number_idx" ON "material_arrival_batches"("tracking_number");
CREATE TABLE "material_order_commands" (
  "id" TEXT NOT NULL, "task_id" TEXT NOT NULL, "key" TEXT NOT NULL, "hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_order_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_order_commands_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "warehouse_material_tasks"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "material_order_commands_task_id_key_key" ON "material_order_commands"("task_id","key");
-- Historical reported arrivals are deliberately unverified. Closed orders and their facts are unchanged.
INSERT INTO "material_arrival_batches" (id,exception_id,status,quantity,logistics_mode,arrived_at,note,recorded_by_id,legacy)
SELECT 'legacy-' || id,id,'ARRIVED',received_quantity,'UNKNOWN',actual_arrival_at,
       '历史累计报到料，待仓库核验',COALESCE(actual_arrival_by_id,reported_by_id),true
FROM warehouse_material_exception_cases WHERE status='OPEN' AND received_quantity>0;

-- A changed production quantity or specification requires physical rechecking;
-- previously verified receipt facts and completed-history entries are never rewritten.
CREATE FUNCTION material_plan_recheck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task warehouse_material_tasks%ROWTYPE; next_state TEXT;
BEGIN
  IF NEW.deleted_at IS NULL AND (
    NEW.production_target_qty IS DISTINCT FROM OLD.production_target_qty OR
    NEW.specification IS DISTINCT FROM OLD.specification OR
    (NEW.production_target_qty IS NULL AND NEW.uncompleted_qty IS DISTINCT FROM OLD.uncompleted_qty)
  ) THEN
    SELECT * INTO task FROM warehouse_material_tasks WHERE work_order_id=NEW.id FOR UPDATE;
    IF FOUND THEN
      next_state := CASE WHEN EXISTS(SELECT 1 FROM warehouse_material_exception_cases WHERE warehouse_task_id=task.id AND status='OPEN') THEN 'exception' ELSE 'pending' END;
      UPDATE warehouse_material_tasks SET status=next_state, requirements_confirmed=false,
        completed_at=NULL, completed_by_id=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=task.id;
      NEW.material_status := CASE WHEN next_state='exception' THEN '缺料待核对' ELSE '计划已变更，待重新核对' END;
      INSERT INTO warehouse_material_activities(id,task_id,action,from_status,to_status,content,detail)
      VALUES (gen_random_uuid()::text,task.id,'plan_changed',task.status,next_state,'计划数量或规格已变更，仓库需重新核对',
        jsonb_build_object('beforeQuantity',OLD.production_target_qty,'afterQuantity',NEW.production_target_qty,'beforeSpecification',OLD.specification,'afterSpecification',NEW.specification));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_plan_recheck_trigger BEFORE UPDATE OF production_target_qty,specification,uncompleted_qty ON work_orders FOR EACH ROW EXECUTE FUNCTION material_plan_recheck();

CREATE FUNCTION close_cancelled_material_order(work_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE task_id TEXT;
BEGIN
  SELECT id INTO task_id FROM warehouse_material_tasks WHERE work_order_id=work_id FOR UPDATE;
  IF task_id IS NULL THEN RETURN; END IF;
  UPDATE material_follow_up_tasks SET status='CANCELLED',version=version+1,updated_at=CURRENT_TIMESTAMP
    WHERE warehouse_task_id=task_id AND status NOT IN ('RESOLVED','CANCELLED');
  UPDATE warehouse_material_exception_cases SET status='CANCELLED',resolution_note='来源订单已取消，保留收料事实',updated_at=CURRENT_TIMESTAMP
    WHERE warehouse_task_id=task_id AND status='OPEN';
  UPDATE warehouse_material_tasks SET status=CASE WHEN status='exception' THEN 'pending' ELSE status END,
    exception_type=NULL,exception_note=NULL,expected_at=NULL,
    version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=task_id;
  INSERT INTO warehouse_material_activities(id,task_id,action,content)
    VALUES(gen_random_uuid()::text,task_id,'source_cancelled','来源订单已取消，停止跟进；历史到料与核验记录保留');
END $$;
CREATE FUNCTION material_source_cancelled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN PERFORM close_cancelled_material_order(NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_source_cancelled_trigger AFTER UPDATE OF deleted_at ON work_orders FOR EACH ROW EXECUTE FUNCTION material_source_cancelled();
CREATE FUNCTION material_plan_cancelled() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_id TEXT;
BEGIN
  IF (OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled') OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    FOR work_id IN SELECT work_order_id FROM production_plan_batches WHERE plan_order_id=NEW.id AND work_order_id IS NOT NULL ORDER BY work_order_id LOOP
      PERFORM close_cancelled_material_order(work_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_plan_cancelled_trigger AFTER UPDATE OF status,deleted_at ON production_plan_orders FOR EACH ROW EXECUTE FUNCTION material_plan_cancelled();
