import { FinishedGoodsError, fgDate, fgQty, fgRequired, fgText } from './finished-goods-domain';

export const SHIPPING_REPORT_TEMPLATE_VERSION = '2026-09-27.1';
export const SHIPPING_REPORT_TEMPLATES = [
  { id: 'general', name: '常规', title: '出荷检查报告', company: '杭州杭连电子有限公司', hasDrawing: true },
  { id: 'yiwei', name: '益威', title: '出荷检查报告', company: '杭州杭连电子有限公司', hasDrawing: true },
  { id: 'xinxinghui', name: '欣兴汇', title: '出厂检验记录单', company: '杭州迈斯嘉电子科技有限公司', hasDrawing: false },
] as const;
export type ShippingTemplate = typeof SHIPPING_REPORT_TEMPLATES[number]['id'];
export type ShippingReportSource = { lotId: string; shipmentId?: string; receiptId?: string };
export type ShippingDrawing = { id: string; name: string; version: string; mimeType: string; size: number; updatedAt: string };
export type ShippingReportFields = {
  template: ShippingTemplate | ''; customerName: string; orderNo: string; quantity: string;
  lotNo: string; reportDate: string; drawingId: string; drawingPage: number;
};
export type ShippingReportSnapshot = {
  template: ShippingTemplate; templateVersion: string; recommendedTemplate: ShippingTemplate | null;
  customerName: string; productName: string; specification: string; orderNo: string;
  quantity: number; unit: string; lotNo: string; reportDate: string; workOrderCode: string;
  source: ShippingReportSource; sourceVersion: number; shipmentVersion: number | null;
  drawing: (ShippingDrawing & { page: number; pageCount?: number }) | null;
};
export type ShippingReportRecord = { id: string; number: string; template: ShippingTemplate; quantity: number; unit: string; createdAt: string; actorName: string; snapshot: ShippingReportSnapshot };
export type ShippingReportContext = {
  source: ShippingReportSource; version: number; shipmentVersion: number | null;
  productName: string; specification: string; customerName: string; unit: string; workOrderCode: string;
  quantity: number; maxQuantity: number; quantityLocked: boolean; sourceLabel: string;
  sourceOrderNo: string; eligible: boolean; ineligibleReason: string;
  recommendedTemplate: ShippingTemplate | null; drawings: ShippingDrawing[]; reports: ShippingReportRecord[];
};

export function recommendShippingTemplate(customerName: string): ShippingTemplate | null {
  const name = customerName.trim();
  if (!name) return null;
  const yiwei = name.includes('益威'), xinxinghui = name.includes('欣兴汇');
  if (yiwei && xinxinghui) return null;
  return yiwei ? 'yiwei' : xinxinghui ? 'xinxinghui' : 'general';
}

export function normalizeShippingReport(input: Record<string, unknown>, context: ShippingReportContext): ShippingReportSnapshot {
  if (!context.eligible) throw new FinishedGoodsError(context.ineligibleReason, 'REPORT_NOT_RECEIVED', 409);
  if (Number(input.version) !== context.version || (context.shipmentVersion !== null && Number(input.shipmentVersion) !== context.shipmentVersion)) {
    throw new FinishedGoodsError('这条入库或出货记录已更新，请重新打开报告。', 'REPORT_SOURCE_CHANGED', 409);
  }
  const template = SHIPPING_REPORT_TEMPLATES.find(t => t.id === input.template);
  if (!template) throw new FinishedGoodsError('请选择本次使用的报告模板');
  const customerName = context.customerName || fgRequired(input.customerName, '本次报告客户', 200);
  const quantity = fgQty(input.quantity);
  if (quantity > context.maxQuantity) throw new FinishedGoodsError(`报告数量不能超过对应实收数量 ${context.maxQuantity} ${context.unit}`);
  if (context.quantityLocked && quantity !== context.quantity) throw new FinishedGoodsError('报告数量须与本次出货明细一致');
  const drawingId = template.hasDrawing ? fgText(input.drawingId, 100) : '';
  const drawing = drawingId ? context.drawings.find(d => d.id === drawingId) : null;
  if (drawingId && !drawing) throw new FinishedGoodsError('原图已被更换或不属于当前产品，请重新选择。', 'REPORT_DRAWING_CHANGED', 409);
  const page = drawing ? fgQty(input.drawingPage || 1) : 1;
  if (drawing && fgText(input.drawingUpdatedAt, 40) !== drawing.updatedAt) throw new FinishedGoodsError('原图版本已更新，请重新打开报告。', 'REPORT_DRAWING_CHANGED', 409);
  return {
    template: template.id, templateVersion: SHIPPING_REPORT_TEMPLATE_VERSION,
    recommendedTemplate: recommendShippingTemplate(customerName), customerName,
    productName: context.productName, specification: context.specification,
    orderNo: fgText(input.orderNo, 160), quantity, unit: context.unit,
    lotNo: fgText(input.lotNo, 120), reportDate: fgDate(input.reportDate), workOrderCode: context.workOrderCode,
    source: context.source, sourceVersion: context.version, shipmentVersion: context.shipmentVersion,
    drawing: drawing ? { ...drawing, page } : null,
  };
}
