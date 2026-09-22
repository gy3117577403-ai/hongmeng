import type { DrawingLibraryFile, DrawingReplacementJob, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { lockFixtureBusiness, qfJson } from '@/lib/quality-fixture-service';
import { syncProductDocuments } from '@/lib/quality-fixture-sync';
import { resubmitDocumentReturns } from '@/lib/quality-document-returns';
import { purgeObjectVersions } from '@/lib/s3';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import type { PcActor } from '@/lib/purchasing-service';

type Tx = Prisma.TransactionClient;
/** Only the explicitly selected current file is retired. Business states never veto a replacement. */
export async function retireReplacedDrawing(tx: Tx, old: DrawingLibraryFile, next: DrawingLibraryFile, actor: PcActor, reason: string) {
  const now = new Date();
  const asset = old.mediaAssetId ? await tx.mediaAsset.findUnique({ where: { id: old.mediaAssetId } }) : null;
  await tx.drawingLibraryFile.update({ where: { id: old.id }, data: { isCurrent: false, deletedAt: now, retiredForReplacementAt: now } });
  if (old.sourceResourceFileId) await tx.resourceFile.updateMany({ where: { id: old.sourceResourceFileId, objectKey: old.objectKey }, data: { deletedAt: now } });
  if (old.sourceSopVersionId) {
    await tx.sopDocument.updateMany({ where: { currentPublishedVersionId: old.sourceSopVersionId }, data: { currentPublishedVersionId: null } });
    await tx.sopVersion.updateMany({ where: { id: old.sourceSopVersionId }, data: { deletedAt: now } });
  }
  await tx.pdfOverlayDocument.updateMany({ where: { OR: [{ currentFileId: old.id }, { baseFileId: old.id }] }, data: { deletedAt: now, currentPublishedVersionId: null } });
  if (old.sourcePdfOverlayVersionId) await tx.pdfOverlayVersion.updateMany({ where: { id: old.sourcePdfOverlayVersionId }, data: { deletedAt: now } });
  // Durable work is committed with the file switch, so a failed audit service or S3 cleanup cannot lose the request.
  await tx.drawingReplacementJob.create({ data: {
    sourceFileId: old.id, replacementFileId: next.id, libraryItemId: old.libraryItemId,
    actorId: actor.id, actorName: actor.displayName || actor.username, reason,
    objectKeys: [old.objectKey, asset?.previewObjectKey, asset?.thumbnailObjectKey].filter((key): key is string => !!key),
  } });
}

const includesFile = (p: { drawingFiles: unknown; sopFiles: unknown }, id: string) =>
  [p.drawingFiles, p.sopFiles].some(files => Array.isArray(files) && files.some(file => file?.id === id));

export async function syncDrawingReplacement(tx: Tx, job: DrawingReplacementJob) {
  const actor = { id: job.actorId, username: job.actorName, displayName: job.actorName };
  const product = await tx.drawingLibraryItem.findFirst({ where: { id: job.libraryItemId, deletedAt: null } });
  if (!product) return;
  let replacement = await tx.drawingLibraryFile.findUnique({ where: { id: job.replacementFileId }, include: { supersededByFile: true } });
  const seen = new Set<string>();
  while (replacement?.supersededByFile && !seen.has(replacement.id)) {
    seen.add(replacement.id);
    replacement = await tx.drawingLibraryFile.findUnique({ where: { id: replacement.supersededByFile.id }, include: { supersededByFile: true } });
  }
  const replacementId = replacement?.id || job.replacementFileId;
  const packages = await tx.qfPackage.findMany({ where: { libraryItemId: job.libraryItemId } });
  const priorIds = packages.filter(p => includesFile(p, job.sourceFileId)).map(p => p.id);
  await tx.qfPackage.updateMany({ where: { id: { in: priorIds }, status: { in: ['REVIEWING', 'SUPERVISOR', 'QUALITY', 'APPROVED'] } },
    data: { status: 'SUPERSEDED', version: { increment: 1 } } });
  await tx.qfDocumentReturn.updateMany({ where: { libraryItemId: job.libraryItemId, status: { not: 'RESOLVED' },
    AND: [{ OR: [{ responseFileId: null }, { responseFileId: { not: replacementId } }] }],
    OR: [{ fileId: job.sourceFileId }, { responseFileId: job.sourceFileId }] }, data: {
    status: 'READY', responseMode: 'REPLACE', responseFileId: replacementId,
    responseText: job.reason || '已通过快捷更换上传新文件，请重新审核。',
    respondedById: actor.id, respondedByName: actor.username, respondedAt: new Date(), submittedPackageId: null, version: { increment: 1 },
  } });
  await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: job.libraryItemId });
  await synchronizeDrawingLibraryWorkOrderStatus(tx, job.libraryItemId);
  let p = await syncProductDocuments(tx, job.libraryItemId, actor);
  const issues = await tx.qfDocumentReturn.findMany({ where: { libraryItemId: job.libraryItemId, status: { not: 'RESOLVED' } } });
  if (p?.status === 'DRAFT' && issues.length && issues.every(i => i.status === 'READY' && i.responseText) && p.needFixture !== null) {
    // All return replies ready: retain reasons and submit a new, unsigned review round.
    const submitted = await resubmitDocumentReturns(tx, { libraryItemId: job.libraryItemId, versions: Object.fromEntries(issues.map(i => [i.id, i.version])) }, actor);
    p = await tx.qfPackage.findUnique({ where: { id: submitted.id } });
  }
  if (p) await tx.qfPlanBinding.updateMany({ where: { packageId: { in: priorIds }, workOrder: {
    drawingLibraryItemId: job.libraryItemId, deletedAt: null, completedAt: null, status: { notIn: ['completed', 'cancelled', 'archived'] },
  } }, data: { packageId: p.id, selectedById: actor.id, selectedAt: new Date() } });
  await tx.qfEvent.create({ data: { entityType: 'DOCUMENT_RETURN', entityId: job.libraryItemId, action: 'REPLACEMENT_REVIEW_SYNC',
    actorId: actor.id, actorName: actor.username, reason: job.reason,
    snapshot: qfJson({ sourceFileId: job.sourceFileId, replacementFileId: job.replacementFileId, packageId: p?.id || null }) } });
}

/** Shared sample evidence remains owned by its original business record. Never delete unrelated evidence. */
async function objectStillReferenced(key: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { OR: [{ originalObjectKey: key }, { previewObjectKey: key }, { thumbnailObjectKey: key }] }, select: { id: true } });
  const references = await Promise.all([
    prisma.drawingLibraryFile.count({ where: { retiredForReplacementAt: null, OR: [{ objectKey: key }, ...(asset ? [{ mediaAssetId: asset.id }] : [])] } }),
    prisma.resourceFile.count({ where: { objectKey: key, deletedAt: null } }),
    prisma.samplePhoto.count({ where: { OR: [{ objectKey: key }, ...(asset ? [{ mediaAssetId: asset.id }] : [])] } }),
  ]);
  return references.some(Boolean);
}

export async function processDrawingReplacementJobs(limit = 10) {
  const jobs = await prisma.drawingReplacementJob.findMany({ where: { retryAt: { lte: new Date() }, OR: [{ syncPending: true }, { purgePending: true }] }, orderBy: { createdAt: 'asc' }, take: limit });
  for (const job of jobs) {
    const errors: string[] = [];
    if (job.syncPending) try {
      await prisma.$transaction(async tx => {
        await lockFixtureBusiness(tx);
        const current = await tx.drawingReplacementJob.findUnique({ where: { id: job.id } });
        if (!current?.syncPending) return;
        await syncDrawingReplacement(tx, current);
        await tx.drawingReplacementJob.update({ where: { id: job.id }, data: { syncPending: false } });
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) { errors.push(e instanceof Error ? e.message.slice(0, 300) : '审核关联待重试'); }
    if (job.purgePending) try {
      for (const key of job.objectKeys as string[]) {
        if (await objectStillReferenced(key)) throw new Error('其他业务仍引用附件，已移除旧图纸入口，等待引用释放后清理原件');
        await purgeObjectVersions(key);
      }
      await prisma.drawingReplacementJob.update({ where: { id: job.id }, data: { purgePending: false } });
    } catch (e) { errors.push(e instanceof Error ? e.message.slice(0, 300) : '旧附件清理待重试'); }
    await prisma.drawingReplacementJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 }, lastError: errors.join('; ') || null,
      retryAt: new Date(Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(job.attempts, 8))) } });
  }
  return { pending: jobs.length === limit };
}
