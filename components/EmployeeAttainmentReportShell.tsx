'use client';

import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerOff,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeReportDTO,
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
} from '@/types';

type Period = EmployeeAttainmentReportDTO['period'];
type ViewKey = 'employee' | 'abnormal';
type ReportResponse = { ok: boolean; report?: EmployeeAttainmentReportDTO; error?: string };
type AbnormalReportResponse = { ok: boolean; report?: AbnormalTimeReportDTO; error?: string };

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function percent(value: number | null): string {
  return value === null ? '无有效生产时段' : `${(value / 100).toFixed(1)}%`;
}

function attainmentClass(value: number | null): string {
  if (value === null) return 'empty';
  if (value >= 10_000) return 'good';
  if (value >= 8_000) return 'watch';
  return 'low';
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function periodLabel(period: Period): string {
  return period === 'month' ? '本月' : period === 'week' ? '本周' : '当日';
}

export default function EmployeeAttainmentReportShell({ user }: { user: CurrentUserDTO }) {
  const [view, setView] = useState<ViewKey>('employee');
  const [period, setPeriod] = useState<Period>('today');
  const [date, setDate] = useState(todayKey);
  const [report, setReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [abnormalReport, setAbnormalReport] = useState<AbnormalTimeReportDTO | null>(null);
  const [keyword, setKeyword] = useState('');
  const [expandedEmployeeId, setExpandedEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ period, date });
    Promise.all([
      fetch(`/api/reports/employee-attainment?${params}`, { cache: 'no-store', signal: controller.signal }),
      fetch(`/api/reports/abnormal-time?${params}`, { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([employeeResponse, abnormalResponse]) => {
      const employeeBody = await employeeResponse.json() as ReportResponse;
      const abnormalBody = await abnormalResponse.json() as AbnormalReportResponse;
      if (!employeeResponse.ok || !employeeBody.report) throw new Error(employeeBody.error || '员工达成率报表加载失败');
      if (!abnormalResponse.ok || !abnormalBody.report) throw new Error(abnormalBody.error || '异常工时汇总加载失败');
      setReport(employeeBody.report);
      setAbnormalReport(abnormalBody.report);
    }).catch(reason => {
      if ((reason as { name?: string }).name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '报表加载失败');
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [date, period, refreshToken]);

  const rows = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return report?.rows || [];
    return (report?.rows || []).filter(row =>
      `${row.employee.employeeNo} ${row.employee.name} ${row.employee.department || ''} ${row.employee.position || ''} ${row.employee.team || ''}`
        .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [keyword, report?.rows]);

  const abnormalEvents = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return abnormalReport?.events || [];
    return (abnormalReport?.events || []).filter(event =>
      `${event.sequence} ${event.categoryLabel} ${event.title} ${event.reason || ''} ${event.allocations.map(item => item.employee.name).join(' ')}`
        .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [abnormalReport?.events, keyword]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  const summary = report?.summary;
  const abnormalSummary = abnormalReport?.summary;

  return (
    <main className="employee-report-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/reports"
        subtitle="出勤达成率、工序效率与异常损失"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => void logout() }]}
      />
      <div className="employee-report-frame">
        <WorkbenchPageHeader
          kicker="数据分析"
          title="员工达成率与异常工时报表"
          titleId="employee-attainment-title"
          description="个人达成率按标准完成工时 ÷（确认出勤－品质确认免责异常）计算；工序效率仍按标准工时 ÷ 实际报工工时单独展示。"
          actions={<>
            <a className="hm-workbench-button" href="/workspace/attendance"><CalendarClock size={15} />考勤与异常</a>
            <a className="hm-workbench-button" href="/workspace/product-times"><Clock3 size={15} />产品工序与工时</a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button>
          </>}
        />

        <section className="employee-report-summary" aria-label="达成率与异常概览">
          <article><UsersRound /><span>参与员工<small>{periodLabel(period)}在用员工</small></span><strong>{summary?.employeeCount || 0}</strong></article>
          <article><CalendarClock /><span>确认出勤<small>{summary?.attendanceConfirmedDays || 0} 人日，缺失 {summary?.attendanceMissingCount || 0} 人</small></span><strong>{formatProcessDuration(summary?.attendanceMilliseconds || 0)}</strong></article>
          <article><TimerOff /><span>免责异常<small>品质确认后扣除个人基数</small></span><strong>{formatProcessDuration(summary?.exemptAbnormalMilliseconds || 0)}</strong></article>
          <article><Clock3 /><span>标准完成工时<small>已完成工序标准时间</small></span><strong>{formatProcessDuration(summary?.standardLaborMilliseconds || 0)}</strong></article>
          <article className={attainmentClass(summary?.attainmentBasisPoints ?? null)}><Gauge /><span>出勤达成率<small>标准工时 ÷ 有效生产时段</small></span><strong>{percent(summary?.attainmentBasisPoints ?? null)}</strong></article>
          <article className={abnormalSummary?.openCount ? 'watch' : 'good'}><AlertTriangle /><span>异常影响人时<small>未关闭 {abnormalSummary?.openCount || 0} 条</small></span><strong>{formatProcessDuration(abnormalSummary?.affectedPersonMilliseconds || 0)}</strong></article>
        </section>

        <section className="employee-report-toolbar">
          <div className="employee-report-view" role="tablist" aria-label="报表视图">
            <button className={view === 'employee' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'employee'} onClick={() => setView('employee')}><Gauge size={15} />员工达成率</button>
            <button className={view === 'abnormal' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'abnormal'} onClick={() => setView('abnormal')}><AlertTriangle size={15} />异常汇总</button>
          </div>
          <div className="employee-report-period" role="group" aria-label="报表周期">
            {(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}
          </div>
          <label className="employee-report-date"><span>统计日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label className="employee-report-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={view === 'employee' ? '搜索员工编号、姓名、岗位或班组' : '搜索异常、员工或分类'} /></label>
        </section>

        {error && <div className="employee-report-error" role="alert">{error}</div>}

        {view === 'employee' ? <section className="employee-report-table" aria-labelledby="employee-report-list-title">
          <header><div><span>员工维度</span><h2 id="employee-report-list-title">{periodLabel(period)}出勤达成率</h2></div><em>{rows.length} 人</em></header>
          <div className="employee-report-scroll hm-scroll-region" tabIndex={0}>
            <div className="employee-report-head" aria-hidden="true"><span>员工</span><span>确认出勤</span><span>免责异常</span><span>标准工时</span><span>工序效率</span><span>出勤达成率</span><span /></div>
            {rows.map(row => <EmployeeReportRow row={row} expanded={expandedEmployeeId === row.employee.id} key={row.employee.id} onToggle={() => setExpandedEmployeeId(current => current === row.employee.id ? '' : row.employee.id)} />)}
            {!loading && !rows.length && <div className="employee-report-empty"><Gauge /><strong>暂无符合条件的员工记录</strong><span>先登记并确认考勤，再从生产执行完成工序报工。</span></div>}
            {loading && <div className="employee-report-empty"><RefreshCw className="spin" /><strong>正在加载报表</strong></div>}
          </div>
        </section> : <section className="employee-report-table abnormal-report-table" aria-labelledby="abnormal-report-list-title">
          <header><div><span>异常损失</span><h2 id="abnormal-report-list-title">{periodLabel(period)}异常工时汇总</h2></div><em>{abnormalEvents.length} 条</em></header>
          <div className="abnormal-report-body hm-scroll-region" tabIndex={0}>
            <div className="abnormal-report-categories">{(abnormalReport?.categories || []).map(category => <article key={category.category}><span>{category.categoryLabel}</span><strong>{formatProcessDuration(category.affectedPersonMilliseconds)}</strong><small>{category.eventCount} 条 · 事件 {formatProcessDuration(category.incidentMilliseconds)}</small></article>)}</div>
            <div className="abnormal-report-list">{abnormalEvents.map(event => <article key={event.id}>
              <div><em>#{event.sequence}</em><strong>{event.title}</strong><small>{event.categoryLabel} · {event.allocations.map(item => item.employee.name).join('、')}</small></div>
              <span><small>事件时长</small><b>{formatProcessDuration(event.durationMilliseconds)}</b></span>
              <span><small>影响人时</small><b>{formatProcessDuration(event.affectedPersonMilliseconds)}</b></span>
              <span><small>品质口径</small><b>{event.qualityStatus === 'pending' ? '待确认' : event.qualityStatus === 'rejected' ? '已驳回' : event.employeeExempt ? '已确认免责' : '已确认不免责'}</b></span>
              <span><small>处理状态</small><b>{event.resolutionStatus === 'resolved' ? '已关闭' : '处理中'}</b></span>
            </article>)}</div>
            {!loading && !abnormalEvents.length && <div className="employee-report-empty"><ShieldCheck /><strong>当前周期没有异常工时</strong><span>已登记的异常会同时显示事件时长和受影响员工人时。</span></div>}
          </div>
        </section>}
      </div>
    </main>
  );
}

function EmployeeReportRow({ row, expanded, onToggle }: { row: EmployeeAttainmentRowDTO; expanded: boolean; onToggle: () => void }) {
  return <article className={`employee-report-row ${expanded ? 'expanded' : ''}`}>
    <button className="employee-report-row-main" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span className="employee-cell"><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.department || '部门未设置'}{row.employee.position ? ` / ${row.employee.position}` : ''}{row.employee.team ? ` / ${row.employee.team}` : ''}</small></span>
      <b>{row.attendanceMissing ? '未录考勤' : formatProcessDuration(row.attendanceMilliseconds)}</b>
      <b>{formatProcessDuration(row.exemptAbnormalMilliseconds)}</b>
      <b>{formatProcessDuration(row.standardLaborMilliseconds)}</b>
      <em className={attainmentClass(row.processEfficiencyBasisPoints)}>{percent(row.processEfficiencyBasisPoints)}</em>
      <em className={attainmentClass(row.attainmentBasisPoints)}>{percent(row.attainmentBasisPoints)}</em>
      {expanded ? <ChevronDown /> : <ChevronRight />}
    </button>
    {expanded && <div className="employee-report-details">
      <div className="employee-report-metric-detail">
        <span><small>有效生产时段</small><b>{formatProcessDuration(row.effectiveProductionMilliseconds)}</b></span>
        <span><small>原始出勤产出率</small><b>{percent(row.rawAttendanceOutputBasisPoints)}</b></span>
        <span><small>时间覆盖率</small><b>{percent(row.coverageBasisPoints)}</b></span>
        <span><small>未解释时间</small><b>{formatProcessDuration(row.unexplainedMilliseconds)}</b></span>
        <span><small>确认考勤</small><b>{row.attendanceConfirmedDays} 人日</b></span>
      </div>
      {row.details.map(detail => <div key={detail.id}>
        <span><strong>{detail.processName}</strong><small>{detail.customerName || '客户未设置'} · {detail.specification || detail.workOrderCode}</small></span>
        <span><small>作业时间</small><b>{dateTime(detail.startedAt)} - {dateTime(detail.endedAt)}</b></span>
        <span><small>标准 / 实际</small><b>{formatProcessDuration(detail.standardLaborMilliseconds)} / {formatProcessDuration(detail.actualLaborMilliseconds)}</b></span>
        <span><small>数量</small><b>合格 {detail.goodQty} · 报废 {detail.scrapQty} · 返工 {detail.reworkQty}</b></span>
        <em className={attainmentClass(detail.attainmentBasisPoints)}>{detail.countsForEfficiency ? percent(detail.attainmentBasisPoints) : '不计入'}</em>
      </div>)}
      {!row.details.length && <p>该员工在当前周期暂无生产报工，考勤仍会保留并显示。</p>}
    </div>}
  </article>;
}
