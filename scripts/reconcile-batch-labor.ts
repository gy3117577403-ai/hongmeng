import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { reconcileProportionalBatchLaborInTransaction } from '../lib/process-completion-service';

async function main() {
  const execute = process.argv.includes('--execute');
  const routeArg = process.argv.find(argument => argument.startsWith('--route='));
  // Explicit routes keep both preview and repair bounded and reviewable.
  if (!routeArg?.slice(8)) throw new Error('请提供 --route=<routeId>；默认只预览，确认预览后加 --execute');
  const routeId = routeArg.slice(8);
  const result = await prisma.$transaction(tx => reconcileProportionalBatchLaborInTransaction(tx, routeId, { execute, userId: null }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry-run', ...result }, null, 2)}\n`);
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : '修复失败'}\n`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
