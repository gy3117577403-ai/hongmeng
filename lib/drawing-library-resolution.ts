import { Prisma } from '@prisma/client';
import { drawingProductIdentity, normalizeProductText, sameDrawingProduct } from './drawing-product-identity';

export class DrawingLibraryResolutionError extends Error {
  constructor(message: string, public code = 'DRAWING_LIBRARY_CONFLICT', public itemIds: string[] = []) {
    super(message);
  }
}

export async function lockDrawingProduct(tx: Prisma.TransactionClient, input: { customerName: string; specification: string }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drawing-product:${drawingProductIdentity(input.customerName, input.specification)}`}))`;
}

export async function findDrawingProductCandidates(
  tx: Pick<Prisma.TransactionClient, '$queryRaw' | 'drawingLibraryItem'>,
  input: { customerName: string; specification: string },
) {
  const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM drawing_library_items
    WHERE lower(trim(regexp_replace(normalize(specification, NFKC), '[[:space:]]+', ' ', 'g'))) = ${normalizeProductText(input.specification)}
    ORDER BY id
  `);
  const items = ids.length ? await tx.drawingLibraryItem.findMany({ where: { id: { in: ids.map(item => item.id) } } }) : [];
  return items.filter(item => sameDrawingProduct(item, input));
}

export function requireActiveDrawing<T extends { id: string; deletedAt: Date | string | null }>(item: T): T {
  if (item.deletedAt) throw new DrawingLibraryResolutionError('匹配档案已在回收站，请管理员先恢复后重新预检；不会自动恢复或另建档案', 'DRAWING_LIBRARY_RESTORE_REQUIRED', [item.id]);
  return item;
}

export async function resolveOrCreateDrawingProduct(
  tx: Prisma.TransactionClient,
  input: { customerName: string; specification: string; productName?: string | null; remark?: string | null },
) {
  await lockDrawingProduct(tx, input);
  const candidates = await findDrawingProductCandidates(tx, input);
  const active = candidates.filter(item => !item.deletedAt);
  if (active.length > 1) throw new DrawingLibraryResolutionError('同客户同型号存在多个档案，请选择具体图纸库编号', undefined, active.map(item => item.id));
  if (active.length === 1) return active[0];
  if (candidates.length) return requireActiveDrawing(candidates[0]);
  const { drawingLibraryKey, parseCustomerCode } = await import('./drawing-library');
  return tx.drawingLibraryItem.create({ data: {
    customerName: input.customerName, specification: input.specification,
    productName: input.productName, remark: input.remark, customerCode: parseCustomerCode(input.customerName),
    libraryKey: drawingLibraryKey(input.customerName === '未设置' ? '' : input.customerName, input.specification),
  } });
}
