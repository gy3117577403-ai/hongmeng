'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
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
  GripVertical,
  Image as ImageIcon,
  Info,
  Library,
  Layers3,
  ListOrdered,
  LoaderCircle,
  MoveVertical,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { useToast, useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { productTimeReturnContextFromSearch, type ProductTimeReturnContext } from '@/lib/workflow-routes';
import { ClientFetchError, fetchJson } from '@/lib/client-fetch';
import type {
  CurrentUserDTO,
  DrawingLibraryFileDTO,
  DrawingLibraryItemDTO,
  ProductQuotationTimeDTO,
  ProductProcessTimeEntryDTO,
  ProductTimeCopySourceDTO,
  ProductTimeDeploymentDTO,
  ProductTimeDeploymentPreviewDTO,
  ProductTimeListItemDTO,
  ProductTimePlanningScope,
  ProductTimePlanningSummaryDTO,
  ProductTimeProfileDTO,
  ProcessReportQuantityBasis,
  ProcessReportingPolicy,
  ProcessStageGroup,
  ProcessTimeBasis,
} from '@/types';
import {
  countProductTimeDeploymentDiffs,
  failedProductTimeDeploymentRoutes,
  productTimeDeploymentProgress,
  productTimeDeploymentRouteStateText,
  productTimeDeploymentRouteStatusText,
  productTimeDeploymentStatusText,
} from '@/lib/product-time-deployment-presenter';
import {
  groupKeyForProductTimeEntry,
  insertProductTimeRouteEntry,
  moveProductTimeRouteGroupBefore,
  moveProductTimeRouteGroupByDirection,
  productTimeRouteGroups,
  removeProductTimeRouteEntry,
  reorderProductTimeRouteGroup,
  type ProductTimeRouteGroup,
} from '@/lib/product-time-route-editor';

type ProcessDefinition = {
  id: string;
  code: string;
  name: string;
  stageGroup: ProcessStageGroup;
  sortOrder: number;
};

type CustomerOption = { customerName: string; count: number };
type DiscardPrompt = { actionLabel: string; detail: string };
type DraftRebuildPrompt = {
  itemId: string;
  specification: string;
  draftVersion: number;
  draftRevision: number;
  publishedVersion: number;
  publishedProcessCount: number;
  confirmationText: string;
  hadRouteChanges: boolean;
  hadQuotationChanges: boolean;
};
type ProductTimePayload = {
  ok: boolean;
  error?: string;
  code?: string;
  requestId?: string;
  items?: ProductTimeListItemDTO[];
  definitions?: ProcessDefinition[];
  customers?: CustomerOption[];
  planningScope?: ProductTimePlanningScope;
  planningSummary?: ProductTimePlanningSummaryDTO | null;
  periods?: {
    current: { weekStartDate: string; weekEndDate: string };
    next: { weekStartDate: string; weekEndDate: string };
  };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

type ProductTimeDetailPayload = {
  ok?: boolean;
  error?: string;
  item?: Pick<ProductTimeListItemDTO, 'id' | 'customerName' | 'customerCode' | 'specification' | 'productName' | 'updatedAt'>;
  profiles?: ProductTimeProfileDTO[];
  quotation?: ProductQuotationTimeDTO | null;
};

type ProductTimeDeploymentApiPayload = {
  ok?: boolean;
  error?: string;
  code?: string;
  preview?: ProductTimeDeploymentPreviewDTO;
  deployment?: ProductTimeDeploymentDTO;
};

type ProductTimeDraftSyncSummary = {
  baseVersion: number | null;
  fromDraftVersion: number;
  publishedVersion: number;
  toDraftVersion: number;
  addedFromPublished: number;
  updatedFromPublished: number;
  removedFromPublished: number;
  preservedDraftChanges: number;
  conflicts: Array<{
    kind: string;
    occurrenceKey: string | null;
    processDefinitionId: string | null;
    fields: string[];
    resolution: 'draft_preserved' | 'published_restored';
  }>;
};

function deploymentPreviewFromPayload(payload: ProductTimeDeploymentApiPayload): ProductTimeDeploymentPreviewDTO | null {
  if (payload.preview) return payload.preview;
  return 'previewToken' in payload
    ? payload as unknown as ProductTimeDeploymentPreviewDTO
    : null;
}

function deploymentFromPayload(payload: ProductTimeDeploymentApiPayload): ProductTimeDeploymentDTO | null {
  if (payload.deployment) return payload.deployment;
  return 'id' in payload && 'routes' in payload
    ? payload as unknown as ProductTimeDeploymentDTO
    : null;
}

type ReferenceCategory = 'drawing' | 'sop' | 'all';

type EntryDraft = {
  processDefinitionId: string;
  occurrenceKey: string;
  timeBasis: ProcessTimeBasis;
  unitSeconds: string;
  occurrences: string;
  setupSeconds: string;
  unitLabel: string;
  reportQuantityBasis: ProcessReportQuantityBasis;
  reportUnitLabel: string;
  parallelWithPrevious: boolean;
  countsForEfficiency: boolean;
  isCritical: boolean;
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
    occurrenceKey: entry.occurrenceKey,
    timeBasis: entry.timeBasis,
    unitSeconds: seconds(usesActionCount ? entry.actionMilliseconds : entry.unitMilliseconds),
    occurrences: String(usesActionCount ? entry.occurrences : 1),
    setupSeconds: seconds(entry.setupMilliseconds) || '0',
    unitLabel: entry.unitLabel || '套',
    reportQuantityBasis: entry.reportQuantityBasis || 'product',
    reportUnitLabel: entry.reportUnitLabel || '个',
    parallelWithPrevious: index > 0 && allEntries[index - 1].sequenceGroup === entry.sequenceGroup,
    countsForEfficiency: entry.countsForEfficiency,
    isCritical: entry.isCritical,
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

function entryValidation(entry: EntryDraft): {
  unitSeconds: boolean;
  setupSeconds: boolean;
  occurrences: boolean;
  reportUnitLabel: boolean;
  messages: string[];
} {
  const value = Number(entry.unitSeconds);
  const setup = Number(entry.setupSeconds || 0);
  const occurrences = Number(entry.occurrences || 1);
  const unitSeconds = !Number.isFinite(value) || value <= 0 || value > 86_400;
  const setupSeconds = !Number.isFinite(setup) || setup < 0 || setup > 86_400;
  const occurrenceInvalid = entry.timeBasis === 'per_unit'
    && (!Number.isInteger(occurrences) || occurrences <= 0 || occurrences > 10_000);
  const reportUnitLabel = entry.reportQuantityBasis === 'action'
    && (entry.timeBasis !== 'per_unit' || occurrences <= 1 || !entry.reportUnitLabel.trim());
  const messages: string[] = [];
  if (unitSeconds) messages.push('标准时间须大于 0 且不超过 24 小时');
  if (setupSeconds) messages.push('准备时间不能小于 0 且不超过 24 小时');
  if (occurrenceInvalid) messages.push('每套工序次数须为 1–10000 的整数');
  if (reportUnitLabel) messages.push('按动作报工须填写动作单位，且每套次数须大于 1');
  return { unitSeconds, setupSeconds, occurrences: occurrenceInvalid, reportUnitLabel, messages };
}

function invalidEntry(entry: EntryDraft): boolean {
  return entryValidation(entry).messages.length > 0;
}

function entryFormula(entry: EntryDraft): string {
  const value = Number(entry.unitSeconds);
  const setup = Number(entry.setupSeconds || 0);
  const occurrences = Number(entry.occurrences || 1);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(setup) || setup < 0) return '';
  if (entry.timeBasis === 'per_batch') return `${value.toLocaleString('zh-CN')} 秒/批 + ${setup.toLocaleString('zh-CN')} 秒准备`;
  if (!Number.isInteger(occurrences) || occurrences <= 0) return '';
  const total = value * occurrences + setup;
  return `${value.toLocaleString('zh-CN')} 秒 × ${occurrences.toLocaleString('zh-CN')} 次 + ${setup.toLocaleString('zh-CN')} 秒准备 = ${total.toLocaleString('zh-CN')} 秒/套`;
}

function statusText(item: ProductTimeListItemDTO): string {
  if (item.draft && item.published && item.draft.version <= item.published.version) {
    return `草稿待同步 · 正式 V${item.published.version}`;
  }
  if (item.draft) return item.published ? '新版草稿' : '草稿';
  if (item.published) return `已发布 V${item.published.version}`;
  return '工时待维护';
}

function draftSyncConflictMessage(kind: string): string {
  if (kind === 'PUBLISHED_DELETED_DRAFT_CHANGED') return '正式版已删除此工序，但旧草稿修改过它，当前保留草稿内容，请确认是否仍需重新下发。';
  if (kind === 'DRAFT_DELETED_PUBLISHED_CHANGED') return '旧草稿曾删除此工序，但正式版后来又修改过它，当前已按正式版恢复，请重新确认。';
  return '旧草稿和最新正式版都修改了此工序，当前保留草稿值；发布预览会再次展示差异，请重点复核。';
}

type StructuralUndo = {
  entries: EntryDraft[];
  label: string;
  dirtyBefore: boolean;
};

type SortableProductTimeGroupProps = {
  group: ProductTimeRouteGroup<EntryDraft>;
  groupIndex: number;
  groupCount: number;
  definitions: ProcessDefinition[];
  onInsertBefore: (group: ProductTimeRouteGroup<EntryDraft>, trigger: HTMLButtonElement) => void;
  onInsertAfter: (group: ProductTimeRouteGroup<EntryDraft>, trigger: HTMLButtonElement) => void;
  onMove: (group: ProductTimeRouteGroup<EntryDraft>) => void;
  onMoveByDirection: (group: ProductTimeRouteGroup<EntryDraft>, direction: -1 | 1) => void;
};

function SortableProductTimeGroup({
  group,
  groupIndex,
  groupCount,
  definitions,
  onInsertBefore,
  onInsertAfter,
  onMove,
  onMoveByDirection,
}: SortableProductTimeGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.key });
  const processNames = group.entries.map(entry => definitions.find(
    definition => definition.id === entry.processDefinitionId,
  )?.name || '工序已停用');
  const containsBatchTime = group.entries.some(entry => entry.timeBasis === 'per_batch');
  const range = group.startIndex === group.endIndex
    ? `第 ${group.startIndex + 1} 道`
    : `第 ${group.startIndex + 1}–${group.endIndex + 1} 道`;

  return <article
    ref={setNodeRef}
    className={isDragging ? 'dragging' : ''}
    style={{ transform: CSS.Transform.toString(transform), transition }}
  >
    <button
      className="product-time-drag-handle"
      type="button"
      aria-label={`拖动${processNames.join('、')}调整顺序`}
      title="拖动整组调整顺序"
      {...attributes}
      {...listeners}
    ><GripVertical size={18} aria-hidden="true" /></button>
    <b>{range}</b>
    <span className="product-time-reorder-names">
      <strong>{processNames.join(' / ')}</strong>
      <small>{group.entries.length > 1 ? `并行组 · ${group.entries.length} 道` : '顺序工序'} · {containsBatchTime ? '含按批工时' : duration(draftTotal(group.entries))}</small>
    </span>
    <div className="product-time-reorder-actions">
      <button type="button" disabled={groupIndex === 0} onClick={() => onMoveByDirection(group, -1)}><ArrowUp size={14} aria-hidden="true" />上移</button>
      <button type="button" disabled={groupIndex === groupCount - 1} onClick={() => onMoveByDirection(group, 1)}><ArrowDown size={14} aria-hidden="true" />下移</button>
      <button type="button" onClick={event => onInsertBefore(group, event.currentTarget)}>前加</button>
      <button type="button" onClick={event => onInsertAfter(group, event.currentTarget)}>后加</button>
      <button type="button" onClick={() => onMove(group)}><MoveVertical size={14} aria-hidden="true" />移至</button>
    </div>
  </article>;
}

export default function ProductTimeShell({ user }: { user: CurrentUserDTO }) {
  const canManageProductTimes = (
    user.access.capabilities.includes('PROCESS:UPDATE')
    && user.access.capabilities.includes('PROCESS:CREATE')
  ) || (
    user.access.capabilities.includes('PRODUCT_TIME:UPDATE')
    && user.access.capabilities.includes('PRODUCT_TIME:CREATE')
  );
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
  const [reportingPolicy, setReportingPolicy] = useState<ProcessReportingPolicy>('free_sequence');
  const [dirty, setDirty] = useState(false);
  const [quotationSeconds, setQuotationSeconds] = useState('');
  const [quotationRemark, setQuotationRemark] = useState('');
  const [quotationSourceType, setQuotationSourceType] = useState<ProductQuotationTimeDTO['sourceType']>('manual');
  const [quotationSourceRefId, setQuotationSourceRefId] = useState<string | null>(null);
  const [quotationDirty, setQuotationDirty] = useState(false);
  const [quotationSaving, setQuotationSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listTotal, setListTotal] = useState(0);
  const [listHasMore, setListHasMore] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [loadFailure, setLoadFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftSyncing, setDraftSyncing] = useState(false);
  const [draftSyncSummary, setDraftSyncSummary] = useState<(ProductTimeDraftSyncSummary & { itemId: string }) | null>(null);
  const [draftRebuildPrompt, setDraftRebuildPrompt] = useState<DraftRebuildPrompt | null>(null);
  const [draftRebuildConfirmText, setDraftRebuildConfirmText] = useState('');
  const [draftRebuilding, setDraftRebuilding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [deploymentPreviewLoading, setDeploymentPreviewLoading] = useState(false);
  const [deploymentRetrying, setDeploymentRetrying] = useState(false);
  const [deploymentPreview, setDeploymentPreview] = useState<ProductTimeDeploymentPreviewDTO | null>(null);
  const [deployment, setDeployment] = useState<ProductTimeDeploymentDTO | null>(null);
  const [deploymentError, setDeploymentError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryStage, setLibraryStage] = useState<'all' | ProcessStageGroup>('all');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBeforeGroupKey, setLibraryBeforeGroupKey] = useState<string | null>(null);
  const [libraryParallelWithPrevious, setLibraryParallelWithPrevious] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [structuralUndo, setStructuralUndo] = useState<StructuralUndo | null>(null);
  const [moveGroupKey, setMoveGroupKey] = useState<string | null>(null);
  const [moveBeforeGroupKey, setMoveBeforeGroupKey] = useState<string | null>(null);
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessStage, setNewProcessStage] = useState<ProcessStageGroup>('backend');
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [copySourceKeyword, setCopySourceKeyword] = useState('');
  const [copySources, setCopySources] = useState<ProductTimeCopySourceDTO[]>([]);
  const [copySourcesLoading, setCopySourcesLoading] = useState(false);
  const [copySourceError, setCopySourceError] = useState('');
  const [copyingProfile, setCopyingProfile] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState<DiscardPrompt | null>(null);
  const [ruleHintOpen, setRuleHintOpen] = useState(false);
  const [returnContext, setReturnContext] = useState<ProductTimeReturnContext | null>(null);
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
  const libraryReturnFocusRef = useRef<HTMLElement | null>(null);
  const referenceTriggerRef = useRef<HTMLButtonElement>(null);
  const referenceCloseRef = useRef<HTMLButtonElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importCloseRef = useRef<HTMLButtonElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const copySearchRef = useRef<HTMLInputElement>(null);
  const copyTriggerRef = useRef<HTMLButtonElement>(null);
  const copyConfirmCloseRef = useRef<HTMLButtonElement>(null);
  const draftRebuildInputRef = useRef<HTMLInputElement>(null);
  const draftRebuildReturnFocusRef = useRef<HTMLElement | null>(null);
  const discardCloseRef = useRef<HTMLButtonElement>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const pendingDiscardActionRef = useRef<(() => void) | null>(null);
  const deploymentCloseRef = useRef<HTMLButtonElement>(null);
  const initialSelectionRef = useRef(false);
  const lastExternalRefreshRef = useRef(0);
  const lastSuccessfulRefreshRef = useRef(0);
  const selectedIdRef = useRef('');
  const listRequestRef = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const optionsLoadedRef = useRef(false);
  const unsavedToastShownRef = useRef(false);
  const completedDeploymentRef = useRef('');
  const routeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { showToast } = useToast();
  useToastBridge(message, setMessage);
  useToastBridge(error, setError, 'error');

  const hasUnsavedChanges = dirty || quotationDirty;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
  const staleDraft = Boolean(
    activeDraft
    && activePublished
    && activeDraft.version <= activePublished.version,
  );
  const activeQuotation = selectedItem?.quotation || null;
  const deploymentBusy = publishing || deployment?.status === 'pending' || deployment?.status === 'applying';
  const selectedCopySource = copySources.find(source => source.profileId === copySourceId) || null;
  const referenceFiles = useMemo(
    () => referenceItem?.files.filter(file => !file.deletedAt) || [],
    [referenceItem],
  );
  const visibleReferenceFiles = useMemo(
    () => referenceFiles.filter(file => referenceCategoryFilter === 'all' || referenceCategory(file) === referenceCategoryFilter),
    [referenceCategoryFilter, referenceFiles],
  );
  const selectedReferenceFile = visibleReferenceFiles.find(file => file.id === referenceFileId) || visibleReferenceFiles[0] || null;
  const routeSequenceGroups = useMemo(() => productTimeRouteGroups(entries), [entries]);
  const draftSyncConflictByKey = useMemo(() => new Map(
    (draftSyncSummary?.itemId === selectedItemId ? draftSyncSummary.conflicts : [])
      .filter(conflict => conflict.occurrenceKey)
      .map(conflict => [conflict.occurrenceKey as string, conflict] as const),
  ), [draftSyncSummary, selectedItemId]);
  const effectiveLibraryBeforeGroupKey = routeSequenceGroups.some(group => group.key === libraryBeforeGroupKey)
    ? libraryBeforeGroupKey
    : null;
  const libraryTargetGroup = effectiveLibraryBeforeGroupKey
    ? routeSequenceGroups.find(group => group.key === effectiveLibraryBeforeGroupKey) || null
    : null;
  const libraryInsertionIndex = libraryTargetGroup?.startIndex ?? entries.length;
  const selectedMoveGroup = moveGroupKey
    ? routeSequenceGroups.find(group => group.key === moveGroupKey) || null
    : null;

  const load = useCallback(async (preferredItemId?: string, requestedPage = 1) => {
    const append = requestedPage > 1;
    listRequestRef.current?.controller.abort();
    const request = {
      sequence: (listRequestRef.current?.sequence || 0) + 1,
      controller: new AbortController(),
    };
    listRequestRef.current = request;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    setLoadFailure(null);
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (customer) params.set('customer', customer);
      if (status !== 'all') params.set('status', status);
      if (planningScope !== 'all') params.set('scope', planningScope);
      if (planningScope === 'history') params.set('weekStartDate', historyWeekStart);
      params.set('page', String(requestedPage));
      params.set('pageSize', '50');
      if (optionsLoadedRef.current) params.set('includeOptions', '0');
      const data = await fetchJson<ProductTimePayload>(`/api/product-time-profiles?${params.toString()}`, {
        cache: 'no-store',
        signal: request.controller.signal,
        timeoutMs: 12_000,
        retries: 1,
      });
      if (listRequestRef.current?.sequence !== request.sequence) return;
      let nextItems = data.items || [];
      if (data.definitions) setDefinitions(data.definitions);
      if (data.customers) setCustomers(data.customers);
      if (data.definitions && data.customers) optionsLoadedRef.current = true;
      setPlanningSummary(data.planningSummary || null);
      setPeriods(data.periods);
      const urlItemId = new URLSearchParams(window.location.search).get('itemId') || '';
      const requested = preferredItemId || urlItemId || selectedIdRef.current;
      if (!append && requested && !nextItems.some(item => item.id === requested)) {
        try {
          const detail = await fetchJson<ProductTimeDetailPayload>(`/api/product-time-profiles/${encodeURIComponent(requested)}`, {
            cache: 'no-store',
            signal: request.controller.signal,
            timeoutMs: 8_000,
            retries: 1,
          });
          if (detail.item) {
          const profiles = detail.profiles || [];
          nextItems = [{
            ...detail.item,
            draft: profiles.find(profile => profile.status === 'draft') || null,
            published: profiles.find(profile => profile.status === 'published') || null,
            quotation: detail.quotation || null,
            planning: null,
            planningReference: null,
          }, ...nextItems];
          } else if (preferredItemId || urlItemId) {
            setError(detail.error || '指定产品不存在、已删除或无权访问');
          }
        } catch (detailError) {
          if (preferredItemId || urlItemId) {
            setError(detailError instanceof Error ? detailError.message : '指定产品加载失败');
          }
        }
      }
      if (append) {
        setItems(current => {
          const existing = new Set(current.map(item => item.id));
          return [...current, ...nextItems.filter(item => !existing.has(item.id))];
        });
      } else {
        setItems(nextItems);
        setSelectedId(nextItems.some(item => item.id === requested) ? requested : nextItems[0]?.id || '');
      }
      setListPage(data.pagination?.page || requestedPage);
      setListTotal(data.pagination?.total ?? nextItems.length);
      setListHasMore(data.pagination?.hasMore === true);
      lastSuccessfulRefreshRef.current = Date.now();
    } catch (reason) {
      if (request.controller.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : '产品工时加载失败';
      const requestId = reason instanceof ClientFetchError ? reason.requestId : undefined;
      setError(requestId ? `${message}（追踪号 ${requestId}）` : message);
      setLoadFailure({ message, requestId });
    } finally {
      if (listRequestRef.current?.sequence === request.sequence) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [customer, historyWeekStart, keyword, planningScope, status]);

  function requestDiscard(actionLabel: string, detail: string, action: () => void): void {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    discardReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingDiscardActionRef.current = action;
    setDiscardPrompt({ actionLabel, detail });
  }

  function closeDiscardPrompt(): void {
    pendingDiscardActionRef.current = null;
    setDiscardPrompt(null);
    window.requestAnimationFrame(() => discardReturnFocusRef.current?.focus());
  }

  function confirmDiscardAndContinue(): void {
    const action = pendingDiscardActionRef.current;
    pendingDiscardActionRef.current = null;
    setDiscardPrompt(null);
    resetChanges();
    window.requestAnimationFrame(() => action?.());
  }

  function changePlanningScope(scope: ProductTimePlanningScope): void {
    const scopeLabel: Record<ProductTimePlanningScope, string> = {
      all: '产品总库',
      current: '本周计划',
      next: '下周预备',
      carryover: '遗留未完',
      history: '历史周',
    };
    requestDiscard(`切换到“${scopeLabel[scope]}”`, '切换范围会重新加载产品列表。', () => {
      setPlanningScope(scope);
      setStatus('all');
      const url = new URL(window.location.href);
      if (scope === 'all') url.searchParams.delete('scope');
      else url.searchParams.set('scope', scope);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    });
  }

  useEffect(() => {
    const search = window.location.search;
    const urlScope = new URLSearchParams(search).get('scope');
    if (urlScope === 'current' || urlScope === 'next' || urlScope === 'carryover' || urlScope === 'history') {
      setPlanningScope(urlScope);
    }
    setReturnContext(productTimeReturnContextFromSearch(search));
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
      if (now - lastExternalRefreshRef.current < 10_000) return;
      if (now - lastSuccessfulRefreshRef.current < 60_000) return;
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
    setReportingPolicy(activeProfile?.reportingPolicy || 'free_sequence');
    setCopySourceId('');
    setDirty(false);
    setReorderMode(false);
    setStructuralUndo(null);
    setMoveGroupKey(null);
    setMoveBeforeGroupKey(null);
    setLibraryBeforeGroupKey(null);
    setLibraryParallelWithPrevious(false);
    setQuotationSeconds(seconds(selectedItem?.quotation?.unitMilliseconds));
    setQuotationRemark(selectedItem?.quotation?.remark || '');
    setQuotationSourceType(selectedItem?.quotation?.sourceType || 'manual');
    setQuotationSourceRefId(selectedItem?.quotation?.sourceRefId || null);
    setQuotationDirty(false);
  }, [activeProfile, selectedItem?.id, selectedItem?.quotation]);

  useEffect(() => {
    if (!selectedItemId) {
      setReferenceItem(null);
      setReferenceError('');
      return;
    }
    if (!referenceOpen) {
      setReferenceItem(null);
      setReferenceFileId('');
      setReferenceLoading(false);
      setReferenceError('');
      return;
    }
    const controller = new AbortController();
    setReferenceItem(null);
    setReferenceFileId('');
    setReferenceLoading(true);
    setReferenceError('');
    fetchJson<{ ok?: boolean; error?: string; item?: DrawingLibraryItemDTO }>(`/api/drawing-library/${selectedItemId}`, {
      cache: 'no-store',
      signal: controller.signal,
      timeoutMs: 10_000,
      retries: 1,
    })
      .then(data => {
        if (!data.item) throw new Error(data.error || '参考资料加载失败');
        setReferenceItem(data.item);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setReferenceItem(null);
        setReferenceError(reason instanceof Error ? reason.message : '参考资料加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setReferenceLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [referenceOpen, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setCopySources([]);
      setCopySourcesLoading(false);
      setCopySourceError('');
      return undefined;
    }
    setCopySourcesLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCopySourceError('');
      try {
        const params = new URLSearchParams({ excludeItemId: selectedItemId, limit: '40' });
        if (copySourceKeyword.trim()) params.set('keyword', copySourceKeyword.trim());
        const response = await fetch(`/api/product-time-profiles/sources?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({})) as {
          ok?: boolean;
          error?: string;
          sources?: ProductTimeCopySourceDTO[];
        };
        if (!response.ok) throw new Error(data.error || '已发布产品路线加载失败');
        setCopySources(data.sources || []);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setCopySources([]);
        setCopySourceError(reason instanceof Error ? reason.message : '已发布产品路线加载失败');
      } finally {
        if (!controller.signal.aborted) setCopySourcesLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [copySourceKeyword, selectedItemId]);

  useEffect(() => {
    setCopySourceId('');
    setCopySources([]);
    setDraftSyncSummary(null);
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
    if (!libraryOpen && !importOpen && !referenceOpen && !deploymentOpen && !moveGroupKey && !copyConfirmOpen && !discardPrompt && !draftRebuildPrompt) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      if (draftRebuildPrompt) draftRebuildInputRef.current?.focus();
      else if (discardPrompt) discardCloseRef.current?.focus();
      else if (copyConfirmOpen) copyConfirmCloseRef.current?.focus();
      else if (deploymentOpen) deploymentCloseRef.current?.focus();
      else if (referenceOpen) referenceCloseRef.current?.focus();
      else if (importOpen) importCloseRef.current?.focus();
      else if (libraryOpen && window.matchMedia('(max-width: 1500px)').matches) libraryCloseRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [copyConfirmOpen, deploymentOpen, discardPrompt, draftRebuildPrompt, importOpen, libraryOpen, moveGroupKey, referenceOpen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (draftRebuildPrompt) {
        if (draftRebuilding) return;
        setDraftRebuildPrompt(null);
        setDraftRebuildConfirmText('');
        window.requestAnimationFrame(() => draftRebuildReturnFocusRef.current?.focus());
        return;
      }
      if (discardPrompt) {
        pendingDiscardActionRef.current = null;
        setDiscardPrompt(null);
        window.requestAnimationFrame(() => discardReturnFocusRef.current?.focus());
        return;
      }
      if (copyConfirmOpen) {
        setCopyConfirmOpen(false);
        window.requestAnimationFrame(() => copyTriggerRef.current?.focus());
        return;
      }
      if (ruleHintOpen) {
        setRuleHintOpen(false);
        return;
      }
      if (deploymentOpen) {
        setDeploymentOpen(false);
        return;
      }
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
      if (moveGroupKey) {
        setMoveGroupKey(null);
        return;
      }
      if (libraryOpen) {
        setLibraryOpen(false);
        window.requestAnimationFrame(() => (libraryReturnFocusRef.current || libraryTriggerRef.current)?.focus());
        return;
      }
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [copyConfirmOpen, deploymentOpen, discardPrompt, draftRebuildPrompt, draftRebuilding, importOpen, libraryOpen, moveGroupKey, referenceOpen, ruleHintOpen]);

  useEffect(() => {
    const deploymentId = deployment?.id;
    const status = deployment?.status;
    if (!deploymentId || (status !== 'pending' && status !== 'applying')) return undefined;

    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt > 120_000) {
        setDeploymentError('发布仍在后台执行，已停止自动轮询；可点击刷新进度继续查看');
        return;
      }
      if (document.visibilityState !== 'visible') {
        timer = window.setTimeout(poll, 5000);
        return;
      }
      try {
        const data = await fetchJson<ProductTimeDeploymentApiPayload>(`/api/product-time-deployments/${encodeURIComponent(deploymentId)}`, {
          cache: 'no-store',
          timeoutMs: 8000,
        });
        const next = deploymentFromPayload(data);
        if (!next) throw new Error(data.error || '发布进度读取失败');
        if (cancelled) return;
        failures = 0;
        setDeployment(next);
        setDeploymentError(next.error || '');
        if (next.status === 'pending' || next.status === 'applying') {
          timer = window.setTimeout(poll, 1200);
          return;
        }
        if (next.status === 'active' && completedDeploymentRef.current !== next.id) {
          completedDeploymentRef.current = next.id;
          setMessage(`产品工序与工时 V${next.profileVersion} 已发布，并同步到二维码和全部关联工单`);
          showToast('发布完成：二维码仍然有效，扫码会读取最新工序与工时', {
            tone: 'success',
            duration: 6000,
            dedupeKey: `product-time-deployment-active:${next.id}`,
          });
          await load(next.itemId);
        }
        if (next.status === 'failed') {
          setDeploymentError(next.error || '部分工单同步失败，正式版本未静默部分生效');
        }
      } catch (reason) {
        if (!cancelled) {
          failures += 1;
          setDeploymentError(reason instanceof Error ? reason.message : '发布进度读取失败');
          timer = window.setTimeout(poll, Math.min(10_000, 1500 * (2 ** Math.min(failures, 3))));
        }
      }
    };
    timer = window.setTimeout(poll, 900);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [deployment?.id, deployment?.status, load, showToast]);

  const filteredDefinitions = useMemo(() => definitions.filter(definition => {
    if (libraryStage !== 'all' && definition.stageGroup !== libraryStage) return false;
    const normalized = libraryKeyword.trim().toLocaleLowerCase('zh-CN');
    return !normalized || `${definition.name} ${definition.code}`.toLocaleLowerCase('zh-CN').includes(normalized);
  }), [definitions, libraryKeyword, libraryStage]);

  function selectProduct(itemId: string): void {
    if (selectedItem?.id === itemId) return;
    if (deploymentBusy) {
      setDeploymentOpen(true);
      setDeploymentError('当前产品仍在发布同步中，请等待完成后再切换产品');
      return;
    }
    const target = items.find(item => item.id === itemId);
    requestDiscard(
      `切换到“${target?.specification || '所选产品'}”`,
      '切换产品会载入另一套工序路线和报价数据。',
      () => {
        setError('');
        setDeploymentPreview(null);
        setDeployment(null);
        setDeploymentError('');
        setDeploymentOpen(false);
        setSelectedId(itemId);
        const url = new URL(window.location.href);
        url.searchParams.set('itemId', itemId);
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      },
    );
  }

  function resetChanges(): void {
    setEntries(activeProfile?.entries.map(entryDraft) || []);
    setRemark(activeProfile?.remark || '');
    setReportingPolicy(activeProfile?.reportingPolicy || 'free_sequence');
    setCopySourceId('');
    setDirty(false);
    setReorderMode(false);
    setStructuralUndo(null);
    setMoveGroupKey(null);
    setMoveBeforeGroupKey(null);
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

  function structuralOrderChanged(current: EntryDraft[], next: EntryDraft[]): boolean {
    if (current.length !== next.length) return true;
    return current.some((entry, index) => entry.occurrenceKey !== next[index]?.occurrenceKey
      || entry.parallelWithPrevious !== next[index]?.parallelWithPrevious);
  }

  function applyStructuralChange(next: EntryDraft[], label: string): boolean {
    if (!structuralOrderChanged(entries, next)) return false;
    setStructuralUndo({
      entries: entries.map(entry => ({ ...entry })),
      label,
      dirtyBefore: dirty,
    });
    setEntries(next);
    setDirty(true);
    setMessage(label);
    return true;
  }

  function openProcessLibrary(
    beforeGroupKey: string | null,
    parallelWithPrevious: boolean,
    trigger?: HTMLElement | null,
  ): void {
    const target = beforeGroupKey
      ? routeSequenceGroups.find(group => group.key === beforeGroupKey) || null
      : null;
    libraryReturnFocusRef.current = trigger || libraryTriggerRef.current;
    setLibraryBeforeGroupKey(target?.key || null);
    setLibraryParallelWithPrevious(Boolean(parallelWithPrevious && (target?.startIndex ?? entries.length) > 0));
    setLibraryOpen(true);
  }

  function closeProcessLibrary(): void {
    setLibraryOpen(false);
    window.requestAnimationFrame(() => (libraryReturnFocusRef.current || libraryTriggerRef.current)?.focus());
  }

  function nextGroupKey(group: ProductTimeRouteGroup<EntryDraft>): string | null {
    const groupIndex = routeSequenceGroups.findIndex(item => item.key === group.key);
    return routeSequenceGroups[groupIndex + 1]?.key || null;
  }

  function addDefinition(definition: ProcessDefinition): void {
    const newEntry: EntryDraft = {
      processDefinitionId: definition.id,
      occurrenceKey: crypto.randomUUID(),
      timeBasis: 'per_unit',
      unitSeconds: '',
      occurrences: '1',
      setupSeconds: '0',
      unitLabel: '套',
      reportQuantityBasis: 'product',
      reportUnitLabel: '个',
      parallelWithPrevious: false,
      countsForEfficiency: true,
      isCritical: false,
      remark: '',
    };
    const next = insertProductTimeRouteEntry(
      entries,
      newEntry,
      effectiveLibraryBeforeGroupKey,
      libraryParallelWithPrevious && libraryInsertionIndex > 0,
    );
    const insertedIndex = next.findIndex(entry => entry.occurrenceKey === newEntry.occurrenceKey);
    const placement = next[insertedIndex]?.parallelWithPrevious ? '并入前一工序组' : `插入为第 ${insertedIndex + 1} 道`;
    applyStructuralChange(next, `${definition.name} 已${placement}`);
  }

  function updateEntry(index: number, patch: Partial<EntryDraft>): void {
    const next = entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry);
    if (Object.prototype.hasOwnProperty.call(patch, 'parallelWithPrevious')) {
      applyStructuralChange(next, patch.parallelWithPrevious ? '已并入上一工序组' : '已改为独立顺序工序');
      return;
    }
    setStructuralUndo(null);
    setEntries(next);
    setDirty(true);
  }

  function moveEntry(index: number, direction: -1 | 1): void {
    const entry = entries[index];
    if (!entry) return;
    const next = moveProductTimeRouteGroupByDirection(entries, entry.occurrenceKey, direction);
    const definition = definitions.find(item => item.id === entry.processDefinitionId);
    applyStructuralChange(next, `${definition?.name || '工序组'}已${direction < 0 ? '上移' : '下移'}`);
  }

  function removeEntry(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    const definition = definitions.find(item => item.id === entry.processDefinitionId);
    applyStructuralChange(
      removeProductTimeRouteEntry(entries, entry.occurrenceKey),
      `${definition?.name || '工序'}已从当前草稿移除`,
    );
  }

  function openMoveDialog(group: ProductTimeRouteGroup<EntryDraft>): void {
    setMoveGroupKey(group.key);
    setMoveBeforeGroupKey(nextGroupKey(group));
  }

  function confirmMoveGroup(): void {
    if (!selectedMoveGroup) return;
    const processNames = selectedMoveGroup.entries.map(entry => definitions.find(
      definition => definition.id === entry.processDefinitionId,
    )?.name || '工序');
    const changed = applyStructuralChange(
      moveProductTimeRouteGroupBefore(entries, selectedMoveGroup.key, moveBeforeGroupKey),
      `${processNames.join(' / ')}已移动到指定位置`,
    );
    setMoveGroupKey(null);
    if (!changed) setMessage('工序位置没有变化');
  }

  function handleRouteDragEnd(event: DragEndEvent): void {
    const overKey = event.over?.id ? String(event.over.id) : '';
    const activeKey = String(event.active.id);
    if (!overKey || activeKey === overKey) return;
    applyStructuralChange(
      reorderProductTimeRouteGroup(entries, activeKey, overKey),
      '已拖动调整工序顺序',
    );
  }

  function undoStructuralChange(): void {
    if (!structuralUndo) return;
    setEntries(structuralUndo.entries.map(entry => ({ ...entry })));
    setDirty(structuralUndo.dirtyBefore);
    setMessage(`已撤销：${structuralUndo.label}`);
    setStructuralUndo(null);
  }

  async function copyProfile(): Promise<void> {
    if (!selectedItem || !selectedCopySource) {
      setError('请选择一个已发布产品作为复制来源');
      return;
    }
    setCopyConfirmOpen(false);
    setCopyingProfile(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceProfileId: selectedCopySource.profileId,
          expectedTargetRevision: activeDraft?.revision ?? null,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        profile?: ProductTimeProfileDTO;
      };
      if (!response.ok || !data.profile) throw new Error(data.error || '复制产品路线失败');
      setDirty(false);
      setMessage(`已从 ${selectedCopySource.specification} · V${selectedCopySource.version} 复制 ${data.profile.processCount} 道工序，并保存为当前产品草稿`);
      await load(selectedItem.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '复制产品路线失败');
    } finally {
      setCopyingProfile(false);
    }
  }

  function openCopyConfirmation(): void {
    if (!selectedCopySource) {
      setError('请先选择一个已发布产品作为复制来源');
      return;
    }
    requestDiscard('复制相似产品路线', '复制前需要结束当前未保存编辑，随后仍会显示覆盖范围供你最终确认。', () => {
      setCopyConfirmOpen(true);
    });
  }

  function closeCopyConfirmation(): void {
    setCopyConfirmOpen(false);
    window.requestAnimationFrame(() => copyTriggerRef.current?.focus());
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
          reportingPolicy,
          sourceType: activeDraft?.sourceType || 'manual',
          entries: entries.map(entry => ({
            processDefinitionId: entry.processDefinitionId,
            occurrenceKey: entry.occurrenceKey,
            timeBasis: entry.timeBasis,
            unitSeconds: entry.unitSeconds,
            occurrences: entry.occurrences,
            setupSeconds: entry.setupSeconds,
            unitLabel: entry.unitLabel,
            reportQuantityBasis: entry.reportQuantityBasis,
            reportUnitLabel: entry.reportUnitLabel,
            parallelWithPrevious: entry.parallelWithPrevious,
            countsForEfficiency: entry.countsForEfficiency,
            isCritical: entry.isCritical,
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

  async function syncDraftWithPublished(): Promise<void> {
    if (!selectedItem || !activeDraft || !activePublished || !staleDraft) {
      setError('当前草稿已经是最新基线，无需同步');
      return;
    }
    setDraftSyncing(true);
    setDraftSyncSummary(null);
    setError('');
    setMessage('');
    try {
      const savedDraft = dirty ? await saveDraft() : activeDraft;
      if (!savedDraft) return;
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/draft/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: savedDraft.revision }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        code?: string;
        profile?: ProductTimeProfileDTO;
        summary?: ProductTimeDraftSyncSummary;
      };
      if (!response.ok || !data.profile || !data.summary) {
        throw new Error(data.error || '草稿同步最新正式版本失败');
      }
      setDirty(false);
      setStructuralUndo(null);
      setDeploymentPreview(null);
      setDeployment(null);
      setDeploymentError('');
      setDeploymentOpen(false);
      setDraftSyncSummary({ ...data.summary, itemId: selectedItem.id });
      const conflictText = data.summary.conflicts.length
        ? `；${data.summary.conflicts.length} 项双方同时修改内容已保留草稿值，请复核`
        : '；未发现双方同时修改冲突';
      setMessage(
        `已把正式 V${data.summary.publishedVersion} 合并为 V${data.summary.toDraftVersion} 草稿：补入 ${data.summary.addedFromPublished} 道、更新 ${data.summary.updatedFromPublished} 道、移除 ${data.summary.removedFromPublished} 道${conflictText}`,
      );
      await load(selectedItem.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '草稿同步最新正式版本失败');
    } finally {
      setDraftSyncing(false);
    }
  }

  function openDraftRebuildConfirmation(): void {
    if (!selectedItem || !activeDraft || !activePublished) {
      setError('当前产品必须同时存在草稿和正式版本才能重建');
      return;
    }
    draftRebuildReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setDraftRebuildConfirmText('');
    setDraftRebuildPrompt({
      itemId: selectedItem.id,
      specification: selectedItem.specification,
      draftVersion: activeDraft.version,
      draftRevision: activeDraft.revision,
      publishedVersion: activePublished.version,
      publishedProcessCount: activePublished.processCount,
      confirmationText: `放弃草稿 V${activeDraft.version} 并重建 V${activePublished.version}`,
      hadRouteChanges: dirty,
      hadQuotationChanges: quotationDirty,
    });
  }

  function closeDraftRebuildConfirmation(): void {
    if (draftRebuilding) return;
    setDraftRebuildPrompt(null);
    setDraftRebuildConfirmText('');
    window.requestAnimationFrame(() => draftRebuildReturnFocusRef.current?.focus());
  }

  async function rebuildDraftFromPublished(): Promise<void> {
    if (!draftRebuildPrompt) return;
    if (draftRebuildConfirmText.trim() !== draftRebuildPrompt.confirmationText) {
      setError(`请完整输入“${draftRebuildPrompt.confirmationText}”后再确认`);
      draftRebuildInputRef.current?.focus();
      return;
    }
    setDraftRebuilding(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/product-time-profiles/${draftRebuildPrompt.itemId}/draft/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: draftRebuildPrompt.draftRevision,
          expectedPublishedVersion: draftRebuildPrompt.publishedVersion,
          confirmationText: draftRebuildConfirmText.trim(),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        profile?: ProductTimeProfileDTO;
        summary?: {
          discardedDraftVersion: number;
          publishedVersion: number;
          rebuiltDraftVersion: number;
          processCount: number;
        };
      };
      if (!response.ok || !data.profile || !data.summary) {
        throw new Error(data.error || '放弃草稿并重建失败');
      }
      setDirty(false);
      setQuotationDirty(false);
      setStructuralUndo(null);
      setDraftSyncSummary(null);
      setDeploymentPreview(null);
      setDeployment(null);
      setDeploymentError('');
      setDeploymentOpen(false);
      setDraftRebuildPrompt(null);
      setDraftRebuildConfirmText('');
      setMessage(`原草稿 V${data.summary.discardedDraftVersion} 已保留为放弃记录；已按正式 V${data.summary.publishedVersion} 重建 V${data.summary.rebuiltDraftVersion} 草稿，共 ${data.summary.processCount} 道工序`);
      await load(draftRebuildPrompt.itemId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '放弃草稿并重建失败');
    } finally {
      setDraftRebuilding(false);
    }
  }

  async function openPublishPreview(): Promise<void> {
    if (!selectedItem || !activeDraft) {
      setError('请先保存产品工时草稿');
      return;
    }
    if (dirty) {
      setError('当前内容尚未保存，请先保存草稿再发布');
      return;
    }
    setDeploymentOpen(true);
    setDeploymentPreviewLoading(true);
    setDeploymentPreview(null);
    setDeployment(null);
    setDeploymentError('');
    setError('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/publish/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: activeDraft.revision,
          policies: {},
        }),
      });
      const data = await response.json().catch(() => ({})) as ProductTimeDeploymentApiPayload;
      if (data.code === 'PRODUCT_TIME_DRAFT_STALE') {
        setDeploymentOpen(false);
        setError(data.error || '当前草稿已落后正式版本，请先同步最新正式版');
        await load(selectedItem.id);
        return;
      }
      const preview = deploymentPreviewFromPayload(data);
      if (!response.ok || !preview) throw new Error(data.error || '发布影响预览生成失败');
      setDeploymentPreview(preview);
      if (!preview.canPublish) setDeploymentError('存在发布冲突，请先处理下方阻断项；系统不会静默跳过任何工单');
    } catch (reason) {
      setDeploymentError(reason instanceof Error ? reason.message : '发布影响预览生成失败');
    } finally {
      setDeploymentPreviewLoading(false);
    }
  }

  function closeDeployment(): void {
    setDeploymentOpen(false);
  }

  async function publish(): Promise<void> {
    if (!selectedItem || !activeDraft || !deploymentPreview) {
      setDeploymentError('发布预览已失效，请关闭后重新预览');
      return;
    }
    if (!deploymentPreview.canPublish) {
      setDeploymentError('存在冲突，不能发布；请按预览中的阻断项处理后重新生成预览');
      return;
    }
    setPublishing(true);
    setDeploymentError('');
    setError('');
    try {
      const response = await fetch(`/api/product-time-profiles/${selectedItem.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: activeDraft.revision,
          previewToken: deploymentPreview.previewToken,
          policies: {},
        }),
      });
      const data = await response.json().catch(() => ({})) as ProductTimeDeploymentApiPayload;
      if (data.code === 'PRODUCT_TIME_DRAFT_STALE') {
        setDeploymentOpen(false);
        setError(data.error || '当前草稿已落后正式版本，请先同步最新正式版');
        await load(selectedItem.id);
        return;
      }
      const next = deploymentFromPayload(data);
      // A failed all-or-nothing deployment is still a first-class result: the
      // backend returns its ledger id so the operator can inspect every route
      // and retry. Keep that result before surfacing the HTTP error.
      if (next) setDeployment(next);
      if (!response.ok) throw new Error(data.error || next?.error || '产品工时发布启动失败');
      if (!next) throw new Error(data.error || '产品工时发布启动失败');
      if (next.status === 'active') {
        completedDeploymentRef.current = next.id;
        setMessage(`产品工序与工时 V${next.profileVersion} 已发布，并同步到二维码和全部关联工单`);
        showToast('发布完成：原二维码无需重印，扫码会读取最新工序与工时', {
          tone: 'success',
          duration: 6000,
          dedupeKey: `product-time-deployment-active:${next.id}`,
        });
        await load(next.itemId);
      } else if (next.status === 'failed') {
        setDeploymentError(next.error || '发布失败，旧正式版本继续有效；可一键重试失败项');
      }
    } catch (reason) {
      setDeploymentError(reason instanceof Error ? reason.message : '产品工时发布启动失败');
    } finally {
      setPublishing(false);
    }
  }

  async function retryDeployment(): Promise<void> {
    if (!deployment) return;
    const failedRoutes = failedProductTimeDeploymentRoutes(deployment);
    if (!failedRoutes.length) return;
    setDeploymentRetrying(true);
    setDeploymentError('');
    try {
      const response = await fetch(`/api/product-time-deployments/${encodeURIComponent(deployment.id)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrderIds: failedRoutes.map(route => route.workOrderId) }),
      });
      const data = await response.json().catch(() => ({})) as ProductTimeDeploymentApiPayload;
      const next = deploymentFromPayload(data);
      if (next) setDeployment(next);
      if (!response.ok) throw new Error(data.error || next?.error || '失败项重试启动失败');
      if (!next) throw new Error(data.error || '失败项重试启动失败');
      if (next.status === 'failed') setDeploymentError(next.error || '重试仍有失败项，请查看逐工单结果');
    } catch (reason) {
      setDeploymentError(reason instanceof Error ? reason.message : '失败项重试启动失败');
    } finally {
      setDeploymentRetrying(false);
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
  const planningReference = selectedItem?.planningReference || null;
  const parsedQuotationSeconds = Number(quotationSeconds);
  const quotationPreviewText = quotationSeconds.trim()
    ? Number.isFinite(parsedQuotationSeconds) && parsedQuotationSeconds > 0 && parsedQuotationSeconds <= 86_400
      ? `折合 ${duration(Math.round(parsedQuotationSeconds * 1000))}`
      : '请输入大于 0 且不超过 86400 的秒数'
    : '输入后会自动换算为分钟或小时';
  const saveDisabledReason = saving || draftSyncing
    ? draftSyncing ? '正在同步最新正式版' : '正在保存草稿'
    : !dirty
      ? '当前工序路线没有未保存修改'
      : !entries.length
        ? '请先添加至少一道工序'
        : invalidEntryCount
          ? `请先修正 ${invalidEntryCount} 道无效工序`
          : '';
  const publishDisabledReason = deploymentBusy
    ? '当前正在发布同步'
    : staleDraft
      ? `草稿已落后正式 V${activePublished?.version || ''}，请先同步最新正式版`
    : dirty
      ? '请先保存当前工序草稿'
      : !activeDraft
        ? '请先建立并保存一份工序草稿'
        : invalidEntryCount
          ? `请先修正 ${invalidEntryCount} 道无效工序`
          : '';
  const copyDisabledReason = copySourcesLoading
    ? '正在加载可复制路线'
    : !selectedCopySource
      ? '请先选择一个来源产品'
      : copyingProfile
        ? '正在复制路线'
        : '';
  const copySourceDiffers = Boolean(selectedItem && selectedCopySource && (
    selectedCopySource.customerName !== selectedItem.customerName
    || selectedCopySource.specification !== selectedItem.specification
  ));
  const copyTargetEffect = activeDraft
    ? '当前草稿会被所选路线完整替换。'
    : activePublished
      ? '当前正式版本会保留，系统将新建一份可调整草稿。'
      : '系统将为当前产品建立一份可调整草稿。';
  const reportingPolicyDirty = reportingPolicy !== (activeProfile?.reportingPolicy || 'free_sequence');
  const referenceDrawingCount = referenceFiles.filter(file => referenceCategory(file) === 'drawing').length;
  const referenceSopCount = referenceFiles.filter(file => referenceCategory(file) === 'sop').length;
  const deploymentDiffs = deployment?.diffs || deploymentPreview?.diffs || [];
  const deploymentDiffCounts = countProductTimeDeploymentDiffs(deploymentDiffs);
  const deploymentImpact = deployment?.impact || deploymentPreview?.impact || null;
  const deploymentRoutes = deployment?.routes || deploymentPreview?.routes || [];
  const deploymentConflicts = deployment?.conflicts || deploymentPreview?.conflicts || [];
  const deploymentProgress = deployment ? productTimeDeploymentProgress(deployment) : null;
  const failedDeploymentRoutes = deployment ? failedProductTimeDeploymentRoutes(deployment) : [];
  const deploymentStatus = deployment?.status || deploymentPreview?.status || 'preview';
  const planningPeriodText = planningSummary?.weekStartDate && planningSummary?.weekEndDate
    ? `${planningSummary.weekStartDate} 至 ${planningSummary.weekEndDate}`
    : planningScope === 'carryover' ? '早于本周且尚未完成' : '当前范围暂无计划批次';

  return (
    <main className={`product-time-page hm-product-time-workbench hm-product-time-headerless hm-workbench-root hm-workbench-navigation-overlay${canManageProductTimes ? '' : ' product-time-readonly'}`}>
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
          {returnContext && <a
            className="product-time-context-return"
            href={returnContext.returnTo}
            onClick={event => {
              if (!hasUnsavedChanges) return;
              event.preventDefault();
              requestDiscard('返回计划中心', '返回后将离开当前产品工时页面。', () => window.location.assign(returnContext.returnTo));
            }}
          ><ArrowLeft size={14} aria-hidden="true" />{returnContext.label}</a>}
          <div role="tablist" aria-label="产品工时范围">
            <button type="button" role="tab" aria-selected={planningScope === 'all'} onClick={() => changePlanningScope('all')}>产品总库</button>
            <button type="button" role="tab" aria-selected={planningScope === 'current'} onClick={() => changePlanningScope('current')}>本周计划</button>
            <button type="button" role="tab" aria-selected={planningScope === 'next'} onClick={() => changePlanningScope('next')}>下周预备</button>
            <button type="button" role="tab" aria-selected={planningScope === 'carryover'} onClick={() => changePlanningScope('carryover')}>遗留未完</button>
            <button type="button" role="tab" aria-selected={planningScope === 'history'} onClick={() => changePlanningScope('history')}>历史周</button>
          </div>
          <span>{planningScope === 'all' ? (canManageProductTimes ? '维护全部图纸产品的标准工时' : '查看全部产品的正式工序与工时') : planningPeriodText}</span>
          {planningScope === 'history' && <label><span>选择历史周</span><input type="date" value={historyWeekStart} max={periods?.current.weekStartDate} onChange={event => {
            const value = event.target.value;
            requestDiscard('切换历史周', '切换日期会重新载入该周产品。', () => setHistoryWeekStart(value));
          }} /></label>}
        </section>

        <section className="product-time-toolbar" aria-label="产品工时搜索和筛选">
          <div className="product-time-navigation-trigger" id="product-time-navigation-trigger" aria-label="平台导航入口" />
          <label><Search aria-hidden="true" /><input ref={productSearchRef} value={keyword} onChange={event => {
            const value = event.target.value;
            requestDiscard('使用新的搜索条件', '搜索结果可能切换当前产品。', () => {
              setKeyword(value);
              window.requestAnimationFrame(() => productSearchRef.current?.focus());
            });
          }} placeholder="搜索客户、规格或品名" /></label>
          <select value={customer} onChange={event => {
            const value = event.target.value;
            requestDiscard('切换客户筛选', '筛选结果可能切换当前产品。', () => setCustomer(value));
          }} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(option => <option key={option.customerName} value={option.customerName}>{option.customerName}（{option.count}）</option>)}</select>
          <select value={status} onChange={event => {
            const value = event.target.value;
            requestDiscard('切换工时状态筛选', '筛选结果可能切换当前产品。', () => setStatus(value));
          }} aria-label="筛选工时状态"><option value="all">全部状态</option><option value="missing">工时待维护</option><option value="quotation_missing">报价待维护</option><option value="draft">草稿待发布</option><option value="unpublished">尚未发布</option><option value="published">已发布</option></select>
          <div className="product-time-toolbar-actions">
            {canManageProductTimes && <input
              ref={importInputRef}
              className="product-time-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              aria-label="选择产品工时 Excel 或 CSV"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void previewImport(file);
              }}
            />}
            {canManageProductTimes && <button ref={importTriggerRef} className="hm-workbench-button" type="button" disabled={importLoading} onClick={() => requestDiscard('导入产品工时', '导入预览会重新读取产品工时数据。', () => importInputRef.current?.click())} title="导入产品工时 Excel" aria-label="导入产品工时 Excel"><Upload size={15} aria-hidden="true" /><span>{importLoading ? '解析中' : '导入'}</span></button>}
            <a className="hm-workbench-button" href="/api/product-time-profiles/export.xlsx" title="导出产品工时 Excel" aria-label="导出产品工时 Excel"><FileDown size={15} aria-hidden="true" /><span>导出</span></a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => requestDiscard('刷新产品工时', '刷新会放弃当前未保存内容并重新读取服务器数据。', () => void load(selectedItem?.id))} title="刷新产品工时" aria-label="刷新产品工时"><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /><span>刷新</span></button>
          </div>
        </section>

        <section className="product-time-workspace" aria-label="产品工序与工时工作台">
          <aside className="product-time-products" aria-label="产品列表">
            <header>
              <span><small>{isPlanningScope ? '计划范围' : '产品总库'}</small><strong>{listTotal || items.length} 款产品</strong>{listTotal > items.length && <small>已加载 {items.length} 款</small>}</span>
              <Layers3 size={19} aria-hidden="true" />
            </header>
            <div className="product-time-product-list hm-scroll-region" tabIndex={0}>
              {loadFailure && <div className="product-time-load-failure" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <span><strong>{items.length ? '未获取到最新数据，已保留当前列表' : '产品工时数据加载失败'}</strong><small>{loadFailure.message}{loadFailure.requestId ? ` · 追踪号 ${loadFailure.requestId}` : ''}</small></span>
                <button type="button" onClick={() => void load(selectedItem?.id)}>重试</button>
              </div>}
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
              {listHasMore && <button className="product-time-load-more" type="button" disabled={loadingMore} onClick={() => void load(undefined, listPage + 1)}>{loadingMore ? '正在加载…' : `加载更多（剩余 ${Math.max(0, listTotal - items.length)} 款）`}</button>}
              {!loading && !loadFailure && !items.length && <div className="product-time-empty"><Search aria-hidden="true" /><strong>没有符合条件的产品</strong><span>调整筛选，或先在图纸资料库建立产品资料。</span></div>}
            </div>
          </aside>

          <section className="product-time-route" aria-labelledby="product-time-route-title">
            {!selectedItem ? <div className="product-time-empty large"><Clock3 aria-hidden="true" /><strong>选择产品查看工序与工时</strong><span>{canManageProductTimes ? '每款产品独立保存实际参与的工序、顺序和单套合计工时。' : '当前账号为只读访问，数据与工艺人员维护的正式产品资料实时一致。'}</span></div> : <>
              <header className="product-time-route-head">
                <div className="product-time-route-identity">
                  <span>{selectedStatus}</span>
                  <h1 id="product-time-route-title" title={selectedItem.specification}>{selectedItem.specification}</h1>
                  <p title={`${selectedItem.customerName} · ${selectedItem.productName || '品名未设置'}`}>{selectedItem.customerName} · {selectedItem.productName || '品名未设置'}</p>
                </div>
                <div className="product-time-route-quick-rules" aria-label="当前产品报工与计时规则">
                  <label className={`product-time-route-rule reporting${reportingPolicyDirty ? ' dirty' : ''}`}>
                    <span>{reportingPolicyDirty ? '报工顺序 · 已修改' : '报工顺序'}</span>
                    <select disabled={!canManageProductTimes} value={reportingPolicy} onChange={event => { setReportingPolicy(event.target.value as ProcessReportingPolicy); setDirty(true); }} aria-label="现场报工顺序">
                      <option value="free_sequence">自由跨序报工</option>
                      <option value="strict_sequence">严格按流程报工</option>
                    </select>
                  </label>
                  <button className="product-time-route-rule timing" type="button" aria-expanded={ruleHintOpen} aria-controls="product-time-timing-rule-hint" onClick={() => setRuleHintOpen(value => !value)}>
                    <span>计时口径</span><strong>按件 / 按批</strong><Info size={14} aria-hidden="true" />
                  </button>
                  {ruleHintOpen && <span className="product-time-rule-hint" id="product-time-timing-rule-hint" role="status">每道工序独立选择按件或按整批；准备时间在该次工时池中只计一次。</span>}
                </div>
                <div className="product-time-route-head-actions">
                  <button ref={referenceTriggerRef} className="hm-workbench-button" type="button" title="临时查看图纸或作业指导书" aria-haspopup="dialog" aria-expanded={referenceOpen} onClick={openReferencePreview}><BookOpenText size={15} aria-hidden="true" />查看资料</button>
                  {canManageProductTimes && entries.length > 0 && <button className={`hm-workbench-button${reorderMode ? ' active' : ''}`} type="button" disabled={entries.length < 2} title={entries.length < 2 ? '至少添加 2 道工序后可调整顺序' : undefined} aria-pressed={reorderMode} onClick={() => setReorderMode(current => !current)}><ListOrdered size={15} aria-hidden="true" />{reorderMode ? '完成排序' : '调整顺序'}</button>}
                  {canManageProductTimes && entries.length > 0 && <button ref={libraryTriggerRef} className="hm-workbench-button primary" type="button" aria-expanded={libraryOpen} aria-controls="product-process-library" onClick={event => openProcessLibrary(null, false, event.currentTarget)}><Plus size={15} aria-hidden="true" />添加工序</button>}
                </div>
              </header>

              <div className="product-time-route-metrics" aria-label="当前产品工时概览">
                <span><small>工序数量</small><strong>{entries.length}</strong><em>实际参与工序</em></span>
                <span><small>工时口径</small><strong>{perBatchEntryCount ? `${perBatchEntryCount} 道按批` : '全部按件'}</strong><em>{perBatchEntryCount ? '按批工时不折算为单套' : `单套估算 ${duration(totalMilliseconds)}`}</em></span>
                <span><small>当前版本</small><strong>{activeProfile ? `V${activeProfile.version}` : '待创建'}</strong><em>{staleDraft ? `草稿落后正式 V${activePublished?.version}` : activeDraft ? '草稿待发布' : activePublished ? '正式版本' : '尚未维护'}</em></span>
                <span><small>计划关联</small><strong>{selectedItem.planning?.batchCount || 0} 批</strong><em>{selectedItem.planning ? `${selectedItem.planning.totalQuantity.toLocaleString('zh-CN')} 件` : '当前范围无批次'}</em></span>
              </div>

              {(staleDraft || draftSyncSummary?.itemId === selectedItem.id || deployment?.itemId === selectedItem.id) && <div className="product-time-route-notices">
                {staleDraft && <div className="product-time-draft-sync-banner stale" role="alert">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>
                    <strong>当前草稿 V{activeDraft?.version} 已落后正式 V{activePublished?.version}</strong>
                    <small>过期草稿不能直接下发。同步会先保存当前编辑，再补入最新正式工序和工时；双方同时修改的项目保留草稿值并提示复核。</small>
                  </span>
                  {canManageProductTimes
                    ? <div className="product-time-draft-sync-actions"><button className="hm-workbench-button primary" type="button" disabled={draftSyncing || draftRebuilding || saving || deploymentBusy} onClick={() => void syncDraftWithPublished()}><RefreshCw className={draftSyncing ? 'spin' : ''} size={15} aria-hidden="true" />{draftSyncing ? '正在合并' : '同步最新正式版'}</button><button className="hm-workbench-button danger" type="button" disabled={draftSyncing || draftRebuilding || saving || deploymentBusy} onClick={openDraftRebuildConfirmation}><RotateCcw size={15} aria-hidden="true" />放弃草稿并重建</button></div>
                    : <em>请联系工艺人员同步草稿</em>}
                </div>}

                {!staleDraft && draftSyncSummary?.itemId === selectedItem.id && <div className={`product-time-draft-sync-banner ${draftSyncSummary.conflicts.length ? 'review' : 'success'}`} role="status">
                  {draftSyncSummary.conflicts.length
                    ? <AlertTriangle size={18} aria-hidden="true" />
                    : <CheckCircle2 size={18} aria-hidden="true" />}
                  <span>
                    <strong>已同步正式 V{draftSyncSummary.publishedVersion}，当前为 V{draftSyncSummary.toDraftVersion} 草稿</strong>
                    <small>补入 {draftSyncSummary.addedFromPublished} 道 · 更新 {draftSyncSummary.updatedFromPublished} 道 · 移除 {draftSyncSummary.removedFromPublished} 道 · 保留 {draftSyncSummary.preservedDraftChanges} 项草稿修改{draftSyncSummary.conflicts.length ? ` · ${draftSyncSummary.conflicts.length} 项冲突请复核` : ' · 无双方修改冲突'}</small>
                  </span>
                </div>}

                {deployment?.itemId === selectedItem.id && <div className={`product-time-deployment-banner ${deployment.status}`}>
                  {deployment.status === 'pending' || deployment.status === 'applying'
                    ? <LoaderCircle className="spin" size={17} aria-hidden="true" />
                    : deployment.status === 'active'
                      ? <CheckCircle2 size={17} aria-hidden="true" />
                      : <AlertTriangle size={17} aria-hidden="true" />}
                  <span>
                    <strong>V{deployment.profileVersion} · {productTimeDeploymentStatusText(deployment.status)}</strong>
                    <small>{deployment.status === 'active'
                      ? `${deployment.routes.length} 张关联工单已核对，原二维码继续有效`
                      : deployment.status === 'failed'
                        ? `${failedDeploymentRoutes.length} 张工单失败或冲突，旧正式版本继续有效`
                        : `正在同步 ${deployment.routes.length} 张关联工单、二维码及历史工时`}</small>
                  </span>
                  <button type="button" onClick={() => setDeploymentOpen(true)}>查看发布结果</button>
                </div>}
              </div>}

              <div className={`product-time-route-editor${reorderMode ? ' reorder' : ''}`}>
                {reorderMode && <div className="product-time-reorder-toolbar">
                  <span><strong>快速调整顺序</strong><small>拖动或点“移至”一次到位；并行工序会作为整组移动。</small></span>
                  <button type="button" disabled={!structuralUndo} onClick={undoStructuralChange}><RotateCcw size={14} aria-hidden="true" />撤销上一步</button>
                </div>}
                <div className={`product-time-entry-list hm-scroll-region${reorderMode ? ' product-time-reorder-list' : ''}`} tabIndex={0} aria-label={`当前产品工序路线，共 ${entries.length} 道工序`}>
                  {reorderMode ? <DndContext sensors={routeSensors} collisionDetection={closestCenter} onDragEnd={handleRouteDragEnd}>
                    <SortableContext items={routeSequenceGroups.map(group => group.key)} strategy={verticalListSortingStrategy}>
                      {routeSequenceGroups.map((group, groupIndex) => <SortableProductTimeGroup
                        key={group.key}
                        group={group}
                        groupIndex={groupIndex}
                        groupCount={routeSequenceGroups.length}
                        definitions={definitions}
                        onInsertBefore={(target, trigger) => openProcessLibrary(target.key, false, trigger)}
                        onInsertAfter={(target, trigger) => openProcessLibrary(nextGroupKey(target), false, trigger)}
                        onMove={openMoveDialog}
                        onMoveByDirection={(target, direction) => {
                          const next = moveProductTimeRouteGroupByDirection(entries, target.key, direction);
                          applyStructuralChange(next, `工序组已${direction < 0 ? '上移' : '下移'}`);
                        }}
                      />)}
                    </SortableContext>
                  </DndContext> : entries.map((entry, index) => {
                    const definition = definitions.find(item => item.id === entry.processDefinitionId);
                    const validation = entryValidation(entry);
                    const invalid = validation.messages.length > 0;
                    const draftSyncConflict = draftSyncConflictByKey.get(entry.occurrenceKey) || null;
                    const validationId = `product-time-entry-validation-${entry.occurrenceKey}`;
                    const formula = entryFormula(entry);
                    const groupKey = groupKeyForProductTimeEntry(entries, entry.occurrenceKey);
                    const groupIndex = routeSequenceGroups.findIndex(group => group.key === groupKey);
                    const group = routeSequenceGroups[groupIndex];
                    return <article className={[invalid ? 'invalid' : '', draftSyncConflict ? 'draft-sync-conflict' : ''].filter(Boolean).join(' ')} key={entry.occurrenceKey}>
                      <div className="product-time-process-name">
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <span><strong>{definition?.name || '工序已停用'}</strong><small>{definition ? stageText[definition.stageGroup] : '历史工序'}</small></span>
                      </div>
                      <div className="product-time-standard-editor">
                        <label><span>工时口径</span><select disabled={!canManageProductTimes} value={entry.timeBasis} onChange={event => {
                          const timeBasis = event.target.value as ProcessTimeBasis;
                          updateEntry(index, { timeBasis });
                        }}><option value="per_unit">按件 / 按套</option><option value="per_batch">按整批</option></select></label>
                        <label><span>{entry.timeBasis === 'per_batch' ? '整批标准时间（秒）' : '单次标准时间（秒）'}</span><input disabled={!canManageProductTimes} inputMode="decimal" aria-invalid={validation.unitSeconds} aria-describedby={invalid ? validationId : undefined} value={entry.unitSeconds} onChange={event => updateEntry(index, { unitSeconds: event.target.value })} placeholder="输入正数" /></label>
                        <label><span>{entry.timeBasis === 'per_batch' ? '整批计次' : '每套工序次数'}</span><input inputMode="numeric" disabled={!canManageProductTimes || entry.timeBasis === 'per_batch'} aria-invalid={validation.occurrences} aria-describedby={invalid ? validationId : undefined} value={entry.timeBasis === 'per_batch' ? '1' : entry.occurrences} onChange={event => updateEntry(index, { occurrences: event.target.value })} /></label>
                        <label><span>准备时间（秒）</span><input disabled={!canManageProductTimes} inputMode="decimal" aria-invalid={validation.setupSeconds} aria-describedby={invalid ? validationId : undefined} value={entry.setupSeconds} onChange={event => updateEntry(index, { setupSeconds: event.target.value })} /></label>
                        <label><span>产品数量单位</span><input disabled={!canManageProductTimes} maxLength={20} value={entry.unitLabel} onChange={event => updateEntry(index, { unitLabel: event.target.value })} placeholder="套" /></label>
                        <label><span>现场报工口径</span><select disabled={!canManageProductTimes} value={entry.reportQuantityBasis} onChange={event => updateEntry(index, { reportQuantityBasis: event.target.value as ProcessReportQuantityBasis })}><option value="product">按产品数量报工</option><option value="action" disabled={entry.timeBasis !== 'per_unit' || Number(entry.occurrences) <= 1}>按实际动作数量报工</option></select></label>
                        {entry.reportQuantityBasis === 'action' && <label><span>动作数量单位</span><input disabled={!canManageProductTimes} maxLength={20} aria-invalid={validation.reportUnitLabel} aria-describedby={invalid ? validationId : undefined} value={entry.reportUnitLabel} onChange={event => updateEntry(index, { reportUnitLabel: event.target.value })} placeholder="个" /></label>}
                        {formula && <small className="product-time-entry-formula">{formula}</small>}
                        {invalid && <small id={validationId} className="product-time-entry-validation" role="alert">{validation.messages.join('；')}。</small>}
                        {draftSyncConflict && <small className="product-time-entry-sync-conflict" role="status">{draftSyncConflictMessage(draftSyncConflict.kind)}</small>}
                      </div>
                      <div className="product-time-process-options">
                        <label><input type="checkbox" disabled={!canManageProductTimes || index === 0} checked={entry.parallelWithPrevious} onChange={event => updateEntry(index, { parallelWithPrevious: event.target.checked })} /><span>{index === 0 ? '首道工序' : '与上一道并行'}</span></label>
                        <label><input type="checkbox" disabled={!canManageProductTimes} checked={entry.countsForEfficiency} onChange={event => updateEntry(index, { countsForEfficiency: event.target.checked })} /><span>计入员工达成率</span></label>
                        <label><input type="checkbox" disabled={!canManageProductTimes} checked={entry.isCritical} onChange={event => updateEntry(index, { isCritical: event.target.checked })} /><span>安全/质量关键工序</span></label>
                      </div>
                      <input disabled={!canManageProductTimes} className="product-time-row-remark" value={entry.remark} onChange={event => updateEntry(index, { remark: event.target.value })} placeholder="工序说明，可选" />
                      {canManageProductTimes && <div className="product-time-row-actions">
                        <button type="button" title="整组上移" aria-label={`上移${definition?.name || '工序'}所在工序组`} disabled={groupIndex <= 0} onClick={() => moveEntry(index, -1)}><ArrowUp size={15} /></button>
                        <button type="button" title="整组下移" aria-label={`下移${definition?.name || '工序'}所在工序组`} disabled={groupIndex < 0 || groupIndex === routeSequenceGroups.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown size={15} /></button>
                        <button className="text-action" type="button" disabled={!group} onClick={event => group && openProcessLibrary(group.key, false, event.currentTarget)}>前加</button>
                        <button className="text-action" type="button" disabled={!group} onClick={event => group && openProcessLibrary(nextGroupKey(group), false, event.currentTarget)}>后加</button>
                        <button className="text-action" type="button" disabled={!group} onClick={() => group && openMoveDialog(group)}>移至</button>
                        <button className="danger" type="button" title="移除" aria-label={`移除${definition?.name || '工序'}`} onClick={() => removeEntry(index)}><Trash2 size={15} /></button>
                      </div>}
                    </article>;
                  })}
                  {!entries.length && <div className="product-time-empty large"><Library aria-hidden="true" /><strong>这款产品还没有工序路线</strong><span>{canManageProductTimes ? '从共享工序库添加实际参与的工序，或复制相似产品的已发布路线作为草稿。' : '工艺人员尚未维护该产品的正式工序路线。'}</span>{canManageProductTimes && <div className="product-time-empty-actions"><button className="hm-workbench-button primary" type="button" onClick={event => openProcessLibrary(null, false, event.currentTarget)}>从工序库添加</button><button className="hm-workbench-button" type="button" onClick={() => { copySearchRef.current?.scrollIntoView({ block: 'center' }); copySearchRef.current?.focus(); }}>复制相似路线</button></div>}</div>}
                </div>
              </div>

              <label className="product-time-remark"><span>版本说明</span><textarea disabled={!canManageProductTimes} value={remark} onChange={event => { setRemark(event.target.value); setDirty(true); }} placeholder="记录测定依据、特殊设备或本次调整原因" /></label>

              <footer className="product-time-route-actions">
                <span className="product-time-route-status">
                  {hasUnsavedChanges && <b><AlertTriangle size={13} aria-hidden="true" />未保存</b>}
                  <em>{invalidEntryCount
                    ? `${invalidEntryCount} 道工序工时无效`
                    : staleDraft
                      ? `草稿已落后正式 V${activePublished?.version}，请先使用“同步最新正式版”；系统已禁止直接下发。`
                      : activeDraft
                        ? '保存草稿不会影响生产；正式发布前会预览全部工单、二维码和历史达成率影响。'
                      : activePublished
                        ? '当前为正式版本；后续修改会先形成草稿，不会静默改变二维码报工。'
                        : '保存草稿后检查无误，再发布并同步到二维码和全部关联工单。'}</em>
                </span>
                {canManageProductTimes ? <div>
                  <button className="hm-workbench-button" type="button" disabled={!hasUnsavedChanges || saving} title={!hasUnsavedChanges ? '当前没有未保存修改' : '恢复当前产品已保存的工序与报价内容'} onClick={resetChanges}><RotateCcw size={15} aria-hidden="true" />放弃修改</button>
                  {activeDraft && activePublished && <button className="hm-workbench-button danger" type="button" disabled={draftSyncing || draftRebuilding || saving || deploymentBusy} title="保留原草稿审计记录，并按当前正式版本完整重建新草稿" onClick={openDraftRebuildConfirmation}><RotateCcw size={15} aria-hidden="true" />放弃草稿并重建</button>}
                  <button className="hm-workbench-button" type="button" disabled={Boolean(saveDisabledReason)} title={saveDisabledReason || undefined} onClick={() => void saveDraft()}><Save size={15} aria-hidden="true" />{saving ? '保存中' : '保存草稿'}</button>
                  <button className="hm-workbench-button primary product-time-publish-button" type="button" disabled={Boolean(publishDisabledReason)} title={publishDisabledReason || '先查看差异和影响范围，再确认正式发布'} onClick={() => void openPublishPreview()}><QrCode size={15} aria-hidden="true" />{deploymentBusy ? '正在发布同步' : '预览发布影响'}</button>
                </div> : <strong>只读资料 · 如需调整请联系工艺人员</strong>}
              </footer>
            </>}
          </section>

          <aside className="product-time-context" aria-label="当前产品报价与快速起草">
            <section className="product-time-quotation-editor" aria-labelledby="product-time-quotation-title">
              <header><span><small>商业基准</small><strong id="product-time-quotation-title">单套报价工时</strong></span><b className={quotationDirty ? 'dirty' : undefined}>{quotationDirty ? '未保存' : activeQuotation ? `V${activeQuotation.version}` : '待维护'}</b></header>
              {planningReference ? <div className="product-time-planning-candidate">
                <span><small>最近计划候选</small><strong>{duration(planningReference.unitMilliseconds)}</strong><em>{planningReference.weekStartDate && planningReference.weekEndDate ? `${planningReference.weekStartDate} 至 ${planningReference.weekEndDate}` : '计划订单'} · {planningReference.quantity.toLocaleString('zh-CN')} 件</em></span>
                {canManageProductTimes && <button type="button" onClick={adoptPlanningQuotation}>填入 {duration(planningReference.unitMilliseconds)}</button>}
              </div> : <div className="product-time-planning-candidate empty"><span><small>最近计划候选</small><strong>暂无计划单套工时</strong><em>计划订单维护后可在这里人工采用</em></span></div>}
              <label><span>秒 / 套</span><input disabled={!canManageProductTimes} inputMode="decimal" aria-describedby="product-time-quotation-conversion" value={quotationSeconds} onChange={event => { setQuotationSeconds(event.target.value); setQuotationSourceType('manual'); setQuotationSourceRefId(null); setQuotationDirty(true); }} placeholder="输入报价工时" /><small id="product-time-quotation-conversion" className={quotationSeconds.trim() && (!Number.isFinite(parsedQuotationSeconds) || parsedQuotationSeconds <= 0 || parsedQuotationSeconds > 86_400) ? 'error' : undefined}>{quotationPreviewText}</small></label>
              <label><span>报价说明</span><input disabled={!canManageProductTimes} value={quotationRemark} onChange={event => { setQuotationRemark(event.target.value); setQuotationDirty(true); }} placeholder="版本或测算依据，可选" /></label>
              <div className="product-time-quotation-compare"><span>生产标准<strong>{perBatchEntryCount ? '含按批口径' : duration(totalMilliseconds)}</strong></span><span>计划候选<strong>{planningReference ? duration(planningReference.unitMilliseconds) : '暂无'}</strong></span><span>当前报价<strong>{activeQuotation ? duration(activeQuotation.unitMilliseconds) : '未录入'}</strong></span></div>
              <small className="product-time-quotation-source">当前编辑来源：{quotationSourceText(quotationSourceType)}。采用计划工时后仍需保存，保存会创建新的报价版本。</small>
              {canManageProductTimes && <button className="hm-workbench-button" type="button" disabled={quotationSaving || !quotationDirty} onClick={() => void saveQuotation()}><Save size={15} aria-hidden="true" />{quotationSaving ? '保存中' : '保存报价工时'}</button>}
            </section>

            {canManageProductTimes && <section className="product-time-copy-panel">
              <header><small>快速起草</small><strong>复制相似产品路线</strong></header>
              <label className="product-time-copy-search"><Search size={14} aria-hidden="true" /><input ref={copySearchRef} value={copySourceKeyword} onChange={event => setCopySourceKeyword(event.target.value)} placeholder="搜索客户、规格或品名" aria-label="搜索已发布产品路线" /></label>
              <div className="product-time-copy-sources hm-scroll-region" role="listbox" aria-label="已发布产品路线">
                {copySources.map(source => <button
                  key={source.profileId}
                  className={source.profileId === copySourceId ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={source.profileId === copySourceId}
                  onClick={() => setCopySourceId(source.profileId)}
                >
                  <span><strong>{source.specification}</strong><small>{source.customerName} · {source.productName || '品名未设置'}</small></span>
                  <em>V{source.version} · {source.processCount} 道</em>
                </button>)}
                {copySourcesLoading && <p>正在检索已发布路线…</p>}
                {!copySourcesLoading && copySourceError && <p className="error">{copySourceError}</p>}
                {!copySourcesLoading && !copySourceError && !copySources.length && <p>{copySourceKeyword.trim() ? '没有匹配的已发布路线' : '暂无可复制的已发布路线'}</p>}
              </div>
              <button ref={copyTriggerRef} className="hm-workbench-button" type="button" disabled={Boolean(copyDisabledReason)} title={copyDisabledReason || '先预览来源和覆盖范围'} onClick={openCopyConfirmation}><Copy size={15} aria-hidden="true" />{copyingProfile ? '复制中' : '预览并复制'}</button>
              <small>{copyDisabledReason || '复制会记录精确来源版本，不会修改来源产品。'}</small>
            </section>}
          </aside>
        </section>

        {canManageProductTimes && libraryOpen && <button className="product-time-library-scrim" type="button" aria-label="关闭工序库" onClick={closeProcessLibrary} />}
        {canManageProductTimes && libraryOpen && <aside id="product-process-library" className="product-time-library open" aria-label="共享工序库">
            <header><span><strong>共享工序库</strong><small>先选插入位置，再选择或新建工序</small></span><button ref={libraryCloseRef} type="button" title="关闭工序库" aria-label="关闭工序库" onClick={closeProcessLibrary}><X size={17} /></button></header>
            <section className="product-time-library-target" aria-label="新增工序插入位置">
              <label><span>插入位置</span><select value={effectiveLibraryBeforeGroupKey || '__end__'} onChange={event => {
                const value = event.target.value;
                const nextKey = value === '__end__' ? null : value;
                const target = nextKey ? routeSequenceGroups.find(group => group.key === nextKey) || null : null;
                setLibraryBeforeGroupKey(nextKey);
                if ((target?.startIndex ?? entries.length) === 0) setLibraryParallelWithPrevious(false);
              }}>
                {routeSequenceGroups.map(group => {
                  const names = group.entries.map(entry => definitions.find(definition => definition.id === entry.processDefinitionId)?.name || '历史工序').join(' / ');
                  return <option key={group.key} value={group.key}>第 {group.startIndex + 1} 道前 · {names}</option>;
                })}
                <option value="__end__">路线末尾 · 新第 {entries.length + 1} 道</option>
              </select></label>
              <label className="product-time-library-parallel"><input type="checkbox" disabled={libraryInsertionIndex === 0} checked={libraryParallelWithPrevious && libraryInsertionIndex > 0} onChange={event => setLibraryParallelWithPrevious(event.target.checked)} /><span>与前一工序组并行</span></label>
              <small>将插入为第 {libraryInsertionIndex + 1} 道{libraryParallelWithPrevious && libraryInsertionIndex > 0 ? '，并入前一并行组' : '，后续序号自动顺延'}。</small>
            </section>
            <label className="product-time-library-search"><Search size={15} aria-hidden="true" /><input value={libraryKeyword} onChange={event => setLibraryKeyword(event.target.value)} placeholder="搜索工序" /></label>
            <div className="product-time-stage-tabs">{(['all', 'frontend', 'backend', 'finish'] as const).map(value => <button key={value} className={libraryStage === value ? 'active' : ''} type="button" onClick={() => setLibraryStage(value)}>{value === 'all' ? '全部' : stageText[value]}</button>)}</div>
            <div className="product-time-definition-list hm-scroll-region" tabIndex={0}>{filteredDefinitions.map(definition => <button key={definition.id} type="button" onClick={() => addDefinition(definition)}><span><strong>{definition.name}</strong><small>{stageText[definition.stageGroup]}</small></span><Plus size={15} aria-hidden="true" /></button>)}{!filteredDefinitions.length && <p>没有可添加的工序</p>}</div>
            <section className="product-time-new-process"><strong>新增共享工序</strong><small>创建后会进入共享工序库，其他产品也可复用。</small><input value={newProcessName} onChange={event => setNewProcessName(event.target.value)} placeholder="工序名称" maxLength={60} /><select value={newProcessStage} onChange={event => setNewProcessStage(event.target.value as ProcessStageGroup)}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select><button className="hm-workbench-button" type="button" disabled={creatingProcess} onClick={createProcess}><Plus size={15} />{creatingProcess ? '创建中' : '创建并加入'}</button></section>
        </aside>}
      </div>

      {discardPrompt && <div className="product-time-confirm-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeDiscardPrompt();
      }}>
        <section
          className="product-time-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-time-discard-title"
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
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
          <header><span><small>未保存修改</small><strong id="product-time-discard-title">确认{discardPrompt.actionLabel}？</strong></span><button ref={discardCloseRef} type="button" title="关闭" aria-label="关闭未保存修改提示" onClick={closeDiscardPrompt}><X size={17} /></button></header>
          <div className="product-time-confirm-body">
            <p>{discardPrompt.detail}</p>
            <div className="product-time-unsaved-summary" aria-label="将放弃的修改">
              {dirty && <span><ListOrdered size={16} aria-hidden="true" /><strong>工序路线修改</strong><small>顺序、工时口径或版本说明尚未保存</small></span>}
              {quotationDirty && <span><Clock3 size={16} aria-hidden="true" /><strong>报价工时修改</strong><small>秒数或报价说明尚未保存</small></span>}
            </div>
            <p className="warning"><AlertTriangle size={16} aria-hidden="true" />放弃后无法从当前页面恢复这些修改。</p>
          </div>
          <footer><button className="hm-workbench-button" type="button" onClick={closeDiscardPrompt}>继续编辑</button><button className="hm-workbench-button danger" type="button" onClick={confirmDiscardAndContinue}>放弃修改并继续</button></footer>
        </section>
      </div>}

      {draftRebuildPrompt && <div className="product-time-confirm-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeDraftRebuildConfirmation();
      }}>
        <section
          className="product-time-confirm-dialog product-time-rebuild-confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="product-time-rebuild-confirm-title"
          aria-describedby="product-time-rebuild-confirm-description"
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
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
          <header><span><small>不可撤销的草稿替换</small><strong id="product-time-rebuild-confirm-title">放弃草稿并按正式版重建？</strong></span><button type="button" disabled={draftRebuilding} title="关闭" aria-label="关闭放弃草稿并重建确认" onClick={closeDraftRebuildConfirmation}><X size={17} /></button></header>
          <div className="product-time-confirm-body">
            <div className="product-time-rebuild-version-map" aria-label="重建版本范围">
              <span><small>将放弃</small><strong>草稿 V{draftRebuildPrompt.draftVersion}</strong><em>{draftRebuildPrompt.specification}</em></span>
              <ChevronRight size={19} aria-hidden="true" />
              <span><small>重建基线</small><strong>正式 V{draftRebuildPrompt.publishedVersion}</strong><em>{draftRebuildPrompt.publishedProcessCount} 道工序</em></span>
            </div>
            <p id="product-time-rebuild-confirm-description">系统会保留原草稿及其工序明细作为审计记录，再创建一个更高版本的新草稿；当前正式版本和生产工单不会在这一步被修改。</p>
            {(draftRebuildPrompt.hadRouteChanges || draftRebuildPrompt.hadQuotationChanges) && <p className="warning"><AlertTriangle size={16} aria-hidden="true" />当前页面还有未保存的{draftRebuildPrompt.hadRouteChanges && draftRebuildPrompt.hadQuotationChanges ? '工序路线和报价工时修改' : draftRebuildPrompt.hadRouteChanges ? '工序路线修改' : '报价工时修改'}，确认重建后也会一并放弃。若需保留，请先取消并保存。</p>}
            <label className="product-time-rebuild-confirmation"><span>请输入以下完整文字以二次确认</span><code>{draftRebuildPrompt.confirmationText}</code><input ref={draftRebuildInputRef} value={draftRebuildConfirmText} disabled={draftRebuilding} autoComplete="off" spellCheck={false} onChange={event => setDraftRebuildConfirmText(event.target.value)} placeholder={draftRebuildPrompt.confirmationText} aria-label="放弃草稿并重建确认文字" /></label>
            <p className="muted">“同步最新正式版”会保留并合并人工修改；只有此重建操作会放弃草稿内容，且必须经过本次显式确认。</p>
          </div>
          <footer><button className="hm-workbench-button" type="button" disabled={draftRebuilding} onClick={closeDraftRebuildConfirmation}>取消，保留草稿</button><button className="hm-workbench-button danger" type="button" disabled={draftRebuilding || draftRebuildConfirmText.trim() !== draftRebuildPrompt.confirmationText} onClick={() => void rebuildDraftFromPublished()}><RotateCcw className={draftRebuilding ? 'spin' : ''} size={15} aria-hidden="true" />{draftRebuilding ? '正在重建' : '确认放弃并重建'}</button></footer>
        </section>
      </div>}

      {copyConfirmOpen && selectedCopySource && selectedItem && <div className="product-time-confirm-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeCopyConfirmation();
      }}>
        <section
          className="product-time-confirm-dialog product-time-copy-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-time-copy-confirm-title"
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
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
          <header><span><small>复制前预览</small><strong id="product-time-copy-confirm-title">确认复制这套产品路线？</strong></span><button ref={copyConfirmCloseRef} type="button" title="关闭" aria-label="关闭复制路线预览" onClick={closeCopyConfirmation}><X size={17} /></button></header>
          <div className="product-time-confirm-body">
            <div className="product-time-copy-compare" aria-label="复制来源和目标">
              <span><small>来源 · 已发布 V{selectedCopySource.version}</small><strong>{selectedCopySource.specification}</strong><em>{selectedCopySource.customerName} · {selectedCopySource.processCount} 道工序</em></span>
              <ChevronRight size={19} aria-hidden="true" />
              <span><small>目标 · 当前产品</small><strong>{selectedItem.specification}</strong><em>{selectedItem.customerName}</em></span>
            </div>
            <p>{copyTargetEffect}</p>
            {copySourceDiffers && <p className="warning"><AlertTriangle size={16} aria-hidden="true" />来源与目标的客户或规格不同，请确认工艺确实可以复用。</p>}
            <p className="muted">复制会记录精确来源版本，不会修改来源产品，也不会直接发布到现场。</p>
          </div>
          <footer><button className="hm-workbench-button" type="button" disabled={copyingProfile} onClick={closeCopyConfirmation}>取消</button><button className="hm-workbench-button primary" type="button" disabled={copyingProfile} onClick={() => void copyProfile()}><Copy size={15} aria-hidden="true" />{copyingProfile ? '复制中' : activeDraft ? '覆盖当前草稿' : '复制为新草稿'}</button></footer>
        </section>
      </div>}

      {selectedMoveGroup && <div className="product-time-position-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) setMoveGroupKey(null);
      }}>
        <section className="product-time-position-dialog" role="dialog" aria-modal="true" aria-labelledby="product-time-position-title">
          <header><span><small>一次移动到位</small><strong id="product-time-position-title">移动工序位置</strong></span><button type="button" title="关闭" aria-label="关闭移动工序窗口" onClick={() => setMoveGroupKey(null)}><X size={17} /></button></header>
          <div>
            <span className="product-time-position-current"><b>{selectedMoveGroup.startIndex + 1}{selectedMoveGroup.endIndex > selectedMoveGroup.startIndex ? `–${selectedMoveGroup.endIndex + 1}` : ''}</b><strong>{selectedMoveGroup.entries.map(entry => definitions.find(definition => definition.id === entry.processDefinitionId)?.name || '历史工序').join(' / ')}</strong><small>{selectedMoveGroup.entries.length > 1 ? '并行工序会整组移动' : '当前为独立顺序工序'}</small></span>
            <label><span>移动到</span><select value={moveBeforeGroupKey || '__end__'} onChange={event => setMoveBeforeGroupKey(event.target.value === '__end__' ? null : event.target.value)}>
              {routeSequenceGroups.filter(group => group.key !== selectedMoveGroup.key).map(group => {
                const names = group.entries.map(entry => definitions.find(definition => definition.id === entry.processDefinitionId)?.name || '历史工序').join(' / ');
                return <option key={group.key} value={group.key}>在第 {group.startIndex + 1} 道「{names}」之前</option>;
              })}
              <option value="__end__">路线末尾</option>
            </select></label>
            <p>保存草稿前只调整编辑顺序；正式发布时仍会先预览全部二维码和关联工单影响。</p>
          </div>
          <footer><button className="hm-workbench-button" type="button" onClick={() => setMoveGroupKey(null)}>取消</button><button className="hm-workbench-button primary" type="button" onClick={confirmMoveGroup}><MoveVertical size={15} aria-hidden="true" />确认移动</button></footer>
        </section>
      </div>}

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

      {deploymentOpen && <div className="product-time-deployment-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target) closeDeployment();
      }}>
        <section className="product-time-deployment-dialog" role="dialog" aria-modal="true" aria-labelledby="product-time-deployment-title" aria-describedby="product-time-deployment-description">
          <header>
            <div>
              <QrCode aria-hidden="true" />
              <span>
                <strong id="product-time-deployment-title">发布并同步二维码/全部工单</strong>
                <small>{selectedItem?.specification || '当前产品'} · {deployment ? `V${deployment.profileVersion}` : deploymentPreview ? `V${deploymentPreview.toVersion}` : '正在计算影响'}</small>
              </span>
            </div>
            <b className={deploymentStatus}>{productTimeDeploymentStatusText(deploymentStatus)}</b>
            <button ref={deploymentCloseRef} type="button" title="关闭发布详情" aria-label="关闭发布详情" onClick={closeDeployment}><X size={18} /></button>
          </header>

          <div id="product-time-deployment-description" className="product-time-deployment-scope">
            <Route size={17} aria-hidden="true" />
            <span><strong>未开工执行完整新路线，在制新增工序按整单全套补报，已完成冻结历史</strong><small>在制且尚未闭环的工单，每一道新增工序都按该工单有效目标数量建立独立报工义务；不伪造入站数量、不重复转序或增加成品。</small></span>
          </div>

          {deploymentError && <div className="product-time-deployment-error" role="alert"><AlertTriangle size={17} aria-hidden="true" /><span>{deploymentError}</span></div>}

          {deploymentPreviewLoading && <div className="product-time-deployment-loading"><LoaderCircle className="spin" size={26} aria-hidden="true" /><strong>正在核对全部关联工单</strong><span>计算每道新增工序的整单目标、实际待报量、完成状态和并发冲突…</span></div>}

          {!deploymentPreviewLoading && (deploymentPreview || deployment) && <div className="product-time-deployment-body hm-scroll-region" tabIndex={0}>
            <section className="product-time-deployment-section" aria-labelledby="product-time-deployment-change-title">
              <header><span><small>01</small><strong id="product-time-deployment-change-title">本次版本差异</strong></span><em>严格按工序实例标识匹配，不按名称或位置猜测</em></header>
              <div className="product-time-deployment-change-summary">
                <span className="insert"><small>新增 / NEW</small><strong>{deploymentDiffCounts.insert}</strong></span>
                <span><small>顺序调整</small><strong>{deploymentDiffCounts.move}</strong></span>
                <span><small>工时变更</small><strong>{deploymentDiffCounts.updateTime}</strong></span>
                <span className="delete"><small>删除 / 退役</small><strong>{deploymentDiffCounts.delete}</strong></span>
              </div>
              <div className="product-time-deployment-diffs">
                {deploymentDiffs.map(diff => <article key={`${diff.kind}-${diff.occurrenceKey}`} className={`${diff.kind}${diff.isCritical ? ' critical' : ''}`}>
                  <b>{diff.kind === 'insert' ? 'NEW' : diff.kind === 'move' ? '调序' : diff.kind === 'update_time' ? '工时' : '退役'}</b>
                  <span><strong>{diff.processName}{diff.isCritical ? ' · 关键工序' : ''}</strong><small title={diff.occurrenceKey}>工序实例 {diff.occurrenceKey.slice(0, 12)}</small></span>
                  <em>{diff.kind === 'update_time'
                    ? `${diff.oldUnitMilliseconds == null ? '—' : duration(diff.oldUnitMilliseconds)} → ${diff.newUnitMilliseconds == null ? '—' : duration(diff.newUnitMilliseconds)}`
                    : diff.kind === 'move'
                      ? `第 ${diff.oldSequence ?? '—'} 道 → 第 ${diff.newSequence ?? '—'} 道`
                      : diff.kind === 'insert'
                        ? `插入第 ${diff.newSequence ?? '—'} 道 · 未完成工单整单全套补报`
                        : `原第 ${diff.oldSequence ?? '—'} 道；已报工历史不物理删除`}</em>
                  {diff.kind === 'insert' && <div className="product-time-insert-policy" role="status" aria-label={`${diff.processName} 生效策略`}>
                    <span>在制工单生效策略</span>
                    <strong>整单全套补报</strong>
                    <small>未开工进入正常路线；在制生成独立补报义务；已完成保持冻结</small>
                  </div>}
                </article>)}
                {!deploymentDiffs.length && <p>草稿与当前正式版本没有工序或工时差异。</p>}
              </div>
            </section>

            {deploymentImpact && <section className="product-time-deployment-section" aria-labelledby="product-time-deployment-impact-title">
              <header><span><small>02</small><strong id="product-time-deployment-impact-title">影响范围</strong></span><em>发布前完整展示，不静默跳过</em></header>
              <div className="product-time-deployment-impact-grid">
                <span><small>关联工单</small><strong>{deploymentImpact.workOrders.total}</strong><em>未报工 {deploymentImpact.workOrders.unstarted} · 在制 {deploymentImpact.workOrders.inProgress} · 已完成 {deploymentImpact.workOrders.completed}</em></span>
                <span><small>原二维码</small><strong>{deploymentImpact.qrTickets}</strong><em>无需重印，扫码读取最新路线</em></span>
                <span><small>受影响扫码报工</small><strong>{deploymentImpact.historicalReports}</strong><em>调序、删除或工时变化均同步有效口径，原始扫码事实保留</em></span>
                <span><small>影响员工</small><strong>{deploymentImpact.affectedEmployees}</strong><em>{deploymentImpact.attainmentRecords} 条个人效率记录重算</em></span>
                <span><small>系统历史承接</small><strong>{deploymentImpact.systemCoveredQty ?? 0}</strong><em>未完成工单新增工序固定为 0，不替员工完成</em></span>
                <span><small>新增工序实际待报</small><strong>{deploymentImpact.actualRequiredQty ?? 0}</strong><em>按每张未完成工单、每道新增工序的全套目标累计</em></span>
                <span><small>保持已完成</small><strong>{deploymentImpact.keptCompleted ?? 0}</strong><em>已完成历史工单不由产品版本发布自动重开</em></span>
                <span><small>历史承接生成报工</small><strong>{deploymentImpact.generatedLaborRecords ?? 0}</strong><em>固定为 0，不归属管理员或员工</em></span>
                <span><small>承接审计记录</small><strong>{deploymentImpact.supplementObligations}</strong><em>系统承接、混合执行、仅未来或召回均留痕</em></span>
                <span className={deploymentImpact.conflicts ? 'conflict' : 'safe'}><small>发布冲突</small><strong>{deploymentImpact.conflicts}</strong><em>{deploymentImpact.conflicts ? '必须处理后才能正式生效' : '当前未发现阻断项'}</em></span>
              </div>
              {deploymentConflicts.length > 0 && <div className="product-time-deployment-conflicts">
                {deploymentConflicts.map((conflict, index) => <article key={`${conflict.code}-${conflict.workOrderId || index}`}><AlertTriangle size={15} aria-hidden="true" /><span><strong>{conflict.workOrderCode || conflict.code}</strong><small>{conflict.message}</small></span></article>)}
              </div>}
            </section>}

            <section className="product-time-deployment-section route-results" aria-labelledby="product-time-deployment-routes-title">
              <header><span><small>03</small><strong id="product-time-deployment-routes-title">逐工单同步结果</strong></span><em>{deployment ? `${deploymentProgress?.completed || 0}/${deploymentProgress?.total || 0} 已处理` : `${deploymentRoutes.length} 张待发布`}</em></header>
              {deployment && <div className={`product-time-deployment-progress ${deployment.status}`}><i style={{ width: `${deploymentProgress?.percent || 0}%` }} /><span>{deploymentProgress?.percent || 0}%</span></div>}
              <div className="product-time-deployment-route-list">
                <div className="product-time-deployment-route-head"><span>工单</span><span>生产状态</span><span>同步内容</span><span>二维码 / 版本</span><span>结果</span></div>
                {deploymentRoutes.map(route => <article key={route.workOrderId} className={route.status}>
                  <span><strong>{route.workOrderCode}</strong><small>{route.workOrderId.slice(0, 12)}</small></span>
                  <span>{productTimeDeploymentRouteStateText(route.state)}</span>
                  <span><small>新增 {route.insertedProcesses || 0} · 调序 {route.movedProcesses || 0} · 退役 {route.retiredProcesses || 0} · 工时 {route.updatedTimes || 0}</small><small>系统承接 {route.systemCoveredQty || 0} · 待实报 {route.actualRequiredQty || 0} · 审计 {route.supplementObligations || 0}</small></span>
                  <span><small>{deployment ? (route.qrUpdated ? '二维码已更新' : route.status === 'unchanged' ? '二维码无需更新' : '二维码未更新') : '发布后同步二维码'}</small><small>{route.routeVersionBefore == null ? '路线待生成' : `V${route.routeVersionBefore} → ${route.routeVersionAfter == null ? '待发布' : `V${route.routeVersionAfter}`}`}</small></span>
                  <span><b>{deployment ? productTimeDeploymentRouteStatusText(route.status) : route.status === 'blocked' ? '冲突阻断' : '待同步'}</b>{route.error && <small title={route.error}>{route.error}</small>}</span>
                </article>)}
                {!deploymentRoutes.length && <p>当前产品没有需要同步的关联工单；发布仍会更新产品正式版本。</p>}
              </div>
            </section>
          </div>}

          {!deploymentPreviewLoading && !deploymentPreview && !deployment && <div className="product-time-deployment-empty"><AlertTriangle size={24} aria-hidden="true" /><strong>暂时无法生成发布预览</strong><span>请重新计算影响；在预览成功前不会修改正式版本、工单或二维码。</span></div>}

          <footer>
            <span>{deployment?.status === 'active'
              ? '发布已完成：二维码保持原地址，重新扫码即可看到最新工序与工时。'
              : deployment?.status === 'failed'
                ? '发布未完整成功，旧正式版本继续有效；请处理冲突或重试失败项。'
                : deploymentBusy
                  ? '正在原子同步；请勿重复发布。'
                  : '确认后才会修改正式版本与关联路线；在制新增工序按整单全套建立真实补报义务，不改变既有物料数量。'}</span>
            <div>
              <button className="hm-workbench-button" type="button" onClick={closeDeployment}>{deploymentBusy ? '后台同步，关闭详情' : deployment?.status === 'active' ? '完成' : '关闭'}</button>
              {!deployment && <button className="hm-workbench-button" type="button" disabled={deploymentPreviewLoading || publishing} onClick={() => void openPublishPreview()}><RefreshCw size={15} aria-hidden="true" />重新计算影响</button>}
              {!deployment && deploymentPreview && <button className="hm-workbench-button primary" type="button" disabled={publishing || !deploymentPreview.canPublish} onClick={() => void publish()}><QrCode size={15} aria-hidden="true" />{publishing ? '正在启动发布' : `确认发布并同步 ${((deploymentImpact?.workOrders.unstarted || 0) + (deploymentImpact?.workOrders.inProgress || 0))} 张未完成工单`}</button>}
              {deployment?.status === 'failed' && failedDeploymentRoutes.length > 0 && <button className="hm-workbench-button primary" type="button" disabled={deploymentRetrying} onClick={() => void retryDeployment()}><RefreshCw className={deploymentRetrying ? 'spin' : ''} size={15} aria-hidden="true" />{deploymentRetrying ? '正在重试' : `一键重试 ${failedDeploymentRoutes.length} 个失败项`}</button>}
            </div>
          </footer>
        </section>
      </div>}
    </main>
  );
}
