import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/** Integration fixture cleanup only. Production retains the restrictive source FK. */
export async function deleteTestCompletions(args: Prisma.ProcessCompletionDeleteManyArgs) {
  if (process.env.RUN_DB_INTEGRATION !== '1' || !args.where || !Object.keys(args.where).length) throw new Error('Scoped disposable completion cleanup required');
  const rows = await prisma.qualityDataRecord.findMany({ where: { sourceCompletion: args.where }, select: { id: true } });
  const ids = rows.map(row => row.id);
  if (ids.length) {
    await prisma.qualityDataRevision.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataAttachment.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.processQualityEvidence.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataRecord.deleteMany({ where: { id: { in: ids } } });
  }
  return prisma.processCompletion.deleteMany(args);
}
