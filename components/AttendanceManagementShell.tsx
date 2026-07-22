'use client';

import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  FileWarning,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ABNORMAL_TIME_CATEGORIES } from '@/lib/attendance';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  AbnormalTimeCategory,
  AbnormalTimeEventDTO,
  AttendanceRecordDTO,
  AttendanceType,
  CurrentUserDTO,
  EmployeeDTO,
} from '@/types';

type TabKey = 'attendance' | 'abnormal' | 'quality';
type Period = 'today' | 'week' | 'month';
type EmployeesResponse = { ok: boolean; employees?: EmployeeDTO[]; error?: string };
type AttendanceResponse = {
  ok: boolean;
  records?: AttendanceRecordDTO[];
  summary?: {
    enabledEmployeeCount: number;
    recordCount: number;
    confirmedCount: number;
    draftCount: number;
    actualMilliseconds: number;
    overtimeMilliseconds: number;
    leaveMilliseconds: number;
  };
  error?: string;
};
type EventsResponse = {
  ok: boolean;
  events?: AbnormalTimeEventDTO[];
  summary?: {
    eventCount: number;
    pendingCount: number;
    confirmedCount: number;
    rejectedCount: number;
    openCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
  };
  event?: AbnormalTimeEventDTO;
  error?: string;
};

type AttendanceDraft = {
  employeeId: string;
  attendanceType: AttendanceType;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  overtimeStart: string;
  overtimeEnd: string;
  leaveMinutes: string;
  remark: string;
};

type AbnormalDraft = {
  id?: string;
  category: AbnormalTimeCategory;
  title: string;
  startedAt: string;
  endedAt: string;
  employeeIds: string[];
  employeeExempt: boolean;
  responsibilityDepartment: string;
  expectedResolvedAt: string;
  reason: string;
  workOrderId: string;
};

const emptyAttendanceSummary = {
  enabledEmployeeCount: 0,
  recordCount: 0,
  confirmedCount: 0,
  draftCount: 0,
  actualMilliseconds: 0,
  overtimeMilliseconds: 0,
  leaveMilliseconds: 0,
};
const emptyEventSummary = {
  eventCount: 0,
  pendingCount: 0,
  confirmedCount: 0,
  rejectedCount: 0,
  openCount: 0,
  incidentMilliseconds: 0,
  affectedPersonMilliseconds: 0,
};

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function toTime(value: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string): string => parts.find(item => item.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find(item => item.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function isoFor(date: string, time: string): string {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

function attendanceTypeLabel(type: AttendanceType): string {
  return type === 'leave' ? '请假' : type === 'absent' ? '缺勤' : type === 'rest' ? '休息日' : '正常出勤';
}

function periodLabel(period: Period): string {
  return period === 'month' ? '本月' : period === 'week' ? '本周' : '当日';
}

function eventStatusLabel(event: AbnormalTimeEventDTO): string {
  if (event.qualityStatus === 'pending') return '待品质确认';
  if (event.qualityStatus === 'rejected') return '品质已驳回';
  return event.employeeExempt ? '已确认免责' : '已确认不免责';
}

export default function AttendanceManagementShell({ user }: { user: CurrentUserDTO }) {
  const [tab, setTab] = useState<TabKey>('attendance');
  const [date, setDate] = useState(todayKey);
  const [period, setPeriod] = useState<Period>('today');
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [records, setRecords] = useState<AttendanceRecordDTO[]>([]);
  const [events, setEvents] = useState<AbnormalTimeEventDTO[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState(emptyAttendanceSummary);
  const [eventSummary, setEventSummary] = useState(emptyEventSummary);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [refreshToken, setRefreshToken] = useState(0);
  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceDraft | null>(null);
  const [abnormalDraft, setAbnormalDraft] = useState<AbnormalDraft | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'abnormal' || requestedTab === 'quality') setTab(requestedTab);
    const employeeId = params.get('employeeId') || '';
    if (employeeId) setKeyword(employeeId);
    const workOrderId = params.get('workOrderId') || '';
    if (requestedTab === 'abnormal' && workOrderId) {
      const now = new Date();
      const later = new Date(now.getTime() + 30 * 60 * 1000);
      setAbnormalDraft({
        category: 'other', title: '', startedAt: toDateTimeLocal(now.toISOString()),
        endedAt: toDateTimeLocal(later.toISOString()), employeeIds: [], employeeExempt: true,
        responsibilityDepartment: '', expectedResolvedAt: '', reason: '', workOrderId,
      });
    }
  }, []);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [employeeResponse, attendanceResponse, eventResponse] = await Promise.all([
        fetch('/api/employees?active=true', { cache: 'no-store', signal }),
        fetch(`/api/attendance/records?period=today&date=${encodeURIComponent(date)}`, { cache: 'no-store', signal }),
        fetch(`/api/abnormal-time-events?period=${period}&date=${encodeURIComponent(date)}`, { cache: 'no-store', signal }),
      ]);
      const employeeBody = await employeeResponse.json() as EmployeesResponse;
      const attendanceBody = await attendanceResponse.json() as AttendanceResponse;
      const eventBody = await eventResponse.json() as EventsResponse;
      if (!employeeResponse.ok) throw new Error(employeeBody.error || '员工档案加载失败');
      if (!attendanceResponse.ok) throw new Error(attendanceBody.error || '考勤记录加载失败');
      if (!eventResponse.ok) throw new Error(eventBody.error || '异常工时加载失败');
      setEmployees((employeeBody.employees || []).filter(item => item.attendanceEnabled));
      setRecords(attendanceBody.records || []);
      setEvents(eventBody.events || []);
      setAttendanceSummary(attendanceBody.summary || emptyAttendanceSummary);
      setEventSummary(eventBody.summary || emptyEventSummary);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '工作台加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [date, period]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!attendanceDraft && !abnormalDraft) return;
    function close(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setAttendanceDraft(null);
      setAbnormalDraft(null);
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [attendanceDraft, abnormalDraft]);

  const recordByEmployee = useMemo(() => new Map(records.map(item => [item.employeeId, item])), [records]);
  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return employees;
    return employees.filter(item => `${item.id} ${item.employeeNo} ${item.name} ${item.department || ''} ${item.position || ''} ${item.team || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [employees, keyword]);
  const visibleEvents = tab === 'quality' ? events.filter(item => item.qualityStatus === 'pending') : events;

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  function openAttendance(employee: EmployeeDTO): void {
    const record = recordByEmployee.get(employee.id);
    const regular = record?.segments.filter(item => item.type === 'regular') || [];
    const overtime = record?.segments.find(item => item.type === 'overtime');
    setAttendanceDraft({
      employeeId: employee.id,
      attendanceType: record?.attendanceType || 'normal',
      morningStart: regular[0] ? toTime(regular[0].startedAt) : '08:00',
      morningEnd: regular[0] ? toTime(regular[0].endedAt) : '12:00',
      afternoonStart: regular[1] ? toTime(regular[1].startedAt) : '13:00',
      afternoonEnd: regular[1] ? toTime(regular[1].endedAt) : '17:00',
      overtimeStart: overtime ? toTime(overtime.startedAt) : '',
      overtimeEnd: overtime ? toTime(overtime.endedAt) : '',
      leaveMinutes: record ? String(record.leaveMilliseconds / 60000) : '0',
      remark: record?.remark || '',
    });
  }

  async function batchDefault(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/attendance/records/batch-default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workDate: date }),
      });
      const body = await response.json() as { ok: boolean; createdCount?: number; skippedCount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || '生成失败');
      setToast(`已生成 ${body.createdCount || 0} 条，保留已有 ${body.skippedCount || 0} 条`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量生成考勤失败');
    } finally {
      setSaving(false);
    }
  }

  async function batchConfirm(): Promise<void> {
    if (!window.confirm(`确认 ${date} 的全部考勤草稿？请先修改请假、缺勤和加班例外。`)) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/attendance/records/batch-confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workDate: date }),
      });
      const body = await response.json() as { ok: boolean; confirmedCount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || '批量确认失败');
      setToast(`已确认 ${body.confirmedCount || 0} 条考勤`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量确认考勤失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance(confirm: boolean): Promise<void> {
    if (!attendanceDraft) return;
    setSaving(true);
    setError('');
    try {
      const segments = attendanceDraft.attendanceType === 'normal'
        ? [
            { type: 'regular', startedAt: isoFor(date, attendanceDraft.morningStart), endedAt: isoFor(date, attendanceDraft.morningEnd) },
            { type: 'regular', startedAt: isoFor(date, attendanceDraft.afternoonStart), endedAt: isoFor(date, attendanceDraft.afternoonEnd) },
            ...(attendanceDraft.overtimeStart && attendanceDraft.overtimeEnd
              ? [{ type: 'overtime', startedAt: isoFor(date, attendanceDraft.overtimeStart), endedAt: isoFor(date, attendanceDraft.overtimeEnd) }]
              : []),
          ]
        : [];
      const response = await fetch('/api/attendance/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...attendanceDraft, workDate: date, segments, confirm }),
      });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || '考勤保存失败');
      setAttendanceDraft(null);
      setToast(confirm ? '考勤已确认' : '考勤草稿已保存');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '考勤保存失败');
    } finally {
      setSaving(false);
    }
  }

  function beginAbnormal(): void {
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60 * 1000);
    setAbnormalDraft({
      category: 'equipment', title: '', startedAt: toDateTimeLocal(now.toISOString()),
      endedAt: toDateTimeLocal(later.toISOString()), employeeIds: [], employeeExempt: true,
      responsibilityDepartment: '', expectedResolvedAt: '', reason: '', workOrderId: '',
    });
  }

  function editAbnormal(event: AbnormalTimeEventDTO): void {
    setAbnormalDraft({
      id: event.id,
      category: event.category,
      title: event.title,
      startedAt: toDateTimeLocal(event.startedAt),
      endedAt: toDateTimeLocal(event.endedAt),
      employeeIds: event.allocations.map(item => item.employeeId),
      employeeExempt: event.employeeExempt,
      responsibilityDepartment: event.responsibilityDepartment || '',
      expectedResolvedAt: toDateTimeLocal(event.expectedResolvedAt),
      reason: event.reason || '',
      workOrderId: event.workOrder?.id || '',
    });
  }

  async function saveAbnormal(): Promise<void> {
    if (!abnormalDraft) return;
    setSaving(true);
    setError('');
    try {
      const workDate = abnormalDraft.startedAt.slice(0, 10);
      const response = await fetch(abnormalDraft.id ? `/api/abnormal-time-events/${abnormalDraft.id}` : '/api/abnormal-time-events', {
        method: abnormalDraft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...abnormalDraft,
          workDate,
          startedAt: new Date(`${abnormalDraft.startedAt}:00+08:00`).toISOString(),
          endedAt: new Date(`${abnormalDraft.endedAt}:00+08:00`).toISOString(),
          expectedResolvedAt: abnormalDraft.expectedResolvedAt
            ? new Date(`${abnormalDraft.expectedResolvedAt}:00+08:00`).toISOString()
            : null,
        }),
      });
      const body = await response.json() as EventsResponse;
      if (!response.ok) throw new Error(body.error || '异常工时保存失败');
      setAbnormalDraft(null);
      setDate(workDate);
      setPeriod('today');
      setToast(abnormalDraft.id ? '异常工时已更新，需重新品质确认' : '异常工时已登记，等待品质确认');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '异常工时保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function quality(event: AbnormalTimeEventDTO, decision: 'confirmed' | 'rejected'): Promise<void> {
    const note = decision === 'rejected'
      ? window.prompt('请输入驳回原因')
      : window.prompt('品质确认说明（可选）', '现场异常记录属实');
    if (note === null || (decision === 'rejected' && !note.trim())) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/abnormal-time-events/${event.id}/quality`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note }),
      });
      const body = await response.json() as EventsResponse;
      if (!response.ok) throw new Error(body.error || '品质确认失败');
      setToast(decision === 'confirmed' ? '品质确认完成' : '异常记录已驳回');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '品质确认失败');
    } finally {
      setSaving(false);
    }
  }

  async function resolveEvent(event: AbnormalTimeEventDTO): Promise<void> {
    const resolutionNote = window.prompt('请填写异常处理结果');
    if (!resolutionNote?.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/abnormal-time-events/${event.id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolutionNote }),
      });
      const body = await response.json() as EventsResponse;
      if (!response.ok) throw new Error(body.error || '关闭失败');
      setToast('异常已关闭');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关闭异常失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent(event: AbnormalTimeEventDTO): Promise<void> {
    if (!window.confirm(`确认删除异常 #${event.sequence}？记录将软删除。`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/abnormal-time-events/${event.id}`, { method: 'DELETE' });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || '删除失败');
      setToast('异常记录已删除');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除异常失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="attendance-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/attendance"
        subtitle="手工考勤、异常免责与品质确认"
        menuItems={[{ label: '修改密码', href: '/dashboard?changePassword=1' }, { label: '退出登录', onSelect: () => void logout() }]}
      />
      <div className="attendance-frame">
        <section className="attendance-summary" aria-label="考勤与异常概览">
          <article><UsersRound /><span>考勤员工<small>已启用考勤的在用员工</small></span><strong>{attendanceSummary.enabledEmployeeCount}</strong></article>
          <article><UserRoundCheck /><span>已确认考勤<small>{date} 日记录</small></span><strong>{attendanceSummary.confirmedCount}</strong></article>
          <article><Clock3 /><span>有效出勤<small>请假不计入</small></span><strong>{formatProcessDuration(attendanceSummary.actualMilliseconds)}</strong></article>
          <article><AlertTriangle /><span>异常事件<small>{periodLabel(period)}汇总</small></span><strong>{eventSummary.eventCount}</strong></article>
          <article className={eventSummary.pendingCount ? 'warning' : ''}><ShieldCheck /><span>待品质确认<small>确认后才影响免责口径</small></span><strong>{eventSummary.pendingCount}</strong></article>
        </section>

        <section className="attendance-toolbar">
          <div className="attendance-tabs" role="tablist" aria-label="考勤工作台视图">
            <button className={tab === 'attendance' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'attendance'} onClick={() => setTab('attendance')}><CalendarClock size={16} />考勤登记</button>
            <button className={tab === 'abnormal' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'abnormal'} onClick={() => setTab('abnormal')}><FileWarning size={16} />异常工时</button>
            <button className={tab === 'quality' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'quality'} onClick={() => setTab('quality')}><ShieldCheck size={16} />品质确认 <em>{eventSummary.pendingCount}</em></button>
          </div>
          <a className="attendance-employee-link" href="/workspace/employees" title="打开员工档案"><UsersRound size={16} />员工档案</a>
          <label className="attendance-date"><span>基准日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          {tab !== 'attendance' && <div className="attendance-period" role="group" aria-label="异常汇总周期">{(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}</div>}
          <button className="icon-button" type="button" aria-label="刷新" title="刷新" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={17} /></button>
          {tab === 'attendance'
            ? <><button type="button" disabled={saving || !attendanceSummary.draftCount} onClick={() => void batchConfirm()}><Check size={16} />确认全部草稿</button><button className="primary-button" type="button" disabled={saving} onClick={() => void batchDefault()}><Plus size={16} />一键生成正常出勤</button></>
            : <button className="primary-button" type="button" onClick={beginAbnormal}><Plus size={16} />登记异常工时</button>}
        </section>

        {error && <div className="attendance-error" role="alert"><AlertTriangle size={16} />{error}</div>}

        {tab === 'attendance' ? (
          <section className="attendance-ledger">
            <header><div><span>手工考勤</span><h1>{date} 出勤登记</h1></div><label><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、姓名、岗位或班组" /></label></header>
            <div className="attendance-table-wrap hm-scroll-region" tabIndex={0}>
              <div className="attendance-table-head"><span>员工</span><span>状态</span><span>有效出勤</span><span>加班</span><span>请假</span><span>确认</span><span>操作</span></div>
              {filteredEmployees.map(employee => {
                const record = recordByEmployee.get(employee.id);
                return <div className={`attendance-row ${record?.status || 'missing'}`} key={employee.id}>
                  <div><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || '岗位未设置'} · {employee.team || '班组未设置'}</small></div>
                  <span>{record ? attendanceTypeLabel(record.attendanceType) : '未登记'}</span>
                  <b>{record ? formatProcessDuration(record.actualMilliseconds) : '-'}</b>
                  <b>{record ? formatProcessDuration(record.overtimeMilliseconds) : '-'}</b>
                  <b>{record ? formatProcessDuration(record.leaveMilliseconds) : '-'}</b>
                  <em>{record?.status === 'confirmed' ? '已确认' : record ? '草稿' : '缺失'}</em>
                  <button type="button" onClick={() => openAttendance(employee)}><Pencil size={15} />{record ? '编辑' : '登记'}</button>
                </div>;
              })}
              {!loading && !filteredEmployees.length && <div className="attendance-empty"><UsersRound /><strong>没有可登记考勤的员工</strong><span>请先在员工档案中启用考勤。</span><a href="/workspace/employees">打开员工档案</a></div>}
            </div>
          </section>
        ) : (
          <section className="abnormal-ledger">
            <header>
              <div><span>{tab === 'quality' ? '二次确认' : '异常账本'}</span><h1>{tab === 'quality' ? '待品质确认异常' : `${periodLabel(period)}异常工时`}</h1></div>
              <p>当前尚未启用角色权限，所有登录账号均可执行品质确认；系统会完整记录确认人、时间和说明。</p>
            </header>
            <div className="abnormal-list hm-scroll-region" tabIndex={0}>
              {visibleEvents.map(event => <article className={`abnormal-card ${event.qualityStatus}`} key={event.id}>
                <header><div><em>#{event.sequence}</em><span>{event.categoryLabel}</span><strong>{event.title}</strong></div><b>{eventStatusLabel(event)}</b></header>
                <div className="abnormal-card-grid">
                  <span><small>异常时段</small><strong>{toTime(event.startedAt)}–{toTime(event.endedAt)}</strong></span>
                  <span><small>事件时长</small><strong>{formatProcessDuration(event.durationMilliseconds)}</strong></span>
                  <span><small>影响人时</small><strong>{formatProcessDuration(event.affectedPersonMilliseconds)}</strong></span>
                  <span><small>受影响员工</small><strong title={event.allocations.map(item => item.employee.name).join('、')}>{event.allocations.map(item => item.employee.name).join('、')}</strong></span>
                  <span><small>免责口径</small><strong>{event.employeeExempt ? '申请不影响个人达成率' : '不申请免责'}</strong></span>
                  <span><small>处理状态</small><strong>{event.resolutionStatus === 'resolved' ? '已关闭' : '处理中'}</strong></span>
                </div>
                {event.reason && <p>{event.reason}</p>}
                {event.qualityNote && <p className="quality-note">品质说明：{event.qualityNote}</p>}
                <footer>
                  <button type="button" disabled={saving} onClick={() => editAbnormal(event)}><Pencil size={15} />编辑</button>
                  {event.qualityStatus === 'pending' && <>
                    <button className="confirm" type="button" disabled={saving} onClick={() => void quality(event, 'confirmed')}><Check size={15} />确认</button>
                    <button type="button" disabled={saving} onClick={() => void quality(event, 'rejected')}><X size={15} />驳回</button>
                  </>}
                  {event.resolutionStatus === 'open' && <button type="button" disabled={saving} onClick={() => void resolveEvent(event)}><CheckCircle2 size={15} />关闭异常</button>}
                  <button className="danger" type="button" disabled={saving} onClick={() => void removeEvent(event)}><Trash2 size={15} />删除</button>
                </footer>
              </article>)}
              {!loading && !visibleEvents.length && <div className="attendance-empty"><ShieldCheck /><strong>{tab === 'quality' ? '没有待确认异常' : '当前周期没有异常工时'}</strong><span>异常事件会在这里按事件时长和影响人时分别汇总。</span></div>}
            </div>
          </section>
        )}
      </div>

      {attendanceDraft && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAttendanceDraft(null); }}>
        <section className="attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title">
          <header><div><span>员工考勤</span><h2 id="attendance-dialog-title">{employees.find(item => item.id === attendanceDraft.employeeId)?.name} · {date}</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setAttendanceDraft(null)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <label><span>出勤类型</span><select value={attendanceDraft.attendanceType} onChange={event => setAttendanceDraft({ ...attendanceDraft, attendanceType: event.target.value as AttendanceType })}><option value="normal">正常出勤</option><option value="leave">全天请假</option><option value="absent">缺勤</option><option value="rest">休息日</option></select></label>
            {attendanceDraft.attendanceType === 'normal' && <>
              <fieldset><legend>正常班（午休 12:00–13:00 不计）</legend><label><span>上午开始</span><input type="time" value={attendanceDraft.morningStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, morningStart: event.target.value })} /></label><label><span>上午结束</span><input type="time" value={attendanceDraft.morningEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, morningEnd: event.target.value })} /></label><label><span>下午开始</span><input type="time" value={attendanceDraft.afternoonStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, afternoonStart: event.target.value })} /></label><label><span>下午结束</span><input type="time" value={attendanceDraft.afternoonEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, afternoonEnd: event.target.value })} /></label></fieldset>
              <fieldset><legend>不定时加班（可留空）</legend><label><span>加班开始</span><input type="time" value={attendanceDraft.overtimeStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, overtimeStart: event.target.value })} /></label><label><span>加班结束</span><input type="time" value={attendanceDraft.overtimeEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, overtimeEnd: event.target.value })} /></label><label><span>部分请假（分钟）</span><input type="number" min="0" step="30" value={attendanceDraft.leaveMinutes} onChange={event => setAttendanceDraft({ ...attendanceDraft, leaveMinutes: event.target.value })} /></label></fieldset>
            </>}
            <label className="wide"><span>考勤备注</span><textarea maxLength={500} rows={3} value={attendanceDraft.remark} onChange={event => setAttendanceDraft({ ...attendanceDraft, remark: event.target.value })} placeholder="迟到、早退、连班或其他说明" /></label>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setAttendanceDraft(null)}>取消</button><button type="button" disabled={saving} onClick={() => void saveAttendance(false)}><Save size={16} />保存草稿</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveAttendance(true)}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存并确认</button></footer>
        </section>
      </div>}

      {abnormalDraft && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAbnormalDraft(null); }}>
        <section className="attendance-dialog abnormal-dialog" role="dialog" aria-modal="true" aria-labelledby="abnormal-dialog-title">
          <header><div><span>现场异常</span><h2 id="abnormal-dialog-title">{abnormalDraft.id ? '编辑异常工时' : '登记异常工时'}</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setAbnormalDraft(null)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <label><span>异常分类</span><select value={abnormalDraft.category} onChange={event => setAbnormalDraft({ ...abnormalDraft, category: event.target.value as AbnormalTimeCategory })}>{ABNORMAL_TIME_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="wide"><span>异常标题</span><input maxLength={160} value={abnormalDraft.title} onChange={event => setAbnormalDraft({ ...abnormalDraft, title: event.target.value })} placeholder="例如：端子缺料等待补料" /></label>
            <label><span>开始时间</span><input type="datetime-local" value={abnormalDraft.startedAt} onChange={event => setAbnormalDraft({ ...abnormalDraft, startedAt: event.target.value })} /></label>
            <label><span>结束时间</span><input type="datetime-local" value={abnormalDraft.endedAt} onChange={event => setAbnormalDraft({ ...abnormalDraft, endedAt: event.target.value })} /></label>
            <label><span>责任部门</span><input maxLength={100} value={abnormalDraft.responsibilityDepartment} onChange={event => setAbnormalDraft({ ...abnormalDraft, responsibilityDepartment: event.target.value })} placeholder="可选" /></label>
            <label><span>预计恢复时间</span><input type="datetime-local" value={abnormalDraft.expectedResolvedAt} onChange={event => setAbnormalDraft({ ...abnormalDraft, expectedResolvedAt: event.target.value })} /></label>
            <fieldset className="employee-picker"><legend>受影响员工（可多选）</legend>{employees.map(employee => <label key={employee.id}><input type="checkbox" checked={abnormalDraft.employeeIds.includes(employee.id)} onChange={change => setAbnormalDraft({ ...abnormalDraft, employeeIds: change.target.checked ? [...abnormalDraft.employeeIds, employee.id] : abnormalDraft.employeeIds.filter(id => id !== employee.id) })} /><span><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || '岗位未设置'}</small></span></label>)}</fieldset>
            <label className="attendance-exempt"><input type="checkbox" checked={abnormalDraft.employeeExempt} onChange={event => setAbnormalDraft({ ...abnormalDraft, employeeExempt: event.target.checked })} /><span><strong>申请员工达成率免责</strong><small>品质确认后，此时段才会从个人有效生产时段中扣除；管理端仍统计异常损失。</small></span></label>
            <label className="wide"><span>异常原因与现场说明</span><textarea maxLength={1000} rows={3} value={abnormalDraft.reason} onChange={event => setAbnormalDraft({ ...abnormalDraft, reason: event.target.value })} /></label>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setAbnormalDraft(null)}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveAbnormal()}>{saving ? <Loader2 className="spin" size={16} /> : <FileWarning size={16} />}提交品质确认</button></footer>
        </section>
      </div>}

      {loading && <div className="attendance-loading"><Loader2 className="spin" /><span>正在加载考勤与异常账本</span></div>}
    </main>
  );
}
