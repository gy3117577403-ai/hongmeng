'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Archive, CheckCircle2, ChevronRight, ClipboardCheck, FileImage, Save, Send, ShieldCheck, Users } from 'lucide-react';
import { QualityPeopleFields, QualityAssigneeSelect, type QualityAssignee } from '@/components/QualityAssigneeSelect';
import QualityOperatorsPicker, { QualityOperatorTags } from './QualityOperatorsPicker';
import { qualityTaskCauses, qualityOperators, qualityTaskSupplement, QUALITY_TASK_SUPPLEMENT_FIELDS, type QualityOperatorAssignments } from '@/lib/quality-direct-shared';
import { useQualityDraft } from './useQualityDraft';
import { QualityDraftNotice } from './QualityDraftNotice';
import { qualityWorkflowView, qualityEventTitle, qualityDate, QUALITY_PHASE_LABELS, QUALITY_TASK_LABELS } from '@/lib/quality-workbench';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer, PreviewModal } from '@/components/PdfViewer';
import { QUALITY_ANALYSIS_FIELDS, QUALITY_PROBLEM_CATEGORIES, qualityAnalysisIssues, qualityTaskPath } from '@/lib/quality-workflow-shared';
import type { CurrentUserDTO, InternalQualityRiskDTO, InternalQualityRiskTaskDTO, InternalQualityRiskAttachmentDTO } from '@/types';

type Action = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
const taskLabels = QUALITY_TASK_LABELS;

export function QualityEvidenceGallery({ attachments }: { attachments: InternalQualityRiskAttachmentDTO[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [pdf, setPdf] = useState<InternalQualityRiskAttachmentDTO | null>(null);
  const images = attachments.filter(item => item.mimeType.startsWith('image/'));
  const active = index === null ? null : images[index];
  return <><div className="qv3-evidence">{attachments.map(item => <div key={item.id}>{item.mimeType.startsWith('image/') ? <button type="button" aria-label={`放大照片 ${item.caption || item.displayName}`} onClick={() => setIndex(images.findIndex(image => image.id === item.id))}><img src={item.contentUrl} alt={item.caption || item.displayName} loading="lazy" /></button> : <button type="button" onClick={() => setPdf(item)}><FileImage />预览 PDF / 文件</button>}<small>{item.caption || item.displayName}</small></div>)}{!attachments.length && <p className="qv3-muted">暂无照片；以问题描述和处理记录为准。</p>}</div>
    {pdf && <PreviewModal title={pdf.displayName} onClose={() => setPdf(null)}><PdfViewer fileId={pdf.id} title={pdf.displayName} contentUrl={pdf.contentUrl} downloadUrl={pdf.contentUrl} /></PreviewModal>}
    {active && <PreviewModal title={`${active.caption || active.displayName} · ${index! + 1}/${images.length}`} onClose={() => setIndex(null)}><ImageViewer fileId={active.id} title={active.caption || active.displayName} contentUrl={active.contentUrl} downloadUrl={active.contentUrl} page={index! + 1} pageCount={images.length} onPageChange={page => setIndex(page - 1)} /></PreviewModal>}
  </>;
}

function TaskCard({ task, report, user, run, busy, users, onUploaded }: { task: InternalQualityRiskTaskDTO; report: InternalQualityRiskDTO; user: CurrentUserDTO; run: Action; busy: boolean; users: QualityAssignee[]; onUploaded: (file: File, taskId: string) => Promise<void> }) {
  const direct = (report.workflowVersion || 2) >= 4;
  const causes = qualityTaskCauses(task, report);
  const taskDraft = useQualityDraft(user.id + ':task:' + task.id + ':' + (report.reviewRound || 0), { ...qualityTaskSupplement(task), result: task.result || '', actionTaken: task.actionTaken || '', occurrenceCause: causes.occurrenceCause, rootCause: causes.rootCause, operators: qualityOperators(task.operators) });
  const { result, actionTaken } = taskDraft.value;
  const occurrenceCause = taskDraft.value.occurrenceCause ?? causes.occurrenceCause, rootCause = taskDraft.value.rootCause ?? causes.rootCause;
  const operators = qualityOperators(taskDraft.value.operators ?? task.operators);
  const setField = (field: 'result' | 'actionTaken' | 'occurrenceCause' | 'rootCause' | typeof QUALITY_TASK_SUPPLEMENT_FIELDS[number][0], value: string) => taskDraft.setValue(current => ({ ...current, [field]: value }));
  async function saveTask(action: string) { const submitted = { ...taskDraft.value, result, actionTaken, occurrenceCause, rootCause, operators }; if (await run(action, { taskId: task.id, ...submitted, operatorIds: operators.map(item => item.id) })) taskDraft.saved(submitted); }
  const [dueAt, setDueAt] = useState(qualityDate(task.dueAt));
  const [dueReason, setDueReason] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [reason, setReason] = useState('');
  const handling = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status);
  const own = task.ownerUserId === user.id;
  const editable = own && handling && task.status === 'IN_PROGRESS';
  return <details open={own || undefined} className={`qv3-task ${own ? 'is-own' : ''}`} id={`task-${task.id}`}>
    <summary><span className="qv3-avatar"><Users size={19} /></span><div><h3>{task.ownerName || '待指派'} {own && <em>我的任务</em>}</h3><small>{task.department} · 主要责任人</small></div><b className={`qv3-status ${task.status.toLowerCase()}`}>{taskLabels[task.status]}</b></summary>
    <div className="qv4-task-body"><p className="qv4-task-due">截止：{qualityDate(task.dueAt) || '未设置'} · {task.attachmentCount} 份证据</p><p className="qv3-task-requirement"><b>需要处理：</b>{task.requirement || report.defectPhenomenon}</p>
    {task.reviewNote && <p className="qv3-return-note"><b>上次意见：</b>{task.reviewNote}</p>}
    {own && handling && task.status === 'TODO' && <button className="primary" disabled={busy} onClick={() => void run('START_TASK', { taskId: task.id })}>接单并开始处理<ChevronRight size={16} /></button>}
    {editable ? <>
      {direct && <div className="qv3-form-pair"><label>发生原因 <b>*</b><textarea rows={3} value={occurrenceCause} onChange={event => setField('occurrenceCause', event.target.value)} placeholder="问题是怎样发生的" /></label><label>根本原因 <b>*</b><textarea rows={3} value={rootCause} onChange={event => setField('rootCause', event.target.value)} placeholder="导致问题的根本原因" /></label></div>}
      <div className="qv3-form-pair"><label>采取了什么措施 <b>*</b><textarea rows={3} value={actionTaken} onChange={event => setField('actionTaken', event.target.value)} placeholder="记录实际调整、替换、复测等处理动作" /></label><label>处理结果 <b>*</b><textarea rows={3} value={result} onChange={event => setField('result', event.target.value)} placeholder="记录处理后的状态与结果" /></label></div>
      {direct && <details className="qd-task-supplement"><summary>补充处理说明 <small>流出原因、遏制与预防措施、作业要求</small></summary><div className="qv3-form-pair">{QUALITY_TASK_SUPPLEMENT_FIELDS.map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={taskDraft.value[key] || ''} onChange={event => setField(key, event.target.value)} placeholder="按需填写" /></label>)}</div></details>}
      {direct && <QualityOperatorsPicker value={operators} disabled={busy} onChange={operators => taskDraft.setValue(current => ({ ...current, operators }))} />}
      <div className="qv3-actions"><label className="qv3-upload">添加处理后照片 / 文件<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void onUploaded(file, task.id); event.target.value = ''; }} /></label><button disabled={busy || taskDraft.conflict} onClick={() => void saveTask('SAVE_TASK')}><Save size={16} />保存草稿</button><button className="primary" disabled={busy || taskDraft.conflict || !result.trim() || !actionTaken.trim() || direct && (!occurrenceCause.trim() || !rootCause.trim())} onClick={() => void saveTask('COMPLETE_TASK')}><CheckCircle2 size={16} />提交处理结果</button></div>
      {direct && <small className="qv3-muted">所有责任人提交后，自动进入品质确认。</small>}
      </> : <>
      {direct && (causes.occurrenceCause || causes.rootCause) && <div className="qv3-form-pair qv3-readonly"><section><strong>发生原因{causes.legacy && '（沿用原记录）'}</strong><p>{causes.occurrenceCause || '待补充'}</p></section><section><strong>根本原因{causes.legacy && '（沿用原记录）'}</strong><p>{causes.rootCause || '待补充'}</p></section></div>}
      {(task.actionTaken || task.result) && <div className="qv3-form-pair qv3-readonly"><section><strong>实际措施</strong><p>{task.actionTaken || '旧记录未单列措施'}</p></section><section><strong>处理结果</strong><p>{task.result || '待处理人填写'}</p></section></div>}
      {QUALITY_TASK_SUPPLEMENT_FIELDS.some(([key]) => qualityTaskSupplement(task)[key]) && <details className="qd-task-supplement"><summary>补充处理说明</summary>{QUALITY_TASK_SUPPLEMENT_FIELDS.filter(([key]) => qualityTaskSupplement(task)[key]).map(([key,label]) => <p key={key}><b>{label}：</b>{qualityTaskSupplement(task)[key]}</p>)}</details>}
      {qualityOperators(task.operators).length > 0 && <div className="qd-task-operators"><strong>作业人员</strong><QualityOperatorTags people={qualityOperators(task.operators)} /></div>}
      </>}
    {editable && <QualityDraftNotice draft={taskDraft} busy={busy} />}
    {report.attachments.some(item => item.taskId === task.id) && <QualityEvidenceGallery attachments={report.attachments.filter(item => item.taskId === task.id)} />}
    {handling && ['TODO', 'IN_PROGRESS'].includes(task.status) && ((!direct && report.ownerUserId === user.id) || report.createdById === user.id && user.access.capabilities.includes('QUALITY:CREATE') || user.access.capabilities.includes('QUALITY:UPDATE')) && <details><summary>调整截止日期</summary><label>新的截止日期（留空取消期限）<input type="date" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label><label>调整原因<textarea rows={2} value={dueReason} onChange={event => setDueReason(event.target.value)} /></label><button disabled={busy || !dueReason.trim()} onClick={async () => { if (await run('SET_TASK_DEADLINE', { taskId: task.id, dueAt, reason: dueReason })) setDueReason(''); }}>保存任务期限</button></details>}
    {handling && task.status !== 'CANCELLED' && ((!direct && report.ownerUserId === user.id) || report.createdById === user.id && user.access.capabilities.includes('QUALITY:CREATE') || user.access.capabilities.includes('QUALITY:UPDATE')) && <details><summary>交接责任人</summary><QualityAssigneeSelect value={newOwner} onChange={setNewOwner} users={users.filter(item => item.id !== report.reviewerUserId)} label="交给谁处理" /><label>交接原因<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} /></label><button disabled={busy || !newOwner || !reason.trim()} onClick={() => void run('REASSIGN', { taskId: task.id, ownerUserId: newOwner, reason })}>确认交接（保留已有结果）</button></details>}
  </div></details>;
}

export default function QualityWorkflowPanel({ report, user, users, reviewMode = false, onUpdated, onEditDraft, embedded = false }: {
  report: InternalQualityRiskDTO; user: CurrentUserDTO; users: QualityAssignee[]; reviewMode?: boolean;
  onUpdated: (report: InternalQualityRiskDTO) => void; onEditDraft?: () => void; embedded?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const analysisDraft = useQualityDraft(user.id + ':analysis:' + report.id + ':' + (report.reviewRound || 0), Object.fromEntries(QUALITY_ANALYSIS_FIELDS.map(([key]) => [key, report[key] || ''])));
  const analysis = analysisDraft.value, setAnalysis = analysisDraft.setValue;
  const reviewDraft = useQualityDraft(user.id + ':review:' + report.id + ':' + (report.reviewRound || 0), { result: report.reviews?.[0]?.result || '' });
  const result = reviewDraft.value.result, setResult = (result: string) => reviewDraft.setValue({ result });
  const [additionalDue, setAdditionalDue] = useState('');
  const [comment, setComment] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const flow = report.workflow || qualityWorkflowView(report);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnIds, setReturnIds] = useState<string[]>([]);
  const [newReviewer, setNewReviewer] = useState('');
  const [reviewerReason, setReviewerReason] = useState('');
  const [additionalOwner, setAdditionalOwner] = useState('');
  const [additionalRequirement, setAdditionalRequirement] = useState('');
  const [people, setPeople] = useState({ responsibleUserIds: report.responsibleUserIds?.length ? report.responsibleUserIds : report.ownerUserId ? [report.ownerUserId] : [], ownerUserId: report.ownerUserId || '', reviewerUserId: report.reviewerUserId || '', operatorAssignments: (report.operatorAssignments || {}) as QualityOperatorAssignments });
  const [category, setCategory] = useState(report.problemCategory || 'PROCESS');
  const [selectedRound, setSelectedRound] = useState(report.reviewRound || 0);
  const latestReview = report.reviews?.[0];
  const review = report.reviews?.find(item => item.round === selectedRound) || latestReview;
  useEffect(() => { setSelectedRound(report.reviewRound || 0); setError(''); setReturnOpen(false); }, [report.id, report.reviewRound]); // eslint-disable-line react-hooks/exhaustive-deps
  const handling = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status);
  const direct = (report.workflowVersion || 2) >= 4;
  const isLead = !direct && report.ownerUserId === user.id;
  const canReview = reviewMode && report.reviewerUserId === user.id && ['VERIFYING', 'PENDING_CLOSE'].includes(report.status) && review?.id === latestReview?.id;
  const snapshot = review?.snapshot as { submissionMode?: string; defectPhenomenon?: string; analysis?: Record<string, string>; tasks?: InternalQualityRiskTaskDTO[]; attachments?: InternalQualityRiskAttachmentDTO[] } | undefined;
  const fields = reviewMode && snapshot?.analysis ? snapshot.analysis : analysis;
  const photos = reviewMode && snapshot?.attachments ? snapshot.attachments : report.attachments;
  const tasks = reviewMode && snapshot?.tasks ? snapshot.tasks : report.tasks;
  const issues = qualityAnalysisIssues(analysis);
  async function run(action: string, payload: Record<string, unknown> = {}) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/quality/internal-risks/${report.id}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload: ['CONFIGURE', 'RETURN'].includes(action) ? { ...payload, workflowVersion: 4 } : payload, expectedVersion: report.version }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '操作失败');
      onUpdated(body.report); if (['SAVE_ANALYSIS', 'SUBMIT_REVIEW'].includes(action)) analysisDraft.saved(payload as Record<string, string>); if (['SAVE_REVIEW', 'APPROVE'].includes(action)) reviewDraft.saved({ result: String(payload.result || '') }); setNotice(action === 'SUBMIT_REVIEW' ? '已提交品质确认，等待指定人员验证。' : action === 'COMPLETE_TASK' ? body.report.status === 'VERIFYING' ? '处理结果已提交，已自动送品质确认。' : '处理结果已提交，等待其他责任人完成。' : '已保存');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function upload(file: File, taskId: string) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('taskId', taskId); form.set('category', 'SOLUTION');
      const response = await fetch(`/api/quality/internal-risks/${report.id}/attachments`, { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '上传失败'); onUpdated(body.report); setNotice('附件已存入对象存储');
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); } finally { inFlight.current = false; setBusy(false); }
  }
  async function refreshRecord() { setRefreshing(true); try { const response = await fetch(user.access.capabilities.includes('QUALITY:READ') ? '/api/quality/internal-risks/' + report.id : '/api/quality-tasks?reportId=' + report.id, { cache: 'no-store' }); const body = await response.json(); if (!response.ok) throw Error(body.error); const next = body.report || body.reports?.find((item: InternalQualityRiskDTO) => item.id === report.id); if (!next) throw Error('当前任务已不在你的处理范围'); onUpdated(next); } catch (error) { setError(error instanceof Error ? error.message : '刷新失败'); } finally { setRefreshing(false); } }
  const legacy = (report.workflowVersion || 2) < 3;
  const canConfigure = !report.deletedAt && report.status !== 'ARCHIVED' && (legacy || report.status === 'DRAFT' || report.status === 'REVISING') && (isLead || report.createdById === user.id || user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE'));
  return <div className={`qv3-panel ${reviewMode ? 'qv3-review-layout' : ''}`}>
    {!embedded && <div className="qv3-context"><div><small>{report.reportNo} · {reviewMode ? '品质确认' : '异常工单'}</small><h2>{qualityEventTitle(report)}</h2></div><span>{flow.activeTasks} 项责任任务 · 品质确认 <b>{report.reviewerName || '待指定'}</b></span></div>}
    <nav className="qv3-progress" aria-label="异常处理阶段">{Object.entries(QUALITY_PHASE_LABELS).filter(([key]) => key !== 'SUMMARIZING').map(([key, label], index) => <span aria-current={flow.phase === key ? 'step' : undefined} className={flow.phase === key ? 'current' : ''} key={key}><b>{index + 1}</b>{label}</span>)}</nav>
    <section className="qv4-next"><div><span className={'qv4-phase phase-' + flow.phase.toLowerCase()}>{flow.label}</span>{flow.returned && <em>退回补充</em>}{flow.revising && <em>修订中</em>}{flow.overdueTasks > 0 && <em className="overdue">{flow.overdueTasks} 项逾期</em>}<h3>{flow.next}</h3><p>{flow.waitingNames.length ? '当前等待：' + flow.waitingNames.join('、') : '按归档和权限要求继续'} · {flow.submittedTasks}/{flow.activeTasks} 项已提交{flow.unaccepted > 0 ? ' · ' + flow.unaccepted + ' 人待接单' : ''}</p></div><nav>
      {report.status === 'DRAFT' && onEditDraft && <button className="primary" onClick={onEditDraft}>完善异常工单</button>}
      {handling && <button className="primary" onClick={() => document.getElementById(flow.phase === 'SUMMARIZING' ? 'quality-analysis' : 'quality-tasks')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{flow.phase === 'SUMMARIZING' ? isLead ? '完善汇总' : '查看汇总' : '查看处理任务'}</button>}
      {report.status === 'VERIFYING' && report.reviewerUserId === user.id && !reviewMode && <Link className="primary" href={qualityTaskPath(report.id, null, true)}>进入品质确认</Link>}
      {report.status === 'PENDING_CLOSE' && !embedded && user.access.capabilities.includes('QUALITY:READ') && <Link href={'/workspace/quality/internal-risks?reportId=' + report.id}>检查并归档</Link>}
    </nav></section>
    {report.reviewBlockReason && <p className="qv3-return-note">{report.reviewBlockReason}。处理结果已保留，请在下方“人员与分工管理”中重新指定品质确认人。</p>}{error && <div role="alert" className="qv3-error">{error}<button disabled={refreshing || busy} onClick={() => void refreshRecord()}>读取最新记录（保留草稿）</button></div>}{notice && <p role="status" className="qv3-notice">{notice}</p>}
    {canConfigure && <section className="qv3-card"><h3>{legacy ? '沿用现有事实，确认新流程分工' : '发起信息与责任分工'}</h3>{legacy && <p>保留已有任务和证据；确认后进入协同处理，再按新规则提交品质确认。历史归档不改动。</p>}<label>问题归属<select value={category} onChange={event => setCategory(event.target.value)}>{QUALITY_PROBLEM_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><QualityPeopleFields ids={people.responsibleUserIds} operators={people.operatorAssignments} reviewer={people.reviewerUserId} users={users} onChange={setPeople} /><div className="qv3-actions">{report.status === 'DRAFT' && onEditDraft && <button onClick={onEditDraft}>补充实际问题与产品</button>}<button disabled={busy} onClick={() => void run('CONFIGURE', { ...people, problemCategory: category })}>保存责任分工</button>{!legacy && report.status === 'DRAFT' && <button className="primary" disabled={busy} onClick={() => void run('SUBMIT')}>提交并分派</button>}</div></section>}
    {report.qualitySource && <details className="qv4-source"><summary><strong>来源检验：{report.qualitySource.code} · V{report.qualitySource.version}</strong></summary><p>{report.qualitySource.description}</p><Link href={'/workspace/quality/data?recordId=' + report.qualitySource.id}>查看来源记录（按质量数据权限）</Link><small>此处保留发起时的版本摘要，来源后续修改不会覆盖本次事实。</small></details>}
    <section className="qv3-card qv3-problem"><h3>本次具体问题</h3><p>{reviewMode ? snapshot?.defectPhenomenon || report.defectPhenomenon : report.defectPhenomenon || '请先补充问题事实'}</p><small>关联产品：{report.products.map(item => item.specification || item.productName).join('、') || '尚未关联'}</small><QualityEvidenceGallery attachments={photos.filter(item => !item.taskId || item.category === 'DEFECT')} /></section>
    {!reviewMode && !legacy && <section className="qv3-tasks" id="quality-tasks"><header><h3><Users size={20} />责任人处理</h3><span>{flow.submittedTasks}/{flow.activeTasks} 项已提交</span></header>{report.tasks.map(task => <TaskCard key={task.id + ":" + report.reviewRound} task={task} report={report} user={user} run={run} busy={busy || Boolean(report.deletedAt)} users={users} onUploaded={upload} />)}{!handling && report.status !== 'DRAFT' && <p className="qv3-frozen"><ShieldCheck size={18} />{report.status === 'VERIFYING' ? '本轮处理资料已冻结，等待指定品质人员独立确认。' : '处理资料已按本轮确认结果冻结，历史证据与结果保留。'}{report.reviewerUserId === user.id && <Link href={qualityTaskPath(report.id, null, true)}>打开品质确认</Link>}</p>}</section>}
    {(reviewMode && snapshot?.submissionMode !== 'ALL_TASKS_COMPLETED' || !reviewMode && !direct && !legacy && report.status !== 'DRAFT') && <section className="qv3-card qv3-analysis" id="quality-analysis"><header><h3>原因与解决方案</h3>{reviewMode && <label>提交轮次<select value={review?.round || ''} onChange={event => setSelectedRound(Number(event.target.value))}>{report.reviews?.map(item => <option key={item.id} value={item.round}>第 {item.round} 轮 · {item.decision === 'PENDING' ? '待确认' : item.decision === 'APPROVED' ? '通过' : '退回'}</option>)}</select></label>}</header>
      {(snapshot?.submissionMode !== 'ALL_TASKS_COMPLETED' || !reviewMode) && <div className="qv3-form-pair">{QUALITY_ANALYSIS_FIELDS.filter(([key]) => !reviewMode || Boolean(fields[key]) || ['occurrenceCause', 'rootCause', 'finalConclusion', 'correctiveAction'].includes(key)).map(([key, label, required]) => <label id={"quality-field-" + key} key={key}>{label}{required && <b> *</b>}{isLead && handling && !reviewMode && !report.deletedAt ? <textarea rows={3} value={fields[key] || ''} onChange={event => setAnalysis({ ...analysis, [key]: event.target.value })} placeholder={required ? `提交品质确认前填写${label}` : '选填'} /> : <p className="qv3-value">{fields[key] || report[key] || '未填写'}</p>}</label>)}</div>}
      {isLead && handling && !reviewMode && !report.deletedAt && <><small>必填项：发生原因、根本原因、处理结论和具体方案；流出原因选填。所有责任人完成后由你统一提交。</small><div className="qv3-actions"><button disabled={busy || analysisDraft.conflict} onClick={() => void run('SAVE_ANALYSIS', analysis)}><Save size={16} />保存分析草稿</button><button className="primary" disabled={busy || analysisDraft.conflict || issues.length > 0 || flow.phase !== 'SUMMARIZING'} onClick={() => void run('SUBMIT_REVIEW', analysis)}><Send size={16} />提交品质确认</button></div><QualityDraftNotice draft={analysisDraft} busy={busy} />{issues.length > 0 && <div className="qv4-blockers">提交前请补齐：{issues.map(item => <button key={item.field} onClick={() => { const field = document.querySelector<HTMLTextAreaElement>('#quality-field-' + item.field + ' textarea'); field?.focus(); field?.scrollIntoView({ block: 'center' }); }}>{item.message.replace('请填写', '')}</button>)}</div>}{flow.phase !== 'SUMMARIZING' && <p className="qv3-muted">需至少一项有效任务，且所有有效任务已提交，才能提交品质确认。</p>}</>}
    </section>}
    {reviewMode && review && <><section className={`qv3-card qv3-review-tasks ${snapshot?.submissionMode === 'ALL_TASKS_COMPLETED' ? 'qv3-analysis' : ''}`}><header><h3>本轮处理结果与作业人员</h3>{snapshot?.submissionMode === 'ALL_TASKS_COMPLETED' && <label>提交轮次<select value={review?.round || ''} onChange={event => setSelectedRound(Number(event.target.value))}>{report.reviews?.map(item => <option key={item.id} value={item.round}>第 {item.round} 轮 · {item.decision === 'PENDING' ? '待确认' : item.decision === 'APPROVED' ? '通过' : '退回'}</option>)}</select></label>}</header>{tasks.map(task => <details key={task.id}><summary><b>{task.ownerName}</b> · {task.result || '无处理结果'}</summary>{task.analysis && <div className="qv3-form-pair qv3-readonly"><section><strong>发生原因</strong><p>{qualityTaskCauses(task, report).occurrenceCause}</p></section><section><strong>根本原因</strong><p>{qualityTaskCauses(task, report).rootCause}</p></section></div>}{qualityOperators(task.operators).length > 0 && <div className="qd-task-operators"><strong>作业人员</strong><QualityOperatorTags people={qualityOperators(task.operators)} /></div>}<p><b>措施：</b>{task.actionTaken || '旧记录未单列'}</p><p><b>结果：</b>{task.result}</p>{QUALITY_TASK_SUPPLEMENT_FIELDS.filter(([key]) => qualityTaskSupplement(task)[key]).map(([key,label]) => <p key={key}><b>{label}：</b>{qualityTaskSupplement(task)[key]}</p>)}<QualityEvidenceGallery attachments={photos.filter(item => item.taskId === task.id)} /></details>)}</section>
      <section className="qv3-card qv3-review" id="quality-confirmation-form"><header><h3><ClipboardCheck size={20} />第 {review.round} 轮品质确认</h3><span>提交于 {new Date(review.submittedAt).toLocaleString('zh-CN', { hour12: false })}</span></header>
        {canReview && report.status === 'VERIFYING' && !report.deletedAt ? <><label>验证结果 <b>必填后才能通过</b><textarea rows={4} value={result} onChange={event => setResult(event.target.value)} placeholder="填写验证方式、实测数据与判定结果，不能替处理人填写原始结果" /></label><div className="qv3-actions"><button disabled={busy || reviewDraft.conflict} onClick={() => void run('SAVE_REVIEW', { result })}><Save size={16} />保存验证草稿</button><button className="primary" disabled={busy || reviewDraft.conflict || !result.trim()} onClick={() => void run('APPROVE', { result })}><ShieldCheck size={16} />验证通过，进入待归档</button></div><QualityDraftNotice draft={reviewDraft} busy={busy} /></> : <p className="qv3-value">{review.result || '等待指定品质人员填写验证结果'}</p>}
        {review.returnReason && <p className="qv3-return-note"><b>本轮退回意见：</b>{review.returnReason}</p>}
        {canReview && !report.deletedAt && <><button className="qv3-return-button" disabled={busy} onClick={() => setReturnOpen(!returnOpen)}>退回指定责任人补充</button>{returnOpen && <section className="qv3-return-form"><label>退回原因 <b>*</b><textarea rows={3} value={returnReason} onChange={event => setReturnReason(event.target.value)} /></label><fieldset><legend>需要补充的责任任务</legend>{report.tasks.filter(task => task.status !== 'CANCELLED').map(task => <label key={task.id}><input type="checkbox" checked={returnIds.includes(task.id)} onChange={() => setReturnIds(returnIds.includes(task.id) ? returnIds.filter(id => id !== task.id) : [...returnIds, task.id])} /><strong>{task.ownerName}</strong><span>{task.title}</span></label>)}</fieldset><p>仅重开勾选任务；原结果、照片及其他人员完成状态均保留。</p><button disabled={busy || !returnReason.trim() || !returnIds.length} onClick={async () => { if (await run('RETURN', { result, reason: returnReason, taskIds: returnIds })) { setReturnOpen(false); setReturnReason(''); setReturnIds([]); } }}>确认定向退回</button></section>}</>}
        {report.status === 'PENDING_CLOSE' && <div className="qv3-actions"><Link href={`/workspace/quality/internal-risks?reportId=${report.id}`}><Archive size={18} />进入异常中心预览并归档</Link><Link target="_blank" href={`/workspace/quality/internal-risks/${report.id}/print-preview`}>预览工单附页</Link></div>}
      </section></>}
    {!reviewMode && !report.deletedAt && (handling || report.status === 'VERIFYING') && <details className="qv3-card qv4-management"><summary>人员与分工管理</summary>    {!reviewMode && !report.deletedAt && (handling || report.status === 'VERIFYING') && (user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE')) && <details className="qv3-card"><summary>品质确认人交接（人员变更时使用）</summary><QualityAssigneeSelect label="新的品质确认人" value={newReviewer} onChange={setNewReviewer} users={users.filter(item => item.canReview && !report.tasks.some(task => task.ownerUserId === item.id && task.status !== 'CANCELLED'))} /><label>交接原因<textarea rows={2} value={reviewerReason} onChange={event => setReviewerReason(event.target.value)} /></label><button disabled={busy || !newReviewer || !reviewerReason.trim()} onClick={() => void run('CHANGE_REVIEWER', { reviewerUserId: newReviewer, reason: reviewerReason })}>确认交接并保留审计</button></details>}    {!reviewMode && !report.deletedAt && handling && (isLead || user.access.capabilities.includes('QUALITY:UPDATE')) && <details className="qv3-card"><summary>增补协同人员</summary><QualityAssigneeSelect label="增补责任人" value={additionalOwner} onChange={setAdditionalOwner} users={users.filter(item => item.id !== report.reviewerUserId && !report.tasks.some(task => task.ownerUserId === item.id && task.status !== 'CANCELLED'))} /><label>需要协同处理什么<textarea rows={2} value={additionalRequirement} onChange={event => setAdditionalRequirement(event.target.value)} /></label><label>截止日期（选填）<input type="date" value={additionalDue} onChange={event => setAdditionalDue(event.target.value)} /></label><button disabled={busy || !additionalOwner || !additionalRequirement.trim()} onClick={async () => { if (await run('ADD_TASK', { ownerUserId: additionalOwner, requirement: additionalRequirement, dueAt: additionalDue })) { setAdditionalOwner(''); setAdditionalRequirement(''); } }}>创建任务并通知责任人</button></details>}</details>}
    {!report.deletedAt && report.status !== 'ARCHIVED' && (isLead || report.reviewerUserId === user.id || user.access.capabilities.includes('QUALITY:UPDATE') || report.tasks.some(task => task.ownerUserId === user.id && task.status !== 'CANCELLED')) && <details className="qv3-card qv4-comment"><summary>补充协同说明</summary><label>说明内容<textarea rows={3} value={comment} maxLength={3000} onChange={event => setComment(event.target.value)} placeholder="补充背景或沟通信息；正式结果仍在责任任务内提交" /></label><button disabled={busy || !comment.trim()} onClick={async () => { if (await run('COMMENT', { content: comment })) setComment(''); }}>保存说明到流转记录</button></details>}
    <details className="qv3-card qv3-notification-log"><summary>企业微信通知与处理记录</summary><p>“企微已接收”不代表已读或接单；处理人员仍需点击链接操作。</p>{report.notifications?.map(item => <article className="qv3-notification" key={item.id}><strong>{item.title}</strong><span>{({ PENDING: '等待发送', SENDING: '发送中', WAITING_CONFIG: '等待配置', FAILED: item.attempts >= 8 ? '重试已用尽' : '发送失败，等待重试', SENT: '企微已接收', SKIPPED: '已取消通知' } as Record<string, string>)[item.state] || item.state}</span>{item.lastError && <small>{item.lastError}</small>}{!report.deletedAt && ['FAILED', 'WAITING_CONFIG'].includes(item.state) && (user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE')) && <button disabled={busy} onClick={() => void run('RETRY_NOTIFICATION', { notificationId: item.id })}>重新排队</button>}</article>)}{!report.notifications?.length && <p>暂无企微通知记录</p>}<div>{report.activities.slice(0, 20).map(item => <p key={item.id}><b>{item.actorName}</b> · {item.content} <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></p>)}</div></details>
  </div>;
}
