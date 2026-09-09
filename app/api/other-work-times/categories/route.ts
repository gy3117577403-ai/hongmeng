import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { OtherWorkError } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    if (user.laborRole !== 'ADMIN') throw new OtherWorkError('仅管理员可配置分类', 403);
    const data = await otherWorkJson(req);
    const name = String(data.name || '').trim();
    if (name.length < 2 || name.length > 40) throw new OtherWorkError('分类名称须为 2 至 40 字');
    const result = await prisma.$transaction(async tx => {
      let category;
      if (typeof data.id === 'string') {
        if (typeof data.isActive !== 'boolean' || !Number.isInteger(data.version)) throw new OtherWorkError('请提供有效的分类版本和启用状态');
        const changed = await tx.otherWorkTimeCategory.updateMany({ where: { id: data.id, version: Number(data.version) }, data: { name, isActive: data.isActive, version: { increment: 1 } } });
        if (changed.count !== 1) throw new OtherWorkError('分类已变化，请刷新', 409);
        category = await tx.otherWorkTimeCategory.findUniqueOrThrow({ where: { id: data.id } });
      } else category = await tx.otherWorkTimeCategory.create({ data: { code: crypto.randomUUID(), name } });
      await tx.operationLog.create({ data: { userId: user.id, action: 'configure_other_work_category', targetType: 'other_work_category', targetId: category.id, detail: { name, isActive: category.isActive } } });
      return category;
    });
    return NextResponse.json({ ok: true, category: result });
  } catch (error) { return otherWorkErrorResponse(error); }
}
