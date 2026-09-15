-- All quantities are integral pieces. Pending receipt is never physical stock.
ALTER TABLE fg_lots ADD CONSTRAINT fg_nonnegative_stock CHECK
  ("sourceQuantity" >= 0 AND pending >= 0 AND available >= 0 AND reserved >= 0 AND held >= 0 AND blocked >= 0);
ALTER TABLE fg_shipment_lines ADD CONSTRAINT fg_line_quantity CHECK (quantity > 0 AND returned >= 0 AND returned <= quantity);
ALTER TABLE fg_shipments ADD CONSTRAINT fg_shipment_state CHECK (status IN ('DRAFT','RESERVED','SHIPPED','CANCELLED'));
ALTER TABLE fg_lots ADD CONSTRAINT fg_owner_type CHECK ("ownerType" IN ('PUBLIC','CUSTOMER'));
ALTER TABLE fg_holds ADD CONSTRAINT fg_hold_quantity CHECK (quantity > 0 AND released >= 0 AND released <= quantity);
ALTER TABLE fg_reworks ADD CONSTRAINT fg_rework_quantity CHECK (quantity > 0 AND returned >= 0 AND scrapped >= 0 AND returned + scrapped <= quantity);

-- Historical shipments are consumed FIFO against valid produced-good movements.
-- Remaining quantities are candidates only: a person must reconcile and receive them.
WITH old_ship AS (
 SELECT i.work_order_id, GREATEST(0, SUM(CASE WHEN e.event_type = 'SHIPMENT' THEN e.quantity ELSE -e.quantity END)) AS shipped
 FROM shipment_events e JOIN daily_shipment_plan_items i ON i.id=e.item_id GROUP BY i.work_order_id
), valid_good AS (
 SELECT m.*, GREATEST(0,m.quantity-COALESCE((SELECT SUM(r.quantity) FROM process_quantity_movements r WHERE r.reversal_of_id=m.id AND r.type='REVERSAL' AND r.voided_at IS NULL),0))::int AS good_qty
 FROM process_quantity_movements m JOIN process_completions c ON c.id=m.completion_id
 WHERE m.type='FINISHED_GOOD' AND m.voided_at IS NULL AND c.voided_at IS NULL AND m.quantity > 0
), sources AS (
 SELECT m.id,m.work_order_id,m.created_at,m.good_qty AS quantity,COALESCE(s.shipped,0) AS shipped,
 COALESCE(SUM(m.good_qty) OVER (PARTITION BY m.work_order_id ORDER BY m.created_at,m.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS preceding
 FROM valid_good m LEFT JOIN old_ship s ON s.work_order_id=m.work_order_id
), remaining AS (
 SELECT *, GREATEST(0, quantity-GREATEST(0,shipped-preceding))::int AS remainder FROM sources
)
INSERT INTO fg_lots (id,"sourceKey","sourceKind","movementId","workOrderId","workOrderCode","productKey","productName",specification,unit,"ownerType","customerName","sourceQuantity",pending,available,reserved,held,blocked,location,"openingReview",note,version,"createdAt","updatedAt")
SELECT gen_random_uuid()::text,'movement:'||m.id,'PRODUCTION',m.id,w.id,COALESCE(NULLIF(w.business_code,''),w.code),
 COALESCE(w.drawing_library_item_id,w.product_name||'|'||COALESCE(w.specification,'')),w.product_name,COALESCE(w.specification,''),'件',
 CASE WHEN COALESCE(TRIM(w.customer_name),'')='' THEN 'PUBLIC' ELSE 'CUSTOMER' END,COALESCE(TRIM(w.customer_name),''),
 m.remainder,m.remainder,0,0,0,0,'',true,'期初候选：已扣除历史净发货，须核对实物。历史已出 '||(m.quantity-m.remainder)::text||' 件。',0,m.created_at,NOW()
FROM remaining m JOIN work_orders w ON w.id=m.work_order_id;

CREATE FUNCTION fg_production_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_id text; v_old int := 0; v_new int := 0; v_delta int; v_reversed int:=0; v_original process_quantity_movements%ROWTYPE; v_lot fg_lots%ROWTYPE; v_order work_orders%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.type IN ('FINISHED_GOOD','REVERSAL') OR NEW.type IN ('FINISHED_GOOD','REVERSAL')) AND (NEW.work_order_id<>OLD.work_order_id OR NEW.type<>OLD.type OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id) THEN
   RAISE EXCEPTION 'FG_SOURCE_IDENTITY: 已记账的生产流水不能改换来源，请使用撤回和新记录。' USING ERRCODE='23514';
 END IF;
 IF (TG_OP<>'DELETE' AND NEW.type='REVERSAL') OR (TG_OP='DELETE' AND OLD.type='REVERSAL') THEN
   IF TG_OP='DELETE' THEN v_id:=OLD.reversal_of_id; ELSE v_id:=NEW.reversal_of_id; END IF;
   SELECT * INTO v_original FROM process_quantity_movements WHERE id=v_id;
   IF NOT FOUND OR v_original.type<>'FINISHED_GOOD' OR v_original.voided_at IS NOT NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
   IF TG_OP<>'INSERT' AND OLD.voided_at IS NULL THEN v_old:=-OLD.quantity; END IF;
   IF TG_OP<>'DELETE' AND NEW.voided_at IS NULL THEN v_new:=-NEW.quantity; END IF;
 ELSE
 IF TG_OP <> 'INSERT' THEN
   v_id := OLD.id;
   IF OLD.type='FINISHED_GOOD' AND OLD.voided_at IS NULL THEN v_old:=OLD.quantity; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
   v_id := NEW.id;
   IF NEW.type='FINISHED_GOOD' AND NEW.voided_at IS NULL THEN v_new:=NEW.quantity; END IF;
 END IF;
 SELECT COALESCE(SUM(quantity),0)::int INTO v_reversed FROM process_quantity_movements WHERE reversal_of_id=v_id AND type='REVERSAL' AND voided_at IS NULL;
 IF v_old>0 THEN v_old:=GREATEST(0,v_old-v_reversed); END IF;
 IF v_new>0 THEN v_new:=GREATEST(0,v_new-v_reversed); END IF;
 END IF;
 v_delta:=v_new-v_old;
 IF v_delta=0 THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 SELECT * INTO v_lot FROM fg_lots WHERE "movementId"=v_id FOR UPDATE;
 IF NOT FOUND THEN
   IF v_new <= 0 THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
   SELECT * INTO v_order FROM work_orders WHERE id=NEW.work_order_id;
   INSERT INTO fg_lots (id,"sourceKey","sourceKind","movementId","workOrderId","workOrderCode","productKey","productName",specification,unit,"ownerType","customerName","sourceQuantity",pending,available,reserved,held,blocked,location,"openingReview",note,version,"createdAt","updatedAt")
   VALUES (gen_random_uuid()::text,'movement:'||v_id,'PRODUCTION',v_id,v_order.id,COALESCE(NULLIF(v_order.business_code,''),v_order.code),
    COALESCE(v_order.drawing_library_item_id,v_order.product_name||'|'||COALESCE(v_order.specification,'')),v_order.product_name,COALESCE(v_order.specification,''),'件',
    CASE WHEN COALESCE(TRIM(v_order.customer_name),'')='' THEN 'PUBLIC' ELSE 'CUSTOMER' END,COALESCE(TRIM(v_order.customer_name),''),v_new,v_new,0,0,0,0,'',false,'',0,NOW(),NOW()) RETURNING * INTO v_lot;
   INSERT INTO fg_ledger (id,"lotId",kind,quantity,before,after,reference,reason,"actorId","actorName","createdAt")
   VALUES (gen_random_uuid()::text,v_lot.id,'PRODUCTION_PENDING',v_new,'{}',jsonb_build_object('pending',v_new,'available',0,'reserved',0,'held',0,'blocked',0),v_id,'生产完成自动待接收','SYSTEM','生产执行',NOW());
 ELSE
   IF v_lot.pending+v_delta < 0 OR v_lot."sourceQuantity"+v_delta < 0 THEN
     RAISE EXCEPTION 'FG_SOURCE_IN_USE: 成品已接收、已发货或已有历史出货，请先在成品仓处理关联库存，再撤回生产记录。' USING ERRCODE='23514';
   END IF;
   UPDATE fg_lots SET pending=pending+v_delta,"sourceQuantity"="sourceQuantity"+v_delta,version=version+1,"updatedAt"=NOW() WHERE id=v_lot.id;
   INSERT INTO fg_ledger (id,"lotId",kind,quantity,before,after,reference,reason,"actorId","actorName","createdAt")
   VALUES (gen_random_uuid()::text,v_lot.id,'SOURCE_CORRECTION',v_delta,to_jsonb(v_lot),jsonb_build_object('pending',v_lot.pending+v_delta,'available',v_lot.available,'reserved',v_lot.reserved,'held',v_lot.held,'blocked',v_lot.blocked),v_id,'生产来源变更','SYSTEM','生产执行',NOW());
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER fg_production_source_change AFTER INSERT OR UPDATE ON process_quantity_movements FOR EACH ROW EXECUTE FUNCTION fg_production_source();
-- BEFORE DELETE preserves reversal visibility during a multi-row delete. If the
-- original is removed first it sees the reversals; if a reversal is removed first
-- it restores pending before its original is removed. Received stock still blocks.
CREATE TRIGGER fg_production_source_delete BEFORE DELETE ON process_quantity_movements FOR EACH ROW EXECUTE FUNCTION fg_production_source();
