'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  GitPullRequestArrow,
  Inbox,
  Info,
  Loader2,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import type {
  CurrentUserDTO,
  DetectedIssueDTO,
  IssueDTO,
  IssuePriority,
  IssueStatus,
  IssueSummaryDTO,
  IssueType,
  UserDTO,
  WorkOrderDTO,
} from '@/types';

type IssueManagementShellProps = { user: CurrentUserDTO };
type QueueMode = 'issues' | 'detected';
type IssueListResponse = { ok: boolean; issues: IssueDTO[]; summary: IssueSummaryDTO; pagination: { page: number; pageSize: number; total: number; totalPages: number }; error?: string };
type DetectedResponse = { ok: boolean; detected: DetectedIssueDTO[]; pendingCount: number; error?: string };
type UsersResponse = { ok: boolean; users: UserDTO[]; error?: string };
type WorkOrdersResponse = { workOrders?: WorkOrderDTO[]; error?: string; message?: string };
type IssueMutationResponse = { ok: boolean; issue?: IssueDTO; error?: string; created?: boolean };

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
  assigneeId: string;
  dueAt: string;
  rootCause: string;
  solution: string;
  verificationResult: string;
};

type TransitionState = { target: IssueStatus; solution: string; verificationResult: string; comment: string };
type AttachmentDeleteState = { id: string; name: string };

const statusLabels: Record<IssueStatus, string> = { pending: '待受理', processing: '处理中', verifying: '待验证', closed: '已关闭' };
const priorityLabels: Record<IssuePriority, string> = { urgent: '紧急', high: '高', normal: '一般' };
const typeLabels: Record<IssueType, string> = { production: '生产问题', planning: '计划问题', technical: '技术问题', quality: '质量问题', material: '物料问题', equipment: '设备问题', other: '其他' };
const activityLabels: Record<string, string> = {
  create: '创建问题', create_from_source: '由生产异常转入', restore_from_source: '从来源恢复',
  update: '更新问题信息', assign: '更新负责人', transition: '状态流转', comment: '处理记录',
  upload_attachment: '上传附件', delete_attachment: '删除附件', delete: '删除问题',
};
const emptySummary: IssueSummaryDTO = { total: 0, pending: 0, processing: 0, verifying: 0, closed: 0, overdue: 0, unassigned: 0 };
const emptyFilters: Filters = { status: 'all', type: 'all', priority: 'all', assigneeId: '', overdue: false, unassigned: false };
const emptyForm: IssueFormState = { title: '', type: 'production', priority: 'normal', description: '', workOrderId: '', assigneeId: '', dueAt: '', rootCause: '', solution: '', verificationResult: '' };

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
  if (issue.sourceType === 'manual') return issue.workOrder ? '工单人工创建' : '人工创建';
  return issue.sourceType || '人工创建';
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || '请求失败');
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
    assigneeId: issue.assignee?.id || '',
    dueAt: localDateTime(issue.dueAt),
    rootCause: issue.rootCause || '',
    solution: issue.solution || '',
    verificationResult: issue.verificationResult || '',
  };
}

export default function IssueManagementShell({ user }: IssueManagementShellProps) {
  const routeSearchParams = useSearchParams();
  const initialParams = useMemo(() => new URLSearchParams(routeSearchParams.toString()), [routeSearchParams]);
  const [keyword, setKeyword] = useState(initialParams.get('keyword') || '');
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    status: (['pending', 'processing', 'verifying', 'closed'].includes(initialParams.get('status') || '') ? initialParams.get('status') : 'all') as Filters['status'],
    overdue: initialParams.get('overdue') === 'true',
  }));
  const [queueMode, setQueueMode] = useState<QueueMode>(initialParams.get('inbox') === 'detected' ? 'detected' : 'issues');
  const [issues, setIssues] = useState<IssueDTO[]>([]);
  const [summary, setSummary] = useState<IssueSummaryDTO>(emptySummary);
  const [detected, setDetected] = useState<DetectedIssueDTO[]>([]);
  const [pendingDetected, setPendingDetected] = useState(0);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderDTO[]>([]);
  const [selected, setSelected] = useState<IssueDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(initialParams.get('action') === 'new');
  const [editingIssue, setEditingIssue] = useState<IssueDTO | null>(null);
  const [form, setForm] = useState<IssueFormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [comment, setComment] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [compactContext, setCompactContext] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<IssueDTO | null>(null);
  const [confirmAttachmentDelete, setConfirmAttachmentDelete] = useState<AttachmentDeleteState | null>(null);
  const [contextForm, setContextForm] = useState({ assigneeId: '', dueAt: '', priority: 'normal' as IssuePriority });
  const queueRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextReturnFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const modalWasOpenRef = useRef(false);
  const handledDirectAlertRef = useRef('');

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
      if (match) setSelected(match);
      else if (desired) {
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
  }, [initialParams, updateIssue]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadIssues(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [filters, keyword, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadDetected();
    Promise.all([
      jsonRequest<UsersResponse>('/api/users'),
      jsonRequest<WorkOrdersResponse>('/api/work-orders'),
    ]).then(([userData, orderData]) => {
      setUsers(userData.users || []);
      setWorkOrders(orderData.workOrders || []);
    }).catch(() => setToast('负责人或工单选项加载失败'));
  }, [loadDetected]);

  useEffect(() => {
    const workOrderId = initialParams.get('workOrderId') || initialParams.get('sourceWorkOrderId') || '';
    if (formOpen && !editingIssue && workOrderId) setForm(current => ({ ...current, workOrderId }));
  }, [editingIssue, formOpen, initialParams]);

  useEffect(() => {
    if (!selected) return;
    sessionStorage.setItem('hm-issue-selected', selected.id);
    setContextForm({ assigneeId: selected.assignee?.id || '', dueAt: localDateTime(selected.dueAt), priority: selected.priority });
    const params = new URLSearchParams(window.location.search);
    params.set('issueId', selected.id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }, [selected]);

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
    const sync = (): void => setCompactContext(media.matches);
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const modalOpen = formOpen || !!transition || !!confirmDelete || !!confirmAttachmentDelete;
  useEffect(() => {
    if (!modalOpen) {
      if (modalWasOpenRef.current) window.requestAnimationFrame(() => modalReturnFocusRef.current?.focus());
      modalWasOpenRef.current = false;
      return;
    }
    modalWasOpenRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>('.hm-issue-workbench .issue-modal-backdrop [role="dialog"], .hm-issue-workbench .issue-modal-backdrop [role="alertdialog"]');
    const focusable = (): HTMLElement[] => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')) : [];
    window.requestAnimationFrame(() => {
      if (!(dialog?.contains(document.activeElement))) focusable()[0]?.focus();
    });
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) {
        if (confirmAttachmentDelete) setConfirmAttachmentDelete(null);
        else if (confirmDelete) setConfirmDelete(null);
        else if (transition) setTransition(null);
        else if (formOpen) setFormOpen(false);
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
  }, [confirmAttachmentDelete, confirmDelete, formOpen, modalOpen, saving, transition]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function openCreate(): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingIssue(null);
    setForm({ ...emptyForm });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(issue: IssueDTO): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingIssue(issue);
    setForm(issueFormFrom(issue));
    setFormError('');
    setFormOpen(true);
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.title.trim()) { setFormError('请填写问题标题'); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload = { ...form, workOrderId: form.workOrderId || null, assigneeId: form.assigneeId || null, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null };
      const data = await jsonRequest<IssueMutationResponse>(editingIssue ? `/api/issues/${editingIssue.id}` : '/api/issues', {
        method: editingIssue ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!data.issue) throw new Error('问题保存结果为空');
      updateIssue(data.issue);
      setFormOpen(false);
      setToast(editingIssue ? '问题信息已更新' : '问题已创建');
      await loadIssues(data.issue.id);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '问题保存失败');
    } finally { setSaving(false); }
  }

  async function saveContext(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          assigneeId: contextForm.assigneeId || null,
          dueAt: contextForm.dueAt ? new Date(contextForm.dueAt).toISOString() : null,
          priority: contextForm.priority,
        }),
      });
      if (data.issue) updateIssue(data.issue);
      setToast('责任信息已保存');
    } catch (saveError) { setToast(saveError instanceof Error ? saveError.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function submitTransition(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !transition) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transition),
      });
      if (data.issue) updateIssue(data.issue);
      setTransition(null);
      setToast(`问题已流转为${statusLabels[transition.target]}`);
      await loadIssues(data.issue?.id);
    } catch (transitionError) { setToast(transitionError instanceof Error ? transitionError.message : '状态流转失败'); }
    finally { setSaving(false); }
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    setSaving(true);
    try {
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/activities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: comment }),
      });
      if (data.issue) updateIssue(data.issue);
      setComment('');
      setToast('处理记录已添加');
    } catch (commentError) { setToast(commentError instanceof Error ? commentError.message : '处理记录保存失败'); }
    finally { setSaving(false); }
  }

  async function uploadAttachment(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!selected || !file) return;
    setSaving(true);
    try {
      const body = new FormData(); body.append('file', file);
      const data = await jsonRequest<IssueMutationResponse>(`/api/issues/${selected.id}/attachments/upload`, { method: 'POST', body });
      if (data.issue) updateIssue(data.issue);
      setToast('附件已上传');
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
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTransition({ target, solution: selected?.solution || '', verificationResult: selected?.verificationResult || '', comment: '' });
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
    setSelected(issue);
    if (window.matchMedia('(max-width: 760px)').matches) setContextOpen(false);
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
  const workOrderOptions = useMemo(() => workOrders.slice().sort((a, b) => (a.specification || a.code).localeCompare(b.specification || b.code, 'zh-CN')), [workOrders]);

  return (
    <main className="hm-issue-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/issues"
        subtitle="生产、计划与技术问题闭环"
        menuItems={[
          { label: '操作日志', href: '/dashboard?openLogs=1' },
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
        searchSlot={(
          <label className="issue-header-search">
            <Search size={17} aria-hidden="true" />
            <input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索问题、工单、规格、客户..." aria-label="搜索问题" />
            {keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={15} /></button>}
          </label>
        )}
        utilityActions={<button className="hm-workbench-button primary issue-new-header" type="button" onClick={openCreate}><Plus size={16} />新建问题</button>}
      />

      <div className="issue-workbench-main">
        <WorkbenchPageHeader
          kicker="协同闭环"
          title="问题管理"
          description="统一承接生产异常、计划与技术问题，完成受理、处理、验证和关闭。"
          titleId="issue-workbench-title"
          actions={<>
            {initialParams.get('returnTo') && <a className="hm-workbench-button issue-return-link" href={initialParams.get('returnTo') || '/production'}><ArrowLeft size={15} />返回生产执行</a>}
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => { void Promise.all([loadIssues(), loadDetected()]); }}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
            <button ref={contextTriggerRef} className="hm-workbench-button issue-context-trigger" type="button" disabled={!selected} aria-expanded={contextOpen} onClick={openContext}><Info size={15} />责任与来源</button>
          </>}
        />

        <section className="issue-summary" aria-label="问题状态概览">
          {([
            ['all', '全部问题', summary.total], ['pending', '待受理', summary.pending], ['processing', '处理中', summary.processing],
            ['verifying', '待验证', summary.verifying], ['closed', '已关闭', summary.closed], ['overdue', '已逾期', summary.overdue],
          ] as const).map(([key, label, count]) => {
            const active = key === 'all' ? filters.status === 'all' && !filters.overdue : key === 'overdue' ? filters.overdue : filters.status === key;
            return <button className={`${key} ${active ? 'active' : ''}`} type="button" aria-pressed={active} key={key} onClick={() => {
              setFilters(current => key === 'overdue' ? { ...current, status: 'all', overdue: true } : { ...current, status: key as Filters['status'], overdue: false }); setPage(1);
            }}><span>{label}</span><strong>{count}</strong></button>;
          })}
          <button className={`detected ${queueMode === 'detected' ? 'active' : ''}`} type="button" aria-pressed={queueMode === 'detected'} onClick={() => setQueueMode('detected')}><span>待转问题</span><strong>{pendingDetected}</strong></button>
        </section>

        <section className="issue-filter-bar" aria-label="问题筛选">
          <select value={filters.type} aria-label="问题类型" onChange={event => { setFilters(current => ({ ...current, type: event.target.value as Filters['type'] })); setPage(1); }}><option value="all">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select value={filters.priority} aria-label="优先级" onChange={event => { setFilters(current => ({ ...current, priority: event.target.value as Filters['priority'] })); setPage(1); }}><option value="all">全部优先级</option>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select value={filters.assigneeId} aria-label="负责人" onChange={event => { setFilters(current => ({ ...current, assigneeId: event.target.value, unassigned: false })); setPage(1); }}><option value="">全部负责人</option>{users.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select>
          <button className={filters.unassigned ? 'active' : ''} type="button" aria-pressed={filters.unassigned} onClick={() => setFilters(current => ({ ...current, unassigned: !current.unassigned, assigneeId: '' }))}>未分派 {summary.unassigned}</button>
          <button type="button" onClick={() => { setFilters({ ...emptyFilters }); setKeyword(''); setPage(1); }}>清除筛选</button>
          <span>{queueMode === 'issues' ? `当前 ${issues.length} 条` : `待转 ${activeDetected.length} 条`}</span>
        </section>

        <div className="issue-workspace-grid">
          <section className="issue-queue" aria-label="问题队列">
            <div className="issue-queue-tabs" role="tablist" aria-label="问题来源">
              <button className={queueMode === 'issues' ? 'active' : ''} type="button" role="tab" aria-selected={queueMode === 'issues'} onClick={() => setQueueMode('issues')}><ClipboardCheck size={15} />问题队列 <em>{summary.total}</em></button>
              <button className={queueMode === 'detected' ? 'active' : ''} type="button" role="tab" aria-selected={queueMode === 'detected'} onClick={() => setQueueMode('detected')}><Inbox size={15} />异常收件箱 <em>{pendingDetected}</em></button>
            </div>
            <div ref={queueRef} className="issue-queue-scroll hm-scroll-region" tabIndex={0}>
              {loading && queueMode === 'issues' && <div className="issue-loading"><Loader2 className="spin" />正在加载问题</div>}
              {!loading && error && <div className="issue-empty error"><AlertCircle /><strong>加载失败</strong><p>{error}</p><button type="button" onClick={() => { void loadIssues(); }}>重试</button></div>}
              {!loading && !error && queueMode === 'issues' && !issues.length && <div className="issue-empty"><CheckCircle2 /><strong>当前筛选下没有问题</strong><p>可以新建问题，或从异常收件箱将生产异常转入。</p><button type="button" onClick={openCreate}>新建问题</button></div>}
              {queueMode === 'issues' && issues.map(issue => (
                <button className={`issue-card ${selected?.id === issue.id ? 'active' : ''} priority-${issue.priority}`} type="button" aria-pressed={selected?.id === issue.id} key={issue.id} onClick={() => selectIssue(issue)}>
                  <span className={`issue-status status-${issue.status}`}>{statusLabels[issue.status]}</span><em className={`priority-${issue.priority}`}>{priorityLabels[issue.priority]}</em>
                  <strong title={issue.title}>{issue.title}</strong>
                  <p title={`${issue.workOrder?.customerName || '未关联客户'} · ${issue.workOrder?.specification || issue.sourceCode || issue.code}`}>{issue.workOrder?.customerName || '未关联客户'} · {issue.workOrder?.specification || issue.sourceCode || issue.code}</p>
                  <footer><span>{issue.code}</span><span>{issue.assignee?.displayName || issue.assignee?.username || '未分派'}</span><time className={issue.isOverdue ? 'overdue' : ''}>{issue.dueAt ? formatDate(issue.dueAt, false) : '无截止时间'}</time></footer>
                </button>
              ))}
              {queueMode === 'detected' && !activeDetected.length && <div className="issue-empty"><CheckCircle2 /><strong>没有待转异常</strong><p>当前生产异常已转为问题，或暂时没有命中异常规则。</p></div>}
              {queueMode === 'detected' && activeDetected.map(item => (
                <article className={`detected-card tone-${item.tone}`} key={item.id}>
                  <header><span>{item.label}</span><em>待转问题</em></header>
                  <strong title={item.specification || item.workOrderCode}>{item.specification || item.workOrderCode}</strong>
                  <p>{item.customerName || '客户未设置'} · {item.productName}</p>
                  <footer><a href={item.sourceRoute}>查看生产现场 <ExternalLink size={13} /></a><button type="button" disabled={saving} onClick={() => { void convertDetected(item); }}>转为问题</button></footer>
                </article>
              ))}
            </div>
            {queueMode === 'issues' && totalPages > 1 && <div className="issue-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
          </section>

          <section className="issue-detail" aria-label="问题处理详情">
            {!selected ? <div className="issue-detail-empty"><MessageSquareText /><h2>选择一个问题开始处理</h2><p>左侧可选择问题，或从异常收件箱转入生产异常。</p></div> : <>
              <header className="issue-detail-header">
                <div><span>{selected.code} · {typeLabels[selected.type]}</span><h2 title={selected.title}>{selected.title}</h2><p>{sourceLabel(selected)} · 创建于 {formatDate(selected.createdAt)}</p></div>
                <div><span className={`issue-status status-${selected.status}`}>{statusLabels[selected.status]}</span><button type="button" aria-label="编辑问题" title="编辑问题" onClick={() => openEdit(selected)}><Pencil size={16} /></button><button className="danger" type="button" aria-label="删除问题" title="删除问题" onClick={() => openIssueDelete(selected)}><Trash2 size={16} /></button></div>
              </header>

              <div className="issue-detail-scroll hm-scroll-region">
                <section className="issue-description"><h3>问题描述</h3><p>{selected.description || '尚未填写问题描述。'}</p></section>
                <div className="issue-resolution-grid">
                  <section><h3>原因分析</h3><p>{selected.rootCause || '处理中填写原因分析。'}</p></section>
                  <section><h3>处理方案</h3><p>{selected.solution || '提交验证前需要填写处理方案。'}</p></section>
                  <section><h3>验证结果</h3><p>{selected.verificationResult || '待验证阶段填写验证结果。'}</p></section>
                </div>

                <section className="issue-timeline">
                  <header><div><h3>处理时间线</h3><span>{selected.activityCount} 条记录</span></div></header>
                  <div>
                    {selected.activities?.map(activity => <article key={activity.id}>
                      <span className={`timeline-dot ${activity.action === 'transition' ? 'transition' : ''}`} />
                      <div><strong>{activityLabels[activity.action] || activity.action}</strong>{activity.fromStatus && activity.toStatus && <em>{statusLabels[activity.fromStatus]} <ChevronRight size={12} /> {statusLabels[activity.toStatus]}</em>}<p>{activity.content || '已记录操作'}</p><small>{activity.actor?.displayName || activity.actor?.username || '系统'} · {formatDate(activity.createdAt)}</small></div>
                    </article>)}
                    {!selected.activities?.length && <p className="timeline-empty">暂无处理记录</p>}
                  </div>
                </section>
              </div>

              <form className="issue-comment" onSubmit={addComment}><textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={2000} placeholder="补充处理进展、现场反馈或验证说明..." /><button type="submit" disabled={saving || !comment.trim()}><Send size={15} />添加记录</button></form>
              <div className="issue-transition-actions">
                <a className="issue-change-link" href={`/workspace/changes?action=new&issueId=${encodeURIComponent(selected.id)}${selected.workOrderId ? `&workOrderId=${encodeURIComponent(selected.workOrderId)}` : ''}`}><GitPullRequestArrow size={15} />发起变更</a>
                {selected.status === 'pending' && <button className="primary" type="button" onClick={() => beginTransition('processing')}>开始处理</button>}
                {selected.status === 'processing' && <button className="primary" type="button" onClick={() => beginTransition('verifying')}>提交验证</button>}
                {selected.status === 'verifying' && <><button type="button" onClick={() => beginTransition('processing')}>退回处理</button><button className="primary" type="button" onClick={() => beginTransition('closed')}>验证通过并关闭</button></>}
                {selected.status === 'closed' && <button type="button" onClick={() => beginTransition('processing')}>重新打开问题</button>}
                <button className="context-mobile" type="button" onClick={openContext}><Info size={15} />责任与附件</button>
              </div>
            </>}
          </section>

          <button className={`issue-context-scrim ${contextOpen ? 'open' : ''}`} type="button" aria-label="关闭责任与来源面板" onClick={closeContext} />
          <aside ref={contextRef} className={`issue-context ${contextOpen ? 'open' : ''}`} aria-label="问题责任与来源" aria-hidden={compactContext && !contextOpen}>
            <header><div><span>问题上下文</span><strong>{selected?.code || '未选择问题'}</strong></div><button type="button" aria-label="关闭责任与来源面板" title="关闭" onClick={closeContext}><X size={18} /></button></header>
            {!selected ? <div className="issue-context-empty">选择问题后查看责任、来源和附件。</div> : <div className="issue-context-scroll hm-scroll-region">
              <section className="context-section responsibility"><h3><UserRound size={15} />责任信息</h3><label>负责人<select value={contextForm.assigneeId} onChange={event => setContextForm(current => ({ ...current, assigneeId: event.target.value }))}><option value="">未分派</option>{users.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label><label>优先级<select value={contextForm.priority} onChange={event => setContextForm(current => ({ ...current, priority: event.target.value as IssuePriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>截止时间<input type="datetime-local" value={contextForm.dueAt} onChange={event => setContextForm(current => ({ ...current, dueAt: event.target.value }))} /></label><button className="primary" type="button" disabled={saving} onClick={() => { void saveContext(); }}>保存责任信息</button></section>
              <section className="context-section source"><h3><ArrowLeftRight size={15} />来源信息</h3><dl><div><dt>来源</dt><dd>{sourceLabel(selected)}</dd></div><div><dt>报告人</dt><dd>{selected.reporter?.displayName || selected.reporter?.username || '系统'}</dd></div><div><dt>来源标识</dt><dd title={selected.sourceCode || ''}>{selected.sourceCode || '无'}</dd></div></dl>{selected.sourceRoute && <a href={selected.sourceRoute}>返回来源位置 <ExternalLink size={14} /></a>}</section>
              {selected.workOrder && <section className="context-section work-order"><h3><FileText size={15} />关联工单</h3><strong title={selected.workOrder.specification || selected.workOrder.code}>{selected.workOrder.specification || selected.workOrder.code}</strong><p>{selected.workOrder.customerName || '客户未设置'} · {selected.workOrder.productName}</p><dl><div><dt>图纸</dt><dd>{selected.workOrder.drawingStatus || '未设置'}</dd></div><div><dt>配料</dt><dd>{selected.workOrder.materialStatus || '未设置'}</dd></div><div><dt>计划</dt><dd>{formatDate(selected.workOrder.plannedAt, false)}</dd></div></dl><a href={`/dashboard?workOrderId=${encodeURIComponent(selected.workOrder.id)}`}>打开生产工单 <ExternalLink size={14} /></a></section>}
              <section className="context-section attachments"><header><h3><Paperclip size={15} />附件 <em>{selected.attachmentCount}</em></h3><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Plus size={14} />上传</button><input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={uploadAttachment} /></header>
                <div>{selected.attachments?.map(file => <article key={file.id}><span>{file.fileType === 'pdf' ? <FileText /> : <FileImage />}</span><div><strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong><small>{formatBytes(file.size)} · {formatDate(file.createdAt)}</small></div><a href={file.contentUrl} target="_blank" rel="noreferrer" aria-label={`预览 ${file.displayName || file.originalName}`} title="预览"><ExternalLink size={14} /></a><a href={file.downloadUrl} aria-label={`下载 ${file.displayName || file.originalName}`} title="下载"><Download size={14} /></a><button type="button" aria-label={`删除 ${file.displayName || file.originalName}`} title="删除附件" onClick={() => openAttachmentDelete(file.id, file.displayName || file.originalName)}><Trash2 size={14} /></button></article>)}{!selected.attachments?.length && <p className="attachment-empty">可上传 PDF、JPG、PNG、WEBP 作为处理凭证。</p>}</div>
              </section>
            </div>}
          </aside>
        </div>
      </div>

      {formOpen && <div className="issue-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><form className="issue-modal" role="dialog" aria-modal="true" aria-labelledby="issue-form-title" onSubmit={saveForm}><header><div><span>{editingIssue ? '编辑问题' : '新建问题'}</span><h2 id="issue-form-title">{editingIssue ? editingIssue.code : '记录需要协同处理的问题'}</h2></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={() => setFormOpen(false)}><X size={19} /></button></header><div className="issue-modal-body hm-scroll-region">
        <label className="wide">问题标题<input value={form.title} maxLength={160} autoFocus onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="一句话说明问题及影响" /></label>
        <label>问题类型<select value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value as IssueType }))}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>优先级<select value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value as IssuePriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>关联工单<select value={form.workOrderId} onChange={event => setForm(current => ({ ...current, workOrderId: event.target.value }))}><option value="">不关联工单</option>{workOrderOptions.map(order => <option value={order.id} key={order.id}>{order.specification || order.code} · {order.customerName || '客户未设置'}</option>)}</select></label>
        <label>负责人<select value={form.assigneeId} onChange={event => setForm(current => ({ ...current, assigneeId: event.target.value }))}><option value="">暂不分派</option>{users.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
        <label>截止时间<input type="datetime-local" value={form.dueAt} onChange={event => setForm(current => ({ ...current, dueAt: event.target.value }))} /></label>
        <label className="wide">问题描述<textarea rows={4} value={form.description} maxLength={4000} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="说明现象、影响范围和需要协同的事项" /></label>
        {editingIssue && <><label className="wide">原因分析<textarea rows={3} value={form.rootCause} maxLength={4000} onChange={event => setForm(current => ({ ...current, rootCause: event.target.value }))} /></label><label className="wide">处理方案<textarea rows={3} value={form.solution} maxLength={4000} onChange={event => setForm(current => ({ ...current, solution: event.target.value }))} /></label><label className="wide">验证结果<textarea rows={3} value={form.verificationResult} maxLength={4000} onChange={event => setForm(current => ({ ...current, verificationResult: event.target.value }))} /></label></>}
        {formError && <p className="issue-form-error" role="alert">{formError}</p>}
      </div><footer><button type="button" disabled={saving} onClick={() => setFormOpen(false)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={15} />}{editingIssue ? '保存修改' : '创建问题'}</button></footer></form></div>}

      {transition && selected && <div className="issue-modal-backdrop"><form className="issue-modal transition-modal" role="dialog" aria-modal="true" aria-labelledby="issue-transition-title" onSubmit={submitTransition}><header><div><span>状态流转</span><h2 id="issue-transition-title">{statusLabels[selected.status]} → {statusLabels[transition.target]}</h2></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={() => setTransition(null)}><X size={19} /></button></header><div className="issue-modal-body">
        {transition.target === 'verifying' && <label className="wide">处理方案<textarea autoFocus required rows={5} value={transition.solution} onChange={event => setTransition(current => current ? { ...current, solution: event.target.value } : current)} placeholder="说明已经采取的处理措施" /></label>}
        {transition.target === 'closed' && <label className="wide">验证结果<textarea autoFocus required rows={5} value={transition.verificationResult} onChange={event => setTransition(current => current ? { ...current, verificationResult: event.target.value } : current)} placeholder="说明如何验证问题已解决" /></label>}
        <label className="wide">流转备注（可选）<textarea autoFocus={transition.target === 'processing'} rows={3} value={transition.comment} onChange={event => setTransition(current => current ? { ...current, comment: event.target.value } : current)} placeholder="补充本次状态变更说明" /></label>
      </div><footer><button type="button" disabled={saving} onClick={() => setTransition(null)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={15} />}确认流转</button></footer></form></div>}

      {confirmDelete && <div className="issue-modal-backdrop"><section className="issue-confirm" role="alertdialog" aria-modal="true" aria-labelledby="issue-delete-title"><AlertTriangle /><h2 id="issue-delete-title">确认删除问题？</h2><p>{confirmDelete.code} · {confirmDelete.title}</p><span>问题将被软删除，关联工单和 S3 附件原文件不会被物理删除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteIssue(); }}>确认删除</button></footer></section></div>}
      {confirmAttachmentDelete && <div className="issue-modal-backdrop"><section className="issue-confirm" role="alertdialog" aria-modal="true" aria-labelledby="issue-attachment-delete-title"><AlertTriangle /><h2 id="issue-attachment-delete-title">确认删除附件？</h2><p title={confirmAttachmentDelete.name}>{confirmAttachmentDelete.name}</p><span>附件记录将被软删除，对象存储中的原文件不会立即物理清除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmAttachmentDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteAttachment(); }}>确认删除</button></footer></section></div>}
      {toast && <div className="issue-toast" role="status">{toast}</div>}
    </main>
  );
}
