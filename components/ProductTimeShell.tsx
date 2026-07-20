'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  FileSpreadsheet,
  Library,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  ProductProcessTimeEntryDTO,
  ProductTimeListItemDTO,
  ProductTimePlanningScope,
  ProductTimePlanningSummaryDTO,
  ProductTimeProfileDTO,
  ProcessStageGroup,
} from '@/types';

type ProcessDefinition = {
  id: string;
  code: string;
  name: string;
  stageGroup: ProcessStageGroup;
  sortOrder: number;
};

type ProductTimeSummary = { total: number; published: number; draft: number; missing: number };
type CustomerOption = { customerName: string; count: number };
type ProductTimePayload = {
  ok: boolean;
  error?: string;
  items?: ProductTimeListItemDTO[];
  definitions?: ProcessDefinition[];
  customers?: CustomerOption[];
  summary?: ProductTimeSummary;
  planningScope?: ProductTimePlanningScope;
  planningSummary?: ProductTimePlanningSummaryDTO | null;
  periods?: {
    current: { weekStartDate: string; weekEndDate: string };
    next: { weekStartDate: string; weekEndDate: string };
  };
};

type EntryDraft = {
  processDefinitionId: string;
  unitSeconds: string;
  actionSeconds: string;
  occurrences: string;
  setupSeconds: string;
  countsForEfficiency: boolean;
  remark: string;
};

type ProductTimeImportEntry = {
  processDefinitionId: string;
  processName: string;
  unitSeconds: number;
  occurrences: number;
};

type ProductTimeImportRow = {
  rowNo: number;
  itemId: string | null;
  specification: string;
  customerName: string;
  productName: string;
  entries: ProductTimeImportEntry[];
  totalSeconds: number;
  status: 'ready' | 'invalid';
  warnings: string[];
};

type ProductTimeImportPreview = {
  fileName: string;
  sheetName: string;
  processColumns: string[];
  rows: ProductTimeImportRow[];
  summary: {
    total: number;
    ready: number;
    invalid: number;
    matchedProcessColumns: number;
  };
};

const emptySummary: ProductTimeSummary = { total: 0, published: 0, draft: 0, missing: 0 };
const stageText: Record<ProcessStageGroup, string> = { frontend: '前端', backend: '后端', finish: '完工' };

function seconds(value: number | null | undefined): string {
  if (!value) return '';
  return String(Math.round((value / 1000) * 1000) / 1000);
}

function duration(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) return `${Math.round(totalSeconds * 10) / 10} 秒`;
  const minutes = totalSeconds / 60;
  if (minutes >= 60) return `${Math.round((minutes / 60) * 100) / 100} 小时`;
  return `${Math.round(minutes * 10) / 10} 分钟`;
}

function previousWeekStart(): string {
  const value = new Date();
  const daysFromMonday = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - daysFromMonday - 7);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value);
}

function entryDraft(entry: ProductProcessTimeEntryDTO): EntryDraft {
  return {
    processDefinitionId: entry.processDefinitionId,
    unitSeconds: seconds(entry.unitMilliseconds),
    actionSeconds: seconds(entry.actionMilliseconds),
    occurrences: String(entry.occurrences || 1),
    setupSeconds: seconds(entry.setupMilliseconds) || '0',
    countsForEfficiency: entry.countsForEfficiency,
    remark: entry.remark || '',
  };
}

function draftTotal(entries: EntryDraft[]): number {
  return entries.reduce((total, entry) => {
    const direct = Number(entry.unitSeconds);
    const action = Number(entry.actionSeconds);
    const occurrences = Number(entry.occurrences || 1);
    const value = Number.isFinite(direct) && direct > 0
      ? direct
      : Number.isFinite(action) && action > 0 && Number.isFinite(occurrences) && occurrences > 0
        ? action * occurrences
        : 0;
    return total + Math.round(value * 1000);
  }, 0);
}

function statusText(item: ProductTimeListItemDTO): string {
  if (item.draft) return item.published ? '新版草稿' : '草稿';
  if (item.published) return `已发布 V${item.published.version}`;
  return '工时待维护';
}

export default function ProductTimeShell({ user }: { user: CurrentUserDTO }) {
  const [items, setItems] = useState<ProductTimeListItemDTO[]>([]);
  const [definitions, setDefinitions] = useState<ProcessDefinition[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [summary, setSummary] = useState<ProductTimeSummary>(emptySummary);
  const [planningSummary, setPlanningSummary] = useState<ProductTimePlanningSummaryDTO | null>(null);
  const [periods, setPeriods] = useState<ProductTimePayload['periods']>();
  const [planningScope, setPlanningScope] = useState<ProductTimePlanningScope>('all');
  const [historyWeekStart, setHistoryWeekStart] = useState(previousWeekStart);
  const [keyword, setKeyword] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [remark, setRemark] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryStage, setLibraryStage] = useState<'all' | ProcessStageGroup>('all');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessStage, setNewProcessStage] = useState<ProcessStageGroup>('backend');
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [matrixEditKey, setMatrixEditKey] = useState('');
  const [matrixEditValue, setMatrixEditValue] = useState('');
  const [matrixSavingKeys, setMatrixSavingKeys] = useState<string[]>([]);
  const [matrixCellError, setMatrixCellError] = useState<{ key: string; message: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductTimeImportPreview | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryCloseRef = useRef<HTMLButtonElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importCloseRef = useRef<HTMLButtonElement>(null);
  const initialSelectionRef = useRef(false);
  const itemsRef = useRef<ProductTimeListItemDTO[]>([]);
  const matrixSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const matrixCancelRef = useRef('');
  const matrixCommitRef = useRef('');
  const lastExternalRefreshRef = useRef(0);

  const selectedItem = items.find(item => item.id === selectedId) || items[0] || null;
  const activeDraft = selectedItem?.draft || null;
  const activePublished = selectedItem?.published || null;
  const activeProfile = activeDraft || activePublished;

  const load = useCallback(async (preferredItemId?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (customer) params.set('customer', customer);
      if (status !== 'all') params.set('status', status);
      if (planningScope !== 'all') params.set('scope', planningScope);
      if (planningScope === 'history') params.set('weekStartDate', historyWeekStart);
      const response = await fetch(`/api/product-time-profiles?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as ProductTimePayload;
      if (!response.ok) throw new Error(data.error || '产品工时加载失败');
      const nextItems = data.items || [];
      itemsRef.current = nextItems;
      setItems(nextItems);
      setDefinitions(data.definitions || []);
      setCustomers(data.customers || []);
      setSummary(data.summary || emptySummary);
      setPlanningSummary(data.planningSummary || null);
      setPeriods(data.periods);
      const urlItemId = new URLSearchParams(window.location.search).get('itemId') || '';
      const requested = preferredItemId || urlItemId || selectedId;
      setSelectedId(nextItems.some(item => item.id === requested) ? requested : nextItems[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时加载失败');
    } finally {
      setLoading(false);
    }
  }, [customer, historyWeekStart, keyword, planningScope, selectedId, status]);

  const changePlanningScope = useCallback((scope: ProductTimePlanningScope) => {
    setPlanningScope(scope);
    setStatus('all');
    const url = new URL(window.location.href);
    if (scope === 'all') url.searchParams.delete('scope');
    else url.searchParams.set('scope', scope);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!message) return undefined;
    const isQuickMatrixMessage = message === '已保存' || message.startsWith('已取消“');
    const timer = window.setTimeout(() => setMessage(''), isQuickMatrixMessage ? 1200 : 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(''), 4200);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!matrixCellError) return undefined;
    const timer = window.setTimeout(() => setMatrixCellError(null), 4200);
    return () => window.clearTimeout(timer);
  }, [matrixCellError]);

  useEffect(() => {
    const urlScope = new URLSearchParams(window.location.search).get('scope');
    if (urlScope === 'current' || urlScope === 'next' || urlScope === 'carryover' || urlScope === 'history') {
      setPlanningScope(urlScope);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 220);
    return () => window.clearTimeout(timer);
  }, [keyword, customer, historyWeekStart, planningScope, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refreshAfterExternalChange = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastExternalRefreshRef.current < 1200) return;
      lastExternalRefreshRef.current = now;
      void load();
    };
    window.addEventListener('focus', refreshAfterExternalChange);
    document.addEventListener('visibilitychange', refreshAfterExternalChange);
    return () => {
      window.removeEventListener('focus', refreshAfterExternalChange);
      document.removeEventListener('visibilitychange', refreshAfterExternalChange);
    };
  }, [load]);

  useEffect(() => {
    if (initialSelectionRef.current) return;
    initialSelectionRef.current = true;
    const itemId = new URLSearchParams(window.location.search).get('itemId') || '';
    if (itemId) setSelectedId(itemId);
  }, []);

  useEffect(() => {
    setEntries(activeProfile?.entries.map(entryDraft) || []);
    setRemark(activeProfile?.remark || '');
    setCopySourceId('');
    setDirty(false);
    setError('');
  }, [activeProfile, selectedItem?.id]);

  useEffect(() => {
    if (!libraryOpen && !importOpen && !detailOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      if (importOpen) importCloseRef.current?.focus();
      else if (libraryOpen && window.matchMedia('(max-width: 1500px)').matches) libraryCloseRef.current?.focus();
      else if (detailOpen) detailCloseRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [detailOpen, importOpen, libraryOpen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (importOpen) {
        setImportOpen(false);
        window.requestAnimationFrame(() => importTriggerRef.current?.focus());
        return;
      }
      if (libraryOpen) {
        setLibraryOpen(false);
        window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
        return;
      }
      if (detailOpen) {
        setDetailOpen(false);
        window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
      }
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [detailOpen, importOpen, libraryOpen]);

  const filteredDefinitions = useMemo(() => definitions.filter(definition => {
    if (entries.some(entry => entry.processDefinitionId === definition.id)) return false;
    if (libraryStage !== 'all' && definition.stageGroup !== libraryStage) return false;
    const normalized = libraryKeyword.trim().toLocaleLowerCase('zh-CN');
    return !normalized || `${definition.name} ${definition.code}`.toLocaleLowerCase('zh-CN').includes(normalized);
  }), [definitions, entries, libraryKeyword, libraryStage]);

  function openDetail(itemId: string, trigger: HTMLButtonElement): void {
    if (dirty && selectedItem?.id !== itemId && !window.confirm('当前产品工时尚未保存，确定切换产品吗？')) return;
    detailTriggerRef.current = trigger;
    setSelectedId(itemId);
    setDetailOpen(true);
  }

  function closeDetail(): void {
    if (dirty && !window.confirm('当前产品工时尚未保存，确定关闭详情吗？')) return;
    setDetailOpen(false);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }

  function matrixKey(itemId: string, definitionId: string): string {
    return `${itemId}:${definitionId}`;
  }

  function startMatrixEdit(item: ProductTimeListItemDTO, definition: ProcessDefinition): void {
    if (dirty) {
      setError('产品详情中有未保存修改，请先保存或关闭后再快速填写');
      return;
    }
    const profile = item.draft || item.published;
    const entry = profile?.entries.find(value => value.processDefinitionId === definition.id);
    const key = matrixKey(item.id, definition.id);
    if (matrixSavingKeys.includes(key)) return;
    setSelectedId(item.id);
    matrixCancelRef.current = '';
    matrixCommitRef.current = '';
    setMatrixEditKey(key);
    setMatrixEditValue(seconds(entry?.unitMilliseconds));
    setMatrixCellError(current => current?.key === key ? null : current);
    setError('');
  }

  function cancelMatrixEdit(key: string): void {
    matrixCancelRef.current = key;
    matrixCommitRef.current = '';
    setMatrixEditKey('');
    setMatrixEditValue('');
    setMatrixCellError(current => current?.key === key ? null : current);
  }

  function moveMatrixEditor(item: ProductTimeListItemDTO, definition: ProcessDefinition, direction: -1 | 1): void {
    const index = definitions.findIndex(value => value.id === definition.id);
    const nextDefinition = definitions[index + direction];
    if (!nextDefinition) return;
    window.setTimeout(() => startMatrixEdit(item, nextDefinition), 0);
  }

  function queueMatrixCellSave(itemId: string, definition: ProcessDefinition, value: number): void {
    const key = matrixKey(itemId, definition.id);
    setMatrixSavingKeys(current => current.includes(key) ? current : [...current, key]);
    matrixSaveQueueRef.current = matrixSaveQueueRef.current
      .catch(() => undefined)
      .then(() => persistMatrixCell(itemId, definition, value))
      .finally(() => setMatrixSavingKeys(current => current.filter(valueKey => valueKey !== key)));
  }

  async function persistMatrixCell(itemId: string, definition: ProcessDefinition, value: number): Promise<void> {
    const key = matrixKey(itemId, definition.id);
    const item = itemsRef.current.find(current => current.id === itemId);
    if (!item) {
      const failureMessage = '产品已不在当前列表，请刷新后重试';
      setMatrixCellError({ key, message: failureMessage });
      setError(failureMessage);
      return;
    }

    const profile = item.draft || item.published;
    const nextEntries = profile?.entries.map(entryDraft) || [];
    const definitionOrder = new Map(definitions.map((value, index) => [value.id, index]));
    const followsSharedOrder = nextEntries.every((entry, index) => index === 0
      || (definitionOrder.get(nextEntries[index - 1].processDefinitionId) ?? Number.MAX_SAFE_INTEGER)
        <= (definitionOrder.get(entry.processDefinitionId) ?? Number.MAX_SAFE_INTEGER));
    const existingIndex = nextEntries.findIndex(entry => entry.processDefinitionId === definition.id);
    if (value === 0 && existingIndex >= 0) nextEntries.splice(existingIndex, 1);
    else if (existingIndex >= 0) nextEntries[existingIndex] = { ...nextEntries[existingIndex], unitSeconds: String(value) };
    else if (value > 0) nextEntries.push({
      processDefinitionId: definition.id,
      unitSeconds: String(value),
      actionSeconds: '',
      occurrences: '1',
      setupSeconds: '0',
      countsForEfficiency: true,
      remark: '',
    });
    if (value > 0 && existingIndex < 0 && followsSharedOrder) {
      nextEntries.sort((left, right) => (definitionOrder.get(left.processDefinitionId) ?? Number.MAX_SAFE_INTEGER)
        - (definitionOrder.get(right.processDefinitionId) ?? Number.MAX_SAFE_INTEGER));
    }

    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: item.draft?.revision ?? null,
          remark: profile?.remark || '',
          sourceType: 'matrix',
          entries: nextEntries.map(entry => ({
            processDefinitionId: entry.processDefinitionId,
            unitSeconds: entry.unitSeconds,
            actionSeconds: entry.actionSeconds,
            occurrences: entry.occurrences,
            setupSeconds: entry.setupSeconds,
            countsForEfficiency: entry.countsForEfficiency,
            remark: entry.remark,
          })),
        }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; profile?: ProductTimeProfileDTO };
      if (!response.ok || !data.profile) throw new Error(data.error || '产品工时保存失败');
      const hadDraft = Boolean(item.draft);
      const wasMissing = !item.draft && !item.published;
      const nextItems = itemsRef.current.map(currentItem => currentItem.id === item.id
        ? { ...currentItem, draft: data.profile! }
        : currentItem);
      itemsRef.current = nextItems;
      setItems(nextItems);
      setSummary(current => ({
        ...current,
        draft: current.draft + (hadDraft ? 0 : 1),
        missing: Math.max(0, current.missing - (wasMissing ? 1 : 0)),
      }));
      setMatrixCellError(current => current?.key === key ? null : current);
      setMessage(value === 0 ? `已取消“${definition.name}”工序` : '已保存');
    } catch (reason) {
      const failureMessage = reason instanceof Error ? reason.message : '产品工时保存失败';
      setMatrixCellError({ key, message: failureMessage });
      setError(failureMessage);
    }
  }

  function saveMatrixCell(item: ProductTimeListItemDTO, definition: ProcessDefinition): void {
    const key = matrixKey(item.id, definition.id);
    if (matrixCancelRef.current === key) {
      matrixCancelRef.current = '';
      return;
    }
    if (matrixEditKey !== key) return;

    const profile = item.draft || item.published;
    const entry = profile?.entries.find(value => value.processDefinitionId === definition.id);
    const rawValue = matrixEditValue.trim();
    const value = Number(rawValue);
    const explicitlyCommitted = matrixCommitRef.current === key;
    matrixCommitRef.current = '';
    setMatrixEditKey('');
    setMatrixEditValue('');

    if (!rawValue) {
      setMatrixCellError(current => current?.key === key ? null : current);
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 86_400) {
      setMatrixCellError({ key, message: '请输入 0 至 86400 秒；输入 0 并按回车可取消工序' });
      return;
    }
    if (value === 0) {
      setMatrixCellError(current => current?.key === key ? null : current);
      if (explicitlyCommitted && entry) queueMatrixCellSave(item.id, definition, 0);
      return;
    }
    if (entry && Number(seconds(entry.unitMilliseconds)) === value) return;
    queueMatrixCellSave(item.id, definition, value);
  }

  function addDefinition(definition: ProcessDefinition): void {
    setEntries(current => [...current, {
      processDefinitionId: definition.id,
      unitSeconds: '',
      actionSeconds: '',
      occurrences: '1',
      setupSeconds: '0',
      countsForEfficiency: true,
      remark: '',
    }]);
    setDirty(true);
    setMessage(`${definition.name} 已加入产品工时表`);
  }

  function updateEntry(index: number, patch: Partial<EntryDraft>): void {
    setEntries(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
    setDirty(true);
  }

  function moveEntry(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    setEntries(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setDirty(true);
  }

  function removeEntry(index: number): void {
    setEntries(current => current.filter((_entry, entryIndex) => entryIndex !== index));
    setDirty(true);
  }

  function copyProfile(): void {
    const source = items.find(item => item.id === copySourceId)?.published || null;
    if (!source) {
      setError('请选择一个已发布产品作为复制来源');
      return;
    }
    setEntries(source.entries.map(entryDraft));
    setRemark(`参考产品工时 V${source.version}`);
    setDirty(true);
    setMessage(`已复制 ${source.processCount} 道工序，请检查后保存`);
  }

  async function createProcess(): Promise<void> {
    if (!newProcessName.trim()) {
      setError('请填写新工序名称');
      return;
    }
    setCreatingProcess(true);
    setError('');
    try {
      const response = await fetch('/api/process-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProcessName.trim(), stageGroup: newProcessStage }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; definition?: ProcessDefinition };
      if (!response.ok || !data.definition) throw new Error(data.error || '新增工序失败');
      setDefinitions(current => [...current, data.definition!]);
      addDefinition(data.definition);
      setNewProcessName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新增工序失败');
    } finally {
      setCreatingProcess(false);
    }
  }

  async function saveDraft(): Promise<ProductTimeProfileDTO | null> {
    if (!selectedItem) return null;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: activeDraft?.revision ?? null,
          remark,
          sourceType: copySourceId ? 'copied' : 'manual',
          entries: entries.map(entry => ({
            processDefinitionId: entry.processDefinitionId,
            unitSeconds: entry.unitSeconds,
            actionSeconds: entry.actionSeconds,
            occurrences: entry.occurrences,
            setupSeconds: entry.setupSeconds,
            countsForEfficiency: entry.countsForEfficiency,
            remark: entry.remark,
          })),
        }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; profile?: ProductTimeProfileDTO };
      if (!response.ok || !data.profile) throw new Error(data.error || '产品工时保存失败');
      setDirty(false);
      setMessage(`产品工时 V${data.profile.version} 草稿已保存`);
      await load(selectedItem.id);
      return data.profile;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish(): Promise<void> {
    if (!selectedItem || !activeDraft) {
      setError('请先保存产品工时草稿');
      return;
    }
    if (dirty) {
      setError('当前内容尚未保存，请先保存草稿再发布');
      return;
    }
    if (!window.confirm(`确认发布 ${selectedItem.specification} 产品工时 V${activeDraft.version}？已确认工单不会被反向修改。`)) return;
    setPublishing(true);
    setError('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: activeDraft.revision }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        profile?: ProductTimeProfileDTO;
        routeSync?: { updated: number; started: number; skipped: number };
      };
      if (!response.ok || !data.profile) throw new Error(data.error || '产品工时发布失败');
      const synced = data.routeSync?.updated || 0;
      setMessage(`产品工序与工时 V${data.profile.version} 已发布${synced ? `，已自动同步 ${synced} 张待执行工单` : ''}`);
      await load(selectedItem.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时发布失败');
    } finally {
      setPublishing(false);
    }
  }

  function closeImport(): void {
    if (importLoading || importCommitting) return;
    setImportOpen(false);
    window.requestAnimationFrame(() => importTriggerRef.current?.focus());
  }

  async function previewImport(file: File): Promise<void> {
    setImportLoading(true);
    setImportPreview(null);
    setError('');
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/product-time-profiles/import/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        fileName?: string;
        sheetName?: string;
        processColumns?: string[];
        rows?: ProductTimeImportRow[];
        summary?: ProductTimeImportPreview['summary'];
      };
      if (!response.ok || !data.fileName || !data.summary || !data.rows) {
        throw new Error(data.error || '产品工时表预览失败');
      }
      setImportPreview({
        fileName: data.fileName,
        sheetName: data.sheetName || '首个工作表',
        processColumns: data.processColumns || [],
        rows: data.rows,
        summary: data.summary,
      });
      setImportOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时表预览失败');
    } finally {
      setImportLoading(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function commitImport(): Promise<void> {
    const readyRows = importPreview?.rows.filter(row => row.status === 'ready' && row.itemId) || [];
    if (!readyRows.length) {
      setError('当前预览没有可导入的产品');
      return;
    }
    setImportCommitting(true);
    setError('');
    try {
      const response = await fetch('/api/product-time-profiles/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: readyRows.map(row => ({
            rowNo: row.rowNo,
            itemId: row.itemId,
            entries: row.entries,
          })),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        result?: { imported: number; createdDrafts: number; updatedDrafts: number };
      };
      if (!response.ok || !data.result) throw new Error(data.error || '产品工时导入失败');
      setImportOpen(false);
      setImportPreview(null);
      setMessage(`已导入 ${data.result.imported} 款产品工时草稿，请逐项检查后再发布`);
      await load(selectedItem?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产品工时导入失败');
    } finally {
      setImportCommitting(false);
    }
  }

  const totalMilliseconds = draftTotal(entries);
  const selectedStatus = selectedItem ? statusText(selectedItem) : '未选择产品';
  const isPlanningScope = planningScope !== 'all';
  const matrixTrailingColumns = isPlanningScope ? 4 : 2;
  const matrixGridColumns = `minmax(210px, 1.8fr) repeat(${definitions.length}, minmax(58px, 1fr)) repeat(${matrixTrailingColumns}, minmax(88px, .85fr))`;
  const matrixMinWidth = Math.max(860, 210 + definitions.length * 58 + matrixTrailingColumns * 88);
  const planningPeriodText = planningSummary?.weekStartDate && planningSummary?.weekEndDate
    ? `${planningSummary.weekStartDate} 至 ${planningSummary.weekEndDate}`
    : planningScope === 'carryover' ? '早于本周且尚未完成' : '当前范围暂无计划批次';

  return (
    <main className="product-time-page hm-product-time-workbench hm-product-time-headerless hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/product-times"
        subtitle="按产品维护执行工序、顺序与单位标准时间"
        menuItems={[]}
        hideHeader
        sidebarTriggerTargetId="product-time-navigation-trigger"
      />

      <div className="product-time-main">
        <section className="product-time-summary" aria-label="产品工时概览与快捷筛选">
          {isPlanningScope ? <>
            <button className={status === 'all' ? 'active' : ''} type="button" onClick={() => setStatus('all')}><Clock3 aria-hidden="true" /><span>计划产品<small>{planningPeriodText}</small></span><strong>{planningSummary?.productCount || 0}</strong></button>
            <article><FileSpreadsheet aria-hidden="true" /><span>计划数量<small>{planningSummary?.batchCount || 0} 个生产批次</small></span><strong>{(planningSummary?.totalQuantity || 0).toLocaleString()}</strong></article>
            <button className={status === 'published' ? 'active' : ''} type="button" onClick={() => setStatus('published')}><CheckCircle2 aria-hidden="true" /><span>工时已发布<small>可冻结到生产批次</small></span><strong>{planningSummary?.publishedCount || 0}</strong></button>
            <button className={`warning ${status === 'unpublished' ? 'active' : ''}`} type="button" onClick={() => setStatus('unpublished')}><Library aria-hidden="true" /><span>工时待发布<small>正式启用前必须完成</small></span><strong>{planningSummary?.missingCount || 0}</strong></button>
          </> : <>
            <button className={status === 'all' ? 'active' : ''} type="button" onClick={() => setStatus('all')}><Clock3 aria-hidden="true" /><span>图纸产品<small>全部范围</small></span><strong>{summary.total}</strong></button>
            <button className={status === 'published' ? 'active' : ''} type="button" onClick={() => setStatus('published')}><CheckCircle2 aria-hidden="true" /><span>已发布<small>可用于新工单</small></span><strong>{summary.published}</strong></button>
            <button className={status === 'draft' ? 'active' : ''} type="button" onClick={() => setStatus('draft')}><Save aria-hidden="true" /><span>草稿待发布<small>继续维护</small></span><strong>{summary.draft}</strong></button>
            <button className={`warning ${status === 'missing' ? 'active' : ''}`} type="button" onClick={() => setStatus('missing')}><Library aria-hidden="true" /><span>工时待维护<small>暂不计算达成率</small></span><strong>{summary.missing}</strong></button>
          </>}
        </section>

        <section className="product-time-scope-bar" aria-label="按计划周查看产品工时">
          <div role="tablist" aria-label="产品工时范围">
            <button type="button" role="tab" aria-selected={planningScope === 'all'} onClick={() => changePlanningScope('all')}>产品总库</button>
            <button type="button" role="tab" aria-selected={planningScope === 'current'} onClick={() => changePlanningScope('current')}>本周计划</button>
            <button type="button" role="tab" aria-selected={planningScope === 'next'} onClick={() => changePlanningScope('next')}>下周预备</button>
            <button type="button" role="tab" aria-selected={planningScope === 'carryover'} onClick={() => changePlanningScope('carryover')}>遗留未完</button>
            <button type="button" role="tab" aria-selected={planningScope === 'history'} onClick={() => changePlanningScope('history')}>历史周</button>
          </div>
          <span>{planningScope === 'all' ? '维护全部图纸产品的标准工时' : planningPeriodText}</span>
          {planningScope === 'history' && <label><span>选择历史周</span><input type="date" value={historyWeekStart} max={periods?.current.weekStartDate} onChange={event => setHistoryWeekStart(event.target.value)} /></label>}
        </section>

        <section className="product-time-toolbar" aria-label="产品工时搜索和筛选">
          <div className="product-time-navigation-trigger" id="product-time-navigation-trigger" aria-label="平台导航入口" />
          <label><Search aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格或品名" /></label>
          <select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(option => <option key={option.customerName} value={option.customerName}>{option.customerName}（{option.count}）</option>)}</select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="筛选工时状态"><option value="all">全部状态</option><option value="missing">工时待维护</option><option value="draft">草稿待发布</option><option value="unpublished">尚未发布</option><option value="published">已发布</option></select>
          <div className="product-time-toolbar-actions">
            <input
              ref={importInputRef}
              className="product-time-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="选择产品工时 Excel 或 CSV"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void previewImport(file);
              }}
            />
            <button ref={importTriggerRef} className="hm-workbench-button" type="button" disabled={importLoading} onClick={() => importInputRef.current?.click()} title="导入产品工时 Excel"><Upload size={15} aria-hidden="true" />{importLoading ? '解析中' : '导入'}</button>
            <a className="hm-workbench-button" href="/api/product-time-profiles/export.xlsx" title="导出产品工时 Excel"><FileDown size={15} aria-hidden="true" />导出</a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => load(selectedItem?.id)} title="刷新产品工时"><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />刷新</button>
          </div>
        </section>

        {message && <div className="product-time-message" role="status" aria-live="polite"><CheckCircle2 size={16} aria-hidden="true" />{message}</div>}
        {error && <div className="product-time-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}

        <section className="product-time-matrix-shell" aria-labelledby="product-time-matrix-title">
          <header className="product-time-matrix-titlebar">
            <div><span>{isPlanningScope ? '计划产品工时' : '产品工时矩阵'}</span><h1 id="product-time-matrix-title">{isPlanningScope ? '按生产周登记并核对产品工时' : '按产品维护单件工序时间'}</h1><p>{isPlanningScope ? '只显示当前计划范围内的产品；工时仍保存到对应图纸产品，发布后才能用于正式生产。' : '输入正数后按 Enter 或 Tab 保存；输入 0 后按 Enter 取消工序，留空或按 Esc 放弃修改。'}</p></div>
            <div className="product-time-matrix-legend" aria-label="矩阵图例"><span><i className="configured" />已配置</span><span><i />未参与</span><span><b>01</b>产品路线顺序</span></div>
          </header>
          <div className="product-time-matrix-scroll hm-scroll-region" tabIndex={0} aria-label={`产品工时矩阵，共 ${items.length} 款产品、${definitions.length} 个共享工序`}>
            <div className="product-time-matrix" style={{ minWidth: `${matrixMinWidth}px` }}>
              <div className="product-time-matrix-row product-time-matrix-head" style={{ gridTemplateColumns: matrixGridColumns }}>
                <span className="product-time-product-column"><b>产品 / 客户</b><small>点击产品查看并调整完整路线</small></span>
                {definitions.map(definition => <span key={definition.id} title={`${definition.name} · ${stageText[definition.stageGroup]}`}><b>{definition.name}</b><small>{stageText[definition.stageGroup]}</small></span>)}
                {isPlanningScope && <span><b>计划数量</b><small>当前范围合计</small></span>}
                <span><b>汇总工时</b><small>当前已填合计</small></span>
                {isPlanningScope && <span><b>计划总工时</b><small>发布工时 × 数量</small></span>}
                <span><b>报价工时</b><small>后续功能接入</small></span>
              </div>
              {items.map(item => {
                const profile = item.draft || item.published;
                const planningQuantity = item.planning?.totalQuantity || 0;
                const frozenPlanningTotal = item.planning?.frozenBatchCount === item.planning?.batchCount && item.planning?.snapshotTotalMilliseconds
                  ? Number(item.planning.snapshotTotalMilliseconds)
                  : 0;
                const calculatedPlanningTotal = item.published ? item.published.totalMillisecondsPerUnit * planningQuantity : 0;
                const planningTotal = frozenPlanningTotal || calculatedPlanningTotal;
                return <div className="product-time-matrix-row" style={{ gridTemplateColumns: matrixGridColumns }} key={item.id}>
                  <button className="product-time-product-cell" type="button" title={`${item.specification} · ${item.customerName} · ${item.productName || '品名未设置'}`} onClick={event => openDetail(item.id, event.currentTarget)}>
                    <strong>{item.specification}</strong><span>{item.customerName}</span><small>{item.productName || '品名未设置'}</small>
                  </button>
                  {definitions.map(definition => {
                    const key = matrixKey(item.id, definition.id);
                    const entry = profile?.entries.find(value => value.processDefinitionId === definition.id);
                    const editing = matrixEditKey === key;
                    const savingCell = matrixSavingKeys.includes(key);
                    const cellError = matrixCellError?.key === key ? matrixCellError.message : '';
                    return <div className={`product-time-matrix-cell ${entry ? 'configured' : ''} ${editing ? 'editing' : ''} ${savingCell ? 'saving' : ''} ${cellError ? 'invalid' : ''}`} key={definition.id}>
                      {editing ? <input
                        autoFocus
                        inputMode="decimal"
                        aria-label={`${item.specification} ${definition.name}单件工时（秒）`}
                        aria-invalid={Boolean(cellError)}
                        value={matrixEditValue}
                        onChange={event => setMatrixEditValue(event.target.value)}
                        onBlur={() => saveMatrixCell(item, definition)}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelMatrixEdit(key);
                            return;
                          }
                          if (event.key === 'Enter' || event.key === 'Tab') {
                            event.preventDefault();
                            matrixCommitRef.current = event.key === 'Enter' ? key : '';
                            const direction = event.shiftKey ? -1 : 1;
                            event.currentTarget.blur();
                            moveMatrixEditor(item, definition, direction);
                          }
                        }}
                      /> : <button type="button" disabled={savingCell} title={`${item.specification} · ${definition.name}：${entry ? `${seconds(entry.unitMilliseconds)} 秒，路线第 ${entry.position} 道` : '不参与，点击填写'}`} onClick={() => startMatrixEdit(item, definition)}>
                        {savingCell ? <span>保存中</span> : entry ? <><b>{seconds(entry.unitMilliseconds)}</b><small>秒</small><em>{String(entry.position).padStart(2, '0')}</em></> : <><Plus size={14} aria-hidden="true" /><span>填写</span></>}
                      </button>}
                      {cellError && <span className="product-time-cell-error" role="alert" title={cellError}>输入无效</span>}
                    </div>;
                  })}
                  {isPlanningScope && <div className="product-time-plan-quantity-cell" role="note" aria-label={`${item.specification}计划数量${planningQuantity}件`}><strong>{planningQuantity.toLocaleString()}</strong><small>{item.planning?.batchCount || 0} 批</small></div>}
                  <div
                    className="product-time-total-cell"
                    role="note"
                    aria-label={profile && profile.processCount > 0
                      ? `${item.specification}当前汇总工时${duration(profile.totalMillisecondsPerUnit)}，共${profile.processCount}道工序`
                      : `${item.specification}尚未配置工序工时`}
                    title={profile && profile.processCount > 0 ? `当前已填写 ${profile.processCount} 道工序` : '尚未配置工序工时'}
                  >
                    <strong>{profile && profile.processCount > 0 ? duration(profile.totalMillisecondsPerUnit) : '—'}</strong>
                    <small>{profile && profile.processCount > 0 ? `${profile.processCount} 道工序` : '未配置'}</small>
                  </div>
                  {isPlanningScope && <div className="product-time-plan-total-cell" role="note" aria-label={planningTotal > 0 ? `${item.specification}计划总工时${duration(planningTotal)}` : `${item.specification}尚无可用的已发布工时`} title={frozenPlanningTotal > 0 ? '生产批次已冻结工时版本' : item.published ? `按已发布 V${item.published.version} 计算` : '请先发布产品工时'}><strong>{planningTotal > 0 ? duration(planningTotal) : '—'}</strong><small>{frozenPlanningTotal > 0 ? '批次已冻结' : item.published ? `发布 V${item.published.version}` : '待发布'}</small></div>}
                  <div className="product-time-quote-cell" role="note" aria-label={`${item.specification}报价工时尚未录入`} title="报价工时将在后续功能中接入">
                    <span aria-hidden="true">—</span>
                  </div>
                </div>;
              })}
              {!loading && !items.length && <div className="product-time-empty matrix-empty"><Search aria-hidden="true" /><strong>没有符合条件的产品</strong><span>请调整筛选，或先在图纸资料库建立产品资料。</span></div>}
            </div>
          </div>
        </section>

        {detailOpen && <button className="product-time-detail-scrim" type="button" aria-label="关闭产品工时详情" onClick={closeDetail} />}
        {detailOpen && <aside className="product-time-detail-drawer open" role="dialog" aria-modal="true" aria-labelledby="product-time-detail-title">
          <div className="product-time-editor" aria-label="产品单位工时编辑">
            {!selectedItem ? <div className="product-time-empty large"><Clock3 aria-hidden="true" /><strong>选择产品开始维护工时</strong></div> : <>
              <header className="product-time-editor-head">
                <div><span>{selectedStatus}</span><h1 id="product-time-detail-title" title={selectedItem.specification}>{selectedItem.specification}</h1><p title={`${selectedItem.customerName} · ${selectedItem.productName || '品名未设置'}`}>{selectedItem.customerName} · {selectedItem.productName || '品名未设置'}</p></div>
                <button ref={detailCloseRef} className="product-time-detail-close" type="button" title="关闭产品工时详情" aria-label="关闭产品工时详情" onClick={closeDetail}><X size={18} /></button>
              </header>
              <div className="product-time-editor-actions">
                <a className="hm-workbench-button" href={`/drawing-library?itemId=${encodeURIComponent(selectedItem.id)}`}><BookOpenText size={15} aria-hidden="true" />查看图纸</a>
                <button ref={libraryTriggerRef} className="hm-workbench-button" type="button" aria-expanded={libraryOpen} aria-controls="product-process-library" onClick={() => setLibraryOpen(true)}><Library size={15} aria-hidden="true" />工序库</button>
                <button className="hm-workbench-button" type="button" disabled={saving} onClick={saveDraft}><Save size={15} aria-hidden="true" />{saving ? '保存中' : '保存草稿'}</button>
                <button className="hm-workbench-button primary" type="button" disabled={publishing || dirty || !activeDraft} onClick={publish}><CheckCircle2 size={15} aria-hidden="true" />{publishing ? '发布中' : '发布版本'}</button>
              </div>
              <div className="product-time-metrics">
                <span><small>工序数量</small><strong>{entries.length}</strong></span><span><small>单件总工时</small><strong>{duration(totalMilliseconds)}</strong></span><span><small>当前版本</small><strong>{activeProfile ? `V${activeProfile.version}` : '待创建'}</strong></span><span><small>工时来源</small><strong>{copySourceId ? '复制后调整' : '人工维护'}</strong></span>
              </div>
              <div className="product-time-copy-row">
                <label><span>复制相似产品</span><select value={copySourceId} onChange={event => setCopySourceId(event.target.value)}><option value="">选择已发布产品</option>{items.filter(item => item.id !== selectedItem.id && item.published).map(item => <option key={item.id} value={item.id}>{item.customerName} · {item.specification}</option>)}</select></label>
                <button className="hm-workbench-button" type="button" disabled={!copySourceId} onClick={copyProfile}><Copy size={15} aria-hidden="true" />复制工时</button>
              </div>
              <div className="product-time-table-head" aria-hidden="true"><span>顺序/工序</span><span>单件工时(秒)</span><span>单次(秒)</span><span>次数</span><span>准备(秒)</span><span>计入达成率</span><span>操作</span></div>
              <div className="product-time-entry-list hm-scroll-region" tabIndex={0} aria-label={`产品工时明细，共 ${entries.length} 道工序`}>
                {entries.map((entry, index) => {
                  const definition = definitions.find(item => item.id === entry.processDefinitionId);
                  return <article key={entry.processDefinitionId}>
                    <div className="product-time-process-name"><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{definition?.name || '工序已停用'}</strong><small>{definition ? stageText[definition.stageGroup] : '待处理'}</small></span></div>
                    <label><span>单件工时</span><input inputMode="decimal" value={entry.unitSeconds} onChange={event => updateEntry(index, { unitSeconds: event.target.value })} placeholder="必填" /></label>
                    <label><span>单次时间</span><input inputMode="decimal" value={entry.actionSeconds} onChange={event => updateEntry(index, { actionSeconds: event.target.value })} placeholder="可选" /></label>
                    <label><span>次数</span><input inputMode="numeric" value={entry.occurrences} onChange={event => updateEntry(index, { occurrences: event.target.value })} /></label>
                    <label><span>准备时间</span><input inputMode="decimal" value={entry.setupSeconds} onChange={event => updateEntry(index, { setupSeconds: event.target.value })} /></label>
                    <label className="product-time-efficiency"><input type="checkbox" checked={entry.countsForEfficiency} onChange={event => updateEntry(index, { countsForEfficiency: event.target.checked })} /><span>计入</span></label>
                    <div className="product-time-row-actions"><button type="button" title="上移" aria-label={`上移${definition?.name || '工序'}`} disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button><button type="button" title="下移" aria-label={`下移${definition?.name || '工序'}`} disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button><button className="danger" type="button" title="移除" aria-label={`移除${definition?.name || '工序'}`} onClick={() => removeEntry(index)}><Trash2 size={15} /></button></div>
                    <input className="product-time-row-remark" value={entry.remark} onChange={event => updateEntry(index, { remark: event.target.value })} placeholder="工序备注，可选" />
                  </article>;
                })}
                {!entries.length && <div className="product-time-empty"><Library aria-hidden="true" /><strong>当前产品还没有工时明细</strong><span>从工序库添加参与该产品的工序；未添加的工序即表示不参与。</span><button className="hm-workbench-button primary" type="button" onClick={() => setLibraryOpen(true)}>打开工序库</button></div>}
              </div>
              <label className="product-time-remark"><span>版本说明</span><textarea value={remark} onChange={event => { setRemark(event.target.value); setDirty(true); }} placeholder="记录工时测定依据、特殊设备或本次调整原因" /></label>
            </>}
          </div>
        </aside>}

        {libraryOpen && <button className="product-time-library-scrim" type="button" aria-label="关闭工序库" onClick={() => {
          setLibraryOpen(false);
          window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
        }} />}
        {libraryOpen && <aside id="product-process-library" className="product-time-library open" aria-label="共享工序库">
            <header><span><strong>共享工序库</strong><small>加入当前产品后填写单件工时</small></span><button ref={libraryCloseRef} type="button" title="关闭工序库" aria-label="关闭工序库" onClick={() => {
              setLibraryOpen(false);
              window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
            }}><X size={17} /></button></header>
            <label className="product-time-library-search"><Search size={15} aria-hidden="true" /><input value={libraryKeyword} onChange={event => setLibraryKeyword(event.target.value)} placeholder="搜索工序" /></label>
            <div className="product-time-stage-tabs">{(['all', 'frontend', 'backend', 'finish'] as const).map(value => <button key={value} className={libraryStage === value ? 'active' : ''} type="button" onClick={() => setLibraryStage(value)}>{value === 'all' ? '全部' : stageText[value]}</button>)}</div>
            <div className="product-time-definition-list hm-scroll-region" tabIndex={0}>{filteredDefinitions.map(definition => <button key={definition.id} type="button" onClick={() => addDefinition(definition)}><span><strong>{definition.name}</strong><small>{stageText[definition.stageGroup]}</small></span><Plus size={15} aria-hidden="true" /></button>)}{!filteredDefinitions.length && <p>没有可添加的工序</p>}</div>
            <section className="product-time-new-process"><strong>新增共享工序</strong><input value={newProcessName} onChange={event => setNewProcessName(event.target.value)} placeholder="工序名称" maxLength={60} /><select value={newProcessStage} onChange={event => setNewProcessStage(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select><button className="hm-workbench-button" type="button" disabled={creatingProcess} onClick={createProcess}><Plus size={15} />{creatingProcess ? '创建中' : '创建并加入'}</button></section>
        </aside>}
      </div>

      {importOpen && importPreview && <div className="product-time-import-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeImport();
      }}>
        <section className="product-time-import-dialog" role="dialog" aria-modal="true" aria-labelledby="product-time-import-title">
          <header>
            <div><FileSpreadsheet aria-hidden="true" /><span><strong id="product-time-import-title">产品工时导入预览</strong><small title={importPreview.fileName}>{importPreview.fileName} · {importPreview.sheetName}</small></span></div>
            <button ref={importCloseRef} type="button" title="关闭导入预览" aria-label="关闭导入预览" disabled={importCommitting} onClick={closeImport}><X size={18} /></button>
          </header>
          <div className="product-time-import-notice"><AlertTriangle size={17} aria-hidden="true" /><span><strong>导入只保存草稿，不会自动发布</strong><small>空白工序表示该产品不参与；无效行不会写入数据库。</small></span></div>
          <div className="product-time-import-summary">
            <span><small>数据行</small><strong>{importPreview.summary.total}</strong></span>
            <span className="ready"><small>可导入</small><strong>{importPreview.summary.ready}</strong></span>
            <span className="invalid"><small>需处理</small><strong>{importPreview.summary.invalid}</strong></span>
            <span><small>匹配工序列</small><strong>{importPreview.summary.matchedProcessColumns}</strong></span>
          </div>
          <div className="product-time-import-columns" title={importPreview.processColumns.join('、')}>
            已识别工序：{importPreview.processColumns.join('、') || '无'}
          </div>
          <div className="product-time-import-list hm-scroll-region" tabIndex={0}>
            <div className="product-time-import-list-head"><span>行</span><span>产品 / 客户</span><span>工序</span><span>单件合计</span><span>状态</span></div>
            {importPreview.rows.map(row => <article key={`${row.rowNo}-${row.specification}`} className={row.status}>
              <span>{row.rowNo}</span>
              <span><strong title={row.specification}>{row.specification}</strong><small title={`${row.customerName} · ${row.productName || '品名未设置'}`}>{row.customerName || '客户未匹配'} · {row.productName || '品名未设置'}</small></span>
              <span>{row.entries.length}</span>
              <span>{Math.round(row.totalSeconds * 1000) / 1000} 秒</span>
              <span>{row.status === 'ready' ? <em>可导入</em> : <em title={row.warnings.join('；')}>{row.warnings.join('；') || '数据无效'}</em>}</span>
            </article>)}
          </div>
          <footer>
            <span>将写入 {importPreview.summary.ready} 款产品的草稿；发布前仍可逐项修改。</span>
            <div><button className="hm-workbench-button" type="button" disabled={importCommitting} onClick={closeImport}>取消</button><button className="hm-workbench-button primary" type="button" disabled={importCommitting || importPreview.summary.ready === 0} onClick={commitImport}><Upload size={15} aria-hidden="true" />{importCommitting ? '导入中' : `导入 ${importPreview.summary.ready} 条草稿`}</button></div>
          </footer>
        </section>
      </div>}
    </main>
  );
}
