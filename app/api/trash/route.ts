import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeResourceFile } from '@/lib/resource-files';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';
import { serializeManual, serializeManualAsset, serializeManualVersion } from '@/lib/connector-assembly-manuals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [workOrders, resourceFiles, connectorAssemblyManuals, connectorAssemblyManualVersions, connectorAssemblyManualAssets] = await Promise.all([
      prisma.workOrder.findMany({
        where: { deletedAt: { not: null } },
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.resourceFile.findMany({
        where: { OR: [{ deletedAt: { not: null } }, { status: 'deleted' }] },
        include: {
          workOrder: { select: { code: true, specification: true, productName: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.connectorAssemblyManual.findMany({
        where: { deletedAt: { not: null } },
        include: {
          versions: { include: { assets: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }, orderBy: [{ isLatest: 'desc' }, { createdAt: 'desc' }] },
          bindings: { include: { connectorParameter: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.connectorAssemblyManualVersion.findMany({
        where: { deletedAt: { not: null }, manual: { deletedAt: null } },
        include: { manual: { select: { title: true } }, assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.connectorAssemblyManualAsset.findMany({
        where: { deletedAt: { not: null }, version: { deletedAt: null, manual: { deletedAt: null } } },
        include: { version: { include: { manual: { select: { title: true } } } } },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      workOrders: workOrders.map(serializeWorkOrder),
      resourceFiles: resourceFiles.map(serializeResourceFile),
      connectorAssemblyManuals: connectorAssemblyManuals.map(serializeManual),
      connectorAssemblyManualVersions: connectorAssemblyManualVersions.map(version => ({ ...serializeManualVersion(version), manualTitle: version.manual.title })),
      connectorAssemblyManualAssets: connectorAssemblyManualAssets.map(asset => ({ ...serializeManualAsset(asset), manualTitle: asset.version.manual.title, revision: asset.version.revision })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '回收站加载失败' }, { status: 500 });
  }
}
