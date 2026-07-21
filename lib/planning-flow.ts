import type {
  PlanningFlowStatus,
  ProcessRouteStatus,
  ProductionPlanReleaseState,
  WarehouseMaterialStatus,
  WorkflowProcessStatus,
} from '@/types';

export type PlanningFlowFacts = {
  releaseState: ProductionPlanReleaseState;
  drawingReady: boolean;
  timeReady: boolean;
  warehouseStatus?: WarehouseMaterialStatus | 'not_created';
  processStatus?: ProcessRouteStatus | 'not_created';
  currentProcessName?: string | null;
  workOrderStartedAt?: string | Date | null;
  workOrderCompletedAt?: string | Date | null;
  processCompletedAt?: string | Date | null;
};

export type PlanningFlowState = {
  status: PlanningFlowStatus;
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'ready' | 'complete';
  workflowStatus: WorkflowProcessStatus;
  nextStep: string | null;
};

export const PLANNING_FLOW_STEPS = [
  '计划排程',
  '图纸资料',
  '仓库配料',
  '产品工时',
  '工艺确认',
  '计划下达',
  '生产执行',
  '完成归档',
] as const;

export function hasConfirmedPlanningProcess(status?: ProcessRouteStatus | 'not_created'): boolean {
  return status === 'confirmed' || status === 'in_progress' || status === 'completed';
}

export function resolvePlanningFlow(facts: PlanningFlowFacts): PlanningFlowState {
  if (facts.workOrderCompletedAt || facts.processCompletedAt || facts.releaseState === 'archived') {
    return { status: 'completed', label: '已完成', tone: 'complete', workflowStatus: 'closed', nextStep: null };
  }
  if (facts.warehouseStatus === 'exception') {
    return { status: 'material_exception', label: '仓库异常', tone: 'danger', workflowStatus: 'waiting', nextStep: '处理仓库异常' };
  }
  if (!facts.drawingReady) {
    return { status: 'missing_drawing', label: '图纸待上传', tone: 'warning', workflowStatus: 'waiting', nextStep: '上传图纸资料' };
  }
  if (!facts.timeReady) {
    return { status: 'missing_time', label: '工时待维护', tone: 'warning', workflowStatus: 'waiting', nextStep: '发布产品工时' };
  }
  if (facts.warehouseStatus !== 'completed') {
    return { status: 'pending_material', label: '仓库待配料', tone: 'warning', workflowStatus: 'waiting', nextStep: '完成仓库配料' };
  }
  if (!hasConfirmedPlanningProcess(facts.processStatus)) {
    return { status: 'pending_process', label: '工艺待确认', tone: 'warning', workflowStatus: 'waiting', nextStep: '确认产品工艺' };
  }
  if (facts.releaseState === 'draft') {
    return { status: 'ready_release', label: '准备完成', tone: 'ready', workflowStatus: 'verifying', nextStep: '下达生产计划' };
  }
  if (facts.releaseState === 'preparation') {
    return { status: 'next_preparation', label: '下周预备', tone: 'info', workflowStatus: 'waiting', nextStep: '启用本周生产' };
  }
  if (facts.processStatus === 'completed') {
    return { status: 'pending_archive', label: '待完成归档', tone: 'ready', workflowStatus: 'verifying', nextStep: '完成生产归档' };
  }
  if (facts.currentProcessName) {
    return { status: 'production', label: `生产中 · ${facts.currentProcessName}`, tone: 'info', workflowStatus: 'processing', nextStep: '推进下一工序' };
  }
  if (facts.workOrderStartedAt || facts.processStatus === 'in_progress') {
    return { status: 'production', label: '生产进行中', tone: 'info', workflowStatus: 'processing', nextStep: '推进生产工序' };
  }
  return { status: 'current_execution', label: '本周待执行', tone: 'info', workflowStatus: 'waiting', nextStep: '开始生产执行' };
}

export function planningFlowStepStates(facts: PlanningFlowFacts): Array<'done' | 'current' | 'pending'> {
  const flow = resolvePlanningFlow(facts);
  const processReady = hasConfirmedPlanningProcess(facts.processStatus);
  const released = facts.releaseState !== 'draft';
  const completed = flow.status === 'completed';
  const done = [
    true,
    facts.drawingReady,
    facts.warehouseStatus === 'completed',
    facts.timeReady,
    processReady,
    released,
    facts.processStatus === 'completed' || completed,
    completed,
  ];
  const currentByStatus: Record<PlanningFlowStatus, number> = {
    material_exception: 2,
    missing_drawing: 1,
    missing_time: 3,
    pending_material: 2,
    pending_process: 4,
    ready_release: 5,
    next_preparation: 6,
    current_execution: 6,
    production: 6,
    pending_archive: 7,
    completed: -1,
  };
  const currentIndex = currentByStatus[flow.status];
  return done.map((isDone, index) => (
    completed || isDone ? 'done' : index === currentIndex ? 'current' : 'pending'
  ));
}
