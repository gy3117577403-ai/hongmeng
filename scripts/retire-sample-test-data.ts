import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { commitSampleTestCleanup, previewSampleTestCleanup, type SampleTaskDeleteMode } from '../lib/sample-task-deletion';

function values(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).filter(arg => arg.startsWith(prefix)).map(arg => arg.slice(prefix.length).trim()).filter(Boolean);
}

function value(name: string) {
  return values(name)[0] || '';
}

async function main() {
  const execute = process.argv.includes('--execute');
  const taskIds = values('task-id');
  const mode: SampleTaskDeleteMode = value('mode') === 'RETIRE_TEST_OUTPUTS' ? 'RETIRE_TEST_OUTPUTS' : 'REMOVE_TASK_ONLY';
  if (!taskIds.length) throw new Error('必须使用一个或多个 --task-id=<精确任务ID>，本工具不会按日期、客户或关键词猜测范围。');

  const preview = await previewSampleTestCleanup(taskIds, mode);
  process.stdout.write(`${JSON.stringify({ operation: execute ? 'execute' : 'dry-run', preview }, null, 2)}\n`);
  if (!execute) {
    process.stdout.write('\n仅生成预览，没有修改数据。确认清单后再使用 --execute。\n');
    return;
  }

  const actorName = value('actor');
  const reason = value('reason');
  const confirmationText = value('confirm');
  if (!actorName) throw new Error('执行模式必须提供 --actor=<管理员用户名>。');
  if (!reason) throw new Error('执行模式必须提供 --reason=<清理原因>。');
  const actor = await prisma.user.findFirst({ where: { username: actorName, isActive: true } });
  if (!actor || actor.laborRole !== 'ADMIN') throw new Error('指定账号不是有效的系统管理员。');
  const expectedConfirmation = `退役 ${preview.items.length} 条样品测试数据`;
  if (confirmationText !== expectedConfirmation) throw new Error(`执行确认不匹配，必须提供 --confirm="${expectedConfirmation}"。`);

  const result = await commitSampleTestCleanup({
    taskIds,
    mode,
    actorId: actor.id,
    actorName: actor.displayName || actor.username,
    reason,
    previewToken: preview.previewToken,
    confirmationText,
    confirmed: true,
    clientMutationId: `sample-test-cleanup-cli-${randomUUID()}`,
  });
  process.stdout.write(`${JSON.stringify({ operation: 'completed', result }, null, 2)}\n`);
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
