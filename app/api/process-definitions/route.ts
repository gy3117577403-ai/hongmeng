import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cleanProductTimeText } from '@/lib/product-time';
import type { ProcessStageGroup } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stageGroup(value: unknown): ProcessStageGroup {
  return value === 'backend' || value === 'finish' ? value : 'frontend';
}

export async function GET() {
  try {
    await requireUser();
    const definitions = await prisma.processDefinition.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
    });
    return NextResponse.json({ ok: true, definitions });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process definitions list failed', error);
    return NextResponse.json({ ok: false, error: '工序库加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = cleanProductTimeText(body.name, 60);
    if (!name) return NextResponse.json({ ok: false, error: '请填写工序名称' }, { status: 400 });
    const duplicate = await prisma.processDefinition.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ ok: false, error: '同名工序已经存在' }, { status: 409 });
    const sortOrder = Number(body.sortOrder);
    const definition = await prisma.$transaction(async tx => {
      const created = await tx.processDefinition.create({
        data: {
          code: `process-${randomUUID()}`,
          name,
          stageGroup: stageGroup(body.stageGroup),
          sortOrder: Number.isInteger(sortOrder) ? sortOrder : 1000,
          isActive: true,
        },
        select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_process_definition',
          targetType: 'process_definition',
          targetId: created.id,
          detail: { processCode: created.code, processName: created.name },
        },
      });
      return created;
    });
    return NextResponse.json({ ok: true, definition }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('create process definition failed', error);
    return NextResponse.json({ ok: false, error: '新增工序失败' }, { status: 500 });
  }
}
