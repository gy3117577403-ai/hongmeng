import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemInclude,
  materialLibraryItemLockKey,
  serializeMaterialItem,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function datePart(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let objectKey = '';
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const form = await request.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择供应商规格书' }, { status: 400 });
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const variant = await prisma.materialLibrarySupplierVariant.findFirst({
      where: { id: params.id, deletedAt: null, materialItem: { deletedAt: null } },
      select: { materialItemId: true },
    });
    if (!variant) return NextResponse.json({ ok: false, error: '供应商型号不存在或已停用' }, { status: 404 });
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    objectKey = `material-library/${variant.materialItemId}/specifications/${params.id}/${datePart()}/sha256-${sha256}-${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: upload.type || 'application/octet-stream', originalName: upload.name });

    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(variant.materialItemId)}))`;
      const fresh = await tx.materialLibrarySupplierVariant.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!fresh) throw new Error('MATERIAL_VARIANT_NOT_FOUND');
      const revision = (await tx.materialLibrarySpecificationDocument.aggregate({
        where: { supplierVariantId: fresh.id },
        _max: { revision: true },
      }))._max.revision ?? 0;
      await tx.materialLibrarySpecificationDocument.updateMany({
        where: { supplierVariantId: fresh.id, isCurrent: true, deletedAt: null },
        data: { isCurrent: false },
      });
      const document = await tx.materialLibrarySpecificationDocument.create({
        data: {
          supplierVariantId: fresh.id,
          revision: revision + 1,
          originalName: upload.name,
          mimeType: upload.type || 'application/octet-stream',
          size: BigInt(upload.size),
          objectKey,
          sha256,
          isCurrent: true,
          uploadedById: actor.id,
          uploadedByName: actor.name,
        },
      });
      await tx.materialLibrarySupplierVariant.update({
        where: { id: fresh.id },
        data: { updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      await tx.materialLibraryItem.update({
        where: { id: fresh.materialItemId },
        data: { updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'upload_material_library_specification',
          targetType: 'material_library_specification_document',
          targetId: document.id,
          detail: { materialItemId: fresh.materialItemId, supplierVariantId: fresh.id, revision: document.revision, sha256, size: upload.size },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: fresh.materialItemId }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    objectKey = '';
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    if (error instanceof Error && error.message === 'MATERIAL_VARIANT_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '供应商型号不存在或已停用' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '供应商规格书上传失败，请检查对象存储');
  }
}
