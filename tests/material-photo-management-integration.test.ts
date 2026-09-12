import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { manageMaterialPhotos } from '../lib/material-photo-management';

test('photo deletion is atomic, permission checked, cover-safe, idempotent and recoverable to its original record', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const prefix = `photo-it-${randomUUID()}`;
  const category = await prisma.materialLibraryCategory.create({ data: { code: prefix, name: prefix } });
  const item = await prisma.materialLibraryItem.create({ data: { categoryId: category.id, code: prefix, name: '照片集成测试' } });
  const link = await prisma.materialLibraryUploadLink.create({ data: { materialItemId: item.id, tokenHash: prefix, mode: 'PERMANENT' } });
  const session = await prisma.materialLibraryCaptureSession.create({ data: { sessionNo: prefix, materialItemId: item.id, categoryId: category.id, uploadLinkId: link.id, status: 'COMPLETED' } });
  const user = await prisma.user.create({ data: { username: prefix, displayName: prefix, passwordHash: 'not-a-login-hash' } });
  const input = { materialItemId: item.id, actor: { id: user.id, name: '照片测试' }, canDeleteArchived: true, reason: '误传' };
  try {
    const photos = await Promise.all([0, 1, 2].map(index => prisma.materialLibraryPhoto.create({ data: { sessionId: session.id, materialItemId: item.id, originalName: `photo-${index}.jpg`, mimeType: 'image/jpeg', size: 100n, objectKey: `${prefix}/${index}`, sha256: String(index).repeat(64), isCover: index === 0, sortOrder: index } })));
    const ids = photos.slice(0, 2).map(photo => photo.id);
    await assert.rejects(manageMaterialPhotos({ ...input, canDeleteArchived: false, action: 'DELETE', ids }), /权限/);
    await assert.rejects(manageMaterialPhotos({ ...input, action: 'DELETE', ids: [photos[0].id, randomUUID()] }), /归属/);
    assert.equal(await prisma.materialLibraryPhoto.count({ where: { materialItemId: item.id, deletedAt: null } }), 3);
    const deleted = await manageMaterialPhotos({ ...input, action: 'DELETE', ids }); assert.equal(deleted.changed, 2);
    assert.equal((await manageMaterialPhotos({ ...input, action: 'DELETE', ids })).changed, 0);
    assert.equal((await prisma.materialLibraryPhoto.findUniqueOrThrow({ where: { id: photos[2].id } })).isCover, true);
    const removed = await prisma.materialLibraryPhoto.findUniqueOrThrow({ where: { id: ids[0] } }); assert.equal(removed.objectKey, photos[0].objectKey); assert.equal(removed.deletedByName, '照片测试');
    await assert.rejects(manageMaterialPhotos({ ...input, canDeleteArchived: false, action: 'RESTORE', ids }), /权限/);
    await prisma.materialLibraryItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    await assert.rejects(manageMaterialPhotos({ ...input, action: 'RESTORE', ids }), /先恢复物料/);
    await prisma.materialLibraryItem.update({ where: { id: item.id }, data: { deletedAt: null } });
    assert.equal((await manageMaterialPhotos({ ...input, action: 'RESTORE', ids })).changed, 2);
    const restored = await prisma.materialLibraryPhoto.findUniqueOrThrow({ where: { id: ids[0] } }); assert.equal(restored.sessionId, session.id); assert.equal(restored.deletedAt, null);
    assert.equal(await prisma.materialLibraryPhoto.count({ where: { materialItemId: item.id, deletedAt: null, isCover: true } }), 1);
    await assert.rejects(manageMaterialPhotos({ ...input, action: 'DELETE', ids: [ids[0]], expectedUpdatedAt: { [ids[0]]: '2000-01-01' } }), /修改/);
  } finally {
    await prisma.operationLog.deleteMany({ where: { targetId: item.id } });
    await prisma.materialLibraryPhoto.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryCaptureSession.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryUploadLink.deleteMany({ where: { materialItemId: item.id } });
    await prisma.materialLibraryItem.delete({ where: { id: item.id } });
    await prisma.materialLibraryCategory.delete({ where: { id: category.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
