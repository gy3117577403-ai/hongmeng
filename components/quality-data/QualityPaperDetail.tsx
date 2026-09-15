'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, Download, FileText, History, MoreHorizontal, Pencil, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { requestPreviewLeave } from '@/components/DocumentOrientation';
import { beijingInput, QUALITY_LABELS, RESULT_LABELS, type QualityRecord } from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import { qualityJson, qualityRequest } from './client';
import QualityDataDetail from './QualityDataDetail';

export default function QualityPaperDetail({ record, user, onChanged, onEdit }: { record: QualityRecord; user: CurrentUserDTO; onChanged: (record: QualityRecord) => void; onEdit: () => void }) {
  const [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState(false);
  const [pendingAction,setPendingAction] = useState<'DELETE'|'RESTORE'|null>(null), [actionReason,setActionReason] = useState('');
  const previousFiles = useRef<{ recordId: string; ids: string[] }>({ recordId: record.id, ids: record.attachments.filter(f => !f.deletedAt).map(f => f.id) });
  const files = record.attachments.filter(file => !file.deletedAt);
  const file = files.find(item => item.id === selected) || files[0];
  const index = files.findIndex(item => item.id === file?.id);
  const canManage = user.access.capabilities.includes('QUALITY_DATA:MANAGE');
  const canEdit = !record.deletedAt && (canManage || user.id === record.createdById) && user.access.capabilities.includes('QUALITY_DATA:UPDATE');
  useEffect(() => { setSelected(''); setHistory(false); setError(''); }, [record.id]);
  useEffect(() => {
    const previous = previousFiles.current;
    const activeIds = record.attachments.filter(f => !f.deletedAt).map(f => f.id);
    if (previous.recordId === record.id) { const added = activeIds.filter(id => !previous.ids.includes(id)); if (added.length) setSelected(added[added.length - 1]); }
    previousFiles.current = { recordId: record.id, ids: activeIds };
  }, [record.id, record.attachments]);
  const first = record.type === 'FIRST';
  const url = file ? '/api/quality-data/attachments/' + file.id + '/content' + (record.deletedAt ? '?historyVersion=' + record.version : '') : '';
  const choose = (id: string) => requestPreviewLeave(() => setSelected(id));
  async function action(action: string) {
    const reason = actionReason.trim(); if(!reason)return;
    setBusy(true); setError('');
    try { const updated = await qualityRequest<QualityRecord>('records/' + record.id, qualityJson(action === 'DELETE' ? 'DELETE' : 'PATCH', { action, reason, version: record.version })); setPendingAction(null);setActionReason('');onChanged(updated); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); }
  }
  async function reorder(delta: number) {
    if (!file || busy) return;
    const ids = files.map(item => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    setBusy(true); setError('');
    try { onChanged(await qualityRequest<QualityRecord>('records/' + record.id, qualityJson('PATCH', { action: 'REORDER_ATTACHMENTS', version: record.version, attachmentIds: ids, reason: '调整纸质报表照片顺序' }))); setSelected(file.id); }
    catch (e) { setError(e instanceof Error ? e.message : '调整失败'); } finally { setBusy(false); }
  }
  return <section className={"qp-detail" + (!first ? " qp-patrol-detail" : "")} aria-label="检验照片预览">
    <header><div><small>{QUALITY_LABELS[record.type]}{record.inspectionStepSnapshot ? ' › 第 ' + String(record.inspectionStepSnapshot.position || '').padStart(2, '0') + ' 道 · ' + record.inspectionStepSnapshot.name : first ? ' · 历史未指定工序' : ''}</small><h2>{first ? record.orderSnapshot.specification || record.orderSnapshot.productName : beijingInput(record.inspectedAt).slice(5, 10).replace('-', '月') + '日 · ' + (record.data.paper?.area ? record.data.paper.area + ' · ' : '') + record.title}</h2><span>{first ? (record.orderSnapshot.businessCode || record.orderSnapshot.code) + (record.orderSnapshot.batchNo ? ' · 第 ' + record.orderSnapshot.batchNo + ' 批' : '') : '检验人：' + (record.data.context.inspectedBy || record.createdByName) + ' · ' + files.length + ' 份附件'}</span></div><div className="qp-detail-actions"><span className={'qd-badge ' + record.result.toLowerCase()}>{record.deletedAt ? '已作废' : record.status === 'DRAFT' ? '草稿' : first ? RESULT_LABELS[record.result] : '已归档'}</span>{!first && canEdit && <button onClick={() => requestPreviewLeave(onEdit)}><Upload size={16}/>补传照片</button>}<details><summary aria-label="更多记录操作"><MoreHorizontal size={20}/></summary><div>{canEdit && <button onClick={() => requestPreviewLeave(onEdit)}><Pencil size={15}/>编辑 / 补传照片</button>}<button onClick={() => setHistory(true)}><History size={15}/>原始明细与历史</button>{!record.deletedAt && (canManage || (record.createdById === user.id && record.status === 'DRAFT')) && <button disabled={busy} onClick={() => {setPendingAction('DELETE');setActionReason('');}}><Trash2 size={15}/>移入回收站</button>}{record.deletedAt && canManage && <button disabled={busy} onClick={() => {setPendingAction('RESTORE');setActionReason('');}}><RotateCcw size={15}/>恢复记录</button>}</div></details></div></header>
    {first && <div className="qp-detail-meta"><div><small>{first ? '实际检验' : '巡检日期'}</small><b>{first ? beijingInput(record.inspectedAt).replace('T', ' ') : beijingInput(record.inspectedAt).slice(0, 10)}</b></div><div><small>检验人</small><b>{record.data.context.inspectedBy || record.createdByName}</b></div><div><small>检验凭证</small><b>{files.length} 份照片 / 文件</b></div></div>}
    {error && <p role="alert" className="qd-alert error">{error}</p>}
    {record.deletedAt && <p className="qp-deleted-note">作废原因：{record.deleteReason}</p>}
    <div className="qp-fixed-preview">{!file ? <div className="qp-empty"><ClipboardCheck size={36}/><b>{record.data.mode === 'FORM' ? '历史记录保留了在线检验明细' : '还没有检验照片'}</b><button onClick={() => record.data.mode === 'FORM' ? setHistory(true) : onEdit()}>{record.data.mode === 'FORM' ? '查看原始明细' : '继续上传'}</button></div> : file.mimeType.startsWith('image/') ? <ImageViewer fileId={file.id} title={file.originalName} contentUrl={url} downloadUrl={url + (url.includes('?') ? '&' : '?') + 'download=1'} dashboardMode paperMode={!first} initialFitMode={first ? "fit-window" : "fit-width"}/> : file.mimeType === 'application/pdf' ? <PdfViewer fileId={file.id} title={file.originalName} contentUrl={url} downloadUrl={url + (url.includes('?') ? '&' : '?') + 'download=1'} dashboardMode/> : <div className="qp-empty"><FileText size={36}/><b>{file.originalName}</b><a href={url + (url.includes('?') ? '&' : '?') + 'download=1'}>下载原始文件</a></div>}</div>
    <div className={"qp-thumbnails" + (!first && files.length <= 1 ? " qp-single-photo" : "")}><div className="qp-thumb-scroll">{files.map((item, i) => <button className={file?.id === item.id ? 'active' : ''} key={item.id} onClick={() => choose(item.id)} aria-label={'查看第 ' + (i + 1) + ' 份'}>{item.mimeType.startsWith('image/') ? <img loading="lazy" src={'/api/quality-data/attachments/' + item.id + '/content' + (record.deletedAt ? '?historyVersion=' + record.version : '')} alt={item.originalName}/> : <FileText size={24}/>}<small>第 {i + 1} 份</small></button>)}</div>{file && <div className="qp-photo-controls"><span>{index + 1} / {files.length}</span>{canEdit && files.length > 1 && <><button title="调整附件顺序：前移" disabled={busy || index <= 0} aria-label="当前照片前移" onClick={() => void reorder(-1)}><ChevronLeft size={16}/></button><button title="调整附件顺序：后移" disabled={busy || index >= files.length - 1} aria-label="当前照片后移" onClick={() => void reorder(1)}><ChevronRight size={16}/></button></>}<a href={url + (url.includes('?') ? '&' : '?') + 'download=1'} aria-label="下载当前原件"><Download size={17}/></a></div>}</div>
    {(first || record.data.summary) && <footer><span>{record.data.summary || (first ? '检验凭证随本工序留存' : '按实际巡检日期归档')}</span>{first && canEdit && <button onClick={() => requestPreviewLeave(onEdit)}>补传照片</button>}</footer>}
    {pendingAction && <div className="qd-modal qp-modal" role="dialog" aria-modal="true" aria-label={pendingAction==='DELETE'?'移入回收站':'恢复检验记录'}><section className="qp-action-dialog"><h2>{pendingAction==='DELETE'?'移入回收站':'恢复记录'}</h2><p>{record.title}</p><label>操作原因<textarea autoFocus rows={3} value={actionReason} onChange={e=>setActionReason(e.target.value)} /></label>{error&&<p role="alert">{error}</p>}<footer><button disabled={busy} onClick={()=>setPendingAction(null)}>取消</button><button className="qd-primary" disabled={busy||!actionReason.trim()} onClick={()=>void action(pendingAction)}>{busy?'处理中…':'确认'}</button></footer></section></div>}
    {history && <div className="qd-modal" role="dialog" aria-modal="true" aria-label="检验历史明细"><div className="qp-history-dialog"><button className="qp-history-close" aria-label="关闭历史明细" onClick={() => setHistory(false)}><X size={20}/></button><QualityDataDetail record={record} user={user} onChanged={onChanged} onEdit={() => { setHistory(false); onEdit(); }}/></div></div>}
  </section>;
}
