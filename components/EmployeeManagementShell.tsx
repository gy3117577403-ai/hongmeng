'use client';

import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type { CurrentUserDTO, EmployeeDTO } from '@/types';

type EmployeeFilter = 'all' | 'active' | 'attendance' | 'inactive';

type EmployeeDraft = {
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  team: string;
  isActive: boolean;
  attendanceEnabled: boolean;
};

type EmployeesResponse = {
  ok: boolean;
  employees?: EmployeeDTO[];
  employee?: EmployeeDTO;
  error?: string;
};

const emptyDraft: EmployeeDraft = {
  employeeNo: '',
  name: '',
  department: '',
  position: '',
  team: '',
  isActive: true,
  attendanceEnabled: true,
};

function toDraft(employee: EmployeeDTO): EmployeeDraft {
  return {
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department || '',
    position: employee.position || '',
    team: employee.team || '',
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
  };
}

function sortEmployees(employees: EmployeeDTO[]): EmployeeDTO[] {
  return [...employees].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return left.employeeNo.localeCompare(right.employeeNo, 'zh-CN', { numeric: true });
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export default function EmployeeManagementShell({ user }: { user: CurrentUserDTO }) {
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [draft, setDraft] = useState<EmployeeDraft>(emptyDraft);
  const [baseline, setBaseline] = useState<EmployeeDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<EmployeeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);

  const selectedEmployee = useMemo(
    () => employees.find(employee => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const loadEmployees = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/employees', { cache: 'no-store' });
      const body = await response.json() as EmployeesResponse;
      if (!response.ok) throw new Error(body.error || '员工档案加载失败');
      const nextEmployees = sortEmployees(body.employees || []);
      setEmployees(nextEmployees);
      setSelectedEmployeeId(current => {
        const requestedId = new URLSearchParams(window.location.search).get('employeeId') || '';
        if (nextEmployees.some(employee => employee.id === current)) return current;
        if (requestedId && nextEmployees.some(employee => employee.id === requestedId)) return requestedId;
        return nextEmployees[0]?.id || '';
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '员工档案加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (creating || !selectedEmployee) return;
    const nextDraft = toDraft(selectedEmployee);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setFormError('');
  }, [creating, selectedEmployee]);

  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeave(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [dirty]);

  const summary = useMemo(() => ({
    total: employees.length,
    active: employees.filter(employee => employee.isActive).length,
    attendance: employees.filter(employee => employee.isActive && employee.attendanceEnabled).length,
    inactive: employees.filter(employee => !employee.isActive).length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    return employees.filter(employee => {
      if (filter === 'active' && !employee.isActive) return false;
      if (filter === 'inactive' && employee.isActive) return false;
      if (filter === 'attendance' && (!employee.isActive || !employee.attendanceEnabled)) return false;
      if (!normalized) return true;
      return `${employee.employeeNo} ${employee.name} ${employee.department || ''} ${employee.position || ''} ${employee.team || ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalized);
    });
  }, [employees, filter, keyword]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('当前员工档案有未保存修改，确认放弃吗？');
  }

  function chooseEmployee(employee: EmployeeDTO): void {
    if (!confirmDiscard()) return;
    setCreating(false);
    setSelectedEmployeeId(employee.id);
    const nextDraft = toDraft(employee);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setFormError('');
  }

  function beginCreate(): void {
    if (!confirmDiscard()) return;
    setCreating(true);
    setSelectedEmployeeId('');
    setDraft(emptyDraft);
    setBaseline(emptyDraft);
    setFormError('');
  }

  async function saveEmployee(): Promise<void> {
    if (!draft.employeeNo.trim()) {
      setFormError('请填写员工编号');
      return;
    }
    if (!draft.name.trim()) {
      setFormError('请填写员工姓名');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const wasCreating = creating;
      const response = await fetch(wasCreating ? '/api/employees' : `/api/employees/${selectedEmployeeId}`, {
        method: wasCreating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await response.json() as EmployeesResponse;
      if (!response.ok || !body.employee) throw new Error(body.error || '保存员工档案失败');
      const savedEmployee = body.employee;
      setEmployees(current => sortEmployees(wasCreating
        ? [...current, savedEmployee]
        : current.map(employee => employee.id === savedEmployee.id ? savedEmployee : employee)));
      setCreating(false);
      setSelectedEmployeeId(savedEmployee.id);
      const nextDraft = toDraft(savedEmployee);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setToast(wasCreating ? '员工档案已创建' : '员工档案已保存');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存员工档案失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return (
    <main className="employee-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/employees"
        subtitle="生产员工、岗位班组与考勤范围"
        menuItems={[{ label: '修改密码', href: '/dashboard?changePassword=1' }, { label: '退出登录', onSelect: () => void logout() }]}
      />

      <div className="employee-workbench-frame">
        <section className="employee-workbench-summary" aria-label="员工档案概览">
          <article><UsersRound /><span>员工总数<small>历史与在用档案</small></span><strong>{summary.total}</strong></article>
          <article className="active"><UserRoundCheck /><span>在用员工<small>可参与报工</small></span><strong>{summary.active}</strong></article>
          <article className="attendance"><CalendarClock /><span>启用考勤<small>纳入出勤与达成率</small></span><strong>{summary.attendance}</strong></article>
          <article className="inactive"><CircleOff /><span>已停用<small>历史数据仍保留</small></span><strong>{summary.inactive}</strong></article>
        </section>

        <section className="employee-workbench-toolbar" aria-label="员工档案筛选与操作">
          <label className="employee-workbench-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索员工编号、姓名、部门、岗位或班组" /></label>
          <label className="employee-workbench-filter"><span>状态</span><select value={filter} onChange={event => setFilter(event.target.value as EmployeeFilter)}><option value="all">全部员工</option><option value="active">在用员工</option><option value="attendance">启用考勤</option><option value="inactive">已停用</option></select></label>
          <a className="employee-workbench-link" href="/workspace/attendance" title="打开考勤与异常"><CalendarClock size={16} aria-hidden="true" />考勤与异常</a>
          <button className="employee-workbench-icon-button" type="button" aria-label="刷新员工档案" title="刷新员工档案" disabled={loading} onClick={() => void loadEmployees()}><RefreshCw className={loading ? 'spin' : ''} size={17} aria-hidden="true" /></button>
          <button className="employee-workbench-primary" type="button" onClick={beginCreate}><Plus size={17} aria-hidden="true" />新增员工</button>
        </section>

        {error && <div className="employee-workbench-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}

        <div className="employee-workbench-grid">
          <section className="employee-directory" aria-label="员工列表">
            <header><div><span>员工目录</span><h1>生产员工档案</h1></div><em>{filteredEmployees.length} 人</em></header>
            <div className="employee-directory-list hm-scroll-region" tabIndex={0}>
              {filteredEmployees.map(employee => (
                <button className={`${selectedEmployeeId === employee.id && !creating ? 'selected' : ''} ${employee.isActive ? '' : 'inactive'}`.trim()} type="button" key={employee.id} onClick={() => chooseEmployee(employee)}>
                  <span className="employee-directory-avatar" aria-hidden="true">{employee.name.slice(0, 1)}</span>
                  <span className="employee-directory-copy"><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.department || '部门未设置'}</small><small>{employee.position || '岗位未设置'} · {employee.team || '班组未设置'}</small></span>
                  <span className="employee-directory-state">{employee.isActive ? employee.attendanceEnabled ? '考勤中' : '在用' : '已停用'}</span>
                </button>
              ))}
              {!loading && !filteredEmployees.length && <div className="employee-directory-empty"><UserRound /><strong>没有符合条件的员工</strong><span>调整搜索或筛选条件，或新建员工档案。</span></div>}
            </div>
          </section>

          <section className="employee-editor" aria-label="员工档案编辑">
            <header>
              <div><span>{creating ? '新增人员' : '员工档案'}</span><h1>{creating ? '新增生产员工' : selectedEmployee?.name || '请选择员工'}</h1></div>
              {!creating && selectedEmployee && <em className={selectedEmployee.isActive ? 'active' : 'inactive'}>{selectedEmployee.isActive ? '在用' : '已停用'}</em>}
            </header>

            <div className="employee-editor-body hm-scroll-region">
              <div className="employee-editor-form">
                <label><span>员工编号 *</span><input value={draft.employeeNo} maxLength={40} onChange={event => setDraft(current => ({ ...current, employeeNo: event.target.value }))} placeholder="例如 0001" /></label>
                <label><span>员工姓名 *</span><input value={draft.name} maxLength={80} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="填写真实姓名" /></label>
                <label><span>部门</span><input value={draft.department} maxLength={80} onChange={event => setDraft(current => ({ ...current, department: event.target.value }))} placeholder="例如 生产部" /></label>
                <label><span>岗位</span><input value={draft.position} maxLength={80} onChange={event => setDraft(current => ({ ...current, position: event.target.value }))} placeholder="例如 压接操作员" /></label>
                <label className="wide"><span>班组</span><input value={draft.team} maxLength={80} onChange={event => setDraft(current => ({ ...current, team: event.target.value }))} placeholder="例如 前端一组" /></label>
              </div>

              <div className="employee-editor-switches">
                <label><input type="checkbox" checked={draft.attendanceEnabled} onChange={event => setDraft(current => ({ ...current, attendanceEnabled: event.target.checked }))} /><span><strong>纳入考勤与个人达成率</strong><small>启用后可登记出勤、加班、请假和异常工时。</small></span></label>
                {!creating && <label><input type="checkbox" checked={draft.isActive} onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))} /><span><strong>允许选择该员工报工</strong><small>停用不会删除历史考勤、异常工时和生产记录。</small></span></label>}
              </div>

              {!creating && selectedEmployee && <div className="employee-editor-actions">
                <a href={`/workspace/attendance?employeeId=${encodeURIComponent(selectedEmployee.id)}`}><CalendarClock size={18} aria-hidden="true" /><span><strong>查看考勤与异常工时</strong><small>直接定位到该员工的当日考勤记录</small></span></a>
                <div><BadgeCheck size={18} aria-hidden="true" /><span><strong>档案更新时间</strong><small>{formatDateTime(selectedEmployee.updatedAt)}</small></span></div>
              </div>}

              <div className="employee-editor-note"><UsersRound size={21} aria-hidden="true" /><div><strong>员工档案不等于登录账号</strong><span>生产员工无需拥有系统账号；所有已登录账号仍共享同一套业务数据。员工停用后，历史数据继续保留。</span></div></div>
              {formError && <div className="employee-editor-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{formError}</div>}
            </div>

            <footer>
              <span>{dirty ? '有未保存修改' : creating ? '填写员工信息后保存' : '档案已保存'}</span>
              <button className="employee-workbench-primary" type="button" disabled={saving || (!creating && !selectedEmployee)} onClick={() => void saveEmployee()}>{saving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : dirty ? <Save size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}{saving ? '保存中…' : creating ? '创建员工' : '保存员工档案'}</button>
            </footer>
          </section>
        </div>
      </div>

      {loading && <div className="employee-workbench-loading"><Loader2 className="spin" size={17} aria-hidden="true" />正在加载员工档案</div>}
    </main>
  );
}
