'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  CloudOff,
  Database,
  Eye,
  FileText,
  Image as ImageIcon,
  Images,
  ListChecks,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCapturedImage, prepareSamplePhotoForUpload } from '@/lib/image-client';
import {
  SAMPLE_SECTION_MAX_ROWS,
  createProcessRow,
  createProcessRows,
  createStrippingRow,
  createStrippingRows,
  formatDraftTime,
  hydrateProcessRows,
  hydrateStrippingRows,
  processRowHasContent,
  serializeProcessRows,
  serializeStrippingRows,
  strippingRowHasContent,
  validateProcessRows,
  validateStrippingRows,
  type ProcessDraftRow,
  type SampleSectionEnvelope,
  type StrippingDraftRow,
} from '@/lib/sample-capture-mobile';
import type {
  CurrentUserDTO,
  SampleDataEntryDTO,
  SampleDataKindDTO,
  SamplePhotoCategoryDTO,
  SamplePhotoDTO,
  SampleTaskDTO,
} from '@/types';

type CaptureTab = 'overview' | 'data' | 'photos' | 'records';
type SectionKind = 'PROCESS_TIME' | 'STRIPPING';
type ProcessOption = { id: string; name: string; code: string };
type PhotoSource = 'CAMERA' | 'ALBUM';
type LocalPhotoStatus = 'LOCAL' | 'UPLOADING' | 'FAILED';

type LocalPhotoDraft = {
  id: string;
  file: File;
  objectUrl: string;
  originalName: string;
  category: SamplePhotoCategoryDTO;
  caption: string;
  linkedEntryId: string;
  source: PhotoSource;
  mutationId: string;
  status: LocalPhotoStatus;
  progress: number;
  error: string;
};

type StoredLocalPhoto = Omit<LocalPhotoDraft, 'objectUrl'>;

type DataForm = {
  kind: SampleDataKindDTO;
  label: string;
  processDefinitionId: string;
  processName: string;
  measurements: string;
  recommendedSeconds: string;
  setupSeconds: string;
  occurrences: string;
  timeBasis: string;
  unitLabel: string;
  model: string;
  outerPeelMm: string;
  innerPeelMm: string;
  insertionLengthMm: string;
  positionLabel: string;
  name: string;
  specification: string;
  length: string;
  quantity: string;
  unit: string;
  tolerance: string;
  position: string;
  category: string;
  severity: string;
  content: string;
  value: string;
  remark: string;
};

const emptyDataForm: DataForm = {
  kind: 'MATERIAL', label: '', processDefinitionId: '', processName: '', measurements: '',
  recommendedSeconds: '', setupSeconds: '', occurrences: '', timeBasis: 'per_unit', unitLabel: '件',
  model: '', outerPeelMm: '', innerPeelMm: '', insertionLengthMm: '', positionLabel: '', name: '',
  specification: '', length: '', quantity: '', unit: '', tolerance: '', position: '', category: '',
  severity: '', content: '', value: '', remark: '',
};

const kindLabels: Record<SampleDataKindDTO, string> = {
  PROCESS_TIME: '工序与工时', STRIPPING: '剥皮参数', MATERIAL: '辅料数据', NOTICE: '注意事项', CUSTOM: '自定义记录',
};

const photoCategoryLabels: Record<SamplePhotoCategoryDTO, string> = {
  UNCLASSIFIED: '稍后分类', PROCESS_TIME: '工序与工时照片', STRIPPING: '剥皮参数照片', MATERIAL: '辅料照片',
  NOTICE: '注意事项照片', SEMI_FINISHED: '半成品照片', PROCESS: '过程图', MEASUREMENT: '测量证据',
  FINISHED: '成品图', DETAIL: '细节图', EXCEPTION: '异常参考',
};

const captureCategories = [
  { key: 'process-time', title: '工序与工时', description: '逐行填写实测工时，单位秒/件', kind: 'PROCESS_TIME' as const, photo: null, icon: Clock3 },
  { key: 'stripping', title: '剥皮参数', description: '型号、外剥、内剥与入长', kind: 'STRIPPING' as const, photo: null, icon: ListChecks },
  { key: 'material', title: '辅料', description: '名称、规格、用量或照片', kind: 'MATERIAL' as const, photo: null, icon: Database },
  { key: 'notice', title: '注意事项', description: '工艺提示、质量风险', kind: 'NOTICE' as const, photo: null, icon: AlertTriangle },
  { key: 'semi-finished', title: '半成品照片', description: '相机或相册可连续添加', kind: null, photo: 'SEMI_FINISHED' as const, icon: Images },
  { key: 'finished', title: '成品照片', description: '记录最终样品外观', kind: null, photo: 'FINISHED' as const, icon: PackageCheck },
] as const;

const reviewLabels: Record<string, string> = {
  DRAFT: '草稿', PENDING: '待审核', CHANGES_REQUESTED: '待修改', APPROVED: '已通过', PUBLISHED: '已发布', VOIDED: '已作废',
};

const PHOTO_DB = 'hongmeng-sample-capture';
const PHOTO_STORE = 'pending-photos';
const PHOTO_DB_VERSION = 2;

function newMutationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sample-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasMeaningfulForm(form: DataForm) {
  return Object.entries(form).some(([key, value]) => {
    if (key === 'kind') return false;
    if (key === 'timeBasis') return value !== 'per_unit';
    if (key === 'unitLabel') return value !== '件';
    return String(value || '').trim().length > 0;
  });
}

function taskStatusText(task: SampleTaskDTO) {
  if (task.status === 'PLANNED') return '待开始';
  if (task.status === 'IN_PROGRESS') return '采集中';
  if (task.status === 'SUBMITTED') return '已提交审核';
  if (task.status === 'COMPLETED') return '样品已完成';
  return '任务已取消';
}

async function bodyJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

function encodePhotoUploadMetadata(metadata: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  if (bytes.length > 6 * 1024) throw new Error('照片说明或原文件名过长，请缩短后重试');
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function openPhotoDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, PHOTO_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) request.result.createObjectStore(PHOTO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPhotoStoreValue(key: string): Promise<Record<string, any> | null> {
  const db = await openPhotoDb();
  if (!db) return null;
  const value = await new Promise<Record<string, any> | null>((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function writePhotoStoreValue(key: string, value: Record<string, unknown> | null) {
  const db = await openPhotoDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, 'readwrite');
    if (value) transaction.objectStore(PHOTO_STORE).put(value, key);
    else transaction.objectStore(PHOTO_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function nonEmptyPayload(form: DataForm): Record<string, unknown> {
  if (form.kind === 'MATERIAL') return { name: form.name, specification: form.specification, length: form.length, quantity: form.quantity, unit: form.unit, tolerance: form.tolerance, position: form.position, remark: form.remark };
  if (form.kind === 'NOTICE') return { category: form.category, severity: form.severity, content: form.content, processName: form.processName, remark: form.remark };
  return { value: form.value, unit: form.unit, remark: form.remark };
}

function formFromEntry(entry: SampleDataEntryDTO): DataForm {
  const payload = entry.payload;
  const text = (key: keyof DataForm) => String(payload[key] ?? '');
  return {
    ...emptyDataForm, kind: entry.kind, label: entry.label || '', processDefinitionId: text('processDefinitionId'),
    processName: text('processName'), recommendedSeconds: text('recommendedSeconds'), setupSeconds: text('setupSeconds'),
    occurrences: text('occurrences'), timeBasis: text('timeBasis') || 'per_unit', unitLabel: text('unitLabel') || '件',
    model: text('model'), outerPeelMm: text('outerPeelMm'), innerPeelMm: text('innerPeelMm'), insertionLengthMm: text('insertionLengthMm'),
    positionLabel: text('positionLabel'), name: text('name'), specification: text('specification'), length: text('length'),
    quantity: text('quantity'), unit: text('unit'), tolerance: text('tolerance'), position: text('position'), category: text('category'),
    severity: text('severity'), content: text('content'), value: text('value'), remark: text('remark'),
  };
}

function isSectionKind(kind: SampleDataKindDTO): kind is SectionKind {
  return kind === 'PROCESS_TIME' || kind === 'STRIPPING';
}

export default function SampleCaptureMobile({ code, user: _user }: { code: string; user: CurrentUserDTO }) {
  const [task, setTask] = useState<SampleTaskDTO | null>(null);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<CaptureTab>('overview');
  const [activeKind, setActiveKind] = useState<SampleDataKindDTO>('PROCESS_TIME');
  const [form, setForm] = useState<DataForm>(emptyDataForm);
  const [editingEntry, setEditingEntry] = useState<SampleDataEntryDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingSection, setSavingSection] = useState<SectionKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [online, setOnline] = useState(true);
  const [entryMutationId, setEntryMutationId] = useState(newMutationId);
  const [submissionMutationId, setSubmissionMutationId] = useState(newMutationId);
  const [withdrawMutationId, setWithdrawMutationId] = useState(newMutationId);

  const [processRows, setProcessRows] = useState<ProcessDraftRow[]>(() => createProcessRows());
  const [strippingRows, setStrippingRows] = useState<StrippingDraftRow[]>(() => createStrippingRows());
  const [sectionRevisions, setSectionRevisions] = useState<Record<SectionKind, number>>({ PROCESS_TIME: 0, STRIPPING: 0 });
  const [sectionSavedAt, setSectionSavedAt] = useState<Record<SectionKind, string>>({ PROCESS_TIME: '', STRIPPING: '' });
  const [dirtySections, setDirtySections] = useState<Set<SectionKind>>(() => new Set());
  const [processErrors, setProcessErrors] = useState<Record<string, string>>({});
  const [strippingErrors, setStrippingErrors] = useState<Record<string, string>>({});
  const [lastActiveRow, setLastActiveRow] = useState<Record<SectionKind, string>>({ PROCESS_TIME: '', STRIPPING: '' });
  const [openComboboxRow, setOpenComboboxRow] = useState('');
  const [comboboxIndex, setComboboxIndex] = useState(0);

  const [photoQueue, setPhotoQueue] = useState<LocalPhotoDraft[]>([]);
  const [photoCategory, setPhotoCategory] = useState<SamplePhotoCategoryDTO>('UNCLASSIFIED');
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(() => new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [photoEditor, setPhotoEditor] = useState<{ id: string; category: SamplePhotoCategoryDTO; caption: string; linkedEntryId: string; captureSource: string; sortOrder: number; version: number } | null>(null);
  const [photoEditing, setPhotoEditing] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const sectionHydrated = useRef(false);
  const genericDraftHydrated = useRef(false);
  const photoQueueHydrated = useRef(false);

  const genericDraftKey = `sample-capture:${code}:draft`;
  const sectionDraftKey = `sample-capture:${code}:sections-v2`;
  const legacyPhotoQueueKey = `sample-capture:${code}:photo`;
  const photoQueueKey = `sample-capture:${code}:photo-queue-v2`;
  const submissionMutationKey = `sample-capture:${code}:submission-mutation`;
  const withdrawMutationKey = `sample-capture:${code}:withdraw-mutation`;

  const hardClosed = task?.status === 'COMPLETED' || task?.status === 'CANCELLED';
  const submitted = task?.status === 'SUBMITTED';
  const readOnly = hardClosed || submitted;
  const formHasData = useMemo(() => hasMeaningfulForm(form), [form]);
  const processHasData = useMemo(() => processRows.some(processRowHasContent), [processRows]);
  const strippingHasData = useMemo(() => strippingRows.some(strippingRowHasContent), [strippingRows]);
  const syncedCount = (task?.entries.length || 0) + (task?.photos.length || 0);
  const pendingChanges = useMemo(() => [
    ...(task?.entries.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
    ...(task?.photos.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
  ], [task]);
  const collectedKinds = useMemo(() => {
    const values = new Set<string>([...(task?.entries.map(item => item.kind) || []), ...(task?.photos.map(item => item.category) || [])]);
    if (processHasData) values.add('PROCESS_TIME');
    if (strippingHasData) values.add('STRIPPING');
    return values;
  }, [processHasData, strippingHasData, task]);

  const createObjectUrl = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }, []);
  const revokeObjectUrl = useCallback((url: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }, []);

  const hydrateSections = useCallback((taskSnapshot: SampleTaskDTO, sections: SampleSectionEnvelope[]) => {
    const processSection = sections.find(section => section.kind === 'PROCESS_TIME');
    const strippingSection = sections.find(section => section.kind === 'STRIPPING');
    let nextProcessRows = hydrateProcessRows(processSection, taskSnapshot.entries);
    let nextStrippingRows = hydrateStrippingRows(strippingSection, taskSnapshot.entries);
    let nextDirty = new Set<SectionKind>();
    const latestSection = [...sections].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
    let nextActiveKind: SampleDataKindDTO = isSectionKind(String(latestSection?.uiState?.lastActiveKind || '') as SampleDataKindDTO)
      ? String(latestSection?.uiState?.lastActiveKind) as SectionKind
      : 'PROCESS_TIME';
    let nextLastActive: Record<SectionKind, string> = {
      PROCESS_TIME: String(processSection?.uiState?.lastEditedRowId || processSection?.uiState?.lastActiveRowId || ''),
      STRIPPING: String(strippingSection?.uiState?.lastEditedRowId || strippingSection?.uiState?.lastActiveRowId || ''),
    };
    try {
      const stored = window.localStorage.getItem(sectionDraftKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { processRows?: ProcessDraftRow[]; strippingRows?: StrippingDraftRow[]; dirtyKinds?: SectionKind[]; activeKind?: SampleDataKindDTO; lastActiveRow?: Record<SectionKind, string> };
        nextDirty = new Set((parsed.dirtyKinds || []).filter(kind => isSectionKind(kind)));
        if (nextDirty.has('PROCESS_TIME') && Array.isArray(parsed.processRows)) nextProcessRows = parsed.processRows.slice(0, SAMPLE_SECTION_MAX_ROWS);
        if (nextDirty.has('STRIPPING') && Array.isArray(parsed.strippingRows)) nextStrippingRows = parsed.strippingRows.slice(0, SAMPLE_SECTION_MAX_ROWS);
        if (parsed.activeKind) nextActiveKind = parsed.activeKind;
        if (parsed.lastActiveRow) nextLastActive = parsed.lastActiveRow;
      }
    } catch {
      setMessage('本机分区草稿读取失败，已恢复服务器版本');
    }
    setProcessRows(nextProcessRows.length ? nextProcessRows : createProcessRows());
    setStrippingRows(nextStrippingRows.length ? nextStrippingRows : createStrippingRows());
    setDirtySections(nextDirty);
    setActiveKind(nextActiveKind);
    setLastActiveRow(nextLastActive);
    setSectionRevisions({ PROCESS_TIME: processSection?.revision || 0, STRIPPING: strippingSection?.revision || 0 });
    setSectionSavedAt({ PROCESS_TIME: processSection?.updatedAt || '', STRIPPING: strippingSection?.updatedAt || '' });
    sectionHydrated.current = true;
  }, [sectionDraftKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [taskResponse, contextResponse] = await Promise.all([
        fetch(`/api/sample-tasks/code/${encodeURIComponent(code)}`, { cache: 'no-store' }),
        fetch('/api/sample-team/context', { cache: 'no-store' }),
      ]);
      const taskBody = await bodyJson(taskResponse);
      const contextBody = await bodyJson(contextResponse);
      if (!taskResponse.ok) throw new Error(taskBody.error || '样品任务读取失败');
      const nextTask = taskBody.task as SampleTaskDTO;
      setTask(nextTask);
      if (contextResponse.ok) setProcesses(Array.isArray(contextBody.processes) ? contextBody.processes : []);
      const sectionResponse = await fetch(`/api/sample-tasks/${nextTask.id}/sections`, { cache: 'no-store' });
      const sectionBody = await bodyJson(sectionResponse);
      if (sectionResponse.ok) {
        if (sectionBody.task) setTask(sectionBody.task as SampleTaskDTO);
        hydrateSections((sectionBody.task || nextTask) as SampleTaskDTO, Array.isArray(sectionBody.sections) ? sectionBody.sections : []);
      } else {
        hydrateSections(nextTask, []);
        setMessage(sectionBody.error || '分区草稿暂不可用，已显示历史采集记录');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '样品任务读取失败');
    } finally {
      setLoading(false);
    }
  }, [code, hydrateSections]);

  const reloadTaskOnly = useCallback(async () => {
    const response = await fetch(`/api/sample-tasks/code/${encodeURIComponent(code)}`, { cache: 'no-store' });
    const body = await bodyJson(response);
    if (!response.ok) throw new Error(body.error || '样品任务刷新失败');
    setTask(body.task as SampleTaskDTO);
    return body.task as SampleTaskDTO;
  }, [code]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setOnline(navigator.onLine);
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline); window.addEventListener('offline', markOffline);
    return () => { window.removeEventListener('online', markOnline); window.removeEventListener('offline', markOffline); };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(genericDraftKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { form?: DataForm; entryMutationId?: string };
        if (parsed.form) setForm({ ...emptyDataForm, ...parsed.form });
        if (parsed.entryMutationId) setEntryMutationId(parsed.entryMutationId);
      }
    } catch { setMessage('本机文字草稿读取失败，可继续重新录入'); }
    genericDraftHydrated.current = true;
  }, [genericDraftKey]);

  useEffect(() => {
    const hydrateQueue = async () => {
      try {
        const stored = await readPhotoStoreValue(photoQueueKey);
        const legacy = stored ? null : await readPhotoStoreValue(legacyPhotoQueueKey);
        let items: StoredLocalPhoto[] = [];
        if (stored && Array.isArray(stored.items)) items = stored.items as StoredLocalPhoto[];
        else if (legacy?.file instanceof File) items = [{ id: newMutationId(), file: legacy.file, originalName: legacy.file.name, category: (legacy.category || 'UNCLASSIFIED') as SamplePhotoCategoryDTO, caption: String(legacy.caption || ''), linkedEntryId: String(legacy.linkedEntryId || ''), source: 'CAMERA', mutationId: String(legacy.mutationId || newMutationId()), status: 'LOCAL', progress: 0, error: '' }];
        const hydrated = items.filter(item => item.file instanceof File).map(item => ({ ...item, status: item.status === 'UPLOADING' ? 'LOCAL' as const : item.status, progress: item.status === 'UPLOADING' ? 0 : Number(item.progress || 0), objectUrl: createObjectUrl(item.file) }));
        setPhotoQueue(hydrated);
        if (legacy && hydrated.length) {
          await writePhotoStoreValue(photoQueueKey, { version: 2, items: hydrated.map(({ objectUrl: _objectUrl, ...item }) => item) });
          await writePhotoStoreValue(legacyPhotoQueueKey, null);
        }
      } catch { setMessage('本机照片队列读取失败，请重新选择照片'); }
      finally { photoQueueHydrated.current = true; }
    };
    void hydrateQueue();
  }, [createObjectUrl, legacyPhotoQueueKey, photoQueueKey]);

  useEffect(() => () => { for (const url of objectUrlsRef.current) URL.revokeObjectURL(url); objectUrlsRef.current.clear(); }, []);
  useEffect(() => {
    const stored = window.sessionStorage.getItem(submissionMutationKey);
    if (stored) setSubmissionMutationId(stored); else window.sessionStorage.setItem(submissionMutationKey, submissionMutationId);
  }, [submissionMutationId, submissionMutationKey]);
  useEffect(() => {
    const stored = window.sessionStorage.getItem(withdrawMutationKey);
    if (stored) setWithdrawMutationId(stored); else window.sessionStorage.setItem(withdrawMutationKey, withdrawMutationId);
  }, [withdrawMutationId, withdrawMutationKey]);
  useEffect(() => {
    if (!genericDraftHydrated.current) return;
    if (hasMeaningfulForm(form)) window.localStorage.setItem(genericDraftKey, JSON.stringify({ form, entryMutationId, savedAt: new Date().toISOString() }));
    else window.localStorage.removeItem(genericDraftKey);
  }, [entryMutationId, form, genericDraftKey]);
  useEffect(() => {
    if (!sectionHydrated.current) return;
    window.localStorage.setItem(sectionDraftKey, JSON.stringify({ processRows, strippingRows, dirtyKinds: Array.from(dirtySections), activeKind, lastActiveRow, savedAt: new Date().toISOString() }));
  }, [activeKind, dirtySections, lastActiveRow, processRows, sectionDraftKey, strippingRows]);
  useEffect(() => {
    if (!photoQueueHydrated.current) return;
    const items = photoQueue.map(({ objectUrl: _objectUrl, ...item }) => item);
    void writePhotoStoreValue(photoQueueKey, items.length ? { version: 2, items } : null).catch(() => setMessage('照片队列保存失败，请保持页面打开后重试'));
  }, [photoQueue, photoQueueKey]);
  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!formHasData && !dirtySections.size && !photoQueue.length) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [dirtySections.size, formHasData, photoQueue.length]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 4200);
    return () => window.clearTimeout(timer);
  }, [message]);

  function markSectionDirty(kind: SectionKind) {
    setDirtySections(current => new Set(current).add(kind));
  }

  function updateProcessRow(rowId: string, patch: Partial<ProcessDraftRow>) {
    setProcessRows(current => current.map(row => row.rowId === rowId ? { ...row, ...patch } : row));
    setProcessErrors(current => { const next = { ...current }; delete next[rowId]; return next; });
    setLastActiveRow(current => ({ ...current, PROCESS_TIME: rowId }));
    markSectionDirty('PROCESS_TIME');
  }

  function updateStrippingRow(rowId: string, patch: Partial<StrippingDraftRow>) {
    setStrippingRows(current => current.map(row => row.rowId === rowId ? { ...row, ...patch } : row));
    setStrippingErrors(current => { const next = { ...current }; delete next[rowId]; return next; });
    setLastActiveRow(current => ({ ...current, STRIPPING: rowId }));
    markSectionDirty('STRIPPING');
  }

  function removeProcessRow(rowId: string) {
    setProcessRows(current => current.length === 1 ? [createProcessRow()] : current.filter(row => row.rowId !== rowId));
    setProcessErrors(current => { const next = { ...current }; delete next[rowId]; return next; });
    markSectionDirty('PROCESS_TIME');
  }

  function removeStrippingRow(rowId: string) {
    setStrippingRows(current => current.length === 1 ? [createStrippingRow()] : current.filter(row => row.rowId !== rowId));
    setStrippingErrors(current => { const next = { ...current }; delete next[rowId]; return next; });
    markSectionDirty('STRIPPING');
  }

  function addProcessRow() {
    if (processRows.length >= SAMPLE_SECTION_MAX_ROWS) { setMessage(`每个分区最多 ${SAMPLE_SECTION_MAX_ROWS} 行`); return; }
    const row = createProcessRow();
    setProcessRows(current => [...current, row]);
    setLastActiveRow(current => ({ ...current, PROCESS_TIME: row.rowId }));
    markSectionDirty('PROCESS_TIME');
    window.setTimeout(() => document.getElementById(`process-name-${row.rowId}`)?.focus(), 0);
  }

  function addStrippingRow() {
    if (strippingRows.length >= SAMPLE_SECTION_MAX_ROWS) { setMessage(`每个分区最多 ${SAMPLE_SECTION_MAX_ROWS} 行`); return; }
    const row = createStrippingRow();
    setStrippingRows(current => [...current, row]);
    setLastActiveRow(current => ({ ...current, STRIPPING: row.rowId }));
    markSectionDirty('STRIPPING');
    window.setTimeout(() => document.getElementById(`stripping-model-${row.rowId}`)?.focus(), 0);
  }

  function matchingProcesses(query: string) {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return processes.slice(0, 8);
    return processes.filter(process => `${process.name} ${process.code}`.toLocaleLowerCase('zh-CN').includes(normalized)).slice(0, 8);
  }

  function chooseProcess(row: ProcessDraftRow, process: ProcessOption | null) {
    if (process) updateProcessRow(row.rowId, { processDefinitionId: process.id, processName: process.name, source: 'OFFICIAL' });
    else updateProcessRow(row.rowId, { processDefinitionId: '', processName: row.processName.trim(), source: 'PROPOSED' });
    setOpenComboboxRow('');
  }

  function handleProcessKeyDown(event: React.KeyboardEvent<HTMLInputElement>, row: ProcessDraftRow) {
    const matches = matchingProcesses(row.processName);
    const exact = processes.some(process => process.name.trim().toLocaleLowerCase('zh-CN') === row.processName.trim().toLocaleLowerCase('zh-CN'));
    const optionCount = matches.length + (row.processName.trim() && !exact ? 1 : 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault(); setOpenComboboxRow(row.rowId); setComboboxIndex(current => optionCount ? (current + 1) % optionCount : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); setOpenComboboxRow(row.rowId); setComboboxIndex(current => optionCount ? (current - 1 + optionCount) % optionCount : 0);
    } else if (event.key === 'Enter' && openComboboxRow === row.rowId && optionCount) {
      event.preventDefault();
      if (comboboxIndex < matches.length) chooseProcess(row, matches[comboboxIndex]); else chooseProcess(row, null);
    } else if (event.key === 'Escape') setOpenComboboxRow('');
  }

  async function saveSection(kind: SectionKind) {
    if (!task || readOnly) return;
    const errors = kind === 'PROCESS_TIME' ? validateProcessRows(processRows) : validateStrippingRows(strippingRows);
    if (kind === 'PROCESS_TIME') setProcessErrors(errors); else setStrippingErrors(errors);
    if (Object.keys(errors).length) {
      setMessage('请先修正标出的未完整行');
      const rowId = Object.keys(errors)[0];
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${rowId}"] input`)?.focus(), 0);
      return;
    }
    if (!online) { setMessage('当前离线：内容已保存在本机，联网后请再次点击保存草稿'); return; }
    setSavingSection(kind);
    try {
      const rows = kind === 'PROCESS_TIME' ? serializeProcessRows(processRows) : serializeStrippingRows(strippingRows);
      const activeRows = kind === 'PROCESS_TIME' ? processRows : strippingRows;
      const response = await fetch(`/api/sample-tasks/${task.id}/sections/${kind}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedTaskVersion: task.version,
          expectedSectionRevision: sectionRevisions[kind],
          clientMutationId: newMutationId(),
          payload: { rows },
          uiState: { visibleRowCount: activeRows.length, lastEditedRowId: lastActiveRow[kind] || activeRows[0]?.rowId || '', lastActiveKind: kind },
        }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '草稿保存失败');
      if (body.task) setTask(current => !current || (body.task as SampleTaskDTO).version >= current.version ? body.task as SampleTaskDTO : current);
      const section = body.section as SampleSectionEnvelope;
      setSectionRevisions(current => ({ ...current, [kind]: section?.revision || current[kind] + 1 }));
      setSectionSavedAt(current => ({ ...current, [kind]: section?.updatedAt || new Date().toISOString() }));
      setDirtySections(current => { const next = new Set(current); next.delete(kind); return next; });
      setMessage(`${kindLabels[kind]}草稿已保存到服务器`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '草稿保存失败'); }
    finally { setSavingSection(null); }
  }

  function changeGenericKind(kind: SampleDataKindDTO) {
    setEditingEntry(null); setActiveKind(kind); setForm({ ...emptyDataForm, kind });
  }

  async function openCategory(category: typeof captureCategories[number]) {
    if (category.kind) {
      setActiveKind(category.kind);
      if (!isSectionKind(category.kind)) changeGenericKind(category.kind);
      setTab('data');
    } else if (category.photo) { setPhotoCategory(category.photo); setTab('photos'); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const resumeKind: SectionKind | null = category.kind && isSectionKind(category.kind) ? category.kind : null;
    if (resumeKind && lastActiveRow[resumeKind]) {
      const resumeRowId = lastActiveRow[resumeKind];
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${resumeRowId}"]`)?.scrollIntoView({ block: 'center' }), 80);
    }
  }

  async function saveEntry() {
    if (!task || readOnly || (!editingEntry && !hasMeaningfulForm(form))) return;
    setSaving(true);
    try {
      const response = await fetch(editingEntry ? `/api/sample-entries/${editingEntry.id}` : `/api/sample-tasks/${task.id}/entries`, {
        method: editingEntry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: form.kind, label: form.label, payload: nonEmptyPayload(form), expectedTaskVersion: task.version,
          ...(!editingEntry ? { clientMutationId: entryMutationId } : {}), ...(editingEntry ? { expectedVersion: editingEntry.version } : {}),
        }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '数据保存失败');
      setTask(body.task as SampleTaskDTO);
      setForm({ ...emptyDataForm, kind: form.kind });
      window.localStorage.removeItem(genericDraftKey);
      setEntryMutationId(newMutationId()); setEditingEntry(null);
      setMessage(editingEntry ? '记录已更新为采集草稿' : '记录已保存到服务器草稿');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '数据保存失败'); }
    finally { setSaving(false); }
  }

  async function deleteEntry(entry: SampleDataEntryDTO) {
    if (!task || readOnly || !window.confirm('删除这条样品采集记录？已发布记录不能删除。')) return;
    try {
      const response = await fetch(`/api/sample-entries/${entry.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: entry.version, expectedTaskVersion: task.version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '删除失败');
      setTask(body.task as SampleTaskDTO); setMessage('记录已软删除并保留审计痕迹');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '删除失败'); }
  }

  function editEntry(entry: SampleDataEntryDTO) {
    if (isSectionKind(entry.kind)) { setActiveKind(entry.kind); setTab('data'); return; }
    setEditingEntry(entry); setActiveKind(entry.kind); setForm(formFromEntry(entry)); setTab('data');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function choosePhotos(files: FileList | null, source: PhotoSource) {
    if (!files?.length || readOnly) return;
    setPhotoPreparing(true);
    let added = 0;
    for (const file of Array.from(files)) {
      try {
        const normalized = await normalizeCapturedImage(file);
        const item: LocalPhotoDraft = { id: newMutationId(), file: normalized, objectUrl: createObjectUrl(normalized), originalName: file.name, category: photoCategory, caption: '', linkedEntryId: '', source, mutationId: newMutationId(), status: 'LOCAL', progress: 0, error: '' };
        setPhotoQueue(current => [...current, item]); added += 1;
      } catch { setMessage(`照片“${file.name}”处理失败，请换一张后重试`); }
    }
    setPhotoPreparing(false);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (albumInputRef.current) albumInputRef.current.value = '';
    if (added) setMessage(online ? `已加入 ${added} 张照片，等待上传` : `已将 ${added} 张照片安全保存在本机`);
  }

  function updateLocalPhoto(id: string, patch: Partial<LocalPhotoDraft>) {
    setPhotoQueue(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function removeLocalPhoto(id: string) {
    setPhotoQueue(current => {
      const item = current.find(photo => photo.id === id); if (item) revokeObjectUrl(item.objectUrl);
      return current.filter(photo => photo.id !== id);
    });
    setSelectedPhotos(current => { const next = new Set(current); next.delete(`local:${id}`); return next; });
  }

  async function uploadLocalPhoto(item: LocalPhotoDraft, sortOrder: number) {
    if (!task) return false;
    updateLocalPhoto(item.id, { status: 'UPLOADING', progress: 20, error: '' });
    try {
      const uploadFile = await prepareSamplePhotoForUpload(item.file, item.mutationId);
      const metadata = encodePhotoUploadMetadata({
        category: item.category,
        caption: item.caption.slice(0, 500),
        captureSource: item.source,
        sourceOriginalName: item.originalName.slice(0, 255),
        sortOrder: String(sortOrder),
        clientMutationId: item.mutationId,
        expectedTaskVersion: String(task.version),
        linkedEntryId: item.linkedEntryId,
      });
      updateLocalPhoto(item.id, { progress: 45 });
      const response = await fetch(`/api/sample-tasks/${task.id}/photos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'X-Sample-Photo-Protocol': 'raw-v1',
          'X-Sample-Photo-Metadata': metadata,
        },
        body: uploadFile,
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片上传失败');
      if (body.task) setTask(current => !current || (body.task as SampleTaskDTO).version >= current.version ? body.task as SampleTaskDTO : current);
      updateLocalPhoto(item.id, { progress: 100 }); removeLocalPhoto(item.id); return true;
    } catch (reason) {
      updateLocalPhoto(item.id, { status: 'FAILED', progress: 0, error: reason instanceof Error ? reason.message : '照片上传失败' });
      return false;
    }
  }

  async function uploadPhotoQueue(targetId?: string) {
    if (!task || readOnly || !online || photoUploading) return;
    const candidates = photoQueue.filter(item => (!targetId || item.id === targetId) && item.status !== 'UPLOADING');
    if (!candidates.length) return;
    setPhotoUploading(true);
    let cursor = 0; let success = 0;
    const workers = Array.from({ length: Math.min(2, candidates.length) }, async () => {
      while (cursor < candidates.length) { const index = cursor++; if (await uploadLocalPhoto(candidates[index], (task.photos.length || 0) + index)) success += 1; }
    });
    await Promise.all(workers); setPhotoUploading(false);
    try { await reloadTaskOnly(); } catch { /* upload response already carried the task */ }
    setMessage(success === candidates.length ? `${success} 张照片已上传到对象存储` : `${success} 张已上传，失败项可单独重试`);
  }

  async function savePhotoMetadata() {
    if (!task || !photoEditor || readOnly) return;
    setPhotoEditing(true);
    try {
      const response = await fetch(`/api/sample-photos/${photoEditor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: photoEditor.version, expectedTaskVersion: task.version, category: photoEditor.category, caption: photoEditor.caption, captureSource: photoEditor.captureSource, linkedEntryId: photoEditor.linkedEntryId || null, sortOrder: photoEditor.sortOrder }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片说明保存失败');
      setTask(body.task as SampleTaskDTO); setPhotoEditor(null); setMessage('照片分类与说明已保存');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '照片说明保存失败'); }
    finally { setPhotoEditing(false); }
  }

  async function deleteServerPhoto(photo: SamplePhotoDTO, skipConfirm = false, expectedTaskVersion = task?.version) {
    if (!task || readOnly || (!skipConfirm && !window.confirm('移除这张照片？原文件会按软删除规则保留。'))) return false;
    try {
      const response = await fetch(`/api/sample-photos/${photo.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: photo.version, expectedTaskVersion, deleteReason: '采集端删除草稿照片' }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片删除失败');
      setTask(body.task as SampleTaskDTO);
      setSelectedPhotos(current => { const next = new Set(current); next.delete(`server:${photo.id}`); return next; });
      if (!skipConfirm) setMessage('照片已移出本次采集，原文件按软删除规则保留');
      return body.task as SampleTaskDTO;
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '照片删除失败'); return false; }
  }

  async function deleteSelectedPhotos() {
    if (!selectedPhotos.size || !window.confirm(`删除选中的 ${selectedPhotos.size} 张照片？服务器照片将软删除。`)) return;
    const localIds = Array.from(selectedPhotos).filter(key => key.startsWith('local:')).map(key => key.slice(6));
    localIds.forEach(removeLocalPhoto);
    const serverIds = new Set(Array.from(selectedPhotos).filter(key => key.startsWith('server:')).map(key => key.slice(7)));
    let taskVersion = task?.version;
    for (const photo of task?.photos || []) {
      if (!serverIds.has(photo.id)) continue;
      const nextTask = await deleteServerPhoto(photo, true, taskVersion);
      if (nextTask && typeof nextTask !== 'boolean') taskVersion = nextTask.version;
    }
    setSelectedPhotos(new Set()); setMessage('选中照片已处理');
  }

  async function submitTask() {
    if (!task || readOnly) return;
    if (dirtySections.size || formHasData) { setMessage('还有未保存内容，请先点击“保存草稿”'); return; }
    if (photoQueue.length) { setMessage('还有未同步或上传失败的照片，请全部上传或删除后再提交'); return; }
    if (!online) { setMessage('当前离线，联网后才能提交审核'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: task.version, clientMutationId: submissionMutationId }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '提交失败');
      setTask(body.task as SampleTaskDTO);
      const nextSubmissionMutationId = newMutationId(); setSubmissionMutationId(nextSubmissionMutationId);
      window.sessionStorage.setItem(submissionMutationKey, nextSubmissionMutationId);
      setMessage('已冻结当前版本并提交管理员/工艺审核'); setTab('records');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '提交失败'); }
    finally { setSubmitting(false); }
  }

  async function withdrawSubmission() {
    if (!task || task.status !== 'SUBMITTED' || !window.confirm('撤回本次提交并继续编辑？已经发生审核的项目不能撤回。')) return;
    setWithdrawing(true);
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}/withdraw-submission`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: task.version, reason: '现场继续补充或修正样品采集数据', clientMutationId: withdrawMutationId }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '撤回提交失败');
      setTask(body.task as SampleTaskDTO);
      const nextWithdrawMutationId = newMutationId();
      setWithdrawMutationId(nextWithdrawMutationId);
      window.sessionStorage.setItem(withdrawMutationKey, nextWithdrawMutationId);
      setMessage('已撤回提交，可以继续编辑草稿');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '撤回提交失败'); }
    finally { setWithdrawing(false); }
  }

  const previewItems = useMemo(() => [
    ...photoQueue.map(item => ({ key: `local:${item.id}`, src: item.objectUrl, alt: item.caption || item.originalName })),
    ...(task?.photos || []).map(item => ({ key: `server:${item.id}`, src: item.contentUrl, alt: item.caption || item.originalName })),
  ], [photoQueue, task?.photos]);

  useEffect(() => {
    if (previewIndex === null) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewIndex(null);
      if (event.key === 'ArrowLeft') setPreviewIndex(current => current === null ? null : Math.max(0, current - 1));
      if (event.key === 'ArrowRight') setPreviewIndex(current => current === null ? null : Math.min(previewItems.length - 1, current + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewIndex, previewItems.length]);

  const activeSectionKind: SectionKind | null = isSectionKind(activeKind) ? activeKind : null;
  const focused = tab === 'data' || tab === 'photos';
  const canSubmit = Boolean(task && !readOnly && online && !dirtySections.size && !formHasData && !photoQueue.length && !submitting);

  if (loading && !task) return <main className="sample-capture-loading"><Loader2 className="spin" /><strong>正在读取样品二维码</strong><span>加载任务和已采集记录…</span></main>;
  if (!task) return <main className="sample-capture-failure"><AlertTriangle /><strong>无法打开样品任务</strong><p>{error || '二维码无效或任务不存在'}</p><button type="button" onClick={() => void load()}><RefreshCw />重新读取</button></main>;

  const renderFocusHeader = (title: string, savedText?: string) => <header className="sample-capture-header sample-focus-header">
    <button type="button" aria-label="返回采集首页" onClick={() => { setOpenComboboxRow(''); setTab('overview'); }}><ArrowLeft /></button>
    <div><strong>{title}</strong><span>{task.specification}</span></div>
    <em className={savedText ? 'saved' : ''}>{savedText || (online ? '在线' : '离线')}</em>
  </header>;

  const renderSubmitFooter = (kind?: SectionKind) => <footer className="sample-focus-submitbar">
    {submitted ? <>
      <div><span>当前版本已提交，需撤回后编辑</span></div>
      <button className="secondary" type="button" disabled={withdrawing} onClick={() => void withdrawSubmission()}>{withdrawing ? <Loader2 className="spin" /> : <RotateCcw />}撤回提交</button>
    </> : <>
      <button className="secondary" type="button" disabled={readOnly || saving || Boolean(savingSection)} onClick={() => kind ? void saveSection(kind) : void saveEntry()}>{saving || savingSection === kind ? <><Loader2 className="spin" />保存中</> : <><Save />保存草稿</>}</button>
      <button className="primary" type="button" disabled={!canSubmit} onClick={() => void submitTask()}>{submitting ? <><Loader2 className="spin" />提交中</> : <><Send />提交审核</>}</button>
    </>}
  </footer>;

  return <main className={`sample-capture-page v13485 sample-capture-focused-v2 ${tab === 'overview' ? 'overview' : ''} ${focused ? 'focused' : ''}`}>
    {!focused && <header className="sample-capture-header">
      <Link href="/production?branch=samples" aria-label="返回样品执行"><ArrowLeft /></Link>
      <div><span>样品数据采集</span><strong>{task.code}</strong></div>
      <button type="button" aria-label="刷新" onClick={() => void load()}><RefreshCw /></button>
    </header>}

    {tab === 'data' && activeSectionKind && renderFocusHeader(kindLabels[activeSectionKind], sectionSavedAt[activeSectionKind] ? `已保存 ${formatDraftTime(sectionSavedAt[activeSectionKind])}` : dirtySections.has(activeSectionKind) ? '有未保存内容' : '尚未保存')}
    {tab === 'data' && !activeSectionKind && renderFocusHeader(kindLabels[activeKind], formHasData ? '有未保存内容' : '草稿编辑')}
    {tab === 'photos' && renderFocusHeader('样品照片', `${task.photos.length + photoQueue.length} 张`)}

    {tab === 'overview' && <>
      <section className="sample-capture-identity">
        <div><span style={{ background: task.customerLevelColor || '#e11d48' }}>{task.customerLevelLabel || task.customerLevelCode || '未分级'}</span><em>{collectedKinds.size ? `已采集 ${collectedKinds.size} 类` : taskStatusText(task)}</em></div>
        <h1>{task.specification}</h1>
        <p>{task.customerName} · {task.productName || '未设置品名'}</p>
        <dl><div><dt>计划日期</dt><dd>{task.dueDate || '未设置'}</dd></div><div><dt>成员</dt><dd>{task.assignees.map(item => item.name).join('、') || '未指派'}</dd></div><div><dt>当前状态</dt><dd>{taskStatusText(task)}</dd></div></dl>
      </section>
      <section className="sample-sync-strip" aria-label="采集同步状态">
        <div><Database /><span>未保存</span><strong>{dirtySections.size + (formHasData ? 1 : 0)}</strong></div>
        <div><CloudOff /><span>待上传</span><strong>{photoQueue.length}</strong></div>
        <div className={online ? 'online' : 'offline'}>{online ? <Cloud /> : <CloudOff />}<span>{online ? '已同步' : '离线'}</span><strong>{syncedCount}</strong></div>
      </section>
    </>}

    {!!pendingChanges.length && tab === 'overview' && <section className="sample-capture-guidance warning"><AlertTriangle /><span><strong>{pendingChanges.length} 项被退回修改</strong><small>退回项目已经恢复可编辑；修改并保存后可重新提交审核。</small></span></section>}
    {hardClosed && <div className="sample-capture-readonly"><AlertTriangle />当前任务为{task.status === 'COMPLETED' ? '已完成' : '已取消'}，现有记录只读；需要继续采集请在样品执行中重新打开任务。</div>}
    {submitted && tab !== 'overview' && <div className="sample-capture-readonly submitted"><CheckCircle2 />当前版本已提交审核，页面只读；尚未发生审核时可从底部撤回。</div>}

    {tab === 'overview' && <section className="sample-capture-overview">
      <header><div><span>选择采集内容</span><h2>按分区专注填写</h2></div><button type="button" onClick={() => setTab('records')}>查看记录 {syncedCount}<ChevronRight /></button></header>
      <div className="sample-category-grid">
        {captureCategories.map(category => {
          const count = category.kind === 'PROCESS_TIME' ? serializeProcessRows(processRows).length
            : category.kind === 'STRIPPING' ? serializeStrippingRows(strippingRows).length
              : category.kind ? task.entries.filter(item => item.kind === category.kind).length
                : task.photos.filter(item => item.category === category.photo).length + photoQueue.filter(item => item.category === category.photo).length;
          const Icon = category.icon;
          return <button className={count ? 'collected' : ''} type="button" key={category.key} onClick={() => void openCategory(category)}>
            <span className="sample-category-icon"><Icon /></span><span><strong>{category.title}</strong><small>{category.description}</small></span><em>{count ? `${count} 项` : '选填'}<ChevronRight /></em>
          </button>;
        })}
      </div>
      {!!photoQueue.length && <div className="sample-upload-queue">
        <div><ImageIcon /><span><strong>{photoQueue.length} 张照片待同步</strong><small>{photoQueue.some(item => item.status === 'FAILED') ? '含上传失败项，请进入照片分区重试' : '进入照片分区可预览、编辑和上传'}</small></span><em>{online ? '本机队列' : '离线保存'}</em></div>
        <i><span style={{ width: `${Math.round(photoQueue.filter(item => item.status === 'UPLOADING').reduce((sum, item) => sum + item.progress, 0) / Math.max(1, photoQueue.length))}%` }} /></i>
      </div>}
      <div className="sample-overview-actions">
        <button className="primary" type="button" disabled={hardClosed} onClick={() => void openCategory(captureCategories[0])}><Plus />继续采集</button>
        {submitted ? <button className="secondary" type="button" disabled={withdrawing} onClick={() => void withdrawSubmission()}>{withdrawing ? <Loader2 className="spin" /> : <RotateCcw />}撤回提交并编辑</button>
          : <button className="secondary" type="button" disabled={!canSubmit} onClick={() => void submitTask()}>{submitting ? <><Loader2 className="spin" />提交中</> : <><Send />提交本次记录</>}</button>}
      </div>
      <div className="sample-optional-note"><CheckCircle2 /><span><strong>保存不等于提交</strong><small>保存只更新服务器草稿；提交后当前版本冻结并进入管理员/工艺审核。</small></span></div>
    </section>}

    {tab === 'data' && activeKind === 'PROCESS_TIME' && <section className="sample-focus-content sample-process-editor">
      <div className="sample-focus-hint"><Clock3 /><span>填写实测工时，计时口径统一为<strong>秒/件</strong>。未匹配名称只保存为候选工序。</span></div>
      <div className="sample-process-rows">
        {processRows.map((row, index) => {
          const matches = matchingProcesses(row.processName);
          const exact = processes.some(process => process.name.trim().toLocaleLowerCase('zh-CN') === row.processName.trim().toLocaleLowerCase('zh-CN'));
          const proposed = Boolean(row.processName.trim() && !row.processDefinitionId && !exact);
          return <div className={`sample-process-row ${processErrors[row.rowId] ? 'invalid' : ''}`} data-row-id={row.rowId} key={row.rowId}>
            <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="sample-process-combobox">
              <input id={`process-name-${row.rowId}`} role="combobox" aria-autocomplete="list" aria-expanded={openComboboxRow === row.rowId} aria-controls={`process-options-${row.rowId}`} aria-label={`第 ${index + 1} 行工序`} disabled={readOnly} value={row.processName} placeholder="选择或输入工序"
                onFocus={() => { setOpenComboboxRow(row.rowId); setComboboxIndex(0); setLastActiveRow(current => ({ ...current, PROCESS_TIME: row.rowId })); }}
                onBlur={() => window.setTimeout(() => setOpenComboboxRow(current => current === row.rowId ? '' : current), 160)} onKeyDown={event => handleProcessKeyDown(event, row)}
                onChange={event => { const name = event.target.value; const official = processes.find(process => process.name.trim().toLocaleLowerCase('zh-CN') === name.trim().toLocaleLowerCase('zh-CN')); updateProcessRow(row.rowId, { processName: name, processDefinitionId: official?.id || '', source: official ? 'OFFICIAL' : 'PROPOSED' }); setOpenComboboxRow(row.rowId); setComboboxIndex(0); }} />
              <ChevronDown aria-hidden="true" />
              {openComboboxRow === row.rowId && <div className="sample-process-options" id={`process-options-${row.rowId}`} role="listbox">
                {matches.map((process, optionIndex) => <button className={comboboxIndex === optionIndex ? 'active' : ''} type="button" role="option" aria-selected={row.processDefinitionId === process.id} key={process.id} onMouseDown={event => event.preventDefault()} onClick={() => chooseProcess(row, process)}><span>{process.name}</span><small>{process.code || '正式工序'}</small></button>)}
                {proposed && <button className={`proposed ${comboboxIndex === matches.length ? 'active' : ''}`} type="button" role="option" aria-selected={false} onMouseDown={event => event.preventDefault()} onClick={() => chooseProcess(row, null)}><Plus /><span>将“{row.processName.trim()}”保存为候选工序</span></button>}
                {!matches.length && !proposed && <p>输入工序名称开始搜索</p>}
              </div>}
              {proposed && <em>待工艺确认</em>}
            </div>
            <label className="sample-time-input"><span className="sr-only">第 {index + 1} 行实测工时</span><input inputMode="decimal" aria-label={`第 ${index + 1} 行实测工时，秒每件`} disabled={readOnly} value={row.seconds} placeholder="0.0" onFocus={() => setLastActiveRow(current => ({ ...current, PROCESS_TIME: row.rowId }))} onChange={event => updateProcessRow(row.rowId, { seconds: event.target.value })} /><i>秒/件</i></label>
            <button className="sample-row-delete" type="button" aria-label={`删除第 ${index + 1} 行`} disabled={readOnly} onClick={() => removeProcessRow(row.rowId)}><Trash2 /></button>
            {processErrors[row.rowId] && <p className="sample-row-error" role="alert">{processErrors[row.rowId]}</p>}
          </div>;
        })}
      </div>
      <button className="sample-add-row" type="button" disabled={readOnly || processRows.length >= SAMPLE_SECTION_MAX_ROWS} onClick={addProcessRow}><Plus />添加一行</button>
    </section>}

    {tab === 'data' && activeKind === 'STRIPPING' && <section className="sample-focus-content sample-stripping-editor">
      <div className="sample-focus-hint"><ListChecks /><span>尺寸单位统一为 <strong>mm</strong>；型号与至少一个尺寸组成一条有效记录。</span></div>
      <div className="sample-stripping-rows">
        {strippingRows.map((row, index) => <article className={strippingErrors[row.rowId] ? 'invalid' : ''} data-row-id={row.rowId} key={row.rowId}>
          <header><span>第 {String(index + 1).padStart(2, '0')} 组</span><button type="button" aria-label={`删除第 ${index + 1} 组剥皮参数`} disabled={readOnly} onClick={() => removeStrippingRow(row.rowId)}><Trash2 /></button></header>
          <label><span>型号</span><input id={`stripping-model-${row.rowId}`} disabled={readOnly} value={row.model} placeholder="例如 T25BF2-80300" onFocus={() => setLastActiveRow(current => ({ ...current, STRIPPING: row.rowId }))} onChange={event => updateStrippingRow(row.rowId, { model: event.target.value })} /></label>
          <div className="sample-stripping-dimensions">
            <label><span>外剥（mm）</span><input inputMode="decimal" disabled={readOnly} value={row.outerPeelMm} placeholder="0" onChange={event => updateStrippingRow(row.rowId, { outerPeelMm: event.target.value })} /></label>
            <label><span>内剥（mm）</span><input inputMode="decimal" disabled={readOnly} value={row.innerPeelMm} placeholder="0" onChange={event => updateStrippingRow(row.rowId, { innerPeelMm: event.target.value })} /></label>
            <label><span>入长（mm）</span><input inputMode="decimal" disabled={readOnly} value={row.insertionLengthMm} placeholder="0" onChange={event => updateStrippingRow(row.rowId, { insertionLengthMm: event.target.value })} /></label>
          </div>
          {(row.positionLabel || row.remark) && <small>历史扩展信息已保留，审核端仍可查看。</small>}
          {strippingErrors[row.rowId] && <p className="sample-row-error" role="alert">{strippingErrors[row.rowId]}</p>}
        </article>)}
      </div>
      <button className="sample-add-row" type="button" disabled={readOnly || strippingRows.length >= SAMPLE_SECTION_MAX_ROWS} onClick={addStrippingRow}><Plus />添加一组参数</button>
    </section>}

    {tab === 'data' && !activeSectionKind && <section className="sample-capture-card data-form sample-generic-focus-form">
      <header><div><span>{editingEntry ? '修改采集记录' : '新增一条数据'}</span><h2>{kindLabels[form.kind]}</h2></div>{editingEntry && <button type="button" onClick={() => { setEditingEntry(null); setForm({ ...emptyDataForm, kind: form.kind }); }}>取消修改</button>}</header>
      <label><span>记录名称</span><input disabled={readOnly} value={form.label} onChange={event => setForm(current => ({ ...current, label: event.target.value }))} placeholder="可留空，例如：端子辅料、首件注意事项" /></label>
      {form.kind === 'MATERIAL' && <div className="sample-mobile-fields">
        <div className="two"><label><span>辅料名称</span><input disabled={readOnly} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="例如热缩管" /></label><label><span>型号/规格</span><input disabled={readOnly} value={form.specification} onChange={event => setForm(current => ({ ...current, specification: event.target.value }))} /></label></div>
        <div className="three"><label><span>长度</span><input inputMode="decimal" disabled={readOnly} value={form.length} onChange={event => setForm(current => ({ ...current, length: event.target.value }))} /></label><label><span>数量</span><input inputMode="decimal" disabled={readOnly} value={form.quantity} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label><span>单位</span><input disabled={readOnly} value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} placeholder="件/mm" /></label></div>
        <div className="two"><label><span>公差</span><input disabled={readOnly} value={form.tolerance} onChange={event => setForm(current => ({ ...current, tolerance: event.target.value }))} /></label><label><span>使用位置</span><input disabled={readOnly} value={form.position} onChange={event => setForm(current => ({ ...current, position: event.target.value }))} /></label></div>
      </div>}
      {form.kind === 'NOTICE' && <div className="sample-mobile-fields">
        <div className="two"><label><span>事项分类</span><input disabled={readOnly} value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} placeholder="工艺/质量" /></label><label><span>提示等级</span><input disabled={readOnly} value={form.severity} onChange={event => setForm(current => ({ ...current, severity: event.target.value }))} /></label></div>
        <label><span>注意事项内容</span><textarea disabled={readOnly} value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} /></label>
        <label><span>适用工序</span><input disabled={readOnly} value={form.processName} onChange={event => setForm(current => ({ ...current, processName: event.target.value }))} /></label>
      </div>}
      {form.kind === 'CUSTOM' && <div className="sample-mobile-fields"><div className="two"><label><span>记录值</span><input disabled={readOnly} value={form.value} onChange={event => setForm(current => ({ ...current, value: event.target.value }))} /></label><label><span>单位</span><input disabled={readOnly} value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} /></label></div></div>}
      <label><span>补充备注</span><textarea disabled={readOnly} value={form.remark} onChange={event => setForm(current => ({ ...current, remark: event.target.value }))} /></label>
      <p className="sample-field-optional-hint">可以只保存文字，也可以前往照片分区补充图片证据。</p>
    </section>}

    {tab === 'photos' && <section className="sample-photo-focus">
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={event => void choosePhotos(event.target.files, 'CAMERA')} />
      <input ref={albumInputRef} type="file" accept="image/*" multiple onChange={event => void choosePhotos(event.target.files, 'ALBUM')} />
      <div className="sample-photo-actions">
        <button className="camera" type="button" disabled={readOnly || photoPreparing} onClick={() => cameraInputRef.current?.click()}><Camera />拍照</button>
        <button type="button" disabled={readOnly || photoPreparing} onClick={() => albumInputRef.current?.click()}><Images />从相册选择</button>
      </div>
      <div className="sample-photo-statuses" aria-label="照片状态统计">
        <span>本机待传 <strong>{photoQueue.filter(item => item.status === 'LOCAL').length}</strong></span>
        <span>上传中 <strong>{photoQueue.filter(item => item.status === 'UPLOADING').length}</strong></span>
        <span>草稿已存 <strong>{task.photos.filter(item => item.reviewStatus === 'DRAFT' || item.reviewStatus === 'CHANGES_REQUESTED').length}</strong></span>
        <span className="failed">失败 <strong>{photoQueue.filter(item => item.status === 'FAILED').length}</strong></span>
      </div>
      {(photoQueue.length > 0 || selectedPhotos.size > 0) && <div className="sample-photo-queue-toolbar">
        <span>{selectedPhotos.size ? `已选择 ${selectedPhotos.size} 张` : `还有 ${photoQueue.length} 张未同步`}</span>
        <div>{selectedPhotos.size > 0 && <button className="danger" type="button" onClick={() => void deleteSelectedPhotos()}><Trash2 />批量删除</button>}<button type="button" disabled={!online || photoUploading || readOnly || !photoQueue.length} onClick={() => void uploadPhotoQueue()}>{photoUploading ? <Loader2 className="spin" /> : <UploadCloud />}上传全部</button></div>
      </div>}
      <div className="sample-photo-grid-v2">
        {photoQueue.map((item, index) => <article className={`local status-${item.status.toLowerCase()}`} key={item.id}>
          <label className="sample-photo-select"><input type="checkbox" aria-label={`选择照片 ${item.originalName}`} checked={selectedPhotos.has(`local:${item.id}`)} onChange={event => setSelectedPhotos(current => { const next = new Set(current); if (event.target.checked) next.add(`local:${item.id}`); else next.delete(`local:${item.id}`); return next; })} /><span /></label>
          <button className="sample-photo-image" type="button" aria-label={`预览 ${item.originalName}`} onClick={() => setPreviewIndex(index)}><Image unoptimized fill sizes="(max-width: 430px) 45vw, 190px" src={item.objectUrl} alt={item.caption || item.originalName} /></button>
          <div className="sample-photo-card-body">
            <header><strong>{item.caption || (item.source === 'CAMERA' ? '相机照片' : '相册照片')}</strong><em>{item.status === 'FAILED' ? '上传失败' : item.status === 'UPLOADING' ? `上传中 ${item.progress}%` : '本机待上传'}</em></header>
            <select aria-label="照片分类" disabled={readOnly || item.status === 'UPLOADING'} value={item.category} onChange={event => updateLocalPhoto(item.id, { category: event.target.value as SamplePhotoCategoryDTO })}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input aria-label="照片说明" disabled={readOnly || item.status === 'UPLOADING'} value={item.caption} placeholder="添加照片说明" onChange={event => updateLocalPhoto(item.id, { caption: event.target.value })} />
            {item.status === 'FAILED' && <p role="alert">{item.error}</p>}
          </div>
          <footer><button type="button" onClick={() => setPreviewIndex(index)}><Eye />预览</button>{item.status === 'FAILED' && <button type="button" disabled={!online || photoUploading} onClick={() => void uploadPhotoQueue(item.id)}><RotateCcw />重试</button>}<button type="button" disabled={item.status === 'UPLOADING'} onClick={() => removeLocalPhoto(item.id)}><Trash2 />删除</button></footer>
        </article>)}
        {task.photos.map((photo, serverIndex) => {
          const previewPosition = photoQueue.length + serverIndex;
          const editable = !readOnly && ['DRAFT', 'CHANGES_REQUESTED'].includes(photo.reviewStatus);
          return <article className={`server status-${photo.reviewStatus.toLowerCase()}`} key={photo.id}>
            {editable && <label className="sample-photo-select"><input type="checkbox" aria-label={`选择照片 ${photo.originalName}`} checked={selectedPhotos.has(`server:${photo.id}`)} onChange={event => setSelectedPhotos(current => { const next = new Set(current); if (event.target.checked) next.add(`server:${photo.id}`); else next.delete(`server:${photo.id}`); return next; })} /><span /></label>}
            <button className="sample-photo-image" type="button" aria-label={`预览 ${photo.caption || photo.originalName}`} onClick={() => setPreviewIndex(previewPosition)}><Image unoptimized fill sizes="(max-width: 430px) 45vw, 190px" src={photo.contentUrl} alt={photo.caption || photo.originalName} /></button>
            <div className="sample-photo-card-body"><header><strong>{photo.caption || photo.originalName}</strong><em>{reviewLabels[photo.reviewStatus]}</em></header><p>{photoCategoryLabels[photo.category]}</p>{photo.reviewComment && <p className="review-comment">审核意见：{photo.reviewComment}</p>}</div>
            <footer><button type="button" onClick={() => setPreviewIndex(previewPosition)}><Eye />预览</button>{editable && <button type="button" onClick={() => setPhotoEditor({ id: photo.id, category: photo.category, caption: photo.caption || '', linkedEntryId: photo.linkedEntryId || '', captureSource: photo.captureSource || 'ALBUM', sortOrder: serverIndex, version: photo.version })}><Pencil />编辑</button>}{editable && <button type="button" onClick={() => void deleteServerPhoto(photo)}><Trash2 />删除</button>}</footer>
          </article>;
        })}
        {!photoQueue.length && !task.photos.length && <div className="sample-photo-empty"><ImageIcon /><strong>还没有样品照片</strong><span>可以拍照，也可以一次从相册选择多张。</span></div>}
      </div>
    </section>}

    {tab === 'records' && <section className="sample-capture-records sample-records-v2">
      <header><div><span>本次已采集</span><h2>{task.entries.length} 条数据 · {task.photos.length} 张照片</h2></div><button type="button" onClick={() => setTab('overview')}><ArrowLeft />采集首页</button></header>
      <div className="sample-mobile-record-list">
        {task.entries.map(entry => <article className={`status-${entry.reviewStatus.toLowerCase()}`} key={entry.id}>
          <div className="record-icon"><FileText /></div><div><header><strong>{kindLabels[entry.kind]}</strong><em>{reviewLabels[entry.reviewStatus]}</em></header><p>{entry.label || '未命名记录'}</p>{entry.reviewComment && <span>审核意见：{entry.reviewComment}</span>}</div>
          {!readOnly && !['PUBLISHED', 'VOIDED'].includes(entry.reviewStatus) && <footer><button type="button" onClick={() => editEntry(entry)}>修改</button><button className="danger" type="button" onClick={() => void deleteEntry(entry)}><Trash2 />删除</button></footer>}
        </article>)}
        {task.photos.map((photo, index) => <article className={`photo status-${photo.reviewStatus.toLowerCase()}`} key={photo.id}>
          <button className="record-photo-preview" type="button" onClick={() => { setTab('photos'); setPreviewIndex(photoQueue.length + index); }}><Image unoptimized fill sizes="84px" src={photo.contentUrl} alt={photo.caption || photo.originalName} /></button><div><header><strong>{photoCategoryLabels[photo.category]}</strong><em>{reviewLabels[photo.reviewStatus]}</em></header><p>{photo.caption || photo.originalName}</p>{photo.reviewComment && <span>审核意见：{photo.reviewComment}</span>}</div>
        </article>)}
        {!task.entries.length && !task.photos.length && <div className="sample-mobile-empty"><Plus /><strong>本次还没有服务器记录</strong><p>先在各分区保存草稿，再统一提交审核。</p></div>}
      </div>
      {submitted && <button className="sample-record-withdraw" type="button" disabled={withdrawing} onClick={() => void withdrawSubmission()}>{withdrawing ? <Loader2 className="spin" /> : <RotateCcw />}撤回提交并继续编辑</button>}
    </section>}

    {tab === 'data' && activeSectionKind && renderSubmitFooter(activeSectionKind)}
    {tab === 'data' && !activeSectionKind && renderSubmitFooter()}
    {tab === 'photos' && <footer className="sample-focus-submitbar sample-photo-submitbar"><div><CloudOff /><span>{photoQueue.length ? `还有 ${photoQueue.length} 张照片未同步` : '全部照片已同步'}</span></div><button className="secondary" type="button" disabled={readOnly || photoPreparing} onClick={() => setMessage('照片队列已保存在本机；上传成功后会同步到服务器草稿')}><Save />保存草稿</button><button className="primary" type="button" disabled={!canSubmit} onClick={() => void submitTask()}><Send />提交审核</button></footer>}

    {photoEditor && <div className="sample-photo-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPhotoEditor(null); }}>
      <section className="sample-photo-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-photo-editor-title">
        <header><h2 id="sample-photo-editor-title">编辑照片信息</h2><button type="button" aria-label="关闭" onClick={() => setPhotoEditor(null)}><X /></button></header>
        <label><span>照片分类</span><select value={photoEditor.category} onChange={event => setPhotoEditor(current => current ? { ...current, category: event.target.value as SamplePhotoCategoryDTO } : current)}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>照片说明</span><textarea value={photoEditor.caption} onChange={event => setPhotoEditor(current => current ? { ...current, caption: event.target.value } : current)} /></label>
        <label><span>关联记录</span><select value={photoEditor.linkedEntryId} onChange={event => setPhotoEditor(current => current ? { ...current, linkedEntryId: event.target.value } : current)}><option value="">不关联具体记录</option>{task.entries.map(entry => <option key={entry.id} value={entry.id}>{kindLabels[entry.kind]} · {entry.label || '未命名记录'}</option>)}</select></label>
        <footer><button type="button" onClick={() => setPhotoEditor(null)}>取消</button><button className="primary" type="button" disabled={photoEditing} onClick={() => void savePhotoMetadata()}>{photoEditing ? <Loader2 className="spin" /> : <Save />}保存修改</button></footer>
      </section>
    </div>}

    {previewIndex !== null && previewItems[previewIndex] && <div className="sample-photo-lightbox" role="dialog" aria-modal="true" aria-label="照片预览">
      <header><span>{previewIndex + 1} / {previewItems.length}</span><button type="button" aria-label="关闭预览" onClick={() => setPreviewIndex(null)}><X /></button></header>
      <div><Image unoptimized fill sizes="100vw" src={previewItems[previewIndex].src} alt={previewItems[previewIndex].alt} /></div>
      <footer><button type="button" aria-label="上一张" disabled={previewIndex === 0} onClick={() => setPreviewIndex(index => index === null ? null : Math.max(0, index - 1))}><ChevronLeft /></button><p>{previewItems[previewIndex].alt}</p><button type="button" aria-label="下一张" disabled={previewIndex === previewItems.length - 1} onClick={() => setPreviewIndex(index => index === null ? null : Math.min(previewItems.length - 1, index + 1))}><ChevronRight /></button></footer>
    </div>}

    {message && <div className="sample-mobile-toast" role="status" aria-live="polite">{message}</div>}
  </main>;
}
