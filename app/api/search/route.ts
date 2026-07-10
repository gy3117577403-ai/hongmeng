import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeConnectorParameter } from '@/lib/connector-parameters';
import { serializeDrawingLibraryItem } from '@/lib/drawing-library';
import { serializeResourceFile } from '@/lib/resource-files';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';
import { serializeManual } from '@/lib/connector-assembly-manuals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim();
    if (!keyword) {
      const empty = { keyword, workOrders: [], resourceFiles: [], drawingLibraryItems: [], drawingLibraryFiles: [], connectorParameters: [], connectorAssemblyManuals: [], connectorAssemblyManualAssets: [] };
      return NextResponse.json({ ok: true, data: empty, ...empty });
    }

    const [workOrders, resourceFiles, drawingCategories, drawingLibraryItems, drawingLibraryFiles, connectorParameters, connectorAssemblyManuals, connectorAssemblyManualAssets] = await Promise.all([
      prisma.workOrder.findMany({
        where: {
          deletedAt: null,
          planActive: true,
          OR: [
            { code: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
            { specification: { contains: keyword, mode: 'insensitive' } },
            { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
            { salesperson: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
      }),
      prisma.resourceFile.findMany({
        where: {
          deletedAt: null,
          status: 'uploaded',
          OR: [
            { originalName: { contains: keyword, mode: 'insensitive' } },
            { displayName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
            { version: { contains: keyword, mode: 'insensitive' } },
            { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { sourceOrderNo: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { salesperson: { contains: keyword, mode: 'insensitive' } } },
            { category: { name: { contains: keyword, mode: 'insensitive' } } },
          ],
          workOrder: { deletedAt: null, planActive: true },
        },
        include: {
          workOrder: { select: { code: true, specification: true, productName: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
      }),
      prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.drawingLibraryItem.findMany({
        where: {
          deletedAt: null,
          OR: [
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { customerCode: { contains: keyword, mode: 'insensitive' } },
            { specification: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: {
          files: {
            where: { deletedAt: null },
            include: {
              category: { select: { id: true, name: true, code: true, sortOrder: true } },
              uploadedBy: { select: { displayName: true, username: true } },
            },
            orderBy: [{ createdAt: 'desc' }],
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 12,
      }),
      prisma.drawingLibraryFile.findMany({
        where: {
          deletedAt: null,
          OR: [
            { originalName: { contains: keyword, mode: 'insensitive' } },
            { displayName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
          libraryItem: { deletedAt: null },
        },
        include: {
          category: { select: { id: true, name: true, code: true, sortOrder: true } },
          libraryItem: { select: { id: true, customerName: true, customerCode: true, specification: true, productName: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 12,
      }),
      prisma.connectorParameter.findMany({
        where: {
          deletedAt: null,
          OR: [
            { model: { contains: keyword, mode: 'insensitive' } },
            { outerPeelMm: { contains: keyword, mode: 'insensitive' } },
            { innerPeelMm: { contains: keyword, mode: 'insensitive' } },
            { insertionLengthMm: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: { _count: { select: { assemblyManualBindings: { where: { manual: { deletedAt: null } } } } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 12,
      }),
      prisma.connectorAssemblyManual.findMany({
        where: {
          deletedAt: null,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { manufacturer: { contains: keyword, mode: 'insensitive' } },
            { family: { contains: keyword, mode: 'insensitive' } },
            { documentNo: { contains: keyword, mode: 'insensitive' } },
            { summary: { contains: keyword, mode: 'insensitive' } },
            { keywords: { contains: keyword, mode: 'insensitive' } },
            { versions: { some: { deletedAt: null, OR: [{ revision: { contains: keyword, mode: 'insensitive' } }, { searchText: { contains: keyword, mode: 'insensitive' } }] } } },
            { bindings: { some: { connectorParameter: { deletedAt: null, model: { contains: keyword, mode: 'insensitive' } } } } },
          ],
        },
        include: {
          versions: { where: { deletedAt: null }, include: { assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }, orderBy: [{ isLatest: 'desc' }, { issuedAt: 'desc' }, { createdAt: 'desc' }] },
          bindings: { where: { connectorParameter: { deletedAt: null } }, include: { connectorParameter: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.connectorAssemblyManualAsset.findMany({
        where: {
          deletedAt: null,
          OR: [{ originalName: { contains: keyword, mode: 'insensitive' } }, { displayName: { contains: keyword, mode: 'insensitive' } }],
          version: { deletedAt: null, manual: { deletedAt: null } },
        },
        include: {
          version: {
            include: {
              manual: { include: { bindings: { where: { connectorParameter: { deletedAt: null } }, include: { connectorParameter: { select: { model: true } } } } } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    const data = {
      keyword,
      workOrders: workOrders.map(serializeWorkOrder),
      resourceFiles: resourceFiles.map(serializeResourceFile),
      drawingLibraryItems: drawingLibraryItems.map(item => serializeDrawingLibraryItem(item, drawingCategories)),
      drawingLibraryFiles: drawingLibraryFiles.map(file => ({
        id: file.id,
        libraryItemId: file.libraryItemId,
        categoryId: file.categoryId,
        categoryName: file.category?.name || null,
        categoryCode: file.category?.code || null,
        originalName: file.originalName,
        displayName: file.displayName,
        remark: file.remark,
        mimeType: file.mimeType,
        fileSize: file.size,
        version: file.version || 'V1.0',
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        item: {
          id: file.libraryItem.id,
          customerName: file.libraryItem.customerName,
          customerCode: file.libraryItem.customerCode,
          specification: file.libraryItem.specification,
          productName: file.libraryItem.productName,
        },
      })),
      connectorParameters: connectorParameters.map(serializeConnectorParameter),
      connectorAssemblyManuals: connectorAssemblyManuals.map(serializeManual),
      connectorAssemblyManualAssets: connectorAssemblyManualAssets.map(asset => ({
        id: asset.id,
        manualId: asset.version.manual.id,
        versionId: asset.version.id,
        manualTitle: asset.version.manual.title,
        revision: asset.version.revision,
        originalName: asset.originalName,
        displayName: asset.displayName,
        assetType: asset.assetType,
        pageNo: asset.pageNo,
        models: asset.version.manual.bindings.map(binding => binding.connectorParameter.model || '').filter(Boolean),
      })),
    };

    return NextResponse.json({
      ok: true,
      data,
      ...data,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '搜索失败' }, { status: 500 });
  }
}
