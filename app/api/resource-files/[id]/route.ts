import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clean(v: unknown, max = 200) {
  if (typeof v !== 'string') return null;
  const next = v.trim();
  return next ? next.slice(0, max) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.resourceFile.findFirst({
      where: { id: params.id, deletedAt: null, status: 'uploaded' },
      include: {
        workOrder: { select: { code: true, productName: true } },
        category: { select: { name: true, code: true } },
      },
    });
    if (!old) return NextResponse.json({ ok: false, error: '文件不存在' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const data: { displayName?: string | null; remark?: string | null; workOrderId?: string; categoryId?: string } = {};
    if (body.displayName !== undefined) data.displayName = clean(body.displayName, 160);
    if (body.remark !== undefined) data.remark = clean(body.remark, 500);
    if (typeof body.workOrderId === 'string' && body.workOrderId.trim() && body.workOrderId !== old.workOrderId) {
      const targetOrder = await prisma.workOrder.findFirst({ where: { id: body.workOrderId, deletedAt: null } });
      if (!targetOrder) return NextResponse.json({ ok: false, error: '目标工单不存在' }, { status: 404 });
      data.workOrderId = targetOrder.id;
    }
    if (typeof body.categoryId === 'string' && body.categoryId.trim() && body.categoryId !== old.categoryId) {
      const targetCategory = await prisma.resourceCategory.findUnique({ where: { id: body.categoryId } });
      if (!targetCategory) return NextResponse.json({ ok: false, error: '目标分类不存在' }, { status: 404 });
      data.categoryId = targetCategory.id;
    }
    if (!Object.keys(data).length) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });

    const file = await prisma.resourceFile.update({
      where: { id: old.id },
      data,
      include: {
        workOrder: { select: { code: true, productName: true } },
        category: { select: { name: true, code: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
    });

    const moved = old.workOrderId !== file.workOrderId || old.categoryId !== file.categoryId;
    if (moved) {
      await logOp({
        userId: user.id,
        action: 'move_resource_file',
        targetType: 'resource_file',
        targetId: file.id,
        detail: {
          fromWorkOrder: old.workOrder.code,
          toWorkOrder: file.workOrder.code,
          fromCategory: old.category.name,
          toCategory: file.category.name,
        },
      });
    }
    if (body.displayName !== undefined || body.remark !== undefined) {
      await logOp({
        userId: user.id,
        action: 'update_resource_file',
        targetType: 'resource_file',
        targetId: file.id,
        detail: { displayName: file.displayName, hasRemark: !!file.remark },
      });
    }

    return NextResponse.json({
      ok: true,
      file: serializeResourceFile(file),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '文件信息保存失败' }, { status: 500 });
  }
}
