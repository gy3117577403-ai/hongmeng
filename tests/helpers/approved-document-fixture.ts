import { prisma } from "../../lib/prisma";
import { documentFingerprint } from "../../lib/quality-fixture-service";
/** Test fixture only; production documents always use the two independent review commands. */
export async function approvedDocumentFixture(workOrderId: string, submittedById: string) {
  const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  const createdProduct = !order.drawingLibraryItemId;
  let productId = order.drawingLibraryItemId;
  if (!productId) {
    const cat = await prisma.resourceCategory.upsert({ where: { code: "drawing" }, create: { code: "drawing", name: "图纸", sortOrder: 1 }, update: {} });
    const product = await prisma.drawingLibraryItem.create({ data: { customerName: "integration-test", specification: order.code, libraryKey: "qr-test-" + order.id,
      files: { create: { categoryId: cat.id, originalName: "approved-test.pdf", mimeType: "application/pdf", size: 10, objectKey: "qr-test/" + order.id, uploadedById: submittedById } } } });
    productId = product.id; await prisma.workOrder.update({ where: { id: order.id }, data: { drawingLibraryItemId: product.id } });
  }
  let files = await prisma.drawingLibraryFile.findMany({ where: { libraryItemId: productId, deletedAt: null, category: { code: "drawing" } }, orderBy: { id: "asc" } });
  let createdFileId: string | null = null;
  if (!files.length) {
    const cat = await prisma.resourceCategory.upsert({ where: { code: "drawing" }, create: { code: "drawing", name: "图纸", sortOrder: 1 }, update: {} });
    const file = await prisma.drawingLibraryFile.create({ data: { libraryItemId: productId!, categoryId: cat.id, originalName: "approved-test.pdf", mimeType: "application/pdf", size: 10, objectKey: "qr-test/" + order.id, uploadedById: submittedById } });
    files = [file]; createdFileId = file.id;
  }
  const reviewers = await Promise.all(["supervisor","quality"].map(role => prisma.user.create({ data: { username: "qr-review-" + order.id + "-" + role, passwordHash: "not-a-login-hash", displayName: role } })));
  const values = { revision: "QA", needFixture: false, drawingFiles: files.map(f => ({ id: f.id, name: f.originalName, version: f.version, sha256: f.sha256 || "", objectKey: f.objectKey, mimeType: f.mimeType })),
    bomFileId: null, bomRows: [], parallelCount: 1, spareCount: 0 };
  const p = await prisma.qfPackage.create({ data: { ...values, fingerprint: documentFingerprint(values), libraryItemId: productId, sequence: 1,
    status: "APPROVED", createdById: submittedById, submittedById, submittedAt: new Date(), supervisorId: reviewers[0].id, supervisorName: "Test supervisor", supervisorAt: new Date(),
    qualityId: reviewers[1].id, qualityName: "Test quality", qualityAt: new Date() } });
  return async () => {
    await prisma.qfPackage.delete({ where: { id: p.id } });
    if (createdFileId) await prisma.drawingLibraryFile.delete({ where: { id: createdFileId } });
    if (createdProduct) { await prisma.drawingLibraryFile.deleteMany({ where: { libraryItemId: productId } }); await prisma.drawingLibraryItem.delete({ where: { id: productId } }); }
    await prisma.user.deleteMany({ where: { id: { in: reviewers.map(u => u.id) } } });
  };
}
