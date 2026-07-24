import { MaterialFollowUpStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  chinaDayStart,
  MATERIAL_FOLLOW_UP_ACTIVE_STATUSES,
  materialFollowUpListInclude,
  serializeMaterialFollowUpTask,
} from '@/lib/material-follow-up';
import { prisma } from '@/lib/prisma';
import type { MaterialFollowUpStatusDTO, MaterialFollowUpSummaryDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validStatuses = new Set(Object.values(MaterialFollowUpStatus));

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const status = String(req.nextUrl.searchParams.get('status') || '').trim();
    const owner = String(req.nextUrl.searchParams.get('owner') || '').trim();
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 100);
    if (status && status !== 'ALL' && !validStatuses.has(status as MaterialFollowUpStatus)) {
      return NextResponse.json({ ok: false, error: '跟进状态筛选不正确' }, { status: 400 });
    }
    const where: Prisma.MaterialFollowUpTaskWhereInput = {
      ...(status && status !== 'ALL' ? { status: status as MaterialFollowUpStatus } : {}),
      ...(owner === 'unassigned' ? { ownerId: null } : owner ? { ownerId: owner } : {}),
      ...(keyword ? {
        OR: [
          { latestProgress: { contains: keyword, mode: 'insensitive' } },
          { warehouseTask: { exceptionNote: { contains: keyword, mode: 'insensitive' } } },
          { warehouseTask: { workOrder: { code: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [tasks, statusRows, overdue, unassigned, users] = await prisma.$transaction([
      prisma.materialFollowUpTask.findMany({
        where,
        include: materialFollowUpListInclude,
        orderBy: [{ resolvedAt: 'asc' }, { expectedAt: 'asc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      prisma.materialFollowUpTask.findMany({ select: { status: true } }),
      prisma.materialFollowUpTask.count({
        where: {
          status: { in: MATERIAL_FOLLOW_UP_ACTIVE_STATUSES },
          expectedAt: { lt: chinaDayStart() },
        },
      }),
      prisma.materialFollowUpTask.count({
        where: {
          status: { in: MATERIAL_FOLLOW_UP_ACTIVE_STATUSES },
          ownerId: null,
        },
      }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, username: true, displayName: true },
        orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      }),
    ]);
    const counts = new Map<MaterialFollowUpStatusDTO, number>();
    statusRows.forEach(item => {
      const itemStatus = item.status as MaterialFollowUpStatusDTO;
      counts.set(itemStatus, (counts.get(itemStatus) || 0) + 1);
    });
    const summary: MaterialFollowUpSummaryDTO = {
      total: statusRows.length,
      pending: counts.get('PENDING') || 0,
      inProgress: counts.get('IN_PROGRESS') || 0,
      waitingArrival: counts.get('WAITING_ARRIVAL') || 0,
      waitingWarehouse: counts.get('WAITING_WAREHOUSE') || 0,
      resolved: counts.get('RESOLVED') || 0,
      overdue,
      unassigned,
    };
    return NextResponse.json({
      ok: true,
      tasks: tasks.map(task => serializeMaterialFollowUpTask(task)),
      summary,
      users,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('material follow-up list failed', error);
    return NextResponse.json({ ok: false, error: '缺料跟进任务加载失败' }, { status: 500 });
  }
}
