'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import type { CurrentUserDTO } from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type QuickFilter = 'overdue' | 'urgent' | 'drawing' | 'material' | 'documents' | 'completed' | 'due_today' | 'updated_today' | 'completed_today' | 'delivery_missing' | 'specification_invalid' | 'customer_missing';
type DetailTab = 'production' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_priority' | 'set_stage' | 'add_remark';
type DuePreset = '' | 'today' | 'tomorrow' | 'overdue' | 'week' | 'custom';

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
  stage: StageKey;
  completedQty: string;
  remark: string;
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

const stages: Array<{ key: StageKey; label: string }> = [
  { key: 'not_issued', label: '未发图' },
  { key: 'frontend', label: '在前端' },
  { key: 'backend', label: '在后端' },
  { key: 'completed', label: '已完成' },
];

const quickByView: Record<ViewKey, Array<{ key: QuickFilter; label: string }>> = {
  board: [
    { key: 'overdue', label: '已逾期' }, { key: 'urgent', label: '紧急' }, { key: 'drawing', label: '缺图纸' },
    { key: 'material', label: '配料未齐' }, { key: 'documents', label: '资料不完整' }, { key: 'completed', label: '已完成' },
  ],
  today: [
    { key: 'due_today', label: '今日交期' }, { key: 'overdue', label: '已逾期' },
    { key: 'updated_today', label: '今日更新' }, { key: 'completed_today', label: '今日完成' },
  ],
  exceptions: [
    { key: 'drawing', label: '缺图纸' }, { key: 'material', label: '配料未齐' }, { key: 'documents', label: '资料不完整' },
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
  'delivery_missing', 'specification_invalid', 'customer_missing',
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

function updateFormFor(order: ProductionOrder, stage = order.stage): UpdateForm {
  return { stage, completedQty: order.completedQty || '', remark: '' };
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
  items.forEach(item => { stageCounts[item.stage] += 1; });
  return { ...payload, items, stageCounts };
}

function optimisticOrder(order: ProductionOrder, value: UpdateForm): ProductionOrder {
  const stageText = stages.find(item => item.key === value.stage)?.label || order.stageText;
  return {
    ...order,
    stage: value.stage,
    stageText,
    completedQty: value.completedQty.trim() || order.completedQty,
    latestProgressRemark: value.remark.trim() || order.latestProgressRemark,
    lastProgressAt: new Date().toISOString(),
  };
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
  const [userMenu, setUserMenu] = useState(false);
  const [statusMenuOrder, setStatusMenuOrder] = useState<ProductionOrder | null>(null);
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Record<StageKey, HTMLDivElement | null>>({ not_issued: null, frontend: null, backend: null, completed: null });
  const pendingRestoreRef = useRef<ProductionExecutionViewState | null>(null);
  const returnKeyRef = useRef('');
  const requestRef = useRef(0);
  const boardRef = useRef<BoardPayload | null>(null);
  const keywordReadyRef = useRef(false);

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
  }, [refreshToken, stateReady, weekStart]);

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
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const grouped = useMemo(() => {
    const result: Record<StageKey, ProductionOrder[]> = { not_issued: [], frontend: [], backend: [], completed: [] };
    for (const item of board?.items || []) result[item.stage].push(item);
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
    add('drawing', '图纸', { issued: '已发', not_issued: '未发', unset: '未设置' });
    add('material', '配料', { allocated: '已配料', ready: '料齐', not_ready: '未齐', unset: '未设置' });
    add('documents', '资料', { empty: '0/5', partial: '1-4/5', complete: '5/5' });
    return chips;
  }, [advanced]);

  const activeFilterCount = filterChips.length;

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

  function toggleSummary(key: 'all' | 'due_today' | 'overdue' | 'drawing' | 'material' | 'documents' | 'urgent' | 'completed'): void {
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

  function openUpdate(order: ProductionOrder, stage = order.stage): void {
    setStatusMenuOrder(null);
    setUpdateOrder(order);
    setUpdateForm(updateFormFor(order, stage));
    setFormError('');
  }

  async function saveUpdate(): Promise<void> {
    if (!updateOrder || !updateForm) return;
    const previousBoard = board;
    const previousDetail = detailOrder;
    const optimistic = optimisticOrder(updateOrder, updateForm);
    setBoard(current => replaceOrder(current, optimistic));
    if (detailOrder?.id === updateOrder.id) setDetailOrder(optimistic);
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/work-orders/${updateOrder.id}/execution`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '进度更新失败');
      if (body.data) {
        const updated = body.data as ProductionOrder;
        setBoard(current => replaceOrder(current, updated));
        if (detailOrder?.id === updated.id) setDetailOrder(updated);
      }
      setUpdateOrder(null);
      setUpdateForm(null);
      setToast('生产进度已更新');
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setBoard(previousBoard);
      setDetailOrder(previousDetail);
      setFormError(reason instanceof Error ? reason.message : '进度更新失败');
    } finally {
      setSaving(false);
    }
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

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const cardProps = {
    batchMode, selected, toggleSelected, openDetail, openUpdate, openResources: openWorkOrderResources,
    openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, item: ProductionOrder): void => {
      statusButtonRef.current = event.currentTarget;
      setStatusMenuOrder(item);
    },
  };

  return (
    <main className="production-page">
      <header className="production-topbar">
        <div className="production-brand"><strong>生产执行中心</strong><span>本周任务、异常与进度闭环</span></div>
        <nav className="production-main-nav" aria-label="主要导航">
          <a className="active" href="/production">生产执行</a><a href="/dashboard">生产工单</a><a href="/weekly-plan-center">周计划</a>
          <a href="/drawing-library">图纸资料库</a><a href="/connector-parameters">连接器参数</a><a href="/connector-assembly-manuals">组装说明书</a>
          <a href="/dashboard?openSettings=1">系统设置</a>
        </nav>
        <div className="user-wrap">
          <button ref={userButtonRef} className="user-button" type="button" onClick={() => setUserMenu(value => !value)}><span>♙</span><b>{user.displayName || user.username}</b><em>⌄</em></button>
          <PortalMenu open={userMenu} anchorRef={userButtonRef} className="user-menu app-user-menu" width={176} onClose={() => setUserMenu(false)}>
            <button type="button" onClick={() => { location.href = '/dashboard?openSettings=1'; }}>系统设置</button><button type="button" onClick={logout}>退出登录</button>
          </PortalMenu>
        </div>
      </header>

      <div className="production-execution-main">
        <section className="production-summary" aria-label="当前周生产摘要">
          <button className={`production-week-label ${summaryActive('all') ? 'active' : ''}`} type="button" onClick={() => toggleSummary('all')}>
            <span>当前启用周 · 全周统计</span><strong>{summary?.weekStartDate ? `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}` : '尚未启用周计划'}</strong><em>{summary?.total ?? 0} 工单</em>
          </button>
          {[
            ['今日交期', summary?.dueToday ?? 0, 'blue', 'due_today'], ['已逾期', summary?.overdue ?? 0, 'red', 'overdue'],
            ['未发图', summary?.notIssuedDrawing ?? 0, 'gray', 'drawing'], ['配料未齐', summary?.materialNotReady ?? 0, 'orange', 'material'],
            ['资料不完整', summary?.incompleteDocuments ?? 0, 'amber', 'documents'], ['紧急', summary?.urgent ?? 0, 'red', 'urgent'], ['已完成', summary?.completed ?? 0, 'green', 'completed'],
          ].map(([label, value, tone, key]) => <button className={`${String(tone)} ${summaryActive(String(key)) ? 'active' : ''}`} type="button" key={String(key)} onClick={() => toggleSummary(key as Parameters<typeof toggleSummary>[0])}><span>{label}</span><strong>{value}</strong></button>)}
        </section>

        <section className="production-toolbar">
          <div className="production-view-tabs">
            <button className={view === 'board' ? 'active' : ''} type="button" onClick={() => changeView('board')}>生产看板</button>
            <button className={view === 'today' ? 'active' : ''} type="button" onClick={() => changeView('today')}>今日任务</button>
            <button className={view === 'exceptions' ? 'active' : ''} type="button" onClick={() => changeView('exceptions')}>异常任务</button>
          </div>
          <label className="production-search"><span aria-hidden="true">⌕</span><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名 / 订单号" /></label>
          <button ref={filterButtonRef} className={filtersOpen || activeFilterCount ? 'active' : ''} type="button" onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>高级筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
          <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
            <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
          </PortalMenu>
          <button type="button" onClick={toggleBatchMode}>{batchMode ? '退出批量' : '批量操作'}</button>
          <button type="button" onClick={exportCsv}>导出 CSV</button>
          <span className="production-result-count">筛选结果 <b>{board?.pagination.total || 0}</b> / 全周 {summary?.total || 0}</span>
        </section>

        <section className="production-quick-filters" aria-label="快捷筛选">
          <button className={!quick.length ? 'active' : ''} type="button" onClick={() => { setQuick([]); setPage(1); }}>全部</button>
          {quickByView[view].map(item => <button className={quick.includes(item.key) ? 'active' : ''} key={item.key} type="button" onClick={() => toggleQuick(item.key)}>{item.label}</button>)}
        </section>

        {!!filterChips.length && <div className="production-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}

        {error && <div className="production-error"><span><strong>加载失败</strong>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}
        {!summary?.weekStartDate && !loading && <div className="production-empty-week"><strong>当前暂无启用生产周</strong><span>请前往周计划中心审核并启用生产计划。</span><a href="/weekly-plan-center">进入周计划中心</a></div>}

        {view === 'board' ? (
          <div ref={boardShellRef} className="production-board-shell" aria-label="四状态生产看板">
            <div className="production-board">
              {stages.map(column => (
                <section className={`production-column ${column.key}`} key={column.key}>
                  <header className="production-stage-header"><strong>{column.label}</strong><span>{board?.stageCounts[column.key] || 0}</span></header>
                  <div ref={element => { columnRefs.current[column.key] = element; }} className="production-column-list">
                    {grouped[column.key].map(order => <ProductionCard key={order.id} order={order} {...cardProps} />)}
                    {loading && !grouped[column.key].length && <CardSkeleton count={3} />}
                    {!loading && !grouped[column.key].length && <div className="production-column-empty">当前状态暂无工单</div>}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <section className="production-task-view">
            <div className="production-task-heading"><div><strong>{view === 'today' ? '今日任务' : '异常任务'}</strong><span>{view === 'today' ? '今日交期、逾期与今日进展' : '聚合资料与基础字段异常，不自动修改数据'}</span></div><em>{board?.pagination.total || 0} 项</em></div>
            <div className="production-task-grid">
              {board?.items.map(order => <ProductionCard key={order.id} order={order} {...cardProps} showExceptions={view === 'exceptions'} />)}
              {loading && <CardSkeleton count={8} />}
              {!loading && !board?.items.length && <div className="production-task-empty">当前没有匹配任务</div>}
            </div>
          </section>
        )}

        {board && board.pagination.totalPages > 1 && <div className="production-pagination"><span>共 {board.pagination.total} 单</span><button type="button" disabled={board.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{board.pagination.page} / {board.pagination.totalPages}</b><button type="button" disabled={board.pagination.page >= board.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
      </div>

      {batchMode && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong><button type="button" disabled={!selected.length} onClick={() => openBatch('set_priority')}>设置优先级</button><button type="button" disabled={!selected.length} onClick={() => openBatch('set_stage')}>修改状态</button><button type="button" disabled={!selected.length} onClick={() => openBatch('add_remark')}>添加进度备注</button><button type="button" onClick={() => setSelected([])}>清空选择</button><button type="button" onClick={toggleBatchMode}>退出批量</button></div>}

      <PortalMenu open={!!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu" width={164} onClose={() => setStatusMenuOrder(null)}>
        {statusMenuOrder && stages.map(stage => <button className={statusMenuOrder.stage === stage.key ? 'active' : ''} type="button" key={stage.key} onClick={() => openUpdate(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      {updateOrder && updateForm && <UpdateDialog order={updateOrder} value={updateForm} setValue={setUpdateForm} saving={saving} error={formError} close={() => { if (!saving) { setUpdateOrder(null); setUpdateForm(null); } }} save={saveUpdate} />}
      {detailOrder && <DetailDialog order={detailOrder} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} update={() => openUpdate(detailOrder)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder)} />}
      {batchOpen && <BatchDialog count={selected.length} operation={batchOperation} value={batchValue} remark={batchRemark} confirm={batchConfirm} saving={saving} error={formError} setValue={setBatchValue} setRemark={setBatchRemark} setConfirm={setBatchConfirm} close={() => { if (!saving) setBatchOpen(false); }} save={saveBatch} />}
      {toast && <div className="production-toast" role="status">{toast}</div>}
    </main>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="production-card skeleton" aria-hidden="true" key={index}><i /><i /><i /><i /></div>)}</>;
}

function ProductionCard({ order, batchMode, selected, toggleSelected, openDetail, openUpdate, openResources, openStatusMenu, showExceptions = false }: {
  order: ProductionOrder;
  batchMode: boolean;
  selected: string[];
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
  openUpdate: (order: ProductionOrder) => void;
  openResources: (order: ProductionOrder) => void;
  openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  showExceptions?: boolean;
}) {
  const isSelected = selected.includes(order.id);
  const delivery = deliveryText(order);
  return (
    <article className={`production-card ${order.stage} ${isSelected ? 'selected' : ''}`}>
      <div className="production-card-title">
        {batchMode && <input aria-label={`选择${specText(order)}`} type="checkbox" checked={isSelected} onChange={() => toggleSelected(order.id)} />}
        <button className="production-card-spec" type="button" title={order.specification || '规格待补充'} onClick={() => openResources(order)}>{specText(order)}</button>
        <em className={order.priority}>{priorityText(order.priority)}</em>
        <button className="production-card-info" type="button" title="查看工单详情" aria-label="查看工单详情" onClick={() => openDetail(order)}>i</button>
      </div>
      <div className="production-card-customer"><strong>{order.customerName || '客户待补充'}</strong>{order.productName && <span>· {order.productName}</span>}</div>
      {(delivery || order.uncompletedQty || order.completedQty) && <dl className="production-card-metrics">{delivery && <div><dt>交期</dt><dd>{delivery}</dd></div>}{order.uncompletedQty && <div><dt>未交</dt><dd>{order.uncompletedQty}</dd></div>}{order.completedQty && <div><dt>完成</dt><dd>{order.completedQty}</dd></div>}</dl>}
      <div className="production-card-health"><button type="button" onClick={() => openResources(order)}>图纸 {order.drawingStatus || '未设置'}</button><span>配料 {order.materialStatus || '未设置'}</span><span>资料 {order.documentFilledCount}/{order.documentTotalCount || 5}</span></div>
      {showExceptions && order.exceptionLabels.length > 0 && <div className="production-card-exceptions">{order.exceptionLabels.map(label => <span key={label}>{label}</span>)}</div>}
      {order.latestProgressRemark && <p title={order.latestProgressRemark}>{order.latestProgressRemark}</p>}
      <footer><button type="button" onClick={() => openResources(order)}>打开资料</button><button className="primary" type="button" onClick={() => openUpdate(order)}>更新进度</button><button type="button" onClick={event => openStatusMenu(event, order)}>状态⌄</button></footer>
    </article>
  );
}

function UpdateDialog({ order, value, setValue, saving, error, close, save }: { order: ProductionOrder; value: UpdateForm; setValue: (value: UpdateForm) => void; saving: boolean; error: string; close: () => void; save: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog update" role="dialog" aria-modal="true" aria-label="更新工单进度">
      <div className="dialog-title"><div><strong>更新生产进度</strong><small>{specText(order)} · {order.customerName || '客户待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-reference">{order.productName && <span>品名 <b>{order.productName}</b></span>}{deliveryText(order) && <span>交期 <b>{deliveryText(order)}</b></span>}{order.uncompletedQty && <span>未交 <b>{order.uncompletedQty}</b></span>}<span>资料 <b>{order.documentFilledCount}/{order.documentTotalCount || 5}</b></span></div>
      <div className="production-form-grid">
        <label><span>当前状态</span><input value={order.stageText} readOnly /></label>
        <label><span>新状态</span><select value={value.stage} onChange={event => setValue({ ...value, stage: event.target.value as StageKey })}>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>
        <label className="wide"><span>完成数量</span><input value={value.completedQty} onChange={event => setValue({ ...value, completedQty: event.target.value })} placeholder="累计完成数量，不允许负数" /></label>
        <label className="wide"><span>进度备注</span><div className="production-voice-field"><textarea value={value.remark} onChange={event => setValue({ ...value, remark: event.target.value })} rows={3} placeholder="记录首件、批量生产、异常处理等现场进度" /><VoiceInputButton value={value.remark} onChange={remark => setValue({ ...value, remark })} label="进度备注语音输入" /></div></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存进度'}</button></div>
    </section></div>
  );
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
      <label><span>图纸状态</span><select value={value.drawing} onChange={event => setValue({ ...value, drawing: event.target.value })}><option value="">全部图纸状态</option><option value="issued">已发</option><option value="not_issued">未发</option><option value="unset">未设置</option></select></label>
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
