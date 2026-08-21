'use client';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileBarChart,
  FolderTree,
  GraduationCap,
  IdCard,
  KeyRound,
  Layers3,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  MapPin,
  MessageSquareText,
  Monitor,
  MoreHorizontal,
  Network,
  PencilLine,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
  UserRoundCheck,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmployeeNumberReorderDialog from '@/components/EmployeeNumberReorderDialog';
import { useToastBridge } from '@/components/ToastProvider';
import { ResponsibilityMatrixWorkspace } from '@/components/ResponsibilityMatrixWorkspace';
import SkillPerformanceWorkbench from '@/components/SkillPerformanceWorkbench';
import TrainingDevelopmentWorkbench from '@/components/TrainingDevelopmentWorkbench';
import {
  responsibilityPeople,
  responsibilityWorkItems,
} from '@/lib/responsibility-collaboration';
import {
  isProductionDepartment,
  isProductionWorkforceEmployee,
} from '@/lib/production-workforce';
import type {
  AbnormalTimeEventDTO,
  AttendanceRecordDTO,
  AttainmentStream,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeDTO,
  RecruitmentCandidateDTO,
  RecruitmentDemandDTO,
  RecruitmentDemandStatusDTO,
  RecruitmentSummaryDTO,
  UserAccessGrantDTO,
  UserDTO,
} from '@/types';

type HrView =
  | 'overview'
  | 'directory'
  | 'recruiting'
  | 'attendance'
  | 'performance'
  | 'training'
  | 'organization'
  | 'responsibilities'
  | 'approvals'
  | 'analytics';

type EmployeeFilter = 'all' | 'active' | 'attendance' | 'inactive';
type DirectoryDetailTab = 'basic' | 'appointment' | 'attendance' | 'collaboration';

type EmployeeDraft = {
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  team: string;
  hireDate: string;
  mobile: string;
  notificationEnabled: boolean;
  isActive: boolean;
  attendanceEnabled: boolean;
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
};

type EmployeesResponse = {
  ok: boolean;
  employees?: EmployeeDTO[];
  employee?: EmployeeDTO;
  error?: string;
};

type EmploymentImpact = {
  activeAssignments: number;
  plannedAssignments: number;
  activeMemberships: number;
  pendingCrossTeamRequests: number;
  weeklyPresets: number;
  futureCapacityOverrides: number;
  futureAttendanceRecords: number;
  openIssues: number;
  linkedLogin: boolean;
  linkedLoginActive: boolean;
};

type EmploymentActionResponse = {
  ok: boolean;
  employee?: EmployeeDTO;
  impact?: EmploymentImpact;
  blocked?: boolean;
  blockerMessage?: string | null;
  history?: Array<{
    id: string;
    eventType: string;
    effectiveDate: string;
    reason: string | null;
    note: string | null;
    actorName: string;
    createdAt: string;
  }>;
  error?: string;
  code?: string;
  message?: string;
  accountAccessRequiresAdmin?: boolean;
};

type EmploymentDialogMode = 'offboard' | 'reinstate' | null;

type EmploymentActionDraft = {
  effectiveDate: string;
  reason: string;
  note: string;
  attendanceEnabled: boolean;
};

type NextEmployeeNumberResponse = {
  ok: boolean;
  nextEmployeeNo?: string;
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

type RecruitmentResponse = {
  ok: boolean;
  demands?: RecruitmentDemandDTO[];
  demand?: RecruitmentDemandDTO;
  summary?: RecruitmentSummaryDTO;
  employeeNo?: string;
  error?: string;
};

type RecruitmentDemandDraft = {
  department: string;
  position: string;
  team: string;
  headcount: string;
  employmentType: string;
  priority: string;
  reason: string;
  requirements: string;
  targetDate: string;
  requesterId: string;
  coordinatorId: string;
};

type RecruitmentCandidateDraft = {
  name: string;
  phone: string;
  source: string;
  currentCompany: string;
  currentPosition: string;
  experienceYears: string;
  expectedSalary: string;
  notes: string;
  nextActionAt: string;
};

type RecruitmentInterviewDraft = {
  scheduledAt: string;
  durationMinutes: string;
  interviewerId: string;
  method: string;
  location: string;
  result: string;
  feedback: string;
};

type RecruitmentHireDraft = {
  department: string;
  position: string;
  team: string;
  attendanceEnabled: boolean;
};

type RecruitmentDialog =
  | 'demand'
  | 'candidate'
  | 'interview'
  | 'interview-result'
  | 'hire'
  | null;

type HrNavItem = {
  id: HrView;
  label: string;
  description: string;
  icon: LucideIcon;
};

const hrNavigation: HrNavItem[] = [
  { id: 'overview', label: '人事首页', description: '人力与协同总览', icon: LayoutDashboard },
  { id: 'directory', label: '员工档案', description: '人员与岗位资料', icon: UserRound },
  { id: 'recruiting', label: '招聘管理', description: '需求、候选与录用闭环', icon: BriefcaseBusiness },
  { id: 'attendance', label: '考勤管理', description: '出勤与异常确认', icon: CalendarCheck2 },
  { id: 'performance', label: '技能绩效', description: '技能矩阵、岗位考核与认证', icon: BadgeCheck },
  { id: 'training', label: '培训发展', description: '岗位能力与培养计划', icon: GraduationCap },
  { id: 'organization', label: '组织架构', description: '部门与班组分布', icon: Network },
  { id: 'responsibilities', label: '职责配置', description: '责任矩阵与人员归属', icon: Layers3 },
  { id: 'approvals', label: '审批中心', description: '人事协同待办', icon: ClipboardCheck },
  { id: 'analytics', label: '报表分析', description: '人力数据洞察', icon: FileBarChart },
];

const directoryDetailTabs: Array<{ id: DirectoryDetailTab; label: string; icon: LucideIcon }> = [
  { id: 'basic', label: '基本信息', icon: UserRound },
  { id: 'appointment', label: '任职与权限', icon: BriefcaseBusiness },
  { id: 'attendance', label: '考勤记录', icon: CalendarClock },
  { id: 'collaboration', label: '协作职责', icon: Network },
];

const emptyDraft: EmployeeDraft = {
  employeeNo: '',
  name: '',
  department: '',
  position: '',
  team: '',
  hireDate: '',
  mobile: '',
  notificationEnabled: true,
  isActive: true,
  attendanceEnabled: true,
  attainmentEligible: true,
  attainmentFactorBasisPoints: 10000,
  attainmentStream: 'batch',
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

const emptyRecruitmentSummary: RecruitmentSummaryDTO = {
  demandCount: 0,
  activeDemandCount: 0,
  pendingApprovalCount: 0,
  plannedHeadcount: 0,
  remainingHeadcount: 0,
  candidateCount: 0,
  interviewCount: 0,
  hiredCount: 0,
  overdueCount: 0,
};

const emptyRecruitmentDemandDraft: RecruitmentDemandDraft = {
  department: '',
  position: '',
  team: '',
  headcount: '1',
  employmentType: 'full_time',
  priority: 'NORMAL',
  reason: '',
  requirements: '',
  targetDate: '',
  requesterId: '',
  coordinatorId: '',
};

const emptyRecruitmentCandidateDraft: RecruitmentCandidateDraft = {
  name: '',
  phone: '',
  source: '',
  currentCompany: '',
  currentPosition: '',
  experienceYears: '',
  expectedSalary: '',
  notes: '',
  nextActionAt: '',
};

const emptyRecruitmentInterviewDraft: RecruitmentInterviewDraft = {
  scheduledAt: '',
  durationMinutes: '60',
  interviewerId: '',
  method: 'onsite',
  location: '',
  result: 'pass',
  feedback: '',
};

const emptyRecruitmentHireDraft: RecruitmentHireDraft = {
  department: '',
  position: '',
  team: '',
  attendanceEnabled: true,
};

const recruitmentStageOptions: Array<{ value: RecruitmentDemandStatusDTO | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING_APPROVAL', label: '待审批' },
  { value: 'RECRUITING', label: '招聘中' },
  { value: 'INTERVIEWING', label: '面试中' },
  { value: 'OFFER', label: '待录用' },
  { value: 'CLOSED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
];

function toDraft(employee: EmployeeDTO): EmployeeDraft {
  return {
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department || '',
    position: employee.position || '',
    team: employee.team || '',
    hireDate: employee.hireDate || '',
    mobile: employee.mobile || '',
    notificationEnabled: employee.notificationEnabled,
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
    attainmentEligible: employee.attainmentEligible,
    attainmentFactorBasisPoints: employee.attainmentFactorBasisPoints,
    attainmentStream: employee.attainmentStream,
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function employeeAccessProfileLabel(value?: string | null): string {
  if (value === 'ADMIN_GLOBAL') return '管理员全权限';
  if (value === 'DEPARTMENT_FULL') return '部门工作台';
  if (value === 'PROCESS_SPECIALIST') return '工艺专员';
  if (value === 'FIELD_REPORTER') return '扫码报工';
  if (value === 'GM_OFFICE_READER_APPROVER') return '总经办只读与重大审批';
  if (value === 'FINANCE_ACCOUNT_ONLY') return '财务账号接入';
  if (value === 'WORKSHOP_SUPERVISOR') return '车间主管';
  if (value === 'WORKSHOP_TEAM_LEADER') return '车间组长';
  if (value === 'PLANNING_COLLABORATOR') return '计划协同';
  if (value === 'PRODUCTION_COLLABORATOR') return '生产协同只读';
  if (value === 'MATERIAL_FOLLOW_UP_OPERATOR') return '物料跟进经办';
  if (value === 'TRAINING_COLLABORATOR') return '培训发展协同';
  return '旧权限兼容';
}

function employeeGrantTypeLabel(value?: string | null): string {
  return value === 'CONCURRENT' ? '兼岗' : value === 'ACTING' ? '代班' : '主部门';
}

function employeeLinkedAccount(employee?: EmployeeDTO | null) {
  return employee?.user || employee?.linkedUser || null;
}

function currentEmployeeAccessGrants(employee?: EmployeeDTO | null): UserAccessGrantDTO[] {
  const now = Date.now();
  return (employee?.user?.accessGrants || []).filter(grant => {
    if (!grant.isActive) return false;
    const from = new Date(grant.effectiveFrom).getTime();
    const to = grant.effectiveTo ? new Date(grant.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
    return (!Number.isFinite(from) || from <= now) && (!Number.isFinite(to) || to >= now);
  });
}

function employeeAccountStatus(employee?: EmployeeDTO | null): { label: string; tone: string } {
  const account = employeeLinkedAccount(employee);
  if (!account) return { label: '未开通', tone: 'unbound' };
  const status = account.accountStatus || (account.isActive ? 'ACTIVE' : 'DISABLED');
  if (account.passwordSetupRequired && account.isActive && status === 'ACTIVE') {
    return { label: '待设后台密码', tone: 'pending' };
  }
  if (status === 'PENDING') return { label: '待激活', tone: 'pending' };
  if (status === 'SUSPENDED') return { label: '已暂停', tone: 'suspended' };
  if (status === 'DISABLED' || !account.isActive) return { label: '已停用', tone: 'disabled' };
  return { label: '正常', tone: 'active' };
}

function employeeAccessMethods(employee: EmployeeDTO | null | undefined, productionEligible: boolean): string[] {
  const account = employeeLinkedAccount(employee);
  if (!account) return [];
  const accountStatus = account.accountStatus || (account.isActive ? 'ACTIVE' : 'DISABLED');
  if (employee?.isActive === false || !account.isActive || accountStatus !== 'ACTIVE') {
    return ['不可登录'];
  }
  const grants = currentEmployeeAccessGrants(employee);
  const summary = employee?.linkedUser?.permissionSummary;
  if (account.passwordSetupRequired) {
    const pendingMethods = ['后台登录待设密码'];
    if (
      summary?.fieldReportEnabled
      || grants.some(grant => grant.profileKey === 'FIELD_REPORTER')
    ) pendingMethods.push('扫码报工');
    return pendingMethods;
  }
  if (!grants.length && summary?.activeGrantCount) {
    const summaryMethods: string[] = [];
    if (summary.profiles.some(profile => profile !== 'FIELD_REPORTER')) summaryMethods.push('后台登录');
    if (summary.fieldReportEnabled) summaryMethods.push('扫码报工');
    return summaryMethods;
  }
  if (!grants.length) return productionEligible ? ['扫码报工（旧权限）'] : ['后台登录（旧权限）'];
  const methods = new Set<string>();
  grants.forEach(grant => {
    if (grant.profileKey === 'FIELD_REPORTER') methods.add('扫码报工');
    else methods.add('后台登录');
  });
  return [...methods];
}

function employeeGrantDepartment(grant: UserAccessGrantDTO, fallback: string): string {
  return grant.department?.name || fallback;
}

function employeeGrantPeriod(grant: UserAccessGrantDTO): string {
  const start = grant.effectiveFrom ? formatDate(grant.effectiveFrom) : '立即生效';
  if (!grant.effectiveTo) return grant.grantType === 'ACTING' ? `${start}起 · 结束日期待补` : `${start}起`;
  return `${start}—${formatDate(grant.effectiveTo)}`;
}

function formatRecruitmentDate(value: string | null | undefined): string {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function summarizeRecruitmentClient(demands: RecruitmentDemandDTO[]): RecruitmentSummaryDTO {
  return demands.reduce<RecruitmentSummaryDTO>((summary, demand) => {
    summary.demandCount += 1;
    if (!['CLOSED', 'CANCELLED'].includes(demand.status)) summary.activeDemandCount += 1;
    if (demand.status === 'PENDING_APPROVAL') summary.pendingApprovalCount += 1;
    summary.plannedHeadcount += demand.headcount;
    summary.remainingHeadcount += demand.remainingHeadcount;
    summary.candidateCount += demand.candidateCount;
    summary.interviewCount += demand.interviewCount;
    summary.hiredCount += demand.hiredCount;
    if (demand.overdue) summary.overdueCount += 1;
    return summary;
  }, { ...emptyRecruitmentSummary });
}

function recruitmentStatusTone(status: RecruitmentDemandStatusDTO): string {
  if (status === 'CLOSED') return 'green';
  if (status === 'CANCELLED') return 'muted';
  if (status === 'PENDING_APPROVAL' || status === 'OFFER') return 'orange';
  if (status === 'INTERVIEWING') return 'violet';
  return 'blue';
}

function candidateStatusTone(status: RecruitmentCandidateDTO['status']): string {
  if (status === 'HIRED') return 'green';
  if (status === 'REJECTED' || status === 'WITHDRAWN') return 'muted';
  if (status === 'OFFER') return 'orange';
  if (status === 'INTERVIEW') return 'violet';
  return 'blue';
}

function departmentName(employee: EmployeeDTO): string {
  return employee.department?.trim() || '未分组';
}

function statusLabel(employee: EmployeeDTO): string {
  if (!employee.isActive) return employee.resignedAt ? `已离职 · ${employee.resignedAt}` : '离职档案';
  return employee.attendanceEnabled ? '在岗 · 考勤中' : '在岗';
}

function todayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
  const canManageAccounts = user.laborRole === 'ADMIN';
  const trainingOnly = user.access.modules.includes('TRAINING') && !user.access.modules.includes('HR');
  const availableNavigation = useMemo(
    () => trainingOnly ? hrNavigation.filter(item => item.id === 'training') : hrNavigation,
    [trainingOnly],
  );
  const [view, setView] = useState<HrView>(trainingOnly ? 'training' : 'overview');
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
  const [directoryEditing, setDirectoryEditing] = useState(false);
  const [nextEmployeeNo, setNextEmployeeNo] = useState('');
  const [nextEmployeeNoLoading, setNextEmployeeNoLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<EmployeeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [auxiliaryWarning, setAuxiliaryWarning] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [directoryDetailTab, setDirectoryDetailTab] = useState<DirectoryDetailTab>('basic');
  const [recruitingStageFilter, setRecruitingStageFilter] = useState('');
  const [recruitmentDemands, setRecruitmentDemands] = useState<RecruitmentDemandDTO[]>([]);
  const [recruitmentSummary, setRecruitmentSummary] = useState<RecruitmentSummaryDTO>(emptyRecruitmentSummary);
  const [selectedRecruitmentDemandId, setSelectedRecruitmentDemandId] = useState('');
  const [recruitmentKeyword, setRecruitmentKeyword] = useState('');
  const [recruitmentDepartmentFilter, setRecruitmentDepartmentFilter] = useState('');
  const [recruitmentDialog, setRecruitmentDialog] = useState<RecruitmentDialog>(null);
  const [recruitmentDialogError, setRecruitmentDialogError] = useState('');
  const [recruitmentSaving, setRecruitmentSaving] = useState(false);
  const [editingRecruitmentDemand, setEditingRecruitmentDemand] = useState(false);
  const [recruitmentDemandDraft, setRecruitmentDemandDraft] = useState<RecruitmentDemandDraft>(emptyRecruitmentDemandDraft);
  const [recruitmentCandidateDraft, setRecruitmentCandidateDraft] = useState<RecruitmentCandidateDraft>(emptyRecruitmentCandidateDraft);
  const [recruitmentInterviewDraft, setRecruitmentInterviewDraft] = useState<RecruitmentInterviewDraft>(emptyRecruitmentInterviewDraft);
  const [recruitmentHireDraft, setRecruitmentHireDraft] = useState<RecruitmentHireDraft>(emptyRecruitmentHireDraft);
  const [selectedRecruitmentCandidateId, setSelectedRecruitmentCandidateId] = useState('');
  const [selectedRecruitmentInterviewId, setSelectedRecruitmentInterviewId] = useState('');
  const [numberReorderOpen, setNumberReorderOpen] = useState(false);
  const [employmentDialog, setEmploymentDialog] = useState<EmploymentDialogMode>(null);
  const [employmentPreview, setEmploymentPreview] = useState<EmploymentActionResponse | null>(null);
  const [employmentPreviewLoading, setEmploymentPreviewLoading] = useState(false);
  const [employmentSaving, setEmploymentSaving] = useState(false);
  const [employmentError, setEmploymentError] = useState('');
  const [employmentDraft, setEmploymentDraft] = useState<EmploymentActionDraft>({
    effectiveDate: todayDateKey(),
    reason: '主动离职',
    note: '',
    attendanceEnabled: true,
  });
  const workbenchRef = useRef<HTMLElement>(null);
  const employmentDialogRef = useRef<HTMLElement>(null);
  const allowNextHistoryNavigationRef = useRef(false);
  useToastBridge(toast, setToast);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view') as HrView | null;
    if (requested && availableNavigation.some(item => item.id === requested)) setView(requested);
    const directoryMode = params.get('mode');
    if (directoryMode === 'edit') setDirectoryEditing(true);
    if (directoryMode === 'create') {
      setCreating(true);
      setDirectoryEditing(true);
      setSelectedEmployeeId('');
      setDraft(emptyDraft);
      setBaseline(emptyDraft);
    }
    if (params.get('detail') === 'collaboration') setDirectoryDetailTab('collaboration');
    const recruitmentStage = params.get('recruitmentStage');
    if (recruitmentStage && recruitmentStageOptions.some(item => item.value === recruitmentStage)) {
      setRecruitingStageFilter(recruitmentStage);
    }
  }, [availableNavigation]);

  const selectedEmployee = useMemo(
    () => employees.find(employee => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );
  const selectedRecruitmentDemand = useMemo(
    () => recruitmentDemands.find(demand => demand.id === selectedRecruitmentDemandId) || null,
    [recruitmentDemands, selectedRecruitmentDemandId],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const editorUnlocked = creating || directoryEditing;

  const loadHumanResources = useCallback(async (): Promise<void> => {
    if (trainingOnly) {
      setLoading(false);
      setError('');
      setAuxiliaryWarning('');
      return;
    }
    setLoading(true);
    setError('');
    setAuxiliaryWarning('');
    try {
      const [employeeResult, attendanceResult, abnormalResult, attainmentResult, recruitmentResult, accountResult] = await Promise.allSettled([
        fetch('/api/employees', { cache: 'no-store' }),
        fetch('/api/attendance/records?period=month', { cache: 'no-store' }),
        fetch('/api/abnormal-time-events?period=month', { cache: 'no-store' }),
        fetch('/api/reports/employee-attainment?period=month', { cache: 'no-store' }),
        fetch('/api/recruitment/demands', { cache: 'no-store' }),
        canManageAccounts ? fetch('/api/users', { cache: 'no-store' }) : Promise.resolve(null),
      ]);

      if (employeeResult.status !== 'fulfilled') throw new Error('员工档案加载失败');
      const employeeBody = await employeeResult.value.json() as EmployeesResponse;
      if (!employeeResult.value.ok) throw new Error(employeeBody.error || '员工档案加载失败');
      let nextEmployees = sortEmployees(employeeBody.employees || []);
      if (accountResult.status === 'fulfilled' && accountResult.value) {
        const accountBody = await accountResult.value.json().catch(() => ({})) as { users?: UserDTO[] };
        if (accountResult.value.ok && Array.isArray(accountBody.users)) {
          const accountByEmployeeId = new Map(accountBody.users
            .filter(account => Boolean(account.employeeId))
            .map(account => [account.employeeId as string, account]));
          nextEmployees = nextEmployees.map(employee => {
            const account = accountByEmployeeId.get(employee.id);
            if (!account) return employee;
            return {
              ...employee,
              permissionSyncPending: account.permissionSyncPending ?? employee.permissionSyncPending,
              user: {
                id: account.id,
                username: account.username,
                accountStatus: account.accountStatus,
                isActive: account.isActive,
                mustChangePassword: account.mustChangePassword,
                lastLoginAt: account.lastLoginAt,
                accessGrants: account.accessGrants,
              },
            };
          });
        }
      }
      setEmployees(nextEmployees);
      setSelectedEmployeeId(current => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') === 'create') return '';
        const requestedId = params.get('employeeId') || '';
        const requestedPersonId = params.get('person') || '';
        const requestedPerson = responsibilityPeople.find(person => person.id === requestedPersonId);
        const requestedPersonEmployee = requestedPerson
          ? nextEmployees.find(employee => employee.name === requestedPerson.name)
          : undefined;
        if (nextEmployees.some(employee => employee.id === current)) return current;
        if (requestedId && nextEmployees.some(employee => employee.id === requestedId)) return requestedId;
        if (requestedPersonEmployee) return requestedPersonEmployee.id;
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

      if (recruitmentResult.status === 'fulfilled') {
        const body = await recruitmentResult.value.json() as RecruitmentResponse;
        if (recruitmentResult.value.ok) {
          const nextDemands = body.demands || [];
          setRecruitmentDemands(nextDemands);
          setRecruitmentSummary(body.summary || emptyRecruitmentSummary);
          setSelectedRecruitmentDemandId(current => (
            nextDemands.some(demand => demand.id === current) ? current : nextDemands[0]?.id || ''
          ));
        } else {
          warnings.push(body.error || '招聘数据暂不可用');
        }
      } else {
        warnings.push('招聘数据暂不可用');
      }
      setAuxiliaryWarning([...new Set(warnings)].join('；'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '人事管理数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [canManageAccounts, trainingOnly]);

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

  useEffect(() => {
    function applyHistoryLocation(): void {
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get('view') as HrView | null;
      const nextView = requestedView && availableNavigation.some(item => item.id === requestedView)
        ? requestedView
        : trainingOnly ? 'training' : 'overview';
      const mode = params.get('mode');
      const nextEditing = nextView === 'directory' && (mode === 'edit' || mode === 'create');
      const nextCreating = nextView === 'directory' && mode === 'create';

      if (!allowNextHistoryNavigationRef.current && (directoryEditing || creating) && dirty) {
        if (!window.confirm('当前员工档案有未保存修改，确认放弃并返回吗？')) {
          const restoreUrl = new URL(window.location.href);
          restoreUrl.searchParams.set('view', 'directory');
          if (selectedEmployeeId) restoreUrl.searchParams.set('employeeId', selectedEmployeeId);
          else restoreUrl.searchParams.delete('employeeId');
          restoreUrl.searchParams.set('mode', creating ? 'create' : 'edit');
          window.history.pushState({ hrModeEntry: true }, '', restoreUrl);
          return;
        }
      }

      allowNextHistoryNavigationRef.current = false;
      if (dirty) setDraft(baseline);
      setView(nextView);
      setCreating(nextCreating);
      setDirectoryEditing(nextEditing);
      setFormError('');

      if (nextCreating) {
        setSelectedEmployeeId('');
        setDraft(emptyDraft);
        setBaseline(emptyDraft);
      } else {
        const employeeId = params.get('employeeId') || '';
        if (employeeId && employees.some(employee => employee.id === employeeId)) {
          setSelectedEmployeeId(employeeId);
        }
      }
      const historyEmployeeId = params.get('employeeId') || selectedEmployeeId;
      if (nextView === 'directory' && !nextEditing && historyEmployeeId) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-employee-id="${CSS.escape(historyEmployeeId)}"]`)?.focus());
      }
    }

    window.addEventListener('popstate', applyHistoryLocation);
    return () => window.removeEventListener('popstate', applyHistoryLocation);
  }, [availableNavigation, baseline, creating, directoryEditing, dirty, employees, selectedEmployeeId, trainingOnly]);

  useEffect(() => {
    if (!employmentDialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstButton = employmentDialogRef.current?.querySelector<HTMLButtonElement>('button');
    firstButton?.focus();

    function dismissWithKeyboard(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || employmentSaving) return;
      setEmploymentDialog(null);
      setEmploymentPreview(null);
      setEmploymentError('');
    }

    document.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      document.removeEventListener('keydown', dismissWithKeyboard);
      previouslyFocused?.focus();
    };
  }, [employmentDialog, employmentSaving]);

  const summary = useMemo(() => ({
    total: employees.length,
    active: employees.filter(employee => employee.isActive).length,
    attendance: employees.filter(employee => employee.isActive && employee.attendanceEnabled).length,
    inactive: employees.filter(employee => !employee.isActive).length,
    newThisMonth: employees.filter(employee => employee.hireDate && isThisMonth(employee.hireDate)).length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    return employees.filter(employee => {
      if (filter === 'active' && !employee.isActive) return false;
      if (filter === 'inactive' && employee.isActive) return false;
      if (filter === 'attendance' && (!employee.isActive || !employee.attendanceEnabled)) return false;
      if (selectedDepartment && departmentName(employee) !== selectedDepartment) return false;
      if (selectedTeam && (employee.team?.trim() || '班组待维护') !== selectedTeam) return false;
      if (!normalized) return true;
      return `${employee.employeeNo} ${employee.name} ${employee.department || ''} ${employee.position || ''} ${employee.team || ''} ${employee.mobile || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized);
    });
  }, [employees, filter, keyword, selectedDepartment, selectedTeam]);

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

  const departmentTeams = useMemo(() => departmentStats.map(department => {
    const grouped = new Map<string, number>();
    employees
      .filter(employee => departmentName(employee) === department.name)
      .forEach(employee => {
        const team = employee.team?.trim() || '班组待维护';
        grouped.set(team, (grouped.get(team) || 0) + 1);
      });
    return {
      ...department,
      teams: [...grouped.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')),
    };
  }), [departmentStats, employees]);

  const maxDepartmentCount = Math.max(...departmentStats.map(item => item.active), 1);
  const archiveCompleteness = summary.active
    ? Math.round((employees.filter(employee => (
      employee.isActive && employee.department && employee.position && employee.team && employee.hireDate
    )).length / summary.active) * 100)
    : 0;
  const archiveCompleteCount = employees.filter(employee => (
    employee.isActive && employee.department && employee.position && employee.team && employee.hireDate
  )).length;
  const archiveMissingCount = Math.max(0, summary.active - archiveCompleteCount);
  const attendanceCoverage = summary.active
    ? Math.round((summary.attendance / summary.active) * 100)
    : 0;
  const pendingApprovalCount = attendanceSummary.draftCount
    + abnormalSummary.pendingCount
    + recruitmentSummary.pendingApprovalCount;
  const recentEmployees = [...employees]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 5);
  const hrCoordinator = responsibilityPeople.find(person => person.departmentId === 'people-operations');
  const hrWorkItems = responsibilityWorkItems.filter(item => (
    item.ownerId === hrCoordinator?.id || item.participantIds.includes(hrCoordinator?.id || '')
  ));

  async function loadNextEmployeeNumber(): Promise<void> {
    setNextEmployeeNo('');
    setNextEmployeeNoLoading(true);
    try {
      const response = await fetch('/api/employees/next-number', { cache: 'no-store' });
      const body = await response.json() as NextEmployeeNumberResponse;
      if (response.ok && body.nextEmployeeNo) setNextEmployeeNo(body.nextEmployeeNo);
    } catch {
      // The preview is informational only. The server still allocates the final number on save.
    } finally {
      setNextEmployeeNoLoading(false);
    }
  }

  function applyRecruitmentDemand(demand: RecruitmentDemandDTO): void {
    setRecruitmentDemands(current => {
      const next = current.some(item => item.id === demand.id)
        ? current.map(item => item.id === demand.id ? demand : item)
        : [demand, ...current];
      setRecruitmentSummary(summarizeRecruitmentClient(next));
      return next;
    });
    setSelectedRecruitmentDemandId(demand.id);
  }

  async function refreshRecruitment(): Promise<void> {
    setRecruitmentSaving(true);
    setRecruitmentDialogError('');
    try {
      const response = await fetch('/api/recruitment/demands', { cache: 'no-store' });
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok) throw new Error(body.error || '招聘数据刷新失败');
      const nextDemands = body.demands || [];
      setRecruitmentDemands(nextDemands);
      setRecruitmentSummary(body.summary || summarizeRecruitmentClient(nextDemands));
      setSelectedRecruitmentDemandId(current => (
        nextDemands.some(demand => demand.id === current) ? current : nextDemands[0]?.id || ''
      ));
      setToast('招聘数据已刷新');
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '招聘数据刷新失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  function openRecruitmentDemandDialog(demand?: RecruitmentDemandDTO): void {
    setEditingRecruitmentDemand(Boolean(demand));
    setRecruitmentDemandDraft(demand ? {
      department: demand.department,
      position: demand.position,
      team: demand.team || '',
      headcount: String(demand.headcount),
      employmentType: demand.employmentType,
      priority: demand.priority,
      reason: demand.reason,
      requirements: demand.requirements || '',
      targetDate: demand.targetDate || '',
      requesterId: demand.requester?.id || '',
      coordinatorId: demand.coordinator?.id || '',
    } : {
      ...emptyRecruitmentDemandDraft,
      coordinatorId: employees.find(employee => employee.name === hrCoordinator?.name)?.id || '',
    });
    setRecruitmentDialogError('');
    setRecruitmentDialog('demand');
  }

  async function saveRecruitmentDemand(): Promise<void> {
    setRecruitmentSaving(true);
    setRecruitmentDialogError('');
    try {
      const demand = editingRecruitmentDemand ? selectedRecruitmentDemand : null;
      const response = await fetch(
        demand ? `/api/recruitment/demands/${demand.id}` : '/api/recruitment/demands',
        {
          method: demand ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...recruitmentDemandDraft,
            headcount: Number(recruitmentDemandDraft.headcount),
            ...(demand ? { action: 'update', version: demand.version } : {}),
          }),
        },
      );
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '招聘需求保存失败');
      applyRecruitmentDemand(body.demand);
      setRecruitmentDialog(null);
      setToast(demand ? '招聘需求已更新' : '招聘需求已创建，可提交审批');
    } catch (reason) {
      setRecruitmentDialogError(reason instanceof Error ? reason.message : '招聘需求保存失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  async function transitionRecruitmentDemand(action: string): Promise<void> {
    const demand = selectedRecruitmentDemand;
    if (!demand) return;
    let note = '';
    if (action === 'cancel' || action === 'return_draft') {
      const entered = window.prompt(action === 'cancel' ? '请输入取消招聘的原因' : '请输入退回修改的原因');
      if (entered === null) return;
      note = entered.trim();
      if (!note) {
        setToast('请填写操作说明');
        return;
      }
    }
    setRecruitmentSaving(true);
    try {
      const response = await fetch(`/api/recruitment/demands/${demand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note, version: demand.version }),
      });
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '招聘流程更新失败');
      applyRecruitmentDemand(body.demand);
      setToast({
        submit: '招聘需求已提交审批',
        approve: '招聘需求已审批并启动',
        return_draft: '招聘需求已退回',
        cancel: '招聘需求已取消',
        reopen: '招聘需求已重新开启',
        close: '招聘需求已完成',
      }[action] || '招聘流程已更新');
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '招聘流程更新失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  function openRecruitmentCandidateDialog(): void {
    setRecruitmentCandidateDraft(emptyRecruitmentCandidateDraft);
    setRecruitmentDialogError('');
    setRecruitmentDialog('candidate');
  }

  async function saveRecruitmentCandidate(): Promise<void> {
    if (!selectedRecruitmentDemand) return;
    setRecruitmentSaving(true);
    setRecruitmentDialogError('');
    try {
      const response = await fetch('/api/recruitment/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demandId: selectedRecruitmentDemand.id,
          ...recruitmentCandidateDraft,
          experienceYears: recruitmentCandidateDraft.experienceYears
            ? Number(recruitmentCandidateDraft.experienceYears)
            : null,
          nextActionAt: recruitmentCandidateDraft.nextActionAt
            ? new Date(recruitmentCandidateDraft.nextActionAt).toISOString()
            : null,
        }),
      });
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '候选人录入失败');
      applyRecruitmentDemand(body.demand);
      setRecruitmentDialog(null);
      setToast('候选人已进入筛选');
    } catch (reason) {
      setRecruitmentDialogError(reason instanceof Error ? reason.message : '候选人录入失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  async function updateRecruitmentCandidate(candidate: RecruitmentCandidateDTO, status: string): Promise<void> {
    let rejectionReason = '';
    if (status === 'REJECTED') {
      const entered = window.prompt('请输入未通过原因');
      if (entered === null) return;
      rejectionReason = entered.trim();
      if (!rejectionReason) {
        setToast('请填写未通过原因');
        return;
      }
    }
    setRecruitmentSaving(true);
    try {
      const response = await fetch(`/api/recruitment/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, rejectionReason }),
      });
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '候选人更新失败');
      applyRecruitmentDemand(body.demand);
      setToast('候选人状态已更新');
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '候选人更新失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  function openRecruitmentInterviewDialog(candidate: RecruitmentCandidateDTO): void {
    setSelectedRecruitmentCandidateId(candidate.id);
    setSelectedRecruitmentInterviewId('');
    setRecruitmentInterviewDraft({
      ...emptyRecruitmentInterviewDraft,
      scheduledAt: toDateTimeLocal(candidate.nextActionAt),
    });
    setRecruitmentDialogError('');
    setRecruitmentDialog('interview');
  }

  function openRecruitmentInterviewResultDialog(candidate: RecruitmentCandidateDTO): void {
    const interview = [...candidate.interviews]
      .reverse()
      .find(item => item.status === 'SCHEDULED');
    if (!interview) {
      setToast('该候选人没有待处理面试');
      return;
    }
    setSelectedRecruitmentCandidateId(candidate.id);
    setSelectedRecruitmentInterviewId(interview.id);
    setRecruitmentInterviewDraft({
      ...emptyRecruitmentInterviewDraft,
      scheduledAt: toDateTimeLocal(interview.scheduledAt),
      durationMinutes: String(interview.durationMinutes),
      interviewerId: interview.interviewer?.id || '',
      method: interview.method,
      location: interview.location || '',
    });
    setRecruitmentDialogError('');
    setRecruitmentDialog('interview-result');
  }

  async function saveRecruitmentInterview(): Promise<void> {
    setRecruitmentSaving(true);
    setRecruitmentDialogError('');
    try {
      const completing = recruitmentDialog === 'interview-result';
      const response = await fetch(
        completing
          ? `/api/recruitment/interviews/${selectedRecruitmentInterviewId}`
          : '/api/recruitment/interviews',
        {
          method: completing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(completing ? {
            action: 'complete',
            result: recruitmentInterviewDraft.result,
            feedback: recruitmentInterviewDraft.feedback,
          } : {
            candidateId: selectedRecruitmentCandidateId,
            scheduledAt: recruitmentInterviewDraft.scheduledAt
              ? new Date(recruitmentInterviewDraft.scheduledAt).toISOString()
              : '',
            durationMinutes: Number(recruitmentInterviewDraft.durationMinutes),
            interviewerId: recruitmentInterviewDraft.interviewerId,
            method: recruitmentInterviewDraft.method,
            location: recruitmentInterviewDraft.location,
          }),
        },
      );
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '面试记录保存失败');
      applyRecruitmentDemand(body.demand);
      setRecruitmentDialog(null);
      setToast(completing ? '面试结果已记录' : '面试已安排');
    } catch (reason) {
      setRecruitmentDialogError(reason instanceof Error ? reason.message : '面试记录保存失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  function openRecruitmentHireDialog(candidate: RecruitmentCandidateDTO): void {
    if (!selectedRecruitmentDemand) return;
    setSelectedRecruitmentCandidateId(candidate.id);
    setRecruitmentHireDraft({
      ...emptyRecruitmentHireDraft,
      department: selectedRecruitmentDemand.department,
      position: selectedRecruitmentDemand.position,
      team: selectedRecruitmentDemand.team || '',
    });
    setRecruitmentDialogError('');
    setRecruitmentDialog('hire');
    void loadNextEmployeeNumber();
  }

  async function saveRecruitmentHire(): Promise<void> {
    setRecruitmentSaving(true);
    setRecruitmentDialogError('');
    try {
      const response = await fetch(`/api/recruitment/candidates/${selectedRecruitmentCandidateId}/hire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recruitmentHireDraft),
      });
      const body = await response.json() as RecruitmentResponse;
      if (!response.ok || !body.demand) throw new Error(body.error || '录用入职办理失败');
      applyRecruitmentDemand(body.demand);
      setRecruitmentDialog(null);
      setToast(body.employeeNo
        ? `录用完成，员工编号 ${body.employeeNo} 已自动建立`
        : '录用完成，员工档案已自动建立');
      void loadHumanResources();
    } catch (reason) {
      setRecruitmentDialogError(reason instanceof Error ? reason.message : '录用入职办理失败');
    } finally {
      setRecruitmentSaving(false);
    }
  }

  function changeView(nextView: HrView, directoryEmployeeId?: string): void {
    if (!availableNavigation.some(item => item.id === nextView)) return;
    if (nextView === view && directoryEmployeeId === undefined) return;
    if (view === 'directory' && nextView !== 'directory' && !confirmDiscard()) return;
    if (view === 'directory' && nextView !== 'directory' && dirty) setDraft(baseline);
    setView(nextView);
    if (nextView !== 'directory') {
      setCreating(false);
      setDirectoryEditing(false);
    }
    const url = new URL(window.location.href);
    if (nextView === 'overview') {
      url.searchParams.delete('view');
    } else {
      url.searchParams.set('view', nextView);
    }
    url.searchParams.delete('mode');
    if (nextView === 'directory') {
      const employeeId = directoryEmployeeId ?? selectedEmployeeId;
      if (employeeId) url.searchParams.set('employeeId', employeeId);
      else url.searchParams.delete('employeeId');
    } else {
      url.searchParams.delete('employeeId');
    }
    window.history.pushState({ hrView: nextView }, '', url);
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('当前员工档案有未保存修改，确认放弃吗？');
  }

  function chooseEmployee(employee: EmployeeDTO): void {
    if (!confirmDiscard()) return;
    setCreating(false);
    setDirectoryEditing(false);
    setSelectedEmployeeId(employee.id);
    setDirectoryDetailTab('basic');
    const nextDraft = toDraft(employee);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setFormError('');
    if (view === 'directory') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'directory');
      url.searchParams.set('employeeId', employee.id);
      url.searchParams.delete('mode');
      window.history.replaceState({ hrView: 'directory' }, '', url);
    }
  }

  function beginCreate(): void {
    if (!confirmDiscard()) return;
    const baseUrl = new URL(window.location.href);
    baseUrl.searchParams.set('view', 'directory');
    baseUrl.searchParams.delete('mode');
    baseUrl.searchParams.delete('employeeId');
    if (view !== 'directory') window.history.pushState({ hrView: 'directory' }, '', baseUrl);
    else if (window.location.search.includes('mode=')) window.history.replaceState({ hrView: 'directory' }, '', baseUrl);
    const editorUrl = new URL(baseUrl);
    editorUrl.searchParams.set('mode', 'create');
    window.history.pushState({ hrModeEntry: true }, '', editorUrl);
    setView('directory');
    setCreating(true);
    setDirectoryEditing(true);
    setSelectedEmployeeId('');
    setDirectoryDetailTab('basic');
    setDraft(emptyDraft);
    setBaseline(emptyDraft);
    setFormError('');
    void loadNextEmployeeNumber();
  }

  function beginDirectoryEdit(): void {
    if (!selectedEmployee || creating || directoryEditing) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'directory');
    url.searchParams.set('employeeId', selectedEmployee.id);
    url.searchParams.set('mode', 'edit');
    window.history.pushState({ hrModeEntry: true }, '', url);
    setDirectoryEditing(true);
    setDirectoryDetailTab('basic');
    requestAnimationFrame(() => document.getElementById('hr-employee-name')?.focus());
  }

  function exitDirectoryEditor(): void {
    if (!confirmDiscard()) return;
    setDraft(baseline);
    setFormError('');
    setCreating(false);
    setDirectoryEditing(false);
    if (window.history.state?.hrModeEntry) {
      allowNextHistoryNavigationRef.current = true;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'directory');
    url.searchParams.delete('mode');
    if (selectedEmployeeId) url.searchParams.set('employeeId', selectedEmployeeId);
    window.history.replaceState({ hrView: 'directory' }, '', url);
  }

  function returnToHrHome(): void {
    changeView('overview');
  }

  function beginNumberReorder(): void {
    if (!confirmDiscard()) return;
    if (dirty) setDraft(baseline);
    setNumberReorderOpen(true);
  }

  async function saveEmployee(): Promise<void> {
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
      setDirectoryEditing(false);
      setSelectedEmployeeId(savedEmployee.id);
      const nextDraft = toDraft(savedEmployee);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setToast(wasCreating ? `员工档案已创建，员工编号 ${savedEmployee.employeeNo}` : '员工档案已保存');
      if (window.history.state?.hrModeEntry) {
        allowNextHistoryNavigationRef.current = true;
        window.history.back();
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'directory');
        url.searchParams.set('employeeId', savedEmployee.id);
        url.searchParams.delete('mode');
        window.history.replaceState({ hrView: 'directory' }, '', url);
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存员工档案失败');
    } finally {
      setSaving(false);
    }
  }

  async function loadEmploymentPreview(employeeId: string, effectiveDate: string): Promise<void> {
    setEmploymentPreviewLoading(true);
    setEmploymentError('');
    try {
      const response = await fetch(
        `/api/employees/${employeeId}/offboarding?effectiveDate=${encodeURIComponent(effectiveDate)}`,
        { cache: 'no-store' },
      );
      const body = await response.json() as EmploymentActionResponse;
      if (!response.ok) throw new Error(body.error || '离职影响检查失败');
      setEmploymentPreview(body);
    } catch (reason) {
      setEmploymentPreview(null);
      setEmploymentError(reason instanceof Error ? reason.message : '离职影响检查失败');
    } finally {
      setEmploymentPreviewLoading(false);
    }
  }

  function openEmploymentAction(mode: Exclude<EmploymentDialogMode, null>): void {
    if (!selectedEmployee) return;
    if (dirty) {
      setFormError('请先保存或放弃当前档案修改，再办理员工状态变更');
      return;
    }
    const effectiveDate = todayDateKey();
    setEmploymentDraft({
      effectiveDate,
      reason: '主动离职',
      note: '',
      attendanceEnabled: true,
    });
    setEmploymentPreview(null);
    setEmploymentError('');
    setEmploymentDialog(mode);
    void loadEmploymentPreview(selectedEmployee.id, effectiveDate);
  }

  function closeEmploymentAction(): void {
    if (employmentSaving) return;
    setEmploymentDialog(null);
    setEmploymentPreview(null);
    setEmploymentError('');
  }

  async function submitEmploymentAction(): Promise<void> {
    if (!selectedEmployee || !employmentDialog) return;
    setEmploymentSaving(true);
    setEmploymentError('');
    try {
      const endpoint = employmentDialog === 'offboard'
        ? `/api/employees/${selectedEmployee.id}/offboarding`
        : `/api/employees/${selectedEmployee.id}/reinstate`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employmentDialog === 'offboard' ? {
          effectiveDate: employmentDraft.effectiveDate,
          reason: employmentDraft.reason,
          note: employmentDraft.note,
        } : {
          effectiveDate: employmentDraft.effectiveDate,
          note: employmentDraft.note,
          attendanceEnabled: employmentDraft.attendanceEnabled,
          notificationEnabled: true,
        }),
      });
      const body = await response.json() as EmploymentActionResponse;
      if (!response.ok || !body.employee) throw new Error(body.error || '员工状态变更失败');
      const savedEmployee = body.employee;
      setEmployees(current => sortEmployees(current.map(employee => (
        employee.id === savedEmployee.id ? savedEmployee : employee
      ))));
      const nextDraft = toDraft(savedEmployee);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setEmploymentDialog(null);
      setEmploymentPreview(null);
      // Employment changes affect attendance coverage, attainment, login and
      // workforce pools. Refresh the operational summaries immediately so a
      // just-offboarded employee cannot remain visible in a stale HR metric.
      await loadHumanResources();
      setToast(employmentDialog === 'offboard'
        ? `${savedEmployee.name} 已办理离职，工号 ${savedEmployee.employeeNo} 永久保留`
        : body.message || `${savedEmployee.name} 已恢复在职；账号与权限等待管理员确认`);
    } catch (reason) {
      setEmploymentError(reason instanceof Error ? reason.message : '员工状态变更失败');
    } finally {
      setEmploymentSaving(false);
    }
  }

  function focusDepartment(name: string): void {
    setSelectedDepartment(name);
    setSelectedTeam('');
    setKeyword('');
    setFilter('all');
    changeView('directory');
  }

  function renderOverview() {
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
            <span><BadgeCheck /></span>
            <small>技能绩效</small>
            <strong>进入</strong>
            <em>岗位矩阵与考核认证</em>
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
                <button type="button" key={employee.id} onClick={() => { chooseEmployee(employee); changeView('directory', employee.id); }}>
                  <span className="hr-person-avatar">{employee.name.slice(0, 1)}</span>
                  <span><strong>{employee.name}</strong><small>{employee.department || '部门待维护'} · {employee.position || '岗位待维护'}</small></span>
                  <span><em className={employee.isActive ? 'ok' : ''}>{employee.isActive ? '在岗' : '离职'}</em><small>{formatDateTime(employee.updatedAt)}</small></span>
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
              <button type="button" onClick={() => changeView('performance')}><span className="violet"><BadgeCheck /></span><strong>技能矩阵</strong><small>维护岗位技能、员工认证与考核</small></button>
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
    const profileEmployee = creating ? null : selectedEmployee;
    const profileName = creating ? (draft.name.trim() || '新员工') : (profileEmployee?.name || '请选择员工');
    const profileDepartment = draft.department.trim() || '部门待维护';
    const profilePosition = draft.position.trim() || '岗位待维护';
    const profileTeam = draft.team.trim() || '班组待维护';
    const productionDepartment = isProductionDepartment(draft.department);
    const productionReportingEligible = isProductionWorkforceEmployee(draft);
    const profileAccount = employeeLinkedAccount(profileEmployee);
    const profilePermissionSummary = profileEmployee?.linkedUser?.permissionSummary;
    const profileAccountStatus = employeeAccountStatus(profileEmployee);
    const profileAccessGrants = currentEmployeeAccessGrants(profileEmployee);
    const profileAccessMethods = employeeAccessMethods(profileEmployee, productionReportingEligible);
    const profilePrimaryGrant = profileAccessGrants.find(grant => grant.grantType === 'PRIMARY') || null;
    const profilePermissionVersion = profileAccessGrants.length
      ? Math.max(...profileAccessGrants.map(grant => grant.version), 0)
      : 0;
    const profilePermissionNeedsSync = Boolean(profileAccount && (
      profileEmployee?.permissionSyncPending
      || profilePermissionSummary?.permissionSyncPending
      || (profileEmployee?.user && (
        !(profileEmployee.user.accessGrants || []).length
        || (profileEmployee.departmentId && profilePrimaryGrant?.departmentId && profileEmployee.departmentId !== profilePrimaryGrant.departmentId)
      ))
    ));
    const profileActiveGrantCount = profileAccessGrants.length || profilePermissionSummary?.activeGrantCount || 0;
    const profilePermissionSyncLabel = !profileAccount
      ? '等待开通账号'
      : profileEmployee?.isActive === false
        ? '随离职停用'
      : profilePermissionNeedsSync
        ? '待管理员确认'
        : `已同步${profilePermissionVersion ? ` V${profilePermissionVersion}` : ''}`;
    const profileNoGrantLabel = !profileAccount
      ? '未开通'
      : profileEmployee?.isActive === false
        ? '停用'
        : profilePermissionNeedsSync
          ? '待办'
          : '兼容';
    const profileNoGrantDescription = !profileAccount
      ? '尚未创建登录账号'
      : profileEmployee?.isActive === false
        ? '员工已离职，账号与权限均已停用'
        : profilePermissionNeedsSync
          ? '员工已在职，账号与权限等待管理员确认'
          : '旧账号保持限制性兼容权限';
    const productionReportingDescription = !draft.isActive && !productionDepartment
      ? `该员工已离职，历史记录继续保留；“${profileDepartment}”原本也不会进入生产报工名单。`
      : !productionDepartment
        ? `当前归属“${profileDepartment}”，系统自动排除生产报工；保持在职不会进入生产名单。`
        : !draft.isActive
          ? '当前员工已办理离职，不再进入派工、报工、考勤和员工登录名单。'
          : !draft.attendanceEnabled
            ? '当前属于生产部，但尚未启用考勤；启用考勤后才会进入生产报工与达成率。'
            : '当前属于生产部、在职且已启用考勤，系统会自动加入生产报工与达成率。';
    const profileEmployeeNo = creating
      ? nextEmployeeNoLoading
        ? '编号生成中…'
        : nextEmployeeNo
          ? `预计 ${nextEmployeeNo}`
          : '保存时自动编号'
      : draft.employeeNo;
    const archiveFields = [creating ? '系统自动编号' : draft.employeeNo, draft.name, draft.hireDate, draft.department, draft.position, draft.team];
    const profileCompleteness = Math.round((archiveFields.filter(value => value.trim()).length / archiveFields.length) * 100);
    const profileMissingCount = archiveFields.filter(value => !value.trim()).length;
    const profilePerson = responsibilityPeople.find(person => person.name === profileName);
    const profileWorkItems = profilePerson
      ? responsibilityWorkItems.filter(item => (
        item.ownerId === profilePerson.id
        || item.participantIds.includes(profilePerson.id)
        || item.nextPersonId === profilePerson.id
      ))
      : [];
    const profileAttendanceRecords = profileEmployee
      ? attendanceRecords.filter(record => record.employeeId === profileEmployee.id)
      : [];
    const profileAttendanceMilliseconds = profileAttendanceRecords.reduce((total, record) => total + record.actualMilliseconds, 0);
    const profileOvertimeMilliseconds = profileAttendanceRecords.reduce((total, record) => total + record.overtimeMilliseconds, 0);
    const profileAbnormalCount = profileEmployee
      ? abnormalEvents.filter(event => event.allocations.some(allocation => allocation.employeeId === profileEmployee.id)).length
      : 0;
    const profileTeamMembers = employees.filter(employee => (
      employee.isActive
      && departmentName(employee) === profileDepartment
      && (!draft.team.trim() || (employee.team?.trim() || '班组待维护') === profileTeam)
    ));
    const roleComposition = [...profileTeamMembers.reduce((grouped, employee) => {
      const role = employee.position?.trim() || '岗位待维护';
      grouped.set(role, (grouped.get(role) || 0) + 1);
      return grouped;
    }, new Map<string, number>()).entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4);

    return (
      <div className="hr-view hr-directory-view">
        <section className="hr-directory-commandbar" aria-label="员工档案概览与筛选">
          <div className="hr-directory-summary">
            <article>
              <span className="orange"><UsersRound /></span>
              <small>员工总数</small>
              <strong>{summary.total}<em>人</em></strong>
            </article>
            <article>
              <span className="green"><UserRoundCheck /></span>
              <small>在职人数</small>
              <strong>{summary.active}<em>人</em></strong>
            </article>
            <article>
              <span><Building2 /></span>
              <small>部门数量</small>
              <strong>{departmentStats.length}<em>个</em></strong>
            </article>
            <article className={archiveMissingCount ? 'attention' : ''}>
              <span className="orange"><ClipboardCheck /></span>
              <small>待补档案</small>
              <strong>{archiveMissingCount}<em>条</em></strong>
            </article>
          </div>
          <div className="hr-directory-tools">
            <label><Search size={17} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、姓名、手机号、部门、岗位或班组" /></label>
            <select aria-label="员工状态" value={filter} onChange={event => setFilter(event.target.value as EmployeeFilter)}>
              <option value="all">全部员工</option>
              <option value="active">在岗员工</option>
              <option value="attendance">启用考勤</option>
              <option value="inactive">离职档案</option>
            </select>
            {(selectedDepartment || selectedTeam) && (
              <button
                type="button"
                className="hr-filter-chip"
                onClick={() => {
                  setSelectedDepartment('');
                  setSelectedTeam('');
                }}
              >
                {selectedTeam || selectedDepartment} ×
              </button>
            )}
            <button type="button" className="hr-icon-button" title="刷新员工档案" onClick={() => void loadHumanResources()}><RefreshCw size={17} /></button>
            <button type="button" className="hr-secondary-button hr-reorder-trigger" onClick={beginNumberReorder}><ListOrdered size={17} />编号重排</button>
            <button type="button" className="hr-primary-button" onClick={beginCreate}><Plus size={17} />新增员工</button>
          </div>
        </section>

        <div className="hr-directory-grid">
          <aside className="hr-directory-organization">
            <header>
              <div><span className="hr-eyebrow">组织导航</span><h2>组织与人员</h2></div>
              <span title="组织筛选会同步更新下方人员列表"><FolderTree /></span>
            </header>
            <div className="hr-organization-tree hm-scroll-region" tabIndex={0}>
              <button
                type="button"
                className={!selectedDepartment ? 'active root' : 'root'}
                onClick={() => {
                  setSelectedDepartment('');
                  setSelectedTeam('');
                }}
              >
                <span><Building2 /></span>
                <strong>杭连电子</strong>
                <em>{summary.total}</em>
              </button>
              {departmentTeams.map(department => (
                <div className="hr-organization-branch" key={department.name}>
                  <button
                    type="button"
                    className={selectedDepartment === department.name && !selectedTeam ? 'active' : ''}
                    onClick={() => {
                      setSelectedDepartment(department.name);
                      setSelectedTeam('');
                    }}
                  >
                    <ChevronDown />
                    <span>{department.name}</span>
                    <em>{department.total}</em>
                  </button>
                  {(selectedDepartment === department.name || !selectedDepartment) && department.teams.map(team => (
                    <button
                      type="button"
                      className={`team ${selectedDepartment === department.name && selectedTeam === team.name ? 'active' : ''}`}
                      key={`${department.name}-${team.name}`}
                      onClick={() => {
                        setSelectedDepartment(department.name);
                        setSelectedTeam(team.name);
                      }}
                    >
                      <span>{team.name}</span>
                      <em>{team.count}</em>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="hr-employee-list">
              <header>
                <div><strong>{selectedTeam || selectedDepartment || '全部员工'}</strong><small>{filteredEmployees.length} 人</small></div>
                <button type="button" title="清除组织筛选" onClick={() => { setSelectedDepartment(''); setSelectedTeam(''); }}><RefreshCw /></button>
              </header>
              <div className="hm-scroll-region" tabIndex={0}>
                {filteredEmployees.map(employee => (
                  <button
                    className={`${selectedEmployeeId === employee.id && !creating ? 'selected' : ''} ${employee.isActive ? '' : 'inactive'}`.trim()}
                    type="button"
                    key={employee.id}
                    data-employee-id={employee.id}
                    onClick={() => chooseEmployee(employee)}
                  >
                    <span className="hr-person-avatar">{employee.name.slice(0, 1)}</span>
                    <span className="hr-employee-copy">
                      <strong>{employee.name}</strong>
                      <small>{employee.employeeNo} · {employee.position || '岗位待维护'}</small>
                    </span>
                    <i className={employee.isActive ? 'ok' : ''} title={statusLabel(employee)} />
                    <span className="hr-employee-more" aria-hidden="true"><MoreHorizontal /></span>
                  </button>
                ))}
                {!loading && !filteredEmployees.length && (
                  <EmptyPanel
                    icon={UserRound}
                    title="没有符合条件的员工"
                    description="调整组织、搜索或状态筛选后重试。"
                    action={<button type="button" className="hr-text-button" onClick={beginCreate}>新增员工</button>}
                  />
                )}
              </div>
            </div>
          </aside>

          <section className="hr-employee-profile">
            <header className="hr-profile-identity">
              <span className="hr-profile-avatar">{profileName.slice(0, 1)}</span>
              <div className="hr-profile-identity-copy">
                <div>
                  <h1>{profileName}</h1>
                  <strong>{profileEmployeeNo || '编号待生成'}</strong>
                </div>
                <p>{profilePosition}</p>
                <span>
                  <em className={draft.isActive ? 'ok' : ''}>{draft.isActive ? '在职' : '已离职'}</em>
                  <em className={draft.attendanceEnabled ? 'ok' : ''}>{draft.attendanceEnabled ? '考勤启用' : '未启用考勤'}</em>
                </span>
                <small><Building2 />{profileDepartment} · {profileTeam} · {draft.hireDate ? `入职 ${formatDate(draft.hireDate)}` : '入职日期待维护'}</small>
              </div>
              <div className="hr-profile-actions">
                <button
                  type="button"
                  className="hr-primary-button"
                  disabled={creating || directoryEditing || !selectedEmployee}
                  onClick={beginDirectoryEdit}
                >
                  <PencilLine />{directoryEditing ? '编辑中' : '编辑档案'}
                </button>
                {profileEmployee && <a href={`/workspace/attendance?employeeId=${encodeURIComponent(profileEmployee.id)}`}><CalendarClock />考勤记录</a>}
                {profileEmployee && (
                  <button
                    type="button"
                    className="hr-icon-button"
                    title={profileEmployee.isActive ? '办理离职' : '办理复职'}
                    onClick={() => openEmploymentAction(profileEmployee.isActive ? 'offboard' : 'reinstate')}
                  >
                    {profileEmployee.isActive ? <MoreHorizontal /> : <RotateCcw />}
                  </button>
                )}
              </div>
            </header>

            <button type="button" className="hr-profile-completeness" onClick={() => setDirectoryDetailTab('basic')}>
              <BadgeCheck />
              <span><strong>档案完整度 {profileCompleteness}%</strong><small>{profileMissingCount ? `还有 ${profileMissingCount} 项基础信息待补充` : '员工基础信息已完整'}</small></span>
              <i><b style={{ width: `${profileCompleteness}%` }} /></i>
              <ChevronRight />
            </button>

            <nav className="hr-profile-tabs" aria-label="员工档案详情">
              {directoryDetailTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button type="button" key={tab.id} className={directoryDetailTab === tab.id ? 'active' : ''} onClick={() => setDirectoryDetailTab(tab.id)}>
                    <Icon />{tab.label}
                  </button>
                );
              })}
            </nav>

            <div className="hr-profile-scroll hm-scroll-region">
              {directoryDetailTab === 'basic' && (
                <section className="hr-profile-section">
                  <header><div><span className="hr-eyebrow">人员档案</span><h2>基本信息</h2></div><IdCard /></header>
                  <div className="hr-profile-form-grid">
                    <fieldset>
                      <legend><UserRound />身份信息</legend>
                      <label className="hr-auto-number-control">
                        <span>员工编号</span>
                        <input
                          value={creating ? (nextEmployeeNoLoading ? '正在计算…' : nextEmployeeNo || '保存时自动分配') : draft.employeeNo}
                          readOnly
                          aria-readonly="true"
                        />
                        <small>{creating ? '创建档案时正式分配，离职后不回收' : '系统唯一编号，普通档案编辑中不可修改'}</small>
                      </label>
                      <label><span>员工姓名 *</span><input id="hr-employee-name" value={draft.name} disabled={!editorUnlocked} maxLength={80} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="填写真实姓名" /></label>
                      <label><span>入职时间</span><input type="date" value={draft.hireDate} disabled={!editorUnlocked} onChange={event => setDraft(current => ({ ...current, hireDate: event.target.value }))} /></label>
                    </fieldset>
                    <fieldset>
                      <legend><Building2 />组织归属</legend>
                      <label><span>部门</span><input value={draft.department} disabled={!editorUnlocked} maxLength={80} onChange={event => setDraft(current => ({ ...current, department: event.target.value }))} placeholder="例如 生产部" /></label>
                      <label><span>班组</span><input value={draft.team} disabled={!editorUnlocked} maxLength={80} onChange={event => setDraft(current => ({ ...current, team: event.target.value }))} placeholder="例如 前端一组" /></label>
                    </fieldset>
                    <fieldset>
                      <legend><BriefcaseBusiness />岗位信息</legend>
                      <label><span>岗位</span><input value={draft.position} disabled={!editorUnlocked} maxLength={80} onChange={event => setDraft(current => ({ ...current, position: event.target.value }))} placeholder="例如 压接操作员" /></label>
                      <div className="hr-profile-readonly">
                        <span>生产报工</span>
                        <strong>{productionReportingEligible ? '可实名扫码报工' : '不具备生产报工资格'}</strong>
                        <small>{productionReportingEligible ? '账号开通后使用员工编号登录' : `${profileDepartment}仍按部门权限进入后台工作台`}</small>
                      </div>
                      <label className="hr-contact-control">
                        <span>手机号（选填）</span>
                        <input
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={draft.mobile}
                          disabled={!editorUnlocked}
                          maxLength={24}
                          onChange={event => setDraft(current => ({ ...current, mobile: event.target.value }))}
                          placeholder="用于业务联系（选填）"
                        />
                        <small><Phone />仅用于业务通知，不在人员列表公开完整号码</small>
                      </label>
                      <div className="hr-contact-status">
                        <span className={draft.isActive && draft.notificationEnabled ? 'ready' : ''}><Send />系统内通知 {draft.isActive && draft.notificationEnabled ? '已启用' : '已暂停'}</span>
                        <span className={profileEmployee?.wecomUserId ? 'bound' : ''}><MessageSquareText />企业微信 {profileEmployee?.wecomUserId ? '已绑定' : '未接入（未来）'}</span>
                      </div>
                    </fieldset>
                  </div>
                  <div className="hr-editor-note"><BadgeCheck /><div><strong>人员主档是账号与权限的唯一来源</strong><span>部门、兼岗和代班变更后同步权限；手机号仅用于业务联系与未来通知。</span></div></div>
                  {formError && <div className="hr-editor-error" role="alert"><AlertTriangle size={16} />{formError}</div>}
                </section>
              )}

              {directoryDetailTab === 'appointment' && (
                <section className="hr-profile-section">
                  <header><div><span className="hr-eyebrow">组织、账号与权限</span><h2>任职与权限</h2></div><BriefcaseBusiness /></header>
                  <div className="hr-appointment-overview">
                    <article><small>所属部门</small><strong>{profileDepartment}</strong><span>组织归属</span></article>
                    <article><small>当前岗位</small><strong>{profilePosition}</strong><span>岗位配置</span></article>
                    <article><small>所在班组</small><strong>{profileTeam}</strong><span>{profileTeamMembers.length} 名在岗成员</span></article>
                    <article><small>入职日期</small><strong>{draft.hireDate ? formatDate(draft.hireDate) : '待维护'}</strong><span>{profileEmployee ? `档案建立 ${formatDate(profileEmployee.createdAt)}` : '保存后建立档案'}</span></article>
                  </div>
                  {profileEmployee ? (
                    <section className="hr-account-permission-card">
                      <header>
                        <span><ShieldCheck /></span>
                        <div><strong>账号与权限</strong><small>人员主档联动部门权限，兼岗与代班按授权期限生效</small></div>
                        {canManageAccounts && <a href={`/dashboard?settings=accounts&employeeId=${encodeURIComponent(profileEmployee.id)}`}><UserRoundCog />打开账号设置</a>}
                      </header>
                      <div className="hr-account-state-grid">
                        <article><small>账号状态</small><strong className={`tone-${profileAccountStatus.tone}`}>{profileAccountStatus.label}</strong><span>{profileAccount?.username || '由管理员开通'}</span></article>
                        <article><small>主部门</small><strong>{profileEmployee.departmentRecord?.name || profileDepartment}</strong><span>{profileEmployee.departmentRecord?.code || '沿用人员主档'}</span></article>
                        <article><small>权限同步</small><strong className={profileEmployee.isActive === false ? 'tone-disabled' : profilePermissionNeedsSync ? 'tone-pending' : 'tone-active'}>{profilePermissionSyncLabel}</strong><span>{profileActiveGrantCount ? `${profileActiveGrantCount} 条当前有效授权` : profileNoGrantDescription}</span></article>
                        <article><small>最近登录</small><strong>{profileAccount?.lastLoginAt ? formatDateTime(profileAccount.lastLoginAt) : profileEmployee.user ? '尚未登录' : profileAccount ? '账号摘要未提供' : '—'}</strong><span>{profileAccount?.passwordSetupRequired ? '待管理员设置后台密码' : profileAccount?.mustChangePassword ? '首次登录需修改密码' : profileAccount ? '登录凭证正常' : '等待管理员开通'}</span></article>
                      </div>
                      <div className="hr-account-access-row">
                        <strong>访问方式</strong>
                        <div>
                          {profileAccessMethods.map(method => <span key={method}>{method.includes('扫码') ? <QrCode /> : <Monitor />}{method}</span>)}
                          {!profileAccessMethods.length && <span className="muted"><KeyRound />尚未开通</span>}
                        </div>
                      </div>
                      <div className="hr-account-grant-list">
                        <header><strong>部门与权限来源</strong><small>同一部门账号采用统一权限方案</small></header>
                        {profileAccessGrants.map(grant => (
                          <article key={grant.id}>
                            <span className={`grant-${grant.grantType.toLowerCase()}`}>{employeeGrantTypeLabel(grant.grantType)}</span>
                            <div><strong>{employeeGrantDepartment(grant, profileDepartment)}</strong><small>{employeeAccessProfileLabel(grant.profileKey)} · {grant.scopeKey}</small></div>
                            <em>{employeeGrantPeriod(grant)}</em>
                          </article>
                        ))}
                        {!profileAccessGrants.length && profilePermissionSummary?.activeGrantCount ? <article className="legacy"><span>摘要</span><div><strong>{profilePermissionSummary.departmentCodes.join('、') || profileDepartment}</strong><small>{profilePermissionSummary.profiles.map(employeeAccessProfileLabel).join('、') || '部门权限已配置'}</small></div><em>{profilePermissionSummary.activeGrantCount} 条有效</em></article> : null}
                        {!profileAccessGrants.length && !profilePermissionSummary?.activeGrantCount && <article className="legacy"><span>{profileNoGrantLabel}</span><div><strong>{profileDepartment}</strong><small>{profileNoGrantDescription}</small></div><em>{profilePermissionSyncLabel}</em></article>}
                      </div>
                    </section>
                  ) : (
                    <div className="hr-account-permission-empty"><ShieldCheck /><span><strong>创建员工后配置账号与权限</strong><small>账号由管理员开通，部门权限将从人员主档自动继承。</small></span></div>
                  )}
                  <div className="hr-editor-switches">
                    <label>
                      <input type="checkbox" disabled={!editorUnlocked || !draft.isActive} checked={draft.attendanceEnabled} onChange={event => setDraft(current => ({ ...current, attendanceEnabled: event.target.checked }))} />
                      <span><strong>启用员工考勤</strong><small>所有部门均可登记出勤；生产部进入达成率，其他部门仅统计出勤。</small></span>
                    </label>
                    <div className="hr-attainment-policy">
                      <div><strong>达成率统计口径</strong><small>批量与样品分账；不计入用于主管、组长、调模等岗位。</small></div>
                      <label>
                        <span>统计分账</span>
                        <select
                          disabled={!editorUnlocked || !draft.isActive || !draft.attendanceEnabled}
                          value={draft.attainmentStream}
                          onChange={event => {
                            const attainmentStream = event.target.value as AttainmentStream;
                            setDraft(current => ({
                              ...current,
                              attainmentStream,
                              attainmentFactorBasisPoints: attainmentStream === 'excluded'
                                ? 0
                                : current.attainmentFactorBasisPoints || 10000,
                              attainmentEligible: attainmentStream !== 'excluded',
                            }));
                          }}
                        >
                          <option value="batch">批量生产</option>
                          <option value="sample">样品组</option>
                          <option value="excluded">不计入</option>
                        </select>
                      </label>
                      <label>
                        <span>默认计入比例</span>
                        <span className="hr-attainment-factor-input">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            disabled={!editorUnlocked || !draft.isActive || !draft.attendanceEnabled || draft.attainmentStream === 'excluded'}
                            value={draft.attainmentFactorBasisPoints / 100}
                            onChange={event => {
                              const factor = Math.max(0, Math.min(10000, Math.round(Number(event.target.value || 0) * 100)));
                              setDraft(current => ({ ...current, attainmentFactorBasisPoints: factor, attainmentEligible: current.attainmentStream !== 'excluded' && factor > 0 }));
                            }}
                          />
                          <b>%</b>
                        </span>
                      </label>
                    </div>
                    {!creating && profileEmployee && (
                      <div className={`hr-employment-state ${profileEmployee.isActive ? 'active' : 'resigned'}`}>
                        <span>{profileEmployee.isActive ? <UserRoundCheck /> : <RotateCcw />}</span>
                        <div>
                          <strong>{profileEmployee.isActive ? '当前在职' : '已办理离职'}</strong>
                          <small>{profileEmployee.isActive
                            ? '离职必须通过影响检查，不能直接关闭状态'
                            : `${profileEmployee.resignedAt || '日期待核对'} · ${profileEmployee.resignationReason || '原因待核对'}`}</small>
                        </div>
                        <button type="button" onClick={() => openEmploymentAction(profileEmployee.isActive ? 'offboard' : 'reinstate')}>
                          {profileEmployee.isActive ? '办理离职' : '办理复职'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={`hr-editor-note ${!draft.isActive && !productionDepartment ? 'warning' : ''}`.trim()}><ShieldCheck /><div><strong>生产报工资格由人事档案自动判断</strong><span>{productionReportingDescription}</span></div></div>
                </section>
              )}

              {directoryDetailTab === 'attendance' && (
                <section className="hr-profile-section">
                  <header><div><span className="hr-eyebrow">本月汇总</span><h2>考勤与工时</h2></div><CalendarClock /></header>
                  {profileEmployee ? (
                    <>
                      <div className="hr-profile-stat-grid">
                        <article><Clock3 /><span><small>确认出勤</small><strong>{formatHours(profileAttendanceMilliseconds)}</strong></span></article>
                        <article><CalendarClock /><span><small>加班工时</small><strong>{formatHours(profileOvertimeMilliseconds)}</strong></span></article>
                        <article><ClipboardCheck /><span><small>考勤记录</small><strong>{profileAttendanceRecords.length} 条</strong></span></article>
                        <article className={profileAbnormalCount ? 'attention' : ''}><AlertTriangle /><span><small>关联异常</small><strong>{profileAbnormalCount} 项</strong></span></article>
                      </div>
                      <div className="hr-editor-links">
                        <a href={`/workspace/attendance?employeeId=${encodeURIComponent(profileEmployee.id)}`}><CalendarClock /><span><strong>查看考勤与异常</strong><small>定位至该员工的考勤记录</small></span><ChevronRight /></a>
                        <a href={`/workspace/reports?employeeId=${encodeURIComponent(profileEmployee.id)}`}><BarChart3 /><span><strong>查看员工达成率</strong><small>进入报表中心核对已领取工时</small></span><ChevronRight /></a>
                      </div>
                    </>
                  ) : (
                    <EmptyPanel icon={CalendarClock} title="创建后形成考勤档案" description="保存员工后可在这里查看出勤、加班和异常工时。" />
                  )}
                </section>
              )}

              {directoryDetailTab === 'collaboration' && (
                <section className="hr-profile-section">
                  <header><div><span className="hr-eyebrow">职责配置</span><h2>现有责任归属</h2></div><Network /></header>
                  {profilePerson ? (
                    <>
                      <div className="hr-profile-role-summary">
                        <span className="hr-person-avatar">{profilePerson.initials}</span>
                        <div><strong>{profilePerson.role}</strong><p>{profilePerson.summary}</p></div>
                        <a href={`/workspace/employees?view=responsibilities&person=${encodeURIComponent(profilePerson.id)}`}>打开职责配置<ArrowRight /></a>
                      </div>
                      <div className="hr-profile-responsibilities">
                        {profileWorkItems.slice(0, 5).map(item => (
                          <a href={item.route} key={item.id}>
                            <span className={item.priority === 'urgent' ? 'urgent' : item.priority === 'high' ? 'high' : ''}>{item.relation === 'owned' ? '主责' : item.relation === 'review' ? '审核' : item.relation === 'assist' ? '协同' : '知会'}</span>
                            <div><strong>{item.title}</strong><small>{item.source} · {item.stateLabel}</small></div>
                            <em>{item.dueLabel}</em><ChevronRight />
                          </a>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyPanel icon={Network} title="尚未关联职责档案" description="可在“职责配置”中按真实人员姓名配置责任、审核和交接关系。" action={<button type="button" className="hr-text-button" onClick={() => changeView('responsibilities')}>进入职责配置</button>} />
                  )}
                </section>
              )}
            </div>

            <footer className="hr-profile-footer">
              <span>{dirty ? '有未保存修改' : creating ? '填写信息后创建档案' : directoryEditing ? '编辑模式' : '查看模式 · 点击“编辑档案”后修改'}</span>
              {editorUnlocked ? <div className="hr-profile-footer-actions"><button type="button" className="hr-secondary-button" disabled={saving} onClick={exitDirectoryEditor}><X size={16} />取消</button><button type="button" className="hr-primary-button" disabled={saving || (!creating && !selectedEmployee)} onClick={() => void saveEmployee()}>{saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}{saving ? '保存中…' : creating ? '创建员工' : '保存员工档案'}</button></div> : <button type="button" className="hr-primary-button" disabled={!selectedEmployee} onClick={beginDirectoryEdit}><PencilLine size={17} />编辑档案</button>}
            </footer>
          </section>

          <aside className="hr-role-profile">
            <header><button type="button" title="返回人事首页" onClick={returnToHrHome}><ChevronRight /></button><div><span className="hr-eyebrow">人员主档联动</span><h2>岗位、账号与权限</h2></div></header>
            <section>
              <h3>岗位归属</h3>
              <div className="hr-role-path">
                <span>公司</span><ChevronRight /><span>{profileDepartment}</span><ChevronRight /><span>{profileTeam}</span><ChevronRight /><strong>{profilePosition}</strong>
              </div>
              {!!profileAccessGrants.filter(grant => grant.grantType !== 'PRIMARY').length && <div className="hr-role-assignment-tags">{profileAccessGrants.filter(grant => grant.grantType !== 'PRIMARY').map(grant => <span key={grant.id}>{employeeGrantTypeLabel(grant.grantType)} · {employeeGrantDepartment(grant, profileDepartment)}{grant.effectiveTo ? ` · 至${formatDate(grant.effectiveTo)}` : ''}</span>)}</div>}
            </section>
            <section>
              <h3>核心职责</h3>
              {profilePerson?.coreResponsibilities.length ? (
                <ol>
                  {profilePerson.coreResponsibilities.slice(0, 3).map((responsibility, index) => <li key={responsibility}><span>{index + 1}</span><p>{responsibility}</p></li>)}
                </ol>
              ) : (
                <p className="hr-role-empty">当前人员尚未在“职责配置”中维护核心职责。</p>
              )}
            </section>
            <section>
              <h3>部门权限来源 <small>{profilePermissionSyncLabel}</small></h3>
              <div className="hr-role-grant-summary">
                {profileAccessGrants.map(grant => <span key={grant.id}><em>{employeeGrantTypeLabel(grant.grantType)}</em><strong>{employeeGrantDepartment(grant, profileDepartment)}</strong><small>{employeeAccessProfileLabel(grant.profileKey)}</small></span>)}
                {!profileAccessGrants.length && profilePermissionSummary?.activeGrantCount ? <span><em>摘要</em><strong>{profilePermissionSummary.departmentCodes.join('、') || profileDepartment}</strong><small>{profilePermissionSummary.profiles.map(employeeAccessProfileLabel).join('、')}</small></span> : null}
                {!profileAccessGrants.length && !profilePermissionSummary?.activeGrantCount && <p className="hr-role-empty">{profileAccount ? `${profileDepartment} · ${profileNoGrantDescription}` : '尚未开通账号与部门权限。'}</p>}
              </div>
            </section>
            <section>
              <h3>账号与访问 {canManageAccounts && profileEmployee && <a href={`/dashboard?settings=accounts&employeeId=${encodeURIComponent(profileEmployee.id)}`}>设置</a>}</h3>
              <div className="hr-role-account-state">
                <header><span className={`tone-${profileAccountStatus.tone}`}><KeyRound />{profileAccountStatus.label}</span><small>{profileAccount?.username || '未分配账号'}</small></header>
                <div>{profileAccessMethods.map(method => <span key={method}>{method.includes('扫码') ? <QrCode /> : <Monitor />}{method}</span>)}{!profileAccessMethods.length && <span className="muted"><KeyRound />未开通访问方式</span>}</div>
              </div>
            </section>
            <section>
              <h3>人员状态</h3>
              <div className="hr-role-status">
                <span className={draft.isActive ? 'ok' : ''}><CheckCircle2 />{draft.isActive ? '在职' : '已离职'}</span>
                <span className={draft.attendanceEnabled ? 'ok' : ''}><CalendarCheck2 />{draft.attendanceEnabled ? '考勤启用' : '考勤未启用'}</span>
                <span className={productionReportingEligible ? 'ok' : ''}><UserRoundCheck />{productionReportingEligible ? '具备生产报工资格' : '不具备生产报工资格'}</span>
              </div>
            </section>
            <section className="hr-role-team">
              <h3>团队构成 <small>共 {profileTeamMembers.length} 人</small></h3>
              {roleComposition.length ? (
                <div>
                  {roleComposition.map((item, index) => (
                    <span key={item.role}>
                      <i style={{ '--role-tone': `${index * 64 + 214}` } as React.CSSProperties} />
                      <strong>{item.role}</strong>
                      <em>{item.count} 人</em>
                      <small>{profileTeamMembers.length ? Math.round((item.count / profileTeamMembers.length) * 100) : 0}%</small>
                    </span>
                  ))}
                </div>
              ) : <p className="hr-role-empty">当前组织归属下暂无可统计人员。</p>}
            </section>
          </aside>
        </div>
      </div>
    );
  }

  function renderRecruiting() {
    const departments = [...new Set(recruitmentDemands.map(demand => demand.department))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const normalized = recruitmentKeyword.trim().toLocaleLowerCase('zh-CN');
    const visibleDemands = recruitmentDemands.filter(demand => {
      if (recruitingStageFilter && demand.status !== recruitingStageFilter) return false;
      if (recruitmentDepartmentFilter && demand.department !== recruitmentDepartmentFilter) return false;
      if (!normalized) return true;
      return `${demand.code} ${demand.department} ${demand.position} ${demand.team || ''} ${demand.requester?.name || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized);
    });
    const demand = selectedRecruitmentDemand;
    const recruitmentStages: Array<{ status: RecruitmentDemandStatusDTO; label: string }> = [
      { status: 'DRAFT', label: '需求建立' },
      { status: 'PENDING_APPROVAL', label: '需求审批' },
      { status: 'RECRUITING', label: '人才筛选' },
      { status: 'INTERVIEWING', label: '面试评估' },
      { status: 'OFFER', label: '录用办理' },
      { status: 'CLOSED', label: '完成归档' },
    ];
    const stageIndex = demand
      ? Math.max(0, recruitmentStages.findIndex(stage => stage.status === demand.status))
      : 0;
    const selectedCandidate = demand?.candidates.find(candidate => candidate.id === selectedRecruitmentCandidateId) || null;
    const upcomingInterviews = recruitmentDemands
      .flatMap(item => item.candidates.flatMap(candidate => (
        candidate.interviews
          .filter(interview => interview.status === 'SCHEDULED')
          .map(interview => ({ demand: item, candidate, interview }))
      )))
      .sort((left, right) => new Date(left.interview.scheduledAt).getTime() - new Date(right.interview.scheduledAt).getTime())
      .slice(0, 4);
    return (
      <div className="hr-view hr-module-view hr-recruiting-view">
        <section className="hr-module-hero hr-recruitment-hero">
          <div>
            <span className="hr-eyebrow">招聘管理 · 真实业务台账</span>
            <h1>招聘需求与人才进度</h1>
            <p>从用人申请、审批、候选筛选、面试到录用建档，全部记录可追踪、可继续处理。</p>
          </div>
          <div className="hr-recruitment-hero-actions">
            <span><BadgeCheck size={15} />数据实时保存</span>
            <button type="button" className="hr-primary-button" onClick={() => openRecruitmentDemandDialog()}><Plus size={17} />新建招聘需求</button>
          </div>
        </section>
        <section className="hr-recruitment-commandbar">
          <div className="hr-recruitment-kpis">
            <button type="button" onClick={() => setRecruitingStageFilter('')}>
              <span className="blue"><BriefcaseBusiness /></span><small>进行中需求</small><strong>{recruitmentSummary.activeDemandCount}</strong>
            </button>
            <button type="button" onClick={() => setRecruitingStageFilter('PENDING_APPROVAL')}>
              <span className="orange"><ClipboardCheck /></span><small>待审批</small><strong>{recruitmentSummary.pendingApprovalCount}</strong>
            </button>
            <span><i className="violet"><UsersRound /></i><small>候选人</small><strong>{recruitmentSummary.candidateCount}</strong></span>
            <span><i className="green"><UserRoundCheck /></i><small>已入职</small><strong>{recruitmentSummary.hiredCount}</strong></span>
            <span className={recruitmentSummary.overdueCount ? 'attention' : ''}><i><AlertTriangle /></i><small>已超期</small><strong>{recruitmentSummary.overdueCount}</strong></span>
          </div>
          <div className="hr-recruitment-filters">
            <label><Search size={16} /><input value={recruitmentKeyword} onChange={event => setRecruitmentKeyword(event.target.value)} placeholder="搜索需求编号、岗位或负责人" /></label>
            <select value={recruitmentDepartmentFilter} onChange={event => setRecruitmentDepartmentFilter(event.target.value)} aria-label="筛选部门">
              <option value="">全部部门</option>
              {departments.map(item => <option value={item} key={item}>{item}</option>)}
            </select>
            <select value={recruitingStageFilter} onChange={event => setRecruitingStageFilter(event.target.value)} aria-label="筛选状态">
              {recruitmentStageOptions.map(item => <option value={item.value} key={item.value || 'all'}>{item.label}</option>)}
            </select>
            <button type="button" className="hr-icon-button" disabled={recruitmentSaving} title="刷新招聘数据" onClick={() => void refreshRecruitment()}>
              <RefreshCw className={recruitmentSaving ? 'spin' : ''} />
            </button>
          </div>
        </section>

        {!recruitmentDemands.length ? (
          <section className="hr-main-panel hr-recruitment-empty-state">
            <span><ClipboardList /></span>
            <div>
              <small>招聘台账已就绪</small>
              <h2>当前还没有招聘需求</h2>
              <p>从真实用人需求开始建立记录。系统不会再自动生成岗位储备或虚拟候选人。</p>
            </div>
            <button type="button" className="hr-primary-button" onClick={() => openRecruitmentDemandDialog()}><Plus size={16} />建立第一条需求</button>
          </section>
        ) : (
          <div className="hr-recruitment-workspace">
            <section className="hr-main-panel hr-recruitment-demand-list">
              <header className="hr-section-header">
                <div><span>岗位需求</span><h2>招聘需求台账</h2></div>
                <em>{visibleDemands.length} / {recruitmentDemands.length} 条</em>
              </header>
              <div>
                {visibleDemands.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    className={`${selectedRecruitmentDemandId === item.id ? 'selected' : ''}${item.overdue ? ' overdue' : ''}`}
                    onClick={() => setSelectedRecruitmentDemandId(item.id)}
                  >
                    <span className={`hr-recruitment-demand-icon ${recruitmentStatusTone(item.status)}`}><BriefcaseBusiness /></span>
                    <span className="hr-recruitment-demand-copy">
                      <small>{item.code} · {item.department}</small>
                      <strong>{item.position}</strong>
                      <em>{item.requester?.name || '负责人待补充'} · 计划 {item.headcount} 人</em>
                    </span>
                    <span className="hr-recruitment-demand-meta">
                      <b className={recruitmentStatusTone(item.status)}>{item.statusText}</b>
                      <small>{item.overdue ? '已超期' : `到岗 ${formatRecruitmentDate(item.targetDate)}`}</small>
                    </span>
                  </button>
                ))}
                {!visibleDemands.length && (
                  <EmptyPanel
                    icon={Search}
                    title="没有匹配的招聘需求"
                    description="调整关键词、部门或状态筛选后再试。"
                    action={<button type="button" className="hr-text-button" onClick={() => { setRecruitmentKeyword(''); setRecruitmentDepartmentFilter(''); setRecruitingStageFilter(''); }}>清除筛选</button>}
                  />
                )}
              </div>
            </section>

            {demand ? (
              <section className="hr-main-panel hr-recruitment-detail">
                <header>
                  <div className="hr-recruitment-detail-title">
                    <span>{demand.code} · {demand.department}{demand.team ? ` / ${demand.team}` : ''}</span>
                    <h2>{demand.position}</h2>
                    <p>{demand.employmentTypeText} · 需求 {demand.headcount} 人 · 已入职 {demand.hiredCount} 人 · 仍缺 {demand.remainingHeadcount} 人</p>
                  </div>
                  <div className="hr-recruitment-detail-actions">
                    <b className={recruitmentStatusTone(demand.status)}>{demand.statusText}</b>
                    {demand.status === 'DRAFT' && <>
                      <button type="button" className="hr-secondary-button" onClick={() => openRecruitmentDemandDialog(demand)}><PencilLine />编辑</button>
                      <button type="button" className="hr-primary-button" disabled={recruitmentSaving} onClick={() => void transitionRecruitmentDemand('submit')}><Send />提交审批</button>
                    </>}
                    {demand.status === 'PENDING_APPROVAL' && <>
                      <button type="button" className="hr-secondary-button" onClick={() => void transitionRecruitmentDemand('return_draft')}>退回修改</button>
                      <button type="button" className="hr-primary-button" disabled={recruitmentSaving} onClick={() => void transitionRecruitmentDemand('approve')}><Check />审批并启动</button>
                    </>}
                    {['RECRUITING', 'INTERVIEWING', 'OFFER'].includes(demand.status) && <>
                      <button type="button" className="hr-secondary-button" onClick={() => openRecruitmentDemandDialog(demand)}><PencilLine />调整需求</button>
                      <button type="button" className="hr-primary-button" onClick={openRecruitmentCandidateDialog}><UserPlus />录入候选人</button>
                      <button type="button" className="hr-icon-button" title="取消需求" onClick={() => void transitionRecruitmentDemand('cancel')}><X /></button>
                    </>}
                    {['CLOSED', 'CANCELLED'].includes(demand.status) && (
                      <button type="button" className="hr-secondary-button" onClick={() => void transitionRecruitmentDemand('reopen')}><RotateCcw />重新开启</button>
                    )}
                  </div>
                </header>

                <div className={`hr-recruitment-stage-line${demand.status === 'CANCELLED' ? ' cancelled' : ''}`}>
                  {recruitmentStages.map((stage, index) => (
                    <span key={stage.status} className={`${index < stageIndex ? 'done' : ''}${index === stageIndex ? 'current' : ''}`}>
                      <i>{index < stageIndex ? <Check /> : index + 1}</i>
                      <small>{stage.label}</small>
                    </span>
                  ))}
                </div>

                <div className="hr-recruitment-facts">
                  <span><small>用人负责人</small><strong>{demand.requester?.name || '待补充'}</strong></span>
                  <span><small>招聘协调</small><strong>{demand.coordinator?.name || '待补充'}</strong></span>
                  <span><small>期望到岗</small><strong className={demand.overdue ? 'danger' : ''}>{formatRecruitmentDate(demand.targetDate)}</strong></span>
                  <span><small>优先级</small><strong>{demand.priorityText}</strong></span>
                  <span className="wide"><small>招聘原因</small><strong>{demand.reason}</strong></span>
                </div>

                <section className="hr-recruitment-candidates">
                  <header>
                    <div><span className="hr-eyebrow">人才漏斗</span><h3>候选人进展</h3></div>
                    <em>{demand.candidateCount} 人 · {demand.interviewCount} 场面试</em>
                  </header>
                  <div className="hr-recruitment-candidate-head">
                    <span>候选人</span><span>来源 / 联系方式</span><span>当前阶段</span><span>下一步</span><span>操作</span>
                  </div>
                  <div className="hr-recruitment-candidate-list">
                    {demand.candidates.map(candidate => {
                      const scheduled = candidate.interviews.find(interview => interview.status === 'SCHEDULED');
                      return (
                        <article key={candidate.id}>
                          <span className="hr-candidate-person"><i>{candidate.name.slice(0, 1)}</i><span><strong>{candidate.name}</strong><small>{candidate.code}</small></span></span>
                          <span className="hr-candidate-source"><strong>{candidate.source}</strong><small>{candidate.phone || '未留电话'}</small></span>
                          <span><b className={candidateStatusTone(candidate.status)}>{candidate.statusText}</b></span>
                          <span className="hr-candidate-next">
                            <strong>{scheduled ? `第 ${scheduled.round} 轮面试` : candidate.nextActionAt ? '待跟进' : candidate.statusText}</strong>
                            <small>{scheduled ? formatDateTime(scheduled.scheduledAt) : formatRecruitmentDate(candidate.nextActionAt)}</small>
                          </span>
                          <span className="hr-candidate-actions">
                            {candidate.status === 'SCREENING' && <>
                              <button type="button" onClick={() => openRecruitmentInterviewDialog(candidate)}>安排面试</button>
                              <button type="button" className="quiet" onClick={() => void updateRecruitmentCandidate(candidate, 'REJECTED')}>淘汰</button>
                            </>}
                            {candidate.status === 'INTERVIEW' && (
                              scheduled
                                ? <button type="button" onClick={() => openRecruitmentInterviewResultDialog(candidate)}>填写结果</button>
                                : <button type="button" onClick={() => openRecruitmentInterviewDialog(candidate)}>安排下一轮</button>
                            )}
                            {candidate.status === 'OFFER' && <>
                              <button type="button" className="orange" onClick={() => openRecruitmentHireDialog(candidate)}>录用入职</button>
                              <button type="button" className="quiet" onClick={() => void updateRecruitmentCandidate(candidate, 'REJECTED')}>不录用</button>
                            </>}
                            {candidate.status === 'HIRED' && candidate.employee && (
                              <button type="button" onClick={() => {
                                const employee = employees.find(item => item.id === candidate.employee?.id);
                                if (employee) chooseEmployee(employee);
                                changeView('directory', employee?.id);
                              }}>查看档案<ExternalLink /></button>
                            )}
                            {['REJECTED', 'WITHDRAWN'].includes(candidate.status) && (
                              <button type="button" className="quiet" onClick={() => void updateRecruitmentCandidate(candidate, 'SCREENING')}>重新进入</button>
                            )}
                          </span>
                        </article>
                      );
                    })}
                    {!demand.candidates.length && (
                      <EmptyPanel
                        icon={UserPlus}
                        title={['DRAFT', 'PENDING_APPROVAL'].includes(demand.status) ? '需求通过审批后开始招聘' : '尚未录入候选人'}
                        description={['DRAFT', 'PENDING_APPROVAL'].includes(demand.status) ? '先完成需求审批，确保招聘岗位和人数已确认。' : '录入真实候选人后，可继续安排面试和办理录用。'}
                        action={!['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'CLOSED'].includes(demand.status)
                          ? <button type="button" className="hr-primary-button" onClick={openRecruitmentCandidateDialog}><UserPlus />录入候选人</button>
                          : undefined}
                      />
                    )}
                  </div>
                </section>
              </section>
            ) : (
              <section className="hr-main-panel hr-recruitment-detail"><EmptyPanel icon={BriefcaseBusiness} title="请选择招聘需求" description="从左侧台账选择一条需求查看完整进度。" /></section>
            )}

            <aside className="hr-main-panel hr-recruitment-side">
              <section>
                <header><div><span className="hr-eyebrow">实时漏斗</span><h3>招聘推进</h3></div><em>{recruitmentSummary.remainingHeadcount} 人待补</em></header>
                <div className="hr-recruitment-funnel">
                  {[
                    { label: '候选筛选', value: recruitmentDemands.reduce((sum, item) => sum + item.candidates.filter(candidate => candidate.status === 'SCREENING').length, 0), tone: 'blue' },
                    { label: '面试评估', value: recruitmentDemands.reduce((sum, item) => sum + item.candidates.filter(candidate => candidate.status === 'INTERVIEW').length, 0), tone: 'violet' },
                    { label: '待录用', value: recruitmentDemands.reduce((sum, item) => sum + item.candidates.filter(candidate => candidate.status === 'OFFER').length, 0), tone: 'orange' },
                    { label: '已入职', value: recruitmentSummary.hiredCount, tone: 'green' },
                  ].map(item => (
                    <span key={item.label}><i className={item.tone}><UsersRound /></i><small>{item.label}</small><strong>{item.value}</strong></span>
                  ))}
                </div>
              </section>
              <section>
                <header><div><span className="hr-eyebrow">日程</span><h3>近期面试</h3></div><em>{upcomingInterviews.length} 场</em></header>
                <div className="hr-upcoming-interviews">
                  {upcomingInterviews.map(item => (
                    <button type="button" key={item.interview.id} onClick={() => {
                      setSelectedRecruitmentDemandId(item.demand.id);
                      openRecruitmentInterviewResultDialog(item.candidate);
                    }}>
                      <span><CalendarDays /></span>
                      <span><strong>{item.candidate.name} · {item.demand.position}</strong><small>{formatDateTime(item.interview.scheduledAt)} · {item.interview.interviewer?.name || '面试官待定'}</small></span>
                    </button>
                  ))}
                  {!upcomingInterviews.length && <p>近期没有待处理面试。</p>}
                </div>
              </section>
              <section className="hr-recruitment-activity">
                <header><div><span className="hr-eyebrow">操作留痕</span><h3>最近记录</h3></div></header>
                <div>
                  {(demand?.activities || []).slice(0, 6).map(activity => (
                    <span key={activity.id}><i /><strong>{activity.actionText}</strong><small>{activity.actor?.displayName || '系统'} · {formatDateTime(activity.createdAt)}</small></span>
                  ))}
                  {!demand?.activities.length && <p>当前需求暂无操作记录。</p>}
                </div>
              </section>
            </aside>
          </div>
        )}

        {recruitmentDialog && (
          <div className="hr-recruitment-dialog-backdrop" role="presentation" onMouseDown={event => {
            if (event.currentTarget === event.target && !recruitmentSaving) setRecruitmentDialog(null);
          }}>
            <section className="hr-recruitment-dialog" role="dialog" aria-modal="true" aria-labelledby="recruitment-dialog-title">
              <header>
                <div>
                  <span className="hr-eyebrow">招聘管理</span>
                  <h2 id="recruitment-dialog-title">
                    {recruitmentDialog === 'demand' && (editingRecruitmentDemand ? '调整招聘需求' : '新建招聘需求')}
                    {recruitmentDialog === 'candidate' && '录入候选人'}
                    {recruitmentDialog === 'interview' && '安排面试'}
                    {recruitmentDialog === 'interview-result' && '填写面试结果'}
                    {recruitmentDialog === 'hire' && '录用并建立员工档案'}
                  </h2>
                </div>
                <button type="button" className="hr-icon-button" disabled={recruitmentSaving} onClick={() => setRecruitmentDialog(null)}><X /></button>
              </header>

              {recruitmentDialog === 'demand' && (
                <div className="hr-recruitment-dialog-body">
                  <div className="hr-recruitment-form-grid">
                    <label><span>用人部门 *</span><input value={recruitmentDemandDraft.department} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, department: event.target.value }))} placeholder="例如：生产部" /></label>
                    <label><span>招聘岗位 *</span><input value={recruitmentDemandDraft.position} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, position: event.target.value }))} placeholder="填写正式岗位名称" /></label>
                    <label><span>班组 / 团队</span><input value={recruitmentDemandDraft.team} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, team: event.target.value }))} placeholder="可选" /></label>
                    <label><span>招聘人数 *</span><input type="number" min="1" max="999" value={recruitmentDemandDraft.headcount} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, headcount: event.target.value }))} /></label>
                    <label><span>用工类型</span><select value={recruitmentDemandDraft.employmentType} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, employmentType: event.target.value }))}><option value="full_time">正式员工</option><option value="temporary">临时用工</option><option value="intern">实习</option><option value="contractor">劳务协作</option></select></label>
                    <label><span>优先级</span><select value={recruitmentDemandDraft.priority} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, priority: event.target.value }))}><option value="NORMAL">常规</option><option value="HIGH">优先</option><option value="URGENT">紧急</option></select></label>
                    <label><span>期望到岗日期</span><input type="date" value={recruitmentDemandDraft.targetDate} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, targetDate: event.target.value }))} /></label>
                    <label><span>用人负责人</span><select value={recruitmentDemandDraft.requesterId} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, requesterId: event.target.value }))}><option value="">待指定</option>{employees.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.name} · {item.position || item.department || '岗位待维护'}</option>)}</select></label>
                    <label><span>招聘协调人</span><select value={recruitmentDemandDraft.coordinatorId} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, coordinatorId: event.target.value }))}><option value="">待指定</option>{employees.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.name} · {item.position || item.department || '岗位待维护'}</option>)}</select></label>
                    <label className="wide"><span>招聘原因 *</span><textarea value={recruitmentDemandDraft.reason} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, reason: event.target.value }))} placeholder="说明新增、替补、产能扩充等真实原因" /></label>
                    <label className="wide"><span>岗位要求</span><textarea value={recruitmentDemandDraft.requirements} onChange={event => setRecruitmentDemandDraft(current => ({ ...current, requirements: event.target.value }))} placeholder="技能、经验、班次与其他必要条件" /></label>
                  </div>
                </div>
              )}

              {recruitmentDialog === 'candidate' && (
                <div className="hr-recruitment-dialog-body">
                  <div className="hr-recruitment-context"><BriefcaseBusiness /><span><small>关联需求</small><strong>{demand?.department} · {demand?.position}</strong></span></div>
                  <div className="hr-recruitment-form-grid">
                    <label><span>候选人姓名 *</span><input value={recruitmentCandidateDraft.name} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, name: event.target.value }))} /></label>
                    <label><span>联系电话</span><input value={recruitmentCandidateDraft.phone} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, phone: event.target.value }))} /></label>
                    <label><span>候选来源 *</span><input value={recruitmentCandidateDraft.source} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, source: event.target.value }))} placeholder="内推、招聘平台、人才市场等" /></label>
                    <label><span>工作年限</span><input type="number" min="0" max="80" value={recruitmentCandidateDraft.experienceYears} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, experienceYears: event.target.value }))} /></label>
                    <label><span>当前公司</span><input value={recruitmentCandidateDraft.currentCompany} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, currentCompany: event.target.value }))} /></label>
                    <label><span>当前岗位</span><input value={recruitmentCandidateDraft.currentPosition} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, currentPosition: event.target.value }))} /></label>
                    <label><span>期望薪资</span><input value={recruitmentCandidateDraft.expectedSalary} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, expectedSalary: event.target.value }))} /></label>
                    <label><span>下一步跟进时间</span><input type="datetime-local" value={recruitmentCandidateDraft.nextActionAt} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, nextActionAt: event.target.value }))} /></label>
                    <label className="wide"><span>候选备注</span><textarea value={recruitmentCandidateDraft.notes} onChange={event => setRecruitmentCandidateDraft(current => ({ ...current, notes: event.target.value }))} placeholder="记录关键经历、沟通结果和关注点" /></label>
                  </div>
                </div>
              )}

              {(recruitmentDialog === 'interview' || recruitmentDialog === 'interview-result') && (
                <div className="hr-recruitment-dialog-body">
                  <div className="hr-recruitment-context"><UserRound /><span><small>候选人</small><strong>{selectedCandidate?.name || demand?.candidates.find(item => item.id === selectedRecruitmentCandidateId)?.name}</strong></span></div>
                  {recruitmentDialog === 'interview' ? (
                    <div className="hr-recruitment-form-grid">
                      <label><span>面试时间 *</span><input type="datetime-local" value={recruitmentInterviewDraft.scheduledAt} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, scheduledAt: event.target.value }))} /></label>
                      <label><span>时长（分钟）</span><input type="number" min="15" max="480" value={recruitmentInterviewDraft.durationMinutes} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, durationMinutes: event.target.value }))} /></label>
                      <label><span>面试官</span><select value={recruitmentInterviewDraft.interviewerId} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, interviewerId: event.target.value }))}><option value="">待指定</option>{employees.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.name} · {item.position || item.department || '岗位待维护'}</option>)}</select></label>
                      <label><span>面试方式</span><select value={recruitmentInterviewDraft.method} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, method: event.target.value }))}><option value="onsite">现场面试</option><option value="video">视频面试</option><option value="phone">电话沟通</option></select></label>
                      <label className="wide"><span>地点 / 会议入口</span><input value={recruitmentInterviewDraft.location} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, location: event.target.value }))} placeholder="会议室、车间或线上会议地址" /></label>
                    </div>
                  ) : (
                    <div className="hr-recruitment-form-grid">
                      <label><span>面试结果 *</span><select value={recruitmentInterviewDraft.result} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, result: event.target.value }))}><option value="pass">通过，进入待录用</option><option value="hold">待定，继续评估</option><option value="reject">未通过</option><option value="no_show">未到场</option></select></label>
                      <label className="wide"><span>面试评价 *</span><textarea value={recruitmentInterviewDraft.feedback} onChange={event => setRecruitmentInterviewDraft(current => ({ ...current, feedback: event.target.value }))} placeholder="记录能力判断、风险点与后续建议" /></label>
                    </div>
                  )}
                </div>
              )}

              {recruitmentDialog === 'hire' && (
                <div className="hr-recruitment-dialog-body">
                  <div className="hr-recruitment-hire-note"><BadgeCheck /><span><strong>录用后将自动建立员工档案</strong><small>候选人与招聘需求保留关联，后续档案维护在“员工档案”中进行。</small></span></div>
                  <div className="hr-recruitment-form-grid">
                    <label className="hr-auto-number-control">
                      <span>员工编号</span>
                      <input value={nextEmployeeNoLoading ? '正在计算…' : nextEmployeeNo || '保存时自动分配'} readOnly aria-readonly="true" />
                      <small>确认录用时正式分配，离职后不回收</small>
                    </label>
                    <label><span>员工姓名</span><input value={selectedCandidate?.name || demand?.candidates.find(item => item.id === selectedRecruitmentCandidateId)?.name || ''} disabled /></label>
                    <label><span>部门</span><input value={recruitmentHireDraft.department} onChange={event => setRecruitmentHireDraft(current => ({ ...current, department: event.target.value }))} /></label>
                    <label><span>岗位</span><input value={recruitmentHireDraft.position} onChange={event => setRecruitmentHireDraft(current => ({ ...current, position: event.target.value }))} /></label>
                    <label><span>班组 / 团队</span><input value={recruitmentHireDraft.team} onChange={event => setRecruitmentHireDraft(current => ({ ...current, team: event.target.value }))} /></label>
                    <label className="hr-recruitment-checkbox"><input type="checkbox" checked={recruitmentHireDraft.attendanceEnabled} onChange={event => setRecruitmentHireDraft(current => ({ ...current, attendanceEnabled: event.target.checked }))} /><span><strong>启用考勤</strong><small>入职后进入正常考勤与报工范围</small></span></label>
                  </div>
                </div>
              )}

              {recruitmentDialogError && <div className="hr-recruitment-dialog-error"><AlertTriangle />{recruitmentDialogError}</div>}
              <footer>
                <button type="button" className="hr-secondary-button" disabled={recruitmentSaving} onClick={() => setRecruitmentDialog(null)}>取消</button>
                <button
                  type="button"
                  className="hr-primary-button"
                  disabled={recruitmentSaving}
                  onClick={() => {
                    if (recruitmentDialog === 'demand') void saveRecruitmentDemand();
                    if (recruitmentDialog === 'candidate') void saveRecruitmentCandidate();
                    if (recruitmentDialog === 'interview' || recruitmentDialog === 'interview-result') void saveRecruitmentInterview();
                    if (recruitmentDialog === 'hire') void saveRecruitmentHire();
                  }}
                >
                  {recruitmentSaving ? <Loader2 className="spin" /> : recruitmentDialog === 'hire' ? <UserRoundCheck /> : <Save />}
                  {recruitmentSaving ? '保存中…' : recruitmentDialog === 'hire' ? '确认录用并建档' : '保存'}
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>
    );
  }

  function renderAttendance() {
    return (
      <div className="hr-view hr-module-view hr-attendance-view">
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
    return <SkillPerformanceWorkbench fallbackEmployees={employees} />;
  }

  function renderTraining() {
    return <TrainingDevelopmentWorkbench />;
  }

  function renderOrganization() {
    return (
      <div className="hr-view hr-module-view hr-organization-view">
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

  function renderResponsibilities() {
    return (
      <div className="hr-view hr-module-view hr-responsibilities-view">
        <section className="hr-module-hero hr-responsibilities-hero">
          <div>
            <span className="hr-eyebrow">人事管理 · 责任治理</span>
            <h1>职责配置与人员归属</h1>
            <p>集中维护业务事项的主责、协同、审核与知会关系；角色档案和个人事项已归并到员工档案与审批中心。</p>
          </div>
          <a className="hr-secondary-button" href="/workspace/workflows">查看业务流程<ArrowRight size={17} /></a>
        </section>
            <ResponsibilityMatrixWorkspace user={user} />
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
      ...(recruitmentSummary.pendingApprovalCount ? [{
        id: 'recruitment-pending',
        title: `${recruitmentSummary.pendingApprovalCount} 项招聘需求待审批`,
        source: '招聘管理',
        due: '确认岗位、人数与目标到岗日',
        status: '待审批',
        route: '/workspace/employees?view=recruiting&recruitmentStage=PENDING_APPROVAL',
        tone: 'warning',
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
      <div className="hr-view hr-module-view hr-approvals-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">审批中心 · 协同汇总</span><h1>人事待办与跨模块确认</h1><p>集中展示现有考勤、异常工时和职责协同事项；实际处理仍回到对应业务模块。</p></div>
          <button type="button" className="hr-secondary-button" onClick={() => void loadHumanResources()}><RefreshCw size={17} />刷新待办</button>
        </section>
        <section className="hr-metric-grid compact">
          <MetricCard icon={ClipboardCheck} label="全部待办" value={approvalItems.length} note="当前可定位事项" />
          <MetricCard icon={CalendarCheck2} label="考勤确认" value={attendanceSummary.draftCount} note="草稿记录" tone="orange" />
          <MetricCard icon={ShieldCheck} label="异常审核" value={abnormalSummary.pendingCount} note="质量待确认" tone="red" />
          <MetricCard icon={UsersRound} label="招聘审批" value={recruitmentSummary.pendingApprovalCount} note="真实招聘需求" tone="violet" />
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
      <div className="hr-view hr-module-view hr-analytics-view">
        <section className="hr-module-hero">
          <div><span className="hr-eyebrow">报表分析 · 本月</span><h1>人力运营数据洞察</h1><p>从员工档案、考勤、异常和生产工时汇总可核验的人事指标。</p></div>
          <a className="hr-primary-button" href="/workspace/reports">打开完整报表<ArrowRight size={17} /></a>
        </section>
        <section className="hr-metric-grid compact">
          <MetricCard icon={UsersRound} label="在岗人数" value={summary.active} note={`离职档案 ${summary.inactive} 人`} />
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
      case 'responsibilities': return renderResponsibilities();
      case 'approvals': return renderApprovals();
      case 'analytics': return renderAnalytics();
      default: return renderOverview();
    }
  }

  return (<>
    <main ref={workbenchRef} className="hr-workbench hm-workbench-root">
      <div className="hr-shell">
        <nav className="hr-module-tabs" aria-label="人事管理功能导航">
          <div className="hr-module-tab-list">
            {availableNavigation.map(item => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={view === item.id ? 'active' : ''}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => changeView(item.id)}
                >
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
              {availableNavigation.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
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
    {employmentDialog && selectedEmployee && (
      <div className="hr-employment-dialog-backdrop" role="presentation">
        <section ref={employmentDialogRef} className={`hr-employment-dialog ${employmentDialog}`} role="dialog" aria-modal="true" aria-labelledby="hr-employment-dialog-title">
          <header>
            <div>
              <span>{employmentDialog === 'offboard' ? '人员异动 · 离职检查' : '人员异动 · 恢复任职'}</span>
              <h2 id="hr-employment-dialog-title">{employmentDialog === 'offboard' ? '办理员工离职' : '办理员工复职'}</h2>
              <p>{selectedEmployee.name} · {selectedEmployee.employeeNo} · {selectedEmployee.department || '部门待维护'}</p>
            </div>
            <button type="button" aria-label="关闭" disabled={employmentSaving} onClick={closeEmploymentAction}><X /></button>
          </header>

          <div className="hr-employment-dialog-body hm-scroll-region">
            <section className="hr-employment-summary-card">
              <span className={employmentDialog === 'offboard' ? 'warning' : 'success'}>
                {employmentDialog === 'offboard' ? <AlertTriangle /> : <RotateCcw />}
              </span>
              <div>
                <strong>{employmentDialog === 'offboard' ? '工号与全部历史记录永久保留' : '继续使用原员工编号与历史档案'}</strong>
                <p>{employmentDialog === 'offboard'
                  ? '生效后退出派工、报工、考勤和员工登录名单；已完成记录不会删除或改名。'
                  : '复职只恢复员工在职状态与所选考勤；登录账号和部门权限继续停用，需管理员另行确认。'}</p>
              </div>
            </section>

            <div className="hr-employment-form-grid">
              <label>
                <span>{employmentDialog === 'offboard' ? '离职生效日期' : '复职生效日期'}</span>
                <input
                  type="date"
                  required
                  max={todayDateKey()}
                  value={employmentDraft.effectiveDate}
                  onChange={event => {
                    const effectiveDate = event.target.value;
                    setEmploymentDraft(current => ({ ...current, effectiveDate }));
                    if (effectiveDate) void loadEmploymentPreview(selectedEmployee.id, effectiveDate);
                  }}
                />
                <small>未来日期暂不自动生效，请在生效当天办理</small>
              </label>
              {employmentDialog === 'offboard' ? (
                <label>
                  <span>离职原因</span>
                  <select value={employmentDraft.reason} onChange={event => setEmploymentDraft(current => ({ ...current, reason: event.target.value }))}>
                    <option>主动离职</option>
                    <option>协商解除</option>
                    <option>合同到期</option>
                    <option>公司解除</option>
                    <option>退休</option>
                    <option>其他</option>
                  </select>
                </label>
              ) : (
                <div className="hr-employment-reinstate-options">
                  <label><input type="checkbox" checked={employmentDraft.attendanceEnabled} onChange={event => setEmploymentDraft(current => ({ ...current, attendanceEnabled: event.target.checked }))} /><span>恢复考勤</span></label>
                  <div className="hr-employment-admin-task"><ShieldCheck /><span><strong>账号与权限保持停用</strong><small>复职完成后由管理员在账号设置中确认恢复</small></span></div>
                </div>
              )}
            </div>

            <label className="hr-employment-note">
              <span>{employmentDialog === 'offboard' ? '交接备注（选填）' : '复职说明（选填）'}</span>
              <textarea maxLength={500} value={employmentDraft.note} onChange={event => setEmploymentDraft(current => ({ ...current, note: event.target.value }))} placeholder="填写交接事项、资料归还或复职说明" />
            </label>

            {employmentPreviewLoading ? (
              <div className="hr-employment-loading"><Loader2 className="spin" />正在核对派工、考勤和登录影响…</div>
            ) : employmentPreview?.impact && employmentDialog === 'offboard' ? (
              <section className="hr-employment-impact">
                <header><div><span>离职影响检查</span><h3>系统处理与人工确认</h3></div><em>{employmentPreview.blocked ? '存在阻塞' : '可以办理'}</em></header>
                {employmentPreview.blocked && <div className="hr-employment-blocker"><AlertTriangle />{employmentPreview.blockerMessage}</div>}
                <div>
                  <article className={employmentPreview.impact.activeAssignments ? 'danger' : ''}><strong>{employmentPreview.impact.activeAssignments}</strong><span>正在执行派工</span><small>必须先完成或转派</small></article>
                  <article><strong>{employmentPreview.impact.plannedAssignments}</strong><span>未开始派工</span><small>离职时自动取消</small></article>
                  <article><strong>{employmentPreview.impact.activeMemberships}</strong><span>计划组织身份</span><small>离职时自动停用</small></article>
                  <article><strong>{employmentPreview.impact.pendingCrossTeamRequests}</strong><span>跨组待办</span><small>离职时自动取消</small></article>
                  <article><strong>{employmentPreview.impact.futureCapacityOverrides}</strong><span>后续排班容量</span><small>离职时自动移除</small></article>
                  <article><strong>{employmentPreview.impact.futureAttendanceRecords}</strong><span>生效日起考勤</span><small>保留历史，不再新增</small></article>
                  <article className={employmentPreview.impact.openIssues ? 'attention' : ''}><strong>{employmentPreview.impact.openIssues}</strong><span>未关闭问题</span><small>建议办理后转交责任人</small></article>
                </div>
                {employmentPreview.impact.linkedLogin && <p><ShieldCheck />关联员工登录账号将同步停用，无法继续扫码报工。</p>}
              </section>
            ) : null}

            {employmentPreview?.history?.length ? (
              <section className="hr-employment-history">
                <header><span>任职履历</span><small>只新增记录，不覆盖历史</small></header>
                <div>{employmentPreview.history.map(item => (
                  <article key={item.id}>
                    <i />
                    <div><strong>{item.eventType === 'RESIGNED' ? '离职' : item.eventType === 'REINSTATED' ? '复职' : item.eventType === 'HIRED' ? '入职' : '历史档案'}</strong><span>{item.effectiveDate} · {item.reason || '未填写原因'}</span></div>
                    <small>{item.actorName}</small>
                  </article>
                ))}</div>
              </section>
            ) : null}

            {employmentError && <div className="hr-editor-error" role="alert"><AlertTriangle />{employmentError}</div>}
          </div>

          <footer>
            <span>{employmentDialog === 'offboard' ? '历史报工、工时与考勤不会删除' : '旧派工不会自动恢复，账号权限由管理员确认'}</span>
            <button type="button" className="hr-secondary-button" disabled={employmentSaving} onClick={closeEmploymentAction}>取消</button>
            <button
              type="button"
              className="hr-primary-button"
              disabled={!employmentDraft.effectiveDate || employmentSaving || employmentPreviewLoading || (employmentDialog === 'offboard' && (employmentPreview?.blocked || !employmentPreview))}
              onClick={() => void submitEmploymentAction()}
            >
              {employmentSaving ? <Loader2 className="spin" /> : employmentDialog === 'offboard' ? <CheckCircle2 /> : <RotateCcw />}
              {employmentSaving ? '处理中…' : employmentDialog === 'offboard' ? '确认办理离职' : '确认恢复在职'}
            </button>
          </footer>
        </section>
      </div>
    )}
    {numberReorderOpen && <EmployeeNumberReorderDialog
      employees={employees}
      backgroundRef={workbenchRef}
      onClose={() => setNumberReorderOpen(false)}
      onApplied={nextEmployees => {
        const sorted = sortEmployees(nextEmployees);
        const nextSelected = sorted.find(employee => employee.id === selectedEmployeeId) || sorted[0] || null;
        setEmployees(sorted);
        setSelectedEmployeeId(nextSelected?.id || '');
        setCreating(false);
        const nextDraft = nextSelected ? toDraft(nextSelected) : emptyDraft;
        setDraft(nextDraft);
        setBaseline(nextDraft);
        setToast('员工编号重排已完成，后续新员工将从下一编号继续');
      }}
    />}
  </>);
}
