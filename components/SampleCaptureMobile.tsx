'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CurrentUserDTO,
  SampleDataEntryDTO,
  SampleDataKindDTO,
  SamplePhotoCategoryDTO,
  SampleTaskDTO,
} from '@/types';

type CaptureTab = 'data' | 'photos' | 'records';
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
  PROCESS: '过程图',
  MEASUREMENT: '测量证据',
  FINISHED: '成品图',
  DETAIL: '细节图',
  EXCEPTION: '异常参考',
};

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
  const [tab, setTab] = useState<CaptureTab>('data');
  const [form, setForm] = useState<DataForm>(emptyDataForm);
  const [editingEntry, setEditingEntry] = useState<SampleDataEntryDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCategory, setPhotoCategory] = useState<SamplePhotoCategoryDTO>('UNCLASSIFIED');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readOnly = task?.status === 'COMPLETED' || task?.status === 'CANCELLED';
  const pendingChanges = useMemo(() => [
    ...(task?.entries.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
    ...(task?.photos.filter(item => item.reviewStatus === 'CHANGES_REQUESTED') || []),
  ], [task]);

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
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  function changeKind(kind: SampleDataKindDTO) {
    setEditingEntry(null);
    setForm({ ...emptyDataForm, kind });
  }

  async function saveEntry() {
    if (!task || readOnly) return;
    setSaving(true);
    try {
      const process = processes.find(item => item.id === form.processDefinitionId);
      const nextForm = process ? { ...form, processName: process.name } : form;
      const response = await fetch(editingEntry ? `/api/sample-entries/${editingEntry.id}` : `/api/sample-tasks/${task.id}/entries`, {
        method: editingEntry ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: nextForm.kind,
          label: nextForm.label,
          payload: nonEmptyPayload(nextForm),
          ...(editingEntry ? { expectedVersion: editingEntry.version } : {}),
        }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '数据保存失败');
      setTask(body.task as SampleTaskDTO);
      setForm({ ...emptyDataForm, kind: form.kind });
      setEditingEntry(null);
      setMessage(editingEntry ? '记录已更新为采集草稿' : '记录已保存');
      setTab('records');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '数据保存失败');
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

  async function uploadPhoto() {
    if (!task || !photoFile || readOnly) return;
    setPhotoUploading(true);
    try {
      const data = new FormData();
      data.set('file', photoFile);
      data.set('category', photoCategory);
      data.set('caption', photoCaption);
      data.set('captureSource', 'CAMERA_OR_UPLOAD');
      const response = await fetch(`/api/sample-tasks/${task.id}/photos`, { method: 'POST', body: data });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片上传失败');
      setTask(body.task as SampleTaskDTO);
      setPhotoFile(null);
      setPhotoCaption('');
      setPhotoCategory('UNCLASSIFIED');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage('照片已上传');
      setTab('records');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片上传失败');
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
    if (!task.entries.length && !task.photos.length && !window.confirm('本次没有采集任何数据或照片，仍然提交审核吗？无需填写原因。')) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: task.version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '提交失败');
      setTask(body.task as SampleTaskDTO);
      setMessage('本次已提交分项审核');
      setTab('records');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !task) return <main className="sample-capture-loading"><Loader2 className="spin" /><strong>正在读取样品二维码</strong><span>加载任务和已采集记录…</span></main>;
  if (!task) return <main className="sample-capture-failure"><AlertTriangle /><strong>无法打开样品任务</strong><p>{error || '二维码无效或任务不存在'}</p><button type="button" onClick={() => void load()}><RefreshCw size={16} />重新读取</button></main>;

  return <main className="sample-capture-page">
    <header className="sample-capture-header">
      <Link href="/production?branch=samples" aria-label="返回样品执行"><ArrowLeft /></Link>
      <div><span>样品数据采集</span><strong>{task.code}</strong></div>
      <button type="button" aria-label="刷新" onClick={() => void load()}><RefreshCw size={18} /></button>
    </header>

    <section className="sample-capture-identity">
      <div><span style={{ background: task.customerLevelColor || '#94a3b8' }}>{task.customerLevelLabel || task.customerLevelCode || '未分级'}</span><em>{taskStatusText(task)}</em></div>
      <h1>{task.specification}</h1>
      <p>{task.customerName} · {task.productName || '未设置品名'}</p>
      <dl><div><dt>计划日期</dt><dd>{task.dueDate || '未设置'}</dd></div><div><dt>成员</dt><dd>{task.assignees.map(item => item.name).join('、') || '未指派'}</dd></div><div><dt>已采集</dt><dd>{task.counts.data} 条 · {task.counts.photos} 图</dd></div></dl>
    </section>

    <section className="sample-capture-guidance"><CheckCircle2 size={18} /><span><strong>所有内容均为选填</strong><small>不填不算缺项，也无需选择或填写原因；系统只审核本次实际提交的内容。</small></span></section>
    {!!pendingChanges.length && <section className="sample-capture-guidance warning"><AlertTriangle size={18} /><span><strong>{pendingChanges.length} 项被退回修改</strong><small>修改意见为自由文本；可以修改后重新提交，也可以继续补充其他记录。</small></span></section>}

    <nav className="sample-capture-tabs" aria-label="采集内容">
      <button className={tab === 'data' ? 'active' : ''} type="button" onClick={() => setTab('data')}><FileText size={17} />填数据</button>
      <button className={tab === 'photos' ? 'active' : ''} type="button" onClick={() => setTab('photos')}><Camera size={17} />拍照片</button>
      <button className={tab === 'records' ? 'active' : ''} type="button" onClick={() => setTab('records')}><CheckCircle2 size={17} />本次记录 <em>{task.entries.length + task.photos.length}</em></button>
    </nav>

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
      <button className="sample-mobile-primary" type="button" disabled={saving || readOnly} onClick={() => void saveEntry()}>{saving ? <><Loader2 className="spin" />保存中</> : <><Save />{editingEntry ? '保存修改' : '保存这条记录'}</>}</button>
    </section>}

    {tab === 'photos' && <section className="sample-capture-card photo-form">
      <header><div><span>拍照与上传</span><h2>过程、成品或测量证据</h2></div></header>
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={event => setPhotoFile(event.target.files?.[0] || null)} />
      <button className="sample-photo-picker" type="button" disabled={readOnly} onClick={() => fileInputRef.current?.click()}><Camera />{photoFile ? <span><strong>{photoFile.name}</strong><small>{(photoFile.size / 1024 / 1024).toFixed(2)} MB</small></span> : <span><strong>拍照或选择图片</strong><small>照片上传到对象存储，不保存在应用服务器本地</small></span>}</button>
      <label><span>照片分类</span><select value={photoCategory} onChange={event => setPhotoCategory(event.target.value as SamplePhotoCategoryDTO)}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>照片说明</span><textarea value={photoCaption} onChange={event => setPhotoCaption(event.target.value)} placeholder="可留空，审核时仍可重新分类" /></label>
      <button className="sample-mobile-primary" type="button" disabled={!photoFile || photoUploading || readOnly} onClick={() => void uploadPhoto()}>{photoUploading ? <><Loader2 className="spin" />上传中</> : <><Camera />上传照片</>}</button>
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

    <footer className="sample-capture-submitbar"><div><span>当前账号</span><strong>{user.employee?.name || user.displayName}</strong></div><button type="button" disabled={submitting || readOnly} onClick={() => void submitTask()}>{submitting ? <><Loader2 className="spin" />提交中</> : <><Send />提交分项审核</>}</button></footer>
    {message && <div className="sample-mobile-toast" role="status">{message}</div>}
  </main>;
}
