import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  UnauthorizedError,
  forbidden,
  requireCapability,
  unauthorized,
} from '@/lib/auth';
import {
  decideMaterialExecution,
  MaterialExecutionControlError,
} from '@/lib/material-execution-control';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const actor = await requireCapability('PLANNING', 'UPDATE');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.allowed !== 'boolean') {
      return NextResponse.json({ ok: false, error: '请选择允许或禁止缺料开工' }, { status: 400 });
    }
    const allowed = body.allowed;
    const expectedTaskVersion = body.expectedTaskVersion == null
      ? null
      : Number(body.expectedTaskVersion);
    if (expectedTaskVersion !== null && (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 0)) {
      return NextResponse.json({ ok: false, error: '仓库任务版本无效，请刷新后重试' }, { status: 400 });
    }
    const control = await prisma.$transaction(tx => decideMaterialExecution(tx, {
      batchId: context.params.id,
      allowed,
      expectedTaskVersion,
      reason: body.reason,
      actorId: actor.id,
      actorName: actor.displayName,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, control });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅计划人员或管理员可以设置缺料开工授权');
    if (error instanceof MaterialExecutionControlError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '物料或批次状态已变化，请刷新后重试' }, { status: 409 });
    }
    console.error('update material execution authorization failed', error);
    return NextResponse.json({ ok: false, error: '更新缺料开工授权失败' }, { status: 500 });
  }
}
