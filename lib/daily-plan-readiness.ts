export const DAILY_PLAN_WARNING_LABELS: Record<string, string> = {
  WAITING_UPSTREAM: '等待上道工序完成',
  DRAWING_NOT_READY: '图纸尚未下发或确认',
  MATERIAL_NOT_READY: '物料尚未备齐',
  WAREHOUSE_EXCEPTION: '仓库配料存在异常',
  SKILL_NOT_MATCHED: '暂无技能完全匹配的人员',
  WORK_ORDER_NOT_READY: '生产工单尚未准备完成',
  MISSING_PROCESS_ROUTE: '缺少已发布的工艺路线',
  PROCESS_ROUTE_NOT_PUBLISHED: '工艺路线尚未发布',
  EMPTY_PROCESS_ROUTE: '工艺路线没有有效工序',
  MISSING_PROCESS_TIME: '工序缺少有效标准工时',
  ALREADY_PLANNED: '本周已安排到其他日计划',
  NO_REMAINING_CAPACITY: '当日人员容量不足',
};

export function dailyPlanWarningText(value: unknown): string {
  const code = String(value || '').trim();
  return DAILY_PLAN_WARNING_LABELS[code] || code || '状态待确认';
}

export function dailyPlanWarningTexts(values: unknown): { codes: string[]; labels: string[] } {
  const codes = Array.isArray(values)
    ? [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
    : [];
  return { codes, labels: codes.map(dailyPlanWarningText) };
}

export function drawingReady(input: { drawingLibraryItemId?: unknown; drawingStatus?: unknown }): boolean {
  if (!String(input.drawingLibraryItemId || '').trim()) return false;
  return new Set(['issued', 'confirmed', 'completed', 'ready', '已发', '已确认', '已下发'])
    .has(String(input.drawingStatus || '').trim().toLowerCase());
}

export function internalTeamCode(value: unknown): boolean {
  const code = String(value || '').trim().toUpperCase();
  return code.startsWith('LEGACY_') || /^TEAM-[A-F0-9]{8}$/.test(code);
}

export function displayTeamCode(value: unknown): string | null {
  const code = String(value || '').trim();
  return code && !internalTeamCode(code) ? code : null;
}
