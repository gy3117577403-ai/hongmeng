'use client';

import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  ListOrdered,
  RefreshCw,
  Search,
  TimerReset,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  CurrentUserDTO,
  EmployeeAttainmentReportDTO,
  EmployeeAttainmentRowDTO,
} from '@/types';

type Period = EmployeeAttainmentReportDTO['period'];
type ReportResponse = {
  ok: boolean;
  report?: EmployeeAttainmentReportDTO;
  error?: string;
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function percent(value: number): string {
  return value > 0 ? `${(value / 100).toFixed(1)}%` : '-';
}

function attainmentClass(value: number): string {
  if (value >= 10_000) return 'good';
  if (value >= 8_000) return 'watch';
  return value > 0 ? 'low' : 'empty';
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function periodLabel(period: Period): string {
  return period === 'month' ? '本月' : period === 'week' ? '本周' : '当日';
}

export default function EmployeeAttainmentReportShell({ user }: { user: CurrentUserDTO }) {
  const [period, setPeriod] = useState<Period>('today');
  const [date, setDate] = useState(todayKey);
  const [report, setReport] = useState<EmployeeAttainmentReportDTO | null>(null);
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
    fetch(`/api/reports/employee-attainment?${params}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json() as ReportResponse;
        if (!response.ok || !body.report) throw new Error(body.error || '员工达成率报表加载失败');
        setReport(body.report);
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '员工达成率报表加载失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [date, period, refreshToken]);

  const rows = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return report?.rows || [];
    return (report?.rows || []).filter(row =>
      `${row.employee.employeeNo} ${row.employee.name} ${row.employee.department || ''} ${row.employee.position || ''} ${row.employee.team || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized));
  }, [keyword, report?.rows]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return (
    <main className="employee-report-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/reports"
        subtitle="员工标准工时、实际工时与达成率"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />
      <div className="employee-report-frame">
        <WorkbenchPageHeader
          kicker="数据分析"
          title="员工达成率报表"
          titleId="employee-attainment-title"
          description="按员工汇总已完成工序的标准工时与实际工时；总达成率采用工时加权计算，可展开查看每条报工明细。"
          actions={<>
            <a className="hm-workbench-button" href="/workspace/time-standards"><Clock3 size={15} />标准工时</a>
            <a className="hm-workbench-button" href="/workspace/processes"><ListOrdered size={15} />工艺管理</a>
            <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button>
          </>}
        />

        <section className="employee-report-summary" aria-label="达成率概览">
          <article><UsersRound /><span>参与员工<small>{periodLabel(period)}有报工或在用员工</small></span><strong>{report?.summary.employeeCount || 0}</strong></article>
          <article><BarChart3 /><span>报工次数<small>已完成工序记录</small></span><strong>{report?.summary.executionCount || 0}</strong></article>
          <article><Clock3 /><span>标准总工时<small>纳入达成率的标准时间</small></span><strong>{formatProcessDuration(report?.summary.standardLaborMilliseconds || 0)}</strong></article>
          <article><TimerReset /><span>实际总工时<small>起止时间扣除休息</small></span><strong>{formatProcessDuration(report?.summary.actualLaborMilliseconds || 0)}</strong></article>
          <article className={attainmentClass(report?.summary.attainmentBasisPoints || 0)}><Gauge /><span>加权达成率<small>标准总工时 ÷ 实际总工时</small></span><strong>{percent(report?.summary.attainmentBasisPoints || 0)}</strong></article>
        </section>

        <section className="employee-report-toolbar">
          <div className="employee-report-period" role="tablist" aria-label="报表周期">
            {(['today', 'week', 'month'] as Period[]).map(item => (
              <button className={period === item ? 'active' : ''} type="button" role="tab" aria-selected={period === item} key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>
            ))}
          </div>
          <label className="employee-report-date"><span>统计日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label className="employee-report-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索员工编号、姓名、部门、岗位或班组" /></label>
        </section>

        {error && <div className="employee-report-error" role="alert">{error}</div>}

        <section className="employee-report-table" aria-labelledby="employee-report-list-title">
          <header>
            <div><span>员工维度</span><h2 id="employee-report-list-title">{periodLabel(period)}达成率</h2></div>
            <em>{rows.length} 人</em>
          </header>
          <div className="employee-report-scroll hm-scroll-region" tabIndex={0}>
            <div className="employee-report-head" aria-hidden="true">
              <span>员工</span><span>标准工时</span><span>实际工时</span><span>合格数量</span><span>报工</span><span>达成率</span><span />
            </div>
            {rows.map(row => (
              <EmployeeReportRow
                row={row}
                expanded={expandedEmployeeId === row.employee.id}
                key={row.employee.id}
                onToggle={() => setExpandedEmployeeId(current => current === row.employee.id ? '' : row.employee.id)}
              />
            ))}
            {!loading && !rows.length && <div className="employee-report-empty"><Gauge /><strong>暂无符合条件的员工记录</strong><span>先在标准工时中维护员工，再从生产执行完成一道工序并登记报工。</span></div>}
            {loading && <div className="employee-report-empty"><RefreshCw className="spin" /><strong>正在加载报表</strong></div>}
          </div>
        </section>
      </div>
    </main>
  );
}

function EmployeeReportRow({ row, expanded, onToggle }: {
  row: EmployeeAttainmentRowDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`employee-report-row ${expanded ? 'expanded' : ''}`}>
      <button className="employee-report-row-main" type="button" aria-expanded={expanded} onClick={onToggle}>
        <span className="employee-cell"><strong>{row.employee.name}</strong><small>{row.employee.employeeNo} · {row.employee.department || '部门未设置'}{row.employee.position ? ` / ${row.employee.position}` : ''}{row.employee.team ? ` / ${row.employee.team}` : ''}</small></span>
        <b>{formatProcessDuration(row.standardLaborMilliseconds)}</b>
        <b>{formatProcessDuration(row.actualLaborMilliseconds)}</b>
        <b>{row.goodQty}</b>
        <b>{row.executionCount}</b>
        <em className={attainmentClass(row.attainmentBasisPoints)}>{percent(row.attainmentBasisPoints)}</em>
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </button>
      {expanded && (
        <div className="employee-report-details">
          {row.details.map(detail => (
            <div key={detail.id}>
              <span><strong>{detail.processName}</strong><small>{detail.customerName || '客户未设置'} · {detail.specification || detail.workOrderCode}</small></span>
              <span><small>作业时间</small><b>{dateTime(detail.startedAt)} - {dateTime(detail.endedAt)}</b></span>
              <span><small>标准 / 实际</small><b>{formatProcessDuration(detail.standardLaborMilliseconds)} / {formatProcessDuration(detail.actualLaborMilliseconds)}</b></span>
              <span><small>数量</small><b>合格 {detail.goodQty} · 报废 {detail.scrapQty} · 返工 {detail.reworkQty}</b></span>
              <em className={attainmentClass(detail.attainmentBasisPoints)}>{detail.countsForEfficiency ? percent(detail.attainmentBasisPoints) : '不计入'}</em>
            </div>
          ))}
          {!row.details.length && <p>该员工在当前周期暂无报工记录。</p>}
        </div>
      )}
    </article>
  );
}
