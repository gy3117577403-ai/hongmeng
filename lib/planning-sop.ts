import type { SopDrawingStatusDTO, SopStageDTO } from '@/types';

export type PlanningSopStage = SopStageDTO | 'unregistered';

export type PlanningSopMetadata = {
  sopStage: SopStageDTO | null;
  sopDrawingStatus: SopDrawingStatusDTO | null;
  sopRemark: string | null;
  sopMetadataUpdatedAt: string | null;
};

export const planningSopStageLabels: Record<PlanningSopStage, string> = {
  standard: '标准',
  new_product: '新品',
  validating: '验证中',
  unregistered: '未登记',
};

export function normalizePlanningSopStage(value: unknown): SopStageDTO | null {
  return value === 'standard' || value === 'new_product' || value === 'validating'
    ? value
    : null;
}

export function normalizePlanningSopDrawingStatus(value: unknown): SopDrawingStatusDTO | null {
  return value === 'available' || value === 'missing' ? value : null;
}

export function planningSopStage(value: unknown): PlanningSopStage {
  return normalizePlanningSopStage(value) || 'unregistered';
}

export function planningSopIsValidating(value: unknown): boolean {
  return planningSopStage(value) === 'validating';
}

export function formatPlanningSopUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

export function planningSopTooltip(input: PlanningSopMetadata & { sopFileCount: number }): string {
  const stage = planningSopStage(input.sopStage);
  const lines = [
    `SOP文件：${input.sopFileCount > 0 ? `${input.sopFileCount} 个有效文件` : '缺少有效文件'}`,
    `SOP状态：${planningSopStageLabels[stage]}`,
  ];
  if (input.sopDrawingStatus) lines.push(`图纸状态：${input.sopDrawingStatus === 'available' ? '有图纸' : '没图纸'}`);
  if (input.sopRemark) lines.push(`备注：${input.sopRemark}`);
  const updatedAt = formatPlanningSopUpdatedAt(input.sopMetadataUpdatedAt);
  if (updatedAt) lines.push(`状态更新：${updatedAt}`);
  return lines.join('\n');
}
