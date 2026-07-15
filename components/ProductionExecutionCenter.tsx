'use client';

import { AlertTriangle, BarChart3, CalendarDays, ChevronRight, Copy, Download, Info, ListChecks, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { writeClipboardText } from '@/lib/client-platform';
import { getProductionAlerts, isDrawingConfirmationAlert, type ProductionAlert } from '@/lib/production-alerts';
import { formatProductionPercentage, formatProductionQuantity, getProductionQuantitySummary, type ProductionQuantitySummary } from '@/lib/production-quantity';
import type { CurrentUserDTO } from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type QuickFilter = 'overdue' | 'urgent' | 'drawing' | 'drawing_confirmation' | 'material' | 'documents' | 'tail_remaining' | 'completed' | 'due_today' | 'updated_today' | 'completed_today' | 'delivery_missing' | 'specification_invalid' | 'customer_missing';
type DetailTab = 'production' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_priority' | 'set_stage' | 'add_remark';
type DuePreset = '' | 'today' | 'tomorrow' | 'overdue' | 'week' | 'custom';
type ProductionFlowAction = 'confirm_drawing_issued' | 'transfer_to_backend' | 'complete_from_backend';

type ProductionStageSegment = {
  stage: StageKey;
  quantity: number | null;
};

type ProductionQuantityFlow = {
  valid: boolean;
  targetQty: number | null;
  frontendTransferredQty: number | null;
  completedQty: number | null;
  frontendRemainingQty: number | null;
  backendRemainingQty: number | null;
  executionVersion: number;
  legacy: boolean;
  materialized: boolean;
  segments: ProductionStageSegment[];
  error: { code: string; field: string; message: string } | null;
};

type ProductionOrder = {
  id: string;
  code: string;
  specification?: string | null;
  customerName?: string | null;
  productName: string;
  stage: StageKey;
  stageText: string;
  priority: string;
  plannedAt?: string | null;
  deliveryDay?: string | null;
  uncompletedQty?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  completedQty?: string | null;
  frontendTransferredQty?: number | null;
  executionVersion: number;
  quantityFlow: ProductionQuantityFlow;
  startedAt?: string | null;
  completedAt?: string | null;
  lastProgressAt?: string | null;
  latestProgressRemark?: string | null;
  lastProgressBy?: string | null;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  drawingLibraryItemId?: string | null;
  documentCompleteness: string;
  documentFilledCount: number;
  documentTotalCount: number;
  documentsComplete: boolean;
  documentCategoryCodes: string[];
  exceptionCodes: string[];
  exceptionLabels: string[];
  quantitySummary: ProductionQuantitySummary;
  productionAlerts: ProductionAlert[];
  processName?: string | null;
  orderDate?: string | null;
  salesperson?: string | null;
  customerLevel?: string | null;
  sourceOrderNo?: string | null;
  importBatchId?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo?: number | null;
  drawingIssuedAt?: string | null;
  drawingIssueNote?: string | null;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  remark?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  updatedAt: string;
};

type ProductionSummary = {
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  total: number;
  dueToday: number;
  overdue: number;
  notIssuedDrawing: number;
  materialNotReady: number;
  incompleteDocuments: number;
  drawingConfirmation: number;
  tailRemaining: number;
  urgent: number;
  completed: number;
  stageCounts: Record<StageKey, number>;
};

type BoardPayload = {
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  stageCounts: Record<StageKey, number>;
  items: ProductionOrder[];
  filterOptions: { customers: string[] };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type ProgressLog = {
  id: string;
  previousStage?: string | null;
  previousStageText?: string | null;
  stage: string;
  stageText: string;
  completedQty?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  remark?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

type AdvancedFilters = {
  customers: string[];
  duePreset: DuePreset;
  dueFrom: string;
  dueTo: string;
  stage: string;
  priority: string;
  drawing: string;
  material: string;
  documents: string;
};

type UpdateForm = {
  completedQty: string;
  remark: string;
};

type ExecutionPatchPayload = Partial<UpdateForm> & {
  stage?: StageKey;
  drawingStatus?: string;
};

type StageChangeRequest = {
  order: ProductionOrder;
  stage: StageKey;
};

type NextStepRequest = {
  order: ProductionOrder;
  displayStage: StageKey;
  action: ProductionFlowAction;
};

type ProductionCardView = {
  order: ProductionOrder;
  displayStage: StageKey;
  stageQuantity: number | null;
};

type ProductionExecutionViewState = {
  version: 1;
  createdAt: number;
  returnUrl: string;
  view: ViewKey;
  keyword: string;
  filters: AdvancedFilters;
  quick: QuickFilter[];
  weekStart: string;
  batchMode: boolean;
  selectedIds: string[];
  boardScrollLeft: number;
  columnScrollTops: Record<StageKey, number>;
};

type FilterChip = {
  key: string;
  label: string;
  remove: () => void;
};

const stages: Array<{ key: StageKey; label: string; step: string; hint: string }> = [
  { key: 'not_issued', label: '未发图', step: '01', hint: '等待图纸下发' },
  { key: 'frontend', label: '在前端', step: '02', hint: '前端工序进行中' },
  { key: 'backend', label: '在后端', step: '03', hint: '后端工序进行中' },
  { key: 'completed', label: '已完成', step: '04', hint: '生产完成归档' },
];

const drawingStatuses = ['未发', '已发', '待样品确认', '待客户确认', '图纸需变更', '已确认'] as const;

function stageMenuItems(order: ProductionOrder): Array<{ key: StageKey; label: string }> {
  const nextStage: Record<StageKey, StageKey> = {
    not_issued: 'frontend', frontend: 'backend', backend: 'completed', completed: 'backend',
  };
  const next = nextStage[order.stage];
  const ordered = [next, ...stages.map(item => item.key)].filter((key, index, values) => key !== order.stage && values.indexOf(key) === index);
  return ordered.map((key, index) => {
    const label = stages.find(item => item.key === key)?.label || key;
    if (index !== 0) return { key, label };
    return { key, label: order.stage === 'completed' ? `撤回到${label}` : `推进到${label}` };
  });
}

const quickByView: Record<ViewKey, Array<{ key: QuickFilter; label: string }>> = {
  board: [
    { key: 'due_today', label: '今日交期' }, { key: 'overdue', label: '已逾期' },
    { key: 'drawing_confirmation', label: '图纸待确认' }, { key: 'material', label: '配料异常' },
    { key: 'tail_remaining', label: '尾数未清' }, { key: 'completed', label: '已完成' },
  ],
  today: [
    { key: 'due_today', label: '今日交期' }, { key: 'overdue', label: '已逾期' },
    { key: 'updated_today', label: '今日更新' }, { key: 'completed_today', label: '今日完成' },
  ],
  exceptions: [
    { key: 'drawing_confirmation', label: '图纸待确认' }, { key: 'material', label: '配料异常' }, { key: 'tail_remaining', label: '尾数未清' },
    { key: 'documents', label: '资料不完整' },
    { key: 'delivery_missing', label: '交期缺失' }, { key: 'specification_invalid', label: '规格异常' }, { key: 'customer_missing', label: '客户缺失' },
  ],
};

const categoryLabels: Array<{ code: string; label: string }> = [
  { code: 'drawing', label: '原图' }, { code: 'sop', label: 'SOP指导书' }, { code: 'product', label: '成品图' },
  { code: 'material', label: '辅料规格' }, { code: 'notice', label: '注意事项' },
];

const emptyAdvanced: AdvancedFilters = {
  customers: [], duePreset: '', dueFrom: '', dueTo: '', stage: '', priority: '', drawing: '', material: '', documents: '',
};

const productionBoardCache = new Map<string, BoardPayload>();
const validQuickFilters = new Set<QuickFilter>([
  'overdue', 'urgent', 'drawing', 'material', 'documents', 'completed', 'due_today', 'updated_today', 'completed_today',
  'delivery_missing', 'specification_invalid', 'customer_missing', 'drawing_confirmation', 'tail_remaining',
]);

function cloneAdvanced(value: AdvancedFilters): AdvancedFilters {
  return { ...value, customers: [...value.customers] };
}

function dateText(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function priorityText(priority: string): string {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}

function deliveryText(order: ProductionOrder): string {
  return order.deliveryDay?.trim() || dateText(order.plannedAt);
}

function specText(order: ProductionOrder): string {
  return order.specification?.trim() || '规格待补充';
}

function cardSegments(order: ProductionOrder): ProductionStageSegment[] {
  if (order.quantityFlow.valid && order.quantityFlow.segments.length) return order.quantityFlow.segments;
  return [{ stage: order.stage, quantity: null }];
}

function primaryCardView(order: ProductionOrder): ProductionCardView {
  const segments = cardSegments(order);
  const segment = segments.find(item => item.stage === order.stage) || segments[0];
  return { order, displayStage: segment.stage, stageQuantity: segment.quantity };
}

function updateFormFor(order: ProductionOrder): UpdateForm {
  return { completedQty: order.completedQty || '', remark: '' };
}

function advancedFromParams(params: URLSearchParams): AdvancedFilters {
  const customers = params.getAll('customer').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  const duePreset = params.get('duePreset');
  return {
    customers: [...new Set(customers)],
    duePreset: duePreset === 'today' || duePreset === 'tomorrow' || duePreset === 'overdue' || duePreset === 'week' || duePreset === 'custom' ? duePreset : '',
    dueFrom: params.get('dueFrom') || '',
    dueTo: params.get('dueTo') || '',
    stage: params.get('stage') || '',
    priority: params.get('priority') || '',
    drawing: params.get('drawing') || '',
    material: params.get('material') || '',
    documents: params.get('documents') || '',
  };
}

function appendAdvancedParams(params: URLSearchParams, value: AdvancedFilters): void {
  value.customers.forEach(customer => params.append('customer', customer));
  if (value.duePreset) params.set('duePreset', value.duePreset);
  if (value.dueFrom) params.set('dueFrom', value.dueFrom);
  if (value.dueTo) params.set('dueTo', value.dueTo);
  if (value.stage) params.set('stage', value.stage);
  if (value.priority) params.set('priority', value.priority);
  if (value.drawing) params.set('drawing', value.drawing);
  if (value.material) params.set('material', value.material);
  if (value.documents) params.set('documents', value.documents);
}

function executionParams(view: ViewKey, keyword: string, quick: QuickFilter[], advanced: AdvancedFilters, weekStart: string, page = 1): URLSearchParams {
  const params = new URLSearchParams({ view, page: String(page), pageSize: '500' });
  if (keyword) params.set('keyword', keyword);
  if (quick.length) params.set('quick', quick.join(','));
  if (weekStart) params.set('weekStart', weekStart);
  appendAdvancedParams(params, advanced);
  return params;
}

function normalizedProductionUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    url.searchParams.delete('returnKey');
    return `${url.pathname}${url.search ? url.search : ''}`;
  } catch {
    return '';
  }
}

function replaceOrder(payload: BoardPayload | null, order: ProductionOrder): BoardPayload | null {
  if (!payload) return payload;
  const items = payload.items.map(item => item.id === order.id ? order : item);
  const stageCounts: Record<StageKey, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  items.forEach(item => cardSegments(item).forEach(segment => { stageCounts[segment.stage] += 1; }));
  return { ...payload, items, stageCounts };
}

function withProductionDerived(order: ProductionOrder): ProductionOrder {
  const quantitySummary = getProductionQuantitySummary(order);
  const productionAlerts = getProductionAlerts({
    ...order,
    specificationInvalid: order.exceptionCodes.includes('specification_invalid'),
  });
  return { ...order, quantitySummary, productionAlerts };
}

function optimisticOrder(order: ProductionOrder, value: UpdateForm): ProductionOrder {
  return withProductionDerived({
    ...order,
    completedQty: value.completedQty.trim() || order.completedQty,
    latestProgressRemark: value.remark.trim() || order.latestProgressRemark,
    lastProgressAt: new Date().toISOString(),
  });
}

export default function ProductionExecutionCenter({ user }: { user: CurrentUserDTO }) {
  const router = useRouter();
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [view, setView] = useState<ViewKey>('board');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [quick, setQuick] = useState<QuickFilter[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [weekStart, setWeekStart] = useState('');
  const [stateReady, setStateReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<ProductionOrder | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('production');
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [updateOrder, setUpdateOrder] = useState<ProductionOrder | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchOperation, setBatchOperation] = useState<BatchOperation>('set_priority');
  const [batchValue, setBatchValue] = useState('');
  const [batchRemark, setBatchRemark] = useState('');
  const [batchConfirm, setBatchConfirm] = useState('');
  const [statusMenuOrder, setStatusMenuOrder] = useState<ProductionOrder | null>(null);
  const [drawingMenuOrder, setDrawingMenuOrder] = useState<ProductionOrder | null>(null);
  const [stageChangeRequest, setStageChangeRequest] = useState<StageChangeRequest | null>(null);
  const [completionSuggestion, setCompletionSuggestion] = useState<ProductionOrder | null>(null);
  const [nextStepRequest, setNextStepRequest] = useState<NextStepRequest | null>(null);
  const [nextStepQuantity, setNextStepQuantity] = useState('');
  const [nextStepError, setNextStepError] = useState('');
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsCloseRef = useRef<HTMLButtonElement | null>(null);
  const insightsPanelRef = useRef<HTMLElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawingButtonRef = useRef<HTMLButtonElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Record<StageKey, HTMLDivElement | null>>({ not_issued: null, frontend: null, backend: null, completed: null });
  const pendingRestoreRef = useRef<ProductionExecutionViewState | null>(null);
  const returnKeyRef = useRef('');
  const requestRef = useRef(0);
  const boardRef = useRef<BoardPayload | null>(null);
  const keywordReadyRef = useRef(false);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date()), []);

  useEffect(() => { boardRef.current = board; }, [board]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsedView = params.get('view');
    const parsedQuick = (params.get('quick') || '').split(',').filter(value => validQuickFilters.has(value as QuickFilter)) as QuickFilter[];
    setView(parsedView === 'today' || parsedView === 'exceptions' ? parsedView : 'board');
    setKeyword(params.get('keyword') || '');
    setDebouncedKeyword((params.get('keyword') || '').trim());
    setQuick(parsedQuick);
    setAdvanced(advancedFromParams(params));
    setWeekStart(params.get('weekStart') || '');
    setPage(Math.max(1, Number(params.get('page')) || 1));
    let returnKey = params.get('returnKey') || sessionStorage.getItem('production-execution:pending-return') || '';
    if (!returnKey) {
      const currentUrl = normalizedProductionUrl(window.location.href);
      let latest: { key: string; saved: ProductionExecutionViewState } | null = null;
      for (const key of Object.keys(sessionStorage).filter(item => item.startsWith('production-execution:return:'))) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) || '{}') as ProductionExecutionViewState;
          if (saved.version !== 1 || Date.now() - saved.createdAt >= 30 * 60 * 1000) {
            sessionStorage.removeItem(key);
            continue;
          }
          if (normalizedProductionUrl(saved.returnUrl) === currentUrl && (!latest || saved.createdAt > latest.saved.createdAt)) latest = { key, saved };
        } catch {
          sessionStorage.removeItem(key);
        }
      }
      if (latest) returnKey = latest.key.replace('production-execution:return:', '');
    }
    returnKeyRef.current = returnKey;
    if (returnKey) {
      try {
        const raw = sessionStorage.getItem(`production-execution:return:${returnKey}`);
        const saved = raw ? JSON.parse(raw) as ProductionExecutionViewState : null;
        if (saved?.version === 1 && Date.now() - saved.createdAt < 30 * 60 * 1000 && saved.returnUrl.startsWith('/production') && normalizedProductionUrl(saved.returnUrl) === normalizedProductionUrl(window.location.href)) pendingRestoreRef.current = saved;
        else {
          sessionStorage.removeItem(`production-execution:return:${returnKey}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
        }
      } catch {
        sessionStorage.removeItem(`production-execution:return:${returnKey}`);
        if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
      }
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return undefined;
    if (!keywordReadyRef.current) {
      keywordReadyRef.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, stateReady]);

  useEffect(() => {
    if (!stateReady) return;
    const params = executionParams(view, debouncedKeyword, quick, advanced, weekStart, page);
    if (returnKeyRef.current) params.set('returnKey', returnKeyRef.current);
    window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
  }, [advanced, debouncedKeyword, page, quick, stateReady, view, weekStart]);

  useEffect(() => {
    if (!stateReady) return undefined;
    let active = true;
    const params = new URLSearchParams();
    if (weekStart) params.set('weekStart', weekStart);
    fetch(`/api/dashboard/production-summary?${params.toString()}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产摘要加载失败');
        return body.data as ProductionSummary;
      })
      .then(data => {
        if (!active) return;
        setSummary(data);
        setWeekStart(current => current || data.weekStartDate || '');
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '生产摘要加载失败'); });
    return () => { active = false; };
  }, [refreshToken, stateReady, summaryRefreshToken, weekStart]);

  useEffect(() => {
    if (!stateReady) return undefined;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    const params = executionParams(view, debouncedKeyword, quick, advanced, weekStart, page);
    const cacheKey = params.toString();
    const cached = productionBoardCache.get(cacheKey);
    if (cached) {
      setBoard(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    fetch(`/api/work-orders/execution?${cacheKey}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产看板加载失败');
        return body.data as BoardPayload;
      })
      .then(data => {
        if (requestId !== requestRef.current) return;
        productionBoardCache.set(cacheKey, data);
        if (productionBoardCache.size > 8) productionBoardCache.delete(productionBoardCache.keys().next().value || '');
        setBoard(data);
        setSelected(current => current.filter(id => data.items.some(item => item.id === id)));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '生产看板加载失败');
      })
      .finally(() => { if (requestId === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [advanced, debouncedKeyword, page, quick, refreshToken, stateReady, view, weekStart]);

  useEffect(() => {
    if (loading || !board || !pendingRestoreRef.current) return;
    const saved = pendingRestoreRef.current;
    let cancelled = false;
    let timer = 0;
    let attempt = 0;
    const restore = (): void => {
      if (cancelled) return;
      attempt += 1;
      if (boardShellRef.current) boardShellRef.current.scrollLeft = saved.boardScrollLeft;
      stages.forEach(stage => {
        const column = columnRefs.current[stage.key];
        if (column) column.scrollTop = saved.columnScrollTops[stage.key] || 0;
      });
      window.requestAnimationFrame(() => {
        const shell = boardShellRef.current;
        const expectedLeft = shell ? Math.min(saved.boardScrollLeft, Math.max(0, shell.scrollWidth - shell.clientWidth)) : 0;
        const columnsMatch = stages.every(stage => {
          const column = columnRefs.current[stage.key];
          if (!column) return false;
          const expected = Math.min(saved.columnScrollTops[stage.key] || 0, Math.max(0, column.scrollHeight - column.clientHeight));
          return Math.abs(column.scrollTop - expected) <= 1;
        });
        if (shell && Math.abs(shell.scrollLeft - expectedLeft) <= 1 && columnsMatch) {
          sessionStorage.removeItem(`production-execution:return:${returnKeyRef.current}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKeyRef.current) sessionStorage.removeItem('production-execution:pending-return');
          pendingRestoreRef.current = null;
          returnKeyRef.current = '';
          const params = executionParams(view, debouncedKeyword, quick, advanced, weekStart, page);
          window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
        } else if (attempt < 8) {
          timer = window.setTimeout(restore, 100);
        }
      });
    };
    timer = window.setTimeout(restore, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [advanced, board, debouncedKeyword, loading, page, quick, view, weekStart]);

  useEffect(() => {
    document.body.classList.toggle('hongmeng-webview', Boolean(window.__HONGMENG_WEBVIEW__));
    return () => document.body.classList.remove('hongmeng-webview');
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem('production-execution:completed-collapsed');
    setCompletedCollapsed(window.innerWidth >= 1280 && saved === '1');
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!insightsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const overlayMode = !window.matchMedia('(min-width: 1600px)').matches;
    if (overlayMode) document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => insightsCloseRef.current?.focus(), 60);
    const handleInsightKeys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setInsightsOpen(false);
        window.requestAnimationFrame(() => insightsButtonRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab' || !overlayMode) return;
      const panel = insightsPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !panel.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleInsightKeys);
    return () => {
      window.clearTimeout(focusTimer);
      if (overlayMode) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleInsightKeys);
    };
  }, [insightsOpen]);

  const grouped = useMemo(() => {
    const result: Record<StageKey, ProductionCardView[]> = { not_issued: [], frontend: [], backend: [], completed: [] };
    for (const item of board?.items || []) {
      cardSegments(item).forEach(segment => result[segment.stage].push({
        order: item,
        displayStage: segment.stage,
        stageQuantity: segment.quantity,
      }));
    }
    return result;
  }, [board]);

  const filterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    advanced.customers.forEach(customer => chips.push({
      key: `customer-${customer}`, label: `客户：${customer}`,
      remove: () => setAdvanced(current => ({ ...current, customers: current.customers.filter(item => item !== customer) })),
    }));
    const add = (key: keyof Omit<AdvancedFilters, 'customers'>, prefix: string, labels?: Record<string, string>): void => {
      const value = advanced[key];
      if (!value) return;
      chips.push({ key, label: `${prefix}：${labels?.[value] || value}`, remove: () => setAdvanced(current => ({ ...current, [key]: '' })) });
    };
    add('duePreset', '交期', { today: '今日', tomorrow: '明日', overdue: '已逾期', week: '本周', custom: '自定义' });
    add('dueFrom', '交期起'); add('dueTo', '交期止');
    add('stage', '状态', { not_issued: '未发图', frontend: '在前端', backend: '在后端', completed: '已完成' });
    add('priority', '优先级', { urgent: '紧急', high: '高', normal: '一般' });
    add('drawing', '图纸', {
      issued: '已发', not_issued: '未发', sample_confirmation: '待样品确认', customer_confirmation: '待客户确认',
      change_required: '图纸需变更', confirmed: '已确认', unset: '未设置',
    });
    add('material', '配料', { allocated: '已配料', ready: '料齐', not_ready: '未齐', unset: '未设置' });
    add('documents', '资料', { empty: '0/5', partial: '1-4/5', complete: '5/5' });
    return chips;
  }, [advanced]);

  const activeFilterCount = filterChips.length;

  const insightOrders = useMemo(() => (board?.items || [])
    .filter(item => item.stage !== 'completed' && item.productionAlerts.length > 0)
    .sort((left, right) => {
      const leftCritical = left.productionAlerts.some(alert => alert.tone === 'red') ? 1 : 0;
      const rightCritical = right.productionAlerts.some(alert => alert.tone === 'red') ? 1 : 0;
      return rightCritical - leftCritical || right.productionAlerts.length - left.productionAlerts.length;
    })
    .slice(0, 5), [board]);

  const stageTotal = useMemo(() => stages.reduce((total, stage) => total + (summary?.stageCounts[stage.key] || 0), 0), [summary]);

  function changeView(next: ViewKey): void {
    setView(next);
    setQuick([]);
    setPage(1);
    setSelected([]);
  }

  function toggleQuick(key: QuickFilter): void {
    setQuick(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
    setPage(1);
  }

  function selectStage(stage: StageKey): void {
    setView('board');
    setAdvanced(current => ({ ...current, stage: current.stage === stage ? '' : stage }));
    setPage(1);
  }

  function closeInsights(): void {
    setInsightsOpen(false);
    window.requestAnimationFrame(() => insightsButtonRef.current?.focus());
  }

  function toggleSummary(key: 'all' | 'due_today' | 'overdue' | 'drawing_confirmation' | 'material' | 'tail_remaining' | 'urgent' | 'completed'): void {
    if (key === 'all') {
      setKeyword(''); setQuick([]); setAdvanced(emptyAdvanced); setView('board'); setPage(1);
      return;
    }
    if (key === 'due_today') {
      setAdvanced(current => ({ ...current, duePreset: current.duePreset === 'today' ? '' : 'today', dueFrom: '', dueTo: '' }));
      setQuick(current => current.filter(item => item !== 'due_today'));
      return;
    }
    toggleQuick(key);
  }

  function summaryActive(key: string): boolean {
    if (key === 'all') return !debouncedKeyword && !quick.length && !activeFilterCount;
    if (key === 'due_today') return advanced.duePreset === 'today';
    return quick.includes(key as QuickFilter);
  }

  function toggleSelected(id: string): void {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleBatchMode(): void {
    setBatchMode(current => {
      if (current) setSelected([]);
      return !current;
    });
  }

  function openUpdate(order: ProductionOrder): void {
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    setUpdateOrder(order);
    setUpdateForm(updateFormFor(order));
    setFormError('');
  }

  function applyLocalOrder(order: ProductionOrder): void {
    setBoard(current => replaceOrder(current, order));
    setDetailOrder(current => current?.id === order.id ? order : current);
  }

  async function requestExecutionPatch(orderId: string, payload: ExecutionPatchPayload, fallbackError: string): Promise<ProductionOrder> {
    const response = await fetch(`/api/work-orders/${orderId}/execution`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.data) throw new Error(body.error || fallbackError);
    return withProductionDerived(body.data as ProductionOrder);
  }

  async function saveUpdate(): Promise<void> {
    if (!updateOrder || !updateForm) return;
    const previousBoard = board;
    const previousDetail = detailOrder;
    const payload: ExecutionPatchPayload = updateOrder.quantityFlow.materialized
      ? { remark: updateForm.remark }
      : updateForm;
    const optimistic = optimisticOrder(updateOrder, updateOrder.quantityFlow.materialized
      ? { completedQty: updateOrder.completedQty || '', remark: updateForm.remark }
      : updateForm);
    setBoard(current => replaceOrder(current, optimistic));
    if (detailOrder?.id === updateOrder.id) setDetailOrder(optimistic);
    setSaving(true);
    setFormError('');
    try {
      const updated = await requestExecutionPatch(updateOrder.id, payload, '进度更新失败');
      applyLocalOrder(updated);
      setUpdateOrder(null);
      setUpdateForm(null);
      setToast('生产进度已更新');
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      if (updated.stage !== 'completed' && (updated.quantitySummary.status === 'complete' || updated.quantitySummary.status === 'overrun')) {
        setCompletionSuggestion(updated);
      }
    } catch (reason) {
      setBoard(previousBoard);
      setDetailOrder(previousDetail);
      setFormError(reason instanceof Error ? reason.message : '进度更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveQuickUpdate(order: ProductionOrder, payload: ExecutionPatchPayload, optimistic: ProductionOrder, successMessage: string): Promise<ProductionOrder | null> {
    const previousBoard = boardRef.current;
    const previousDetail = detailOrder;
    applyLocalOrder(optimistic);
    setSaving(true);
    try {
      const updated = await requestExecutionPatch(order.id, payload, successMessage);
      applyLocalOrder(updated);
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast(successMessage);
      return updated;
    } catch (reason) {
      setBoard(previousBoard);
      setDetailOrder(previousDetail);
      setToast(reason instanceof Error ? reason.message : `${successMessage}失败`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveStageChange(order: ProductionOrder, stage: StageKey): Promise<void> {
    setStatusMenuOrder(null);
    setStageChangeRequest(null);
    setCompletionSuggestion(null);
    if (order.stage === stage) return;
    const optimistic = withProductionDerived({
      ...order,
      stage,
      stageText: stages.find(item => item.key === stage)?.label || order.stageText,
      completedAt: stage === 'completed' ? new Date().toISOString() : null,
    });
    await saveQuickUpdate(order, { stage }, optimistic, stage === 'completed' ? '工单已标记完成' : '生产状态已更新');
  }

  function requestStageChange(order: ProductionOrder, stage: StageKey): void {
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    if (stage === order.stage) return;
    if (stage === 'completed') {
      setStageChangeRequest({ order, stage });
      return;
    }
    void saveStageChange(order, stage);
  }

  async function saveDrawingStatus(order: ProductionOrder, drawingStatus: string): Promise<void> {
    setDrawingMenuOrder(null);
    if (order.drawingStatus === drawingStatus) return;
    const optimistic = withProductionDerived({ ...order, drawingStatus });
    await saveQuickUpdate(order, { drawingStatus }, optimistic, `图纸状态已更新为${drawingStatus}`);
  }

  function openNextStep(order: ProductionOrder, displayStage: StageKey): void {
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    if (!order.quantityFlow.valid) {
      setToast(order.quantityFlow.error?.message || '工单数量数据不完整，暂时无法流转');
      return;
    }
    if (displayStage === 'completed') return;
    const action: ProductionFlowAction = displayStage === 'not_issued'
      ? 'confirm_drawing_issued'
      : displayStage === 'frontend'
        ? 'transfer_to_backend'
        : 'complete_from_backend';
    const defaultQuantity = displayStage === 'frontend'
      ? order.quantityFlow.frontendRemainingQty
      : displayStage === 'backend'
        ? order.quantityFlow.backendRemainingQty
        : null;
    setNextStepRequest({ order, displayStage, action });
    setNextStepQuantity(defaultQuantity && defaultQuantity > 0 ? String(defaultQuantity) : '');
    setNextStepError('');
  }

  async function saveNextStep(): Promise<void> {
    if (!nextStepRequest) return;
    const { order, action, displayStage } = nextStepRequest;
    if (action !== 'confirm_drawing_issued') {
      if (!/^[1-9]\d*$/.test(nextStepQuantity.trim())) {
        setNextStepError('本次数量必须是正整数');
        return;
      }
      const quantity = Number(nextStepQuantity);
      const maximum = displayStage === 'frontend'
        ? order.quantityFlow.frontendRemainingQty
        : order.quantityFlow.backendRemainingQty;
      if (maximum === null || quantity > maximum) {
        setNextStepError(`本次数量不能超过当前可流转数量 ${formatProductionQuantity(maximum)}`);
        return;
      }
    }

    setSaving(true);
    setNextStepError('');
    try {
      const response = await fetch(`/api/work-orders/${order.id}/execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          quantity: action === 'confirm_drawing_issued' ? undefined : nextStepQuantity.trim(),
          expectedVersion: order.quantityFlow.executionVersion,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '生产数量流转失败');
      const updated = withProductionDerived(body.data as ProductionOrder);
      applyLocalOrder(updated);
      setNextStepRequest(null);
      setNextStepQuantity('');
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast(action === 'confirm_drawing_issued'
        ? '图纸已确认下发，工单已进入前端'
        : action === 'transfer_to_backend'
          ? '前端数量已转入后端'
          : '后端完成数量已更新');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '生产数量流转失败';
      if (message === '工单进度已被其他操作更新，请刷新后重试') {
        setNextStepRequest(null);
        setToast(message);
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
        setSummaryRefreshToken(value => value + 1);
      } else {
        setNextStepError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleCompletedColumn(): void {
    setCompletedCollapsed(current => {
      const next = !current;
      sessionStorage.setItem('production-execution:completed-collapsed', next ? '1' : '0');
      return next;
    });
  }

  async function loadProgress(orderId: string): Promise<void> {
    setProgressLoading(true);
    try {
      const response = await fetch(`/api/work-orders/${orderId}/progress-logs?pageSize=50`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '进度记录加载失败');
      setProgressLogs(Array.isArray(body.data?.items) ? body.data.items : []);
    } catch (reason) {
      setProgressLogs([]);
      setToast(reason instanceof Error ? reason.message : '进度记录加载失败');
    } finally {
      setProgressLoading(false);
    }
  }

  function openDetail(order: ProductionOrder): void {
    setDetailOrder(order);
    setDetailTab('production');
    setProgressLogs([]);
  }

  function switchDetailTab(tab: DetailTab): void {
    setDetailTab(tab);
    if (tab === 'progress' && detailOrder) void loadProgress(detailOrder.id);
  }

  function captureReturnState(returnKey: string): string {
    const params = executionParams(view, debouncedKeyword, quick, advanced, weekStart, page);
    params.set('returnKey', returnKey);
    const returnUrl = `/production?${params.toString()}`;
    const state: ProductionExecutionViewState = {
      version: 1,
      createdAt: Date.now(),
      returnUrl,
      view,
      keyword: debouncedKeyword,
      filters: cloneAdvanced(advanced),
      quick: [...quick],
      weekStart,
      batchMode,
      selectedIds: [...selected],
      boardScrollLeft: boardShellRef.current?.scrollLeft || 0,
      columnScrollTops: {
        not_issued: columnRefs.current.not_issued?.scrollTop || 0,
        frontend: columnRefs.current.frontend?.scrollTop || 0,
        backend: columnRefs.current.backend?.scrollTop || 0,
        completed: columnRefs.current.completed?.scrollTop || 0,
      },
    };
    sessionStorage.setItem(`production-execution:return:${returnKey}`, JSON.stringify(state));
    sessionStorage.setItem('production-execution:pending-return', returnKey);
    window.history.replaceState(window.history.state, '', returnUrl);
    return returnUrl;
  }

  function openWorkOrderResources(order: ProductionOrder): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    captureReturnState(returnKey);
    const params = new URLSearchParams({ workOrderId: order.id, categoryCode: 'drawing', from: 'production', returnKey });
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  }

  function openDrawingLibrary(order: ProductionOrder): void {
    const params = new URLSearchParams();
    if (order.drawingLibraryItemId) params.set('itemId', order.drawingLibraryItemId);
    else {
      params.set('create', '1');
      params.set('customerName', order.customerName || '');
      params.set('specification', order.specification || '');
      params.set('productName', order.productName || '');
    }
    router.push(`/drawing-library?${params.toString()}`);
  }

  function openBatch(operation: BatchOperation): void {
    setBatchOperation(operation); setBatchValue(''); setBatchRemark(''); setBatchConfirm(''); setFormError(''); setBatchOpen(true);
  }

  async function saveBatch(): Promise<void> {
    if (!selected.length) return;
    setSaving(true);
    setFormError('');
    const confirmText = batchOperation === 'set_stage' && batchValue !== 'completed' ? 'CONFIRM' : batchConfirm;
    try {
      const response = await fetch('/api/work-orders/batch-execution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, operation: batchOperation, value: batchValue, remark: batchRemark, confirmText }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '批量更新失败');
      setBatchOpen(false); setSelected([]); setBatchMode(false);
      setToast(`已更新 ${body.data?.updated || 0} 个工单`);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '批量更新失败');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv(): void {
    const params = executionParams(view, debouncedKeyword, quick, advanced, weekStart, 1);
    params.delete('page'); params.delete('pageSize');
    location.href = `/api/export/production-execution.csv?${params.toString()}`;
  }

  async function copySpecification(order: ProductionOrder): Promise<void> {
    const specification = order.specification?.trim() || order.code.trim();
    if (!specification) {
      setToast('暂无可复制的规格');
      return;
    }
    try {
      await writeClipboardText(specification);
      setToast(order.specification?.trim() ? '已复制完整规格' : '规格未设置，已复制内部编号');
    } catch {
      setToast('复制失败，请手动选择规格复制');
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const cardProps = {
    batchMode, selected, toggleSelected, openDetail, openUpdate, openNextStep, saving,
    openResources: openWorkOrderResources, copySpecification,
    openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, item: ProductionOrder): void => {
      if (item.quantityFlow.materialized) {
        setToast('该工单已启用分批数量流转，请使用“下一步”更新生产数量');
        return;
      }
      statusButtonRef.current = event.currentTarget;
      setDrawingMenuOrder(null);
      setStatusMenuOrder(item);
    },
    openDrawingStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, item: ProductionOrder): void => {
      drawingButtonRef.current = event.currentTarget;
      setStatusMenuOrder(null);
      setDrawingMenuOrder(item);
    },
  };
  const weeklyPlanWeekStart = weekStart || summary?.weekStartDate || '';
  const weeklyPlanHref = weeklyPlanWeekStart ? `/weekly-plan-center?currentWeekStart=${encodeURIComponent(weeklyPlanWeekStart)}` : '/weekly-plan-center';

  return (
    <main className="production-page hm-production-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/production"
        subtitle="现场生产工作台"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />

      <div className="production-execution-main">
        <WorkbenchPageHeader
          kicker="生产执行"
          title="生产执行中心"
          description={`${todayLabel} · 本周任务、异常与进度闭环`}
          titleId="production-page-title"
          actionsClassName="production-page-actions"
          actions={<><button ref={insightsButtonRef} className={`hm-workbench-button production-insight-trigger ${insightsOpen ? 'active' : ''}`.trim()} type="button" aria-expanded={insightsOpen} aria-controls="production-insight-panel" onClick={() => setInsightsOpen(value => !value)}><BarChart3 size={15} aria-hidden="true" />生产概览</button><a className="hm-workbench-button" href={weeklyPlanHref}><CalendarDays size={15} aria-hidden="true" />周计划</a><button className={`hm-workbench-button ${batchMode ? 'active' : ''}`.trim()} type="button" onClick={toggleBatchMode}><ListChecks size={15} aria-hidden="true" />{batchMode ? '退出批量' : '批量操作'}</button><button className="hm-workbench-button" type="button" onClick={exportCsv}><Download size={15} aria-hidden="true" />导出</button></>}
        />

        <section className="production-summary production-command-strip" aria-label="当前周生产摘要">
          <button className={`production-week-label production-command-total ${summaryActive('all') ? 'active' : ''}`} type="button" onClick={() => toggleSummary('all')}>
            <span>{summary?.weekStartDate ? '当前执行周' : '周计划尚未启用'}</span><strong>{summary?.weekStartDate ? `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}` : '前往周计划中心启用'}</strong><em>{summary?.total ?? 0}<small>工单</small></em>
          </button>
          {stages.map(stage => <button className={`production-command-stage ${stage.key} ${advanced.stage === stage.key ? 'active' : ''}`} type="button" key={stage.key} aria-pressed={advanced.stage === stage.key} onClick={() => selectStage(stage.key)}><span>{stage.label}</span><strong>{summary?.stageCounts[stage.key] ?? 0}</strong><small>{stage.hint}</small></button>)}
          <button className={`production-command-alert ${summaryActive('urgent') || summaryActive('overdue') ? 'active' : ''}`} type="button" onClick={() => { setView('exceptions'); setQuick([]); setPage(1); }}><span>异常 / 紧急</span><strong>{summary?.urgent ?? 0}</strong><small>逾期 {summary?.overdue ?? 0} · 待快速处理</small></button>
        </section>

        <section className="production-controls" aria-label="生产任务筛选">
          <div className="production-toolbar">
            <div className="production-view-tabs" aria-label="任务视图">
              <button className={view === 'board' ? 'active' : ''} type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}>生产看板</button>
              <button className={view === 'today' ? 'active' : ''} type="button" aria-pressed={view === 'today'} onClick={() => changeView('today')}>今日任务</button>
              <button className={view === 'exceptions' ? 'active' : ''} type="button" aria-pressed={view === 'exceptions'} onClick={() => changeView('exceptions')}>异常任务</button>
            </div>
            <label className="production-search"><Search aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名 / 订单号" /></label>
            <button ref={filterButtonRef} className={filtersOpen || activeFilterCount ? 'active' : ''} type="button" aria-expanded={filtersOpen} onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>高级筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
            <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu hm-production-menu hm-production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
              <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
            </PortalMenu>
            <span className="production-result-count">筛选结果 <b>{board?.pagination.total || 0}</b> / 全周 {summary?.total || 0}</span>
          </div>
          <div className="production-quick-filters" aria-label="快捷筛选">
            <span className="production-quick-filter-label">快捷筛选</span>
            <button className={!quick.length ? 'active' : ''} type="button" aria-pressed={!quick.length} onClick={() => { setQuick([]); setPage(1); }}>全部</button>
            {quickByView[view].map(item => <button className={quick.includes(item.key) ? 'active' : ''} key={item.key} type="button" aria-pressed={quick.includes(item.key)} onClick={() => toggleQuick(item.key)}>{item.label}</button>)}
          </div>
          {!!filterChips.length && <div className="production-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}
        </section>

        {error && <div className="production-error"><span><strong>加载失败</strong>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}
        {!summary?.weekStartDate && !loading && <div className="production-empty-week"><strong>当前暂无启用生产周</strong><span>请前往周计划中心审核并启用生产计划。</span><a href={weeklyPlanHref}>进入周计划中心</a></div>}

        <div className="production-workspace">
          <div className="production-workspace-primary">
            {view === 'board' ? (
              <div ref={boardShellRef} className="production-board-shell hm-scroll-region" tabIndex={0} aria-label="四状态生产看板">
                <div className={`production-board ${completedCollapsed ? 'completed-collapsed' : ''}`}>
                  {stages.map(column => (
                    <section className={`production-column ${column.key} ${column.key === 'completed' && completedCollapsed ? 'collapsed' : ''}`} key={column.key}>
                      <header className="production-stage-header">
                        {column.key === 'completed'
                          ? <button type="button" aria-expanded={!completedCollapsed} onClick={toggleCompletedColumn}><span className="production-stage-step">{column.step}</span><span className="production-stage-copy"><strong>{column.label}</strong><small>{column.hint}</small></span><span className="production-stage-count">{board?.stageCounts[column.key] || 0}</span><em>{completedCollapsed ? '展开' : '收起'}</em></button>
                          : <><span className="production-stage-step">{column.step}</span><span className="production-stage-copy"><strong>{column.label}</strong><small>{column.hint}</small></span><span className="production-stage-count">{board?.stageCounts[column.key] || 0}</span></>}
                      </header>
                      {!completedCollapsed || column.key !== 'completed' ? <div ref={element => { columnRefs.current[column.key] = element; }} className="production-column-list hm-scroll-region" tabIndex={0} aria-label={`${column.label}工单列表，共 ${grouped[column.key].length} 项`}>
                        {grouped[column.key].map(item => <ProductionCard key={`${item.order.id}:${item.displayStage}`} order={item.order} displayStage={item.displayStage} stageQuantity={item.stageQuantity} {...cardProps} />)}
                        {loading && !grouped[column.key].length && <CardSkeleton count={3} />}
                        {!loading && !grouped[column.key].length && <div className="production-column-empty">当前状态暂无工单</div>}
                      </div> : <div ref={element => { columnRefs.current[column.key] = element; }} className="production-completed-collapsed-hint"><span>{board?.stageCounts.completed || 0}</span><small>已完成</small></div>}
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <section className="production-task-view">
                <div className="production-task-heading"><div><strong>{view === 'today' ? '今日任务' : '异常任务'}</strong><span>{view === 'today' ? '今日交期、逾期与今日进展' : '聚合资料与基础字段异常，不自动修改数据'}</span></div><em>{board?.pagination.total || 0} 项</em></div>
                <div className="production-task-grid hm-scroll-region" tabIndex={0} aria-label={`${view === 'today' ? '今日任务' : '异常任务'}列表`}>
                  {board?.items.map(order => {
                    const item = primaryCardView(order);
                    return <ProductionCard key={order.id} order={order} displayStage={item.displayStage} stageQuantity={item.stageQuantity} {...cardProps} showExceptions={view === 'exceptions'} />;
                  })}
                  {loading && <CardSkeleton count={8} />}
                  {!loading && !board?.items.length && <div className="production-task-empty">当前没有匹配任务</div>}
                </div>
              </section>
            )}

            {board && board.pagination.totalPages > 1 && <div className="production-pagination"><span>共 {board.pagination.total} 单</span><button type="button" disabled={board.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{board.pagination.page} / {board.pagination.totalPages}</b><button type="button" disabled={board.pagination.page >= board.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
          </div>

          {insightsOpen && <button className="production-insight-scrim open" type="button" aria-label="关闭生产概览" onClick={closeInsights} />}
          {insightsOpen && <aside ref={insightsPanelRef} id="production-insight-panel" className="production-insight-panel open" aria-label="生产概览" role="dialog" aria-modal="true" tabIndex={-1}>
            <header><div><span>本周概览</span><strong>生产执行分布</strong></div><button ref={insightsCloseRef} type="button" aria-label="关闭生产概览" title="关闭生产概览" onClick={closeInsights}><X size={18} aria-hidden="true" /></button></header>
            <section className="production-insight-section" aria-label="阶段分布">
              <div className="production-insight-section-title"><strong>阶段分布</strong><span>{stageTotal} 单</span></div>
              <div className="production-insight-stages">{stages.map(stage => {
                const count = summary?.stageCounts[stage.key] || 0;
                const percentage = stageTotal ? Math.round((count / stageTotal) * 100) : 0;
                return <button type="button" key={stage.key} className={stage.key} onClick={() => { selectStage(stage.key); closeInsights(); }}><span><b>{stage.label}</b><em>{count} 单 · {percentage}%</em></span><i><span style={{ width: `${percentage}%` }} /></i></button>;
              })}</div>
            </section>
            <section className="production-insight-section production-insight-exceptions" aria-label="异常关注">
              <div className="production-insight-section-title"><strong><AlertTriangle size={15} aria-hidden="true" />异常关注</strong><button type="button" onClick={() => { changeView('exceptions'); closeInsights(); }}>查看全部</button></div>
              <div className="production-insight-order-list">{insightOrders.map(order => <button type="button" key={order.id} onClick={() => { closeInsights(); openDetail(order); }}><span><strong title={order.specification || order.code}>{order.specification || order.code}</strong><small>{order.customerName || '客户未设置'}</small></span><em>{order.productionAlerts[0]?.label || '待处理'}</em></button>)}{!insightOrders.length && <p>当前筛选范围内暂无异常工单</p>}</div>
            </section>
            <section className="production-insight-section production-insight-quick" aria-label="快捷入口">
              <div className="production-insight-section-title"><strong>快捷入口</strong></div>
              <a href={weeklyPlanHref}>查看周计划<ChevronRight aria-hidden="true" /></a>
              <a href="/dashboard">进入工单资料库<ChevronRight aria-hidden="true" /></a>
              <button type="button" onClick={() => { closeInsights(); toggleBatchMode(); }}>{batchMode ? '退出批量操作' : '开始批量操作'}<ChevronRight aria-hidden="true" /></button>
            </section>
          </aside>}
        </div>
      </div>

      {batchMode && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong><button type="button" disabled={!selected.length} onClick={() => openBatch('set_priority')}>设置优先级</button><button type="button" disabled={!selected.length} onClick={() => openBatch('set_stage')}>修改状态</button><button type="button" disabled={!selected.length} onClick={() => openBatch('add_remark')}>添加进度备注</button><button type="button" onClick={() => setSelected([])}>清空选择</button><button type="button" onClick={toggleBatchMode}>退出批量</button></div>}

      <PortalMenu open={!!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={164} onClose={() => setStatusMenuOrder(null)} closeOnSelect={false}>
        {statusMenuOrder && stageMenuItems(statusMenuOrder).map(stage => <button type="button" disabled={saving} key={stage.key} onClick={() => requestStageChange(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      <PortalMenu open={!!drawingMenuOrder} anchorRef={drawingButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={184} onClose={() => setDrawingMenuOrder(null)} closeOnSelect={false}>
        {drawingMenuOrder && drawingStatuses.map(status => <button className={drawingMenuOrder.drawingStatus === status ? 'active' : ''} type="button" disabled={saving} key={status} onClick={() => void saveDrawingStatus(drawingMenuOrder, status)}>{status}</button>)}
      </PortalMenu>

      {updateOrder && updateForm && <UpdateDrawer order={updateOrder} value={updateForm} setValue={setUpdateForm} saving={saving} error={formError} close={() => { if (!saving) { setUpdateOrder(null); setUpdateForm(null); } }} save={saveUpdate} />}
      {detailOrder && <DetailDialog order={detailOrder} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} update={() => openUpdate(detailOrder)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder)} />}
      {batchOpen && <BatchDialog count={selected.length} operation={batchOperation} value={batchValue} remark={batchRemark} confirm={batchConfirm} saving={saving} error={formError} setValue={setBatchValue} setRemark={setBatchRemark} setConfirm={setBatchConfirm} close={() => { if (!saving) setBatchOpen(false); }} save={saveBatch} />}
      {stageChangeRequest && <StageChangeDialog request={stageChangeRequest} saving={saving} close={() => { if (!saving) setStageChangeRequest(null); }} confirm={() => void saveStageChange(stageChangeRequest.order, stageChangeRequest.stage)} />}
      {completionSuggestion && <CompletionSuggestionDialog order={completionSuggestion} saving={saving} close={() => setCompletionSuggestion(null)} confirm={() => void saveStageChange(completionSuggestion, 'completed')} />}
      {nextStepRequest && <NextStepDialog request={nextStepRequest} quantity={nextStepQuantity} setQuantity={setNextStepQuantity} saving={saving} error={nextStepError} close={() => { if (!saving) { setNextStepRequest(null); setNextStepQuantity(''); setNextStepError(''); } }} confirm={() => void saveNextStep()} />}
      {toast && <div className="production-toast" role="status">{toast}</div>}
    </main>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="production-card skeleton" aria-hidden="true" key={index}><i /><i /><i /><i /></div>)}</>;
}

type ProductionCardProps = {
  order: ProductionOrder;
  displayStage: StageKey;
  stageQuantity: number | null;
  batchMode: boolean;
  selected: string[];
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
  openUpdate: (order: ProductionOrder) => void;
  openNextStep: (order: ProductionOrder, displayStage: StageKey) => void;
  saving: boolean;
  openResources: (order: ProductionOrder) => void;
  copySpecification: (order: ProductionOrder) => Promise<void>;
  openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  openDrawingStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  showExceptions?: boolean;
};

function ProductionCard(props: ProductionCardProps) {
  if (props.displayStage === 'not_issued') return <NotIssuedWorkOrderCard {...props} />;
  if (props.displayStage === 'completed') return <CompletedWorkOrderCard {...props} />;
  return <ActiveWorkOrderCard {...props} />;
}

function CardSelection({ order, batchMode, selected, toggleSelected }: Pick<ProductionCardProps, 'order' | 'batchMode' | 'selected' | 'toggleSelected'>) {
  if (!batchMode) return null;
  return <label className="production-card-selection" title={`选择${specText(order)}`}><input aria-label={`选择${specText(order)}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleSelected(order.id)} /></label>;
}

function ProductionAlertList({ order, showExceptions, openDrawingStatusMenu }: Pick<ProductionCardProps, 'order' | 'showExceptions' | 'openDrawingStatusMenu'>) {
  const fallback = showExceptions
    ? order.exceptionLabels.filter(label => !order.productionAlerts.some(alert => alert.label === label)).map((label, index) => ({ code: `legacy-${index}`, label, tone: 'amber' as const }))
    : [];
  const all = [...order.productionAlerts, ...fallback];
  if (!all.length) return null;
  const drawingCodes = new Set(['DRAWING_NOT_ISSUED', 'SAMPLE_CONFIRMATION_REQUIRED', 'CUSTOMER_CONFIRMATION_REQUIRED', 'DRAWING_CHANGE_REQUIRED']);
  return <div className="production-alerts" aria-label="工单异常">
    {all.slice(0, 2).map(alert => drawingCodes.has(alert.code)
      ? <button className={alert.tone} type="button" key={`${alert.code}-${alert.label}`} onClick={event => openDrawingStatusMenu(event, order)}>{alert.label}</button>
      : <span className={alert.tone} key={`${alert.code}-${alert.label}`}>{alert.label}</span>)}
    {all.length > 2 && <span className="more" title={all.slice(2).map(alert => alert.label).join('、')}>+{all.length - 2} 更多异常</span>}
  </div>;
}

function WorkOrderCardTitle({ order, batchMode, selected, toggleSelected, openDetail, openResources, copySpecification }: Pick<ProductionCardProps, 'order' | 'batchMode' | 'selected' | 'toggleSelected' | 'openDetail' | 'openResources' | 'copySpecification'>) {
  return <>
    <div className="production-card-title">
      <CardSelection order={order} batchMode={batchMode} selected={selected} toggleSelected={toggleSelected} />
      <div className="production-card-identity">
        <strong title={order.customerName || '客户待补充'}>{order.customerName || '客户待补充'}</strong>
        <button className="production-card-spec" type="button" title={order.specification || '规格待补充'} onClick={() => openResources(order)}>{specText(order)}</button>
      </div>
      <div className="production-card-title-actions">
        <button className="production-card-copy" type="button" title="复制完整规格" aria-label="复制完整规格" onClick={() => void copySpecification(order)}><Copy size={15} aria-hidden="true" /></button>
        <button className="production-card-info" type="button" title="查看工单详情" aria-label="查看工单详情" onClick={() => openDetail(order)}><Info size={15} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="production-card-context"><span title={order.productName || '品名待补充'}>{order.productName || '品名待补充'}</span><em className={order.priority}>{priorityText(order.priority)}</em></div>
  </>;
}

function NotIssuedWorkOrderCard(props: ProductionCardProps) {
  const { order, openNextStep, openDrawingStatusMenu, saving, stageQuantity } = props;
  const quantity = order.quantitySummary;
  const reminder = /样品|确认|变更|异常|返工|待处理/.test(order.latestProgressRemark || '') ? order.latestProgressRemark : '';
  return <article className={`production-card production-card-not-issued not_issued ${props.selected.includes(order.id) ? 'selected' : ''}`}>
    <WorkOrderCardTitle {...props} />
    <dl className="production-leader-metrics production-quantity-grid"><div><dt>本阶段数量</dt><dd>{stageQuantity === null ? '待补充' : formatProductionQuantity(stageQuantity)}</dd></div><div><dt>总目标</dt><dd>{quantity.targetQty === null ? '待补充' : formatProductionQuantity(quantity.targetQty)}</dd></div><div><dt>已完成</dt><dd>{quantity.completedQty === null ? '-' : formatProductionQuantity(quantity.completedQty)}</dd></div></dl>
    <div className="production-card-meta"><span>计划交期</span><strong>{deliveryText(order) || '待设置'}</strong></div>
    <ProductionAlertList order={order} showExceptions={props.showExceptions} openDrawingStatusMenu={openDrawingStatusMenu} />
    {reminder && <p className="production-focus-reminder" title={reminder}>{reminder}</p>}
    <footer><button type="button" onClick={event => openDrawingStatusMenu(event, order)}>更新图纸状态</button><button className="primary" type="button" disabled={saving || !order.quantityFlow.valid} onClick={() => openNextStep(order, 'not_issued')}>下一步</button></footer>
  </article>;
}

function ActiveWorkOrderCard(props: ProductionCardProps) {
  const { order, openUpdate, openNextStep, displayStage, stageQuantity, saving } = props;
  const quantity = order.quantitySummary;
  const percentageWidth = Math.max(0, Math.min(quantity.percentage || 0, 100));
  const splitFlow = cardSegments(order).length > 1;
  return <article className={`production-card production-card-active ${displayStage} ${props.selected.includes(order.id) ? 'selected' : ''}`}>
    <WorkOrderCardTitle {...props} />
    <button className="production-progress-hit" type="button" onClick={() => openUpdate(order)} title="记录生产进度备注">
      <span className="production-quantity-grid"><span><small>本阶段数量</small><strong>{stageQuantity === null ? '-' : formatProductionQuantity(stageQuantity)}</strong></span><span><small>总目标</small><strong>{quantity.targetQty === null ? '-' : formatProductionQuantity(quantity.targetQty)}</strong></span><span><small>累计完成</small><strong>{quantity.completedQty === null ? '-' : formatProductionQuantity(quantity.completedQty)}</strong></span></span>
      <span className="production-progress-track"><i><b style={{ width: `${percentageWidth}%` }} /></i><strong>{formatProductionPercentage(quantity.percentage)}</strong></span>
      {quantity.overrunQty !== null && quantity.overrunQty > 0 && <small className="overrun">超产 {formatProductionQuantity(quantity.overrunQty)} 套</small>}
    </button>
    {splitFlow && <span className="production-flow-badge">分批流转 · 同一工单</span>}
    <ProductionAlertList order={order} showExceptions={props.showExceptions} openDrawingStatusMenu={props.openDrawingStatusMenu} />
    <footer><button type="button" onClick={() => openUpdate(order)}>记录进度</button><button className="primary" type="button" disabled={saving || !order.quantityFlow.valid || !stageQuantity} onClick={() => openNextStep(order, displayStage)}>下一步</button></footer>
  </article>;
}

function CompletedWorkOrderCard(props: ProductionCardProps) {
  const { order, openStatusMenu } = props;
  const isSelected = props.selected.includes(order.id);
  const quantity = order.quantitySummary;
  const quantityText = props.stageQuantity === null
    ? '完成数量待核对'
    : `本阶段完成 ${formatProductionQuantity(props.stageQuantity)} 套 · 累计 ${formatProductionQuantity(quantity.completedQty)} / ${formatProductionQuantity(quantity.targetQty)} 套`;
  return <article className={`production-card production-card-completed completed ${quantity.status} ${isSelected ? 'selected' : ''}`}>
    <WorkOrderCardTitle {...props} />
    <div className="production-completed-quantity">{quantityText}</div>
    {quantity.status === 'tail_remaining' && <div className="production-completed-result tail">剩余 {formatProductionQuantity(quantity.remainingQty)} 套 · 尾数未清</div>}
    {quantity.status === 'overrun' && <div className="production-completed-result overrun">超产 {formatProductionQuantity(quantity.overrunQty)} 套</div>}
    <button className="production-completed-more" type="button" onClick={event => openStatusMenu(event, order)}>调整状态</button>
  </article>;
}

function UpdateDrawer({ order, value, setValue, saving, error, close, save }: { order: ProductionOrder; value: UpdateForm; setValue: (value: UpdateForm) => void; saving: boolean; error: string; close: () => void; save: () => void }) {
  const draft = getProductionQuantitySummary({ ...order, completedQty: value.completedQty });
  return (
    <div className="production-update-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><aside className="production-update-drawer" role="dialog" aria-modal="true" aria-label="快速更新工单进度">
      <div className="dialog-title"><div><strong>更新生产进度</strong><small>{specText(order)} · {order.customerName || '客户待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-update-product"><strong>{order.productName || '品名待补充'}</strong><span>{order.stageText}</span></div>
      <div className="production-update-quantity">
        <div><span>目标数量</span><strong>{formatProductionQuantity(draft.targetQty)}</strong></div>
        <div><span>当前已完成</span><strong>{formatProductionQuantity(draft.completedQty)}</strong></div>
        <div><span>当前剩余</span><strong>{formatProductionQuantity(draft.remainingQty)}</strong></div>
      </div>
      <div className="production-update-form">
        {order.quantityFlow.materialized
          ? <div className="production-flow-edit-note"><strong>数量由“下一步”流转维护</strong><span>此处仅记录生产进度备注，避免绕过分批数量校验。</span></div>
          : <label><span>累计完成数量</span><input inputMode="decimal" value={value.completedQty} onChange={event => setValue({ ...value, completedQty: event.target.value })} placeholder="请输入累计完成数量" /></label>}
        <label><span>进度备注</span><div className="production-voice-field"><textarea value={value.remark} onChange={event => setValue({ ...value, remark: event.target.value })} rows={4} placeholder="记录首件、批量生产或异常处理进度" /><VoiceInputButton value={value.remark} onChange={remark => setValue({ ...value, remark })} label="进度备注语音输入" /></div></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存进度'}</button></div>
    </aside></div>
  );
}

function NextStepDialog({ request, quantity, setQuantity, saving, error, close, confirm }: {
  request: NextStepRequest;
  quantity: string;
  setQuantity: (value: string) => void;
  saving: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  const { order, action } = request;
  const flow = order.quantityFlow;
  const isDrawingConfirmation = action === 'confirm_drawing_issued';
  const title = isDrawingConfirmation ? '确认图纸已下发并进入前端' : action === 'transfer_to_backend' ? '前端数量进入后端' : '确认后端完成数量';
  const quantityLabel = action === 'transfer_to_backend' ? '本次进入后端数量' : '本次完成数量';
  return <div className="modal-backdrop"><section className="production-dialog production-next-step-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-title"><div><strong>{title}</strong><small>{order.customerName || '客户待补充'} · {specText(order)}</small></div><button type="button" disabled={saving} onClick={close} aria-label="关闭">×</button></div>
    <div className="production-flow-summary" aria-label="当前生产数量">
      <div><span>总目标 T</span><strong>{formatProductionQuantity(flow.targetQty)}</strong></div>
      <div><span>前端剩余 T-F</span><strong>{formatProductionQuantity(flow.frontendRemainingQty)}</strong></div>
      <div><span>后端待完成 F-C</span><strong>{formatProductionQuantity(flow.backendRemainingQty)}</strong></div>
      <div><span>累计已完成 C</span><strong>{formatProductionQuantity(flow.completedQty)}</strong></div>
    </div>
    {isDrawingConfirmation
      ? <p className="production-flow-confirm-copy">确认后，图纸状态将更新为“已发”，工单进入前端；目标数量和已有资料不会改变。</p>
      : <label className="production-flow-quantity-input"><span>{quantityLabel}</span><input autoFocus inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={saving} aria-describedby="production-flow-limit" /><small id="production-flow-limit">仅支持正整数，默认填写当前阶段全部可流转数量。</small></label>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '提交中...' : '确认下一步'}</button></div>
  </section></div>;
}

function StageChangeDialog({ request, saving, close, confirm }: { request: StageChangeRequest; saving: boolean; close: () => void; confirm: () => void }) {
  const quantity = request.order.quantitySummary;
  const hasTail = quantity.remainingQty !== null && quantity.remainingQty > 0;
  return <div className="modal-backdrop"><section className="production-dialog production-stage-confirm" role="dialog" aria-modal="true" aria-label="确认完成工单">
    <div className="dialog-title"><div><strong>确认更新为已完成</strong><small>{specText(request.order)} · {request.order.customerName || '客户待补充'}</small></div><button type="button" onClick={close} aria-label="关闭">×</button></div>
    <div className="production-confirm-quantity"><span>目标 <b>{formatProductionQuantity(quantity.targetQty)}</b></span><span>已完成 <b>{formatProductionQuantity(quantity.completedQty)}</b></span><span>剩余 <b>{formatProductionQuantity(quantity.remainingQty)}</b></span></div>
    {hasTail ? <p className="production-tail-warning">当前仍剩余 {formatProductionQuantity(quantity.remainingQty)} 套，完成后将标记为“尾数未清”。</p> : <p className="production-complete-note">数量已完成，可以同步更新工单状态。</p>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '更新中...' : '确认完成'}</button></div>
  </section></div>;
}

function CompletionSuggestionDialog({ order, saving, close, confirm }: { order: ProductionOrder; saving: boolean; close: () => void; confirm: () => void }) {
  return <div className="modal-backdrop"><section className="production-dialog production-stage-confirm" role="dialog" aria-modal="true" aria-label="数量完成提示">
    <div className="dialog-title"><div><strong>数量已经完成</strong><small>{specText(order)} · {formatProductionPercentage(order.quantitySummary.percentage)}</small></div><button type="button" onClick={close} aria-label="关闭">×</button></div>
    <p className="production-complete-note">累计完成数量已达到目标。是否同步把工单状态更新为“已完成”？</p>
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>暂不修改状态</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '更新中...' : '同步标记已完成'}</button></div>
  </section></div>;
}

function DetailDialog({ order, tab, setTab, progressLogs, progressLoading, close, update, resources, drawingLibrary }: { order: ProductionOrder; tab: DetailTab; setTab: (tab: DetailTab) => void; progressLogs: ProgressLog[]; progressLoading: boolean; close: () => void; update: () => void; resources: () => void; drawingLibrary: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog detail" role="dialog" aria-modal="true" aria-label="生产工单详情">
      <div className="dialog-title"><div><strong>{specText(order)}</strong><small>{order.customerName || '客户待补充'} · {order.productName || '品名待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-detail-tabs">{([['production', '生产信息'], ['drawing', '工单资料'], ['progress', '进度记录'], ['source', '来源信息']] as Array<[DetailTab, string]>).map(item => <button className={tab === item[0] ? 'active' : ''} type="button" key={item[0]} onClick={() => setTab(item[0])}>{item[1]}</button>)}</div>
      <div className="production-detail-body">
        {tab === 'production' && <InfoGrid items={[
          ['状态', order.stageText], ['优先级', priorityText(order.priority)], ['未交量', order.uncompletedQty || '-'], ['完成数量', order.completedQty || '-'],
          ['交期', deliveryText(order) || '-'], ['图纸', order.drawingStatus || '-'], ['配料', order.materialStatus || '-'], ['开始时间', dateTimeText(order.startedAt)],
          ['完成时间', dateTimeText(order.completedAt)], ['最近更新', dateTimeText(order.lastProgressAt)], ['最近进度', order.latestProgressRemark || '暂无进度备注'],
        ]} />}
        {tab === 'drawing' && <div className="production-drawing-detail"><div className="production-drawing-score"><span>工单资料完整度</span><strong>{order.documentFilledCount}/{order.documentTotalCount || 5}</strong></div><div className="production-category-status">{categoryLabels.map(category => <span className={order.documentCategoryCodes.includes(category.code) ? 'ready' : 'missing'} key={category.code}><i />{category.label}<b>{order.documentCategoryCodes.includes(category.code) ? '已有资料' : '待补充'}</b></span>)}</div><div className="production-drawing-actions"><button className="primary-button" type="button" onClick={resources}>打开工单资料</button><button type="button" onClick={drawingLibrary}>查看图纸资料库</button></div></div>}
        {tab === 'progress' && <div className="production-progress-list">{progressLoading && <div className="production-loading">进度记录加载中...</div>}{progressLogs.map(log => <article key={log.id}><time>{dateTimeText(log.createdAt)}</time><strong>{log.createdBy || '操作人未记录'}</strong><span>状态：{log.previousStageText && log.previousStage !== log.stage ? `${log.previousStageText} → ` : ''}{log.stageText}</span>{log.completedQty && <span>完成：{log.completedQty}</span>}{(log.productionOwner || log.workstation) && <span>历史记录：{log.productionOwner || ''}{log.productionOwner && log.workstation ? ' · ' : ''}{log.workstation || ''}</span>}<p>{log.remark || '未填写备注'}</p></article>)}{!progressLoading && !progressLogs.length && <div className="production-task-empty">暂无进度记录</div>}</div>}
        {tab === 'source' && <InfoGrid items={[
          ['订单日期', dateText(order.orderDate) || '-'], ['业务员', order.salesperson || '-'], ['客户等级', order.customerLevel || '-'], ['来源订单号', order.sourceOrderNo || '-'],
          ['导入批次', order.importBatchId || '-'], ['来源工作表', order.sourceSheetName || '-'], ['来源行号', order.sourceRowNo ? String(order.sourceRowNo) : '-'], ['内部编号', order.code],
          ['工序', order.processName || '-'], ['单位工时', order.unitWorkHours || '-'], ['总工时', order.totalWorkHours || '-'], ['图纸说明', order.drawingIssueNote || '-'],
        ]} />}
      </div>
      <div className="dialog-actions"><button type="button" onClick={resources}>工单资料</button><button className="primary-button" type="button" onClick={update}>更新进度</button><button type="button" onClick={close}>关闭</button></div>
    </section></div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return <div className="production-info-grid">{items.map(([label, value]) => <div className={label === '最近进度' ? 'wide' : ''} key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>;
}

function AdvancedFilterPanel({ customers, value, setValue, clear, apply }: { customers: string[]; value: AdvancedFilters; setValue: (value: AdvancedFilters) => void; clear: () => void; apply: () => void }) {
  const [customerSearch, setCustomerSearch] = useState('');
  const filteredCustomers = customers.filter(customer => customer.toLocaleLowerCase().includes(customerSearch.trim().toLocaleLowerCase()));
  function toggleCustomer(customer: string): void {
    setValue({ ...value, customers: value.customers.includes(customer) ? value.customers.filter(item => item !== customer) : [...value.customers, customer] });
  }
  return <section className="production-filter-panel" aria-label="生产看板高级筛选">
    <div className="production-filter-heading"><div><strong>高级筛选</strong><small>筛选当前启用周的生产工单</small></div><button type="button" onClick={clear}>重置</button></div>
    <div className="production-filter-fields">
      <fieldset className="production-customer-filter"><legend>客户（可多选）</legend><input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="搜索当前周客户" /><div>{filteredCustomers.map(customer => <label key={customer}><input type="checkbox" checked={value.customers.includes(customer)} onChange={() => toggleCustomer(customer)} /><span>{customer}</span></label>)}{!filteredCustomers.length && <p>暂无匹配客户</p>}</div></fieldset>
      <label><span>交期</span><select value={value.duePreset} onChange={event => setValue({ ...value, duePreset: event.target.value as DuePreset, dueFrom: event.target.value === 'custom' ? value.dueFrom : '', dueTo: event.target.value === 'custom' ? value.dueTo : '' })}><option value="">全部交期</option><option value="today">今日</option><option value="tomorrow">明日</option><option value="overdue">已逾期</option><option value="week">本周</option><option value="custom">自定义</option></select></label>
      {value.duePreset === 'custom' && <><label><span>开始日期</span><input type="date" value={value.dueFrom} onChange={event => setValue({ ...value, dueFrom: event.target.value })} /></label><label><span>结束日期</span><input type="date" value={value.dueTo} onChange={event => setValue({ ...value, dueTo: event.target.value })} /></label></>}
      <label><span>状态</span><select value={value.stage} onChange={event => setValue({ ...value, stage: event.target.value })}><option value="">全部状态</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>
      <label><span>优先级</span><select value={value.priority} onChange={event => setValue({ ...value, priority: event.target.value })}><option value="">全部优先级</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>
      <label><span>图纸状态</span><select value={value.drawing} onChange={event => setValue({ ...value, drawing: event.target.value })}><option value="">全部图纸状态</option><option value="issued">已发</option><option value="not_issued">未发</option><option value="sample_confirmation">待样品确认</option><option value="customer_confirmation">待客户确认</option><option value="change_required">图纸需变更</option><option value="confirmed">已确认</option><option value="unset">未设置</option></select></label>
      <label><span>配料状态</span><select value={value.material} onChange={event => setValue({ ...value, material: event.target.value })}><option value="">全部配料状态</option><option value="allocated">已配料</option><option value="ready">料齐</option><option value="not_ready">未齐</option><option value="unset">未设置</option></select></label>
      <label><span>资料完整度</span><select value={value.documents} onChange={event => setValue({ ...value, documents: event.target.value })}><option value="">全部完整度</option><option value="empty">0/5</option><option value="partial">1-4/5</option><option value="complete">5/5</option></select></label>
    </div>
    <div className="production-filter-actions"><button type="button" onClick={clear}>清空全部</button><button className="primary-button" type="button" onClick={apply}>应用筛选</button></div>
  </section>;
}

function BatchDialog({ count, operation, value, remark, confirm, saving, error, setValue, setRemark, setConfirm, close, save }: { count: number; operation: BatchOperation; value: string; remark: string; confirm: string; saving: boolean; error: string; setValue: (value: string) => void; setRemark: (value: string) => void; setConfirm: (value: string) => void; close: () => void; save: () => void }) {
  const labels: Record<BatchOperation, string> = { set_priority: '批量设置优先级', set_stage: '批量修改状态', add_remark: '批量添加进度备注' };
  return <div className="modal-backdrop"><section className="production-dialog batch" role="dialog" aria-modal="true" aria-label={labels[operation]}><div className="dialog-title"><div><strong>{labels[operation]}</strong><small>将更新已选的 {count} 个当前周工单</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div><div className="production-batch-form">
    {operation === 'set_priority' && <label><span>优先级</span><select value={value} onChange={event => setValue(event.target.value)}><option value="">请选择</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>}
    {operation === 'set_stage' && <label><span>新状态</span><select value={value} onChange={event => { setValue(event.target.value); setConfirm(''); }}><option value="">请选择</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>}
    <label><span>{operation === 'add_remark' ? '进度备注' : '附加进度备注（可选）'}</span><div className="production-voice-field"><textarea value={remark} onChange={event => setRemark(event.target.value)} rows={3} /><VoiceInputButton value={remark} onChange={setRemark} label="批量进度备注语音输入" /></div></label>
    {operation === 'set_stage' && value === 'completed' && <label className="danger-confirm-inline"><span>批量完成不可误触，请输入 COMPLETE_BATCH</span><input value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="COMPLETE_BATCH" /></label>}
  </div>{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className={operation === 'set_stage' && value === 'completed' ? 'danger-button' : 'primary-button'} type="button" disabled={saving || (operation !== 'add_remark' && !value) || (operation === 'add_remark' && !remark.trim()) || (operation === 'set_stage' && value === 'completed' && confirm.trim() !== 'COMPLETE_BATCH')} onClick={save}>{saving ? '处理中...' : '确认批量更新'}</button></div></section></div>;
}
