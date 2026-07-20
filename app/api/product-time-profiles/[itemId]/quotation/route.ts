import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  productQuotationTimeInclude,
  sameProductQuotationTime,
  serializeProductQuotationTime,
  validateProductQuotationTime,
} from '@/lib/product-quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const validation = validateProductQuotationTime(body);
    if (!validation.ok) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const expectedVersion = body.expectedVersion === null || body.expectedVersion === undefined
      ? null
      : Number(body.expectedVersion);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return NextResponse.json({ ok: false, error: '报价工时版本已失效，请刷新后重试' }, { status: 400 });
    }

    const quotationId = await prisma.$transaction(async tx => {
      const item = await tx.drawingLibraryItem.findFirst({
        where: { id: params.itemId, deletedAt: null },
        select: { id: true, specification: true },
      });
      if (!item) throw new Error('PRODUCT_NOT_FOUND');
      const current = await tx.productQuotationTime.findFirst({
        where: { drawingLibraryItemId: item.id, status: 'active' },
        orderBy: { version: 'desc' },
      });
      if (expectedVersion !== null && current?.version !== expectedVersion) {
        throw new Error('PRODUCT_QUOTATION_CONFLICT');
      }
      if (current && sameProductQuotationTime(current, validation.value)) return current.id;

      const latest = await tx.productQuotationTime.aggregate({
        where: { drawingLibraryItemId: item.id },
        _max: { version: true },
      });
      if (current) {
        await tx.productQuotationTime.update({ where: { id: current.id }, data: { status: 'archived' } });
      }
      const quotation = await tx.productQuotationTime.create({
        data: {
          drawingLibraryItemId: item.id,
          version: (latest._max.version || 0) + 1,
          status: 'active',
          unitMilliseconds: validation.value.unitMilliseconds,
          sourceType: validation.value.sourceType,
          sourceRefId: validation.value.sourceRefId,
          remark: validation.value.remark,
          effectiveAt: new Date(),
          createdById: user.id,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'update_product_quotation_time',
          targetType: 'drawing_library_item',
          targetId: item.id,
          detail: {
            quotationVersion: quotation.version,
            sourceType: quotation.sourceType,
          },
        },
      });
      return quotation.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const quotation = await prisma.productQuotationTime.findUnique({
      where: { id: quotationId },
      include: productQuotationTimeInclude,
    });
    return NextResponse.json({
      ok: true,
      quotation: quotation ? serializeProductQuotationTime(quotation) : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'PRODUCT_NOT_FOUND') {
        return NextResponse.json({ ok: false, error: '图纸资料产品不存在' }, { status: 404 });
      }
      if (error.message === 'PRODUCT_QUOTATION_CONFLICT') {
        return NextResponse.json({ ok: false, error: '报价工时已被其他人修改，请刷新后重试' }, { status: 409 });
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      return NextResponse.json({ ok: false, error: '报价工时保存冲突，请刷新后重试' }, { status: 409 });
    }
    console.error('save product quotation time failed', error);
    return NextResponse.json({ ok: false, error: '报价工时保存失败' }, { status: 500 });
  }
}
