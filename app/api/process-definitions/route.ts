import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ProcessDefinitionResolutionError,
  resolveOrCreateProcessDefinition,
} from '@/lib/process-definition-resolver';
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
    const sortOrder = Number(body.sortOrder);
    const definition = await prisma.$transaction(async tx => {
      const { definition: created, action } = await resolveOrCreateProcessDefinition(tx, {
        name: body.name,
        stageGroup: stageGroup(body.stageGroup),
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 1000,
      });
      if (action !== 'CREATED') {
        throw new ProcessDefinitionResolutionError('同名工序已经存在', 'PROCESS_NAME_DUPLICATE');
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_process_definition',
          targetType: 'process_definition',
          targetId: created.id,
          detail: { processCode: created.code, processName: created.name },
        },
      });
      return { id: created.id, code: created.code, name: created.name, stageGroup: created.stageGroup, sortOrder: created.sortOrder };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, definition }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessDefinitionResolutionError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('create process definition failed', error);
    return NextResponse.json({ ok: false, error: '新增工序失败' }, { status: 500 });
  }
}
