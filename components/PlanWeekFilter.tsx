'use client';
import { currentPlanWeek, planWeekLabel, planWeekStart, shiftPlanWeek } from '@/lib/drawing-plan-week';

export function PlanWeekFilter({ value, onChange }: { value: string; onChange: (week: string) => void }) {
  const current = currentPlanWeek(), next = shiftPlanWeek(current, 1);
  return <div className="plan-week-filter" role="group" aria-label="计划周筛选">
    <select aria-label="计划周范围" value={!value ? 'all' : value === current ? 'current' : value === next ? 'next' : 'custom'} onChange={e => onChange(e.target.value === 'all' ? '' : e.target.value === 'next' ? next : e.target.value === 'current' ? current : shiftPlanWeek(current, 2))}>
      <option value="all">全部计划周</option><option value="current">本周计划</option><option value="next">下周计划</option><option value="custom">指定计划周</option>
    </select>
    {value && <><button type="button" aria-label="上一计划周" title="上一周" onClick={() => onChange(shiftPlanWeek(value, -1))}>‹</button><input aria-label="选择计划周日期" type="date" value={value} onChange={e => { if (e.target.value) onChange(planWeekStart(e.target.value)); }} /><button type="button" aria-label="下一计划周" title="下一周" onClick={() => onChange(shiftPlanWeek(value, 1))}>›</button><small>{planWeekLabel(value)}</small></>}
  </div>;
}
