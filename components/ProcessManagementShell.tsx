'use client';

import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  ClipboardCheck,
  CopyPlus,
  GripVertical,
  ListChecks,
  LoaderCircle,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ProcessReferencePanel } from '@/components/process/ProcessReferencePanel';
import type {
  CurrentUserDTO,
  ProcessDefinitionDTO,
  ProcessRouteStatus,
  ProcessRouteSummaryDTO,
  ProcessRouteWorkOrderDTO,
  ProcessStageGroup,
  ProcessTemplateDTO,
  ProcessTemplateStepDTO,
  WarehouseWeekOptionDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';

type ShortcutGroup = { key: string; name: string; processCodes: string[] };
type ProcessFilterStatus = 'all' | 'missing' | 'active' | ProcessRouteStatus;

type ProcessPayload = {
  ok: boolean;
  summary: ProcessRouteSummaryDTO;
  orders: ProcessRouteWorkOrderDTO[];
  definitions: ProcessDefinitionDTO[];
  templates: ProcessTemplateDTO[];
  shortcutGroups: ShortcutGroup[];
  selectedWeekStart?: string | null;
  weeks: WarehouseWeekOptionDTO[];
  error?: string;
};

type EditableStep = ProcessTemplateStepDTO & { clientId: string };

type SortableRouteStepProps = {
  step: EditableStep;
  index: number;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onUnitsChange: (value: number) => void;
};

type SortableTemplateStepProps = {
  step: EditableStep;
  index: number;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onUnitsChange: (value: number) => void;
};

const emptySummary: ProcessRouteSummaryDTO = {
  total: 0,
  missing: 0,
  draft: 0,
  confirmed: 0,
  inProgress: 0,
  completed: 0,
};

const groupText: Record<ProcessStageGroup, string> = {
  frontend: '前端',
  backend: '后端',
  finish: '完工',
};

function dateText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function editableSteps(steps: ProcessTemplateStepDTO[]): EditableStep[] {
  return steps.map((step, index) => ({
    ...step,
    position: index + 1,
    clientId: step.id || `${step.processCode}-${index}-${Date.now()}`,
  }));
}

function orderTitle(order: ProcessRouteWorkOrderDTO): string {
  return order.specification?.trim() || order.code;
}

function routeStatusClass(route?: WorkOrderProcessRouteDTO | null): string {
  return route?.status || 'missing';
}

function routeStatusLabel(route?: WorkOrderProcessRouteDTO | null): string {
  return route?.statusText || '待编排';
}

function stepSignature(steps: ProcessTemplateStepDTO[]): string {
  return JSON.stringify(steps.map(step => ({
    processDefinitionId: step.processDefinitionId || null,
    processCode: step.processCode,
    processName: step.processName,
    stageGroup: step.stageGroup,
    unitsPerProduct: step.unitsPerProduct || 1,
  })));
}

function SortableRouteStep({
  step,
  index,
  selected,
  first,
  last,
  onSelect,
  onMove,
  onRemove,
  onUnitsChange,
}: SortableRouteStepProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.clientId });
  return (
    <article
      ref={setNodeRef}
      className={`process-step-row editable ${step.stageGroup} ${selected ? 'insert-selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
    >
      <div className="process-step-index">
        <button
          className="process-step-drag"
          type="button"
          aria-label={`拖动调整${step.processName}顺序`}
          title="拖动调整顺序"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" />
        </button>
        <b>{String(index + 1).padStart(2, '0')}</b>
      </div>
      <div className="process-step-name"><strong>{step.processName}</strong><span>{groupText[step.stageGroup]}</span></div>
      <label className="process-step-units" title="一套产品中该工序需要执行的次数">
        <span>每件次数</span>
        <input
          type="number"
          min="1"
          max="10000"
          value={step.unitsPerProduct || 1}
          onClick={event => event.stopPropagation()}
          onChange={event => onUnitsChange(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))}
        />
      </label>
      {selected && <span className="process-insert-anchor">插入点</span>}
      <div className="process-step-actions">
        <button type="button" disabled={first} aria-label={`上移${step.processName}`} title="上移" onClick={event => { event.stopPropagation(); onMove(-1); }}><ArrowUp aria-hidden="true" /></button>
        <button type="button" disabled={last} aria-label={`下移${step.processName}`} title="下移" onClick={event => { event.stopPropagation(); onMove(1); }}><ArrowDown aria-hidden="true" /></button>
        <button className="danger" type="button" aria-label={`删除${step.processName}`} title="删除工序" onClick={event => { event.stopPropagation(); onRemove(); }}><Trash2 aria-hidden="true" /></button>
      </div>
    </article>
  );
}

function SortableTemplateStep({
  step,
  index,
  first,
  last,
  onMove,
  onRemove,
  onUnitsChange,
}: SortableTemplateStepProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.clientId });
  return (
    <article ref={setNodeRef} className={isDragging ? 'dragging' : ''} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button className="process-template-drag" type="button" aria-label={`拖动调整${step.processName}顺序`} title="拖动调整顺序" {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>
      <b>{index + 1}</b>
      <span><strong>{step.processName}</strong><small>{groupText[step.stageGroup]}</small></span>
      <label className="process-template-units" title="一套产品中该工序需要执行的次数"><span>×</span><input type="number" min="1" max="10000" value={step.unitsPerProduct || 1} onChange={event => onUnitsChange(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))} /></label>
      <button type="button" disabled={first} aria-label={`上移${step.processName}`} title="上移" onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></button>
      <button type="button" disabled={last} aria-label={`下移${step.processName}`} title="下移" onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></button>
      <button className="danger" type="button" aria-label={`删除${step.processName}`} title="删除工序" onClick={onRemove}><Trash2 aria-hidden="true" /></button>
    </article>
  );
}

export default function ProcessManagementShell({ user }: { user: CurrentUserDTO }) {
  const [scope, setScope] = useState<'current' | 'history'>('current');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [status, setStatus] = useState<ProcessFilterStatus>('all');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState<ProcessPayload | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [routeDetail, setRouteDetail] = useState<WorkOrderProcessRouteDTO | null>(null);
  const [draftSteps, setDraftSteps] = useState<EditableStep[]>([]);
  const [draftHistory, setDraftHistory] = useState<EditableStep[][]>([]);
  const [insertAfterClientId, setInsertAfterClientId] = useState('');
  const [pendingOrder, setPendingOrder] = useState<ProcessRouteWorkOrderDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryStage, setLibraryStage] = useState<'all' | ProcessStageGroup>('all');
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDefault, setTemplateDefault] = useState(false);
  const [templateSteps, setTemplateSteps] = useState<EditableStep[]>([]);
  const [customName, setCustomName] = useState('');
  const [customGroup, setCustomGroup] = useState<ProcessStageGroup>('backend');
  const [templateCustomName, setTemplateCustomName] = useState('');
  const [templateCustomGroup, setTemplateCustomGroup] = useState<ProcessStageGroup>('backend');
  const [productionReturnHref, setProductionReturnHref] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const orderPanelRef = useRef<HTMLElement>(null);
  const ordersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const unsavedDialogRef = useRef<HTMLElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ scope, status });
    if (scope === 'history' && selectedWeek) params.set('weekStart', selectedWeek);
    if (query) params.set('keyword', query);
    setLoading(true);
    setError('');
    fetch(`/api/process-management?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as ProcessPayload;
        if (response.status === 401) { location.href = '/login'; return null; }
        if (!response.ok) throw new Error(body.error || '工艺管理数据加载失败');
        return body;
      })
      .then(body => {
        if (!body) return;
        setPayload(body);
        const search = new URLSearchParams(location.search);
        const requestedOrderId = search.get('workOrderId') || '';
        const returnKey = search.get('from') === 'production' ? search.get('returnKey') || '' : '';
        if (returnKey) setProductionReturnHref(`/production?returnKey=${encodeURIComponent(returnKey)}`);
        setSelectedOrderId(current => body.orders.some(order => order.id === requestedOrderId)
          ? requestedOrderId
          : body.orders.some(order => order.id === current)
            ? current
            : body.orders[0]?.id || '');
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scope, selectedWeek, status, query, refreshToken]);

  const selectedOrder = useMemo(
    () => payload?.orders.find(order => order.id === selectedOrderId) || null,
    [payload?.orders, selectedOrderId],
  );
  const selectedRouteId = selectedOrder?.route?.id || '';

  useEffect(() => {
    if (!selectedRouteId) {
      setRouteDetail(null);
      setDraftSteps([]);
      setDraftHistory([]);
      setInsertAfterClientId('');
      return;
    }
    const controller = new AbortController();
    setRouteLoading(true);
    setFormError('');
    fetch(`/api/process-management/routes/${selectedRouteId}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as {
          ok?: boolean;
          route?: WorkOrderProcessRouteDTO;
          error?: string;
        };
        if (!response.ok || !body.route) throw new Error(body.error || '工艺路线加载失败');
        return body.route;
      })
      .then(route => {
        setRouteDetail(route);
        setDraftSteps(editableSteps(route.steps));
        setDraftHistory([]);
        setInsertAfterClientId('');
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setFormError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });
    return () => controller.abort();
  }, [selectedRouteId, selectedOrderId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const editable = routeDetail?.status === 'draft' && scope === 'current';
  const draftDirty = Boolean(editable && routeDetail && stepSignature(draftSteps) !== stepSignature(routeDetail.steps));
  const draftChangeSummary = useMemo(() => {
    if (!routeDetail || !draftDirty) return '';
    const baseCodes = routeDetail.steps.map(step => step.processCode);
    const nextCodes = draftSteps.map(step => step.processCode);
    const baseSet = new Set(baseCodes);
    const nextSet = new Set(nextCodes);
    const added = nextCodes.filter(code => !baseSet.has(code)).length;
    const removed = baseCodes.filter(code => !nextSet.has(code)).length;
    const sharedBase = baseCodes.filter(code => nextSet.has(code));
    const sharedNext = nextCodes.filter(code => baseSet.has(code));
    const reordered = sharedBase.join('|') !== sharedNext.join('|');
    const details = [
      added ? `新增 ${added}` : '',
      removed ? `移除 ${removed}` : '',
      reordered ? '顺序已调整' : '',
    ].filter(Boolean);
    return details.join(' · ') || '路线内容已调整';
  }, [draftDirty, draftSteps, routeDetail]);

  useEffect(() => {
    if (!templateOpen) return;
    const main = mainRef.current;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('button, input, select')?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTemplateDrawer();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (main) main.inert = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [templateOpen]);

  useEffect(() => {
    if (!libraryOpen) return;
    const main = mainRef.current;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => libraryRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLibrary();
        return;
      }
      if (event.key !== 'Tab' || !libraryRef.current) return;
      const focusable = [...libraryRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (main) main.inert = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [libraryOpen]);

  useEffect(() => {
    if (!ordersOpen) return;
    window.requestAnimationFrame(() => orderPanelRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeOrders();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ordersOpen]);

  useEffect(() => {
    if (!pendingOrder) return;
    const main = mainRef.current;
    if (main) main.inert = true;
    window.requestAnimationFrame(() => unsavedDialogRef.current?.querySelector<HTMLElement>('button')?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPendingOrder(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (main) main.inert = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pendingOrder]);

  function switchOrderNow(order: ProcessRouteWorkOrderDTO): void {
    setSelectedOrderId(order.id);
    setFormError('');
    setPendingOrder(null);
    setOrdersOpen(false);
  }

  function selectOrder(order: ProcessRouteWorkOrderDTO): void {
    if (order.id === selectedOrderId) {
      setOrdersOpen(false);
      return;
    }
    if (draftDirty) {
      setPendingOrder(order);
      return;
    }
    switchOrderNow(order);
  }

  function openOrders(trigger: HTMLButtonElement): void {
    ordersTriggerRef.current = trigger;
    setOrdersOpen(true);
  }

  function closeOrders(): void {
    setOrdersOpen(false);
    window.requestAnimationFrame(() => ordersTriggerRef.current?.focus());
  }

  function openLibrary(trigger: HTMLButtonElement): void {
    libraryTriggerRef.current = trigger;
    setTemplateOpen(false);
    setLibraryOpen(true);
  }

  function closeLibrary(): void {
    setLibraryOpen(false);
    window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
  }

  function chooseSummary(nextStatus: ProcessFilterStatus): void {
    setStatus(nextStatus);
  }

  function resetFilters(): void {
    setStatus('all');
    setKeyword('');
  }

  function replaceStepPositions(steps: EditableStep[]): EditableStep[] {
    return steps.map((step, index) => ({ ...step, position: index + 1 }));
  }

  function commitDraft(nextSteps: EditableStep[]): void {
    const next = replaceStepPositions(nextSteps);
    if (stepSignature(next) === stepSignature(draftSteps)) return;
    setDraftHistory(current => [...current.slice(-11), draftSteps]);
    setDraftSteps(next);
  }

  function insertDraftSteps(additions: EditableStep[]): void {
    if (!additions.length) return;
    const anchorIndex = insertAfterClientId
      ? draftSteps.findIndex(step => step.clientId === insertAfterClientId)
      : draftSteps.length - 1;
    const insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : draftSteps.length;
    const next = [...draftSteps.slice(0, insertIndex), ...additions, ...draftSteps.slice(insertIndex)];
    commitDraft(next);
    setInsertAfterClientId(additions[additions.length - 1].clientId);
  }

  function moveStep(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= draftSteps.length) return;
    commitDraft(arrayMove(draftSteps, index, target));
  }

  function removeStep(index: number): void {
    const removed = draftSteps[index];
    const next = draftSteps.filter((_, itemIndex) => itemIndex !== index);
    commitDraft(next);
    if (removed?.clientId === insertAfterClientId) setInsertAfterClientId(next[Math.max(0, index - 1)]?.clientId || '');
  }

  function undoDraft(): void {
    const previous = draftHistory[draftHistory.length - 1];
    if (!previous) return;
    setDraftSteps(previous);
    setDraftHistory(current => current.slice(0, -1));
    setInsertAfterClientId('');
  }

  function onRouteDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    if (!overId || activeId === overId) return;
    const oldIndex = draftSteps.findIndex(step => step.clientId === activeId);
    const newIndex = draftSteps.findIndex(step => step.clientId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    commitDraft(arrayMove(draftSteps, oldIndex, newIndex));
    setInsertAfterClientId(activeId);
  }

  function onTemplateDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    if (!overId || activeId === overId) return;
    const oldIndex = templateSteps.findIndex(step => step.clientId === activeId);
    const newIndex = templateSteps.findIndex(step => step.clientId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    setTemplateSteps(replaceStepPositions(arrayMove(templateSteps, oldIndex, newIndex)));
  }

  function addDefinition(definition: ProcessDefinitionDTO): void {
    if (draftSteps.some(step => step.processCode === definition.code)) {
      setToast(`${definition.name} 已在路线中`);
      return;
    }
    insertDraftSteps([{
      clientId: `${definition.code}-${Date.now()}`,
      processDefinitionId: definition.id,
      processCode: definition.code,
      processName: definition.name,
      stageGroup: definition.stageGroup,
      position: 0,
      unitsPerProduct: 1,
    }]);
    setToast(`${definition.name} 已加入所选工序之后`);
  }

  function addShortcut(group: ShortcutGroup): void {
    const definitions = payload?.definitions || [];
    const codes = new Set(draftSteps.map(step => step.processCode));
    const additions = group.processCodes
      .map(code => definitions.find(definition => definition.code === code))
      .filter((item): item is ProcessDefinitionDTO => Boolean(item))
      .filter(item => !codes.has(item.code))
      .map(item => ({
        clientId: `${item.code}-${Date.now()}-${Math.random()}`,
        processDefinitionId: item.id,
        processCode: item.code,
        processName: item.name,
        stageGroup: item.stageGroup,
        position: 0,
        unitsPerProduct: 1,
      }));
    if (!additions.length) {
      setToast(`${group.name} 已完整加入`);
      return;
    }
    insertDraftSteps(additions);
    setToast(`${group.name} 已加入所选工序之后`);
  }

  function addCustomStep(): void {
    const name = customName.trim();
    if (!name) {
      setFormError('请填写自定义工序名称');
      return;
    }
    const code = `custom-${Date.now()}`;
    insertDraftSteps([{
      clientId: code,
      processDefinitionId: null,
      processCode: code,
      processName: name.slice(0, 60),
      stageGroup: customGroup,
      position: 0,
      unitsPerProduct: 1,
    }]);
    setCustomName('');
    setFormError('');
  }

  async function applyTemplate(template: ProcessTemplateDTO): Promise<void> {
    if (!selectedOrder) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/process-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderId: selectedOrder.id, templateId: template.id }),
      });
      const body = await response.json().catch(() => ({})) as {
        route?: WorkOrderProcessRouteDTO;
        error?: string;
      };
      if (!response.ok || !body.route) throw new Error(body.error || '应用工艺模板失败');
      setRouteDetail(body.route);
      setDraftSteps(editableSteps(body.route.steps));
      setDraftHistory([]);
      setInsertAfterClientId('');
      setRefreshToken(value => value + 1);
      setToast(`已应用 ${template.name} V${template.version}`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '应用工艺模板失败');
    } finally {
      setSaving(false);
    }
  }

  async function persistDraft(notify: boolean, refresh: boolean): Promise<WorkOrderProcessRouteDTO | null> {
    if (!routeDetail) return null;
    setFormError('');
    try {
      const response = await fetch(`/api/process-management/routes/${routeDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'replace_steps',
          version: routeDetail.version,
          steps: draftSteps.map(step => ({
            processDefinitionId: step.processDefinitionId,
            processCode: step.processCode,
            processName: step.processName,
            stageGroup: step.stageGroup,
            unitsPerProduct: step.unitsPerProduct || 1,
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        route?: WorkOrderProcessRouteDTO;
        error?: string;
      };
      if (!response.ok || !body.route) throw new Error(body.error || '保存工艺路线失败');
      setRouteDetail(body.route);
      setDraftSteps(editableSteps(body.route.steps));
      setDraftHistory([]);
      setInsertAfterClientId('');
      if (refresh) setRefreshToken(value => value + 1);
      if (notify) setToast('工艺路线草稿已保存');
      return body.route;
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存工艺路线失败');
      return null;
    }
  }

  async function saveDraft(): Promise<boolean> {
    if (!routeDetail) return false;
    setSaving(true);
    const saved = await persistDraft(true, true);
    setSaving(false);
    return Boolean(saved);
  }

  async function savePendingAndSwitch(): Promise<void> {
    if (!pendingOrder) return;
    setSaving(true);
    const saved = await persistDraft(false, true);
    setSaving(false);
    if (saved) switchOrderNow(pendingOrder);
  }

  async function confirmRoute(): Promise<void> {
    if (!routeDetail) return;
    setSaving(true);
    setFormError('');
    try {
      const routeToConfirm = draftDirty ? await persistDraft(false, false) : routeDetail;
      if (!routeToConfirm) return;
      const response = await fetch(`/api/process-management/routes/${routeToConfirm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', version: routeToConfirm.version }),
      });
      const body = await response.json().catch(() => ({})) as {
        route?: WorkOrderProcessRouteDTO;
        error?: string;
      };
      if (!response.ok || !body.route) throw new Error(body.error || '确认工艺路线失败');
      setRouteDetail(body.route);
      setDraftSteps(editableSteps(body.route.steps));
      setDraftHistory([]);
      setInsertAfterClientId('');
      setRefreshToken(value => value + 1);
      setToast(body.route.status === 'in_progress' ? '工艺路线已确认并开始首道工序' : '工艺路线已确认，等待图纸下发');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '确认工艺路线失败');
    } finally {
      setSaving(false);
    }
  }

  function openTemplateDrawer(trigger: HTMLButtonElement): void {
    const first = payload?.templates[0];
    if (!first) {
      setToast('暂无可编辑模板');
      return;
    }
    setLibraryOpen(false);
    drawerTriggerRef.current = trigger;
    setTemplateId(first.id);
    setTemplateName(first.name);
    setTemplateDefault(first.isDefault);
    setTemplateSteps(editableSteps(first.steps));
    setTemplateOpen(true);
  }

  function chooseTemplate(id: string): void {
    const template = payload?.templates.find(item => item.id === id);
    if (!template) return;
    setTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDefault(template.isDefault);
    setTemplateSteps(editableSteps(template.steps));
  }

  function addDefinitionToTemplate(definition: ProcessDefinitionDTO): void {
    setTemplateSteps(current => {
      if (current.some(step => step.processCode === definition.code)) return current;
      return replaceStepPositions([...current, {
        clientId: `template-${definition.code}-${Date.now()}`,
        processDefinitionId: definition.id,
        processCode: definition.code,
        processName: definition.name,
        stageGroup: definition.stageGroup,
        position: current.length + 1,
        unitsPerProduct: 1,
      }]);
    });
  }

  function addShortcutToTemplate(group: ShortcutGroup): void {
    const definitions = payload?.definitions || [];
    setTemplateSteps(current => {
      const codes = new Set(current.map(step => step.processCode));
      const additions = group.processCodes
        .map(code => definitions.find(definition => definition.code === code))
        .filter((item): item is ProcessDefinitionDTO => Boolean(item))
        .filter(item => !codes.has(item.code))
        .map(item => ({
          clientId: `template-${item.code}-${Date.now()}-${Math.random()}`,
          processDefinitionId: item.id,
          processCode: item.code,
          processName: item.name,
          stageGroup: item.stageGroup,
          position: 0,
          unitsPerProduct: 1,
        }));
      return replaceStepPositions([...current, ...additions]);
    });
  }

  function addCustomTemplateStep(): void {
    const name = templateCustomName.trim();
    if (!name) return;
    const code = `custom-${Date.now()}`;
    setTemplateSteps(current => replaceStepPositions([...current, {
      clientId: `template-${code}`,
      processDefinitionId: null,
      processCode: code,
      processName: name.slice(0, 60),
      stageGroup: templateCustomGroup,
      position: current.length + 1,
      unitsPerProduct: 1,
    }]));
    setTemplateCustomName('');
  }

  function closeTemplateDrawer(): void {
    setTemplateOpen(false);
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }

  async function saveTemplateVersion(): Promise<void> {
    if (!templateId) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/process-templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName,
          isDefault: templateDefault,
          steps: templateSteps.map(step => ({
            processDefinitionId: step.processDefinitionId,
            processCode: step.processCode,
            processName: step.processName,
            stageGroup: step.stageGroup,
            unitsPerProduct: step.unitsPerProduct || 1,
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        template?: ProcessTemplateDTO;
        error?: string;
      };
      if (!response.ok || !body.template) throw new Error(body.error || '模板新版本保存失败');
      setTemplateOpen(false);
      setRefreshToken(value => value + 1);
      setToast(`${body.template.name} V${body.template.version} 已保存`);
      window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '模板新版本保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  const summary = payload?.summary || emptySummary;
  const defaultTemplate = payload?.templates.find(template => template.isDefault) || payload?.templates[0] || null;
  const filteredDefinitions = useMemo(() => {
    const normalizedKeyword = libraryKeyword.trim().toLocaleLowerCase('zh-CN');
    return (payload?.definitions || []).filter(definition => {
      if (libraryStage !== 'all' && definition.stageGroup !== libraryStage) return false;
      if (!normalizedKeyword) return true;
      return `${definition.name} ${definition.code}`.toLocaleLowerCase('zh-CN').includes(normalizedKeyword);
    });
  }, [libraryKeyword, libraryStage, payload?.definitions]);

  return <>
    <main ref={mainRef} className="process-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/processes"
        subtitle="路线编排、图纸对照与工序流转"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />
      <div className="process-page-frame">
        <section className="process-summary" aria-label="工艺路线统计">
          <button className={status === 'all' ? 'active total' : 'total'} type="button" onClick={() => chooseSummary('all')}><ListChecks aria-hidden="true" /><span>本周工单<small>当前筛选范围</small></span><strong>{summary.total}</strong></button>
          <button className={status === 'missing' ? 'active missing' : 'missing'} type="button" onClick={() => chooseSummary('missing')}><CircleDashed aria-hidden="true" /><span>待编排<small>尚未生成路线</small></span><strong>{summary.missing}</strong></button>
          <button className={status === 'draft' ? 'active draft' : 'draft'} type="button" onClick={() => chooseSummary('draft')}><ClipboardCheck aria-hidden="true" /><span>待确认<small>工艺草稿</small></span><strong>{summary.draft}</strong></button>
          <button className={status === 'active' ? 'active progress' : 'progress'} type="button" onClick={() => chooseSummary('active')}><LoaderCircle aria-hidden="true" /><span>生产中<small>已确认路线</small></span><strong>{summary.confirmed + summary.inProgress}</strong></button>
          <button className={status === 'completed' ? 'active completed' : 'completed'} type="button" onClick={() => chooseSummary('completed')}><CheckCircle2 aria-hidden="true" /><span>已完成<small>路线全部完成</small></span><strong>{summary.completed}</strong></button>
        </section>

        <section className="process-toolbar" aria-label="工艺路线筛选">
          <button className="process-orders-toggle" type="button" ref={ordersTriggerRef} aria-expanded={ordersOpen} onClick={event => openOrders(event.currentTarget)}>
            {ordersOpen ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}工单
          </button>
          <div className="process-scope-tabs" role="tablist" aria-label="生产周范围">
            <button className={scope === 'current' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'current'} onClick={() => { setScope('current'); setSelectedWeek(''); }}>当前周</button>
            <button className={scope === 'history' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'history'} onClick={() => setScope('history')}>历史周</button>
          </div>
          {scope === 'history' && <label className="process-week-select"><span>生产周</span><select value={selectedWeek} onChange={event => setSelectedWeek(event.target.value)}><option value="">全部历史周</option>{payload?.weeks.filter(week => !week.active).map(week => <option value={week.weekStartDate} key={week.weekStartDate}>{dateText(week.weekStartDate)} - {dateText(week.weekEndDate)} · {week.taskCount} 单</option>)}</select></label>}
          <label className="process-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、品名或工单号" /></label>
          <button className="process-reset" type="button" onClick={resetFilters}><RotateCcw size={15} aria-hidden="true" />重置</button>
          <button className="process-library-toggle" type="button" title={libraryOpen ? '收起工序库' : '打开工序库'} aria-label={libraryOpen ? '收起工序库' : '打开工序库'} aria-expanded={libraryOpen} onClick={event => openLibrary(event.currentTarget)}>{libraryOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}工序库</button>
          <div className="process-toolbar-actions" aria-label="工艺管理操作">
            {productionReturnHref && <a className="hm-workbench-button" href={productionReturnHref} title="返回生产执行"><ArrowLeft size={15} aria-hidden="true" /><span>返回生产</span></a>}
            <a className="hm-workbench-button" href="/weekly-plan-center" title="打开周计划"><CalendarDays size={15} aria-hidden="true" /><span>周计划</span></a>
            <a className="hm-workbench-button" href="/workspace/time-standards" title="打开标准工时"><Clock3 size={15} aria-hidden="true" /><span>标准工时</span></a>
            <button className="hm-workbench-button" type="button" title="管理工艺模板" ref={drawerTriggerRef} onClick={event => openTemplateDrawer(event.currentTarget)}><Settings2 size={15} aria-hidden="true" /><span>模板</span></button>
            <button className="hm-workbench-button" type="button" title="刷新工艺数据" aria-label="刷新工艺数据" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
          </div>
        </section>

        {error && <div className="process-error" role="alert"><strong>加载失败</strong><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}

        <div className={`process-main-grid ${ordersOpen ? 'orders-open' : ''}`}>
          {ordersOpen && <button className="process-order-scrim" type="button" aria-label="关闭工单列表" onClick={closeOrders} />}
          <section ref={orderPanelRef} className={`process-order-panel ${ordersOpen ? 'open' : ''}`} aria-labelledby="process-order-heading">
            <header>
              <div><span>{scope === 'current' ? '当前生产周' : '历史生产周'}</span><h2 id="process-order-heading">待编排工单</h2></div>
              <div className="process-order-header-actions"><em>{payload?.orders.length || 0} 项</em><button type="button" aria-label="关闭工单列表" title="关闭" onClick={closeOrders}><X aria-hidden="true" /></button></div>
            </header>
            <div className="process-order-list hm-scroll-region" tabIndex={0}>
              {payload?.orders.map(order => <button className={`${selectedOrderId === order.id ? 'selected' : ''} ${routeStatusClass(order.route)}`} type="button" key={order.id} onClick={() => selectOrder(order)}>
                <span className={`process-route-state ${routeStatusClass(order.route)}`}>{routeStatusLabel(order.route)}</span>
                <strong title={order.customerName || '客户未设置'}>{order.customerName || '客户未设置'}</strong>
                <b title={orderTitle(order)}>{orderTitle(order)}</b>
                <small title={order.productName}>{order.productName}</small>
                <footer><span>{order.route ? `${order.route.completedStepCount}/${order.route.stepCount} 工序` : '尚未应用模板'}</span><time>{order.deliveryDay || dateText(order.plannedAt)}</time><ChevronRight size={15} aria-hidden="true" /></footer>
              </button>)}
              {loading && <div className="process-loading">正在加载工单...</div>}
              {!loading && !payload?.orders.length && <div className="process-empty"><ListChecks aria-hidden="true" /><strong>当前筛选没有工单</strong><span>切换生产周或清除筛选条件后再试。</span></div>}
            </div>
          </section>

          <ProcessReferencePanel order={selectedOrder} />

          <section className="process-route-panel" aria-labelledby="process-route-heading">
            {selectedOrder ? <>
              <header>
                <div><span>{selectedOrder.customerName || '客户未设置'}</span><h2 id="process-route-heading" title={orderTitle(selectedOrder)}>{orderTitle(selectedOrder)}</h2><small title={selectedOrder.productName}>{selectedOrder.productName}</small></div>
                <div className="process-route-header-meta"><span className={routeStatusClass(routeDetail)}>{routeStatusLabel(routeDetail)}</span><small>{selectedOrder.deliveryDay || dateText(selectedOrder.plannedAt)}</small></div>
              </header>
              {routeLoading && <div className="process-loading">正在加载工艺路线...</div>}
              {!routeLoading && !routeDetail && <div className="process-route-empty">
                <Sparkles aria-hidden="true" />
                <strong>该工单尚未生成工艺路线</strong>
                <span>建议先应用标准全工序模板，再按图纸删减、补充和调整顺序。</span>
                {scope === 'current' && defaultTemplate && <button className="primary-button" type="button" disabled={saving} onClick={() => { void applyTemplate(defaultTemplate); }}><CopyPlus size={16} aria-hidden="true" />应用 {defaultTemplate.name} V{defaultTemplate.version}</button>}
              </div>}
              {!routeLoading && routeDetail && <div className="process-route-body">
                <div className="process-route-overview">
                  <div><span>来源模板</span><strong>{routeDetail.templateName} V{routeDetail.templateVersion}</strong></div>
                  <div><span>工序进度</span><strong>{routeDetail.completedStepCount} / {routeDetail.stepCount}</strong></div>
                  <div><span>当前工序</span><strong>{routeDetail.currentStep?.processName || (routeDetail.status === 'confirmed' ? '等待图纸下发' : '-')}</strong></div>
                  <div><span>路线版本</span><strong>R{routeDetail.version}</strong></div>
                </div>
                <div className="process-route-progress"><i style={{ width: `${routeDetail.progress}%` }} /><span>{routeDetail.progress}%</span></div>
                {editable ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRouteDragEnd}>
                    <SortableContext items={draftSteps.map(step => step.clientId)} strategy={verticalListSortingStrategy}>
                      <div className="process-step-list hm-scroll-region" tabIndex={0} aria-label="工艺路线步骤，支持拖动或键盘调整顺序">
                        {draftSteps.map((step, index) => (
                          <SortableRouteStep
                            key={step.clientId}
                            step={step}
                            index={index}
                            first={index === 0}
                            last={index === draftSteps.length - 1}
                            selected={insertAfterClientId === step.clientId}
                            onSelect={() => setInsertAfterClientId(step.clientId)}
                            onMove={direction => moveStep(index, direction)}
                            onRemove={() => removeStep(index)}
                            onUnitsChange={value => commitDraft(draftSteps.map((item, itemIndex) => itemIndex === index ? { ...item, unitsPerProduct: value } : item))}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="process-step-list hm-scroll-region" tabIndex={0} aria-label="工艺路线步骤">
                    {routeDetail.steps.map((step, index) => (
                      <article className={`process-step-row ${step.status} ${step.stageGroup}`} key={step.id}>
                        <div className="process-step-index"><b>{String(index + 1).padStart(2, '0')}</b></div>
                        <div className="process-step-name"><strong>{step.processName}</strong><span>{groupText[step.stageGroup]}</span></div>
                        <span className="process-step-standard" title={step.standardMillisecondsPerUnit ? `标准版本 V${step.standardVersion || 1}` : '尚未定标'}>
                          {step.standardMillisecondsPerUnit
                            ? `${step.timeBasis === 'per_batch' ? '每批' : `每${step.unitLabel || '件'}`} ${step.standardMillisecondsPerUnit / 1000}秒 × ${step.unitsPerProduct || 1}`
                            : '待定标'}
                        </span>
                        <span className={`process-step-status ${step.status}`}>{step.status === 'current' ? '当前' : step.status === 'completed' ? '完成' : step.status === 'skipped' ? '跳过' : '待开始'}</span>
                        {step.completedAt && <small className="process-step-time">{dateTimeText(step.completedAt)}</small>}
                      </article>
                    ))}
                  </div>
                )}
                {editable && <div className="process-custom-step">
                  <input value={customName} onChange={event => setCustomName(event.target.value)} placeholder="自定义工序名称" maxLength={60} />
                  <select value={customGroup} onChange={event => setCustomGroup(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select>
                  <button type="button" onClick={addCustomStep}><Plus size={15} aria-hidden="true" />添加工序</button>
                </div>}
                {formError && <div className="process-form-error" role="alert">{formError}</div>}
                <footer className="process-route-actions">
                  {editable ? <>
                    <span className={draftDirty ? 'process-draft-state dirty' : 'process-draft-state'}>{draftDirty ? draftChangeSummary : '路线草稿已保存'}{insertAfterClientId ? ' · 新工序将插入所选项之后' : ''}</span>
                    <button type="button" disabled={saving || !draftHistory.length} onClick={undoDraft}><Undo2 size={16} aria-hidden="true" />撤销</button>
                    <button type="button" disabled={saving} onClick={event => openLibrary(event.currentTarget)}><PackagePlus size={16} aria-hidden="true" />添加工序</button>
                    <button type="button" disabled={saving || !draftDirty} onClick={() => { void saveDraft(); }}><Save size={16} aria-hidden="true" />保存草稿</button>
                    <button className="primary-button" type="button" disabled={saving || draftSteps.length === 0} onClick={() => { void confirmRoute(); }}><ClipboardCheck size={16} aria-hidden="true" />确认路线</button>
                  </> : <><a className="hm-workbench-button" href="/production">前往生产执行</a><span>已确认路线锁定，模板更新不会影响本工单。</span></>}
                </footer>
                {!!routeDetail.activities?.length && <section className="process-activity"><h3>路线记录</h3>{routeDetail.activities.slice(0, 8).map(activity => <article key={activity.id}><i /><div><strong>{activity.content || activity.action}</strong><span>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</span></div></article>)}</section>}
              </div>}
            </> : <div className="process-route-empty"><ListChecks aria-hidden="true" /><strong>请选择一张工单</strong><span>左侧选择工单后即可查看或编排完整工艺路线。</span></div>}
          </section>

        </div>
      </div>
    </main>

    {libraryOpen && <>
      <button className="process-drawer-scrim process-library-scrim" type="button" aria-label="关闭工序库" onClick={closeLibrary} />
      <aside ref={libraryRef} className="process-library-panel open" role="dialog" aria-modal="true" aria-labelledby="process-library-heading">
        <header><div><span>快捷编排</span><h2 id="process-library-heading">工序库</h2><small>{insertAfterClientId ? '新工序将插入当前选中工序之后' : '未选择插入点时，新工序追加到路线末尾'}</small></div><button type="button" aria-label="关闭工序库" title="关闭" onClick={closeLibrary}><X aria-hidden="true" /></button></header>
        <div className="process-library-body hm-scroll-region">
          <div className="process-library-tools">
            <label className="process-library-search">
              <Search size={15} aria-hidden="true" />
              <input value={libraryKeyword} onChange={event => setLibraryKeyword(event.target.value)} placeholder="搜索工序名称" />
            </label>
            <div className="process-library-filters" role="tablist" aria-label="工序阶段筛选">
              <button className={libraryStage === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={libraryStage === 'all'} onClick={() => setLibraryStage('all')}>全部</button>
              <button className={libraryStage === 'frontend' ? 'active' : ''} type="button" role="tab" aria-selected={libraryStage === 'frontend'} onClick={() => setLibraryStage('frontend')}>前端</button>
              <button className={libraryStage === 'backend' ? 'active' : ''} type="button" role="tab" aria-selected={libraryStage === 'backend'} onClick={() => setLibraryStage('backend')}>后端</button>
              <button className={libraryStage === 'finish' ? 'active' : ''} type="button" role="tab" aria-selected={libraryStage === 'finish'} onClick={() => setLibraryStage('finish')}>完工</button>
            </div>
          </div>
          <section><h3>快捷工序组</h3><div className="process-shortcuts">{payload?.shortcutGroups.map(group => <button type="button" key={group.key} disabled={!editable} onClick={() => addShortcut(group)}><Plus size={14} aria-hidden="true" />{group.name}</button>)}</div></section>
          <section>
            <h3>标准工序 <span>{filteredDefinitions.length}</span></h3>
            <div className="process-definition-list">
              {filteredDefinitions.map(definition => <button type="button" key={definition.id} disabled={!editable || draftSteps.some(step => step.processCode === definition.code)} onClick={() => addDefinition(definition)}><span><strong>{definition.name}</strong><small>{groupText[definition.stageGroup]} · {definition.currentStandard ? `${definition.currentStandard.standardMillisecondsPerUnit / 1000}秒/${definition.currentStandard.timeBasis === 'per_batch' ? '批' : definition.currentStandard.unitLabel}` : '待定标'}</small></span><Plus size={15} aria-hidden="true" /></button>)}
              {!filteredDefinitions.length && <div className="process-library-empty">没有符合条件的工序</div>}
            </div>
          </section>
          <section><h3>可用模板</h3><div className="process-template-list">{payload?.templates.map(template => <button type="button" key={template.id} disabled={Boolean(selectedOrder?.route) || scope !== 'current'} onClick={() => { void applyTemplate(template); closeLibrary(); }}><span><strong>{template.name}</strong><small>V{template.version} · {template.steps.length} 工序</small></span>{template.isDefault && <em>默认</em>}</button>)}</div></section>
        </div>
      </aside>
    </>}

    {templateOpen && <>
      <button className="process-drawer-scrim" type="button" aria-label="关闭模板管理" onClick={closeTemplateDrawer} />
      <aside ref={drawerRef} className="process-template-drawer" role="dialog" aria-modal="true" aria-labelledby="process-template-title">
        <header><div><span>版本化管理</span><h2 id="process-template-title">工艺模板</h2><small>保存时创建新版本，不影响已排产工单。</small></div><button type="button" aria-label="关闭模板管理" title="关闭" onClick={closeTemplateDrawer}><X aria-hidden="true" /></button></header>
        <div className="process-template-body hm-scroll-region">
          <label><span>当前模板</span><select value={templateId} onChange={event => chooseTemplate(event.target.value)}>{payload?.templates.map(template => <option value={template.id} key={template.id}>{template.name} V{template.version}</option>)}</select></label>
          <label><span>模板名称</span><input value={templateName} onChange={event => setTemplateName(event.target.value)} maxLength={80} /></label>
          <label className="process-default-check"><input type="checkbox" checked={templateDefault} onChange={event => setTemplateDefault(event.target.checked)} /><span>设为周计划默认模板</span></label>
          <section>
            <h3>模板工序顺序</h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTemplateDragEnd}>
              <SortableContext items={templateSteps.map(step => step.clientId)} strategy={verticalListSortingStrategy}>
                <div className="process-template-steps">
                  {templateSteps.map((step, index) => (
                    <SortableTemplateStep
                      key={step.clientId}
                      step={step}
                      index={index}
                      first={index === 0}
                      last={index === templateSteps.length - 1}
                      onMove={direction => setTemplateSteps(current => replaceStepPositions(arrayMove(current, index, index + direction)))}
                      onRemove={() => setTemplateSteps(current => replaceStepPositions(current.filter((_, itemIndex) => itemIndex !== index)))}
                      onUnitsChange={value => setTemplateSteps(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, unitsPerProduct: value } : item))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>
          <section className="process-template-additions"><h3>添加工序</h3><div className="process-template-shortcuts">{payload?.shortcutGroups.map(group => <button type="button" key={group.key} onClick={() => addShortcutToTemplate(group)}><Plus size={13} aria-hidden="true" />{group.name}</button>)}</div><div className="process-template-definitions">{payload?.definitions.map(definition => <button type="button" key={definition.id} disabled={templateSteps.some(step => step.processCode === definition.code)} onClick={() => addDefinitionToTemplate(definition)}>{definition.name}</button>)}</div><div className="process-template-custom"><input value={templateCustomName} onChange={event => setTemplateCustomName(event.target.value)} placeholder="其他工序名称" maxLength={60} /><select value={templateCustomGroup} onChange={event => setTemplateCustomGroup(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select><button type="button" onClick={addCustomTemplateStep}>添加</button></div></section>
          {formError && <div className="process-form-error" role="alert">{formError}</div>}
        </div>
        <footer><button type="button" disabled={saving} onClick={closeTemplateDrawer}>取消</button><button className="primary-button" type="button" disabled={saving || !templateName.trim() || !templateSteps.length} onClick={() => { void saveTemplateVersion(); }}>{saving ? '保存中...' : '保存为新版本'}</button></footer>
      </aside>
    </>}
    {pendingOrder && <div className="process-modal-backdrop" role="presentation">
      <section ref={unsavedDialogRef} className="process-unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="process-unsaved-title">
        <span>路线尚未保存</span>
        <h2 id="process-unsaved-title">切换到 {orderTitle(pendingOrder)}？</h2>
        <p>{draftChangeSummary || '当前路线有未保存调整'}。可以先保存草稿，也可以放弃本次调整。</p>
        <div>
          <button type="button" disabled={saving} onClick={() => setPendingOrder(null)}>取消</button>
          <button className="danger" type="button" disabled={saving} onClick={() => switchOrderNow(pendingOrder)}>放弃并切换</button>
          <button className="primary-button" type="button" disabled={saving} onClick={() => { void savePendingAndSwitch(); }}>{saving ? '保存中...' : '保存并切换'}</button>
        </div>
      </section>
    </div>}
    {toast && <div className="process-toast" role="status">{toast}</div>}
  </>;
}
