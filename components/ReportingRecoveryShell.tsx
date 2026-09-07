'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BellRing, CheckCircle2, ClipboardCheck, Clock3, Loader2, RefreshCw, Search } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type { CurrentUserDTO } from '@/types';
import { productTimeConfigurationRoute } from '@/lib/workflow-routes';
import type { ReportSubmissionDto, ReportSubmissionPreview, ReportSubmissionResolutionInput } from '@/lib/process-report-submission-contract';

const statusLabels = { PENDING: '待处理', COMPLETED: '已完成核销', CANCELLED: '已取消' };
function displayTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
}
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || '操作未完成，请重试');
  return body as T;
}

export default function ReportingRecoveryShell({ user }: { user: CurrentUserDTO }) {
  const [items, setItems] = useState<ReportSubmissionDto[]>([]), [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(''), [preview, setPreview] = useState<ReportSubmissionPreview | null>(null);
  const [query, setQuery] = useState(''), [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [cancelConfirm, setCancelConfirm] = useState(false);
  const [loading, setLoading] = useState(true), [previewLoading, setPreviewLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [mobileDetail, setMobileDetail] = useState(false);
  const [sourceKey, setSourceKey] = useState(''), [mappingConfirmed, setMappingConfirmed] = useState(false), [advanceConfirmed, setAdvanceConfirmed] = useState(false);
  const [processedQty, setProcessedQty] = useState(''), [defectQty, setDefectQty] = useState('0');
  const [reportedUnitQty, setReportedUnitQty] = useState(''), [reportedDefectUnitQty, setReportedDefectUnitQty] = useState('0');
  const [standardSeconds, setStandardSeconds] = useState(''), [setupSeconds, setSetupSeconds] = useState('0');
  const [timeBasis, setTimeBasis] = useState<'per_batch' | 'per_unit'>('per_unit'), [unitsPerProduct, setUnitsPerProduct] = useState('1');
  const requestSequence = useRef(0), previewSequence = useRef(0), initialLink = useRef(false), submissionLock = useRef(false);

  const loadList = useCallback(async (quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    try {
      const body = await readResponse<{ data: { items: ReportSubmissionDto[]; total: number } }>(await fetch('/api/process-report-submissions?' + new URLSearchParams({ status: status === 'ALL' ? '' : status, keyword: search, offset: String(page * 30), limit: '30' }), { cache: 'no-store' }));
      if (sequence !== requestSequence.current) return;
      setItems(body.data.items); setTotal(body.data.total);
      if (!initialLink.current) {
        initialLink.current = true;
        const linkId = new URLSearchParams(window.location.search).get('id');
        setSelectedId(linkId || body.data.items[0]?.id || '');
        if (linkId) { setStatus('ALL'); setMobileDetail(true); }
      }
    } catch (e) { if (sequence === requestSequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [status, search, page]);

  const loadPreview = useCallback(async (id: string) => {
    const sequence = ++previewSequence.current;
    setPreviewLoading(true); setError('');
    try {
      const body = await readResponse<{ data: ReportSubmissionPreview }>(await fetch(`/api/process-report-submissions/${encodeURIComponent(id)}/preview`, { cache: 'no-store' }));
      if (sequence !== previewSequence.current) return;
      const next = body.data;
      setPreview(next);
      const options = next.sourceOptions.filter(option => option.action !== 'FUTURE_CONFIRMATION' && option.action !== 'HISTORICAL_CONFIRMATION');
      setSourceKey(options.length === 1 ? options[0].key : '');
      setProcessedQty(String(next.submission.processedQty)); setDefectQty(String(next.submission.defectQty));
      setReportedUnitQty(String(next.submission.reportedUnitQty)); setReportedDefectUnitQty(String(next.submission.reportedDefectUnitQty));
      setMappingConfirmed(false); setAdvanceConfirmed(false);
      const standard = next.standardPreview.published || next.standardPreview.current;
      setStandardSeconds(standard.standardMillisecondsPerUnit == null ? '' : String(standard.standardMillisecondsPerUnit / 1000));
      setSetupSeconds(String((next.standardPreview.published?.setupMilliseconds || 0) / 1000));
      setTimeBasis(standard.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit');
      setUnitsPerProduct(String(standard.unitsPerProduct));
    } catch (e) { if (sequence === previewSequence.current) { setPreview(null); setError(e instanceof Error ? e.message : '详情加载失败'); } }
    finally { if (sequence === previewSequence.current) setPreviewLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query.trim()); setPage(0); }, 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { const sequence = requestSequence; void loadList(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadList(true); }, 60_000); return () => { ++sequence.current; window.clearInterval(timer); }; }, [loadList]);
  useEffect(() => { const sequence = previewSequence; setFeedback(''); setCancelConfirm(false); setPreview(null); if (selectedId) void loadPreview(selectedId); return () => { ++sequence.current; }; }, [selectedId, loadPreview]);

  const submission = preview?.submission;
  const source = preview?.sourceOptions.find(option => option.key === sourceKey);
  const needsSource = Boolean(preview?.actions.some(action => action.code === 'CONFIRM_SOURCE'));
  const needsStandard = Boolean(preview?.actions.some(action => action.code === 'RESOLVE_STANDARD'));
  const mappingToAction = (preview?.standardPreview.published?.reportQuantityBasis || preview?.standardPreview.current.reportQuantityBasis) === 'action';
  const actionMappingValid = !mappingToAction || (/^\d+$/.test(reportedUnitQty) && Number(reportedUnitQty) > 0 && /^\d+$/.test(reportedDefectUnitQty) && Number(reportedDefectUnitQty) <= Number(reportedUnitQty));
  const mappingValid = !preview?.quantityMappingRequired || (mappingConfirmed && actionMappingValid && /^\d+$/.test(processedQty) && /^\d+$/.test(defectQty) && Number(defectQty) <= Number(processedQty) && ((preview.standardPreview.published?.reportQuantityBasis || preview.standardPreview.current.reportQuantityBasis) !== 'product' || Number(processedQty) > 0));
  const standardValid = !needsStandard || (standardSeconds.trim() !== '' && Number.isFinite(Number(standardSeconds)) && Number(standardSeconds) > 0 && Number(setupSeconds) >= 0 && /^\d+$/.test(unitsPerProduct) && Number(unitsPerProduct) > 0);
  const canConfirm = Boolean(preview?.canResolve && submission?.status === 'PENDING' && !previewLoading && !saving && !preview.blockers.length && mappingValid && standardValid && (!needsSource || source) && (!source || !['FUTURE_CONFIRMATION', 'HISTORICAL_CONFIRMATION'].includes(source.action) || advanceConfirmed));

  async function resolve() {
    if (!canConfirm || !preview || !submission || submissionLock.current) return;
    submissionLock.current = true; setSaving(true); setError(''); setFeedback('');
    const body: ReportSubmissionResolutionInput = { expectedVersion: submission.version, expectedRouteVersion: preview.routeVersion ?? undefined, expectedProfileVersion: preview.standardPreview.published?.productTimeProfileVersion, expectedEntryId: preview.standardPreview.published?.productTimeEntryId };
    if (source) { body.sourceKey = source.key; body.sourceVersion = source.version; body.confirmAdvanceSchedule = source.action === 'FUTURE_CONFIRMATION' && advanceConfirmed; body.confirmHistoricalWork = source.action === 'HISTORICAL_CONFIRMATION' && advanceConfirmed; }
    if (preview.quantityMappingRequired) { body.confirmQuantityMapping = mappingConfirmed; body.processedQty = Number(processedQty); body.defectQty = Number(defectQty); if (mappingToAction) { body.reportedUnitQty = Number(reportedUnitQty); body.reportedDefectUnitQty = Number(reportedDefectUnitQty); } }
    if (needsStandard) body.standard = { timeBasis, standardMillisecondsPerUnit: Math.round(Number(standardSeconds) * 1000), setupMilliseconds: Math.round(Number(setupSeconds) * 1000), unitsPerProduct: Number(unitsPerProduct), countsForEfficiency: preview.standardPreview.published?.countsForEfficiency ?? true };
    try {
      const result = await readResponse<{ pending?: boolean; submission?: ReportSubmissionDto; data?: ReportSubmissionDto; lastError?: string }>(await fetch(`/api/process-report-submissions/${encodeURIComponent(submission.id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      const current = result.submission || result.data;
      if (current?.status === 'CANCELLED') setFeedback('这笔申报已被取消，未继续核销。');
      else if (result.pending || current?.status !== 'COMPLETED') setFeedback(result.lastError || current?.lastError || '原申报已保留，尚未完成核销。请核对最新待处理项。');
      else setFeedback('原报工已完成核销并计入工时，处理消息已自动完成。员工无需重复报工。');
      await Promise.all([loadList(true), loadPreview(submission.id)]);
    } catch (e) { setError(e instanceof Error ? e.message : '处理结果暂未确认，请刷新查看原申报；不要重新报工'); }
    finally { submissionLock.current = false; setSaving(false); }
  }

  async function cancelSubmission() {
    if (!submission?.canCancel || saving || submissionLock.current) return;
    submissionLock.current = true; setSaving(true); setError('');
    try {
      await readResponse(await fetch(`/api/process-report-submissions/${encodeURIComponent(submission.id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CANCEL', expectedVersion: submission.version }) }));
      setCancelConfirm(false); setFeedback('申报已取消，待处理占用已释放。');
      await Promise.all([loadList(true), loadPreview(submission.id)]);
    } catch (e) { setError(e instanceof Error ? e.message : '取消结果未确认，请刷新查看原申报'); }
    finally { submissionLock.current = false; setSaving(false); }
  }

  const displayed = items.filter(item => (status === 'ALL' || item.status === status) && `${item.workOrderCode} ${item.specification || ''} ${item.processName} ${item.createdByName}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className={`hm-workbench-root hm-cockpit-root reporting-recovery-root ${mobileDetail ? 'show-detail' : ''}`}>
    <AppWorkbenchHeader user={user} activeHref="/workspace/reporting-recovery" subtitle="报工待处理" menuItems={[]} hideHeader sidebarTriggerTargetId="report-recovery-nav" />
    <header className="rr-header"><div id="report-recovery-nav" className="hm-cockpit-navigation-trigger" /><span className="rr-header-icon"><ClipboardCheck /></span><div><h1>报工待处理</h1><p>保留原申报 · 核对后自动续报</p></div>{user.access.capabilities.includes('NOTIFICATIONS:READ') && <Link href="/workspace/messages"><BellRing size={17} />我的消息</Link>}<button disabled={loading || saving} onClick={() => { setError(''); void loadList(); if (selectedId) void loadPreview(selectedId); }}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新</button></header>
    {error && <div className="rr-alert error" role="alert"><AlertCircle size={19} />{error}</div>}
    {feedback && <div className={`rr-alert ${submission?.status === 'COMPLETED' ? 'success' : ''}`} role="status">{submission?.status === 'COMPLETED' ? <CheckCircle2 size={19} /> : <Clock3 size={19} />}{feedback}</div>}
    <div className="rr-layout"><aside className="rr-list"><div className="rr-list-top"><strong>我发起或待我处理</strong><span>{total}</span></div><label className="rr-search"><Search size={17} /><input aria-label="搜索报工申报" value={query} onChange={e => setQuery(e.target.value)} placeholder="工单、产品、工序、申报人" /></label><div className="rr-tabs" role="tablist">{[['PENDING', '待处理'], ['COMPLETED', '已核销'], ['ALL', '全部']].map(([value, label]) => <button key={value} role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setPage(0); }}>{label}</button>)}</div>
      <div className="rr-list-scroll">{displayed.map(item => <button key={item.id} className={`rr-item ${selectedId === item.id ? 'active' : ''}`} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setMobileDetail(true); window.history.replaceState(null, '', '/workspace/reporting-recovery?id=' + encodeURIComponent(item.id)); }}><span className={`rr-badge ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span><strong>{item.specification || item.productName} · {item.processName}</strong><small>{item.workOrderCode}</small><p>{item.reasonLabel}</p><footer><span>{item.createdByName} · {displayTime(item.createdAt)}</span>{item.canResolve && item.status === 'PENDING' && <b>待我处理</b>}</footer></button>)}{!displayed.length && <div className="rr-empty"><ClipboardCheck size={36} /><p>{loading ? '正在加载申报…' : '当前条件下暂无记录'}</p></div>}</div><nav className="rr-pagination" aria-label="申报翻页"><button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 30))}</span><button disabled={(page + 1) * 30 >= total || loading} onClick={() => setPage(value => value + 1)}>下一页</button></nav>
    </aside><section className="rr-workspace"><button className="rr-mobile-back" onClick={() => setMobileDetail(false)}><ArrowLeft size={16} />返回列表</button>{previewLoading ? <div className="rr-empty"><Loader2 className="spin" /><p>正在核对最新工序与来源…</p></div> : preview && submission ? <>
      <header className="rr-detail-header"><div><span className={`rr-badge ${submission.status.toLowerCase()}`}>{statusLabels[submission.status]}</span><h2>{submission.processName}</h2><p>{submission.specification || submission.productName} · {submission.workOrderCode}</p></div><small>申报编号<br />{submission.id}</small></header>
      <div className="rr-steps"><span className="done"><CheckCircle2 size={17} />{submission.reasonCode === 'STANDARD_MISSING' ? '数量已登记' : '已保存申报'}</span><ArrowRight size={16} /><span className={submission.status === 'COMPLETED' ? 'done' : 'active'}>{submission.status === 'COMPLETED' ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}核对并续报</span><ArrowRight size={16} /><span className={submission.status === 'COMPLETED' ? 'done' : ''}>数量核销 · 工时入账</span></div>
      <article className="rr-card"><h3>原始申报</h3><dl className="rr-facts"><div><dt>申报人 / 生产日期</dt><dd>{submission.createdByName} / {submission.workDate}</dd></div><div><dt>作业人员</dt><dd>{submission.employeeNames.join('、') || '—'}</dd></div><div><dt>报工动作 / 动作不良</dt><dd>{submission.reportedUnitQty} / {submission.reportedDefectUnitQty} {submission.reportUnitLabel}</dd></div><div><dt>整套数量 / 整套不良</dt><dd>{submission.processedQty} / {submission.defectQty} 套</dd></div></dl>{submission.status === 'PENDING' && <p className="rr-note">{submission.reasonCode === 'STANDARD_MISSING' ? '原数量已登记，工时仍待核定。处理时只补计原记录工时，请勿重复申报。' : '申报已保存；最终核销和工时结果以处理成功回执为准，请勿重复申报。'}</p>}</article>
      <article className="rr-card rr-handler"><BellRing size={22} /><div><h3>{submission.status === 'PENDING' ? submission.reasonLabel : statusLabels[submission.status]}</h3><p>处理账号：{submission.assigneeNames.join('、') || '系统正在匹配可处理账号'}</p>{submission.lastError && <p role="status" className="rr-last-error">{submission.lastError}</p>}</div></article>
      {submission.status === 'PENDING' && <>
        {!!preview.blockers.length && <div className="rr-alert"><AlertCircle size={20} /><div>{preview.blockers.map((text, index) => <p key={index}>{text}</p>)}{user.access.capabilities.includes('PROCESS:READ') && <Link href={productTimeConfigurationRoute(undefined, { workOrderId: submission.workOrderId, stepId: submission.stepId, from: 'workflow' })}>打开本工单工序与工时配置</Link>}</div></div>}
        {preview.actions.some(action => action.code === 'REPAIR_STANDARD') && <article className="rr-card"><h3>同步当前有效工时标准</h3><p>确认时重新检查该工序的有效报工与标准版本，并成组同步计量口径和工时。</p><div className="rr-standard-diff"><span>当前：{preview.standardPreview.current.reportQuantityBasis === 'action' ? '按动作' : '按整套'} · {preview.standardPreview.current.unitsPerProduct} {preview.standardPreview.current.reportUnitLabel}/套</span><ArrowRight size={18} /><strong>生效标准：{preview.standardPreview.published ? `${preview.standardPreview.published.reportQuantityBasis === 'action' ? '按动作' : '按整套'} · ${preview.standardPreview.published.unitsPerProduct} ${preview.standardPreview.published.reportUnitLabel}/套` : '待补齐'}</strong></div></article>}
        {needsSource && <article className="rr-card"><h3>确认半成品来源</h3><p>按所选批次核销并保留原生产日期；根据实际情况确认续作或历史补录。</p><div className="rr-source-options">{preview.sourceOptions.map(option => <label key={option.key} className={sourceKey === option.key ? 'selected' : ''}><input type="radio" name="recovery-source" value={option.key} checked={sourceKey === option.key} disabled={!preview.canResolve || saving} onChange={() => { setSourceKey(option.key); setAdvanceConfirmed(false); }} /><div><strong>{option.lotNo}</strong><span>{option.label}</span><small>本工序剩余 {option.remainingQty} 套 · {option.targetWeekStartDate || '尚未安排'}{option.targetWeekEndDate ? ' 至 ' + option.targetWeekEndDate : ''}</small></div></label>)}</div>{!preview.sourceOptions.length && <p className="rr-note">暂无可用半成品来源，原申报继续保留；请由处理人核对批次安排后刷新。</p>}{source?.action === 'HISTORICAL_CONFIRMATION' && <label className="rr-check"><input type="checkbox" checked={advanceConfirmed} onChange={e => setAdvanceConfirmed(e.target.checked)} />确认这是原申报日期实际完成的历史作业；仅核销本次数量和工时，原剩余排程保持不变</label>}{source?.action === 'FUTURE_CONFIRMATION' && <label className="rr-check"><input type="checkbox" checked={advanceConfirmed} onChange={e => setAdvanceConfirmed(e.target.checked)} />确认将未来安排的剩余部分调整到本次生产日期所在周</label>}</article>}
        {preview.quantityMappingRequired && <article className="rr-card"><h3>{mappingToAction ? '核对变更后的动作与整套数量' : '核对实际完成的整套数量'}</h3><p>工序计量口径已变化，请核对本次实际完成数量；系统不会猜测动作数与整套数之间的换算结果。</p><div className="rr-fields">{mappingToAction && <><label>实际动作数量<input type="number" min="1" step="1" value={reportedUnitQty} onChange={e => { setReportedUnitQty(e.target.value); setMappingConfirmed(false); }} /></label><label>动作不良数量<input type="number" min="0" step="1" value={reportedDefectUnitQty} onChange={e => { setReportedDefectUnitQty(e.target.value); setMappingConfirmed(false); }} /></label></>}<label>形成完整产品（套）<input type="number" min="0" step="1" value={processedQty} onChange={e => { setProcessedQty(e.target.value); setMappingConfirmed(false); }} /></label><label>整套不良（套）<input type="number" min="0" step="1" value={defectQty} onChange={e => { setDefectQty(e.target.value); setMappingConfirmed(false); }} /></label></div><label className="rr-check"><input type="checkbox" checked={mappingConfirmed} onChange={e => setMappingConfirmed(e.target.checked)} />已核对动作数量与实际整套数量</label></article>}
        {needsStandard && <article className="rr-card"><h3>补齐本次计工标准</h3><p>核对数值后重新计工，不需要填写说明文字。</p><div className="rr-fields"><label>计时口径<select value={timeBasis} onChange={e => setTimeBasis(e.target.value as 'per_batch' | 'per_unit')}><option value="per_unit">按工序计量单位</option><option value="per_batch">按整批报工</option></select></label><label>{timeBasis === 'per_batch' ? '整批标准工时（秒）' : '单个单位工时（秒）'}<input type="number" min="0" step="0.001" value={standardSeconds} onChange={e => setStandardSeconds(e.target.value)} /></label><label>每套计量单位数<input type="number" min="1" step="1" value={unitsPerProduct} onChange={e => setUnitsPerProduct(e.target.value)} /></label><label>准备工时（秒）<input type="number" min="0" step="0.001" value={setupSeconds} onChange={e => setSetupSeconds(e.target.value)} /></label></div></article>}
        <footer className="rr-confirm"><div><strong>{preview.canResolve ? '确认后自动继续原报工' : '等待处理账号完成核对'}</strong><small>{preview.canResolve ? '成功后同步核销、计工并完成账户消息。' : '处理成功后可在此查看回执，无需再次申报。'}</small></div>{submission.canCancel && <button disabled={saving} onClick={() => setCancelConfirm(true)}>取消申报</button>}{preview.canResolve && <button className="primary" disabled={!canConfirm} onClick={() => void resolve()}>{saving ? <Loader2 size={19} className="spin" /> : <CheckCircle2 size={19} />}{saving ? '正在核销与计工…' : '确认并完成原报工'}</button>}</footer>
      </>}
      {cancelConfirm && submission.canCancel && <div className="rr-cancel-confirm" role="alertdialog" aria-label="确认取消申报"><div><h3>取消这笔尚未入账的申报？</h3><p>将释放待处理占用并关闭本次待办。已保存的原申报仍可查询。</p><button disabled={saving} onClick={() => setCancelConfirm(false)}>保留申报</button><button disabled={saving} onClick={() => void cancelSubmission()}>确认取消申报</button></div></div>}
      {submission.status === 'COMPLETED' && <div className="rr-complete" role="status"><CheckCircle2 size={32} /><div><h3>原报工已完成</h3><p>数量已核销，工时已入账。无需重新报工。</p><small>完成时间 {displayTime(submission.completedAt)} · 完工记录 {submission.completionId || '已关联'}</small></div></div>}
    </> : <div className="rr-empty"><ClipboardCheck size={44} /><h2>选择一条申报</h2><p>核对来源和工时，处理后自动继续原报工。</p></div>}</section></div>
  </main>;
}
