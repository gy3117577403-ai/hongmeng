'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Clock3, Download, RefreshCw, X } from 'lucide-react';
import type { EmployeeAttainmentReportDTO, EmployeeAttainmentRowDTO } from '@/types';
import { aggregateEmployeeHours } from '@/lib/employee-hours-metrics';
import type { EmployeeWorkRecord } from '@/lib/employee-realtime-hours';
import styles from './EmployeeRealtimeHours.module.css';

const hours = (milliseconds = 0) => (milliseconds / 3_600_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const rate = (value?: number | null) => value == null ? '—' : `${(value / 100).toFixed(1)}%`;
const stateLabel = { recorded: '已计入', pending_match: '待匹配 · 已计入', pending_review: '待核对 · 已计入', missing_time: '待补工时' };
const typeLabel = { production: '生产报工', abnormal: '异常工时', other: '其他工时' };

export function realtimeWorkExportRows(rows: EmployeeAttainmentRowDTO[]) {
  return rows.flatMap(row => (row.workRecords || []).map(record => [record.workDate, row.employee.employeeNo,
    row.employee.name, row.days.find(day => day.date === record.workDate)?.teamSnapshot || row.employee.team || '',
    record.workOrderCode || '', record.specification || '', record.title, typeLabel[record.type],
    record.milliseconds / 3_600_000, stateLabel[record.state], record.reportedDurationMilliseconds ? '申报时长' : record.type === 'production' ? '标准工时' : '登记时长',
    record.sourceId, record.recordedAt]));
}

export const REALTIME_WORK_HEADERS = ['工作日期', '员工编号', '员工', '班组', '工单', '规格', '工序/事项', '工时类型', '计入工时(小时)', '状态', '工时依据', '原始记录', '提交时间'];

export function EmployeeRealtimeWorkTable({ rows }: { rows: EmployeeAttainmentRowDTO[] }) {
  const records = rows.flatMap(row => (row.workRecords || []).map(record => ({ record, name: row.employee.name })))
    .sort((a, b) => b.record.workDate.localeCompare(a.record.workDate) || b.record.recordedAt.localeCompare(a.record.recordedAt));
  const [type, setType] = useState('all');
  const filtered = records.filter(({ record }) => type === 'all' || record.type === type
    || type === 'pending' && ['pending_match', 'pending_review', 'missing_time'].includes(record.state));
  const link = (record: EmployeeWorkRecord) => record.source === 'other' ? `/workspace/other-hours?id=${encodeURIComponent(record.sourceId)}`
    : record.source === 'submission' ? `/workspace/reporting-recovery?id=${encodeURIComponent(record.sourceId)}` : null;
  return <section className={styles.records}>
    <div className={styles.recordHead}><strong>已提交工作明细 <small>{filtered.length} 条</small></strong>
      <select aria-label="筛选工时类型" value={type} onChange={event => setType(event.target.value)}>
        <option value="all">全部工时</option><option value="production">生产报工</option><option value="abnormal">异常工时</option>
        <option value="other">其他工时</option><option value="pending">待匹配 / 待核对</option>
      </select></div>
    <div className={styles.scroll}><table><thead><tr><th>日期 / 员工</th><th>工单 / 事项</th><th>类型</th><th>工时</th><th>计入状态</th></tr></thead>
      <tbody>{filtered.map(({ record, name }) => <tr key={record.id}>
        <td>{record.workDate.slice(5)}<small>{name}</small></td>
        <td title={record.workOrderCode}>{link(record) ? <a href={link(record)!} target="_blank" rel="noreferrer">{record.title}</a> : record.title}
          <small>{record.specification || record.workOrderCode || '独立登记'}{record.reportedDurationMilliseconds > 0 ? ' · 按申报时长' : ''}</small></td>
        <td>{typeLabel[record.type]}</td><td><b>{record.missingTime ? '—' : hours(record.milliseconds)}</b> {!record.missingTime && 'h'}</td>
        <td><span className={record.state === 'recorded' ? styles.recorded : styles.pending}>{stateLabel[record.state]}</span></td>
      </tr>)}</tbody></table>{!filtered.length && <p className={styles.empty}>当前范围没有符合条件的已提交记录</p>}</div>
  </section>;
}

export function EmployeeRealtimeHours({ mode, date, onOpen, onClose, onProductionProgress }: {
  mode: 'card' | 'detail'; date: string; onOpen?: () => void; onClose?: () => void; onProductionProgress?: () => void;
}) {
  const [period, setPeriod] = useState('week');
  const [selectedDate, setSelectedDate] = useState(date);
  const [report, setReport] = useState<EmployeeAttainmentReportDTO | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [team, setTeam] = useState('');
  const [employee, setEmployee] = useState('');
  const [exporting, setExporting] = useState(false);
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => setSelectedDate(date), [date]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/reports/employee-attainment?${new URLSearchParams({ period, date: selectedDate })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || '工时加载失败'); return body.report; })
      .then(setReport).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, selectedDate, refresh]);
  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh(value => value + 1); };
    const storage = (event: StorageEvent) => { if (event.key === 'hongmeng:hours-changed') update(); };
    window.addEventListener('storage', storage);
    const timer = window.setInterval(update, 15_000);
    window.addEventListener('focus', update); window.addEventListener('hongmeng:hours-changed', update);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', storage); window.removeEventListener('focus', update); window.removeEventListener('hongmeng:hours-changed', update); };
  }, []);
  useEffect(() => {
    if (mode !== 'detail') return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [mode, onClose]);
  const teams = [...new Set((report?.rows || []).flatMap(row => row.days.map(day => day.teamSnapshot || row.employee.team || '未分组')))];
  const rows = useMemo(() => (report?.rows || []).filter(row => !employee || row.employee.id === employee).map(row => {
    const days = row.days.filter(day => !team || (day.teamSnapshot || row.employee.team || '未分组') === team);
    const dates = new Set(days.map(day => day.date));
    return { ...row, days, workRecords: row.workRecords?.filter(record => dates.has(record.workDate)) };
  }).filter(row => row.days.length > 0), [report, team, employee]);
  const total = aggregateEmployeeHours(rows.flatMap(row => row.days.map(day => ({ ...day, attendanceConfirmed: day.attendanceStatus === 'confirmed' }))));
  const estimated = total.attainmentBasisPoints == null && total.estimatedAttainmentBasisPoints != null;
  const percentage = estimated ? total.estimatedAttainmentBasisPoints : total.attainmentBasisPoints;
  const target = estimated ? total.estimatedCapacityMilliseconds : total.attainmentCapacityMilliseconds;
  const hasData = !!report && !error;
  if (mode === 'card') return <button type="button" className="labor" onClick={onOpen}>
    <span><Clock3 size={18} aria-hidden="true" />员工实时工时达成率<ChevronRight size={14} aria-hidden="true" /></span>
    <strong>{hasData ? rate(percentage) : '—'}</strong>
    <small>{hasData ? `${hours(total.attainmentNumeratorMilliseconds)} / ${hours(target)} 小时${estimated ? ' · 预估' : ''}` : loading ? '正在汇总已提交工时' : error || '等待加载'}</small>
    <i><b style={{ width: `${Math.min(100, (percentage || 0) / 100)}%` }} /></i>
    <em>{hasData && (total.pendingMatchingMilliseconds || total.pendingReviewMilliseconds)
      ? `含待匹配 ${hours(total.pendingMatchingMilliseconds)}h · 待核对 ${hours(total.pendingReviewMilliseconds)}h` : '查看员工与工时明细'}</em>
  </button>;
  const exportWorkbook = async () => {
    setExporting(true);
    try {
      const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('实时工时明细'); sheet.addRow(REALTIME_WORK_HEADERS); sheet.addRows(realtimeWorkExportRows(rows));
      sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.columns.forEach((column, index) => { column.width = [12, 16, 12, 16, 24, 18, 30, 14, 18, 22, 14, 38, 25][index]; });
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `实时工时-${selectedDate}.xlsx`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败'); }
    finally { setExporting(false); }
  };
  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <aside className={styles.dialog} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="员工实时工时明细">
      <header className={styles.header}><div><small>成功提交即计入 · 匹配不重复加时</small><h2>员工实时工时达成率</h2></div>
        <button type="button" aria-label="关闭员工工时明细" onClick={onClose}><X size={22} /></button></header>
      <div className={styles.toolbar}>
        <div>{[['today', '日'], ['week', '周'], ['month', '月']].map(([value, label]) => <button type="button" key={value} aria-pressed={period === value}
          onClick={() => { setPeriod(value); setReport(null); }}>{label}</button>)}</div>
        <input type="date" aria-label="工时统计日期" value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setReport(null); }} />
        <select aria-label="选择工时班组" value={team} onChange={event => { setTeam(event.target.value); setEmployee(''); }}><option value="">全部班组</option>{teams.map(value => <option key={value}>{value}</option>)}</select>
        <select aria-label="选择工时员工" value={employee} onChange={event => setEmployee(event.target.value)}><option value="">全部员工</option>{report?.rows.filter(row => !team || row.days.some(day => (day.teamSnapshot || row.employee.team || '未分组') === team)).map(row => <option key={row.employee.id} value={row.employee.id}>{row.employee.name}</option>)}</select>
        <button type="button" aria-label="刷新工时" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /></button>
        <button type="button" disabled={!hasData || exporting} onClick={exportWorkbook}><Download size={16} />导出</button>
      </div>
      <div className={styles.body}>
        {error && <p role="alert" className={styles.warning}>{error}，请刷新重试。</p>}
        <section className={styles.result}><div><small>{estimated ? '实时预估 · 按排班目标' : '已提交工作 / 员工目标'}</small><strong>{hasData ? rate(percentage) : '—'}</strong></div>
          <p>{hours(total.attainmentNumeratorMilliseconds)} ÷ {hours(target)} 小时<br /><small>目标＝正常出勤与加班合计 × 95%</small></p></section>
        {!total.attainmentDataComplete && hasData && <p className={styles.warning}>考勤待完善，已提交工时照常保留。{estimated ? '当前按明确排班目标展示预估，考勤确认后自动更新。' : '缺少可靠出勤或排班目标，暂不生成达成率。'}</p>}
        <div className={styles.breakdown}>{[['生产报工', total.standardLaborMilliseconds], ['异常工时', total.exemptAbnormalMilliseconds], ['其他工时', total.otherWorkMilliseconds], ['计入合计', total.attainmentNumeratorMilliseconds]].map(([label, value]) => <article key={String(label)}><small>{label}</small><strong>{hours(Number(value))}<i>h</i></strong></article>)}</div>
        <p className={styles.note}>其中包含：待匹配 {hours(total.pendingMatchingMilliseconds)}h · 待核对 {hours(total.pendingReviewMilliseconds)}h{total.reportedDurationMilliseconds > 0 ? ` · 按申报时长 ${hours(total.reportedDurationMilliseconds)}h` : ''}。这些工时已包含在上方合计中。</p>
        {total.missingTimeRecordCount > 0 && <p className={styles.warning}>另有 {total.missingTimeRecordCount} 条记录缺少标准工时和申报时长，待补工时；未将缺失时长伪装为已完成。</p>}
        <EmployeeRealtimeWorkTable rows={rows} />
        <p className={styles.note}>按原工作日期汇总；撤销或核减同步扣回。生产工序效率设置不扣减员工综合工时。非本统计口径的人员记录保留在明细中，目标与计入工时按相同人员范围计算。</p>
        <footer className={styles.footer}><button type="button" onClick={onProductionProgress}>查看生产工序进度</button><span>{loading ? '正在同步…' : `更新 ${report?.generatedAt ? new Date(report.generatedAt).toLocaleTimeString('zh-CN') : '—'}`}</span></footer>
      </div>
    </aside>
  </div>, document.body);
}
