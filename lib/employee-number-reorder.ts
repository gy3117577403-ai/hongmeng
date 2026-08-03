import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Employee } from '@prisma/client';
import {
  EMPLOYEE_NUMBER_LOCK_KEY,
  EMPLOYEE_NUMBER_SEQUENCE_KEY,
  formatEmployeeNumber,
} from '@/lib/employee-number';
import {
  employeeHireDateToDate,
  formatEmployeeHireDate,
  normalizeEmployeeHireDateInput,
} from '@/lib/employee-date';
import { prisma } from '@/lib/prisma';
import { cleanProcessText, serializeEmployee } from '@/lib/process-time';

const MAX_REORDER_EMPLOYEES = 2_000;

type UnknownRecord = Record<string, unknown>;

export type EmployeeNumberReorderExistingInput = {
  kind: 'EXISTING';
  employeeId: string;
  targetEmployeeNo?: string;
  hireDate?: string | null;
};

export type EmployeeNumberReorderNewInput = {
  kind: 'NEW';
  clientKey: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isActive: boolean;
  attendanceEnabled: boolean;
  targetEmployeeNo?: string;
  hireDate?: string | null;
};

export type EmployeeNumberReorderInput =
  | EmployeeNumberReorderExistingInput
  | EmployeeNumberReorderNewInput;

export type EmployeeNumberReorderPreviewRow = {
  key: string;
  kind: 'EXISTING' | 'NEW';
  employeeId: string | null;
  oldEmployeeNo: string | null;
  newEmployeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isActive: boolean;
  attendanceEnabled: boolean;
  oldHireDate: string | null;
  hireDate: string | null;
  hireDateChanged: boolean;
  changed: boolean;
};

export type EmployeeNumberLinkSummary = {
  accountCount: number;
  attendanceCount: number;
  executionCount: number;
  laborClaimCount: number;
  dailyAssignmentCount: number;
  total: number;
};

export type EmployeeNumberReorderPreview = {
  rows: EmployeeNumberReorderPreviewRow[];
  rosterFingerprint: string;
  employeeCount: number;
  existingCount: number;
  createdCount: number;
  changedCount: number;
  inactiveCount: number;
  hasChanges: boolean;
  nextEmployeeNo: string;
  confirmationText: string;
  warnings: string[];
  preservedLinks: EmployeeNumberLinkSummary;
};

export class EmployeeNumberReorderError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'EmployeeNumberReorderError';
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function limitedText(value: unknown, maxLength: number): string {
  return cleanProcessText(value, maxLength);
}

export function parseEmployeeNumberReorderItems(value: unknown): EmployeeNumberReorderInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EmployeeNumberReorderError('编号重排名单不能为空', 'EMPLOYEE_REORDER_EMPTY');
  }
  if (value.length > MAX_REORDER_EMPLOYEES) {
    throw new EmployeeNumberReorderError(
      `单次最多处理 ${MAX_REORDER_EMPLOYEES} 名员工`,
      'EMPLOYEE_REORDER_TOO_LARGE',
    );
  }

  const existingIds = new Set<string>();
  const newKeys = new Set<string>();
  const targetEmployeeNumbers = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item);
    const kind = String(record.kind || '').trim().toUpperCase();
    const rawTargetEmployeeNo = limitedText(record.targetEmployeeNo, 20);
    let targetEmployeeNo: string | undefined;
    if (rawTargetEmployeeNo) {
      if (!/^\d+$/.test(rawTargetEmployeeNo)) {
        throw new EmployeeNumberReorderError(
          `第 ${index + 1} 行目标工号必须是正整数`,
          'EMPLOYEE_REORDER_TARGET_NUMBER_INVALID',
        );
      }
      const numeric = Number(rawTargetEmployeeNo);
      if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 999_999_999) {
        throw new EmployeeNumberReorderError(
          `第 ${index + 1} 行目标工号超出允许范围`,
          'EMPLOYEE_REORDER_TARGET_NUMBER_INVALID',
        );
      }
      targetEmployeeNo = formatEmployeeNumber(numeric);
      if (targetEmployeeNumbers.has(targetEmployeeNo)) {
        throw new EmployeeNumberReorderError(
          `目标工号 ${targetEmployeeNo} 在名单中重复`,
          'EMPLOYEE_REORDER_DUPLICATE_TARGET_NUMBER',
        );
      }
      targetEmployeeNumbers.add(targetEmployeeNo);
    }
    const hasHireDate = Object.prototype.hasOwnProperty.call(record, 'hireDate');
    let hireDate: string | null | undefined;
    if (hasHireDate) {
      try {
        hireDate = normalizeEmployeeHireDateInput(record.hireDate);
      } catch {
        throw new EmployeeNumberReorderError(
          `第 ${index + 1} 行入职日期无效，请使用 YYYY-MM-DD`,
          'EMPLOYEE_REORDER_HIRE_DATE_INVALID',
        );
      }
    }
    if (kind === 'EXISTING') {
      const employeeId = limitedText(record.employeeId, 80);
      if (!employeeId) {
        throw new EmployeeNumberReorderError(
          `第 ${index + 1} 行缺少员工标识`,
          'EMPLOYEE_REORDER_EMPLOYEE_REQUIRED',
        );
      }
      if (existingIds.has(employeeId)) {
        throw new EmployeeNumberReorderError(
          `员工 ${employeeId} 在名单中重复`,
          'EMPLOYEE_REORDER_DUPLICATE_EMPLOYEE',
        );
      }
      existingIds.add(employeeId);
      return {
        kind: 'EXISTING',
        employeeId,
        ...(targetEmployeeNo ? { targetEmployeeNo } : {}),
        ...(hasHireDate ? { hireDate: hireDate ?? null } : {}),
      };
    }
    if (kind !== 'NEW') {
      throw new EmployeeNumberReorderError(
        `第 ${index + 1} 行人员类型无效`,
        'EMPLOYEE_REORDER_KIND_INVALID',
      );
    }

    const clientKey = limitedText(record.clientKey, 100) || `new-${index + 1}`;
    const name = limitedText(record.name, 80);
    if (!name) {
      throw new EmployeeNumberReorderError(
        `第 ${index + 1} 行补录人员缺少姓名`,
        'EMPLOYEE_REORDER_NAME_REQUIRED',
      );
    }
    if (newKeys.has(clientKey)) {
      throw new EmployeeNumberReorderError(
        `补录人员标识 ${clientKey} 重复`,
        'EMPLOYEE_REORDER_DUPLICATE_NEW_KEY',
      );
    }
    newKeys.add(clientKey);
    return {
      kind: 'NEW',
      clientKey,
      name,
      department: limitedText(record.department, 80) || null,
      position: limitedText(record.position, 80) || null,
      team: limitedText(record.team, 80) || null,
      isActive: record.isActive !== false,
      attendanceEnabled: record.attendanceEnabled !== false,
      ...(targetEmployeeNo ? { targetEmployeeNo } : {}),
      ...(hasHireDate ? { hireDate: hireDate ?? null } : {}),
    };
  });
}

export function employeeRosterFingerprint(employees: Array<Pick<Employee, 'id' | 'employeeNo' | 'updatedAt'>>): string {
  const source = employees
    .map(employee => [employee.id, employee.employeeNo, new Date(employee.updatedAt).toISOString()])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

function emptyLinkSummary(): EmployeeNumberLinkSummary {
  return {
    accountCount: 0,
    attendanceCount: 0,
    executionCount: 0,
    laborClaimCount: 0,
    dailyAssignmentCount: 0,
    total: 0,
  };
}

export function buildEmployeeNumberReorderPreview(input: {
  employees: Employee[];
  items: EmployeeNumberReorderInput[];
  preservedLinks?: EmployeeNumberLinkSummary;
}): EmployeeNumberReorderPreview {
  const employeeById = new Map(input.employees.map(employee => [employee.id, employee]));
  const listedExistingIds = input.items
    .filter((item): item is EmployeeNumberReorderExistingInput => item.kind === 'EXISTING')
    .map(item => item.employeeId);
  const listedExistingSet = new Set(listedExistingIds);
  const unknownIds = listedExistingIds.filter(id => !employeeById.has(id));
  if (unknownIds.length > 0) {
    throw new EmployeeNumberReorderError(
      '名单中存在已删除或不可用的员工，请刷新后重新编排',
      'EMPLOYEE_REORDER_UNKNOWN_EMPLOYEE',
      409,
    );
  }
  const missingEmployees = input.employees.filter(employee => !listedExistingSet.has(employee.id));
  if (missingEmployees.length > 0) {
    const names = missingEmployees.slice(0, 5).map(employee => `${employee.employeeNo} ${employee.name}`).join('、');
    throw new EmployeeNumberReorderError(
      `必须保留全部现有员工，当前缺少：${names}${missingEmployees.length > 5 ? ` 等 ${missingEmployees.length} 人` : ''}`,
      'EMPLOYEE_REORDER_ROSTER_INCOMPLETE',
      409,
    );
  }

  const reservedTargetNumbers = new Set(
    input.items.flatMap(item => item.targetEmployeeNo ? [item.targetEmployeeNo] : []),
  );
  let automaticNumber = 1;
  const resolvedTargetNumbers = input.items.map(item => {
    if (item.targetEmployeeNo) return item.targetEmployeeNo;
    while (reservedTargetNumbers.has(formatEmployeeNumber(automaticNumber))) automaticNumber += 1;
    const employeeNo = formatEmployeeNumber(automaticNumber);
    reservedTargetNumbers.add(employeeNo);
    automaticNumber += 1;
    return employeeNo;
  });

  const rows = input.items.map<EmployeeNumberReorderPreviewRow>((item, index) => {
    const newEmployeeNo = resolvedTargetNumbers[index];
    if (item.kind === 'EXISTING') {
      const employee = employeeById.get(item.employeeId)!;
      const oldHireDate = formatEmployeeHireDate(employee.hireDate);
      const hireDate = item.hireDate === undefined ? oldHireDate : item.hireDate;
      const hireDateChanged = oldHireDate !== hireDate;
      return {
        key: `existing:${employee.id}`,
        kind: 'EXISTING',
        employeeId: employee.id,
        oldEmployeeNo: employee.employeeNo,
        newEmployeeNo,
        name: employee.name,
        department: employee.department,
        position: employee.position,
        team: employee.team,
        isActive: employee.isActive,
        attendanceEnabled: employee.attendanceEnabled,
        oldHireDate,
        hireDate,
        hireDateChanged,
        changed: employee.employeeNo !== newEmployeeNo || hireDateChanged,
      };
    }
    return {
      key: `new:${item.clientKey}`,
      kind: 'NEW',
      employeeId: null,
      oldEmployeeNo: null,
      newEmployeeNo,
      name: item.name,
      department: item.department,
      position: item.position,
      team: item.team,
      isActive: item.isActive,
      attendanceEnabled: item.attendanceEnabled,
      oldHireDate: null,
      hireDate: item.hireDate ?? null,
      hireDateChanged: Boolean(item.hireDate),
      changed: true,
    };
  });

  const createdCount = rows.filter(row => row.kind === 'NEW').length;
  const existingCount = rows.length - createdCount;
  const changedCount = rows.filter(row => row.changed).length;
  const inactiveCount = rows.filter(row => !row.isActive).length;
  const hireDateChangedCount = rows.filter(row => row.hireDateChanged).length;
  const nextValue = Math.max(
    ...rows.map(row => Number(row.newEmployeeNo)).filter(Number.isSafeInteger),
    0,
  ) + 1;
  const warnings = [
    ...(inactiveCount > 0 ? [`名单包含 ${inactiveCount} 名停用员工；保留在批次中可以避免历史编号被静默复用。`] : []),
    ...(createdCount > 0 ? [`提交时将同时新建 ${createdCount} 份补录员工档案。`] : []),
    ...(hireDateChangedCount > 0 ? [`将写入或更新 ${hireDateChangedCount} 人的真实入职日期。`] : []),
    '员工、考勤、生产、日计划和账号的内部 UUID 关联不会改变。',
  ];

  return {
    rows,
    rosterFingerprint: employeeRosterFingerprint(input.employees),
    employeeCount: rows.length,
    existingCount,
    createdCount,
    changedCount,
    inactiveCount,
    hasChanges: changedCount > 0,
    nextEmployeeNo: formatEmployeeNumber(nextValue),
    confirmationText: `确认重排${rows.length}人`,
    warnings,
    preservedLinks: input.preservedLinks || emptyLinkSummary(),
  };
}

async function employeeLinkSummary(employeeIds: string[]): Promise<EmployeeNumberLinkSummary> {
  if (employeeIds.length === 0) return emptyLinkSummary();
  const [accountCount, attendanceCount, executionCount, laborClaimCount, dailyAssignmentCount] = await Promise.all([
    prisma.user.count({ where: { employeeId: { in: employeeIds } } }),
    prisma.attendanceRecord.count({ where: { employeeId: { in: employeeIds } } }),
    prisma.processExecution.count({ where: { employeeId: { in: employeeIds } } }),
    prisma.processLaborClaim.count({ where: { employeeId: { in: employeeIds } } }),
    prisma.dailyTaskAssignment.count({ where: { employeeId: { in: employeeIds } } }),
  ]);
  return {
    accountCount,
    attendanceCount,
    executionCount,
    laborClaimCount,
    dailyAssignmentCount,
    total: accountCount + attendanceCount + executionCount + laborClaimCount + dailyAssignmentCount,
  };
}

export async function previewEmployeeNumberReorder(value: unknown): Promise<EmployeeNumberReorderPreview> {
  const items = parseEmployeeNumberReorderItems(value);
  const employees = await prisma.employee.findMany({
    orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
  });
  const preservedLinks = await employeeLinkSummary(employees.map(employee => employee.id));
  return buildEmployeeNumberReorderPreview({ employees, items, preservedLinks });
}

function employeeNumberReorderRequestHash(items: EmployeeNumberReorderInput[], rosterFingerprint: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ items, rosterFingerprint }))
    .digest('hex');
}

function serializeBatch(batch: {
  id: string;
  employeeCount: number;
  existingCount: number;
  createdCount: number;
  changedCount: number;
  previousNextValue: number;
  nextValue: number;
  createdAt: Date;
  createdBy: { displayName: string };
  items: Array<{
    employeeId: string;
    sequence: number;
    oldEmployeeNo: string | null;
    newEmployeeNo: string;
    wasCreated: boolean;
    employee: Employee;
  }>;
}) {
  return {
    id: batch.id,
    employeeCount: batch.employeeCount,
    existingCount: batch.existingCount,
    createdCount: batch.createdCount,
    changedCount: batch.changedCount,
    previousNextEmployeeNo: formatEmployeeNumber(batch.previousNextValue),
    nextEmployeeNo: formatEmployeeNumber(batch.nextValue),
    createdAt: batch.createdAt.toISOString(),
    createdByName: batch.createdBy.displayName,
    items: batch.items
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map(item => ({
        employeeId: item.employeeId,
        sequence: item.sequence,
        oldEmployeeNo: item.oldEmployeeNo,
        newEmployeeNo: item.newEmployeeNo,
        wasCreated: item.wasCreated,
        name: item.employee.name,
        department: item.employee.department,
        position: item.employee.position,
        team: item.employee.team,
        hireDate: formatEmployeeHireDate(item.employee.hireDate),
      })),
  };
}

const batchInclude = {
  createdBy: { select: { displayName: true } },
  items: { include: { employee: true }, orderBy: { sequence: 'asc' as const } },
} as const;

export async function listEmployeeNumberReorderBatches() {
  const batches = await prisma.employeeNumberReorderBatch.findMany({
    include: batchInclude,
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return batches.map(serializeBatch);
}

export async function commitEmployeeNumberReorder(input: {
  actorUserId: string;
  idempotencyKey: string;
  items: unknown;
  rosterFingerprint: unknown;
  confirmationText: unknown;
}) {
  const idempotencyKey = limitedText(input.idempotencyKey, 120);
  if (!idempotencyKey) {
    throw new EmployeeNumberReorderError('缺少幂等请求标识', 'EMPLOYEE_REORDER_IDEMPOTENCY_REQUIRED');
  }
  const items = parseEmployeeNumberReorderItems(input.items);
  const rosterFingerprint = limitedText(input.rosterFingerprint, 128);
  const confirmationText = limitedText(input.confirmationText, 80);
  if (!rosterFingerprint) {
    throw new EmployeeNumberReorderError('请先生成最新预览', 'EMPLOYEE_REORDER_PREVIEW_REQUIRED', 409);
  }
  const requestHash = employeeNumberReorderRequestHash(items, rosterFingerprint);

  const existingBatch = await prisma.employeeNumberReorderBatch.findUnique({
    where: { idempotencyKey },
    include: batchInclude,
  });
  if (existingBatch) {
    if (existingBatch.requestHash !== requestHash) {
      throw new EmployeeNumberReorderError(
        '相同请求标识已用于其他编号重排内容',
        'EMPLOYEE_REORDER_IDEMPOTENCY_CONFLICT',
        409,
      );
    }
    const employees = await prisma.employee.findMany({ orderBy: { employeeNo: 'asc' } });
    return { batch: serializeBatch(existingBatch), employees: employees.map(serializeEmployee), replayed: true };
  }

  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ locked: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${EMPLOYEE_NUMBER_LOCK_KEY}))::text AS "locked"
      `;
      await tx.$executeRaw`
        INSERT INTO "employee_number_sequences" ("key", "next_value", "created_at", "updated_at")
        VALUES (${EMPLOYEE_NUMBER_SEQUENCE_KEY}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("key") DO NOTHING
      `;
      const sequenceRows = await tx.$queryRaw<Array<{ nextValue: number }>>`
        SELECT "next_value" AS "nextValue"
        FROM "employee_number_sequences"
        WHERE "key" = ${EMPLOYEE_NUMBER_SEQUENCE_KEY}
        FOR UPDATE
      `;
      const previousNextValue = Number(sequenceRows[0]?.nextValue || 1);

      const replay = await tx.employeeNumberReorderBatch.findUnique({
        where: { idempotencyKey },
        include: batchInclude,
      });
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new EmployeeNumberReorderError(
            '相同请求标识已用于其他编号重排内容',
            'EMPLOYEE_REORDER_IDEMPOTENCY_CONFLICT',
            409,
          );
        }
        const employees = await tx.employee.findMany({ orderBy: { employeeNo: 'asc' } });
        return { batch: serializeBatch(replay), employees: employees.map(serializeEmployee), replayed: true };
      }

      const employees = await tx.employee.findMany({
        orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
      });
      const preview = buildEmployeeNumberReorderPreview({ employees, items });
      if (preview.rosterFingerprint !== rosterFingerprint) {
        throw new EmployeeNumberReorderError(
          '员工名单或档案已发生变化，请刷新后重新预览',
          'EMPLOYEE_REORDER_STALE_PREVIEW',
          409,
        );
      }
      if (confirmationText !== preview.confirmationText) {
        throw new EmployeeNumberReorderError(
          `请输入“${preview.confirmationText}”后再执行`,
          'EMPLOYEE_REORDER_CONFIRMATION_MISMATCH',
        );
      }
      if (!preview.hasChanges) {
        throw new EmployeeNumberReorderError('当前名单和编号没有变化，无需执行重排', 'EMPLOYEE_REORDER_NO_CHANGES');
      }

      const temporaryToken = randomUUID();
      const existingRows = preview.rows.filter(row => row.kind === 'EXISTING');
      for (let index = 0; index < existingRows.length; index += 1) {
        const row = existingRows[index];
        await tx.employee.update({
          where: { id: row.employeeId! },
          data: { employeeNo: `TMP-${temporaryToken}-${index + 1}` },
        });
      }

      const appliedItems: Array<{
        employeeId: string;
        sequence: number;
        oldEmployeeNo: string | null;
        newEmployeeNo: string;
        wasCreated: boolean;
        employeeData: Prisma.InputJsonValue;
      }> = [];
      for (let index = 0; index < preview.rows.length; index += 1) {
        const row = preview.rows[index];
        const source = items[index];
        const employee = row.kind === 'EXISTING'
          ? await tx.employee.update({
            where: { id: row.employeeId! },
            data: {
              employeeNo: row.newEmployeeNo,
              ...(source.hireDate !== undefined
                ? { hireDate: employeeHireDateToDate(source.hireDate) }
                : {}),
            },
          })
          : await tx.employee.create({
            data: {
              employeeNo: row.newEmployeeNo,
              name: row.name,
              department: row.department,
              position: row.position,
              team: row.team,
              hireDate: employeeHireDateToDate(source.kind === 'NEW' ? source.hireDate ?? null : null),
              isActive: source.kind === 'NEW' ? source.isActive : true,
              attendanceEnabled: source.kind === 'NEW' ? source.attendanceEnabled : true,
            },
          });
        appliedItems.push({
          employeeId: employee.id,
          sequence: index + 1,
          oldEmployeeNo: row.oldEmployeeNo,
          newEmployeeNo: row.newEmployeeNo,
          wasCreated: row.kind === 'NEW',
          employeeData: {
            name: employee.name,
            department: employee.department,
            position: employee.position,
            team: employee.team,
            hireDate: formatEmployeeHireDate(employee.hireDate),
            isActive: employee.isActive,
            attendanceEnabled: employee.attendanceEnabled,
          } as Prisma.InputJsonValue,
        });
      }

      const nextValue = Number(preview.nextEmployeeNo);
      await tx.employeeNumberSequence.update({
        where: { key: EMPLOYEE_NUMBER_SEQUENCE_KEY },
        data: { nextValue },
      });
      const batch = await tx.employeeNumberReorderBatch.create({
        data: {
          idempotencyKey,
          requestHash,
          rosterFingerprint,
          startNumber: 1,
          employeeCount: preview.employeeCount,
          existingCount: preview.existingCount,
          createdCount: preview.createdCount,
          changedCount: preview.changedCount,
          previousNextValue,
          nextValue,
          createdById: input.actorUserId,
          items: { create: appliedItems },
        },
        include: batchInclude,
      });
      await tx.operationLog.create({
        data: {
          userId: input.actorUserId,
          action: 'reorder_employee_numbers',
          targetType: 'employee_number_reorder_batch',
          targetId: batch.id,
          detail: {
            employeeCount: preview.employeeCount,
            existingCount: preview.existingCount,
            createdCount: preview.createdCount,
            changedCount: preview.changedCount,
            previousNextEmployeeNo: formatEmployeeNumber(previousNextValue),
            nextEmployeeNo: formatEmployeeNumber(nextValue),
          },
        },
      });
      const updatedEmployees = await tx.employee.findMany({ orderBy: { employeeNo: 'asc' } });
      return {
        batch: serializeBatch(batch),
        employees: updatedEmployees.map(serializeEmployee),
        replayed: false,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    if (error instanceof EmployeeNumberReorderError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'P2034') {
      throw new EmployeeNumberReorderError(
        '员工数据正在被其他操作修改，请刷新预览后重试',
        'EMPLOYEE_REORDER_CONCURRENT_CHANGE',
        409,
      );
    }
    if (code === 'P2002') {
      throw new EmployeeNumberReorderError(
        '编号重排发生唯一性冲突，事务已全部回滚',
        'EMPLOYEE_REORDER_UNIQUE_CONFLICT',
        409,
      );
    }
    throw error;
  }
}
