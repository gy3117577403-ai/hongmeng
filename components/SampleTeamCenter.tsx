'use client';

import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Info,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ModuleModeDrawer, ModuleModeTrigger, useModuleModeDrawer } from '@/components/layout/ModuleModeDrawer';
import { SamplePhotoViewerDialog } from '@/components/SamplePhotoViewerDialog';
import { writeClipboardText } from '@/lib/client-platform';
import {
  SAMPLE_CUSTOMER_LEVELS,
  sampleCustomerLevelOrDefault,
  sampleCustomerLevelStyle,
} from '@/lib/sample-customer-levels';
import type {
  CurrentUserDTO,
  SampleDataEntryDTO,
  SamplePhotoCategoryDTO,
  SamplePhotoDTO,
  SampleTaskDTO,
  SampleTeamSummaryDTO,
} from '@/types';

type CenterMode = 'planning' | 'execution' | 'materials';
type TaskViewFilter = 'ALL' | 'TODAY' | 'OVERDUE' | 'PLANNED' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'COMPLETED' | 'CANCELLED';
type DetailTab = 'overview' | 'data' | 'materials' | 'photos' | 'review' | 'published';
type SampleDeletePreview = {
  task: { id: string; code: string; customerName: string; productName: string | null; specification: string; status: string; version: number; dataPurpose: string; completedAt: string | null; archivedAt: string | null };
  impact: { entryCount: number; photoCount: number; submissionCount: number; publishedDrawingFileCount: number; productDataRecordCount: number; connectorBindingCount: number; affectedProductTimeProfileCount: number; objectDeletionCount: number };
  blockers: string[];
  canDelete: boolean;
  previewToken: string;
  publishedOutputsRetained: boolean;
};
type SampleTrashItem = { task: SampleTaskDTO; deletedAt: string; deletedBy: string | null; deleteReason: string | null; deleteBatchId: string | null };
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
  dataPurpose: 'PRODUCTION' | 'TEST' | 'TRAINING';
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

type SampleImportCandidate = {
  id: string;
  libraryKey: string;
  customerName: string;
  productName: string | null;
  specification: string;
  score?: number;
};

type SampleImportRow = {
  rowNumber: number;
  customerName: string;
  productName: string;
  specification: string;
  customerLevelCode: string;
  sampleQuantity: number;
  dueDate: string;
  libraryKey: string;
  matchStatus: 'REUSE' | 'CREATE' | 'CONFIRM' | 'BLOCKED';
  message: string;
  matchedItemId: string | null;
  candidates: SampleImportCandidate[];
};

type SampleImportPreview = {
  fileName: string;
  rows: SampleImportRow[];
  summary: { total: number; reuse: number; create: number; confirm: number; blocked: number };
};

type SampleImportDecision = { mode: 'reuse'; drawingLibraryItemId: string } | { mode: 'create' };
type SampleImportStep = 'UPLOAD' | 'PREVIEW' | 'CONFLICTS' | 'COMPLETE';

type ReviewEntryDraft = {
  id: string;
  expectedVersion: number;
  kind: SampleDataEntryDTO['kind'];
  label: string;
  payload: Record<string, unknown>;
};

type ReviewPhotoDraft = {
  id: string;
  expectedVersion: number;
  category: SamplePhotoCategoryDTO;
  caption: string;
  originalName: string;
};

type ReviewIssue = {
  itemType: 'entry' | 'photo' | 'submission';
  itemId: string;
  title: string;
  message: string;
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
  dataPurpose: 'PRODUCTION',
  drawingLibraryItemId: '',
  customerName: '',
  productName: '',
  specification: '',
  sourceOrderNo: '',
  customerLevelCode: 'A',
  customerLevelLabel: 'A级',
  customerLevelColor: SAMPLE_CUSTOMER_LEVELS[0].color,
  sampleQuantity: '',
  dueDate: '',
  priority: String(SAMPLE_CUSTOMER_LEVELS[0].priority),
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
  PROCESS_TIME: '工序与工时照片',
  STRIPPING: '剥皮参数照片',
  MATERIAL: '辅料照片',
  NOTICE: '注意事项照片',
  SEMI_FINISHED: '半成品照片',
  PROCESS: '过程图',
  MEASUREMENT: '测量证据',
  FINISHED: '成品图',
  DETAIL: '细节图',
  EXCEPTION: '异常参考',
};

const payloadLabels: Record<string, string> = {
  processName: '工序',
  stageGroup: '工序阶段',
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
  publicationDecision: '发布处理',
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

const visiblePayloadKeys: Record<SampleDataEntryDTO['kind'], readonly string[]> = {
  PROCESS_TIME: ['processName', 'stageGroup', 'recommendedSeconds', 'measurements', 'setupSeconds', 'occurrences', 'timeBasis', 'unitLabel', 'remark'],
  STRIPPING: ['model', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'positionLabel', 'remark'],
  MATERIAL: ['name', 'specification', 'length', 'quantity', 'unit', 'tolerance', 'position', 'remark'],
  NOTICE: ['category', 'severity', 'content', 'processName', 'remark'],
  CUSTOM: ['value', 'unit', 'remark'],
};

const editablePayloadKeys: Record<SampleDataEntryDTO['kind'], readonly string[]> = {
  PROCESS_TIME: ['recommendedSeconds', 'setupSeconds', 'occurrences', 'timeBasis', 'unitLabel', 'remark'],
  STRIPPING: ['model', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'positionLabel', 'remark'],
  MATERIAL: ['name', 'specification', 'length', 'quantity', 'unit', 'tolerance', 'position', 'remark'],
  NOTICE: ['category', 'severity', 'content', 'processName', 'remark'],
  CUSTOM: ['value', 'unit', 'remark'],
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
  if (key === 'stageGroup') return value === 'backend' ? '后工序' : value === 'finish' ? '包装/收尾' : '前工序';
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function payloadRows(entry: SampleDataEntryDTO) {
  return visiblePayloadKeys[entry.kind]
    .map(key => ({ key, label: payloadLabels[key], value: payloadValue(key, entry.payload[key]) }))
    .filter(item => item.value);
}

function taskLevelText(task: SampleTaskDTO) {
  return task.customerLevelLabel || (task.customerLevelCode ? `${task.customerLevelCode}级` : '未分级');
}

function chinaTodayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function taskMatchesView(task: SampleTaskDTO, view: TaskViewFilter, today: string) {
  if (view === 'ALL') return task.status !== 'CANCELLED';
  if (view === 'TODAY') return task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && task.dueDate === today;
  if (view === 'OVERDUE') return task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && Boolean(task.dueDate && task.dueDate < today);
  if (view === 'PENDING_REVIEW') return task.status !== 'CANCELLED' && task.counts.pendingReview > 0;
  return task.status === view;
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

function browserMutationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sample-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SampleTeamCenter({
  user,
  mode,
  modeDrawerInitiallyOpen = false,
}: {
  user: CurrentUserDTO;
  mode: CenterMode;
  modeDrawerInitiallyOpen?: boolean;
}) {
  const modeDrawer = useModuleModeDrawer(modeDrawerInitiallyOpen);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [tasks, setTasks] = useState<SampleTaskDTO[]>([]);
  const [summary, setSummary] = useState<SampleTeamSummaryDTO>(emptySummary);
  const [selectedId, setSelectedId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [taskView, setTaskView] = useState<TaskViewFilter>('ALL');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [context, setContext] = useState<ContextPayload>({ members: [], sampleMemberCount: 0, products: [], processes: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<SampleImportStep>('UPLOAD');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<SampleImportPreview | null>(null);
  const [importDecisions, setImportDecisions] = useState<Record<string, SampleImportDecision>>({});
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<{ createdTaskCount: number; blockedCount: number; total: number } | null>(null);
  const [importMutationId, setImportMutationId] = useState(browserMutationId);
  const [form, setForm] = useState<PlanForm>(emptyPlanForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [qrTask, setQrTask] = useState<SampleTaskDTO | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [packageDialog, setPackageDialog] = useState<'EDIT' | 'REJECT' | null>(null);
  const [reviewEntryDrafts, setReviewEntryDrafts] = useState<ReviewEntryDraft[]>([]);
  const [reviewPhotoDrafts, setReviewPhotoDrafts] = useState<ReviewPhotoDraft[]>([]);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);
  const [deletePreview, setDeletePreview] = useState<SampleDeletePreview | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<SampleTrashItem[]>([]);
  const [trashBusy, setTrashBusy] = useState(false);
  const [restoreItem, setRestoreItem] = useState<SampleTrashItem | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreCode, setRestoreCode] = useState('');
  const reviewIssuesRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const reviewMutationRef = useRef<{ decision: 'CONFIRM' | 'EDIT' | 'REJECT'; key: string } | null>(null);
  const initialSelectedRef = useRef(false);
  const lastDetailTaskRef = useRef('');

  const todayKey = useMemo(chinaTodayKey, []);
  const visibleTasks = useMemo(
    () => tasks.filter(task => taskMatchesView(task, taskView, todayKey)),
    [taskView, tasks, todayKey],
  );
  const selected = visibleTasks.find(task => task.id === selectedId) || visibleTasks[0] || null;
  const activeTasks = useMemo(() => tasks.filter(task => task.status !== 'CANCELLED'), [tasks]);
  const viewCounts = useMemo(() => ({
    ALL: activeTasks.length,
    TODAY: activeTasks.filter(task => task.status !== 'COMPLETED' && task.dueDate === todayKey).length,
    OVERDUE: activeTasks.filter(task => task.status !== 'COMPLETED' && Boolean(task.dueDate && task.dueDate < todayKey)).length,
    PLANNED: activeTasks.filter(task => task.status === 'PLANNED').length,
    IN_PROGRESS: activeTasks.filter(task => task.status === 'IN_PROGRESS').length,
    PENDING_REVIEW: activeTasks.reduce((count, task) => count + task.counts.pendingReview, 0),
    COMPLETED: activeTasks.filter(task => task.status === 'COMPLETED').length,
    CANCELLED: tasks.filter(task => task.status === 'CANCELLED').length,
  }), [activeTasks, tasks, todayKey]);
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
  }, [debouncedKeyword, refreshToken]);

  useEffect(() => {
    setSelectedId(current => visibleTasks.some(task => task.id === current) ? current : visibleTasks[0]?.id || '');
  }, [visibleTasks]);

  useEffect(() => {
    if (!selected) {
      lastDetailTaskRef.current = '';
      setDetailTab('overview');
      return;
    }
    if (lastDetailTaskRef.current === selected.id) return;
    lastDetailTaskRef.current = selected.id;
    setDetailTab(mode === 'materials' ? 'materials' : selected.counts.pendingReview > 0 ? 'review' : 'overview');
  }, [mode, selected]);

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

  function openImport() {
    setImportOpen(true);
    setImportStep('UPLOAD');
    setImportFile(null);
    setImportPreview(null);
    setImportDecisions({});
    setImportResult(null);
    setImportError('');
    setImportMutationId(browserMutationId());
  }

  async function previewImport() {
    if (!importFile) {
      setImportError('请先选择填写完成的 .xlsx 模板');
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const payload = new FormData();
      payload.append('file', importFile);
      const response = await fetch('/api/sample-tasks/import/preview', { method: 'POST', body: payload });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '导入预览失败');
      setImportPreview(body as SampleImportPreview);
      setImportStep('PREVIEW');
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : '导入预览失败');
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    if (!importPreview) return;
    const unresolved = importPreview.rows.filter(row => row.matchStatus === 'CONFIRM' && !importDecisions[String(row.rowNumber)]);
    if (unresolved.length) {
      setImportError(`还有 ${unresolved.length} 行相似图纸库尚未确认`);
      setImportStep('CONFLICTS');
      return;
    }
    const acceptedRows = importPreview.rows.filter(row => row.matchStatus !== 'BLOCKED');
    if (!acceptedRows.length) {
      setImportError('没有可导入的计划，请修正模板后重新上传');
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const response = await fetch('/api/sample-tasks/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMutationId: importMutationId,
          fileName: importPreview.fileName,
          rows: importPreview.rows,
          decisions: importDecisions,
        }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '批量导入失败');
      setImportResult({ createdTaskCount: Number(body.createdTaskCount || 0), blockedCount: Number(body.blockedCount || 0), total: Number(body.total || 0) });
      setImportStep('COMPLETE');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : '批量导入失败');
    } finally {
      setImportBusy(false);
    }
  }

  function openEdit(task: SampleTaskDTO) {
    const level = sampleCustomerLevelOrDefault(task.customerLevelCode);
    setForm({
      dataPurpose: task.dataPurpose,
      drawingLibraryItemId: task.drawingLibraryItemId,
      customerName: task.customerName,
      productName: task.productName || '',
      specification: task.specification,
      sourceOrderNo: task.sourceOrderNo || '',
      customerLevelCode: level.code,
      customerLevelLabel: level.label,
      customerLevelColor: level.color,
      sampleQuantity: task.sampleQuantity === null ? '' : String(task.sampleQuantity),
      dueDate: task.dueDate || '',
      priority: String(level.priority),
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

  async function taskAction(task: SampleTaskDTO, action: 'START' | 'COMPLETE' | 'CANCEL' | 'ARCHIVE' | 'UNARCHIVE') {
    if (action === 'CANCEL' && !window.confirm('确认取消这个样品任务？已采集和已发布的数据会保留。')) return;
    if (action === 'COMPLETE' && !window.confirm('确认将这个没有采集资料的任务直接完成并归档？')) return;
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedVersion: task.version, ...(action === 'COMPLETE' ? { confirmNoData: true } : {}) }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '任务操作失败');
      replaceTask(body.task as SampleTaskDTO);
      setMessage(action === 'COMPLETE'
        ? '样品任务已完成并归档'
        : action === 'CANCEL'
          ? '样品任务已取消，现已只读'
          : action === 'ARCHIVE'
            ? '样品任务已归档，审核结果保持不变'
            : action === 'UNARCHIVE'
              ? '已取消归档，任务仍保持完成和审核通过'
              : '样品任务已开始');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '任务操作失败');
    }
  }

  async function openDeleteTask(task: SampleTaskDTO) {
    setDeleteReason('');
    setDeleteCode('');
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}/delete`, { cache: 'no-store' });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '删除影响加载失败');
      setDeletePreview(body.preview as SampleDeletePreview);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '删除影响加载失败');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function confirmDeleteTask() {
    if (!deletePreview || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/sample-tasks/${deletePreview.task.id}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: deleteReason,
          confirmationCode: deleteCode,
          previewToken: deletePreview.previewToken,
          expectedVersion: deletePreview.task.version,
          confirmed: true,
          clientMutationId: browserMutationId(),
        }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '样品任务删除失败');
      setDeletePreview(null);
      setMessage(`${body.code || '样品任务'}已移入回收站，正式发布资料和对象文件均保留`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '样品任务删除失败');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function loadTrash() {
    setTrashOpen(true);
    setTrashBusy(true);
    setRestoreItem(null);
    try {
      const response = await fetch('/api/sample-tasks/trash', { cache: 'no-store' });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '样品回收站加载失败');
      setTrashItems(Array.isArray(body.items) ? body.items as SampleTrashItem[] : []);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '样品回收站加载失败');
    } finally {
      setTrashBusy(false);
    }
  }

  function chooseRestoreItem(item: SampleTrashItem) {
    setRestoreItem(item);
    setRestoreReason('');
    setRestoreCode('');
  }

  async function confirmRestoreTask() {
    if (!restoreItem || trashBusy) return;
    setTrashBusy(true);
    try {
      const response = await fetch(`/api/sample-tasks/${restoreItem.task.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: restoreReason, confirmationCode: restoreCode, expectedVersion: restoreItem.task.version, confirmed: true }),
      });
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body.error || '样品任务恢复失败');
      setTrashItems(current => current.filter(item => item.task.id !== restoreItem.task.id));
      setRestoreItem(null);
      setMessage(`${body.task?.code || '样品任务'}已恢复`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '样品任务恢复失败');
    } finally {
      setTrashBusy(false);
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

  function openPackageDialog(next: 'EDIT' | 'REJECT') {
    if (!selected?.activeSubmission || selected.activeSubmission.status !== 'PENDING') return;
    setReviewComment('');
    if (next === 'REJECT') setReviewIssues([]);
    reviewMutationRef.current = null;
    if (next === 'EDIT') {
      const revision = selected.activeSubmission.revision;
      setReviewEntryDrafts(selected.entries
        .filter(entry => entry.submissionRevision === revision && entry.reviewStatus === 'PENDING')
        .map(entry => ({ id: entry.id, expectedVersion: entry.version, kind: entry.kind, label: entry.label || '', payload: { ...entry.payload } })));
      setReviewPhotoDrafts(selected.photos
        .filter(photo => photo.submissionRevision === revision && photo.reviewStatus === 'PENDING')
        .map(photo => ({ id: photo.id, expectedVersion: photo.version, category: photo.category, caption: photo.caption || '', originalName: photo.originalName })));
    }
    setPackageDialog(next);
  }

  function updateReviewEntry(id: string, patch: Partial<Pick<ReviewEntryDraft, 'label' | 'payload'>>) {
    setReviewEntryDrafts(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
  }

  function updateReviewEntryPayload(id: string, key: string, value: unknown) {
    setReviewEntryDrafts(current => current.map(entry => entry.id === id
      ? { ...entry, payload: { ...entry.payload, [key]: value } }
      : entry));
  }

  function updateReviewPhoto(id: string, patch: Partial<Pick<ReviewPhotoDraft, 'category' | 'caption'>>) {
    setReviewPhotoDrafts(current => current.map(photo => photo.id === id ? { ...photo, ...patch } : photo));
  }

  function reviewMutationKey(decision: 'CONFIRM' | 'EDIT' | 'REJECT') {
    if (reviewMutationRef.current?.decision === decision) return reviewMutationRef.current.key;
    const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sample-review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    reviewMutationRef.current = { decision, key };
    return key;
  }

  async function savePackageReview(decision: 'CONFIRM' | 'EDIT' | 'REJECT') {
    if (!selected?.activeSubmission || selected.activeSubmission.status !== 'PENDING') {
      setMessage('当前没有可审核的提交包');
      return;
    }
    const autoCatalogCount = pendingEntries.filter(entry => entry.kind === 'PROCESS_TIME' && !String(entry.payload.processDefinitionId || '').trim() && String(entry.payload.processName || '').trim()).length;
    if (decision === 'CONFIRM' && !window.confirm(`确认一次通过 ${selected.specification} 的本次全部资料？${autoCatalogCount ? `系统会自动处理 ${autoCatalogCount} 条未绑定工序并写入工序库。` : ''}确认后任务会完成并归档。`)) return;
    if (decision === 'REJECT' && reviewComment.trim().length < 2) {
      setMessage('整包驳回必须填写明确原因');
      return;
    }
    setReviewSaving(true);
    try {
      const response = await fetch(`/api/sample-tasks/${selected.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: selected.activeSubmission.id,
          submissionRevision: selected.activeSubmission.revision,
          expectedTaskVersion: selected.version,
          clientMutationId: reviewMutationKey(decision),
          decision,
          comment: reviewComment,
          ...(decision === 'EDIT' ? {
            edits: {
              entries: reviewEntryDrafts.map(entry => ({ id: entry.id, expectedVersion: entry.expectedVersion, label: entry.label, payload: entry.payload })),
              photos: reviewPhotoDrafts.map(photo => ({ id: photo.id, expectedVersion: photo.expectedVersion, category: photo.category, caption: photo.caption })),
            },
          } : {}),
        }),
      });
      const body = await responseJson(response);
      if (!response.ok) {
        const nextIssues = Array.isArray(body.issues) ? body.issues as ReviewIssue[] : [];
        setReviewIssues(nextIssues);
        window.setTimeout(() => reviewIssuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        const firstIssue = nextIssues[0];
        throw new Error(firstIssue ? `${body.error || '整包审核失败'}：${firstIssue.title}，${firstIssue.message}` : body.error || '整包审核失败');
      }
      reviewMutationRef.current = null;
      replaceTask(body.task as SampleTaskDTO);
      setPackageDialog(null);
      setReviewIssues([]);
      setReviewComment('');
      setMessage(decision === 'CONFIRM'
        ? '本次提交已整包确认，任务完成并归档'
        : decision === 'REJECT'
          ? '本次提交已整包驳回，可修改后重新提交'
          : '审核页修改已保存，仍等待整包确认');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '整包审核失败');
    } finally {
      setReviewSaving(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function renderDataRecord(entry: SampleDataEntryDTO) {
    return <article className={`sample-data-record review-${entry.reviewStatus.toLowerCase()}`} key={entry.id}>
      <header><span>{dataKindLabels[entry.kind] || entry.kind}</span><strong>{entry.label || '未命名记录'}</strong><em>{reviewStatusLabels[entry.reviewStatus]}</em></header>
      {!!payloadRows(entry).length && <dl>{payloadRows(entry).map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      <footer><span>{entry.updatedBy || entry.createdBy || '未记录'} · {dateTimeText(entry.updatedAt)}</span>{entry.reviewComment && <p>审核意见：{entry.reviewComment}</p>}</footer>
      {entry.kind === 'PROCESS_TIME' && entry.publishedEntityType === 'product_time_draft' && selected && <Link className="sample-published-link" href={`/workspace/product-times?itemId=${encodeURIComponent(selected.drawingLibraryItemId)}`} prefetch={false}><Clock3 size={13} />已同步产品工时草稿，进入影响预览后正式发布</Link>}
    </article>;
  }

  function renderPhotoRecord(photo: SamplePhotoDTO, photoIndex: number) {
    return <article className={`review-${photo.reviewStatus.toLowerCase()}`} key={photo.id}>
      <button className="sample-photo-preview-trigger" type="button" aria-label={`全屏查看${photo.caption || photo.originalName}`} onClick={() => setPhotoViewerIndex(Math.max(0, selected?.photos.findIndex(item => item.id === photo.id) ?? photoIndex))}><Image unoptimized priority={photoIndex === 0} width={220} height={132} src={photo.contentUrl} alt={photo.caption || photo.originalName} /></button>
      <div><header><strong>{photoCategoryLabels[photo.category]}</strong><em>{reviewStatusLabels[photo.reviewStatus]}</em></header><p>{photo.caption || photo.originalName}</p><small>{photo.uploadedBy || '未记录'} · {dateTimeText(photo.createdAt)}</small>{photo.reviewComment && <span>审核意见：{photo.reviewComment}</span>}</div>
    </article>;
  }

  const terminalTask = selected?.status === 'COMPLETED' || selected?.status === 'CANCELLED';
  const activeSubmissionRevision = selected?.activeSubmission?.status === 'PENDING' ? selected.activeSubmission.revision : null;
  const pendingEntries = selected?.entries.filter(entry => entry.reviewStatus === 'PENDING' && entry.submissionRevision === activeSubmissionRevision) || [];
  const pendingPhotos = selected?.photos.filter(photo => photo.reviewStatus === 'PENDING' && photo.submissionRevision === activeSubmissionRevision) || [];
  const autoCatalogEntries = pendingEntries.filter(entry => entry.kind === 'PROCESS_TIME' && !String(entry.payload.processDefinitionId || '').trim() && String(entry.payload.processName || '').trim());
  const publishedEntries = selected?.entries.filter(entry => ['APPROVED', 'PUBLISHED'].includes(entry.reviewStatus) && (mode !== 'materials' || entry.kind === 'MATERIAL')) || [];
  const publishedPhotos = selected?.photos.filter(photo => photo.reviewStatus === 'PUBLISHED') || [];
  const materialEntries = selected?.entries.filter(entry => entry.kind === 'MATERIAL') || [];
  const publishedCount = publishedEntries.length + publishedPhotos.length;
  const stageIndex = !selected
    ? 0
    : selected.status === 'COMPLETED'
      ? 3
      : selected.status === 'SUBMITTED' || selected.counts.pendingReview > 0
        ? 2
        : selected.status === 'IN_PROGRESS'
          ? 1
          : 0;
  const taskViews = [
    { key: 'ALL' as const, label: '全部任务', count: viewCounts.ALL, icon: <PackageCheck size={15} /> },
    { key: 'TODAY' as const, label: '今日到期', count: viewCounts.TODAY, icon: <CalendarDays size={15} /> },
    { key: 'OVERDUE' as const, label: '已经逾期', count: viewCounts.OVERDUE, icon: <Clock3 size={15} />, danger: true },
    { key: 'PLANNED' as const, label: '待开始', count: viewCounts.PLANNED, icon: <CircleDot size={15} /> },
    { key: 'IN_PROGRESS' as const, label: '采集中', count: viewCounts.IN_PROGRESS, icon: <Camera size={15} /> },
    { key: 'PENDING_REVIEW' as const, label: '待整包审核', count: viewCounts.PENDING_REVIEW, icon: <ClipboardCheck size={15} />, unit: '单', attention: true },
    { key: 'COMPLETED' as const, label: '已完成', count: viewCounts.COMPLETED, icon: <CheckCircle2 size={15} /> },
    { key: 'CANCELLED' as const, label: '已取消', count: viewCounts.CANCELLED, icon: <X size={15} />, quiet: true },
  ];
  const detailTabs: Array<{ key: DetailTab; label: string; count?: number; attention?: boolean }> = !selected ? [] : mode === 'materials' ? [
    { key: 'overview' as const, label: '准备概览' },
    { key: 'materials' as const, label: '辅料数据', count: materialEntries.length },
    { key: 'photos' as const, label: '样品照片', count: selected.photos.length },
    { key: 'published' as const, label: '正式资料', count: publishedCount },
  ] : [
    { key: 'overview' as const, label: '任务概览' },
    { key: 'data' as const, label: '采集数据', count: selected.entries.length },
    { key: 'photos' as const, label: '过程照片', count: selected.photos.length },
    { key: 'review' as const, label: '整包审核', count: selected.counts.pendingReview, attention: true },
    { key: 'published' as const, label: '已处理', count: publishedCount },
  ];
  const moduleConfig = mode === 'planning' ? {
    activeHref: '/weekly-plan-center',
    subtitle: '样品任务下达与数据审核',
    eyebrow: '计划中心 / 样品组',
    title: '样品组计划',
    description: '下达任务、整包审核并受控沉淀产品资料',
    moduleLabel: '计划中心',
    drawerId: 'sample-planning-mode-drawer',
    massHref: '/weekly-plan-center',
    massTitle: '量产计划',
    massDescription: '订单排程、配料准备、工艺联动与生产下达',
    sampleHref: '/weekly-plan-center?branch=samples',
    sampleTitle: '样品组计划',
  } : mode === 'execution' ? {
    activeHref: '/production',
    subtitle: '样品采集与照片留证',
    eyebrow: '生产执行 / 样品组',
    title: '样品执行',
    description: '扫码填写选填数据、拍摄过程与成品照片',
    moduleLabel: '生产执行',
    drawerId: 'sample-execution-mode-drawer',
    massHref: '/production',
    massTitle: '量产执行',
    massDescription: '按工单、工序、人员和数量推进正式生产',
    sampleHref: '/production?branch=samples',
    sampleTitle: '样品执行',
  } : {
    activeHref: '/workspace/warehouse',
    subtitle: '样品辅料数据与照片准备',
    eyebrow: '仓库管理 / 样品组',
    title: '样品物料准备',
    description: '查看与补充样品辅料、过程及成品照片',
    moduleLabel: '仓库管理',
    drawerId: 'sample-materials-mode-drawer',
    massHref: '/workspace/warehouse',
    massTitle: '量产配料',
    massDescription: '正式配料任务、库存协同与仓库异常闭环',
    sampleHref: '/workspace/warehouse?branch=samples',
    sampleTitle: '样品物料准备',
  };

  function handleNavigationExpandedChange(expanded: boolean): void {
    setNavigationOpen(expanded);
    if (expanded) modeDrawer.close(false);
  }

  function toggleModeDrawer(): void {
    if (!modeDrawer.open) setNavigationOpen(false);
    modeDrawer.toggle();
  }

  return (
    <main className="sample-team-page hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref={moduleConfig.activeHref}
        subtitle={moduleConfig.subtitle}
        hideHeader
        sidebarTriggerTargetId="sample-team-navigation-trigger"
        sidebarExpanded={navigationOpen}
        onSidebarExpandedChange={handleNavigationExpandedChange}
        moduleModeSwitcher={{ mode: 'sample', drawerId: moduleConfig.drawerId, drawerOpen: modeDrawer.open, onToggle: toggleModeDrawer, openFromSidebar: false }}
        menuItems={[{ label: '退出登录', onSelect: () => { void logout(); } }]}
      />

      <div className={`sample-team-main${modeDrawer.open ? ' mode-drawer-open' : ''}`}>
        <header className="sample-team-commandbar">
          <div className="sample-team-title">
            <span id="sample-team-navigation-trigger" className="sample-team-navigation-trigger" />
            <div className="sample-team-title-copy">
              <small>{moduleConfig.eyebrow}</small>
              <div className="sample-team-title-line"><h1>{moduleConfig.title}</h1><ModuleModeTrigger buttonRef={modeDrawer.triggerRef} open={modeDrawer.open} mode="sample" onClick={toggleModeDrawer} controls={moduleConfig.drawerId} compact /></div>
              <p>{moduleConfig.description}</p>
            </div>
          </div>
          <div className="sample-team-rule-note"><Info size={16} /><span>{mode === 'materials' ? '样品辅料与照片全部选填' : '样品任务只记录资料'}<strong>{mode === 'materials' ? '不扣库存、不生成正式领料' : '不统计产量与个人效率'}</strong></span></div>
          <div className="sample-team-command-actions">
            {mode === 'planning' && <a className="hm-workbench-button" href="/api/sample-tasks/import/template" download><Download size={15} />下载导入模板</a>}
            {mode === 'planning' && <button className="hm-workbench-button" type="button" onClick={openImport}><Upload size={15} />批量导入</button>}
            {mode === 'planning' && <button className="hm-workbench-button primary" type="button" onClick={openCreate}><Plus size={15} />新建样品计划</button>}
            {mode === 'planning' && user.laborRole === 'ADMIN' && <button className="hm-workbench-button" type="button" onClick={() => void loadTrash()}><Trash2 size={15} />回收站</button>}
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
          </div>
        </header>

        <ModuleModeDrawer
          id={moduleConfig.drawerId}
          open={modeDrawer.open}
          moduleLabel={moduleConfig.moduleLabel}
          mode="sample"
          mass={{ href: moduleConfig.massHref, title: moduleConfig.massTitle, description: moduleConfig.massDescription }}
          sample={{ href: moduleConfig.sampleHref, title: moduleConfig.sampleTitle, description: moduleConfig.description, count: summary.total, countLabel: '项' }}
          onClose={modeDrawer.close}
        />

        {!!tasks.length && <section className="sample-team-statusbar" aria-label="样品任务状态筛选">
          <div>{taskViews.map(item => <button type="button" className={`${taskView === item.key ? 'active' : ''}${item.danger && item.count ? ' danger' : ''}${item.attention && item.count ? ' attention' : ''}${item.quiet ? ' quiet' : ''}`} aria-pressed={taskView === item.key} key={item.key} onClick={() => setTaskView(item.key)}>{item.icon}<span>{item.label}</span><b>{item.count}{item.unit || ''}</b></button>)}</div>
          <span className="sample-team-published-total"><CheckCircle2 size={15} />正式资料 <strong>{summary.publishedItems}</strong> 项</span>
        </section>}

        {error && <div className="sample-team-error"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}

        {loading && !tasks.length ? <section className="sample-team-loading"><Loader2 className="spin" size={28} /><strong>正在加载样品任务</strong></section>
          : !tasks.length && !debouncedKeyword ? <section className="sample-team-zero-state"><span className="sample-empty-icon"><PackageCheck size={34} /></span><small>{moduleConfig.title}</small><h2>{mode === 'planning' ? '从第一条样品任务开始' : mode === 'materials' ? '当前还没有样品物料记录' : '当前还没有样品任务'}</h2><p>{mode === 'planning' ? '建立任务与产品关联后，员工即可扫码填写数据和拍照；所有采集项都可留空。' : mode === 'materials' ? '计划中心下达样品任务后，可在这里选填辅料数据与上传照片；不会扣减库存。' : '计划中心下达样品任务后，会自动出现在这里。'}</p>{mode === 'planning' && <button className="primary" type="button" onClick={openCreate}><Plus size={17} />新建第一条样品计划</button>}<div><Info size={15} />每个产品的本次提交只做一次整包审核</div></section>
            : !tasks.length || !visibleTasks.length ? <section className="sample-filter-empty"><span className="sample-empty-icon"><Search size={30} /></span><h2>没有符合条件的样品任务</h2><p>调整搜索内容或任务状态后再查看。</p><button type="button" onClick={() => { setKeyword(''); setTaskView('ALL'); }}>清除筛选</button></section>
              : <section className="sample-team-workspace">
          <aside className="sample-task-list" aria-label="样品任务列表">
            <header className="sample-task-list-head"><div><strong>任务清单</strong><span>{visibleTasks.length} 个任务</span></div><label><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、订单或成员" /></label></header>
            <div className="sample-task-list-scroll hm-scroll-region" tabIndex={0}>
              {visibleTasks.map(task => {
                const overdue = taskMatchesView(task, 'OVERDUE', todayKey);
                return <button className={`sample-task-card ${selected?.id === task.id ? 'active' : ''} status-${task.status.toLowerCase()}`} aria-pressed={selected?.id === task.id} type="button" key={task.id} onClick={() => setSelectedId(task.id)}>
                  <span className="sample-task-color" style={{ background: sampleCustomerLevelOrDefault(task.customerLevelCode).color }} />
                  <header className="sample-task-card-head"><div><em style={sampleCustomerLevelStyle(task.customerLevelCode)}>{taskLevelText(task)}</em>{task.dataPurpose !== 'PRODUCTION' && <em className="sample-data-purpose">{task.dataPurpose === 'TEST' ? '测试' : '培训'}</em>}<strong title={task.customerName}>{task.customerName}</strong></div><small>{task.code}</small></header>
                  <h3 title={task.specification}>{task.specification}</h3>
                  <p>{task.productName || '未设置品名'}</p>
                  <div className="sample-task-card-state"><span className={`state-${task.status.toLowerCase()}`}>{taskStatusLabels[task.status]}</span><span className={overdue ? 'overdue' : ''}><CalendarDays size={12} />{dateText(task.dueDate)}</span><span><UserRound size={12} />{task.assignees.map(item => item.name).join('、') || '未指派'}</span></div>
                  <footer><span><FileText size={12} />数据 {task.counts.data}</span><span><ImageIcon size={12} />照片 {task.counts.photos}</span>{task.counts.pendingReview > 0 && <b>待审 1 包</b>}{task.status === 'COMPLETED' && <span>{task.archivedAt ? '已归档' : '未归档'}</span>}</footer>
                </button>;
              })}
            </div>
          </aside>

          <section className="sample-task-detail">
            {selected && <>
              <header className="sample-detail-head">
                <div><div className="sample-detail-identity"><span style={sampleCustomerLevelStyle(selected.customerLevelCode)}>{taskLevelText(selected)}</span><small>{selected.code}</small></div><h2>{selected.specification}</h2><p>{selected.customerName} · {selected.productName || '未设置品名'}{selected.sourceOrderNo ? ` · 来源 ${selected.sourceOrderNo}` : ''}</p></div>
                <div className="sample-detail-actions">
                  {!terminalTask && <button type="button" onClick={() => void openQr(selected)}><QrCode size={15} />二维码</button>}
                  {mode === 'planning' && !terminalTask && <button type="button" onClick={() => openEdit(selected)}><Pencil size={15} />编辑计划</button>}
                  {mode !== 'materials' && selected.status === 'PLANNED' && <button className="primary" type="button" onClick={() => void taskAction(selected, 'START')}>开始任务</button>}
                  {mode !== 'materials' && selected.status === 'IN_PROGRESS' && selected.counts.data + selected.counts.photos === 0 && <button type="button" onClick={() => void taskAction(selected, 'COMPLETE')}>无资料完成</button>}
                  {mode === 'planning' && selected.status === 'COMPLETED' && <button type="button" onClick={() => void taskAction(selected, selected.archivedAt ? 'UNARCHIVE' : 'ARCHIVE')}>{selected.archivedAt ? '取消归档' : '归档'}</button>}
                  {mode === 'planning' && user.laborRole === 'ADMIN' && selected.status === 'COMPLETED' && <button className="danger" type="button" disabled={deleteBusy} onClick={() => void openDeleteTask(selected)}><Trash2 size={15} />删除</button>}
                </div>
              </header>

              <nav className="sample-detail-tabs" aria-label="样品任务详情"><div>{detailTabs.map(tab => <button type="button" className={`${detailTab === tab.key ? 'active' : ''}${tab.attention && tab.count ? ' attention' : ''}`} aria-pressed={detailTab === tab.key} key={tab.key} onClick={() => setDetailTab(tab.key)}><span>{tab.label}</span>{typeof tab.count === 'number' && <em>{tab.count}</em>}</button>)}</div></nav>

              <div className="sample-detail-body hm-scroll-region" tabIndex={0}>
                {detailTab === 'overview' && <section className="sample-overview-content">
                  <ol className={`sample-stage-rail ${selected.status === 'CANCELLED' ? 'cancelled' : ''}`}>{['待开始', '采集中', '待审核', '已归档'].map((label, index) => <li className={index < stageIndex ? 'done' : index === stageIndex ? 'current' : ''} key={label}><span>{index < stageIndex ? <CheckCircle2 size={15} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
                  <section className="sample-detail-facts">
                    <div><span>任务状态</span><strong>{taskStatusLabels[selected.status]}</strong><small>{dataStatusLabels[selected.dataStatus]}</small></div>
                    <div><span>计划日期</span><strong>{dateText(selected.dueDate)}</strong><small>{selected.sampleQuantity === null ? '数量未设置' : `${selected.sampleQuantity} 件/套`}</small></div>
                    <div><span>样品成员</span><strong>{selected.assignees.length || 0} 人</strong><small>{selected.assignees.map(item => item.name).join('、') || '尚未指派'}</small></div>
                    <div><span>本次采集</span><strong>{selected.counts.data} 条 · {selected.counts.photos} 图</strong><small>{selected.counts.pendingReview ? `待审核 1 包 · ${selected.counts.pendingItems} 项内容` : selected.archivedAt ? '已完成并归档' : '没有待审核提交包'}</small></div>
                  </section>
                  {terminalTask && <div className={`sample-terminal-banner ${selected.status.toLowerCase()}`}><CheckCircle2 size={18} /><span><strong>{selected.status === 'CANCELLED' ? '任务已取消，所有入口均为只读' : selected.archivedAt ? '任务已完成并归档' : '任务已完成，当前未归档'}</strong><small>{selected.status === 'CANCELLED' ? '不会再显示新增、删除、采集、上传、重新打开或审核操作。' : '归档或取消归档只改变整理状态，不会撤销审核结果，也不需要重新审核。'}</small></span></div>}
                  {selected.planRemark && <div className="sample-plan-remark"><strong>计划说明</strong><p>{selected.planRemark}</p></div>}
                  {!terminalTask && <section className="sample-capture-callout"><div><Camera size={22} /><span><strong>{mode === 'materials' ? '补充辅料数据与样品照片' : '扫码填写数据与拍照'}</strong><small>{mode === 'materials' ? '全部选填；仅沉淀样品资料，不扣库存、不生成正式领料。' : '所有采集项均为选填；空白不判缺项，也无需说明原因。'}</small></span></div><div><Link className="primary" href={selected.captureUrl} prefetch={false}>打开采集页<ArrowRight size={15} /></Link><button type="button" onClick={() => void copyCaptureLink(selected)}><Copy size={15} />复制链接</button></div></section>}
                  {mode === 'materials' ? <div className="sample-overview-cards"><button type="button" onClick={() => setDetailTab('materials')}><span><PackageCheck size={18} /></span><div><small>辅料数据</small><strong>{materialEntries.length} 条</strong><em>查看波纹管、热缩管等选填记录</em></div><ArrowRight size={16} /></button><button type="button" onClick={() => setDetailTab('photos')}><span><ImageIcon size={18} /></span><div><small>过程与成品照片</small><strong>{selected.photos.length} 张</strong><em>查看拍照与分类</em></div><ArrowRight size={16} /></button><button type="button" onClick={() => setDetailTab('published')}><span><FolderKanban size={18} /></span><div><small>正式产品资料</small><strong>{publishedCount} 项</strong><em>仅展示审核发布后的记录</em></div><ArrowRight size={16} /></button></div> : <div className="sample-overview-cards"><button type="button" onClick={() => setDetailTab('data')}><span><FileText size={18} /></span><div><small>采集数据</small><strong>{selected.entries.length} 条</strong><em>查看记录与审核状态</em></div><ArrowRight size={16} /></button><button type="button" onClick={() => setDetailTab('photos')}><span><ImageIcon size={18} /></span><div><small>过程与成品照片</small><strong>{selected.photos.length} 张</strong><em>查看拍照与分类</em></div><ArrowRight size={16} /></button><button className={selected.counts.pendingReview ? 'attention' : ''} type="button" onClick={() => setDetailTab('review')}><span><ClipboardCheck size={18} /></span><div><small>整包审核</small><strong>{selected.counts.pendingReview ? '1 包' : '0 包'}</strong><em>{selected.counts.pendingReview ? `${selected.counts.pendingItems} 项内容一次确认` : '当前没有待审核提交包'}</em></div><ArrowRight size={16} /></button></div>}
                </section>}

                {detailTab === 'data' && <section className="sample-record-panel sample-tab-panel"><header><div><FileText size={17} /><span><strong>采集数据</strong><small>{selected.entries.length} 条记录，仅显示业务字段</small></span></div>{!terminalTask && <Link href={selected.captureUrl} prefetch={false}>继续采集</Link>}</header><div className="sample-record-list" tabIndex={0}>{selected.entries.map(renderDataRecord)}{!selected.entries.length && <div className="sample-record-empty"><FileText size={25} /><strong>本次尚未采集数据</strong><p>这不是缺项，任务仍可提交或完成。</p></div>}</div></section>}

                {detailTab === 'materials' && <section className="sample-record-panel sample-tab-panel"><header><div><PackageCheck size={17} /><span><strong>样品辅料数据</strong><small>{materialEntries.length} 条记录；全部选填，不关联库存扣减</small></span></div>{!terminalTask && <Link href={selected.captureUrl} prefetch={false}>补充资料</Link>}</header><div className="sample-record-list" tabIndex={0}>{materialEntries.map(renderDataRecord)}{!materialEntries.length && <div className="sample-record-empty"><PackageCheck size={25} /><strong>本次尚未记录辅料数据</strong><p>可按实际需要记录波纹管、热缩管、套管等，不要求填写原因。</p></div>}</div></section>}

                {detailTab === 'photos' && <section className="sample-record-panel sample-tab-panel photo-panel"><header><div><ImageIcon size={17} /><span><strong>过程与成品照片</strong><small>{selected.photos.length} 张照片</small></span></div>{!terminalTask && <Link href={selected.captureUrl} prefetch={false}>继续拍照</Link>}</header><div className="sample-photo-grid" tabIndex={0}>{selected.photos.map(renderPhotoRecord)}{!selected.photos.length && <div className="sample-record-empty"><ImageIcon size={25} /><strong>本次尚未上传照片</strong><p>照片同样不设必选项。</p></div>}</div></section>}

                {detailTab === 'review' && (!selected.activeSubmission || selected.activeSubmission.status !== 'PENDING' ? <div className="sample-record-empty sample-tab-empty"><CheckCircle2 size={30} /><strong>当前没有待审核提交包</strong><p>每个产品每次提交只形成一个审核包，不再逐条确认。</p></div> : <section className="sample-package-review">
                  <header className="sample-package-review-head">
                    <div><ClipboardCheck size={20} /><span><small>提交版本 R{selected.activeSubmission.revision}</small><strong>{selected.specification}</strong><em>{pendingEntries.length} 条数据 · {pendingPhotos.length} 张照片</em></span></div>
                    <p>审核动作只作用于当前产品的本次提交；确认、编辑或驳回均按整包留痕。</p>
                  </header>
                  {!!reviewIssues.length && <div ref={reviewIssuesRef} className="sample-package-issues" role="alert"><AlertTriangle size={18} /><div><strong>确认前还有 {reviewIssues.length} 个阻断项</strong>{reviewIssues.map(issue => <p key={`${issue.itemType}:${issue.itemId}:${issue.message}`}><b>{issue.title}</b><span>{issue.message}</span></p>)}</div></div>}
                  {!!autoCatalogEntries.length && <div className="sample-package-auto-catalog"><Info size={18} /><div><strong>可直接整包确认</strong><p>确认时会自动复用或新增 {autoCatalogEntries.length} 条未绑定工序，并同步回写本次记录，不需要逐条审核。</p></div></div>}
                  <div className="sample-review-workspace">
                    <section className="sample-record-panel"><header><div><FileText size={17} /><span><strong>本包采集数据</strong><small>{pendingEntries.length} 项</small></span></div></header><div className="sample-record-list">{pendingEntries.map(renderDataRecord)}{!pendingEntries.length && <div className="sample-record-empty"><strong>本包没有数据记录</strong></div>}</div></section>
                    <section className="sample-record-panel photo-panel"><header><div><ImageIcon size={17} /><span><strong>本包照片</strong><small>{pendingPhotos.length} 项</small></span></div></header><div className="sample-photo-grid sample-review-photo-grid">{pendingPhotos.map(renderPhotoRecord)}{!pendingPhotos.length && <div className="sample-record-empty"><strong>本包没有照片</strong></div>}</div></section>
                  </div>
                  {mode === 'planning' && <footer className="sample-package-review-actions"><span><Info size={15} />确认时整包事务处理；任一真实阻断项都会全部回滚。</span><div><button type="button" disabled={reviewSaving} onClick={() => openPackageDialog('EDIT')}><Pencil size={15} />编辑资料</button><button className="danger" type="button" disabled={reviewSaving} onClick={() => openPackageDialog('REJECT')}><X size={15} />整包驳回</button><button className="primary" type="button" disabled={reviewSaving} onClick={() => void savePackageReview('CONFIRM')}>{reviewSaving ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}{autoCatalogEntries.length ? `确认并处理 ${autoCatalogEntries.length} 条工序` : '确认通过'}</button></div></footer>}
                </section>)}

                {detailTab === 'published' && (!publishedEntries.length && !publishedPhotos.length ? <div className="sample-record-empty sample-tab-empty"><FolderKanban size={30} /><strong>本任务还没有审核处理资料</strong><p>整包确认后的留档、工时草稿、正式数据和照片会在这里集中展示。</p></div> : <div className="sample-review-workspace"><section className="sample-record-panel"><header><div><FileText size={17} /><span><strong>已处理数据</strong><small>{publishedEntries.length} 项</small></span></div></header><div className="sample-record-list">{publishedEntries.map(renderDataRecord)}{!publishedEntries.length && <div className="sample-record-empty"><strong>没有已处理数据</strong></div>}</div></section><section className="sample-record-panel photo-panel"><header><div><ImageIcon size={17} /><span><strong>已发布照片</strong><small>{publishedPhotos.length} 项</small></span></div></header><div className="sample-photo-grid sample-review-photo-grid">{publishedPhotos.map(renderPhotoRecord)}{!publishedPhotos.length && <div className="sample-record-empty"><strong>没有已发布照片</strong></div>}</div></section></div>)}
              </div>

              <footer className="sample-detail-footer">
                <div><span>创建 {dateTimeText(selected.createdAt)} · {selected.createdBy || '未记录'}</span><span>最近更新 {dateTimeText(selected.updatedAt)}</span></div>
                <div><Link href={`/drawing-library?itemId=${encodeURIComponent(selected.drawingLibraryItemId)}`} prefetch={false}><FolderKanban size={14} />查看产品资料</Link>{selected.status !== 'CANCELLED' && selected.status !== 'COMPLETED' && mode === 'planning' && <button className="danger" type="button" onClick={() => void taskAction(selected, 'CANCEL')}>取消任务</button>}</div>
              </footer>
            </>}
          </section>
        </section>}
      </div>

      {message && <div className="sample-team-toast" role="status">{message}</div>}

      {importOpen && <div className="sample-modal-backdrop sample-import-backdrop" role="presentation">
        <section className="sample-import-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-import-dialog-title">
          <header>
            <div><span>样品计划批量导入</span><h2 id="sample-import-dialog-title">{importStep === 'UPLOAD' ? '上传已填写模板' : importStep === 'PREVIEW' ? '核对匹配结果' : importStep === 'CONFLICTS' ? '确认相似图纸库' : '导入完成'}</h2></div>
            <button type="button" aria-label="关闭" disabled={importBusy} onClick={() => setImportOpen(false)}><X /></button>
          </header>
          <ol className="sample-import-steps" aria-label="导入步骤">
            {[['UPLOAD', '1', '上传'], ['PREVIEW', '2', '预览'], ['CONFLICTS', '3', '确认'], ['COMPLETE', '4', '完成']].map(([key, number, label]) => {
              const order = ['UPLOAD', 'PREVIEW', 'CONFLICTS', 'COMPLETE'];
              const activeIndex = order.indexOf(importStep);
              const index = order.indexOf(key);
              return <li className={index < activeIndex ? 'done' : index === activeIndex ? 'active' : ''} key={key}><span>{index < activeIndex ? <CheckCircle2 /> : number}</span><strong>{label}</strong></li>;
            })}
          </ol>
          <div className="sample-import-body hm-scroll-region" tabIndex={0}>
            {importStep === 'UPLOAD' && <section className="sample-import-upload">
              <FileSpreadsheet />
              <h3>选择填写完成的 Excel 模板</h3>
              <p>只支持 .xlsx；系统先预览匹配结果，不会在上传后立即创建计划。</p>
              <input ref={importFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { setImportFile(event.target.files?.[0] || null); setImportError(''); }} />
              <button type="button" onClick={() => importFileRef.current?.click()}><Upload />{importFile ? '重新选择文件' : '选择 Excel 文件'}</button>
              {importFile && <div className="sample-import-file"><FileSpreadsheet /><span><strong>{importFile.name}</strong><small>{Math.max(1, Math.round(importFile.size / 1024))} KB</small></span><CheckCircle2 /></div>}
              <a href="/api/sample-tasks/import/template" download><Download />还没有模板？下载简版模板</a>
            </section>}

            {importStep === 'PREVIEW' && importPreview && <>
              <section className="sample-import-summary">
                <div><span>总计</span><strong>{importPreview.summary.total}</strong></div>
                <div className="reuse"><span>复用图纸库</span><strong>{importPreview.summary.reuse}</strong></div>
                <div className="create"><span>新建图纸库</span><strong>{importPreview.summary.create}</strong></div>
                <div className="confirm"><span>需要确认</span><strong>{importPreview.summary.confirm}</strong></div>
                <div className="blocked"><span>阻止导入</span><strong>{importPreview.summary.blocked}</strong></div>
              </section>
              <div className="sample-import-rule"><Info /><span><strong>图纸库只复用产品资料，不复用旧样品任务。</strong>重复计划会直接阻止，页面不提供强制重复导入。</span></div>
              <div className="sample-import-table-wrap">
                <table className="sample-import-table">
                  <thead><tr><th>行</th><th>客户 / 产品</th><th>型号 / 规格</th><th>等级</th><th>数量 / 日期</th><th>匹配结果</th></tr></thead>
                  <tbody>{importPreview.rows.map(row => <tr key={row.rowNumber} className={`status-${row.matchStatus.toLowerCase()}`}><td>{row.rowNumber}</td><td><strong>{row.customerName || '—'}</strong><small>{row.productName || '—'}</small></td><td>{row.specification || '—'}</td><td><em style={sampleCustomerLevelStyle(row.customerLevelCode)}>{row.customerLevelCode || '—'}</em></td><td><strong>{row.sampleQuantity || '—'}</strong><small>{row.dueDate || '—'}</small></td><td><b>{row.matchStatus === 'REUSE' ? '复用' : row.matchStatus === 'CREATE' ? '新建' : row.matchStatus === 'CONFIRM' ? '待确认' : '已阻止'}</b><small>{row.message}</small></td></tr>)}</tbody>
                </table>
              </div>
            </>}

            {importStep === 'CONFLICTS' && importPreview && <section className="sample-import-conflicts">
              <div className="sample-import-rule"><AlertTriangle /><span><strong>这些行只做选择，不需要审核。</strong>选择已有图纸库即复用；确认确实是新产品时才新建。</span></div>
              {importPreview.rows.filter(row => row.matchStatus === 'CONFIRM').map(row => <article key={row.rowNumber}>
                <header><span>Excel 第 {row.rowNumber} 行</span><strong>{row.customerName} · {row.productName}</strong><p>{row.specification}</p></header>
                <div>{row.candidates.map(candidate => <button className={importDecisions[String(row.rowNumber)]?.mode === 'reuse' && (importDecisions[String(row.rowNumber)] as { drawingLibraryItemId?: string }).drawingLibraryItemId === candidate.id ? 'selected' : ''} type="button" key={candidate.id} onClick={() => setImportDecisions(current => ({ ...current, [String(row.rowNumber)]: { mode: 'reuse', drawingLibraryItemId: candidate.id } }))}><FolderKanban /><span><strong>{candidate.specification}</strong><small>{candidate.customerName} · {candidate.productName || '未设置品名'}</small><em>{candidate.libraryKey}</em></span><CheckCircle2 /></button>)}</div>
                <button className={`sample-import-create-choice ${importDecisions[String(row.rowNumber)]?.mode === 'create' ? 'selected' : ''}`} type="button" onClick={() => setImportDecisions(current => ({ ...current, [String(row.rowNumber)]: { mode: 'create' } }))}><Plus />确认这是新产品，建立新的图纸库</button>
              </article>)}
            </section>}

            {importStep === 'COMPLETE' && importResult && <section className="sample-import-complete">
              <span><CheckCircle2 /></span><h3>样品计划导入已处理</h3><p>已创建 <strong>{importResult.createdTaskCount}</strong> 个样品计划{importResult.blockedCount ? `，另有 ${importResult.blockedCount} 行因重复或数据变化未创建` : '，没有重复数据'}。</p>
              <div><div><span>已创建</span><strong>{importResult.createdTaskCount}</strong></div><div><span>未创建</span><strong>{importResult.blockedCount}</strong></div><div><span>总处理</span><strong>{importResult.total}</strong></div></div>
            </section>}
            {importError && <div className="sample-form-error"><AlertTriangle size={16} />{importError}</div>}
          </div>
          <footer>
            <span>{importStep === 'UPLOAD' ? '上传只做检查，下一步才确认导入。' : importStep === 'PREVIEW' ? '红色阻止行不会创建，也不能强制跳过规则。' : importStep === 'CONFLICTS' ? '每一条相似匹配都必须明确选择。' : '任务列表已刷新，可直接继续安排。'}</span>
            <div>
              {importStep === 'PREVIEW' && <button type="button" disabled={importBusy} onClick={() => setImportStep('UPLOAD')}>重新上传</button>}
              {importStep === 'CONFLICTS' && <button type="button" disabled={importBusy} onClick={() => setImportStep('PREVIEW')}>返回预览</button>}
              {importStep === 'UPLOAD' && <button type="button" disabled={importBusy} onClick={() => setImportOpen(false)}>取消</button>}
              {importStep === 'UPLOAD' && <button className="primary" type="button" disabled={importBusy || !importFile} onClick={() => void previewImport()}>{importBusy ? <><Loader2 className="spin" />读取中</> : '读取并预览'}</button>}
              {importStep === 'PREVIEW' && importPreview && <button className="primary" type="button" disabled={importBusy || importPreview.summary.total === importPreview.summary.blocked} onClick={() => { if (importPreview.summary.confirm > 0) { setImportError(''); setImportStep('CONFLICTS'); } else void commitImport(); }}>{importBusy ? <><Loader2 className="spin" />导入中</> : importPreview.summary.confirm ? `确认 ${importPreview.summary.confirm} 条匹配` : '确认并导入'}</button>}
              {importStep === 'CONFLICTS' && importPreview && <button className="primary" type="button" disabled={importBusy || importPreview.rows.some(row => row.matchStatus === 'CONFIRM' && !importDecisions[String(row.rowNumber)])} onClick={() => void commitImport()}>{importBusy ? <><Loader2 className="spin" />导入中</> : '确认并导入'}</button>}
              {importStep === 'COMPLETE' && <button className="primary" type="button" onClick={() => setImportOpen(false)}>完成</button>}
            </div>
          </footer>
        </section>
      </div>}

      {photoViewerIndex !== null && selected?.photos[photoViewerIndex] && <SamplePhotoViewerDialog photos={selected.photos} index={photoViewerIndex} onIndexChange={setPhotoViewerIndex} onClose={() => setPhotoViewerIndex(null)} />}

      {deletePreview && <div className="sample-modal-backdrop sample-delete-backdrop" role="presentation">
        <section className="sample-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sample-delete-title" aria-describedby="sample-delete-description">
          <header><div><span>管理员安全删除</span><h2 id="sample-delete-title">{deletePreview.task.code}</h2></div><button type="button" aria-label="关闭" disabled={deleteBusy} onClick={() => setDeletePreview(null)}><X /></button></header>
          <div className="sample-delete-body hm-scroll-region" tabIndex={0}>
            <div className="sample-delete-warning"><AlertTriangle size={20} /><span><strong>只从样品计划移入回收站</strong><small id="sample-delete-description">已审核图纸、正式参数、提交历史和对象存储文件默认保留；这不是物理删除。</small></span></div>
            <section className="sample-delete-identity"><span><small>客户</small><strong>{deletePreview.task.customerName}</strong></span><span><small>规格型号</small><strong>{deletePreview.task.specification}</strong></span><span><small>数据用途</small><strong>{deletePreview.task.dataPurpose === 'TEST' ? '测试数据' : deletePreview.task.dataPurpose === 'TRAINING' ? '培训数据' : '正式业务'}</strong></span></section>
            <section className="sample-delete-impact" aria-label="删除影响"><article><small>采集数据</small><strong>{deletePreview.impact.entryCount}</strong></article><article><small>照片</small><strong>{deletePreview.impact.photoCount}</strong></article><article><small>提交包</small><strong>{deletePreview.impact.submissionCount}</strong></article><article><small>已发布图纸</small><strong>{deletePreview.impact.publishedDrawingFileCount}</strong></article><article><small>正式资料</small><strong>{deletePreview.impact.productDataRecordCount}</strong></article><article><small>连接器绑定</small><strong>{deletePreview.impact.connectorBindingCount}</strong></article><article><small>工时草稿</small><strong>{deletePreview.impact.affectedProductTimeProfileCount}</strong></article><article><small>物理删对象</small><strong>{deletePreview.impact.objectDeletionCount}</strong></article></section>
            {!!deletePreview.blockers.length && <div className="sample-delete-blockers" role="alert">{deletePreview.blockers.map(item => <p key={item}>{item}</p>)}</div>}
            <label><span>删除原因（必填）</span><textarea autoFocus maxLength={500} value={deleteReason} onChange={event => setDeleteReason(event.target.value)} placeholder="例如：重复建立的样品测试任务，正式发布资料保留" /></label>
            <label><span>输入完整任务编号确认</span><input value={deleteCode} onChange={event => setDeleteCode(event.target.value)} placeholder={deletePreview.task.code} autoComplete="off" /></label>
          </div>
          <footer><span>可在“回收站”恢复；恢复不会改写审核结论。</span><div><button type="button" disabled={deleteBusy} onClick={() => setDeletePreview(null)}>取消</button><button className="danger" type="button" disabled={deleteBusy || !deletePreview.canDelete || !deleteReason.trim() || deleteCode !== deletePreview.task.code} onClick={() => void confirmDeleteTask()}>{deleteBusy ? <><Loader2 className="spin" size={15} />处理中</> : <><Trash2 size={15} />移入回收站</>}</button></div></footer>
        </section>
      </div>}

      {trashOpen && <div className="sample-modal-backdrop sample-trash-backdrop" role="presentation">
        <section className="sample-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-trash-title">
          <header><div><span>管理员工具</span><h2 id="sample-trash-title">样品任务回收站</h2></div><button type="button" aria-label="关闭" disabled={trashBusy} onClick={() => setTrashOpen(false)}><X /></button></header>
          <div className="sample-trash-body">
            <section className="sample-trash-list hm-scroll-region" tabIndex={0}>
              {trashBusy && !trashItems.length ? <div className="sample-trash-empty"><Loader2 className="spin" /><strong>正在加载回收站</strong></div> : trashItems.map(item => <button className={restoreItem?.task.id === item.task.id ? 'active' : ''} type="button" key={item.task.id} onClick={() => chooseRestoreItem(item)}><span><strong>{item.task.specification}</strong><small>{item.task.customerName} · {item.task.code}</small></span><em>{dateTimeText(item.deletedAt)}<small>{item.deletedBy || '未记录删除人'}</small></em></button>)}
              {!trashBusy && !trashItems.length && <div className="sample-trash-empty"><Trash2 /><strong>回收站为空</strong><p>删除的已完成任务会出现在这里。</p></div>}
            </section>
            <section className="sample-trash-restore">
              {restoreItem ? <><div className="sample-delete-warning"><Info size={20} /><span><strong>恢复 {restoreItem.task.code}</strong><small>任务、提交历史和照片会重新出现在样品计划；已退役的正式下游资料不会被自动恢复。</small></span></div><dl><div><dt>规格型号</dt><dd>{restoreItem.task.specification}</dd></div><div><dt>原删除原因</dt><dd>{restoreItem.deleteReason || '未记录'}</dd></div><div><dt>删除人</dt><dd>{restoreItem.deletedBy || '未记录'}</dd></div></dl><label><span>恢复原因（必填）</span><textarea maxLength={500} value={restoreReason} onChange={event => setRestoreReason(event.target.value)} placeholder="说明为什么需要恢复" /></label><label><span>输入完整任务编号确认</span><input value={restoreCode} onChange={event => setRestoreCode(event.target.value)} placeholder={restoreItem.task.code} autoComplete="off" /></label><button className="primary" type="button" disabled={trashBusy || !restoreReason.trim() || restoreCode !== restoreItem.task.code} onClick={() => void confirmRestoreTask()}>{trashBusy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}确认恢复</button></> : <div className="sample-trash-empty"><FolderKanban /><strong>选择一个任务查看</strong><p>恢复操作同样需要填写原因并输入完整任务编号。</p></div>}
            </section>
          </div>
        </section>
      </div>}

      {(createOpen || editOpen) && <div className="sample-modal-backdrop sample-plan-backdrop" role="presentation">
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
              <div className="sample-section-title"><strong>计划信息</strong><small>客户等级固定为 A红、B黄、C蓝、D绿，优先顺序由系统自动计算</small></div>
              <fieldset className="sample-level-picker">
                <legend>客户等级</legend>
                {SAMPLE_CUSTOMER_LEVELS.map(level => <button
                  className={form.customerLevelCode === level.code ? 'selected' : ''}
                  type="button"
                  key={level.code}
                  style={{ color: level.color, backgroundColor: level.background, borderColor: form.customerLevelCode === level.code ? level.color : level.border }}
                  aria-pressed={form.customerLevelCode === level.code}
                  onClick={() => setForm(current => ({ ...current, customerLevelCode: level.code, customerLevelLabel: level.label, customerLevelColor: level.color, priority: String(level.priority) }))}
                ><strong>{level.code}</strong><span>{level.label}</span></button>)}
              </fieldset>
              <div className="sample-form-grid two sample-plan-core-fields">
                <label><span>样品数量</span><input type="number" min="1" step="1" value={form.sampleQuantity} onChange={event => setForm(current => ({ ...current, sampleQuantity: event.target.value }))} placeholder="填写样品数量" /></label>
                <label><span>计划日期</span><input type="date" value={form.dueDate} onChange={event => setForm(current => ({ ...current, dueDate: event.target.value }))} /></label>
              </div>
              {!editOpen && user.laborRole === 'ADMIN' && <label className="sample-data-purpose-field"><span>数据用途</span><select value={form.dataPurpose} onChange={event => setForm(current => ({ ...current, dataPurpose: event.target.value as PlanForm['dataPurpose'] }))}><option value="PRODUCTION">正式业务数据</option><option value="TEST">测试数据（可批量退役）</option><option value="TRAINING">培训数据</option></select><small>只有新建时可标记；正式数据不会被测试清理工具自动退役。</small></label>}
            </section>

            <section className="sample-plan-section">
              <div className="sample-section-title"><strong>样品组成员</strong><small>{context.sampleMemberCount ? `已识别 ${context.sampleMemberCount} 名样品组成员` : '当前员工资料中未识别到“样品”班组名称，可从全部员工选择'}</small><button type="button" onClick={() => setShowAllMembers(value => !value)}>{showAllMembers ? '只看样品组' : '查看全部员工'}</button></div>
              <div className="sample-member-grid">{visibleMembers.map(member => <button className={form.assigneeEmployeeIds.includes(member.id) ? 'selected' : ''} type="button" key={member.id} onClick={() => toggleAssignee(member.id)}><span>{member.name.slice(0, 1)}</span><b>{member.name}<small>{member.employeeNo} · {member.position || '岗位未设置'}</small></b><em>{member.team || member.department || '班组未设置'}</em></button>)}{!visibleMembers.length && <p>没有可选择的样品组成员，请查看全部员工或先维护员工班组。</p>}</div>
            </section>
            {formError && <div className="sample-form-error"><AlertTriangle size={16} />{formError}</div>}
          </div>
          <footer><span>计划建立后，现场采集内容仍全部选填。</span><div><button type="button" disabled={saving} onClick={() => { setCreateOpen(false); setEditOpen(false); }}>取消</button><button className="primary" type="button" disabled={saving} onClick={() => void savePlan()}>{saving ? <><Loader2 className="spin" size={15} />保存中</> : editOpen ? '保存计划' : '创建样品任务'}</button></div></footer>
        </section>
      </div>}

      {qrTask && <div className="sample-modal-backdrop" role="presentation">
        <section className="sample-qr-dialog" role="dialog" aria-modal="true" aria-label="样品采集二维码">
          <header><div><span>样品采集二维码</span><h2>{qrTask.code}</h2></div><button type="button" aria-label="关闭" onClick={() => setQrTask(null)}><X /></button></header>
          <div className="sample-qr-content">{qrDataUrl ? <Image unoptimized priority width={260} height={260} src={qrDataUrl} alt={`${qrTask.code}样品采集二维码`} /> : <Loader2 className="spin" />}<strong>{qrTask.specification}</strong><p>{qrTask.customerName} · {taskLevelText(qrTask)}</p><small>扫码后填写数据与拍摄照片，不会生成量产报工或效率。</small></div>
          <footer><button type="button" onClick={() => void copyCaptureLink(qrTask)}><Copy size={15} />复制链接</button><Link href={`/sample-print/${encodeURIComponent(qrTask.id)}?mode=current&from=${encodeURIComponent(mode)}`} prefetch={false}><Printer size={15} />打印标准采集单</Link><Link className="primary" href={qrTask.captureUrl} prefetch={false}>打开采集页</Link></footer>
        </section>
      </div>}

      {packageDialog && selected?.activeSubmission && <div className="sample-modal-backdrop" role="presentation">
        <section className="sample-review-dialog sample-package-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-review-title">
          <header><div><span>{packageDialog === 'EDIT' ? '审核页编辑' : '整包驳回'}</span><h2 id="sample-review-title">{selected.specification} · R{selected.activeSubmission.revision}</h2></div><button type="button" aria-label="关闭" onClick={() => { if (!reviewSaving) setPackageDialog(null); }}><X /></button></header>
          <div className="sample-review-dialog-body hm-scroll-region" tabIndex={0}>
            {packageDialog === 'EDIT' ? <>
              <div className="sample-review-note"><Info size={17} /><span><strong>只修改本次提交包</strong><small>不新增或删除记录；保存后仍停留在待审核状态，再点击“确认通过”统一处理。</small></span></div>
              {!!reviewIssues.length && <div className="sample-package-issues" role="alert"><AlertTriangle size={18} /><div><strong>需要修改的阻断项</strong>{reviewIssues.map(issue => <p key={`dialog:${issue.itemType}:${issue.itemId}:${issue.message}`}><b>{issue.title}</b><span>{issue.message}</span></p>)}</div></div>}
              <section className="sample-package-edit-section"><header><strong>采集数据</strong><small>{reviewEntryDrafts.length} 条</small></header>
                {reviewEntryDrafts.map((entry, index) => <article className="sample-package-entry-editor" key={entry.id}>
                  <header><span>{String(index + 1).padStart(2, '0')}</span><strong>{dataKindLabels[entry.kind]}</strong></header>
                  <label><span>记录名称</span><input value={entry.label} onChange={event => updateReviewEntry(entry.id, { label: event.target.value })} /></label>
                  {entry.kind === 'PROCESS_TIME' && <><label><span>工序处理方式</span><select value={typeof entry.payload.processDefinitionId === 'string' ? entry.payload.processDefinitionId : ''} onChange={event => updateReviewEntryPayload(entry.id, 'processDefinitionId', event.target.value)}><option value="">确认时按名称自动复用或新增</option>{context.processes.map(process => <option key={process.id} value={process.id}>{process.name}{process.code ? ` · ${process.code}` : ''}</option>)}</select><small>未选择已有工序不再阻断确认；系统会按名称去重复用或写入工序库。</small></label>{!String(entry.payload.processDefinitionId || '').trim() && <div className="sample-package-edit-grid"><label><span>新工序名称</span><input value={String(entry.payload.processName || '')} onChange={event => updateReviewEntryPayload(entry.id, 'processName', event.target.value)} /></label><label><span>工序阶段</span><select value={entry.payload.stageGroup === 'backend' || entry.payload.stageGroup === 'finish' ? String(entry.payload.stageGroup) : 'frontend'} onChange={event => updateReviewEntryPayload(entry.id, 'stageGroup', event.target.value)}><option value="frontend">前工序</option><option value="backend">后工序</option><option value="finish">包装/收尾</option></select></label></div>}</>}
                  {entry.kind === 'STRIPPING' && <label><span>正式参数处理</span><select value={entry.payload.publicationDecision === 'REPLACE_CURRENT' || entry.payload.publicationDecision === 'RECORD_ONLY' ? String(entry.payload.publicationDecision) : 'APPEND'} onChange={event => updateReviewEntryPayload(entry.id, 'publicationDecision', event.target.value)}><option value="APPEND">新增；完全相同则复用</option><option value="REPLACE_CURRENT">替换同产品、同位置当前版本</option><option value="RECORD_ONLY">仅保留样品审核记录，不进入参数库</option></select><small>同一产品、同一位置参数不同会阻断静默新增；选择“替换”后才建立新版本。</small></label>}
                  <div className="sample-package-edit-grid">{editablePayloadKeys[entry.kind].map(key => <label className={key === 'content' || key === 'remark' ? 'wide' : ''} key={key}><span>{payloadLabels[key]}</span>{key === 'timeBasis' ? <select value={entry.payload[key] === 'per_batch' ? 'per_batch' : 'per_unit'} onChange={event => updateReviewEntryPayload(entry.id, key, event.target.value)}><option value="per_unit">按件</option><option value="per_batch">按批</option></select> : key === 'content' || key === 'remark' ? <textarea value={String(entry.payload[key] ?? '')} onChange={event => updateReviewEntryPayload(entry.id, key, event.target.value)} /> : <input type={['recommendedSeconds', 'setupSeconds', 'occurrences'].includes(key) ? 'number' : 'text'} min={key === 'setupSeconds' ? 0 : undefined} step={key === 'occurrences' ? 1 : 'any'} value={String(entry.payload[key] ?? '')} onChange={event => updateReviewEntryPayload(entry.id, key, event.target.value)} />}</label>)}</div>
                </article>)}
                {!reviewEntryDrafts.length && <p className="sample-package-edit-empty">本包没有可编辑的数据记录。</p>}
              </section>
              <section className="sample-package-edit-section"><header><strong>照片信息</strong><small>{reviewPhotoDrafts.length} 张</small></header>
                {reviewPhotoDrafts.map((photo, index) => <article className="sample-package-photo-editor" key={photo.id}><span>{String(index + 1).padStart(2, '0')}</span><label><span>照片分类</span><select value={photo.category} onChange={event => updateReviewPhoto(photo.id, { category: event.target.value as SamplePhotoCategoryDTO })}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>照片说明</span><input value={photo.caption} placeholder={photo.originalName} onChange={event => updateReviewPhoto(photo.id, { caption: event.target.value })} /></label></article>)}
                {!reviewPhotoDrafts.length && <p className="sample-package-edit-empty">本包没有可编辑的照片。</p>}
              </section>
              <label><span>本次编辑说明（可留空）</span><textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder="例如：修正工序映射和照片分类" /></label>
            </> : <>
              <div className="sample-review-note danger"><AlertTriangle size={17} /><span><strong>将本次提交整体退回</strong><small>数据与照片会一起进入待修改状态，不会出现一部分通过、一部分驳回。</small></span></div>
              <label><span>驳回原因（必填）</span><textarea autoFocus value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder="请写清需要修改的问题" /></label>
            </>}
          </div>
          <footer><button type="button" disabled={reviewSaving} onClick={() => setPackageDialog(null)}>取消</button><button className={packageDialog === 'REJECT' ? 'danger' : 'primary'} type="button" disabled={reviewSaving || (packageDialog === 'REJECT' && reviewComment.trim().length < 2) || (packageDialog === 'EDIT' && !reviewEntryDrafts.length && !reviewPhotoDrafts.length)} onClick={() => void savePackageReview(packageDialog)}>{reviewSaving ? <><Loader2 className="spin" size={15} />处理中</> : packageDialog === 'EDIT' ? '保存整包修改' : '确认整包驳回'}</button></footer>
        </section>
      </div>}
    </main>
  );
}
