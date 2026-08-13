import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sourceProfileId = String(body.sourceProfileId || '').trim();
    const expectedTargetRevision = body.expectedTargetRevision === null || body.expectedTargetRevision === undefined
      ? null
      : Number(body.expectedTargetRevision);
    if (!sourceProfileId) {
      return NextResponse.json({ ok: false, error: '请选择已发布的产品路线' }, { status: 400 });
    }
    if (expectedTargetRevision !== null && (!Number.isInteger(expectedTargetRevision) || expectedTargetRevision < 0)) {
      return NextResponse.json({ ok: false, error: '目标产品工时版本已失效，请刷新后重试' }, { status: 400 });
    }

    const result = await prisma.$transaction(async tx => {
      const [target, source] = await Promise.all([
        tx.drawingLibraryItem.findFirst({
          where: { id: params.itemId, deletedAt: null },
          select: { id: true, customerName: true, specification: true },
        }),
        tx.productTimeProfile.findFirst({
          where: {
            id: sourceProfileId,
            status: 'published',
            drawingLibraryItem: { deletedAt: null },
          },
          select: {
            id: true,
            drawingLibraryItemId: true,
            version: true,
            entries: { orderBy: { position: 'asc' } },
            drawingLibraryItem: {
              select: { customerName: true, specification: true, productName: true },
            },
          },
        }),
      ]);
      if (!target) throw new Error('PRODUCT_NOT_FOUND');
      if (!source || !source.entries.length) throw new Error('COPY_SOURCE_NOT_FOUND');
      if (source.drawingLibraryItemId === target.id) throw new Error('COPY_SOURCE_SAME_PRODUCT');

      let draft = await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: target.id, status: 'draft' },
        select: { id: true, revision: true, version: true },
      });
      if (draft) {
        if (expectedTargetRevision === null || draft.revision !== expectedTargetRevision) {
          throw new Error('PRODUCT_TIME_CONFLICT');
        }
        const updated = await tx.productTimeProfile.updateMany({
          where: { id: draft.id, revision: draft.revision, status: 'draft' },
          data: {
            revision: { increment: 1 },
            sourceType: 'copied',
            remark: `复制自 ${source.drawingLibraryItem.customerName} · ${source.drawingLibraryItem.specification} · V${source.version}`,
            updatedById: user.id,
          },
        });
        if (updated.count !== 1) throw new Error('PRODUCT_TIME_CONFLICT');
        await tx.productProcessTimeEntry.deleteMany({ where: { profileId: draft.id } });
      } else {
        if (expectedTargetRevision !== null) throw new Error('PRODUCT_TIME_CONFLICT');
        const latest = await tx.productTimeProfile.aggregate({
          where: { drawingLibraryItemId: target.id },
          _max: { version: true },
        });
        draft = await tx.productTimeProfile.create({
          data: {
            drawingLibraryItemId: target.id,
            version: (latest._max.version || 0) + 1,
            status: 'draft',
            sourceType: 'copied',
            remark: `复制自 ${source.drawingLibraryItem.customerName} · ${source.drawingLibraryItem.specification} · V${source.version}`,
            createdById: user.id,
            updatedById: user.id,
          },
          select: { id: true, revision: true, version: true },
        });
      }

      await tx.productProcessTimeEntry.createMany({
        data: source.entries.map(entry => ({
          profileId: draft!.id,
          processDefinitionId: entry.processDefinitionId,
          occurrenceKey: entry.occurrenceKey,
          position: entry.position,
          sequenceGroup: entry.sequenceGroup,
          timeBasis: entry.timeBasis,
          unitMilliseconds: entry.unitMilliseconds,
          actionMilliseconds: entry.actionMilliseconds,
          occurrences: entry.occurrences,
          setupMilliseconds: entry.setupMilliseconds,
          unitLabel: entry.unitLabel,
          reportQuantityBasis: entry.reportQuantityBasis,
          reportUnitLabel: entry.reportUnitLabel,
          countsForEfficiency: entry.countsForEfficiency,
          remark: entry.remark,
        })),
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'copy_product_time_profile',
          targetType: 'product_time_profile',
          targetId: draft.id,
          detail: {
            targetDrawingLibraryItemId: target.id,
            targetSpecification: target.specification,
            targetVersion: draft.version,
            sourceProfileId: source.id,
            sourceDrawingLibraryItemId: source.drawingLibraryItemId,
            sourceVersion: source.version,
            sourceCustomerName: source.drawingLibraryItem.customerName,
            sourceSpecification: source.drawingLibraryItem.specification,
            processCount: source.entries.length,
          },
        },
      });
      return {
        profileId: draft.id,
        source: {
          profileId: source.id,
          drawingLibraryItemId: source.drawingLibraryItemId,
          version: source.version,
          customerName: source.drawingLibraryItem.customerName,
          specification: source.drawingLibraryItem.specification,
          productName: source.drawingLibraryItem.productName,
          processCount: source.entries.length,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const profile = await prisma.productTimeProfile.findUnique({
      where: { id: result.profileId },
      include: productTimeProfileInclude,
    });
    if (!profile) throw new Error('COPIED_PROFILE_MISSING');
    return NextResponse.json({ ok: true, profile: serializeProductTimeProfile(profile), source: result.source });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '目标产品工时正在被其他人修改，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Error) {
      if (error.message === 'PRODUCT_NOT_FOUND') return NextResponse.json({ ok: false, error: '目标产品不存在' }, { status: 404 });
      if (error.message === 'COPY_SOURCE_NOT_FOUND') return NextResponse.json({ ok: false, error: '复制来源不存在、未发布或没有有效工序' }, { status: 404 });
      if (error.message === 'COPY_SOURCE_SAME_PRODUCT') return NextResponse.json({ ok: false, error: '不能从当前产品自身复制路线' }, { status: 400 });
      if (error.message === 'PRODUCT_TIME_CONFLICT') return NextResponse.json({ ok: false, error: '目标产品工时已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    console.error('copy product time profile failed', error);
    return NextResponse.json({ ok: false, error: '复制产品路线失败' }, { status: 500 });
  }
}
