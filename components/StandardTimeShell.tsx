'use client';

import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  History,
  ListOrdered,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { formatProcessDuration } from '@/lib/process-time';
import type {
  CurrentUserDTO,
  EmployeeDTO,
  ProcessDefinitionDTO,
  ProcessStageGroup,
  ProcessTimeBasis,
} from '@/types';

type StandardSummary = { total: number; active: number; standardized: number; pending: number };
type StandardsResponse = {
  ok: boolean;
  definitions?: ProcessDefinitionDTO[];
  summary?: StandardSummary;
  definition?: ProcessDefinitionDTO;
  error?: string;
};
type EmployeesResponse = { ok: boolean; employees?: EmployeeDTO[]; employee?: EmployeeDTO; error?: string };
type TabKey = 'standards' | 'employees';

type StandardForm = {
  name: string;
  stageGroup: ProcessStageGroup;
  timeBasis: ProcessTimeBasis;
  unitLabel: string;
  standardSeconds: string;
  setupSeconds: string;
  countsForEfficiency: boolean;
  isActive: boolean;
  remark: string;
};

type EmployeeForm = {
  employeeNo: string;
  name: string;
  department: string;
  team: string;
  isActive: boolean;
};

const emptyStandardForm: StandardForm = {
  name: '',
  stageGroup: 'frontend',
  timeBasis: 'per_unit',
  unitLabel: '根',
  standardSeconds: '',
  setupSeconds: '0',
  countsForEfficiency: true,
  isActive: true,
  remark: '',
};
const emptyEmployeeForm: EmployeeForm = {
  employeeNo: '',
  name: '',
  department: '',
  team: '',
  isActive: true,
};
const emptySummary: StandardSummary = { total: 0, active: 0, standardized: 0, pending: 0 };
const stageText: Record<ProcessStageGroup, string> = { frontend: '前端', backend: '后端', finish: '完工' };

function standardForm(definition: ProcessDefinitionDTO): StandardForm {
  const standard = definition.currentStandard;
  return {
    name: definition.name,
    stageGroup: definition.stageGroup,
    timeBasis: standard?.timeBasis || 'per_unit',
    unitLabel: standard?.unitLabel || '件',
    standardSeconds: standard ? String(standard.standardMillisecondsPerUnit / 1000) : '',
    setupSeconds: standard ? String(standard.setupMilliseconds / 1000) : '0',
    countsForEfficiency: standard?.countsForEfficiency ?? true,
    isActive: definition.isActive,
    remark: standard?.remark || '',
  };
}

function employeeForm(employee: EmployeeDTO): EmployeeForm {
  return {
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department || '',
    team: employee.team || '',
    isActive: employee.isActive,
  };
}

function standardLabel(definition: ProcessDefinitionDTO): string {
  const standard = definition.currentStandard;
  if (!standard) return '待定标';
  const base = formatProcessDuration(standard.standardMillisecondsPerUnit);
  return standard.timeBasis === 'per_batch' ? `${base}/批` : `${base}/${standard.unitLabel}`;
}

export default function StandardTimeShell({ user }: { user: CurrentUserDTO }) {
  const [tab, setTab] = useState<TabKey>('standards');
  const [definitions, setDefinitions] = useState<ProcessDefinitionDTO[]>([]);
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [summary, setSummary] = useState<StandardSummary>(emptySummary);
  const [keyword, setKeyword] = useState('');
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [standardDraft, setStandardDraft] = useState<StandardForm>(emptyStandardForm);
  const [employeeDraft, setEmployeeDraft] = useState<EmployeeForm>(emptyEmployeeForm);
  const [newStandard, setNewStandard] = useState(false);
  const [newEmployee, setNewEmployee] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const newStandardRef = useRef(newStandard);
  const newEmployeeRef = useRef(newEmployee);

  useEffect(() => {
    newStandardRef.current = newStandard;
  }, [newStandard]);

  useEffect(() => {
    newEmployeeRef.current = newEmployee;
  }, [newEmployee]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      fetch('/api/process-time-standards', { cache: 'no-store', signal: controller.signal }),
      fetch('/api/employees', { cache: 'no-store', signal: controller.signal }),
    ])
      .then(async ([standardResponse, employeeResponse]) => {
        const standards = await standardResponse.json() as StandardsResponse;
        const staff = await employeeResponse.json() as EmployeesResponse;
        if (!standardResponse.ok) throw new Error(standards.error || '标准工时加载失败');
        if (!employeeResponse.ok) throw new Error(staff.error || '员工档案加载失败');
        const nextDefinitions = standards.definitions || [];
        const nextEmployees = staff.employees || [];
        setDefinitions(nextDefinitions);
        setEmployees(nextEmployees);
        setSummary(standards.summary || emptySummary);
        setSelectedDefinitionId(current => {
          const nextId = nextDefinitions.some(item => item.id === current) ? current : nextDefinitions[0]?.id || '';
          const selected = nextDefinitions.find(item => item.id === nextId);
          if (selected && !newStandardRef.current) setStandardDraft(standardForm(selected));
          return nextId;
        });
        setSelectedEmployeeId(current => {
          const nextId = nextEmployees.some(item => item.id === current) ? current : nextEmployees[0]?.id || '';
          const selected = nextEmployees.find(item => item.id === nextId);
          if (selected && !newEmployeeRef.current) setEmployeeDraft(employeeForm(selected));
          return nextId;
        });
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '数据加载失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [refreshToken]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredDefinitions = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return definitions;
    return definitions.filter(item => `${item.name} ${item.code} ${stageText[item.stageGroup]}`
      .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [definitions, keyword]);

  const filteredEmployees = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return employees;
    return employees.filter(item => `${item.employeeNo} ${item.name} ${item.department || ''} ${item.team || ''}`
      .toLocaleLowerCase('zh-CN').includes(normalized));
  }, [employees, keyword]);

  const selectedDefinition = definitions.find(item => item.id === selectedDefinitionId) || null;
  const selectedEmployee = employees.find(item => item.id === selectedEmployeeId) || null;

  function chooseDefinition(definition: ProcessDefinitionDTO): void {
    setNewStandard(false);
    setSelectedDefinitionId(definition.id);
    setStandardDraft(standardForm(definition));
    setFormError('');
  }

  function chooseEmployee(employee: EmployeeDTO): void {
    setNewEmployee(false);
    setSelectedEmployeeId(employee.id);
    setEmployeeDraft(employeeForm(employee));
    setFormError('');
  }

  function beginStandard(): void {
    setTab('standards');
    setNewStandard(true);
    setSelectedDefinitionId('');
    setStandardDraft(emptyStandardForm);
    setFormError('');
  }

  function beginEmployee(): void {
    setTab('employees');
    setNewEmployee(true);
    setSelectedEmployeeId('');
    setEmployeeDraft(emptyEmployeeForm);
    setFormError('');
  }

  async function saveStandard(): Promise<void> {
    setSaving(true);
    setFormError('');
    try {
      if (!standardDraft.name.trim()) throw new Error('请填写工序名称');
      if (!standardDraft.standardSeconds.trim() || Number(standardDraft.standardSeconds) <= 0) {
        throw new Error('单位标准时间必须大于 0');
      }
      const response = await fetch(newStandard
        ? '/api/process-time-standards'
        : `/api/process-time-standards/${selectedDefinitionId}`, {
        method: newStandard ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardDraft),
      });
      const body = await response.json() as StandardsResponse;
      if (!response.ok || !body.definition) throw new Error(body.error || '保存失败');
      setNewStandard(false);
      setSelectedDefinitionId(body.definition.id);
      setStandardDraft(standardForm(body.definition));
      setToast(newStandard ? '工序和首版标准工时已创建' : '标准工时已保存为新版本');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存标准工时失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployee(): Promise<void> {
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(newEmployee ? '/api/employees' : `/api/employees/${selectedEmployeeId}`, {
        method: newEmployee ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employeeDraft),
      });
      const body = await response.json() as EmployeesResponse;
      if (!response.ok || !body.employee) throw new Error(body.error || '保存失败');
      setNewEmployee(false);
      setSelectedEmployeeId(body.employee.id);
      setEmployeeDraft(employeeForm(body.employee));
      setToast(newEmployee ? '员工档案已创建' : '员工档案已更新');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '保存员工档案失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="time-standard-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/time-standards"
        subtitle="工序时间版本与员工档案"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />
      <div className="time-standard-frame">
        <section className="time-standard-summary" aria-label="标准工时概览">
          <article><Clock3 /><span>工序总数<small>统一工序主数据</small></span><strong>{summary.total}</strong></article>
          <article className="ready"><CheckCircle2 /><span>已定标<small>存在当前标准版本</small></span><strong>{summary.standardized}</strong></article>
          <article className="pending"><Gauge /><span>待定标<small>仍可用于工艺编排</small></span><strong>{summary.pending}</strong></article>
          <article className="staff"><UsersRound /><span>在用员工<small>用于生产工序报工</small></span><strong>{employees.filter(item => item.isActive).length}</strong></article>
        </section>

        <section className="time-standard-toolbar">
          <div className="time-standard-tabs" role="tablist">
            <button className={tab === 'standards' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'standards'} onClick={() => { setTab('standards'); setFormError(''); }}><Clock3 size={15} />工序标准</button>
            <button className={tab === 'employees' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'employees'} onClick={() => { setTab('employees'); setFormError(''); }}><UsersRound size={15} />员工档案</button>
          </div>
          <label><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={tab === 'standards' ? '搜索工序名称或编码' : '搜索员工编号、姓名、部门或班组'} /></label>
          <button className="primary-button" type="button" onClick={tab === 'standards' ? beginStandard : beginEmployee}><Plus size={16} />{tab === 'standards' ? '新增工序' : '新增员工'}</button>
          <div className="time-standard-toolbar-actions" aria-label="标准工时关联操作">
            <a className="hm-workbench-button" href="/workspace/processes" title="打开工艺管理"><ListOrdered size={15} /><span>工艺管理</span></a>
            <a className="hm-workbench-button" href="/workspace/reports" title="打开达成率报表"><BarChart3 size={15} /><span>报表</span></a>
            <button className="hm-workbench-button" type="button" title="刷新标准工时" aria-label="刷新标准工时" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} /></button>
          </div>
        </section>

        {error && <div className="time-standard-error" role="alert">{error}</div>}

        {tab === 'standards' ? (
          <div className="time-standard-grid">
            <section className="time-standard-list-panel">
              <header><div><span>工序库</span><h2>标准工序与时间</h2></div><em>{filteredDefinitions.length} 项</em></header>
              <div className="time-standard-list hm-scroll-region" tabIndex={0}>
                {filteredDefinitions.map(definition => (
                  <button className={`${selectedDefinitionId === definition.id && !newStandard ? 'selected' : ''} ${definition.isActive ? '' : 'inactive'}`} type="button" key={definition.id} onClick={() => chooseDefinition(definition)}>
                    <span className={`stage ${definition.stageGroup}`}>{stageText[definition.stageGroup]}</span>
                    <strong>{definition.name}</strong>
                    <b className={definition.currentStandard ? 'ready' : 'pending'}>{standardLabel(definition)}</b>
                    <small>{definition.currentStandard ? `V${definition.currentStandard.version}` : '尚未建立时间版本'} · 路线使用 {definition.routeUsageCount || 0}</small>
                  </button>
                ))}
                {!loading && !filteredDefinitions.length && <div className="time-standard-empty">没有符合条件的工序</div>}
              </div>
            </section>

            <section className="time-standard-editor">
              <header><div><span>{newStandard ? '新增主数据' : '版本化维护'}</span><h2>{newStandard ? '新增工序与标准时间' : selectedDefinition?.name || '选择工序'}</h2></div>{selectedDefinition?.currentStandard && !newStandard && <em>当前 V{selectedDefinition.currentStandard.version}</em>}</header>
              <div className="time-standard-form hm-scroll-region">
                <div className="form-grid">
                  <label><span>工序名称</span><input value={standardDraft.name} maxLength={60} onChange={event => setStandardDraft({ ...standardDraft, name: event.target.value })} /></label>
                  <label><span>阶段</span><select value={standardDraft.stageGroup} onChange={event => setStandardDraft({ ...standardDraft, stageGroup: event.target.value as ProcessStageGroup })}><option value="frontend">前端</option><option value="backend">后端</option><option value="finish">完工</option></select></label>
                  <label><span>计时方式</span><select value={standardDraft.timeBasis} onChange={event => setStandardDraft({ ...standardDraft, timeBasis: event.target.value as ProcessTimeBasis })}><option value="per_unit">按作业单位</option><option value="per_batch">按生产批次</option></select></label>
                  <label><span>作业单位</span><input value={standardDraft.unitLabel} maxLength={20} onChange={event => setStandardDraft({ ...standardDraft, unitLabel: event.target.value })} placeholder="根、端子、套、批" /></label>
                  <label><span>{standardDraft.timeBasis === 'per_batch' ? '每批标准时间（秒）' : '单位标准时间（秒）'}</span><input type="number" min="0.001" step="0.001" value={standardDraft.standardSeconds} onChange={event => setStandardDraft({ ...standardDraft, standardSeconds: event.target.value })} /></label>
                  <label><span>固定准备时间（秒）</span><input type="number" min="0" step="1" value={standardDraft.setupSeconds} onChange={event => setStandardDraft({ ...standardDraft, setupSeconds: event.target.value })} /></label>
                </div>
                <label className="time-standard-check"><input type="checkbox" checked={standardDraft.countsForEfficiency} onChange={event => setStandardDraft({ ...standardDraft, countsForEfficiency: event.target.checked })} /><span><strong>计入员工工时达成率</strong><small>机器等待、固化等待等无人作业时间可以取消勾选。</small></span></label>
                {!newStandard && <label className="time-standard-check"><input type="checkbox" checked={standardDraft.isActive} onChange={event => setStandardDraft({ ...standardDraft, isActive: event.target.checked })} /><span><strong>工序保持启用</strong><small>停用后不再出现在新工艺路线中，历史数据不会删除。</small></span></label>}
                <label className="wide"><span>定标说明</span><textarea rows={4} maxLength={500} value={standardDraft.remark} onChange={event => setStandardDraft({ ...standardDraft, remark: event.target.value })} placeholder="记录测量条件、取样口径或适用范围" /></label>
                <div className="time-standard-formula">
                  <Gauge size={19} />
                  <div><strong>标准工时计算</strong><span>{standardDraft.timeBasis === 'per_batch' ? '固定准备时间 + 每批标准时间' : '固定准备时间 + 单位标准时间 × 合格数量 × 每件工序次数'}</span></div>
                </div>
                {formError && <div className="time-standard-form-error" role="alert">{formError}</div>}
                <div className="time-standard-save"><button className="primary-button" type="button" disabled={saving || (!newStandard && !selectedDefinition)} onClick={() => { void saveStandard(); }}><Save size={16} />{saving ? '保存中...' : newStandard ? '创建工序' : '保存新版本'}</button></div>
                {!newStandard && selectedDefinition && (
                  <section className="time-standard-history">
                    <h3><History size={15} />版本记录</h3>
                    {(selectedDefinition.standardHistory || []).map(item => (
                      <article key={item.id}><b>V{item.version}</b><span>{formatProcessDuration(item.standardMillisecondsPerUnit)}/{item.timeBasis === 'per_batch' ? '批' : item.unitLabel}</span><small>{new Date(item.effectiveFrom).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</small>{item.isCurrent && <em>当前</em>}</article>
                    ))}
                    {!selectedDefinition.standardHistory?.length && <p>该工序尚未定标。</p>}
                  </section>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="time-standard-grid employee-grid">
            <section className="time-standard-list-panel">
              <header><div><span>员工目录</span><h2>生产报工人员</h2></div><em>{filteredEmployees.length} 人</em></header>
              <div className="time-standard-list employee-list hm-scroll-region" tabIndex={0}>
                {filteredEmployees.map(employee => (
                  <button className={`${selectedEmployeeId === employee.id && !newEmployee ? 'selected' : ''} ${employee.isActive ? '' : 'inactive'}`} type="button" key={employee.id} onClick={() => chooseEmployee(employee)}>
                    <UserRound />
                    <strong>{employee.name}</strong>
                    <b>{employee.employeeNo}</b>
                    <small>{employee.department || '部门未设置'} · {employee.team || '班组未设置'}</small>
                  </button>
                ))}
                {!loading && !filteredEmployees.length && <div className="time-standard-empty">尚未建立员工档案</div>}
              </div>
            </section>
            <section className="time-standard-editor employee-editor">
              <header><div><span>{newEmployee ? '新增人员' : '员工档案'}</span><h2>{newEmployee ? '新增生产员工' : selectedEmployee?.name || '选择员工'}</h2></div>{selectedEmployee && !newEmployee && <em>{selectedEmployee.isActive ? '在用' : '已停用'}</em>}</header>
              <div className="time-standard-form">
                <div className="form-grid">
                  <label><span>员工编号</span><input value={employeeDraft.employeeNo} maxLength={40} onChange={event => setEmployeeDraft({ ...employeeDraft, employeeNo: event.target.value })} placeholder="例如 HL001" /></label>
                  <label><span>员工姓名</span><input value={employeeDraft.name} maxLength={80} onChange={event => setEmployeeDraft({ ...employeeDraft, name: event.target.value })} /></label>
                  <label><span>部门</span><input value={employeeDraft.department} maxLength={80} onChange={event => setEmployeeDraft({ ...employeeDraft, department: event.target.value })} placeholder="例如 生产部" /></label>
                  <label><span>班组</span><input value={employeeDraft.team} maxLength={80} onChange={event => setEmployeeDraft({ ...employeeDraft, team: event.target.value })} placeholder="例如 前端一组" /></label>
                </div>
                {!newEmployee && <label className="time-standard-check"><input type="checkbox" checked={employeeDraft.isActive} onChange={event => setEmployeeDraft({ ...employeeDraft, isActive: event.target.checked })} /><span><strong>允许选择该员工报工</strong><small>停用不会删除历史工时记录。</small></span></label>}
                <div className="employee-note"><UsersRound size={20} /><div><strong>员工档案不等于登录账号</strong><span>生产员工无需拥有系统账号；所有已登录账号仍共享同一套业务数据。</span></div></div>
                {formError && <div className="time-standard-form-error" role="alert">{formError}</div>}
                <div className="time-standard-save"><button className="primary-button" type="button" disabled={saving || (!newEmployee && !selectedEmployee)} onClick={() => { void saveEmployee(); }}><Save size={16} />{saving ? '保存中...' : newEmployee ? '创建员工' : '保存员工档案'}</button></div>
              </div>
            </section>
          </div>
        )}
      </div>
      {toast && <div className="time-standard-toast" role="status">{toast}</div>}
    </main>
  );
}
