import {
  MaterialFollowUpStatus,
  Prisma,
  PrismaClient,
  WarehouseExceptionCaseStatus,
} from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';

function loadLocalEnvironment() {
  if (process.env.DATABASE_URL || !existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function sameTime(first: Date | null, second: Date | null): boolean {
  return first?.getTime() === second?.getTime();
}

function hasArgument(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

loadLocalEnvironment();
const prisma = new PrismaClient();

async function main() {
  const snapshot = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [activeWarehouseTasks, openCases, resolvedCases, activeFollowUps] = await Promise.all([
      tx.warehouseMaterialTask.findMany({
        where: { status: 'exception' },
        select: {
          id: true,
          exceptionType: true,
          expectedAt: true,
          workOrder: { select: { code: true } },
          exceptionCases: {
            where: { status: WarehouseExceptionCaseStatus.OPEN },
            select: { id: true },
          },
        },
      }),
      tx.warehouseMaterialExceptionCase.findMany({
        where: { status: WarehouseExceptionCaseStatus.OPEN },
        select: {
          id: true,
          warehouseTaskId: true,
          exceptionType: true,
          expectedArrivalAt: true,
          warehouseTask: { select: { status: true, expectedAt: true, workOrder: { select: { code: true } } } },
          followUpTask: { select: { id: true, status: true, expectedAt: true } },
        },
      }),
      tx.warehouseMaterialExceptionCase.findMany({
        where: { status: WarehouseExceptionCaseStatus.RESOLVED },
        select: {
          id: true,
          resolvedAt: true,
          followUpTask: { select: { id: true, status: true, resolvedAt: true } },
        },
      }),
      tx.materialFollowUpTask.findMany({
        where: {
          status: {
            in: [
              MaterialFollowUpStatus.PENDING,
              MaterialFollowUpStatus.IN_PROGRESS,
              MaterialFollowUpStatus.WAITING_ARRIVAL,
              MaterialFollowUpStatus.WAITING_WAREHOUSE,
            ],
          },
        },
        select: {
          id: true,
          warehouseExceptionId: true,
          warehouseException: { select: { status: true } },
        },
      }),
    ]);
    return { activeWarehouseTasks, openCases, resolvedCases, activeFollowUps };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 60_000,
  });

  const findings: Array<{ code: string; entityId: string; message: string }> = [];
  const addFinding = (code: string, entityId: string, message: string) => {
    findings.push({ code, entityId, message });
  };

  for (const task of snapshot.activeWarehouseTasks) {
    if (task.exceptionCases.length !== 1) {
      addFinding(
        'ACTIVE_WAREHOUSE_EVENT_COUNT',
        task.id,
        `${task.workOrder.code} 当前异常必须且只能对应一个活动事件，实际 ${task.exceptionCases.length} 个`,
      );
    }
  }
  for (const exceptionCase of snapshot.openCases) {
    if (exceptionCase.warehouseTask.status !== 'exception') {
      addFinding('OPEN_EVENT_WITHOUT_WAREHOUSE_EXCEPTION', exceptionCase.id, '活动异常事件对应的仓库任务不是异常状态');
    }
    if (!exceptionCase.followUpTask) {
      addFinding('OPEN_EVENT_WITHOUT_FOLLOW_UP', exceptionCase.id, '活动异常事件没有对应物料跟进任务');
      continue;
    }
    if (
      exceptionCase.followUpTask.status === MaterialFollowUpStatus.RESOLVED
      || exceptionCase.followUpTask.status === MaterialFollowUpStatus.CANCELLED
    ) {
      addFinding('OPEN_EVENT_WITH_TERMINAL_FOLLOW_UP', exceptionCase.id, '活动异常事件对应的物料跟进已结束');
    }
    if (!sameTime(exceptionCase.expectedArrivalAt, exceptionCase.followUpTask.expectedAt)) {
      addFinding('EVENT_FOLLOW_UP_ETA_MISMATCH', exceptionCase.id, '异常事件与物料跟进的预计到料时间不一致');
    }
    if (!sameTime(exceptionCase.warehouseTask.expectedAt, exceptionCase.followUpTask.expectedAt)) {
      addFinding('WAREHOUSE_FOLLOW_UP_ETA_MISMATCH', exceptionCase.id, '仓库任务与物料跟进的预计到料时间不一致');
    }
  }
  for (const followUp of snapshot.activeFollowUps) {
    if (followUp.warehouseException.status !== WarehouseExceptionCaseStatus.OPEN) {
      addFinding('ACTIVE_FOLLOW_UP_WITHOUT_OPEN_EVENT', followUp.id, '活动物料跟进没有对应的活动异常事件');
    }
  }
  for (const exceptionCase of snapshot.resolvedCases) {
    if (!exceptionCase.followUpTask) {
      addFinding('RESOLVED_EVENT_WITHOUT_FOLLOW_UP', exceptionCase.id, '已解决异常事件没有归档物料跟进');
      continue;
    }
    if (exceptionCase.followUpTask.status !== MaterialFollowUpStatus.RESOLVED) {
      addFinding('RESOLVED_EVENT_STATUS_MISMATCH', exceptionCase.id, '异常事件已解决，但物料跟进未标记为已解决');
    }
    if (!sameTime(exceptionCase.resolvedAt, exceptionCase.followUpTask.resolvedAt)) {
      addFinding('RESOLVED_TIME_MISMATCH', exceptionCase.id, '仓库异常与物料跟进的解决时间不一致');
    }
  }

  const byType = snapshot.openCases.reduce<Record<string, number>>((counts, item) => {
    counts[item.exceptionType] = (counts[item.exceptionType] || 0) + 1;
    return counts;
  }, {});
  const result = {
    mode: 'READ_ONLY',
    passed: findings.length === 0,
    counts: {
      activeWarehouseExceptions: snapshot.activeWarehouseTasks.length,
      openExceptionEvents: snapshot.openCases.length,
      activeMaterialFollowUps: snapshot.activeFollowUps.length,
      resolvedExceptionEvents: snapshot.resolvedCases.length,
      findings: findings.length,
    },
    activeByExceptionType: byType,
    findings: findings.slice(0, 100),
  };

  if (hasArgument('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Warehouse / material follow-up sync audit');
    console.log('Mode: READ ONLY');
    console.log(`Result: ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log(
      `Counts: warehouse=${result.counts.activeWarehouseExceptions}, `
      + `events=${result.counts.openExceptionEvents}, `
      + `followUps=${result.counts.activeMaterialFollowUps}, `
      + `resolved=${result.counts.resolvedExceptionEvents}`,
    );
    console.log(`Active exception types: ${JSON.stringify(result.activeByExceptionType)}`);
    result.findings.forEach((finding, index) => {
      console.log(`${index + 1}. ${finding.code} | ${finding.entityId} | ${finding.message}`);
    });
    console.log('READ ONLY: no warehouse task, event, ETA, follow-up or history row was changed.');
  }
  if (!result.passed && !hasArgument('--no-fail')) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
