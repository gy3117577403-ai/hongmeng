'use client';

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useModalLayer } from '@/components/useModalLayer';
import {
  formatMinutes,
  type DailyPlanAssignment,
  type DailyPlanCrossTeamRequest,
  type DailyPlanEmployee,
  type DailyPlanOrganization,
  type DailyPlanOrganizationMutation,
  type DailyPlanTask,
} from '@/lib/daily-plan-client';
import type { EmployeeDTO, ProcessLaborPoolDTO } from '@/types';
import { chinaDateKey } from '@/lib/china-date';

function ModalFrame({ eyebrow, title, description, busy, error, backgroundRef, onClose, children, footer }: {
  eyebrow: string;
  title: string;
  description?: string;
  busy: boolean;
  error: string;
  backgroundRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalLayer({ open: true, layerRef, initialFocusRef: closeRef, backgroundRef, onClose, lockScroll: true });
  return <div className="daily-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={layerRef} className="daily-dialog daily-advanced-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-advanced-title" tabIndex={-1}>
      <header><div><span>{eyebrow}</span><h2 id="daily-advanced-title">{title}</h2>{description && <p>{description}</p>}</div><button ref={closeRef} type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <div className="daily-dialog-body hm-scroll-region">{children}{error && <div className="daily-dialog-error" role="alert"><AlertTriangle size={16} />{error}</div>}</div>
      <footer>{footer}</footer>
    </section>
  </div>;
}

export function AssignmentMutationDialog({ mode, task, assignment, candidates, busy, error, backgroundRef, onClose, onSubmit }: {
  mode: 'adjust' | 'withdraw';
  task: DailyPlanTask;
  assignment: DailyPlanAssignment;
  candidates: DailyPlanEmployee[];
  busy: boolean;
  error: string;
  backgroundRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (input: { employeeId?: string; quantity?: number; reason: string }) => void;
}) {
  const [employeeId, setEmployeeId] = useState(assignment.employeeId);
  const [quantity, setQuantity] = useState(String(assignment.quantity));
  const [reason, setReason] = useState('');
  const quantityValue = Number(quantity);
  const invalid = !reason.trim() || (mode === 'adjust' && (!employeeId || !Number.isInteger(quantityValue) || quantityValue <= 0 || quantityValue > task.remainingQuantity + assignment.quantity));
  return <ModalFrame eyebrow={mode === 'adjust' ? '计划调整' : '撤回任务'} title={mode === 'adjust' ? `调整 ${task.processName}` : `撤回 ${task.processName}`} description={`${task.workOrderCode} · 当前分配 ${assignment.quantity} 件给 ${assignment.employeeName}`} busy={busy} error={error} backgroundRef={backgroundRef} onClose={onClose} footer={<><button className="daily-secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className={`daily-primary-button ${mode === 'withdraw' ? 'danger' : ''}`} type="button" disabled={busy || invalid} onClick={() => onSubmit({ ...(mode === 'adjust' ? { employeeId, quantity: quantityValue } : {}), reason: reason.trim() })}>{busy ? <LoaderCircle className="spin" size={16} /> : mode === 'adjust' ? <Check size={16} /> : <Trash2 size={16} />}{busy ? '提交中…' : mode === 'adjust' ? '保存调整' : '确认撤回'}</button></>}>
    {mode === 'adjust' && <div className="daily-form-grid"><label>本组员工<select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>{candidates.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.teamName}</option>)}</select></label><label>分配数量<input type="number" min="1" max={task.remainingQuantity + assignment.quantity} value={quantity} onChange={event => setQuantity(event.target.value)} /></label></div>}
    <label className="daily-full-field">{mode === 'adjust' ? '调整原因' : '撤回原因'}<textarea rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="必填，用于日计划修订记录" /></label>
    <div className="daily-dialog-callout neutral"><ShieldCheck size={19} /><span><b>操作全程留痕</b><small>只调整班前排程，不会删除生产完成记录，也不会提前生成或撤销员工实际工时。</small></span></div>
  </ModalFrame>;
}

type ClaimRow = { employeeId: string; quantity: string };

export function LaborClaimDialog({ pool, employees, busy, error, backgroundRef, onClose, onSubmit }: {
  pool: ProcessLaborPoolDTO;
  employees: EmployeeDTO[];
  busy: boolean;
  error: string;
  backgroundRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (allocations: Array<{ employeeId: string; quantity: number }>) => void;
}) {
  const suggestedEmployees = pool.suggestedEmployees || [];
  const sourceEmployees = suggestedEmployees.length ? suggestedEmployees : employees;
  const [rows, setRows] = useState<ClaimRow[]>([{ employeeId: sourceEmployees[0]?.id || '', quantity: String(pool.remainingQty) }]);
  const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const invalid = !rows.length || rows.some(row => !row.employeeId || !Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0) || total > pool.remainingQty || new Set(rows.map(row => row.employeeId)).size !== rows.length;
  return <ModalFrame eyebrow="完工领取" title="分配实际完成工时" description={`${pool.workOrder.code} · ${pool.step.processName} · 真实工时池剩余 ${pool.remainingQty} ${pool.unitLabel}`} busy={busy} error={error} backgroundRef={backgroundRef} onClose={onClose} footer={<><button className="daily-secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="daily-primary-button" type="button" disabled={busy || invalid} onClick={() => onSubmit(rows.map(row => ({ employeeId: row.employeeId, quantity: Number(row.quantity) })))}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{busy ? '领取中…' : '确认实际工时分配'}</button></>}>
    <div className="daily-labor-pool-facts"><div><span>完工可领</span><strong>{pool.remainingQty} {pool.unitLabel}</strong></div><div><span>标准工时</span><strong>{formatMinutes(pool.remainingStandardLaborMilliseconds / 60_000)}</strong></div><div><span>生产日期</span><strong>{pool.workDate}</strong></div><div><span>数据来源</span><strong>ProcessLaborPool</strong></div></div>
    <div className="daily-dialog-callout"><AlertTriangle size={19} /><span><b>这里分配的是实际完成工时</b><small>只有生产执行完工后生成的真实工时池可以领取；班前日计划数量不会在此自动转成绩效。</small></span></div>
    <section className="daily-split-editor"><header><div><span>员工实际完成数量</span><strong>{total} / {pool.remainingQty} {pool.unitLabel}</strong></div><button className="daily-secondary-button compact" type="button" onClick={() => setRows(current => [...current, { employeeId: '', quantity: '' }])}><Plus size={15} />增加员工</button></header>{rows.map((row, index) => <div className="daily-split-row" key={`${index}-${row.employeeId}`}><span>{index + 1}</span><select value={row.employeeId} onChange={event => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, employeeId: event.target.value } : item))}><option value="">选择员工</option>{sourceEmployees.map(employee => <option value={employee.id} key={employee.id} disabled={rows.some((other, otherIndex) => otherIndex !== index && other.employeeId === employee.id)}>{employee.name} · {employee.team || employee.position || employee.employeeNo}</option>)}</select><input type="number" min="1" step="1" max={pool.remainingQty} value={row.quantity} onChange={event => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /><button type="button" aria-label="移除员工" disabled={rows.length === 1} onClick={() => setRows(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}</section>
    {total > pool.remainingQty && <p className="daily-inline-validation">分配总量不能超过真实工时池剩余数量。</p>}
  </ModalFrame>;
}

export function CrossTeamReviewPanel({ requests, busyId, onReview }: {
  requests: DailyPlanCrossTeamRequest[];
  busyId: string;
  onReview: (request: DailyPlanCrossTeamRequest, decision: 'APPROVE' | 'REJECT') => void;
}) {
  if (!requests.length) return null;
  return <section className="daily-cross-team-queue"><header><div><span>主管审批</span><strong>跨组借调</strong></div><b>{requests.length}</b></header>{requests.map(request => <article key={request.id}><div><b>{request.workOrderCode} · {request.processName}</b><p>{request.sourceTeamName || '未分组'} → {request.targetTeamName}{request.employeeName ? ` · ${request.employeeName}` : ''}</p><small>{request.quantity} 件 · {request.reason}</small></div><div><button type="button" disabled={busyId === request.id} onClick={() => onReview(request, 'REJECT')}>驳回</button><button type="button" className="approve" disabled={busyId === request.id} onClick={() => onReview(request, 'APPROVE')}>{busyId === request.id ? '处理中…' : '批准'}</button></div></article>)}</section>;
}

export function OrganizationManager({ organization, busy, error, canManage, onSave }: {
  organization: DailyPlanOrganization | null;
  busy: boolean;
  error: string;
  canManage: boolean;
  onSave: (mutation: DailyPlanOrganizationMutation) => void;
}) {
  const [teamId, setTeamId] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState<'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'MEMBER'>('MEMBER');
  const [memberTeamId, setMemberTeamId] = useState('');
  const [capabilityTeamId, setCapabilityTeamId] = useState('');
  const [processDefinitionId, setProcessDefinitionId] = useState('');
  const activeTeams = useMemo(() => organization?.teams.filter(team => team.isActive) || [], [organization]);
  useEffect(() => {
    if (!activeTeams.some(team => team.id === memberTeamId)) setMemberTeamId(activeTeams[0]?.id || '');
    if (!activeTeams.some(team => team.id === capabilityTeamId)) setCapabilityTeamId(activeTeams[0]?.id || '');
  }, [activeTeams, capabilityTeamId, memberTeamId]);
  useEffect(() => {
    if (!processDefinitionId && organization?.processDefinitions[0]) {
      setProcessDefinitionId(organization.processDefinitions[0].id);
    }
  }, [organization, processDefinitionId]);
  if (!organization) return <div className="daily-page-loading"><LoaderCircle className="spin" /><b>正在加载生产组织…</b></div>;
  const activeCapabilityCount = organization.teams.reduce((total, team) => total + team.capabilities.filter(capability => capability.isActive).length, 0);
  return <div className="daily-organization-manager">
    <section className="daily-organization-hero"><div><span>独立排程范围</span><h2>班组、人员与工序归属</h2><p>工序归属决定“哪个班组可在日计划领取哪些工序”，不会改变登录权限、人事岗位或实际工时领取权限。</p></div><div><strong>{activeTeams.length}</strong><span>在用班组</span></div><div><strong>{activeCapabilityCount}</strong><span>有效工序归属</span></div></section>
    {error && <div className="daily-page-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
    {canManage && <section className="daily-organization-editor">
      <header><UserRoundCog size={19} /><div><strong>生产组织维护</strong><span>依次配置班组、人员关系和班组可领取工序；每次修改都有审计记录。</span></div></header>
      <div className="daily-org-forms">
        <form onSubmit={event => {
          event.preventDefault();
          if (!teamName.trim()) return;
          onSave({ action: 'upsertTeam', ...(teamId ? { teamId } : {}), code: teamCode.trim(), name: teamName.trim(), isActive: true, expectedVersion: teamId ? organization.teams.find(item => item.id === teamId)?.version : undefined });
          setTeamId(''); setTeamCode(''); setTeamName('');
        }}>
          <b>{teamId ? '编辑班组' : '新增班组'}</b>
          <label>班组名称<input value={teamName} onChange={event => setTeamName(event.target.value)} placeholder="例如 压裁组" required /></label>
          <label>班组编码（可选）<input value={teamCode} onChange={event => setTeamCode(event.target.value)} placeholder="留空由系统管理" /></label>
          <button type="submit" className="daily-primary-button compact" disabled={busy}>{busy ? '保存中…' : '保存班组'}</button>
        </form>
        <form onSubmit={event => {
          event.preventDefault();
          if (!employeeId || (role !== 'WORKSHOP_SUPERVISOR' && !memberTeamId)) return;
          onSave({ action: 'upsertMembership', employeeId, ...(role === 'WORKSHOP_SUPERVISOR' ? {} : { teamId: memberTeamId }), role, isActive: true, effectiveFrom: chinaDateKey(new Date()) });
          setEmployeeId('');
        }}>
          <b>配置人员关系</b>
          <label>人员<select value={employeeId} onChange={event => setEmployeeId(event.target.value)} required><option value="">选择在岗员工</option>{organization.availableEmployees.filter(employee => employee.isActive).map(employee => <option value={employee.id} key={employee.id}>{employee.name} · {employee.employeeNo}</option>)}</select></label>
          <label>排程角色<select value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="WORKSHOP_SUPERVISOR">车间主管</option><option value="TEAM_LEADER">班组长</option><option value="MEMBER">生产成员</option></select></label>
          {role !== 'WORKSHOP_SUPERVISOR' && <label>所属班组<select value={memberTeamId} onChange={event => setMemberTeamId(event.target.value)}>{activeTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
          <button type="submit" className="daily-primary-button compact" disabled={busy}>{busy ? '保存中…' : '保存关系'}</button>
        </form>
        <form onSubmit={event => {
          event.preventDefault();
          if (!capabilityTeamId || !processDefinitionId) return;
          const team = organization.teams.find(item => item.id === capabilityTeamId);
          const existing = team?.capabilities.find(capability => capability.processDefinitionId === processDefinitionId);
          onSave({ action: 'upsertCapability', ...(existing ? { capabilityId: existing.id, expectedVersion: existing.version } : {}), teamId: capabilityTeamId, processDefinitionId, isActive: true });
        }}>
          <b>配置班组—工序归属</b>
          <label>生产班组<select value={capabilityTeamId} onChange={event => setCapabilityTeamId(event.target.value)}>{activeTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label>可领取工序<select value={processDefinitionId} onChange={event => setProcessDefinitionId(event.target.value)}>{organization.processDefinitions.map(process => <option key={process.id} value={process.id}>{process.name}{process.stageGroup ? ` · ${process.stageGroup}` : ''}</option>)}</select></label>
          <button type="submit" className="daily-primary-button compact" disabled={busy || !capabilityTeamId || !processDefinitionId}><Plus size={14} />添加归属</button>
        </form>
      </div>
    </section>}
    <div className="daily-team-grid">{organization.teams.map(team => <article className={`daily-team-card ${team.isActive ? '' : 'inactive'}`} key={team.id}>
      <header><div><span>{team.code || '生产班组'}</span><strong>{team.name}</strong></div><b>{team.members.length} 人 · {team.capabilities.filter(capability => capability.isActive).length} 工序</b></header>
      <section className="daily-team-capabilities"><strong>可领取工序</strong><div>{!team.capabilities.some(capability => capability.isActive) && <p>尚未配置工序归属</p>}{team.capabilities.filter(capability => capability.isActive).map(capability => <span key={capability.id}>{capability.processName}{canManage && <button type="button" aria-label={`移除${capability.processName}归属`} disabled={busy} onClick={() => onSave({ action: 'upsertCapability', capabilityId: capability.id, teamId: team.id, processDefinitionId: capability.processDefinitionId, isActive: false, expectedVersion: capability.version })}><X size={12} /></button>}</span>)}</div></section>
      <div className="daily-org-member-list">{!team.members.length && <p>尚未配置组长或成员</p>}{team.members.map(member => <div key={member.id || `${team.id}-${member.employeeId}-${member.planningRole}`}><span>{member.employeeName.slice(0, 1)}</span><b>{member.employeeName}<small>{member.position || member.employeeNo}</small></b><em>{member.planningRole === 'TEAM_LEADER' ? '组长' : member.planningRole === 'WORKSHOP_SUPERVISOR' ? '主管' : '成员'}</em></div>)}</div>
      {canManage && <footer><button type="button" onClick={() => { setTeamId(team.id); setTeamCode(team.code || ''); setTeamName(team.name); }}>编辑</button><button type="button" className={team.isActive ? 'danger' : ''} disabled={busy} onClick={() => onSave({ action: 'upsertTeam', teamId: team.id, code: team.code || '', name: team.name, isActive: !team.isActive, expectedVersion: team.version })}>{team.isActive ? '停用' : '启用'}</button></footer>}
    </article>)}</div>
  </div>;
}
