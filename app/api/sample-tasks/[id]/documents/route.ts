import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { purchasingError } from '@/lib/purchasing-http';
import { fixtureReviewRoles, FixtureError } from '@/lib/quality-fixture-domain';
import { lockFixtureBusiness } from '@/lib/quality-fixture-service';
import { syncProductDocuments } from '@/lib/quality-fixture-sync';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await prisma.sampleTask.findFirst({ where: { id: params.id, deletedAt: null }, select: { drawingLibraryItemId: true, approvedPackageId: true } });
    if (!task) throw new FixtureError('样品任务不存在');
    const [product, packs, settings, files] = await Promise.all([
      prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: task.drawingLibraryItemId }, select: { id: true, fixtureRequired: true } }),
      prisma.qfPackage.findMany({ where: { libraryItemId: task.drawingLibraryItemId }, orderBy: { sequence: 'desc' }, take: 30 }),
      prisma.qfSettings.findUnique({ where: { id: 'quality-fixtures' } }),
      prisma.drawingLibraryFile.findMany({ where: { libraryItemId: task.drawingLibraryItemId, deletedAt: null, isCurrent: true, category: { code: { in: ['drawing','sop'] } } }, select: { id: true, originalName: true, displayName: true, mimeType: true, version: true, uploadedById: true, createdAt: true, updatedAt: true, category: { select: { code: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    // Bound evidence remains available even when it is older than the recent history page.
    if (task.approvedPackageId && !packs.some(p => p.id === task.approvedPackageId)) {
      const bound = await prisma.qfPackage.findUnique({ where: { id: task.approvedPackageId } }); if (bound) packs.push(bound);
    }
    const evidenceIds = [...new Set(packs.flatMap(p => [...(p.drawingFiles as Array<{ id: string }>), ...(p.sopFiles as Array<{ id: string }>)].map(f => f.id)))];
    const owned = new Set(user.laborRole === 'ADMIN' ? [] : (await prisma.drawingLibraryFile.findMany({ where: { id: { in: evidenceIds }, uploadedById: user.id }, select: { id: true } })).map(f => f.id));
    const packages = packs.map(p => {
      const evidence = [...(p.drawingFiles as Array<{ id: string }>), ...(p.sopFiles as Array<{ id: string }>)];
      const owns = evidence.some(f => owned.has(f.id));
      return { id: p.id, version: p.version, revision: p.revision, sequence: p.sequence, status: p.status, reason: p.reason,
        supervisorName: p.supervisorName, supervisorAt: p.supervisorAt, qualityName: p.qualityName, qualityAt: p.qualityAt,
        drawingFiles: (p.drawingFiles as Array<Record<string, unknown>>).map(({ id, name, mimeType, version }) => ({ id, name, mimeType, version })),
        sopFiles: (p.sopFiles as Array<Record<string, unknown>>).map(({ id, name, mimeType, version }) => ({ id, name, mimeType, version })),
        roles: fixtureReviewRoles(p, user, settings || { supervisorIds: [], qualityIds: [] }, owns), createdAt: p.createdAt,
      };
    });
    return NextResponse.json({ ok: true, product, packages, boundPackageId: task.approvedPackageId, files: files.map(({ uploadedById, ...f }) => f) });
  } catch (e) { return purchasingError(e); }
}
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await prisma.$transaction(async tx => {
      await lockFixtureBusiness(tx);
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new FixtureError('样品任务不存在');
      return syncProductDocuments(tx, task.drawingLibraryItemId, user);
    }, { timeout: 30000 });
    return NextResponse.json({ ok: true, id: result?.id });
  } catch (e) { return purchasingError(e); }
}
