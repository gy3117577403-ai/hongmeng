'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import QualityWorkflowPanel from '@/components/QualityWorkflowPanel';
import type { QualityAssignee } from '@/components/QualityAssigneeSelect';
import { RefreshCw, ClipboardCheck, ShieldCheck, Search } from 'lucide-react';
import { QUALITY_PROBLEM_CATEGORIES } from '@/lib/quality-workflow-shared';
import type { CurrentUserDTO, InternalQualityRiskDTO } from '@/types';

export default function QualityTasksShell({ user, reviewMode = false }: { user: CurrentUserDTO; reviewMode?: boolean }) {
  const [reports, setReports] = useState<InternalQualityRiskDTO[]>([]);
  const [users, setUsers] = useState<QualityAssignee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const path = reviewMode ? '/workspace/quality-confirmation' : '/workspace/quality-tasks';
  const selected = reports.find(item => item.id === selectedId);
  const pending = (report: InternalQualityRiskDTO) => reviewMode ? report.status === 'VERIFYING' || report.status === 'PENDING_CLOSE' :
    ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status) && (report.ownerUserId === user.id || report.tasks.some(task => task.ownerUserId === user.id && ['TODO', 'IN_PROGRESS'].includes(task.status)));
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(reviewMode ? '/api/quality-confirmation' : '/api/quality-tasks', { cache: 'no-store' }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || '加载失败');
      setReports(body.reports); setUsers(body.assignees);
      const linkId = new URLSearchParams(window.location.search).get('reportId');
      if (linkId && !body.reports.some((item: InternalQualityRiskDTO) => item.id === linkId)) setError('链接所指事件不在你的处理范围，或已回收。请联系发起质量确认分工。');
      setSelectedId(current => body.reports.some((item: InternalQualityRiskDTO) => item.id === current) ? current : linkId || body.reports[0]?.id || '');
      if (linkId) setPendingOnly(false);
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setLoading(false); }
  }, [reviewMode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const task = new URLSearchParams(window.location.search).get('taskId'); if (task && selected) document.getElementById('task-' + task)?.scrollIntoView({ block: 'start' }); }, [selectedId, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const displayed = reports.filter(item => (!pendingOnly || pending(item)) && (!category || item.problemCategory === category) && (item.reportNo + ' ' + item.title + ' ' + item.defectPhenomenon + ' ' + item.products.map(product => product.specification).join(' ')).toLowerCase().includes(query.toLowerCase()));
  return <main className="hm-workbench-root hm-cockpit-root quality-tasks-root qv3-root"><AppWorkbenchHeader user={user} activeHref={path} subtitle={reviewMode ? '品质确认' : '我的质量任务'} menuItems={[]} hideHeader sidebarTriggerTargetId="quality-workflow-navigation-trigger" />
    <header className="qv3-head"><div id="quality-workflow-navigation-trigger" className="hm-cockpit-navigation-trigger" />{reviewMode ? <ShieldCheck /> : <ClipboardCheck />}<div><h1>{reviewMode ? '品质确认' : '我的质量任务'}</h1><small>{reviewMode ? '核对冻结方案 · 验证通过或定向退回' : '先看清问题 · 处理自己的任务 · 牵头人汇总提交'}</small></div><Link href={reviewMode ? '/workspace/quality-tasks' : '/workspace/quality/internal-risks'}>{reviewMode ? '我的处理任务' : '异常中心'}</Link><button disabled={loading} onClick={() => void load()}><RefreshCw size={18} />刷新</button></header>
    {error && <p role="alert" className="qv3-error">{error}</p>}
    <div className="qv3-shell-grid"><aside className="qv3-list"><header><b>{reviewMode ? '待我确认' : '待我处理'} <em>{reports.filter(pending).length}</em></b><label><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)} />仅待办</label></header><label className="qv3-search"><Search size={17} /><input aria-label="搜索质量任务" placeholder="问题、产品、编号" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="按问题归属筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部问题归属</option>{QUALITY_PROBLEM_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      {displayed.map(report => <button key={report.id} className={report.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(report.id); window.history.replaceState(null, '', path + '?reportId=' + encodeURIComponent(report.id)); }}><small>{report.reportNo}</small><strong>{report.title}</strong><p>{report.defectPhenomenon}</p><span>{report.ownerName} 牵头 · {report.tasks.filter(task => ['COMPLETED', 'VERIFIED', 'CANCELLED'].includes(task.status)).length}/{report.tasks.length} 已完成</span></button>)}{!displayed.length && <p>{loading ? '正在加载…' : '当前筛选下没有任务'}</p>}
    </aside><section className="qv3-workspace">{selected ? <QualityWorkflowPanel key={selected.id} report={selected} user={user} users={users} reviewMode={reviewMode} onUpdated={report => setReports(items => items.map(item => item.id === report.id ? report : item))} /> : <div className="qv3-empty"><ClipboardCheck size={42} /><h2>选择一个事件</h2><p>所有操作按你的责任和当前阶段显示。</p></div>}</section></div>
  </main>;
}
