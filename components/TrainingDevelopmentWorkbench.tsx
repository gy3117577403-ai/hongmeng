'use client';

import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  Award,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  GraduationCap,
  Loader2,
  LockKeyhole,
  Maximize2,
  MessageSquareText,
  Paperclip,
  PencilLine,
  Play,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { parseTrainingLocalTime, trainingDateTimeInput, trainingMonthRange } from '@/lib/training-time';

type TrainingEmployee = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isActive: boolean;
};

type TrainingSkill = { id: string; code: string; name: string; category: string; defaultValidityMonths: number };
type TrainingAttachment = { id: string; kind: string; name: string; mimeType: string; size: number; createdAt: string; contentUrl: string };
type TrainingCourse = {
  id: string;
  code: string;
  name: string;
  category: string;
  objective: string | null;
  description: string | null;
  targetAudience: string | null;
  defaultDurationMinutes: number;
  mode: string;
  isRequired: boolean;
  assessmentMode: string;
  passScore: number | null;
  skillId: string | null;
  skill: { id: string; code: string; name: string; category: string } | null;
  targetLevel: number | null;
  validityMonths: number | null;
  retrainingMonths: number | null;
  ownerEmployeeId: string | null;
  status: string;
  version: number;
  attachments: TrainingAttachment[];
  updatedAt: string;
};

type TrainingParticipant = {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isRequired: boolean;
  attendanceStatus: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  actualMinutes: number | null;
  theoryScore: number | null;
  practicalScore: number | null;
  score: number | null;
  result: string;
  status: string;
  reviewStatus: string;
  reviewComment: string | null;
  certificationId: string | null;
  version: number;
  attachments: TrainingAttachment[];
};

type TrainingPlan = {
  id: string;
  code: string;
  title: string;
  courseId: string | null;
  course: TrainingCourse | null;
  purpose: string | null;
  organizerId: string | null;
  organizerName: string | null;
  trainerId: string | null;
  trainerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  departmentId: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  mode: string;
  isRequired: boolean;
  assessmentMode: string;
  passScore: number | null;
  status: string;
  version: number;
  archivedAt: string | null;
  archivedById: string | null;
  archiveReason: string | null;
  deletedAt: string | null;
  deletedById: string | null;
  deleteReason: string | null;
  restoredAt: string | null;
  restoredById: string | null;
  restoreReason: string | null;
  sessions: Array<{
    id: string;
    name: string;
    sequence: number;
    startAt: string;
    endAt: string;
    location: string | null;
    status: string;
    actualStartAt: string | null;
    actualEndAt: string | null;
    checkInOpenMinutes: number;
    lateAfterMinutes: number;
    checkInCloseMinutes: number;
    feedbackDeadlineHours: number;
    feedbackRequired: boolean;
    version: number;
  }>;
  participants: TrainingParticipant[];
  attachments: TrainingAttachment[];
  activities: Array<{ id: string; action: string; content: string | null; createdAt: string }>;
  summary: {
    participantCount: number;
    attendedCount: number;
    attendanceRate: number;
    passedCount: number;
    passRate: number | null;
    pendingReviewCount: number;
    belowPassCount: number;
  };
};

type TrainingLive = {
  serverTime: string;
  plan: { id: string; code: string; title: string; status: string };
  session: {
    id: string;
    name: string;
    sequence: number;
    startAt: string;
    endAt: string;
    location: string | null;
    status: string;
    actualStartAt: string | null;
    actualEndAt: string | null;
    checkInOpenMinutes: number;
    lateAfterMinutes: number;
    checkInCloseMinutes: number;
    feedbackDeadlineHours: number;
    feedbackRequired: boolean;
    version: number;
  };
  windows: Array<{
    id: string;
    sessionId: string;
    purpose: 'CHECK_IN' | 'FEEDBACK';
    status: 'SCHEDULED' | 'OPEN' | 'EXPIRED' | 'CLOSED' | 'REVOKED';
    generation: number;
    opensAt: string;
    expiresAt: string;
    scanPath: string | null;
  }>;
  participants: Array<{
    id: string;
    employeeId: string;
    employeeNo: string;
    employeeName: string;
    department: string | null;
    position: string | null;
    team: string | null;
    accountReady: boolean;
    attendance: { id: string; status: string; checkInAt: string | null; source: string; correctionReason: string | null; version: number } | null;
    feedback: { id: string; overallRating: number; followUpRequested: boolean; updatedAt: string; version: number } | null;
  }>;
  summary: {
    participantCount: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    leaveCount: number;
    invitedCount: number;
    feedbackEligibleCount: number;
    feedbackCount: number;
    feedbackRate: number;
    followUpCount: number;
    averageOverallRating: number | null;
    averageContentRating: number | null;
    averageTrainerRating: number | null;
    averagePracticalValueRating: number | null;
  };
};

type Workbench = {
  ok: boolean;
  error?: string;
  generatedAt: string;
  permissions: { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; canPermanentDelete: boolean; canExecute: boolean; actorEmployeeId: string | null };
  summary: {
    activeCourseCount: number;
    upcomingPlanCount: number;
    activePlanCount: number;
    pendingReviewCount: number;
    completedPlanCount: number;
    participantCount: number;
    attendanceRate: number;
    passRate: number | null;
  };
  employees: TrainingEmployee[];
  skills: TrainingSkill[];
  courses: TrainingCourse[];
  plans: TrainingPlan[];
  deletedPlans: TrainingPlan[];
  expiringCertifications: Array<{
    id: string;
    employeeId: string;
    employeeNo: string;
    employeeName: string;
    department: string | null;
    team: string | null;
    skillName: string;
    level: number;
    expiresAt: string | null;
    expired: boolean;
  }>;
};

type ViewKey = 'overview' | 'courses' | 'plans' | 'execution' | 'review' | 'records' | 'retraining' | 'reports';
type DrawerKey = 'course' | 'plan' | 'participant' | null;
type PlanViewKey = 'active' | 'completed' | 'cancelled' | 'archived' | 'deleted';

type TrainingPlanImpact = {
  participantCount: number;
  attendanceFactCount: number;
  feedbackCount: number;
  scoreOrReviewFactCount: number;
  certificationCount: number;
  activeQrWindowCount: number;
  attachmentCount: number;
  hasExecutionFacts: boolean;
};

type PlanChangePreview = {
  changedFields: Array<{ key: string; label: string; before: string; after: string; lockedAfterPublish: boolean; scheduleSensitive: boolean }>;
  addedParticipantCount: number;
  removedParticipantCount: number;
  impact: TrainingPlanImpact;
  blockers: string[];
  warnings: string[];
  requiresConfirmation: boolean;
  canApply: boolean;
};

type PlanDialog = {
  kind: 'change' | 'delete' | 'archive' | 'unarchive' | 'restore' | 'cancel' | 'purge';
  plan: TrainingPlan;
  reason: string;
  confirmationCode: string;
  impact: TrainingPlanImpact | null;
  preview: PlanChangePreview | null;
  purge?: { impact: TrainingPlanImpact; canPurge: boolean; blockers: string[]; previewToken: string; requiresInvalidateFacts: boolean; willCancel: boolean };
  invalidateFacts?: boolean;
  error?: string;
};

const emptyCourse = {
  name: '', category: '岗位技能', objective: '', description: '', targetAudience: '', defaultDurationMinutes: '60', mode: 'OFFLINE',
  isRequired: false, assessmentMode: 'NONE', passScore: '80', skillId: '', targetLevel: '1', validityMonths: '12', retrainingMonths: '12', ownerEmployeeId: '',
};

function localInputDate(offsetHours = 1): string {
  return trainingDateTimeInput(new Date(Date.now() + offsetHours * 60 * 60 * 1000));
}

function localDateTimeValue(value: string): string {
  return trainingDateTimeInput(value);
}

const emptyPlan = {
  title: '', courseId: '', purpose: '', organizerId: '', trainerId: '', reviewerId: '', departmentId: '', startAt: localInputDate(24), endAt: localInputDate(26),
  location: '', mode: 'OFFLINE', isRequired: false, assessmentMode: 'NONE', passScore: '80',
  checkInOpenMinutes: '30', lateAfterMinutes: '5', checkInCloseMinutes: '15', feedbackDeadlineHours: '24', feedbackRequired: false,
  participantIds: [] as string[],
};

function fmtDate(value: string | null | undefined, withTime = true): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric' }),
  }).format(date);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: '草稿', PUBLISHED: '已发布', IN_PROGRESS: '进行中', PENDING_REVIEW: '待结审', COMPLETED: '已完成', CANCELLED: '已取消',
    INVITED: '未签到', PRESENT: '已签到', LATE: '迟到', PARTIAL: '部分出勤', ABSENT: '缺席', LEAVE: '请假',
    NOT_REQUIRED: '无需审核', PENDING: '待审核', APPROVED: '已审核', RETURNED: '已退回', PASSED: '合格', FAILED: '不合格',
    SCHEDULED: '等待开放', OPEN: '开放中', EXPIRED: '已过期', CLOSED: '已关闭', REVOKED: '已作废',
  };
  return labels[status] || status;
}

function modeLabel(mode: string): string {
  return mode === 'ONLINE' ? '线上' : mode === 'BLENDED' ? '混合' : '线下';
}

function assessmentLabel(mode: string): string {
  return mode === 'THEORY' ? '理论' : mode === 'PRACTICAL' ? '实操' : mode === 'COMBINED' ? '理论 + 实操' : '无需考核';
}

function planChangeValueLabel(
  fieldKey: string,
  value: string,
  employees: TrainingEmployee[],
  courses: TrainingCourse[],
): string {
  if (value === '未设置') return value;
  if (['organizerId', 'trainerId', 'reviewerId'].includes(fieldKey)) {
    const employee = employees.find(person => person.id === value);
    return employee ? `${employee.employeeNo} · ${employee.name}` : '原人员已不在在岗名单';
  }
  if (fieldKey === 'courseId') {
    const course = courses.find(item => item.id === value);
    return course ? `${course.code} · ${course.name}` : '原课程已停用或删除';
  }
  if (fieldKey === 'startAt' || fieldKey === 'endAt') return fmtDate(value);
  if (fieldKey === 'mode') return modeLabel(value);
  if (fieldKey === 'assessmentMode') return assessmentLabel(value);
  if (fieldKey === 'passScore') return `${value} 分`;
  if (['checkInOpenMinutes', 'lateAfterMinutes', 'checkInCloseMinutes'].includes(fieldKey)) return `${value} 分钟`;
  if (fieldKey === 'feedbackDeadlineHours') return `${value} 小时`;
  return value;
}

function planDialogCopy(kind: PlanDialog['kind']) {
  const copies: Record<PlanDialog['kind'], { eyebrow: string; title: string; description: string; confirm: string }> = {
    purge: { eyebrow: '管理员危险操作 · 不可恢复', title: '永久删除培训计划', description: '永久移除本计划及其私有参训、签到、成绩和反馈记录。独立审计保留；附件进入文件回收，不删除课程库、员工档案及共享技能证书。', confirm: '确认永久删除' },
    change: { eyebrow: '已发布计划变更', title: '确认影响后保存变更', description: '系统不会覆盖历史签到、反馈或成绩；受影响员工会收到本次变更通知。', confirm: '确认变更并通知' },
    delete: { eyebrow: '可恢复删除', title: '将草稿移入回收站', description: '只允许删除未产生执行事实的草稿。课程资料和计划数据不会物理清除，可从回收站恢复。', confirm: '确认删除草稿' },
    archive: { eyebrow: '资料归档', title: '归档已结束计划', description: '归档后从日常计划中隐藏，但员工培训档案、签到、反馈、成绩、附件和审计记录继续保留。', confirm: '确认归档' },
    unarchive: { eyebrow: '历史资料', title: '取消计划归档', description: '计划会重新出现在已完成或已取消列表，业务状态和历史事实不会改变。', confirm: '取消归档' },
    restore: { eyebrow: '回收站恢复', title: '恢复培训计划草稿', description: '恢复后计划回到待处理列表，仍保持草稿状态，不会自动发布或通知员工。', confirm: '确认恢复草稿' },
    cancel: { eyebrow: '取消执行', title: '取消培训计划', description: '取消后保留计划、人员和已经产生的事实，不可再继续签到或考核；后续可以归档。', confirm: '确认取消计划' },
  };
  return copies[kind];
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok) throw new Error(body.error || '操作失败');
  return body;
}

export default function TrainingDevelopmentWorkbench() {
  const [data, setData] = useState<Workbench | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [view, setView] = useState<ViewKey>('overview');
  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [editingPlanId, setEditingPlanId] = useState('');
  const [planView, setPlanView] = useState<PlanViewKey>('active');
  const [planDialog, setPlanDialog] = useState<PlanDialog | null>(null);
  const [pendingPlanPayload, setPendingPlanPayload] = useState<Record<string, unknown> | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [courseDraft, setCourseDraft] = useState({ ...emptyCourse });
  const [planDraft, setPlanDraft] = useState({ ...emptyPlan, participantIds: [] as string[] });
  const [participantDraft, setParticipantDraft] = useState<{ id: string; employeeName: string; version: number; theoryScore: string; practicalScore: string; reviewComment: string } | null>(null);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [live, setLive] = useState<TrainingLive | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [exportRange, setExportRange] = useState(() => trainingMonthRange());
  const [exportFilters, setExportFilters] = useState({ planKeyword: '', department: '', employee: '' });
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPreview, setExportPreview] = useState<{ planCount: number; rowCount: number; employeeCount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrPanelRef = useRef<HTMLElement>(null);
  useToastBridge(toast, setToast);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/training/workbench', { cache: 'no-store' });
      const body = await response.json() as Workbench;
      if (!response.ok) throw new Error(body.error || '培训发展数据加载失败');
      setData(body);
      const allPlans = [...body.plans, ...(body.deletedPlans || [])];
      setSelectedPlanId(current => allPlans.some(plan => plan.id === current) ? current : body.plans.find(plan => !plan.archivedAt)?.id || body.plans[0]?.id || body.deletedPlans?.[0]?.id || '');
      const requestedPlan = new URLSearchParams(window.location.search).get('planId');
      if (requestedPlan && allPlans.some(plan => plan.id === requestedPlan)) {
        setSelectedPlanId(requestedPlan);
        setView('plans');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '培训发展数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedPlan = useMemo(() => {
    const plans = [...(data?.plans || []), ...(data?.deletedPlans || [])];
    return plans.find(plan => plan.id === selectedPlanId) || null;
  }, [data, selectedPlanId]);
  const editingPlan = useMemo(() => data?.plans.find(plan => plan.id === editingPlanId) || null, [data, editingPlanId]);
  useEffect(() => {
    const sessions = selectedPlan?.sessions || [];
    setSelectedSessionId(current => sessions.some(session => session.id === current) ? current : sessions[0]?.id || '');
  }, [selectedPlan]);

  const loadLive = useCallback(async (sessionId: string, quiet = false) => {
    if (!sessionId) {
      setLive(null);
      return;
    }
    if (!quiet) setLiveLoading(true);
    try {
      const response = await fetch(`/api/training/sessions/${sessionId}/live`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as { data?: TrainingLive; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || '培训现场数据加载失败');
      setLive(body.data);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : '培训现场数据加载失败');
    } finally {
      if (!quiet) setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== 'execution' || !selectedSessionId) return undefined;
    void loadLive(selectedSessionId);
    const timer = window.setInterval(() => void loadLive(selectedSessionId, true), 5_000);
    return () => window.clearInterval(timer);
  }, [loadLive, selectedSessionId, view]);

  const activeQrWindow = useMemo(() => live?.windows.find(window => (
    ['SCHEDULED', 'OPEN'].includes(window.status) && Boolean(window.scanPath)
  )) || null, [live]);

  useEffect(() => {
    let cancelled = false;
    if (!activeQrWindow?.scanPath) {
      setQrDataUrl('');
      return undefined;
    }
    const link = `${window.location.origin}${activeQrWindow.scanPath}`;
    void QRCode.toDataURL(link, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M',
      color: { dark: '#172033', light: '#ffffff' },
    }).then(url => { if (!cancelled) setQrDataUrl(url); }).catch(() => {
      if (!cancelled) setQrDataUrl('');
    });
    return () => { cancelled = true; };
  }, [activeQrWindow]);
  const departments = useMemo(() => [...new Set((data?.employees || []).map(person => person.department || '').filter(Boolean))], [data]);
  const filteredEmployees = useMemo(() => {
    const q = keyword.trim().toLocaleLowerCase('zh-CN');
    return (data?.employees || []).filter(person => !departmentFilter || person.department === departmentFilter).filter(person => (
      !q || [person.name, person.employeeNo, person.department, person.position, person.team].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(q))
    ));
  }, [data, departmentFilter, keyword]);
  const pendingReviews = useMemo(() => (data?.plans || []).flatMap(plan => plan.participants.filter(person => person.reviewStatus === 'PENDING').map(person => ({ plan, person }))), [data]);
  const completedRecords = useMemo(() => (data?.plans || []).flatMap(plan => plan.participants.filter(person => (
    plan.status === 'COMPLETED'
    && ['PRESENT', 'LATE'].includes(person.attendanceStatus)
    && (plan.assessmentMode === 'NONE'
      ? person.reviewStatus === 'NOT_REQUIRED'
      : person.reviewStatus === 'APPROVED' && ['PASSED', 'FAILED'].includes(person.result))
  )).map(person => ({ plan, person }))), [data]);
  const currentPlans = useMemo(() => (data?.plans || []).filter(plan => !plan.archivedAt), [data]);
  const visiblePlans = useMemo(() => {
    if (!data) return [];
    if (planView === 'deleted') return data.deletedPlans || [];
    if (planView === 'archived') return data.plans.filter(plan => Boolean(plan.archivedAt));
    if (planView === 'completed') return data.plans.filter(plan => !plan.archivedAt && plan.status === 'COMPLETED');
    if (planView === 'cancelled') return data.plans.filter(plan => !plan.archivedAt && plan.status === 'CANCELLED');
    return data.plans.filter(plan => !plan.archivedAt && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(plan.status));
  }, [data, planView]);

  async function submitCourse(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await jsonRequest('/api/training/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...courseDraft, defaultDurationMinutes: Number(courseDraft.defaultDurationMinutes), passScore: courseDraft.assessmentMode === 'NONE' ? null : Number(courseDraft.passScore), targetLevel: courseDraft.skillId ? Number(courseDraft.targetLevel) : null, validityMonths: courseDraft.skillId ? Number(courseDraft.validityMonths) : null, retrainingMonths: Number(courseDraft.retrainingMonths) }) });
      setDrawer(null);
      setCourseDraft({ ...emptyCourse });
      setToast('培训课程已创建');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '课程创建失败'); } finally { setSaving(false); }
  }

  function planPayload(plan?: TrainingPlan): Record<string, unknown> {
    return {
      ...planDraft,
      startAt: parseTrainingLocalTime(planDraft.startAt).toISOString(),
      endAt: parseTrainingLocalTime(planDraft.endAt).toISOString(),
      passScore: planDraft.assessmentMode === 'NONE' ? null : Number(planDraft.passScore),
      checkInOpenMinutes: Number(planDraft.checkInOpenMinutes),
      lateAfterMinutes: Number(planDraft.lateAfterMinutes),
      checkInCloseMinutes: Number(planDraft.checkInCloseMinutes),
      feedbackDeadlineHours: Number(planDraft.feedbackDeadlineHours),
      ...(plan ? { version: plan.version } : {}),
    };
  }

  function openCreatePlan(seed?: Partial<typeof emptyPlan>) {
    setEditingPlanId('');
    setPlanDraft({ ...emptyPlan, startAt: localInputDate(24), endAt: localInputDate(26), participantIds: [], ...seed });
    setKeyword('');
    setDepartmentFilter('');
    setDrawer('plan');
  }

  function openEditPlan(plan: TrainingPlan) {
    const session = plan.sessions[0];
    setEditingPlanId(plan.id);
    setPlanDraft({
      ...emptyPlan,
      title: plan.title,
      courseId: plan.courseId || '',
      purpose: plan.purpose || '',
      organizerId: plan.organizerId || '',
      trainerId: plan.trainerId || '',
      reviewerId: plan.reviewerId || '',
      departmentId: plan.departmentId || '',
      startAt: localDateTimeValue(plan.startAt),
      endAt: localDateTimeValue(plan.endAt),
      location: plan.location || '',
      mode: plan.mode,
      isRequired: plan.isRequired,
      assessmentMode: plan.assessmentMode,
      passScore: String(plan.passScore ?? 80),
      checkInOpenMinutes: String(session?.checkInOpenMinutes ?? 30),
      lateAfterMinutes: String(session?.lateAfterMinutes ?? 5),
      checkInCloseMinutes: String(session?.checkInCloseMinutes ?? 15),
      feedbackDeadlineHours: String(session?.feedbackDeadlineHours ?? 24),
      feedbackRequired: session?.feedbackRequired ?? false,
      participantIds: plan.participants.map(person => person.employeeId),
    });
    setKeyword('');
    setDepartmentFilter('');
    setDrawer('plan');
  }

  async function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const editingPlan = editingPlanId ? data?.plans.find(plan => plan.id === editingPlanId) || null : null;
      const payload = planPayload(editingPlan || undefined);
      if (!editingPlan) {
        await jsonRequest('/api/training/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        setDrawer(null);
        setPlanDraft({ ...emptyPlan, startAt: localInputDate(24), endAt: localInputDate(26), participantIds: [] });
        setToast('培训计划已建立，可发布通知');
        await load(true);
        setPlanView('active');
        setView('plans');
        return;
      }
      const previewResult = await jsonRequest(`/api/training/plans/${editingPlan.id}/change-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }) as { preview?: PlanChangePreview };
      const preview = previewResult.preview;
      if (!preview) throw new Error('未取得培训计划变更影响');
      if (!preview.canApply || preview.blockers.length) throw new Error(preview.blockers.join('；') || '当前变更不能保存');
      if (!preview.changedFields.length) {
        setToast('计划内容没有变化');
        setDrawer(null);
        setEditingPlanId('');
        return;
      }
      if (preview.requiresConfirmation) {
        setPendingPlanPayload(payload);
        setPlanDialog({ kind: 'change', plan: editingPlan, reason: '', confirmationCode: '', impact: preview.impact, preview });
        return;
      }
      await jsonRequest(`/api/training/plans/${editingPlan.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      setDrawer(null);
      setEditingPlanId('');
      setToast('培训计划草稿已更新');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '计划保存失败'); } finally { setSaving(false); }
  }

  function chooseCourse(courseId: string) {
    const course = data?.courses.find(item => item.id === courseId);
    setPlanDraft(current => ({
      ...current,
      courseId,
      title: current.title || course?.name || '',
      mode: course?.mode || current.mode,
      isRequired: course?.isRequired ?? current.isRequired,
      assessmentMode: course?.assessmentMode || current.assessmentMode,
      passScore: String(course?.passScore ?? 80),
      purpose: current.purpose || course?.objective || '',
    }));
  }

  async function transition(action: string) {
    if (!selectedPlan) return;
    if (action === 'cancel') {
      setPlanDialog({ kind: 'cancel', plan: selectedPlan, reason: '', confirmationCode: '', impact: null, preview: null });
      return;
    }
    setSaving(true);
    try {
      await jsonRequest(`/api/training/plans/${selectedPlan.id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: selectedPlan.version }) });
      setToast(action === 'publish' ? '计划已发布并通知有账号的参训员工' : action === 'start' ? '培训已开始' : action === 'submit_review' ? '培训成绩已提交审核' : action === 'complete' ? '培训已完成，可核对后归档' : '培训计划已取消');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '计划状态更新失败'); } finally { setSaving(false); }
  }

  async function exportLedger(planId?: string, previewOnly = false) {
    setExportBusy(true); setError('');
    try {
      const query = new URLSearchParams(planId ? { planId } : {
        period: 'custom', startDate: exportRange.start, endDate: exportRange.end, ...exportFilters,
      });
      if (previewOnly) query.set('preview', '1');
      const response = await fetch(`/api/training/export.xlsx?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '台账导出失败');
      if (previewOnly) { setExportPreview(await response.json()); return; }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      anchor.download = encoded ? decodeURIComponent(encoded) : '培训台账.xlsx';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setToast('已导出普通 Excel 台账，时间为北京时间');
    } catch (err) { setError(err instanceof Error ? err.message : '台账导出失败'); }
    finally { setExportBusy(false); }
  }

  async function openPlanLifecycleDialog(kind: PlanDialog['kind'], plan: TrainingPlan) {
    setSaving(true);
    try {
      let impact: TrainingPlanImpact | null = null;
      if (kind === 'purge') {
        const result = await jsonRequest(`/api/training/plans/${plan.id}/permanent-delete`) as { preview?: NonNullable<PlanDialog['purge']> };
        if (!result.preview) throw new Error('未取得永久删除影响');
        setPlanDialog({ kind, plan, reason: '', confirmationCode: '', impact: result.preview.impact, preview: null, purge: result.preview, invalidateFacts: false });
        return;
      }
      if (kind === 'delete') {
        const result = await jsonRequest(`/api/training/plans/${plan.id}/delete-preview`, { method: 'POST' }) as {
          preview?: { impact: TrainingPlanImpact; canDelete: boolean; blockers: string[] };
        };
        if (!result.preview) throw new Error('未取得草稿删除影响');
        if (!result.preview.canDelete) throw new Error(result.preview.blockers.join('；') || '当前草稿不能删除');
        impact = result.preview.impact;
      } else if (['archive', 'unarchive', 'restore'].includes(kind)) {
        const result = await jsonRequest(`/api/training/plans/${plan.id}/lifecycle-preview`) as { preview?: { impact: TrainingPlanImpact } };
        impact = result.preview?.impact || null;
      }
      setPlanDialog({ kind, plan, reason: '', confirmationCode: '', impact, preview: null });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划影响加载失败');
    } finally {
      setSaving(false);
    }
  }

  async function confirmPlanDialog() {
    if (!planDialog) return;
    const { kind, plan } = planDialog;
    const reason = planDialog.reason.trim();
    if (['change', 'delete', 'restore', 'cancel', 'purge'].includes(kind) && !reason) {
      setPlanDialog(current => current ? { ...current, error: '请填写本次操作原因' } : current);
      setError('请填写本次操作原因');
      return;
    }
    if (['delete', 'restore', 'purge'].includes(kind) && planDialog.confirmationCode.trim() !== plan.code) {
      setPlanDialog(current => current ? { ...current, error: '请输入完整计划编号' } : current);
      setError(`请输入完整计划编号 ${plan.code}`);
      return;
    }
    setSaving(true);
    try {
      if (kind === 'purge') {
        if (!planDialog.purge?.canPurge) throw new Error('请先处理界面列出的证书关联');
        if (planDialog.purge.requiresInvalidateFacts && !planDialog.invalidateFacts) throw new Error('请确认已有记录属于误录；真实培训应归档保留');
        await jsonRequest(`/api/training/plans/${plan.id}/permanent-delete`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true, reason, confirmationCode: planDialog.confirmationCode.trim(), previewToken: planDialog.purge.previewToken, invalidateFacts: planDialog.invalidateFacts === true }),
        });
        setSelectedPlanId('');
        setLive(null);
        setSelectedSessionId('');
        setSelectedParticipantIds([]);
        setQrDataUrl('');
        setToast('培训计划已永久删除，无法恢复；专属附件已进入文件回收，共享资料未改动');
      } else if (kind === 'change') {
        if (!pendingPlanPayload) throw new Error('变更内容已失效，请重新编辑');
        await jsonRequest(`/api/training/plans/${plan.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pendingPlanPayload, confirmed: true, reason }),
        });
        setDrawer(null);
        setEditingPlanId('');
        setPendingPlanPayload(null);
        setToast('已发布培训计划已变更，并通知相关员工');
      } else if (kind === 'delete') {
        await jsonRequest(`/api/training/plans/${plan.id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: plan.version, reason, confirmationCode: planDialog.confirmationCode.trim() }),
        });
        setPlanView('deleted');
        setToast('草稿已移入回收站，可恢复');
      } else if (kind === 'restore') {
        await jsonRequest(`/api/training/plans/${plan.id}/restore`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: plan.version, reason, confirmationCode: planDialog.confirmationCode.trim() }),
        });
        setPlanView('active');
        setToast('培训计划草稿已恢复');
      } else if (kind === 'archive') {
        await jsonRequest(`/api/training/plans/${plan.id}/archive`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: plan.version, reason, confirmed: true }),
        });
        setPlanView('archived');
        setToast('培训计划已归档，培训档案与附件仍完整保留');
      } else if (kind === 'unarchive') {
        await jsonRequest(`/api/training/plans/${plan.id}/unarchive`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: plan.version, reason, confirmed: true }),
        });
        setPlanView(plan.status === 'COMPLETED' ? 'completed' : 'cancelled');
        setToast('培训计划已取消归档');
      } else if (kind === 'cancel') {
        await jsonRequest(`/api/training/plans/${plan.id}/transition`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', version: plan.version, reason }),
        });
        setPlanView('cancelled');
        setToast('培训计划已取消，历史信息保留');
      }
      setPlanDialog(null);
      await load(true);
    } catch (reasonValue) {
      setPlanDialog(current => current ? { ...current, error: reasonValue instanceof Error ? reasonValue.message : '计划操作失败' } : current);
      setError(reasonValue instanceof Error ? reasonValue.message : '计划操作失败');
    } finally {
      setSaving(false);
    }
  }

  async function startSession(sessionId: string, version: number) {
    setSaving(true);
    try {
      const result = await jsonRequest(`/api/training/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      }) as { ok?: boolean; idempotent?: boolean };
      setToast(result.idempotent ? '本课次已经开始，本次没有重复变更' : '本课次已开始，其他未来课次保持待开始');
      await Promise.all([load(true), loadLive(sessionId, true)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '课次开始失败');
    } finally {
      setSaving(false);
    }
  }

  async function updateAttendance(person: TrainingLive['participants'][number], attendanceStatus: string, sharedReason?: string) {
    if (!person.attendance) {
      setError('课次出勤记录尚未初始化，请刷新现场数据');
      return;
    }
    const reason = sharedReason || window.prompt(`请填写将 ${person.employeeName} 改为“${statusLabel(attendanceStatus)}”的原因`, '培训负责人现场登记')?.trim();
    if (!reason) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/session-attendance/${person.attendance.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: attendanceStatus, version: person.attendance.version, reason }) });
      await Promise.all([loadLive(selectedSessionId, true), load(true)]);
      setToast(`${person.employeeName}：${statusLabel(attendanceStatus)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '签到保存失败'); } finally { setSaving(false); }
  }

  async function batchAttendance(attendanceStatus: string) {
    const people = live?.participants.filter(person => selectedParticipantIds.includes(person.id)) || [];
    if (!people.length) return;
    if (people.some(person => !person.attendance)) {
      setError('部分课次出勤记录尚未初始化，请刷新后重试');
      return;
    }
    const reason = window.prompt(`请填写批量标记 ${people.length} 人为“${statusLabel(attendanceStatus)}”的原因`, '培训负责人现场批量登记')?.trim();
    if (!reason) return;
    setSaving(true);
    try {
      for (const person of people) {
        await jsonRequest(`/api/training/session-attendance/${person.attendance!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: attendanceStatus, version: person.attendance!.version, reason }) });
      }
      setSelectedParticipantIds([]);
      setToast(`已批量更新 ${people.length} 人签到状态`);
      await Promise.all([loadLive(selectedSessionId, true), load(true)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批量签到失败'); } finally { setSaving(false); }
  }

  async function openQrWindow(purpose: 'CHECK_IN' | 'FEEDBACK') {
    if (!selectedSessionId) return;
    if (purpose === 'FEEDBACK' && !window.confirm('确认结束本课并开放课后反馈吗？签到二维码将关闭，仍未签到人员会标记为缺勤；后续可填写原因进行人工纠正。')) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/sessions/${selectedSessionId}/qr-windows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose }),
      });
      setToast(purpose === 'CHECK_IN' ? '签到二维码已开放' : '本课已结束，课后反馈二维码已开放');
      await Promise.all([loadLive(selectedSessionId), load(true)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '二维码开放失败'); } finally { setSaving(false); }
  }

  async function closeQrWindow(windowId: string) {
    if (!window.confirm('确认关闭当前二维码吗？关闭后不能继续扫码，但已产生的签到或反馈不会删除。')) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/qr-windows/${windowId}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setToast('二维码已关闭，历史记录保持不变');
      await loadLive(selectedSessionId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '二维码关闭失败'); } finally { setSaving(false); }
  }

  async function rotateQrWindow(windowId: string) {
    if (!window.confirm('确认重新生成二维码吗？当前二维码会立即作废，已完成的签到和反馈不会删除。')) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/qr-windows/${windowId}/rotate`, { method: 'POST' });
      setToast('新二维码已生成，旧二维码已经作废');
      await loadLive(selectedSessionId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '二维码重新生成失败'); } finally { setSaving(false); }
  }

  async function checkAccountReadiness(plan: TrainingPlan) {
    setSaving(true);
    try {
      const response = await fetch(`/api/training/plans/${plan.id}/account-readiness`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as { data?: { readyCount: number; blockedCount: number; participants: Array<{ employeeName: string; issue: string | null }> }; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || '参训账号检查失败');
      if (!body.data.blockedCount) setToast(`账号检查通过：${body.data.readyCount} 名参训员工均可使用个人账号`);
      else setError(`有 ${body.data.blockedCount} 名员工账号异常：${body.data.participants.filter(item => item.issue).slice(0, 4).map(item => `${item.employeeName}（${item.issue}）`).join('、')}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '参训账号检查失败'); } finally { setSaving(false); }
  }

  async function saveParticipantResult(event: React.FormEvent) {
    event.preventDefault();
    if (!participantDraft) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/participants/${participantDraft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_result', version: participantDraft.version, theoryScore: participantDraft.theoryScore, practicalScore: participantDraft.practicalScore }) });
      setDrawer(null);
      setParticipantDraft(null);
      setToast('成绩已提交分项审核');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '成绩保存失败'); } finally { setSaving(false); }
  }

  async function reviewParticipant(plan: TrainingPlan, person: TrainingParticipant, action: 'approve' | 'return') {
    const comment = action === 'return' ? window.prompt('请输入退回修改意见')?.trim() : window.prompt('审核说明（选填）')?.trim();
    if (action === 'return' && !comment) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/participants/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: person.version, reviewComment: comment || '' }) });
      setToast(action === 'approve' ? `${person.employeeName} 已审核；符合条件的技能证书已同步` : `${person.employeeName} 已退回修改`);
      setSelectedPlanId(plan.id);
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审核失败'); } finally { setSaving(false); }
  }

  async function uploadAttachment(file: File) {
    if (!selectedPlan) return;
    setSaving(true);
    const form = new FormData();
    form.set('file', file);
    form.set('kind', file.type.startsWith('image/') ? 'PHOTO' : 'COURSE_MATERIAL');
    try {
      const response = await fetch(`/api/training/plans/${selectedPlan.id}/attachments`, { method: 'POST', body: form });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '附件上传失败');
      setToast('培训资料已上传到对象存储');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '附件上传失败'); } finally { setSaving(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  const navigation: Array<{ id: ViewKey; label: string; icon: typeof GraduationCap; count?: number }> = [
    { id: 'overview', label: '培训总览', icon: BarChart3 },
    { id: 'courses', label: '课程库', icon: BookOpenCheck, count: data?.courses.length },
    { id: 'plans', label: '计划管理', icon: CalendarDays, count: data?.plans.length },
    { id: 'execution', label: '签到与考核', icon: UserCheck, count: data?.summary.activePlanCount },
    { id: 'review', label: '分项审核', icon: ClipboardCheck, count: pendingReviews.length },
    { id: 'records', label: '培训档案', icon: FileCheck2, count: completedRecords.length },
    { id: 'retraining', label: '到期复训', icon: Award, count: data?.expiringCertifications.length },
    { id: 'reports', label: '台账导出', icon: Download },
  ];

  if (loading && !data) return <div className="td-loading"><Loader2 className="spin" />正在加载培训发展台账</div>;
  if (!data) return <div className="td-fatal"><AlertCircle /><strong>{error || '培训发展数据不可用'}</strong><button type="button" onClick={() => void load()}>重新加载</button></div>;

  function planCard(plan: TrainingPlan) {
    const recordState = plan.deletedAt ? '回收站' : plan.archivedAt ? '已归档' : statusLabel(plan.status);
    return (
      <button type="button" key={plan.id} className={`td-plan-card ${selectedPlanId === plan.id ? 'active' : ''} ${plan.archivedAt ? 'archived' : ''} ${plan.deletedAt ? 'deleted' : ''}`} onClick={() => setSelectedPlanId(plan.id)}>
        <span className={`td-status-dot ${plan.status.toLowerCase()}`} />
        <div><small>{plan.code} · {recordState}</small><strong>{plan.title}</strong><p>{fmtDate(plan.startAt)} · {plan.trainerName || '讲师待定'} · {plan.summary.participantCount} 人</p></div>
        <em>{plan.summary.attendanceRate}%<small>到课</small></em><ChevronRight />
      </button>
    );
  }

  function renderPlanDetail(plan: TrainingPlan) {
    const nextSession = plan.sessions.find(session => session.status === 'SCHEDULED') || null;
    const isLockedRecord = Boolean(plan.archivedAt || plan.deletedAt);
    return (
      <section className="td-plan-detail">
        <header><div><span>{plan.deletedAt ? '回收站草稿' : plan.archivedAt ? `${statusLabel(plan.status)} · 已归档` : statusLabel(plan.status)}</span><h2>{plan.title}</h2><p>{plan.code} · {plan.course?.name || '临时培训'} · {modeLabel(plan.mode)}</p></div><div className="td-plan-actions">
          {plan.deletedAt && data!.permissions.canDelete && <button type="button" className="primary" disabled={saving} onClick={() => void openPlanLifecycleDialog('restore', plan)}><ArchiveRestore />恢复草稿</button>}
          {!plan.deletedAt && plan.status === 'COMPLETED' && <button type="button" disabled={exportBusy} onClick={() => void exportLedger(plan.id)}><Download />导出本计划台账</button>}
          {data!.permissions.canPermanentDelete && <button type="button" className="danger" disabled={saving} onClick={() => void openPlanLifecycleDialog('purge', plan)}><Trash2 />永久删除</button>}
          {plan.archivedAt && data!.permissions.canExecute && <button type="button" disabled={saving} onClick={() => void openPlanLifecycleDialog('unarchive', plan)}><ArchiveRestore />取消归档</button>}
          {!isLockedRecord && ['DRAFT', 'PUBLISHED'].includes(plan.status) && data!.permissions.canUpdate && <button type="button" disabled={saving} onClick={() => openEditPlan(plan)}><PencilLine />{plan.status === 'PUBLISHED' ? '变更计划' : '编辑草稿'}</button>}
          {!isLockedRecord && plan.status === 'DRAFT' && data!.permissions.canDelete && <button type="button" className="danger" disabled={saving} onClick={() => void openPlanLifecycleDialog('delete', plan)}><Trash2 />删除草稿</button>}
          {!isLockedRecord && ['DRAFT', 'PUBLISHED'].includes(plan.status) && <button type="button" disabled={saving} onClick={() => void checkAccountReadiness(plan)}><UserCheck />账号检查</button>}
          {!isLockedRecord && plan.status === 'DRAFT' && <button type="button" className="primary" disabled={saving} onClick={() => void transition('publish')}><Send />发布</button>}
          {!isLockedRecord && nextSession && ['PUBLISHED', 'IN_PROGRESS'].includes(plan.status) && <button type="button" className="primary" disabled={saving} onClick={() => void startSession(nextSession.id, nextSession.version)}><Play />{plan.status === 'PUBLISHED' ? '开始首课' : '开始下一课次'}</button>}
          {!isLockedRecord && plan.status === 'IN_PROGRESS' && <button type="button" className="primary" disabled={saving} onClick={() => void transition(plan.assessmentMode === 'NONE' ? 'complete' : 'submit_review')}><ClipboardCheck />{plan.assessmentMode === 'NONE' ? '完成培训' : '提交审核'}</button>}
          {!isLockedRecord && plan.status === 'PENDING_REVIEW' && <button type="button" className="primary" disabled={saving || plan.summary.pendingReviewCount > 0} onClick={() => void transition('complete')}><CheckCircle2 />完成培训</button>}
          {!isLockedRecord && !['COMPLETED', 'CANCELLED'].includes(plan.status) && <button type="button" disabled={saving} onClick={() => void transition('cancel')}>取消计划</button>}
          {!isLockedRecord && ['COMPLETED', 'CANCELLED'].includes(plan.status) && data!.permissions.canExecute && <button type="button" className="primary" disabled={saving} onClick={() => void openPlanLifecycleDialog('archive', plan)}><Archive />归档计划</button>}
        </div></header>
        {plan.archivedAt && <div className="td-record-banner archived"><Archive /><span><strong>该计划已归档</strong><small>{fmtDate(plan.archivedAt)} · {plan.archiveReason || '未填写归档说明'}；员工培训档案、签到、反馈、附件和审计记录均保留。</small></span></div>}
        {plan.deletedAt && <div className="td-record-banner deleted"><Trash2 /><span><strong>该草稿位于回收站</strong><small>{fmtDate(plan.deletedAt)} · {plan.deleteReason || '未填写删除原因'}；当前不参与计划执行，可按计划编号恢复。</small></span></div>}
        <div className="td-detail-metrics"><article><span>计划时间</span><strong>{fmtDate(plan.startAt)} — {fmtDate(plan.endAt)}</strong></article><article><span>地点 / 方式</span><strong>{plan.location || '地点待定'} · {modeLabel(plan.mode)}</strong></article><article><span>讲师 / 审核</span><strong>{plan.trainerName || '待定'} / {plan.reviewerName || '待定'}</strong></article><article><span>考核规则</span><strong>{assessmentLabel(plan.assessmentMode)}{plan.passScore !== null ? ` · ${plan.passScore} 分` : ''}</strong></article></div>
        <div className="td-progress-pair"><div><span>到课率 <b>{plan.summary.attendanceRate}%</b></span><i><b style={{ width: `${plan.summary.attendanceRate}%` }} /></i></div><div><span>{plan.assessmentMode === 'NONE' ? '考核规则' : '合格率'} <b>{plan.summary.passRate === null ? '无需考核' : `${plan.summary.passRate}%`}</b></span><i><b className="green" style={{ width: `${plan.summary.passRate ?? 100}%` }} /></i></div></div>
        <div className="td-detail-grid"><article><span>参训人员</span><strong>{plan.summary.participantCount}</strong><small>已到 {plan.summary.attendedCount} 人</small></article><article><span>待审核</span><strong>{plan.summary.pendingReviewCount}</strong><small>低于合格线 {plan.summary.belowPassCount} 人</small></article><article><span>课程资料</span><strong>{plan.attachments.length}</strong><small>对象存储附件</small></article><article><span>技能联动</span><strong>{plan.participants.filter(item => item.certificationId).length}</strong><small>已同步正式证书</small></article></div>
        <section className="td-attachment-zone"><header><div><strong>培训资料与现场证据</strong><small>PDF、图片、Office、MP4；文件存储在对象存储</small></div>{data!.permissions.canUpdate && !isLockedRecord && <><input ref={fileInputRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.mp4" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); }} /><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Upload />上传资料</button></>}</header><div>{plan.attachments.map(file => <a key={file.id} href={file.contentUrl} target="_blank" rel="noreferrer"><FileText /><span><strong>{file.name}</strong><small>{file.kind} · {(file.size / 1024).toFixed(1)} KB</small></span><ArrowRight /></a>)}{!plan.attachments.length && <p><Paperclip />尚未上传资料，可在执行前补充课件、签到表或现场照片。</p>}</div></section>
        <section className="td-activity"><header><strong>最近动态</strong><small>{plan.activities.length} 条</small></header><div>{plan.activities.slice(0, 6).map(item => <article key={item.id}><i /><span><strong>{item.content || item.action}</strong><small>{fmtDate(item.createdAt)}</small></span></article>)}</div></section>
      </section>
    );
  }

  function renderExecution(plan: TrainingPlan | null) {
    if (!plan) return <div className="td-empty"><GraduationCap /><strong>尚无培训计划</strong><p>先在计划管理中创建培训计划。</p></div>;
    const currentSession = plan.sessions.find(session => session.id === selectedSessionId) || plan.sessions[0] || null;
    const currentLive = live?.session.id === currentSession?.id ? live : null;
    const people = currentLive?.participants || [];
    const allSelected = people.length > 0 && people.every(person => selectedParticipantIds.includes(person.id));
    const checkInWindow = currentLive?.windows.find(window => window.purpose === 'CHECK_IN' && ['SCHEDULED', 'OPEN'].includes(window.status)) || null;
    const feedbackWindow = currentLive?.windows.find(window => window.purpose === 'FEEDBACK' && ['SCHEDULED', 'OPEN'].includes(window.status)) || null;
    const shownWindow = feedbackWindow || checkInWindow;
    return <div className="td-execution td-live-execution">
      <header className="td-section-title td-live-header"><div><span>现场执行</span><h2>{plan.title}</h2><p>{fmtDate(currentSession?.startAt || plan.startAt)} · {currentSession?.location || plan.location || '地点待定'} · {assessmentLabel(plan.assessmentMode)}</p></div><div className="td-live-selectors"><select value={plan.id} onChange={event => { setSelectedPlanId(event.target.value); setSelectedParticipantIds([]); setLive(null); }}>{data!.plans.filter(item => !['COMPLETED', 'CANCELLED'].includes(item.status)).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select><select value={currentSession?.id || ''} onChange={event => { setSelectedSessionId(event.target.value); setSelectedParticipantIds([]); setLive(null); }}>{plan.sessions.map(session => <option value={session.id} key={session.id}>第 {session.sequence} 课次 · {session.name}</option>)}</select></div></header>

      {currentLive && <section className="td-live-metrics">
        <article><span>应到</span><strong>{currentLive.summary.participantCount}</strong><small>个人账号参训</small></article>
        <article className="green"><span>已到</span><strong>{currentLive.summary.presentCount + currentLive.summary.lateCount}</strong><small>正常 {currentLive.summary.presentCount} · 迟到 {currentLive.summary.lateCount}</small></article>
        <article className="amber"><span>未处理</span><strong>{currentLive.summary.invitedCount}</strong><small>缺勤 {currentLive.summary.absentCount} · 请假 {currentLive.summary.leaveCount}</small></article>
        <article className="blue"><span>反馈</span><strong>{currentLive.summary.feedbackRate}%</strong><small>{currentLive.summary.feedbackCount}/{currentLive.summary.feedbackEligibleCount} 份 · 待跟进 {currentLive.summary.followUpCount}</small></article>
        <article className="violet"><span>综合评分</span><strong>{currentLive.summary.averageOverallRating ?? '—'}</strong><small>内容 {currentLive.summary.averageContentRating ?? '—'} · 讲师 {currentLive.summary.averageTrainerRating ?? '—'}</small></article>
      </section>}

      {selectedParticipantIds.length > 0 && <div className="td-batch-bar"><strong>已选 {selectedParticipantIds.length} 人</strong><button type="button" disabled={saving} onClick={() => void batchAttendance('PRESENT')}>批量到场</button><button type="button" disabled={saving} onClick={() => void batchAttendance('ABSENT')}>批量缺勤</button><button type="button" disabled={saving} onClick={() => void batchAttendance('LEAVE')}>批量请假</button><button type="button" onClick={() => setSelectedParticipantIds([])}>取消选择</button></div>}

      <div className="td-live-workspace">
        <section className="td-live-roster">
          {liveLoading && !currentLive ? <div className="td-loading compact"><Loader2 className="spin" />正在读取现场数据</div> : <div className="td-table-wrap"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={event => setSelectedParticipantIds(event.target.checked ? people.map(item => item.id) : [])} /></th><th>参训人员</th><th>账号</th><th>课次出勤</th><th>课后反馈</th><th>考核</th></tr></thead><tbody>{people.map(person => {
            const planPerson = plan.participants.find(item => item.id === person.id);
            return <tr key={person.id}><td><input type="checkbox" checked={selectedParticipantIds.includes(person.id)} onChange={event => setSelectedParticipantIds(current => event.target.checked ? [...new Set([...current, person.id])] : current.filter(id => id !== person.id))} /></td><td><strong>{person.employeeName}</strong><small>{person.employeeNo} · {person.position || '岗位待维护'}</small><small>{person.department || '未分组'} / {person.team || '班组未设置'}</small></td><td><span className={`td-account-state ${person.accountReady ? 'ready' : 'blocked'}`}>{person.accountReady ? '可扫码' : '账号异常'}</span></td><td><select className={`td-attendance-select ${(person.attendance?.status || 'INVITED').toLowerCase()}`} value={person.attendance?.status || 'INVITED'} disabled={saving || !person.attendance} onChange={event => void updateAttendance(person, event.target.value)}><option value="INVITED">未签到</option><option value="PRESENT">已到场</option><option value="LATE">迟到</option><option value="LEAVE">请假</option><option value="ABSENT">缺勤</option></select><small>{fmtDate(person.attendance?.checkInAt)}</small>{person.attendance?.correctionReason && <small title={person.attendance.correctionReason}>人工：{person.attendance.correctionReason}</small>}</td><td>{person.feedback ? <><span className="td-feedback-done"><MessageSquareText />已提交 · {person.feedback.overallRating}分</span><small>{person.feedback.followUpRequested ? '需要跟进' : fmtDate(person.feedback.updatedAt)}</small></> : <span className="td-pill invited">未提交</span>}</td><td>{planPerson ? <><strong>{planPerson.score ?? '—'}</strong><small>{planPerson.result === 'PENDING' ? assessmentLabel(plan.assessmentMode) : statusLabel(planPerson.result)}</small>{plan.assessmentMode !== 'NONE' && ['PRESENT', 'LATE'].includes(planPerson.attendanceStatus) && <button type="button" className="td-inline-action" onClick={() => { setParticipantDraft({ id: planPerson.id, employeeName: planPerson.employeeName, version: planPerson.version, theoryScore: String(planPerson.theoryScore ?? ''), practicalScore: String(planPerson.practicalScore ?? ''), reviewComment: '' }); setDrawer('participant'); }}><PencilLine />录分</button>}</> : '—'}</td></tr>;
          })}{!people.length && <tr><td colSpan={6}><div className="td-empty compact"><UsersRound /><strong>当前课次没有参训人员</strong></div></td></tr>}</tbody></table></div>}
        </section>

        <aside className="td-qr-console" ref={qrPanelRef}>
          <header><div><span><QrCode /></span><div><small>{shownWindow?.purpose === 'FEEDBACK' ? '课后反馈二维码' : '课前签到二维码'}</small><strong>{shownWindow ? `${shownWindow.status === 'SCHEDULED' ? '等待开放' : '正在开放'} · 第 ${shownWindow.generation} 代` : '二维码未开放'}</strong></div></div>{shownWindow && <em className={shownWindow.status.toLowerCase()}>{statusLabel(shownWindow.status)}</em>}</header>
          {shownWindow && qrDataUrl ? <div className="td-qr-image"><Image unoptimized priority width={320} height={320} src={qrDataUrl} alt={`${shownWindow.purpose === 'CHECK_IN' ? '培训签到' : '课后反馈'}二维码`} /><strong>{plan.title}</strong><span>{currentSession?.name}</span><small>{shownWindow.status === 'SCHEDULED' ? `开放：${fmtDate(shownWindow.opensAt)}` : `截止：${fmtDate(shownWindow.expiresAt)}`}</small></div> : <div className="td-qr-empty"><QrCode /><strong>尚未生成现场二维码</strong><p>签到码用于开课前确认身份；反馈码会在结束本课后开放。</p></div>}
          <div className="td-qr-flow"><span className={checkInWindow ? 'active' : currentSession?.status === 'COMPLETED' ? 'done' : ''}><i>1</i><b>签到</b></span><i /><span className={currentSession?.status === 'IN_PROGRESS' ? 'active' : currentSession?.status === 'COMPLETED' ? 'done' : ''}><i>2</i><b>授课</b></span><i /><span className={feedbackWindow ? 'active' : ''}><i>3</i><b>反馈</b></span></div>
          <div className="td-qr-actions">
            {!checkInWindow && currentSession?.status !== 'COMPLETED' && ['PUBLISHED', 'IN_PROGRESS'].includes(plan.status) && <button type="button" className="primary" disabled={saving} onClick={() => void openQrWindow('CHECK_IN')}><QrCode />开放签到</button>}
            {currentSession?.status === 'SCHEDULED' && ['PUBLISHED', 'IN_PROGRESS'].includes(plan.status) && <button type="button" className="primary" disabled={saving} onClick={() => void startSession(currentSession.id, currentSession.version)}><Play />开始本课</button>}
            {!feedbackWindow && ['IN_PROGRESS', 'COMPLETED'].includes(currentSession?.status || '') && ['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED'].includes(plan.status) && <button type="button" className="primary" disabled={saving} onClick={() => void openQrWindow('FEEDBACK')}><MessageSquareText />结束本课并开放反馈</button>}
            {shownWindow && <><button type="button" disabled={saving} onClick={() => void qrPanelRef.current?.requestFullscreen()}><Maximize2 />全屏</button><button type="button" disabled={saving} onClick={() => window.print()}><Printer />打印</button><button type="button" disabled={saving} onClick={() => void rotateQrWindow(shownWindow.id)}><RotateCw />重新生成</button><button type="button" disabled={saving} onClick={() => void closeQrWindow(shownWindow.id)}><LockKeyhole />关闭</button></>}
            <button type="button" disabled={liveLoading} onClick={() => void loadLive(selectedSessionId)}><RefreshCw className={liveLoading ? 'spin' : ''} />刷新现场</button>
          </div>
          <p className="td-qr-note">签到默认提前 {currentSession?.checkInOpenMinutes ?? 30} 分钟开放，开课后 {currentSession?.checkInCloseMinutes ?? 15} 分钟截止，{currentSession?.lateAfterMinutes ?? 5} 分钟起记迟到；反馈开放 {currentSession?.feedbackDeadlineHours ?? 24} 小时。员工身份来自当前个人账号，反馈不会自动生成签退，也不会改变成绩或证书。</p>
        </aside>
      </div>
    </div>;
  }

  return <div className="td-workbench">
    <header className="td-hero"><div className="td-hero-title"><span><GraduationCap /></span><div><small>人事管理 · 能力发展</small><h1>培训发展中心</h1><p>课程、计划、签到、考核、审核、技能证书与复训提醒形成一条真实数据链。</p></div></div><div className="td-hero-actions"><button type="button" title="刷新" onClick={() => void load()}><RefreshCw /></button>{data.permissions.canCreate && <button type="button" onClick={() => setDrawer('course')}><BookOpenCheck />新建课程</button>}{data.permissions.canCreate && <button type="button" className="primary" onClick={() => openCreatePlan()}><Plus />新建计划</button>}</div></header>
    <nav className="td-nav">{navigation.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon /><span>{item.label}</span>{typeof item.count === 'number' && <em>{item.count}</em>}</button>; })}</nav>
    {error && <div className="td-error"><AlertCircle />{error}<button type="button" onClick={() => setError('')}>关闭</button></div>}

    {view === 'overview' && <div className="td-page"><section className="td-kpis"><article className="orange"><BookOpenCheck /><span><small>有效课程</small><strong>{data.summary.activeCourseCount}</strong><em>标准化课程库</em></span></article><article className="blue"><CalendarDays /><span><small>待开展计划</small><strong>{data.summary.upcomingPlanCount}</strong><em>进行中 {data.summary.activePlanCount}</em></span></article><article className="violet"><ClipboardCheck /><span><small>待分项审核</small><strong>{data.summary.pendingReviewCount}</strong><em>成绩必须审核后入档</em></span></article><article className="green"><UserCheck /><span><small>综合到课率</small><strong>{data.summary.attendanceRate}%</strong><em>{data.summary.participantCount} 人次</em></span></article><article className="amber"><Award /><span><small>到期复训</small><strong>{data.expiringCertifications.length}</strong><em>未来 90 天</em></span></article></section>
      <div className="td-overview-grid"><section className="td-panel td-overview-plans"><header className="td-section-title"><div><span>近期计划</span><h2>培训执行节奏</h2></div><button type="button" onClick={() => setView('plans')}>查看全部<ArrowRight /></button></header><div>{currentPlans.filter(plan => ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(plan.status)).slice(0, 6).map(planCard)}{!currentPlans.length && <div className="td-empty compact"><CalendarDays /><strong>尚无培训计划</strong><button type="button" onClick={() => openCreatePlan()}>建立第一条计划</button></div>}</div></section>
        <section className="td-panel td-radar"><header className="td-section-title"><div><span>质量门禁</span><h2>审核与复训预警</h2></div></header><div className="td-radar-ring"><strong>{data.summary.passRate === null ? '—' : `${data.summary.passRate}%`}</strong><span>{data.summary.passRate === null ? '暂无需考核样本' : '已审核合格率'}</span></div><div className="td-risk-list"><button type="button" onClick={() => setView('review')}><span className="red"><ClipboardCheck /></span><div><strong>{data.summary.pendingReviewCount} 项待审核</strong><small>审核通过后才进入正式技能资料</small></div><ChevronRight /></button><button type="button" onClick={() => setView('retraining')}><span className="amber"><Award /></span><div><strong>{data.expiringCertifications.length} 项到期提醒</strong><small>证书到期前可一键创建复训计划</small></div><ChevronRight /></button><button type="button" onClick={() => setView('reports')}><span className="blue"><Download /></span><div><strong>培训台账可追溯导出</strong><small>北京时间、员工、签到、学时、成绩和审核一行呈现</small></div><ChevronRight /></button></div></section></div>
      <section className="td-panel td-course-strip"><header className="td-section-title"><div><span>课程库</span><h2>岗位能力课程</h2></div><button type="button" onClick={() => setView('courses')}>管理课程<ArrowRight /></button></header><div>{data.courses.slice(0, 5).map(course => <article key={course.id}><span><BookOpenCheck /></span><div><small>{course.category} · {course.code}</small><strong>{course.name}</strong><p>{course.targetAudience || '适用对象待补充'}</p></div><em>{assessmentLabel(course.assessmentMode)}</em></article>)}</div></section></div>}

    {view === 'courses' && <div className="td-page"><section className="td-toolbar"><div><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索课程名称、分类或技能" /></div><span>{data.courses.length} 门真实课程</span>{data.permissions.canCreate && <button type="button" className="primary" onClick={() => setDrawer('course')}><Plus />新建课程</button>}</section><section className="td-course-grid">{data.courses.filter(course => !keyword || [course.name, course.code, course.category, course.skill?.name].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword.toLocaleLowerCase('zh-CN')))).map(course => <article key={course.id}><header><span><BookOpenCheck /></span><div><small>{course.category} · {course.code}</small><h2>{course.name}</h2></div><em>{course.status === 'ACTIVE' ? '启用' : '停用'}</em></header><p>{course.objective || course.description || '课程目标待补充'}</p><dl><div><dt>适用对象</dt><dd>{course.targetAudience || '待设置'}</dd></div><div><dt>培训规则</dt><dd>{course.defaultDurationMinutes} 分钟 · {modeLabel(course.mode)}</dd></div><div><dt>考核</dt><dd>{assessmentLabel(course.assessmentMode)}{course.passScore !== null ? ` · ${course.passScore}分` : ''}</dd></div><div><dt>技能联动</dt><dd>{course.skill ? `${course.skill.name} · L${course.targetLevel || 1}` : '不关联技能证书'}</dd></div></dl><footer><span>{course.isRequired ? '必修' : '选修'} · {course.retrainingMonths ? `${course.retrainingMonths}个月复训` : '无复训周期'}</span><button type="button" onClick={() => openCreatePlan({ courseId: course.id, title: course.name, purpose: course.objective || '', mode: course.mode, isRequired: course.isRequired, assessmentMode: course.assessmentMode, passScore: String(course.passScore ?? 80) })}>据此建计划<ArrowRight /></button></footer></article>)}</section></div>}

    {view === 'plans' && <div className="td-page td-plan-workspace"><aside className="td-plan-list"><header><div><span>计划管理</span><strong>{visiblePlans.length}</strong></div>{data.permissions.canCreate && <button type="button" onClick={() => openCreatePlan()}><Plus /></button>}</header><nav className="td-plan-filters">{([
      ['active', '待处理'], ['completed', '已完成'], ['cancelled', '已取消'], ['archived', '已归档'], ['deleted', '回收站'],
    ] as Array<[PlanViewKey, string]>).map(([key, label]) => <button type="button" key={key} className={planView === key ? 'active' : ''} onClick={() => { setPlanView(key); const first = key === 'deleted' ? data.deletedPlans?.[0] : key === 'archived' ? data.plans.find(plan => plan.archivedAt) : key === 'completed' ? data.plans.find(plan => !plan.archivedAt && plan.status === 'COMPLETED') : key === 'cancelled' ? data.plans.find(plan => !plan.archivedAt && plan.status === 'CANCELLED') : data.plans.find(plan => !plan.archivedAt && ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(plan.status)); setSelectedPlanId(first?.id || ''); }}>{label}</button>)}</nav><div>{visiblePlans.map(planCard)}{!visiblePlans.length && <div className="td-empty compact"><CalendarDays /><strong>当前分类没有计划</strong></div>}</div></aside>{selectedPlan && visiblePlans.some(plan => plan.id === selectedPlan.id) ? renderPlanDetail(selectedPlan) : <div className="td-empty"><CalendarDays /><strong>请选择培训计划</strong></div>}</div>}

    {view === 'execution' && <div className="td-page td-panel">{renderExecution(selectedPlan && !selectedPlan.archivedAt && !selectedPlan.deletedAt ? selectedPlan : data.plans.find(plan => !plan.archivedAt && ['PUBLISHED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(plan.status)) || null)}</div>}

    {view === 'review' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>质量门禁</span><h2>培训成绩分项审核</h2><p>只有审核通过的数据才能同步为正式技能证书。</p></div><em>{pendingReviews.length} 项待审核</em></header><section className="td-review-list">{pendingReviews.map(({ plan, person }) => <article key={person.id}><div className="td-avatar">{person.employeeName.slice(0, 1)}</div><div><small>{plan.code} · {plan.title}</small><strong>{person.employeeName} · {person.employeeNo}</strong><p>{person.department || '未分组'} / {person.team || '未分组'} · {assessmentLabel(plan.assessmentMode)}</p></div><div className="td-score"><span>理论 <b>{person.theoryScore ?? '—'}</b></span><span>实操 <b>{person.practicalScore ?? '—'}</b></span><strong>{person.score ?? '—'}<small>综合</small></strong></div><div className="td-review-actions"><button type="button" disabled={saving} onClick={() => void reviewParticipant(plan, person, 'return')}>退回</button><button type="button" className="primary" disabled={saving} onClick={() => void reviewParticipant(plan, person, 'approve')}><ShieldCheck />审核通过</button></div></article>)}{!pendingReviews.length && <div className="td-empty"><CheckCircle2 /><strong>当前没有待审核成绩</strong><p>培训执行录分后，审核任务会在这里汇总。</p></div>}</section></div>}

    {view === 'records' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>正式档案</span><h2>员工培训与认证记录</h2><p>保留计划快照、签到、成绩、审核和技能证书关联；无需考核的到课记录也会正式入档。</p></div><button type="button" onClick={() => setView('reports')}><Download />导出台账</button></header><div className="td-table-wrap td-record-table"><table><thead><tr><th>员工</th><th>培训计划 / 课程</th><th>培训日期</th><th>到课</th><th>成绩</th><th>审核</th><th>技能证书</th></tr></thead><tbody>{completedRecords.map(({ plan, person }) => <tr key={`${plan.id}-${person.id}`}><td><strong>{person.employeeName}</strong><small>{person.employeeNo} · {person.department || '未分组'}</small></td><td><strong>{plan.title}</strong><small>{plan.course?.name || '临时培训'} · {plan.code}{plan.archivedAt ? ' · 已归档' : ''}</small></td><td>{fmtDate(plan.startAt)}</td><td><span className={`td-pill ${person.attendanceStatus.toLowerCase()}`}>{statusLabel(person.attendanceStatus)}</span></td><td><strong>{plan.assessmentMode === 'NONE' ? '无需考核' : person.score ?? '—'}</strong><small>{plan.assessmentMode === 'NONE' ? '完成培训' : statusLabel(person.result)}</small></td><td><span className={`td-pill ${person.reviewStatus.toLowerCase()}`}>{plan.assessmentMode === 'NONE' ? '无需审核' : statusLabel(person.reviewStatus)}</span></td><td>{person.certificationId ? <span className="td-certificate"><Award />已同步</span> : '—'}</td></tr>)}</tbody></table></div></div>}

    {view === 'retraining' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>有效期管理</span><h2>到期复训与证书续期</h2><p>展示已到期及未来 90 天内到期的正式技能证书。</p></div><em>{data.expiringCertifications.length} 项</em></header><section className="td-retraining-grid">{data.expiringCertifications.map(item => <article key={item.id} className={item.expired ? 'expired' : ''}><span><Award /></span><div><small>{item.employeeNo} · {item.department || '未分组'} / {item.team || '未分组'}</small><strong>{item.employeeName}</strong><p>{item.skillName} · L{item.level}</p></div><div><em>{item.expired ? '已到期' : '即将到期'}</em><strong>{item.expiresAt || '—'}</strong></div><button type="button" onClick={() => { const course = data.courses.find(course => course.skillId && course.skill?.name === item.skillName); openCreatePlan({ title: `${item.skillName}复训`, courseId: course?.id || '', participantIds: [item.employeeId], assessmentMode: course?.assessmentMode || 'COMBINED', passScore: String(course?.passScore || 80), mode: course?.mode || 'OFFLINE', isRequired: true }); }}>创建复训<ChevronRight /></button></article>)}{!data.expiringCertifications.length && <div className="td-empty"><Award /><strong>未来 90 天没有到期证书</strong><p>关联技能的培训审核通过后会进入有效期管理。</p></div>}</section></div>}

    {view === 'reports' && <div className="td-page"><section className="td-panel td-ledger-panel">
      <header><div><span>普通 Excel · 1 个文件 / 1 张工作表</span><h2>培训台账导出</h2><p>按计划开始日期筛选，结束日期包含当天全天，统一北京时间。仅纳入已完成的培训（含已归档），不纳入取消、草稿或回收站记录。</p></div></header>
      <form onSubmit={event => { event.preventDefault(); void exportLedger(); }}>
        <div className="td-ledger-form">
          <label>开始日期（北京时间）<input type="date" required value={exportRange.start} onChange={event => { setExportRange(current => ({ ...current, start: event.target.value })); setExportPreview(null); }} /></label>
          <label>结束日期（含当天）<input type="date" required min={exportRange.start} value={exportRange.end} onChange={event => { setExportRange(current => ({ ...current, end: event.target.value })); setExportPreview(null); }} /></label>
          <label>培训名称 / 计划编号<input value={exportFilters.planKeyword} placeholder="全部培训" onChange={event => { setExportFilters(current => ({ ...current, planKeyword: event.target.value })); setExportPreview(null); }} /></label>
          <label>部门<input list="training-ledger-departments" value={exportFilters.department} placeholder="全部部门" onChange={event => { setExportFilters(current => ({ ...current, department: event.target.value })); setExportPreview(null); }} /><datalist id="training-ledger-departments">{[...new Set(data.employees.map(person => person.department).filter(Boolean))].map(name => <option key={name} value={name!} />)}</datalist></label>
          <label>员工姓名 / 工号<input value={exportFilters.employee} placeholder="全部员工" onChange={event => { setExportFilters(current => ({ ...current, employee: event.target.value })); setExportPreview(null); }} /></label>
        </div>
        <div className="td-ledger-actions"><button type="button" disabled={exportBusy || !exportRange.start || !exportRange.end} onClick={() => void exportLedger(undefined, true)}><Search />核对导出范围</button><button type="submit" className="primary" disabled={exportBusy}>{exportBusy ? <Loader2 className="spin" /> : <Download />}导出 Excel 台账</button></div>
      </form>
      {exportPreview && <div className="td-ledger-summary" role="status"><strong>{exportPreview.planCount} 个计划 · {exportPreview.rowCount} 条明细 · {exportPreview.employeeCount} 位员工</strong><span>{exportPreview.rowCount ? '按当前筛选条件导出；每位员工每次培训一行。' : '当前范围没有记录，导出文件仅包含表头。'}</span></div>}
      <div className="td-ledger-help"><strong>时间和结果按真实记录填写</strong><p>计划开始/结束时间与实际参训学时分开显示；未记录的成绩和学时留空，缺席不会标记为培训完成。工号保留前导零，表头可筛选、冻结，无封面和额外工作表。</p></div>
    </section></div>}

    {drawer && <div className="td-drawer-backdrop" role="presentation"><aside className="td-drawer" role="dialog" aria-modal="true"><header><div><span>{drawer === 'course' ? '课程标准' : drawer === 'plan' ? '培训安排' : '考核录分'}</span><h2>{drawer === 'course' ? '新建培训课程' : drawer === 'plan' ? editingPlan ? (editingPlan.status === 'PUBLISHED' ? '变更已发布计划' : '编辑培训计划草稿') : '新建培训计划' : `${participantDraft?.employeeName || ''} · 录入成绩`}</h2></div><button type="button" onClick={() => { setDrawer(null); setParticipantDraft(null); setEditingPlanId(''); setPendingPlanPayload(null); }}><X /></button></header>
      {drawer === 'course' && <form className="td-form" onSubmit={submitCourse}><div className="td-form-scroll"><section><strong>课程基础</strong><div className="td-form-grid"><label className="wide">课程名称<input required value={courseDraft.name} onChange={event => setCourseDraft({ ...courseDraft, name: event.target.value })} placeholder="如：全自动压接机安全与操作" /></label><label>课程分类<input value={courseDraft.category} onChange={event => setCourseDraft({ ...courseDraft, category: event.target.value })} /></label><label>培训方式<select value={courseDraft.mode} onChange={event => setCourseDraft({ ...courseDraft, mode: event.target.value })}><option value="OFFLINE">线下</option><option value="ONLINE">线上</option><option value="BLENDED">混合</option></select></label><label>默认时长（分钟）<input type="number" min="1" max="1440" value={courseDraft.defaultDurationMinutes} onChange={event => setCourseDraft({ ...courseDraft, defaultDurationMinutes: event.target.value })} /></label><label>课程负责人<select value={courseDraft.ownerEmployeeId} onChange={event => setCourseDraft({ ...courseDraft, ownerEmployeeId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label className="wide">课程目标<textarea value={courseDraft.objective} onChange={event => setCourseDraft({ ...courseDraft, objective: event.target.value })} placeholder="完成后应掌握什么" /></label><label className="wide">适用对象<input value={courseDraft.targetAudience} onChange={event => setCourseDraft({ ...courseDraft, targetAudience: event.target.value })} placeholder="如：压接岗位新员工、换岗人员" /></label></div></section><section><strong>考核与技能联动</strong><div className="td-form-grid"><label>考核方式<select value={courseDraft.assessmentMode} onChange={event => setCourseDraft({ ...courseDraft, assessmentMode: event.target.value })}><option value="NONE">无需考核</option><option value="THEORY">理论</option><option value="PRACTICAL">实操</option><option value="COMBINED">理论 + 实操</option></select></label><label>合格分<input type="number" min="0" max="100" disabled={courseDraft.assessmentMode === 'NONE'} value={courseDraft.passScore} onChange={event => setCourseDraft({ ...courseDraft, passScore: event.target.value })} /></label><label>关联技能<select value={courseDraft.skillId} onChange={event => { const skill = data.skills.find(item => item.id === event.target.value); setCourseDraft({ ...courseDraft, skillId: event.target.value, validityMonths: String(skill?.defaultValidityMonths || 12) }); }}><option value="">不关联证书</option>{data.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label><label>认证等级<select disabled={!courseDraft.skillId} value={courseDraft.targetLevel} onChange={event => setCourseDraft({ ...courseDraft, targetLevel: event.target.value })}>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>L{level}</option>)}</select></label><label>证书有效（月）<input type="number" min="1" max="120" disabled={!courseDraft.skillId} value={courseDraft.validityMonths} onChange={event => setCourseDraft({ ...courseDraft, validityMonths: event.target.value })} /></label><label>复训周期（月）<input type="number" min="1" max="120" value={courseDraft.retrainingMonths} onChange={event => setCourseDraft({ ...courseDraft, retrainingMonths: event.target.value })} /></label><label className="td-check wide"><input type="checkbox" checked={courseDraft.isRequired} onChange={event => setCourseDraft({ ...courseDraft, isRequired: event.target.checked })} /><span><strong>必修课程</strong><small>计划创建时默认标记为必修</small></span></label></div></section></div><footer><button type="button" onClick={() => setDrawer(null)}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? <Loader2 className="spin" /> : <Check />}保存课程</button></footer></form>}
      {drawer === 'plan' && <form className="td-form" onSubmit={submitPlan}><div className="td-form-scroll"><section><strong>计划安排</strong>{editingPlan?.status === 'PUBLISHED' && <p className="td-form-help">已发布计划可变更时间、地点、人员和负责人；课程标准、考核方式、合格分及必修属性保持发布时版本。保存前会先展示影响并要求填写原因。</p>}<div className="td-form-grid"><label className="wide">计划名称<input required value={planDraft.title} onChange={event => setPlanDraft({ ...planDraft, title: event.target.value })} /></label><label className="wide">选择课程<select disabled={editingPlan?.status === 'PUBLISHED'} value={planDraft.courseId} onChange={event => chooseCourse(event.target.value)}><option value="">临时培训（不引用课程）</option>{data.courses.filter(course => course.status === 'ACTIVE').map(course => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label><label>开始时间<input required type="datetime-local" value={planDraft.startAt} onChange={event => setPlanDraft({ ...planDraft, startAt: event.target.value })} /></label><label>结束时间<input required type="datetime-local" value={planDraft.endAt} onChange={event => setPlanDraft({ ...planDraft, endAt: event.target.value })} /></label><label>地点<input value={planDraft.location} onChange={event => setPlanDraft({ ...planDraft, location: event.target.value })} placeholder="培训室 / 现场工位" /></label><label>方式<select value={planDraft.mode} onChange={event => setPlanDraft({ ...planDraft, mode: event.target.value })}><option value="OFFLINE">线下</option><option value="ONLINE">线上</option><option value="BLENDED">混合</option></select></label><label>组织人<select value={planDraft.organizerId} onChange={event => setPlanDraft({ ...planDraft, organizerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>讲师<select value={planDraft.trainerId} onChange={event => setPlanDraft({ ...planDraft, trainerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>审核人<select value={planDraft.reviewerId} onChange={event => setPlanDraft({ ...planDraft, reviewerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>考核方式<select disabled={editingPlan?.status === 'PUBLISHED'} value={planDraft.assessmentMode} onChange={event => setPlanDraft({ ...planDraft, assessmentMode: event.target.value })}><option value="NONE">无需考核</option><option value="THEORY">理论</option><option value="PRACTICAL">实操</option><option value="COMBINED">理论 + 实操</option></select></label><label className="wide">培训目的<textarea value={planDraft.purpose} onChange={event => setPlanDraft({ ...planDraft, purpose: event.target.value })} /></label></div></section><section><strong>选择参训人员 <em>{planDraft.participantIds.length} 人</em></strong><div className="td-picker-tools"><div><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索姓名、工号、岗位或班组" /></div><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="">全部部门</option>{departments.map(department => <option key={department} value={department}>{department}</option>)}</select><button type="button" onClick={() => setPlanDraft(current => ({ ...current, participantIds: [...new Set([...current.participantIds, ...filteredEmployees.map(person => person.id)])] }))}>全选当前</button></div><div className="td-employee-picker">{filteredEmployees.map(person => <label key={person.id} className={planDraft.participantIds.includes(person.id) ? 'selected' : ''}><input type="checkbox" checked={planDraft.participantIds.includes(person.id)} onChange={event => setPlanDraft(current => ({ ...current, participantIds: event.target.checked ? [...current.participantIds, person.id] : current.participantIds.filter(id => id !== person.id) }))} /><span>{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><small>{person.employeeNo} · {person.position || '岗位待维护'}</small><em>{person.department || '未分组'} / {person.team || '未分组'}</em></div></label>)}</div></section></div><footer><button type="button" onClick={() => { setDrawer(null); setEditingPlanId(''); }}>取消</button><button type="submit" className="primary" disabled={saving || !planDraft.participantIds.length}>{saving ? <Loader2 className="spin" /> : <Check />}{editingPlan ? '预览并保存变更' : '建立计划'}</button></footer></form>}
      {drawer === 'participant' && participantDraft && <form className="td-form" onSubmit={saveParticipantResult}><div className="td-form-scroll"><section><strong>分项成绩</strong><p className="td-form-help">成绩保存后进入“分项审核”，审核通过才会同步正式技能资料。</p><div className="td-form-grid"><label>理论成绩<input type="number" min="0" max="100" disabled={selectedPlan?.assessmentMode === 'PRACTICAL'} value={participantDraft.theoryScore} onChange={event => setParticipantDraft({ ...participantDraft, theoryScore: event.target.value })} /></label><label>实操成绩<input type="number" min="0" max="100" disabled={selectedPlan?.assessmentMode === 'THEORY'} value={participantDraft.practicalScore} onChange={event => setParticipantDraft({ ...participantDraft, practicalScore: event.target.value })} /></label></div></section></div><footer><button type="button" onClick={() => { setDrawer(null); setParticipantDraft(null); }}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? <Loader2 className="spin" /> : <Send />}提交审核</button></footer></form>}
    </aside></div>}
    {planDialog && (() => { const copy = planDialogCopy(planDialog.kind); return <div className="td-confirm-backdrop" role="presentation"><section className="td-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="training-plan-confirm-title"><header><div><span>{copy.eyebrow}</span><h2 id="training-plan-confirm-title">{copy.title}</h2><p>{planDialog.plan.code} · {planDialog.plan.title}</p></div><button type="button" aria-label="关闭" onClick={() => { setPlanDialog(null); if (planDialog.kind === 'change') setPendingPlanPayload(null); }}><X /></button></header><div className="td-confirm-body"><p className="td-confirm-description">{copy.description}</p>
      {planDialog.preview && <section className="td-change-preview"><header><strong>本次变更 {planDialog.preview.changedFields.length} 项</strong><span>新增 {planDialog.preview.addedParticipantCount} 人 · 移除 {planDialog.preview.removedParticipantCount} 人</span></header><div>{planDialog.preview.changedFields.map(field => <article key={field.key}><strong>{field.label}</strong><small>{planChangeValueLabel(field.key, field.before, data.employees, data.courses)}</small><ArrowRight /><small>{planChangeValueLabel(field.key, field.after, data.employees, data.courses)}</small></article>)}</div>{planDialog.preview.warnings.map(warning => <p key={warning}><AlertCircle />{warning}</p>)}</section>}
      {planDialog.impact && <section className="td-impact-grid"><article><span>参训人员</span><strong>{planDialog.impact.participantCount}</strong></article><article><span>签到事实</span><strong>{planDialog.impact.attendanceFactCount}</strong></article><article><span>反馈</span><strong>{planDialog.impact.feedbackCount}</strong></article><article><span>成绩/审核</span><strong>{planDialog.impact.scoreOrReviewFactCount}</strong></article><article><span>证书</span><strong>{planDialog.impact.certificationCount}</strong></article><article><span>附件</span><strong>{planDialog.impact.attachmentCount}</strong></article></section>}
      {planDialog.purge && <section className="td-purge-notice">
        <strong>永久删除后不可恢复，不设等待天数</strong>
        <p>{planDialog.purge.willCancel ? '该计划尚在进行中，删除后签到二维码和待办立即失效。' : '该计划及其专属参训、签到、反馈和审核记录将从业务台账中移除。'} 课程、员工和技能证书不会连带删除；附件按回收规则保留，操作原因单独留痕。</p>
        {planDialog.purge.blockers.length > 0 && <div role="alert">{planDialog.purge.blockers.map(message => <p key={message}>{message}</p>)}<a href="/workspace/employees?view=performance">查看技能绩效关联</a></div>}
        {planDialog.purge.requiresInvalidateFacts && <label className="td-purge-ack"><input type="checkbox" checked={planDialog.invalidateFacts === true} onChange={event => setPlanDialog(current => current ? { ...current, invalidateFacts: event.target.checked } : current)} /><span>我已核对以上影响，确认这些是误录记录，同意作废并永久删除。真实培训应使用归档保留。</span></label>}
        <button type="button" disabled={saving} onClick={() => void openPlanLifecycleDialog('purge', planDialog.plan)}>重新检查删除影响</button>
      </section>}
      {planDialog.error && <p className="td-dialog-error" role="alert">{planDialog.error}</p>}
      <label>操作原因{!['archive', 'unarchive'].includes(planDialog.kind) && <em>必填</em>}<textarea value={planDialog.reason} onChange={event => setPlanDialog(current => current ? { ...current, reason: event.target.value } : current)} placeholder={planDialog.kind === 'change' ? '说明为什么要变更已发布计划' : planDialog.kind === 'cancel' ? '说明取消原因' : '填写本次操作说明，便于审计追溯'} /></label>
      {['delete', 'restore', 'purge'].includes(planDialog.kind) && <label>输入计划编号确认 <em>必填</em><input value={planDialog.confirmationCode} onChange={event => setPlanDialog(current => current ? { ...current, confirmationCode: event.target.value } : current)} placeholder={planDialog.plan.code} /><small>请完整输入：{planDialog.plan.code}</small></label>}
    </div><footer><button type="button" onClick={() => { setPlanDialog(null); if (planDialog.kind === 'change') setPendingPlanPayload(null); }}>返回</button><button type="button" className={['delete', 'cancel', 'purge'].includes(planDialog.kind) ? 'danger' : 'primary'} disabled={saving || (planDialog.kind === 'purge' && (!planDialog.purge?.canPurge || (planDialog.purge.requiresInvalidateFacts && !planDialog.invalidateFacts)))} onClick={() => void confirmPlanDialog()}>{saving ? <Loader2 className="spin" /> : ['delete', 'purge'].includes(planDialog.kind) ? <Trash2 /> : planDialog.kind === 'archive' ? <Archive /> : <Check />}{copy.confirm}</button></footer></section></div>; })()}
    {saving && <div className="td-saving"><Loader2 className="spin" />正在保存真实培训数据</div>}
  </div>;
}
