'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  CloudOff,
  Database,
  FileText,
  Image as ImageIcon,
  Images,
  ListChecks,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCapturedImage } from '@/lib/image-client';
import type {
  CurrentUserDTO,
  SampleDataEntryDTO,
  SampleDataKindDTO,
  SamplePhotoCategoryDTO,
  SampleTaskDTO,
} from '@/types';

type CaptureTab = 'overview' | 'data' | 'photos' | 'records';
type ProcessOption = { id: string; name: string; code: string };
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
  kind: 'PROCESS_TIME',
  label: '',
  processDefinitionId: '',
  processName: '',
  measurements: '',
  recommendedSeconds: '',
  setupSeconds: '',
  occurrences: '',
  timeBasis: 'per_unit',
  unitLabel: '件',
  model: '',
  outerPeelMm: '',
  innerPeelMm: '',
  insertionLengthMm: '',
  positionLabel: '',
  name: '',
  specification: '',
  length: '',
  quantity: '',
  unit: '',
  tolerance: '',
  position: '',
  category: '',
  severity: '',
  content: '',
  value: '',
  remark: '',
};

const kindLabels: Record<SampleDataKindDTO, string> = {
  PROCESS_TIME: '工序与工时',
  STRIPPING: '剥皮参数',
  MATERIAL: '辅料数据',
  NOTICE: '注意事项',
  CUSTOM: '自定义记录',
};

const photoCategoryLabels: Record<SamplePhotoCategoryDTO, string> = {
  UNCLASSIFIED: '稍后分类',
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

const captureCategories = [
  { key: 'process-time', title: '工序与工时', description: '实测、建议工时、准备时间', kind: 'PROCESS_TIME' as const, photo: null, icon: Clock3 },
  { key: 'stripping', title: '剥皮参数', description: '支持手写录入与照片', kind: 'STRIPPING' as const, photo: null, icon: ListChecks },
  { key: 'material', title: '辅料', description: '名称、规格、用量或照片', kind: 'MATERIAL' as const, photo: null, icon: Database },
  { key: 'notice', title: '注意事项', description: '工艺提示、质量风险', kind: 'NOTICE' as const, photo: null, icon: AlertTriangle },
  { key: 'semi-finished', title: '半成品照片', description: '拍照后进入产品资料库', kind: null, photo: 'SEMI_FINISHED' as const, icon: Images },
  { key: 'finished', title: '成品照片', description: '记录最终样品外观', kind: null, photo: 'FINISHED' as const, icon: PackageCheck },
] as const;

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

const PHOTO_DB = 'hongmeng-sample-capture';
const PHOTO_STORE = 'pending-photos';

function openPhotoDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) request.result.createObjectStore(PHOTO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writePendingPhoto(key: string, value: Record<string, unknown> | null) {
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

async function readPendingPhoto(key: string): Promise<Record<string, any> | null> {
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

const reviewLabels: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  CHANGES_REQUESTED: '待修改',
  APPROVED: '已通过',
  PUBLISHED: '已发布',
  VOIDED: '已作废',
};

function nonEmptyPayload(form: DataForm): Record<string, unknown> {
  if (form.kind === 'PROCESS_TIME') {
    return {
      processDefinitionId: form.processDefinitionId,
      processName: form.processName,
      measurements: form.measurements.split(/[，,\s]+/).map(value => value.trim()).filter(Boolean).map(value => ({ value })),
      recommendedSeconds: form.recommendedSeconds,
      setupSeconds: form.setupSeconds,
      occurrences: form.occurrences,
      timeBasis: form.timeBasis,
      unitLabel: form.unitLabel,
      remark: form.remark,
    };
  }
  if (form.kind === 'STRIPPING') {
    return {
      model: form.model,
      outerPeelMm: form.outerPeelMm,
      innerPeelMm: form.innerPeelMm,
      insertionLengthMm: form.insertionLengthMm,
      positionLabel: form.positionLabel,
      remark: form.remark,
    };
  }
  if (form.kind === 'MATERIAL') {
    return {
      name: form.name,
      specification: form.specification,
      length: form.length,
      quantity: form.quantity,
      unit: form.unit,
      tolerance: form.tolerance,
      position: form.position,
      remark: form.remark,
    };
  }
  if (form.kind === 'NOTICE') {
    return {
      category: form.category,
      severity: form.severity,
      content: form.content,
      processName: form.processName,
      remark: form.remark,
    };
  }
  return { value: form.value, unit: form.unit, remark: form.remark };
}

function formFromEntry(entry: SampleDataEntryDTO): DataForm {
  const payload = entry.payload;
  const measurements = Array.isArray(payload.measurements)
    ? payload.measurements.map(item => item && typeof item === 'object' && !Array.isArray(item) ? String((item as Record<string, unknown>).value || '') : String(item || '')).filter(Boolean).join(', ')
    : '';
  const text = (key: keyof DataForm) => String(payload[key] ?? '');
  return {
    ...emptyDataForm,
    kind: entry.kind,
    label: entry.label || '',
    processDefinitionId: text('processDefinitionId'),
    processName: text('processName'),
    measurements,
    recommendedSeconds: text('recommendedSeconds'),
    setupSeconds: text('setupSeconds'),
    occurrences: text('occurrences'),
    timeBasis: text('timeBasis') || 'per_unit',
    unitLabel: text('unitLabel') || '件',
    model: text('model'),
    outerPeelMm: text('outerPeelMm'),
    innerPeelMm: text('innerPeelMm'),
    insertionLengthMm: text('insertionLengthMm'),
    positionLabel: text('positionLabel'),
    name: text('name'),
    specification: text('specification'),
    length: text('length'),
    quantity: text('quantity'),
    unit: text('unit'),
    tolerance: text('tolerance'),
    position: text('position'),
    category: text('category'),
    severity: text('severity'),
    content: text('content'),
    value: text('value'),
    remark: text('remark'),
  };
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

export default function SampleCaptureMobile({ code, user }: { code: string; user: CurrentUserDTO }) {
  const [task, setTask] = useState<SampleTaskDTO | null>(null);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<CaptureTab>('overview');
  const [form, setForm] = useState<DataForm>(emptyDataForm);
  const [editingEntry, setEditingEntry] = useState<SampleDataEntryDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCategory, setPhotoCategory] = useState<SamplePhotoCategoryDTO>('UNCLASSIFIED');
  const [photoCaption, setPhotoCaption] = useState('');
  const [linkedEntryId, setLinkedEntryId] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(true);
  const [entryMutationId, setEntryMutationId] = useState(newMutationId);
  const [photoMutationId, setPhotoMutationId] = useState(newMutationId);
  const [submissionMutationId, setSubmissionMutationId] = useState(newMutationId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftHydrated = useRef(false);
  const draftKey = `sample-capture:${code}:draft`;
  const photoQueueKey = `sample-capture:${code}:photo`;
  const submissionMutationKey = `sample-capture:${code}:submission-mutation`;

  const readOnly = task?.status === 'COMPLETED' || task?.status === 'CANCELLED';
  const pendingChanges = useMemo(() => [
    ...(task?.entries.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
    ...(task?.photos.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
  ], [task]);
  const formHasData = useMemo(() => hasMeaningfulForm(form), [form]);
  const syncedCount = (task?.entries.length || 0) + (task?.photos.length || 0);
  const collectedKinds = useMemo(() => new Set([
    ...(task?.entries.map(item => item.kind) || []),
    ...(task?.photos.map(item => item.category) || []),
  ]), [task]);

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
      setTask(taskBody.task as SampleTaskDTO);
      if (contextResponse.ok) setProcesses(Array.isArray(contextBody.processes) ? contextBody.processes : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '样品任务读取失败');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { form?: DataForm; entryMutationId?: string };
        if (parsed.form) setForm({ ...emptyDataForm, ...parsed.form });
        if (parsed.entryMutationId) setEntryMutationId(parsed.entryMutationId);
      }
    } catch {
      setMessage('本机文字草稿读取失败，可继续重新录入');
    }
    void readPendingPhoto(photoQueueKey).then(pending => {
      if (!pending) return;
      if (pending.file instanceof File) setPhotoFile(pending.file);
      if (typeof pending.category === 'string') setPhotoCategory(pending.category as SamplePhotoCategoryDTO);
      if (typeof pending.caption === 'string') setPhotoCaption(pending.caption);
      if (typeof pending.linkedEntryId === 'string') setLinkedEntryId(pending.linkedEntryId);
      if (typeof pending.mutationId === 'string') setPhotoMutationId(pending.mutationId);
    }).catch(() => setMessage('本机照片队列读取失败，请重新选择照片'));
    window.setTimeout(() => { draftHydrated.current = true; }, 0);
  }, [draftKey, photoQueueKey]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(submissionMutationKey);
    if (stored) setSubmissionMutationId(stored);
    else window.sessionStorage.setItem(submissionMutationKey, submissionMutationId);
  }, [submissionMutationId, submissionMutationKey]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    if (hasMeaningfulForm(form)) {
      window.localStorage.setItem(draftKey, JSON.stringify({ form, entryMutationId, savedAt: new Date().toISOString() }));
    } else {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, entryMutationId, form]);

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!formHasData && !photoFile) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [formHasData, photoFile]);

  useEffect(() => {
    if (!photoFile) return;
    void writePendingPhoto(photoQueueKey, {
      file: photoFile,
      category: photoCategory,
      caption: photoCaption,
      linkedEntryId,
      mutationId: photoMutationId,
    }).catch(() => setMessage('照片队列保存失败，请保持页面打开后重试'));
  }, [linkedEntryId, photoCaption, photoCategory, photoFile, photoMutationId, photoQueueKey]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  function changeKind(kind: SampleDataKindDTO) {
    setEditingEntry(null);
    setForm({ ...emptyDataForm, kind });
  }

  async function openCategory(category: typeof captureCategories[number]) {
    if (category.kind) {
      if (formHasData && category.kind !== form.kind) {
        if (!online) {
          setMessage('当前离线，本机草稿尚未同步；请先保留在当前分类');
          return;
        }
        try {
          await saveEntry({ stay: true });
        } catch {
          return;
        }
      }
      changeKind(category.kind);
      setTab('data');
    } else if (category.photo) {
      setPhotoCategory(category.photo);
      setTab('photos');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveEntry(options: { stay?: boolean; taskSnapshot?: SampleTaskDTO } = {}) {
    const activeTask = options.taskSnapshot || task;
    if (!activeTask || readOnly || (!editingEntry && !hasMeaningfulForm(form))) return activeTask;
    setSaving(true);
    try {
      const process = processes.find(item => item.id === form.processDefinitionId);
      const nextForm = process ? { ...form, processName: process.name } : form;
      const response = await fetch(editingEntry ? `/api/sample-entries/${editingEntry.id}` : `/api/sample-tasks/${activeTask.id}/entries`, {
        method: editingEntry ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: nextForm.kind,
          label: nextForm.label,
          payload: nonEmptyPayload(nextForm),
          ...(!editingEntry ? { clientMutationId: entryMutationId } : {}),
          ...(editingEntry ? { expectedVersion: editingEntry.version } : {}),
        }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '数据保存失败');
      const nextTask = body.task as SampleTaskDTO;
      setTask(nextTask);
      setForm({ ...emptyDataForm, kind: form.kind });
      window.localStorage.removeItem(draftKey);
      setEntryMutationId(newMutationId());
      setEditingEntry(null);
      setMessage(editingEntry ? '记录已更新为采集草稿' : '记录已保存并同步');
      if (!options.stay) setTab('overview');
      return nextTask;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '数据保存失败');
      if (options.stay) throw reason;
      return activeTask;
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: SampleDataEntryDTO) {
    if (!task || !window.confirm('删除这条样品采集记录？已发布记录不能删除。')) return;
    try {
      const response = await fetch(`/api/sample-entries/${entry.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: entry.version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '删除失败');
      setTask(body.task as SampleTaskDTO);
      setMessage('记录已删除，历史文件未产生');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '删除失败');
    }
  }

  function editEntry(entry: SampleDataEntryDTO) {
    setEditingEntry(entry);
    setForm(formFromEntry(entry));
    setTab('data');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function choosePhoto(file: File | null) {
    if (!file) return;
    setPhotoPreparing(true);
    try {
      const normalized = await normalizeCapturedImage(file);
      const mutationId = newMutationId();
      setPhotoFile(normalized);
      setPhotoMutationId(mutationId);
      await writePendingPhoto(photoQueueKey, {
        file: normalized,
        category: photoCategory,
        caption: photoCaption,
        linkedEntryId,
        mutationId,
      });
      setMessage(online ? '照片已进入待上传队列' : '当前离线，照片已安全保存在本机队列');
    } catch {
      setMessage('照片处理失败，请重新选择');
    } finally {
      setPhotoPreparing(false);
    }
  }

  async function uploadPhoto(options: { stay?: boolean; taskSnapshot?: SampleTaskDTO } = {}) {
    const activeTask = options.taskSnapshot || task;
    if (!activeTask || !photoFile || readOnly) return activeTask;
    if (!online) throw new Error('当前网络不可用，照片仍保留在本机待上传队列');
    setPhotoUploading(true);
    try {
      const data = new FormData();
      data.set('file', photoFile);
      data.set('category', photoCategory);
      data.set('caption', photoCaption);
      data.set('captureSource', 'CAMERA_OR_UPLOAD');
      data.set('clientMutationId', photoMutationId);
      if (linkedEntryId) data.set('linkedEntryId', linkedEntryId);
      const response = await fetch(`/api/sample-tasks/${activeTask.id}/photos`, { method: 'POST', body: data });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片上传失败');
      const nextTask = body.task as SampleTaskDTO;
      setTask(nextTask);
      setPhotoFile(null);
      setPhotoCaption('');
      setLinkedEntryId('');
      setPhotoCategory('UNCLASSIFIED');
      setPhotoMutationId(newMutationId());
      await writePendingPhoto(photoQueueKey, null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage('照片已上传到对象存储');
      if (!options.stay) setTab('overview');
      return nextTask;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片上传失败');
      if (options.stay) throw reason;
      return activeTask;
    } finally {
      setPhotoUploading(false);
    }
  }

  async function deletePhoto(photoId: string, version: number) {
    if (!task || !window.confirm('移除这张照片？对象存储中的原文件会按软删除规则保留。')) return;
    try {
      const response = await fetch(`/api/sample-photos/${photoId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片删除失败');
      setTask(body.task as SampleTaskDTO);
      setMessage('照片已移出本次采集，原文件按软删除规则保留');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片删除失败');
    }
  }

  async function submitTask() {
    if (!task || readOnly) return;
    if (!online && (formHasData || photoFile)) {
      setMessage('当前离线：草稿已保存在本机，联网后再提交即可');
      return;
    }
    if (!task.entries.length && !task.photos.length && !formHasData && !photoFile && !window.confirm('本次没有采集任何数据或照片，仍然提交审核吗？所有分类均为选填，无需填写原因。')) return;
    setSubmitting(true);
    try {
      let currentTask = task;
      if (formHasData) currentTask = await saveEntry({ stay: true, taskSnapshot: currentTask }) || currentTask;
      if (photoFile) currentTask = await uploadPhoto({ stay: true, taskSnapshot: currentTask }) || currentTask;
      const response = await fetch(`/api/sample-tasks/${currentTask.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: currentTask.version, clientMutationId: submissionMutationId }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '提交失败');
      setTask(body.task as SampleTaskDTO);
      const nextSubmissionMutationId = newMutationId();
      setSubmissionMutationId(nextSubmissionMutationId);
      window.sessionStorage.setItem(submissionMutationKey, nextSubmissionMutationId);
      setMessage('本次记录已全部同步并提交审核');
      setTab('records');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !task) return <main className="sample-capture-loading"><Loader2 className="spin" /><strong>正在读取样品二维码</strong><span>加载任务和已采集记录…</span></main>;
  if (!task) return <main className="sample-capture-failure"><AlertTriangle /><strong>无法打开样品任务</strong><p>{error || '二维码无效或任务不存在'}</p><button type="button" onClick={() => void load()}><RefreshCw size={16} />重新读取</button></main>;

  return <main className={`sample-capture-page v13485 ${tab === 'overview' ? 'overview' : ''}`}>
    <header className="sample-capture-header">
      <Link href="/production?branch=samples" aria-label="返回样品执行"><ArrowLeft /></Link>
      <div><span>样品数据采集</span><strong>{task.code}</strong></div>
      <button type="button" aria-label="刷新" onClick={() => void load()}><RefreshCw size={18} /></button>
    </header>

    <section className="sample-capture-identity">
      <div><span style={{ background: task.customerLevelColor || '#e11d48' }}>{task.customerLevelLabel || task.customerLevelCode || '未分级'}</span><em>{collectedKinds.size ? `已采集 ${collectedKinds.size} 类` : taskStatusText(task)}</em></div>
      <h1>{task.specification}</h1>
      <p>{task.customerName} · {task.productName || '未设置品名'}</p>
      <dl><div><dt>计划日期</dt><dd>{task.dueDate || '未设置'}</dd></div><div><dt>成员</dt><dd>{task.assignees.map(item => item.name).join('、') || '未指派'}</dd></div><div><dt>当前状态</dt><dd>{taskStatusText(task)}</dd></div></dl>
    </section>

    <section className="sample-sync-strip" aria-label="采集同步状态">
      <div><Database /><span>本机草稿</span><strong>{formHasData ? 1 : 0}</strong></div>
      <div><CloudOff /><span>待上传</span><strong>{photoFile ? 1 : 0}</strong></div>
      <div className={online ? 'online' : 'offline'}>{online ? <Cloud /> : <CloudOff />}<span>{online ? '已同步' : '离线'}</span><strong>{syncedCount}</strong></div>
    </section>

    {!!pendingChanges.length && <section className="sample-capture-guidance warning"><AlertTriangle size={18} /><span><strong>{pendingChanges.length} 项被退回修改</strong><small>修改意见为自由文本；可以修改后重新提交，也可以继续补充其他记录。</small></span></section>}

    {tab === 'overview' && <section className="sample-capture-overview">
      <header><div><span>选择采集内容</span><h2>每一项都可以跳过</h2></div><button type="button" onClick={() => setTab('records')}>查看记录 {syncedCount}<ChevronRight /></button></header>
      <div className="sample-category-grid">
        {captureCategories.map(category => {
          const count = category.kind
            ? task.entries.filter(item => item.kind === category.kind).length
            : task.photos.filter(item => item.category === category.photo).length;
          const Icon = category.icon;
          return <button className={count ? 'collected' : ''} type="button" key={category.key} onClick={() => void openCategory(category)}>
            <span className="sample-category-icon"><Icon /></span>
            <span><strong>{category.title}</strong><small>{category.description}</small></span>
            <em>{count ? `${count} 项` : '选填'}<ChevronRight /></em>
          </button>;
        })}
      </div>
      {photoFile && <div className="sample-upload-queue">
        <div><ImageIcon /><span><strong>待上传照片</strong><small>{photoFile.name}</small></span><em>{online ? '提交时自动上传' : '已存本机'}</em></div>
        <i><span /></i>
      </div>}
      <div className="sample-overview-actions">
        <button className="primary" type="button" disabled={readOnly} onClick={() => void openCategory(captureCategories[0])}><Plus />继续采集</button>
        <button className="secondary" type="button" disabled={submitting || readOnly} onClick={() => void submitTask()}>{submitting ? <><Loader2 className="spin" />正在同步</> : <><Send />提交本次记录</>}</button>
      </div>
      <div className="sample-optional-note"><CheckCircle2 /><span><strong>所有内容均为选填</strong><small>未采集任何内容也可提交；系统只审核实际提交的文字和照片。</small></span></div>
    </section>}

    {tab !== 'overview' && <nav className="sample-capture-tabs" aria-label="采集内容">
      <button type="button" onClick={() => setTab('overview')}><ArrowLeft size={17} />采集首页</button>
      <button className={tab === 'data' ? 'active' : ''} type="button" onClick={() => setTab('data')}><FileText size={17} />填数据</button>
      <button className={tab === 'photos' ? 'active' : ''} type="button" onClick={() => setTab('photos')}><Camera size={17} />拍照片</button>
      <button className={tab === 'records' ? 'active' : ''} type="button" onClick={() => setTab('records')}><CheckCircle2 size={17} />记录 <em>{syncedCount}</em></button>
    </nav>}

    {readOnly && <div className="sample-capture-readonly"><AlertTriangle size={17} />当前任务为{task.status === 'COMPLETED' ? '已完成' : '已取消'}，现有记录只读；需要继续采集请在样品执行中重新打开任务。</div>}

    {tab === 'data' && <section className="sample-capture-card data-form">
      <header><div><span>{editingEntry ? '修改采集记录' : '新增一条数据'}</span><h2>{kindLabels[form.kind]}</h2></div>{editingEntry && <button type="button" onClick={() => { setEditingEntry(null); setForm({ ...emptyDataForm, kind: form.kind }); }}>取消修改</button>}</header>
      <div className="sample-kind-grid">{(Object.keys(kindLabels) as SampleDataKindDTO[]).map(kind => <button className={form.kind === kind ? 'active' : ''} type="button" key={kind} onClick={() => changeKind(kind)}>{kindLabels[kind]}</button>)}</div>
      <label><span>记录名称</span><input value={form.label} onChange={event => setForm(current => ({ ...current, label: event.target.value }))} placeholder="可留空，例如：左端剥皮、裁线工序" /></label>

      {form.kind === 'PROCESS_TIME' && <div className="sample-mobile-fields">
        <label><span>工序</span><select value={form.processDefinitionId} onChange={event => { const process = processes.find(item => item.id === event.target.value); setForm(current => ({ ...current, processDefinitionId: event.target.value, processName: process?.name || '' })); }}><option value="">稍后由审核人员确认</option>{processes.map(process => <option key={process.id} value={process.id}>{process.name}</option>)}</select></label>
        <label><span>多次实测（秒）</span><input inputMode="decimal" value={form.measurements} onChange={event => setForm(current => ({ ...current, measurements: event.target.value }))} placeholder="可留空；例如 12.4, 12.8, 12.6" /></label>
        <div className="two"><label><span>建议采用值（秒）</span><input inputMode="decimal" value={form.recommendedSeconds} onChange={event => setForm(current => ({ ...current, recommendedSeconds: event.target.value }))} placeholder="可留空" /></label><label><span>准备时间（秒）</span><input inputMode="decimal" value={form.setupSeconds} onChange={event => setForm(current => ({ ...current, setupSeconds: event.target.value }))} placeholder="可留空" /></label></div>
        <div className="two"><label><span>发生次数</span><input inputMode="numeric" value={form.occurrences} onChange={event => setForm(current => ({ ...current, occurrences: event.target.value }))} placeholder="可留空" /></label><label><span>计时口径</span><select value={form.timeBasis} onChange={event => setForm(current => ({ ...current, timeBasis: event.target.value }))}><option value="per_unit">按件</option><option value="per_batch">按批</option></select></label></div>
      </div>}

      {form.kind === 'STRIPPING' && <div className="sample-mobile-fields">
        <label><span>连接器/端子型号</span><input value={form.model} onChange={event => setForm(current => ({ ...current, model: event.target.value }))} placeholder="可留空" /></label>
        <label><span>产品部位</span><input value={form.positionLabel} onChange={event => setForm(current => ({ ...current, positionLabel: event.target.value }))} placeholder="可留空，例如左端、1号孔位" /></label>
        <div className="three"><label><span>外剥皮 mm</span><input inputMode="decimal" value={form.outerPeelMm} onChange={event => setForm(current => ({ ...current, outerPeelMm: event.target.value }))} /></label><label><span>内剥皮 mm</span><input inputMode="decimal" value={form.innerPeelMm} onChange={event => setForm(current => ({ ...current, innerPeelMm: event.target.value }))} /></label><label><span>入长 mm</span><input inputMode="decimal" value={form.insertionLengthMm} onChange={event => setForm(current => ({ ...current, insertionLengthMm: event.target.value }))} /></label></div>
      </div>}

      {form.kind === 'MATERIAL' && <div className="sample-mobile-fields">
        <div className="two"><label><span>辅料名称</span><input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="可留空，例如波纹管" /></label><label><span>型号/规格</span><input value={form.specification} onChange={event => setForm(current => ({ ...current, specification: event.target.value }))} placeholder="可留空" /></label></div>
        <div className="three"><label><span>长度</span><input inputMode="decimal" value={form.length} onChange={event => setForm(current => ({ ...current, length: event.target.value }))} /></label><label><span>数量</span><input inputMode="decimal" value={form.quantity} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label><span>单位</span><input value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} placeholder="mm/件" /></label></div>
        <div className="two"><label><span>公差</span><input value={form.tolerance} onChange={event => setForm(current => ({ ...current, tolerance: event.target.value }))} placeholder="可留空" /></label><label><span>使用位置</span><input value={form.position} onChange={event => setForm(current => ({ ...current, position: event.target.value }))} placeholder="可留空" /></label></div>
      </div>}

      {form.kind === 'NOTICE' && <div className="sample-mobile-fields">
        <div className="two"><label><span>事项分类</span><input value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} placeholder="可留空，例如工艺/质量" /></label><label><span>提示等级</span><input value={form.severity} onChange={event => setForm(current => ({ ...current, severity: event.target.value }))} placeholder="可留空" /></label></div>
        <label><span>注意事项内容</span><textarea value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} placeholder="可留空" /></label>
        <label><span>适用工序</span><input value={form.processName} onChange={event => setForm(current => ({ ...current, processName: event.target.value }))} placeholder="可留空" /></label>
      </div>}

      {form.kind === 'CUSTOM' && <div className="sample-mobile-fields"><div className="two"><label><span>记录值</span><input value={form.value} onChange={event => setForm(current => ({ ...current, value: event.target.value }))} placeholder="可留空" /></label><label><span>单位</span><input value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} placeholder="可留空" /></label></div></div>}

      <label><span>补充备注</span><textarea value={form.remark} onChange={event => setForm(current => ({ ...current, remark: event.target.value }))} placeholder="可留空" /></label>
      <p className="sample-field-optional-hint">以上字段均可留空；不需要这类数据时直接返回即可。</p>
      <button className="sample-mobile-primary" type="button" disabled={saving || readOnly || (!editingEntry && !formHasData)} onClick={() => void saveEntry()}>{saving ? <><Loader2 className="spin" />同步中</> : <><Save />{editingEntry ? '保存修改' : '保存并同步'}</>}</button>
    </section>}

    {tab === 'photos' && <section className="sample-capture-card photo-form">
      <header><div><span>拍照与上传</span><h2>过程、成品或测量证据</h2></div></header>
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={event => void choosePhoto(event.target.files?.[0] || null)} />
      <button className="sample-photo-picker" type="button" disabled={readOnly || photoPreparing} onClick={() => fileInputRef.current?.click()}><Camera />{photoPreparing ? <span><strong>正在优化照片</strong><small>压缩后放入本机待上传队列…</small></span> : photoFile ? <span><strong>{photoFile.name}</strong><small>{(photoFile.size / 1024 / 1024).toFixed(2)} MB · 已安全保存到本机队列</small></span> : <span><strong>拍照或选择图片</strong><small>先保存在本机队列，上传后只进入对象存储</small></span>}</button>
      <label><span>照片分类</span><select value={photoCategory} onChange={event => setPhotoCategory(event.target.value as SamplePhotoCategoryDTO)}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>关联采集记录（选填）</span><select value={linkedEntryId} onChange={event => setLinkedEntryId(event.target.value)}><option value="">不关联具体记录</option>{task.entries.map(entry => <option key={entry.id} value={entry.id}>{kindLabels[entry.kind]} · {entry.label || '未命名记录'}</option>)}</select></label>
      <label><span>照片说明</span><textarea value={photoCaption} onChange={event => setPhotoCaption(event.target.value)} placeholder="可留空，审核时仍可重新分类" /></label>
      <p className="sample-field-optional-hint">分类、关联记录和说明均为选填；照片可单独提交。</p>
      <button className="sample-mobile-primary" type="button" disabled={!photoFile || photoUploading || readOnly || !online} onClick={() => void uploadPhoto()}>{photoUploading ? <><Loader2 className="spin" />上传中</> : online ? <><Cloud />上传到对象存储</> : <><CloudOff />离线等待联网</>}</button>
    </section>}

    {tab === 'records' && <section className="sample-capture-records">
      <header><div><span>本次已采集</span><h2>{task.entries.length} 条数据 · {task.photos.length} 张照片</h2></div><small>数量展示不代表完整度</small></header>
      <div className="sample-mobile-record-list">
        {task.entries.map(entry => <article className={`status-${entry.reviewStatus.toLowerCase()}`} key={entry.id}>
          <div className="record-icon"><FileText /></div><div><header><strong>{kindLabels[entry.kind]}</strong><em>{reviewLabels[entry.reviewStatus]}</em></header><p>{entry.label || '未命名记录'}</p>{entry.reviewComment && <span>审核意见：{entry.reviewComment}</span>}</div>
          {!readOnly && !['PUBLISHED', 'VOIDED'].includes(entry.reviewStatus) && <footer><button type="button" onClick={() => editEntry(entry)}>修改</button><button className="danger" type="button" onClick={() => void deleteEntry(entry)}><Trash2 size={14} />删除</button></footer>}
        </article>)}
        {task.photos.map((photo, photoIndex) => <article className={`photo status-${photo.reviewStatus.toLowerCase()}`} key={photo.id}>
          <a href={photo.contentUrl} target="_blank" rel="noreferrer"><Image unoptimized priority={photoIndex === 0} width={112} height={86} src={photo.contentUrl} alt={photo.caption || photo.originalName} /></a><div><header><strong>{photoCategoryLabels[photo.category]}</strong><em>{reviewLabels[photo.reviewStatus]}</em></header><p>{photo.caption || photo.originalName}</p>{photo.reviewComment && <span>审核意见：{photo.reviewComment}</span>}</div>
          {!readOnly && !['PUBLISHED', 'VOIDED'].includes(photo.reviewStatus) && <footer><button className="danger" type="button" onClick={() => void deletePhoto(photo.id, photo.version)}><Trash2 size={14} />删除</button></footer>}
        </article>)}
        {!task.entries.length && !task.photos.length && <div className="sample-mobile-empty"><Plus /><strong>本次还没有采集记录</strong><p>可以继续添加，也可以直接提交，不要求说明原因。</p></div>}
      </div>
    </section>}

    {tab !== 'overview' && <footer className="sample-capture-submitbar"><button className="back" type="button" onClick={() => setTab('overview')}><ArrowLeft />采集首页</button><div><span>{online ? '在线同步' : '离线草稿'}</span><strong>{user.employee?.name || user.displayName}</strong></div><button type="button" disabled={submitting || readOnly} onClick={() => void submitTask()}>{submitting ? <><Loader2 className="spin" />提交中</> : <><Send />提交审核</>}</button></footer>}
    {message && <div className="sample-mobile-toast" role="status">{message}</div>}
  </main>;
}
