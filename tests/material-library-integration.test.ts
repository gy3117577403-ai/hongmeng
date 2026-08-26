import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMaterialUploadCode, hashMaterialUploadCode, materialLibraryItemInclude, materialLibrarySessionInclude, serializeMaterialItem, serializeMaterialSession } from '../lib/material-library';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
process.env.SESSION_SECRET ||= 'material-library-integration-secret-2026';

test('material library supports reusable QR sessions, archive sync and recoverable photo deletion', { skip: !runDatabaseIntegration }, async () => {
  const prefix = `material-it-${randomUUID().slice(0, 8)}`;
  const category = await prisma.materialLibraryCategory.create({
    data: { code: `${prefix}-CATEGORY`, name: '集成测试端子', sortOrder: 990, isSystem: false },
  });
  const item = await prisma.materialLibraryItem.create({
    data: { categoryId: category.id, code: `${prefix}-T001`.toUpperCase(), name: '集成测试端子' },
  });
  const linkId = randomUUID();
  const linkCode = createMaterialUploadCode({ id: linkId, generation: 1, materialItemId: item.id, mode: 'PERMANENT' });
  const link = await prisma.materialLibraryUploadLink.create({
    data: { id: linkId, materialItemId: item.id, mode: 'PERMANENT', tokenHash: hashMaterialUploadCode(linkCode) },
  });
  const temporaryLinkId = randomUUID();
  const temporaryLinkCode = createMaterialUploadCode({ id: temporaryLinkId, generation: 1, materialItemId: item.id, mode: 'TEMPORARY' });
  const temporaryLink = await prisma.materialLibraryUploadLink.create({
    data: {
      id: temporaryLinkId,
      materialItemId: item.id,
      mode: 'TEMPORARY',
      tokenHash: hashMaterialUploadCode(temporaryLinkCode),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const session = await prisma.materialLibraryCaptureSession.create({
    data: {
      sessionNo: `${prefix}-REC`, uploadLinkId: link.id, materialItemId: item.id, categoryId: category.id,
      connectedByName: '集成测试品质员', draftManufacturerModel: 'SXH-001T-P0.6', draftSpecification: 'AWG 22–28',
    },
  });
  const objectKey = `material-library/${item.id}/${prefix}.jpg`;
  const photo = await prisma.materialLibraryPhoto.create({
    data: {
      sessionId: session.id, materialItemId: item.id, originalName: `${prefix}.jpg`, mimeType: 'image/jpeg', size: BigInt(1024),
      objectKey, sha256: 'f'.repeat(64), width: 1280, height: 960, isCover: true, uploadedByName: '集成测试品质员',
    },
  });

  try {
    const active = await prisma.materialLibraryCaptureSession.findUniqueOrThrow({ where: { id: session.id }, include: materialLibrarySessionInclude });
    assert.equal(serializeMaterialSession(active).photos.length, 1);
    assert.equal(serializeMaterialSession(active).item.coverPhoto?.id, photo.id);
    await assert.rejects(
      prisma.materialLibraryCaptureSession.create({
        data: { sessionNo: `${prefix}-DUP`, uploadLinkId: link.id, materialItemId: item.id, categoryId: category.id },
      }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002',
    );
    await assert.rejects(
      prisma.materialLibraryCaptureSession.create({
        data: { sessionNo: `${prefix}-OTHER-QR`, uploadLinkId: temporaryLink.id, materialItemId: item.id, categoryId: category.id },
      }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002',
    );

    await prisma.$transaction(async tx => {
      await tx.materialLibraryItem.update({
        where: { id: item.id },
        data: { manufacturerModel: active.draftManufacturerModel, specification: active.draftSpecification, lastCapturedAt: new Date(), version: { increment: 1 } },
      });
      await tx.materialLibraryCaptureSession.update({ where: { id: session.id }, data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } } });
    });
    const archived = await prisma.materialLibraryItem.findUniqueOrThrow({ where: { id: item.id }, include: materialLibraryItemInclude });
    assert.equal(serializeMaterialItem(archived).manufacturerModel, 'SXH-001T-P0.6');
    assert.equal(serializeMaterialItem(archived).photoCount, 1);

    const nextSession = await prisma.materialLibraryCaptureSession.create({
      data: { sessionNo: `${prefix}-NEXT`, uploadLinkId: link.id, materialItemId: item.id, categoryId: category.id },
    });
    assert.equal(nextSession.status, 'ACTIVE');

    await prisma.materialLibraryItem.update({ where: { id: item.id }, data: { deletedAt: new Date(), deletedReason: '集成测试回收' } });
    assert.equal(await prisma.materialLibraryPhoto.count({ where: { id: photo.id } }), 1);
    assert.equal((await prisma.materialLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedReason, '集成测试回收');
    await prisma.materialLibraryItem.update({ where: { id: item.id }, data: { deletedAt: null, deletedReason: null } });
    assert.equal((await prisma.materialLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt, null);
  } finally {
    await prisma.materialLibraryPhoto.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryCaptureSession.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryUploadLink.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryItem.deleteMany({ where: { id: item.id } });
    await prisma.materialLibraryCategory.deleteMany({ where: { id: category.id } });
  }
});
