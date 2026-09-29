import { sameDrawingProduct, drawingCustomerIdentity } from './drawing-product-identity';

export type ImportDrawingArchive = {
  id: string;
  libraryKey: string;
  customerName: string;
  customerCode?: string | null;
  specification: string;
  productName: string | null;
  deletedAt?: string | null;
  drawingFileCount?: number;
  sopFileCount?: number;
  productUnitMilliseconds?: number | null;
  updatedAt?: string;
  files?: Array<{ id: string; name: string; mimeType: string; version: string; category: string }>;
};

/** Matching an archive never identifies an order or grants an approval. */
export function matchImportDrawing(row: { customerName: string; specification: string; libraryKey?: string }, items: ImportDrawingArchive[]) {
  const result = (matchStatus: 'REUSE' | 'CREATE' | 'CONFIRM' | 'BLOCKED', message: string, candidates: ImportDrawingArchive[], matchedItemId: string | null = null) =>
    ({ matchStatus, message, candidates, matchedItemId });
  if (row.libraryKey) {
    const item = items.find(item => item.id === row.libraryKey || item.libraryKey.toLowerCase() === row.libraryKey!.toLowerCase());
    if (!item) return result('BLOCKED', '图纸库编号不存在，请核对编号', []);
    if (item.deletedAt) return result('BLOCKED', '档案在回收站，请先恢复后重新预览', [item]);
    if (!sameDrawingProduct(item, row)) return result('BLOCKED', '指定图纸档案与客户或规格不一致', [item]);
    return result('REUSE', '已关联图纸资料库', [item], item.id);
  }
  const exact = items.filter(item => sameDrawingProduct(item, row));
  const active = exact.filter(item => !item.deletedAt);
  if (active.length === 1) return result('REUSE', '客户、规格一致', active, active[0].id);
  if (active.length > 1) return result('CONFIRM', '存在多个同规格资料档案，请选择', active);
  if (exact.length) return result('BLOCKED', '档案在回收站，请先恢复；不会重复建档', exact);
  return result('CREATE', '本次新建资料档案，图纸待上传', []);
}

export function sameImportCustomer(a: string, b: string) {
  const left = drawingCustomerIdentity(a), right = drawingCustomerIdentity(b);
  return !!left.name && left.name === right.name && (!left.code || !right.code || left.code === right.code);
}
