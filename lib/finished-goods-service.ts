import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type FgLot, type FgShipment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaDateKey } from '@/lib/china-date';
import { syncProductionBatchToDueShipmentPlan } from '@/lib/daily-shipment-sync';
import { netShipmentQuantity, shipmentItemStatus } from '@/lib/daily-shipment-domain';
import { FinishedGoodsError, fgShortWorkOrder, fgAssertStock, fgDate, fgQty, fgRecord, fgRequired, fgStock, fgText, fgWaybills, physicalStock, type FgActor, type FgInput, type FgRow, type FgWorkbench, type Stock } from '@/lib/finished-goods-domain';

type Tx = Prisma.TransactionClient;
type Result = Record<string, string | number | boolean | null>;
const shipmentInclude = { lines: { include: { lot: true } }, batch: true } satisfies Prisma.FgShipmentInclude;
type Shipment = Prisma.FgShipmentGetPayload<{ include: typeof shipmentInclude }>;
const nameOf = (actor: FgActor): string => actor.displayName || actor.username;
const conflict = (message = '记录已更新，请刷新后重试'): never => { throw new FinishedGoodsError(message, 'FG_CONFLICT', 409); };
function checked(input: FgInput): void { if (input.checked !== true) throw new FinishedGoodsError('请先核对实物并勾选确认'); }
function version(actual: number, expected: unknown): void { if (fgQty(expected, true) !== actual) conflict(); }
async function lockLot(tx: Tx, id: string): Promise<FgLot> {
  await tx.$queryRaw`SELECT id FROM fg_lots WHERE id=${id} FOR UPDATE`;
  const lot = await tx.fgLot.findUnique({ where: { id } });
  if (!lot) throw new FinishedGoodsError('成品记录不存在', 'FG_NOT_FOUND', 404);
  return lot;
}
async function lockShipment(tx: Tx, id: string): Promise<Shipment> {
  await tx.$queryRaw`SELECT id FROM fg_shipments WHERE id=${id} FOR UPDATE`;
  const shipment = await tx.fgShipment.findUnique({ where: { id }, include: shipmentInclude });
  if (!shipment) throw new FinishedGoodsError('发货单不存在', 'FG_NOT_FOUND', 404);
  return shipment;
}
async function number(tx: Tx, kind: string, date: string): Promise<{ number: string; sequence: number }> {
  const row = await tx.fgSequence.upsert({ where: { key: `${kind}:${date}` }, create: { key: `${kind}:${date}`, value: 1 }, update: { value: { increment: 1 } } });
  return { number: `${kind}${date.replace(/-/g, '')}-${String(row.value).padStart(kind === 'PC' ? 2 : 4, '0')}`, sequence: row.value };
}
async function ledger(tx: Tx, lot: FgLot, next: Stock, kind: string, quantity: number, actor: FgActor, reason = '', reference = ''): Promise<FgLot> {
  if (lot.legacyClosedAt) throw new FinishedGoodsError('历史默认已出记录不能重新接收入库');
  fgAssertStock(next);
  const updated = await tx.fgLot.update({ where: { id: lot.id }, data: { ...next, version: { increment: 1 } } });
  await tx.fgLedger.create({ data: { lotId: lot.id, kind, quantity, before: fgStock(lot), after: next, reason, reference, actorId: actor.id, actorName: nameOf(actor) } });
  return updated;
}
async function sourceBlock(tx: Tx, lot: FgLot): Promise<string> {
  if (!['PRODUCTION', 'ALLOCATION'].includes(lot.sourceKind)) return '';
  if (!lot.workOrderId) return lot.sourceKind === 'ALLOCATION' ? '' : '生产来源已移除';
  const workOrder = await tx.workOrder.findUnique({ where: { id: lot.workOrderId }, select: { deletedAt: true } });
  if (!workOrder || workOrder.deletedAt) return '生产工单已移除，需先恢复来源';
  if (lot.movementId) {
    const movement = await tx.processQuantityMovement.findUnique({ where: { id: lot.movementId }, select: { voidedAt: true, completion: { select: { voidedAt: true } } } });
    if (!movement || movement.voidedAt || movement.completion.voidedAt) return '生产完成记录已撤回';
  }
  if (await tx.processSupplementObligation.count({ where: { workOrderId: lot.workOrderId, status: 'ACTIVE' } })) return '生产补充工序尚未完成';
  return '';
}
async function assertShippable(tx: Tx, lot: FgLot): Promise<void> {
  if (lot.legacyClosedAt) throw new FinishedGoodsError('历史默认已出记录不能再次发货');
  if (lot.openingReview) throw new FinishedGoodsError('期初库存须先核对接收');
  const reason = await sourceBlock(tx, lot);
  if (reason) throw new FinishedGoodsError(reason, 'FG_SOURCE_BLOCKED', 409);
}
async function receive(tx: Tx, lot: FgLot, quantity: number, actor: FgActor, reason = '', openingConfirmed = false): Promise<FgLot> {
  if (lot.openingReview && !openingConfirmed) throw new FinishedGoodsError('请核对期初实物数量，使用「期初核对」接收');
  if (lot.movementId) {
    const source = await tx.processQuantityMovement.findUnique({ where: { id: lot.movementId }, select: { voidedAt: true, completion: { select: { voidedAt: true } } } });
    if (!source || source.voidedAt || source.completion.voidedAt) conflict('生产来源已撤回，不能接收');
  }
  const next = await ledger(tx, lot, { ...fgStock(lot), pending: lot.pending - quantity, available: lot.available + quantity }, lot.openingReview ? 'OPENING' : 'RECEIVE', quantity, actor, reason);
  return tx.fgLot.update({ where: { id: next.id }, data: { receivedAt: lot.receivedAt || new Date(), openingReview: lot.openingReview && next.pending > 0 } });
}
function logistics(input: FgInput, base?: FgShipment) {
  const field = (key: string, previous = '', max = 500) => key in input ? fgText(input[key], max) : previous;
  const method = field('method', base?.method || 'COURIER', 20);
  if (!['COURIER', 'PICKUP', 'DELIVERY'].includes(method)) throw new FinishedGoodsError('出货方式无效');
  return {
    customerName: field('customerName', base?.customerName || '', 150), recipient: field('recipient', base?.recipient || '', 100),
    phone: field('phone', base?.phone || '', 100), address: field('address', base?.address || '', 500), method,
    carrier: field('carrier', base?.carrier || '', 100), waybills: 'waybills' in input ? fgWaybills(input.waybills) : fgWaybills(base?.waybills),
    boxes: 'boxes' in input ? fgQty(input.boxes) : base?.boxes || 1, handoverName: field('handoverName', base?.handoverName || '', 100),
    note: field('note', base?.note || '', 1000), plannedDate: fgDate(input.plannedDate || base?.plannedDate),
    batchId: field('batchId', base?.batchId || '', 100) || null,
    externalReference: field('externalReference', base?.externalReference || '', 150),
  };
}
async function checkWaybillCustomer(tx: Tx, details: ReturnType<typeof logistics>, input: FgInput, shipmentId?: string): Promise<void> {
  if (!details.waybills.length || details.method !== 'COURIER' || input.waybillChecked === true) return;
  const matches = await tx.fgShipment.findMany({
    where: { ...(shipmentId ? { id: { not: shipmentId } } : {}), customerName: { not: details.customerName }, status: { in: ['DRAFT', 'RESERVED', 'SHIPPED'] }, OR: details.waybills.map(waybill => ({ waybills: { array_contains: [waybill] } })) },
    select: { customerName: true }, take: 3,
  });
  if (matches.length) throw new FinishedGoodsError(`运单号也用于其他客户：${[...new Set(matches.map(row => row.customerName))].join('、')}。请核对是否误复制。`, 'FG_WAYBILL_CUSTOMER', 409);
}
async function validateBatch(tx: Tx, batchId: string | null, date: string, shipping = false): Promise<void> {
  if (!batchId) return;
  const batch = await tx.fgDispatchBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.closedAt) throw new FinishedGoodsError('批次不存在或已封批');
  if (batch.businessDate !== date) throw new FinishedGoodsError(shipping ? '实际发货须选择今天的出货批次' : '批次日期须与计划发货日一致');
}

async function saveDraft(tx: Tx, input: FgInput, actor: FgActor): Promise<Shipment> {
  const id = fgText(input.shipmentId, 100);
  let existing: Shipment | undefined;
  if (id) {
    existing = await lockShipment(tx, id);
    version(existing.version, input.shipmentVersion);
    if (existing.status !== 'DRAFT') throw new FinishedGoodsError('该单已占用或已出货，数量不能直接修改');
    if (existing.lines.length > 1 && !Array.isArray(input.lines)) throw new FinishedGoodsError('合单须保留全部明细，请使用该单的确认发货操作');
  }
  const rawLines = Array.isArray(input.lines) ? input.lines.map(fgRecord) : [{ lotId: input.lotId, quantity: input.quantity, version: input.version }];
  if (!rawLines.length || rawLines.length > 100) throw new FinishedGoodsError('一次发货需要 1 至 100 条成品明细');
  if (new Set(rawLines.map(line => String(line.lotId))).size !== rawLines.length) throw new FinishedGoodsError('同一库存批次不能重复添加');
  const lines = [];
  for (const line of rawLines.sort((a, b) => String(a.lotId).localeCompare(String(b.lotId)))) {
    const lot = await lockLot(tx, fgRequired(line.lotId, '成品记录', 100));
    version(lot.version, line.version);
    const activeDraft = await tx.fgShipmentLine.findFirst({ where: { lotId: lot.id, shipment: { status: { in: ['DRAFT', 'RESERVED'] }, ...(existing ? { id: { not: existing.id } } : {}) } } });
    if (activeDraft) conflict(`${lot.workOrderCode} 已有未完成发货单，请在原单处理或取消后重新建单`);
    const quantity = fgQty(line.quantity);
    if (quantity > lot.pending + lot.available) throw new FinishedGoodsError(`${lot.workOrderCode} 数量超过待接收和可用库存`);
    lines.push({ lot, quantity });
  }
  const details = logistics(input, existing);
  const customer = details.customerName || lines[0].lot.customerName;
  if (!customer) throw new FinishedGoodsError('公共备货须先分配客户，再创建发货单');
  if (lines.some(line => line.lot.ownerType === 'PUBLIC' || line.lot.customerName !== customer)) throw new FinishedGoodsError('合单须为同一客户；公共备货请先分配，客户专属库存不能串用');
  await checkWaybillCustomer(tx, { ...details, customerName: customer }, input, existing?.id);
  await validateBatch(tx, details.batchId, details.plannedDate);
  if (existing) {
    await tx.fgShipmentLine.deleteMany({ where: { shipmentId: existing.id } });
    return tx.fgShipment.update({ where: { id: existing.id }, data: { ...details, customerName: customer, version: { increment: 1 }, lines: { create: lines.map(line => ({ lotId: line.lot.id, quantity: line.quantity })) } }, include: shipmentInclude });
  }
  const serial = await number(tx, 'FH', details.plannedDate);
  return tx.fgShipment.create({ data: { ...details, customerName: customer, number: serial.number, actorId: actor.id, actorName: nameOf(actor), lines: { create: lines.map(line => ({ lotId: line.lot.id, quantity: line.quantity })) } }, include: shipmentInclude });
}

// Compatibility projection: immutable warehouse evidence is the sole new source.
async function projectShipment(tx: Tx, shipment: Shipment, line: Shipment['lines'][number], actor: FgActor, at: Date): Promise<void> {
  if (!line.lot.workOrderId) return;
  let item = await tx.dailyShipmentPlanItem.findFirst({ where: { workOrderId: line.lot.workOrderId, status: { in: ['PLANNED', 'PARTIALLY_SHIPPED'] } }, orderBy: { plannedShipAt: 'asc' } });
  if (!item) {
    const batch = await tx.productionPlanBatch.findFirst({ where: { workOrderId: line.lot.workOrderId, deletedAt: null } });
    if (batch) {
      const synced = await syncProductionBatchToDueShipmentPlan(tx, { batchId: batch.id, actorId: actor.id, allowArchived: true, reason: 'repair' });
      if (synced.itemId) item = await tx.dailyShipmentPlanItem.findUnique({ where: { id: synced.itemId } });
    }
  }
  // A return being reshipped may refer to a previously fulfilled plan item.
  if (!item) item = await tx.dailyShipmentPlanItem.findFirst({ where: { workOrderId: line.lot.workOrderId }, orderBy: { createdAt: 'desc' } });
  if (!item) return;
  await tx.shipmentEvent.create({ data: { itemId: item.id, eventType: 'SHIPMENT', quantity: line.quantity, shippedAt: at, actorId: actor.id, idempotencyKey: `FG:${line.id}`, reason: `成品仓 ${shipment.number}` } });
  await tx.fgShipmentLine.update({ where: { id: line.id }, data: { dailyItemId: item.id } });
  const events = await tx.shipmentEvent.findMany({ where: { itemId: item.id } });
  const nextStatus = shipmentItemStatus(item.plannedQuantity, netShipmentQuantity(events));
  await tx.dailyShipmentPlanItem.update({ where: { id: item.id }, data: { status: nextStatus, associationKey: nextStatus === 'SHIPPED' ? null : item.associationKey, version: { increment: 1 }, updatedById: actor.id } });
  await tx.dailyShipmentPlan.update({ where: { id: item.planId }, data: { version: { increment: 1 }, updatedById: actor.id } });
}

async function ship(tx: Tx, shipment: Shipment, input: FgInput, actor: FgActor): Promise<Result> {
  checked(input);
  if (!['DRAFT', 'RESERVED'].includes(shipment.status)) conflict('该单已发货或已取消');
  const details = logistics(input, shipment);
  const now = new Date();
  const today = chinaDateKey(now);
  if (details.customerName !== shipment.customerName) throw new FinishedGoodsError('出库记录的客户不能变更');
  // Formal shipping documents and recipient details are maintained externally.
  // An explicit physical confirmation and valid stock remain mandatory.
  await checkWaybillCustomer(tx, details, input, shipment.id);
  await validateBatch(tx, details.batchId, today, true);
  const nextShipment = await tx.fgShipment.update({ where: { id: shipment.id }, data: { ...details, plannedDate: today, status: 'SHIPPED', shippedAt: now, actorId: actor.id, actorName: nameOf(actor), version: { increment: 1 } }, include: shipmentInclude });
  for (const line of [...shipment.lines].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
    let lot = await lockLot(tx, line.lotId);
    await assertShippable(tx, lot);
    if (shipment.status === 'DRAFT' && lot.available < line.quantity && input.receive === true) {
      lot = await receive(tx, lot, line.quantity - lot.available, actor, `急单接收 ${shipment.number}`);
    }
    const bucket = shipment.status === 'RESERVED' ? 'reserved' : 'available';
    await ledger(tx, lot, { ...fgStock(lot), [bucket]: lot[bucket] - line.quantity }, 'SHIP', line.quantity, actor, details.note, shipment.id);
    await projectShipment(tx, nextShipment, line, actor, now);
  }
  return { id: shipment.id, number: shipment.number, shipped: true };
}

async function stockAction(tx: Tx, input: FgInput, actor: FgActor): Promise<Result> {
  let lot = await lockLot(tx, fgRequired(input.lotId, '成品记录', 100));
  version(lot.version, input.version);
  if (lot.legacyClosedAt) throw new FinishedGoodsError('历史默认已出记录只供查询');
  const action = fgText(input.action);
  const quantity = ['MOVE', 'ALLOCATE'].includes(action) ? (action === 'ALLOCATE' ? fgQty(input.quantity) : 0) : fgQty(input.quantity, action === 'OPENING_RECONCILE');
  const reason = ['RECEIVE'].includes(action) ? fgText(input.reason) : fgRequired(input.reason, '原因');
  if (action === 'RECEIVE') {
    checked(input); lot = await receive(tx, lot, quantity, actor, reason);
  } else if (action === 'OPENING_RECONCILE') {
    checked(input);
    if (!lot.openingReview) conflict('该批次已完成期初核对');
    // Reconcile only pending historical stock; an excess is an explicit separate counted lot.
    const counted = Math.min(quantity, lot.pending);
    const before = fgStock(lot);
    await tx.fgLot.update({ where: { id: lot.id }, data: { pending: counted, sourceQuantity: lot.sourceQuantity - lot.pending + counted, openingReview: false } });
    await tx.fgLedger.create({ data: { lotId: lot.id, kind: 'ADJUST', quantity: counted - lot.pending, before, after: { ...before, pending: counted }, reason, actorId: actor.id, actorName: nameOf(actor) } });
    lot = await lockLot(tx, lot.id);
    if (counted) lot = await receive(tx, lot, counted, actor, reason, true);
    if (quantity > counted) await createCountedLot(tx, { ...input, quantity: quantity - counted, customerName: lot.customerName, productName: lot.productName, productKey: lot.productKey, specification: lot.specification, workOrderCode: lot.workOrderCode, ownerType: lot.ownerType, location: lot.location }, actor, 'OPENING');
  } else if (action === 'UNRECEIVE') {
    checked(input);
    if (lot.sourceKind !== 'PRODUCTION') throw new FinishedGoodsError('只有生产来源可以撤销接收，其他来源请办理盘点调整');
    lot = await ledger(tx, lot, { ...fgStock(lot), available: lot.available - quantity, pending: lot.pending + quantity }, action, quantity, actor, reason);
  } else if (action === 'HOLD') {
    const dueDate = fgText(input.dueDate) ? fgDate(input.dueDate) : null;
    const hold = await tx.fgHold.create({ data: { lotId: lot.id, quantity, reason, dueDate, actorId: actor.id, actorName: nameOf(actor) } });
    lot = await ledger(tx, lot, { ...fgStock(lot), available: lot.available - quantity, held: lot.held + quantity }, action, quantity, actor, reason, hold.id);
  } else if (action === 'RELEASE_HOLD') {
    let remaining = quantity;
    for (const hold of await tx.fgHold.findMany({ where: { lotId: lot.id }, orderBy: { createdAt: 'asc' } })) {
      const released = Math.min(remaining, hold.quantity - hold.released);
      if (released > 0) { await tx.fgHold.update({ where: { id: hold.id }, data: { released: { increment: released } } }); remaining -= released; }
    }
    if (remaining) conflict('留库数量不足');
    lot = await ledger(tx, lot, { ...fgStock(lot), held: lot.held - quantity, available: lot.available + quantity }, action, quantity, actor, reason);
  } else if (action === 'BLOCK' || action === 'UNBLOCK') {
    const delta = action === 'BLOCK' ? quantity : -quantity;
    lot = await ledger(tx, lot, { ...fgStock(lot), available: lot.available - delta, blocked: lot.blocked + delta }, action, quantity, actor, reason);
  } else if (action === 'SCRAP' || action === 'ADJUST_DOWN') {
    checked(input);
    const bucket = input.bucket === 'blocked' ? 'blocked' : 'available';
    lot = await ledger(tx, lot, { ...fgStock(lot), [bucket]: lot[bucket] - quantity }, action === 'SCRAP' ? action : 'ADJUST', -quantity, actor, reason);
  } else if (action === 'REWORK_OUT') {
    checked(input);
    const bucket = input.bucket === 'blocked' ? 'blocked' : 'available';
    const rework = await tx.fgRework.create({ data: { lotId: lot.id, quantity, reason, destination: fgRequired(input.destination, '返工去向'), actorName: nameOf(actor) } });
    lot = await ledger(tx, lot, { ...fgStock(lot), [bucket]: lot[bucket] - quantity }, action, quantity, actor, reason, rework.id);
  } else if (action === 'MOVE') {
    const location = fgRequired(input.location, '库位', 100);
    await ledger(tx, lot, fgStock(lot), action, physicalStock(lot), actor, `${lot.location || '未设库位'} → ${location}；${reason}`);
    lot = await tx.fgLot.update({ where: { id: lot.id }, data: { location } });
  } else if (action === 'ALLOCATE') {
    if (lot.ownerType !== 'PUBLIC') throw new FinishedGoodsError('只能分配公共备货；客户专属库存不可变更归属');
    const customer = fgRequired(input.customerName, '目标客户', 150);
    await assertShippable(tx, lot);
    const bucket = 'available';
    lot = await ledger(tx, lot, { ...fgStock(lot), [bucket]: lot[bucket] - quantity }, action, quantity, actor, reason);
    const newLot = await tx.fgLot.create({ data: { sourceKey: `allocation:${randomUUID()}`, sourceKind: 'ALLOCATION', workOrderId: lot.workOrderId, workOrderCode: lot.workOrderCode, productKey: lot.productKey, productName: lot.productName, specification: lot.specification, unit: lot.unit, ownerType: 'CUSTOMER', customerName: customer, sourceQuantity: quantity, [bucket]: quantity, location: lot.location, note: `来自公共备货 ${lot.id}；${reason}`, receivedAt: lot.receivedAt } });
    await ledger(tx, newLot, fgStock(newLot), action, quantity, actor, reason, lot.id);
    return { id: newLot.id };
  } else throw new FinishedGoodsError('不支持的库存操作');
  return { id: lot.id, version: lot.version };
}

async function createCountedLot(tx: Tx, input: FgInput, actor: FgActor, kind = 'OPENING'): Promise<Result> {
  checked(input);
  const quantity = fgQty(input.quantity); const reason = fgRequired(input.reason, '实物来源及核对原因');
  const customerName = input.ownerType === 'PUBLIC' ? '' : fgRequired(input.customerName, '客户', 150);
  const productName = fgRequired(input.productName, '产品名称', 150); const specification = fgRequired(input.specification, '规格或图号', 250);
  const lot = await tx.fgLot.create({ data: { sourceKey: `counted:${randomUUID()}`, sourceKind: kind, workOrderCode: fgText(input.workOrderCode, 100) || '期初盘点', productKey: fgText(input.productKey, 250) || `${productName}|${specification}`, productName, specification, unit: fgText(input.unit, 30) || '件', ownerType: customerName ? 'CUSTOMER' : 'PUBLIC', customerName, sourceQuantity: quantity, available: quantity, location: fgText(input.location, 100), note: reason, receivedAt: new Date() } });
  await tx.fgLedger.create({ data: { lotId: lot.id, kind, quantity, before: { pending: 0, available: 0, reserved: 0, held: 0, blocked: 0 }, after: fgStock(lot), reason, actorId: actor.id, actorName: nameOf(actor) } });
  return { id: lot.id };
}

async function returnShipment(tx: Tx, input: FgInput, actor: FgActor): Promise<Result> {
  checked(input);
  const lineId = fgRequired(input.lineId, '原发货明细', 100);
  await tx.$queryRaw`SELECT id FROM fg_shipment_lines WHERE id=${lineId} FOR UPDATE`;
  const line = await tx.fgShipmentLine.findUnique({ where: { id: lineId }, include: { shipment: true, lot: true } });
  if (!line || line.shipment.status !== 'SHIPPED') throw new FinishedGoodsError('原发货记录不存在');
  const quantity = fgQty(input.quantity); const reason = fgRequired(input.reason, '退货原因');
  if (quantity > line.quantity - line.returned) conflict('退货数量超过原单尚未退回数量');
  const source = line.lot;
  const lot = await tx.fgLot.create({ data: { sourceKey: `return:${randomUUID()}`, sourceKind: 'RETURN', workOrderId: source.workOrderId, workOrderCode: source.workOrderCode, productKey: source.productKey, productName: source.productName, specification: source.specification, unit: source.unit, customerName: source.customerName, ownerType: source.ownerType, sourceQuantity: quantity, blocked: quantity, location: fgText(input.location, 100) || '退货隔离区', note: reason, receivedAt: new Date() } });
  const receipt = await tx.fgReturn.create({ data: { lineId: line.id, lotId: lot.id, quantity, reason, actorName: nameOf(actor) } });
  await tx.fgShipmentLine.update({ where: { id: line.id }, data: { returned: { increment: quantity } } });
  await tx.fgLedger.create({ data: { lotId: lot.id, kind: 'RETURN', quantity, before: { pending: 0, available: 0, reserved: 0, held: 0, blocked: 0 }, after: fgStock(lot), reference: line.shipment.id, reason, actorId: actor.id, actorName: nameOf(actor) } });
  if (line.dailyItemId) {
    const original = await tx.shipmentEvent.findUnique({ where: { idempotencyKey: `FG:${line.id}` } });
    if (original) {
      await tx.shipmentEvent.create({ data: { itemId: line.dailyItemId, eventType: 'REVERSAL', quantity, shippedAt: new Date(), actorId: actor.id, reversalOfEventId: original.id, idempotencyKey: `FGRETURN:${receipt.id}`, reason: `成品仓退货 ${reason}` } });
      const item = await tx.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: line.dailyItemId }, include: { events: true } });
      await tx.dailyShipmentPlanItem.update({ where: { id: item.id }, data: { status: shipmentItemStatus(item.plannedQuantity, netShipmentQuantity(item.events)), version: { increment: 1 }, updatedById: actor.id } });
      await tx.dailyShipmentPlan.update({ where: { id: item.planId }, data: { status: 'CONFIRMED', closedAt: null, version: { increment: 1 }, updatedById: actor.id } });
    }
  }
  return { id: lot.id, returnId: receipt.id };
}

async function reworkReceive(tx: Tx, input: FgInput, actor: FgActor): Promise<Result> {
  checked(input);
  const id = fgRequired(input.reworkId, '返工单', 100);
  await tx.$queryRaw`SELECT id FROM fg_reworks WHERE id=${id} FOR UPDATE`;
  const rework = await tx.fgRework.findUnique({ where: { id }, include: { lot: true } });
  if (!rework) throw new FinishedGoodsError('返工记录不存在');
  if (rework.lot.legacyClosedAt) throw new FinishedGoodsError('此记录已按启用约定结清，不能重新转回库存');
  const quantity = fgQty(input.quantity); const reason = fgRequired(input.reason, '处理说明');
  if (quantity > rework.quantity - rework.returned - rework.scrapped) conflict('数量超过返工在外数量');
  if (input.action === 'REWORK_SCRAP') {
    await tx.fgRework.update({ where: { id }, data: { scrapped: { increment: quantity } } });
    const source = await lockLot(tx, rework.lotId);
    await ledger(tx, source, fgStock(source), 'REWORK_SCRAP', quantity, actor, reason, id);
    return { id };
  }
  await tx.fgRework.update({ where: { id }, data: { returned: { increment: quantity } } });
  const source = rework.lot;
  const lot = await tx.fgLot.create({ data: { sourceKey: `rework:${randomUUID()}`, sourceKind: 'REWORK', workOrderId: source.workOrderId, workOrderCode: source.workOrderCode, productKey: source.productKey, productName: source.productName, specification: source.specification, unit: source.unit, customerName: source.customerName, ownerType: source.ownerType, sourceQuantity: quantity, blocked: quantity, location: fgText(input.location, 100) || '返工回库区', note: reason, receivedAt: new Date() } });
  await tx.fgLedger.create({ data: { lotId: lot.id, kind: 'REWORK_RETURN', quantity, before: { pending: 0, available: 0, reserved: 0, held: 0, blocked: 0 }, after: fgStock(lot), reference: id, reason, actorId: actor.id, actorName: nameOf(actor) } });
  return { id: lot.id };
}

async function perform(tx: Tx, input: FgInput, actor: FgActor): Promise<Result> {
  const action = fgRequired(input.action, '操作', 40);
  if (action === 'RECEIVE_HOLD') {
    fgRequired(input.reason, '留库原因');
    const received = await stockAction(tx, { ...input, action: 'RECEIVE' }, actor);
    return stockAction(tx, { ...input, action: 'HOLD', version: received.version }, actor);
  }
  if (action === 'BATCH_RECEIVE') {
    checked(input);
    const entries = Array.isArray(input.entries) ? input.entries.map(fgRecord) : [];
    if (!entries.length || entries.length > 100) throw new FinishedGoodsError('请选择 1 至 100 条入库记录');
    if (new Set(entries.map(entry => entry.lotId)).size !== entries.length) throw new FinishedGoodsError('同一货批不能重复入库');
    for (const entry of entries.sort((a,b) => String(a.lotId).localeCompare(String(b.lotId)))) await stockAction(tx, { ...entry, action: 'RECEIVE', checked: true }, actor);
    return { count: entries.length, received: true };
  }
  if (['RECEIVE','UNRECEIVE','OPENING_RECONCILE','HOLD','RELEASE_HOLD','BLOCK','UNBLOCK','SCRAP','ADJUST_DOWN','REWORK_OUT','MOVE','ALLOCATE'].includes(action)) return stockAction(tx, input, actor);
  if (action === 'OPENING_ADD') return createCountedLot(tx, input, actor);
  if (action === 'RETURN') return returnShipment(tx, input, actor);
  if (action === 'REWORK_RETURN' || action === 'REWORK_SCRAP') return reworkReceive(tx, input, actor);
  if (action === 'CREATE_BATCH') {
    const date = fgDate(input.date); const serial = await number(tx, 'PC', date);
    const batch = await tx.fgDispatchBatch.create({ data: { ...serial, businessDate: date, name: fgText(input.name, 100), carrier: fgText(input.carrier, 100), note: fgText(input.note), actorName: nameOf(actor) } });
    return { id: batch.id, number: batch.number };
  }
  if (action === 'CLOSE_BATCH') {
    const batchId = fgRequired(input.batchId, '批次', 100);
    if (await tx.fgShipment.count({ where: { batchId, status: { in: ['DRAFT','RESERVED'] } } })) throw new FinishedGoodsError('该批仍有待发货单，请先发货或移至其他批次');
    const changed = await tx.fgDispatchBatch.updateMany({ where: { id: batchId, closedAt: null }, data: { closedAt: new Date() } });
    if (!changed.count) conflict('批次已封批或不存在');
    return { id: batchId };
  }
  if (action === 'SAVE_DRAFT' || action === 'QUICK_SHIP') {
    const shipment = await saveDraft(tx, input, actor);
    if (action === 'QUICK_SHIP') return ship(tx, shipment, input, actor);
    return { id: shipment.id, number: shipment.number, version: shipment.version };
  }
  if (action === 'BATCH_SHIP') {
    checked(input);
    const entries = Array.isArray(input.entries) ? input.entries.map(fgRecord) : [];
    if (!entries.length || entries.length > 100) throw new FinishedGoodsError('请选择 1 至 100 条出货记录');
    for (const entry of entries) await perform(tx, { ...entry, action: 'QUICK_SHIP', checked: true, waybillChecked: input.waybillChecked === true }, actor);
    return { count: entries.length, shipped: true };
  }
  if (['SAVE_LOGISTICS','SHIP','RESERVE','UNRESERVE','CANCEL_DRAFT'].includes(action)) {
    const shipment = await lockShipment(tx, fgRequired(input.shipmentId, '发货单', 100));
    version(shipment.version, input.shipmentVersion);
    if (action === 'SAVE_LOGISTICS') {
      if (shipment.status === 'CANCELLED') throw new FinishedGoodsError('已取消的单据不能修改');
      const details = logistics(input, shipment);
      // Once shipped, date/batch/customer/method and the physical handover identity are immutable.
      if (details.customerName !== shipment.customerName) throw new FinishedGoodsError('客户不能在物流补录中变更');
      await checkWaybillCustomer(tx, { ...details, method: shipment.status === 'SHIPPED' ? shipment.method : details.method }, input, shipment.id);
      const data = shipment.status === 'SHIPPED' ? { carrier: details.carrier, waybills: details.waybills, note: details.note, externalReference: details.externalReference } : details;
      if (shipment.status !== 'SHIPPED') await validateBatch(tx, details.batchId, details.plannedDate);
      const updated = await tx.fgShipment.update({ where: { id: shipment.id }, data: { ...data, version: { increment: 1 } } });
      for (const line of shipment.lines) await tx.fgLedger.create({ data: { lotId: line.lotId, kind: 'LOGISTICS', quantity: 0, before: { waybills: shipment.waybills, note: shipment.note, externalReference: shipment.externalReference }, after: { waybills: updated.waybills, note: updated.note, externalReference: updated.externalReference }, reference: shipment.id, reason: input.waybillChecked === true ? '已核对跨客户共用运单并保存信息' : '保存单号与出库备注', actorId: actor.id, actorName: nameOf(actor) } });
      return { id: updated.id, version: updated.version };
    }
    if (action === 'SHIP') return ship(tx, shipment, input, actor);
    if (action === 'RESERVE' && shipment.status !== 'DRAFT') conflict('只有草稿可以占用库存');
    if (action === 'UNRESERVE' && shipment.status !== 'RESERVED') conflict('该单没有库存占用');
    if (action === 'CANCEL_DRAFT' && !['DRAFT','RESERVED'].includes(shipment.status)) conflict('已发货单请办理退货，不能直接取消');
    for (const line of [...shipment.lines].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
      const lot = await lockLot(tx, line.lotId);
      if (action === 'RESERVE') {
        await assertShippable(tx, lot);
        await ledger(tx, lot, { ...fgStock(lot), available: lot.available - line.quantity, reserved: lot.reserved + line.quantity }, 'RESERVE', line.quantity, actor, '', shipment.id);
      } else if (shipment.status === 'RESERVED') await ledger(tx, lot, { ...fgStock(lot), available: lot.available + line.quantity, reserved: lot.reserved - line.quantity }, 'RELEASE_RESERVATION', line.quantity, actor, fgText(input.reason), shipment.id);
    }
    const status = action === 'RESERVE' ? 'RESERVED' : action === 'CANCEL_DRAFT' ? 'CANCELLED' : 'DRAFT';
    await tx.fgShipment.update({ where: { id: shipment.id }, data: { status, version: { increment: 1 } } });
    return { id: shipment.id, status };
  }
  throw new FinishedGoodsError('不支持的成品仓操作');
}

export async function mutateFinishedGoods(input: FgInput, actor: FgActor, idempotencyKey: unknown): Promise<Result> {
  const key = fgRequired(idempotencyKey, '操作编号', 150);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finished-goods:${key}`},0))`;
        const previous = await tx.fgMutation.findUnique({ where: { key } });
        if (previous) {
          if (previous.payloadHash !== payloadHash || previous.actorId !== actor.id) conflict('操作编号已用于不同内容，请刷新后重试');
          return { ...previous.result as Result, replayed: true };
        }
        const result = await perform(tx, input, actor);
        await tx.fgMutation.create({ data: { key, payloadHash, actorId: actor.id, result } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000, maxWait: 10000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && ['40001','40P01'].includes(String(error.meta?.code))))) { if (attempt < 3) continue; conflict('其他人正在处理这些库存，请稍后重试'); }
      throw error;
    }
  }
  return conflict();
}

export async function loadFinishedGoods(input: { date?: string; dateTo?: string; scope?: string; view?: string; filter?: string; q?: string; batchId?: string; page?: number; pageSize?: number }): Promise<FgWorkbench> {
  const date = fgDate(input.date);
  const workDate = fgDate();
  const dateTo = input.dateTo ? fgDate(input.dateTo) : date;
  if (dateTo < date) throw new FinishedGoodsError('结束日期不能早于开始日期');
  const start = new Date(`${date}T00:00:00+08:00`); const end = new Date(new Date(`${dateTo}T00:00:00+08:00`).getTime() + 86400000);
  const pageSize = [24, 16, 48, 100].includes(input.pageSize || 0) ? input.pageSize! : 24;
  const q = fgText(input.q, 200).toLocaleLowerCase();
  const allHistory = input.scope === 'all';
  const view = input.view || 'queue';
  const filter = input.filter || 'all';
  return prisma.$transaction(async tx => {
    const lots = await tx.fgLot.findMany({
      where: { legacyClosedAt: null, OR: [{ pending: { gt: 0 } }, { available: { gt: 0 } }, { reserved: { gt: 0 } }, { held: { gt: 0 } }, { blocked: { gt: 0 } }] },
      include: { holds: true, lines: { where: { shipment: { status: { in: ['DRAFT', 'RESERVED'] } } }, include: { shipment: { include: { batch: true, _count: { select: { lines: true } } } } }, orderBy: { shipment: { updatedAt: 'desc' } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const shipmentWhere: Prisma.FgShipmentWhereInput = { status: 'SHIPPED', ...(!allHistory ? { shippedAt: { gte: start, lt: end } } : {}) };
    const waybillMatches = allHistory && q ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fg_shipments WHERE waybills::text ILIKE ${'%' + q.replace(/[\\%_]/g, '\\$&') + '%'}` : [];
    if (allHistory && q) shipmentWhere.OR = [{ number: { contains: q, mode: 'insensitive' } }, { customerName: { contains: q, mode: 'insensitive' } }, { lines: { some: { lot: { OR: [{ workOrderCode: { contains: q.replace('·', '-'), mode: 'insensitive' } }, { specification: { contains: q, mode: 'insensitive' } }, { productName: { contains: q, mode: 'insensitive' } }] } } } }, { id: { in: waybillMatches.map(s => s.id) } }];
    const shipped = await tx.fgShipment.findMany({ where: shipmentWhere, include: shipmentInclude, orderBy: [{ shippedAt: 'desc' }, { id: 'asc' }], take: allHistory ? 20001 : undefined });
    if (shipped.length > 20000) throw new FinishedGoodsError('历史记录较多，请按日期范围查询');
    const batchRows = await tx.fgDispatchBatch.findMany({ where: { businessDate: { in: [...new Set([date, workDate])] } }, include: { shipments: { include: { lines: true } } }, orderBy: { sequence: 'asc' } });
    const cutover = await tx.fgCutover.findUnique({ where: { id: 'finished-goods-v2' } });
    const closedCount = await tx.fgLot.count({ where: { legacyClosedAt: { not: null }, legacyQuantity: { gt: 0 } } });
    const legacyLots = view === 'legacy' ? await tx.fgLot.findMany({ where: { legacyClosedAt: { not: null }, legacyQuantity: { gt: 0 } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }) : [];
    const receipts = view === 'receipts' ? await tx.fgLedger.findMany({ where: { kind: { in: ['RECEIVE','OPENING','RETURN','REWORK_RETURN'] }, ...(allHistory ? {} : { createdAt: { gte: start, lt: end } }) }, include: { lot: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20001 }) : [];
    if (receipts.length > 20000) throw new FinishedGoodsError('入库记录较多，请按日期范围查询');
    const workOrderIds = [...new Set(lots.filter(l => ['PRODUCTION','ALLOCATION'].includes(l.sourceKind)).map(l => l.workOrderId).filter((id): id is string => Boolean(id)))];
    const [workOrders, supplements] = await Promise.all([
      tx.workOrder.findMany({ where: { id: { in: workOrderIds }, deletedAt: null }, select: { id: true } }),
      tx.processSupplementObligation.findMany({ where: { workOrderId: { in: workOrderIds }, status: 'ACTIVE' }, select: { workOrderId: true }, distinct: ['workOrderId'] }),
    ]);
    const validOrders = new Set(workOrders.map(w => w.id));
    const supplementIds = new Set(supplements.map(s => s.workOrderId));
    const block = (lot: FgLot): string => !['PRODUCTION','ALLOCATION'].includes(lot.sourceKind) || (lot.sourceKind === 'ALLOCATION' && !lot.workOrderId) ? '' : !lot.workOrderId || !validOrders.has(lot.workOrderId) ? '生产来源已移除' : supplementIds.has(lot.workOrderId) ? '补充工序未完成' : '';
    const base = (lot: FgLot): FgRow => ({
      ...fgStock(lot), id: lot.id, lotId: lot.id, workOrderId: lot.workOrderId, workOrderCode: lot.workOrderCode, productKey: lot.productKey,
      productName: lot.productName, specification: lot.specification, unit: lot.unit, customerName: lot.customerName, ownerType: lot.ownerType,
      sourceKind: lot.sourceKind, sourceQuantity: lot.sourceQuantity, location: lot.location, note: lot.note, openingReview: lot.openingReview,
      legacyClosedAt: lot.legacyClosedAt?.toISOString() || null, legacyQuantity: lot.legacyQuantity,
      version: lot.version, createdAt: lot.createdAt.toISOString(), receivedAt: lot.receivedAt?.toISOString() || null, status: '', blockedReason: block(lot),
      quantity: lot.available || lot.pending, returned: 0, carrier: '', waybills: [], method: 'COURIER', recipient: '', phone: '', address: '',
      boxes: 1, handoverName: '', batchId: '', batchNumber: '', shippedAt: null, holdDueDate: null, holdReason: '', otherDrafts: 0, shipmentLineCount: 1, shipmentNote: '', externalReference: '',
    });
    const shipmentFields = (shipment: FgShipment & { batch?: { number: string } | null }) => ({ shipmentId: shipment.id, shipmentNumber: shipment.number, shipmentVersion: shipment.version, shipmentNote: shipment.note, externalReference: shipment.externalReference, carrier: shipment.carrier, waybills: fgWaybills(shipment.waybills), method: shipment.method, recipient: shipment.recipient, phone: shipment.phone, address: shipment.address, boxes: shipment.boxes, handoverName: shipment.handoverName, batchId: shipment.batchId || '', batchNumber: shipment.batch?.number || '', shippedAt: shipment.shippedAt?.toISOString() || null });
    const stockRows: FgRow[] = lots.map(lot => {
      const active = lot.lines[0]; const hold = lot.holds.filter(h => h.quantity > h.released).sort((a, b) => (a.dueDate || 'z').localeCompare(b.dueDate || 'z'))[0];
      const row = base(lot);
      if (active) Object.assign(row, shipmentFields(active.shipment), { quantity: active.quantity, lineId: active.id, otherDrafts: lot.lines.length - 1, shipmentLineCount: active.shipment._count.lines });
      row.status = active?.shipment.status === 'RESERVED' ? 'reserved' : lot.openingReview ? 'opening' : row.blockedReason ? 'restricted' : lot.available > 0 ? 'ready' : lot.pending > 0 ? 'pending' : lot.held > 0 ? 'held' : lot.blocked > 0 ? 'blocked' : 'reserved';
      row.holdDueDate = hold?.dueDate || null; row.holdReason = hold?.reason || '';
      return row;
    });
    const shippedRows: FgRow[] = shipped.flatMap(shipment => shipment.lines.map(line => ({ ...base(line.lot), ...shipmentFields(shipment), id: line.id, lineId: line.id, quantity: line.quantity, returned: line.returned, status: 'shipped', blockedReason: '', shipmentLineCount: shipment.lines.length })));
    const legacyRows: FgRow[] = legacyLots.map(lot => ({ ...base(lot), quantity: lot.legacyQuantity, status: 'legacy', blockedReason: '' }));
    const receiptRows: FgRow[] = receipts.map(entry => ({ ...base(entry.lot), id: entry.id, quantity: Math.abs(entry.quantity), receivedAt: entry.createdAt.toISOString(), status: 'received', note: entry.reason, blockedReason: '' }));
    const commonFilter = (row: FgRow): boolean => (!q || [row.workOrderCode, fgShortWorkOrder(row.workOrderCode), row.productName, row.specification, row.customerName, row.location, row.shipmentNumber, row.waybills.join(' ')].join(' ').toLocaleLowerCase().includes(q)) && (!input.batchId || row.batchId === input.batchId);
    let sourceRows = view === 'legacy' ? legacyRows : view === 'receipts' ? receiptRows : view === 'history' ? shippedRows : view === 'stock' || view === 'holds' ? stockRows : [...stockRows.filter(r => r.status !== 'opening' && r.status !== 'held'), ...shippedRows];
    if (view === 'holds') sourceRows = sourceRows.filter(r => r.held > 0);
    if (view === 'stock' && input.date && input.scope === 'range') sourceRows = sourceRows.filter(r => r.receivedAt && new Date(r.receivedAt) >= start && new Date(r.receivedAt) < end);
    const matching = sourceRows.filter(commonFilter);
    const counts: Record<string, number> = { all: matching.length, processing: 0, pending: 0, ready: 0, shipped: 0, held: 0, opening: 0, missing: 0, blocked: 0, reserved: 0, legacy: closedCount, received: receiptRows.length };
    for (const row of matching) {
      if (row.status === 'shipped') { counts.shipped++; if (row.method === 'COURIER' && !row.waybills.length) counts.missing++; }
      else {
        if (['ready','pending','reserved'].includes(row.status)) counts.processing++;
        if (row.pending > 0 && !row.openingReview) counts.pending++;
        if (row.available > 0 && !row.blockedReason && !row.openingReview) counts.ready++;
        if (row.held > 0) counts.held++;
        if (row.openingReview) counts.opening++;
        if (row.blocked > 0 || row.blockedReason) counts.blocked++;
        if (row.reserved > 0) counts.reserved++;
      }
    }
    let rows = matching;
    if (filter !== 'all') rows = rows.filter(row => filter === 'processing' ? ['ready','pending','reserved'].includes(row.status) : filter === 'missing' ? row.status === 'shipped' && row.method === 'COURIER' && !row.waybills.length : filter === 'pending' ? row.status !== 'shipped' && row.pending > 0 && !row.openingReview : filter === 'ready' ? row.status !== 'shipped' && row.available > 0 && !row.blockedReason && !row.openingReview : filter === 'held' ? row.status !== 'shipped' && row.held > 0 : filter === 'blocked' ? row.status !== 'shipped' && (row.blocked > 0 || Boolean(row.blockedReason)) : row.status === filter);
    if (view === 'batches') rows.sort((a, b) => a.batchNumber.localeCompare(b.batchNumber) || a.workOrderCode.localeCompare(b.workOrderCode));
    else if (view === 'queue') { const rank: Record<string,number> = { pending:0,ready:1,reserved:1,shipped:2,blocked:4,restricted:4 }; rows.sort((a,b) => (rank[a.status] ?? 5)-(rank[b.status] ?? 5)); }
    const total = rows.length; const page = Math.max(1, Math.min(Math.ceil(total / pageSize) || 1, Math.trunc(input.page || 1)));
    const batchDTO = (b: typeof batchRows[number]) => {
      const actual = b.shipments.filter(s => s.status === 'SHIPPED');
      return { id: b.id, number: b.number, businessDate: b.businessDate, sequence: b.sequence, name: b.name, carrier: b.carrier, note: b.note, closedAt: b.closedAt?.toISOString() || null, shipped: actual.length, draft: b.shipments.filter(s => ['DRAFT','RESERVED'].includes(s.status)).length, quantity: actual.flatMap(s => s.lines).reduce((sum,l) => sum + l.quantity,0), waybillCount: new Set(actual.flatMap(s => fgWaybills(s.waybills))).size, missingWaybill: actual.filter(s => s.method === 'COURIER' && !fgWaybills(s.waybills).length).length };
    };
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, date, counts,
      stats: { pending: lots.reduce((s, l) => s + l.pending, 0), physical: lots.reduce((s, l) => s + physicalStock(l), 0),
        available: lots.reduce((s, l) => s + l.available, 0), reserved: lots.reduce((s, l) => s + l.reserved, 0), held: lots.reduce((s, l) => s + l.held, 0), blocked: lots.reduce((s, l) => s + l.blocked, 0),
        shipped: shippedRows.reduce((s, r) => s + r.quantity, 0), shipmentCount: shipped.length, batchCount: new Set(shipped.map(s => s.batchId).filter(Boolean)).size,
        missingWaybill: shipped.filter(s => s.method === 'COURIER' && !fgWaybills(s.waybills).length).length,
        holdDue: lots.flatMap(l => l.holds).filter(h => h.quantity > h.released && h.dueDate && h.dueDate <= date).length },
      cutover: cutover ? { startedAt: cutover.startedAt.toISOString(), closedCount } : null,
      workDate,
      batches: batchRows.filter(b => b.businessDate === date).map(batchDTO),
      dispatchBatches: batchRows.filter(b => b.businessDate === workDate).map(batchDTO),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function finishedGoodsDetail(lotId: string, shipmentId?: string) {
  const lot = await prisma.fgLot.findUnique({ where: { id: lotId }, include: { holds: { orderBy: { createdAt: 'desc' } }, reworks: { orderBy: { createdAt: 'desc' } }, ledger: { orderBy: { createdAt: 'desc' }, take: 100 }, lines: { include: { shipment: { include: { batch: true, attachments: { where: { deletedAt: null } } } }, returns: true }, orderBy: { shipment: { createdAt: 'desc' } } } } });
  if (!lot) throw new FinishedGoodsError('成品记录不存在', 'FG_NOT_FOUND', 404);
  const shipment = shipmentId ? await prisma.fgShipment.findUnique({ where: { id: shipmentId }, include: { ...shipmentInclude, attachments: { where: { deletedAt: null } } } }) : null;
  return { lot, shipment };
}
