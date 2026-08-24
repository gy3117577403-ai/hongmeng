'use client';

import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  FileWarning,
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchCockpitCommand } from '@/components/layout/WorkbenchCockpitCommand';
import { ABNORMAL_TIME_CATEGORIES } from '@/lib/attendance';
import { formatProcessDuration } from '@/lib/process-time';
import {
  isProductionDepartment,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';
import type {
  AbnormalTimeCategory,
  AbnormalTimeEventDTO,
  AttendanceRecordDTO,
  AttainmentStream,
  AttendanceType,
  CurrentUserDTO,
  EmployeeDTO,
} from '@/types';

type TabKey = 'attendance' | 'abnormal' | 'quality';
type Period = 'today' | 'week' | 'month';
type ExportPeriod = 'week' | 'month' | 'custom';
type AttendancePermissions = {
  allowedWorkforceScopes: AttendanceWorkforceScope[];
  scopeLabel: string;
  unrestricted: boolean;
};
type EmployeesResponse = {
  ok: boolean;
  employees?: EmployeeDTO[];
  permissions?: AttendancePermissions;
  error?: string;
};
type AttendanceResponse = {
  ok: boolean;
  records?: AttendanceRecordDTO[];
  scope?: AttendanceWorkforceScope;
  scopeCounts?: { production: number; other: number; all: number };
  permissions?: AttendancePermissions;
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
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
  remark: string;
};

type AttendanceBatchDraft = Omit<AttendanceDraft, 'employeeId' | 'attainmentFactorBasisPoints' | 'attainmentStream'>;

type AbnormalDraft = {
  id?: string;
  category: AbnormalTimeCategory;
  title: string;
  workDate: string;
  durationMinutes: string;
  employeeIds: string[];
  responsibilityDepartment: string;
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
  return type === 'partial_leave'
    ? '部分请假'
    : type === 'leave'
      ? '全天请假'
      : type === 'absent'
        ? '缺勤'
        : type === 'rest'
          ? '休息日'
          : '正常出勤';
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
  const [workforceScope, setWorkforceScope] = useState<AttendanceWorkforceScope>('PRODUCTION');
  const [employeeDirectory, setEmployeeDirectory] = useState<EmployeeDTO[]>([]);
  const [scopeCounts, setScopeCounts] = useState({ production: 0, other: 0, all: 0 });
  const [allowedWorkforceScopes, setAllowedWorkforceScopes] = useState<AttendanceWorkforceScope[]>(['PRODUCTION']);
  const [accessScopeLabel, setAccessScopeLabel] = useState('生产范围');
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
  const [batchAttendanceDraft, setBatchAttendanceDraft] = useState<AttendanceBatchDraft | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [abnormalDraft, setAbnormalDraft] = useState<AbnormalDraft | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>('week');
  const [exportStartDate, setExportStartDate] = useState(todayKey);
  const [exportEndDate, setExportEndDate] = useState(todayKey);
  const [exportSelectedOnly, setExportSelectedOnly] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'abnormal' || requestedTab === 'quality') setTab(requestedTab);
    const employeeId = params.get('employeeId') || '';
    if (employeeId) setKeyword(employeeId);
    const workOrderId = params.get('workOrderId') || '';
    if (requestedTab === 'abnormal' && workOrderId) {
      setAbnormalDraft({
        category: 'other', title: '', workDate: todayKey(), durationMinutes: '30',
        employeeIds: [], responsibilityDepartment: '', reason: '', workOrderId,
      });
    }
  }, []);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [employeeResponse, attendanceResponse, eventResponse] = await Promise.all([
        fetch('/api/attendance/employees', { cache: 'no-store', signal }),
        fetch(`/api/attendance/records?period=today&date=${encodeURIComponent(date)}&scope=${workforceScope}`, { cache: 'no-store', signal }),
        fetch(`/api/abnormal-time-events?period=${period}&date=${encodeURIComponent(date)}`, { cache: 'no-store', signal }),
      ]);
      const employeeBody = await employeeResponse.json() as EmployeesResponse;
      const attendanceBody = await attendanceResponse.json() as AttendanceResponse;
      const eventBody = await eventResponse.json() as EventsResponse;
      if (!employeeResponse.ok) throw new Error(employeeBody.error || '员工档案加载失败');
      if (!attendanceResponse.ok) throw new Error(attendanceBody.error || '考勤记录加载失败');
      if (!eventResponse.ok) throw new Error(eventBody.error || '异常工时加载失败');
      setEmployeeDirectory((employeeBody.employees || []).filter(item => item.attendanceEnabled));
      setRecords(attendanceBody.records || []);
      setScopeCounts(attendanceBody.scopeCounts || { production: 0, other: 0, all: 0 });
      const permissions = attendanceBody.permissions || employeeBody.permissions;
      if (permissions) {
        setAllowedWorkforceScopes(permissions.allowedWorkforceScopes);
        setAccessScopeLabel(permissions.scopeLabel);
        if (!permissions.allowedWorkforceScopes.includes(workforceScope)) {
          setWorkforceScope(permissions.allowedWorkforceScopes[0] || 'PRODUCTION');
        }
      }
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
  }, [date, period, workforceScope]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!attendanceDraft && !batchAttendanceDraft && !abnormalDraft && !exportOpen) return;
    function close(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setAttendanceDraft(null);
      setBatchAttendanceDraft(null);
      setAbnormalDraft(null);
      setExportOpen(false);
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [attendanceDraft, batchAttendanceDraft, abnormalDraft, exportOpen]);

  const productionEmployees = useMemo(
    () => employeeDirectory.filter(item => isProductionDepartment(item.department)),
    [employeeDirectory],
  );
  const employees = useMemo(() => {
    if (workforceScope === 'ALL') return employeeDirectory;
    if (workforceScope === 'PRODUCTION') return productionEmployees;
    return employeeDirectory.filter(item => !isProductionDepartment(item.department));
  }, [employeeDirectory, productionEmployees, workforceScope]);
  const workforceLabel = workforceScope === 'PRODUCTION'
    ? '生产考勤'
    : workforceScope === 'OTHER'
      ? '其他人员'
      : '全部人员';
  const workforceNote = workforceScope === 'PRODUCTION'
    ? '用于生产报工、日计划与员工达成率'
    : workforceScope === 'OTHER'
      ? '仅统计出勤，不参与生产报工与达成率'
      : '汇总全员出勤；生产达成率仍只读取生产考勤';
  const recordByEmployee = useMemo(() => new Map(records.map(item => [item.employeeId, item])), [records]);
  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return employees;
    return employees.filter(item => `${item.id} ${item.employeeNo} ${item.name} ${item.department || ''} ${item.position || ''} ${item.team || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [employees, keyword]);
  const visibleEmployeeIds = useMemo(() => filteredEmployees.map(employee => employee.id), [filteredEmployees]);
  const visibleEmployeeIdSet = useMemo(() => new Set(visibleEmployeeIds), [visibleEmployeeIds]);
  const selectedEmployeeIdSet = useMemo(() => new Set(selectedEmployeeIds), [selectedEmployeeIds]);
  const selectedVisibleCount = visibleEmployeeIds.filter(employeeId => selectedEmployeeIdSet.has(employeeId)).length;
  const allVisibleSelected = visibleEmployeeIds.length > 0 && selectedVisibleCount === visibleEmployeeIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedEmployeeIds([]);
    setBatchAttendanceDraft(null);
  }, [date, workforceScope]);

  useEffect(() => {
    setSelectedEmployeeIds(current => current.filter(employeeId => visibleEmployeeIdSet.has(employeeId)));
  }, [visibleEmployeeIdSet]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);
  const visibleEvents = tab === 'quality' ? events.filter(item => item.qualityStatus === 'pending') : events;
  const canOpenEmployeeAdmin = user.access.modules.includes('HR');
  const canReviewQuality = user.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW')
    || (
      user.access.capabilities.includes('PRODUCTION:EXECUTE_WORKFLOW')
      && (user.access.productionScope === 'WORKSHOP' || user.access.productionScope === 'GLOBAL')
    );
  const canResolveAbnormal = user.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW')
    || (
      user.access.capabilities.includes('PRODUCTION:EXECUTE_WORKFLOW')
      && (user.access.productionScope === 'WORKSHOP' || user.access.productionScope === 'GLOBAL')
    );

  useEffect(() => {
    if (tab === 'quality' && !canReviewQuality) setTab('abnormal');
  }, [canReviewQuality, tab]);

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
      attainmentFactorBasisPoints: record?.attainmentFactorBasisPoints ?? employee.attainmentFactorBasisPoints,
      attainmentStream: record?.attainmentStream ?? employee.attainmentStream,
      remark: record?.remark || '',
    });
  }

  function toggleEmployeeSelection(employeeId: string, checked: boolean): void {
    setSelectedEmployeeIds(current => checked
      ? [...new Set([...current, employeeId])]
      : current.filter(id => id !== employeeId));
  }

  async function exportAttendance(): Promise<void> {
    if (exportSelectedOnly && !selectedEmployeeIds.length) {
      setError('请先选择需要导出的员工，或改为导出当前权限范围');
      return;
    }
    if (exportPeriod === 'custom' && exportEndDate < exportStartDate) {
      setError('导出结束日期不能早于开始日期');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const params = new URLSearchParams({ period: exportPeriod, date, scope: workforceScope });
      if (exportPeriod === 'custom') {
        params.set('startDate', exportStartDate);
        params.set('endDate', exportEndDate);
      }
      if (exportSelectedOnly) params.set('employeeIds', selectedEmployeeIds.join(','));
      const response = await fetch(`/api/attendance/export.xlsx?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '考勤导出失败');
      }
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : `员工出勤记录表-${date}.xlsx`;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setToast('员工出勤记录表已导出：一个文件、一张工作表');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '考勤导出失败');
    } finally {
      setSaving(false);
    }
  }

  function toggleVisibleSelection(checked: boolean): void {
    setSelectedEmployeeIds(checked ? visibleEmployeeIds : []);
  }

  function openBatchAttendance(): void {
    if (!selectedEmployeeIds.length) return;
    setBatchAttendanceDraft({
      attendanceType: 'normal',
      morningStart: '08:00',
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: '17:00',
      overtimeStart: '',
      overtimeEnd: '',
      leaveMinutes: '0',
      remark: '',
    });
  }

  async function batchDefault(employeeIds?: string[]): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/attendance/records/batch-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate: date,
          scope: workforceScope,
          ...(employeeIds?.length ? { employeeIds } : {}),
        }),
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

  async function batchConfirm(employeeIds?: string[]): Promise<void> {
    const rangeLabel = employeeIds?.length ? `所选 ${employeeIds.length} 人` : workforceLabel;
    if (!window.confirm(`确认 ${date} 的${rangeLabel}草稿？请先修改请假、缺勤和加班例外。`)) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/attendance/records/batch-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate: date,
          scope: workforceScope,
          ...(employeeIds?.length ? { employeeIds } : {}),
        }),
      });
      const body = await response.json() as { ok: boolean; confirmedCount?: number; skippedCount?: number; missingCount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || '批量确认失败');
      setToast(`已确认 ${body.confirmedCount || 0} 条，跳过 ${body.skippedCount || 0} 条`);
      if (employeeIds?.length) setSelectedEmployeeIds([]);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量确认考勤失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveBatchAttendance(): Promise<void> {
    if (!batchAttendanceDraft || !selectedEmployeeIds.length) return;
    setSaving(true);
    setError('');
    try {
      const segments = batchAttendanceDraft.attendanceType === 'normal' || batchAttendanceDraft.attendanceType === 'partial_leave'
        ? [
            { type: 'regular', startedAt: isoFor(date, batchAttendanceDraft.morningStart), endedAt: isoFor(date, batchAttendanceDraft.morningEnd) },
            { type: 'regular', startedAt: isoFor(date, batchAttendanceDraft.afternoonStart), endedAt: isoFor(date, batchAttendanceDraft.afternoonEnd) },
            ...(batchAttendanceDraft.overtimeStart && batchAttendanceDraft.overtimeEnd
              ? [{ type: 'overtime', startedAt: isoFor(date, batchAttendanceDraft.overtimeStart), endedAt: isoFor(date, batchAttendanceDraft.overtimeEnd) }]
              : []),
          ]
        : [];
      const response = await fetch('/api/attendance/records/batch-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...batchAttendanceDraft,
          workDate: date,
          scope: workforceScope,
          employeeIds: selectedEmployeeIds,
          segments,
        }),
      });
      const body = await response.json() as { ok: boolean; savedCount?: number; skippedCount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || '批量设置失败');
      setBatchAttendanceDraft(null);
      setToast(`已保存 ${body.savedCount || 0} 条草稿，已确认记录跳过 ${body.skippedCount || 0} 条`);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量设置考勤失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance(confirm: boolean): Promise<void> {
    if (!attendanceDraft) return;
    setSaving(true);
    setError('');
    try {
      const segments = attendanceDraft.attendanceType === 'normal' || attendanceDraft.attendanceType === 'partial_leave'
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
    setAbnormalDraft({
      category: 'equipment', title: '', workDate: date, durationMinutes: '30',
      employeeIds: [], responsibilityDepartment: '', reason: '', workOrderId: '',
    });
  }

  function editAbnormal(event: AbnormalTimeEventDTO): void {
    setAbnormalDraft({
      id: event.id,
      category: event.category,
      title: event.title,
      workDate: event.workDate,
      durationMinutes: String(Math.max(1, Math.round(event.durationMilliseconds / 60_000))),
      employeeIds: event.allocations.map(item => item.employeeId),
      responsibilityDepartment: event.responsibilityDepartment || '',
      reason: event.reason || '',
      workOrderId: event.workOrder?.id || '',
    });
  }

  async function saveAbnormal(): Promise<void> {
    if (!abnormalDraft) return;
    setSaving(true);
    setError('');
    try {
      const durationMinutes = Number(abnormalDraft.durationMinutes);
      if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
        throw new Error('异常时长必须是大于 0 的整数分钟');
      }
      const response = await fetch(abnormalDraft.id ? `/api/abnormal-time-events/${abnormalDraft.id}` : '/api/abnormal-time-events', {
        method: abnormalDraft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...abnormalDraft,
          durationMinutes,
        }),
      });
      const body = await response.json() as EventsResponse;
      if (!response.ok) throw new Error(body.error || '异常工时保存失败');
      setAbnormalDraft(null);
      setDate(abnormalDraft.workDate);
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
      : '';
    if (note === null || (decision === 'rejected' && !note.trim())) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/abnormal-time-events/${event.id}/quality`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          decision,
          note,
          expectedVersion: event.version,
        }),
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
    <main className="attendance-workbench hm-workbench-root hm-cockpit-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/attendance"
        subtitle="手工考勤、异常免责与品质确认"
        menuItems={[{ label: '修改密码', href: '/dashboard?changePassword=1' }, { label: '退出登录', onSelect: () => void logout() }]}
        hideHeader
        sidebarTriggerTargetId="attendance-navigation-trigger"
      />
      <div className="attendance-frame">
        <WorkbenchCockpitCommand
          navigationTargetId="attendance-navigation-trigger"
          icon={<CalendarClock size={19} />}
          title="考勤与异常"
          subtitle="生产出勤、异常免责与品质确认任务驾驶舱"
          context={<><span>{attendanceSummary.confirmedCount} 条已确认</span><span>{eventSummary.pendingCount} 条待品质确认</span></>}
          search={<label><Search size={16} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、姓名、岗位或班组" aria-label="搜索考勤员工" /></label>}
          actions={<>
            {canOpenEmployeeAdmin && <a href="/workspace/employees?view=directory"><UsersRound size={15} />人事管理</a>}
            <button type="button" onClick={() => { setExportSelectedOnly(selectedEmployeeIds.length > 0); setExportOpen(true); }}><Download size={16} />导出考勤</button>
            <button className="icon-only" type="button" aria-label="刷新" title="刷新" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={16} /></button>
            {tab === 'attendance'
              ? <button className="primary" type="button" disabled={saving} onClick={() => void batchDefault(selectedEmployeeIds.length ? selectedEmployeeIds : undefined)}><Plus size={16} />{selectedEmployeeIds.length ? `为所选生成（${selectedEmployeeIds.length}）` : '生成正常出勤'}</button>
              : <button className="primary" type="button" onClick={beginAbnormal}><Plus size={16} />登记异常工时</button>}
          </>}
        />

        <section className="attendance-summary" aria-label="考勤与异常概览">
          <article><UsersRound /><span>{workforceLabel}<small>{workforceNote}</small></span><strong>{attendanceSummary.enabledEmployeeCount}</strong></article>
          <article><UserRoundCheck /><span>已确认考勤<small>{date} 日记录</small></span><strong>{attendanceSummary.confirmedCount}</strong></article>
          <article><Clock3 /><span>有效出勤<small>请假不计入</small></span><strong>{formatProcessDuration(attendanceSummary.actualMilliseconds)}</strong></article>
          <article><AlertTriangle /><span>异常事件<small>{periodLabel(period)}汇总</small></span><strong>{eventSummary.eventCount}</strong></article>
          <article className={eventSummary.pendingCount ? 'warning' : ''}><ShieldCheck /><span>待品质确认<small>确认后才影响免责口径</small></span><strong>{eventSummary.pendingCount}</strong></article>
        </section>

        <section className="attendance-toolbar">
          <div className="attendance-tabs" role="tablist" aria-label="考勤工作台视图">
            <button className={tab === 'attendance' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'attendance'} onClick={() => setTab('attendance')}><CalendarClock size={16} />考勤登记</button>
            <button className={tab === 'abnormal' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'abnormal'} onClick={() => setTab('abnormal')}><FileWarning size={16} />异常工时</button>
            {canReviewQuality && <button className={tab === 'quality' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'quality'} onClick={() => setTab('quality')}><ShieldCheck size={16} />品质确认 <em>{eventSummary.pendingCount}</em></button>}
          </div>
          <label className="attendance-date"><span>基准日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          {tab !== 'attendance' && <div className="attendance-period" role="group" aria-label="异常汇总周期">{(['today', 'week', 'month'] as Period[]).map(item => <button className={period === item ? 'active' : ''} type="button" key={item} onClick={() => setPeriod(item)}>{periodLabel(item)}</button>)}</div>}
          {tab === 'attendance'
            ? <button type="button" disabled={saving || (!attendanceSummary.draftCount && !selectedEmployeeIds.length)} onClick={() => void batchConfirm(selectedEmployeeIds.length ? selectedEmployeeIds : undefined)}><Check size={16} />{selectedEmployeeIds.length ? `确认所选（${selectedEmployeeIds.length}）` : '确认全部草稿'}</button>
            : null}
        </section>

        {error && <div className="attendance-error" role="alert"><AlertTriangle size={16} />{error}</div>}

        {tab === 'attendance' ? (
          <section className="attendance-ledger">
            <header>
              <div><span>手工考勤 · {workforceLabel}</span><h1>{date} 出勤登记</h1><small>{workforceNote} · 当前权限：{accessScopeLabel}</small></div>
              <div className="attendance-workforce-switch" role="tablist" aria-label="考勤人员范围">
                {allowedWorkforceScopes.includes('PRODUCTION') && <button className={workforceScope === 'PRODUCTION' ? 'active' : ''} type="button" role="tab" aria-selected={workforceScope === 'PRODUCTION'} onClick={() => { setWorkforceScope('PRODUCTION'); setAttendanceDraft(null); }}><strong>生产考勤</strong><em>{scopeCounts.production}</em></button>}
                {allowedWorkforceScopes.includes('OTHER') && <button className={workforceScope === 'OTHER' ? 'active' : ''} type="button" role="tab" aria-selected={workforceScope === 'OTHER'} onClick={() => { setWorkforceScope('OTHER'); setAttendanceDraft(null); }}><strong>其他人员</strong><em>{scopeCounts.other}</em></button>}
                {allowedWorkforceScopes.includes('ALL') && <button className={workforceScope === 'ALL' ? 'active' : ''} type="button" role="tab" aria-selected={workforceScope === 'ALL'} onClick={() => { setWorkforceScope('ALL'); setAttendanceDraft(null); }}><strong>全部人员</strong><em>{scopeCounts.all}</em></button>}
              </div>
            </header>
            <div className="attendance-selection-strip">
              <label>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={event => toggleVisibleSelection(event.target.checked)}
                />
                <span>{selectedEmployeeIds.length ? `已选 ${selectedEmployeeIds.length} 人` : '尚未选择员工'}</span>
              </label>
              <button type="button" disabled={!visibleEmployeeIds.length} onClick={() => toggleVisibleSelection(!allVisibleSelected)}>
                {allVisibleSelected ? '取消当前筛选全选' : `全选当前筛选结果 ${visibleEmployeeIds.length} 人`}
              </button>
              <small>日期或人员范围切换后自动清空；搜索结果变化时仅保留当前可见人员。</small>
            </div>
            <div className="attendance-table-wrap hm-scroll-region" tabIndex={0}>
              <div className="attendance-table-head"><span className="attendance-checkbox-label">选择</span><span>员工</span><span>状态</span><span>有效出勤</span><span>加班</span><span>请假</span><span>确认</span><span>操作</span></div>
              {filteredEmployees.map(employee => {
                const record = recordByEmployee.get(employee.id);
                return <div className={`attendance-row ${record?.status || 'missing'}`} key={employee.id}>
                  <label className="attendance-row-checkbox" aria-label={`选择 ${employee.name}`}><input type="checkbox" checked={selectedEmployeeIdSet.has(employee.id)} onChange={event => toggleEmployeeSelection(employee.id, event.target.checked)} /></label>
                  <div><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || '岗位未设置'} · {employee.team || '班组未设置'}</small></div>
                  <span>{record ? attendanceTypeLabel(record.attendanceType) : '未登记'}</span>
                  <b>{record ? formatProcessDuration(record.actualMilliseconds) : '-'}</b>
                  <b>{record ? formatProcessDuration(record.overtimeMilliseconds) : '-'}</b>
                  <b>{record ? formatProcessDuration(record.leaveMilliseconds) : '-'}</b>
                  <em>{record?.status === 'confirmed' ? '已确认' : record ? '草稿' : '缺失'}</em>
                  <button type="button" onClick={() => openAttendance(employee)}><Pencil size={15} />{record ? '编辑' : '登记'}</button>
                </div>;
              })}
              {!loading && !filteredEmployees.length && <div className="attendance-empty"><UsersRound /><strong>当前权限范围没有可登记考勤的员工</strong><span>请检查账号的班组范围与员工档案中的班组归属、在职状态和考勤启用状态。</span>{canOpenEmployeeAdmin && <a href="/workspace/employees?view=directory">打开人事管理</a>}</div>}
              {selectedEmployeeIds.length > 0 && <div className="attendance-bulk-bar" role="toolbar" aria-label="所选员工批量操作">
                <span><strong>{selectedEmployeeIds.length}</strong><small>人已选择</small></span>
                <button type="button" disabled={saving} onClick={() => void batchDefault(selectedEmployeeIds)}><Plus size={15} />生成正常考勤</button>
                <button type="button" disabled={saving} onClick={openBatchAttendance}><Pencil size={15} />批量设置</button>
                <button className="confirm" type="button" disabled={saving} onClick={() => void batchConfirm(selectedEmployeeIds)}><Check size={15} />确认所选草稿</button>
                <button type="button" disabled={saving} onClick={() => setSelectedEmployeeIds([])}><X size={15} />清空选择</button>
              </div>}
            </div>
          </section>
        ) : (
          <section className="abnormal-ledger">
            <header>
              <div><span>{tab === 'quality' ? '二次确认' : '异常账本'}</span><h1>{tab === 'quality' ? '待品质确认异常' : `${periodLabel(period)}异常工时`}</h1></div>
              <p>异常数据按账号职责范围读取；品质确认仅对质量人员或生产主管开放，并完整记录确认人、时间和说明。</p>
            </header>
            <div className="abnormal-list hm-scroll-region" tabIndex={0}>
              {visibleEvents.map(event => <article className={`abnormal-card ${event.qualityStatus}`} key={event.id}>
                <header><div><em>#{event.sequence}</em><span>{event.categoryLabel}</span><strong>{event.title}</strong></div><b>{eventStatusLabel(event)}</b></header>
                <div className="abnormal-card-grid">
                  <span><small>异常日期</small><strong>{event.workDate}</strong></span>
                  <span><small>异常时长</small><strong>{formatProcessDuration(event.durationMilliseconds)}</strong></span>
                  <span><small>影响人时</small><strong>{formatProcessDuration(event.affectedPersonMilliseconds)}</strong></span>
                  <span><small>受影响员工</small><strong title={event.allocations.map(item => item.employee.name).join('、')}>{event.allocations.map(item => item.employee.name).join('、')}</strong></span>
                  <span><small>达成率口径</small><strong>{event.qualityStatus === 'confirmed' ? '已剔除异常时长' : '审核后剔除异常时长'}</strong></span>
                  <span><small>处理状态</small><strong>{event.resolutionStatus === 'resolved' ? '已关闭' : '处理中'}</strong></span>
                </div>
                {event.reason && <p>{event.reason}</p>}
                {event.qualityNote && <p className="quality-note">品质说明：{event.qualityNote}</p>}
                <footer>
                  <button type="button" disabled={saving} onClick={() => editAbnormal(event)}><Pencil size={15} />编辑</button>
                  {canReviewQuality && event.qualityStatus === 'pending' && <>
                    <button className="confirm" type="button" disabled={saving} onClick={() => void quality(event, 'confirmed')}><Check size={15} />同意</button>
                    <button type="button" disabled={saving} onClick={() => void quality(event, 'rejected')}><X size={15} />驳回</button>
                  </>}
                  {canResolveAbnormal && event.resolutionStatus === 'open' && <button type="button" disabled={saving} onClick={() => void resolveEvent(event)}><CheckCircle2 size={15} />关闭异常</button>}
                  <button className="danger" type="button" disabled={saving} onClick={() => void removeEvent(event)}><Trash2 size={15} />删除</button>
                </footer>
              </article>)}
              {!loading && !visibleEvents.length && <div className="attendance-empty"><ShieldCheck /><strong>{tab === 'quality' ? '没有待确认异常' : '当前周期没有异常工时'}</strong><span>异常事件会在这里按事件时长和影响人时分别汇总。</span></div>}
            </div>
          </section>
        )}
      </div>

      {exportOpen && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setExportOpen(false); }}>
        <section className="attendance-dialog attendance-export-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-export-title">
          <header><div><span>单页业务报表</span><h2 id="attendance-export-title">导出员工出勤记录表</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setExportOpen(false)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <div className="attendance-batch-warning"><ShieldCheck size={16} /><span><strong>一个文件只输出一张员工出勤表</strong><small>顶部 4 项指标、每日工时矩阵、人员汇总和 2 张紧凑图表全部在同一工作表；草稿与缺失以状态标记，不再拆分多张表。</small></span></div>
            <fieldset><legend>统计周期</legend>{(['week', 'month', 'custom'] as ExportPeriod[]).map(item => <label key={item}><input type="radio" name="attendance-export-period" checked={exportPeriod === item} onChange={() => setExportPeriod(item)} /><span>{item === 'week' ? '按周' : item === 'month' ? '按月' : '自定义日期'}</span></label>)}</fieldset>
            {exportPeriod === 'custom' && <fieldset><legend>自定义日期（含首尾两天）</legend><label><span>开始日期</span><input type="date" value={exportStartDate} max={exportEndDate} onChange={event => setExportStartDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={exportEndDate} min={exportStartDate} onChange={event => setExportEndDate(event.target.value)} /></label></fieldset>}
            <fieldset><legend>人员范围</legend><label><input type="radio" name="attendance-export-scope" checked={!exportSelectedOnly} onChange={() => setExportSelectedOnly(false)} /><span>当前权限范围 · {workforceLabel}</span></label><label><input type="radio" name="attendance-export-scope" checked={exportSelectedOnly} disabled={!selectedEmployeeIds.length} onChange={() => setExportSelectedOnly(true)} /><span>仅导出已选 {selectedEmployeeIds.length} 人</span></label></fieldset>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setExportOpen(false)}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={() => void exportAttendance()}>{saving ? <Loader2 className="spin" size={16} /> : <Download size={16} />}生成并下载 Excel</button></footer>
        </section>
      </div>}

      {attendanceDraft && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAttendanceDraft(null); }}>
        <section className="attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title">
          <header><div><span>{workforceLabel}</span><h2 id="attendance-dialog-title">{employees.find(item => item.id === attendanceDraft.employeeId)?.name} · {date}</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setAttendanceDraft(null)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <label><span>出勤类型</span><select value={attendanceDraft.attendanceType} onChange={event => setAttendanceDraft({ ...attendanceDraft, attendanceType: event.target.value as AttendanceType, leaveMinutes: event.target.value === 'normal' ? '0' : attendanceDraft.leaveMinutes })}><option value="normal">正常出勤</option><option value="partial_leave">部分请假</option><option value="leave">全天请假</option><option value="absent">缺勤</option><option value="rest">休息日</option></select></label>
            {(attendanceDraft.attendanceType === 'normal' || attendanceDraft.attendanceType === 'partial_leave') && <>
              <fieldset><legend>正常班（午休 12:00–13:00 不计）</legend><label><span>上午开始</span><input type="time" value={attendanceDraft.morningStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, morningStart: event.target.value })} /></label><label><span>上午结束</span><input type="time" value={attendanceDraft.morningEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, morningEnd: event.target.value })} /></label><label><span>下午开始</span><input type="time" value={attendanceDraft.afternoonStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, afternoonStart: event.target.value })} /></label><label><span>下午结束</span><input type="time" value={attendanceDraft.afternoonEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, afternoonEnd: event.target.value })} /></label></fieldset>
              <fieldset><legend>不定时加班与请假</legend><label><span>加班开始</span><input type="time" value={attendanceDraft.overtimeStart} onChange={event => setAttendanceDraft({ ...attendanceDraft, overtimeStart: event.target.value })} /></label><label><span>加班结束</span><input type="time" value={attendanceDraft.overtimeEnd} onChange={event => setAttendanceDraft({ ...attendanceDraft, overtimeEnd: event.target.value })} /></label><label><span>{attendanceDraft.attendanceType === 'partial_leave' ? '实际请假分钟数' : '请假分钟数（应为 0）'}</span><input type="number" min="0" step="1" value={attendanceDraft.leaveMinutes} onChange={event => setAttendanceDraft({ ...attendanceDraft, leaveMinutes: event.target.value })} /></label></fieldset>
            </>}
            <fieldset className="attendance-attainment-policy"><legend>当天达成率口径</legend><label><span>统计分账</span><select value={attendanceDraft.attainmentStream} onChange={event => { const attainmentStream = event.target.value as AttainmentStream; setAttendanceDraft({ ...attendanceDraft, attainmentStream, attainmentFactorBasisPoints: attainmentStream === 'excluded' ? 0 : attendanceDraft.attainmentFactorBasisPoints || 10000 }); }}><option value="batch">批量生产</option><option value="sample">样品组</option><option value="excluded">当天不计入</option></select></label><label><span>个人计入比例（任意值）</span><span className="attendance-factor-input"><input type="number" min="0" max="100" step="0.1" disabled={attendanceDraft.attainmentStream === 'excluded'} value={attendanceDraft.attainmentFactorBasisPoints / 100} onChange={event => setAttendanceDraft({ ...attendanceDraft, attainmentFactorBasisPoints: Math.max(0, Math.min(10000, Math.round(Number(event.target.value || 0) * 100))) })} /><b>%</b></span></label><small>部分请假先按实际出勤小时折算，再乘此比例；例如工作 3 小时、个人比例 50%，当天产能分母按 3h × 95% × 50% 计算。</small></fieldset>
            <label className="wide"><span>考勤备注</span><textarea maxLength={500} rows={3} value={attendanceDraft.remark} onChange={event => setAttendanceDraft({ ...attendanceDraft, remark: event.target.value })} placeholder="迟到、早退、连班或其他说明" /></label>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setAttendanceDraft(null)}>取消</button><button type="button" disabled={saving} onClick={() => void saveAttendance(false)}><Save size={16} />保存草稿</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveAttendance(true)}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存并确认</button></footer>
        </section>
      </div>}

      {batchAttendanceDraft && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setBatchAttendanceDraft(null); }}>
        <section className="attendance-dialog batch-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-batch-dialog-title">
          <header><div><span>批量考勤设置 · {workforceLabel}</span><h2 id="attendance-batch-dialog-title">{date} · 所选 {selectedEmployeeIds.length} 人</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setBatchAttendanceDraft(null)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <div className="attendance-batch-warning"><AlertTriangle size={16} /><span><strong>只保存为草稿</strong><small>已确认记录自动跳过，确认需回到列表执行“确认所选草稿”。</small></span></div>
            <label><span>出勤类型</span><select value={batchAttendanceDraft.attendanceType} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, attendanceType: event.target.value as AttendanceType, leaveMinutes: event.target.value === 'normal' ? '0' : batchAttendanceDraft.leaveMinutes })}><option value="normal">正常出勤</option><option value="partial_leave">部分请假</option><option value="leave">全天请假</option><option value="absent">缺勤</option><option value="rest">休息日</option></select></label>
            {(batchAttendanceDraft.attendanceType === 'normal' || batchAttendanceDraft.attendanceType === 'partial_leave') && <>
              <fieldset><legend>统一正常班（午休 12:00–13:00 不计）</legend><label><span>上午开始</span><input type="time" value={batchAttendanceDraft.morningStart} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, morningStart: event.target.value })} /></label><label><span>上午结束</span><input type="time" value={batchAttendanceDraft.morningEnd} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, morningEnd: event.target.value })} /></label><label><span>下午开始</span><input type="time" value={batchAttendanceDraft.afternoonStart} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, afternoonStart: event.target.value })} /></label><label><span>下午结束</span><input type="time" value={batchAttendanceDraft.afternoonEnd} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, afternoonEnd: event.target.value })} /></label></fieldset>
              <fieldset><legend>统一加班与部分请假</legend><label><span>加班开始</span><input type="time" value={batchAttendanceDraft.overtimeStart} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, overtimeStart: event.target.value })} /></label><label><span>加班结束</span><input type="time" value={batchAttendanceDraft.overtimeEnd} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, overtimeEnd: event.target.value })} /></label><label><span>实际请假分钟数</span><input type="number" min="0" step="1" value={batchAttendanceDraft.leaveMinutes} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, leaveMinutes: event.target.value })} /></label></fieldset>
            </>}
            <label className="wide"><span>统一备注</span><textarea maxLength={500} rows={3} value={batchAttendanceDraft.remark} onChange={event => setBatchAttendanceDraft({ ...batchAttendanceDraft, remark: event.target.value })} placeholder="选填；将写入所有未确认记录" /></label>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setBatchAttendanceDraft(null)}>取消</button><button className="primary-button" type="button" disabled={saving || !selectedEmployeeIds.length} onClick={() => void saveBatchAttendance()}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}保存 {selectedEmployeeIds.length} 人草稿</button></footer>
        </section>
      </div>}

      {abnormalDraft && <div className="attendance-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAbnormalDraft(null); }}>
        <section className="attendance-dialog abnormal-dialog" role="dialog" aria-modal="true" aria-labelledby="abnormal-dialog-title">
          <header><div><span>现场异常</span><h2 id="abnormal-dialog-title">{abnormalDraft.id ? '编辑异常工时' : '登记异常工时'}</h2></div><button type="button" aria-label="关闭" title="关闭" onClick={() => setAbnormalDraft(null)}><X size={18} /></button></header>
          <div className="attendance-dialog-body">
            <label><span>异常分类</span><select value={abnormalDraft.category} onChange={event => setAbnormalDraft({ ...abnormalDraft, category: event.target.value as AbnormalTimeCategory })}>{ABNORMAL_TIME_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="wide"><span>异常标题</span><input maxLength={160} value={abnormalDraft.title} onChange={event => setAbnormalDraft({ ...abnormalDraft, title: event.target.value })} placeholder="例如：端子缺料等待补料" /></label>
            <label><span>异常日期</span><input type="date" value={abnormalDraft.workDate} onChange={event => setAbnormalDraft({ ...abnormalDraft, workDate: event.target.value })} /></label>
            <label><span>异常时长（分钟）</span><input inputMode="numeric" type="number" min="1" step="1" value={abnormalDraft.durationMinutes} onFocus={event => event.currentTarget.select()} onChange={event => setAbnormalDraft({ ...abnormalDraft, durationMinutes: event.target.value })} /></label>
            <label><span>责任部门</span><input maxLength={100} value={abnormalDraft.responsibilityDepartment} onChange={event => setAbnormalDraft({ ...abnormalDraft, responsibilityDepartment: event.target.value })} placeholder="可选" /></label>
            <fieldset className="employee-picker"><legend>受影响生产员工（可多选）</legend>{productionEmployees.map(employee => <label key={employee.id}><input type="checkbox" checked={abnormalDraft.employeeIds.includes(employee.id)} onChange={change => setAbnormalDraft({ ...abnormalDraft, employeeIds: change.target.checked ? [...abnormalDraft.employeeIds, employee.id] : abnormalDraft.employeeIds.filter(id => id !== employee.id) })} /><span><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.position || '岗位未设置'}</small></span></label>)}</fieldset>
            <div className="attendance-exempt"><ShieldCheck size={18} /><span><strong>审核后自动保护个人达成率</strong><small>完整异常时长从个人达成率有效工时分母中扣除；不增加标准产出工时。</small></span></div>
            <label className="wide"><span>异常原因与现场说明</span><textarea maxLength={1000} rows={3} value={abnormalDraft.reason} onChange={event => setAbnormalDraft({ ...abnormalDraft, reason: event.target.value })} /></label>
          </div>
          <footer><button type="button" disabled={saving} onClick={() => setAbnormalDraft(null)}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveAbnormal()}>{saving ? <Loader2 className="spin" size={16} /> : <FileWarning size={16} />}提交品质确认</button></footer>
        </section>
      </div>}

      {loading && <div className="attendance-loading"><Loader2 className="spin" /><span>正在加载考勤与异常账本</span></div>}
    </main>
  );
}
