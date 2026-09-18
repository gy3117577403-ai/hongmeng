ALTER TABLE "drawing_library_items" ADD COLUMN "fixture_required" BOOLEAN;
ALTER TABLE "work_orders" ADD COLUMN "document_review_required" BOOLEAN;
ALTER TABLE "production_plan_batches" ADD COLUMN "document_review_required" BOOLEAN;
ALTER TABLE "QfPackage" ADD COLUMN "sopFiles" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "QfPackage" ADD COLUMN "sourceSignature" TEXT NOT NULL DEFAULT '';
CREATE TABLE "QfSyncQueue" ("libraryItemId" TEXT PRIMARY KEY, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

-- Freeze the original cohort. Rescheduling an existing order never changes its policy.
UPDATE "work_orders" SET "document_review_required" = COALESCE("week_start_date" >= TIMESTAMP '2026-09-20 16:00:00', FALSE);
UPDATE "work_orders" w SET "document_review_required" = root."document_review_required"
FROM "work_orders" root WHERE root.id = COALESCE(w.root_work_order_id, w.parent_work_order_id);
UPDATE "production_plan_batches" b SET "document_review_required" = COALESCE(
  (SELECT w."document_review_required" FROM "work_orders" w WHERE w.id=b.work_order_id),
  b.week_start_date >= TIMESTAMP '2026-09-20 16:00:00');
UPDATE "drawing_library_items" p SET "fixture_required"=q."needFixture"
FROM (SELECT DISTINCT ON ("libraryItemId") "libraryItemId", "needFixture" FROM "QfPackage" ORDER BY "libraryItemId",sequence DESC) q
WHERE q."libraryItemId"=p.id;

CREATE OR REPLACE FUNCTION qf_freeze_review_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.document_review_required IS NOT NULL THEN
    NEW.document_review_required := OLD.document_review_required;
  ELSIF TG_TABLE_NAME='work_orders' THEN
    SELECT document_review_required INTO NEW.document_review_required FROM work_orders
    WHERE id=COALESCE(NEW.root_work_order_id, NEW.parent_work_order_id);
    IF NEW.document_review_required IS NULL AND NEW.week_start_date IS NOT NULL THEN
      NEW.document_review_required := NEW.week_start_date >= TIMESTAMP '2026-09-20 16:00:00';
    END IF;
  ELSE
    SELECT document_review_required INTO NEW.document_review_required FROM work_orders WHERE id=NEW.work_order_id;
    NEW.document_review_required := COALESCE(NEW.document_review_required, NEW.week_start_date >= TIMESTAMP '2026-09-20 16:00:00');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qf_order_scope BEFORE INSERT OR UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION qf_freeze_review_scope();
CREATE TRIGGER qf_batch_scope BEFORE INSERT OR UPDATE ON production_plan_batches FOR EACH ROW EXECUTE FUNCTION qf_freeze_review_scope();

-- A durable queue covers every upload, SOP publisher and plan writer, including imports.
-- Readers do not create packages. The worker drains the queue idempotently.
CREATE OR REPLACE FUNCTION qf_queue_documents() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE product_id TEXT; old_product_id TEXT;
BEGIN
  IF TG_TABLE_NAME='drawing_library_files' THEN
    product_id:=NEW.library_item_id;
    IF TG_OP='UPDATE' THEN old_product_id:=OLD.library_item_id; END IF;
  ELSIF TG_TABLE_NAME='drawing_library_items' THEN
    product_id:=NEW.id;
    IF TG_OP='UPDATE' AND NEW.fixture_required IS NOT DISTINCT FROM OLD.fixture_required AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='production_plan_batches' THEN
    SELECT drawing_library_item_id INTO product_id FROM production_plan_orders WHERE id=NEW.plan_order_id;
    IF TG_OP='UPDATE' THEN SELECT drawing_library_item_id INTO old_product_id FROM production_plan_orders WHERE id=OLD.plan_order_id; END IF;
  ELSE
    product_id:=NEW.drawing_library_item_id;
    IF TG_OP='UPDATE' THEN old_product_id:=OLD.drawing_library_item_id; END IF;
  END IF;
  IF product_id IS NOT NULL THEN
    INSERT INTO "QfSyncQueue" VALUES(product_id,CURRENT_TIMESTAMP) ON CONFLICT ("libraryItemId") DO UPDATE SET "updatedAt"=EXCLUDED."updatedAt";
  END IF;
  IF old_product_id IS NOT NULL AND old_product_id IS DISTINCT FROM product_id THEN
    INSERT INTO "QfSyncQueue" VALUES(old_product_id,CURRENT_TIMESTAMP) ON CONFLICT ("libraryItemId") DO UPDATE SET "updatedAt"=EXCLUDED."updatedAt";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qf_file_queue AFTER INSERT OR UPDATE ON drawing_library_files FOR EACH ROW EXECUTE FUNCTION qf_queue_documents();
CREATE TRIGGER qf_product_queue AFTER INSERT OR UPDATE ON drawing_library_items FOR EACH ROW EXECUTE FUNCTION qf_queue_documents();
CREATE TRIGGER qf_plan_queue AFTER INSERT OR UPDATE ON production_plan_batches FOR EACH ROW EXECUTE FUNCTION qf_queue_documents();
CREATE TRIGGER qf_plan_order_queue AFTER INSERT OR UPDATE ON production_plan_orders FOR EACH ROW EXECUTE FUNCTION qf_queue_documents();
CREATE TRIGGER qf_work_order_queue AFTER INSERT OR UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION qf_queue_documents();
INSERT INTO "QfSyncQueue" ("libraryItemId")
SELECT DISTINCT p.id FROM drawing_library_items p WHERE p.deleted_at IS NULL AND (
  EXISTS(SELECT 1 FROM production_plan_orders o JOIN production_plan_batches b ON b.plan_order_id=o.id
    WHERE o.drawing_library_item_id=p.id AND o.deleted_at IS NULL AND b.deleted_at IS NULL AND b.document_review_required)
  OR EXISTS(SELECT 1 FROM work_orders w WHERE w.drawing_library_item_id=p.id AND w.deleted_at IS NULL AND w.plan_active AND w.document_review_required))
ON CONFLICT DO NOTHING;
CREATE INDEX qf_plan_scope_idx ON production_plan_batches(document_review_required,deleted_at);
CREATE INDEX qf_work_order_scope_idx ON work_orders(document_review_required,deleted_at);
