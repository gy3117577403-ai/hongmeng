'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  GitPullRequestArrow,
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
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import type {
  ChangeImpactArea,
  ChangePriority,
  ChangeRequestDTO,
  ChangeStatus,
  ChangeSummaryDTO,
  ChangeType,
  CurrentUserDTO,
  IssueDTO,
  UserDTO,
  WorkOrderDTO,
} from '@/types';

type ChangeManagementShellProps = { user: CurrentUserDTO };
type ChangeListResponse = {
  ok: boolean;
  changes: ChangeRequestDTO[];
  summary: ChangeSummaryDTO;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};
type ChangeMutationResponse = { ok: boolean; change?: ChangeRequestDTO; error?: string };
type UsersResponse = { ok: boolean; users: UserDTO[]; error?: string };
type WorkOrdersResponse = { workOrders?: WorkOrderDTO[]; error?: string; message?: string };
type IssuesResponse = { ok: boolean; issues: IssueDTO[]; error?: string };

type Filters = {
  status: 'all' | ChangeStatus;
  type: 'all' | ChangeType;
  priority: 'all' | ChangePriority;
  ownerId: string;
  overdue: boolean;
  unassigned: boolean;
};

type ChangeFormState = {
  title: string;
  type: ChangeType;
  priority: ChangePriority;
  reason: string;
  description: string;
  impactAreas: ChangeImpactArea[];
  impactScope: string;
  implementationPlan: string;
  implementationResult: string;
  validationResult: string;
  rollbackPlan: string;
  sourceIssueId: string;
  workOrderId: string;
  ownerId: string;
  dueAt: string;
  effectiveAt: string;
};

type TransitionState = {
  target: ChangeStatus;
  reason: string;
  impactAreas: ChangeImpactArea[];
  impactScope: string;
  implementationPlan: string;
  implementationResult: string;
  validationResult: string;
  comment: string;
};

type AttachmentDeleteState = { id: string; name: string };

const statusLabels: Record<ChangeStatus, string> = {
  draft: '草稿', assessing: '待评估', implementing: '执行中', verifying: '待验证', closed: '已关闭',
};
const priorityLabels: Record<ChangePriority, string> = { urgent: '紧急', high: '高', normal: '一般' };
const typeLabels: Record<ChangeType, string> = {
  drawing: '图纸变更', process: '工艺变更', plan: '计划变更', material: '物料变更', document: '资料变更', other: '其他变更',
};
const impactLabels: Record<ChangeImpactArea, string> = {
  drawing: '图纸', process: '工艺', plan: '计划', material: '物料', document: '资料', production: '生产',
};
const activityLabels: Record<string, string> = {
  create: '创建变更', update: '更新变更', assign: '更新负责人', transition: '状态流转', comment: '协同记录',
  upload_attachment: '上传附件', delete_attachment: '删除附件', delete: '删除变更',
};
const emptySummary: ChangeSummaryDTO = {
  total: 0, draft: 0, assessing: 0, implementing: 0, verifying: 0, closed: 0, overdue: 0, unassigned: 0,
};
const emptyFilters: Filters = { status: 'all', type: 'all', priority: 'all', ownerId: '', overdue: false, unassigned: false };
const emptyForm: ChangeFormState = {
  title: '', type: 'drawing', priority: 'normal', reason: '', description: '', impactAreas: [], impactScope: '',
  implementationPlan: '', implementationResult: '', validationResult: '', rollbackPlan: '', sourceIssueId: '', workOrderId: '', ownerId: '', dueAt: '', effectiveAt: '',
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

function localDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || '请求失败');
  return data;
}

function formFromChange(change?: ChangeRequestDTO | null): ChangeFormState {
  if (!change) return { ...emptyForm, impactAreas: [] };
  return {
    title: change.title,
    type: change.type,
    priority: change.priority,
    reason: change.reason || '',
    description: change.description || '',
    impactAreas: [...change.impactAreas],
    impactScope: change.impactScope || '',
    implementationPlan: change.implementationPlan || '',
    implementationResult: change.implementationResult || '',
    validationResult: change.validationResult || '',
    rollbackPlan: change.rollbackPlan || '',
    sourceIssueId: change.sourceIssueId || '',
    workOrderId: change.workOrderId || '',
    ownerId: change.owner?.id || '',
    dueAt: localDateTime(change.dueAt),
    effectiveAt: localDateTime(change.effectiveAt),
  };
}

export default function ChangeManagementShell({ user }: ChangeManagementShellProps) {
  const routeSearchParams = useSearchParams();
  const initialParams = useMemo(() => new URLSearchParams(routeSearchParams.toString()), [routeSearchParams]);
  const [keyword, setKeyword] = useState(initialParams.get('keyword') || '');
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    status: (['draft', 'assessing', 'implementing', 'verifying', 'closed'].includes(initialParams.get('status') || '') ? initialParams.get('status') : 'all') as Filters['status'],
    overdue: initialParams.get('overdue') === 'true',
  }));
  const [changes, setChanges] = useState<ChangeRequestDTO[]>([]);
  const [summary, setSummary] = useState<ChangeSummaryDTO>(emptySummary);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderDTO[]>([]);
  const [issues, setIssues] = useState<IssueDTO[]>([]);
  const [selected, setSelected] = useState<ChangeRequestDTO | null>(null);
  const selectedIdRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(initialParams.get('action') === 'new');
  const [editingChange, setEditingChange] = useState<ChangeRequestDTO | null>(null);
  const [form, setForm] = useState<ChangeFormState>(() => ({
    ...emptyForm,
    impactAreas: [],
    sourceIssueId: initialParams.get('issueId') || '',
    workOrderId: initialParams.get('workOrderId') || '',
  }));
  const [formError, setFormError] = useState('');
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [comment, setComment] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [compactContext, setCompactContext] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ChangeRequestDTO | null>(null);
  const [confirmAttachmentDelete, setConfirmAttachmentDelete] = useState<AttachmentDeleteState | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);

  const updateChange = useCallback((change: ChangeRequestDTO): void => {
    setChanges(current => current.some(item => item.id === change.id)
      ? current.map(item => item.id === change.id ? change : item)
      : [change, ...current]);
    selectedIdRef.current = change.id;
    setSelected(change);
  }, []);

  const loadChanges = useCallback(async (preferredId?: string): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '60' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters.ownerId) params.set('ownerId', filters.ownerId);
      if (filters.overdue) params.set('overdue', 'true');
      if (filters.unassigned) params.set('unassigned', 'true');
      const linkedWorkOrder = initialParams.get('workOrderId');
      const linkedIssue = initialParams.get('sourceIssueId');
      if (linkedWorkOrder && initialParams.get('action') !== 'new') params.set('workOrderId', linkedWorkOrder);
      if (linkedIssue) params.set('sourceIssueId', linkedIssue);
      const data = await jsonRequest<ChangeListResponse>(`/api/changes?${params.toString()}`);
      setChanges(data.changes);
      setSummary(data.summary);
      setTotalPages(data.pagination.totalPages);
      const desired = preferredId || selectedIdRef.current || initialParams.get('changeId') || sessionStorage.getItem('hm-change-selected') || '';
      const nextSelected = data.changes.find(item => item.id === desired) || data.changes[0] || null;
      selectedIdRef.current = nextSelected?.id || '';
      setSelected(nextSelected);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '变更列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, initialParams, keyword, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadChanges(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [keyword, loadChanges]);

  useEffect(() => {
    Promise.all([
      jsonRequest<UsersResponse>('/api/users'),
      jsonRequest<WorkOrdersResponse>('/api/work-orders'),
      jsonRequest<IssuesResponse>('/api/issues?pageSize=100'),
    ]).then(([userData, orderData, issueData]) => {
      setUsers(userData.users || []);
      setWorkOrders(orderData.workOrders || []);
      setIssues(issueData.issues || []);
    }).catch(() => setToast('负责人、工单或问题选项加载失败'));
  }, []);

  useEffect(() => {
    if (!selected) return;
    selectedIdRef.current = selected.id;
    sessionStorage.setItem('hm-change-selected', selected.id);
    const params = new URLSearchParams(window.location.search);
    params.delete('action');
    params.set('changeId', selected.id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }, [selected]);

  useEffect(() => {
    const element = queueRef.current;
    if (!element) return;
    element.scrollTop = Number(sessionStorage.getItem('hm-change-queue-scroll') || 0);
    const save = (): void => sessionStorage.setItem('hm-change-queue-scroll', String(element.scrollTop));
    element.addEventListener('scroll', save, { passive: true });
    return () => element.removeEventListener('scroll', save);
  }, [loading]);

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
        window.requestAnimationFrame(() => contextTriggerRef.current?.focus());
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

  const modalOpen = formOpen || !!transition || !!confirmDelete || !!confirmAttachmentDelete;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (modalOpen) surface.setAttribute('inert', '');
    else surface.removeAttribute('inert');
    return () => surface.removeAttribute('inert');
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>('.hm-change-workbench .change-modal-backdrop [role="dialog"], .hm-change-workbench .change-modal-backdrop [role="alertdialog"]');
    const focusable = (): HTMLElement[] => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')) : [];
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) {
        if (confirmAttachmentDelete) setConfirmAttachmentDelete(null);
        else if (confirmDelete) setConfirmDelete(null);
        else if (transition) setTransition(null);
        else setFormOpen(false);
        window.requestAnimationFrame(() => modalReturnFocusRef.current?.focus());
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
    setEditingChange(null);
    setForm({
      ...emptyForm,
      impactAreas: [],
      sourceIssueId: initialParams.get('issueId') || '',
      workOrderId: initialParams.get('workOrderId') || '',
    });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(change: ChangeRequestDTO): void {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingChange(change);
    setForm(formFromChange(change));
    setFormError('');
    setFormOpen(true);
  }

  function toggleImpact(area: ChangeImpactArea): void {
    setForm(current => ({
      ...current,
      impactAreas: current.impactAreas.includes(area)
        ? current.impactAreas.filter(item => item !== area)
        : [...current.impactAreas, area],
    }));
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.title.trim().length < 2) { setFormError('请填写至少 2 个字符的变更标题'); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        reason: form.reason || null,
        description: form.description || null,
        impactScope: form.impactScope || null,
        implementationPlan: form.implementationPlan || null,
        implementationResult: form.implementationResult || null,
        validationResult: form.validationResult || null,
        rollbackPlan: form.rollbackPlan || null,
        sourceIssueId: form.sourceIssueId || null,
        workOrderId: form.workOrderId || null,
        ownerId: form.ownerId || null,
        dueAt: form.dueAt || null,
        effectiveAt: form.effectiveAt || null,
        ...(editingChange ? { expectedVersion: editingChange.version } : {}),
      };
      const data = await jsonRequest<ChangeMutationResponse>(editingChange ? `/api/changes/${editingChange.id}` : '/api/changes', {
        method: editingChange ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (data.change) updateChange(data.change);
      setFormOpen(false);
      setEditingChange(null);
      setToast(editingChange ? '变更信息已更新' : '变更草稿已创建');
      await loadChanges(data.change?.id);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '变更保存失败');
    } finally {
      setSaving(false);
    }
  }

  function beginTransition(target: ChangeStatus): void {
    if (!selected) return;
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTransition({
      target,
      reason: selected.reason || '',
      impactAreas: [...selected.impactAreas],
      impactScope: selected.impactScope || '',
      implementationPlan: selected.implementationPlan || '',
      implementationResult: selected.implementationResult || '',
      validationResult: selected.validationResult || '',
      comment: '',
    });
  }

  function toggleTransitionImpact(area: ChangeImpactArea): void {
    setTransition(current => current ? ({
      ...current,
      impactAreas: current.impactAreas.includes(area)
        ? current.impactAreas.filter(item => item !== area)
        : [...current.impactAreas, area],
    }) : current);
  }

  async function submitTransition(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !transition) return;
    setSaving(true);
    try {
      const data = await jsonRequest<ChangeMutationResponse>(`/api/changes/${selected.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transition, status: transition.target, expectedVersion: selected.version }),
      });
      if (data.change) updateChange(data.change);
      setTransition(null);
      setToast(`已流转到${statusLabels[transition.target]}`);
      await loadChanges(data.change?.id);
    } catch (transitionError) {
      setToast(transitionError instanceof Error ? transitionError.message : '状态流转失败');
    } finally {
      setSaving(false);
    }
  }

  async function addComment(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    setSaving(true);
    try {
      const data = await jsonRequest<ChangeMutationResponse>(`/api/changes/${selected.id}/activities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: comment }),
      });
      if (data.change) updateChange(data.change);
      setComment('');
      setToast('协同记录已添加');
    } catch (commentError) {
      setToast(commentError instanceof Error ? commentError.message : '协同记录保存失败');
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
      const payload = new FormData();
      payload.append('file', file);
      const data = await jsonRequest<ChangeMutationResponse>(`/api/changes/${selected.id}/attachments/upload`, { method: 'POST', body: payload });
      if (data.change) updateChange(data.change);
      setToast('附件已上传到对象存储');
    } catch (uploadError) {
      setToast(uploadError instanceof Error ? uploadError.message : '附件上传失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAttachment(): Promise<void> {
    if (!confirmAttachmentDelete) return;
    setSaving(true);
    try {
      const data = await jsonRequest<ChangeMutationResponse>(`/api/changes/attachments/${confirmAttachmentDelete.id}`, { method: 'DELETE' });
      if (data.change) updateChange(data.change);
      setConfirmAttachmentDelete(null);
      setToast('附件已软删除');
    } catch (deleteError) {
      setToast(deleteError instanceof Error ? deleteError.message : '附件删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteChange(): Promise<void> {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await jsonRequest<{ ok: boolean; error?: string }>(`/api/changes/${confirmDelete.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: confirmDelete.version }),
      });
      setConfirmDelete(null);
      selectedIdRef.current = '';
      setSelected(null);
      setToast('变更已软删除');
      await loadChanges();
    } catch (deleteError) {
      setToast(deleteError instanceof Error ? deleteError.message : '变更删除失败');
    } finally {
      setSaving(false);
    }
  }

  const activeFilterCount = [filters.status !== 'all', filters.type !== 'all', filters.priority !== 'all', !!filters.ownerId, filters.overdue, filters.unassigned].filter(Boolean).length;
  const orderOptions = useMemo(() => [...workOrders].sort((a, b) => String(a.specification || a.code).localeCompare(String(b.specification || b.code), 'zh-CN')), [workOrders]);
  const transitionTitle = transition && selected ? `${statusLabels[selected.status]} → ${statusLabels[transition.target]}` : '';

  return (
    <main className="hm-workbench-root hm-change-workbench">
      <div ref={surfaceRef} className="change-workbench-surface">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/changes"
        subtitle="影响评估、执行和验证闭环"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
        searchSlot={<label className="change-global-search"><Search size={16} aria-hidden="true" /><input value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索变更编号、标题、工单、规格或客户" aria-label="搜索变更" />{keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={14} /></button>}</label>}
        utilityActions={<a className="change-workflow-link" href="/workspace/workflows"><ClipboardList size={15} />流程中心</a>}
      />

      <div className="change-page-frame">
        <WorkbenchPageHeader
          kicker="协同中心"
          title="变更管理"
          titleId="change-page-title"
          description="图纸、工艺、计划、物料和资料变更的评估、执行与验证闭环。"
          actions={<><button className="hm-workbench-button" type="button" disabled={loading} onClick={() => { void loadChanges(selected?.id); }}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button><button className="hm-workbench-button primary" type="button" onClick={openCreate}><Plus size={16} />新建变更</button></>}
        />

        <section className="change-summary" aria-label="变更统计">
          {([
            ['全部', summary.total, 'all'], ['草稿', summary.draft, 'draft'], ['待评估', summary.assessing, 'assessing'],
            ['执行中', summary.implementing, 'implementing'], ['待验证', summary.verifying, 'verifying'], ['已关闭', summary.closed, 'closed'],
          ] as const).map(([label, count, status]) => <button key={status} type="button" className={filters.status === status ? 'active' : ''} onClick={() => { setFilters(current => ({ ...current, status })); setPage(1); }}><span>{label}</span><strong>{count}</strong></button>)}
          <button type="button" className={`warning ${filters.overdue ? 'active' : ''}`} onClick={() => setFilters(current => ({ ...current, overdue: !current.overdue }))}><span>逾期</span><strong>{summary.overdue}</strong></button>
        </section>

        <div className="change-workspace">
          <section className="change-queue" aria-label="变更队列">
            <header><div><h2>变更队列</h2><span>{changes.length} 条当前结果</span></div>{activeFilterCount > 0 && <button type="button" onClick={() => setFilters({ ...emptyFilters })}>清除 {activeFilterCount}</button>}</header>
            <div className="change-filter-grid">
              <select aria-label="变更类型" value={filters.type} onChange={event => { setFilters(current => ({ ...current, type: event.target.value as Filters['type'] })); setPage(1); }}><option value="all">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <select aria-label="优先级" value={filters.priority} onChange={event => { setFilters(current => ({ ...current, priority: event.target.value as Filters['priority'] })); setPage(1); }}><option value="all">全部优先级</option>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <select aria-label="负责人" value={filters.ownerId} onChange={event => { setFilters(current => ({ ...current, ownerId: event.target.value })); setPage(1); }}><option value="">全部负责人</option>{users.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select>
              <button type="button" className={filters.unassigned ? 'active' : ''} onClick={() => setFilters(current => ({ ...current, unassigned: !current.unassigned }))}><UserRound size={14} />待分派 {summary.unassigned}</button>
            </div>
            <div className="change-queue-scroll hm-scroll-region" ref={queueRef} tabIndex={0}>
              {loading && <div className="change-loading"><Loader2 className="spin" />正在加载变更...</div>}
              {!loading && error && <div className="change-error"><AlertTriangle /><p>{error}</p><button type="button" onClick={() => { void loadChanges(); }}>重试</button></div>}
              {!loading && !error && !changes.length && <div className="change-empty"><GitPullRequestArrow /><h3>没有符合条件的变更</h3><p>可调整筛选，或创建第一条变更草稿。</p><button type="button" onClick={openCreate}><Plus size={15} />新建变更</button></div>}
              {!loading && !error && changes.map(change => <button type="button" key={change.id} className={`change-card ${selected?.id === change.id ? 'selected' : ''}`} onClick={() => setSelected(change)}>
                <div className="change-card-top"><span>{change.code} · {typeLabels[change.type]}</span><em className={`priority-${change.priority}`}>{priorityLabels[change.priority]}</em></div>
                <strong title={change.title}>{change.title}</strong>
                <p title={change.workOrder ? `${change.workOrder.customerName || '客户未设置'} · ${change.workOrder.specification || change.workOrder.code}` : '未关联工单'}>{change.workOrder ? `${change.workOrder.customerName || '客户未设置'} · ${change.workOrder.specification || change.workOrder.code}` : '未关联工单'}</p>
                <div className="change-card-meta"><span className={`status-${change.status}`}>{statusLabels[change.status]}</span><span>{change.owner?.displayName || change.owner?.username || '待分派'}</span><span className={change.isOverdue ? 'overdue' : ''}>{change.isOverdue ? '已逾期' : formatDate(change.dueAt, false)}</span></div>
              </button>)}
            </div>
            {totalPages > 1 && <footer className="change-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></footer>}
          </section>

          <section className="change-detail" aria-label="变更处理详情">
            {!selected ? <div className="change-detail-empty"><GitPullRequestArrow /><h2>选择一条变更开始处理</h2><p>变更评估、实施、验证和附件都在这里完成。</p></div> : <>
              <header className="change-detail-header">
                <div><span>{selected.code} · {typeLabels[selected.type]}</span><h2 title={selected.title}>{selected.title}</h2><p>申请人 {selected.requester?.displayName || selected.requester?.username || '未记录'} · 更新于 {formatDate(selected.updatedAt)}</p></div>
                <div><span className={`change-status status-${selected.status}`}>{statusLabels[selected.status]}</span><button type="button" aria-label="编辑变更" title="编辑变更" onClick={() => openEdit(selected)}><Pencil size={16} /></button><button className="danger" type="button" aria-label="删除变更" title="删除变更" onClick={() => { modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConfirmDelete(selected); }}><Trash2 size={16} /></button></div>
              </header>
              <div className="change-detail-scroll hm-scroll-region">
                <section className="change-overview"><div><h3>变更原因</h3><p>{selected.reason || '尚未填写变更原因。'}</p></div><div><h3>影响范围</h3><p>{selected.impactScope || '尚未填写影响范围。'}</p><div className="impact-tags">{selected.impactAreas.map(area => <span key={area}>{impactLabels[area]}</span>)}{!selected.impactAreas.length && <em>待确认</em>}</div></div></section>
                {selected.description && <section className="change-description"><h3>补充说明</h3><p>{selected.description}</p></section>}
                <section className="change-execution-grid">
                  <article><span>01</span><div><h3>实施方案</h3><p>{selected.implementationPlan || '评估通过后填写实施步骤、负责人和切换窗口。'}</p></div></article>
                  <article><span>02</span><div><h3>实施结果</h3><p>{selected.implementationResult || '执行完成后记录实际结果和偏差。'}</p></div></article>
                  <article><span>03</span><div><h3>验证结果</h3><p>{selected.validationResult || '验证阶段记录验证方法和结论。'}</p></div></article>
                  <article><span>R</span><div><h3>回退方案</h3><p>{selected.rollbackPlan || '可在需要时补充回退条件和恢复步骤。'}</p></div></article>
                </section>
                <section className="change-timeline"><header><div><h3>协同时间线</h3><span>{selected.activityCount} 条记录</span></div></header><div>{selected.activities?.map(item => <article key={item.id}><span className={item.action === 'transition' ? 'transition' : ''} /><div><strong>{activityLabels[item.action] || item.action}</strong>{item.fromStatus && item.toStatus && <em>{statusLabels[item.fromStatus]} <ChevronRight size={12} /> {statusLabels[item.toStatus]}</em>}<p>{item.content || '已记录操作'}</p><small>{item.actor?.displayName || item.actor?.username || '系统'} · {formatDate(item.createdAt)}</small></div></article>)}{!selected.activities?.length && <p className="timeline-empty">暂无协同记录</p>}</div></section>
              </div>
              <form className="change-comment" onSubmit={addComment}><textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={2000} placeholder="补充评估结论、实施进展或验证说明..." /><button type="submit" disabled={saving || !comment.trim()}><Send size={15} />添加记录</button></form>
              <div className="change-transition-actions">
                {selected.status === 'draft' && <button className="primary" type="button" onClick={() => beginTransition('assessing')}>提交评估<ArrowRight size={15} /></button>}
                {selected.status === 'assessing' && <><button type="button" onClick={() => beginTransition('draft')}><ArrowLeft size={15} />退回草稿</button><button className="primary" type="button" onClick={() => beginTransition('implementing')}>开始实施<ArrowRight size={15} /></button></>}
                {selected.status === 'implementing' && <button className="primary" type="button" onClick={() => beginTransition('verifying')}>提交验证<ArrowRight size={15} /></button>}
                {selected.status === 'verifying' && <><button type="button" onClick={() => beginTransition('implementing')}><ArrowLeft size={15} />退回实施</button><button className="primary" type="button" onClick={() => beginTransition('closed')}>验证并关闭<CheckCircle2 size={15} /></button></>}
                {selected.status === 'closed' && <button type="button" onClick={() => beginTransition('assessing')}><RefreshCw size={15} />重新评估</button>}
                {compactContext && <button ref={contextTriggerRef} type="button" onClick={() => setContextOpen(true)}><Info size={15} />责任与附件</button>}
              </div>
            </>}
          </section>

          {compactContext && <button className={`change-context-scrim ${contextOpen ? 'open' : ''}`} type="button" aria-label="关闭责任与附件面板" onClick={() => setContextOpen(false)} />}
          <aside ref={contextRef} className={`change-context ${compactContext && contextOpen ? 'open' : ''}`} aria-label="变更上下文">
            <header><div><span>变更上下文</span><h2>{selected?.code || '未选择变更'}</h2></div>{compactContext && <button type="button" aria-label="关闭责任与附件面板" title="关闭" onClick={() => { setContextOpen(false); window.requestAnimationFrame(() => contextTriggerRef.current?.focus()); }}><X size={18} /></button>}</header>
            {!selected ? <div className="change-context-empty"><Info /><p>选择变更后查看责任、关联来源和附件。</p></div> : <div className="change-context-scroll hm-scroll-region">
              <section className="context-section"><h3><UserRound size={15} />责任与时间</h3><dl><div><dt>申请人</dt><dd>{selected.requester?.displayName || selected.requester?.username || '未记录'}</dd></div><div><dt>负责人</dt><dd>{selected.owner?.displayName || selected.owner?.username || '待分派'}</dd></div><div><dt>截止时间</dt><dd className={selected.isOverdue ? 'overdue' : ''}>{formatDate(selected.dueAt)}</dd></div><div><dt>计划生效</dt><dd>{formatDate(selected.effectiveAt)}</dd></div><div><dt>版本</dt><dd>V{selected.version}</dd></div></dl></section>
              <section className="context-section"><h3><ClipboardList size={15} />关联来源</h3>{selected.sourceIssue ? <a className="context-link" href={`/workspace/issues?issueId=${encodeURIComponent(selected.sourceIssue.id)}`}><div><strong>{selected.sourceIssue.code}</strong><span title={selected.sourceIssue.title}>{selected.sourceIssue.title}</span></div><ExternalLink size={14} /></a> : <p className="context-muted">未关联来源问题</p>}{selected.workOrder ? <a className="context-link" href={`/production?workOrderId=${encodeURIComponent(selected.workOrder.id)}`}><div><strong>{selected.workOrder.specification || selected.workOrder.code}</strong><span>{selected.workOrder.customerName || '客户未设置'} · {selected.workOrder.productName}</span></div><ExternalLink size={14} /></a> : <p className="context-muted">未关联生产工单</p>}</section>
              <section className="context-section attachments"><header><h3><Paperclip size={15} />附件 <em>{selected.attachmentCount}</em></h3><button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}><Plus size={14} />上传</button><input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={uploadAttachment} /></header><div>{selected.attachments?.map(file => <article key={file.id}><span>{file.fileType === 'pdf' ? <FileText /> : <FileImage />}</span><div><strong title={file.displayName || file.originalName}>{file.displayName || file.originalName}</strong><small>{formatBytes(file.size)} · {formatDate(file.createdAt)}</small></div><a href={file.contentUrl} target="_blank" rel="noreferrer" aria-label={`预览 ${file.displayName || file.originalName}`} title="预览"><ExternalLink size={14} /></a><a href={file.downloadUrl} aria-label={`下载 ${file.displayName || file.originalName}`} title="下载"><Download size={14} /></a><button type="button" aria-label={`删除 ${file.displayName || file.originalName}`} title="删除附件" onClick={() => { modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConfirmAttachmentDelete({ id: file.id, name: file.displayName || file.originalName }); }}><Trash2 size={14} /></button></article>)}{!selected.attachments?.length && <p className="attachment-empty">可上传 PDF、JPG、PNG、WEBP 作为变更依据或验证凭证。</p>}</div></section>
            </div>}
          </aside>
        </div>
      </div>
      </div>

      {formOpen && <div className="change-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><form className="change-modal" role="dialog" aria-modal="true" aria-labelledby="change-form-title" onSubmit={saveForm}><header><div><span>{editingChange ? '编辑变更' : '新建变更'}</span><h2 id="change-form-title">{editingChange ? editingChange.code : '记录需要评估和执行的变更'}</h2></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={() => setFormOpen(false)}><X size={19} /></button></header><div className="change-modal-body hm-scroll-region">
        <label className="wide">变更标题<input value={form.title} maxLength={160} autoFocus onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="一句话说明要改变什么" /></label>
        <label>变更类型<select value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value as ChangeType }))}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>优先级<select value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value as ChangePriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>来源问题<select value={form.sourceIssueId} onChange={event => { const issue = issues.find(item => item.id === event.target.value); setForm(current => ({ ...current, sourceIssueId: event.target.value, workOrderId: current.workOrderId || issue?.workOrderId || '' })); }}><option value="">不关联问题</option>{issues.map(issue => <option value={issue.id} key={issue.id}>{issue.code} · {issue.title}</option>)}</select></label>
        <label>关联工单<select value={form.workOrderId} onChange={event => setForm(current => ({ ...current, workOrderId: event.target.value }))}><option value="">不关联工单</option>{orderOptions.map(order => <option value={order.id} key={order.id}>{order.specification || order.code} · {order.customerName || '客户未设置'}</option>)}</select></label>
        <label>负责人<select value={form.ownerId} onChange={event => setForm(current => ({ ...current, ownerId: event.target.value }))}><option value="">暂不分派</option>{users.filter(item => item.isActive).map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
        <label>截止时间<input type="datetime-local" value={form.dueAt} onChange={event => setForm(current => ({ ...current, dueAt: event.target.value }))} /></label>
        <label>计划生效<input type="datetime-local" value={form.effectiveAt} onChange={event => setForm(current => ({ ...current, effectiveAt: event.target.value }))} /></label>
        <fieldset className="wide"><legend>影响区域</legend><div className="impact-options">{Object.entries(impactLabels).map(([value, label]) => <label key={value}><input type="checkbox" checked={form.impactAreas.includes(value as ChangeImpactArea)} onChange={() => toggleImpact(value as ChangeImpactArea)} /><span>{label}</span></label>)}</div></fieldset>
        <label className="wide">变更原因<textarea rows={3} value={form.reason} maxLength={4000} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} placeholder="为什么需要变更，以及不变更的风险" /></label>
        <label className="wide">影响范围<textarea rows={3} value={form.impactScope} maxLength={4000} onChange={event => setForm(current => ({ ...current, impactScope: event.target.value }))} placeholder="说明涉及工单、客户、产品、资料或生产环节" /></label>
        <label className="wide">补充说明<textarea rows={3} value={form.description} maxLength={4000} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
        <label className="wide">实施方案<textarea rows={3} value={form.implementationPlan} maxLength={6000} onChange={event => setForm(current => ({ ...current, implementationPlan: event.target.value }))} /></label>
        <label className="wide">回退方案<textarea rows={3} value={form.rollbackPlan} maxLength={4000} onChange={event => setForm(current => ({ ...current, rollbackPlan: event.target.value }))} /></label>
        {editingChange && <><label className="wide">实施结果<textarea rows={3} value={form.implementationResult} maxLength={6000} onChange={event => setForm(current => ({ ...current, implementationResult: event.target.value }))} /></label><label className="wide">验证结果<textarea rows={3} value={form.validationResult} maxLength={6000} onChange={event => setForm(current => ({ ...current, validationResult: event.target.value }))} /></label></>}
        {formError && <p className="change-form-error wide"><AlertTriangle size={15} />{formError}</p>}
      </div><footer><button type="button" disabled={saving} onClick={() => setFormOpen(false)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={15} />}{editingChange ? '保存修改' : '创建草稿'}</button></footer></form></div>}

      {transition && selected && <div className="change-modal-backdrop"><form className="change-modal transition-modal" role="dialog" aria-modal="true" aria-labelledby="change-transition-title" onSubmit={submitTransition}><header><div><span>状态流转</span><h2 id="change-transition-title">{transitionTitle}</h2></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={() => setTransition(null)}><X size={19} /></button></header><div className="change-modal-body">
        {transition.target === 'assessing' && <><fieldset className="wide"><legend>影响区域</legend><div className="impact-options">{Object.entries(impactLabels).map(([value, label]) => <label key={value}><input type="checkbox" checked={transition.impactAreas.includes(value as ChangeImpactArea)} onChange={() => toggleTransitionImpact(value as ChangeImpactArea)} /><span>{label}</span></label>)}</div></fieldset><label className="wide">变更原因<textarea autoFocus required rows={3} value={transition.reason} onChange={event => setTransition(current => current ? { ...current, reason: event.target.value } : current)} /></label><label className="wide">影响范围<textarea required rows={3} value={transition.impactScope} onChange={event => setTransition(current => current ? { ...current, impactScope: event.target.value } : current)} /></label></>}
        {transition.target === 'implementing' && selected.status === 'assessing' && <label className="wide">实施方案<textarea autoFocus required rows={5} value={transition.implementationPlan} onChange={event => setTransition(current => current ? { ...current, implementationPlan: event.target.value } : current)} placeholder="说明实施步骤、切换窗口和责任安排" /></label>}
        {transition.target === 'verifying' && <label className="wide">实施结果<textarea autoFocus required rows={5} value={transition.implementationResult} onChange={event => setTransition(current => current ? { ...current, implementationResult: event.target.value } : current)} placeholder="记录实际实施结果和偏差" /></label>}
        {transition.target === 'closed' && <label className="wide">验证结果<textarea autoFocus required rows={5} value={transition.validationResult} onChange={event => setTransition(current => current ? { ...current, validationResult: event.target.value } : current)} placeholder="说明验证方法、结论和生效确认" /></label>}
        <label className="wide">流转备注（可选）<textarea autoFocus={!['assessing', 'verifying', 'closed'].includes(transition.target) && !(transition.target === 'implementing' && selected.status === 'assessing')} rows={3} value={transition.comment} onChange={event => setTransition(current => current ? { ...current, comment: event.target.value } : current)} placeholder="补充本次状态变更说明" /></label>
      </div><footer><button type="button" disabled={saving} onClick={() => setTransition(null)}>取消</button><button className="primary" type="submit" disabled={saving}>{saving && <Loader2 className="spin" size={15} />}确认流转</button></footer></form></div>}

      {confirmDelete && <div className="change-modal-backdrop"><section className="change-confirm" role="alertdialog" aria-modal="true" aria-labelledby="change-delete-title"><AlertTriangle /><h2 id="change-delete-title">确认删除变更？</h2><p>{confirmDelete.code} · {confirmDelete.title}</p><span>变更将被软删除，关联问题、工单及对象存储附件不会被物理删除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteChange(); }}>确认删除</button></footer></section></div>}
      {confirmAttachmentDelete && <div className="change-modal-backdrop"><section className="change-confirm" role="alertdialog" aria-modal="true" aria-labelledby="change-attachment-delete-title"><AlertTriangle /><h2 id="change-attachment-delete-title">确认删除附件？</h2><p title={confirmAttachmentDelete.name}>{confirmAttachmentDelete.name}</p><span>附件记录将被软删除，对象存储中的原文件不会立即物理清除。</span><footer><button type="button" disabled={saving} onClick={() => setConfirmAttachmentDelete(null)}>取消</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteAttachment(); }}>确认删除</button></footer></section></div>}
    </main>
  );
}
