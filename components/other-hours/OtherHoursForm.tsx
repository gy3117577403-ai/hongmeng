'use client';
/* Evidence images use the authenticated same-origin endpoint. */
/* eslint-disable @next/next/no-img-element */
import { Camera, ChevronDown, ImagePlus, Send, X } from 'lucide-react';
import type { RefObject } from 'react';
import { duration, type Data, type Form, type Photo, type Row } from './model';

export function OtherHoursForm({ form, row, data, busy, field, formRef, update, onSave, onSubmit, onUpload, onRemove, onPreview, onCategories, failedPhotos, onRetry }: {
  form: Form; row: Row | null; data: Data | null; busy: boolean; field: boolean; formRef: RefObject<HTMLFormElement>;
  update: <K extends keyof Form>(key: K, value: Form[K]) => void;
  onSave: () => void; onSubmit: () => void; onUpload: (files: FileList | null) => void;
  onRemove: (photo: Photo) => void; onPreview: (photo: Photo) => void; onCategories: () => void;
  failedPhotos: string[]; onRetry: () => void;
}) {
  const active = data?.categories.filter(c => c.isActive) || [];
  const chosen = active.find(c => c.id === form.categoryId);
  const common = [...(chosen ? [chosen] : []), ...active.filter(c => c.id !== chosen?.id)].slice(0, 2);
  const needsReason = form.workDate < (data?.today || form.workDate) || Boolean(form.employeeId);
  return <form ref={formRef} className="oh-form" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
    <fieldset disabled={busy}>
      {data?.permissions.admin && !field && !row && <label>管理员补录<select value={form.employeeId} onChange={e => update('employeeId', e.target.value)}>
        <option value="">为本人申报</option>{data.employees?.map(e => <option key={e.id} value={e.id}>{e.employeeNo} · {e.name}</option>)}
      </select></label>}
      <label><span className="oh-field-label">工作日期</span><span className="oh-date-input"><input type="date" required value={form.workDate} max={data?.today}
        disabled={Boolean(row)} onChange={e => update('workDate', e.target.value)} />
        {!row && <button type="button" onClick={() => update('workDate', data?.today || form.workDate)}>今天</button>}</span></label>
      <div className="oh-field"><span className="oh-field-label">事项分类</span><div className="oh-category-buttons">
        {common.map(c => <button key={c.id} type="button" aria-pressed={form.categoryId === c.id} onClick={() => update('categoryId', c.id)}>{c.name}</button>)}
        <button type="button" onClick={onCategories}>更多<ChevronDown size={14} /></button>
      </div>{form.categoryId && !chosen && <small className="oh-field-error">原分类已停用，请重新选择。</small>}</div>
      <label><span className="oh-field-label">实际耗时<small className="oh-duration-hint">{form.requestedMinutes > 0 ? '共 ' + duration(form.requestedMinutes) : '填写实际工作时长'}</small></span>
        <span className="oh-duration-input"><input type="number" min="1" max="1440" step="1" inputMode="numeric" required placeholder="输入时长" value={form.requestedMinutes || ''}
          onChange={e => update('requestedMinutes', Number(e.target.value))} /><span>分钟</span></span>
      </label>
      <div className="oh-presets" aria-label="常用时长">{[30, 60, 90, 120].map(minutes => <button key={minutes} type="button" aria-pressed={form.requestedMinutes === minutes}
        onClick={() => update('requestedMinutes', minutes)}>{minutes === 30 ? '30 分钟' : minutes / 60 + ' 小时'}</button>)}</div>
      <label><span className="oh-field-label">工作说明</span><textarea required minLength={2} maxLength={1000} rows={2} value={form.description}
        placeholder="如：协助样品组给连接线打端子" onChange={e => update('description', e.target.value)} /></label>
      {needsReason && <label><span className="oh-field-label">补报 / 管理员补录原因</span><textarea required minLength={2} maxLength={500} rows={2}
        value={form.backfillReason} onChange={e => update('backfillReason', e.target.value)} placeholder="请说明补报原因" /></label>}
      <div className="oh-field"><span className="oh-field-label">工作照片<small>选填 · {row?.attachments.length || 0}/6</small></span>
        <div className="oh-upload-actions"><label className="oh-file-button"><Camera size={17} />拍照<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
          aria-label="拍摄工作照片" onChange={e => { onUpload(e.target.files); e.target.value = ''; }} /></label>
          <label className="oh-file-button"><ImagePlus size={17} />从相册选择<input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="从相册选择工作照片"
            onChange={e => { onUpload(e.target.files); e.target.value = ''; }} /></label></div>
        {!!row?.attachments.length && <div className="oh-photos">{row.attachments.map(photo => <div key={photo.id}><button type="button" onClick={() => onPreview(photo)} aria-label={'预览照片 ' + photo.originalName}>
          <img src={photo.url} alt={photo.originalName} /></button><button type="button" className="oh-remove-photo" onClick={() => onRemove(photo)} aria-label={'移除照片 ' + photo.originalName}><X size={14} /></button></div>)}</div>}
        {!!failedPhotos.length && <div className="oh-photo-retry" role="status"><span>{failedPhotos.length} 张照片未上传：{failedPhotos.join('、')}</span><button type="button" onClick={onRetry}>重试上传</button></div>}
      </div>
      <details className="oh-time-options"><summary>补充起止时段</summary><div className="oh-form-pair"><label>开始时间<input type="time" value={form.startedAt} onChange={e => update('startedAt', e.target.value)} /></label>
        <label>结束时间<input type="time" value={form.endedAt} onChange={e => update('endedAt', e.target.value)} /></label></div><small>跨工作日请分开填写，未工作的休息间隔不计入申报。</small></details>
    </fieldset>
    <footer className="oh-form-footer"><button type="button" disabled={busy} onClick={onSave}>保存草稿</button><button type="submit" className="primary" disabled={busy}>
      <Send size={16} />{busy ? '正在处理…' : '提交审批'}</button></footer>
  </form>;
}
