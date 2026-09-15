BEGIN;
ALTER TABLE fg_lots ADD COLUMN "legacyClosedAt" TIMESTAMP(3), ADD COLUMN "legacyQuantity" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "fg_lots_legacyClosedAt_idx" ON fg_lots("legacyClosedAt");
CREATE TABLE fg_cutover (id TEXT PRIMARY KEY, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE fg_lots ADD CONSTRAINT fg_legacy_closed_stock CHECK ("legacyQuantity">=0 AND ("legacyClosedAt" IS NULL OR (pending=0 AND available=0 AND reserved=0 AND held=0 AND blocked=0 AND "openingReview"=false)));

-- Run once, at first activation on this database. This is an explicit baseline
-- settlement, not a fabricated shipment: no shippedAt, waybill or ShipmentEvent.
CREATE FUNCTION fg_initialize_cutover() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_started TIMESTAMP(3);
BEGIN
  LOCK TABLE process_quantity_movements, fg_lots, fg_shipments IN SHARE ROW EXCLUSIVE MODE;
  INSERT INTO fg_cutover (id,"startedAt") VALUES ('finished-goods-v2',clock_timestamp()) ON CONFLICT DO NOTHING RETURNING "startedAt" INTO v_started;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO fg_ledger (id,"lotId",kind,quantity,before,after,reference,reason,"actorId","actorName","createdAt")
    SELECT gen_random_uuid()::text,l.id,'LEGACY_CLOSE',l.pending+l.available+l.reserved+l.held+l.blocked,
      to_jsonb(l),jsonb_build_object('pending',0,'available',0,'reserved',0,'held',0,'blocked',0),
      'finished-goods-v2','按启用约定，既有结余默认历史已出；实际出货时间未知，不计入当日实发。','SYSTEM','成品仓启用',v_started
    FROM fg_lots l WHERE l."legacyClosedAt" IS NULL;
  UPDATE fg_shipments s SET status='CANCELLED',version=version+1,"updatedAt"=v_started,
    note=concat_ws('；',NULLIF(note,''),'新仓启用前历史默认结清，草稿停止执行')
    WHERE s.status IN ('DRAFT','RESERVED') AND EXISTS (SELECT 1 FROM fg_shipment_lines x JOIN fg_lots l ON l.id=x."lotId" WHERE x."shipmentId"=s.id AND l."legacyClosedAt" IS NULL);
  UPDATE fg_lots SET "legacyClosedAt"=v_started,"legacyQuantity"=pending+available+reserved+held+blocked,
    pending=0,available=0,reserved=0,held=0,blocked=0,"openingReview"=false,version=version+1,"updatedAt"=v_started
    WHERE "legacyClosedAt" IS NULL;
END $$;
SELECT fg_initialize_cutover();

CREATE OR REPLACE FUNCTION fg_production_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
 -- Existing facts are a settled historical baseline; edits must never reopen stock.
 IF EXISTS (SELECT 1 FROM fg_lots WHERE "movementId"=v_id AND "legacyClosedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM process_quantity_movements m JOIN fg_cutover c ON c.id='finished-goods-v2' WHERE m.id=v_id AND m.created_at<c."startedAt") THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
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

COMMIT;
