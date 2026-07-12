import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  createLocalImportTicket,
  createLocalImportPairingCode,
  LOCAL_IMPORT_LOOPBACK_URL,
  LOCAL_IMPORT_TASK_TTL_SECONDS,
  localImportErrorResponse,
  localImportLimits,
} from '@/lib/local-import';
import { prisma } from '@/lib/prisma';
import { displayWorkOrderCode } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function appBaseUrl(req: NextRequest) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('APP_BASE_URL protocol invalid');
    return parsed.origin;
  }
  return req.nextUrl.origin;
}
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { workOrderId?: unknown; categoryId?: unknown };
    const workOrderId = typeof body.workOrderId === 'string' ? body.workOrderId.trim() : '';
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : '';
    if (!workOrderId) return NextResponse.json({ ok: false, error: '请先选择工单' }, { status: 400 });
    if (!categoryId) return NextResponse.json({ ok: false, error: '请先选择资料分类' }, { status: 400 });

    const [workOrder, category] = await Promise.all([
      prisma.workOrder.findFirst({
        where: { id: workOrderId, deletedAt: null },
        select: { id: true, code: true, specification: true, customerName: true, productName: true },
      }),
      prisma.resourceCategory.findUnique({ where: { id: categoryId }, select: { id: true, name: true, code: true } }),
    ]);
    if (!workOrder || !category) return NextResponse.json({ ok: false, error: '工单或资料分类不存在' }, { status: 404 });

    const taskId = crypto.randomUUID();
    const handshakeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + LOCAL_IMPORT_TASK_TTL_SECONDS * 1000);
    const limits = localImportLimits();
    const pairing = createLocalImportPairingCode();
    const detail = {
      workOrderId: workOrder.id,
      categoryId: category.id,
      handshakeId,
      expiresAt: expiresAt.toISOString(),
      ...limits,
      state: 'waiting',
      pairingCodeHash: pairing.hash,
    };
    await prisma.operationLog.create({
      data: {
        id: taskId,
        userId: user.id,
        action: 'local_import_task_created',
        targetType: 'local_import_task',
        targetId: taskId,
        detail: detail as Prisma.InputJsonValue,
      },
    });

    const handoffTicket = createLocalImportTicket({
      taskId,
      workOrderId: workOrder.id,
      categoryId: category.id,
      userId: user.id,
      handshakeId,
      expiresAt,
      ...limits,
    });
    const baseUrl = appBaseUrl(req);
    const launchParams = new URLSearchParams({ handshakeId, taskId, baseUrl });

    return NextResponse.json({
      ok: true,
      data: {
        taskId,
        handshakeId,
        handoffTicket,
        launchUrl: `hongmeng-workorder-import://launch?${launchParams.toString()}`,
        loopbackUrl: LOCAL_IMPORT_LOOPBACK_URL,
        pairingCode: pairing.code,
        expiresAt: expiresAt.toISOString(),
        limits,
        workOrder: {
          id: workOrder.id,
          displayCode: displayWorkOrderCode(workOrder),
          customerName: workOrder.customerName || '未设置',
          productName: workOrder.productName,
        },
        category,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('local import task create failed', error);
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
