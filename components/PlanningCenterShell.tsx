'use client';

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Clock3,
  Factory,
  FilePenLine,
  History,
  Layers3,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import { Fragment, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { useModalLayer } from '@/components/useModalLayer';
import type {
  CurrentUserDTO,
  ProductionPlanBatchDTO,
  ProductionPlanChangeDTO,
  ProductionPlanOrderDTO,
  ProductionPlanPriority,
  ProductionPlanProductOptionDTO,
  ProductionPlanningSummaryDTO,
} from '@/types';

type PlanningView = 'schedule' | 'orders' | 'preparation' | 'changes' | 'history';
type ProductEntryMode = 'select' | 'create';

type PlanningPayload = {
  ok?: boolean;
  orders?: ProductionPlanOrderDTO[];
  summary?: ProductionPlanningSummaryDTO;
  customers?: string[];
  productOptions?: ProductionPlanProductOptionDTO[];
  salespeople?: string[];
  periods?: {
    current: { weekStartDate: string; weekEndDate: string };
    next: { weekStartDate: string; weekEndDate: string };
  };
  error?: string;
};

type OrderForm = {
  drawingLibraryItemId: string;
  customerName: string;
  salesperson: string;
  productName: string;
  specification: string;
  orderQuantity: string;
  planningUnitMinutes: string;
  orderDate: string;
  customerDueDate: string;
  priority: ProductionPlanPriority;
  remark: string;
  reason: string;
};

type BatchForm = {
  quantity: string;
  unitSeconds: string;
  weekStartDate: string;
  plannedCompletionDate: string;
  reason: string;
};

type ReleasePreview = {
  target: 'preparation' | 'active';
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  warnings: number;
  blockers: number;
  items: Array<{ batchId: string; specification: string; quantity: number; warnings: string[]; blockers: string[] }>;
};

type DeletePreview = {
  batchCount: number;
  totalQuantity: number;
  draftDeleteCount: number;
  withdrawCount: number;
  blockers: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    action: 'delete_draft' | 'withdraw_unstarted' | 'blocked';
    message: string;
  }>;
};

type ActivationPreview = {
  sourceWeekStartDate?: string;
  sourceWeekEndDate?: string;
  weekStartDate: string;
  weekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  warningCount: number;
  blockerCount: number;
  items: Array<{
    batchId: string;
    specification: string;
    customerName: string;
    quantity: number;
    warehouseStatus: string;
    processStatus: string;
    warnings: string[];
    blockers: string[];
  }>;
};

const emptySummary: ProductionPlanningSummaryDTO = {
  orderCount: 0,
  pendingOrderCount: 0,
  scheduledOrderCount: 0,
  thisWeekBatchCount: 0,
  nextWeekBatchCount: 0,
  preparationBatchCount: 0,
  activeBatchCount: 0,
  missingDrawingCount: 0,
  missingProductTimeCount: 0,
  warehouseExceptionCount: 0,
  processPendingCount: 0,
};

function emptyOrderForm(): OrderForm {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return {
    drawingLibraryItemId: '',
    customerName: '', salesperson: '', productName: '', specification: '',
    orderQuantity: '', planningUnitMinutes: '', orderDate: today, customerDueDate: '', priority: 'normal', remark: '', reason: '',
  };
}

function orderForm(order: ProductionPlanOrderDTO): OrderForm {
  return {
    drawingLibraryItemId: order.drawingLibraryItemId || '',
    customerName: order.customerName,
    salesperson: order.salesperson || '',
    productName: order.productName,
    specification: order.specification,
    orderQuantity: String(order.orderQuantity),
    planningUnitMinutes: millisecondsInput(order.planningUnitMilliseconds || order.currentUnitMilliseconds),
    orderDate: order.orderDate,
    customerDueDate: order.customerDueDate,
    priority: order.priority,
    remark: order.remark || '',
    reason: '',
  };
}

function duration(milliseconds?: number | null): string {
  if (!milliseconds) return '待维护';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${(minutes / 60).toFixed(2)} 小时`;
}

function totalDuration(milliseconds?: string | null): string {
  if (!milliseconds) return '待计算';
  const number = Number(milliseconds);
  return Number.isFinite(number) ? duration(number) : '待计算';
}

function millisecondsInput(milliseconds?: number | null): string {
  if (!milliseconds) return '';
  return String(Number((milliseconds / 60_000).toFixed(3)));
}

function secondsInput(milliseconds?: number | null): string {
  if (!milliseconds) return '';
  return String(Number((milliseconds / 1000).toFixed(3)));
}

function planningUnitMilliseconds(order: ProductionPlanOrderDTO): number | null {
  return order.effectiveUnitMilliseconds || order.currentUnitMilliseconds || order.planningUnitMilliseconds || null;
}

function batchTotalMilliseconds(order: ProductionPlanOrderDTO, batch: ProductionPlanBatchDTO): string | null {
  if (batch.totalMillisecondsSnapshot) return batch.totalMillisecondsSnapshot;
  const unitMilliseconds = batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order);
  return unitMilliseconds ? String(unitMilliseconds * batch.quantity) : null;
}

function priorityText(priority: ProductionPlanPriority): string {
  if (priority === 'insert') return '插单';
  if (priority === 'urgent') return '紧急';
  return '一般';
}

function releaseText(
  state: ProductionPlanBatchDTO['releaseState'],
  weekStartDate?: string,
  currentWeekStartDate?: string,
): string {
  if (state === 'preparation') return '下周预备';
  if (state === 'active') {
    if (weekStartDate && currentWeekStartDate && weekStartDate < currentWeekStartDate) return '遗留执行';
    return '本周执行';
  }
  if (state === 'archived') return '历史归档';
  return '排程草稿';
}

function preparationText(batch: ProductionPlanBatchDTO): string {
  if (batch.warehouseStatus === 'exception') return '仓库异常';
  if (batch.warehouseStatus !== 'completed') return '待配料';
  if (batch.processStatus === 'not_created' || batch.processStatus === 'draft') return '待工艺';
  return '准备完成';
}

function changeActionText(action: string): string {
  const labels: Record<string, string> = {
    create_plan_order: '新建订单', update_plan_order: '修改订单', update_released_plan_order: '变更已下达订单',
    delete_plan_order: '删除订单', create_plan_batch: '新增排产批次', update_plan_batch: '调整排产',
    update_released_plan_batch: '调整已下达批次', delete_plan_batch: '删除排产批次',
    release_to_current_week: '下达本周执行', release_to_next_week: '下达下周预备', activate_preparation_week: '启用为本周执行',
    repair_active_plan_week_alignment: '修复执行周次',
  };
  return labels[action] || action;
}

async function responseBody<T>(response: Response): Promise<T & { error?: string; requiresConfirmation?: boolean; requiresProductRestore?: boolean }> {
  return response.json().catch(() => ({})) as Promise<T & { error?: string; requiresConfirmation?: boolean; requiresProductRestore?: boolean }>;
}

function productTimeHref(order: ProductionPlanOrderDTO, periods?: PlanningPayload['periods']): string {
  const params = new URLSearchParams();
  if (order.drawingLibraryItemId) params.set('itemId', order.drawingLibraryItemId);
  if (periods) {
    const hasCurrent = order.batches.some(batch => batch.weekStartDate === periods.current.weekStartDate);
    const hasNext = order.batches.some(batch => batch.weekStartDate === periods.next.weekStartDate);
    const hasCarryover = order.batches.some(batch => (
      batch.weekEndDate < periods.current.weekStartDate && batch.releaseState !== 'archived'
    ));
    if (hasCurrent) params.set('scope', 'current');
    else if (hasNext) params.set('scope', 'next');
    else if (hasCarryover) params.set('scope', 'carryover');
  }
  const query = params.toString();
  return `/workspace/product-times${query ? `?${query}` : ''}`;
}

export default function PlanningCenterShell({ user }: { user: CurrentUserDTO }) {
  const [view, setView] = useState<PlanningView>('schedule');
  const [orders, setOrders] = useState<ProductionPlanOrderDTO[]>([]);
  const [summary, setSummary] = useState<ProductionPlanningSummaryDTO>(emptySummary);
  const [customers, setCustomers] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<ProductionPlanProductOptionDTO[]>([]);
  const [salespeople, setSalespeople] = useState<string[]>([]);
  const [periods, setPeriods] = useState<PlanningPayload['periods']>();
  const [keyword, setKeyword] = useState('');
  const [customer, setCustomer] = useState('');
  const [priority, setPriority] = useState<'all' | ProductionPlanPriority>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [expandedOrderId, setExpandedOrderId] = useState('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [orderDialog, setOrderDialog] = useState<{ mode: 'create' | 'edit'; orderId?: string } | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderForm>(emptyOrderForm);
  const [productKeyword, setProductKeyword] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productEntryMode, setProductEntryMode] = useState<ProductEntryMode>('select');
  const [activeProductIndex, setActiveProductIndex] = useState(-1);
  const [batchDialog, setBatchDialog] = useState<{ orderId: string; batchId?: string } | null>(null);
  const [batchDraft, setBatchDraft] = useState<BatchForm>({ quantity: '', unitSeconds: '', weekStartDate: '', plannedCompletionDate: '', reason: '' });
  const [releasePreview, setReleasePreview] = useState<ReleasePreview | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [activationPreview, setActivationPreview] = useState<ActivationPreview | null>(null);
  const [changes, setChanges] = useState<ProductionPlanChangeDTO[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const productPickerRef = useRef<HTMLDivElement>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const lastExternalRefreshRef = useRef(0);
  const activeDialog = Boolean(orderDialog || batchDialog || releasePreview || deletePreview || activationPreview);

  useModalLayer({
    open: activeDialog,
    layerRef: dialogRef,
    triggerRef: dialogTriggerRef,
    backgroundRef: mainRef,
    onClose: handleDialogEscape,
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/planning/orders', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await responseBody<PlanningPayload>(response);
        if (response.status === 401) { location.href = '/login'; return null; }
        if (!response.ok) throw new Error(body.error || '计划中心加载失败');
        return body;
      })
      .then(body => {
        if (!body) return;
        setOrders(body.orders || []);
        setSummary(body.summary || emptySummary);
        setCustomers(body.customers || []);
        setProductOptions(body.productOptions || []);
        setSalespeople(body.salespeople || []);
        setPeriods(body.periods);
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshToken]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!productPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || productPickerRef.current?.contains(event.target)) return;
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [productPickerOpen]);

  useEffect(() => {
    const refreshAfterExternalChange = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastExternalRefreshRef.current < 1200) return;
      lastExternalRefreshRef.current = now;
      setRefreshToken(value => value + 1);
    };
    window.addEventListener('focus', refreshAfterExternalChange);
    document.addEventListener('visibilitychange', refreshAfterExternalChange);
    return () => {
      window.removeEventListener('focus', refreshAfterExternalChange);
      document.removeEventListener('visibilitychange', refreshAfterExternalChange);
    };
  }, []);

  useEffect(() => {
    if (view !== 'changes') return;
    setChangesLoading(true);
    fetch('/api/planning/changes', { cache: 'no-store' })
      .then(async response => {
        const body = await responseBody<{ changes?: ProductionPlanChangeDTO[] }>(response);
        if (!response.ok) throw new Error(body.error || '变更记录加载失败');
        setChanges(body.changes || []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : '变更记录加载失败'))
      .finally(() => setChangesLoading(false));
  }, [view, refreshToken]);

  const allBatches = useMemo(() => orders.flatMap(order => order.batches.map(batch => ({ order, batch }))), [orders]);
  const selectedProduct = useMemo(
    () => productOptions.find(item => item.id === orderDraft.drawingLibraryItemId) || null,
    [orderDraft.drawingLibraryItemId, productOptions],
  );
  const orderDraftUnitMilliseconds = useMemo(() => {
    const minutes = Number(orderDraft.planningUnitMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : null;
  }, [orderDraft.planningUnitMinutes]);
  const orderDraftTotalMilliseconds = useMemo(() => {
    const quantity = Number(orderDraft.orderQuantity);
    return orderDraftUnitMilliseconds && Number.isInteger(quantity) && quantity > 0
      ? orderDraftUnitMilliseconds * quantity
      : null;
  }, [orderDraft.orderQuantity, orderDraftUnitMilliseconds]);
  const batchDraftUnitMilliseconds = useMemo(() => {
    const seconds = Number(batchDraft.unitSeconds);
    const milliseconds = Math.round(seconds * 1000);
    return Number.isFinite(seconds) && milliseconds > 0 && milliseconds <= 86_400_000
      ? milliseconds
      : null;
  }, [batchDraft.unitSeconds]);
  const batchDraftTotalMilliseconds = useMemo(() => {
    const quantity = Number(batchDraft.quantity);
    return batchDraftUnitMilliseconds && Number.isInteger(quantity) && quantity > 0
      ? batchDraftUnitMilliseconds * quantity
      : null;
  }, [batchDraft.quantity, batchDraftUnitMilliseconds]);
  const canSaveBatch = useMemo(() => {
    const quantity = Number(batchDraft.quantity);
    const timeIsValid = !batchDraft.unitSeconds.trim() || Boolean(batchDraftUnitMilliseconds);
    return Number.isInteger(quantity) && quantity > 0
      && Boolean(batchDraft.weekStartDate && batchDraft.plannedCompletionDate)
      && timeIsValid;
  }, [batchDraft.plannedCompletionDate, batchDraft.quantity, batchDraft.unitSeconds, batchDraft.weekStartDate, batchDraftUnitMilliseconds]);
  const visibleProductOptions = useMemo(() => {
    const word = productKeyword.trim().toLocaleLowerCase();
    const filtered = word
      ? productOptions.filter(item => [item.customerName, item.customerCode || '', item.specification, item.productName]
          .some(value => value.toLocaleLowerCase().includes(word)))
      : productOptions;
    return filtered.slice(0, 18);
  }, [productKeyword, productOptions]);
  useEffect(() => {
    setActiveProductIndex(current => visibleProductOptions.length
      ? Math.min(Math.max(current, 0), visibleProductOptions.length - 1)
      : -1);
  }, [visibleProductOptions]);
  const canSaveOrder = useMemo(() => {
    const productReady = productEntryMode === 'create'
      ? Boolean(orderDraft.customerName.trim() && orderDraft.specification.trim() && orderDraft.productName.trim())
      : Boolean(orderDraft.drawingLibraryItemId);
    const quantity = Number(orderDraft.orderQuantity);
    const timeIsValid = !orderDraft.planningUnitMinutes.trim()
      || Boolean(orderDraftUnitMilliseconds && orderDraftUnitMilliseconds <= 86_400_000);
    return productReady
      && Number.isInteger(quantity) && quantity > 0
      && Boolean(orderDraft.orderDate && orderDraft.customerDueDate)
      && timeIsValid;
  }, [orderDraft.customerDueDate, orderDraft.customerName, orderDraft.drawingLibraryItemId, orderDraft.orderDate, orderDraft.orderQuantity, orderDraft.planningUnitMinutes, orderDraft.productName, orderDraft.specification, orderDraftUnitMilliseconds, productEntryMode]);
  const filteredOrders = useMemo(() => {
    const word = keyword.trim().toLocaleLowerCase();
    return orders.filter(order => {
      if (customer && order.customerName !== customer) return false;
      if (priority !== 'all' && order.priority !== priority) return false;
      if (!word) return true;
      return [order.customerName, order.salesperson || '', order.productName, order.specification, order.remark || '']
        .some(value => value.toLocaleLowerCase().includes(word));
    });
  }, [orders, keyword, customer, priority]);
  const orderPool = filteredOrders.filter(order => order.remainingQuantity > 0 && order.status !== 'cancelled' && order.status !== 'completed');
  const scheduleRows = allBatches.filter(({ order, batch }) => {
    if (batch.releaseState === 'archived') return false;
    if (customer && order.customerName !== customer) return false;
    if (priority !== 'all' && order.priority !== priority) return false;
    const word = keyword.trim().toLocaleLowerCase();
    return !word || [order.customerName, order.salesperson || '', order.productName, order.specification].some(value => value.toLocaleLowerCase().includes(word));
  });
  const preparationRows = allBatches.filter(item => item.batch.releaseState === 'preparation'
    && (!periods || item.batch.weekStartDate === periods.next.weekStartDate));
  const historyRows = allBatches.filter(item => item.batch.releaseState === 'archived');

  function closeDialog(): void {
    setOrderDialog(null);
    setBatchDialog(null);
    setReleasePreview(null);
    setDeletePreview(null);
    setActivationPreview(null);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setError('');
  }

  function handleDialogEscape(): void {
    if (productPickerOpen && productPickerRef.current?.contains(document.activeElement)) {
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
      return;
    }
    closeDialog();
  }

  function openCreateOrder(trigger: HTMLElement): void {
    dialogTriggerRef.current = trigger;
    setOrderDraft(emptyOrderForm());
    setProductKeyword('');
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setOrderDialog({ mode: 'create' });
  }

  function openEditOrder(order: ProductionPlanOrderDTO, trigger: HTMLElement): void {
    dialogTriggerRef.current = trigger;
    setOrderDraft(orderForm(order));
    setProductKeyword(order.specification);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setOrderDialog({ mode: 'edit', orderId: order.id });
  }

  function selectProduct(option: ProductionPlanProductOptionDTO): void {
    setOrderDraft(current => {
      const previous = productOptions.find(item => item.id === current.drawingLibraryItemId);
      const keepSalesperson = Boolean(current.salesperson && previous?.customerName === option.customerName);
      return {
        ...current,
        drawingLibraryItemId: option.id,
        customerName: option.customerName,
        specification: option.specification,
        productName: option.productName,
        salesperson: keepSalesperson ? current.salesperson : option.recommendedSalesperson || '',
        planningUnitMinutes: previous?.id === option.id && current.planningUnitMinutes
          ? current.planningUnitMinutes
          : millisecondsInput(option.unitMilliseconds),
      };
    });
    setProductKeyword(option.specification);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
  }

  function clearProductSelection(openPicker = true): void {
    setOrderDraft(current => ({
      ...current,
      drawingLibraryItemId: '',
      customerName: '',
      salesperson: '',
      productName: '',
      specification: '',
      planningUnitMinutes: '',
    }));
    setProductKeyword('');
    setProductEntryMode('select');
    setProductPickerOpen(openPicker);
    setActiveProductIndex(-1);
    if (openPicker) window.requestAnimationFrame(() => productSearchInputRef.current?.focus());
  }

  function updateProductKeyword(value: string): void {
    if (orderDraft.drawingLibraryItemId && value !== selectedProduct?.specification) {
      setOrderDraft(current => ({
        ...current,
        drawingLibraryItemId: '',
        customerName: '',
        salesperson: '',
        productName: '',
        specification: '',
        planningUnitMinutes: '',
      }));
    }
    setProductKeyword(value);
    setProductPickerOpen(true);
    setActiveProductIndex(0);
  }

  function beginCreateProduct(): void {
    const specification = productKeyword.trim();
    setOrderDraft(current => ({
      ...current,
      drawingLibraryItemId: '',
      customerName: '',
      salesperson: '',
      productName: '',
      specification,
      planningUnitMinutes: '',
    }));
    setProductEntryMode('create');
    setProductPickerOpen(false);
    setActiveProductIndex(-1);
    setError('');
  }

  function handleProductSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!productPickerOpen) setProductPickerOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveProductIndex(current => {
        if (!visibleProductOptions.length) return -1;
        const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
        return (start + direction + visibleProductOptions.length) % visibleProductOptions.length;
      });
      return;
    }
    if (event.key === 'Enter' && productPickerOpen) {
      event.preventDefault();
      const option = visibleProductOptions[activeProductIndex] || visibleProductOptions[0];
      if (option) selectProduct(option);
      else if (orderDialog?.mode === 'create' && productKeyword.trim()) beginCreateProduct();
    }
  }

  function openBatch(order: ProductionPlanOrderDTO, trigger: HTMLElement, batch?: ProductionPlanBatchDTO): void {
    dialogTriggerRef.current = trigger;
    const defaultWeek = batch?.weekStartDate || periods?.next.weekStartDate || '';
    setBatchDraft({
      quantity: String(batch?.quantity || order.remainingQuantity || ''),
      unitSeconds: secondsInput(batch?.unitMillisecondsSnapshot || planningUnitMilliseconds(order)),
      weekStartDate: defaultWeek,
      plannedCompletionDate: batch?.plannedCompletionDate || periods?.next.weekEndDate || '',
      reason: '',
    });
    setBatchDialog({ orderId: order.id, batchId: batch?.id });
  }

  async function saveOrder(confirmImpact = false, restoreDrawingLibraryProduct = false): Promise<void> {
    if (!orderDialog) return;
    if (productEntryMode === 'select' && !orderDraft.drawingLibraryItemId) {
      setError('请选择图纸资料库产品，或创建新型号');
      return;
    }
    if (productEntryMode === 'create' && (!orderDraft.customerName.trim() || !orderDraft.specification.trim() || !orderDraft.productName.trim())) {
      setError('新型号必须填写客户、产品规格和产品名称');
      return;
    }
    if (orderDraft.planningUnitMinutes.trim() && (!orderDraftUnitMilliseconds || orderDraftUnitMilliseconds > 86_400_000)) {
      setError('请填写大于 0 且不超过 1440 分钟的单件产品工时');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const editing = orderDialog.mode === 'edit' && orderDialog.orderId;
      const response = await fetch(editing ? `/api/planning/orders/${orderDialog.orderId}` : '/api/planning/orders', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...orderDraft,
          planningUnitMilliseconds: orderDraftUnitMilliseconds,
          confirmImpact,
          createDrawingLibraryProduct: productEntryMode === 'create',
          restoreDrawingLibraryProduct,
        }),
      });
      const body = await responseBody<{
        order?: ProductionPlanOrderDTO;
        impact?: Record<string, number | boolean | string>;
        productAction?: 'existing' | 'created' | 'restored';
      }>(response);
      if (body.requiresConfirmation && !confirmImpact) {
        if (!orderDraft.reason.trim()) throw new Error('订单已经下达，请填写变更原因后再次保存');
        const confirmed = window.confirm('该订单已经下达，数量、交期或产品信息会同步到关联工单，但不会重置仓库和工艺进度。确认继续吗？');
        if (confirmed) await saveOrder(true);
        return;
      }
      if (body.requiresProductRestore && !restoreDrawingLibraryProduct) {
        const confirmed = window.confirm('该客户和规格已在图纸资料库回收站中。是否恢复该型号并继续创建订单？');
        if (confirmed) await saveOrder(confirmImpact, true);
        return;
      }
      if (!response.ok || !body.order) throw new Error(body.error || '计划订单保存失败');
      setToast(editing
        ? orderDraftUnitMilliseconds ? '计划订单已更新' : '计划订单已更新，工时待维护'
        : body.productAction === 'created'
          ? orderDraftUnitMilliseconds ? '订单已创建，新型号已进入图纸资料库' : '订单已创建并建档，工时待维护'
          : body.productAction === 'restored'
            ? orderDraftUnitMilliseconds ? '订单已创建，回收站型号已恢复' : '订单已创建并恢复型号，工时待维护'
            : orderDraftUnitMilliseconds ? '计划订单已创建' : '计划订单已创建，工时待维护');
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划订单保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder(order: ProductionPlanOrderDTO): Promise<void> {
    if (!window.confirm(`确认删除计划订单 ${order.specification}？仅未下达订单可以删除。`)) return;
    const response = await fetch(`/api/planning/orders/${order.id}`, { method: 'DELETE' });
    const body = await responseBody<Record<string, never>>(response);
    if (!response.ok) { setError(body.error || '删除计划订单失败'); return; }
    setToast('计划订单已删除');
    setRefreshToken(value => value + 1);
  }

  async function saveBatch(confirmImpact = false): Promise<void> {
    if (!batchDialog) return;
    if (batchDraft.unitSeconds.trim() && !batchDraftUnitMilliseconds) {
      setError('请填写大于 0 且不超过 86400 秒的单根工时');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const editing = Boolean(batchDialog.batchId);
      const response = await fetch(editing ? `/api/planning/batches/${batchDialog.batchId}` : `/api/planning/orders/${batchDialog.orderId}/batches`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...batchDraft, unitMilliseconds: batchDraftUnitMilliseconds, confirmImpact }),
      });
      const body = await responseBody<{ order?: ProductionPlanOrderDTO }>(response);
      if (body.requiresConfirmation && !confirmImpact) {
        if (!batchDraft.reason.trim()) throw new Error('该批次已经下达，请填写调整原因后再次保存');
        if (window.confirm('修改会同步关联生产工单，且保留现有仓库和工艺进度。确认继续吗？')) await saveBatch(true);
        return;
      }
      if (!response.ok || !body.order) throw new Error(body.error || '排产批次保存失败');
      setToast(batchDraftUnitMilliseconds
        ? editing ? '排产批次与总工时已调整' : '排产批次与总工时已创建'
        : editing ? '排产草稿已调整，工时待维护' : '排产草稿已创建，工时待维护');
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排产批次保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteBatch(batch: ProductionPlanBatchDTO): Promise<void> {
    if (!window.confirm(`确认删除第 ${batch.batchNo} 批排产？`)) return;
    const response = await fetch(`/api/planning/batches/${batch.id}`, { method: 'DELETE' });
    const body = await responseBody<Record<string, never>>(response);
    if (!response.ok) { setError(body.error || '删除排产批次失败'); return; }
    setSelectedBatchIds(current => current.filter(id => id !== batch.id));
    setToast('排产批次已删除');
    setRefreshToken(value => value + 1);
  }

  function toggleBatch(batchId: string): void {
    setSelectedBatchIds(current => current.includes(batchId) ? current.filter(id => id !== batchId) : [...current, batchId]);
  }

  async function previewRelease(target: ReleasePreview['target'], trigger: HTMLElement): Promise<void> {
    if (!selectedBatchIds.length) { setToast('请先勾选排产批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/release/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchIds: selectedBatchIds, target }),
      });
      const body = await responseBody<{ preview?: ReleasePreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '下达预检失败');
      setReleasePreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '下达预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitRelease(): Promise<void> {
    if (!releasePreview) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/release/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selectedBatchIds, target: releasePreview.target, confirmWarnings: true }),
      });
      const body = await responseBody<{ result?: { releasedCount: number; warningCount: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '计划下达失败');
      setToast(`${body.result.releasedCount} 个批次已${releasePreview.target === 'active' ? '下达本周执行' : '下达下周预备'}`);
      setSelectedBatchIds([]);
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划下达失败');
    } finally {
      setSaving(false);
    }
  }

  async function previewDeletion(trigger: HTMLElement): Promise<void> {
    if (!selectedBatchIds.length) { setToast('请先勾选要删除的计划批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/delete/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selectedBatchIds }),
      });
      const body = await responseBody<{ preview?: DeletePreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '删除计划预检失败');
      setDeletePreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitDeletion(): Promise<void> {
    if (!deletePreview) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/delete/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selectedBatchIds, confirm: true }),
      });
      const body = await responseBody<{ result?: { draftDeletedCount: number; withdrawnCount: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '删除计划失败');
      const messages = [
        body.result.draftDeletedCount ? `删除草稿 ${body.result.draftDeletedCount} 批` : '',
        body.result.withdrawnCount ? `撤回未开工计划 ${body.result.withdrawnCount} 批` : '',
      ].filter(Boolean);
      setToast(messages.join('，') || '所选计划已删除');
      setSelectedBatchIds([]);
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划失败');
    } finally {
      setSaving(false);
    }
  }

  async function previewActivation(trigger: HTMLElement): Promise<void> {
    const weekStartDate = periods?.next.weekStartDate || preparationRows[0]?.batch.weekStartDate;
    if (!weekStartDate) { setToast('当前没有下周预备批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    try {
      const response = await fetch('/api/planning/activate/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStartDate }),
      });
      const body = await responseBody<{ preview?: ActivationPreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '启用预检失败');
      setActivationPreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启用预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitActivation(): Promise<void> {
    if (!activationPreview) return;
    setSaving(true);
    try {
      const response = await fetch('/api/planning/activate/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStartDate: activationPreview.sourceWeekStartDate || activationPreview.weekStartDate,
          confirmWarnings: true,
        }),
      });
      const body = await responseBody<{ result?: { activated: number; archived: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '启用本周计划失败');
      setToast(`已启用 ${body.result.activated} 个批次，原本周 ${body.result.archived} 个批次已归档`);
      closeDialog();
      setView('schedule');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启用本周计划失败');
    } finally {
      setSaving(false);
    }
  }

  function selectAllDrafts(): void {
    const ids = scheduleRows.filter(item => item.batch.releaseState === 'draft').map(item => item.batch.id);
    setSelectedBatchIds(current => current.length === ids.length && ids.every(id => current.includes(id)) ? [] : ids);
  }

  const selectedQuantity = allBatches.filter(item => selectedBatchIds.includes(item.batch.id)).reduce((sum, item) => sum + item.batch.quantity, 0);
  const views: Array<{ id: PlanningView; label: string; icon: typeof ClipboardList; count?: number }> = [
    { id: 'schedule', label: '计划排程', icon: CalendarCheck2, count: summary.scheduledOrderCount },
    { id: 'orders', label: '订单池', icon: ClipboardList, count: summary.pendingOrderCount },
    { id: 'preparation', label: '下周预备', icon: PackageCheck, count: summary.preparationBatchCount },
    { id: 'changes', label: '插单与变更', icon: FilePenLine },
    { id: 'history', label: '历史计划', icon: History },
  ];

  return <>
    <main ref={mainRef} className="planning-center-shell hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref="/weekly-plan-center"
        subtitle="订单排程、下周准备与本周生产下达"
        menuItems={[]}
        hideHeader
        sidebarTriggerTargetId="planning-navigation-trigger"
      />

      <div className="planning-center-main">
        <header className="planning-titlebar">
          <div className="planning-navigation-trigger" id="planning-navigation-trigger" aria-label="平台导航入口" />
          <div className="planning-title-copy"><span>生产计划</span><h1>计划中心</h1><p>订单、排程、配料、工艺与生产下达</p></div>
          <nav aria-label="计划中心视图">
            {views.map(item => {
              const Icon = item.icon;
              return <button className={view === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => setView(item.id)}><Icon size={16} aria-hidden="true" /><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>;
            })}
          </nav>
          <button className="planning-refresh" type="button" title="刷新计划数据" aria-label="刷新计划数据" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={17} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
        </header>

        <section className="planning-period-ribbon" aria-label="本周与下周计划状态">
          <article className="current"><div><CalendarCheck2 aria-hidden="true" /><span><small>本周执行</small><strong>{periods ? `${periods.current.weekStartDate.slice(5)} - ${periods.current.weekEndDate.slice(5)}` : '加载中'}</strong></span></div><b>{summary.activeBatchCount}<small>批执行中</small></b><a href="/production">进入生产<ChevronRight size={14} /></a></article>
          <div className="planning-period-link"><span>提前准备</span><ArrowRight aria-hidden="true" /></div>
          <article className="next"><div><CalendarClock aria-hidden="true" /><span><small>下周预备</small><strong>{periods ? `${periods.next.weekStartDate.slice(5)} - ${periods.next.weekEndDate.slice(5)}` : '加载中'}</strong></span></div><b>{summary.preparationBatchCount}<small>批已下达</small></b><a href="/workspace/warehouse?scope=preparation">仓库配料<ChevronRight size={14} /></a></article>
          <div className="planning-readiness"><span><Warehouse size={15} />仓库异常 <b>{summary.warehouseExceptionCount}</b></span><span><Settings2 size={15} />待工艺 <b>{summary.processPendingCount}</b></span><span><ShieldAlert size={15} />缺工时 <b>{summary.missingProductTimeCount}</b></span></div>
        </section>

        <section className="planning-flowline" aria-label="计划下达流程">
          {[['01', '订单池', '录入实时订单', ClipboardList], ['02', '计划排程', '拆批与安排日期', Layers3], ['03', '仓库配料', '下周提前准备', Warehouse], ['04', '工艺编排', '产品路线与工时', Settings2], ['05', '启用生产', '人工切换本周', Factory]].map(([no, label, copy, IconValue], index) => {
            const Icon = IconValue as typeof ClipboardList;
            return <div key={String(no)}><i>{String(no)}</i><Icon size={18} aria-hidden="true" /><span><strong>{String(label)}</strong><small>{String(copy)}</small></span>{index < 4 && <ChevronRight size={14} aria-hidden="true" />}</div>;
          })}
        </section>

        <section className="planning-toolbar" aria-label="计划筛选和操作">
          <label className="planning-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、业务员、规格或品名" /></label>
          <select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(item => <option value={item} key={item}>{item}</option>)}</select>
          <select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} aria-label="筛选优先级"><option value="all">全部优先级</option><option value="insert">插单</option><option value="urgent">紧急</option><option value="normal">一般</option></select>
          <div className="planning-toolbar-actions">
            <a className="planning-secondary-action" href="/workspace/product-times" title="维护产品工序与工时"><Clock3 size={16} />产品工时</a>
            <button className="planning-primary-action" type="button" onClick={event => openCreateOrder(event.currentTarget)}><Plus size={17} />新建订单</button>
          </div>
        </section>

        {error && <div className="planning-error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}

        {view === 'schedule' && <section className="planning-schedule-workspace">
          <aside className="planning-order-pool">
            <header><div><span>待安排</span><h2>订单池</h2></div><b>{orderPool.length}</b></header>
            <div className="planning-pool-list hm-scroll-region" tabIndex={0}>
              {orderPool.map(order => <article className={`priority-${order.priority}`} key={order.id}>
                <div className="planning-pool-order"><span>{order.specification}</span><em>{priorityText(order.priority)}</em></div>
                <strong title={order.specification}>{order.specification}</strong>
                <p title={`${order.customerName} · ${order.productName}`}>{order.customerName}<small>{order.productName}</small></p>
                <dl><div><dt>未排数量</dt><dd>{order.remainingQuantity.toLocaleString()}</dd></div><div><dt>客户交期</dt><dd>{order.customerDueDate.slice(5)}</dd></div><div><dt>单件工时</dt><dd>{duration(planningUnitMilliseconds(order))}</dd></div></dl>
                <button type="button" onClick={event => openBatch(order, event.currentTarget)}><Plus size={15} />安排批次</button>
              </article>)}
              {!loading && !orderPool.length && <div className="planning-empty compact"><CheckCircle2 /><strong>订单池已安排完毕</strong><span>新增订单或调整筛选后继续排程。</span></div>}
            </div>
          </aside>

          <div className="planning-schedule-board">
            <header className="planning-board-heading"><div><span>排程清单</span><h2>本周与下周生产批次</h2></div><div><button type="button" onClick={selectAllDrafts}><Check size={15} />全选草稿</button><em>{scheduleRows.length} 批</em></div></header>
            <div className="planning-table-scroll hm-scroll-region" tabIndex={0}>
              <table className="planning-table">
                <thead><tr><th className="select-cell">选择</th><th>订单 / 产品</th><th>排产数量</th><th>生产周</th><th>内部完成</th><th>客户交期</th><th>单件 / 总工时</th><th>图纸</th><th>仓库</th><th>工艺</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>{scheduleRows.map(({ order, batch }) => <Fragment key={batch.id}>
                  <tr className={`state-${batch.releaseState} ${expandedOrderId === batch.id ? 'expanded' : ''}`}>
                    <td className="select-cell"><input type="checkbox" aria-label={`选择 ${order.specification} 第 ${batch.batchNo} 批`} checked={selectedBatchIds.includes(batch.id)} disabled={batch.releaseState === 'archived'} onChange={() => toggleBatch(batch.id)} /></td>
                    <td><button className="planning-product-link" type="button" title={`${order.specification} · ${order.productName}`} onClick={() => setExpandedOrderId(current => current === batch.id ? '' : batch.id)}><strong>{order.specification}</strong><span>{order.customerName} · {order.productName}</span><small>{order.salesperson ? `业务员 ${order.salesperson} · ` : ''}第 {batch.batchNo} 批</small></button></td>
                    <td><b>{batch.quantity.toLocaleString()}</b><small>订单 {order.orderQuantity.toLocaleString()}</small></td>
                    <td><strong>{batch.weekStartDate.slice(5)} - {batch.weekEndDate.slice(5)}</strong></td>
                    <td><strong>{batch.plannedCompletionDate.slice(5)}</strong></td>
                    <td><strong className={batch.plannedCompletionDate > order.customerDueDate ? 'danger-text' : ''}>{order.customerDueDate.slice(5)}</strong></td>
                    <td><strong>{duration(batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order))}</strong><small>{totalDuration(batchTotalMilliseconds(order, batch))}</small></td>
                    <td><span className={`planning-status ${order.drawingFileCount ? 'ready' : 'warning'}`}>{order.drawingFileCount ? `${order.drawingFileCount} 文件` : order.drawingLibraryItemId ? '待上传' : '未建档'}</span></td>
                    <td><span className={`planning-status status-${batch.warehouseStatus}`}>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus === 'exception' ? '异常' : batch.warehouseStatus === 'not_created' ? '未下达' : '待配料'}</span></td>
                    <td><span className={`planning-status status-${batch.processStatus}`}>{batch.processStatus === 'confirmed' || batch.processStatus === 'in_progress' || batch.processStatus === 'completed' ? '已确认' : batch.processStatus === 'not_created' ? '待生成' : '待编排'}</span></td>
                    <td><span className={`planning-release state-${batch.releaseState}`}>{releaseText(batch.releaseState, batch.weekStartDate, periods?.current.weekStartDate)}</span></td>
                    <td><div className="planning-row-actions"><button type="button" title="调整批次" aria-label="调整批次" onClick={event => openBatch(order, event.currentTarget, batch)}><Pencil size={15} /></button>{batch.releaseState === 'draft' && <button className="danger" type="button" title="删除批次" aria-label="删除批次" onClick={() => { void deleteBatch(batch); }}><Trash2 size={15} /></button>}<button type="button" title="展开详情" aria-label="展开详情" onClick={() => setExpandedOrderId(current => current === batch.id ? '' : batch.id)}><ChevronDown size={15} /></button></div></td>
                  </tr>
                  {expandedOrderId === batch.id && <tr className="planning-inspector-row" key={`${batch.id}-detail`}><td colSpan={12}><div className="planning-inline-inspector">
                    <div><span>订单信息</span><strong>{order.salesperson ? `业务员 ${order.salesperson}` : '业务员未设置'}</strong><small>{order.remark || '无备注'}</small></div>
                    <div><span>准备状态</span><strong>{preparationText(batch)}</strong><small>仓库 {batch.warehouseStatus} · 工艺 {batch.processStatus}</small></div>
                    <div><span>数据来源</span><strong>{order.currentProductTimeVersion ? `产品工时 V${order.currentProductTimeVersion}` : order.planningUnitMilliseconds ? '订单计划工时' : '工时待维护'}</strong><small>{order.currentProductTimeVersion ? '正式工序工时' : '计划估算，投产前仍需发布工序工时'}</small></div>
                    <nav><a href={order.drawingLibraryItemId ? `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId)}` : `/drawing-library?create=1&customerName=${encodeURIComponent(order.customerName)}&specification=${encodeURIComponent(order.specification)}&productName=${encodeURIComponent(order.productName)}`}>{order.drawingLibraryItemId ? '进入图纸档案' : '建立图纸档案'}</a><a href="/workspace/warehouse">仓库任务</a><a href={productTimeHref(order, periods)}>工艺与工时</a></nav>
                  </div></td></tr>}
                </Fragment>)}</tbody>
              </table>
              {!loading && !scheduleRows.length && <div className="planning-empty"><CalendarClock /><strong>还没有排产批次</strong><span>从左侧订单池选择产品并安排本周或下周批次。</span></div>}
            </div>
          </div>
        </section>}

        {view === 'orders' && <section className="planning-orders-view">
          <header><div><span>实时订单</span><h2>生产订单池</h2><p>订单变化直接在这里维护，不再依赖重复上传 Excel。</p></div><b>{filteredOrders.length} 单</b></header>
          <div className="planning-table-scroll hm-scroll-region" tabIndex={0}><table className="planning-table orders"><thead><tr><th>客户 / 产品</th><th>业务员</th><th>规格</th><th>数量</th><th>已排 / 未排</th><th>下单日期</th><th>客户交期</th><th>优先级</th><th>单件 / 总工时</th><th>操作</th></tr></thead><tbody>{filteredOrders.map(order => <tr key={order.id}><td><strong>{order.customerName}</strong><small>{order.productName}</small></td><td>{order.salesperson || '未设置'}</td><td><b>{order.specification}</b></td><td>{order.orderQuantity.toLocaleString()}</td><td><strong>{order.allocatedQuantity.toLocaleString()} / {order.remainingQuantity.toLocaleString()}</strong></td><td>{order.orderDate}</td><td>{order.customerDueDate}</td><td><span className={`planning-priority ${order.priority}`}>{priorityText(order.priority)}</span></td><td><span className={`planning-status ${planningUnitMilliseconds(order) ? 'ready' : 'warning'}`}>{duration(planningUnitMilliseconds(order))}<small>{totalDuration(order.planningTotalMilliseconds)}</small></span></td><td><div className="planning-row-actions text"><button type="button" onClick={event => openBatch(order, event.currentTarget)}><Plus size={14} />排产</button><button type="button" onClick={event => openEditOrder(order, event.currentTarget)}><Pencil size={14} />编辑</button><button className="danger" type="button" onClick={() => { void deleteOrder(order); }}><Trash2 size={14} />删除</button></div></td></tr>)}</tbody></table>{!loading && !filteredOrders.length && <div className="planning-empty"><ClipboardList /><strong>订单池为空</strong><span>点击右上角“新建订单”开始建立实时计划。</span></div>}</div>
        </section>}

        {view === 'preparation' && <section className="planning-preparation-view">
          <header><div><span>下周提前准备</span><h2>{periods ? `${periods.next.weekStartDate} 至 ${periods.next.weekEndDate}` : '下周预备清单'}</h2><p>仓库和工艺可先处理；只有人工启用后，工单才进入生产执行。</p></div><button className="planning-primary-action" type="button" disabled={!preparationRows.length || saving} onClick={event => { void previewActivation(event.currentTarget); }}><Factory size={16} />启用为本周执行</button></header>
          <div className="planning-preparation-grid"><section><div className="planning-prep-heading"><Warehouse /><span><strong>仓库配料</strong><small>{preparationRows.filter(item => item.batch.warehouseStatus === 'completed').length} / {preparationRows.length} 已完成</small></span><a href="/workspace/warehouse?scope=preparation">进入仓库</a></div>{preparationRows.map(({ order, batch }) => <article key={batch.id}><span className={`state-${batch.warehouseStatus}`}><Boxes /></span><div><strong>{order.specification}</strong><small>{order.customerName} · {batch.quantity.toLocaleString()} 件</small></div><em>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus === 'exception' ? '仓库异常' : '待配料'}</em></article>)}</section><section><div className="planning-prep-heading"><Settings2 /><span><strong>工艺准备</strong><small>{preparationRows.filter(item => item.batch.processStatus !== 'not_created' && item.batch.processStatus !== 'draft').length} / {preparationRows.length} 已确认</small></span><a href="/workspace/product-times?scope=next">维护工时</a></div>{preparationRows.map(({ order, batch }) => { const unitMilliseconds = batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order); return <article key={batch.id}><span className={`state-${batch.processStatus}`}><Settings2 /></span><div><strong>{order.specification}</strong><small>{unitMilliseconds ? `单根 ${duration(unitMilliseconds)}${order.currentProductTimeVersion ? '' : ' · 批次计划值'}` : '单根工时待维护'}</small></div><em>{batch.processStatus === 'confirmed' || batch.processStatus === 'in_progress' || batch.processStatus === 'completed' ? '已确认' : '待工艺'}</em></article>; })}</section></div>
          {!preparationRows.length && <div className="planning-empty"><PackageCheck /><strong>当前没有下周预备任务</strong><span>在计划排程中勾选批次，点击“下达下周预备”。</span></div>}
        </section>}

        {view === 'changes' && <section className="planning-changes-view"><header><div><span>可追溯变更</span><h2>插单与计划调整记录</h2><p>已下达订单修改后同步关联工单，同时保留仓库与工艺处理进度。</p></div><b>{changes.length} 条</b></header><div className="planning-change-list hm-scroll-region">{changes.map(change => <article key={change.id}><i><FilePenLine /></i><div><strong>{changeActionText(change.action)}</strong><span>{change.actor?.displayName || change.actor?.username || '系统'} · {new Date(change.createdAt).toLocaleString('zh-CN')}</span><p>{change.reason || '常规计划操作'}</p></div><em>{change.planOrderId ? '订单变更' : '计划操作'}</em></article>)}{changesLoading && <div className="planning-loading">正在加载变更记录...</div>}{!changesLoading && !changes.length && <div className="planning-empty"><History /><strong>暂无计划变更</strong><span>新增、排程和下达操作会自动记录。</span></div>}</div></section>}

        {view === 'history' && <section className="planning-history-view"><header><div><span>已完成生产周</span><h2>历史计划</h2><p>历史批次只读展示，不影响当前生产数据。</p></div><b>{historyRows.length} 批</b></header><div className="planning-table-scroll hm-scroll-region"><table className="planning-table"><thead><tr><th>规格</th><th>客户 / 品名</th><th>业务员</th><th>批次数量</th><th>生产周</th><th>计划完成</th><th>仓库</th><th>工艺</th><th>关联工单</th></tr></thead><tbody>{historyRows.map(({ order, batch }) => <tr key={batch.id}><td><strong>{order.specification}</strong></td><td><strong>{order.customerName}</strong><small>{order.productName}</small></td><td>{order.salesperson || '未设置'}</td><td>{batch.quantity.toLocaleString()}</td><td>{batch.weekStartDate} - {batch.weekEndDate}</td><td>{batch.plannedCompletionDate}</td><td>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus}</td><td>{batch.processStatus}</td><td>{batch.workOrderId ? <a href={`/dashboard?workOrderId=${encodeURIComponent(batch.workOrderId)}`}>查看工单</a> : '-'}</td></tr>)}</tbody></table>{!historyRows.length && <div className="planning-empty"><History /><strong>暂无历史计划</strong><span>人工切换生产周后，原本周计划会归档到这里。</span></div>}</div></section>}

        {selectedBatchIds.length > 0 && <div className="planning-selection-bar"><div><CheckCircle2 /><span><strong>已选 {selectedBatchIds.length} 个批次</strong><small>合计 {selectedQuantity.toLocaleString()} 件</small></span></div><button type="button" className="danger-action" disabled={saving} onClick={event => { void previewDeletion(event.currentTarget); }}><Trash2 size={16} />删除计划</button><button type="button" className="secondary" disabled={saving} onClick={event => { void previewRelease('preparation', event.currentTarget); }}><PackageCheck size={16} />下达下周预备</button><button type="button" className="primary" disabled={saving} onClick={event => { void previewRelease('active', event.currentTarget); }}><Send size={16} />下达本周执行</button><button type="button" aria-label="清除选择" title="清除选择" onClick={() => setSelectedBatchIds([])}><X size={16} /></button></div>}
      </div>
    </main>

    {activeDialog && <button className="planning-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={closeDialog} />}

    {orderDialog && <div ref={dialogRef} className="planning-dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-order-dialog-title">
      <header><div><span>{orderDialog.mode === 'create' ? '实时订单池' : '订单变更'}</span><h2 id="planning-order-dialog-title">{orderDialog.mode === 'create' ? '新建计划订单' : '编辑计划订单'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <div className="planning-form-grid">
          <div
            ref={productPickerRef}
            className={`planning-product-picker wide mode-${productEntryMode}`}
            onBlur={event => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
              setProductPickerOpen(false);
              setActiveProductIndex(-1);
            }}
          >
            {productEntryMode === 'select' ? <>
              <label htmlFor="planning-product-search">选择图纸资料库产品 *</label>
              <div className="planning-product-search">
                <Search size={18} />
                <input
                  ref={productSearchInputRef}
                  id="planning-product-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={productPickerOpen}
                  aria-controls="planning-product-results"
                  aria-activedescendant={productPickerOpen && activeProductIndex >= 0 ? `planning-product-option-${visibleProductOptions[activeProductIndex]?.id}` : undefined}
                  value={productKeyword}
                  onFocus={() => setProductPickerOpen(true)}
                  onChange={event => updateProductKeyword(event.target.value)}
                  onKeyDown={handleProductSearchKeyDown}
                  placeholder="搜索客户、规格或产品名称"
                />
                <div className="planning-product-search-actions">
                  {(productKeyword || orderDraft.drawingLibraryItemId) && <button type="button" aria-label="清除所选产品" title="清除所选产品" onClick={() => clearProductSelection()}><X size={16} /></button>}
                  <button type="button" aria-label={productPickerOpen ? '收起产品列表' : '展开产品列表'} title={productPickerOpen ? '收起产品列表' : '展开产品列表'} onClick={() => { setProductPickerOpen(value => !value); setActiveProductIndex(0); productSearchInputRef.current?.focus(); }}><ChevronDown size={17} /></button>
                </div>
              </div>
              {productPickerOpen && <div id="planning-product-results" className="planning-product-results" role="listbox" aria-label="图纸资料库产品">
                {visibleProductOptions.map((option, index) => <button
                  id={`planning-product-option-${option.id}`}
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeProductIndex || option.id === orderDraft.drawingLibraryItemId}
                  onPointerMove={() => setActiveProductIndex(index)}
                  onClick={() => selectProduct(option)}
                >
                  <span><strong>{option.specification}</strong><small>{option.customerName} · {option.productName}</small></span>
                  <em>{option.publishedProductTimeVersion ? `工时 V${option.publishedProductTimeVersion}` : '工时待发布'}</em>
                </button>)}
                {!visibleProductOptions.length && <div className="planning-product-empty">
                  <strong>没有匹配的图纸产品</strong>
                  <span>可以直接建立新型号，订单会自动与图纸资料库绑定。</span>
                  {orderDialog.mode === 'create' && productKeyword.trim() && <button type="button" onClick={beginCreateProduct}><Plus size={15} />创建新型号“{productKeyword.trim()}”</button>}
                  <a href="/drawing-library">前往图纸资料库</a>
                </div>}
              </div>}
              {selectedProduct && <section className="planning-selected-product">
                <div><span>已绑定图纸产品</span><strong title={selectedProduct.specification}>{selectedProduct.specification}</strong><small>{selectedProduct.customerName} · {selectedProduct.productName}</small></div>
                <div><span>原图 {selectedProduct.drawingFileCount}</span><span>SOP {selectedProduct.sopFileCount}</span><span className={selectedProduct.publishedProductTimeVersion ? 'ready' : 'warning'}>{selectedProduct.publishedProductTimeVersion ? `工时 V${selectedProduct.publishedProductTimeVersion}` : '工时待发布'}</span><button type="button" onClick={() => clearProductSelection()}><Search size={14} />更换</button></div>
              </section>}
            </> : <section className="planning-new-product-mode">
              <div><span>新型号建档</span><strong>{orderDraft.specification || '请填写产品规格'}</strong><small>保存订单时同步建立空白图纸资料项；图纸和正式产品工时仍需后续维护。</small></div>
              <button type="button" onClick={() => clearProductSelection()}><Search size={15} />选择已有产品</button>
            </section>}
          </div>
          <label><span>客户{productEntryMode === 'create' ? ' *' : ''}</span><input list={productEntryMode === 'create' ? 'planning-customer-list' : undefined} value={orderDraft.customerName} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, customerName: event.target.value }))} /><datalist id="planning-customer-list">{customers.map(item => <option value={item} key={item} />)}</datalist></label>
          <label><span>业务员</span><input list="planning-salesperson-list" value={orderDraft.salesperson} onChange={event => setOrderDraft(current => ({ ...current, salesperson: event.target.value }))} placeholder="按同客户最近订单推荐，可修改" /><datalist id="planning-salesperson-list">{salespeople.map(item => <option value={item} key={item} />)}</datalist></label>
          <label><span>产品规格{productEntryMode === 'create' ? ' *' : ''}</span><input value={orderDraft.specification} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, specification: event.target.value }))} /></label>
          <label><span>产品名称{productEntryMode === 'create' ? ' *' : ''}</span><input value={orderDraft.productName} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, productName: event.target.value }))} /></label>
          <label><span>订单数量 *</span><input type="number" min="1" value={orderDraft.orderQuantity} onChange={event => setOrderDraft(current => ({ ...current, orderQuantity: event.target.value }))} /></label>
          <label><span>单件产品工时（分钟）</span><input type="number" min="0.001" max="1440" step="0.001" value={orderDraft.planningUnitMinutes} onChange={event => setOrderDraft(current => ({ ...current, planningUnitMinutes: event.target.value }))} /><small>可暂不填写并进入订单池；下达本周或下周计划前必须补齐</small></label>
          <label className="planning-total-time"><span>订单总工时</span><output>{orderDraftTotalMilliseconds ? duration(orderDraftTotalMilliseconds) : '待维护'}</output><small>{orderDraftTotalMilliseconds ? '单件工时 × 订单数量' : '补齐单件工时后自动计算'}</small></label>
          <label><span>优先级</span><select value={orderDraft.priority} onChange={event => setOrderDraft(current => ({ ...current, priority: event.target.value as ProductionPlanPriority }))}><option value="normal">一般</option><option value="urgent">紧急</option><option value="insert">插单</option></select></label>
          <label><span>下单日期 *</span><input type="date" value={orderDraft.orderDate} onChange={event => setOrderDraft(current => ({ ...current, orderDate: event.target.value }))} /></label>
          <label><span>客户交期 *</span><input type="date" value={orderDraft.customerDueDate} onChange={event => setOrderDraft(current => ({ ...current, customerDueDate: event.target.value }))} /></label>
          <label className="wide"><span>备注</span><textarea rows={3} value={orderDraft.remark} onChange={event => setOrderDraft(current => ({ ...current, remark: event.target.value }))} /></label>
          {orderDialog.mode === 'edit' && <label className="wide"><span>已下达订单变更原因</span><textarea rows={2} placeholder="修改已下达订单时必填" value={orderDraft.reason} onChange={event => setOrderDraft(current => ({ ...current, reason: event.target.value }))} /></label>}
        </div>
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="primary" disabled={saving || !canSaveOrder} onClick={() => { void saveOrder(); }}>{saving ? '保存中...' : productEntryMode === 'create' ? '保存订单并建档' : '保存订单'}</button></footer>
    </div>}

    {batchDialog && <div ref={dialogRef} className="planning-dialog batch-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-batch-dialog-title">
      <header><div><span>拆批排程</span><h2 id="planning-batch-dialog-title">{batchDialog.batchId ? '调整排产批次' : '安排生产批次'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <div className="planning-form-grid">
          <label><span>本批数量 *</span><input type="number" min="1" value={batchDraft.quantity} onChange={event => setBatchDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
          <label><span>单根工时（秒）</span><input type="number" min="0.001" max="86400" step="0.001" value={batchDraft.unitSeconds} onChange={event => setBatchDraft(current => ({ ...current, unitSeconds: event.target.value }))} /><small>草稿可暂不填写；下达本周或下周计划前必须补齐</small></label>
          <label><span>生产周 *</span><input type="date" value={batchDraft.weekStartDate} onChange={event => setBatchDraft(current => ({ ...current, weekStartDate: event.target.value }))} /></label>
          <label><span>内部计划完成日期 *</span><input type="date" value={batchDraft.plannedCompletionDate} onChange={event => setBatchDraft(current => ({ ...current, plannedCompletionDate: event.target.value }))} /></label>
          <label className="wide planning-total-time"><span>本批总工时</span><output>{batchDraftTotalMilliseconds ? duration(batchDraftTotalMilliseconds) : '待维护'}</output><small>{batchDraftTotalMilliseconds ? '单根工时 × 本批数量，保存后用于下达与生产工时统计' : '可先保存排程草稿，下达周计划前补齐工时'}</small></label>
          {batchDialog.batchId && <label className="wide"><span>已下达批次调整原因</span><textarea rows={2} placeholder="如果批次已经下达，此项必填" value={batchDraft.reason} onChange={event => setBatchDraft(current => ({ ...current, reason: event.target.value }))} /></label>}
        </div>
        <div className="planning-dialog-note"><CalendarClock /><span><strong>{batchDraftUnitMilliseconds ? '批次工时随排程冻结' : '先排程，后补工时'}</strong><small>{batchDraftUnitMilliseconds ? '保存后会把单根工时和本批总工时应用到当前批次；不会改写产品工时库。' : '当前仅保存排程草稿，不会进入本周执行或下周预备。'}</small></span></div>
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="primary" disabled={saving || !canSaveBatch} onClick={() => { void saveBatch(); }}>{saving ? '保存中...' : batchDraftUnitMilliseconds ? '保存并应用工时' : '保存排程草稿'}</button></footer>
    </div>}

    {releasePreview && <div ref={dialogRef} className="planning-dialog release-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-release-dialog-title"><header><div><span>下达预检</span><h2 id="planning-release-dialog-title">{releasePreview.target === 'active' ? '下达本周执行' : '下达下周预备'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header><div className="planning-dialog-body"><section className="planning-release-summary"><div><span>批次数</span><strong>{releasePreview.batchCount}</strong></div><div><span>目标生产周</span><strong>{releasePreview.targetWeekStartDate.slice(5)} - {releasePreview.targetWeekEndDate.slice(5)}</strong></div><div><span>总数量 / 提醒</span><strong className={releasePreview.warnings ? 'warning' : ''}>{releasePreview.totalQuantity.toLocaleString()} / {releasePreview.warnings}</strong></div></section>{releasePreview.target === 'preparation' && <div className="planning-dialog-note"><PackageCheck /><span><strong>只进入下周准备区</strong><small>生产周统一为 {releasePreview.targetWeekStartDate} 至 {releasePreview.targetWeekEndDate}，不会出现在本周生产执行中心。</small></span></div>}{releasePreview.target === 'active' && <div className="planning-dialog-note"><Factory /><span><strong>立即进入本周生产</strong><small>生产周统一为 {releasePreview.targetWeekStartDate} 至 {releasePreview.targetWeekEndDate}，并同步到关联工单、仓库和工艺任务。</small></span></div>}<div className="planning-warning-list">{releasePreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.quantity.toLocaleString()} 件</strong>{item.blockers.map(message => <span className="blocker" key={message}>{message}</span>)}{item.warnings.map(message => <span key={message}>{message}</span>)}{!item.blockers.length && !item.warnings.length && <span className="ready">资料检查通过</span>}</article>)}</div>{error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={closeDialog}>返回调整</button><button type="button" className="primary" disabled={saving || releasePreview.blockers > 0} onClick={() => { void commitRelease(); }}>{saving ? '下达中...' : '确认下达'}</button></footer></div>}

    {deletePreview && <div ref={dialogRef} className="planning-dialog delete-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-delete-dialog-title"><header><div><span>危险操作预检</span><h2 id="planning-delete-dialog-title">删除所选计划</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header><div className="planning-dialog-body"><section className="planning-release-summary four"><div><span>所选批次</span><strong>{deletePreview.batchCount}</strong></div><div><span>删除草稿</span><strong>{deletePreview.draftDeleteCount}</strong></div><div><span>撤回未开工</span><strong>{deletePreview.withdrawCount}</strong></div><div><span>禁止删除</span><strong className={deletePreview.blockers ? 'danger' : ''}>{deletePreview.blockers}</strong></div></section><div className="planning-dialog-note danger"><ShieldAlert /><span><strong>已开工计划不会被删除</strong><small>草稿会从排程中删除；已下达但未开工的计划会撤回并软删除关联工单。历史记录、图纸和对象存储文件全部保留。</small></span></div><div className="planning-warning-list">{deletePreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.quantity.toLocaleString()} 件</strong><span className={item.action === 'blocked' ? 'blocker' : item.action === 'withdraw_unstarted' ? 'warning' : 'ready'}>{item.message}</span></article>)}</div>{deletePreview.blockers > 0 && <div className="planning-dialog-error"><AlertTriangle />请取消勾选已开工或已完成的批次后再删除，本次不会处理任何批次。</div>}{error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="danger" disabled={saving || deletePreview.blockers > 0} onClick={() => { void commitDeletion(); }}>{saving ? '删除中...' : '确认删除计划'}</button></footer></div>}

    {activationPreview && <div ref={dialogRef} className="planning-dialog activation-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-activation-title"><header><div><span>生产周切换</span><h2 id="planning-activation-title">启用下周预备计划</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header><div className="planning-dialog-body"><section className="planning-release-summary"><div><span>生产周</span><strong>{activationPreview.weekStartDate.slice(5)} - {activationPreview.weekEndDate.slice(5)}</strong></div><div><span>批次 / 数量</span><strong>{activationPreview.batchCount} / {activationPreview.totalQuantity.toLocaleString()}</strong></div><div><span>阻断 / 提醒</span><strong className={activationPreview.blockerCount || activationPreview.warningCount ? 'warning' : ''}>{activationPreview.blockerCount} / {activationPreview.warningCount}</strong></div></section><div className="planning-dialog-note warning"><ShieldAlert /><span><strong>人工切换，不自动跨周</strong><small>缺少有效单根工时的批次不能进入生产；仓库或工艺未完成会保留提醒，但准备数据不会丢失。</small></span></div><div className="planning-warning-list">{activationPreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.customerName}</strong>{item.blockers.map(message => <span className="blocker" key={message}>{message}</span>)}{item.warnings.map(message => <span key={message}>{message}</span>)}{!item.blockers.length && !item.warnings.length && <span className="ready">工时、仓库与工艺准备完成</span>}</article>)}</div>{error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={closeDialog}>暂不启用</button><button type="button" className="primary" disabled={saving || activationPreview.blockerCount > 0} onClick={() => { void commitActivation(); }}>{saving ? '切换中...' : activationPreview.blockerCount > 0 ? '请先补充单根工时' : '确认启用为本周'}</button></footer></div>}

    {toast && <div className="planning-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </>;
}
