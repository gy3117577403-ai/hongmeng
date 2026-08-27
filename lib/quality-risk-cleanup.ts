import { prisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/s3';

/** Durable retry queue; only keys owned exclusively by a purged quality draft. */
export async function processQualityRiskCleanup() {
  const jobs = await prisma.qualityRiskObjectCleanup.findMany({ where: { completedAt: null }, orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }], take: 20 });
  let completed = 0;
  for (const job of jobs) {
    if (!job.objectKey.startsWith(`quality-risks/${job.reportId}/`)) continue;
    if (await prisma.internalQualityRiskAttachment.count({ where: { objectKey: job.objectKey } })) continue;
    try {
      await deleteObject(job.objectKey);
      await prisma.qualityRiskObjectCleanup.update({ where: { id: job.id }, data: { completedAt: new Date(), attempts: { increment: 1 } } });
      completed++;
    } catch {
      await prisma.qualityRiskObjectCleanup.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
    }
  }
  return { completed, pending: await prisma.qualityRiskObjectCleanup.count({ where: { completedAt: null } }) };
}
