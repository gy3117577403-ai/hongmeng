BEGIN;
-- Preserve uploaded evidence separately from the effective batch plan.
ALTER TABLE production_plan_batches
  ADD COLUMN imported_unit_milliseconds INTEGER,
  ADD COLUMN plan_time_source TEXT NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT plan_batch_imported_time_valid CHECK (imported_unit_milliseconds IS NULL OR imported_unit_milliseconds BETWEEN 1 AND 86400000),
  ADD CONSTRAINT plan_batch_time_source_valid CHECK (plan_time_source IN ('legacy','import','manual','order','published','missing'));

CREATE FUNCTION pg_temp.plan_ms(value jsonb) RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN
    CASE WHEN value::text::numeric BETWEEN 1 AND 86400000 AND trunc(value::text::numeric) = value::text::numeric
      THEN value::text::numeric::integer END END
$$;

CREATE TEMP TABLE plan_time_evidence ON COMMIT DROP AS
SELECT b.id, b.plan_order_id, b.work_order_id, b.quantity, b.unit_milliseconds_snapshot AS old_unit,
  b.total_milliseconds_snapshot AS old_total, o.planning_unit_milliseconds AS order_unit,
  COALESCE(pg_temp.plan_ms(i.impact_data #> '{planningTime,importedUnitMilliseconds}'), raw.uploaded) AS uploaded,
  i.impact_data #>> '{planningTime,source}' AS recorded_source,
  i.id AS import_change_id, i.created_at AS imported_at,
  m.unit AS manual_unit, m.id AS manual_change_id,
  (SELECT sum(e.unit_milliseconds) FROM product_process_time_entries e WHERE e.profile_id = b.product_time_profile_id) AS bound_standard
FROM production_plan_batches b JOIN production_plan_orders o ON o.id = b.plan_order_id
LEFT JOIN LATERAL (
  SELECT c.* FROM production_plan_changes c WHERE c.batch_id = b.id
    AND c.action IN ('bulk_import_plan_week','restore_deleted_plan_order_from_bulk_import')
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1
) i ON true
LEFT JOIN production_plan_import_batches ib ON ib.id = i.impact_data ->> 'importBatchId' AND ib.status = 'completed'
LEFT JOIN LATERAL (
  SELECT pg_temp.plan_ms(r #> '{input,planningUnitMilliseconds}') AS uploaded
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ib.preview_data -> 'rows') = 'array' THEN ib.preview_data -> 'rows' ELSE '[]'::jsonb END) r
  WHERE r ->> 'rowNo' = i.impact_data ->> 'sourceRowNo' LIMIT 1
) raw ON true
LEFT JOIN LATERAL (
  SELECT c.id, pg_temp.plan_ms(c.after_data -> 'unitMilliseconds') AS unit
  FROM production_plan_changes c WHERE c.batch_id = b.id
    AND c.action IN ('create_plan_batch','update_plan_batch','update_released_plan_batch')
    AND pg_temp.plan_ms(c.after_data -> 'unitMilliseconds') IS NOT NULL
    AND (c.action = 'create_plan_batch' OR c.before_data -> 'unitMilliseconds' IS DISTINCT FROM c.after_data -> 'unitMilliseconds')
    AND (i.created_at IS NULL OR c.created_at > i.created_at)
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1
) m ON true
WHERE b.deleted_at IS NULL AND o.deleted_at IS NULL;

CREATE TEMP TABLE plan_time_decisions ON COMMIT DROP AS
SELECT *, CASE
  WHEN manual_unit IS NOT NULL THEN manual_unit
  WHEN uploaded IS NOT NULL THEN uploaded
  -- Old import versions took the linked process standard. Only repair this
  -- signature when a distinct order plan exists and no manual batch edit exists.
  WHEN import_change_id IS NOT NULL AND recorded_source IS NULL AND order_unit > 0
    AND old_unit = bound_standard AND old_unit <> order_unit THEN order_unit
  ELSE COALESCE(old_unit, order_unit) END AS new_unit,
  CASE WHEN manual_unit IS NOT NULL THEN 'manual'
    WHEN uploaded IS NOT NULL THEN 'import'
    WHEN import_change_id IS NOT NULL AND recorded_source IS NULL AND order_unit > 0
      AND old_unit = bound_standard AND old_unit <> order_unit THEN 'order'
    WHEN recorded_source IN ('order','published','missing') THEN recorded_source
    WHEN old_unit IS NULL AND order_unit > 0 THEN 'order'
    ELSE 'legacy' END AS source
FROM plan_time_evidence;

-- The audit contains the evidence used, old/new values, and the recalculated
-- total. No process entry, completion, quantity movement or employee labor row
-- is changed by this migration.
INSERT INTO production_plan_changes (id, plan_order_id, batch_id, action, before_data, after_data, impact_data, reason, created_at)
SELECT 'plan-time-v179-' || id, plan_order_id, id, 'repair_plan_time_consistency',
  jsonb_build_object('unitMilliseconds', old_unit, 'totalMilliseconds', old_total::text),
  jsonb_build_object('unitMilliseconds', new_unit, 'totalMilliseconds', COALESCE(new_unit::bigint * quantity, old_total)::text, 'planTimeSource', source),
  jsonb_build_object('importChangeId', import_change_id, 'manualChangeId', manual_change_id,
    'importedUnitMilliseconds', uploaded, 'orderUnitMilliseconds', order_unit, 'boundStandardMilliseconds', bound_standard),
  '统一批次计划工时：依据导入记录、明确调整记录或旧版工序标准覆盖特征校正', CURRENT_TIMESTAMP
FROM plan_time_decisions
WHERE old_unit IS DISTINCT FROM new_unit OR old_total IS DISTINCT FROM COALESCE(new_unit::bigint * quantity, old_total);

UPDATE production_plan_batches b SET unit_milliseconds_snapshot = d.new_unit,
  total_milliseconds_snapshot = COALESCE(d.new_unit::bigint * b.quantity, d.old_total),
  imported_unit_milliseconds = d.uploaded, plan_time_source = d.source
FROM plan_time_decisions d WHERE b.id = d.id;

-- Keep integer milliseconds as the authority; the legacy hour strings are a
-- projection for existing exports/integrations, never an independent input.
CREATE FUNCTION enforce_plan_batch_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_time_source = 'import' AND NEW.imported_unit_milliseconds IS NOT NULL THEN
    NEW.unit_milliseconds_snapshot := NEW.imported_unit_milliseconds;
  END IF;
  NEW.unit_milliseconds_snapshot := COALESCE(NEW.unit_milliseconds_snapshot,
    (SELECT planning_unit_milliseconds FROM production_plan_orders WHERE id = NEW.plan_order_id));
  NEW.total_milliseconds_snapshot := CASE WHEN NEW.unit_milliseconds_snapshot IS NOT NULL THEN NEW.unit_milliseconds_snapshot::bigint * NEW.quantity WHEN NEW.plan_time_source = 'legacy' THEN NEW.total_milliseconds_snapshot ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_batch_time_total BEFORE INSERT OR UPDATE OF unit_milliseconds_snapshot, total_milliseconds_snapshot, quantity, imported_unit_milliseconds, plan_time_source
  ON production_plan_batches FOR EACH ROW EXECUTE FUNCTION enforce_plan_batch_time();

CREATE FUNCTION sync_plan_batch_work_order_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_order_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE work_orders SET
      unit_work_hours = COALESCE((NEW.unit_milliseconds_snapshot::numeric / 3600000)::text, unit_work_hours),
      total_work_hours = COALESCE((NEW.total_milliseconds_snapshot::numeric / 3600000)::text, total_work_hours)
    WHERE id = NEW.work_order_id AND
      ((NEW.unit_milliseconds_snapshot IS NOT NULL AND unit_work_hours IS DISTINCT FROM (NEW.unit_milliseconds_snapshot::numeric / 3600000)::text)
       OR (NEW.total_milliseconds_snapshot IS NOT NULL AND total_work_hours IS DISTINCT FROM (NEW.total_milliseconds_snapshot::numeric / 3600000)::text));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_batch_work_order_time AFTER INSERT OR UPDATE OF unit_milliseconds_snapshot, total_milliseconds_snapshot, quantity, work_order_id, imported_unit_milliseconds, plan_time_source
  ON production_plan_batches FOR EACH ROW EXECUTE FUNCTION sync_plan_batch_work_order_time();

CREATE FUNCTION protect_managed_work_order_time() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch production_plan_batches%ROWTYPE;
BEGIN
  SELECT * INTO batch FROM production_plan_batches WHERE work_order_id = NEW.id AND deleted_at IS NULL;
  IF FOUND THEN
    NEW.unit_work_hours := COALESCE((batch.unit_milliseconds_snapshot::numeric / 3600000)::text, OLD.unit_work_hours);
    NEW.total_work_hours := COALESCE((batch.total_milliseconds_snapshot::numeric / 3600000)::text, OLD.total_work_hours);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER managed_work_order_plan_time BEFORE UPDATE OF unit_work_hours, total_work_hours
  ON work_orders FOR EACH ROW EXECUTE FUNCTION protect_managed_work_order_time();

UPDATE work_orders w SET unit_work_hours = COALESCE((b.unit_milliseconds_snapshot::numeric / 3600000)::text, w.unit_work_hours),
  total_work_hours = COALESCE((b.total_milliseconds_snapshot::numeric / 3600000)::text, w.total_work_hours)
FROM production_plan_batches b WHERE b.work_order_id = w.id AND b.deleted_at IS NULL;

COMMIT;
