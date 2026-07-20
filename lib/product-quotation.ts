import { Prisma } from '@prisma/client';
import type { ProductQuotationTimeDTO } from '@/types';
import { cleanProductTimeText } from '@/lib/product-time';

export const productQuotationTimeInclude = Prisma.validator<Prisma.ProductQuotationTimeInclude>()({
  createdBy: { select: { id: true, username: true, displayName: true } },
});

export type ProductQuotationTimeRecord = Prisma.ProductQuotationTimeGetPayload<{
  include: typeof productQuotationTimeInclude;
}>;

export type ProductQuotationTimeInput = {
  unitMilliseconds: number;
  sourceType: 'manual' | 'import' | 'quotation';
  sourceRefId: string | null;
  remark: string | null;
};

export type ProductQuotationValidationResult =
  | { ok: true; value: ProductQuotationTimeInput }
  | { ok: false; error: string };

function quotationSourceType(value: unknown): ProductQuotationTimeInput['sourceType'] | null {
  if (value === undefined || value === null || value === '') return 'manual';
  if (value === 'manual' || value === 'import' || value === 'quotation') return value;
  return null;
}

export function validateProductQuotationTime(value: Record<string, unknown>): ProductQuotationValidationResult {
  const rawSeconds = value.unitSeconds;
  const rawMilliseconds = value.unitMilliseconds;
  const milliseconds = rawSeconds !== undefined && rawSeconds !== null && String(rawSeconds).trim() !== ''
    ? Number(rawSeconds) * 1000
    : Number(rawMilliseconds);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 86_400_000) {
    return { ok: false, error: '报价工时必须大于 0 秒且不超过 24 小时' };
  }
  const sourceType = quotationSourceType(value.sourceType);
  if (!sourceType) return { ok: false, error: '报价工时来源不正确' };
  return {
    ok: true,
    value: {
      unitMilliseconds: Math.round(milliseconds),
      sourceType,
      sourceRefId: cleanProductTimeText(value.sourceRefId, 100) || null,
      remark: cleanProductTimeText(value.remark, 500) || null,
    },
  };
}

export function serializeProductQuotationTime(record: ProductQuotationTimeRecord): ProductQuotationTimeDTO {
  return {
    id: record.id,
    drawingLibraryItemId: record.drawingLibraryItemId,
    version: record.version,
    status: record.status === 'archived' ? 'archived' : 'active',
    unitMilliseconds: record.unitMilliseconds,
    sourceType: record.sourceType === 'import' || record.sourceType === 'quotation' ? record.sourceType : 'manual',
    sourceRefId: record.sourceRefId,
    remark: record.remark,
    effectiveAt: record.effectiveAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy,
  };
}

export function sameProductQuotationTime(
  current: Pick<ProductQuotationTimeRecord, 'unitMilliseconds' | 'sourceType' | 'sourceRefId' | 'remark'>,
  next: ProductQuotationTimeInput,
): boolean {
  return current.unitMilliseconds === next.unitMilliseconds
    && current.sourceType === next.sourceType
    && current.sourceRefId === next.sourceRefId
    && current.remark === next.remark;
}
