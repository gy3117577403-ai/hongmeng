import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { materialLossAccess } from '@/lib/material-loss-access';
import { lossTarget } from '@/lib/material-loss-service';
import { materialLossFailure } from '@/lib/material-loss-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(); await materialLossAccess(user.id);
    const id = req.nextUrl.searchParams.get('id');
    if (id) return NextResponse.json({ ok: true, targets: [await lossTarget(prisma, id)] });
    const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
    if (q.length < 2) return NextResponse.json({ ok: true, targets: [] });
    const match: Prisma.StringFilter = { contains: q, mode: 'insensitive' };
    const rows = await prisma.warehouseMaterialTask.findMany({ where: { OR: [
      { sampleTask: { deletedAt: null, status: { not: 'CANCELLED' }, OR: [{ code: match }, { specificationSnapshot: match }, { customerNameSnapshot: match }] } },
      { workOrder: { deletedAt: null, OR: [{ code: match }, { specification: match }, { customerName: match }] } },
      { planOrder: { deletedAt: null, status: { not: 'cancelled' }, OR: [{ sourceOrderNo: match }, { specification: match }, { customerName: match }] } },
    ] }, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 12 });
    return NextResponse.json({ ok: true, targets: await Promise.all(rows.map(row => lossTarget(prisma, row.id))) });
  } catch (e) { return materialLossFailure(e); }
}
