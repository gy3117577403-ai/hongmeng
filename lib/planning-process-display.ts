export type PlanningProcessDisplayInput = {
  processStatus: 'not_created' | 'draft' | 'confirmed' | 'in_progress' | 'completed' | string;
  productTimeProfileVersion?: number | null;
};

export type PlanningProcessDisplay = {
  label: string;
  detail: string | null;
  readiness: 'registered' | 'pending' | 'ready' | 'completed';
};

/**
 * Product-time registration and a released work-order route are two different
 * lifecycle states. Draft plan batches intentionally have no route yet, so the
 * UI must not describe a published product profile as "missing" or "unplanned".
 */
export function planningProcessDisplay(input: PlanningProcessDisplayInput): PlanningProcessDisplay {
  if (input.processStatus === 'completed') {
    return { label: '已完成', detail: null, readiness: 'completed' };
  }
  if (input.processStatus === 'confirmed' || input.processStatus === 'in_progress') {
    return { label: '已确认', detail: null, readiness: 'ready' };
  }
  if (input.productTimeProfileVersion) {
    return {
      label: `已关联 V${input.productTimeProfileVersion}`,
      detail: input.processStatus === 'not_created' ? '下达后自动生成' : '正在同步正式工艺',
      readiness: 'registered',
    };
  }
  return {
    label: input.processStatus === 'not_created' ? '工时待发布' : '待编排',
    detail: null,
    readiness: 'pending',
  };
}
