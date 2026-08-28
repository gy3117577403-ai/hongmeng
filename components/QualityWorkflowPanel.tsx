'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, ChevronRight, ClipboardCheck, FileImage, Save, Send, ShieldCheck, Users } from 'lucide-react';
import { QualityPeopleFields, QualityAssigneeSelect, type QualityAssignee } from '@/components/QualityAssigneeSelect';
import { ImageViewer } from '@/components/ImageViewer';
import { PreviewModal } from '@/components/PdfViewer';
import { QUALITY_ANALYSIS_FIELDS, QUALITY_PROBLEM_CATEGORIES, qualityAnalysisIssues, qualityTaskPath } from '@/lib/quality-workflow-shared';
import type { CurrentUserDTO, InternalQualityRiskDTO, InternalQualityRiskTaskDTO, InternalQualityRiskAttachmentDTO } from '@/types';

type Action = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
const taskLabels: Record<string, string> = { TODO: '待接单', IN_PROGRESS: '处理中', COMPLETED: '已完成 · 待汇总', VERIFIED: '品质已通过', CANCELLED: '已取消' };
const stateLabels: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '待接单', CONTAINMENT: '待接单', COLLABORATING: '协同处理中', REVISING: '修订中', VERIFYING: '待品质确认', PENDING_CLOSE: '待归档', ARCHIVED: '已归档' };

export function QualityEvidenceGallery({ attachments }: { attachments: InternalQualityRiskAttachmentDTO[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const images = attachments.filter(item => item.mimeType.startsWith('image/'));
  const active = index === null ? null : images[index];
  return <><div className="qv3-evidence">{attachments.map(item => <div key={item.id}>{item.mimeType.startsWith('image/') ? <button type="button" aria-label={`放大照片 ${item.caption || item.displayName}`} onClick={() => setIndex(images.findIndex(image => image.id === item.id))}><img src={item.contentUrl} alt={item.caption || item.displayName} loading="lazy" /></button> : <a href={item.contentUrl} target="_blank" rel="noreferrer"><FileImage />查看 PDF / 文件</a>}<small>{item.caption || item.displayName}</small></div>)}{!attachments.length && <p className="qv3-muted">暂无照片；以问题描述和处理记录为准。</p>}</div>
    {active && <PreviewModal title={`${active.caption || active.displayName} · ${index! + 1}/${images.length}`} onClose={() => setIndex(null)}><ImageViewer fileId={active.id} title={active.caption || active.displayName} contentUrl={active.contentUrl} downloadUrl={active.contentUrl} page={index! + 1} pageCount={images.length} onPageChange={page => setIndex(page - 1)} /></PreviewModal>}
  </>;
}

function TaskCard({ task, report, user, run, busy, users, onUploaded }: { task: InternalQualityRiskTaskDTO; report: InternalQualityRiskDTO; user: CurrentUserDTO; run: Action; busy: boolean; users: QualityAssignee[]; onUploaded: (file: File, taskId: string) => Promise<void> }) {
  const [result, setResult] = useState(task.result || '');
  const [actionTaken, setActionTaken] = useState(task.actionTaken || '');
  const [newOwner, setNewOwner] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { setResult(task.result || ''); setActionTaken(task.actionTaken || ''); }, [task.id, task.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const handling = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status);
  const own = task.ownerUserId === user.id;
  const editable = own && handling && task.status === 'IN_PROGRESS';
  return <article className={`qv3-task ${own ? 'is-own' : ''}`} id={`task-${task.id}`}>
    <header><span className="qv3-avatar"><Users size={19} /></span><div><h3>{task.ownerName || '待指派'} {own && <em>我的任务</em>}</h3><small>{task.department} · {task.ownerUserId === report.ownerUserId ? '牵头汇总' : '独立负责'}</small></div><b className={`qv3-status ${task.status.toLowerCase()}`}>{taskLabels[task.status]}</b></header>
    <p className="qv3-task-requirement"><b>需要处理：</b>{task.requirement || report.defectPhenomenon}</p>
    {task.reviewNote && <p className="qv3-return-note"><b>上次意见：</b>{task.reviewNote}</p>}
    {own && handling && task.status === 'TODO' && <button className="primary" disabled={busy} onClick={() => void run('START_TASK', { taskId: task.id })}>接单并开始处理<ChevronRight size={16} /></button>}
    {editable ? <><div className="qv3-form-pair"><label>采取了什么措施 <b>*</b><textarea rows={4} value={actionTaken} onChange={event => setActionTaken(event.target.value)} placeholder="记录实际调整、替换、复测等处理动作" /></label><label>处理结果 <b>*</b><textarea rows={4} value={result} onChange={event => setResult(event.target.value)} placeholder="说明处理后状态，不仅填写“已解决”" /></label></div>
      <div className="qv3-actions"><label className="qv3-upload">添加处理后照片 / 文件<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void onUploaded(file, task.id); event.target.value = ''; }} /></label><button disabled={busy} onClick={() => void run('SAVE_TASK', { taskId: task.id, result, actionTaken })}><Save size={16} />保存草稿</button><button className="primary" disabled={busy || !result.trim() || !actionTaken.trim()} onClick={() => void run('COMPLETE_TASK', { taskId: task.id, result, actionTaken })}><CheckCircle2 size={16} />完成我的任务</button></div></>
      : (task.actionTaken || task.result) && <div className="qv3-form-pair qv3-readonly"><section><strong>实际措施</strong><p>{task.actionTaken || '旧记录未单列措施'}</p></section><section><strong>处理结果</strong><p>{task.result || '待处理人填写'}</p></section></div>}
    {report.attachments.some(item => item.taskId === task.id) && <QualityEvidenceGallery attachments={report.attachments.filter(item => item.taskId === task.id)} />}
    {handling && (report.ownerUserId === user.id || user.access.capabilities.includes('QUALITY:UPDATE')) && <details><summary>交接责任人</summary><QualityAssigneeSelect value={newOwner} onChange={setNewOwner} users={users.filter(item => item.id !== report.reviewerUserId)} label="交给谁处理" /><label>交接原因<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} /></label><button disabled={busy || !newOwner || !reason.trim()} onClick={() => void run('REASSIGN', { taskId: task.id, ownerUserId: newOwner, reason })}>确认交接（保留已有结果）</button></details>}
  </article>;
}

export default function QualityWorkflowPanel({ report, user, users, reviewMode = false, onUpdated, onEditDraft }: {
  report: InternalQualityRiskDTO; user: CurrentUserDTO; users: QualityAssignee[]; reviewMode?: boolean;
  onUpdated: (report: InternalQualityRiskDTO) => void; onEditDraft?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnIds, setReturnIds] = useState<string[]>([]);
  const [newReviewer, setNewReviewer] = useState('');
  const [reviewerReason, setReviewerReason] = useState('');
  const [additionalOwner, setAdditionalOwner] = useState('');
  const [additionalRequirement, setAdditionalRequirement] = useState('');
  const [people, setPeople] = useState({ responsibleUserIds: report.responsibleUserIds?.length ? report.responsibleUserIds : report.ownerUserId ? [report.ownerUserId] : [], ownerUserId: report.ownerUserId || '', reviewerUserId: report.reviewerUserId || '' });
  const [category, setCategory] = useState(report.problemCategory || 'PROCESS');
  const [selectedRound, setSelectedRound] = useState(report.reviewRound || 0);
  const latestReview = report.reviews?.[0];
  const review = report.reviews?.find(item => item.round === selectedRound) || latestReview;
  useEffect(() => { setAnalysis(Object.fromEntries(QUALITY_ANALYSIS_FIELDS.map(([key]) => [key, report[key] || '']))); setResult(latestReview?.result || ''); setSelectedRound(report.reviewRound || 0); setError(''); setReturnOpen(false); }, [report.id, report.reviewRound]); // eslint-disable-line react-hooks/exhaustive-deps
  const handling = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status);
  const isLead = report.ownerUserId === user.id;
  const canReview = reviewMode && report.reviewerUserId === user.id && ['VERIFYING', 'PENDING_CLOSE'].includes(report.status) && review?.id === latestReview?.id;
  const snapshot = review?.snapshot as { defectPhenomenon?: string; analysis?: Record<string, string>; tasks?: InternalQualityRiskTaskDTO[]; attachments?: InternalQualityRiskAttachmentDTO[] } | undefined;
  const fields = reviewMode && snapshot?.analysis ? snapshot.analysis : analysis;
  const photos = reviewMode && snapshot?.attachments ? snapshot.attachments : report.attachments;
  const tasks = reviewMode && snapshot?.tasks ? snapshot.tasks : report.tasks;
  const issues = qualityAnalysisIssues(analysis);
  async function run(action: string, payload: Record<string, unknown> = {}) {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/quality/internal-risks/${report.id}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload, expectedVersion: report.version }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '操作失败');
      onUpdated(body.report); setNotice(action === 'SUBMIT_REVIEW' ? '已提交品质确认；通知已入队，实际投递状态见下方。' : '已保存');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false; }
    finally { setBusy(false); }
  }
  async function upload(file: File, taskId: string) {
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('taskId', taskId); form.set('category', 'SOLUTION');
      const response = await fetch(`/api/quality/internal-risks/${report.id}/attachments`, { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '上传失败'); onUpdated(body.report); setNotice('附件已存入对象存储');
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); } finally { setBusy(false); }
  }
  const legacy = (report.workflowVersion || 2) < 3;
  const canConfigure = !report.deletedAt && report.status !== 'ARCHIVED' && (legacy || report.status === 'DRAFT' || report.status === 'REVISING') && (isLead || report.createdById === user.id || user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE'));
  return <div className={`qv3-panel ${reviewMode ? 'qv3-review-layout' : ''}`}>
    <nav className="qv3-progress" aria-label="异常处理阶段">{['质量发起', '责任处理', '品质确认', '归档发布'].map((label, index) => <span className={index === (report.status === 'DRAFT' ? 0 : handling ? 1 : report.status === 'VERIFYING' ? 2 : 3) ? 'current' : ''} key={label}><b>{index + 1}</b>{label}</span>)}</nav>
    <div className="qv3-context"><div><small>{report.reportNo} · {stateLabels[report.status]}</small><h2>{reviewMode ? '品质确认' : report.title}</h2></div><span>牵头 <b>{report.ownerName || '待指定'}</b> · 品质 <b>{report.reviewerName || '待指定'}</b></span></div>
    {!reviewMode && !report.deletedAt && (handling || report.status === 'VERIFYING') && (user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE')) && <details className="qv3-card"><summary>品质确认人交接（人员变更时使用）</summary><QualityAssigneeSelect label="新的品质确认人" value={newReviewer} onChange={setNewReviewer} users={users.filter(item => item.canReview && !report.tasks.some(task => task.ownerUserId === item.id && task.status !== 'CANCELLED'))} /><label>交接原因<textarea rows={2} value={reviewerReason} onChange={event => setReviewerReason(event.target.value)} /></label><button disabled={busy || !newReviewer || !reviewerReason.trim()} onClick={() => void run('CHANGE_REVIEWER', { reviewerUserId: newReviewer, reason: reviewerReason })}>确认交接并保留审计</button></details>}
    {error && <p role="alert" className="qv3-error">{error}</p>}{notice && <p role="status" className="qv3-notice">{notice}</p>}
    {!reviewMode && !report.deletedAt && handling && (isLead || user.access.capabilities.includes('QUALITY:UPDATE')) && <details className="qv3-card"><summary>增补协同人员</summary><QualityAssigneeSelect label="增补责任人" value={additionalOwner} onChange={setAdditionalOwner} users={users.filter(item => item.id !== report.reviewerUserId && !report.tasks.some(task => task.ownerUserId === item.id && task.status !== 'CANCELLED'))} /><label>需要协同处理什么<textarea rows={2} value={additionalRequirement} onChange={event => setAdditionalRequirement(event.target.value)} /></label><button disabled={busy || !additionalOwner || !additionalRequirement.trim()} onClick={async () => { if (await run('ADD_TASK', { ownerUserId: additionalOwner, requirement: additionalRequirement })) { setAdditionalOwner(''); setAdditionalRequirement(''); } }}>创建任务并通知责任人</button></details>}
    {canConfigure && <section className="qv3-card"><h3>{legacy ? '沿用现有事实，确认新流程分工' : '发起信息与责任分工'}</h3>{legacy && <p>保留已有任务和证据；确认后进入协同处理，再按新规则提交品质确认。历史归档不改动。</p>}<label>问题归属<select value={category} onChange={event => setCategory(event.target.value)}>{QUALITY_PROBLEM_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><QualityPeopleFields ids={people.responsibleUserIds} lead={people.ownerUserId} reviewer={people.reviewerUserId} users={users} onChange={setPeople} /><div className="qv3-actions">{report.status === 'DRAFT' && onEditDraft && <button onClick={onEditDraft}>补充实际问题与产品</button>}<button disabled={busy} onClick={() => void run('CONFIGURE', { ...people, problemCategory: category })}>保存责任分工</button>{!legacy && report.status === 'DRAFT' && <button className="primary" disabled={busy} onClick={() => void run('SUBMIT')}>提交并分派</button>}</div></section>}
    <section className="qv3-card qv3-problem"><h3>本次具体问题</h3><p>{reviewMode ? snapshot?.defectPhenomenon || report.defectPhenomenon : report.defectPhenomenon || '请先补充问题事实'}</p><small>关联产品：{report.products.map(item => item.specification || item.productName).join('、') || '尚未关联'}</small><QualityEvidenceGallery attachments={photos.filter(item => !item.taskId || item.category === 'DEFECT')} /></section>
    {!reviewMode && !legacy && <section className="qv3-tasks"><header><h3><Users size={20} />责任人处理</h3><span>{report.tasks.filter(task => ['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(task.status)).length}/{report.tasks.length} 项完成</span></header>{report.tasks.map(task => <TaskCard key={task.id} task={task} report={report} user={user} run={run} busy={busy || Boolean(report.deletedAt)} users={users} onUploaded={upload} />)}{!handling && report.status !== 'DRAFT' && <p className="qv3-frozen"><ShieldCheck size={18} />处理资料已冻结；由指定品质人员在独立页面确认。{report.reviewerUserId === user.id && <Link href={qualityTaskPath(report.id, null, true)}>打开品质确认</Link>}</p>}</section>}
    {(reviewMode || !legacy && report.status !== 'DRAFT') && <section className="qv3-card qv3-analysis"><header><h3>原因与解决方案</h3>{reviewMode && <label>提交轮次<select value={review?.round || ''} onChange={event => setSelectedRound(Number(event.target.value))}>{report.reviews?.map(item => <option key={item.id} value={item.round}>第 {item.round} 轮 · {item.decision === 'PENDING' ? '待确认' : item.decision === 'APPROVED' ? '通过' : '退回'}</option>)}</select></label>}</header>
      <div className="qv3-form-pair">{QUALITY_ANALYSIS_FIELDS.filter(([key]) => !reviewMode || Boolean(fields[key]) || ['occurrenceCause', 'rootCause', 'finalConclusion', 'correctiveAction'].includes(key)).map(([key, label, required]) => <label key={key}>{label}{required && <b> *</b>}{isLead && handling && !reviewMode && !report.deletedAt ? <textarea rows={3} value={fields[key] || ''} onChange={event => setAnalysis({ ...analysis, [key]: event.target.value })} placeholder={required ? `提交品质确认前填写${label}` : '选填'} /> : <p className="qv3-value">{fields[key] || report[key] || '未填写'}</p>}</label>)}</div>
      {isLead && handling && !reviewMode && !report.deletedAt && <><small>必填项：发生原因、根本原因、处理结论和具体方案；流出原因选填。所有责任人完成后由你统一提交。</small><div className="qv3-actions"><button disabled={busy} onClick={() => void run('SAVE_ANALYSIS', analysis)}><Save size={16} />保存分析草稿</button><button className="primary" disabled={busy} onClick={() => void run('SUBMIT_REVIEW', analysis)}><Send size={16} />提交品质确认</button></div>{issues.length > 0 && <p className="qv3-muted">尚缺：{issues.map(item => item.message.replace('请填写', '')).join('、')}</p>}</>}
    </section>}
    {reviewMode && review && <><section className="qv3-card qv3-review-tasks"><h3>本轮提交的责任任务与照片</h3>{tasks.map(task => <details key={task.id}><summary><b>{task.ownerName}</b> · {task.result || '无处理结果'}</summary><p><b>措施：</b>{task.actionTaken || '旧记录未单列'}</p><p><b>结果：</b>{task.result}</p><QualityEvidenceGallery attachments={photos.filter(item => item.taskId === task.id)} /></details>)}</section>
      <section className="qv3-card qv3-review" id="quality-confirmation-form"><header><h3><ClipboardCheck size={20} />第 {review.round} 轮品质确认</h3><span>提交于 {new Date(review.submittedAt).toLocaleString('zh-CN', { hour12: false })}</span></header>
        {canReview && report.status === 'VERIFYING' && !report.deletedAt ? <><label>验证结果 <b>必填后才能通过</b><textarea rows={4} value={result} onChange={event => setResult(event.target.value)} placeholder="填写验证方式、实测数据与判定结果，不能替处理人填写原始结果" /></label><div className="qv3-actions"><button disabled={busy} onClick={() => void run('SAVE_REVIEW', { result })}><Save size={16} />保存验证草稿</button><button className="primary" disabled={busy || !result.trim()} onClick={() => void run('APPROVE', { result })}><ShieldCheck size={16} />验证通过，进入待归档</button></div></> : <p className="qv3-value">{review.result || '等待指定品质人员填写验证结果'}</p>}
        {review.returnReason && <p className="qv3-return-note"><b>本轮退回意见：</b>{review.returnReason}</p>}
        {canReview && !report.deletedAt && <><button className="qv3-return-button" disabled={busy} onClick={() => setReturnOpen(!returnOpen)}>退回指定责任人补充</button>{returnOpen && <section className="qv3-return-form"><label>退回原因 <b>*</b><textarea rows={3} value={returnReason} onChange={event => setReturnReason(event.target.value)} /></label><fieldset><legend>需要补充的责任任务</legend>{report.tasks.filter(task => task.status !== 'CANCELLED').map(task => <label key={task.id}><input type="checkbox" checked={returnIds.includes(task.id)} onChange={() => setReturnIds(returnIds.includes(task.id) ? returnIds.filter(id => id !== task.id) : [...returnIds, task.id])} /><strong>{task.ownerName}</strong><span>{task.title}</span></label>)}</fieldset><p>仅重开勾选任务；原结果、照片及其他人员完成状态均保留。</p><button disabled={busy || !returnReason.trim() || !returnIds.length} onClick={async () => { if (await run('RETURN', { result, reason: returnReason, taskIds: returnIds })) { setReturnOpen(false); setReturnReason(''); setReturnIds([]); } }}>确认定向退回</button></section>}</>}
        {report.status === 'PENDING_CLOSE' && <div className="qv3-actions"><Link href={`/workspace/quality/internal-risks?reportId=${report.id}`}><Archive size={18} />进入异常中心预览并归档</Link><Link target="_blank" href={`/workspace/quality/internal-risks/${report.id}/print-preview`}>预览工单附页</Link></div>}
      </section></>}
    <details className="qv3-card qv3-notification-log"><summary>企业微信通知与处理记录</summary><p>“企微已接收”不代表已读或接单；处理人员仍需点击链接操作。</p>{report.notifications?.map(item => <article className="qv3-notification" key={item.id}><strong>{item.title}</strong><span>{({ PENDING: '等待发送', SENDING: '发送中', WAITING_CONFIG: '等待配置', FAILED: item.attempts >= 8 ? '重试已用尽' : '发送失败，等待重试', SENT: '企微已接收', SKIPPED: '已取消通知' } as Record<string, string>)[item.state] || item.state}</span>{item.lastError && <small>{item.lastError}</small>}{!report.deletedAt && ['FAILED', 'WAITING_CONFIG'].includes(item.state) && (user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE')) && <button disabled={busy} onClick={() => void run('RETRY_NOTIFICATION', { notificationId: item.id })}>重新排队</button>}</article>)}{!report.notifications?.length && <p>暂无企微通知记录</p>}<div>{report.activities.slice(0, 20).map(item => <p key={item.id}><b>{item.actorName}</b> · {item.content} <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></p>)}</div></details>
  </div>;
}
