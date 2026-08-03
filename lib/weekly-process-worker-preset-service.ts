import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { productionDateKey, productionWeekDateBounds } from '@/lib/production-week';
import {
  weeklyProcessKey,
  weeklyProcessPresetScopeKey,
} from '@/lib/weekly-process-domain';

export class WeeklyProcessWorkerPresetError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'WeeklyProcessWorkerPresetError';
    this.status = status;
    this.code = code;
  }
}

const presetInclude = {
  members: {
    include: { employee: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.WeeklyProcessWorkerPresetInclude;

type PresetRecord = Prisma.WeeklyProcessWorkerPresetGetPayload<{ include: typeof presetInclude }>;

export type WeeklyProcessWorkerPresetDTO = {
  id: string;
  weekStartDate: string;
  scope: 'PROCESS' | 'STEP';
  scopeKey: string;
  processKey: string;
  processDefinitionId: string | null;
  stepId: string | null;
  version: number;
  employees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    department: string | null;
    position: string | null;
    team: string | null;
    isActive: boolean;
    priority: number;
  }>;
  updatedAt: string;
};

function serializePreset(preset: PresetRecord): WeeklyProcessWorkerPresetDTO {
  return {
    id: preset.id,
    weekStartDate: productionDateKey(preset.weekStartDate),
    scope: preset.stepId ? 'STEP' : 'PROCESS',
    scopeKey: preset.scopeKey,
    processKey: preset.processKey,
    processDefinitionId: preset.processDefinitionId,
    stepId: preset.stepId,
    version: preset.version,
    employees: preset.members.map(member => ({
      id: member.employee.id,
      employeeNo: member.employee.employeeNo,
      name: member.employee.name,
      department: member.employee.department,
      position: member.employee.position,
      team: member.employee.team,
      isActive: member.employee.isActive,
      priority: member.position,
    })),
    updatedAt: preset.updatedAt.toISOString(),
  };
}

function cleanProcessKey(value: unknown): string {
  const processKey = String(value || '').trim();
  if (
    !processKey
    || processKey.length > 240
    || (!processKey.startsWith('definition:') && !processKey.startsWith('legacy:'))
  ) {
    throw new WeeklyProcessWorkerPresetError(
      '请选择有效工序后再配置人员',
      400,
      'WEEKLY_PROCESS_PRESET_PROCESS_INVALID',
    );
  }
  return processKey;
}

function cleanStepId(value: unknown): string | null {
  const stepId = String(value || '').trim();
  if (!stepId) return null;
  if (stepId.length > 80) {
    throw new WeeklyProcessWorkerPresetError(
      '工序明细标识无效',
      400,
      'WEEKLY_PROCESS_PRESET_STEP_INVALID',
    );
  }
  return stepId;
}

function cleanEmployeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new WeeklyProcessWorkerPresetError(
      '预选人员必须是员工列表',
      400,
      'WEEKLY_PROCESS_PRESET_EMPLOYEES_INVALID',
    );
  }
  const ids = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  if (ids.length > 100 || ids.some(id => id.length > 80)) {
    throw new WeeklyProcessWorkerPresetError(
      '单个工序最多预选100名员工',
      400,
      'WEEKLY_PROCESS_PRESET_EMPLOYEES_INVALID',
    );
  }
  return ids;
}

function cleanExpectedVersion(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new WeeklyProcessWorkerPresetError(
      '人员配置版本无效，请刷新后重试',
      400,
      'WEEKLY_PROCESS_PRESET_VERSION_INVALID',
    );
  }
  return version;
}

async function validatePresetTarget(input: {
  processKey: string;
  stepId: string | null;
}): Promise<{ processDefinitionId: string | null }> {
  if (input.stepId) {
    const step = await prisma.workOrderProcessStep.findUnique({
      where: { id: input.stepId },
      select: {
        processDefinitionId: true,
        processCode: true,
        processName: true,
      },
    });
    if (!step) {
      throw new WeeklyProcessWorkerPresetError(
        '所选工序明细已不存在，请刷新后重试',
        404,
        'WEEKLY_PROCESS_PRESET_STEP_NOT_FOUND',
      );
    }
    const actualKey = weeklyProcessKey(step);
    if (actualKey !== input.processKey) {
      throw new WeeklyProcessWorkerPresetError(
        '工序明细已发生变化，请刷新后重新配置',
        409,
        'WEEKLY_PROCESS_PRESET_STEP_CHANGED',
      );
    }
    return { processDefinitionId: step.processDefinitionId };
  }
  if (!input.processKey.startsWith('definition:')) return { processDefinitionId: null };
  const processDefinitionId = input.processKey.slice('definition:'.length);
  const exists = await prisma.processDefinition.count({ where: { id: processDefinitionId } });
  if (!exists) {
    throw new WeeklyProcessWorkerPresetError(
      '所选工序已不存在，请刷新后重试',
      404,
      'WEEKLY_PROCESS_PRESET_PROCESS_NOT_FOUND',
    );
  }
  return { processDefinitionId };
}

export async function listWeeklyProcessWorkerPresets(
  weekDate: string | Date,
): Promise<WeeklyProcessWorkerPresetDTO[]> {
  const week = productionWeekDateBounds(weekDate);
  const presets = await prisma.weeklyProcessWorkerPreset.findMany({
    where: { weekStartDate: week.startDate },
    include: presetInclude,
    orderBy: [{ processKey: 'asc' }, { scopeKey: 'asc' }],
  });
  return presets.map(serializePreset);
}

export function resolveWeeklyProcessWorkerPreset(
  presets: WeeklyProcessWorkerPresetDTO[],
  input: { processKey: string; stepId?: string | null },
): WeeklyProcessWorkerPresetDTO | null {
  const stepScope = input.stepId
    ? weeklyProcessPresetScopeKey({ processKey: input.processKey, stepId: input.stepId })
    : '';
  return presets.find(preset => stepScope && preset.scopeKey === stepScope)
    || presets.find(preset => preset.scopeKey === weeklyProcessPresetScopeKey({ processKey: input.processKey }))
    || null;
}

export async function loadWeeklyProcessWorkerPresetForStep(input: {
  weekDate: string | Date | null | undefined;
  processDefinitionId?: string | null;
  processCode?: string | null;
  processName?: string | null;
  stepId: string;
}): Promise<WeeklyProcessWorkerPresetDTO | null> {
  if (!input.weekDate) return null;
  const processKey = weeklyProcessKey(input);
  const week = productionWeekDateBounds(input.weekDate);
  const scopeKeys = [
    weeklyProcessPresetScopeKey({ processKey, stepId: input.stepId }),
    weeklyProcessPresetScopeKey({ processKey }),
  ];
  const presets = await prisma.weeklyProcessWorkerPreset.findMany({
    where: { weekStartDate: week.startDate, scopeKey: { in: scopeKeys } },
    include: presetInclude,
  });
  const serialized = presets.map(serializePreset);
  return resolveWeeklyProcessWorkerPreset(serialized, { processKey, stepId: input.stepId });
}

export async function saveWeeklyProcessWorkerPreset(input: {
  weekDate: string | Date;
  processKey: unknown;
  stepId?: unknown;
  employeeIds: unknown;
  expectedVersion?: unknown;
  actorId: string;
}): Promise<WeeklyProcessWorkerPresetDTO | null> {
  const processKey = cleanProcessKey(input.processKey);
  const stepId = cleanStepId(input.stepId);
  const employeeIds = cleanEmployeeIds(input.employeeIds);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const week = productionWeekDateBounds(input.weekDate);
  const scopeKey = weeklyProcessPresetScopeKey({ processKey, stepId });
  const target = await validatePresetTarget({ processKey, stepId });
  const employees = employeeIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: employeeIds }, isActive: true },
        select: { id: true },
      })
    : [];
  if (employees.length !== employeeIds.length) {
    throw new WeeklyProcessWorkerPresetError(
      '部分预选员工已离职或停用，请刷新后重新选择',
      400,
      'WEEKLY_PROCESS_PRESET_EMPLOYEE_INACTIVE',
    );
  }

  const presetId = await prisma.$transaction(async tx => {
    const current = await tx.weeklyProcessWorkerPreset.findUnique({
      where: {
        weekStartDate_scopeKey: {
          weekStartDate: week.startDate,
          scopeKey,
        },
      },
      select: { id: true, version: true },
    });
    if (expectedVersion !== null && current?.version !== expectedVersion) {
      throw new WeeklyProcessWorkerPresetError(
        '人员配置已被其他操作更新，请刷新后重试',
        409,
        'WEEKLY_PROCESS_PRESET_VERSION_CONFLICT',
      );
    }
    if (!employeeIds.length) {
      if (current) await tx.weeklyProcessWorkerPreset.delete({ where: { id: current.id } });
      return null;
    }
    if (!current) {
      const created = await tx.weeklyProcessWorkerPreset.create({
        data: {
          weekStartDate: week.startDate,
          scopeKey,
          processKey,
          processDefinitionId: target.processDefinitionId,
          stepId,
          createdById: input.actorId,
          updatedById: input.actorId,
          members: {
            create: employeeIds.map((employeeId, position) => ({ employeeId, position })),
          },
        },
        select: { id: true },
      });
      return created.id;
    }
    const updated = await tx.weeklyProcessWorkerPreset.updateMany({
      where: { id: current.id, version: current.version },
      data: {
        processKey,
        processDefinitionId: target.processDefinitionId,
        stepId,
        updatedById: input.actorId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new WeeklyProcessWorkerPresetError(
        '人员配置已被其他操作更新，请刷新后重试',
        409,
        'WEEKLY_PROCESS_PRESET_VERSION_CONFLICT',
      );
    }
    await tx.weeklyProcessWorkerPresetMember.deleteMany({ where: { presetId: current.id } });
    await tx.weeklyProcessWorkerPresetMember.createMany({
      data: employeeIds.map((employeeId, position) => ({
        presetId: current.id,
        employeeId,
        position,
      })),
    });
    return current.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!presetId) return null;
  const result = await prisma.weeklyProcessWorkerPreset.findUnique({
    where: { id: presetId },
    include: presetInclude,
  });
  if (!result) {
    throw new WeeklyProcessWorkerPresetError(
      '人员配置保存后未找到，请刷新后重试',
      409,
      'WEEKLY_PROCESS_PRESET_SAVE_CONFLICT',
    );
  }
  return serializePreset(result);
}
