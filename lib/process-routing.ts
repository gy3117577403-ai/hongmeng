import { Prisma } from '@prisma/client';
import type {
  ProcessRouteStatus,
  ProcessStageGroup,
  ProcessStepStatus,
  ProcessTemplateDTO,
  ProcessTemplateStepDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';

export const PROCESS_STAGE_GROUPS: ProcessStageGroup[] = ['frontend', 'backend', 'finish'];
export const PROCESS_ROUTE_STATUSES: ProcessRouteStatus[] = ['draft', 'confirmed', 'in_progress', 'completed'];
export const PROCESS_STEP_STATUSES: ProcessStepStatus[] = ['pending', 'current', 'completed', 'skipped'];

export const processStageGroupText: Record<ProcessStageGroup, string> = {
  frontend: '前端工序',
  backend: '后端工序',
  finish: '完工工序',
};

export const processRouteStatusText: Record<ProcessRouteStatus, string> = {
  draft: '待确认',
  confirmed: '已确认',
  in_progress: '生产中',
  completed: '已完成',
};

export const processStepStatusText: Record<ProcessStepStatus, string> = {
  pending: '待开始',
  current: '当前工序',
  completed: '已完成',
  skipped: '已跳过',
};

export const PROCESS_SHORTCUT_GROUPS: Array<{
  key: string;
  name: string;
  processCodes: string[];
}> = [
  { key: 'crimp', name: '压接组', processCodes: ['crimping', 'crimp_inspection'] },
  { key: 'solder', name: '焊接组', processCodes: ['soldering', 'solder_inspection'] },
  { key: 'heat-shrink', name: '热缩组', processCodes: ['heat_shrink_tube', 'positioning', 'heat_shrink'] },
  { key: 'inspection', name: '检验组', processCodes: ['continuity_test', 'inspection'] },
];

export const processTemplateInclude = Prisma.validator<Prisma.ProcessTemplateInclude>()({
  createdBy: { select: { id: true, username: true, displayName: true } },
  steps: {
    orderBy: { position: 'asc' },
  },
});

export const processRouteInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  confirmedBy: { select: { id: true, username: true, displayName: true } },
  steps: {
    orderBy: { position: 'asc' },
    include: { completedBy: { select: { id: true, username: true, displayName: true } } },
  },
  activities: {
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: { actor: { select: { id: true, username: true, displayName: true } } },
  },
});

export const processRouteSummaryInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  steps: { orderBy: { position: 'asc' } },
});

export type ProcessTemplateRecord = Prisma.ProcessTemplateGetPayload<{
  include: typeof processTemplateInclude;
}>;

export type ProcessRouteRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof processRouteInclude;
}>;

export type ProcessRouteSummaryRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof processRouteSummaryInclude;
}>;

export type ProcessStepInput = {
  processDefinitionId?: unknown;
  processCode?: unknown;
  processName?: unknown;
  stageGroup?: unknown;
};

export type ValidatedProcessStep = {
  processDefinitionId: string | null;
  processCode: string;
  processName: string;
  stageGroup: ProcessStageGroup;
  position: number;
};

export type ProcessStepValidationResult =
  | { ok: true; steps: ValidatedProcessStep[] }
  | { ok: false; error: string };

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeRouteStatus(value: string): ProcessRouteStatus {
  return PROCESS_ROUTE_STATUSES.includes(value as ProcessRouteStatus)
    ? value as ProcessRouteStatus
    : 'draft';
}

function normalizeStepStatus(value: string): ProcessStepStatus {
  return PROCESS_STEP_STATUSES.includes(value as ProcessStepStatus)
    ? value as ProcessStepStatus
    : 'pending';
}

export function normalizeProcessStageGroup(value: unknown): ProcessStageGroup | null {
  const normalized = cleanText(value, 30) as ProcessStageGroup;
  return PROCESS_STAGE_GROUPS.includes(normalized) ? normalized : null;
}

export function processStageForGroup(stageGroup: ProcessStageGroup): 'frontend' | 'backend' {
  return stageGroup === 'frontend' ? 'frontend' : 'backend';
}

export function validateProcessSteps(input: unknown): ProcessStepValidationResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: '工艺路线至少需要一个工序' };
  }
  if (input.length > 40) {
    return { ok: false, error: '单条工艺路线最多支持 40 个工序' };
  }

  const steps: ValidatedProcessStep[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index] as ProcessStepInput;
    const processName = cleanText(item?.processName, 60);
    const stageGroup = normalizeProcessStageGroup(item?.stageGroup);
    let processCode = cleanText(item?.processCode, 80)
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!processName) return { ok: false, error: `第 ${index + 1} 个工序缺少名称` };
    if (!stageGroup) return { ok: false, error: `第 ${index + 1} 个工序的阶段分组不正确` };
    if (!processCode) processCode = `custom-${index + 1}-${Date.now()}`;
    if (codes.has(processCode)) {
      return { ok: false, error: `工序“${processName}”重复，请删除重复项后再保存` };
    }
    codes.add(processCode);
    steps.push({
      processDefinitionId: cleanText(item?.processDefinitionId, 80) || null,
      processCode,
      processName,
      stageGroup,
      position: index + 1,
    });
  }
  return { ok: true, steps };
}

export function serializeProcessTemplate(template: ProcessTemplateRecord): ProcessTemplateDTO {
  return {
    id: template.id,
    templateKey: template.templateKey,
    name: template.name,
    version: template.version,
    isDefault: template.isDefault,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy,
    steps: template.steps.map(step => ({
      id: step.id,
      processDefinitionId: step.processDefinitionId,
      processCode: step.processCode,
      processName: step.processName,
      stageGroup: normalizeProcessStageGroup(step.stageGroup) || 'frontend',
      position: step.position,
    })),
  };
}

export function serializeProcessRoute(
  route: ProcessRouteRecord | ProcessRouteSummaryRecord,
): WorkOrderProcessRouteDTO {
  const status = normalizeRouteStatus(route.status);
  const steps = route.steps.map(step => ({
    id: step.id,
    processDefinitionId: step.processDefinitionId,
    processCode: step.processCode,
    processName: step.processName,
    stageGroup: normalizeProcessStageGroup(step.stageGroup) || 'frontend',
    position: step.position,
    status: normalizeStepStatus(step.status),
    startedAt: step.startedAt?.toISOString() || null,
    completedAt: step.completedAt?.toISOString() || null,
    completedBy: 'completedBy' in step ? step.completedBy : null,
    remark: step.remark,
  }));
  const completedStepCount = steps.filter(step => step.status === 'completed' || step.status === 'skipped').length;
  const currentIndex = steps.findIndex(step => step.status === 'current');
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : null;
  const nextStep = currentIndex >= 0
    ? steps.slice(currentIndex + 1).find(step => step.status === 'pending') || null
    : steps.find(step => step.status === 'pending') || null;
  const detailRoute = route as ProcessRouteRecord;
  return {
    id: route.id,
    workOrderId: route.workOrderId,
    templateId: route.templateId,
    templateName: route.templateName,
    templateVersion: route.templateVersion,
    status,
    statusText: processRouteStatusText[status],
    version: route.version,
    confirmedAt: route.confirmedAt?.toISOString() || null,
    confirmedBy: 'confirmedBy' in route ? route.confirmedBy : null,
    startedAt: route.startedAt?.toISOString() || null,
    completedAt: route.completedAt?.toISOString() || null,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
    stepCount: steps.length,
    completedStepCount,
    progress: steps.length > 0 ? Math.round((completedStepCount / steps.length) * 100) : 0,
    currentStep,
    nextStep,
    steps,
    activities: Array.isArray(detailRoute.activities)
      ? detailRoute.activities.map(activity => ({
          id: activity.id,
          stepId: activity.stepId,
          action: activity.action,
          content: activity.content,
          actor: activity.actor,
          createdAt: activity.createdAt.toISOString(),
        }))
      : undefined,
  };
}

export async function findDefaultProcessTemplate(
  tx: Prisma.TransactionClient,
): Promise<ProcessTemplateRecord | null> {
  return tx.processTemplate.findFirst({
    where: { isDefault: true, isActive: true },
    include: processTemplateInclude,
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createWorkOrderProcessRoute(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    templateId?: string | null;
    actorId?: string | null;
  },
): Promise<{ created: boolean; routeId: string }> {
  const existing = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: input.workOrderId },
    select: { id: true },
  });
  if (existing) return { created: false, routeId: existing.id };

  const template = input.templateId
    ? await tx.processTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
        include: processTemplateInclude,
      })
    : await findDefaultProcessTemplate(tx);
  if (!template) throw new Error('PROCESS_TEMPLATE_NOT_FOUND');
  if (!template.steps.length) throw new Error('PROCESS_TEMPLATE_EMPTY');

  const route = await tx.workOrderProcessRoute.create({
    data: {
      workOrderId: input.workOrderId,
      templateId: template.id,
      templateName: template.name,
      templateVersion: template.version,
      status: 'draft',
      steps: {
        create: template.steps.map(step => ({
          processDefinitionId: step.processDefinitionId,
          processCode: step.processCode,
          processName: step.processName,
          stageGroup: step.stageGroup,
          position: step.position,
          status: 'pending',
        })),
      },
      activities: {
        create: {
          action: 'create_process_route',
          content: `应用 ${template.name} V${template.version}，等待工艺确认`,
          actorId: input.actorId || null,
          detail: { templateId: template.id, templateVersion: template.version },
        },
      },
    },
    select: { id: true },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId || null,
      action: 'create_process_route',
      targetType: 'work_order_process_route',
      targetId: route.id,
      detail: {
        workOrderId: input.workOrderId,
        templateId: template.id,
        templateVersion: template.version,
      },
    },
  });
  return { created: true, routeId: route.id };
}

export function processTemplateStepInput(step: ProcessTemplateStepDTO): ValidatedProcessStep {
  return {
    processDefinitionId: step.processDefinitionId || null,
    processCode: step.processCode,
    processName: step.processName,
    stageGroup: step.stageGroup,
    position: step.position,
  };
}
