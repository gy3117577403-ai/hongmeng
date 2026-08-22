import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadSopWorkspaceByItemId } from '@/lib/sop/server';
import { createSopOperationLog, getOrCreateSopDocument, lockSopScope } from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';
import { SOP_WRITE_ACCESS, SopRequestError } from '@/lib/sop';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return sopRouteError(error, '加载 SOP 工作区失败');
  }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new SopRequestError(`${label}无效`);
  }
  return value as T;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const sopStage = enumValue(body.sopStage, ['standard', 'new_product', 'validating'] as const, 'SOP 状态');
    const drawingStatus = enumValue(body.drawingStatus, ['available', 'missing'] as const, '图纸状态');
    const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
    if (remark.length > 500) throw new SopRequestError('SOP 备注不能超过 500 个字符');

    await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const { document } = await getOrCreateSopDocument(tx, params.id, user.id);
      await tx.sopDocument.update({
        where: { id: document.id },
        data: { sopStage, drawingStatus, remark: remark || null, updatedById: user.id },
      });
      await tx.drawingLibraryItem.update({ where: { id: params.id }, data: { updatedAt: new Date() } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'update_sop_metadata',
        targetType: 'sop_document',
        targetId: document.id,
        detail: { itemId: params.id, sopStage, drawingStatus, remark } as unknown as Prisma.InputJsonValue,
      });
    });

    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return sopRouteError(error, '保存 SOP 状态与备注失败');
  }
}
