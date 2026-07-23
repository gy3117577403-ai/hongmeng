'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Library,
  Layers3,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { useToast, useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  DrawingLibraryFileDTO,
  DrawingLibraryItemDTO,
  ProductQuotationTimeDTO,
  ProductProcessTimeEntryDTO,
  ProductTimeListItemDTO,
  ProductTimePlanningScope,
  ProductTimePlanningSummaryDTO,
  ProductTimeProfileDTO,
  ProcessStageGroup,
  ProcessTimeBasis,
} from '@/types';

type ProcessDefinition = {
  id: string;
  code: string;
  name: string;
  stageGroup: ProcessStageGroup;
  sortOrder: number;
};

type CustomerOption = { customerName: string; count: number };
type ProductTimePayload = {
  ok: boolean;
  error?: string;
  items?: ProductTimeListItemDTO[];
  definitions?: ProcessDefinition[];
  customers?: CustomerOption[];
  planningScope?: ProductTimePlanningScope;
  planningSummary?: ProductTimePlanningSummaryDTO | null;
  periods?: {
    current: { weekStartDate: string; weekEndDate: string };
    next: { weekStartDate: string; weekEndDate: string };
  };
};

type ReferenceCategory = 'drawing' | 'sop' | 'all';

type EntryDraft = {
  processDefinitionId: string;
  timeBasis: ProcessTimeBasis;
  unitSeconds: string;
  occurrences: string;
  setupSeconds: string;
  unitLabel: string;
  parallelWithPrevious: boolean;
  countsForEfficiency: boolean;
  remark: string;
};

type ProductTimeImportEntry = {
  processDefinitionId: string;
  processName: string;
  unitSeconds: number;
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

const stageText: Record<ProcessStageGroup, string> = { frontend: '前端', backend: '后端', finish: '完工' };

function referenceCategory(file: DrawingLibraryFileDTO): Exclude<ReferenceCategory, 'all'> | 'other' {
  const code = (file.categoryCode || '').toLocaleLowerCase('zh-CN');
  const name = (file.categoryName || '').toLocaleLowerCase('zh-CN');
  if (code.includes('sop') || code.includes('manual') || code.includes('instruction') || name.includes('指导书') || name.includes('sop')) return 'sop';
  if (code.includes('original') || code.includes('drawing') || name.includes('原图') || name.includes('图纸')) return 'drawing';
  return 'other';
}

function quotationSourceText(sourceType: ProductQuotationTimeDTO['sourceType'] | null): string {
  if (sourceType === 'planning_order') return '采用计划单套工时';
  if (sourceType === 'import') return '导入';
  if (sourceType === 'quotation') return '报价资料';
  return '人工录入';
}

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

function entryDraft(
  entry: ProductProcessTimeEntryDTO,
  index: number,
  allEntries: ProductProcessTimeEntryDTO[],
): EntryDraft {
  const usesActionCount = entry.timeBasis === 'per_unit'
    && Boolean(entry.actionMilliseconds)
    && entry.occurrences > 1;
  return {
    processDefinitionId: entry.processDefinitionId,
    timeBasis: entry.timeBasis,
    unitSeconds: seconds(usesActionCount ? entry.actionMilliseconds : entry.unitMilliseconds),
    occurrences: String(usesActionCount ? entry.occurrences : 1),
    setupSeconds: seconds(entry.setupMilliseconds) || '0',
    unitLabel: entry.unitLabel || '套',
    parallelWithPrevious: index > 0 && allEntries[index - 1].sequenceGroup === entry.sequenceGroup,
    countsForEfficiency: entry.countsForEfficiency,
    remark: entry.remark || '',
  };
}

function draftTotal(entries: EntryDraft[]): number {
  return entries.reduce((total, entry) => {
    const value = Number(entry.unitSeconds);
    const occurrences = entry.timeBasis === 'per_batch' ? 1 : Number(entry.occurrences || 1);
    const variable = Number.isFinite(value) && value > 0 && Number.isInteger(occurrences) && occurrences > 0
      ? value * occurrences
      : 0;
    return total + Math.round(variable * 1000);
  }, 0);
}

function invalidEntry(entry: EntryDraft): boolean {
  const value = Number(entry.unitSeconds);
  const setup = Number(entry.setupSeconds || 0);
  const occurrences = Number(entry.occurrences || 1);
  return !Number.isFinite(value)
    || value <= 0
    || value > 86_400
    || !Number.isFinite(setup)
    || setup < 0
    || setup > 86_400
    || (entry.timeBasis === 'per_unit' && (!Number.isInteger(occurrences) || occurrences <= 0 || occurrences > 10_000));
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
  const [quotationSeconds, setQuotationSeconds] = useState('');
  const [quotationRemark, setQuotationRemark] = useState('');
  const [quotationSourceType, setQuotationSourceType] = useState<ProductQuotationTimeDTO['sourceType']>('manual');
  const [quotationSourceRefId, setQuotationSourceRefId] = useState<string | null>(null);
  const [quotationDirty, setQuotationDirty] = useState(false);
  const [quotationSaving, setQuotationSaving] = useState(false);
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
  const [referenceItem, setReferenceItem] = useState<DrawingLibraryItemDTO | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceCategoryFilter, setReferenceCategoryFilter] = useState<ReferenceCategory>('drawing');
  const [referenceFileId, setReferenceFileId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductTimeImportPreview | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryCloseRef = useRef<HTMLButtonElement>(null);
  const referenceTriggerRef = useRef<HTMLButtonElement>(null);
  const referenceCloseRef = useRef<HTMLButtonElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importCloseRef = useRef<HTMLButtonElement>(null);
  const initialSelectionRef = useRef(false);
  const lastExternalRefreshRef = useRef(0);
  const unsavedToastShownRef = useRef(false);
  const { showToast } = useToast();
  useToastBridge(message, setMessage);
  useToastBridge(error, setError, 'error');

  const hasUnsavedChanges = dirty || quotationDirty;

  useEffect(() => {
    if (hasUnsavedChanges && !unsavedToastShownRef.current) {
      showToast('当前产品有未保存修改', { tone: 'warning' });
    }
    unsavedToastShownRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges, showToast]);

  const selectedItem = items.find(item => item.id === selectedId) || items[0] || null;
  const selectedItemId = selectedItem?.id || null;
  const activeDraft = selectedItem?.draft || null;
  const activePublished = selectedItem?.published || null;
  const activeProfile = activeDraft || activePublished;
  const activeQuotation = selectedItem?.quotation || null;
  const referenceFiles = useMemo(
    () => referenceItem?.files.filter(file => !file.deletedAt) || [],
    [referenceItem],
  );
  const visibleReferenceFiles = useMemo(
    () => referenceFiles.filter(file => referenceCategoryFilter === 'all' || referenceCategory(file) === referenceCategoryFilter),
    [referenceCategoryFilter, referenceFiles],
  );
  const selectedReferenceFile = visibleReferenceFiles.find(file => file.id === referenceFileId) || visibleReferenceFiles[0] || null;

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
      setItems(nextItems);
      setDefinitions(data.definitions || []);
      setCustomers(data.customers || []);
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
    if ((dirty || quotationDirty) && !window.confirm('当前产品有未保存修改，切换范围将放弃这些修改，是否继续？')) return;
    setPlanningScope(scope);
    setStatus('all');
    const url = new URL(window.location.href);
    if (scope === 'all') url.searchParams.delete('scope');
    else url.searchParams.set('scope', scope);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [dirty, quotationDirty]);

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
      if (dirty || quotationDirty) return;
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
  }, [dirty, load, quotationDirty]);

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
    setQuotationSeconds(seconds(selectedItem?.quotation?.unitMilliseconds));
    setQuotationRemark(selectedItem?.quotation?.remark || '');
    setQuotationSourceType(selectedItem?.quotation?.sourceType || 'manual');
    setQuotationSourceRefId(selectedItem?.quotation?.sourceRefId || null);
    setQuotationDirty(false);
    setError('');
  }, [activeProfile, selectedItem?.id, selectedItem?.quotation]);

  useEffect(() => {
    if (!selectedItemId) {
      setReferenceItem(null);
      setReferenceError('');
      return;
    }
    let cancelled = false;
    setReferenceItem(null);
    setReferenceFileId('');
    setReferenceLoading(true);
    setReferenceError('');
    fetch(`/api/drawing-library/${selectedItemId}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; item?: DrawingLibraryItemDTO };
        if (!response.ok || !data.item) throw new Error(data.error || '参考资料加载失败');
        if (!cancelled) setReferenceItem(data.item);
      })
      .catch(reason => {
        if (!cancelled) {
          setReferenceItem(null);
          setReferenceError(reason instanceof Error ? reason.message : '参考资料加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setReferenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  useEffect(() => {
    if (!referenceOpen) return;
    const nextFileId = visibleReferenceFiles.some(file => file.id === referenceFileId)
      ? referenceFileId
      : visibleReferenceFiles[0]?.id || '';
    if (nextFileId !== referenceFileId) setReferenceFileId(nextFileId);
  }, [referenceFileId, referenceOpen, visibleReferenceFiles]);

  useEffect(() => {
    if (!dirty && !quotationDirty) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, quotationDirty]);

  useEffect(() => {
    if (!libraryOpen && !importOpen && !referenceOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      if (referenceOpen) referenceCloseRef.current?.focus();
      else if (importOpen) importCloseRef.current?.focus();
      else if (libraryOpen && window.matchMedia('(max-width: 1500px)').matches) libraryCloseRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [importOpen, libraryOpen, referenceOpen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (referenceOpen) {
        setReferenceOpen(false);
        window.requestAnimationFrame(() => referenceTriggerRef.current?.focus());
        return;
      }
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
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [importOpen, libraryOpen, referenceOpen]);

  const filteredDefinitions = useMemo(() => definitions.filter(definition => {
    if (entries.some(entry => entry.processDefinitionId === definition.id)) return false;
    if (libraryStage !== 'all' && definition.stageGroup !== libraryStage) return false;
    const normalized = libraryKeyword.trim().toLocaleLowerCase('zh-CN');
    return !normalized || `${definition.name} ${definition.code}`.toLocaleLowerCase('zh-CN').includes(normalized);
  }), [definitions, entries, libraryKeyword, libraryStage]);

  function selectProduct(itemId: string): void {
    if (selectedItem?.id === itemId) return;
    if ((dirty || quotationDirty) && !window.confirm('当前产品有未保存修改，切换产品将放弃这些修改，是否继续？')) return;
    setSelectedId(itemId);
    const url = new URL(window.location.href);
    url.searchParams.set('itemId', itemId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  function resetChanges(): void {
    setEntries(activeProfile?.entries.map(entryDraft) || []);
    setRemark(activeProfile?.remark || '');
    setCopySourceId('');
    setDirty(false);
    setQuotationSeconds(seconds(activeQuotation?.unitMilliseconds));
    setQuotationRemark(activeQuotation?.remark || '');
    setQuotationSourceType(activeQuotation?.sourceType || 'manual');
    setQuotationSourceRefId(activeQuotation?.sourceRefId || null);
    setQuotationDirty(false);
    setError('');
    setMessage('已放弃未保存修改');
  }

  function openReferencePreview(): void {
    const nextCategory: ReferenceCategory = referenceFiles.some(file => referenceCategory(file) === 'drawing')
      ? 'drawing'
      : referenceFiles.some(file => referenceCategory(file) === 'sop')
        ? 'sop'
        : 'all';
    setReferenceCategoryFilter(nextCategory);
    const nextFile = referenceFiles.find(file => nextCategory === 'all' || referenceCategory(file) === nextCategory) || null;
    setReferenceFileId(nextFile?.id || '');
    setReferenceOpen(true);
  }

  function closeReferencePreview(): void {
    setReferenceOpen(false);
    window.requestAnimationFrame(() => referenceTriggerRef.current?.focus());
  }

  function adoptPlanningQuotation(): void {
    const planningReference = selectedItem?.planningReference;
    if (!planningReference) return;
    setQuotationSeconds(seconds(planningReference.unitMilliseconds));
    setQuotationSourceType('planning_order');
    setQuotationSourceRefId(planningReference.planOrderId);
    setQuotationDirty(true);
    setMessage('已带入计划单套工时，请确认后保存报价版本');
  }

  async function saveQuotation(): Promise<void> {
    if (!selectedItem) return;
    const parsedSeconds = Number(quotationSeconds);
    if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0 || parsedSeconds > 86_400) {
      setError('报价工时必须大于 0 秒且不超过 24 小时');
      return;
    }
    setQuotationSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/quotation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: activeQuotation?.version ?? null,
          unitSeconds: parsedSeconds,
          sourceType: quotationSourceType,
          sourceRefId: quotationSourceRefId,
          remark: quotationRemark,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        quotation?: ProductTimeListItemDTO['quotation'];
      };
      if (!response.ok || !data.quotation) throw new Error(data.error || '报价工时保存失败');
      setQuotationDirty(false);
      setMessage(`${selectedItem.specification} 报价工时 V${data.quotation.version} 已保存`);
      await load(selectedItem.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '报价工时保存失败');
    } finally {
      setQuotationSaving(false);
    }
  }

  function addDefinition(definition: ProcessDefinition): void {
    setEntries(current => [...current, {
      processDefinitionId: definition.id,
      timeBasis: 'per_unit',
      unitSeconds: '',
      occurrences: '1',
      setupSeconds: '0',
      unitLabel: '套',
      parallelWithPrevious: false,
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
      next[0] = { ...next[0], parallelWithPrevious: false };
      return next;
    });
    setDirty(true);
  }

  function removeEntry(index: number): void {
    setEntries(current => {
      const next = current.filter((_entry, entryIndex) => entryIndex !== index);
      if (next.length) next[0] = { ...next[0], parallelWithPrevious: false };
      return next;
    });
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
    if (!entries.length) {
      setError('请先从工序库添加该产品实际参与的工序');
      return null;
    }
    const invalidDraftEntry = entries.find(invalidEntry);
    if (invalidDraftEntry) {
      const definition = definitions.find(item => item.id === invalidDraftEntry.processDefinitionId);
      setError(`${definition?.name || '工序'}的工时口径、标准时间、次数或准备时间不正确`);
      return null;
    }
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
            timeBasis: entry.timeBasis,
            unitSeconds: entry.unitSeconds,
            occurrences: entry.occurrences,
            setupSeconds: entry.setupSeconds,
            unitLabel: entry.unitLabel,
            parallelWithPrevious: entry.parallelWithPrevious,
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
    if (!window.confirm(`确认发布 ${selectedItem.specification} 产品工时 V${activeDraft.version}？完全未开工且没有生产事实的待执行路线会自动升级；已开工路线继续保留原版本快照。`)) return;
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
  const perBatchEntryCount = entries.filter(entry => entry.timeBasis === 'per_batch').length;
  const selectedStatus = selectedItem ? statusText(selectedItem) : '未选择产品';
  const isPlanningScope = planningScope !== 'all';
  const invalidEntryCount = entries.filter(invalidEntry).length;
  const copySources = items.filter(item => item.id !== selectedItem?.id && item.published);
  const planningReference = selectedItem?.planningReference || null;
  const referenceDrawingCount = referenceFiles.filter(file => referenceCategory(file) === 'drawing').length;
  const referenceSopCount = referenceFiles.filter(file => referenceCategory(file) === 'sop').length;
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
        <section className="product-time-scope-bar" aria-label="按计划周查看产品工时">
          <div role="tablist" aria-label="产品工时范围">
            <button type="button" role="tab" aria-selected={planningScope === 'all'} disabled={hasUnsavedChanges} onClick={() => changePlanningScope('all')}>产品总库</button>
            <button type="button" role="tab" aria-selected={planningScope === 'current'} disabled={hasUnsavedChanges} onClick={() => changePlanningScope('current')}>本周计划</button>
            <button type="button" role="tab" aria-selected={planningScope === 'next'} disabled={hasUnsavedChanges} onClick={() => changePlanningScope('next')}>下周预备</button>
            <button type="button" role="tab" aria-selected={planningScope === 'carryover'} disabled={hasUnsavedChanges} onClick={() => changePlanningScope('carryover')}>遗留未完</button>
            <button type="button" role="tab" aria-selected={planningScope === 'history'} disabled={hasUnsavedChanges} onClick={() => changePlanningScope('history')}>历史周</button>
          </div>
          <span>{planningScope === 'all' ? '维护全部图纸产品的标准工时' : planningPeriodText}</span>
          {planningScope === 'history' && <label><span>选择历史周</span><input type="date" value={historyWeekStart} max={periods?.current.weekStartDate} disabled={hasUnsavedChanges} onChange={event => setHistoryWeekStart(event.target.value)} /></label>}
        </section>

        <section className="product-time-toolbar" aria-label="产品工时搜索和筛选">
          <div className="product-time-navigation-trigger" id="product-time-navigation-trigger" aria-label="平台导航入口" />
          <label><Search aria-hidden="true" /><input value={keyword} disabled={hasUnsavedChanges} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格或品名" /></label>
          <select value={customer} disabled={hasUnsavedChanges} onChange={event => setCustomer(event.target.value)} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(option => <option key={option.customerName} value={option.customerName}>{option.customerName}（{option.count}）</option>)}</select>
          <select value={status} disabled={hasUnsavedChanges} onChange={event => setStatus(event.target.value)} aria-label="筛选工时状态"><option value="all">全部状态</option><option value="missing">工时待维护</option><option value="quotation_missing">报价待维护</option><option value="draft">草稿待发布</option><option value="unpublished">尚未发布</option><option value="published">已发布</option></select>
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
            <button ref={importTriggerRef} className="hm-workbench-button" type="button" disabled={importLoading || hasUnsavedChanges} onClick={() => importInputRef.current?.click()} title="导入产品工时 Excel"><Upload size={15} aria-hidden="true" />{importLoading ? '解析中' : '导入'}</button>
            <a className="hm-workbench-button" href="/api/product-time-profiles/export.xlsx" title="导出产品工时 Excel"><FileDown size={15} aria-hidden="true" />导出</a>
            <button className="hm-workbench-button" type="button" disabled={loading || hasUnsavedChanges} onClick={() => load(selectedItem?.id)} title="刷新产品工时"><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />刷新</button>
          </div>
        </section>

        <section className="product-time-workspace" aria-label="产品工序与工时工作台">
          <aside className="product-time-products" aria-label="产品列表">
            <header>
              <span><small>{isPlanningScope ? '计划范围' : '产品总库'}</small><strong>{items.length} 款产品</strong></span>
              <Layers3 size={19} aria-hidden="true" />
            </header>
            <div className="product-time-product-list hm-scroll-region" tabIndex={0}>
              {items.map(item => {
                const profile = item.draft || item.published;
                const active = item.id === selectedItem?.id;
                return <button
                  className={active ? 'active' : ''}
                  type="button"
                  key={item.id}
                  aria-current={active ? 'true' : undefined}
                  title={`${item.specification} · ${item.customerName} · ${item.productName || '品名未设置'}`}
                  onClick={() => selectProduct(item.id)}
                >
                  <span className="product-time-product-main"><strong>{item.specification}</strong><small>{item.customerName}</small><em>{item.productName || '品名未设置'}</em></span>
                  <span className="product-time-product-meta">
                    <b className={item.published ? 'published' : item.draft ? 'draft' : 'missing'}>{statusText(item)}</b>
                    <small>{profile ? `${profile.processCount} 道 · ${profile.entries.some(entry => entry.timeBasis === 'per_batch') ? '含按批工时' : duration(profile.totalMillisecondsPerUnit)}` : '尚未建立产品路线'}</small>
                    {item.planning && <small>{item.planning.batchCount} 批 · {item.planning.totalQuantity.toLocaleString('zh-CN')} 件</small>}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>;
              })}
              {!loading && !items.length && <div className="product-time-empty"><Search aria-hidden="true" /><strong>没有符合条件的产品</strong><span>调整筛选，或先在图纸资料库建立产品资料。</span></div>}
            </div>
          </aside>

          <section className="product-time-route" aria-labelledby="product-time-route-title">
            {!selectedItem ? <div className="product-time-empty large"><Clock3 aria-hidden="true" /><strong>选择产品开始维护</strong><span>每款产品独立保存实际参与的工序、顺序和单套合计工时。</span></div> : <>
              <header className="product-time-route-head">
                <div>
                  <span>{selectedStatus}</span>
                  <h1 id="product-time-route-title" title={selectedItem.specification}>{selectedItem.specification}</h1>
                  <p title={`${selectedItem.customerName} · ${selectedItem.productName || '品名未设置'}`}>{selectedItem.customerName} · {selectedItem.productName || '品名未设置'}</p>
                </div>
                <div>
                  <button ref={referenceTriggerRef} className="hm-workbench-button" type="button" title="临时查看图纸或作业指导书" aria-haspopup="dialog" aria-expanded={referenceOpen} onClick={openReferencePreview}><BookOpenText size={15} aria-hidden="true" />查看资料</button>
                  <button ref={libraryTriggerRef} className="hm-workbench-button primary" type="button" aria-expanded={libraryOpen} aria-controls="product-process-library" onClick={() => setLibraryOpen(true)}><Plus size={15} aria-hidden="true" />添加工序</button>
                </div>
              </header>

              <div className="product-time-route-metrics" aria-label="当前产品工时概览">
                <span><small>工序数量</small><strong>{entries.length}</strong><em>实际参与工序</em></span>
                <span><small>工时口径</small><strong>{perBatchEntryCount ? `${perBatchEntryCount} 道按批` : '全部按件'}</strong><em>{perBatchEntryCount ? '按批工时不折算为单套' : `单套估算 ${duration(totalMilliseconds)}`}</em></span>
                <span><small>当前版本</small><strong>{activeProfile ? `V${activeProfile.version}` : '待创建'}</strong><em>{activeDraft ? '草稿待发布' : activePublished ? '正式版本' : '尚未维护'}</em></span>
                <span><small>计划关联</small><strong>{selectedItem.planning?.batchCount || 0} 批</strong><em>{selectedItem.planning ? `${selectedItem.planning.totalQuantity.toLocaleString('zh-CN')} 件` : '当前范围无批次'}</em></span>
              </div>

              <div className="product-time-route-guidance">
                <Route size={18} aria-hidden="true" />
                <span><strong>每道工序可选择“按件”或“按整批”计时</strong><small>按件工时＝单次标准时间 × 每套工序次数；按批工时整批只计一次。准备时间在该次工时池中只计一次。</small></span>
              </div>

              <div className="product-time-entry-list hm-scroll-region" tabIndex={0} aria-label={`当前产品工序路线，共 ${entries.length} 道工序`}>
                {entries.map((entry, index) => {
                  const definition = definitions.find(item => item.id === entry.processDefinitionId);
                  const invalid = invalidEntry(entry);
                  return <article className={invalid ? 'invalid' : ''} key={entry.processDefinitionId}>
                    <div className="product-time-process-name">
                      <b>{String(index + 1).padStart(2, '0')}</b>
                      <span><strong>{definition?.name || '工序已停用'}</strong><small>{definition ? stageText[definition.stageGroup] : '历史工序'}</small></span>
                    </div>
                    <div className="product-time-standard-editor">
                      <label><span>工时口径</span><select value={entry.timeBasis} onChange={event => {
                        const timeBasis = event.target.value as ProcessTimeBasis;
                        updateEntry(index, { timeBasis });
                      }}><option value="per_unit">按件 / 按套</option><option value="per_batch">按整批</option></select></label>
                      <label><span>{entry.timeBasis === 'per_batch' ? '整批标准时间（秒）' : '单次标准时间（秒）'}</span><input inputMode="decimal" aria-invalid={invalid} value={entry.unitSeconds} onChange={event => updateEntry(index, { unitSeconds: event.target.value })} placeholder="输入正数" /></label>
                      <label><span>{entry.timeBasis === 'per_batch' ? '整批计次' : '每套工序次数'}</span><input inputMode="numeric" disabled={entry.timeBasis === 'per_batch'} value={entry.timeBasis === 'per_batch' ? '1' : entry.occurrences} onChange={event => updateEntry(index, { occurrences: event.target.value })} /></label>
                      <label><span>准备时间（秒）</span><input inputMode="decimal" value={entry.setupSeconds} onChange={event => updateEntry(index, { setupSeconds: event.target.value })} /></label>
                      <label><span>产品数量单位</span><input maxLength={20} value={entry.unitLabel} onChange={event => updateEntry(index, { unitLabel: event.target.value })} placeholder="套" /></label>
                      {invalid && <small>标准时间须大于 0；次数须为正整数；准备时间不能小于 0，单项均不超过 24 小时。</small>}
                    </div>
                    <div className="product-time-process-options">
                      <label><input type="checkbox" disabled={index === 0} checked={entry.parallelWithPrevious} onChange={event => updateEntry(index, { parallelWithPrevious: event.target.checked })} /><span>{index === 0 ? '首道工序' : '与上一道并行'}</span></label>
                      <label><input type="checkbox" checked={entry.countsForEfficiency} onChange={event => updateEntry(index, { countsForEfficiency: event.target.checked })} /><span>计入员工达成率</span></label>
                    </div>
                    <input className="product-time-row-remark" value={entry.remark} onChange={event => updateEntry(index, { remark: event.target.value })} placeholder="工序说明，可选" />
                    <div className="product-time-row-actions">
                      <button type="button" title="上移" aria-label={`上移${definition?.name || '工序'}`} disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button>
                      <button type="button" title="下移" aria-label={`下移${definition?.name || '工序'}`} disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button>
                      <button className="danger" type="button" title="移除" aria-label={`移除${definition?.name || '工序'}`} onClick={() => removeEntry(index)}><Trash2 size={15} /></button>
                    </div>
                  </article>;
                })}
                {!entries.length && <div className="product-time-empty large"><Library aria-hidden="true" /><strong>这款产品还没有工序路线</strong><span>从共享工序库添加实际参与的工序。未添加的工序视为该产品不参与，不会进入生产执行。</span><button className="hm-workbench-button primary" type="button" onClick={() => setLibraryOpen(true)}>从工序库添加</button></div>}
              </div>

              <label className="product-time-remark"><span>版本说明</span><textarea value={remark} onChange={event => { setRemark(event.target.value); setDirty(true); }} placeholder="记录测定依据、特殊设备或本次调整原因" /></label>

              <footer className="product-time-route-actions">
                <span className="product-time-route-status">
                  {hasUnsavedChanges && <b><AlertTriangle size={13} aria-hidden="true" />未保存</b>}
                  <em>{invalidEntryCount ? `${invalidEntryCount} 道工序工时无效` : activePublished ? '新发布版本只升级完全未开工且没有生产事实的路线；已开工路线保留原版本快照。' : '保存草稿后检查无误，再发布为生产可用版本。'}</em>
                </span>
                <div>
                  <button className="hm-workbench-button" type="button" disabled={!dirty || saving} onClick={resetChanges}><RotateCcw size={15} aria-hidden="true" />放弃</button>
                  <button className="hm-workbench-button" type="button" disabled={saving || !dirty || invalidEntryCount > 0 || entries.length === 0} onClick={() => void saveDraft()}><Save size={15} aria-hidden="true" />{saving ? '保存中' : '保存草稿'}</button>
                  <button className="hm-workbench-button primary" type="button" disabled={publishing || dirty || !activeDraft || invalidEntryCount > 0} onClick={() => void publish()}><CheckCircle2 size={15} aria-hidden="true" />{publishing ? '发布中' : '发布生产版本'}</button>
                </div>
              </footer>
            </>}
          </section>

          <aside className="product-time-context" aria-label="当前产品报价与快速起草">
            <section className="product-time-quotation-editor" aria-labelledby="product-time-quotation-title">
              <header><span><small>商业基准</small><strong id="product-time-quotation-title">单套报价工时</strong></span><b>{activeQuotation ? `V${activeQuotation.version}` : '待维护'}</b></header>
              {planningReference ? <div className="product-time-planning-candidate">
                <span><small>最近计划候选</small><strong>{duration(planningReference.unitMilliseconds)}</strong><em>{planningReference.weekStartDate && planningReference.weekEndDate ? `${planningReference.weekStartDate} 至 ${planningReference.weekEndDate}` : '计划订单'} · {planningReference.quantity.toLocaleString('zh-CN')} 件</em></span>
                <button type="button" onClick={adoptPlanningQuotation}>采用计划工时</button>
              </div> : <div className="product-time-planning-candidate empty"><span><small>最近计划候选</small><strong>暂无计划单套工时</strong><em>计划订单维护后可在这里人工采用</em></span></div>}
              <label><span>秒 / 套</span><input inputMode="decimal" value={quotationSeconds} onChange={event => { setQuotationSeconds(event.target.value); setQuotationSourceType('manual'); setQuotationSourceRefId(null); setQuotationDirty(true); }} placeholder="输入报价工时" /></label>
              <label><span>报价说明</span><input value={quotationRemark} onChange={event => { setQuotationRemark(event.target.value); setQuotationDirty(true); }} placeholder="版本或测算依据，可选" /></label>
              <div className="product-time-quotation-compare"><span>生产标准<strong>{perBatchEntryCount ? '含按批口径' : duration(totalMilliseconds)}</strong></span><span>计划候选<strong>{planningReference ? duration(planningReference.unitMilliseconds) : '暂无'}</strong></span><span>当前报价<strong>{activeQuotation ? duration(activeQuotation.unitMilliseconds) : '未录入'}</strong></span></div>
              <small className="product-time-quotation-source">当前编辑来源：{quotationSourceText(quotationSourceType)}。采用计划工时后仍需保存，保存会创建新的报价版本。</small>
              <button className="hm-workbench-button" type="button" disabled={quotationSaving || !quotationDirty} onClick={() => void saveQuotation()}><Save size={15} aria-hidden="true" />{quotationSaving ? '保存中' : '保存报价工时'}</button>
            </section>

            <section className="product-time-copy-panel">
              <header><small>快速起草</small><strong>复制相似产品路线</strong></header>
              <select value={copySourceId} onChange={event => setCopySourceId(event.target.value)} aria-label="选择已发布的相似产品"><option value="">选择已发布产品</option>{copySources.map(item => <option key={item.id} value={item.id}>{item.customerName} · {item.specification}</option>)}</select>
              <button className="hm-workbench-button" type="button" disabled={!copySourceId} onClick={copyProfile}><Copy size={15} aria-hidden="true" />复制后调整</button>
              <small>复制只生成当前产品的草稿，不会修改来源产品。</small>
            </section>
          </aside>
        </section>

        {libraryOpen && <button className="product-time-library-scrim" type="button" aria-label="关闭工序库" onClick={() => {
          setLibraryOpen(false);
          window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
        }} />}
        {libraryOpen && <aside id="product-process-library" className="product-time-library open" aria-label="共享工序库">
            <header><span><strong>共享工序库</strong><small>加入当前产品后填写单套该工序合计工时</small></span><button ref={libraryCloseRef} type="button" title="关闭工序库" aria-label="关闭工序库" onClick={() => {
              setLibraryOpen(false);
              window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
            }}><X size={17} /></button></header>
            <label className="product-time-library-search"><Search size={15} aria-hidden="true" /><input value={libraryKeyword} onChange={event => setLibraryKeyword(event.target.value)} placeholder="搜索工序" /></label>
            <div className="product-time-stage-tabs">{(['all', 'frontend', 'backend', 'finish'] as const).map(value => <button key={value} className={libraryStage === value ? 'active' : ''} type="button" onClick={() => setLibraryStage(value)}>{value === 'all' ? '全部' : stageText[value]}</button>)}</div>
            <div className="product-time-definition-list hm-scroll-region" tabIndex={0}>{filteredDefinitions.map(definition => <button key={definition.id} type="button" onClick={() => addDefinition(definition)}><span><strong>{definition.name}</strong><small>{stageText[definition.stageGroup]}</small></span><Plus size={15} aria-hidden="true" /></button>)}{!filteredDefinitions.length && <p>没有可添加的工序</p>}</div>
            <section className="product-time-new-process"><strong>新增共享工序</strong><input value={newProcessName} onChange={event => setNewProcessName(event.target.value)} placeholder="工序名称" maxLength={60} /><select value={newProcessStage} onChange={event => setNewProcessStage(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select><button className="hm-workbench-button" type="button" disabled={creatingProcess} onClick={createProcess}><Plus size={15} />{creatingProcess ? '创建中' : '创建并加入'}</button></section>
        </aside>}
      </div>

      {referenceOpen && <div className="product-time-reference-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeReferencePreview();
      }}>
        <section
          className="product-time-reference-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-time-reference-title"
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <header>
            <div><BookOpenText aria-hidden="true" /><span><small>工艺临时参考</small><strong id="product-time-reference-title">{selectedItem?.specification || '当前产品'} · 图纸与作业指导书</strong></span></div>
            <div>
              <a className="hm-workbench-button" href={selectedItem ? `/drawing-library?itemId=${encodeURIComponent(selectedItem.id)}` : '/drawing-library'} title="进入完整图纸资料页"><ExternalLink size={15} aria-hidden="true" />资料页</a>
              <button ref={referenceCloseRef} type="button" title="关闭资料预览" aria-label="关闭资料预览" onClick={closeReferencePreview}><X size={18} /></button>
            </div>
          </header>
          <nav aria-label="参考资料分类">
            <button type="button" className={referenceCategoryFilter === 'drawing' ? 'active' : ''} onClick={() => setReferenceCategoryFilter('drawing')}>原图 <b>{referenceDrawingCount}</b></button>
            <button type="button" className={referenceCategoryFilter === 'sop' ? 'active' : ''} onClick={() => setReferenceCategoryFilter('sop')}>作业指导书 <b>{referenceSopCount}</b></button>
            <button type="button" className={referenceCategoryFilter === 'all' ? 'active' : ''} onClick={() => setReferenceCategoryFilter('all')}>全部资料 <b>{referenceFiles.length}</b></button>
          </nav>
          <div className="product-time-reference-body">
            <aside className="product-time-reference-list hm-scroll-region" aria-label="参考资料文件列表" tabIndex={0}>
              {referenceLoading && <div className="product-time-context-loading"><RefreshCw className="spin" size={17} aria-hidden="true" />正在读取资料</div>}
              {!referenceLoading && referenceError && <div className="product-time-context-error"><AlertTriangle size={16} aria-hidden="true" />{referenceError}</div>}
              {!referenceLoading && !referenceError && visibleReferenceFiles.map(file => <button className={selectedReferenceFile?.id === file.id ? 'active' : ''} type="button" key={file.id} onClick={() => setReferenceFileId(file.id)} title={file.displayName || file.originalName}>
                {file.mimeType.includes('pdf') || file.fileType.toLocaleLowerCase('zh-CN') === 'pdf' ? <FileText size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}
                <span><strong>{file.displayName || file.originalName}</strong><small>{file.categoryName || '未分类'} · {file.version || 'V1.0'}</small></span>
              </button>)}
              {!referenceLoading && !referenceError && !visibleReferenceFiles.length && <div className="product-time-empty compact"><BookOpenText aria-hidden="true" /><strong>当前分类暂无资料</strong><span>可进入资料页上传原图或作业指导书。</span></div>}
            </aside>
            <div className="product-time-reference-viewer">
              {selectedReferenceFile && (selectedReferenceFile.mimeType.includes('pdf') || selectedReferenceFile.fileType.toLocaleLowerCase('zh-CN') === 'pdf') && <PdfViewer fileId={selectedReferenceFile.id} title={selectedReferenceFile.displayName || selectedReferenceFile.originalName} contentUrl={selectedReferenceFile.contentUrl} downloadUrl={selectedReferenceFile.downloadUrl} viewUrl={selectedReferenceFile.viewUrl} dashboardMode />}
              {selectedReferenceFile && selectedReferenceFile.mimeType.startsWith('image/') && <ImageViewer fileId={selectedReferenceFile.id} title={selectedReferenceFile.displayName || selectedReferenceFile.originalName} contentUrl={selectedReferenceFile.contentUrl} downloadUrl={selectedReferenceFile.downloadUrl} gestureResetKey={selectedReferenceFile.id} dashboardMode />}
              {selectedReferenceFile && !selectedReferenceFile.mimeType.includes('pdf') && selectedReferenceFile.fileType.toLocaleLowerCase('zh-CN') !== 'pdf' && !selectedReferenceFile.mimeType.startsWith('image/') && <div className="product-time-empty large"><FileText aria-hidden="true" /><strong>此文件暂不支持内嵌预览</strong><span>{selectedReferenceFile.displayName || selectedReferenceFile.originalName}</span><a className="hm-workbench-button" href={selectedReferenceFile.viewUrl} target="_blank" rel="noreferrer">打开文件<ExternalLink size={15} aria-hidden="true" /></a></div>}
              {!selectedReferenceFile && !referenceLoading && <div className="product-time-empty large"><BookOpenText aria-hidden="true" /><strong>暂无可预览资料</strong><span>进入图纸资料页上传原图或作业指导书后即可临时查阅。</span></div>}
            </div>
          </div>
        </section>
      </div>}

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
            <div className="product-time-import-list-head"><span>行</span><span>产品 / 客户</span><span>工序</span><span>单套合计</span><span>状态</span></div>
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
