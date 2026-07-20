import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  productQuotationTimeInclude,
  serializeProductQuotationTime,
} from '@/lib/product-quotation';
import {
  cleanProductTimeText,
  productTimeProfileInclude,
  serializeProductTimeProfile,
  validateProductTimeEntries,
} from '@/lib/product-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function profilePayload(itemId: string) {
  const item = await prisma.drawingLibraryItem.findFirst({
    where: { id: itemId, deletedAt: null },
    include: {
      productTimeProfiles: {
        orderBy: { version: 'desc' },
        include: productTimeProfileInclude,
      },
      quotationTimes: {
        where: { status: 'active' },
        orderBy: { version: 'desc' },
        take: 1,
        include: productQuotationTimeInclude,
      },
    },
  });
  if (!item) return null;
  return {
    item: {
      id: item.id,
      customerName: item.customerName,
      customerCode: item.customerCode,
      specification: item.specification,
      productName: item.productName,
    },
    profiles: item.productTimeProfiles.map(serializeProductTimeProfile),
    quotation: item.quotationTimes[0] ? serializeProductQuotationTime(item.quotationTimes[0]) : null,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    await requireUser();
    const payload = await profilePayload(params.itemId);
    if (!payload) return NextResponse.json({ ok: false, error: '图纸资料产品不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time profile detail failed', error);
    return NextResponse.json({ ok: false, error: '产品工时详情加载失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const validation = validateProductTimeEntries(body.entries);
    if (!validation.ok) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const expectedRevision = body.expectedRevision === null || body.expectedRevision === undefined
      ? null
      : Number(body.expectedRevision);
    if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      return NextResponse.json({ ok: false, error: '产品工时版本已失效，请刷新后重试' }, { status: 400 });
    }
    const definitionIds = validation.entries.map(entry => entry.processDefinitionId);
    const profileId = await prisma.$transaction(async tx => {
      const item = await tx.drawingLibraryItem.findFirst({
        where: { id: params.itemId, deletedAt: null },
        select: { id: true, specification: true },
      });
      if (!item) throw new Error('PRODUCT_NOT_FOUND');
      const definitions = definitionIds.length
        ? await tx.processDefinition.findMany({ where: { id: { in: definitionIds }, isActive: true }, select: { id: true } })
        : [];
      if (definitions.length !== definitionIds.length) throw new Error('PROCESS_DEFINITION_INVALID');

      let draft = await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: item.id, status: 'draft' },
        select: { id: true, revision: true, version: true },
      });
      if (draft) {
        if (expectedRevision !== null && draft.revision !== expectedRevision) throw new Error('PRODUCT_TIME_CONFLICT');
        const updated = await tx.productTimeProfile.updateMany({
          where: { id: draft.id, revision: draft.revision, status: 'draft' },
          data: {
            revision: { increment: 1 },
            sourceType: cleanProductTimeText(body.sourceType, 30) || 'manual',
            remark: cleanProductTimeText(body.remark, 500) || null,
            updatedById: user.id,
          },
        });
        if (updated.count !== 1) throw new Error('PRODUCT_TIME_CONFLICT');
        await tx.productProcessTimeEntry.deleteMany({ where: { profileId: draft.id } });
      } else {
        const latest = await tx.productTimeProfile.aggregate({
          where: { drawingLibraryItemId: item.id },
          _max: { version: true },
        });
        draft = await tx.productTimeProfile.create({
          data: {
            drawingLibraryItemId: item.id,
            version: (latest._max.version || 0) + 1,
            status: 'draft',
            sourceType: cleanProductTimeText(body.sourceType, 30) || 'manual',
            remark: cleanProductTimeText(body.remark, 500) || null,
            createdById: user.id,
            updatedById: user.id,
          },
          select: { id: true, revision: true, version: true },
        });
      }
      if (validation.entries.length) {
        await tx.productProcessTimeEntry.createMany({
          data: validation.entries.map(entry => ({ ...entry, profileId: draft!.id })),
        });
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'save_product_time_profile',
          targetType: 'product_time_profile',
          targetId: draft.id,
          detail: { drawingLibraryItemId: item.id, version: draft.version, processCount: validation.entries.length },
        },
      });
      return draft.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const profile = await prisma.productTimeProfile.findUnique({
      where: { id: profileId },
      include: productTimeProfileInclude,
    });
    return NextResponse.json({ ok: true, profile: profile ? serializeProductTimeProfile(profile) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'PRODUCT_NOT_FOUND') return NextResponse.json({ ok: false, error: '图纸资料产品不存在' }, { status: 404 });
      if (error.message === 'PROCESS_DEFINITION_INVALID') return NextResponse.json({ ok: false, error: '包含已停用或不存在的工序' }, { status: 400 });
      if (error.message === 'PRODUCT_TIME_CONFLICT') return NextResponse.json({ ok: false, error: '产品工时已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    console.error('save product time profile failed', error);
    return NextResponse.json({ ok: false, error: '产品工时保存失败' }, { status: 500 });
  }
}
