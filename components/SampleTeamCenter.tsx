'use client';

import QRCode from 'qrcode';
import dynamic from 'next/dynamic';
import SampleOverview from '@/components/sample/SampleOverview';
import '@/app/sample-unified-workbench.css';
const SampleCapture = dynamic(() => import('@/components/SampleCaptureMobile'), { ssr: false, loading: () => <div className="sb-empty">正在加载采集工具…</div> });
import '@/app/sample-branches.css';
import { SampleBranchControls, SampleDialog } from '@/components/sample/SampleBranchControls';
import SampleDocumentsPanel from '@/components/sample/SampleDocumentsPanel';
import SamplePlanningTable from '@/components/sample/SamplePlanningTable';
import SampleLibraryEntry from '@/components/sample-library/SampleLibraryQr';
import SamplePlanImportDialog from '@/components/sample/SamplePlanImportDialog';
import SampleCorrectionDialog from '@/components/sample/SampleCorrectionDialog';
import { sampleHours } from '@/lib/sample-plan-time';
import '@/app/sample-planning-realignment.css';
import { SamplePlanningDetail } from '@/components/sample/SamplePlanningDetail';
import '@/app/sample-planning-warehouse.css';
import SampleCompletionPanel from '@/components/sample/SampleCompletionPanel';
import { sampleCurrentWeek } from '@/lib/sample-plan-domain';
import { SAMPLE_VIEWS, sampleDateRange, sampleWarning, type SamplePlanView } from '@/lib/sample-plan-view';
import {
  FlaskConical,
  Layers3,
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
type TaskViewFilter = SamplePlanView;
type DetailTab = 'capture' | 'documents' | 'warehouse' | 'completion' | 'overview' | 'data' | 'materials' | 'photos' | 'review' | 'published';
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
  taskType: 'NEW' | 'REPEAT';
  planWeekStartDate: string;
  dataPurpose: 'PRODUCTION' | 'TEST' | 'TRAINING';
  drawingLibraryItemId: string;
  customerName: string;
  productName: string;
  specification: string;
  sourceOrderNo: string;
  sourceOrderLine: string;
  unitPlannedMinutes: string;
  customerLevelCode: string;
  customerLevelLabel: string;
  customerLevelColor: string;
  sampleQuantity: string;
  dueDate: string;
  plannedCompletionDate: string;
  issuedDate: string;
  warningDays: string;
  scheduleReason: string;
  priority: string;
  planRemark: string;
};

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
  taskType: 'NEW', planWeekStartDate: '',
  dataPurpose: 'PRODUCTION',
  drawingLibraryItemId: '',
  customerName: '',
  productName: '',
  specification: '',
  sourceOrderNo: '', sourceOrderLine: '', unitPlannedMinutes: '',
  customerLevelCode: 'A',
  customerLevelLabel: 'A级',
  customerLevelColor: SAMPLE_CUSTOMER_LEVELS[0].color,
  sampleQuantity: '',
  dueDate: '', plannedCompletionDate: '',
  issuedDate: '',
  warningDays: '2',
  scheduleReason: '',
  priority: String(SAMPLE_CUSTOMER_LEVELS[0].priority),
  planRemark: '',
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
  modalContext,
}: {
  user: CurrentUserDTO;
  mode: CenterMode;
  modeDrawerInitiallyOpen?: boolean;
  modalContext?: { taskId: string; queue: string[]; onClose: () => void };
}) {
  const modeDrawer = useModuleModeDrawer(modeDrawerInitiallyOpen);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [taskType, setTaskType] = useState<'NEW' | 'REPEAT'>('NEW');
  const [planWeek, setPlanWeek] = useState(sampleCurrentWeek);
  const [includeCarry, setIncludeCarry] = useState(false);
  const [planningDetailOpen, setPlanningDetailOpen] = useState(!!modalContext);
  const detailOpenRef = useRef(false); detailOpenRef.current = planningDetailOpen;
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [globalCompleted, setGlobalCompleted] = useState(0);
  const [captureDirty, setCaptureDirty] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [commandMenu, setCommandMenu] = useState(false);
  function safelyLeave(action: () => void) { if (captureDirty) setLeaveAction(() => action); else action(); }
  function navigateDetail(tab: DetailTab) { safelyLeave(() => { setDetailTab(tab); setCaptureDirty(false); setRefreshToken(v=>v+1); }); }
  function closeDetail() { safelyLeave(() => { setPlanningDetailOpen(false); setCaptureDirty(false); setRefreshToken(v=>v+1);
    if (window.history.state?.sampleModal === historyMarker.current) window.history.back();
    modalContext?.onClose(); }); }
  const [detailTask, setDetailTask] = useState<SampleTaskDTO | null>(null);
  const [tasks, setTasks] = useState<SampleTaskDTO[]>([]);
  const [summary, setSummary] = useState<SampleTeamSummaryDTO>(emptySummary);
  const [selectedId, setSelectedId] = useState(modalContext?.taskId || '');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [taskView, setTaskView] = useState<TaskViewFilter>(mode === 'planning' ? 'ALL' : 'UNFINISHED');
  const [filters, setFilters] = useState({ customer: '', dateBy: 'issued', period: 'all', from: '', to: '', level: '', member: '', risk: '', sort: 'issued_desc' });
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(mode === 'planning' ? 20 : 40);
  const [purpose, setPurpose] = useState('PRODUCTION');
  const [importBatch, setImportBatch] = useState('');
  const [correctionTask, setCorrectionTask] = useState<SampleTaskDTO | null>(null);
  const [timeSummary, setTimeSummary] = useState<{totalPlannedMilliseconds?:string;remainingPlannedMilliseconds?:string;missingTimeCount?:number;remainingUnknownCount?:number;unknownCompletedCount?:number}>({});
  const importReturn = useRef<null | (()=>void)>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 40, total: 0, totalPages: 1 });
  const [customers, setCustomers] = useState<string[]>([]);
  const [viewCounts, setViewCounts] = useState<Record<TaskViewFilter, number>>(Object.fromEntries(SAMPLE_VIEWS.map(view => [view, 0])) as Record<TaskViewFilter, number>);
  const [queryReady, setQueryReady] = useState(false);
  const [focusId, setFocusId] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [context, setContext] = useState<ContextPayload>({ members: [], sampleMemberCount: 0, products: [], processes: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{ id: string; version: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(emptyPlanForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [qrTask, setQrTask] = useState<SampleTaskDTO | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [reviewApprovalOpen,setReviewApprovalOpen]=useState(false),[reviewPhysical,setReviewPhysical]=useState(false),[reviewQuantity,setReviewQuantity]=useState(''),[reviewWorkDate,setReviewWorkDate]=useState(chinaTodayKey),[reviewApprovalError,setReviewApprovalError]=useState('');
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
  const reviewMutationRef = useRef<{ decision: 'CONFIRM' | 'EDIT' | 'REJECT'; key: string } | null>(null);
  const initialSelectedRef = useRef(false);
  const lastDetailTaskRef = useRef('');

  const detailQueue = modalContext?.queue || tasks.map(t => t.id);
  const historyMarker = useRef(`sample-modal-${Math.random().toString(36).slice(2)}`);
  const backAction = useRef(() => {});
  backAction.current = () => {
    if (captureDirty || photoViewerIndex !== null || editOpen || qrTask || packageDialog || deletePreview) {
      window.history.pushState({ ...window.history.state, sampleModal: historyMarker.current }, '', window.location.href);
      if (photoViewerIndex !== null) { setPhotoViewerIndex(null); return; }
      if (editOpen) { setEditOpen(false); return; }
      if (qrTask) { setQrTask(null); return; }
      if (packageDialog) { setPackageDialog(null); return; }
      if (deletePreview) { setDeletePreview(null); return; }
    }
    closeDetail();
  };
  useEffect(() => {
    if (!planningDetailOpen || mode !== 'planning') return;
    const base = new URL(window.location.href);
    base.searchParams.delete('taskId'); base.searchParams.delete('from');
    window.history.replaceState(window.history.state, '', base);
    window.history.pushState({ ...window.history.state, sampleModal: historyMarker.current }, '', base);
    const back = () => { if (window.history.state?.sampleModal !== historyMarker.current) backAction.current(); };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [planningDetailOpen, mode]);
  const [todayKey, setTodayKey] = useState(chinaTodayKey);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') { setTodayKey(chinaTodayKey()); setRefreshToken(value => value+1); } };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const visibleTasks = tasks;
  const summaryTask = tasks.find(task => task.id === selectedId) || (planningDetailOpen && detailTask?.id === selectedId ? detailTask : tasks[0]) || null;
  const selected = detailTask?.id === summaryTask?.id ? detailTask : summaryTask;
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ view: taskView, page: String(page), pageSize: String(pageSize), dateBy: filters.dateBy, sort: filters.sort });
    if (!importBatch) query.set('taskType', taskType); else query.set('importBatch', importBatch); query.set('purpose', purpose); if (planWeek) query.set('week', planWeek); query.set('carry', String(includeCarry)); query.set('summary', 'true');
    if (debouncedKeyword) query.set('keyword', debouncedKeyword);
    for (const key of ['customer', 'level', 'member', 'risk', 'from', 'to'] as const) if (filters[key]) query.set(key, filters[key]);
    if (focusId) query.set('focusId', focusId);
    return query.toString();
  }, [taskView, page, filters, debouncedKeyword, focusId, taskType, planWeek, includeCarry, pageSize, purpose, importBatch]);
  function changeFilters(next: Partial<typeof filters>) { setFilters(current => ({ ...current, ...next })); setPage(1); setFocusId(''); }
  function changeView(view: TaskViewFilter) { setTaskView(view); setPage(1); setFocusId(''); }
  function clearFilters() { setKeyword(''); setDebouncedKeyword(''); setFilters({ customer: '', dateBy: 'issued', period: 'all', from: '', to: '', level: '', member: '', risk: '', sort: 'issued_desc' }); setPage(1); setFocusId(''); setTaskView('ALL'); }
  function showHistory() { clearFilters(); setImportBatch(''); setPlanWeek(''); setIncludeCarry(false); setTaskView('COMPLETED'); setFilters(v=>({...v,dateBy:'completed',sort:'completed_desc'})); }
  function focusPlan(task: SampleTaskDTO) { clearFilters(); setImportBatch(''); setPurpose(task.dataPurpose); setTaskType(task.taskType || 'NEW'); setPlanWeek(task.planWeekStartDate || (['COMPLETED','CANCELLED'].includes(task.status) ? '' : 'unplanned')); setTaskView(task.status==='CANCELLED'?'CANCELLED':'ALL'); setIncludeCarry(false); setFocusId(task.id); setSelectedId(task.id); setDetailTask(task); setRefreshToken(v=>v+1); }
  async function viewImportedPlan(id: string) { try { const response=await fetch(`/api/sample-tasks/${encodeURIComponent(id)}`,{cache:'no-store'});const body=await responseJson(response);if(!response.ok)throw new Error(body.error);setSelectedId(body.task.id);setDetailTask(body.task);setDetailTab('overview');setPlanningDetailOpen(true); } catch(e){setMessage(e instanceof Error?e.message:'计划加载失败');} }
  function showImportBatch(batch: string) { const prior={taskType,planWeek,includeCarry,taskView,filters,keyword,debouncedKeyword,page,purpose};importReturn.current=()=>{setTaskType(prior.taskType);setPlanWeek(prior.planWeek);setIncludeCarry(prior.includeCarry);setTaskView(prior.taskView);setFilters(prior.filters);setKeyword(prior.keyword);setDebouncedKeyword(prior.debouncedKeyword);setPage(prior.page);setPurpose(prior.purpose);setFocusId('');};clearFilters();setPlanWeek('');setIncludeCarry(false);setPurpose('PRODUCTION');setImportBatch(batch);setImportOpen(false);setRefreshToken(v=>v+1); }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (modalContext) { setQueryReady(true); return; }
    const view = params.get('sampleView') as TaskViewFilter;
    if (SAMPLE_VIEWS.includes(view)) { setTaskView(view); if (view === 'COMPLETED' || view === 'ALL') setPlanWeek(''); if (view === 'COMPLETED') setFilters(v=>({...v,dateBy:'completed',sort:'completed_desc'})); }
    const id = params.get('taskId');
    if (id) {
      fetch(`/api/sample-tasks/${encodeURIComponent(id)}`, { cache: 'no-store' }).then(responseJson).then(body => {
        if (!body.task) { setError(body.error || '任务不存在'); return; }
        setTaskType(body.task.taskType || 'NEW'); setPlanWeek(body.task.planWeekStartDate || (body.task.status==='COMPLETED'?'':'unplanned')); setPurpose(body.task.dataPurpose); setTaskView('ALL'); setFocusId(id); setSelectedId(id); setDetailTask(body.task); setPlanningDetailOpen(true);
      }).catch(() => { setFocusId(''); setError('指定任务加载失败，请从任务清单重新选择'); }).finally(() => setQueryReady(true));
    }
    const keyword = params.get('sampleSearch') || '';
    setKeyword(keyword); setDebouncedKeyword(keyword); if (!id) setQueryReady(true);
  }, []);
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
    if (!createOpen && !editOpen && !importOpen && !moreFilters) return;
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
  }, [createOpen, editOpen, importOpen, moreFilters]);

  useEffect(() => {
    if (!queryReady || modalContext) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/sample-tasks?${queryString}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '样品任务加载失败');
        const nextTasks = Array.isArray(body.tasks) ? body.tasks as SampleTaskDTO[] : [];
        if (controller.signal.aborted) return;
        setTasks(nextTasks);
        setViewCounts(body.viewCounts);
        setPagination(body.pagination);
        setCustomers(body.customers || []);
        setSummary(body.summary || emptySummary); setTimeSummary(body.summary || {});
        setTotalQuantity(Number(body.summary?.quantity || 0)); setGlobalCompleted(Number(body.globalCompleted ?? body.viewCounts?.COMPLETED ?? 0));
        setSelectedId(currentSelectedId => {
          if (!detailOpenRef.current && !nextTasks.some(task => task.id === currentSelectedId)) {
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
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [queryString, queryReady, refreshToken]);

  useEffect(() => {
    if (!selectedId || mode === 'planning' && !planningDetailOpen) return;
    const controller = new AbortController();
    fetch(`/api/sample-tasks/${encodeURIComponent(selectedId)}`, { cache: 'no-store', signal: controller.signal }).then(async response => { const body = await responseJson(response); if (!response.ok) throw new Error(body.error || '任务详情加载失败'); if (!controller.signal.aborted) setDetailTask(body.task); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [selectedId, refreshToken, mode, planningDetailOpen]);

  useEffect(() => {
    if (planningDetailOpen) return;
    setSelectedId(current => visibleTasks.some(task => task.id === current) ? current : visibleTasks[0]?.id || '');
  }, [visibleTasks, planningDetailOpen]);

  useEffect(() => {
    if (!selected) {
      lastDetailTaskRef.current = '';
      setDetailTab('overview');
      return;
    }
    if (lastDetailTaskRef.current === selected.id) return;
    lastDetailTaskRef.current = selected.id;
    setDetailTab(mode === 'materials' ? 'warehouse' : selected.taskType === 'REPEAT' ? 'documents' : selected.counts.pendingReview > 0 ? 'review' : 'overview');
  }, [mode, selected]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function replaceTask(task: SampleTaskDTO | null | undefined) {
    if (!task) return;
    setFocusId('');
    setDetailTask(task);
    setTasks(current => current.map(item => item.id === task.id ? task : item));
    setSelectedId(task.id);
    setRefreshToken(value => value + 1);
  }

  function openCreate() {
    setForm({ ...emptyPlanForm, taskType, planWeekStartDate: planWeek === 'unplanned' ? '' : planWeek, issuedDate: chinaTodayKey() });
    setProductSearch('');
    setFormError('');
    setCreateOpen(true);
  }

  function openImport() { setCommandMenu(false); setImportOpen(true); }

  function openEdit(task: SampleTaskDTO) {
    if (['COMPLETED','CANCELLED'].includes(task.status)) { setCorrectionTask(task); return; }
    setEditingTarget({ id: task.id, version: task.version });
    const level = sampleCustomerLevelOrDefault(task.customerLevelCode);
    setForm({
      taskType: task.taskType || 'NEW', planWeekStartDate: task.planWeekStartDate || '',
      dataPurpose: task.dataPurpose,
      drawingLibraryItemId: task.drawingLibraryItemId,
      customerName: task.customerName,
      productName: task.productName || '',
      specification: task.specification,
      sourceOrderNo: task.sourceOrderNo || '', sourceOrderLine: task.sourceOrderLine || '', unitPlannedMinutes: task.unitPlannedMinutes == null ? '' : String(task.unitPlannedMinutes),
      customerLevelCode: level.code,
      customerLevelLabel: level.label,
      customerLevelColor: level.color,
      sampleQuantity: task.sampleQuantity === null ? '' : String(task.sampleQuantity),
      dueDate: task.dueDate || '', plannedCompletionDate: task.plannedCompletionDate || '',
      issuedDate: task.issuedDate || '',
      warningDays: String(task.warningDays ?? 2),
      scheduleReason: '',
      priority: String(level.priority),
      planRemark: task.planRemark || '',
    });
    setFormError('');
    setEditOpen(true);
  }


  async function savePlan() {
    setSaving(true);
    setFormError('');
    try {
      if (editOpen && editingTarget) {
        const response = await fetch(`/api/sample-tasks/${editingTarget.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, action: 'UPDATE', expectedVersion: editingTarget.version }),
        });
        const body = await responseJson(response);
        if (!response.ok) throw new Error(body.error || '计划保存失败');
        replaceTask(body.task as SampleTaskDTO);
        focusPlan(body.task);
        setEditOpen(false);
        setMessage('计划已更新并定位；数量有变化时，仓库配料需重新确认');
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
        clearFilters();
        setDebouncedKeyword('');
        setRefreshToken(value => value + 1);
        if (body.task?.id) {
          focusPlan(body.task);
          const url = new URL(window.location.href);
          url.searchParams.set('taskId', body.task.id);
          url.searchParams.set('sampleView', 'UNFINISHED');
          url.searchParams.delete('sampleSearch');
          window.history.replaceState(window.history.state, '', url);
        }
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '计划保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function taskAction(task: SampleTaskDTO, action: 'START' | 'COMPLETE' | 'CANCEL' | 'ARCHIVE' | 'UNARCHIVE') {
    if (action === 'CANCEL' && !window.confirm('确认取消这个样品任务？未结束的缺料跟进会取消。已采集资料、已配物料和成品库存会保留，实物需另行核对。')) return;
    if (action === 'COMPLETE' && task.dataPurpose === 'PRODUCTION') { setSelectedId(task.id); setDetailTask(task); setDetailTab('completion'); setPlanningDetailOpen(true); return; }
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

  async function savePackageReview(decision: 'CONFIRM' | 'EDIT' | 'REJECT', confirmed=false) {
    if (!selected?.activeSubmission || selected.activeSubmission.status !== 'PENDING') {
      setMessage('当前没有可审核的提交包');
      return;
    }
    if (decision==='CONFIRM'&&!confirmed) {setReviewPhysical(false);setReviewQuantity(String(Math.max(0,(selected.sampleQuantity||0)-(selected.completedQuantity||0))));setReviewWorkDate(chinaTodayKey());setReviewApprovalError('');setReviewApprovalOpen(true);return;}
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
          ...(decision==='CONFIRM' && reviewPhysical && selected.dataPurpose==='PRODUCTION' ? {completion:{quantity:Number(reviewQuantity),workDate:reviewWorkDate}} : {}),
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
      setPackageDialog(null); setReviewApprovalOpen(false);
      setReviewIssues([]);
      setReviewComment('');
      setMessage(decision === 'CONFIRM'
        ? body.task.status==='COMPLETED'?'资料审核及实际完成登记已完成':'本次资料已通过审核，实物按实际数量继续登记完成'
        : decision === 'REJECT'
          ? '本次提交已整包驳回，可修改后重新提交'
          : '审核页修改已保存，仍等待整包确认');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      const text=reason instanceof Error ? reason.message : '整包审核失败';setMessage(text);setReviewApprovalError(text);
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
      {entry.publishedEntityType === 'connector_parameter_conflict' && <Link className="sample-published-link" href="/connector-parameters?view=conflicts">参数差异待处理 · 不影响样品完成 →</Link>}
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
  const taskViews = [
    { key: 'ALL' as const, label: '全部', count: viewCounts.ALL, icon: <ClipboardCheck size={15} /> },
    { key: 'DOCUMENT_PENDING' as const, label: '资料待处理', count: viewCounts.DOCUMENT_PENDING, icon: <FileText size={15} /> },
    { key: 'SHORTAGE' as const, label: '缺料', count: viewCounts.SHORTAGE, icon: <AlertTriangle size={15} /> },
    { key: 'UNFINISHED' as const, label: '未完成任务', count: viewCounts.UNFINISHED, icon: <PackageCheck size={15} /> },
    { key: 'TODAY' as const, label: '今日到期', count: viewCounts.TODAY, icon: <CalendarDays size={15} /> },
    { key: 'SOON' as const, label: '即将到期', count: viewCounts.SOON, icon: <Clock3 size={15} />, attention: true },
    { key: 'OVERDUE' as const, label: '已经逾期', count: viewCounts.OVERDUE, icon: <Clock3 size={15} />, danger: true },
    { key: 'PLANNED' as const, label: '待开始', count: viewCounts.PLANNED, icon: <CircleDot size={15} /> },
    { key: 'IN_PROGRESS' as const, label: taskType === 'REPEAT' ? '制作中' : '采集中', count: viewCounts.IN_PROGRESS, icon: <Camera size={15} /> },
    { key: 'PENDING_REVIEW' as const, label: '待整包审核', count: viewCounts.PENDING_REVIEW, icon: <ClipboardCheck size={15} />, unit: '单', attention: true },
    { key: 'COMPLETED' as const, label: '已完成', count: viewCounts.COMPLETED, icon: <CheckCircle2 size={15} /> },
    { key: 'CANCELLED' as const, label: '已取消', count: viewCounts.CANCELLED, icon: <X size={15} />, quiet: true },
  ];
  const detailTabs: Array<{ key: DetailTab; label: string; count?: number; attention?: boolean }> = !selected ? [] : [
    { key: 'overview', label: '任务概览' },
    { key: 'documents', label: '图纸审核' },

    ...(selected.taskType === 'REPEAT' ? [] : [
      ...(!terminalTask ? [{ key: 'capture' as const, label: '填写 / 拍照' }] : []),
      { key: 'data' as const, label: '数据记录', count: selected.counts.data },
      { key: 'photos' as const, label: '过程照片', count: selected.counts.photos },
      { key: 'review' as const, label: '整包审核', count: selected.counts.pendingReview, attention: true },
      { key: 'published' as const, label: '已处理', count: publishedCount },
    ]),
    { key: 'completion', label: '完成 / 成品仓', count: selected.finishedGoodsCount || 0 },
  ];
  const moduleConfig = mode === 'planning' ? {
    activeHref: '/weekly-plan-center',
    subtitle: '样品任务下达与数据审核',
    eyebrow: '计划中心 / 样品组',
    title: '计划中心',
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
    subtitle: '样品仓库配料与物料跟进',
    eyebrow: '仓库管理 / 样品组',
    title: '样品物料准备',
    description: '登记需求、核对配料、跟进采购及客供缺料',
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

  const statusBar = <section className="su-status spr-status" aria-label="样品任务状态筛选"><div className="su-primary-scopes">{(['ALL','UNFINISHED','COMPLETED','CANCELLED'] as const).map(view=><button key={view} className={taskView===view?'active':''} aria-pressed={taskView===view} onClick={()=>changeView(view)}>{({ALL:'全部',UNFINISHED:'未完成',COMPLETED:'已完成',CANCELLED:'已取消'})[view]}<b>{loading?'…':viewCounts[view]}</b></button>)}</div><div className="su-attention-scopes">{taskViews.filter(v=>['DOCUMENT_PENDING','SHORTAGE',...(taskType==='NEW'?['PENDING_REVIEW']:[])].includes(v.key)).map(v=><button key={v.key} className={taskView===v.key?'active':''} aria-pressed={taskView===v.key} onClick={()=>changeView(v.key)}>{v.icon}{v.label}<b>{loading?'…':v.count}</b></button>)}<select aria-label="资料审核状态" value={['DRAWING_MISSING','DRAWING_DRAFT','DRAWING_REVIEW','DRAWING_RETURNED','DRAWING_APPROVED'].includes(taskView)?taskView:''} onChange={e=>changeView((e.target.value || 'ALL') as TaskViewFilter)}><option value="">资料状态</option><option value="DRAWING_MISSING">待上传</option><option value="DRAWING_DRAFT">待提交</option><option value="DRAWING_REVIEW">待审核</option><option value="DRAWING_RETURNED">已退回</option><option value="DRAWING_APPROVED">已通过</option></select></div><button className="spr-history" onClick={showHistory}>历史已完成 <b>{loading?'…':globalCompleted}</b></button></section>;
  return (
    <main style={modalContext ? { display: 'contents' } : undefined} className={`sample-team-page sample-branches-page hm-workbench-root hm-workbench-navigation-overlay ${mode === 'planning' ? 'sp-planning-page' : ''}`}>
      {!modalContext && <AppWorkbenchHeader
        user={user}
        activeHref={moduleConfig.activeHref}
        subtitle={moduleConfig.subtitle}
        hideHeader
        sidebarTriggerTargetId="sample-team-navigation-trigger"
        sidebarExpanded={navigationOpen}
        onSidebarExpandedChange={handleNavigationExpandedChange}
        moduleModeSwitcher={{ mode: 'sample', drawerId: moduleConfig.drawerId, drawerOpen: modeDrawer.open, onToggle: toggleModeDrawer, openFromSidebar: false }}
        menuItems={[{ label: '退出登录', onSelect: () => { void logout(); } }]}
      />}

      {!modalContext && <div className={`sample-team-main${modeDrawer.open ? ' mode-drawer-open' : ''}`}>
        <header className="sample-team-commandbar">
          <div className="sample-team-title">
            <span id="sample-team-navigation-trigger" className="sample-team-navigation-trigger" />
            <div className="sample-team-title-copy">
              <small>{moduleConfig.eyebrow}</small>
              <div className="sample-team-title-line"><h1>{moduleConfig.title}</h1><ModuleModeTrigger buttonRef={modeDrawer.triggerRef} open={modeDrawer.open} mode="sample" onClick={toggleModeDrawer} controls={moduleConfig.drawerId} compact /></div>
              <p>{moduleConfig.description}</p>
            </div>
          </div>
          {mode === 'planning' && <div className="sb-branch-switch sp-header-branches" role="group" aria-label="样品类型">{(['NEW','REPEAT'] as const).map(kind=><button key={kind} className={taskType===kind?'active':''} aria-pressed={taskType===kind} onClick={()=>{setImportBatch('');setTaskType(kind);setPage(1);setFocusId('');setSelectedId('');setDetailTask(null);}}>{kind==='NEW'?<FlaskConical size={18}/>:<Layers3 size={18}/>}<span>{kind==='NEW'?'新品试制':'老产品制作'}</span></button>)}</div>}
          <div className="sample-team-command-actions">
            <SampleLibraryEntry returnTo="/weekly-plan-center?branch=samples" />
            <details className="su-command-menu" open={commandMenu} onToggle={e=>setCommandMenu(e.currentTarget.open)}><summary>导入 / 导出</summary><div><a className="hm-workbench-button" href={`/api/sample-tasks/export?${queryString}`} download><Download size={15} />导出清单</a>
            {mode === 'planning' && <a className="hm-workbench-button" href="/api/sample-tasks/import/template" download><Download size={15} />下载导入模板</a>}
            {mode === 'planning' && <button className="hm-workbench-button" type="button" onClick={openImport}><Upload size={15} />批量导入</button>}
            </div></details>
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

        <SampleBranchControls hideType={mode === 'planning'} filters={queryString} type={importBatch?'':taskType} week={planWeek} carry={includeCarry} refresh={refreshToken} onChange={(kind, week, carry) => { if(kind)setTaskType(kind); setPlanWeek(week); setIncludeCarry(carry); setPage(1); setFocusId(''); }} />
        {statusBar}
        {importBatch && <div className="spr-batch-banner"><span>本次导入 · 包含本批新建和更新的计划，跨周与混合类型统一展示</span><button onClick={()=>{setImportBatch('');importReturn.current?.();importReturn.current=null;}}>返回导入前视图 <X size={14}/></button></div>}
        <section className="sample-plan-filters" aria-label="样品计划筛选">
          <div className="sample-plan-filter-line">
            <label className="sample-plan-search"><Search size={16}/><input aria-label="搜索样品任务" value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); setFocusId(''); }} placeholder="搜索客户、型号或订单" /></label>
            <select aria-label="日期类型" value={filters.dateBy} onChange={event => changeFilters({ dateBy: event.target.value })}><option value="issued">下达日期</option><option value="due">客户交期</option><option value="completed">完成日期</option></select>
            <select aria-label="日期范围" value={filters.period} onChange={event => changeFilters({ period: event.target.value, ...sampleDateRange(event.target.value) })}><option value="all">全部日期</option><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="custom">自定义</option></select>
            <select aria-label="客户筛选" value={filters.customer} onChange={event => changeFilters({ customer: event.target.value })}><option value="">全部客户</option>{customers.map(customer => <option key={customer}>{customer}</option>)}</select>
            <select aria-label="排序方式" value={filters.sort} onChange={event => changeFilters({ sort: event.target.value })}><option value="issued_desc">最近下达</option><option value="issued_asc">最早下达</option><option value="due_asc">交期最近</option><option value="priority">客户优先级</option><option value="completed_desc">最近完成</option></select>
            <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters(value => !value)}>更多筛选</button><button type="button" aria-label="清除筛选" onClick={clearFilters}><X size={16}/></button>
          </div>
          {filters.period === 'custom' && <div className="sample-plan-filter-line"><label>从 <input aria-label="开始日期" type="date" value={filters.from} onChange={event => changeFilters({ from: event.target.value })}/></label><label>至 <input aria-label="结束日期" type="date" value={filters.to} onChange={event => changeFilters({ to: event.target.value })}/></label></div>}
          {moreFilters && <div className="sample-plan-filter-line"><select aria-label="数据用途筛选" value={purpose} onChange={e=>{setPurpose(e.target.value);setPage(1);setFocusId('');}}><option value="PRODUCTION">正式业务</option><option value="TEST">测试</option><option value="TRAINING">培训</option><option value="ALL">全部用途</option></select><select aria-label="客户等级筛选" value={filters.level} onChange={event => changeFilters({ level: event.target.value })}><option value="">全部等级</option>{['A','B','C','D'].map(level => <option value={level} key={level}>{level}级</option>)}</select><select aria-label="交期预警筛选" value={filters.risk} onChange={event => changeFilters({ risk: event.target.value })}><option value="">全部交期</option><option value="WARNING">需关注交期</option><option value="MISSING">未设置出货日期</option></select></div>}
        </section>


        {error && <div className="sample-team-error"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}

        {mode !== 'planning' && loading && !tasks.length ? <section className="sample-team-loading"><Loader2 className="spin" size={28} /><strong>正在加载样品任务</strong></section>
          : mode !== 'planning' && viewCounts.ALL === 0 && !debouncedKeyword && !Object.values(filters).some(value => value && !['issued', 'all', 'issued_desc'].includes(value)) ? <section className="sample-team-zero-state"><span className="sample-empty-icon"><PackageCheck size={34} /></span><small>{moduleConfig.title}</small><h2>{mode === 'materials' ? '当前还没有样品物料记录' : '当前还没有样品任务'}</h2><p>{mode === 'materials' ? '正式样品计划下达后，仓库可在这里登记物料需求并确认配料。' : '计划中心下达样品任务后，会自动出现在这里。'}</p><div><Info size={15} />{taskType === 'REPEAT' ? '老产品仅审核图纸资料，完成后转成品仓。' : '新品保留现有采集与整包审核流程。'}</div></section>
            : mode !== 'planning' && (!tasks.length || !visibleTasks.length) ? <section className="sample-filter-empty"><span className="sample-empty-icon"><Search size={30} /></span><h2>没有符合条件的样品任务</h2><p>调整搜索内容或任务状态后再查看。</p><button type="button" onClick={clearFilters}>清除筛选</button></section>
              : <section className="sample-team-workspace">
          {mode === 'planning' && <SamplePlanningTable scopeKey={queryString} tasks={tasks} pagination={pagination} loading={loading} totalQuantity={totalQuantity} timeSummary={timeSummary} focusId={focusId} error={error} onPageSize={n=>{setPageSize(n);setPage(1);setFocusId('');}} scopeLabel={`${planWeek==='unplanned'?'待排期':planWeek?planWeek+' 当周':'全部计划周'} · ${taskViews.find(v=>v.key===taskView)?.label || ({ALL:'全部有效计划',DOCUMENT_PENDING:'资料待处理'} as Record<string,string>)[taskView] || '当前筛选'}`} onEmptyAction={week=>{clearFilters();setPlanWeek(week);setIncludeCarry(false);setImportBatch('');}} onPage={next => { setFocusId(''); setPage(next); }} onEdit={openEdit} onChanged={() => setRefreshToken(v=>v+1)} onOpen={(task, tab) => { lastDetailTaskRef.current=task.id; setSelectedId(task.id); setDetailTab(tab); setPlanningDetailOpen(true); }} />}
          {mode !== 'planning' && <aside className="sample-task-list" aria-label="样品任务列表">
            <header className="sample-task-list-head"><div><strong>任务清单</strong><span>{pagination.total} 个任务</span></div></header>
            <div className="sample-task-list-scroll hm-scroll-region" tabIndex={0}>
              {visibleTasks.map((task, index) => {
                const warning = sampleWarning(task, todayKey);
                const overdue = warning.kind === 'OVERDUE';
                return <button className={`sample-task-card ${selected?.id === task.id ? 'active' : ''} status-${task.status.toLowerCase()}`} aria-pressed={selected?.id === task.id} type="button" key={task.id} onClick={() => setSelectedId(task.id)}>
                  <span className="sample-task-color" style={{ background: sampleCustomerLevelOrDefault(task.customerLevelCode).color }} />
                  <header className="sample-task-card-head"><div><em style={sampleCustomerLevelStyle(task.customerLevelCode)}>{taskLevelText(task)}</em>{task.dataPurpose !== 'PRODUCTION' && <em className="sample-data-purpose">{task.dataPurpose === 'TEST' ? '测试' : '培训'}</em>}<strong title={task.customerName}>{task.customerName}</strong></div><small>{task.code}</small></header>
                  <h3 title={task.specification}><small className="sample-task-sequence">{String((pagination.page-1)*pagination.pageSize+index+1).padStart(3, '0')}</small>{task.specification}</h3>
                  <p>{task.productName || '未设置品名'}</p>
                  <div className="sample-task-date-pair"><span>下达 {dateText(task.issuedDate)}</span><span>出货 {dateText(task.dueDate)}</span></div>
                  <div className="sample-task-card-state"><span className={`state-${task.status.toLowerCase()}`}>{task.taskType === 'REPEAT' && task.status === 'IN_PROGRESS' ? '制作中' : taskStatusLabels[task.status]}</span><span className={overdue ? 'overdue' : ''}><CalendarDays size={12} />{warning.label}</span></div>
                  <footer><span className={task.drawingReviewStatus === 'APPROVED' ? 'sb-good-text' : ''}>图纸 {task.drawingReviewStatus === 'APPROVED' ? '已通过' : task.drawingReviewStatus === 'RETURNED' ? '已退回' : '待审核'}</span><span>配料 {task.materialStatus === 'completed' ? '已齐' : task.materialStatus === 'exception' ? '缺料' : '待准备'}</span><b>{task.completedQuantity || 0} / {task.sampleQuantity || '—'}</b></footer>
                </button>;
              })}
            </div>
            <footer className="sample-plan-pagination"><button type="button" disabled={loading || pagination.page <= 1} onClick={() => { setFocusId(''); setPage(pagination.page-1); }}>上一页</button><span>{pagination.page} / {pagination.totalPages}</span><button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => { setFocusId(''); setPage(pagination.page+1); }}>下一页</button></footer>
          </aside>}


        </section>}
      </div>}

          <SamplePlanningDetail planning={mode === 'planning'} open={planningDetailOpen && !packageDialog && !editOpen && !qrTask && !deletePreview && photoViewerIndex === null} title={selected?.taskType==='REPEAT'?'样品制作':'样品试制'} onClose={closeDetail} navigation={<div className="su-detail-nav"><span>{detailQueue.indexOf(selectedId)+1} / {detailQueue.length}</span>{[-1,1].map(direction=><button key={direction} aria-label={direction<0?'上一项样品':'下一项样品'} disabled={!detailQueue[detailQueue.indexOf(selectedId)+direction]} onClick={()=>safelyLeave(()=>{const next=detailQueue[detailQueue.indexOf(selectedId)+direction];if(next){setSelectedId(next);setDetailTask(null);setCaptureDirty(false);}})}>{direction<0?'上一项':'下一项'}</button>)}</div>}>
          <section className="sample-task-detail">
            {!selected && <div className="sb-empty" role="status">{error ? <><strong>{error}</strong><button onClick={() => { setError(''); setRefreshToken(v => v + 1); }}>重新加载</button></> : <><Loader2 className="spin"/>正在读取样品详情…</>}</div>}
            {selected && detailTask?.id !== selected.id && <div className="sb-empty"><Loader2 className="spin"/>正在读取任务详情</div>}
            {selected && detailTask?.id === selected.id && <>
              <header className="sample-detail-head">
                <div><div className="sample-detail-identity"><span style={sampleCustomerLevelStyle(selected.customerLevelCode)}>{taskLevelText(selected)}</span><small>{selected.code}</small></div><h2>{selected.specification}</h2><p>{selected.customerName} · {selected.productName || '未设置品名'}{selected.sourceOrderNo ? ` · 来源 ${selected.sourceOrderNo}` : ''}</p></div>
                <div className="sample-detail-actions">
                  {!terminalTask && selected.taskType !== 'REPEAT' && <button type="button" onClick={() => safelyLeave(() => { setCaptureDirty(false); void openQr(selected); })}><QrCode size={15} />二维码</button>}
                  {mode === 'planning' && !terminalTask && <button type="button" onClick={() => safelyLeave(() => { setCaptureDirty(false); openEdit(selected); })}><Pencil size={15} />编辑计划</button>}
                  {mode !== 'materials' && selected.status === 'PLANNED' && <button className="primary" type="button" onClick={() => void taskAction(selected, 'START')}>开始任务</button>}
                  {mode !== 'materials' && selected.taskType !== 'REPEAT' && selected.status === 'IN_PROGRESS' && selected.counts.data + selected.counts.photos === 0 && <button type="button" onClick={() => void taskAction(selected, 'COMPLETE')}>无资料完成</button>}
                  {mode === 'planning' && selected.status === 'COMPLETED' && <button type="button" onClick={() => void taskAction(selected, selected.archivedAt ? 'UNARCHIVE' : 'ARCHIVE')}>{selected.archivedAt ? '取消归档' : '归档'}</button>}
                  {mode === 'planning' && user.laborRole === 'ADMIN' && selected.status === 'COMPLETED' && <button className="danger" type="button" disabled={deleteBusy} onClick={() => void openDeleteTask(selected)}><Trash2 size={15} />删除</button>}
                </div>
              </header>

              <nav className="sample-detail-tabs" aria-label="样品任务详情"><div>{detailTabs.map(tab => <button type="button" className={`${detailTab === tab.key ? 'active' : ''}${tab.attention && tab.count ? ' attention' : ''}`} aria-pressed={detailTab === tab.key} key={tab.key} onClick={() => navigateDetail(tab.key)}><span>{tab.label}</span>{typeof tab.count === 'number' && <em>{tab.count}</em>}</button>)}</div></nav>

              <div className={`sample-detail-body hm-scroll-region${detailTab === 'documents' ? ' sb-preview-body' : ''}`} tabIndex={0}>
                {detailTab === 'documents' && <SampleDocumentsPanel key={selected.id} task={selected} onChanged={() => setRefreshToken(v => v + 1)} />}
                {detailTab === 'warehouse' && <div className="sb-empty"><Link href={`/workspace/warehouse?branch=samples&taskId=${selected.id}`} prefetch={false}>进入仓库查看配料与缺料跟进 →</Link></div>}
                {(detailTab === 'completion' || detailTab === 'overview' && selected.taskType === 'REPEAT') && <SampleCompletionPanel key={selected.id} task={selected} onSaved={replaceTask} onTab={setDetailTab} onCorrect={()=>setCorrectionTask(selected)} />}

                {detailTab === 'overview' && selected.taskType !== 'REPEAT' && <SampleOverview task={selected} onTab={navigateDetail}/>}
                {detailTab === 'capture' && selected.taskType !== 'REPEAT' && <div className="su-embedded-capture"><SampleCapture key={selected.id} code={selected.qrCode} user={user} embedded onDirtyChange={setCaptureDirty} onBack={()=>navigateDetail('data')}/></div>}
                {detailTab === 'data' && <section className="sample-record-panel sample-tab-panel"><header><div><FileText size={17} /><span><strong>采集数据</strong><small>{selected.entries.length} 条记录，仅显示业务字段</small></span></div>{!terminalTask && <button onClick={()=>navigateDetail('capture')}>继续采集</button>}</header><div className="sample-record-list" tabIndex={0}>{selected.entries.map(renderDataRecord)}{!selected.entries.length && <div className="sample-record-empty"><FileText size={25} /><strong>本次尚未采集数据</strong><p>这不是缺项，任务仍可提交或完成。</p></div>}</div></section>}

                {detailTab === 'materials' && <section className="sample-record-panel sample-tab-panel"><header><div><PackageCheck size={17} /><span><strong>样品辅料数据</strong><small>{materialEntries.length} 条记录；全部选填，不关联库存扣减</small></span></div>{!terminalTask && <Link href={selected.captureUrl} prefetch={false}>补充资料</Link>}</header><div className="sample-record-list" tabIndex={0}>{materialEntries.map(renderDataRecord)}{!materialEntries.length && <div className="sample-record-empty"><PackageCheck size={25} /><strong>本次尚未记录辅料数据</strong><p>可按实际需要记录波纹管、热缩管、套管等，不要求填写原因。</p></div>}</div></section>}

                {detailTab === 'photos' && <section className="sample-record-panel sample-tab-panel photo-panel"><header><div><ImageIcon size={17} /><span><strong>过程与成品照片</strong><small>{selected.photos.length} 张照片</small></span></div>{!terminalTask && <button onClick={()=>navigateDetail('capture')}>继续拍照</button>}</header><div className="sample-photo-grid" tabIndex={0}>{selected.photos.map(renderPhotoRecord)}{!selected.photos.length && <div className="sample-record-empty"><ImageIcon size={25} /><strong>本次尚未上传照片</strong><p>照片同样不设必选项。</p></div>}</div></section>}

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
                  {<footer className="sample-package-review-actions"><span><Info size={15} />参数差异将留待处理，样品可正常完成并转仓。</span><div><button type="button" disabled={reviewSaving} onClick={() => openPackageDialog('EDIT')}><Pencil size={15} />编辑资料</button><button className="danger" type="button" disabled={reviewSaving} onClick={() => openPackageDialog('REJECT')}><X size={15} />整包驳回</button><button className="primary" type="button" disabled={reviewSaving} onClick={() => void savePackageReview('CONFIRM')}>{reviewSaving ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}{autoCatalogEntries.length ? `确认并处理 ${autoCatalogEntries.length} 条工序` : '确认通过'}</button></div></footer>}
                </section>)}

                {detailTab === 'published' && (!publishedEntries.length && !publishedPhotos.length ? <div className="sample-record-empty sample-tab-empty"><FolderKanban size={30} /><strong>本任务还没有审核处理资料</strong><p>整包确认后的留档、工时草稿、正式数据和照片会在这里集中展示。</p></div> : <div className="sample-review-workspace"><section className="sample-record-panel"><header><div><FileText size={17} /><span><strong>已处理数据</strong><small>{publishedEntries.length} 项</small></span></div></header><div className="sample-record-list">{publishedEntries.map(renderDataRecord)}{!publishedEntries.length && <div className="sample-record-empty"><strong>没有已处理数据</strong></div>}</div></section><section className="sample-record-panel photo-panel"><header><div><ImageIcon size={17} /><span><strong>已发布照片</strong><small>{publishedPhotos.length} 项</small></span></div></header><div className="sample-photo-grid sample-review-photo-grid">{publishedPhotos.map(renderPhotoRecord)}{!publishedPhotos.length && <div className="sample-record-empty"><strong>没有已发布照片</strong></div>}</div></section></div>)}
              </div>

              <footer className="sample-detail-footer">
                <div><span>创建 {dateTimeText(selected.createdAt)} · {selected.createdBy || '未记录'}</span><span>最近更新 {dateTimeText(selected.updatedAt)}</span></div>
                <div><Link href={`/drawing-library?itemId=${encodeURIComponent(selected.drawingLibraryItemId)}`} prefetch={false}><FolderKanban size={14} />查看产品资料</Link>{selected.status !== 'CANCELLED' && selected.status !== 'COMPLETED' && mode === 'planning' && <button className="danger" type="button" onClick={() => void taskAction(selected, 'CANCEL')}>取消任务</button>}</div>
              </footer>
            </>}
          </section>
          </SamplePlanningDetail>

      {leaveAction&&<SampleDialog title="还有未同步的采集内容" onClose={()=>setLeaveAction(null)}><div className="sb-dialog-body"><p>请先保存数据并上传照片。留在当前页可继续处理；离开后，本机草稿会保留供下次继续。</p></div><footer><button onClick={()=>setLeaveAction(null)}>继续编辑</button><button onClick={()=>{const action=leaveAction;setLeaveAction(null);setCaptureDirty(false);action();}}>保留草稿并离开</button></footer></SampleDialog>}
      {message && <div className="sample-team-toast" role="status">{message}</div>}

      {importOpen && <SamplePlanImportDialog suspended={planningDetailOpen} week={planWeek} type={taskType} onClose={()=>{setImportOpen(false);setRefreshToken(v=>v+1);}} onCommitted={showImportBatch} onViewPlan={id=>void viewImportedPlan(id)}/>}
      {reviewApprovalOpen && selected && <SampleDialog title="确认本次整包资料" busy={reviewSaving} onClose={()=>setReviewApprovalOpen(false)}><div className="sb-dialog-body"><strong>{selected.specification}</strong><p>通过后发布本次提交的资料与参数；没有变更的资料后续无需重复审核。</p>{selected.dataPurpose==='PRODUCTION'&&<><label className="spr-check"><input type="checkbox" disabled={reviewSaving} checked={reviewPhysical} onChange={e=>setReviewPhysical(e.target.checked)}/>同时登记实际完成并转成品仓</label>{reviewPhysical?<><label>本次实际完成数量<input type="number" min={1} max={(selected.sampleQuantity||0)-(selected.completedQuantity||0)} step={1} value={reviewQuantity} disabled={reviewSaving} onChange={e=>setReviewQuantity(e.target.value)}/></label><label>现场完成日期<input type="date" max={chinaTodayKey()} value={reviewWorkDate} disabled={reviewSaving} onChange={e=>setReviewWorkDate(e.target.value)}/></label><p className="sb-inline-note">本次转入 {reviewQuantity||'0'} 件／套，备注“样品完成”；剩余部分可稍后登记。</p></>:<p className="spr-help">本次只通过资料，不将计划数量自动记为实物完成。</p>}</>}{reviewApprovalError&&<p role="alert" className="sb-error">{reviewApprovalError}</p>}</div><footer><button disabled={reviewSaving} onClick={()=>setReviewApprovalOpen(false)}>取消</button><button className="sb-primary" disabled={reviewSaving||(reviewPhysical&&(!reviewWorkDate||!Number.isInteger(Number(reviewQuantity))||Number(reviewQuantity)<1||Number(reviewQuantity)>(selected.sampleQuantity||0)-(selected.completedQuantity||0)))} onClick={()=>void savePackageReview('CONFIRM',true)}>{reviewSaving?'正在处理…':reviewPhysical?'通过并登记完成':'确认通过资料'}</button></footer></SampleDialog>}
      {correctionTask && <SampleCorrectionDialog task={correctionTask} onClose={()=>setCorrectionTask(null)} onSaved={task=>{replaceTask(task);setCorrectionTask(null);setRefreshToken(v=>v+1);setMessage('更正已保存，记录保留修改原因与前后值');}}/>}

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
            <section className="sample-plan-section"><div className="sample-section-title"><strong>本次任务类型</strong></div><div className="sb-branch-switch">{(['NEW','REPEAT'] as const).map(kind => <button type="button" key={kind} aria-pressed={form.taskType === kind} className={form.taskType === kind ? 'active' : ''} onClick={() => setForm(current => ({ ...current, taskType: kind, dataPurpose: kind === 'REPEAT' ? 'PRODUCTION' : current.dataPurpose }))}>{kind === 'NEW' ? '新品试制' : '老产品制作'}</button>)}</div><p>{form.taskType === 'REPEAT' ? '复用图纸，双方审核后制作，完成转成品仓。' : '图纸审核、仓库配料、试制采集与整包审核。'}</p><label className="sb-plan-week-label">计划周<input type="date" value={form.planWeekStartDate} onChange={e => setForm(current => ({ ...current, planWeekStartDate: e.target.value }))}/><small>选择该周任一日期；留空进入待排期，出货日期单独保留。</small></label></section>

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
                <label><span>单套计划工时（分钟／套）</span><input type="number" min="0.001" max="1440" step="0.001" value={form.unitPlannedMinutes} onChange={event=>setForm(current=>({...current,unitPlannedMinutes:event.target.value}))} placeholder="未填写时标记工时待补"/><small>{Number(form.unitPlannedMinutes)>0&&Number(form.sampleQuantity)>0?`合计 ${sampleHours(Math.round(Number(form.unitPlannedMinutes)*60000)*Number(form.sampleQuantity))} 小时`:'计划工时，不作为实际报工'}</small></label><label><span>来源订单号</span><input value={form.sourceOrderNo} onChange={event=>setForm(current=>({...current,sourceOrderNo:event.target.value}))}/></label><label><span>订单行号（选填）</span><input value={form.sourceOrderLine} onChange={event=>setForm(current=>({...current,sourceOrderLine:event.target.value}))}/></label><label><span>计划下达日期</span><input type="date" value={form.issuedDate} onChange={event => setForm(current => ({ ...current, issuedDate: event.target.value }))} /></label>
                <label><span>提前预警天数</span><input type="number" min="0" max="30" value={form.warningDays} onChange={event => setForm(current => ({ ...current, warningDays: event.target.value }))} /></label>
                {editOpen && <label className="wide"><span>日期或预警调整原因</span><input value={form.scheduleReason} maxLength={500} onChange={event => setForm(current => ({ ...current, scheduleReason: event.target.value }))} placeholder="修改日期或预警时必填" /></label>}
                <label><span>计划完成日期（选填）</span><input type="date" value={form.plannedCompletionDate} onChange={event => setForm(current => ({ ...current, plannedCompletionDate: event.target.value }))} /></label>
                <label><span>客户交期</span><input type="date" value={form.dueDate} onChange={event => setForm(current => ({ ...current, dueDate: event.target.value }))} /></label>
              </div>
              {!editOpen && form.taskType !== 'REPEAT' && user.laborRole === 'ADMIN' && <label className="sample-data-purpose-field"><span>数据用途</span><select value={form.dataPurpose} onChange={event => setForm(current => ({ ...current, dataPurpose: event.target.value as PlanForm['dataPurpose'] }))}><option value="PRODUCTION">正式业务数据</option><option value="TEST">测试数据（可批量退役）</option><option value="TRAINING">培训数据</option></select><small>只有新建时可标记；正式数据不会被测试清理工具自动退役。</small></label>}
            </section>


            {editOpen && <p className="spr-help">数量变更会重新计算计划工时，并通知仓库重新确认配料；已记录的实际完成数量保留。</p>}{formError && <div className="sample-form-error"><AlertTriangle size={16} />{formError}</div>}
          </div>
          <footer><span>{form.taskType === 'REPEAT' ? '老产品只审核图纸资料。' : '新品采集内容仍全部选填。'}</span><div><button type="button" disabled={saving} onClick={() => { setCreateOpen(false); setEditOpen(false); }}>取消</button><button className="primary" type="button" disabled={saving} onClick={() => void savePlan()}>{saving ? <><Loader2 className="spin" size={15} />保存中</> : editOpen ? '保存计划' : '创建样品任务'}</button></div></footer>
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
                  {entry.kind === 'STRIPPING' && <label><span>正式参数处理</span><select value={entry.payload.publicationDecision === 'RECORD_ONLY' ? 'RECORD_ONLY' : 'APPEND'} onChange={event => updateReviewEntryPayload(entry.id, 'publicationDecision', event.target.value)}><option value="APPEND">新增；完全相同则复用</option><option value="RECORD_ONLY">仅保留样品审核记录，不进入参数库</option></select><small>相同参数自动复用；不同参数进入连接器参数待处理，不影响样品正常完成。</small></label>}
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


