import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { deleteObjectsBestEffort, getObjectStream, putObject } from './s3';
import { FinishedGoodsError, fgRequired, fgText, physicalStock, type FgActor } from './finished-goods-domain';
import { chinaDateKey } from './china-date';
import { normalizeShippingReport, recommendShippingTemplate, type ShippingDrawing, type ShippingReportContext, type ShippingReportRecord, type ShippingReportSnapshot, type ShippingReportSource, type ShippingTemplate } from './shipping-report-domain';
import { generateShippingReportPdf } from './shipping-report-pdf';

type DB = Prisma.TransactionClient;
type DrawingFile = ShippingDrawing & { objectKey: string };
const RECEIPTS = ['RECEIVE', 'OPENING', 'RETURN', 'REWORK_RETURN'];
const MAX_DRAWING = 30 * 1024 * 1024;
const sourceInput = (input: Record<string, unknown>): ShippingReportSource => ({ lotId: fgRequired(input.lotId, '入库产品', 100), ...(input.shipmentId ? { shipmentId: fgText(input.shipmentId, 100) } : {}), ...(input.receiptId ? { receiptId: fgText(input.receiptId, 100) } : {}) });
const recordDTO = (r: { id: string; number: string; template: string; quantity: number; unit: string; createdAt: Date; actorName: string; snapshot: unknown }): ShippingReportRecord => ({ id: r.id, number: r.number, template: r.template as ShippingTemplate, quantity: r.quantity, unit: r.unit, createdAt: r.createdAt.toISOString(), actorName: r.actorName, snapshot: r.snapshot as ShippingReportSnapshot });

async function loadContext(input: Record<string, unknown>, db: DB = prisma) {
  const source = sourceInput(input);
  if (source.shipmentId && source.receiptId) throw new FinishedGoodsError('请选择一个报告数量来源');
  const lot = await db.fgLot.findUnique({ where: { id: source.lotId } });
  if (!lot) throw new FinishedGoodsError('入库产品不存在', 'REPORT_NOT_FOUND', 404);
  const [workOrder, sample, receipts, shipment, receipt, reports] = await Promise.all([
    lot.workOrderId ? db.workOrder.findUnique({ where: { id: lot.workOrderId }, select: { drawingLibraryItemId: true, sourceOrderNo: true } }) : null,
    lot.sampleTaskId ? db.sampleTask.findUnique({ where: { id: lot.sampleTaskId }, select: { drawingLibraryItemId: true, sourceOrderNo: true } }) : null,
    db.fgLedger.findMany({ where: { lotId: lot.id, kind: { in: [...RECEIPTS, 'UNRECEIVE'] } }, select: { kind: true, quantity: true } }),
    source.shipmentId ? db.fgShipment.findUnique({ where: { id: source.shipmentId }, include: { lines: { where: { lotId: lot.id } } } }) : null,
    source.receiptId ? db.fgLedger.findUnique({ where: { id: source.receiptId } }) : null,
    db.fgShippingReport.findMany({ where: { lotId: lot.id, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
  ]);
  if (source.shipmentId && (!shipment || !shipment.lines.length || shipment.status === 'CANCELLED')) throw new FinishedGoodsError('出货记录不存在、已取消或不属于当前产品', 'REPORT_SOURCE_CHANGED', 409);
  if (source.receiptId && (!receipt || receipt.lotId !== lot.id || !RECEIPTS.includes(receipt.kind))) throw new FinishedGoodsError('这条入库记录不属于当前产品', 'REPORT_SOURCE_CHANGED', 409);
  const received = receipts.reduce((n, e) => n + (e.kind === 'UNRECEIVE' ? -1 : 1) * Math.abs(e.quantity), 0) + (lot.sourceKind === 'ALLOCATION' ? lot.sourceQuantity : 0);
  const quantity = shipment ? shipment.lines[0].quantity : receipt ? Math.abs(receipt.quantity) : physicalStock(lot) > 0 ? Math.min(received, physicalStock(lot)) : received;
  const ineligibleReason = !lot.receivedAt || received <= 0 ? '仓库确认实收后即可生成出货报告。' : lot.legacyClosedAt ? '这条历史记录没有实际入库依据，不能自动生成报告。' : '';
  const libraryItemId = workOrder?.drawingLibraryItemId || sample?.drawingLibraryItemId;
  const [libraryFiles, resourceFiles] = await Promise.all([
    libraryItemId ? db.drawingLibraryFile.findMany({ where: { libraryItemId, deletedAt: null, retiredForReplacementAt: null, isCurrent: true, category: { code: 'drawing' }, libraryItem: { deletedAt: null } }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    lot.workOrderId ? db.resourceFile.findMany({ where: { workOrderId: lot.workOrderId, deletedAt: null, category: { code: 'drawing' } }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
  ]);
  const files: DrawingFile[] = libraryFiles.map(f => ({ id: `library:${f.id}`, name: f.displayName || f.originalName, version: f.version, mimeType: f.mimeType, size: f.size, updatedAt: f.updatedAt.toISOString(), objectKey: f.objectKey }));
  // A linked library is authoritative; do not resurrect resource copies retired by a replacement.
  if (!libraryItemId) for (const f of resourceFiles) files.push({ id: `resource:${f.id}`, name: f.displayName || f.originalName, version: f.version, mimeType: f.mimeType, size: f.fileSize, updatedAt: f.updatedAt.toISOString(), objectKey: f.objectKey });
  const usable = files.filter(f => ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.mimeType));
  const customerName = shipment?.customerName || lot.customerName;
  const context: ShippingReportContext = {
    source, version: lot.version, shipmentVersion: shipment?.version ?? null,
    productName: lot.productName, specification: lot.specification, customerName, unit: lot.unit, workOrderCode: lot.workOrderCode,
    quantity, maxQuantity: shipment ? shipment.lines[0].quantity : receipt ? Math.min(received, Math.abs(receipt.quantity)) : received,
    quantityLocked: Boolean(shipment), sourceLabel: shipment ? `${shipment.number} · ${shipment.status === 'SHIPPED' ? '本次出货' : '待发明细'}` : receipt ? '本次实收入库' : '本次报告数量',
    sourceOrderNo: workOrder?.sourceOrderNo || sample?.sourceOrderNo || '', eligible: !ineligibleReason, ineligibleReason,
    recommendedTemplate: recommendShippingTemplate(customerName), drawings: usable.map(({ objectKey: _, ...f }) => f), reports: reports.map(recordDTO),
  };
  return { context, files: usable };
}

export async function shippingReportContext(input: Record<string, unknown>) { return (await loadContext(input)).context; }

async function readDrawing(file: DrawingFile) {
  if (file.size > MAX_DRAWING) throw new FinishedGoodsError('原图超过 30 MB，请选择较小图页文件，或本次不附原图。', 'REPORT_DRAWING_SIZE', 413);
  try {
    const stream = await getObjectStream(file.objectKey, { abortSignal: AbortSignal.timeout(30000) });
    const chunks: Buffer[] = []; let total = 0;
    for await (const part of stream) { const bytes = Buffer.from(part); total += bytes.length; if (total > MAX_DRAWING) { stream.destroy(); throw new Error('oversized'); } chunks.push(bytes); }
    return { body: Buffer.concat(chunks), mimeType: file.mimeType };
  } catch { throw new FinishedGoodsError('原图加载失败，请重试，或选择“不附原图”后继续。', 'REPORT_DRAWING_LOAD', 422); }
}

export async function previewShippingReport(input: Record<string, unknown>, number?: string) {
  const { context, files } = await loadContext(input);
  const snapshot = normalizeShippingReport(input, context);
  const file = snapshot.drawing ? files.find(f => f.id === snapshot.drawing!.id) : null;
  const result = await generateShippingReportPdf(snapshot, file ? await readDrawing(file) : undefined, number);
  return { ...result, snapshot };
}

export async function saveShippingReport(input: Record<string, unknown>, actor: FgActor, key: string | null, storage: { put: typeof putObject; cleanup: (keys: string[]) => Promise<unknown> } = { put: putObject, cleanup: deleteObjectsBestEffort }) {
  const requestKey = `${actor.id}:${fgRequired(key, '请求标识', 100)}`;
  const requestHash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  const existing = await prisma.fgShippingReport.findUnique({ where: { requestKey } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new FinishedGoodsError('请求标识已用于另一份内容，请重新保存', 'REPORT_KEY_CONFLICT', 409);
    return recordDTO(existing);
  }
  const id = randomUUID(), number = `CHBG-${chinaDateKey(new Date()).replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
  const { bytes, snapshot, drawingPages } = await previewShippingReport(input, number);
  if (snapshot.drawing) snapshot.drawing.pageCount = drawingPages;
  const objectKey = `finished-goods/reports/${snapshot.source.lotId}/${id}.pdf`;
  try {
    await storage.put({ key: objectKey, body: bytes, contentType: 'application/pdf', originalName: `${number}.pdf` });
    const saved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
      const replay = await tx.fgShippingReport.findUnique({ where: { requestKey } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new FinishedGoodsError('请求标识冲突', 'REPORT_KEY_CONFLICT', 409);
        return replay;
      }
      await tx.$queryRaw`SELECT "id" FROM "fg_lots" WHERE "id"=${snapshot.source.lotId} FOR UPDATE`;
      if (snapshot.source.shipmentId) await tx.$queryRaw`SELECT "id" FROM "fg_shipments" WHERE "id"=${snapshot.source.shipmentId} FOR UPDATE`;
      const { context } = await loadContext(input, tx);
      normalizeShippingReport(input, context);
      if (context.customerName && context.customerName !== snapshot.customerName || context.specification !== snapshot.specification || context.productName !== snapshot.productName) throw new FinishedGoodsError('产品资料已更新，请重新预览。', 'REPORT_SOURCE_CHANGED', 409);
      return tx.fgShippingReport.create({ data: {
        id, number, lotId: snapshot.source.lotId, shipmentId: snapshot.source.shipmentId, receiptId: snapshot.source.receiptId,
        template: snapshot.template, templateVersion: snapshot.templateVersion, snapshot: snapshot as unknown as Prisma.InputJsonValue,
        quantity: snapshot.quantity, unit: snapshot.unit, objectKey, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        actorId: actor.id, actorName: actor.displayName || actor.username, requestKey, requestHash,
      } });
    }, { timeout: 15000 });
    if (saved.objectKey !== objectKey) await storage.cleanup([objectKey]);
    return recordDTO(saved);
  } catch (error) { await storage.cleanup([objectKey]); throw error; }
}

export async function shippingReportFile(id: string) {
  const report = await prisma.fgShippingReport.findFirst({ where: { id: fgRequired(id, '报告', 100), deletedAt: null } });
  if (!report) throw new FinishedGoodsError('报告不存在或已作废', 'REPORT_NOT_FOUND', 404);
  return report;
}
