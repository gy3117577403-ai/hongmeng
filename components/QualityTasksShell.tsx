'use client';
import { useCallback, useEffect, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { QualityTaskActions } from '@/components/QualityTaskActions';
import { QualityAssigneeSelect, type QualityAssignee } from '@/components/QualityAssigneeSelect';
import { RefreshCw, ClipboardCheck, UploadCloud, Save, Send } from 'lucide-react';
import type { CurrentUserDTO, InternalQualityRiskDTO } from '@/types';

const solutionFields = [['rootCause', '已确认的原因'], ['correctiveAction', '具体解决方案'], ['containmentAction', '临时遏制措施（选填）'], ['preventiveAction', '防止再发（选填）'], ['requiredAction', '本批作业要求（选填）'], ['finalConclusion', '处理结论']] as const;
export default function QualityTasksShell({ user }: { user: CurrentUserDTO }) {
  const [reports, setReports] = useState<InternalQualityRiskDTO[]>([]);
  const [users, setUsers] = useState<QualityAssignee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newTask, setNewTask] = useState({ title: '', department: '', ownerUserId: '', requirement: '', dueAt: '' });
  const [taskOpen, setTaskOpen] = useState(false);
  const selected = reports.find(item => item.id === selectedId);
  const ownReport = selected?.ownerUserId === user.id;
  const canVerify = user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW');
  const update = useCallback((report: InternalQualityRiskDTO) => {
    setReports(items => items.map(item => item.id === report.id ? report : item));
    setDraft(Object.fromEntries(solutionFields.map(([key]) => [key, report[key] || ''])));
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/quality-tasks', { cache: 'no-store' }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || '加载失败');
      setReports(body.reports); setUsers(body.assignees);
      setSelectedId(current => body.reports.some((item: InternalQualityRiskDTO) => item.id === current) ? current : new URLSearchParams(window.location.search).get('reportId') || body.reports[0]?.id || '');
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDraft(Object.fromEntries(solutionFields.map(([key]) => [key, selected?.[key] || '']))); }, [selectedId, selected?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mutate(url: string, data: unknown, method = 'POST') {
    setBusy(true); setError('');
    try {
      const response = await fetch(url, { method, headers: data instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: data instanceof FormData ? data : JSON.stringify(data) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || '操作失败');
      if (body.report) update(body.report);
      setTaskOpen(false);
      return body.report as InternalQualityRiskDTO | undefined;
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function submitOverallVerification() {
    if (!selected) return;
    const dirty = solutionFields.some(([key]) => (draft[key] || '') !== (selected[key] || ''));
    const current = dirty ? await mutate(`/api/quality-tasks/${selected.id}/solution`, { ...draft, expectedVersion: selected.version }, 'PATCH') : selected;
    if (current) await mutate(`/api/quality/internal-risks/${current.id}/workflow`, { status: 'VERIFYING', expectedVersion: current.version });
  }
  const displayed = reports.filter(item => `${item.reportNo} ${item.title}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="hm-workbench-root hm-cockpit-root quality-tasks-root"><AppWorkbenchHeader user={user} activeHref="/workspace/quality-tasks" subtitle="分配给我的质量任务" menuItems={[]} hideHeader />
    <header className="quality-tasks-head"><ClipboardCheck /><div><h1>我的质量任务</h1><small>只显示分配给你的事件；接单、补充方案、提交质量验证。</small></div><button disabled={loading} onClick={() => void load()}><RefreshCw size={18} />刷新</button></header>
    {error && <p role="alert" className="risk-form-error">{error}</p>}
    <div className="quality-tasks-grid"><aside><input aria-label="搜索我的任务" placeholder="搜索编号 / 标题" value={query} onChange={event => setQuery(event.target.value)} />{displayed.map(report => <button key={report.id} className={report.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(report.id)}><small>{report.reportNo}</small><strong>{report.title}</strong><span>{report.tasks.filter(task => task.ownerUserId === user.id && !['VERIFIED', 'CANCELLED'].includes(task.status)).length} 项待处理 · {report.ownerUserId === user.id ? '我主责' : '我协同'}</span></button>)}{!displayed.length && <p>{loading ? '正在加载…' : '暂无分配给你的质量任务'}</p>}</aside>
      <section className="quality-task-detail">{selected ? <><header><small>{selected.reportNo} · {selected.ownerName} 主责</small><h2>{selected.title}</h2><p><b>实际问题：</b>{selected.defectPhenomenon}</p><p><b>产品：</b>{selected.products.map(product => product.specification || product.productName).join('、')}</p></header>
        {selected.tasks.filter(task => ownReport || canVerify || task.ownerUserId === user.id).map(task => <article className="quality-assigned-task" key={task.id}><h3>{task.isPrimary ? '主责处理' : task.department} · {task.title}</h3><p>{task.ownerName} · {task.dueAt ? `截止 ${task.dueAt.slice(0, 10)}` : '未设置期限'} · {({ TODO: '待接单', IN_PROGRESS: '处理中', COMPLETED: '待验证', VERIFIED: '已通过', CANCELLED: '已取消' })[task.status]}</p>{task.result && <p><b>处理结果：</b>{task.result}</p>}{selected.status !== 'ARCHIVED' && <><QualityTaskActions reportId={selected.id} task={task} canManage={Boolean(ownReport)} canVerify={canVerify} canHandle={task.ownerUserId === user.id} users={users} onUpdated={update} />{task.ownerUserId === user.id && <label className="quality-task-upload"><UploadCloud size={16} />上传本任务证据<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { const file = event.target.files?.[0]; if (!file) return; const data = new FormData(); data.set('file', file); data.set('taskId', task.id); data.set('category', 'SOLUTION'); void mutate(`/api/quality/internal-risks/${selected.id}/attachments`, data); event.target.value = ''; }} /></label>}</>}</article>)}
        {ownReport && selected.status !== 'ARCHIVED' && <><section className="quality-task-solution"><header><h3>汇总处理方案</h3><button onClick={() => setTaskOpen(!taskOpen)}>分派协同子任务</button></header>{solutionFields.map(([key, label]) => <label key={key}>{label}<textarea rows={3} value={draft[key] || ''} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}<footer><button className="primary" disabled={busy} onClick={() => void mutate(`/api/quality-tasks/${selected.id}/solution`, { ...draft, expectedVersion: selected.version }, 'PATCH')}><Save size={16} />保存方案</button>{['COLLABORATING', 'REVISING'].includes(selected.status) && <button disabled={busy} onClick={() => void submitOverallVerification()}><Send size={16} />提交整体验证</button>}</footer></section>
          {taskOpen && <section className="quality-task-solution"><h3>新增协同任务</h3>{(['title', 'department', 'requirement', 'dueAt'] as const).map(key => <label key={key}>{{ title: '任务标题', department: '责任部门', requirement: '交付要求', dueAt: '截止日期' }[key]}<input type={key === 'dueAt' ? 'date' : 'text'} value={newTask[key]} onChange={event => setNewTask({ ...newTask, [key]: event.target.value })} /></label>)}<QualityAssigneeSelect value={newTask.ownerUserId} users={users} onChange={ownerUserId => setNewTask({ ...newTask, ownerUserId })} /><button className="primary" disabled={busy} onClick={() => void mutate(`/api/quality/internal-risks/${selected.id}/tasks`, newTask)}>分派任务</button></section>}</>}
        <section><h3>证据与方案附件</h3><div className="quality-task-attachments">{selected.attachments.map(item => <a key={item.id} href={item.contentUrl} target="_blank" rel="noreferrer">{item.mimeType.startsWith('image/') && <img src={item.contentUrl} alt={item.caption || item.displayName} />}<span>{item.caption || item.displayName}</span></a>)}</div></section>
      </> : <p>选择左侧事件开始处理</p>}</section></div>
  </main>;
}
