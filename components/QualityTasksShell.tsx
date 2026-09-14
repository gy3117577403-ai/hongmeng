'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import QualityWorkflowPanel from '@/components/QualityWorkflowPanel';
import type { QualityAssignee } from '@/components/QualityAssigneeSelect';
import { RefreshCw, ClipboardCheck, ShieldCheck, Search, ChevronLeft } from 'lucide-react';
import { QUALITY_PROBLEM_CATEGORIES } from '@/lib/quality-workflow-shared';
import { qualityWorkflowView, qualityMyPending, qualityEventTitle } from '@/lib/quality-workbench';
import type { CurrentUserDTO, InternalQualityRiskDTO } from '@/types';

export default function QualityTasksShell({ user, reviewMode = false }: { user: CurrentUserDTO; reviewMode?: boolean }) {
  const [reports, setReports] = useState<InternalQualityRiskDTO[]>([]), [users, setUsers] = useState<QualityAssignee[]>([]);
  const [selectedId, setSelectedId] = useState(''), [query, setQuery] = useState(''), [category, setCategory] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const request = useRef(0), openedLink = useRef(false);
  const path = reviewMode ? '/workspace/quality-confirmation' : '/workspace/quality-tasks';
  const selected = reports.find(item => item.id === selectedId);
  const pending = (report: InternalQualityRiskDTO) => reviewMode ? report.status === 'VERIFYING' : qualityMyPending(report, user.id);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError('');
    try {
      const linkId = new URLSearchParams(window.location.search).get('reportId');
      const response = await fetch((reviewMode ? '/api/quality-confirmation' : '/api/quality-tasks') + (linkId ? '?reportId=' + encodeURIComponent(linkId) : ''), { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '加载失败');
      if (sequence !== request.current) return;
      setReports(body.reports); setUsers(body.assignees || []);
      if (!openedLink.current) {
        if (linkId && !body.reports.some((item: InternalQualityRiskDTO) => item.id === linkId)) setError('该事件不在你的处理范围，或已回收。请联系发起质量确认分工。');
        setSelectedId(linkId || body.reports[0]?.id || ''); setMobileDetail(Boolean(linkId));
        if (linkId) setPendingOnly(false); openedLink.current = true;
      }
    } catch (e) { if (sequence === request.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [reviewMode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get('taskId');
    const task = taskId ? document.getElementById('task-' + taskId) : null;
    if (task instanceof HTMLDetailsElement) task.open = true;
    task?.scrollIntoView({ block: 'start' });
  }, [selectedId, loading]);
  const displayed = reports.filter(item => (!pendingOnly || pending(item)) && (!category || item.problemCategory === category) && (item.reportNo + ' ' + item.title + ' ' + item.defectPhenomenon + ' ' + item.products.map(product => product.specification).join(' ')).toLowerCase().includes(query.trim().toLowerCase()));
  return <main className={`hm-workbench-root hm-cockpit-root quality-tasks-root qv3-root ${mobileDetail ? 'show-detail' : 'show-list'}`}>
    <AppWorkbenchHeader user={user} activeHref={path} subtitle={reviewMode ? '品质确认' : '我的质量任务'} menuItems={[]} hideHeader sidebarTriggerTargetId="quality-workflow-navigation-trigger" />
    <header className="qv3-head"><div id="quality-workflow-navigation-trigger" className="hm-cockpit-navigation-trigger" />{reviewMode ? <ShieldCheck /> : <ClipboardCheck />}<div><h1>{reviewMode ? '品质确认' : '我的质量任务'}</h1><small>{reviewMode ? '独立验证 · 定向退回 · 保留每一轮证据' : '填写原因、措施与结果，全部提交后自动送品质确认'}</small></div>{user.access.capabilities.includes('QUALITY:READ') && <Link href={'/workspace/quality/internal-risks' + (selectedId ? '?reportId=' + encodeURIComponent(selectedId) : '')}>异常中心</Link>}<button disabled={loading} onClick={() => void load()}><RefreshCw size={18} className={loading ? 'spin' : ''} />刷新</button></header>
    {error && <p role="alert" className="qv3-error">{error}<button disabled={loading} onClick={() => void load()}>重试</button></p>}
    <div className="qv3-shell-grid"><aside className="qv3-list"><header><b>{reviewMode ? '待我确认' : '我的待办'} <em>{reports.filter(pending).length}</em></b><label><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)} />仅待办</label></header>
      <label className="qv3-search"><Search size={17} /><input aria-label="搜索质量任务" placeholder="问题、产品、编号" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="按问题归属筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部问题归属</option>{QUALITY_PROBLEM_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      {displayed.map(report => { const flow = report.workflow || qualityWorkflowView(report); return <button key={report.id} aria-pressed={report.id === selectedId} className={report.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(report.id); setMobileDetail(true); window.history.replaceState(null, '', path + '?reportId=' + encodeURIComponent(report.id)); }}><span className={'qv4-phase phase-' + flow.phase.toLowerCase()}>{flow.label}</span><strong>{qualityEventTitle(report)}</strong><small>{report.reportNo}</small><p>{report.products.map(product => product.specification || product.productName).join('、')}</p><span>{flow.waitingNames.join('、') || '查看归档'} · {flow.submittedTasks}/{flow.activeTasks} 项已提交</span>{flow.overdueTasks > 0 && <small className="overdue">{flow.overdueTasks} 项逾期</small>}</button>; })}
      {!displayed.length && <div className="qv3-empty"><ClipboardCheck size={32} /><p>{loading ? '正在加载…' : '当前条件下没有待办'}</p>{pendingOnly && <button onClick={() => setPendingOnly(false)}>查看我参与的全部记录</button>}</div>}
      {reports.length >= 300 && <small>已加载最近记录；通知链接可直接定位具体事件。</small>}
    </aside><section className="qv3-workspace"><button className="qv4-task-back" onClick={() => setMobileDetail(false)}><ChevronLeft size={16} />返回任务列表</button>{selected ? <QualityWorkflowPanel key={selected.id + ':' + selected.reviewRound} report={selected} user={user} users={users} reviewMode={reviewMode} onUpdated={report => { ++request.current; setLoading(false); setReports(items => items.map(item => item.id === report.id ? report : item)); }} /> : <div className="qv3-empty"><ClipboardCheck size={42} /><h2>选择一个异常工单</h2><p>查看当前阶段，处理分配给你的任务。</p></div>}</section></div>
  </main>;
}
