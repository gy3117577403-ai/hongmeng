'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { useState } from 'react';
import { Download, FileText, History, Pencil, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { CONTEXT_FIELDS, QUALITY_LABELS, RESULT_LABELS, REVIEW_LABELS, beijingInput, type QualityRecord } from '@/lib/quality-data';
import { qualityJson, qualityRequest } from './client';
import type { CurrentUserDTO } from '@/types';
type HistoryPage = { total: number; items: Array<{ version: number; action: string; reason: string; actorName: string; createdAt: string }>; page: number };
export default function QualityDataDetail({ record, user, onChanged, onEdit, onRetest }: { record: QualityRecord; user: CurrentUserDTO; onChanged: (r: QualityRecord) => void; onEdit: () => void; onRetest: () => void }) {
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [preview,setPreview] = useState<{ url: string; image: boolean; title: string } | null>(null);
  const [history,setHistory] = useState<HistoryPage | null>(null), [old,setOld] = useState<QualityRecord | null>(null);
  const canManage = user.access.capabilities.includes('QUALITY_DATA:MANAGE');
  const canReview = user.access.capabilities.includes('QUALITY_DATA:APPROVE');
  const canEdit = (canManage || record.createdById === user.id) && !record.deletedAt;
  const r = old || record;
  async function action(name: string, label: string) {
    const reason = window.prompt(label + '：请填写原因或复核意见');
    if (!reason?.trim()) return;
    setBusy(true); setError('');
    try { onChanged(await qualityRequest<QualityRecord>('records/' + record.id, qualityJson(name === 'DELETE' ? 'DELETE' : 'PATCH', { action: name, reason, version: record.version }))); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function loadHistory(page = 1) {
    setError('');
    try { setHistory(await qualityRequest<HistoryPage>('records/' + record.id + '/revisions?page=' + page)); }
    catch (e) { setError(e instanceof Error ? e.message : '读取历史失败'); }
  }
  return <section className="qd-detail" aria-label="检验记录详情">
    <header><div><small>{r.code} · V{r.version}</small><h2>{r.title}</h2></div><span className={'qd-badge ' + r.result.toLowerCase()}>{RESULT_LABELS[r.result]}</span></header>
    <div className="qd-detail-tags"><span>{QUALITY_LABELS[r.type]}</span><span>{r.deletedAt ? '已作废' : r.status === 'DRAFT' ? '草稿' : '已提交'}</span><span>{REVIEW_LABELS[r.reviewStatus]}</span></div>
    {old && <div className="qd-alert">正在查看 V{old.version} 历史快照<button onClick={() => setOld(null)}>返回当前版本</button></div>}
    {error && <p className="qd-alert error" role="alert">{error}</p>}
    {r.deletedAt && <p className="qd-alert error">作废原因：{r.deleteReason}</p>}
    <div className="qd-order-strip"><strong>{r.orderSnapshot.specification || r.orderSnapshot.productName}</strong><span>{r.orderSnapshot.businessCode || r.orderSnapshot.code}</span><small>订单 {r.orderSnapshot.sourceOrderNo || '未关联'} · {r.orderSnapshot.batchNo ? '第 ' + r.orderSnapshot.batchNo + ' 批' : '历史工单'} · {r.orderSnapshot.customerName || ''}</small></div>
    <dl className="qd-detail-meta"><div><dt>检验时间</dt><dd>{beijingInput(r.inspectedAt).replace('T',' ')}</dd></div><div><dt>填写人</dt><dd>{r.createdByName}</dd></div><div><dt>系统提交时间</dt><dd>{r.submittedAt ? beijingInput(r.submittedAt).replace('T',' ') : '尚未提交'}</dd></div>{CONTEXT_FIELDS.filter(([key]) => r.data.context[key]).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{r.data.context[key]}</dd></div>)}</dl>
    {r.supersedesId && <p className="qd-help">本次为复检。<Link href={'/workspace/quality/data?recordId=' + r.supersedesId}>查看原始记录</Link></p>}
    <div className="qd-section-title"><b>检查明细</b><span>{r.data.rows.length} 项</span></div>
    <div className="qd-table-scroll"><table className="qd-measure-table"><thead><tr><th>样本 / 位置</th><th>项目与标准</th><th>实测结果</th><th>判定</th></tr></thead><tbody>{r.data.rows.map((row,i) => <tr key={i}><td>{row.sample || '—'}<small>{row.position}</small></td><td><b>{row.item}</b><small>{row.standard || '未填写文字依据'}{(row.lower || row.upper) && ' · ' + (row.lower || '不限') + ' ～ ' + (row.upper || '不限') + ' ' + row.unit}</small>{row.note && <small>{row.note}</small>}</td><td>{row.value || '—'} {row.unit}</td><td><span className={'qd-badge ' + row.result.toLowerCase()}>{RESULT_LABELS[row.result]}</span></td></tr>)}</tbody></table>{!r.data.rows.length && <p className="qd-help">文件归档记录，请查看附件与内容摘要。</p>}</div>
    {r.data.summary && <div className="qd-summary"><b>内容摘要 / 异常说明</b><p>{r.data.summary}</p></div>}
    <div className="qd-section-title"><b>原始附件</b><span>{r.attachments.filter(file => !file.deletedAt).length} 份</span></div>
    <div className="qd-attachment-grid">{r.attachments.filter(file => !file.deletedAt).map(file => {
      const historyVersion = old?.version || (r.deletedAt ? r.version : null);
      const url = '/api/quality-data/attachments/' + file.id + '/content' + (historyVersion ? '?historyVersion=' + historyVersion : '');
      return <article key={file.id}>
        <button className="qd-attachment-open" onClick={() => file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf' ? setPreview({ url, image: file.mimeType.startsWith('image/'), title: file.originalName }) : window.open(url + (historyVersion ? '&' : '?') + 'download=1')}>
          {file.mimeType.startsWith('image/') ? <img src={url} alt={file.originalName} loading="lazy"/> : <FileText size={32}/>}<b>{file.originalName}</b>
        </button><a href={url + (historyVersion ? '&' : '?') + 'download=1'}><Download size={13}/>下载原件</a>
      </article>;
    })}</div>
    {r.reviewedAt && <p className="qd-review-note"><ShieldCheck size={16}/>{r.reviewedByName} · {beijingInput(r.reviewedAt).replace('T',' ')}<br/>{r.reviewNote}</p>}
    <div className="qd-detail-actions">
      {!old && canEdit && <button onClick={onEdit} disabled={busy}><Pencil size={15}/>编辑 / 修订</button>}
      {!old && !record.deletedAt && record.status === 'SUBMITTED' && <button onClick={onRetest} disabled={busy}><RotateCcw size={15}/>新增复检</button>}
      <Link target="_blank" href={'/workspace/quality/data/' + record.id + '/print' + (old ? '?version=' + old.version : '')}><Download size={15}/>PDF / 打印</Link>
      <button onClick={() => void loadHistory()}><History size={15}/>修订历史</button>
      {!old && canReview && !record.deletedAt && record.status === 'SUBMITTED' && <><button disabled={busy} onClick={() => void action('REVIEW','确认复核')}><ShieldCheck size={15}/>复核</button><button disabled={busy} onClick={() => void action('RETURN','退回补充')}>退回</button></>}
      {!old && !record.deletedAt && (canManage || (record.status === 'DRAFT' && record.createdById === user.id)) && <button className="qd-danger" disabled={busy} onClick={() => void action('DELETE',record.status === 'DRAFT' ? '删除草稿' : '作废记录')}><Trash2 size={15}/>{record.status === 'DRAFT' ? '删除' : '作废'}</button>}
      {!old && record.deletedAt && canManage && <button disabled={busy} onClick={() => void action('RESTORE','恢复记录')}><RotateCcw size={15}/>恢复</button>}
    </div>
    {history && <section className="qd-history"><div className="qd-section-title"><b>修订历史 · {history.total} 次</b><button onClick={() => setHistory(null)}>收起</button></div>{history.items.map(item => <button key={item.version} onClick={async () => { try { setOld(await qualityRequest<QualityRecord>('records/' + record.id + '/revisions/' + item.version)); } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); } }}><strong>V{item.version} · {item.actorName}</strong><span>{item.reason}</span><small>{beijingInput(item.createdAt).replace('T',' ')}</small></button>)}<div className="qd-pagination"><button disabled={history.page <= 1} onClick={() => void loadHistory(history.page - 1)}>上一页</button><span>{history.page} / {Math.max(1,Math.ceil(history.total/20))}</span><button disabled={history.page * 20 >= history.total} onClick={() => void loadHistory(history.page + 1)}>下一页</button></div></section>}
    {preview && <div className="qd-preview-overlay" role="dialog" aria-modal="true" aria-label={preview.title}><header><b>{preview.title}</b><button onClick={() => setPreview(null)} aria-label="关闭附件预览"><X/></button></header>{preview.image ? <img src={preview.url} alt={preview.title}/> : <iframe src={preview.url} title={preview.title}/>}</div>}
  </section>;
}
