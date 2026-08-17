'use client';

import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { writeClipboardText } from '@/lib/client-platform';
import type {
  CurrentUserDTO,
  SampleDataEntryDTO,
  SamplePhotoCategoryDTO,
  SamplePhotoDTO,
  SamplePublishModeDTO,
  SampleTaskDTO,
  SampleTeamSummaryDTO,
} from '@/types';

type CenterMode = 'planning' | 'execution';
type ContextPayload = {
  members: Array<{
    id: string;
    employeeNo: string;
    name: string;
    team: string | null;
    position: string | null;
    department: string | null;
    sampleTeam: boolean;
  }>;
  sampleMemberCount: number;
  products: Array<{
    id: string;
    customerName: string;
    productName: string | null;
    specification: string;
    libraryKey: string;
  }>;
  processes: Array<{ id: string; code: string; name: string; stageGroup: string; sortOrder: number }>;
};

type PlanForm = {
  drawingLibraryItemId: string;
  customerName: string;
  productName: string;
  specification: string;
  sourceOrderNo: string;
  customerLevelCode: string;
  customerLevelLabel: string;
  customerLevelColor: string;
  sampleQuantity: string;
  dueDate: string;
  priority: string;
  planRemark: string;
  assigneeEmployeeIds: string[];
};

type ReviewRequest = {
  itemType: 'entry' | 'photo';
  itemId: string;
  expectedVersion: number;
  title: string;
  kind?: string;
  category?: SamplePhotoCategoryDTO;
};

const emptySummary: SampleTeamSummaryDTO = {
  total: 0,
  dueToday: 0,
  overdue: 0,
  pendingReview: 0,
  collecting: 0,
  completed: 0,
  publishedItems: 0,
};

const emptyPlanForm: PlanForm = {
  drawingLibraryItemId: '',
  customerName: '',
  productName: '',
  specification: '',
  sourceOrderNo: '',
  customerLevelCode: 'A',
  customerLevelLabel: 'A级',
  customerLevelColor: '#C9972E',
  sampleQuantity: '',
  dueDate: '',
  priority: '2',
  planRemark: '',
  assigneeEmployeeIds: [],
};

const taskStatusLabels: Record<string, string> = {
  PLANNED: '待开始',
  IN_PROGRESS: '采集中',
  SUBMITTED: '已提交',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const dataStatusLabels: Record<string, string> = {
  NO_DATA: '本次无采集',
  COLLECTING: '正在采集',
  PENDING_REVIEW: '等待审核',
  NEEDS_CHANGES: '待修改',
  PARTIALLY_PUBLISHED: '部分已同步',
  PROCESSED: '数据已处理',
};

const dataKindLabels: Record<string, string> = {
  PROCESS_TIME: '工序与工时',
  STRIPPING: '剥皮参数',
  MATERIAL: '辅料数据',
  NOTICE: '注意事项',
  CUSTOM: '自定义记录',
};

const reviewStatusLabels: Record<string, string> = {
  DRAFT: '采集草稿',
  PENDING: '待审核',
  CHANGES_REQUESTED: '待修改',
  APPROVED: '审核通过',
  PUBLISHED: '已发布',
  VOIDED: '已作废',
};

const photoCategoryLabels: Record<SamplePhotoCategoryDTO, string> = {
  UNCLASSIFIED: '未分类',
  PROCESS: '过程图',
  MEASUREMENT: '测量证据',
  FINISHED: '成品图',
  DETAIL: '细节图',
  EXCEPTION: '异常参考',
};

const payloadLabels: Record<string, string> = {
  processName: '工序',
  recommendedSeconds: '建议工时',
  measurements: '实测记录',
  setupSeconds: '准备时间',
  occurrences: '发生次数',
  timeBasis: '计时口径',
  unitLabel: '生产单位',
  model: '连接器型号',
  outerPeelMm: '外剥皮',
  innerPeelMm: '内剥皮',
  insertionLengthMm: '入长',
  positionLabel: '部位',
  name: '辅料名称',
  specification: '规格',
  length: '长度',
  quantity: '数量',
  unit: '单位',
  tolerance: '公差',
  position: '使用位置',
  category: '分类',
  severity: '等级',
  content: '内容',
  value: '记录值',
  remark: '备注',
};

function dateText(value?: string | null) {
  if (!value) return '未设置';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function dateTimeText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function payloadValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  if (key === 'recommendedSeconds' || key === 'setupSeconds') return `${value} 秒`;
  if (key === 'measurements' && Array.isArray(value)) {
    return value.map(item => {
      const next = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>).value : item;
      return next === null || next === undefined || next === '' ? '' : `${next} 秒`;
    }).filter(Boolean).join('、');
  }
  if (key === 'timeBasis') return value === 'per_batch' ? '按批' : '按件';
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function payloadRows(entry: SampleDataEntryDTO) {
  return Object.entries(entry.payload)
    .filter(([key]) => !['processDefinitionId', 'countsForEfficiency', 'isCritical'].includes(key))
    .map(([key, value]) => ({ key, label: payloadLabels[key] || key, value: payloadValue(key, value) }))
    .filter(item => item.value);
}

function taskLevelText(task: SampleTaskDTO) {
  return task.customerLevelLabel || (task.customerLevelCode ? `${task.customerLevelCode}级` : '未分级');
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

export default function SampleTeamCenter({ user, mode }: { user: CurrentUserDTO; mode: CenterMode }) {
  const [tasks, setTasks] = useState<SampleTaskDTO[]>([]);
  const [summary, setSummary] = useState<SampleTeamSummaryDTO>(emptySummary);
  const [selectedId, setSelectedId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [context, setContext] = useState<ContextPayload>({ members: [], sampleMemberCount: 0, products: [], processes: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(emptyPlanForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [qrTask, setQrTask] = useState<SampleTaskDTO | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'PUBLISH' | 'APPROVE' | 'CHANGES_REQUESTED' | 'VOID'>('PUBLISH');
  const [reviewMode, setReviewMode] = useState<SamplePublishModeDTO>('APPEND');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewCategory, setReviewCategory] = useState<SamplePhotoCategoryDTO>('UNCLASSIFIED');
  const [reviewSaving, setReviewSaving] = useState(false);
  const initialSelectedRef = useRef(false);

  const selected = tasks.find(task => task.id === selectedId) || tasks[0] || null;
  const visibleMembers = showAllMembers ? context.members : context.members.filter(member => member.sampleTeam);
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return context.products.slice(0, 120);
    return context.products.filter(product => `${product.customerName} ${product.productName || ''} ${product.specification}`.toLowerCase().includes(query)).slice(0, 120);
  }, [context.products, productSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    fetch('/api/sample-team/context', { cache: 'no-store' })
      .then(async response => {
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '基础资料加载失败');
        setContext({
          members: Array.isArray(body.members) ? body.members : [],
          sampleMemberCount: Number(body.sampleMemberCount || 0),
          products: Array.isArray(body.products) ? body.products : [],
          processes: Array.isArray(body.processes) ? body.processes : [],
        });
      })
      .catch(reason => setMessage(reason instanceof Error ? reason.message : '基础资料加载失败'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (debouncedKeyword) query.set('keyword', debouncedKeyword);
    if (statusFilter !== 'ALL') query.set('status', statusFilter);
    setLoading(true);
    setError('');
    fetch(`/api/sample-tasks?${query.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '样品任务加载失败');
        const nextTasks = Array.isArray(body.tasks) ? body.tasks as SampleTaskDTO[] : [];
        setTasks(nextTasks);
        setSummary(body.summary || emptySummary);
        setSelectedId(currentSelectedId => {
          if (!initialSelectedRef.current || !nextTasks.some(task => task.id === currentSelectedId)) {
            initialSelectedRef.current = true;
            return nextTasks[0]?.id || '';
          }
          return currentSelectedId;
        });
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '样品任务加载失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debouncedKeyword, statusFilter, refreshToken]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function replaceTask(task: SampleTaskDTO | null | undefined) {
    if (!task) return;
    setTasks(current => current.map(item => item.id === task.id ? task : item));
    setSelectedId(task.id);
  }

  function openCreate() {
    setForm(emptyPlanForm);
    setProductSearch('');
    setShowAllMembers(context.sampleMemberCount === 0);
    setFormError('');
    setCreateOpen(true);
  }

  function openEdit(task: SampleTaskDTO) {
    setForm({
      drawingLibraryItemId: task.drawingLibraryItemId,
      customerName: task.customerName,
      productName: task.productName || '',
      specification: task.specification,
      sourceOrderNo: task.sourceOrderNo || '',
      customerLevelCode: task.customerLevelCode || '',
      customerLevelLabel: task.customerLevelLabel || '',
      customerLevelColor: task.customerLevelColor || '#C9972E',
      sampleQuantity: task.sampleQuantity === null ? '' : String(task.sampleQuantity),
      dueDate: task.dueDate || '',
      priority: String(task.priority),
      planRemark: task.planRemark || '',
      assigneeEmployeeIds: task.assignees.map(item => item.employeeId),
    });
    setShowAllMembers(context.sampleMemberCount === 0 || task.assignees.some(item => !context.members.find(member => member.id === item.employeeId)?.sampleTeam));
    setFormError('');
    setEditOpen(true);
  }

  function toggleAssignee(employeeId: string) {
    setForm(current => ({
      ...current,
      assigneeEmployeeIds: current.assigneeEmployeeIds.includes(employeeId)
        ? current.assigneeEmployeeIds.filter(id => id !== employeeId)
        : [...current.assigneeEmployeeIds, employeeId],
    }));
  }

  async function savePlan() {
    setSaving(true);
    setFormError('');
    try {
      if (editOpen && selected) {
        const response = await fetch(`/api/sample-tasks/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, action: 'UPDATE', expectedVersion: selected.version }),
        });
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '计划保存失败');
        replaceTask(body.task as SampleTaskDTO);
        setEditOpen(false);
        setMessage('样品计划已更新');
      } else {
        const response = await fetch('/api/sample-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '计划创建失败');
        setCreateOpen(false);
        setMessage('样品任务已创建');
        setRefreshToken(value => value + 1);
        if (body.task?.id) setSelectedId(body.task.id);
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '计划保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function taskAction(task: SampleTaskDTO, action: 'START' | 'COMPLETE' | 'CANCEL' | 'REOPEN') {
    if (action === 'CANCEL' && !window.confirm('确认取消这个样品任务？已采集和已发布的数据会保留。')) return;
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedVersion: task.version }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '任务操作失败');
      replaceTask(body.task as SampleTaskDTO);
      setMessage(action === 'COMPLETE' ? '样品任务已完成' : action === 'REOPEN' ? '样品任务已重新打开' : action === 'CANCEL' ? '样品任务已取消' : '样品任务已开始');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '任务操作失败');
    }
  }

  async function openQr(task: SampleTaskDTO) {
    const link = `${window.location.origin}${task.captureUrl}`;
    setQrTask(task);
    setQrDataUrl('');
    try {
      setQrDataUrl(await QRCode.toDataURL(link, { margin: 1, width: 260, color: { dark: '#1f2937', light: '#ffffff' } }));
    } catch {
      setMessage('二维码生成失败，可直接复制采集链接');
    }
  }

  async function copyCaptureLink(task: SampleTaskDTO) {
    try {
      await writeClipboardText(`${window.location.origin}${task.captureUrl}`);
      setMessage('采集链接已复制');
    } catch {
      setMessage('复制失败，请手动打开采集页');
    }
  }

  function openReview(item: SampleDataEntryDTO | SamplePhotoDTO, itemType: 'entry' | 'photo', decision: typeof reviewDecision) {
    const title = itemType === 'entry'
      ? `${dataKindLabels[(item as SampleDataEntryDTO).kind] || '样品数据'} · ${(item as SampleDataEntryDTO).label || '未命名记录'}`
      : `${photoCategoryLabels[(item as SamplePhotoDTO).category]} · ${(item as SamplePhotoDTO).caption || (item as SamplePhotoDTO).originalName}`;
    setReviewRequest({
      itemType,
      itemId: item.id,
      expectedVersion: item.version,
      title,
      kind: itemType === 'entry' ? (item as SampleDataEntryDTO).kind : undefined,
      category: itemType === 'photo' ? (item as SamplePhotoDTO).category : undefined,
    });
    setReviewDecision(decision);
    setReviewMode(decision === 'APPROVE' ? 'RECORD_ONLY' : 'APPEND');
    setReviewComment('');
    setReviewCategory(itemType === 'photo' ? (item as SamplePhotoDTO).category : 'UNCLASSIFIED');
  }

  async function saveReview() {
    if (!selected || !reviewRequest) return;
    setReviewSaving(true);
    try {
      const response = await fetch(`/api/sample-tasks/${selected.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: reviewRequest.itemType,
          itemId: reviewRequest.itemId,
          expectedVersion: reviewRequest.expectedVersion,
          decision: reviewDecision,
          publishMode: reviewDecision === 'APPROVE' ? 'RECORD_ONLY' : reviewMode,
          comment: reviewComment,
          category: reviewCategory,
        }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '审核失败');
      replaceTask(body.task as SampleTaskDTO);
      setReviewRequest(null);
      setMessage(reviewDecision === 'PUBLISH'
        ? reviewRequest.kind === 'PROCESS_TIME' ? '已通过审核并同步到产品工时草稿' : '已通过审核并发布到产品资料'
        : reviewDecision === 'APPROVE' ? '已通过审核并保留为样品记录' : reviewDecision === 'VOID' ? '记录已作废' : '已退回修改');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '审核失败');
    } finally {
      setReviewSaving(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const branchLinks = mode === 'planning'
    ? [{ href: '/weekly-plan-center', label: '量产计划' }, { href: '/weekly-plan-center?branch=samples', label: '样品组计划', active: true }]
    : [{ href: '/production', label: '量产执行' }, { href: '/production?branch=samples', label: '样品执行', active: true }];

  return (
    <main className="sample-team-page hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref={mode === 'planning' ? '/weekly-plan-center' : '/production'}
        subtitle={mode === 'planning' ? '样品任务下达与数据审核' : '样品采集与照片留证'}
        hideHeader
        sidebarTriggerTargetId="sample-team-navigation-trigger"
        menuItems={[{ label: '退出登录', onSelect: () => { void logout(); } }]}
      />

      <div className="sample-team-main">
        <header className="sample-team-commandbar">
          <div className="sample-team-title">
            <span id="sample-team-navigation-trigger" className="sample-team-navigation-trigger" />
            <div><small>{mode === 'planning' ? '计划中心分支' : '生产执行分支'}</small><h1>{mode === 'planning' ? '样品组计划' : '样品执行'}</h1><p>{mode === 'planning' ? '下达任务、分项审核、受控沉淀产品资料' : '自由采集数据和照片，不计算产量与效率'}</p></div>
          </div>
          <nav className="sample-team-branch-tabs" aria-label={mode === 'planning' ? '计划中心分支' : '生产执行分支'}>
            {branchLinks.map(item => <Link key={item.href} className={item.active ? 'active' : ''} href={item.href} prefetch={false}>{item.label}</Link>)}
          </nav>
          <div className="sample-team-command-actions">
            {mode === 'planning' && <button className="hm-workbench-button primary" type="button" onClick={openCreate}><Plus size={15} />新建样品计划</button>}
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
          </div>
        </header>

        <section className="sample-team-metrics" aria-label="样品任务摘要">
          <article><span>当前任务</span><strong>{summary.total}</strong><small>不含已取消</small></article>
          <article className={summary.dueToday ? 'attention' : ''}><span>今日到期</span><strong>{summary.dueToday}</strong><small>按计划日期</small></article>
          <article className={summary.overdue ? 'danger' : ''}><span>已经逾期</span><strong>{summary.overdue}</strong><small>不评价个人效率</small></article>
          <article className={summary.pendingReview ? 'pending' : ''}><span>等待审核</span><strong>{summary.pendingReview}</strong><small>按任务统计</small></article>
          <article><span>已发布资料</span><strong>{summary.publishedItems}</strong><small>按数据与照片统计</small></article>
        </section>

        <section className="sample-team-toolbar">
          <label><Search size={17} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索任务、客户、规格、订单或成员" /></label>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="任务状态筛选">
            <option value="ALL">全部状态</option>
            <option value="PLANNED">待开始</option>
            <option value="IN_PROGRESS">采集中</option>
            <option value="SUBMITTED">已提交</option>
            <option value="COMPLETED">已完成</option>
            <option value="CANCELLED">已取消</option>
          </select>
          <span>{loading ? '加载中…' : `${tasks.length} 个任务`}</span>
        </section>

        {error && <div className="sample-team-error"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}

        <section className="sample-team-workspace">
          <aside className="sample-task-list hm-scroll-region" aria-label="样品任务列表" tabIndex={0}>
            {loading && !tasks.length && Array.from({ length: 5 }, (_, index) => <div className="sample-task-card skeleton" key={index} />)}
            {tasks.map(task => (
              <button className={`sample-task-card ${selected?.id === task.id ? 'active' : ''} status-${task.status.toLowerCase()}`} type="button" key={task.id} onClick={() => setSelectedId(task.id)}>
                <span className="sample-task-color" style={{ background: task.customerLevelColor || '#cbd5e1' }} />
                <header><em style={{ borderColor: task.customerLevelColor || '#cbd5e1', color: task.customerLevelColor || '#64748b' }}>{taskLevelText(task)}</em><small>{task.code}</small></header>
                <strong title={task.specification}>{task.specification}</strong>
                <p>{task.customerName} · {task.productName || '未设置品名'}</p>
                <div><span>{taskStatusLabels[task.status]}</span><span>{dataStatusLabels[task.dataStatus]}</span><span>{dateText(task.dueDate)}</span></div>
                <footer><span><FileText size={12} />{task.counts.data}</span><span><ImageIcon size={12} />{task.counts.photos}</span><span>{task.assignees.map(item => item.name).join('、') || '未指派'}</span></footer>
              </button>
            ))}
            {!loading && !tasks.length && <div className="sample-team-empty"><PackageCheck size={32} /><strong>当前没有样品任务</strong><p>{keyword || statusFilter !== 'ALL' ? '清除筛选后再试。' : mode === 'planning' ? '点击“新建样品计划”下达第一条任务。' : '样品计划下达后会显示在这里。'}</p></div>}
          </aside>

          <section className="sample-task-detail">
            {!selected ? <div className="sample-team-empty"><ClipboardCheck size={34} /><strong>请选择样品任务</strong><p>查看采集记录、照片和审核状态。</p></div> : <>
              <header className="sample-detail-head">
                <div><span style={{ background: selected.customerLevelColor || '#cbd5e1' }}>{taskLevelText(selected)}</span><small>{selected.code}</small><h2>{selected.specification}</h2><p>{selected.customerName} · {selected.productName || '未设置品名'}{selected.sourceOrderNo ? ` · 来源 ${selected.sourceOrderNo}` : ''}</p></div>
                <div className="sample-detail-actions">
                  <button type="button" onClick={() => void openQr(selected)}><QrCode size={15} />二维码</button>
                  {mode === 'planning' && selected.status !== 'CANCELLED' && <button type="button" onClick={() => openEdit(selected)}><Pencil size={15} />编辑计划</button>}
                  {selected.status === 'PLANNED' && <button className="primary" type="button" onClick={() => void taskAction(selected, 'START')}>开始任务</button>}
                  {(selected.status === 'IN_PROGRESS' || selected.status === 'SUBMITTED') && <button className="primary" type="button" onClick={() => void taskAction(selected, 'COMPLETE')}>完成样品</button>}
                  {(selected.status === 'COMPLETED' || selected.status === 'CANCELLED') && <button type="button" onClick={() => void taskAction(selected, 'REOPEN')}>重新打开</button>}
                </div>
              </header>

              <section className="sample-detail-facts">
                <div><span>任务状态</span><strong>{taskStatusLabels[selected.status]}</strong><small>{dataStatusLabels[selected.dataStatus]}</small></div>
                <div><span>计划日期</span><strong>{dateText(selected.dueDate)}</strong><small>{selected.sampleQuantity === null ? '数量未设置' : `${selected.sampleQuantity} 件/套`}</small></div>
                <div><span>样品成员</span><strong>{selected.assignees.length || 0} 人</strong><small>{selected.assignees.map(item => item.name).join('、') || '尚未指派'}</small></div>
                <div><span>本次采集</span><strong>{selected.counts.data} 条 · {selected.counts.photos} 图</strong><small>待审核 {selected.counts.pendingReview} 条</small></div>
              </section>

              {selected.planRemark && <div className="sample-plan-remark"><strong>计划说明</strong><p>{selected.planRemark}</p></div>}

              <section className="sample-capture-callout">
                <div><Camera size={22} /><span><strong>扫码填写数据与拍照</strong><small>所有采集项均为选填；空白不判缺项，也无需说明原因。</small></span></div>
                <div><Link className="primary" href={selected.captureUrl} prefetch={false}>打开采集页<ArrowRight size={15} /></Link><button type="button" onClick={() => void copyCaptureLink(selected)}><Copy size={15} />复制链接</button></div>
              </section>

              <div className="sample-record-columns">
                <section className="sample-record-panel">
                  <header><div><FileText size={17} /><span><strong>采集数据</strong><small>{selected.entries.length} 条记录</small></span></div><Link href={selected.captureUrl} prefetch={false}>继续采集</Link></header>
                  <div className="sample-record-list hm-scroll-region" tabIndex={0}>
                    {selected.entries.map(entry => <article className={`sample-data-record review-${entry.reviewStatus.toLowerCase()}`} key={entry.id}>
                      <header><span>{dataKindLabels[entry.kind] || entry.kind}</span><strong>{entry.label || '未命名记录'}</strong><em>{reviewStatusLabels[entry.reviewStatus]}</em></header>
                      {!!payloadRows(entry).length && <dl>{payloadRows(entry).map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
                      <footer><span>{entry.updatedBy || entry.createdBy || '未记录'} · {dateTimeText(entry.updatedAt)}</span>{entry.reviewComment && <p>审核意见：{entry.reviewComment}</p>}</footer>
                      {mode === 'planning' && entry.reviewStatus === 'PENDING' && <div className="sample-review-actions"><button className="primary" type="button" onClick={() => openReview(entry, 'entry', 'PUBLISH')}>{entry.kind === 'PROCESS_TIME' ? '通过并同步草稿' : '通过并发布'}</button><button type="button" onClick={() => openReview(entry, 'entry', 'APPROVE')}>通过留档</button><button type="button" onClick={() => openReview(entry, 'entry', 'CHANGES_REQUESTED')}>退回</button><button className="danger" type="button" onClick={() => openReview(entry, 'entry', 'VOID')}>作废</button></div>}
                      {entry.kind === 'PROCESS_TIME' && entry.publishedEntityType === 'product_time_draft' && <Link className="sample-published-link" href={`/workspace/product-times?itemId=${encodeURIComponent(selected.drawingLibraryItemId)}`} prefetch={false}><Clock3 size={13} />已同步产品工时草稿，进入影响预览后正式发布</Link>}
                    </article>)}
                    {!selected.entries.length && <div className="sample-record-empty"><FileText size={25} /><strong>本次尚未采集数据</strong><p>这不是缺项，任务仍可提交或完成。</p></div>}
                  </div>
                </section>

                <section className="sample-record-panel photo-panel">
                  <header><div><ImageIcon size={17} /><span><strong>过程与成品照片</strong><small>{selected.photos.length} 张照片</small></span></div><Link href={selected.captureUrl} prefetch={false}>继续拍照</Link></header>
                  <div className="sample-photo-grid hm-scroll-region" tabIndex={0}>
                    {selected.photos.map((photo, photoIndex) => <article className={`review-${photo.reviewStatus.toLowerCase()}`} key={photo.id}>
                      <a href={photo.contentUrl} target="_blank" rel="noreferrer"><Image unoptimized priority={photoIndex === 0} width={220} height={132} src={photo.contentUrl} alt={photo.caption || photo.originalName} /></a>
                      <div><header><strong>{photoCategoryLabels[photo.category]}</strong><em>{reviewStatusLabels[photo.reviewStatus]}</em></header><p>{photo.caption || photo.originalName}</p><small>{photo.uploadedBy || '未记录'} · {dateTimeText(photo.createdAt)}</small>{photo.reviewComment && <span>审核意见：{photo.reviewComment}</span>}</div>
                      {mode === 'planning' && photo.reviewStatus === 'PENDING' && <footer><button className="primary" type="button" onClick={() => openReview(photo, 'photo', 'PUBLISH')}>通过并发布</button><button type="button" onClick={() => openReview(photo, 'photo', 'APPROVE')}>通过留档</button><button type="button" onClick={() => openReview(photo, 'photo', 'CHANGES_REQUESTED')}>退回</button><button className="danger" type="button" onClick={() => openReview(photo, 'photo', 'VOID')}>作废</button></footer>}
                    </article>)}
                    {!selected.photos.length && <div className="sample-record-empty"><ImageIcon size={25} /><strong>本次尚未上传照片</strong><p>照片同样不设必选项。</p></div>}
                  </div>
                </section>
              </div>

              <footer className="sample-detail-footer">
                <div><span>创建 {dateTimeText(selected.createdAt)} · {selected.createdBy || '未记录'}</span><span>最近更新 {dateTimeText(selected.updatedAt)}</span></div>
                <div><Link href={`/drawing-library?itemId=${encodeURIComponent(selected.drawingLibraryItemId)}`} prefetch={false}><FolderKanban size={14} />查看产品资料</Link>{selected.status !== 'CANCELLED' && selected.status !== 'COMPLETED' && mode === 'planning' && <button className="danger" type="button" onClick={() => void taskAction(selected, 'CANCEL')}>取消任务</button>}</div>
              </footer>
            </>}
          </section>
        </section>
      </div>

      {message && <div className="sample-team-toast" role="status">{message}</div>}

      {(createOpen || editOpen) && <div className="sample-modal-backdrop" role="presentation">
        <section className="sample-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-plan-dialog-title">
          <header><div><span>{editOpen ? '编辑样品计划' : '新增样品计划'}</span><h2 id="sample-plan-dialog-title">{editOpen ? selected?.code : '建立任务与产品关联'}</h2></div><button type="button" aria-label="关闭" onClick={() => { if (!saving) { setCreateOpen(false); setEditOpen(false); } }}><X /></button></header>
          <div className="sample-plan-dialog-body hm-scroll-region" tabIndex={0}>
            {!editOpen && <section className="sample-plan-section">
              <div className="sample-section-title"><strong>产品</strong><small>可选择现有产品，也可直接建立新规格主档</small></div>
              <label className="sample-product-search"><Search size={15} /><input value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="搜索客户、规格或品名" /></label>
              <select value={form.drawingLibraryItemId} onChange={event => {
                const product = context.products.find(item => item.id === event.target.value);
                setForm(current => ({
                  ...current,
                  drawingLibraryItemId: event.target.value,
                  customerName: product?.customerName || current.customerName,
                  productName: product?.productName || current.productName,
                  specification: product?.specification || current.specification,
                }));
              }}>
                <option value="">新产品 / 新规格</option>
                {visibleProducts.map(product => <option key={product.id} value={product.id}>{product.specification} · {product.customerName} · {product.productName || '未设置品名'}</option>)}
              </select>
              {!form.drawingLibraryItemId && <div className="sample-form-grid three"><label><span>客户</span><input value={form.customerName} onChange={event => setForm(current => ({ ...current, customerName: event.target.value }))} placeholder="建立产品主档所需" /></label><label><span>产品名称</span><input value={form.productName} onChange={event => setForm(current => ({ ...current, productName: event.target.value }))} placeholder="可留空" /></label><label><span>产品规格</span><input value={form.specification} onChange={event => setForm(current => ({ ...current, specification: event.target.value }))} placeholder="建立产品主档所需" /></label></div>}
            </section>}

            <section className="sample-plan-section">
              <div className="sample-section-title"><strong>计划信息</strong><small>客户等级只控制显示和优先顺序，不生成必填项</small></div>
              <div className="sample-form-grid four">
                <label><span>客户等级代码</span><input value={form.customerLevelCode} onChange={event => setForm(current => ({ ...current, customerLevelCode: event.target.value }))} placeholder="例如 A" /></label>
                <label><span>显示名称</span><input value={form.customerLevelLabel} onChange={event => setForm(current => ({ ...current, customerLevelLabel: event.target.value }))} placeholder="例如 A级" /></label>
                <label><span>等级颜色</span><div className="sample-color-input"><input type="color" value={form.customerLevelColor || '#C9972E'} onChange={event => setForm(current => ({ ...current, customerLevelColor: event.target.value }))} /><input value={form.customerLevelColor} onChange={event => setForm(current => ({ ...current, customerLevelColor: event.target.value }))} /></div></label>
                <label><span>优先级 0-9</span><input type="number" min="0" max="9" value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value }))} /></label>
                <label><span>来源订单</span><input value={form.sourceOrderNo} onChange={event => setForm(current => ({ ...current, sourceOrderNo: event.target.value }))} placeholder="可留空" /></label>
                <label><span>样品数量</span><input type="number" min="0" value={form.sampleQuantity} onChange={event => setForm(current => ({ ...current, sampleQuantity: event.target.value }))} placeholder="可留空" /></label>
                <label><span>计划日期</span><input type="date" value={form.dueDate} onChange={event => setForm(current => ({ ...current, dueDate: event.target.value }))} /></label>
              </div>
              <label className="sample-plan-remark-input"><span>计划说明</span><textarea value={form.planRemark} onChange={event => setForm(current => ({ ...current, planRemark: event.target.value }))} placeholder="可留空；只描述任务背景和交付要求" /></label>
            </section>

            <section className="sample-plan-section">
              <div className="sample-section-title"><strong>样品组成员</strong><small>{context.sampleMemberCount ? `已识别 ${context.sampleMemberCount} 名样品组成员` : '当前员工资料中未识别到“样品”班组名称，可从全部员工选择'}</small><button type="button" onClick={() => setShowAllMembers(value => !value)}>{showAllMembers ? '只看样品组' : '查看全部员工'}</button></div>
              <div className="sample-member-grid">{visibleMembers.map(member => <button className={form.assigneeEmployeeIds.includes(member.id) ? 'selected' : ''} type="button" key={member.id} onClick={() => toggleAssignee(member.id)}><span>{member.name.slice(0, 1)}</span><b>{member.name}<small>{member.employeeNo} · {member.position || '岗位未设置'}</small></b><em>{member.team || member.department || '班组未设置'}</em></button>)}{!visibleMembers.length && <p>没有可选择的样品组成员，请查看全部员工或先维护员工班组。</p>}</div>
            </section>
            {formError && <div className="sample-form-error"><AlertTriangle size={16} />{formError}</div>}
          </div>
          <footer><span>采集数据全部选填；这里只建立任务和产品归属。</span><div><button type="button" disabled={saving} onClick={() => { setCreateOpen(false); setEditOpen(false); }}>取消</button><button className="primary" type="button" disabled={saving} onClick={() => void savePlan()}>{saving ? <><Loader2 className="spin" size={15} />保存中</> : editOpen ? '保存计划' : '创建样品任务'}</button></div></footer>
        </section>
      </div>}

      {qrTask && <div className="sample-modal-backdrop" role="presentation">
        <section className="sample-qr-dialog" role="dialog" aria-modal="true" aria-label="样品采集二维码">
          <header><div><span>样品采集二维码</span><h2>{qrTask.code}</h2></div><button type="button" aria-label="关闭" onClick={() => setQrTask(null)}><X /></button></header>
          <div className="sample-qr-content">{qrDataUrl ? <Image unoptimized priority width={260} height={260} src={qrDataUrl} alt={`${qrTask.code}样品采集二维码`} /> : <Loader2 className="spin" />}<strong>{qrTask.specification}</strong><p>{qrTask.customerName} · {taskLevelText(qrTask)}</p><small>扫码后填写数据与拍摄照片，不会生成量产报工或效率。</small></div>
          <footer><button type="button" onClick={() => void copyCaptureLink(qrTask)}><Copy size={15} />复制链接</button><Link className="primary" href={qrTask.captureUrl} prefetch={false}>打开采集页</Link></footer>
        </section>
      </div>}

      {reviewRequest && <div className="sample-modal-backdrop" role="presentation">
        <section className="sample-review-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-review-title">
          <header><div><span>分项审核</span><h2 id="sample-review-title">{reviewRequest.title}</h2></div><button type="button" aria-label="关闭" onClick={() => { if (!reviewSaving) setReviewRequest(null); }}><X /></button></header>
          <div className="sample-review-dialog-body">
            <div className="sample-review-decisions">
              <button className={reviewDecision === 'PUBLISH' ? 'active' : ''} type="button" onClick={() => setReviewDecision('PUBLISH')}>通过并同步</button>
              <button className={reviewDecision === 'APPROVE' ? 'active' : ''} type="button" onClick={() => setReviewDecision('APPROVE')}>通过留档</button>
              <button className={reviewDecision === 'CHANGES_REQUESTED' ? 'active' : ''} type="button" onClick={() => setReviewDecision('CHANGES_REQUESTED')}>退回修改</button>
              <button className={reviewDecision === 'VOID' ? 'active danger' : 'danger'} type="button" onClick={() => setReviewDecision('VOID')}>作废记录</button>
            </div>
            {reviewDecision === 'PUBLISH' && reviewRequest.itemType === 'entry' && <label><span>发布方式</span><select value={reviewMode} onChange={event => setReviewMode(event.target.value as SamplePublishModeDTO)}><option value="APPEND">追加为新记录</option><option value="REPLACE_MATCHING">替换同名/同部位当前记录</option></select></label>}
            {reviewDecision === 'PUBLISH' && reviewRequest.itemType === 'photo' && <label><span>照片分类</span><select value={reviewCategory} onChange={event => setReviewCategory(event.target.value as SamplePhotoCategoryDTO)}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            {reviewRequest.kind === 'PROCESS_TIME' && reviewDecision === 'PUBLISH' && <div className="sample-review-note"><AlertTriangle size={17} /><span><strong>先同步到受控产品工时草稿</strong><small>仍需在产品工序与工时页面预览关联工单影响后正式发布，避免绕过现有生产安全门禁。</small></span></div>}
            <label><span>{reviewDecision === 'CHANGES_REQUESTED' ? '修改意见（自由填写，可留空）' : '审核备注（可留空）'}</span><textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder="不提供固定原因选项" /></label>
          </div>
          <footer><button type="button" disabled={reviewSaving} onClick={() => setReviewRequest(null)}>取消</button><button className={reviewDecision === 'VOID' ? 'danger' : 'primary'} type="button" disabled={reviewSaving} onClick={() => void saveReview()}>{reviewSaving ? <><Loader2 className="spin" size={15} />处理中</> : '确认审核'}</button></footer>
        </section>
      </div>}
    </main>
  );
}
