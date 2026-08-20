'use client';

import {
  AlertCircle,
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
  Paperclip,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';

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
  participants: TrainingParticipant[];
  attachments: TrainingAttachment[];
  activities: Array<{ id: string; action: string; content: string | null; createdAt: string }>;
  summary: {
    participantCount: number;
    attendedCount: number;
    attendanceRate: number;
    passedCount: number;
    passRate: number;
    pendingReviewCount: number;
    belowPassCount: number;
  };
};

type Workbench = {
  ok: boolean;
  error?: string;
  generatedAt: string;
  permissions: { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; canExecute: boolean; actorEmployeeId: string | null };
  summary: {
    activeCourseCount: number;
    upcomingPlanCount: number;
    activePlanCount: number;
    pendingReviewCount: number;
    completedPlanCount: number;
    participantCount: number;
    attendanceRate: number;
    passRate: number;
  };
  employees: TrainingEmployee[];
  skills: TrainingSkill[];
  courses: TrainingCourse[];
  plans: TrainingPlan[];
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

const emptyCourse = {
  name: '', category: '岗位技能', objective: '', description: '', targetAudience: '', defaultDurationMinutes: '60', mode: 'OFFLINE',
  isRequired: false, assessmentMode: 'NONE', passScore: '80', skillId: '', targetLevel: '1', validityMonths: '12', retrainingMonths: '12', ownerEmployeeId: '',
};

function localInputDate(offsetHours = 1): string {
  const value = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const emptyPlan = {
  title: '', courseId: '', purpose: '', organizerId: '', trainerId: '', reviewerId: '', departmentId: '', startAt: localInputDate(24), endAt: localInputDate(26),
  location: '', mode: 'OFFLINE', isRequired: false, assessmentMode: 'NONE', passScore: '80', participantIds: [] as string[],
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
    INVITED: '未签到', PRESENT: '已签到', LATE: '迟到', ABSENT: '缺席', LEAVE: '请假',
    NOT_REQUIRED: '无需审核', PENDING: '待审核', APPROVED: '已审核', RETURNED: '已退回', PASSED: '合格', FAILED: '不合格',
  };
  return labels[status] || status;
}

function modeLabel(mode: string): string {
  return mode === 'ONLINE' ? '线上' : mode === 'BLENDED' ? '混合' : '线下';
}

function assessmentLabel(mode: string): string {
  return mode === 'THEORY' ? '理论' : mode === 'PRACTICAL' ? '实操' : mode === 'COMBINED' ? '理论 + 实操' : '无需考核';
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
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [courseDraft, setCourseDraft] = useState({ ...emptyCourse });
  const [planDraft, setPlanDraft] = useState({ ...emptyPlan, participantIds: [] as string[] });
  const [participantDraft, setParticipantDraft] = useState<{ id: string; employeeName: string; version: number; theoryScore: string; practicalScore: string; reviewComment: string } | null>(null);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [exportRange, setExportRange] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: start.toLocaleDateString('en-CA'), end: end.toLocaleDateString('en-CA') };
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  useToastBridge(toast, setToast);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/training/workbench', { cache: 'no-store' });
      const body = await response.json() as Workbench;
      if (!response.ok) throw new Error(body.error || '培训发展数据加载失败');
      setData(body);
      setSelectedPlanId(current => body.plans.some(plan => plan.id === current) ? current : body.plans[0]?.id || '');
      const requestedPlan = new URLSearchParams(window.location.search).get('planId');
      if (requestedPlan && body.plans.some(plan => plan.id === requestedPlan)) {
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

  const selectedPlan = useMemo(() => data?.plans.find(plan => plan.id === selectedPlanId) || null, [data, selectedPlanId]);
  const departments = useMemo(() => [...new Set((data?.employees || []).map(person => person.department || '').filter(Boolean))], [data]);
  const filteredEmployees = useMemo(() => {
    const q = keyword.trim().toLocaleLowerCase('zh-CN');
    return (data?.employees || []).filter(person => !departmentFilter || person.department === departmentFilter).filter(person => (
      !q || [person.name, person.employeeNo, person.department, person.position, person.team].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(q))
    ));
  }, [data, departmentFilter, keyword]);
  const pendingReviews = useMemo(() => (data?.plans || []).flatMap(plan => plan.participants.filter(person => person.reviewStatus === 'PENDING').map(person => ({ plan, person }))), [data]);
  const completedRecords = useMemo(() => (data?.plans || []).flatMap(plan => plan.participants.filter(person => ['APPROVED', 'NOT_REQUIRED'].includes(person.reviewStatus) && ['PASSED', 'FAILED'].includes(person.result)).map(person => ({ plan, person }))), [data]);

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

  async function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await jsonRequest('/api/training/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...planDraft, startAt: new Date(planDraft.startAt).toISOString(), endAt: new Date(planDraft.endAt).toISOString(), passScore: planDraft.assessmentMode === 'NONE' ? null : Number(planDraft.passScore) }) });
      setDrawer(null);
      setPlanDraft({ ...emptyPlan, startAt: localInputDate(24), endAt: localInputDate(26), participantIds: [] });
      setToast('培训计划已建立，可发布通知');
      await load(true);
      setView('plans');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '计划创建失败'); } finally { setSaving(false); }
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
    const reason = action === 'cancel' ? window.prompt('请填写取消原因')?.trim() : '';
    if (action === 'cancel' && !reason) return;
    setSaving(true);
    try {
      await jsonRequest(`/api/training/plans/${selectedPlan.id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, version: selectedPlan.version, reason }) });
      setToast(action === 'publish' ? '计划已发布并通知有账号的参训员工' : action === 'start' ? '培训已开始' : action === 'submit_review' ? '培训成绩已提交审核' : action === 'complete' ? '培训计划已完成归档' : '培训计划已取消');
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '计划状态更新失败'); } finally { setSaving(false); }
  }

  async function updateAttendance(person: TrainingParticipant, attendanceStatus: string) {
    setSaving(true);
    try {
      await jsonRequest(`/api/training/participants/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'attendance', attendanceStatus, version: person.version }) });
      await load(true);
      setToast(`${person.employeeName}：${statusLabel(attendanceStatus)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '签到保存失败'); } finally { setSaving(false); }
  }

  async function batchAttendance(attendanceStatus: string) {
    const people = selectedPlan?.participants.filter(person => selectedParticipantIds.includes(person.id)) || [];
    if (!people.length) return;
    setSaving(true);
    try {
      for (const person of people) {
        await jsonRequest(`/api/training/participants/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'attendance', attendanceStatus, version: person.version }) });
      }
      setSelectedParticipantIds([]);
      setToast(`已批量更新 ${people.length} 人签到状态`);
      await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批量签到失败'); } finally { setSaving(false); }
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
    return (
      <button type="button" key={plan.id} className={`td-plan-card ${selectedPlanId === plan.id ? 'active' : ''}`} onClick={() => setSelectedPlanId(plan.id)}>
        <span className={`td-status-dot ${plan.status.toLowerCase()}`} />
        <div><small>{plan.code} · {statusLabel(plan.status)}</small><strong>{plan.title}</strong><p>{fmtDate(plan.startAt)} · {plan.trainerName || '讲师待定'} · {plan.summary.participantCount} 人</p></div>
        <em>{plan.summary.attendanceRate}%<small>到课</small></em><ChevronRight />
      </button>
    );
  }

  function renderPlanDetail(plan: TrainingPlan) {
    return (
      <section className="td-plan-detail">
        <header><div><span>{statusLabel(plan.status)}</span><h2>{plan.title}</h2><p>{plan.code} · {plan.course?.name || '临时培训'} · {modeLabel(plan.mode)}</p></div><div className="td-plan-actions">
          {plan.status === 'DRAFT' && <button type="button" className="primary" disabled={saving} onClick={() => void transition('publish')}><Send />发布</button>}
          {plan.status === 'PUBLISHED' && <button type="button" className="primary" disabled={saving} onClick={() => void transition('start')}><Play />开始</button>}
          {plan.status === 'IN_PROGRESS' && <button type="button" className="primary" disabled={saving} onClick={() => void transition(plan.assessmentMode === 'NONE' ? 'complete' : 'submit_review')}><ClipboardCheck />{plan.assessmentMode === 'NONE' ? '完成归档' : '提交审核'}</button>}
          {plan.status === 'PENDING_REVIEW' && <button type="button" className="primary" disabled={saving || plan.summary.pendingReviewCount > 0} onClick={() => void transition('complete')}><CheckCircle2 />完成归档</button>}
          {!['COMPLETED', 'CANCELLED'].includes(plan.status) && <button type="button" disabled={saving} onClick={() => void transition('cancel')}>取消</button>}
        </div></header>
        <div className="td-detail-metrics"><article><span>计划时间</span><strong>{fmtDate(plan.startAt)} — {fmtDate(plan.endAt)}</strong></article><article><span>地点 / 方式</span><strong>{plan.location || '地点待定'} · {modeLabel(plan.mode)}</strong></article><article><span>讲师 / 审核</span><strong>{plan.trainerName || '待定'} / {plan.reviewerName || '待定'}</strong></article><article><span>考核规则</span><strong>{assessmentLabel(plan.assessmentMode)}{plan.passScore !== null ? ` · ${plan.passScore} 分` : ''}</strong></article></div>
        <div className="td-progress-pair"><div><span>到课率 <b>{plan.summary.attendanceRate}%</b></span><i><b style={{ width: `${plan.summary.attendanceRate}%` }} /></i></div><div><span>合格率 <b>{plan.summary.passRate}%</b></span><i><b className="green" style={{ width: `${plan.summary.passRate}%` }} /></i></div></div>
        <div className="td-detail-grid"><article><span>参训人员</span><strong>{plan.summary.participantCount}</strong><small>已到 {plan.summary.attendedCount} 人</small></article><article><span>待审核</span><strong>{plan.summary.pendingReviewCount}</strong><small>低于合格线 {plan.summary.belowPassCount} 人</small></article><article><span>课程资料</span><strong>{plan.attachments.length}</strong><small>对象存储附件</small></article><article><span>技能联动</span><strong>{plan.participants.filter(item => item.certificationId).length}</strong><small>已同步正式证书</small></article></div>
        <section className="td-attachment-zone"><header><div><strong>培训资料与现场证据</strong><small>PDF、图片、Office、MP4；文件存储在对象存储</small></div>{data!.permissions.canUpdate && <><input ref={fileInputRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.mp4" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); }} /><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Upload />上传资料</button></>}</header><div>{plan.attachments.map(file => <a key={file.id} href={file.contentUrl} target="_blank" rel="noreferrer"><FileText /><span><strong>{file.name}</strong><small>{file.kind} · {(file.size / 1024).toFixed(1)} KB</small></span><ArrowRight /></a>)}{!plan.attachments.length && <p><Paperclip />尚未上传资料，可在执行前补充课件、签到表或现场照片。</p>}</div></section>
        <section className="td-activity"><header><strong>最近动态</strong><small>{plan.activities.length} 条</small></header><div>{plan.activities.slice(0, 6).map(item => <article key={item.id}><i /><span><strong>{item.content || item.action}</strong><small>{fmtDate(item.createdAt)}</small></span></article>)}</div></section>
      </section>
    );
  }

  function renderExecution(plan: TrainingPlan | null) {
    if (!plan) return <div className="td-empty"><GraduationCap /><strong>尚无培训计划</strong><p>先在计划管理中创建培训计划。</p></div>;
    const allSelected = plan.participants.length > 0 && plan.participants.every(person => selectedParticipantIds.includes(person.id));
    return <div className="td-execution"><header className="td-section-title"><div><span>现场执行</span><h2>{plan.title}</h2><p>{fmtDate(plan.startAt)} · {plan.location || '地点待定'} · {assessmentLabel(plan.assessmentMode)}</p></div><select value={plan.id} onChange={event => { setSelectedPlanId(event.target.value); setSelectedParticipantIds([]); }}>{data!.plans.filter(item => !['COMPLETED', 'CANCELLED'].includes(item.status)).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></header>
      {selectedParticipantIds.length > 0 && <div className="td-batch-bar"><strong>已选 {selectedParticipantIds.length} 人</strong><button type="button" onClick={() => void batchAttendance('PRESENT')}>批量签到</button><button type="button" onClick={() => void batchAttendance('ABSENT')}>批量缺席</button><button type="button" onClick={() => setSelectedParticipantIds([])}>取消选择</button></div>}
      <div className="td-table-wrap"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={event => setSelectedParticipantIds(event.target.checked ? plan.participants.map(item => item.id) : [])} /></th><th>参训人员</th><th>组织</th><th>签到</th><th>成绩</th><th>审核</th><th>操作</th></tr></thead><tbody>{plan.participants.map(person => <tr key={person.id}><td><input type="checkbox" checked={selectedParticipantIds.includes(person.id)} onChange={event => setSelectedParticipantIds(current => event.target.checked ? [...new Set([...current, person.id])] : current.filter(id => id !== person.id))} /></td><td><strong>{person.employeeName}</strong><small>{person.employeeNo} · {person.position || '岗位待维护'}</small></td><td>{person.department || '未分组'}<small>{person.team || '班组未设置'}</small></td><td><span className={`td-pill ${person.attendanceStatus.toLowerCase()}`}>{statusLabel(person.attendanceStatus)}</span><small>{fmtDate(person.checkInAt)}</small></td><td><strong>{person.score ?? '—'}</strong><small>{person.result === 'PENDING' ? assessmentLabel(plan.assessmentMode) : statusLabel(person.result)}</small></td><td><span className={`td-pill ${person.reviewStatus.toLowerCase()}`}>{statusLabel(person.reviewStatus)}</span><small>{person.certificationId ? '证书已同步' : person.reviewComment || ''}</small></td><td><div className="td-row-actions"><button type="button" disabled={saving} onClick={() => void updateAttendance(person, 'PRESENT')}><Check />签到</button><button type="button" disabled={saving} onClick={() => void updateAttendance(person, 'LEAVE')}>请假</button>{plan.assessmentMode !== 'NONE' && ['PRESENT', 'LATE'].includes(person.attendanceStatus) && <button type="button" className="primary" onClick={() => { setParticipantDraft({ id: person.id, employeeName: person.employeeName, version: person.version, theoryScore: String(person.theoryScore ?? ''), practicalScore: String(person.practicalScore ?? ''), reviewComment: '' }); setDrawer('participant'); }}><PencilLine />录分</button>}</div></td></tr>)}</tbody></table></div>
    </div>;
  }

  return <div className="td-workbench">
    <header className="td-hero"><div className="td-hero-title"><span><GraduationCap /></span><div><small>人事管理 · 能力发展</small><h1>培训发展中心</h1><p>课程、计划、签到、考核、审核、技能证书与复训提醒形成一条真实数据链。</p></div></div><div className="td-hero-actions"><button type="button" title="刷新" onClick={() => void load()}><RefreshCw /></button>{data.permissions.canCreate && <button type="button" onClick={() => setDrawer('course')}><BookOpenCheck />新建课程</button>}{data.permissions.canCreate && <button type="button" className="primary" onClick={() => setDrawer('plan')}><Plus />新建计划</button>}</div></header>
    <nav className="td-nav">{navigation.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon /><span>{item.label}</span>{typeof item.count === 'number' && <em>{item.count}</em>}</button>; })}</nav>
    {error && <div className="td-error"><AlertCircle />{error}<button type="button" onClick={() => setError('')}>关闭</button></div>}

    {view === 'overview' && <div className="td-page"><section className="td-kpis"><article className="orange"><BookOpenCheck /><span><small>有效课程</small><strong>{data.summary.activeCourseCount}</strong><em>标准化课程库</em></span></article><article className="blue"><CalendarDays /><span><small>待开展计划</small><strong>{data.summary.upcomingPlanCount}</strong><em>进行中 {data.summary.activePlanCount}</em></span></article><article className="violet"><ClipboardCheck /><span><small>待分项审核</small><strong>{data.summary.pendingReviewCount}</strong><em>成绩必须审核后入档</em></span></article><article className="green"><UserCheck /><span><small>综合到课率</small><strong>{data.summary.attendanceRate}%</strong><em>{data.summary.participantCount} 人次</em></span></article><article className="amber"><Award /><span><small>到期复训</small><strong>{data.expiringCertifications.length}</strong><em>未来 90 天</em></span></article></section>
      <div className="td-overview-grid"><section className="td-panel td-overview-plans"><header className="td-section-title"><div><span>近期计划</span><h2>培训执行节奏</h2></div><button type="button" onClick={() => setView('plans')}>查看全部<ArrowRight /></button></header><div>{data.plans.slice(0, 6).map(planCard)}{!data.plans.length && <div className="td-empty compact"><CalendarDays /><strong>尚无培训计划</strong><button type="button" onClick={() => setDrawer('plan')}>建立第一条计划</button></div>}</div></section>
        <section className="td-panel td-radar"><header className="td-section-title"><div><span>质量门禁</span><h2>审核与复训预警</h2></div></header><div className="td-radar-ring"><strong>{data.summary.passRate}%</strong><span>已审核合格率</span></div><div className="td-risk-list"><button type="button" onClick={() => setView('review')}><span className="red"><ClipboardCheck /></span><div><strong>{data.summary.pendingReviewCount} 项待审核</strong><small>审核通过后才进入正式技能资料</small></div><ChevronRight /></button><button type="button" onClick={() => setView('retraining')}><span className="amber"><Award /></span><div><strong>{data.expiringCertifications.length} 项到期提醒</strong><small>证书到期前可一键创建复训计划</small></div><ChevronRight /></button><button type="button" onClick={() => setView('reports')}><span className="blue"><Download /></span><div><strong>培训台账可追溯导出</strong><small>计划、员工、签到、成绩、审核和证书一行呈现</small></div><ChevronRight /></button></div></section></div>
      <section className="td-panel td-course-strip"><header className="td-section-title"><div><span>课程库</span><h2>岗位能力课程</h2></div><button type="button" onClick={() => setView('courses')}>管理课程<ArrowRight /></button></header><div>{data.courses.slice(0, 5).map(course => <article key={course.id}><span><BookOpenCheck /></span><div><small>{course.category} · {course.code}</small><strong>{course.name}</strong><p>{course.targetAudience || '适用对象待补充'}</p></div><em>{assessmentLabel(course.assessmentMode)}</em></article>)}</div></section></div>}

    {view === 'courses' && <div className="td-page"><section className="td-toolbar"><div><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索课程名称、分类或技能" /></div><span>{data.courses.length} 门真实课程</span>{data.permissions.canCreate && <button type="button" className="primary" onClick={() => setDrawer('course')}><Plus />新建课程</button>}</section><section className="td-course-grid">{data.courses.filter(course => !keyword || [course.name, course.code, course.category, course.skill?.name].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword.toLocaleLowerCase('zh-CN')))).map(course => <article key={course.id}><header><span><BookOpenCheck /></span><div><small>{course.category} · {course.code}</small><h2>{course.name}</h2></div><em>{course.status === 'ACTIVE' ? '启用' : '停用'}</em></header><p>{course.objective || course.description || '课程目标待补充'}</p><dl><div><dt>适用对象</dt><dd>{course.targetAudience || '待设置'}</dd></div><div><dt>培训规则</dt><dd>{course.defaultDurationMinutes} 分钟 · {modeLabel(course.mode)}</dd></div><div><dt>考核</dt><dd>{assessmentLabel(course.assessmentMode)}{course.passScore !== null ? ` · ${course.passScore}分` : ''}</dd></div><div><dt>技能联动</dt><dd>{course.skill ? `${course.skill.name} · L${course.targetLevel || 1}` : '不关联技能证书'}</dd></div></dl><footer><span>{course.isRequired ? '必修' : '选修'} · {course.retrainingMonths ? `${course.retrainingMonths}个月复训` : '无复训周期'}</span><button type="button" onClick={() => { setPlanDraft(current => ({ ...current, participantIds: [] })); chooseCourse(course.id); setDrawer('plan'); }}>据此建计划<ArrowRight /></button></footer></article>)}</section></div>}

    {view === 'plans' && <div className="td-page td-plan-workspace"><aside className="td-plan-list"><header><div><span>全部计划</span><strong>{data.plans.length}</strong></div><button type="button" onClick={() => setDrawer('plan')}><Plus /></button></header><div>{data.plans.map(planCard)}</div></aside>{selectedPlan ? renderPlanDetail(selectedPlan) : <div className="td-empty"><CalendarDays /><strong>请选择培训计划</strong></div>}</div>}

    {view === 'execution' && <div className="td-page td-panel">{renderExecution(selectedPlan || data.plans.find(plan => ['PUBLISHED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(plan.status)) || data.plans[0] || null)}</div>}

    {view === 'review' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>质量门禁</span><h2>培训成绩分项审核</h2><p>只有审核通过的数据才能同步为正式技能证书。</p></div><em>{pendingReviews.length} 项待审核</em></header><section className="td-review-list">{pendingReviews.map(({ plan, person }) => <article key={person.id}><div className="td-avatar">{person.employeeName.slice(0, 1)}</div><div><small>{plan.code} · {plan.title}</small><strong>{person.employeeName} · {person.employeeNo}</strong><p>{person.department || '未分组'} / {person.team || '未分组'} · {assessmentLabel(plan.assessmentMode)}</p></div><div className="td-score"><span>理论 <b>{person.theoryScore ?? '—'}</b></span><span>实操 <b>{person.practicalScore ?? '—'}</b></span><strong>{person.score ?? '—'}<small>综合</small></strong></div><div className="td-review-actions"><button type="button" disabled={saving} onClick={() => void reviewParticipant(plan, person, 'return')}>退回</button><button type="button" className="primary" disabled={saving} onClick={() => void reviewParticipant(plan, person, 'approve')}><ShieldCheck />审核通过</button></div></article>)}{!pendingReviews.length && <div className="td-empty"><CheckCircle2 /><strong>当前没有待审核成绩</strong><p>培训执行录分后，审核任务会在这里汇总。</p></div>}</section></div>}

    {view === 'records' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>正式档案</span><h2>员工培训与认证记录</h2><p>保留计划快照、签到、成绩、审核和技能证书关联。</p></div><button type="button" onClick={() => setView('reports')}><Download />导出台账</button></header><div className="td-table-wrap td-record-table"><table><thead><tr><th>员工</th><th>培训计划 / 课程</th><th>培训日期</th><th>到课</th><th>成绩</th><th>审核</th><th>技能证书</th></tr></thead><tbody>{completedRecords.map(({ plan, person }) => <tr key={`${plan.id}-${person.id}`}><td><strong>{person.employeeName}</strong><small>{person.employeeNo} · {person.department || '未分组'}</small></td><td><strong>{plan.title}</strong><small>{plan.course?.name || '临时培训'} · {plan.code}</small></td><td>{fmtDate(plan.startAt)}</td><td><span className={`td-pill ${person.attendanceStatus.toLowerCase()}`}>{statusLabel(person.attendanceStatus)}</span></td><td><strong>{person.score ?? '—'}</strong><small>{statusLabel(person.result)}</small></td><td><span className={`td-pill ${person.reviewStatus.toLowerCase()}`}>{statusLabel(person.reviewStatus)}</span></td><td>{person.certificationId ? <span className="td-certificate"><Award />已同步</span> : '—'}</td></tr>)}</tbody></table></div></div>}

    {view === 'retraining' && <div className="td-page"><header className="td-section-title td-page-title"><div><span>有效期管理</span><h2>到期复训与证书续期</h2><p>展示已到期及未来 90 天内到期的正式技能证书。</p></div><em>{data.expiringCertifications.length} 项</em></header><section className="td-retraining-grid">{data.expiringCertifications.map(item => <article key={item.id} className={item.expired ? 'expired' : ''}><span><Award /></span><div><small>{item.employeeNo} · {item.department || '未分组'} / {item.team || '未分组'}</small><strong>{item.employeeName}</strong><p>{item.skillName} · L{item.level}</p></div><div><em>{item.expired ? '已到期' : '即将到期'}</em><strong>{item.expiresAt || '—'}</strong></div><button type="button" onClick={() => { const course = data.courses.find(course => course.skillId && course.skill?.name === item.skillName); setPlanDraft({ ...emptyPlan, startAt: localInputDate(24), endAt: localInputDate(26), title: `${item.skillName}复训`, courseId: course?.id || '', participantIds: [item.employeeId], assessmentMode: course?.assessmentMode || 'COMBINED', passScore: String(course?.passScore || 80), mode: course?.mode || 'OFFLINE', isRequired: true }); setDrawer('plan'); }}>创建复训<ChevronRight /></button></article>)}{!data.expiringCertifications.length && <div className="td-empty"><Award /><strong>未来 90 天没有到期证书</strong><p>关联技能的培训审核通过后会进入有效期管理。</p></div>}</section></div>}

    {view === 'reports' && <div className="td-page"><section className="td-export-card"><div className="td-export-art"><Download /></div><div><span>一张表看清培训结果</span><h2>员工培训发展记录表</h2><p>每名参训员工一行，只输出计划、人员、签到、学时、成绩、审核和技能证书，不在表头堆砌无关数字。</p><ul><li><Check />冻结表头与自动筛选</li><li><Check />状态颜色和异常突出</li><li><Check />适配打印与后续分析</li></ul></div><form onSubmit={event => { event.preventDefault(); window.location.href = `/api/training/export.xlsx?period=custom&startDate=${exportRange.start}&endDate=${exportRange.end}`; }}><label>开始日期<input type="date" required value={exportRange.start} onChange={event => setExportRange(current => ({ ...current, start: event.target.value }))} /></label><label>结束日期<input type="date" required value={exportRange.end} onChange={event => setExportRange(current => ({ ...current, end: event.target.value }))} /></label><button type="submit" className="primary"><Download />导出 Excel 台账</button><small>导出行为会写入系统操作日志</small></form></section></div>}

    {drawer && <div className="td-drawer-backdrop" role="presentation"><aside className="td-drawer" role="dialog" aria-modal="true"><header><div><span>{drawer === 'course' ? '课程标准' : drawer === 'plan' ? '培训安排' : '考核录分'}</span><h2>{drawer === 'course' ? '新建培训课程' : drawer === 'plan' ? '新建培训计划' : `${participantDraft?.employeeName || ''} · 录入成绩`}</h2></div><button type="button" onClick={() => { setDrawer(null); setParticipantDraft(null); }}><X /></button></header>
      {drawer === 'course' && <form className="td-form" onSubmit={submitCourse}><div className="td-form-scroll"><section><strong>课程基础</strong><div className="td-form-grid"><label className="wide">课程名称<input required value={courseDraft.name} onChange={event => setCourseDraft({ ...courseDraft, name: event.target.value })} placeholder="如：全自动压接机安全与操作" /></label><label>课程分类<input value={courseDraft.category} onChange={event => setCourseDraft({ ...courseDraft, category: event.target.value })} /></label><label>培训方式<select value={courseDraft.mode} onChange={event => setCourseDraft({ ...courseDraft, mode: event.target.value })}><option value="OFFLINE">线下</option><option value="ONLINE">线上</option><option value="BLENDED">混合</option></select></label><label>默认时长（分钟）<input type="number" min="1" max="1440" value={courseDraft.defaultDurationMinutes} onChange={event => setCourseDraft({ ...courseDraft, defaultDurationMinutes: event.target.value })} /></label><label>课程负责人<select value={courseDraft.ownerEmployeeId} onChange={event => setCourseDraft({ ...courseDraft, ownerEmployeeId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label className="wide">课程目标<textarea value={courseDraft.objective} onChange={event => setCourseDraft({ ...courseDraft, objective: event.target.value })} placeholder="完成后应掌握什么" /></label><label className="wide">适用对象<input value={courseDraft.targetAudience} onChange={event => setCourseDraft({ ...courseDraft, targetAudience: event.target.value })} placeholder="如：压接岗位新员工、换岗人员" /></label></div></section><section><strong>考核与技能联动</strong><div className="td-form-grid"><label>考核方式<select value={courseDraft.assessmentMode} onChange={event => setCourseDraft({ ...courseDraft, assessmentMode: event.target.value })}><option value="NONE">无需考核</option><option value="THEORY">理论</option><option value="PRACTICAL">实操</option><option value="COMBINED">理论 + 实操</option></select></label><label>合格分<input type="number" min="0" max="100" disabled={courseDraft.assessmentMode === 'NONE'} value={courseDraft.passScore} onChange={event => setCourseDraft({ ...courseDraft, passScore: event.target.value })} /></label><label>关联技能<select value={courseDraft.skillId} onChange={event => { const skill = data.skills.find(item => item.id === event.target.value); setCourseDraft({ ...courseDraft, skillId: event.target.value, validityMonths: String(skill?.defaultValidityMonths || 12) }); }}><option value="">不关联证书</option>{data.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label><label>认证等级<select disabled={!courseDraft.skillId} value={courseDraft.targetLevel} onChange={event => setCourseDraft({ ...courseDraft, targetLevel: event.target.value })}>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>L{level}</option>)}</select></label><label>证书有效（月）<input type="number" min="1" max="120" disabled={!courseDraft.skillId} value={courseDraft.validityMonths} onChange={event => setCourseDraft({ ...courseDraft, validityMonths: event.target.value })} /></label><label>复训周期（月）<input type="number" min="1" max="120" value={courseDraft.retrainingMonths} onChange={event => setCourseDraft({ ...courseDraft, retrainingMonths: event.target.value })} /></label><label className="td-check wide"><input type="checkbox" checked={courseDraft.isRequired} onChange={event => setCourseDraft({ ...courseDraft, isRequired: event.target.checked })} /><span><strong>必修课程</strong><small>计划创建时默认标记为必修</small></span></label></div></section></div><footer><button type="button" onClick={() => setDrawer(null)}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? <Loader2 className="spin" /> : <Check />}保存课程</button></footer></form>}
      {drawer === 'plan' && <form className="td-form" onSubmit={submitPlan}><div className="td-form-scroll"><section><strong>计划安排</strong><div className="td-form-grid"><label className="wide">计划名称<input required value={planDraft.title} onChange={event => setPlanDraft({ ...planDraft, title: event.target.value })} /></label><label className="wide">选择课程<select value={planDraft.courseId} onChange={event => chooseCourse(event.target.value)}><option value="">临时培训（不引用课程）</option>{data.courses.filter(course => course.status === 'ACTIVE').map(course => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label><label>开始时间<input required type="datetime-local" value={planDraft.startAt} onChange={event => setPlanDraft({ ...planDraft, startAt: event.target.value })} /></label><label>结束时间<input required type="datetime-local" value={planDraft.endAt} onChange={event => setPlanDraft({ ...planDraft, endAt: event.target.value })} /></label><label>地点<input value={planDraft.location} onChange={event => setPlanDraft({ ...planDraft, location: event.target.value })} placeholder="培训室 / 现场工位" /></label><label>方式<select value={planDraft.mode} onChange={event => setPlanDraft({ ...planDraft, mode: event.target.value })}><option value="OFFLINE">线下</option><option value="ONLINE">线上</option><option value="BLENDED">混合</option></select></label><label>组织人<select value={planDraft.organizerId} onChange={event => setPlanDraft({ ...planDraft, organizerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>讲师<select value={planDraft.trainerId} onChange={event => setPlanDraft({ ...planDraft, trainerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>审核人<select value={planDraft.reviewerId} onChange={event => setPlanDraft({ ...planDraft, reviewerId: event.target.value })}><option value="">待指定</option>{data.employees.map(person => <option key={person.id} value={person.id}>{person.employeeNo} · {person.name}</option>)}</select></label><label>考核方式<select value={planDraft.assessmentMode} onChange={event => setPlanDraft({ ...planDraft, assessmentMode: event.target.value })}><option value="NONE">无需考核</option><option value="THEORY">理论</option><option value="PRACTICAL">实操</option><option value="COMBINED">理论 + 实操</option></select></label><label className="wide">培训目的<textarea value={planDraft.purpose} onChange={event => setPlanDraft({ ...planDraft, purpose: event.target.value })} /></label></div></section><section><strong>选择参训人员 <em>{planDraft.participantIds.length} 人</em></strong><div className="td-picker-tools"><div><Search /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索姓名、工号、岗位或班组" /></div><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="">全部部门</option>{departments.map(department => <option key={department} value={department}>{department}</option>)}</select><button type="button" onClick={() => setPlanDraft(current => ({ ...current, participantIds: [...new Set([...current.participantIds, ...filteredEmployees.map(person => person.id)])] }))}>全选当前</button></div><div className="td-employee-picker">{filteredEmployees.map(person => <label key={person.id} className={planDraft.participantIds.includes(person.id) ? 'selected' : ''}><input type="checkbox" checked={planDraft.participantIds.includes(person.id)} onChange={event => setPlanDraft(current => ({ ...current, participantIds: event.target.checked ? [...current.participantIds, person.id] : current.participantIds.filter(id => id !== person.id) }))} /><span>{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><small>{person.employeeNo} · {person.position || '岗位待维护'}</small><em>{person.department || '未分组'} / {person.team || '未分组'}</em></div></label>)}</div></section></div><footer><button type="button" onClick={() => setDrawer(null)}>取消</button><button type="submit" className="primary" disabled={saving || !planDraft.participantIds.length}>{saving ? <Loader2 className="spin" /> : <Check />}建立计划</button></footer></form>}
      {drawer === 'participant' && participantDraft && <form className="td-form" onSubmit={saveParticipantResult}><div className="td-form-scroll"><section><strong>分项成绩</strong><p className="td-form-help">成绩保存后进入“分项审核”，审核通过才会同步正式技能资料。</p><div className="td-form-grid"><label>理论成绩<input type="number" min="0" max="100" disabled={selectedPlan?.assessmentMode === 'PRACTICAL'} value={participantDraft.theoryScore} onChange={event => setParticipantDraft({ ...participantDraft, theoryScore: event.target.value })} /></label><label>实操成绩<input type="number" min="0" max="100" disabled={selectedPlan?.assessmentMode === 'THEORY'} value={participantDraft.practicalScore} onChange={event => setParticipantDraft({ ...participantDraft, practicalScore: event.target.value })} /></label></div></section></div><footer><button type="button" onClick={() => { setDrawer(null); setParticipantDraft(null); }}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? <Loader2 className="spin" /> : <Send />}提交审核</button></footer></form>}
    </aside></div>}
    {saving && <div className="td-saving"><Loader2 className="spin" />正在保存真实培训数据</div>}
  </div>;
}
