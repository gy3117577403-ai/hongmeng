'use client';

import {
  AlertTriangle,
  Archive,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  PackageOpen,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MaterialLibraryCaptureSessionDTO,
  MaterialLibraryPhotoDTO,
  MaterialLibraryWarningStateDTO,
} from '@/lib/material-library-contract';
import type { CurrentUserDTO } from '@/types';

type MobileForm = {
  categoryId: string;
  supplierVariantId: string;
  manufacturerModel: string;
  specification: string;
  materialComposition: string;
  supplierName: string;
  supplierPartNumber: string;
  batchNumber: string;
  warningState: MaterialLibraryWarningStateDTO;
  warningNote: string;
  notes: string;
};

function formFromSession(session: MaterialLibraryCaptureSessionDTO): MobileForm {
  return {
    categoryId: session.categoryId,
    supplierVariantId: session.supplierVariantId || '',
    manufacturerModel: session.draftManufacturerModel || '',
    specification: session.draftSpecification || '',
    materialComposition: session.draftMaterialComposition || '',
    supplierName: session.draftSupplierName || '',
    supplierPartNumber: session.draftSupplierPartNumber || '',
    batchNumber: session.draftBatchNumber || '',
    warningState: session.draftWarningState,
    warningNote: session.draftWarningNote || '',
    notes: session.draftNotes || '',
  };
}

async function bodyJson(response: Response): Promise<Record<string, any>> {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

function warningLabel(value: MaterialLibraryWarningStateDTO) {
  if (value === 'DEFECT') return '不良';
  if (value === 'ATTENTION') return '关注';
  return '正常';
}

export default function MaterialLibraryMobileCapture({ code, user }: { code: string; user: CurrentUserDTO }) {
  const [session, setSession] = useState<MaterialLibraryCaptureSessionDTO | null>(null);
  const [form, setForm] = useState<MobileForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<MaterialLibraryPhotoDTO | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const active = session?.status === 'ACTIVE';
  const photoCount = session?.photos.length || 0;
  const userName = user.employee?.name || user.displayName || user.username;
  const sessionId = session?.id;
  const sessionStatus = session?.status;

  const connect = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const scanResponse = await fetch(`/api/material-library/scan/${encodeURIComponent(code)}`, { method: 'POST' });
      const scanBody = await bodyJson(scanResponse);
      if (!scanResponse.ok) throw new Error(scanBody.error || '二维码无效或已过期');
      const next = scanBody.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setForm(formFromSession(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '二维码读取失败');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void connect(); }, [connect]);

  useEffect(() => {
    if (!sessionId || sessionStatus !== 'ACTIVE') return undefined;
    const timer = window.setInterval(() => {
      void fetch(`/api/material-library/sessions/${sessionId}/heartbeat`, { method: 'POST' });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [sessionId, sessionStatus]);

  useEffect(() => {
    if (!sessionId || sessionStatus !== 'ACTIVE') return undefined;
    let cancelled = false;
    const synchronize = async () => {
      const response = await fetch(`/api/material-library/sessions/${sessionId}`, { cache: 'no-store' });
      const body = await bodyJson(response);
      if (cancelled || !response.ok || !body.session) return;
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      if (next.status !== 'ACTIVE') {
        setForm(formFromSession(next));
        setDirty(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (!dirty) {
        setForm(formFromSession(next));
      }
    };
    const timer = window.setInterval(() => { void synchronize(); }, 2_400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dirty, sessionId, sessionStatus]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const steps = useMemo(() => [
    { label: '扫码连接', done: Boolean(session) },
    { label: '拍照上传', done: photoCount > 0 },
    { label: '填写数据', done: !dirty && Boolean(session) },
    { label: '确认归档', done: session?.status === 'COMPLETED' },
  ], [dirty, photoCount, session]);

  function update<K extends keyof MobileForm>(key: K, value: MobileForm[K]) {
    setForm(current => current ? { ...current, [key]: value } : current);
    setDirty(true);
  }

  function selectVariant(supplierVariantId: string) {
    const variant = session?.item.supplierVariants.find(item => item.id === supplierVariantId);
    setForm(current => current ? {
      ...current,
      supplierVariantId,
      ...(variant ? {
        supplierName: variant.supplierName || '',
        manufacturerModel: variant.manufacturerModel || '',
        supplierPartNumber: variant.supplierPartNumber || '',
        specification: variant.specification || '',
        materialComposition: variant.materialComposition || '',
      } : {}),
    } : current);
    setDirty(true);
  }

  async function saveDraft(showMessage = true): Promise<MaterialLibraryCaptureSessionDTO | null> {
    if (!session || !form || session.status !== 'ACTIVE') return session;
    if (!dirty) return session;
    setSaving(true);
    try {
      const response = await fetch(`/api/material-library/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, expectedVersion: session.version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '数据保存失败');
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setForm(formFromSession(next));
      setDirty(false);
      if (showMessage) setMessage('检验数据已保存');
      return next;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '数据保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!session || session.status !== 'ACTIVE') return;
    setUploading(true);
    try {
      const data = new FormData();
      data.set('file', file);
      data.set('captureSource', 'MOBILE_CAMERA');
      const response = await fetch(`/api/material-library/sessions/${session.id}/photos`, { method: 'POST', body: data });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '照片上传失败');
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setMessage(`第 ${next.photos.length} 张照片已上传，电脑端已可预览`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '照片上传失败，请重试');
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  }

  async function removePhoto(photo: MaterialLibraryPhotoDTO) {
    if (!window.confirm('移除这张误拍照片？原文件会按软删除规则保留。')) return;
    const response = await fetch(`/api/material-library/photos/${photo.id}`, { method: 'DELETE' });
    const body = await bodyJson(response);
    if (!response.ok) return setMessage(body.error || '照片移除失败');
    setSession(body.session as MaterialLibraryCaptureSessionDTO);
    setPreview(null);
    setMessage('误拍照片已移除');
  }

  async function complete() {
    if (!session) return;
    const saved = await saveDraft(false);
    if (!saved) return;
    if (!window.confirm(`确认归档本次 ${saved.photos.length} 张来料照片及检验数据？归档后品质人员不能删除照片。`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/material-library/sessions/${saved.id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: saved.version }),
      });
      const body = await bodyJson(response);
      if (!response.ok) throw new Error(body.error || '归档失败');
      const next = body.session as MaterialLibraryCaptureSessionDTO;
      setSession(next);
      setForm(formFromSession(next));
      setDirty(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '归档失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !session) return <main className="material-mobile-state"><Loader2 className="spin" /><strong>正在连接物料拍照会话</strong><span>校验二维码与品质账号权限…</span></main>;
  if (!session || !form) return <main className="material-mobile-state error"><AlertTriangle /><strong>无法打开拍照入口</strong><span>{error || '二维码无效、已过期或已撤销'}</span><button type="button" onClick={() => void connect()}><RefreshCw size={16} />重新读取</button></main>;

  return <main className="material-mobile-page">
    <header className="material-mobile-header">
      <Link href="/workspace/material-library" aria-label="返回物料库"><ChevronLeft /></Link>
      <div><span>来料拍照留库</span><strong>{session.item.code}</strong></div>
      <em className={active ? 'online' : ''}><Wifi size={13} />{active ? '已连接' : '已结束'}</em>
    </header>

    <section className="material-mobile-identity">
      <div><span><PackageOpen size={18} /></span><div><small>{session.item.category.name}</small><h1>{session.item.name}</h1><p>{session.item.manufacturerModel || '请拍照并填写厂家型号'}</p></div></div>
      <em>{session.uploadMode === 'PERMANENT' ? '永久二维码' : '临时二维码'}</em>
    </section>

    {session.item.warningState !== 'NONE' && <section className={`material-mobile-history-warning ${session.item.warningState.toLowerCase()}`}>
      <AlertTriangle size={18} />
      <span><strong>历史风险警示</strong><small>{session.item.warningNote || '该物料存在历史质量警示，请先核对照片和规格再检验。'}</small></span>
    </section>}

    <section className="material-mobile-steps" aria-label="录入进度">{steps.map((step, index) => <div className={step.done ? 'done' : index === steps.findIndex(item => !item.done) ? 'active' : ''} key={step.label}><b>{step.done ? <Check size={12} /> : index + 1}</b><span>{step.label}</span></div>)}</section>

    {session.status === 'COMPLETED' ? <section className="material-mobile-completed"><span><CheckCircle2 size={34} /></span><h2>本次记录已归档</h2><p>{session.photos.length} 张来料照片和检验数据已同步到物料档案。{session.uploadMode === 'PERMANENT' ? '下次扫描永久码将新建一轮录入。' : '本临时二维码已失效。'}</p><Link href="/workspace/material-library"><PackageOpen size={16} />返回物料库</Link></section> : <>
      <section className="material-mobile-card material-mobile-camera">
        <header><div><span>01</span><div><strong>拍摄来料实物</strong><small>选取差异明显的角度，照片会立即上传</small></div></div><em>{photoCount} 张</em></header>
        <div className="material-mobile-photo-grid">
          {session.photos.map((photo, index) => <button type="button" key={photo.id} onClick={() => setPreview(photo)}><Image unoptimized priority={index === 0} src={photo.contentUrl} width={photo.width || 320} height={photo.height || 240} alt={photo.originalName} style={{ transform: `rotate(${photo.rotation}deg)` }} /><span>{photo.isCover ? '封面' : index + 1}</span></button>)}
          <button type="button" className="add" disabled={uploading} onClick={() => cameraRef.current?.click()}>{uploading ? <Loader2 className="spin" /> : <Camera />}<span>{uploading ? '上传中' : '继续拍照'}</span></button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
        <input ref={galleryRef} type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
        <div className="material-mobile-camera-actions"><button className="primary" type="button" disabled={uploading} onClick={() => cameraRef.current?.click()}><Camera size={18} />手机拍照</button><button type="button" disabled={uploading} onClick={() => galleryRef.current?.click()}><ImageIcon size={18} />从相册选择</button></div>
        <p><ShieldCheck size={14} />原图直接写入 S3 兼容对象存储，不永久保存在应用服务器本地。</p>
      </section>

      <section className="material-mobile-card material-mobile-form">
        <header><div><span>02</span><div><strong>核对批次与状态</strong><small>固定型号由物料主档带入，只记录本次来料</small></div></div><em>{dirty ? '待保存' : '已保存'}</em></header>
        {session.item.supplierVariants.length > 1 && <label><span>本次供应商型号</span><select value={form.supplierVariantId} onChange={event => selectVariant(event.target.value)}>{session.item.supplierVariants.map(variant => <option key={variant.id} value={variant.id}>{variant.supplierName || '未登记供应商'} ｜ {variant.manufacturerModel || variant.supplierPartNumber || '未登记型号'}</option>)}</select></label>}
        <section className="material-mobile-fixed-data"><header><span><PackageOpen size={15} />固定资料</span><small>仅电脑端主档可维护</small></header><dl><div><dt>供应商</dt><dd>{form.supplierName || '—'}</dd></div><div><dt>厂家型号</dt><dd>{form.manufacturerModel || '—'}</dd></div><div><dt>供应商料号</dt><dd>{form.supplierPartNumber || '—'}</dd></div><div><dt>规格 / 材质</dt><dd>{[form.specification, form.materialComposition].filter(Boolean).join(' · ') || '—'}</dd></div></dl></section>
        <label><span>来料批次</span><input value={form.batchNumber} onChange={event => update('batchNumber', event.target.value)} placeholder="扫描批次标签或手工填写" /></label>
        <fieldset><legend>质量状态</legend><div>{(['NONE', 'ATTENTION', 'DEFECT'] as MaterialLibraryWarningStateDTO[]).map(value => <button type="button" className={`${value.toLowerCase()} ${form.warningState === value ? 'active' : ''}`} key={value} onClick={() => update('warningState', value)}><i />{warningLabel(value)}</button>)}</div></fieldset>
        {form.warningState !== 'NONE' && <label className="warning"><span>警示说明 *</span><textarea value={form.warningNote} onChange={event => update('warningNote', event.target.value)} placeholder="说明异常表现、与同名物料的差异和使用风险" /></label>}
        <label><span>本批差异 / 检验结论</span><textarea value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="只填写与固定主档不同之处、包装状态或检验结论" /></label>
        <button className="material-mobile-save" type="button" disabled={saving || !dirty} onClick={() => void saveDraft()}>{saving ? <Loader2 className="spin" /> : <Save />}保存检验数据</button>
      </section>

      <section className="material-mobile-archive-note"><Archive size={18} /><span><strong>确认后形成物料历史证据</strong><small>归档会把本次照片、规格、批次和不良警示同步到物料档案；归档照片仅管理员可删除。</small></span></section>
      <footer className="material-mobile-submit"><div><span>录入人</span><strong>{userName}</strong></div><button type="button" disabled={saving || uploading || photoCount < 1} onClick={() => void complete()}>{saving ? <Loader2 className="spin" /> : <Archive />}确认归档</button></footer>
    </>}

    {preview && <div className="material-mobile-preview" onClick={() => setPreview(null)}><button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}><X /></button><Image unoptimized src={preview.contentUrl} width={preview.width || 960} height={preview.height || 720} alt={preview.originalName} style={{ transform: `rotate(${preview.rotation}deg)` }} />{active && <button className="delete" type="button" onClick={event => { event.stopPropagation(); void removePhoto(preview); }}><Trash2 size={16} />移除误拍</button>}</div>}
    {message && <div className="material-mobile-toast" role="status"><CheckCircle2 size={16} />{message}</div>}
  </main>;
}
