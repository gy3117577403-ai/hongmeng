'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  Clock3,
  Download,
  ExternalLink,
  GripVertical,
  LoaderCircle,
  Menu,
  Minus,
  MoveRight,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Sparkles,
  Split,
  TimerReset,
  Undo2,
  UserRoundCog,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import {
  AssignmentMutationDialog,
  CrossTeamReviewPanel,
  LaborClaimDialog,
  OrganizationManager,
} from '@/components/daily-plans/DailyPlanAdvancedPanels';
import { useModalLayer } from '@/components/useModalLayer';
import {
  createIdempotencyKey,
  dailyPlanClient,
  formatMinutes,
  assignmentStatusLabel,
  taskStatusLabel,
  type DailyPlanAssignment,
  type DailyPlanAssignmentStatus,
  type DailyPlanCrossTeamRequest,
  type DailyPlanEmployee,
  type DailyPlanLaborPoolList,
  type DailyPlanOrganization,
  type DailyPlanOrganizationMutation,
  type DailyPlanRisk,
  type DailyPlanSuggestionPreview,
  type DailyPlanTask,
  type DailyPlanWorkbench as DailyPlanWorkbenchDTO,
  type DailyTaskStatus,
} from '@/lib/daily-plan-client';
import type { CurrentUserDTO, ProcessLaborPoolDTO } from '@/types';
import { chinaDateKey } from '@/lib/china-date';

type WorkbenchTab = 'people' | 'processes' | 'reconciliation' | 'organization';
type ModalKind = 'suggestions' | 'maintenance' | 'assign' | 'overtime' | 'crossTeam' | 'carryOver' | 'confirm' | 'print' | null;
type AssignmentDraft = { employeeId: string; quantity: string; order: number };
type AssignmentMutationState = {
  mode: 'adjust' | 'withdraw';
  task: DailyPlanTask;
  assignment: DailyPlanAssignment;
};

const statusTone: Record<DailyTaskStatus, string> = {
  UNPLANNED: 'neutral',
  WAITING_UPSTREAM: 'warning',
  READY: 'ready',
  IN_PROGRESS: 'active',
  COMPLETED: 'success',
  PENDING_CARRY_OVER: 'warning',
  CARRIED_OVER: 'neutral',
  NEEDS_REVIEW: 'danger',
  CANCELLED: 'neutral',
};

function todayValue(): string {
  return chinaDateKey(new Date());
}

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function nextDateValue(date: string): string {
  const parsed = dateFromKey(date);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return dateKeyFromDate(parsed);
}

function displayDate(date: string): string {
  if (!date) return '—';
  const parsed = dateFromKey(date);
  return `${date.slice(5).replace('-', '/')} 周${'日一二三四五六'[parsed.getUTCDay()]}`;
}

function weekDateValues(date: string): string[] {
  const selected = dateFromKey(date);
  const day = selected.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  selected.setUTCDate(selected.getUTCDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(selected);
    value.setUTCDate(value.getUTCDate() + index);
    return dateKeyFromDate(value);
  });
}

function planStatusText(workbench: DailyPlanWorkbenchDTO | null): string {
  if (!workbench) return '正在读取';
  if (workbench.plan.isAggregate) {
    if (!workbench.plan.teamCount) return '未配置班组';
    if (!workbench.plan.generatedTeamCount) return '尚未生成计划';
    if (workbench.plan.confirmedTeamCount === workbench.plan.teamCount) return '全部班组已确认';
    return `${workbench.plan.confirmedTeamCount}/${workbench.plan.teamCount} 班组已确认`;
  }
  if (workbench.plan.status === 'CONFIRMED') return '当日计划已确认';
  if (workbench.plan.status === 'IN_PROGRESS') return '当日计划执行中';
  if (workbench.plan.status === 'ARCHIVED') return '历史计划已归档';
  return workbench.plan.id ? '计划调整中' : '尚未生成计划';
}

function numeric(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value || 0));
}

function priorityText(task: DailyPlanTask): string {
  if (task.priorityLabel) return task.priorityLabel;
  if (task.priority >= 90) return '紧急';
  if (task.priority >= 70) return '高';
  if (task.priority >= 40) return '正常';
  return '低';
}

function EmptyState({ icon = 'calendar', title, description, action }: { icon?: 'calendar' | 'people' | 'route' | 'check'; title: string; description: string; action?: ReactNode }) {
  const Icon = icon === 'people' ? UsersRound : icon === 'route' ? Route : icon === 'check' ? ClipboardCheck : CalendarDays;
  return <div className="daily-empty-state"><span><Icon size={28} aria-hidden="true" /></span><strong>{title}</strong><p>{description}</p>{action}</div>;
}

function CapacityBar({ assigned, capacity }: { assigned: number; capacity: number }) {
  const percent = capacity > 0 ? Math.round((assigned / capacity) * 100) : assigned > 0 ? 100 : 0;
  const capped = Math.min(100, Math.max(0, percent));
  return <div className={`daily-capacity ${percent > 100 ? 'over' : ''}`} aria-label={`已安排 ${formatMinutes(assigned)}，容量 ${formatMinutes(capacity)}`}>
    <div><span style={{ width: `${capped}%` }} /></div><b>{percent}%</b>
  </div>;
}

function TaskStatusBadge({ status }: { status: DailyTaskStatus }) {
  return <span className={`daily-status ${statusTone[status]}`}>{taskStatusLabel(status)}</span>;
}

const assignmentTone: Record<DailyPlanAssignmentStatus, string> = {
  PLANNED: 'neutral',
  ACTIVE: 'active',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

function AssignmentStatusBadge({ status }: { status: DailyPlanAssignmentStatus }) {
  return <span className={`daily-status ${assignmentTone[status]}`}>{assignmentStatusLabel(status)}</span>;
}

function TaskWarning({ task }: { task: DailyPlanTask }) {
  if (task.hardBlocked) return <div className="daily-task-blocker"><ShieldAlert size={15} aria-hidden="true" /><span><b>工艺硬阻断</b>{task.hardBlockReason || '没有有效且已发布的工序与工时版本'}</span></div>;
  if (!task.warnings.length) return null;
  return <div className="daily-task-warning"><AlertTriangle size={14} aria-hidden="true" /><span>{task.warnings.slice(0, 2).join('；')}{task.warnings.length > 2 ? `；另 ${task.warnings.length - 2} 项` : ''}</span></div>;
}

function TaskPoolCard({ task, readOnly = false, onAssign, onCrossTeam, onCarryOver }: {
  task: DailyPlanTask;
  readOnly?: boolean;
  onAssign: (task: DailyPlanTask) => void;
  onCrossTeam: (task: DailyPlanTask) => void;
  onCarryOver: (task: DailyPlanTask) => void;
}) {
  return <article className={`daily-pool-card ${task.hardBlocked ? 'blocked' : ''}`}>
    <header><div><span>{task.customerName || '生产工单'}</span><strong>{task.workOrderCode}</strong><small>{task.productName}</small></div><TaskStatusBadge status={task.status} /></header>
    <div className="daily-pool-route"><span>{task.processSequence.toString().padStart(2, '0')}</span><b>{task.processName}</b><ArrowRight size={15} aria-hidden="true" /><small>{task.upstreamProcessName ? `上游：${task.upstreamProcessName}` : `顺序组 ${task.sequenceGroup}`}</small></div>
    <dl><div><dt>剩余数量</dt><dd>{numeric(task.remainingQuantity)}</dd></div><div><dt>可执行</dt><dd>{numeric(task.availableQuantity)}</dd></div><div><dt>计划工时</dt><dd>{formatMinutes(task.plannedMinutes)}</dd></div></dl>
    <TaskWarning task={task} />
    <footer><button type="button" className="daily-link-button" disabled={readOnly} onClick={() => onCrossTeam(task)}>跨组</button><button type="button" className="daily-link-button" disabled={readOnly} onClick={() => onCarryOver(task)}>顺延</button><button type="button" className="daily-primary-button compact" disabled={readOnly || task.hardBlocked} onClick={() => onAssign(task)}><Split size={15} />领取并分配</button></footer>
  </article>;
}

function RiskRail({ risks, collapsed, onToggle, onOpenTask }: { risks: DailyPlanRisk[]; collapsed: boolean; onToggle: () => void; onOpenTask: (taskId: string) => void }) {
  return <aside className={`daily-risk-rail ${collapsed ? 'collapsed' : ''}`} aria-label="排程风险">
    <header><div><span>实时协同</span><strong>风险与提醒</strong></div><button type="button" onClick={onToggle} aria-label={collapsed ? '展开风险栏' : '收起风险栏'}>{collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}</button></header>
    {!collapsed && <div className="daily-risk-list hm-scroll-region">
      {!risks.length && <EmptyState icon="check" title="当前没有风险" description="当前筛选范围内没有待处理提醒。" />}
      {risks.map(risk => <article className={`level-${risk.level.toLowerCase()}`} key={risk.id}><span><AlertTriangle size={17} aria-hidden="true" /></span><div><b>{risk.title}</b><p>{risk.description}</p>{risk.workOrderCode && <small>{risk.workOrderCode}</small>}</div>{risk.actionHref ? <a href={risk.actionHref}>{risk.actionLabel || '处理'}<ChevronRight size={14} /></a> : risk.taskId ? <button type="button" onClick={() => onOpenTask(risk.taskId!)}>{risk.actionLabel || '查看'}<ChevronRight size={14} /></button> : null}</article>)}
    </div>}
  </aside>;
}

function KpiStrip({ workbench }: { workbench: DailyPlanWorkbenchDTO | null }) {
  const entries = [
    ['计划工时', formatMinutes(workbench?.summary.plannedMinutes || 0), 'blue'],
    ['已分配', formatMinutes(workbench?.summary.assignedMinutes || 0), 'green'],
    ['未分配', formatMinutes(workbench?.summary.unassignedMinutes || 0), 'orange'],
    ['临期', `${workbench?.summary.urgentTaskCount || 0} 项`, 'red'],
    ['超负荷', `${workbench?.summary.overloadedEmployeeCount || 0} 人`, 'red'],
    ['待顺延', `${workbench?.summary.carryOverTaskCount || 0} 项`, 'purple'],
  ] as const;
  return <section className="daily-kpi-strip" aria-label="日计划指标">{entries.map(([label, value, tone]) => <article key={label} className={tone}><span>{label}</span><strong>{value}</strong></article>)}</section>;
}

function PeopleWorkbench({ employees, tasks, readOnly = false, onAssign, onOvertime, onReorder, onAdjust, onWithdraw }: {
  employees: DailyPlanEmployee[];
  tasks: DailyPlanTask[];
  readOnly?: boolean;
  onAssign: (task: DailyPlanTask, employee?: DailyPlanEmployee) => void;
  onOvertime: (employee: DailyPlanEmployee) => void;
  onReorder: (employee: DailyPlanEmployee, assignmentId: string, targetIndex: number) => void;
  onAdjust: (task: DailyPlanTask, assignment: DailyPlanAssignment) => void;
  onWithdraw: (task: DailyPlanTask, assignment: DailyPlanAssignment) => void;
}) {
  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  if (!employees.length) return <EmptyState icon="people" title="没有可排程人员" description="请先在生产组织设置中维护主管、组长和在岗生产人员。" />;
  return <div className="daily-people-grid">
    {employees.map(employee => {
      const capacity = employee.capacityMinutes + employee.overtimeMinutes;
      return <article className="daily-person-card" key={employee.id}>
        <header><div className="daily-avatar">{employee.name.slice(0, 1)}</div><div><strong>{employee.name}<small>{employee.employeeNo}</small></strong><span>{employee.teamName}{employee.position ? ` · ${employee.position}` : ''}</span></div><button type="button" disabled={readOnly} onClick={() => onOvertime(employee)}><Clock3 size={15} />容量</button></header>
        <section className="daily-person-capacity"><div><span>计划负荷</span><strong>{formatMinutes(employee.assignedMinutes)} / {formatMinutes(capacity)}</strong></div><CapacityBar assigned={employee.assignedMinutes} capacity={capacity} /><small>{employee.attendanceSource === 'DEFAULT_8H' ? '暂无考勤，排程暂按 8 小时' : employee.attendanceSource === 'OVERRIDE' ? '已使用当日容量调整' : '容量来自有效出勤'}{employee.overtimeMinutes > 0 ? ` · 加班 ${formatMinutes(employee.overtimeMinutes)}` : ''}</small></section>
        <div className="daily-assignment-list">
          {!employee.assignments.length && <button className="daily-inline-empty" type="button" disabled={readOnly} onClick={() => {
            const available = tasks.find(task => !task.hardBlocked && task.assignedQuantity < task.remainingQuantity);
            if (available) onAssign(available, employee);
          }}><Plus size={16} />为该员工安排首项任务</button>}
          {employee.assignments.slice().sort((a, b) => a.order - b.order).map((assignment, index, list) => {
            const task = taskMap.get(assignment.taskId);
            return <div className="daily-assignment" key={assignment.id} draggable={!readOnly} onDragStart={event => event.dataTransfer.setData('text/daily-assignment', assignment.id)} onDragOver={event => { if (!readOnly) event.preventDefault(); }} onDrop={event => {
              event.preventDefault();
              if (readOnly) return;
              const sourceId = event.dataTransfer.getData('text/daily-assignment');
              if (!sourceId || sourceId === assignment.id) return;
              const sourceIndex = list.findIndex(item => item.id === sourceId);
              if (sourceIndex < 0) return;
              onReorder(employee, sourceId, index);
            }}>
              <span className="daily-drag-handle" title="拖拽排序"><GripVertical size={16} /></span>
              <div><b>{task?.processName || '工序任务'}<small>{task?.workOrderCode || assignment.taskId}</small></b><span>{numeric(assignment.quantity)} 件 · {formatMinutes(assignment.plannedMinutes)}</span></div>
              <AssignmentStatusBadge status={assignment.status} />
              <div className="daily-order-actions"><button type="button" disabled={readOnly || index === 0} aria-label="上移任务" onClick={() => onReorder(employee, assignment.id, index - 1)}><ArrowUp size={14} /></button><button type="button" disabled={readOnly || index === list.length - 1} aria-label="下移任务" onClick={() => onReorder(employee, assignment.id, index + 1)}><ArrowDown size={14} /></button></div>
              {task && assignment.status !== 'COMPLETED' && assignment.status !== 'CANCELLED' && <div className="daily-assignment-actions"><button type="button" disabled={readOnly} onClick={() => onAdjust(task, assignment)}>调整</button><button type="button" className="danger" disabled={readOnly} onClick={() => onWithdraw(task, assignment)}>撤回</button></div>}
            </div>;
          })}
        </div>
      </article>;
    })}
  </div>;
}

function ProcessWorkbench({ tasks, readOnly = false, emptyState, onAssign, onCrossTeam, onCarryOver }: { tasks: DailyPlanTask[]; readOnly?: boolean; emptyState?: { title: string; description: string }; onAssign: (task: DailyPlanTask) => void; onCrossTeam: (task: DailyPlanTask) => void; onCarryOver: (task: DailyPlanTask) => void }) {
  const orders = useMemo(() => {
    const grouped = new Map<string, DailyPlanTask[]>();
    tasks.forEach(task => grouped.set(task.workOrderId, [...(grouped.get(task.workOrderId) || []), task]));
    return [...grouped.values()].map(group => group.sort((a, b) => a.sequenceGroup - b.sequenceGroup || a.processSequence - b.processSequence));
  }, [tasks]);
  if (!orders.length) return <EmptyState icon="route" title={emptyState?.title || '没有工序推进任务'} description={emptyState?.description || '生成日计划工序任务后，这里会按真实工艺路线展示当日推进情况。'} />;
  return <div className="daily-route-groups">{orders.map(group => <article className="daily-route-group" key={group[0].workOrderId}>
    <header><div><span>{group[0].customerName || '生产工单'}</span><strong>{group[0].workOrderCode}</strong><small>{group[0].productName}</small></div><b>{group.filter(task => task.status === 'COMPLETED').length}/{group.length} 工序</b></header>
    <div className="daily-route-line hm-scroll-region">{group.map((task, index) => <div className={`daily-route-node ${statusTone[task.status]}`} key={task.id}>
      <span>{index + 1}</span><div><small>顺序组 {task.sequenceGroup}</small><strong>{task.processName}</strong><p>{numeric(task.assignedQuantity)} / {numeric(task.remainingQuantity)} 件</p><TaskStatusBadge status={task.status} /></div><button type="button" disabled={readOnly || task.hardBlocked || task.status === 'COMPLETED'} onClick={() => onAssign(task)}>{task.assignments.length ? '调整' : '分配'}</button>
      {index < group.length - 1 && <i aria-hidden="true"><MoveRight size={19} /></i>}
    </div>)}</div>
    <footer>{group.flatMap(task => task.warnings.map(message => `${task.processName}：${message}`)).slice(0, 2).map(message => <span key={message}><AlertTriangle size={13} />{message}</span>)}</footer>
  </article>)}</div>;
}

function ReconciliationWorkbench({ tasks, laborPools, loading, onClaim }: { tasks: DailyPlanTask[]; laborPools: ProcessLaborPoolDTO[]; loading: boolean; onClaim: (pool: ProcessLaborPoolDTO) => void }) {
  const rows = useMemo(() => tasks.flatMap(task => task.assignments.map(assignment => ({ task, assignment }))), [tasks]);
  if (!rows.length && !laborPools.length && !loading) return <EmptyState icon="check" title="暂无对账记录" description="班前分配不会产生实际工时；工序完工并进入工时池后，这里会显示计划、完成和领取差异。" />;
  return <div className="daily-reconciliation-layout">
    <section className="daily-labor-pool-panel"><header><div><span>真实完工</span><strong>待领取工时池</strong></div><b>{laborPools.length}</b></header>{loading && <div className="daily-dialog-loading"><LoaderCircle className="spin" />正在同步工时池…</div>}{!loading && !laborPools.length && <p className="daily-muted-empty">当前日期暂无待领取实际工时。</p>}<div className="daily-labor-pool-cards">{laborPools.map(pool => <article key={pool.id}><div><b>{pool.workOrder.code}</b><span>{pool.step.processName}</span><small>{pool.remainingQty} {pool.unitLabel} · {formatMinutes(pool.remainingStandardLaborMilliseconds / 60_000)}</small></div><button type="button" className="daily-primary-button compact" onClick={() => onClaim(pool)}>分配实际工时</button></article>)}</div></section>
    <div className="daily-reconciliation-table hm-scroll-region" role="region" aria-label="工时对账表" tabIndex={0}>
    <table><thead><tr><th>员工 / 班组</th><th>工单 / 工序</th><th>计划分配</th><th>实际完成</th><th>工时池</th><th>已领取工时</th><th>差异</th><th>状态</th></tr></thead><tbody>{rows.map(({ task, assignment }) => {
      const difference = assignment.plannedMinutes - (assignment.actualClaimedMinutes || 0);
      return <tr key={assignment.id}><td><b>{assignment.employeeName}</b><small>{assignment.teamName}</small></td><td><b>{task.workOrderCode}</b><small>{task.processName}</small></td><td>{numeric(assignment.quantity)} 件<small>{formatMinutes(assignment.plannedMinutes)}</small></td><td>{numeric(assignment.actualCompletedQuantity || 0)} 件</td><td>{numeric(assignment.laborPoolQuantity || 0)} 件</td><td>{formatMinutes(assignment.actualClaimedMinutes || 0)}</td><td className={difference > 0 ? 'warning' : 'success'}>{difference > 0 ? `待领取 ${formatMinutes(difference)}` : '已对齐'}</td><td><AssignmentStatusBadge status={assignment.status} /></td></tr>;
    })}</tbody></table>
    </div>
  </div>;
}

function OrganizationWorkbench({ workbench, onOvertime }: { workbench: DailyPlanWorkbenchDTO; onOvertime: (employee: DailyPlanEmployee) => void }) {
  return <div className="daily-organization-layout">
    <section className="daily-organization-summary"><header><div><span>生产排程组织</span><strong>主管、组长与班组成员</strong></div>{workbench.scope.canManageOrganization && <button type="button" className="daily-secondary-button"><UserRoundCog size={16} />维护组织关系</button>}</header><p>这里只维护日计划的排程范围，不改变现有登录角色、实际工时领取权限或人事档案。</p></section>
    <div className="daily-team-grid">{workbench.teams.map(team => {
      const members = workbench.employees.filter(employee => employee.teamId === team.id);
      return <article className="daily-team-card" key={team.id}><header><div><span>{team.code || '生产班组'}</span><strong>{team.name}</strong></div><b>{team.memberCount} 人</b></header><dl><div><dt>组长</dt><dd>{team.leaderName || '待配置'}</dd></div><div><dt>今日已排</dt><dd>{formatMinutes(members.reduce((sum, member) => sum + member.assignedMinutes, 0))}</dd></div></dl><div>{members.map(member => <button type="button" key={member.id} onClick={() => onOvertime(member)}><span>{member.name.slice(0, 1)}</span><b>{member.name}<small>{member.position || member.employeeNo}</small></b><CapacityBar assigned={member.assignedMinutes} capacity={member.capacityMinutes + member.overtimeMinutes} /></button>)}</div></article>;
    })}</div>
  </div>;
}

function WorkbenchDialog({ modal, workbench, task, employee, assignmentCandidates, suggestion, suggestionLoading, busy, error, assignmentRows, backgroundRef, onRowsChange, onClose, onPreviewSuggestions, onCreateSuggestion, onAssign, onUpdateCapacity, onCrossTeam, onCarryOver, onConfirm, onPrint }: {
  modal: Exclude<ModalKind, null>;
  workbench: DailyPlanWorkbenchDTO;
  task: DailyPlanTask | null;
  employee: DailyPlanEmployee | null;
  assignmentCandidates: DailyPlanEmployee[];
  suggestion: DailyPlanSuggestionPreview | null;
  suggestionLoading: boolean;
  busy: boolean;
  error: string;
  assignmentRows: AssignmentDraft[];
  backgroundRef: RefObject<HTMLElement | null>;
  onRowsChange: (rows: AssignmentDraft[]) => void;
  onClose: () => void;
  onPreviewSuggestions: () => void;
  onCreateSuggestion: () => void;
  onAssign: () => void;
  onUpdateCapacity: (input: { employeeId: string; overtimeStart: string; overtimeEnd: string; capacityMinutes: number; reason: string }) => void;
  onCrossTeam: (input: Record<string, unknown>) => void;
  onCarryOver: (input: Record<string, unknown>) => void;
  onConfirm: () => void;
  onPrint: (mode: 'team' | 'employee', employeeId?: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const [overtimeStart, setOvertimeStart] = useState('17:30');
  const [overtimeEnd, setOvertimeEnd] = useState('20:00');
  const [capacityMinutes, setCapacityMinutes] = useState(String(employee?.capacityMinutes || 480));
  const [reason, setReason] = useState('');
  const [targetTeamId, setTargetTeamId] = useState('');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [quantity, setQuantity] = useState(task ? String(Math.max(0, task.remainingQuantity - task.assignedQuantity)) : '');
  const [targetDate, setTargetDate] = useState(nextDateValue(workbench.workDate));
  const [printMode, setPrintMode] = useState<'team' | 'employee'>('team');
  const [printEmployeeId, setPrintEmployeeId] = useState(workbench.employees[0]?.id || '');
  const capacityValue = Number(capacityMinutes);
  const crossTeamQuantity = Number(quantity);
  const availableTaskQuantity = task ? Math.max(0, task.remainingQuantity - task.assignedQuantity) : 0;
  const invalidCapacity = !Number.isInteger(capacityValue) || capacityValue < 0 || !reason.trim() || Boolean(overtimeStart && overtimeEnd && overtimeEnd <= overtimeStart);
  const invalidCrossTeam = !targetTeamId || !reason.trim() || !Number.isInteger(crossTeamQuantity) || crossTeamQuantity <= 0 || crossTeamQuantity > availableTaskQuantity;
  const invalidCarryOver = !reason.trim() || !targetDate || targetDate <= workbench.workDate;

  useModalLayer({ open: true, layerRef, initialFocusRef, backgroundRef, onClose, lockScroll: true });

  const modalCopy = {
    suggestions: ['班前排程', '生成工序任务预览'],
    maintenance: ['数据准备', '待维护工序与工时'],
    assign: ['班前安排', task ? `领取并分配 · ${task.processName}` : '领取并分配'],
    overtime: ['容量调整', employee ? `${employee.name} · 加班与容量` : '加班与容量'],
    crossTeam: ['跨组协同', '发起跨组借调'],
    carryOver: ['生产调整', '顺延未完成任务'],
    confirm: ['每日确认', '确认当日日计划'],
    print: ['服务端快照', '打印日计划'],
  }[modal];

  return <div className="daily-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={layerRef} className={`daily-dialog daily-dialog-${modal}`} role="dialog" aria-modal="true" aria-labelledby="daily-dialog-title" tabIndex={-1}>
      <header><div><span>{modalCopy[0]}</span><h2 id="daily-dialog-title">{modalCopy[1]}</h2></div><button ref={initialFocusRef} type="button" disabled={busy} aria-label="关闭弹窗" onClick={onClose}><X size={21} /></button></header>
      <div className="daily-dialog-body hm-scroll-region">
        {modal === 'suggestions' && <>
          <div className="daily-dialog-callout"><Sparkles size={20} /><span><b>先预览，再生成可执行工序任务</b><small>系统会展示人员容量建议，但本阶段不会自动写入员工分配，任务生成后由组长领取和安排。</small></span></div>
          {!suggestion && !suggestionLoading && <EmptyState icon="calendar" title="准备计算工序任务" description={`${workbench.workDate} · ${workbench.shift.label} · ${workbench.teamOptions.find(item => item.id === workbench.selectedTeamId)?.name || '请选择班组'}`} action={<button type="button" className="daily-primary-button" onClick={onPreviewSuggestions}><Sparkles size={16} />开始计算</button>} />}
          {suggestionLoading && <div className="daily-dialog-loading"><LoaderCircle className="spin" />正在计算排程建议…</div>}
          {suggestion && <><section className="daily-preview-metrics"><div><span>工序任务</span><strong>{suggestion.taskCount}</strong></div><div><span>建议分配</span><strong>{suggestion.assignmentCount}</strong></div><div><span>已排工时</span><strong>{formatMinutes(suggestion.assignedMinutes)}</strong></div><div><span>未排工时</span><strong>{formatMinutes(suggestion.unassignedMinutes)}</strong></div><div><span>超负荷</span><strong>{suggestion.overloadedEmployeeCount}</strong></div></section>
            {suggestion.warnings.length > 0 && <div className="daily-dialog-warning-list">{suggestion.warnings.map(item => <span key={item}><AlertTriangle size={14} />{item}</span>)}</div>}
            <div className="daily-preview-list">{suggestion.assignments.map((item, index) => <article key={`${item.taskId}-${item.employeeId}-${index}`}><b>{item.employeeName}<small>{item.teamName}</small></b><span>{numeric(item.quantity)} 件</span><span>{formatMinutes(item.plannedMinutes)}</span><p>{item.reason}</p></article>)}{!suggestion.assignments.length && <p className="daily-muted-empty">当前没有可用的人员容量建议，仍可先生成工序任务后人工安排。</p>}</div></>}
        </>}
        {modal === 'maintenance' && <>{!workbench.maintenanceItems.length ? <EmptyState icon="check" title="当前没有待维护项" description="当前班组范围内的工序与标准工时已经具备生成条件。" /> : <div className="daily-maintenance-list">{workbench.maintenanceItems.map(item => <article key={item.id}><span><Wrench size={18} aria-hidden="true" /></span><div><b>{item.workOrderCode}<small>{item.customerName || '生产工单'}</small></b><strong>{item.productName || '产品信息待完善'}</strong><p>{item.message}</p>{item.missingStepNames.length > 0 && <em>缺失工序：{item.missingStepNames.join('、')}</em>}</div><a href={item.actionHref}>配置工序与工时<ExternalLink size={14} /></a></article>)}</div>}</>}
        {modal === 'assign' && task && <>
          <div className="daily-task-dialog-summary"><div><span>{task.workOrderCode}</span><strong>{task.productName}</strong></div><div><span>当前工序</span><strong>{task.processName}</strong></div><div><span>剩余 / 可执行</span><strong>{numeric(task.remainingQuantity - task.assignedQuantity)} / {numeric(task.availableQuantity)}</strong></div><div><span>标准工时</span><strong>{task.unitStandardSeconds} 秒/件</strong></div></div>
          <TaskWarning task={task} />
          <div className="daily-assignment-editor"><header><div><span>多人拆分</span><strong>组长领取与员工分配在同一事务完成</strong></div><button type="button" onClick={() => onRowsChange([...assignmentRows, { employeeId: '', quantity: '', order: assignmentRows.length + 1 }])}><Plus size={15} />增加人员</button></header>
            {assignmentRows.map((row, index) => <div className="daily-assignment-row" key={index}><span>{index + 1}</span><label>员工<select value={row.employeeId} onChange={event => onRowsChange(assignmentRows.map((item, itemIndex) => itemIndex === index ? { ...item, employeeId: event.target.value } : item))}><option value="">选择员工</option>{assignmentCandidates.map(item => <option value={item.id} key={item.id} disabled={assignmentRows.some((other, otherIndex) => otherIndex !== index && other.employeeId === item.id)}>{item.name} · {item.teamName} · 剩余 {formatMinutes(Math.max(0, item.capacityMinutes + item.overtimeMinutes - item.assignedMinutes))}</option>)}</select></label><label>数量<input type="number" min="1" step="1" max={Math.max(0, task.remainingQuantity - task.assignedQuantity)} value={row.quantity} onChange={event => onRowsChange(assignmentRows.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label><button type="button" disabled={assignmentRows.length === 1} aria-label="移除人员" onClick={() => onRowsChange(assignmentRows.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })))}><Minus size={16} /></button></div>)}
            <footer><span>分配合计</span><strong>{numeric(assignmentRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0))} / {numeric(Math.max(0, task.remainingQuantity - task.assignedQuantity))} 件</strong></footer>
          </div>
          <div className="daily-dialog-callout neutral"><Clock3 size={19} /><span><b>班前领取不产生员工实际工时</b><small>实际工时只在工序完工进入工时池后，由有权限人员按实际完成数量领取。</small></span></div>
        </>}
        {modal === 'overtime' && employee && <><div className="daily-person-dialog-head"><div className="daily-avatar">{employee.name.slice(0, 1)}</div><span><b>{employee.name}</b><small>{employee.teamName} · 当前容量 {formatMinutes(employee.capacityMinutes + employee.overtimeMinutes)}</small></span></div><div className="daily-form-grid"><label>排程容量（分钟）<input type="number" min="0" value={capacityMinutes} onChange={event => setCapacityMinutes(event.target.value)} /></label><label>加班开始<input type="time" value={overtimeStart} onChange={event => setOvertimeStart(event.target.value)} /></label><label>加班结束<input type="time" value={overtimeEnd} onChange={event => setOvertimeEnd(event.target.value)} /></label><label className="wide">调整原因<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：17:00 连班完成临期工序" /></label></div><div className="daily-dialog-callout neutral"><TimerReset size={19} /><span><b>容量只服务排程</b><small>没有考勤时默认 8 小时，不会反写考勤；加班也不会自动生成实际工时。</small></span></div></>}
        {modal === 'crossTeam' && task && <><div className="daily-task-dialog-summary"><div><span>工单</span><strong>{task.workOrderCode}</strong></div><div><span>工序</span><strong>{task.processName}</strong></div><div><span>当前班组</span><strong>{task.teamName || '未分组'}</strong></div><div><span>可分配数量</span><strong>{numeric(task.remainingQuantity - task.assignedQuantity)}</strong></div></div><div className="daily-form-grid"><label>目标班组<select value={targetTeamId} onChange={event => { setTargetTeamId(event.target.value); setTargetEmployeeId(''); }}><option value="">选择班组</option>{workbench.teamOptions.filter(item => item.id !== task.teamId).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>目标员工<select value={targetEmployeeId} onChange={event => setTargetEmployeeId(event.target.value)}><option value="">可暂不指定</option>{workbench.employeeOptions.filter(item => item.teamId === targetTeamId).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>借调数量<input type="number" min="1" max={Math.max(0, task.remainingQuantity - task.assignedQuantity)} value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="wide">借调原因<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="说明负荷、交期或技能原因" /></label></div><div className="daily-dialog-callout"><ShieldAlert size={19} /><span><b>跨组安排需要主管确认</b><small>系统将记录原班组、目标班组、人员、任务、数量、原因和操作人，不放宽实际工时领取权限。</small></span></div></>}
        {modal === 'carryOver' && task && <><div className="daily-task-dialog-summary"><div><span>工单</span><strong>{task.workOrderCode}</strong></div><div><span>工序</span><strong>{task.processName}</strong></div><div><span>待顺延数量</span><strong>{numeric(Math.max(0, task.remainingQuantity - task.assignedQuantity))}</strong></div><div><span>当前状态</span><strong>{taskStatusLabel(task.status)}</strong></div></div><div className="daily-form-grid"><label>顺延至<input type="date" min={nextDateValue(workbench.workDate)} value={targetDate} onChange={event => setTargetDate(event.target.value)} /></label><label className="wide">顺延原因<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="说明未完成原因和下一日安排" /></label></div></>}
        {modal === 'confirm' && <><div className="daily-confirm-hero"><CheckCircle2 size={32} /><span><b>确认 {displayDate(workbench.workDate)} 日计划</b><small>确认后仍可调整，但每次领取、拆分、转派、撤回和顺延都会保留修订记录。</small></span></div><section className="daily-preview-metrics"><div><span>计划工时</span><strong>{formatMinutes(workbench.summary.plannedMinutes)}</strong></div><div><span>已分配</span><strong>{formatMinutes(workbench.summary.assignedMinutes)}</strong></div><div><span>未分配</span><strong>{formatMinutes(workbench.summary.unassignedMinutes)}</strong></div><div><span>临期任务</span><strong>{workbench.summary.urgentTaskCount}</strong></div><div><span>超负荷</span><strong>{workbench.summary.overloadedEmployeeCount}</strong></div></section>{workbench.summary.unassignedMinutes > 0 && <div className="daily-dialog-callout"><AlertTriangle size={19} /><span><b>仍有未分配任务</b><small>当前版本不启用硬冻结，可确认后继续调整；未分配项仍会保留在工序池。</small></span></div>}</>}
        {modal === 'print' && <><div className="daily-dialog-callout neutral"><Printer size={20} /><span><b>打印来自服务端计划快照</b><small>不会截取当前页面或虚拟列表，确保长列表、分页和历史版本完整。</small></span></div><div className="daily-print-options"><label className={printMode === 'team' ? 'selected' : ''}><input type="radio" name="printMode" checked={printMode === 'team'} onChange={() => setPrintMode('team')} /><span><Printer size={24} /><b>班组日计划总表</b><small>A4 横向 · 全班组任务与容量</small></span></label><label className={printMode === 'employee' ? 'selected' : ''}><input type="radio" name="printMode" checked={printMode === 'employee'} onChange={() => setPrintMode('employee')} /><span><UsersRound size={24} /><b>员工个人任务单</b><small>A4 纵向 · 有序任务与签字栏</small></span></label></div>{printMode === 'employee' && <label className="daily-print-employee">选择员工<select value={printEmployeeId} onChange={event => setPrintEmployeeId(event.target.value)}>{workbench.employees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.teamName}</option>)}</select></label>}</>}
        {error && <div className="daily-dialog-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      </div>
      <footer><button type="button" className="daily-secondary-button" disabled={busy} onClick={onClose}>取消</button>
        {modal === 'suggestions' && suggestion && <button type="button" className="daily-primary-button" disabled={busy || suggestion.taskCount === 0} onClick={onCreateSuggestion}>{busy ? <LoaderCircle className="spin" /> : <Check size={16} />}{busy ? '生成中…' : '生成工序任务'}</button>}
        {modal === 'assign' && <button type="button" className="daily-primary-button" disabled={busy || task?.hardBlocked} onClick={onAssign}>{busy ? <LoaderCircle className="spin" /> : <Split size={16} />}{busy ? '分配中…' : '确认领取并分配'}</button>}
        {modal === 'overtime' && employee && <button type="button" className="daily-primary-button" disabled={busy || invalidCapacity} onClick={() => onUpdateCapacity({ employeeId: employee.id, overtimeStart, overtimeEnd, capacityMinutes: capacityValue, reason: reason.trim() })}>{busy ? '保存中…' : '保存当日容量'}</button>}
        {modal === 'crossTeam' && task && <button type="button" className="daily-primary-button" disabled={busy || invalidCrossTeam} onClick={() => onCrossTeam({ expectedVersion: task.version, targetTeamId, employeeId: targetEmployeeId || undefined, quantity: crossTeamQuantity, reason: reason.trim() })}>{busy ? '提交中…' : '提交主管确认'}</button>}
        {modal === 'carryOver' && task && <button type="button" className="daily-primary-button" disabled={busy || invalidCarryOver} onClick={() => onCarryOver({ expectedVersion: task.version, targetDate, reason: reason.trim() })}>{busy ? '顺延中…' : '确认顺延'}</button>}
        {modal === 'confirm' && <button type="button" className="daily-primary-button" disabled={busy} onClick={onConfirm}>{busy ? '确认中…' : '确认当日计划'}</button>}
        {modal === 'print' && <button type="button" className="daily-primary-button" disabled={printMode === 'employee' && !printEmployeeId} onClick={() => onPrint(printMode, printMode === 'employee' ? printEmployeeId : undefined)}><Printer size={16} />打开打印快照</button>}
      </footer>
    </div>
  </div>;
}

export default function DailyPlanWorkbench({ user }: { user: CurrentUserDTO }) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('people');
  const [workDate, setWorkDate] = useState(todayValue);
  const [teamId, setTeamId] = useState('');
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [workbench, setWorkbench] = useState<DailyPlanWorkbenchDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [riskCollapsed, setRiskCollapsed] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [modalTask, setModalTask] = useState<DailyPlanTask | null>(null);
  const [modalEmployee, setModalEmployee] = useState<DailyPlanEmployee | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [suggestion, setSuggestion] = useState<DailyPlanSuggestionPreview | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [assignmentRows, setAssignmentRows] = useState<AssignmentDraft[]>([{ employeeId: '', quantity: '', order: 1 }]);
  const [assignmentMutation, setAssignmentMutation] = useState<AssignmentMutationState | null>(null);
  const [laborData, setLaborData] = useState<DailyPlanLaborPoolList | null>(null);
  const [laborLoading, setLaborLoading] = useState(false);
  const [laborPool, setLaborPool] = useState<ProcessLaborPoolDTO | null>(null);
  const [crossTeamRequests, setCrossTeamRequests] = useState<DailyPlanCrossTeamRequest[]>([]);
  const [crossBusyId, setCrossBusyId] = useState('');
  const [organization, setOrganization] = useState<DailyPlanOrganization | null>(null);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationError, setOrganizationError] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const queryDate = query.get('workDate') || query.get('date');
    const queryTeamId = query.get('teamId');
    const queryTab = query.get('tab');
    if (isDateKey(queryDate)) setWorkDate(queryDate);
    if (queryTeamId) setTeamId(queryTeamId);
    if (queryTab === 'people' || queryTab === 'processes' || queryTab === 'reconciliation' || queryTab === 'organization') setActiveTab(queryTab);
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set('workDate', workDate);
    if (teamId) url.searchParams.set('teamId', teamId);
    else url.searchParams.delete('teamId');
    if (activeTab === 'people') url.searchParams.delete('tab');
    else url.searchParams.set('tab', activeTab);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab, teamId, urlStateReady, workDate]);

  useEffect(() => {
    if (!historyOpen) return undefined;
    function onPointerDown(event: PointerEvent): void {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setHistoryOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [historyOpen]);

  const loadWorkbench = useCallback((signal?: AbortSignal) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError('');
    return dailyPlanClient.getWorkbench(workDate, teamId, signal).then(data => {
      if (signal?.aborted || requestId !== loadRequestIdRef.current) return;
      setWorkbench(data);
    }).catch(reason => {
      if ((reason as Error).name !== 'AbortError' && requestId === loadRequestIdRef.current) setError(reason instanceof Error ? reason.message : '日计划加载失败');
    }).finally(() => {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    });
  }, [teamId, workDate]);

  useEffect(() => {
    if (!urlStateReady) return;
    const controller = new AbortController();
    void loadWorkbench(controller.signal);
    return () => controller.abort();
  }, [loadWorkbench, refreshToken, urlStateReady]);

  useEffect(() => {
    if (activeTab !== 'reconciliation') return;
    const controller = new AbortController();
    setLaborLoading(true);
    void dailyPlanClient.listLaborPools(workDate, controller.signal).then(setLaborData).catch(reason => {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : '实际工时池加载失败');
    }).finally(() => setLaborLoading(false));
    return () => controller.abort();
  }, [activeTab, refreshToken, workDate]);

  useEffect(() => {
    if (!workbench?.scope.canConfirm) {
      setCrossTeamRequests([]);
      return;
    }
    const controller = new AbortController();
    void dailyPlanClient.listCrossTeamRequests(controller.signal).then(data => setCrossTeamRequests(data.requests)).catch(reason => {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : '跨组借调请求加载失败');
    });
    return () => controller.abort();
  }, [refreshToken, workbench?.scope.canConfirm]);

  useEffect(() => {
    if (activeTab !== 'organization') return;
    const controller = new AbortController();
    setOrganizationError('');
    void dailyPlanClient.getOrganization(controller.signal).then(setOrganization).catch(reason => {
      if ((reason as Error).name !== 'AbortError') setOrganizationError(reason instanceof Error ? reason.message : '生产组织加载失败');
    });
    return () => controller.abort();
  }, [activeTab, refreshToken]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    const source = workbench?.tasks || [];
    if (!query) return source;
    return source.filter(task => [task.workOrderCode, task.productCode, task.productName, task.customerName, task.processName].some(value => value?.toLocaleLowerCase('zh-CN').includes(query)));
  }, [search, workbench?.tasks]);

  const displayedWeek = useMemo(() => weekDateValues(workDate), [workDate]);
  const currentWeekStart = useMemo(() => weekDateValues(todayValue())[0], []);
  const selectedTeamName = workbench?.teamOptions.find(team => team.id === teamId)?.name || '';

  const visibleEmployees = useMemo(() => {
    if (!workbench) return [];
    return workbench.employees.filter(employee => !teamId || employee.teamId === teamId);
  }, [teamId, workbench]);

  const assignmentCandidates = useMemo(() => {
    if (!workbench) return [];
    if (workbench.scope.role === 'ADMIN' || workbench.scope.role === 'WORKSHOP_SUPERVISOR') return workbench.employees;
    const teamIds = new Set(workbench.scope.teamIds);
    return workbench.employees.filter(employee => teamIds.has(employee.teamId));
  }, [workbench]);

  const visiblePool = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return (workbench?.unassignedTasks || []).filter(task => (!teamId || task.teamId === teamId || !task.teamId) && (!query || [task.workOrderCode, task.productCode, task.productName, task.processName].some(value => value?.toLocaleLowerCase('zh-CN').includes(query))));
  }, [search, teamId, workbench?.unassignedTasks]);

  function openModal(kind: Exclude<ModalKind, null>, task?: DailyPlanTask, employee?: DailyPlanEmployee): void {
    if (!teamId && kind !== 'maintenance') {
      setError('“全部班组”仅用于汇总查看，请先选择具体班组再操作日计划');
      return;
    }
    setModalError('');
    setSuggestion(null);
    setModalTask(task || null);
    setModalEmployee(employee || null);
    if (kind === 'assign') {
      const remaining = task ? Math.max(0, task.remainingQuantity - task.assignedQuantity) : 0;
      setAssignmentRows([{ employeeId: employee?.id || '', quantity: remaining ? String(remaining) : '', order: 1 }]);
    }
    setModal(kind);
  }

  function closeModal(): void {
    if (modalBusy) return;
    setModal(null);
    setModalTask(null);
    setModalEmployee(null);
    setModalError('');
  }

  async function previewSuggestions(): Promise<void> {
    if (!workbench || !teamId) {
      setModalError('请先选择具体生产班组');
      return;
    }
    setSuggestionLoading(true);
    setModalError('');
    try {
      setSuggestion(await dailyPlanClient.previewSuggestions({ workDate, shiftCode: workbench.shift.code, teamId }));
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : '排程建议生成失败');
    } finally {
      setSuggestionLoading(false);
    }
  }

  async function execute(action: () => Promise<unknown>, successClose = true): Promise<void> {
    setModalBusy(true);
    setModalError('');
    try {
      await action();
      if (successClose) {
        setModal(null);
        setModalTask(null);
        setModalEmployee(null);
        setAssignmentMutation(null);
        setLaborPool(null);
        setModalError('');
      }
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setModalBusy(false);
    }
  }

  function createSuggestion(): void {
    if (!workbench || !suggestion || !teamId) return setModalError('请先选择具体生产班组');
    void execute(() => dailyPlanClient.createFromSuggestion({ workDate, shiftCode: workbench.shift.code, teamId, suggestionKey: suggestion.suggestionKey }, createIdempotencyKey('daily-create')));
  }

  function assignTask(): void {
    if (!workbench?.plan.id || !modalTask) return setModalError('请先生成日计划，再领取并分配任务');
    const rows = assignmentRows.map(row => ({ employeeId: row.employeeId, quantity: Number(row.quantity), sortOrder: row.order }));
    if (!rows.length || rows.some(row => !row.employeeId || !Number.isInteger(row.quantity) || row.quantity <= 0)) return setModalError('请为每一行选择员工，并填写大于 0 的整数数量');
    const uniqueEmployeeIds = new Set(rows.map(row => row.employeeId));
    if (uniqueEmployeeIds.size !== rows.length) return setModalError('同一员工不能在一次拆分中重复出现，请合并该员工数量');
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    const remaining = Math.max(0, modalTask.remainingQuantity - modalTask.assignedQuantity);
    if (total > remaining) return setModalError(`分配数量不能超过剩余 ${numeric(remaining)} 件`);
    void execute(() => dailyPlanClient.assignTask(modalTask.id, { expectedVersion: modalTask.version, assignments: rows }, createIdempotencyKey('daily-assign')));
  }

  function updateCapacity(input: { employeeId: string; overtimeStart: string; overtimeEnd: string; capacityMinutes: number; reason: string }): void {
    if (!workbench?.plan.id) return setModalError('请先生成日计划');
    void execute(() => dailyPlanClient.updatePlan(workbench.plan.id!, { action: 'UPDATE_CAPACITY', ...input }, workbench.plan.version, createIdempotencyKey('daily-capacity')));
  }

  function requestCrossTeam(input: Record<string, unknown>): void {
    if (!modalTask) return;
    void execute(() => dailyPlanClient.requestCrossTeam(modalTask.id, input, createIdempotencyKey('daily-cross-team')));
  }

  function carryOver(input: Record<string, unknown>): void {
    if (!modalTask) return;
    void execute(() => dailyPlanClient.carryOverTask(modalTask.id, input, createIdempotencyKey('daily-carry-over')));
  }

  function confirmPlan(): void {
    if (!workbench?.plan.id) return setModalError('请先生成日计划');
    void execute(() => dailyPlanClient.updatePlan(workbench.plan.id!, { action: 'CONFIRM' }, workbench.plan.version, createIdempotencyKey('daily-confirm')));
  }

  function openPrint(mode: 'team' | 'employee', employeeId?: string): void {
    if (!workbench?.plan.id) return setModalError('请先生成日计划');
    window.open(dailyPlanClient.printUrl(workbench.plan.id, mode, employeeId), '_blank', 'noopener,noreferrer');
  }

  function reorder(employee: DailyPlanEmployee, assignmentId: string, targetIndex: number): void {
    if (!teamId || !workbench?.plan.id) return setError('请先选择具体班组');
    const sorted = employee.assignments.slice().sort((a, b) => a.order - b.order);
    const index = sorted.findIndex(item => item.id === assignmentId);
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length || targetIndex === index) return;
    const [moving] = sorted.splice(index, 1);
    sorted.splice(targetIndex, 0, moving);
    const task = workbench.tasks.find(item => item.assignments.some(assignment => assignment.id === assignmentId));
    if (!task) return;
    void dailyPlanClient.mutateAssignments(task.id, {
      action: 'reorder',
      expectedVersion: task.version,
      reason: '调整员工当日任务顺序',
      assignments: sorted.map((assignment, sortIndex) => ({ assignmentId: assignment.id, expectedVersion: assignment.version, sortOrder: sortIndex + 1 })),
    }, createIdempotencyKey('daily-reorder')).then(() => setRefreshToken(value => value + 1)).catch(reason => setError(reason instanceof Error ? reason.message : '任务排序失败'));
  }

  function mutateAssignment(input: { employeeId?: string; quantity?: number; reason: string }): void {
    if (!teamId || !assignmentMutation) return setModalError('请先选择具体班组');
    const { mode, task, assignment } = assignmentMutation;
    void execute(() => dailyPlanClient.mutateAssignments(task.id, {
      action: mode,
      expectedVersion: task.version,
      reason: input.reason,
      assignments: [{
        assignmentId: assignment.id,
        expectedVersion: assignment.version,
        ...(mode === 'adjust' ? { employeeId: input.employeeId, quantity: input.quantity } : {}),
      }],
    }, createIdempotencyKey(`daily-${mode}`)));
  }

  function claimLaborPool(allocations: Array<{ employeeId: string; quantity: number }>): void {
    if (!laborPool) return;
    void execute(() => dailyPlanClient.batchClaimLaborPool(laborPool.id, {
      expectedVersion: laborPool.version,
      allocations,
    }, createIdempotencyKey('daily-labor-claim')));
  }

  function reviewCrossTeam(request: DailyPlanCrossTeamRequest, decision: 'APPROVE' | 'REJECT'): void {
    setCrossBusyId(request.id);
    setError('');
    void dailyPlanClient.reviewCrossTeamRequest(request.id, {
      decision,
      expectedVersion: request.version,
      reviewNote: decision === 'APPROVE' ? '车间主管确认跨组借调' : '车间主管驳回跨组借调',
    }, createIdempotencyKey('daily-cross-review')).then(() => {
      setCrossTeamRequests(current => current.filter(item => item.id !== request.id));
      setRefreshToken(value => value + 1);
    }).catch(reason => setError(reason instanceof Error ? reason.message : '跨组借调审批失败')).finally(() => setCrossBusyId(''));
  }

  function saveOrganization(input: DailyPlanOrganizationMutation): void {
    setOrganizationBusy(true);
    setOrganizationError('');
    void dailyPlanClient.updateOrganization(input, createIdempotencyKey('daily-organization')).then(data => {
      setOrganization(data);
      setRefreshToken(value => value + 1);
    }).catch(reason => setOrganizationError(reason instanceof Error ? reason.message : '生产组织保存失败')).finally(() => setOrganizationBusy(false));
  }

  function openRiskTask(taskId: string): void {
    const task = workbench?.tasks.find(item => item.id === taskId);
    if (task) openModal('assign', task);
  }

  const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof UsersRound }> = [
    { id: 'people', label: '人员排程', icon: UsersRound },
    { id: 'processes', label: '工序推进', icon: Route },
    { id: 'reconciliation', label: '工时对账', icon: ClipboardCheck },
    { id: 'organization', label: '生产组织设置', icon: UserRoundCog },
  ];
  const maintenanceCount = workbench?.maintenanceItems.length || 0;
  const aggregateReadOnly = !teamId;
  const processEmptyState = aggregateReadOnly
    ? { title: '请选择班组查看日计划', description: '“全部班组”用于汇总查看；选择具体班组后可生成、确认和调整日计划。' }
    : maintenanceCount > 0
      ? { title: '本日没有可执行工序', description: `有 ${maintenanceCount} 个工单因工序或标准工时未就绪而未进入日计划，请先处理待维护项。` }
      : !workbench?.plan.id
        ? { title: '尚未生成日计划', description: workbench?.weeklyPool.processOwnershipConfigured ? `本周尚有 ${workbench.weeklyPool.availableTaskCount} 项可安排工序；点击“生成工序任务”领取当前班组归属的工序。` : '请先在“生产组织设置”配置班组—工序归属，再从本周工序池生成当日任务。' }
        : { title: '没有工序推进任务', description: '当前班组本日没有待推进工序，或所有工序均已完成。' };
  const aggregateConfirmed = Boolean(workbench?.plan.isAggregate && workbench.plan.teamCount > 0 && workbench.plan.confirmedTeamCount === workbench.plan.teamCount);
  const statusConfirmed = workbench?.plan.status === 'CONFIRMED' || aggregateConfirmed;
  const wideTab = activeTab === 'organization' || activeTab === 'reconciliation';

  return <>
    <main ref={mainRef} className="daily-plan-shell hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader user={user} activeHref="/workspace/daily-plans" subtitle="工序拆分、人员安排与工时对账" menuItems={[]} hideHeader sidebarTriggerTargetId="daily-plan-navigation-trigger" />
      <div className="daily-plan-main">
        <section className="daily-plan-toolbar">
          <div id="daily-plan-navigation-trigger" className="daily-plan-navigation-trigger" aria-label="平台导航入口" />
          <div className="daily-date-navigator" aria-label="生产日期">
            <div ref={historyRef} className={`daily-history-picker ${historyOpen ? 'open' : ''}`}>
              <button type="button" className="daily-history-button" aria-expanded={historyOpen} aria-haspopup="dialog" onClick={() => setHistoryOpen(value => !value)}><CalendarClock size={16} /><span>历史日</span><ChevronDown size={13} /></button>
              {historyOpen && <div className="daily-history-popover" role="dialog" aria-label="选择历史生产日期"><label>选择历史日期<input type="date" max={todayValue()} value={workDate <= todayValue() ? workDate : ''} onChange={event => { if (isDateKey(event.target.value)) { setWorkDate(event.target.value); setHistoryOpen(false); } }} /></label>{displayedWeek[0] !== currentWeekStart && <button type="button" onClick={() => { setWorkDate(todayValue()); setHistoryOpen(false); }}><Undo2 size={14} />返回本周</button>}</div>}
            </div>
            <div className="daily-week-strip" role="group" aria-label="本周生产日期">{displayedWeek.map((date, index) => <button type="button" key={date} className={`${date === workDate ? 'selected' : ''} ${date === todayValue() ? 'today' : ''}`} aria-pressed={date === workDate} aria-current={date === todayValue() ? 'date' : undefined} onClick={() => setWorkDate(date)}><small>周{'一二三四五六日'[index]}</small><strong>{Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}</strong>{date === todayValue() && <em>今天</em>}</button>)}</div>
          </div>
          <div className="daily-toolbar-context">
            <div className="daily-shift-pill"><Clock3 size={16} /><span><small>班次</small><b>{workbench?.shift.label || '白班'}</b></span><strong>{workbench ? `${workbench.shift.startTime}–${workbench.shift.endTime}` : '08:00–17:00'}</strong></div>
            <label className="daily-team-filter"><UsersRound size={16} /><span>班组</span><select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">全部班组</option>{workbench?.teamOptions.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
            <div className="daily-plan-status"><span className={statusConfirmed ? 'status-confirmed' : ''}>{statusConfirmed ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{planStatusText(workbench)}</span>{selectedTeamName && <small>{selectedTeamName}</small>}</div>
          </div>
          <div className="daily-toolbar-actions">
            <button type="button" className="daily-secondary-button accent" title={teamId ? '预览并生成可执行工序任务' : '请先选择具体班组'} disabled={!workbench || !teamId} onClick={() => openModal('suggestions')}><Sparkles size={16} />生成工序任务</button>
            <button type="button" className="daily-primary-button" title={teamId ? '确认当前班组当日日计划' : '请先选择具体班组'} disabled={!teamId || !workbench?.scope.canConfirm || !workbench.plan.id} onClick={() => openModal('confirm')}><CalendarCheck2 size={16} />每日确认</button>
            <details className="daily-more-menu"><summary aria-label="更多日计划操作"><Menu size={17} />更多</summary><div><a href={`/workspace/weekly-processes?date=${encodeURIComponent(workDate)}`}><CalendarDays size={15} />周工序总览</a><button type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新数据</button><button type="button" disabled={!teamId || !workbench?.plan.id} onClick={() => openModal('print')}><Printer size={15} />打印计划</button></div></details>
          </div>
        </section>

        <KpiStrip workbench={workbench} />

        <section className="daily-view-toolbar"><nav aria-label="日计划视图">{tabs.map(tab => { const Icon = tab.icon; return <button type="button" className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}><Icon size={17} />{tab.label}</button>; })}</nav>{activeTab !== 'organization' && <div><label><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索工单、产品或工序" /></label>{!wideTab && <><a className="daily-weekly-pool-link" href={`/workspace/weekly-processes?date=${encodeURIComponent(workDate)}`}><CalendarDays size={16} />本周工序<b>{workbench?.weeklyPool.availableTaskCount || 0}</b></a><button type="button" className="daily-maintenance-trigger" disabled={!maintenanceCount} onClick={() => openModal('maintenance')}><Wrench size={16} />待维护<b>{maintenanceCount}</b></button><button type="button" className="daily-pool-trigger" onClick={() => setPoolOpen(true)}><PanelLeftOpen size={16} />未分配工序<b>{visiblePool.length}</b></button><button type="button" className="daily-risk-trigger" onClick={() => setRiskCollapsed(value => !value)}><ShieldAlert size={16} />风险<b>{workbench?.risks.length || 0}</b></button></>}</div>}</section>

        {error && <div className="daily-page-error" role="alert"><AlertTriangle size={18} /><span><b>日计划加载失败</b>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}

        <div className={`daily-workspace-grid ${riskCollapsed ? 'risk-collapsed' : ''} ${wideTab ? 'wide' : ''}`}>
          {!wideTab && <aside className="daily-pool-panel"><header><div><span>当日工序池</span><strong>未分配任务</strong></div><b>{visiblePool.length}</b></header><div className="hm-scroll-region">{!visiblePool.length && <EmptyState icon="check" title={aggregateReadOnly ? '请选择具体班组' : '没有未分配任务'} description={aggregateReadOnly ? '全部班组只用于汇总查看，选择班组后才能从本周工序池领取并分配任务。' : maintenanceCount ? `有 ${maintenanceCount} 个工单等待补齐工序或标准工时。` : workbench?.weeklyPool.processOwnershipConfigured ? `当前班组本日没有未分配任务，本周尚有 ${workbench.weeklyPool.availableTaskCount} 项可安排工序。未配置归属的工序仍按兼容模式开放。` : '尚未启用工序归属配置，当前按兼容模式展示全部工序。'} />}{visiblePool.map(task => <TaskPoolCard key={task.id} task={task} readOnly={aggregateReadOnly} onAssign={taskItem => openModal('assign', taskItem)} onCrossTeam={taskItem => openModal('crossTeam', taskItem)} onCarryOver={taskItem => openModal('carryOver', taskItem)} />)}</div></aside>}
          <section className="daily-main-workbench" aria-busy={loading}>
            {loading && !workbench && <div className="daily-page-loading"><LoaderCircle className="spin" /><b>正在加载日计划…</b></div>}
            {workbench && activeTab === 'people' && <div className="daily-tab-stack">
              {workbench.scope.canConfirm && <CrossTeamReviewPanel requests={crossTeamRequests} busyId={crossBusyId} onReview={reviewCrossTeam} />}
              <PeopleWorkbench employees={visibleEmployees} tasks={filteredTasks} readOnly={aggregateReadOnly} onAssign={(task, employee) => openModal('assign', task, employee)} onOvertime={employee => openModal('overtime', undefined, employee)} onReorder={reorder} onAdjust={(task, assignment) => setAssignmentMutation({ mode: 'adjust', task, assignment })} onWithdraw={(task, assignment) => setAssignmentMutation({ mode: 'withdraw', task, assignment })} />
            </div>}
            {workbench && activeTab === 'processes' && <ProcessWorkbench tasks={filteredTasks} readOnly={aggregateReadOnly} emptyState={processEmptyState} onAssign={task => openModal('assign', task)} onCrossTeam={task => openModal('crossTeam', task)} onCarryOver={task => openModal('carryOver', task)} />}
            {workbench && activeTab === 'reconciliation' && <ReconciliationWorkbench tasks={filteredTasks} laborPools={laborData?.pools || []} loading={laborLoading} onClaim={setLaborPool} />}
            {workbench && activeTab === 'organization' && <OrganizationManager organization={organization} busy={organizationBusy} error={organizationError} canManage={workbench.scope.canManageOrganization} onSave={saveOrganization} />}
          </section>
          {!wideTab && <RiskRail risks={workbench?.risks || []} collapsed={riskCollapsed} onToggle={() => setRiskCollapsed(value => !value)} onOpenTask={openRiskTask} />}
        </div>
      </div>

      <div className={`daily-pool-drawer ${poolOpen ? 'open' : ''}`} aria-hidden={!poolOpen}><button type="button" className="daily-drawer-scrim" tabIndex={poolOpen ? 0 : -1} aria-label="关闭未分配工序池" onClick={() => setPoolOpen(false)} /><aside><header><div><span>工序池</span><strong>未分配任务</strong></div><button type="button" aria-label="关闭" onClick={() => setPoolOpen(false)}><X size={20} /></button></header><div className="hm-scroll-region">{!visiblePool.length && <EmptyState icon="check" title="没有未分配任务" description="当前筛选范围内没有待分配工序。" />}{visiblePool.map(task => <TaskPoolCard key={task.id} task={task} readOnly={aggregateReadOnly} onAssign={taskItem => { setPoolOpen(false); openModal('assign', taskItem); }} onCrossTeam={taskItem => { setPoolOpen(false); openModal('crossTeam', taskItem); }} onCarryOver={taskItem => { setPoolOpen(false); openModal('carryOver', taskItem); }} />)}</div></aside></div>
    </main>

    {modal && workbench && <WorkbenchDialog modal={modal} workbench={workbench} task={modalTask} employee={modalEmployee} assignmentCandidates={assignmentCandidates} suggestion={suggestion} suggestionLoading={suggestionLoading} busy={modalBusy} error={modalError} assignmentRows={assignmentRows} backgroundRef={mainRef} onRowsChange={setAssignmentRows} onClose={closeModal} onPreviewSuggestions={() => { void previewSuggestions(); }} onCreateSuggestion={createSuggestion} onAssign={assignTask} onUpdateCapacity={updateCapacity} onCrossTeam={requestCrossTeam} onCarryOver={carryOver} onConfirm={confirmPlan} onPrint={openPrint} />}
    {assignmentMutation && <AssignmentMutationDialog mode={assignmentMutation.mode} task={assignmentMutation.task} assignment={assignmentMutation.assignment} candidates={assignmentCandidates} busy={modalBusy} error={modalError} backgroundRef={mainRef} onClose={() => { if (!modalBusy) { setAssignmentMutation(null); setModalError(''); } }} onSubmit={mutateAssignment} />}
    {laborPool && <LaborClaimDialog pool={laborPool} employees={laborData?.employees || []} busy={modalBusy} error={modalError} backgroundRef={mainRef} onClose={() => { if (!modalBusy) { setLaborPool(null); setModalError(''); } }} onSubmit={claimLaborPool} />}
  </>;
}
