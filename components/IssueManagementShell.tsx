'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FileText,
  GitPullRequestArrow,
  Inbox,
  Info,
  ListChecks,
  Loader2,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  ShieldCheck,
  ThumbsUp,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { EmployeeMultiPicker, EmployeePicker, WorkOrderPicker } from '@/components/issues/IssuePickers';
import { IssueCurrentTask } from '@/components/issues/IssueCurrentTask';
import type {
  CurrentUserDTO,
  DetectedIssueDTO,
  IssueAssigneeOptionDTO,
  IssueAttachmentCategory,
  IssueAttachmentDTO,
  IssueDTO,
  IssuePriority,
  IssueStatus,
  IssueSummaryDTO,
  IssueType,
  IssueWorkOrderDraftDTO,
  IssueWorkOrderOptionDTO,
} from '@/types';

type IssueManagementShellProps = { user: CurrentUserDTO };
type QueueMode = 'issues' | 'detected';
type IssueListResponse = { ok: boolean; issues: IssueDTO[]; summary: IssueSummaryDTO; pagination: { page: number; pageSize: number; total: number; totalPages: number }; error?: string };
type DetectedResponse = { ok: boolean; detected: DetectedIssueDTO[]; pendingCount: number; error?: string };
type EmployeesResponse = { ok: boolean; employees: IssueAssigneeOptionDTO[]; error?: string };
type DuplicateIssue = { id: string; code: string; title: string; status: IssueStatus };
type IssueMutationResponse = {
  ok: boolean;
  issue?: IssueDTO;
  error?: string;
  created?: boolean;
  duplicateIssue?: DuplicateIssue;
  createdWorkOrder?: IssueWorkOrderOptionDTO | null;
  existingWorkOrder?: IssueWorkOrderOptionDTO;
  conflictType?: 'existing' | 'soft_deleted';
};

type Filters = {
  status: 'all' | IssueStatus;
  type: 'all' | IssueType;
  priority: 'all' | IssuePriority;
  assigneeId: string;
  overdue: boolean;
  unassigned: boolean;
};

type IssueFormState = {
  title: string;
  type: IssueType;
  priority: IssuePriority;
  description: string;
  workOrderId: string;
  assigneeEmployeeId: string;
  collaboratorEmployeeIds: string[];
  dueAt: string;
  processName: string;
  affectedQuantity: string;
  temporaryMeasure: string;
  rootCause: string;
  solution: string;
  verificationResult: string;
  isMajorQuality: boolean;
  majorQualityReason: string;
};

type TransitionState = { issueId: string; expectedVersion: number; target: IssueStatus; rootCause: string; solution: string; verificationResult: string; comment: string };
type ContextForm = { assigneeEmployeeId: string; verifierEmployeeId: string; collaboratorEmployeeIds: string[]; dueAt: string; priority: IssuePriority };
type ComposerMode = 'comment' | 'task' | 'decision';
type AttachmentDeleteState = { id: string; name: string };
type DetailBranch = 'overview' | 'analysis' | 'collaboration' | 'decisions' | 'files' | 'verification' | 'logs';

const statusLabels: Record<IssueStatus, string> = {
  pending: '待受理',
  processing: '处理中',
  verifying: '待验证',
  awaiting_confirmation: '待发起人确认',
  closed: '已关闭',
};
const priorityLabels: Record<IssuePriority, string> = { urgent: '紧急', high: '高', normal: '一般' };
const typeLabels: Record<IssueType, string> = { production: '生产问题', planning: '计划问题', technical: '技术问题', process: '工艺问题', quality: '质量问题', material: '物料问题', equipment: '设备问题', other: '其他' };
const attachmentCategoryLabels: Record<IssueAttachmentCategory, string> = {
  site_original: '现场原始资料',
  root_cause: '原因分析资料',
  processing: '处理过程资料',
  verification: '验证证据',
  archive: '归档同步资料',
  other: '其他未分类',
};
const detailBranches: Array<{ key: DetailBranch; label: string; hint: string }> = [
  { key: 'overview', label: '处理与验证', hint: '当前任务与解决情况' },
  { key: 'files', label: '文件证据', hint: '查看与补充依据' },
  { key: 'logs', label: '历史记录', hint: '完整审计轨迹' },
];
const activityLabels: Record<string, string> = {
  create: '创建问题', created: '创建问题', create_from_source: '由生产异常转入', restore_from_source: '从来源恢复',
  update: '更新问题信息', assign: '更新负责人', transition: '状态流转', status_changed: '状态流转', comment: '处理记录',
  upload_attachment: '上传附件', delete_attachment: '删除附件', delete: '删除问题',
  major_quality_review: '重大质量二次复核', major_quality_return: '重大质量退回整改',
  major_quality_approved: '重大质量终审通过',
  task_create: '创建协同待办', task_complete: '完成协同待办',
  decision_create: '发起协同决策', decision_approve: '决策通过', decision_return: '决策退回',
};
const majorApprovalStatusLabels = {
  PENDING_QUALITY_REVIEW: '待质量二次复核',
  PENDING_GM_APPROVAL: '待总经办终审',
  APPROVED: '终审通过',
  QUALITY_RETURNED: '质量复核退回',
  GM_RETURNED: '总经办退回',
  CANCELLED: '审批已撤回',
} as const;
const emptySummary: IssueSummaryDTO = { total: 0, pending: 0, processing: 0, verifying: 0, awaiting_confirmation: 0, closed: 0, overdue: 0, unassigned: 0 };
const emptyFilters: Filters = { status: 'all', type: 'all', priority: 'all', assigneeId: '', overdue: false, unassigned: false };
const emptyForm: IssueFormState = {
  title: '', type: 'production', priority: 'normal', description: '', workOrderId: '',
  assigneeEmployeeId: '', collaboratorEmployeeIds: [], dueAt: '', processName: '',
  affectedQuantity: '', temporaryMeasure: '', rootCause: '', solution: '', verificationResult: '',
  isMajorQuality: false, majorQualityReason: '',
};

function formatDate(value?: string | null, includeTime = true): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function localDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function sourceLabel(issue: IssueDTO): string {
  if (issue.sourceType === 'production_alert') return '生产异常';
  if (issue.sourceType === 'work_order') return '工单联动';
  if (issue.sourceType === 'material_exception') return '物料异常';
  if (issue.sourceType === 'sample_task') return '样品任务';
  if (issue.sourceType === 'manual') return issue.workOrder ? '工单人工创建' : '人工创建';
  return issue.sourceType || '人工创建';
}

class ApiRequestError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string; message?: string };
  if (!response.ok) throw new ApiRequestError(data.error || data.message || '请求失败', response.status, data as Record<string, unknown>);
  return data;
}

function issueFormFrom(issue?: IssueDTO | null): IssueFormState {
  if (!issue) return { ...emptyForm };
  return {
    title: issue.title,
    type: issue.type,
    priority: issue.priority,
    description: issue.description || '',
    workOrderId: issue.workOrderId || '',
    assigneeEmployeeId: issue.assignee?.id || '',
    collaboratorEmployeeIds: issue.collaborators.map(item => item.id),
    dueAt: localDateTime(issue.dueAt),
    processName: issue.processName || '',
    affectedQuantity: issue.affectedQuantity === null || issue.affectedQuantity === undefined ? '' : String(issue.affectedQuantity),
    temporaryMeasure: issue.temporaryMeasure || '',
    rootCause: issue.rootCause || '',
    solution: issue.solution || '',
    verificationResult: issue.verificationResult || '',
    isMajorQuality: issue.isMajorQuality,
    majorQualityReason: issue.majorQualityReason || '',
  };
}

function issueFormSnapshot(form: IssueFormState, workOrderDraft: IssueWorkOrderDraftDTO | null): string {
  return JSON.stringify({ form, workOrderDraft });
}

function issueWorkOrderOptionFromIssue(issue?: IssueDTO | null): IssueWorkOrderOptionDTO | null {
  const order = issue?.workOrder;
  if (!order) return null;
  const stageLabels: Record<string, string> = {
    not_issued: '未发图', pending: '未发图', frontend: '在前端', processing: '在前端', backend: '在后端', completed: '已完成', done: '已完成',
  };
  return {
    id: order.id,
    code: order.code,
    displayCode: order.specification || order.code,
    customerName: order.customerName,
    productName: order.productName,
    specification: order.specification,
    stage: order.stage,
    stageText: stageLabels[order.stage] || order.stage,
    drawingStatus: order.drawingStatus,
  };
}

export default function IssueManagementShell({ user }: IssueManagementShellProps) {
  const isAdmin = user.laborRole === 'ADMIN';
  const processIssueMode = user.access.capabilities.includes('PROCESS:READ')
    && user.access.capabilities.includes('ISSUE_MANAGEMENT:READ')
    && !user.access.capabilities.includes('QUALITY:READ');
  const productionIssueMode = user.access.capabilities.includes('PRODUCTION:READ')
    && user.access.capabilities.includes('ISSUE_MANAGEMENT:READ')
    && !user.access.capabilities.includes('QUALITY:READ');
  const canCreateIssues = isAdmin || user.access.capabilities.includes('QUALITY:CREATE')
    || user.access.capabilities.includes('ISSUE_MANAGEMENT:CREATE');
  const canUpdateIssues = isAdmin || user.access.capabilities.includes('QUALITY:UPDATE')
    || user.access.capabilities.includes('ISSUE_MANAGEMENT:UPDATE');
  const canDeleteIssues = isAdmin || user.access.capabilities.includes('QUALITY:DELETE');
  const canConvertDetectedIssues = user.access.capabilities.includes('QUALITY:CREATE');
  const defaultIssueForm = useMemo<IssueFormState>(() => ({
    ...emptyForm,
    type: processIssueMode ? 'process' : emptyForm.type,
    collaboratorEmployeeIds: [],
  }), [processIssueMode]);
  const routeSearchParams = useSearchParams();
  const initialParams = useMemo(() => new URLSearchParams(routeSearchParams.toString()), [routeSearchParams]);
  const [keyword, setKeyword] = useState(initialParams.get('keyword') || '');
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    status: (['pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'].includes(initialParams.get('status') || '') ? initialParams.get('status') : 'all') as Filters['status'],
    overdue: initialParams.get('overdue') === 'true',
  }));
  const [queueMode, setQueueMode] = useState<QueueMode>(canConvertDetectedIssues && initialParams.get('inbox') === 'detected' ? 'detected' : 'issues');
  const [issues, setIssues] = useState<IssueDTO[]>([]);
  const [summary, setSummary] = useState<IssueSummaryDTO>(emptySummary);
  const [detected, setDetected] = useState<DetectedIssueDTO[]>([]);
  const [pendingDetected, setPendingDetected] = useState(0);
  const [employees, setEmployees] = useState<IssueAssigneeOptionDTO[]>([]);
  const [selected, setSelected] = useState<IssueDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(canCreateIssues && initialParams.get('action') === 'new');
  const [editingIssue, setEditingIssue] = useState<IssueDTO | null>(null);
  const [form, setForm] = useState<IssueFormState>(defaultIssueForm);
  const [newWorkOrderDraft, setNewWorkOrderDraft] = useState<IssueWorkOrderDraftDTO | null>(null);
  const [formError, setFormError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [duplicateIssue, setDuplicateIssue] = useState<DuplicateIssue | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [transitionError, setTransitionError] = useState('');
  const [transitionConflict, setTransitionConflict] = useState(false);
  const [operationResult, setOperationResult] = useState('');
  const [contextError, setContextError] = useState('');
  const [composerMode, setComposerMode] = useState<ComposerMode>('comment');
  const [composerContent, setComposerContent] = useState('');
  const [composerAssigneeEmployeeId, setComposerAssigneeEmployeeId] = useState('');
  const [composerDueAt, setComposerDueAt] = useState('');
  const [detailBranch, setDetailBranch] = useState<DetailBranch>('overview');
  const [attachmentCategory, setAttachmentCategory] = useState<IssueAttachmentCategory>('site_original');
  const [attachmentCaption, setAttachmentCaption] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [compactContext, setCompactContext] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<IssueDTO | null>(null);
  const [confirmAttachmentDelete, setConfirmAttachmentDelete] = useState<AttachmentDeleteState | null>(null);
  const [contextDrafts, setContextDrafts] = useState<Record<string, { value: ContextForm; baseline: string; version: number }>>({});
  const serverContext: ContextForm = {
    assigneeEmployeeId: selected?.assignee?.id || '', verifierEmployeeId: selected?.verifier?.id || '',
    collaboratorEmployeeIds: selected?.collaborators.map(item => item.id) || [], dueAt: localDateTime(selected?.dueAt), priority: selected?.priority || 'normal',
  };
  const contextDraft = selected ? contextDrafts[selected.id] : undefined;
  const contextDirty = !!contextDraft && JSON.stringify(contextDraft.value) !== contextDraft.baseline;
  const contextForm = contextDirty ? contextDraft!.value : serverContext;
  const anyContextDirty = Object.values(contextDrafts).some(draft => JSON.stringify(draft.value) !== draft.baseline);
  function setContextForm(update: (current: ContextForm) => ContextForm): void {
    if (!selected || saving) return;
    setContextError('');
    setContextDrafts(current => ({ ...current, [selected.id]: {
      value: update(contextForm), baseline: contextDirty ? contextDraft!.baseline : JSON.stringify(serverContext), version: contextDirty ? contextDraft!.version : selected.version,
    } }));
  }
  function discardContextDraft(id: string): void {
    setContextDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    setContextError('');
  }
  const selectedApprovalPending = ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL']
    .includes(selected?.majorApproval?.status || '');
  const selectedMajorFinalApproved = selected?.majorApproval?.status === 'APPROVED'
    && (selected.status === 'awaiting_confirmation' || selected.status === 'closed');
  const selectedContentLocked = selectedApprovalPending || selectedMajorFinalApproved || selected?.status === 'closed';
  const canMaintainIssue = (issue: IssueDTO | null): boolean => !!issue
    && canUpdateIssues
    && (isAdmin || (!processIssueMode && !productionIssueMode)
      || (!issue.isMajorQuality && (
        (processIssueMode && issue.type === 'process')
        || (productionIssueMode && issue.type === 'production')
        || issue.reporter?.id === user.id
        || issue.assignee?.id === user.employeeId
        || issue.verifier?.id === user.employeeId
        || issue.collaborators.some(employee => employee.id === user.employeeId)
      )));
  const canMaintainSelected = selected?.workflow?.canEdit ?? canMaintainIssue(selected);
  const queueRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextReturnFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileInputRef = useRef<HTMLInputElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const modalWasOpenRef = useRef(false);
  const handledDirectAlertRef = useRef('');
  const formBaselineRef = useRef(issueFormSnapshot(defaultIssueForm, null));

  const updateIssue = useCallback((issue: IssueDTO): void => {
    setIssues(current => current.some(item => item.id === issue.id)
      ? current.map(item => item.id === issue.id ? issue : item)
      : [issue, ...current]);
    setSelected(issue);
  }, []);

  const loadIssues = useCallback(async (preferredId?: string): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters.overdue) params.set('overdue', 'true');
      if (filters.unassigned) params.set('unassigned', 'true');
      const workOrderId = initialParams.get('workOrderId');
      if (workOrderId) params.set('workOrderId', workOrderId);
      const data = await jsonRequest<IssueListResponse>(`/api/issues?${params.toString()}`);
      setIssues(data.issues);
      setSummary(data.summary);
      setTotalPages(data.pagination.totalPages);
      const desired = preferredId || selected?.id || initialParams.get('issueId') || sessionStorage.getItem('hm-issue-selected') || '';
      const match = data.issues.find(item => item.id === desired);
      const listIsScoped = !!keyword.trim()
        || filters.status !== 'all'
        || filters.type !== 'all'
        || filters.priority !== 'all'
        || !!filters.assigneeId
        || filters.overdue
        || filters.unassigned
        || !!workOrderId;
      if (match) setSelected(match);
      else if (desired && (preferredId || !listIsScoped)) {
        try {
          const detail = await jsonRequest<IssueMutationResponse>(`/api/issues/${encodeURIComponent(desired)}`);
          setSelected(detail.issue || data.issues[0] || null);
        } catch {
          setSelected(data.issues[0] || null);
        }
      } else setSelected(data.issues[0] || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '问题列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, initialParams, keyword, page, selected?.id]);

  const loadDetected = useCallback(async (): Promise<void> => {
    if (!canConvertDetectedIssues) {
      setDetected([]);
      setPendingDetected(0);
      setQueueMode('issues');
      return;
    }
    try {
      const data = await jsonRequest<DetectedResponse>('/api/issues/detected');
      setDetected(data.detected);
      setPendingDetected(data.pendingCount);
      const directWorkOrderId = initialParams.get('sourceWorkOrderId') || '';
      const directAlertCode = initialParams.get('alertCode') || '';
      const direct = data.detected.find(item => item.workOrderId === directWorkOrderId && item.alertCode === directAlertCode);
      if (direct?.existingIssueId && handledDirectAlertRef.current !== direct.fingerprint) {
        handledDirectAlertRef.current = direct.fingerprint;
        const detail = await jsonRequest<IssueMutationResponse>(`/api/issues/${encodeURIComponent(direct.existingIssueId)}`);
        if (detail.issue) updateIssue(detail.issue);
        setQueueMode('issues');
        setToast('该生产异常已有问题单，已为你打开');
      }
    } catch (loadError) {
      setToast(loadError instanceof Error ? loadError.message : '生产异常收件箱加载失败');
    }
  }, [canConvertDetectedIssues, initialParams, updateIssue]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadIssues(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [filters, keyword, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (canConvertDetectedIssues) void loadDetected();
    if (!canCreateIssues && !canUpdateIssues) return;
    jsonRequest<EmployeesResponse>('/api/issues/assignee-options')
      .then(employeeData => setEmployees(employeeData.employees || []))
      .catch(() => setToast('员工档案加载失败'));
  }, [canConvertDetectedIssues, canCreateIssues, canUpdateIssues, loadDetected]);

  useEffect(() => {
    const workOrderId = initialParams.get('workOrderId') || initialParams.get('sourceWorkOrderId') || '';
    if (formOpen && !editingIssue && workOrderId) setForm(current => ({ ...current, workOrderId }));
  }, [editingIssue, formOpen, initialParams]);

  useEffect(() => {
    if (!selected) return;
    sessionStorage.setItem('hm-issue-selected', selected.id);
    const params = new URLSearchParams(window.location.search);
    params.set('issueId', selected.id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }, [selected]);

  useEffect(() => {
    if (!anyContextDirty && !composerContent.trim() && !transition?.comment.trim()) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    const leaving = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.pathname === window.location.pathname) return;
      if (!window.confirm('有未保存的责任信息或操作说明，确定离开并放弃这些修改吗？')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', leaving, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', leaving, true); };
  }, [anyContextDirty, composerContent, transition?.comment]);

  useEffect(() => {
    const element = queueRef.current;
    if (!element) return;
    const saved = Number(sessionStorage.getItem('hm-issue-queue-scroll') || 0);
    element.scrollTop = saved;
    const save = (): void => sessionStorage.setItem('hm-issue-queue-scroll', String(element.scrollTop));
    element.addEventListener('scroll', save, { passive: true });
    return () => element.removeEventListener('scroll', save);
  }, [loading, queueMode]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const sync = (): void => {
      setCompactContext(media.matches);
      setContextOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!contextOpen || !compactContext) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = contextRef.current;
    const focusable = (): HTMLElement[] => panel ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')) : [];
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextOpen(false);
        window.requestAnimationFrame(() => (contextReturnFocusRef.current || contextTriggerRef.current)?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [compactContext, contextOpen]);

  useEffect(() => {
    const panel = contextRef.current;
    if (!panel) return;
    if (compactContext && !contextOpen) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
  }, [compactContext, contextOpen]);

  const closeFormNow = useCallback((): void => {
    setFormOpen(false);
    setEditingIssue(null);
    setForm({ ...defaultIssueForm });
    setNewWorkOrderDraft(null);
    setPendingFiles([]);
    setFormError('');
    setDuplicateIssue(null);
    setConfirmDiscard(false);
    formBaselineRef.current = issueFormSnapshot(defaultIssueForm, null);
  }, [defaultIssueForm]);

  const formIsDirty = useCallback((): boolean => (
    issueFormSnapshot(form, newWorkOrderDraft) !== formBaselineRef.current || pendingFiles.length > 0
  ), [form, newWorkOrderDraft, pendingFiles.length]);

  const requestCloseForm = useCallback((): void => {
    if (saving) return;
    if (formIsDirty()) setConfirmDiscard(true);
    else closeFormNow();
  }, [closeFormNow, formIsDirty, saving]);

  const modalOpen = formOpen || !!transition || !!confirmDelete || !!confirmAttachmentDelete || !!duplicateIssue || confirmDiscard;
  useEffect(() => {
    if (!modalOpen) {
      if (modalWasOpenRef.current) window.requestAnimationFrame(() => modalReturnFocusRef.current?.focus());
      modalWasOpenRef.current = false;
      return;
    }
    modalWasOpenRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialogs = document.querySelectorAll<HTMLElement>('.hm-issue-workbench .issue-modal-backdrop [role="dialog"], .hm-issue-workbench .issue-modal-backdrop [role="alertdialog"]');
    const dialog = dialogs.item(dialogs.length - 1);
    const focusable = (): HTMLElement[] => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')) : [];
    window.requestAnimationFrame(() => {
      if (!(dialog?.contains(document.activeElement))) focusable()[0]?.focus();
    });
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) {
        if (duplicateIssue) setDuplicateIssue(null);
        else if (confirmDiscard) setConfirmDiscard(false);
        else if (confirmAttachmentDelete) setConfirmAttachmentDelete(null);
        else if (confirmDelete) setConfirmDelete(null);
        else if (transition) setTransition(null);
        else if (formOpen) requestCloseForm();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [confirmAttachmentDelete, confirmDelete, confirmDiscard, duplicateIssue, formOpen, modalOpen, requestCloseForm, saving, transition]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function openCreate(): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nextForm = { ...defaultIssueForm, collaboratorEmployeeIds: [] };
    setEditingIssue(null);
    setForm(nextForm);
    setNewWorkOrderDraft(null);
    setPendingFiles([]);
    setFormError('');
    setDuplicateIssue(null);
    formBaselineRef.current = issueFormSnapshot(nextForm, null);
    setFormOpen(true);
  }

  function openEdit(issue: IssueDTO): void {
    if (!canMaintainIssue(issue)) return;
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nextForm = issueFormFrom(issue);
    setEditingIssue(issue);
    setForm(nextForm);
    setNewWorkOrderDraft(null);
    setPendingFiles([]);
    setFormError('');
    setDuplicateIssue(null);
    formBaselineRef.current = issueFormSnapshot(nextForm, null);
    setFormOpen(true);
  }

  function queueAttachments(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const next = [...pendingFiles];
    files.forEach(file => {
      if (!next.some(existing => existing.name === file.name && existing.size === file.size)) next.push(file);
    });
    if (next.length > 8) setToast('一次最多添加 8 个附件，已保留前 8 个');
    setPendingFiles(next.slice(0, 8));
  }

  async function persistForm(allowDuplicate = false): Promise<void> {
    if (!form.title.trim()) { setFormError('请填写问题标题'); return; }
    if (form.type === 'process' && !form.processName.trim()) { setFormError('工艺问题请填写关联工序'); return; }
    if (form.isMajorQuality && form.type !== 'quality') { setFormError('只有质量问题可以标记为重大质量事项'); return; }
    if (form.isMajorQuality && !form.majorQualityReason.trim()) { setFormError('请填写重大质量判定原因'); return; }
    if (newWorkOrderDraft && (!newWorkOrderDraft.code.trim() || !newWorkOrderDraft.productName.trim())) {
      setFormError('待创建工单需要填写工单号和产品名称');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        workOrderId: form.workOrderId || null,
        assigneeEmployeeId: form.assigneeEmployeeId || null,
        collaboratorEmployeeIds: form.collaboratorEmployeeIds.filter(id => id !== form.assigneeEmployeeId),
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        processName: form.type === 'process' ? form.processName.trim() || null : null,
        affectedQuantity: form.type === 'process' && form.affectedQuantity !== '' ? Number(form.affectedQuantity) : null,
        temporaryMeasure: form.type === 'process' ? form.temporaryMeasure.trim() || null : null,
        newWorkOrderDraft: editingIssue ? null : newWorkOrderDraft,
        allowDuplicate,
      };
      const data = await jsonRequest<IssueMutationResponse>(editingIssue ? `/api/issues/${editingIssue.id}` : '/api/issues', {
        method: editingIssue ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ...(editingIssue ? { expectedVersion: editingIssue.version } : {}) }),
      });
      if (!data.issue) throw new Error('问题保存结果为空');
      let savedIssue = data.issue;
      let uploadFailures = 0;
      for (const file of pendingFiles) {
        try {
          const uploadBody = new FormData();
          uploadBody.append('file', file);
          uploadBody.append('category', 'site_original');
          const uploaded = await jsonRequest<IssueMutationResponse>(`/api/issues/${savedIssue.id}/attachments/upload`, { method: 'POST', body: uploadBody });
          if (uploaded.issue) savedIssue = uploaded.issue;
        } catch {
          uploadFailures += 1;
        }
      }
      updateIssue(savedIssue);
      closeFormNow();
      setToast(uploadFailures
        ? `问题已保存，${uploadFailures} 个附件上传失败，可在右侧附件区重试`
        : editingIssue ? '问题信息已更新' : pendingFiles.length ? '问题已创建，附件已同步上传' : '问题已创建');
      await loadIssues(savedIssue.id);
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && saveError.status === 409 && saveError.data.conflictType === 'soft_deleted') {
        setFormError('该工单号存在于回收站，请先恢复原工单，或修改待创建工单的工单号。');
        return;
      }
      if (saveError instanceof ApiRequestError && saveError.status === 409 && saveError.data.existingWorkOrder) {
        const existingWorkOrder = saveError.data.existingWorkOrder as IssueWorkOrderOptionDTO;
        setNewWorkOrderDraft(null);
        setForm(current => ({ ...current, workOrderId: existingWorkOrder.id }));
        setFormError(`工单号“${existingWorkOrder.code}”已存在，已为你选中。请核对后再提交。`);
        return;
      }
      if (saveError instanceof ApiRequestError && saveError.status === 409 && saveError.data.duplicateIssue) {
        setDuplicateIssue(saveError.data.duplicateIssue as DuplicateIssue);
        return;
      }
      setFormError(saveError instanceof Error ? saveError.message : '问题保存失败');
    } finally { setSaving(false); }
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await persistForm(false);
  }

  async function saveContext(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setContextError('');
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          expectedVersion: contextDraft && contextDraft.baseline !== JSON.stringify(serverContext) ? contextDraft.version : selected.version,
          assigneeEmployeeId: contextForm.assigneeEmployeeId || null,
          verifierEmployeeId: contextForm.verifierEmployeeId || null,
          collaboratorEmployeeIds: contextForm.collaboratorEmployeeIds.filter(id => id !== contextForm.assigneeEmployeeId),
          dueAt: contextForm.dueAt ? new Date(contextForm.dueAt).toISOString() : null,
          priority: contextForm.priority,
        }),
      });
      if (data.issue) { discardContextDraft(data.issue.id); updateIssue(data.issue); }
      setToast('责任信息已保存');
    } catch (saveError) { setContextError(saveError instanceof Error ? saveError.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function submitTransition(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !transition) return;
    if (contextDirty) { setTransitionError('责任信息尚未保存，请先保存或放弃修改后再操作'); return; }
    if (selected.id !== transition.issueId) { setTransitionError('当前问题已切换，请取消后重新核对'); return; }
    setSaving(true);
    setTransitionError('');
    setTransitionConflict(false);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: transition.target, expectedVersion: transition.expectedVersion, comment: transition.comment,
          ...(transition.target === 'verifying' ? { rootCause: transition.rootCause, solution: transition.solution } : {}),
          ...(transition.target === 'awaiting_confirmation' ? { verificationResult: transition.verificationResult } : {}),
        }),
      });
      if (data.issue) updateIssue(data.issue);
      setTransition(null);
      setOperationResult(`${data.issue?.code || selected.code} ${transition.target === 'closed' ? '已完结并归档' : `已更新为${statusLabels[transition.target]}`}`);
      await loadIssues(data.issue?.id);
    } catch (failure) {
      const requestId = failure instanceof ApiRequestError ? failure.data.requestId : null;
      setTransitionError(`${failure instanceof Error ? failure.message : '提交失败，请重试'}${requestId ? `（追踪号：${String(requestId)}）` : ''}`);
      setTransitionConflict(failure instanceof ApiRequestError && failure.data.code === 'ISSUE_VERSION_CONFLICT');
    }
    finally { setSaving(false); }
  }

  async function refreshTransition(): Promise<void> {
    if (!transition) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${transition.issueId}`);
      if (!data.issue) throw new Error('问题记录未找到');
      const latest = data.issue;
      updateIssue(latest);
      if (!latest.workflow?.actions.some(action => action.target === transition.target && action.allowed)) {
        setTransitionError('当前问题阶段或操作资格已变化，请取消并重新选择下一步');
        return;
      }
      setTransition(current => current ? { ...current, expectedVersion: latest.version, rootCause: latest.rootCause || '', solution: latest.solution || '', verificationResult: latest.verificationResult || '' } : null);
      setTransitionConflict(false);
      setTransitionError('');
    } catch (failure) { setTransitionError(failure instanceof Error ? failure.message : '刷新失败，原输入已保留'); }
    finally { setSaving(false); }
  }

  async function submitCollaboration(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !composerContent.trim()) return;
    if (composerMode === 'task' && !composerAssigneeEmployeeId) {
      setToast('请选择待办负责人');
      return;
    }
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: composerMode,
          content: composerContent,
          assigneeEmployeeId: composerMode === 'task' ? composerAssigneeEmployeeId : null,
          dueAt: composerMode !== 'comment' && composerDueAt ? new Date(composerDueAt).toISOString() : null,
        }),
      });
      if (data.issue) updateIssue(data.issue);
      setComposerContent('');
      setComposerAssigneeEmployeeId('');
      setComposerDueAt('');
      setToast(composerMode === 'task' ? '协同待办已创建并通知负责人' : composerMode === 'decision' ? '协同决策已发起' : '协同回复已发布');
    } catch (commentError) { setToast(commentError instanceof Error ? commentError.message : '协同记录保存失败'); }
    finally { setSaving(false); }
  }

  async function actOnCollaboration(
    kind: 'task_complete' | 'decision_response',
    targetActivityId: string,
    decision?: 'approve' | 'return',
  ): Promise<void> {
    if (!selected) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, targetActivityId, decision }),
      });
      if (data.issue) updateIssue(data.issue);
      setToast(kind === 'task_complete' ? '待办已完成并同步协同人' : decision === 'approve' ? '决策已通过' : '决策已退回');
    } catch (activityError) {
      setToast(activityError instanceof Error ? activityError.message : '协同操作失败');
    } finally {
      setSaving(false);
    }
  }

  async function uploadAttachment(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!selected || !file) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('category', attachmentCategory);
      if (attachmentCaption.trim()) body.append('caption', attachmentCaption.trim());
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/attachments/upload`, { method: 'POST', body });
      if (data.issue) updateIssue(data.issue);
      setAttachmentCaption('');
      setToast(`附件已归入“${attachmentCategoryLabels[attachmentCategory]}”`);
    } catch (uploadError) { setToast(uploadError instanceof Error ? uploadError.message : '附件上传失败'); }
    finally { setSaving(false); }
  }

  async function deleteAttachment(): Promise<void> {
    if (!selected || !confirmAttachmentDelete) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/attachments/${confirmAttachmentDelete.id}`, { method: 'DELETE' });
      if (data.issue) updateIssue(data.issue);
      setConfirmAttachmentDelete(null);
      setToast('附件已删除');
    } catch (deleteError) { setToast(deleteError instanceof Error ? deleteError.message : '附件删除失败'); }
    finally { setSaving(false); }
  }

  async function deleteIssue(): Promise<void> {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await jsonRequest<{ ok: boolean }>(`/api/issues/${confirmDelete.id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      setSelected(null);
      setToast('问题已删除');
      await loadIssues();
      await loadDetected();
    } catch (deleteError) { setToast(deleteError instanceof Error ? deleteError.message : '问题删除失败'); }
    finally { setSaving(false); }
  }

  async function convertDetected(item: DetectedIssueDTO): Promise<void> {
    if (item.existingIssueId) {
      const existing = issues.find(issue => issue.id === item.existingIssueId);
      if (existing) setSelected(existing);
      else {
        try {
          const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${item.existingIssueId}`);
          if (data.issue) updateIssue(data.issue);
        } catch (loadError) { setToast(loadError instanceof Error ? loadError.message : '问题详情加载失败'); }
      }
      setQueueMode('issues');
      return;
    }
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>('/api/issues/from-production-alert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workOrderId: item.workOrderId, alertCode: item.alertCode }),
      });
      if (data.issue) updateIssue(data.issue);
      setQueueMode('issues');
      setToast(data.created ? '生产异常已转为问题' : '该异常已有问题单，已为你打开');
      await Promise.all([loadIssues(data.issue?.id), loadDetected()]);
    } catch (convertError) { setToast(convertError instanceof Error ? convertError.message : '转问题失败'); }
    finally { setSaving(false); }
  }

  function beginTransition(target: IssueStatus): void {
    if (!selected) return;
    if (contextDirty) { setContextError('请先保存或放弃未保存的责任信息，再推进流程'); openContext(); return; }
    if (!selected.workflow?.actions.some(action => action.target === target && action.allowed)) return;
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTransitionError('');
    setTransitionConflict(false);
    setTransition({
      issueId: selected.id, expectedVersion: selected.version,
      target,
      rootCause: selected?.rootCause || '',
      solution: selected?.solution || '',
      verificationResult: selected?.verificationResult || '',
      comment: '',
    });
  }

  function openIssueDelete(issue: IssueDTO): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmDelete(issue);
  }

  function openAttachmentDelete(id: string, name: string): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmAttachmentDelete({ id, name });
  }

  function selectIssue(issue: IssueDTO): void {
    setOperationResult('');
    setContextError('');
    setSelected(issue);
    setDetailBranch('overview');
    setAttachmentCaption('');
    if (window.matchMedia('(max-width: 760px)').matches) setContextOpen(false);
  }

  async function classifyAttachment(file: IssueAttachmentDTO, category: IssueAttachmentCategory): Promise<void> {
    if (!selected || category === file.category) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/attachments/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, caption: file.caption || '', version: file.version }),
      });
      if (data.issue) updateIssue(data.issue);
      setToast(`附件已移入“${attachmentCategoryLabels[category]}”`);
    } catch (classifyError) {
      setToast(classifyError instanceof Error ? classifyError.message : '附件分类更新失败');
    } finally {
      setSaving(false);
    }
  }

  function openContext(): void {
    contextReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContextOpen(true);
  }

  function closeContext(): void {
    setContextOpen(false);
    window.requestAnimationFrame(() => (contextReturnFocusRef.current || contextTriggerRef.current)?.focus());
  }

  const sourceWorkOrderId = initialParams.get('sourceWorkOrderId') || '';
  const activeDetected = detected.filter(item => !item.existingIssueId).sort((first, second) => Number(second.workOrderId === sourceWorkOrderId) - Number(first.workOrderId === sourceWorkOrderId));
  const employeeGroups = useMemo(() => {
    const grouped = new Map<string, IssueAssigneeOptionDTO[]>();
    employees.filter(item => item.isActive).forEach(employee => {
      const department = employee.department?.trim() || '未设置部门';
      grouped.set(department, [...(grouped.get(department) || []), employee]);
    });
    return Array.from(grouped.entries()).sort(([first], [second]) => first.localeCompare(second, 'zh-CN'));
  }, [employees]);

  const queueGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; hint: string; items: IssueDTO[] }> = [
      { key: 'mine', label: '待我处理', hint: '需要我推进的处理任务', items: [] },
      { key: 'waiting', label: '等待他人', hint: '协同处理中', items: [] },
      { key: 'verifying', label: '待我验证', hint: '需要我核对验证依据', items: [] },
      { key: 'confirmation', label: '待我确认', hint: '验证通过，需要我确认完结', items: [] },
      { key: 'closed', label: '已完结问题库', hint: '按问题类型归档', items: [] },
    ];
    issues.forEach(issue => {
      if (issue.status === 'closed') groups[4].items.push(issue);
      else if (issue.workflow?.currentTaskForUser === 'confirmation') groups[3].items.push(issue);
      else if (issue.workflow?.currentTaskForUser === 'verifying') groups[2].items.push(issue);
      else if (issue.status === 'awaiting_confirmation' || issue.status === 'verifying') groups[1].items.push(issue);
      else {
        const mine = issue.workflow?.actions.some(action => action.allowed) && (issue.reporter?.id === user.id
          || issue.assignee?.id === user.employeeId
          || issue.verifier?.id === user.employeeId
          || issue.collaborators.some(employee => employee.id === user.employeeId));
        groups[mine ? 0 : 1].items.push(issue);
      }
    });
    return [groups[0], groups[2], groups[3], groups[1], groups[4]].filter(group => group.items.length);
  }, [issues, user.employeeId, user.id]);

  const completedTaskIds = useMemo(() => new Set(
    (selected?.activities || [])
      .filter(activity => activity.action === 'task_complete')
      .map(activity => String(activity.detail?.targetActivityId || ''))
      .filter(Boolean),
  ), [selected?.activities]);
  const respondedDecisionIds = useMemo(() => new Set(
    (selected?.activities || [])
      .filter(activity => activity.action === 'decision_approve' || activity.action === 'decision_return')
      .map(activity => String(activity.detail?.targetActivityId || ''))
      .filter(Boolean),
  ), [selected?.activities]);
  const openTaskCount = (selected?.activities || [])
    .filter(activity => activity.action === 'task_create' && !completedTaskIds.has(activity.id)).length;
  const openDecisionCount = (selected?.activities || [])
    .filter(activity => activity.action === 'decision_create' && !respondedDecisionIds.has(activity.id)).length;
  const closureChecklist = selected?.workflow?.checklist || [];
  const closureReady = closureChecklist.every(item => item.done);
  const transitionAction = selected?.workflow?.actions.find(action => action.target === transition?.target);
  const visibleActivities = useMemo(() => {
    const activities = selected?.activities || [];
    if (detailBranch === 'logs') return activities;
    if (detailBranch === 'overview') return activities.slice(-5);
    if (detailBranch === 'collaboration') {
      return activities.filter(activity => ['comment', 'task_create', 'task_complete'].includes(activity.action) || activity.action.startsWith('decision_'));
    }
    if (detailBranch === 'decisions') {
      return activities.filter(activity => activity.action.startsWith('decision_')
        || activity.action.startsWith('major_quality_')
        || activity.action === 'transition');
    }
    return [];
  }, [detailBranch, selected?.activities]);
  const attachmentGroups = useMemo(() => Object.entries(attachmentCategoryLabels).map(([category, label]) => ({
    category: category as IssueAttachmentCategory,
    label,
    files: (selected?.attachments || []).filter(file => file.category === category),
  })), [selected?.attachments]);
  const lifecycleStatuses: IssueStatus[] = ['pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'];
  const lifecycleIndex = selected ? lifecycleStatuses.indexOf(selected.status) : 0;
  const mainBranch = detailBranch === 'files' || detailBranch === 'logs' ? detailBranch : 'overview';

  return (
    <main className={`hm-issue-workbench issue-case-room hm-workbench-root hm-cockpit-root hm-workbench-navigation-overlay ${contextOpen ? '' : 'context-collapsed'}`}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/issues"
        subtitle="生产、计划与技术问题闭环"
        menuItems={[
          { label: '操作日志', href: '/dashboard?openLogs=1' },
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
        hideHeader
        sidebarTriggerTargetId="issue-navigation-trigger"
      />

      <div className="issue-workbench-main">
        <WorkbenchCockpitCommand
          navigationTargetId="issue-navigation-trigger"
          icon={<ShieldCheck size={19} />}
          title="问题协同作战室"
          subtitle="从反馈、协同处理、独立验证到发起人确认完结，全程共享、可追溯"
          context={<><span>{summary.processing} 条处理中</span><span>{summary.awaiting_confirmation} 条待发起人确认</span><span>{summary.overdue} 条逾期</span>{canConvertDetectedIssues && <span>{pendingDetected} 条待转问题</span>}</>}
          search={<label><Search size={16} aria-hidden="true" /><input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索问题、工单、规格、客户" aria-label="搜索问题" />{keyword ? <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}</label>}
          actions={<>
            {initialParams.get('returnTo') && <a className="hm-workbench-button issue-return-link" href={initialParams.get('returnTo') || '/production'}><ArrowLeft size={15} />返回生产执行</a>}
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={15} />筛选</button>
            <button ref={contextTriggerRef} type="button" disabled={!selected} aria-expanded={contextOpen} onClick={openContext}><ShieldCheck size={15} />闭环控制台</button>
            <button className="icon-only" type="button" aria-label="刷新问题" title="刷新" disabled={loading} onClick={() => { void (canConvertDetectedIssues ? Promise.all([loadIssues(), loadDetected()]) : loadIssues()); }}><RefreshCw className={loading ? 'spin' : ''} size={15} /></button>
            {canCreateIssues ? <button className="primary" type="button" onClick={openCreate}><Plus size={16} />新建问题</button> : <Link className="primary" href="/workspace/approvals"><ClipboardCheck size={16} />重大审批</Link>}
          </>}
        />

        <section className="issue-summary hm-cockpit-stage-rail" aria-label="问题状态概览">
          {([
            ['all', '全部问题', summary.total], ['pending', '待受理', summary.pending], ['processing', '处理中', summary.processing],
            ['verifying', '待验证', summary.verifying], ['awaiting_confirmation', '待发起人确认', summary.awaiting_confirmation],
            ['closed', '已关闭', summary.closed], ['overdue', '已逾期', summary.overdue],
          ] as const).map(([key, label, count]) => {
            const active = key === 'all' ? filters.status === 'all' && !filters.overdue : key === 'overdue' ? filters.overdue : filters.status === key;
            return <button className={`${key} ${active ? 'active' : ''}`} type="button" aria-pressed={active} key={key} onClick={() => {
              setFilters(current => key === 'overdue' ? { ...current, status: 'all', overdue: true } : { ...current, status: key as Filters['status'], overdue: false }); setPage(1);
            }}><span>{label}</span><strong>{count}</strong></button>;
          })}
          {canConvertDetectedIssues && <button className={`detected ${queueMode === 'detected' ? 'active' : ''}`} type="button" aria-pressed={queueMode === 'detected'} onClick={() => setQueueMode('detected')}><span>待转问题</span><strong>{pendingDetected}</strong></button>}
        </section>

        {filters.status === 'closed' && <section className="issue-archive-filter" aria-label="已完结问题分类">
          <div><strong>已完结问题库</strong><span>关闭后保留完整流程、责任、验证和文件快照</span></div>
          <nav>{(['all', ...Object.keys(typeLabels)] as Array<'all' | IssueType>).map(type => <button type="button" className={filters.type === type ? 'active' : ''} key={type} onClick={() => { setFilters(current => ({ ...current, type })); setPage(1); }}>{type === 'all' ? '全部分类' : typeLabels[type]}</button>)}</nav>
        </section>}

        <section className={`issue-filter-bar issue-filter-drawer ${filtersOpen ? 'open' : ''}`} aria-label="问题筛选" aria-hidden={!filtersOpen}>
          <select value={filters.type} aria-label="问题类型" onChange={event => { setFilters(current => ({ ...current, type: event.target.value as Filters['type'] })); setPage(1); }}><option value="all">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select value={filters.priority} aria-label="优先级" onChange={event => { setFilters(current => ({ ...current, priority: event.target.value as Filters['priority'] })); setPage(1); }}><option value="all">全部优先级</option>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select value={filters.assigneeId} aria-label="负责人" onChange={event => { setFilters(current => ({ ...current, assigneeId: event.target.value, unassigned: false })); setPage(1); }}><option value="">全部负责人</option>{employeeGroups.map(([department, list]) => <optgroup label={department} key={department}>{list.map(item => <option value={item.id} key={item.id}>{item.name} · {item.employeeNo}</option>)}</optgroup>)}</select>
          <button className={filters.unassigned ? 'active' : ''} type="button" aria-pressed={filters.unassigned} onClick={() => setFilters(current => ({ ...current, unassigned: !current.unassigned, assigneeId: '' }))}>未分派 {summary.unassigned}</button>
          <button type="button" onClick={() => { setFilters({ ...emptyFilters }); setKeyword(''); setPage(1); }}>清除筛选</button>
          <span>{queueMode === 'issues' ? `当前 ${issues.length} 条` : `待转 ${activeDetected.length} 条`}</span>
        </section>

        <div className="issue-workspace-grid">
          <section className="issue-queue" aria-label="问题队列">
            <div className="issue-queue-tabs" role="tablist" aria-label="问题来源">
              <button className={queueMode === 'issues' ? 'active' : ''} type="button" role="tab" aria-selected={queueMode === 'issues'} onClick={() => setQueueMode('issues')}><ClipboardCheck size={15} />问题队列 <em>{summary.total}</em></button>
              {canConvertDetectedIssues && <button className={queueMode === 'detected' ? 'active' : ''} type="button" role="tab" aria-selected={queueMode === 'detected'} onClick={() => setQueueMode('detected')}><Inbox size={15} />异常收件箱 <em>{pendingDetected}</em></button>}
            </div>
            <div ref={queueRef} className="issue-queue-scroll hm-scroll-region" tabIndex={0}>
              {loading && queueMode === 'issues' && <div className="issue-loading"><Loader2 className="spin" />正在加载问题</div>}
              {!loading && error && <div className="issue-empty error"><AlertCircle /><strong>加载失败</strong><p>{error}</p><button type="button" onClick={() => { void loadIssues(); }}>重试</button></div>}
              {!loading && !error && queueMode === 'issues' && !issues.length && <div className="issue-empty"><CheckCircle2 /><strong>当前筛选下没有问题</strong><p>{canCreateIssues ? (canConvertDetectedIssues ? '可以新建问题，或从异常收件箱将生产异常转入。' : processIssueMode ? '可以新建工艺问题并进入闭环处理。' : '可以新建生产问题并进入闭环处理。') : '当前没有可查看的问题记录。'}</p>{canCreateIssues && <button type="button" onClick={openCreate}>新建问题</button>}</div>}
              {queueMode === 'issues' && queueGroups.map(group => <section className="case-queue-group" key={group.key}>
                <header><div><strong>{group.label}</strong><span>{group.hint}</span></div><em>{group.items.length}</em></header>
                {group.items.map(issue => (
                  <button className={`issue-card ${selected?.id === issue.id ? 'active' : ''} priority-${issue.priority}`} type="button" aria-pressed={selected?.id === issue.id} key={issue.id} onClick={() => selectIssue(issue)}>
                    <span className={`issue-status status-${issue.status}`}>{statusLabels[issue.status]}</span><em className={`priority-${issue.priority}`}>{priorityLabels[issue.priority]}</em>
                    <strong title={issue.title}>{issue.title}</strong>
                    <p title={`${issue.workOrder?.customerName || '未关联客户'} · ${issue.workOrder?.specification || issue.sourceCode || issue.code}`}>{issue.workOrder?.customerName || '未关联客户'} · {issue.workOrder?.specification || issue.sourceCode || issue.code}</p>
                    <footer><span>{issue.code}</span><span>{issue.assignee?.name || '未分派'}{issue.collaborators.length ? ` +${issue.collaborators.length}` : ''}</span><time className={issue.isOverdue ? 'overdue' : ''}>{issue.dueAt ? formatDate(issue.dueAt, false) : '无截止时间'}</time></footer>
                  </button>
                ))}
              </section>)}
              {queueMode === 'detected' && !activeDetected.length && <div className="issue-empty"><CheckCircle2 /><strong>没有待转异常</strong><p>当前生产异常已转为问题，或暂时没有命中异常规则。</p></div>}
              {queueMode === 'detected' && activeDetected.map(item => (
                <article className={`detected-card tone-${item.tone}`} key={item.id}>
                  <header><span>{item.label}</span><em>待转问题</em></header>
                  <strong title={item.specification || item.workOrderCode}>{item.specification || item.workOrderCode}</strong>
                  <p>{item.customerName || '客户未设置'} · {item.productName}</p>
                   <footer><a href={item.sourceRoute}>查看生产现场 <ExternalLink size={13} /></a>{canConvertDetectedIssues && <button type="button" disabled={saving} onClick={() => { void convertDetected(item); }}>转为问题</button>}</footer>
                </article>
              ))}
            </div>
            {queueMode === 'issues' && totalPages > 1 && <div className="issue-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
          </section>

          <section className="issue-detail" aria-label="问题处理详情">
            {!selected ? <div className="issue-detail-empty"><MessageSquareText /><h2>选择一个问题开始处理</h2><p>{canConvertDetectedIssues ? '左侧可选择问题，或从异常收件箱转入生产异常。' : processIssueMode ? '左侧可选择问题，或新建工艺问题进入闭环处理。' : '左侧可选择问题，或新建生产问题进入闭环处理。'}</p></div> : <>
              <header className="issue-detail-header">
                <div><span>{selected.code} · {typeLabels[selected.type]}{selected.isMajorQuality && <em className="issue-major-chip">重大质量</em>}</span><h2 title={selected.title}>{selected.title}</h2><p>{sourceLabel(selected)} · 创建于 {formatDate(selected.createdAt)}</p></div>
                <div><span className={`issue-status status-${selected.status}`}>{statusLabels[selected.status]}</span>{selected.majorApproval && <span className={`issue-approval-state state-${selected.majorApproval.status.toLowerCase()}`}>{majorApprovalStatusLabels[selected.majorApproval.status]}</span>}{!selectedContentLocked && canMaintainSelected && <button type="button" aria-label="编辑问题" title="编辑问题" onClick={() => openEdit(selected)}><Pencil size={16} /></button>}{selected.status !== 'closed' && !selected.majorApproval && canDeleteIssues && <button className="danger" type="button" aria-label="删除问题" title="删除问题" onClick={() => openIssueDelete(selected)}><Trash2 size={16} /></button>}</div>
              </header>

              <nav className="issue-detail-branches" aria-label="问题内容分支">
                {detailBranches.map(branch => <button type="button" className={mainBranch === branch.key ? 'active' : ''} aria-current={mainBranch === branch.key ? 'page' : undefined} key={branch.key} onClick={() => setDetailBranch(branch.key)}><strong>{branch.label}</strong><span>{branch.hint}</span></button>)}
              </nav>

              <div className="issue-detail-scroll hm-scroll-region">
                {operationResult && <p className="issue-operation-result" role="status"><CheckCircle2 size={18} />{operationResult}</p>}
                <IssueCurrentTask issue={selected} accountName={user.displayName || user.username} saving={saving} dirty={contextDirty} onAction={beginTransition} onContext={openContext} onEvidence={() => setDetailBranch('files')} />
                {mainBranch === 'overview' && <div className="issue-workflow-tools">
                  <button type="button" aria-pressed={detailBranch === 'overview'} onClick={() => setDetailBranch('overview')}>解决情况</button>
                  {canMaintainSelected && !selectedContentLocked && <button type="button" onClick={() => openEdit(selected)}>编辑原因与措施</button>}
                  <button type="button" aria-pressed={detailBranch === 'collaboration'} onClick={() => setDetailBranch('collaboration')}>协同事项 · {openTaskCount + openDecisionCount} 待处理</button>
                  <button type="button" aria-pressed={detailBranch === 'verification'} onClick={() => setDetailBranch('verification')}>验证与确认详情</button>
                </div>}
                {selected.status === 'closed' && <section className="issue-archive-banner"><div><ShieldCheck size={18} /><p><strong>已归档至“{typeLabels[selected.type]}”</strong><span>{selected.requesterConfirmedAt ? '内容只读，完整保留验证、发起人确认与文件历史。' : '历史关闭记录已只读归档；新流程将额外记录发起人确认。'}</span></p></div><time>完结于 {formatDate(selected.closedAt)}</time></section>}

                {detailBranch === 'overview' && <section className="case-room-intro">
                  <header><span>问题提出</span><time>{formatDate(selected.createdAt)}</time></header>
                  <p>{selected.description || '尚未填写问题描述。'}</p>
                  <dl>
                    <div><dt>来源</dt><dd>{sourceLabel(selected)}</dd></div>
                    <div><dt>影响工序</dt><dd>{selected.processName || selected.workOrder?.productName || '待确认'}</dd></div>
                    <div><dt>影响数量</dt><dd>{selected.affectedQuantity ?? '待确认'}</dd></div>
                    <div><dt>当前责任</dt><dd>{selected.assignee?.name || '待分派'}</dd></div>
                  </dl>
                  {selected.temporaryMeasure && <aside><AlertTriangle size={15} /><div><strong>现场临时措施</strong><p>{selected.temporaryMeasure}</p></div></aside>}
                </section>}

                {(detailBranch === 'overview' || detailBranch === 'analysis') && <section className="case-resolution-strip" aria-label="闭环关键结论">
                  <article className={selected.rootCause ? 'complete' : ''}><span>01</span><div><strong>原因分析</strong><p>{selected.rootCause || '待负责人补充根因'}</p></div></article>
                  <article className={selected.solution ? 'complete' : ''}><span>02</span><div><strong>处理方案</strong><p>{selected.solution || '待形成可执行方案'}</p></div></article>
                  <article className={selected.workflow?.verification.kind !== 'missing' ? 'complete' : ''}><span>03</span><div><strong>验证结论</strong><p>{selected.workflow?.verification.text || '待验证人填写结论'}</p></div></article>
                </section>}

                {detailBranch === 'verification' && <section className="case-verification-branch">
                  <header><div><span>验证与关闭</span><h3>{selected.status === 'closed' ? selected.requesterConfirmedAt ? '发起人已确认完结' : '历史关闭记录' : selected.status === 'awaiting_confirmation' ? '等待发起人确认' : '验证流程进行中'}</h3></div><strong className={`status-${selected.status}`}>{statusLabels[selected.status]}</strong></header>
                  <div className="case-verification-grid">
                    <article><span>独立验证人</span><strong>{selected.verifier?.name || (selected.isMajorQuality ? '质量复核与总经办终审' : '尚未指定')}</strong><small>{selected.verifiedAt ? `验证完成 ${formatDate(selected.verifiedAt)}` : '尚未完成验证'}</small></article>
                    <article><span>验证结论</span><strong>{selected.workflow?.verification.text || '尚未填写验证结论'}</strong><small>验证通过后不会直接关闭，必须由发起人确认</small></article>
                    <article><span>问题发起人</span><strong>{selected.reporter?.displayName || selected.reporter?.username || '未知发起人'}</strong><small>{selected.requesterConfirmedAt ? `确认于 ${formatDate(selected.requesterConfirmedAt)}` : '尚未确认完结'}</small></article>
                    <article><span>完结说明</span><strong>{selected.requesterConfirmationNote || (selected.requesterConfirmedAt ? '发起人确认问题已闭环' : selected.status === 'closed' ? '迁移前历史关闭记录，无发起人确认字段' : '等待发起人核对')}</strong><small>{selected.requesterConfirmedBy ? `操作人 ${selected.requesterConfirmedBy.displayName || selected.requesterConfirmedBy.username}` : '管理员代操作将显示真实操作账号'}</small></article>
                  </div>
                </section>}

                {detailBranch === 'files' && <section className="case-file-branch">
                  <header><div><span>文件与证据</span><h3>按流程用途归档</h3></div><strong>{selected.attachmentCount} 个文件</strong></header>
                  {canMaintainSelected && !selectedContentLocked && <div className="case-file-upload-bar"><select value={attachmentCategory} onChange={event => setAttachmentCategory(event.target.value as IssueAttachmentCategory)}>{Object.entries(attachmentCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input value={attachmentCaption} maxLength={500} onChange={event => setAttachmentCaption(event.target.value)} placeholder="文件说明（选填）" /><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Plus size={14} />上传到当前分类</button></div>}
                  <div className="case-file-groups">{attachmentGroups.map(group => <article className={group.files.length ? '' : 'empty'} key={group.category}><header><strong>{group.label}</strong><span>{group.files.length}</span></header><div>{group.files.map(file => <section key={file.id}><span>{file.fileType === 'pdf' ? <FileText /> : <FileImage />}</span><div><strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong><small>{file.caption || `${formatBytes(file.size)} · ${formatDate(file.createdAt)}`}</small>{canMaintainSelected && !selectedContentLocked && <select className="case-file-category-select" aria-label={`调整 ${file.displayName || file.originalName} 的分类`} value={file.category} disabled={saving} onChange={event => { void classifyAttachment(file, event.target.value as IssueAttachmentCategory); }}>{Object.entries(attachmentCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>}</div><em>{statusLabels[file.stage]}</em><a href={file.contentUrl} target="_blank" rel="noreferrer" title="预览"><ExternalLink size={14} /></a><a href={file.downloadUrl} title="下载"><Download size={14} /></a>{canDeleteIssues && !selectedContentLocked && <button type="button" title="删除附件" onClick={() => openAttachmentDelete(file.id, file.displayName || file.originalName)}><Trash2 size={14} /></button>}</section>)}{!group.files.length && <p>暂无{group.label}</p>}</div></article>)}</div>
                </section>}

                {(['collaboration', 'decisions', 'logs'] as DetailBranch[]).includes(detailBranch) && <section className="case-room-stream">
                  <header><div><h3>{detailBranch === 'overview' ? '最近动态' : detailBranch === 'collaboration' ? '协同任务与回复' : detailBranch === 'decisions' ? '决策与审批记录' : '全量审计日志'}</h3><span>{detailBranch === 'logs' ? `完整保留 ${selected.activityCount} 条记录` : '所有部门共享同一条记录'}</span></div><div><em>{openTaskCount} 待办</em><em>{openDecisionCount} 决策待定</em></div></header>
                  <div className="case-stream-list">
                    {visibleActivities.map(activity => {
                      const attachmentId = String(activity.detail?.attachmentId || '');
                      const evidence = selected.attachments?.find(file => file.id === attachmentId);
                      const assignedEmployeeId = String(activity.detail?.assigneeEmployeeId || '');
                      const taskAssignee = employees.find(employee => employee.id === assignedEmployeeId);
                      const taskDone = completedTaskIds.has(activity.id);
                      const decisionDone = respondedDecisionIds.has(activity.id);
                      const decisionResponse = selected.activities?.find(item =>
                        (item.action === 'decision_approve' || item.action === 'decision_return')
                        && item.detail?.targetActivityId === activity.id);
                      return <article className={`case-stream-event action-${activity.action}`} key={activity.id}>
                        <span className="case-stream-avatar">{(activity.actor?.displayName || activity.actor?.username || '系').slice(0, 1)}</span>
                        <div className="case-stream-body">
                          <header><div><strong>{activity.actor?.displayName || activity.actor?.username || '系统'}</strong><span>{activityLabels[activity.action] || activity.action}</span></div><time>{formatDate(activity.createdAt)}</time></header>
                          {activity.fromStatus && activity.toStatus && <div className="case-status-change"><span>{statusLabels[activity.fromStatus]}</span><ChevronRight size={13} /><strong>{statusLabels[activity.toStatus]}</strong></div>}
                          {activity.content && <p>{activity.content}</p>}
                          {activity.action === 'task_create' && <section className={`case-task-card ${taskDone ? 'done' : ''}`}>
                            <div><ListChecks size={17} /><div><strong>{taskDone ? '待办已完成' : '协同待办'}</strong><span>负责人 {taskAssignee?.name || String(activity.detail?.assigneeName || '待确认')} · 截止 {formatDate(String(activity.detail?.dueAt || ''))}</span></div></div>
                            {!taskDone && canMaintainSelected && ['pending', 'processing'].includes(selected.status) && <button type="button" disabled={saving} onClick={() => { void actOnCollaboration('task_complete', activity.id); }}><Check size={14} />标记完成</button>}
                          </section>}
                          {activity.action === 'decision_create' && <section className={`case-decision-card ${decisionDone ? 'done' : ''}`}>
                            <div><ThumbsUp size={17} /><div><strong>{decisionDone ? '决策已有结论' : '等待协同决策'}</strong><span>{decisionResponse ? `${activityLabels[decisionResponse.action]} · ${decisionResponse.actor?.displayName || decisionResponse.actor?.username || '系统'}` : `截止 ${formatDate(String(activity.detail?.dueAt || ''))}`}</span></div></div>
                            {!decisionDone && canMaintainSelected && ['pending', 'processing'].includes(selected.status) && <div><button type="button" disabled={saving} onClick={() => { void actOnCollaboration('decision_response', activity.id, 'return'); }}><RotateCcw size={13} />退回</button><button className="primary" type="button" disabled={saving} onClick={() => { void actOnCollaboration('decision_response', activity.id, 'approve'); }}><Check size={13} />通过</button></div>}
                          </section>}
                          {evidence && <a className="case-evidence-card" href={evidence.contentUrl} target="_blank" rel="noreferrer">
                            {evidence.fileType === 'image' ? <Image src={evidence.contentUrl} alt={evidence.displayName || evidence.originalName} width={220} height={124} unoptimized /> : <span><FileText size={24} /></span>}
                            <div><strong>{evidence.displayName || evidence.originalName}</strong><small>{formatBytes(evidence.size)} · 查看原始凭证</small></div>
                          </a>}
                        </div>
                      </article>;
                    })}
                    {!visibleActivities.length && <p className="timeline-empty">当前分支暂无记录</p>}
                  </div>
                </section>}
              </div>

              {detailBranch === 'collaboration' && canMaintainSelected && selected.status !== 'closed' && !selectedMajorFinalApproved && <form className="case-room-composer" onSubmit={submitCollaboration}>
                <div className="case-composer-tabs" role="tablist" aria-label="协同记录类型">
                  <button className={composerMode === 'comment' ? 'active' : ''} type="button" role="tab" aria-selected={composerMode === 'comment'} onClick={() => setComposerMode('comment')}><MessageSquareText size={14} />回复</button>
                  <button className={composerMode === 'task' ? 'active' : ''} type="button" role="tab" aria-selected={composerMode === 'task'} disabled={!['pending', 'processing'].includes(selected.status)} onClick={() => setComposerMode('task')}><ListChecks size={14} />创建待办</button>
                  <button className={composerMode === 'decision' ? 'active' : ''} type="button" role="tab" aria-selected={composerMode === 'decision'} disabled={!['pending', 'processing'].includes(selected.status)} onClick={() => setComposerMode('decision')}><ThumbsUp size={14} />发起决策</button>
                </div>
                {composerMode === 'task' && <div className="case-composer-meta"><div><span>负责人</span><EmployeePicker employees={employees} value={composerAssigneeEmployeeId} disabled={saving} onChange={setComposerAssigneeEmployeeId} /></div><label>截止时间<input type="datetime-local" value={composerDueAt} onChange={event => setComposerDueAt(event.target.value)} /></label></div>}
                {composerMode === 'decision' && <div className="case-composer-meta decision"><label>决策截止时间<input type="datetime-local" value={composerDueAt} onChange={event => setComposerDueAt(event.target.value)} /></label><p>协同人可直接在时间线通过或退回，结论永久留痕。</p></div>}
                <div className="case-composer-input"><textarea value={composerContent} onChange={event => setComposerContent(event.target.value)} rows={2} maxLength={2000} placeholder={composerMode === 'task' ? '写清交付物、完成标准和需要上传的证据…' : composerMode === 'decision' ? '说明需要确认的方案、风险和决策边界…' : '回复处理进展，可 @ 协同人并补充现场事实…'} /><button type="button" aria-label="上传凭证" title="上传凭证" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button><button className="primary" type="submit" disabled={saving || !composerContent.trim() || (composerMode === 'task' && !composerAssigneeEmployeeId)}><Send size={15} />发布</button></div>
              </form>}
              <div className="issue-transition-actions case-transition-actions">
                {selected.isMajorQuality && selected.status === 'verifying' && <Link className="issue-approval-link" href={`/workspace/approvals?approvalId=${encodeURIComponent(selected.majorApproval?.id || '')}`}>打开重大审批</Link>}
                <button type="button" onClick={contextOpen ? closeContext : openContext}><UsersRound size={16} />{contextOpen ? '收起责任信息' : '责任信息与关联资料'}</button>
              </div>
            </>}
          </section>

          <button className={`issue-context-scrim ${contextOpen ? 'open' : ''}`} type="button" aria-label="关闭责任与来源面板" onClick={closeContext} />
          <aside ref={contextRef} className={`issue-context ${contextOpen ? 'open' : ''}`} aria-label="问题责任与来源" aria-hidden={compactContext && !contextOpen}>
            <header><div><span>闭环控制台</span><strong>{selected?.code || '未选择问题'}</strong></div><button type="button" aria-label="关闭闭环控制台" title="关闭" onClick={closeContext}><X size={18} /></button></header>
            {!selected ? <div className="issue-context-empty">选择问题后查看闭环门槛、责任链和关联应用。</div> : <div className="issue-context-scroll hm-scroll-region">
              <section className="case-lifecycle context-section">
                <header><div><h3><ShieldCheck size={15} />流程进度</h3><span>第 {lifecycleIndex + 1}/{lifecycleStatuses.length} 阶段</span></div><strong>{statusLabels[selected.status]}</strong></header>
                <div className="case-lifecycle-track">{lifecycleStatuses.map((status, index) => {
                  return <div className={index <= lifecycleIndex ? 'complete' : ''} key={status}><span>{index < lifecycleIndex ? <Check size={12} /> : index + 1}</span><em>{statusLabels[status]}</em></div>;
                })}</div>
              </section>

              <details className="case-closure-checklist context-section" open={selected.status === 'pending' || selected.status === 'processing'}><summary>提交验证前的资料清单{!['pending', 'processing'].includes(selected.status) && '（历史阶段）'}</summary>
                <header><h3><ListChecks size={15} />提交验证准备度</h3><em className={closureReady ? 'ready' : ''}>{closureReady ? '资料已齐' : '有阻塞项'}</em></header>
                <div>{closureChecklist.map(item => <article className={item.done ? 'done' : ''} key={item.key}><span>{item.done ? <Check size={13} /> : <Circle size={13} />}</span><strong>{item.label}</strong></article>)}</div>
              </details>

              <section className="context-section responsibility case-responsibility">
                <h3><UsersRound size={15} />责任与验证</h3>{contextDirty && <p className="issue-draft-notice">有未保存修改 · 切换问题时保留草稿</p>}{contextError && <div className="issue-action-error" role="alert"><p>{contextError}</p><button type="button" onClick={() => { discardContextDraft(selected.id); void loadIssues(selected.id); }}>放弃草稿并载入最新记录</button></div>}
                <div className="context-picker-field"><span>问题负责人</span><EmployeePicker fallbackLabel={selected.assignee?.name} employees={employees} value={contextForm.assigneeEmployeeId} disabled={saving || !canMaintainSelected || selectedContentLocked} onChange={value => setContextForm(current => ({ ...current, assigneeEmployeeId: value, collaboratorEmployeeIds: current.collaboratorEmployeeIds.filter(id => id !== value) }))} /></div>
                <div className="context-picker-field"><span>独立验证人</span><EmployeePicker label="验证人" fallbackLabel={selected.verifier?.name} employees={employees} value={contextForm.verifierEmployeeId} disabled={saving || !canMaintainSelected || selectedContentLocked || selected.isMajorQuality} onChange={value => setContextForm(current => ({ ...current, verifierEmployeeId: value }))} /></div>
                <div className="context-picker-field collaborators"><span>协同人员</span><EmployeeMultiPicker employees={employees} values={contextForm.collaboratorEmployeeIds} excludeIds={contextForm.assigneeEmployeeId ? [contextForm.assigneeEmployeeId] : []} disabled={saving || !canMaintainSelected || selectedContentLocked} onChange={values => setContextForm(current => ({ ...current, collaboratorEmployeeIds: values }))} /></div>
                <div className="case-responsibility-grid"><label>优先级<select disabled={saving || !canMaintainSelected || selectedContentLocked} value={contextForm.priority} onChange={event => setContextForm(current => ({ ...current, priority: event.target.value as IssuePriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>截止时间<input type="datetime-local" disabled={saving || !canMaintainSelected || selectedContentLocked} value={contextForm.dueAt} onChange={event => setContextForm(current => ({ ...current, dueAt: event.target.value }))} /></label></div>
                {canMaintainSelected && !selectedContentLocked && <button className="primary" type="button" disabled={saving || !contextDirty} onClick={() => { void saveContext(); }}>保存责任信息</button>}{contextDirty && <button type="button" disabled={saving} onClick={() => discardContextDraft(selected.id)}>放弃未保存修改</button>}
                {selectedContentLocked && <p className="issue-context-lock-note">{selectedApprovalPending ? '审批进行中，责任信息和附件已锁定；可继续追加协同记录。' : selectedMajorFinalApproved && selected.status !== 'closed' ? '重大质量终审已通过，正文和证据已锁定；等待发起人确认完结或退回整改。' : '问题已由发起人确认完结并只读归档；如需整改，请先重新打开问题。'}</p>}
              </section>

              <section className="case-linked-apps context-section">
                <header><h3><ArrowLeftRight size={15} />关联应用</h3><span>同一业务数据</span></header>
                <div>
                  {selected.workOrder && <a href={`/production?workOrderId=${encodeURIComponent(selected.workOrder.id)}`}><span><FileText size={15} /></span><div><strong>生产执行</strong><small>{selected.workOrder.specification || selected.workOrder.code}</small></div><ExternalLink size={13} /></a>}
                  {selected.workOrder && <a href={`/drawing-library?workOrderId=${encodeURIComponent(selected.workOrder.id)}`}><span><FileImage size={15} /></span><div><strong>图纸资料库</strong><small>{selected.workOrder.drawingStatus || '资料状态待确认'}</small></div><ExternalLink size={13} /></a>}
                  <a href={`/workspace/quality/8d?issueId=${encodeURIComponent(selected.id)}`}><span><FileArchive size={15} /></span><div><strong>8D PDF档案</strong><small>查看或关联本问题的8D报告</small></div><ExternalLink size={13} /></a>
                  <a href={`/workspace/changes?action=new&issueId=${encodeURIComponent(selected.id)}`}><span><GitPullRequestArrow size={15} /></span><div><strong>变更管理</strong><small>从本问题发起受控变更</small></div><ExternalLink size={13} /></a>
                  {selected.isMajorQuality && <a href={`/workspace/approvals?approvalId=${encodeURIComponent(selected.majorApproval?.id || '')}`}><span><ClipboardCheck size={15} /></span><div><strong>重大审批</strong><small>{selected.majorApproval ? majorApprovalStatusLabels[selected.majorApproval.status] : '尚未提交'}</small></div><ExternalLink size={13} /></a>}
                </div>
              </section>

              <section className="context-section attachments case-evidence-library"><header><h3><Paperclip size={15} />文件与证据 <em>{selected.attachmentCount}</em></h3>{canMaintainSelected && !selectedContentLocked && <><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Plus size={14} />上传</button><input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={uploadAttachment} /></>}</header>
                {canMaintainSelected && !selectedContentLocked && <div className="context-file-classifier"><select aria-label="附件分类" value={attachmentCategory} onChange={event => setAttachmentCategory(event.target.value as IssueAttachmentCategory)}>{Object.entries(attachmentCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input aria-label="附件说明" value={attachmentCaption} maxLength={500} onChange={event => setAttachmentCaption(event.target.value)} placeholder="文件说明（选填）" /></div>}
                <div>{selected.attachments?.map(file => <article key={file.id}><span>{file.fileType === 'pdf' ? <FileText /> : <FileImage />}</span><div><strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong><small>{attachmentCategoryLabels[file.category]} · {file.caption || formatDate(file.createdAt)}</small></div><a href={file.contentUrl} target="_blank" rel="noreferrer" aria-label={`预览 ${file.displayName || file.originalName}`} title="预览"><ExternalLink size={14} /></a><a href={file.downloadUrl} aria-label={`下载 ${file.displayName || file.originalName}`} title="下载"><Download size={14} /></a>{canDeleteIssues && !selectedContentLocked && <button type="button" aria-label={`删除 ${file.displayName || file.originalName}`} title="删除附件" onClick={() => openAttachmentDelete(file.id, file.displayName || file.originalName)}><Trash2 size={14} /></button>}</article>)}{!selected.attachments?.length && <p className="attachment-empty">{canMaintainSelected && !selectedContentLocked ? '选择分类后上传现场照片、分析资料、复测记录或 PDF。' : '当前没有文件与证据。'}</p>}</div>
              </section>
            </div>}
          </aside>
        </div>
      </div>

      {formOpen && <div className="issue-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) requestCloseForm(); }}><form className="issue-modal issue-modal-large" role="dialog" aria-modal="true" aria-labelledby="issue-form-title" onSubmit={saveForm}>
        <header><div><span>{editingIssue ? '编辑问题 · 协同闭环' : '新建问题 · 协同闭环'}</span><h2 id="issue-form-title">{editingIssue ? `${editingIssue.code} · 更新问题信息` : '记录需要协同处理的问题'}</h2><p>关联工单、明确责任人并保留处理凭证，后续状态和操作全程留痕。</p></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={requestCloseForm}><X size={19} /></button></header>
        <div className="issue-modal-body hm-scroll-region">
          <section className="issue-form-section overview">
            <header><div><strong>问题概况</strong><span>先说明发生了什么以及影响程度</span></div><em>01</em></header>
            <div className="issue-form-grid">
              <label className="wide">问题标题<input value={form.title} maxLength={160} autoFocus onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="一句话说明问题及影响" /></label>
              <label>问题类型<select value={form.type} disabled={processIssueMode} onChange={event => setForm(current => { const type = event.target.value as IssueType; return { ...current, type, isMajorQuality: type === 'quality' ? current.isMajorQuality : false, majorQualityReason: type === 'quality' ? current.majorQualityReason : '' }; })}>{(processIssueMode ? [form.type] : Object.keys(typeLabels) as IssueType[]).map(value => <option value={value} key={value}>{typeLabels[value]}</option>)}</select></label>
              <label>优先级<select value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value as IssuePriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>截止时间<input type="datetime-local" value={form.dueAt} onChange={event => setForm(current => ({ ...current, dueAt: event.target.value }))} /></label>
              {!processIssueMode && form.type === 'quality' && <div className="issue-major-quality-control wide"><label className="issue-major-toggle"><input type="checkbox" checked={form.isMajorQuality} onChange={event => setForm(current => ({ ...current, isMajorQuality: event.target.checked, majorQualityReason: event.target.checked ? current.majorQualityReason : '' }))} /><span><AlertTriangle size={17} /><b>标记为重大质量事项</b><small>提交验证后，必须由另一名质量人员复核，再由总经办终审。</small></span></label>{form.isMajorQuality && <label>重大判定原因<textarea rows={3} required maxLength={1000} value={form.majorQualityReason} onChange={event => setForm(current => ({ ...current, majorQualityReason: event.target.value }))} placeholder="说明重大影响、风险范围及需要升级审批的原因" /></label>}</div>}
            </div>
          </section>

          <section className="issue-form-section relation">
            <header><div><strong>关联与责任</strong><span>可搜索、复制工单编号，员工直接同步人事档案</span></div><em>02</em></header>
            <div className="issue-form-grid">
              <div className="issue-form-field wide"><span>关联工单</span><WorkOrderPicker value={form.workOrderId} initialSelected={issueWorkOrderOptionFromIssue(editingIssue)} newWorkOrderDraft={newWorkOrderDraft} allowCreate={!editingIssue && !processIssueMode} disabled={saving} onCopied={setToast} onNewWorkOrderDraftChange={setNewWorkOrderDraft} onChange={value => setForm(current => ({ ...current, workOrderId: value }))} /></div>
              <div className="issue-form-field"><span>主负责人</span><EmployeePicker employees={employees} value={form.assigneeEmployeeId} disabled={saving} onChange={value => setForm(current => ({ ...current, assigneeEmployeeId: value, collaboratorEmployeeIds: current.collaboratorEmployeeIds.filter(id => id !== value) }))} /></div>
              <div className="issue-form-field"><span>协同人员（可多选）</span><EmployeeMultiPicker employees={employees} values={form.collaboratorEmployeeIds} excludeIds={form.assigneeEmployeeId ? [form.assigneeEmployeeId] : []} disabled={saving} onChange={values => setForm(current => ({ ...current, collaboratorEmployeeIds: values }))} /></div>
            </div>
          </section>

          {form.type === 'process' && <section className="issue-form-section process-fields">
            <header><div><strong>工艺问题信息</strong><span>用于定位具体工序、影响数量和现场临时措施</span></div><em>03</em></header>
            <div className="issue-form-grid">
              <label>关联工序<input value={form.processName} maxLength={120} onChange={event => setForm(current => ({ ...current, processName: event.target.value }))} placeholder="例如：裁线、压接、热缩" /></label>
              <label>影响数量（选填）<input type="number" min="0" step="1" value={form.affectedQuantity} onChange={event => setForm(current => ({ ...current, affectedQuantity: event.target.value }))} placeholder="0" /></label>
              <label className="wide">临时措施（选填）<textarea rows={3} value={form.temporaryMeasure} maxLength={2000} onChange={event => setForm(current => ({ ...current, temporaryMeasure: event.target.value }))} placeholder="说明现场临时控制、隔离或替代处理方式" /></label>
            </div>
          </section>}

          <section className="issue-form-section detail-fields">
            <header><div><strong>问题说明与凭证</strong><span>描述现象、影响范围，并可在创建前添加附件</span></div><em>{form.type === 'process' ? '04' : '03'}</em></header>
            <div className="issue-form-grid">
              <label className="wide">问题描述<textarea rows={4} value={form.description} maxLength={4000} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="说明现象、影响范围、已知事实和需要协同的事项" /></label>
              <div className="issue-form-field wide pending-attachments">
                <div className="pending-attachment-head"><span>附件（选填）</span><button type="button" disabled={saving || pendingFiles.length >= 8} onClick={() => pendingFileInputRef.current?.click()}><Plus size={14} />添加凭证</button><input ref={pendingFileInputRef} type="file" multiple hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={queueAttachments} /></div>
                <p>支持 PDF、JPG、PNG、WEBP；创建成功后直接上传到对象存储，不会永久保存在本机。</p>
                {!!pendingFiles.length && <div className="pending-file-list">{pendingFiles.map((file, index) => <article key={`${file.name}-${file.size}`}><span>{file.type === 'application/pdf' ? <FileText /> : <FileImage />}</span><div><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button type="button" aria-label={`移除附件 ${file.name}`} title="移除附件" onClick={() => setPendingFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button></article>)}</div>}
              </div>
            </div>
          </section>

          {editingIssue && <section className="issue-form-section resolution-fields">
            <header><div><strong>处理结论</strong><span>编辑已有问题时可补充原因、方案和验证结果</span></div><em>{form.type === 'process' ? '05' : '04'}</em></header>
            <div className="issue-form-grid"><label className="wide">原因分析<textarea rows={3} value={form.rootCause} maxLength={4000} onChange={event => setForm(current => ({ ...current, rootCause: event.target.value }))} /></label><label className="wide">处理方案<textarea rows={3} value={form.solution} maxLength={4000} onChange={event => setForm(current => ({ ...current, solution: event.target.value }))} /></label><label className="wide">验证结果<textarea rows={3} value={form.verificationResult} maxLength={4000} onChange={event => setForm(current => ({ ...current, verificationResult: event.target.value }))} /></label></div>
          </section>}
          {formError && <p className="issue-form-error" role="alert">{formError}</p>}
        </div>
        <footer><span>{newWorkOrderDraft ? '将同时创建 1 个待补资料工单' : form.assigneeEmployeeId ? '已明确主负责人' : '负责人可稍后补充'} · {form.collaboratorEmployeeIds.length} 名协同人 · {pendingFiles.length} 个待上传附件</span><div><button type="button" disabled={saving} onClick={requestCloseForm}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={15} />}{editingIssue ? '保存修改' : newWorkOrderDraft ? '创建问题与工单' : '创建问题'}</button></div></footer>
      </form></div>}

      {duplicateIssue && <div className="issue-modal-backdrop"><section className="issue-confirm duplicate-warning" role="alertdialog" aria-modal="true" aria-labelledby="issue-duplicate-title"><AlertTriangle /><h2 id="issue-duplicate-title">发现可能重复的问题</h2><p>{duplicateIssue.code} · {duplicateIssue.title}</p><span>同一工单下已有相同标题或工序的未关闭问题。建议先打开核对，确有不同再继续创建。</span><footer><button type="button" disabled={saving} onClick={() => { setDuplicateIssue(null); closeFormNow(); setQueueMode('issues'); void loadIssues(duplicateIssue.id); }}>打开已有问题</button><button className="danger" type="button" disabled={saving} onClick={() => { setDuplicateIssue(null); void persistForm(true); }}>仍然创建</button></footer></section></div>}
      {confirmDiscard && <div className="issue-modal-backdrop"><section className="issue-confirm discard-warning" role="alertdialog" aria-modal="true" aria-labelledby="issue-discard-title"><AlertTriangle /><h2 id="issue-discard-title">放弃未保存的修改？</h2><p>表单内容或待上传附件尚未保存</p><span>关闭后这些修改不会保留，已经存在的问题和附件不会受到影响。</span><footer><button type="button" onClick={() => setConfirmDiscard(false)}>继续编辑</button><button className="danger" type="button" onClick={closeFormNow}>放弃修改</button></footer></section></div>}

      {transition && selected && <div className="issue-modal-backdrop"><form className="issue-modal transition-modal" role="dialog" aria-modal="true" aria-labelledby="issue-transition-title" onSubmit={submitTransition}>
        <header><div><span>{selected.code} · {statusLabels[selected.status]}</span><h2 id="issue-transition-title">{transitionAction?.label || '核对当前操作'}</h2></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={() => setTransition(null)}><X size={19} /></button></header>
        <div className="issue-modal-body">
          <div className="issue-confirm-summary"><strong>当前待办人：{selected.workflow?.waitingFor}</strong><span>本次操作人：{user.displayName || user.username}</span>{selected.workflow?.verification.kind !== 'missing' && <p>{selected.workflow?.verification.text}</p>}</div>
          {transition.target === 'verifying' && selected.isMajorQuality && <p className="issue-task-notice">将提交第 {(selected.majorApproval?.round || 0) + 1} 轮重大质量审批，依次进行质量复核及总经办终审。</p>}
          {transition.target === 'verifying' && <><label className="wide">原因分析<textarea autoFocus required maxLength={4000} rows={3} value={transition.rootCause} onChange={event => setTransition(current => current ? { ...current, rootCause: event.target.value } : current)} /></label><label className="wide">处理措施<textarea required maxLength={4000} rows={3} value={transition.solution} onChange={event => setTransition(current => current ? { ...current, solution: event.target.value } : current)} /></label></>}
          {transition.target === 'awaiting_confirmation' && <label className="wide">验证结果<textarea autoFocus required maxLength={4000} rows={4} value={transition.verificationResult} onChange={event => setTransition(current => current ? { ...current, verificationResult: event.target.value } : current)} placeholder="填写验证方法、样本、结果与通过依据" /></label>}
          {transition.target === 'closed' && <p className="issue-confirm-warning">请核对处理结果与验证依据。提交成功后问题将只读归档，并记录本次实际确认人和时间。</p>}
          <label className="wide">操作说明{transitionAction?.requiresComment ? '（必填）' : '（选填）'}<textarea required={transitionAction?.requiresComment} autoFocus={transition.target === 'processing' || transition.target === 'closed'} maxLength={2000} rows={3} value={transition.comment} onChange={event => setTransition(current => current ? { ...current, comment: event.target.value } : current)} placeholder={transitionAction?.adminOverride ? '请填写管理员操作原因，真实账号将记入审计' : transition.target === 'processing' ? '说明退回或重新打开的原因' : '补充本次确认说明'} /></label>
          {transitionError && <div className="issue-action-error" role="alert"><strong>本次操作未完成</strong><p>{transitionError}</p>{transitionConflict && <button type="button" disabled={saving} onClick={() => { void refreshTransition(); }}>载入最新资料并重新核对</button>}</div>}
        </div>
        <footer><button type="button" disabled={saving} onClick={() => setTransition(null)}>取消</button><button className="primary" type="submit" disabled={saving || !transitionAction?.allowed || transitionConflict}>{saving ? '正在提交…' : transitionAction?.label || '确认操作'}</button></footer>
      </form></div>}

      {confirmDelete && <div className="issue-modal-backdrop"><section className="issue-confirm" role="alertdialog" aria-modal="true" aria-labelledby="issue-delete-title"><AlertTriangle /><h2 id="issue-delete-title">确认删除问题？</h2><p>{confirmDelete.code} · {confirmDelete.title}</p><span>问题将被软删除，关联工单和 S3 附件原文件不会被物理删除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteIssue(); }}>确认删除</button></footer></section></div>}
      {confirmAttachmentDelete && <div className="issue-modal-backdrop"><section className="issue-confirm" role="alertdialog" aria-modal="true" aria-labelledby="issue-attachment-delete-title"><AlertTriangle /><h2 id="issue-attachment-delete-title">确认删除附件？</h2><p title={confirmAttachmentDelete.name}>{confirmAttachmentDelete.name}</p><span>附件记录将被软删除，对象存储中的原文件不会立即物理清除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmAttachmentDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteAttachment(); }}>确认删除</button></footer></section></div>}
    </main>
  );
}
