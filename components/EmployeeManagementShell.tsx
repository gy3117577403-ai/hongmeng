'use client';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Network,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import {
  responsibilityPeople,
  responsibilityWorkItems,
} from '@/lib/responsibility-collaboration';
import type {
  AbnormalTimeEventDTO,
  AttendanceRecordDTO,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeDTO,
} from '@/types';

type HrView =
  | 'overview'
  | 'directory'
  | 'recruiting'
  | 'attendance'
  | 'performance'
  | 'training'
  | 'organization'
  | 'approvals'
  | 'analytics';

type EmployeeFilter = 'all' | 'active' | 'attendance' | 'inactive';

type EmployeeDraft = {
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  team: string;
  isActive: boolean;
  attendanceEnabled: boolean;
};

type EmployeesResponse = {
  ok: boolean;
  employees?: EmployeeDTO[];
  employee?: EmployeeDTO;
  error?: string;
};

type AttendanceResponse = {
  ok: boolean;
  records?: AttendanceRecordDTO[];
  summary?: {
    enabledEmployeeCount: number;
    recordCount: number;
    confirmedCount: number;
    draftCount: number;
    actualMilliseconds: number;
    overtimeMilliseconds: number;
    leaveMilliseconds: number;
  };
  error?: string;
};

type AbnormalResponse = {
  ok: boolean;
  events?: AbnormalTimeEventDTO[];
  summary?: {
    eventCount: number;
    pendingCount: number;
    confirmedCount: number;
    rejectedCount: number;
    openCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
  };
  error?: string;
};

type AttainmentResponse = {
  ok: boolean;
  report?: EmployeeAttainmentReportDTO;
  error?: string;
};

type HrNavItem = {
  id: HrView;
  label: string;
  description: string;
  icon: LucideIcon;
};

const hrNavigation: HrNavItem[] = [
  { id: 'overview', label: '人事首页', description: '人力与协同总览', icon: LayoutDashboard },
  { id: 'directory', label: '员工档案', description: '人员与岗位资料', icon: UserRound },
  { id: 'recruiting', label: '招聘管理', description: '需求与进度预览', icon: BriefcaseBusiness },
  { id: 'attendance', label: '考勤管理', description: '出勤与异常确认', icon: CalendarCheck2 },
  { id: 'performance', label: '薪酬绩效', description: '工时绩效与待接入薪酬', icon: CircleDollarSign },
  { id: 'training', label: '培训发展', description: '岗位能力与培养计划', icon: GraduationCap },
  { id: 'organization', label: '组织架构', description: '部门与班组分布', icon: Network },
  { id: 'approvals', label: '审批中心', description: '人事协同待办', icon: ClipboardCheck },
  { id: 'analytics', label: '报表分析', description: '人力数据洞察', icon: FileBarChart },
];

const emptyDraft: EmployeeDraft = {
  employeeNo: '',
  name: '',
  department: '',
  position: '',
  team: '',
  isActive: true,
  attendanceEnabled: true,
};

const emptyAttendanceSummary: NonNullable<AttendanceResponse['summary']> = {
  enabledEmployeeCount: 0,
  recordCount: 0,
  confirmedCount: 0,
  draftCount: 0,
  actualMilliseconds: 0,
  overtimeMilliseconds: 0,
  leaveMilliseconds: 0,
};

const emptyAbnormalSummary: NonNullable<AbnormalResponse['summary']> = {
  eventCount: 0,
  pendingCount: 0,
  confirmedCount: 0,
  rejectedCount: 0,
  openCount: 0,
  incidentMilliseconds: 0,
  affectedPersonMilliseconds: 0,
};

function toDraft(employee: EmployeeDTO): EmployeeDraft {
  return {
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department || '',
    position: employee.position || '',
    team: employee.team || '',
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
  };
}

function sortEmployees(employees: EmployeeDTO[]): EmployeeDTO[] {
  return [...employees].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return left.employeeNo.localeCompare(right.employeeNo, 'zh-CN', { numeric: true });
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatHours(milliseconds: number): string {
  if (!milliseconds) return '0 小时';
  return `${(milliseconds / 3_600_000).toFixed(milliseconds < 36_000_000 ? 1 : 0)} 小时`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待形成';
  return `${(value / 100).toFixed(1)}%`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isThisMonth(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function currentDateLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function departmentName(employee: EmployeeDTO): string {
  return employee.department?.trim() || '未分组';
}

function statusLabel(employee: EmployeeDTO): string {
  if (!employee.isActive) return '已停用';
  return employee.attendanceEnabled ? '在岗 · 考勤中' : '在岗';
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'blue',
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  note: string;
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'violet' | 'cyan';
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'article';
  return (
    <Tag
      className={`hr-metric-card tone-${tone}${onClick ? ' actionable' : ''}`}
      {...(onClick ? { type: 'button' as const, onClick } : {})}
    >
      <span className="hr-metric-icon"><Icon aria-hidden="true" /></span>
      <span className="hr-metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </Tag>
  );
}

function DataUnavailable({ message }: { message: string }) {
  return (
    <div className="hr-inline-notice">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hr-empty-panel">
      <span><Icon aria-hidden="true" /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export default function EmployeeManagementShell({ user }: { user: CurrentUserDTO }) {
  const [view, setView] = useState<HrView>('overview');
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordDTO[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState(emptyAttendanceSummary);
  const [abnormalEvents, setAbnormalEvents] = useState<AbnormalTimeEventDTO[]>([]);
  const [abnormalSummary, setAbnormalSummary] = useState(emptyAbnormalSummary);
  const [attainmentReport, setAttainmentReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [draft, setDraft] = useState<EmployeeDraft>(emptyDraft);
  const [baseline, setBaseline] = useState<EmployeeDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<EmployeeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [auxiliaryWarning, setAuxiliaryWarning] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  useToastBridge(toast, setToast);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view') as HrView | null;
    if (requested && hrNavigation.some(item => item.id === requested)) setView(requested);
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find(employee => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const loadHumanResources = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    setAuxiliaryWarning('');
    try {
      const [employeeResult, attendanceResult, abnormalResult, attainmentResult] = await Promise.allSettled([
        fetch('/api/employees', { cache: 'no-store' }),
        fetch('/api/attendance/records?period=month', { cache: 'no-store' }),
        fetch('/api/abnormal-time-events?period=month', { cache: 'no-store' }),
        fetch('/api/reports/employee-attainment?period=month', { cache: 'no-store' }),
      ]);

      if (employeeResult.status !== 'fulfilled') throw new Error('员工档案加载失败');
      const employeeBody = await employeeResult.value.json() as EmployeesResponse;
      if (!employeeResult.value.ok) throw new Error(employeeBody.error || '员工档案加载失败');
      const nextEmployees = sortEmployees(employeeBody.employees || []);
      setEmployees(nextEmployees);
      setSelectedEmployeeId(current => {
        const requestedId = new URLSearchParams(window.location.search).get('employeeId') || '';
        if (nextEmployees.some(employee => employee.id === current)) return current;
        if (requestedId && nextEmployees.some(employee => employee.id === requestedId)) return requestedId;
        return nextEmployees[0]?.id || '';
      });

      const warnings: string[] = [];
      if (attendanceResult.status === 'fulfilled') {
        const body = await attendanceResult.value.json() as AttendanceResponse;
        if (attendanceResult.value.ok) {
          setAttendanceRecords(body.records || []);
          setAttendanceSummary(body.summary || emptyAttendanceSummary);
        } else {
          warnings.push(body.error || '考勤数据暂不可用');
        }
      } else {
        warnings.push('考勤数据暂不可用');
      }

      if (abnormalResult.status === 'fulfilled') {
        const body = await abnormalResult.value.json() as AbnormalResponse;
        if (abnormalResult.value.ok) {
          setAbnormalEvents(body.events || []);
          setAbnormalSummary(body.summary || emptyAbnormalSummary);
        } else {
          warnings.push(body.error || '异常工时数据暂不可用');
        }
      } else {
        warnings.push('异常工时数据暂不可用');
      }

      if (attainmentResult.status === 'fulfilled') {
        const body = await attainmentResult.value.json() as AttainmentResponse;
        if (attainmentResult.value.ok) {
          setAttainmentReport(body.report || null);
        } else {
          warnings.push(body.error || '绩效数据暂不可用');
        }
      } else {
        warnings.push('绩效数据暂不可用');
      }
      setAuxiliaryWarning([...new Set(warnings)].join('；'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '人事管理数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHumanResources();
  }, [loadHumanResources]);

  useEffect(() => {
    if (creating || !selectedEmployee) return;
    const nextDraft = toDraft(selectedEmployee);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setFormError('');
  }, [creating, selectedEmployee]);

  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeave(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty]);

  const summary = useMemo(() => ({
    total: employees.length,
    active: employees.filter(employee => employee.isActive).length,
    attendance: employees.filter(employee => employee.isActive && employee.attendanceEnabled).length,
    inactive: employees.filter(employee => !employee.isActive).length,
    newThisMonth: employees.filter(employee => isThisMonth(employee.createdAt)).length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    return employees.filter(employee => {
      if (filter === 'active' && !employee.isActive) return false;
      if (filter === 'inactive' && employee.isActive) return false;
      if (filter === 'attendance' && (!employee.isActive || !employee.attendanceEnabled)) return false;
      if (selectedDepartment && departmentName(employee) !== selectedDepartment) return false;
      if (!normalized) return true;
      return `${employee.employeeNo} ${employee.name} ${employee.department || ''} ${employee.position || ''} ${employee.team || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized);
    });
  }, [employees, filter, keyword, selectedDepartment]);

  const departmentStats = useMemo(() => {
    const grouped = new Map<string, { total: number; active: number; attendance: number }>();
    employees.forEach(employee => {
      const name = departmentName(employee);
      const value = grouped.get(name) || { total: 0, active: 0, attendance: 0 };
      value.total += 1;
      if (employee.isActive) value.active += 1;
      if (employee.isActive && employee.attendanceEnabled) value.attendance += 1;
      grouped.set(name, value);
    });
    return [...grouped.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((left, right) => right.active - left.active || left.name.localeCompare(right.name, 'zh-CN'));
  }, [employees]);

  const maxDepartmentCount = Math.max(...departmentStats.map(item => item.active), 1);
  const archiveCompleteness = summary.active
    ? Math.round((employees.filter(employee => (
      employee.isActive && employee.department && employee.position && employee.team
    )).length / summary.active) * 100)
    : 0;
  const archiveCompleteCount = employees.filter(employee => (
    employee.isActive && employee.department && employee.position && employee.team
  )).length;
  const archiveMissingCount = Math.max(0, summary.active - archiveCompleteCount);
  const attendanceCoverage = summary.active
    ? Math.round((summary.attendance / summary.active) * 100)
    : 0;
  const pendingApprovalCount = attendanceSummary.draftCount + abnormalSummary.pendingCount;
  const recentEmployees = [...employees]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 5);
  const hrCoordinator = responsibilityPeople.find(person => person.departmentId === 'people-operations');
  const hrWorkItems = responsibilityWorkItems.filter(item => (
    item.ownerId === hrCoordinator?.id || item.participantIds.includes(hrCoordinator?.id || '')
  ));

  function changeView(nextView: HrView): void {
    if (view === 'directory' && !confirmDiscard()) return;
    setView(nextView);
    const url = new URL(window.location.href);
    if (nextView === 'overview') url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    window.history.replaceState({}, '', url);
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('当前员工档案有未保存修改，确认放弃吗？');
  }

  function chooseEmployee(employee: EmployeeDTO): void {
    if (!confirmDiscard()) return;
    setCreating(false);
    setSelectedEmployeeId(employee.id);
    const nextDraft = toDraft(employee);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setFormError('');
  }

  function beginCreate(): void {
    if (!confirmDiscard()) return;
    setCreating(true);
    setSelectedEmployeeId('');
    setDraft(emptyDraft);
    setBaseline(emptyDraft);
    setFormError('');
    if (view !== 'directory') changeView('directory');
  }

  async function saveEmployee(): Promise<void> {
    if (!draft.employeeNo.trim()) {
      setFormError('请填写员工编号');
      return;
    }
    if (!draft.name.trim()) {
      setFormError('请填写员工姓名');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const wasCreating = creating;
      const response = await fetch(wasCreating ? '/api/employees' : `/api/employees/${selectedEmployeeId}`, {
        method: wasCreating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await response.json() as EmployeesResponse;
      if (!response.ok || !body.employee) throw new Error(body.error || '保存员工档案失败');
      const savedEmployee = body.employee;
      setEmployees(current => sortEmployees(wasCreating
        ? [...current, savedEmployee]
        : current.map(employee => employee.id === savedEmployee.id ? savedEmployee : employee)));
      setCreating(false);
      setSelectedEmployeeId(savedEmployee.id);
      const nextDraft = toDraft(savedEmployee);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setToast(wasCreating ? '员工档案已创建' : '员工档案已保存');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存员工档案失败');
    } finally {
      setSaving(false);
    }
  }

  function focusDepartment(name: string): void {
    setSelectedDepartment(name);
    setKeyword('');
    setFilter('all');
    changeView('directory');
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  function renderOverview() {
    const attainment = attainmentReport?.summary.attainmentBasisPoints;
    const primaryTask = hrWorkItems.find(item => item.priority === 'high' || item.priority === 'urgent')
      || hrWorkItems[0];
    const focusOwner = primaryTask
      ? responsibilityPeople.find(person => person.id === primaryTask.ownerId)
      : null;
    const focusNextPerson = primaryTask
      ? responsibilityPeople.find(person => person.id === primaryTask.nextPersonId)
      : null;
    const focusCollaborators = primaryTask
      ? primaryTask.participantIds
        .map(personId => responsibilityPeople.find(person => person.id === personId))
        .filter((person): person is NonNullable<typeof person> => Boolean(person))
        .slice(0, 3)
      : [];

    return (
      <div className="hr-view hr-overview-view">
        <section className="hr-overview-heading">
          <div>
            <span className="hr-eyebrow">人力协同工作台</span>
            <h1>{greeting()}，{user.displayName}</h1>
            <p>{currentDateLabel()} · 今天优先处理待确认事项与人员基础信息。</p>
          </div>
          <div className="hr-overview-heading-actions">
            <button type="button" className="hr-secondary-button" onClick={() => changeView('approvals')}>
              <ClipboardCheck size={17} />查看待办
              {pendingApprovalCount > 0 && <em>{pendingApprovalCount}</em>}
            </button>
            <button type="button" className="hr-primary-button" onClick={beginCreate}>
              <Plus size={17} />新增员工
            </button>
          </div>
        </section>

        <section className="hr-health-strip" aria-label="人事健康概览">
          <button type="button" onClick={() => changeView('directory')}>
            <span><UsersRound /></span>
            <small>在岗人员</small>
            <strong>{summary.active}</strong>
            <em>档案共 {summary.total} 人</em>
          </button>
          <button type="button" onClick={() => changeView('directory')}>
            <span><BadgeCheck /></span>
            <small>档案完整</small>
            <strong>{archiveCompleteCount}/{summary.active}</strong>
            <em>{archiveCompleteness}% 已完善</em>
          </button>
          <button type="button" onClick={() => changeView('attendance')}>
            <span className="green"><CalendarCheck2 /></span>
            <small>考勤覆盖</small>
            <strong>{attendanceCoverage}%</strong>
            <em>{summary.attendance} 人已启用</em>
          </button>
          <button type="button" className={pendingApprovalCount ? 'attention' : ''} onClick={() => changeView('approvals')}>
            <span className="orange"><ClipboardCheck /></span>
            <small>待处理事项</small>
            <strong>{pendingApprovalCount}</strong>
            <em>考勤与异常确认</em>
          </button>
          <button type="button" onClick={() => changeView('performance')}>
            <span><Activity /></span>
            <small>人员达成率</small>
            <strong>{formatPercent(attainment)}</strong>
            <em>本月工时口径</em>
          </button>
          <button type="button" className={abnormalSummary.openCount ? 'danger' : ''} onClick={() => changeView('attendance')}>
            <span className={abnormalSummary.openCount ? 'red' : 'green'}><AlertTriangle /></span>
            <small>未闭环异常</small>
            <strong>{abnormalSummary.openCount}</strong>
            <em>本月共 {abnormalSummary.eventCount} 项</em>
          </button>
        </section>

        <div className="hr-overview-command-grid">
          <section className="hr-focus-workspace">
            <header>
              <div>
                <span><Sparkles size={15} />今日人事焦点</span>
                <em>{primaryTask?.stateLabel || '运行正常'}</em>
              </div>
              {primaryTask && <small>{primaryTask.source} · 截止 {primaryTask.dueLabel}</small>}
            </header>
            {primaryTask ? (
              <>
                <div className="hr-focus-workspace-copy">
                  <span>{primaryTask.priority === 'urgent' ? '紧急事项' : '优先事项'}</span>
                  <h2>{primaryTask.title}</h2>
                  <p>当前需要完成岗位信息核对，并交由下一责任人确认，避免人员档案与组织结构脱节。</p>
                </div>
                <div className="hr-focus-workspace-meta">
                  <span><small>当前主责</small><strong>{focusOwner?.name || hrCoordinator?.name || '人事'}</strong></span>
                  <span><small>下一步交接</small><strong>{focusNextPerson?.name || '相关部门负责人'}</strong></span>
                  <span><small>协同人员</small><strong>{focusCollaborators.map(person => person.name).join('、') || '待确认'}</strong></span>
                </div>
                <div className="hr-focus-workspace-footer">
                  <div>
                    <span><i style={{ width: `${primaryTask.progress}%` }} /></span>
                    <small>当前进度</small>
                    <strong>{primaryTask.progress}%</strong>
                  </div>
                  <button type="button" className="hr-secondary-button" onClick={() => changeView('approvals')}>查看全部待办</button>
                  <a className="hr-primary-button" href={primaryTask.route}>进入处理<ArrowRight size={15} /></a>
                </div>
              </>
            ) : (
              <EmptyPanel icon={CheckCircle2} title="当前没有人事协同待办" description="人员档案、考勤和组织状态均可继续正常维护。" />
            )}
          </section>

          <section className="hr-action-queue">
            <header>
              <div><span className="hr-eyebrow">行动队列</span><h2>待办与异常</h2></div>
              <button type="button" onClick={() => changeView('approvals')}>全部<ChevronRight size={15} /></button>
            </header>
            <div>
              <a href="/workspace/attendance">
                <span className="orange"><CalendarClock /></span>
                <span><strong>考勤待确认</strong><small>{attendanceSummary.draftCount} 条草稿等待确认</small></span>
                <em>{attendanceSummary.draftCount}</em>
              </a>
              <button type="button" onClick={() => changeView('attendance')}>
                <span className={abnormalSummary.openCount ? 'red' : 'green'}><ShieldCheck /></span>
                <span><strong>异常待闭环</strong><small>{abnormalSummary.openCount ? '需要核对影响工时' : '当前没有未闭环异常'}</small></span>
                <em>{abnormalSummary.openCount}</em>
              </button>
              <button type="button" onClick={() => changeView('directory')}>
                <span><UserRoundCheck /></span>
                <span><strong>档案待完善</strong><small>缺少部门、岗位或班组信息</small></span>
                <em>{archiveMissingCount}</em>
              </button>
            </div>
          </section>
        </div>

        <div className="hr-overview-insights-grid">
          <section className="hr-people-insight-panel">
            <header>
              <div><span className="hr-eyebrow">真实人员数据</span><h2>人员结构与运行状态</h2></div>
              <button type="button" onClick={() => changeView('analytics')}>查看分析<ChevronRight size={15} /></button>
            </header>
            <div className="hr-people-insight-body">
              <div className="hr-department-insights">
                <strong>部门在岗分布</strong>
                <div>
                  {departmentStats.slice(0, 6).map(item => (
                    <button type="button" key={item.name} onClick={() => focusDepartment(item.name)}>
                      <span>{item.name}<small>{item.active} 人</small></span>
                      <i><b style={{ width: `${(item.active / maxDepartmentCount) * 100}%` }} /></i>
                    </button>
                  ))}
                  {!departmentStats.length && <p>员工档案中尚未形成部门数据。</p>}
                </div>
              </div>
              <div className="hr-running-summary">
                <article><span><Clock3 /></span><small>本月确认出勤</small><strong>{formatHours(attendanceSummary.actualMilliseconds)}</strong></article>
                <article><span className="violet"><CalendarClock /></span><small>本月加班</small><strong>{formatHours(attendanceSummary.overtimeMilliseconds)}</strong></article>
                <article><span className={abnormalSummary.openCount ? 'red' : 'green'}><ShieldCheck /></span><small>异常影响工时</small><strong>{formatHours(abnormalSummary.affectedPersonMilliseconds)}</strong></article>
                <article><span className="green"><UserRoundCheck /></span><small>本月新建档案</small><strong>{summary.newThisMonth} 人</strong></article>
              </div>
            </div>
          </section>

          <section className="hr-recent-people-panel">
            <header>
              <div><span className="hr-eyebrow">档案动态</span><h2>最近人员变化</h2></div>
              <button type="button" onClick={() => changeView('directory')}>查看全部<ChevronRight size={15} /></button>
            </header>
            <div>
              {recentEmployees.map(employee => (
                <button type="button" key={employee.id} onClick={() => { chooseEmployee(employee); changeView('directory'); }}>
                  <span className="hr-person-avatar">{employee.name.slice(0, 1)}</span>
                  <span><strong>{employee.name}</strong><small>{employee.department || '部门待维护'} · {employee.position || '岗位待维护'}</small></span>
                  <span><em className={employee.isActive ? 'ok' : ''}>{employee.isActive ? '在岗' : '停用'}</em><small>{formatDateTime(employee.updatedAt)}</small></span>
                </button>
              ))}
              {!recentEmployees.length && <EmptyPanel icon={UserRound} title="暂无人员档案" description="创建员工后会在这里显示最近变化。" />}
            </div>
          </section>
        </div>

        <div className="hr-overview-bottom-grid">
          <section className="hr-quick-entry-panel">
            <header><div><span className="hr-eyebrow">快捷入口</span><h2>常用人事操作</h2></div></header>
            <div>
              <button type="button" onClick={beginCreate}><span><Plus /></span><strong>新增员工</strong><small>建立人员与岗位档案</small></button>
              <a href="/workspace/attendance"><span className="green"><CalendarCheck2 /></span><strong>考勤确认</strong><small>处理出勤与异常记录</small></a>
              <button type="button" onClick={() => changeView('performance')}><span className="violet"><BarChart3 /></span><strong>绩效数据</strong><small>{attainmentReport?.rows.length || 0} 人形成月度统计</small></button>
              <button type="button" onClick={() => changeView('training')}><span className="orange"><GraduationCap /></span><strong>培训建议</strong><small>{Math.max(1, departmentStats.length)} 个部门可建立计划</small></button>
            </div>
          </section>

          <section className="hr-organization-health">
            <header>
              <div><span className="hr-eyebrow">组织状态</span><h2>组织健康</h2></div>
              <button type="button" onClick={() => changeView('organization')}>查看组织<ChevronRight size={15} /></button>
            </header>
            <div>
              <span><Network /><strong>{departmentStats.length}</strong><small>已建立部门</small></span>
              <span><BadgeCheck /><strong>{archiveCompleteness}%</strong><small>岗位资料完整</small></span>
              <span className={archiveMissingCount ? 'attention' : ''}><UserRoundCheck /><strong>{archiveMissingCount}</strong><small>待补充档案</small></span>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderDirectory() {
    return (
      <div className="hr-view hr-directory-view">
        <section className="hr-directory-toolbar">
          <div>
            <span className="hr-eyebrow">员工档案</span>
            <h1>人员与岗位资料</h1>
            <p>维护真实员工档案、组织归属、岗位班组和考勤范围。</p>
          </div>
          <div className="hr-directory-tools">
            <label><Search size={17} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、姓名、部门、岗位或班组" /></label>
            <select aria-label="员工状态" value={filter} onChange={event => setFilter(event.target.value as EmployeeFilter)}>
              <option value="all">全部员工</option>
              <option value="active">在岗员工</option>
              <option value="attendance">启用考勤</option>
              <option value="inactive">已停用</option>
            </select>
            {selectedDepartment && <button type="button" className="hr-filter-chip" onClick={() => setSelectedDepartment('')}>{selectedDepartment} ×</button>}
            <button type="button" className="hr-icon-button" title="刷新员工档案" onClick={() => void loadHumanResources()}><RefreshCw size={17} /></button>
            <button type="button" className="hr-primary-button" onClick={beginCreate}><Plus size={17} />新增员工</button>
          </div>
        </section>

        <section className="hr-directory-metrics">
          <span><strong>{summary.total}</strong><small>档案总数</small></span>
          <span><strong>{summary.active}</strong><small>在岗员工</small></span>
          <span><strong>{summary.attendance}</strong><small>启用考勤</small></span>
          <span><strong>{summary.inactive}</strong><small>已停用</small></span>
        </section>

        <div className="hr-directory-grid">
          <section className="hr-employee-list">
            <header><h2>员工目录</h2><em>{filteredEmployees.length} 人</em></header>
            <div className="hm-scroll-region" tabIndex={0}>
              {filteredEmployees.map(employee => (
                <button
                  className={`${selectedEmployeeId === employee.id && !creating ? 'selected' : ''} ${employee.isActive ? '' : 'inactive'}`.trim()}
                  type="button"
                  key={employee.id}
                  onClick={() => chooseEmployee(employee)}
                >
                  <span className="hr-person-avatar">{employee.name.slice(0, 1)}</span>
                  <span className="hr-employee-copy">
                    <strong>{employee.name}</strong>
                    <small>{employee.employeeNo} · {employee.department || '部门待维护'}</small>
                    <small>{employee.position || '岗位待维护'} · {employee.team || '班组待维护'}</small>
                  </span>
                  <em className={employee.isActive ? 'ok' : ''}>{statusLabel(employee)}</em>
                </button>
              ))}
              {!loading && !filteredEmployees.length && (
                <EmptyPanel
                  icon={UserRound}
                  title="没有符合条件的员工"
                  description="调整搜索或筛选条件，或创建新的员工档案。"
                  action={<button type="button" className="hr-text-button" onClick={beginCreate}>新增员工</button>}
                />
              )}
            </div>
          </section>

          <section className="hr-employee-editor">
            <header>
              <div>
                <span>{creating ? '新增人员' : '员工档案'}</span>
                <h2>{creating ? '创建员工档案' : selectedEmployee?.name || '请选择员工'}</h2>
                {!creating && selectedEmployee && <p>{selectedEmployee.employeeNo} · 更新于 {formatDateTime(selectedEmployee.updatedAt)}</p>}
              </div>
              {!creating && selectedEmployee && <em className={selectedEmployee.isActive ? 'ok' : ''}>{statusLabel(selectedEmployee)}</em>}
            </header>
            <div className="hr-editor-scroll hm-scroll-region">
              <div className="hr-editor-form">
                <label><span>员工编号 *</span><input value={draft.employeeNo} maxLength={40} onChange={event => setDraft(current => ({ ...current, employeeNo: event.target.value }))} placeholder="例如 0001" /></label>
                <label><span>员工姓名 *</span><input value={draft.name} maxLength={80} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="填写真实姓名" /></label>
                <label><span>部门</span><input value={draft.department} maxLength={80} onChange={event => setDraft(current => ({ ...current, department: event.target.value }))} placeholder="例如 生产部" /></label>
                <label><span>岗位</span><input value={draft.position} maxLength={80} onChange={event => setDraft(current => ({ ...current, position: event.target.value }))} placeholder="例如 压接操作员" /></label>
                <label className="wide"><span>班组</span><input value={draft.team} maxLength={80} onChange={event => setDraft(current => ({ ...current, team: event.target.value }))} placeholder="例如 前端一组" /></label>
              </div>
              <div className="hr-editor-switches">
                <label>
                  <input type="checkbox" checked={draft.attendanceEnabled} onChange={event => setDraft(current => ({ ...current, attendanceEnabled: event.target.checked }))} />
                  <span><strong>纳入考勤与个人达成率</strong><small>启用后可登记出勤、加班、请假和异常工时。</small></span>
                </label>
                {!creating && (
                  <label>
                    <input type="checkbox" checked={draft.isActive} onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))} />
                    <span><strong>允许选择该员工报工</strong><small>停用不会删除历史考勤、工时和生产记录。</small></span>
                  </label>
                )}
              </div>
              {!creating && selectedEmployee && (
                <div className="hr-editor-links">
                  <a href={`/workspace/attendance?employeeId=${encodeURIComponent(selectedEmployee.id)}`}><CalendarClock /><span><strong>查看考勤与异常</strong><small>定位至该员工的考勤记录</small></span><ChevronRight /></a>
                  <a href={`/workspace/reports?employeeId=${encodeURIComponent(selectedEmployee.id)}`}><BarChart3 /><span><strong>查看员工达成率</strong><small>进入报表中心核对工时</small></span><ChevronRight /></a>
                </div>
              )}
              <div className="hr-editor-note"><BadgeCheck /><div><strong>档案与账号分开管理</strong><span>生产员工无需拥有登录账号；停用员工后，历史业务数据继续保留。</span></div></div>
              {formError && <div className="hr-editor-error" role="alert"><AlertTriangle size={16} />{formError}</div>}
            </div>
            <footer>
              <span>{dirty ? '有未保存修改' : creating ? '填写信息后创建档案' : '档案已保存'}</span>
              <button type="button" className="hr-primary-button" disabled={saving || (!creating && !selectedEmployee)} onClick={() => void saveEmployee()}>
                {saving ? <Loader2 className="spin" size={17} /> : dirty ? <Save size={17} /> : <CheckCircle2 size={17} />}
                {saving ? '保存中…' : creating ? '创建员工' : '保存员工档案'}
              </button>
            </footer>
          </section>
        </div>
      </div>
    );
  }

  function renderRecruiting() {
    const recruitingItems = [
      { department: '生产车间', role: '一线操作岗位储备', demand: Math.max(1, Math.ceil(summary.active * 0.05)), stage: '需求确认', tone: 'blue' },
      { department: '质量管理', role: '质量检验岗位储备', demand: 1, stage: '岗位画像', tone: 'violet' },
      { department: '仓库', role: '仓库协同岗位储备', demand: 1, stage: '待审批', tone: 'orange' },
    ];
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">招聘管理 · 前端工作区</span><h1>人员需求与招聘进度</h1><p>先建立岗位需求、阶段和协同入口；候选人、面试与录用数据将在后续接入。</p></div>
          <button type="button" className="hr-primary-button" onClick={() => setToast('招聘需求接口已预留，当前版本暂不写入数据')}><Plus size={17} />新建招聘需求</button>
        </section>
        <DataUnavailable message="当前系统尚无招聘台账接口。本页为可交互的前端工作区，不会把规划数据伪装成真实候选人记录。" />
        <section className="hr-metric-grid compact">
          <MetricCard icon={BriefcaseBusiness} label="规划岗位" value={recruitingItems.length} note="待与正式编制联动" />
          <MetricCard icon={UsersRound} label="计划补充人数" value={recruitingItems.reduce((sum, item) => sum + item.demand, 0)} note="基于当前组织规模预览" tone="green" />
          <MetricCard icon={ClipboardCheck} label="待确认需求" value={2} note="需部门主管确认" tone="orange" />
          <MetricCard icon={UserRoundCheck} label="候选人数据" value="未接入" note="不生成虚假人员信息" tone="violet" />
        </section>
        <div className="hr-module-grid">
          <section className="hr-main-panel hr-recruiting-board">
            <header className="hr-section-header"><div><span>需求池</span><h2>岗位招聘规划</h2></div><em>人事协调：{hrCoordinator?.name || '待配置'}</em></header>
            <div>
              {recruitingItems.map(item => (
                <article key={item.role}>
                  <span className={`hr-module-icon ${item.tone}`}><BriefcaseBusiness /></span>
                  <div><small>{item.department}</small><strong>{item.role}</strong><p>计划补充 {item.demand} 人 · 部门主管确认后进入招聘流程</p></div>
                  <em>{item.stage}</em>
                  <button type="button" onClick={() => setToast(`${item.role}：真实招聘台账接入后可继续维护`)}>查看规划<ChevronRight /></button>
                </article>
              ))}
            </div>
          </section>
          <aside className="hr-main-panel hr-stage-panel">
            <header className="hr-section-header"><div><span>流程预览</span><h2>招聘协同阶段</h2></div></header>
            <ol>
              {['需求确认', '岗位画像', '候选筛选', '面试安排', '录用入职'].map((label, index) => (
                <li key={label} className={index < 2 ? 'active' : ''}><span>{index + 1}</span><div><strong>{label}</strong><small>{index < 2 ? '可进行规划' : '待数据接入'}</small></div></li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    );
  }

  function renderAttendance() {
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">考勤管理 · 本月</span><h1>出勤、请假与异常确认</h1><p>汇总现有考勤记录和异常工时，具体登记与确认仍在原考勤工作台完成。</p></div>
          <a className="hr-primary-button" href="/workspace/attendance">进入考勤工作台<ArrowRight size={17} /></a>
        </section>
        <section className="hr-metric-grid compact">
          <MetricCard icon={UsersRound} label="考勤覆盖员工" value={attendanceSummary.enabledEmployeeCount} note={`覆盖率 ${attendanceCoverage}%`} />
          <MetricCard icon={CalendarCheck2} label="已确认记录" value={attendanceSummary.confirmedCount} note={`共 ${attendanceSummary.recordCount} 条`} tone="green" />
          <MetricCard icon={ClipboardCheck} label="待确认草稿" value={attendanceSummary.draftCount} note="进入考勤工作台处理" tone={attendanceSummary.draftCount ? 'orange' : 'green'} />
          <MetricCard icon={AlertTriangle} label="待审核异常" value={abnormalSummary.pendingCount} note={`未闭环 ${abnormalSummary.openCount} 项`} tone={abnormalSummary.pendingCount ? 'red' : 'green'} />
        </section>
        <div className="hr-module-grid wide-main">
          <section className="hr-main-panel hr-attendance-list">
            <header className="hr-section-header"><div><span>真实记录</span><h2>最近考勤动态</h2></div><a href="/workspace/attendance">查看全部<ChevronRight size={15} /></a></header>
            <div className="hr-data-table">
              <div className="hr-data-head"><span>员工</span><span>工作日</span><span>类型</span><span>实际出勤</span><span>状态</span></div>
              {attendanceRecords.slice(0, 8).map(record => (
                <a href={`/workspace/attendance?employeeId=${encodeURIComponent(record.employeeId)}`} className="hr-data-row" key={record.id}>
                  <span><b className="hr-person-avatar">{record.employee.name.slice(0, 1)}</b><strong>{record.employee.name}<small>{record.employee.employeeNo}</small></strong></span>
                  <span>{record.workDate}</span>
                  <span>{record.attendanceType === 'normal' ? '正常出勤' : record.attendanceType === 'leave' ? '请假' : record.attendanceType === 'absent' ? '缺勤' : '休息'}</span>
                  <span>{formatHours(record.actualMilliseconds)}</span>
                  <span><em className={record.status === 'confirmed' ? 'success' : 'warning'}>{record.status === 'confirmed' ? '已确认' : '草稿'}</em></span>
                </a>
              ))}
              {!attendanceRecords.length && <EmptyPanel icon={CalendarCheck2} title="本月暂无考勤记录" description="可进入考勤工作台开始登记。" action={<a className="hr-text-button" href="/workspace/attendance">开始登记</a>} />}
            </div>
          </section>
          <aside className="hr-main-panel hr-attendance-side">
            <header className="hr-section-header"><div><span>本月</span><h2>工时结构</h2></div></header>
            <div className="hr-stat-stack">
              <article><span><Clock3 />确认出勤</span><strong>{formatHours(attendanceSummary.actualMilliseconds)}</strong></article>
              <article><span><CalendarClock />加班工时</span><strong>{formatHours(attendanceSummary.overtimeMilliseconds)}</strong></article>
              <article><span><Activity />请假工时</span><strong>{formatHours(attendanceSummary.leaveMilliseconds)}</strong></article>
              <article><span><AlertTriangle />异常影响</span><strong>{formatHours(abnormalSummary.affectedPersonMilliseconds)}</strong></article>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  function renderPerformance() {
    const rows = [...(attainmentReport?.rows || [])]
      .sort((left, right) => (right.attainmentBasisPoints || -1) - (left.attainmentBasisPoints || -1));
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">薪酬绩效 · 本月</span><h1>生产工时与人员达成率</h1><p>绩效区使用现有报工、标准工时和考勤数据；薪资结构与核算规则尚未接入。</p></div>
          <a className="hr-primary-button" href="/workspace/reports">打开报表中心<ArrowRight size={17} /></a>
        </section>
        <DataUnavailable message="薪酬数据尚未接入。本页不会展示或推算个人工资，仅呈现现有生产绩效依据。" />
        <section className="hr-metric-grid compact">
          <MetricCard icon={UsersRound} label="形成绩效统计" value={attainmentReport?.summary.employeeCount || 0} note="有考勤或报工数据的员工" />
          <MetricCard icon={Activity} label="人员达成率" value={formatPercent(attainmentReport?.summary.attainmentBasisPoints)} note="标准工时 ÷ 有效出勤" tone="green" />
          <MetricCard icon={Clock3} label="已认领标准工时" value={formatHours(attainmentReport?.summary.claimedStandardLaborMilliseconds || 0)} note={`认领 ${attainmentReport?.summary.claimQuantity || 0} 件`} tone="violet" />
          <MetricCard icon={AlertTriangle} label="考勤缺失员工" value={attainmentReport?.summary.attendanceMissingCount || 0} note="需要补充出勤依据" tone={(attainmentReport?.summary.attendanceMissingCount || 0) ? 'orange' : 'green'} />
        </section>
        <section className="hr-main-panel hr-performance-table">
          <header className="hr-section-header"><div><span>真实数据</span><h2>员工绩效明细</h2></div><em>计算口径沿用报表中心</em></header>
          <div className="hr-data-table">
            <div className="hr-data-head performance"><span>员工</span><span>标准工时</span><span>有效出勤</span><span>领取数量</span><span>达成率</span><span>考勤依据</span></div>
            {rows.slice(0, 12).map(row => (
              <a href={`/workspace/reports?employeeId=${encodeURIComponent(row.employee.id)}`} className="hr-data-row performance" key={row.employee.id}>
                <span><b className="hr-person-avatar">{row.employee.name.slice(0, 1)}</b><strong>{row.employee.name}<small>{row.employee.position || '岗位待维护'}</small></strong></span>
                <span>{formatHours(row.standardLaborMilliseconds)}</span>
                <span>{formatHours(row.effectiveProductionMilliseconds)}</span>
                <span>{row.claimQuantity.toLocaleString('zh-CN')}</span>
                <span><strong className="hr-rate">{formatPercent(row.attainmentBasisPoints)}</strong></span>
                <span><em className={row.attendanceMissing ? 'warning' : 'success'}>{row.attendanceMissing ? '有缺失' : '已覆盖'}</em></span>
              </a>
            ))}
            {!rows.length && <EmptyPanel icon={BarChart3} title="本月尚未形成绩效数据" description="员工完成报工认领并登记考勤后会自动汇总。" action={<a className="hr-text-button" href="/workspace/reports">查看报表说明</a>} />}
          </div>
        </section>
      </div>
    );
  }

  function renderTraining() {
    const trainingPlans = [
      { title: '新员工岗位与安全说明', audience: '本月新建员工档案', count: summary.newThisMonth, owner: hrCoordinator?.name || '人事待配置', status: summary.newThisMonth ? '建议建立' : '无需安排', icon: ShieldCheck },
      { title: '考勤与报工规范复训', audience: '考勤依据缺失人员', count: attainmentReport?.summary.attendanceMissingCount || 0, owner: hrCoordinator?.name || '人事待配置', status: (attainmentReport?.summary.attendanceMissingCount || 0) ? '需要关注' : '状态正常', icon: CalendarCheck2 },
      { title: '岗位工艺能力提升', audience: '生产与工艺相关岗位', count: departmentStats.find(item => item.name.includes('生产'))?.active || 0, owner: '部门主管待确认', status: '规划中', icon: GraduationCap },
    ];
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">培训发展 · 前端工作区</span><h1>岗位能力与培养计划</h1><p>结合员工档案、考勤和绩效风险给出培训建议，正式培训记录将在后续接入。</p></div>
          <button type="button" className="hr-primary-button" onClick={() => setToast('培训计划接口已预留，当前版本暂不写入数据')}><Plus size={17} />新建培训计划</button>
        </section>
        <DataUnavailable message="当前系统尚无培训台账。本页建议来自现有员工与工时数据，不代表培训已经执行或归档。" />
        <div className="hr-training-layout">
          <section className="hr-main-panel hr-training-plans">
            <header className="hr-section-header"><div><span>能力建议</span><h2>培训计划工作区</h2></div><em>{trainingPlans.length} 项建议</em></header>
            <div>
              {trainingPlans.map(plan => {
                const Icon = plan.icon;
                return (
                  <article key={plan.title}>
                    <span><Icon /></span>
                    <div><strong>{plan.title}</strong><p>{plan.audience} · 建议覆盖 {plan.count} 人</p><small>协调人：{plan.owner}</small></div>
                    <em>{plan.status}</em>
                    <button type="button" onClick={() => setToast(`${plan.title}：待培训台账接入后可创建排期`)}>查看建议<ChevronRight /></button>
                  </article>
                );
              })}
            </div>
          </section>
          <aside className="hr-main-panel hr-competency-panel">
            <header className="hr-section-header"><div><span>档案质量</span><h2>能力数据准备度</h2></div></header>
            <div className="hr-readiness-ring"><strong>{archiveCompleteness}%</strong><span>组织资料完整</span></div>
            <ul>
              <li><span>部门信息</span><strong>{employees.filter(item => item.department).length} / {summary.total}</strong></li>
              <li><span>岗位信息</span><strong>{employees.filter(item => item.position).length} / {summary.total}</strong></li>
              <li><span>班组信息</span><strong>{employees.filter(item => item.team).length} / {summary.total}</strong></li>
            </ul>
          </aside>
        </div>
      </div>
    );
  }

  function renderOrganization() {
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">组织架构 · 实时员工档案</span><h1>部门、岗位与班组分布</h1><p>组织视图直接由员工档案生成；点击部门可进入对应人员清单。</p></div>
          <button type="button" className="hr-secondary-button" onClick={() => changeView('directory')}><PencilLine size={17} />维护组织信息</button>
        </section>
        <section className="hr-organization-root">
          <article>
            <span className="hr-organization-logo">杭</span>
            <div><small>组织总览</small><h2>杭连电子协同团队</h2><p>{summary.active} 名在岗员工 · {departmentStats.length} 个部门或组织分组</p></div>
          </article>
          <span className="hr-org-line" aria-hidden="true" />
          <div className="hr-org-departments">
            {departmentStats.map(item => {
              const people = employees.filter(employee => departmentName(employee) === item.name && employee.isActive);
              return (
                <button type="button" key={item.name} onClick={() => focusDepartment(item.name)}>
                  <span className="hr-module-icon blue"><UsersRound /></span>
                  <strong>{item.name}</strong>
                  <p>{item.active} 人在岗 · {item.attendance} 人启用考勤</p>
                  <div>{people.slice(0, 4).map(person => <i key={person.id} title={`${person.name} · ${person.position || '岗位待维护'}`}>{person.name.slice(0, 1)}</i>)}{people.length > 4 && <em>+{people.length - 4}</em>}</div>
                  <small>查看人员<ChevronRight size={14} /></small>
                </button>
              );
            })}
            {!departmentStats.length && <EmptyPanel icon={Network} title="尚未形成组织架构" description="在员工档案中维护部门、岗位和班组后自动生成。" action={<button className="hr-text-button" type="button" onClick={() => changeView('directory')}>维护员工档案</button>} />}
          </div>
        </section>
      </div>
    );
  }

  function renderApprovals() {
    const approvalItems = [
      ...(attendanceSummary.draftCount ? [{
        id: 'attendance-drafts',
        title: `${attendanceSummary.draftCount} 条考勤草稿待确认`,
        source: '考勤管理',
        due: '本月待处理',
        status: '待确认',
        route: '/workspace/attendance',
        tone: 'warning',
      }] : []),
      ...(abnormalSummary.pendingCount ? [{
        id: 'abnormal-pending',
        title: `${abnormalSummary.pendingCount} 项异常工时待质量确认`,
        source: '考勤与异常',
        due: '建议当日闭环',
        status: '待审核',
        route: '/workspace/attendance',
        tone: 'danger',
      }] : []),
      ...hrWorkItems.map(item => ({
        id: item.id,
        title: item.title,
        source: item.source,
        due: item.dueLabel,
        status: item.stateLabel,
        route: item.route,
        tone: item.priority === 'urgent' ? 'danger' : item.priority === 'high' ? 'warning' : 'normal',
      })),
    ];
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">审批中心 · 协同汇总</span><h1>人事待办与跨模块确认</h1><p>集中展示现有考勤、异常工时和职责协同事项；实际处理仍回到对应业务模块。</p></div>
          <button type="button" className="hr-secondary-button" onClick={() => void loadHumanResources()}><RefreshCw size={17} />刷新待办</button>
        </section>
        <section className="hr-metric-grid compact">
          <MetricCard icon={ClipboardCheck} label="全部待办" value={approvalItems.length} note="当前可定位事项" />
          <MetricCard icon={CalendarCheck2} label="考勤确认" value={attendanceSummary.draftCount} note="草稿记录" tone="orange" />
          <MetricCard icon={ShieldCheck} label="异常审核" value={abnormalSummary.pendingCount} note="质量待确认" tone="red" />
          <MetricCard icon={UsersRound} label="人事协同" value={hrWorkItems.length} note={`负责人 ${hrCoordinator?.name || '待配置'}`} tone="violet" />
        </section>
        <section className="hr-main-panel hr-approval-list">
          <header className="hr-section-header"><div><span>行动入口</span><h2>待处理事项</h2></div><em>点击进入来源模块</em></header>
          <div>
            {approvalItems.map(item => (
              <a href={item.route} key={item.id} className={`tone-${item.tone}`}>
                <span><ClipboardCheck /></span>
                <div><small>{item.source}</small><strong>{item.title}</strong><p>时限：{item.due}</p></div>
                <em>{item.status}</em>
                <b>进入处理<ArrowRight size={15} /></b>
              </a>
            ))}
            {!approvalItems.length && <EmptyPanel icon={CheckCircle2} title="当前没有待处理事项" description="考勤草稿、异常审核或人事协同事项出现后会在这里汇总。" action={<button type="button" className="hr-text-button" onClick={() => changeView('overview')}>返回人事首页</button>} />}
          </div>
        </section>
      </div>
    );
  }

  function renderAnalytics() {
    return (
      <div className="hr-view hr-module-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">报表分析 · 本月</span><h1>人力运营数据洞察</h1><p>从员工档案、考勤、异常和生产工时汇总可核验的人事指标。</p></div>
          <a className="hr-primary-button" href="/workspace/reports">打开完整报表<ArrowRight size={17} /></a>
        </section>
        <section className="hr-metric-grid compact">
          <MetricCard icon={UsersRound} label="在岗人数" value={summary.active} note={`停用 ${summary.inactive} 人`} />
          <MetricCard icon={CalendarCheck2} label="考勤覆盖率" value={`${attendanceCoverage}%`} note={`${summary.attendance} 人启用`} tone="green" />
          <MetricCard icon={Activity} label="人员达成率" value={formatPercent(attainmentReport?.summary.attainmentBasisPoints)} note="标准工时 ÷ 有效出勤" tone="violet" />
          <MetricCard icon={AlertTriangle} label="异常闭环率" value={abnormalSummary.eventCount ? `${Math.round(((abnormalSummary.eventCount - abnormalSummary.openCount) / abnormalSummary.eventCount) * 100)}%` : '100%'} note={`${abnormalSummary.openCount} 项未闭环`} tone={abnormalSummary.openCount ? 'orange' : 'green'} />
        </section>
        <div className="hr-analytics-grid">
          <section className="hr-main-panel hr-analytics-chart">
            <header className="hr-section-header"><div><span>组织结构</span><h2>部门在岗人数</h2></div><em>来自员工档案</em></header>
            <div>
              {departmentStats.map((item, index) => (
                <button type="button" key={item.name} onClick={() => focusDepartment(item.name)}>
                  <span>{item.name}</span>
                  <i><b style={{ width: `${(item.active / maxDepartmentCount) * 100}%`, transitionDelay: `${index * 45}ms` }} /></i>
                  <strong>{item.active}</strong>
                </button>
              ))}
              {!departmentStats.length && <EmptyPanel icon={BarChart3} title="暂无部门分布" description="完善员工部门后自动形成分析。" />}
            </div>
          </section>
          <section className="hr-main-panel hr-analytics-chart">
            <header className="hr-section-header"><div><span>数据质量</span><h2>人事基础数据覆盖</h2></div><em>实时</em></header>
            <div className="hr-coverage-list">
              {[
                { label: '档案完整度', value: archiveCompleteness, tone: 'blue' },
                { label: '考勤覆盖率', value: attendanceCoverage, tone: 'green' },
                { label: '考勤确认率', value: attendanceSummary.recordCount ? Math.round(attendanceSummary.confirmedCount / attendanceSummary.recordCount * 100) : 0, tone: 'violet' },
                { label: '异常闭环率', value: abnormalSummary.eventCount ? Math.round((abnormalSummary.eventCount - abnormalSummary.openCount) / abnormalSummary.eventCount * 100) : 100, tone: 'orange' },
              ].map(item => (
                <article key={item.label}>
                  <div><strong>{item.label}</strong><em>{item.value}%</em></div>
                  <span><i className={item.tone} style={{ width: `${clampPercent(item.value)}%` }} /></span>
                </article>
              ))}
            </div>
          </section>
          <section className="hr-main-panel hr-analytics-summary">
            <header className="hr-section-header"><div><span>工时数据</span><h2>本月人员投入</h2></div></header>
            <div>
              <article><Clock3 /><span><small>确认出勤</small><strong>{formatHours(attendanceSummary.actualMilliseconds)}</strong></span></article>
              <article><BadgeCheck /><span><small>标准工时</small><strong>{formatHours(attainmentReport?.summary.standardLaborMilliseconds || 0)}</strong></span></article>
              <article><AlertTriangle /><span><small>异常影响</small><strong>{formatHours(abnormalSummary.affectedPersonMilliseconds)}</strong></span></article>
              <article><UserRoundCheck /><span><small>本月新档案</small><strong>{summary.newThisMonth} 人</strong></span></article>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderActiveView() {
    switch (view) {
      case 'directory': return renderDirectory();
      case 'recruiting': return renderRecruiting();
      case 'attendance': return renderAttendance();
      case 'performance': return renderPerformance();
      case 'training': return renderTraining();
      case 'organization': return renderOrganization();
      case 'approvals': return renderApprovals();
      case 'analytics': return renderAnalytics();
      default: return renderOverview();
    }
  }

  return (
    <main className="hr-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/employees"
        subtitle="人员、组织、考勤与发展协同"
        searchSlot={(
          <label className="hr-global-search">
            <Search size={17} aria-hidden="true" />
            <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索员工、部门、岗位或人事功能" />
            <kbd>Ctrl K</kbd>
          </label>
        )}
        menuItems={[
          { label: '修改密码', href: '/dashboard?changePassword=1' },
          { label: '退出登录', onSelect: () => void logout() },
        ]}
      />

      <div className="hr-shell">
        <nav className="hr-module-tabs" aria-label="人事管理功能导航">
          <div className="hr-module-tab-list">
            {hrNavigation.map(item => {
              const Icon = item.icon;
              return (
                <button type="button" key={item.id} className={view === item.id ? 'active' : ''} onClick={() => changeView(item.id)}>
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === 'approvals' && pendingApprovalCount > 0 && <em>{pendingApprovalCount}</em>}
                </button>
              );
            })}
          </div>
          <label className="hr-module-mobile-select">
            <span>当前功能</span>
            <select value={view} onChange={event => changeView(event.target.value as HrView)} aria-label="切换人事功能">
              {hrNavigation.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>
        </nav>

        <section className="hr-content">
          {error && <div className="hr-page-error" role="alert"><AlertTriangle size={17} />{error}<button type="button" onClick={() => void loadHumanResources()}>重新加载</button></div>}
          {auxiliaryWarning && !error && <div className="hr-auxiliary-warning" title={auxiliaryWarning}><AlertTriangle size={14} /><span>部分辅助数据暂不可用，员工档案仍可正常使用</span></div>}
          {renderActiveView()}
        </section>
      </div>

      {loading && <div className="hr-loading"><Loader2 className="spin" size={17} />正在汇总人事数据</div>}
    </main>
  );
}
