'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Clock3,
  Eye,
  Filter,
  GitBranch,
  Info,
  Layers3,
  Link2,
  ListChecks,
  MessageSquareText,
  Network,
  PencilLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  UserCog,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import {
  responsibilityCollaborationPrototype,
  type ResponsibilityMatrixItem,
  type ResponsibilityPerson,
  type ResponsibilityPersonStatus,
  type ResponsibilityRuleState,
  type ResponsibilityWarningKind,
  type ResponsibilityWorkItem,
  type WorkDateScope,
  type WorkPriority,
  type WorkRelation,
  type WorkState,
} from '@/lib/responsibility-collaboration';
import type { CurrentUserDTO } from '@/types';

type ResponsibilityCollaborationShellProps = {
  user: CurrentUserDTO;
};

type ResponsibilityTab = 'matrix' | 'roles' | 'work';
type MatrixRiskFilter = ResponsibilityWarningKind | 'all';

const snapshot = responsibilityCollaborationPrototype;
const personMap = new Map(snapshot.people.map(person => [person.id, person]));
const departmentMap = new Map(snapshot.departments.map(department => [department.id, department]));

const tabItems: Array<{ id: ResponsibilityTab; label: string; description: string; icon: typeof Network }> = [
  { id: 'matrix', label: '责任矩阵', description: '规则与全局责任关系', icon: Layers3 },
  { id: 'roles', label: '角色职责', description: '岗位边界与协作网络', icon: UserCog },
  { id: 'work', label: '我的工作预览', description: '个人协同入口模拟', icon: BriefcaseBusiness },
];

const relationLabels: Record<WorkRelation, string> = {
  owned: '我主责',
  review: '待我审核',
  assist: '需要我配合',
  informed: '我被知会',
};

const relationDescriptions: Record<WorkRelation, string> = {
  owned: '需要我推动结果并完成交接',
  review: '等待我确认、放行或给出结论',
  assist: '由他人主责，我提供必要输入',
  informed: '关注进展与结果，无需重复处理',
};

const ruleStateLabels: Record<ResponsibilityRuleState, string> = {
  healthy: '运行正常',
  attention: '需要关注',
  overdue: '已超时',
  conflict: '责任冲突',
  unassigned: '负责人缺失',
};

const priorityLabels: Record<WorkPriority, string> = {
  urgent: '紧急',
  high: '高',
  normal: '常规',
};

const workStateLabels: Record<WorkState, string> = {
  pending: '待处理',
  processing: '处理中',
  waiting: '等待中',
  done: '已完成',
};

function getPerson(personId: string): ResponsibilityPerson {
  return personMap.get(personId) || snapshot.people[0];
}

function PersonAvatar({ personId, size = 'normal' }: { personId: string; size?: 'small' | 'normal' | 'large' }) {
  const person = getPerson(personId);
  return (
    <span
      className={`rc-person-avatar ${size} ${person.status === 'unconfigured' ? 'unconfigured' : ''}`}
      aria-label={`${person.name}，${person.role}`}
      title={`${person.name} · ${person.role}\n${person.summary}`}
    >
      {person.initials}
    </span>
  );
}

function PersonPills({ ids, limit = 2 }: { ids: string[]; limit?: number }) {
  if (!ids.length) return <span className="rc-empty-owner"><AlertCircle size={12} />待配置</span>;
  const visible = ids.slice(0, limit);
  return (
    <span className="rc-person-pills">
      {visible.map(id => {
        const person = getPerson(id);
        return <span className={person.status === 'unconfigured' ? 'unconfigured' : ''} key={id} title={`${person.name} · ${person.role}\n${person.summary}`}><PersonAvatar personId={id} size="small" />{person.name}</span>;
      })}
      {ids.length > limit && <em>+{ids.length - limit}</em>}
    </span>
  );
}

function updateLocation(tab: ResponsibilityTab, personId?: string, matterId?: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set('tab', tab);
  if (personId) params.set('person', personId);
  else params.delete('person');
  if (matterId) params.set('matter', matterId);
  else params.delete('matter');
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function applyPerspective(element: HTMLElement, clientX: number, clientY: number): void {
  const bounds = element.getBoundingClientRect();
  const x = (clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5;
  const y = (clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5;
  element.style.setProperty('--rc-tilt-x', `${(-y * 2.4).toFixed(2)}deg`);
  element.style.setProperty('--rc-tilt-y', `${(x * 3).toFixed(2)}deg`);
  element.style.setProperty('--rc-glow-x', `${((x + 0.5) * 100).toFixed(1)}%`);
  element.style.setProperty('--rc-glow-y', `${((y + 0.5) * 100).toFixed(1)}%`);
}

function clearPerspective(element: HTMLElement): void {
  element.style.removeProperty('--rc-tilt-x');
  element.style.removeProperty('--rc-tilt-y');
  element.style.removeProperty('--rc-glow-x');
  element.style.removeProperty('--rc-glow-y');
}

function MatrixDetail({
  item,
  onClose,
  onPerson,
}: {
  item: ResponsibilityMatrixItem;
  onClose: () => void;
  onPerson: (personId: string) => void;
}) {
  const groups = [
    { label: '主责', ids: item.ownerIds, tone: 'owner' },
    { label: '协同', ids: item.collaboratorIds, tone: 'assist' },
    { label: '审核', ids: item.reviewerIds, tone: 'review' },
    { label: '知会', ids: item.informedIds, tone: 'informed' },
  ];

  return (
    <aside className="rc-matrix-detail" aria-label={`${item.matter}责任详情`}>
      <header>
        <div><span>{item.module}</span><h2>{item.matter}</h2><p>{item.description}</p></div>
        <button type="button" aria-label="关闭责任详情" title="关闭" onClick={onClose}><X size={16} /></button>
      </header>
      {item.warningText && <div className={`rc-rule-warning ${item.warning || ''}`}><AlertTriangle size={16} /><div><strong>{ruleStateLabels[item.state]}</strong><p>{item.warningText}</p></div></div>}
      <section className="rc-detail-section">
        <div className="rc-section-heading"><div><span>责任流转</span><h3>从发起到交接</h3></div><small>{item.dueLabel}</small></div>
        <ol className="rc-responsibility-flow">
          {item.flow.map((step, index) => (
            <li className={step.state} key={`${item.id}-${step.label}`}>
              <span className="rc-flow-index">{step.state === 'done' ? <Check size={12} /> : index + 1}</span>
              <div><strong>{step.label}</strong><PersonPills ids={step.personIds} limit={2} /></div>
              {index < item.flow.length - 1 && <ArrowRight size={14} aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </section>
      <section className="rc-detail-section">
        <div className="rc-section-heading"><div><span>关联人员</span><h3>责任关系分布</h3></div></div>
        <div className="rc-responsibility-groups">
          {groups.map(group => (
            <div className={group.tone} key={group.label}>
              <span>{group.label}</span>
              <div>
                {group.ids.length ? group.ids.map(id => {
                  const person = getPerson(id);
                  return <button type="button" key={id} onClick={() => onPerson(id)}><PersonAvatar personId={id} /><span><strong>{person.name}</strong><small>{person.role}</small></span><ChevronRight size={13} /></button>;
                }) : <p>尚未配置</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <footer>
        <a href={item.route}>打开来源业务<ArrowUpRight size={14} /></a>
        <span><Info size={13} />本页仅配置责任规则，不重复处理业务</span>
      </footer>
    </aside>
  );
}

function MatrixView({
  onOpenRole,
  initialMatterId,
}: {
  onOpenRole: (personId: string) => void;
  initialMatterId: string;
}) {
  const [keyword, setKeyword] = useState('');
  const [department, setDepartment] = useState('all');
  const [person, setPerson] = useState('all');
  const [module, setModule] = useState('all');
  const [risk, setRisk] = useState<MatrixRiskFilter>('all');
  const [selectedId, setSelectedId] = useState(initialMatterId);

  useEffect(() => {
    if (initialMatterId) setSelectedId(initialMatterId);
  }, [initialMatterId]);

  const modules = useMemo(() => Array.from(new Set(snapshot.matrix.map(item => item.module))), []);
  const filtered = useMemo(() => snapshot.matrix.filter(item => {
    const search = keyword.trim().toLowerCase();
    const people = [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds];
    const matchesKeyword = !search || [item.matter, item.description, item.module, item.roleKeyword, ...people.map(id => `${getPerson(id).name} ${getPerson(id).role}`)]
      .some(value => value.toLowerCase().includes(search));
    const matchesDepartment = department === 'all' || item.departmentId === department;
    const matchesPerson = person === 'all' || people.includes(person);
    const matchesModule = module === 'all' || item.module === module;
    const matchesRisk = risk === 'all' || item.warning === risk;
    return matchesKeyword && matchesDepartment && matchesPerson && matchesModule && matchesRisk;
  }), [department, keyword, module, person, risk]);
  const selected = snapshot.matrix.find(item => item.id === selectedId) || null;
  const warningCounts = {
    'missing-owner': snapshot.matrix.filter(item => item.warning === 'missing-owner').length,
    'responsibility-conflict': snapshot.matrix.filter(item => item.warning === 'responsibility-conflict').length,
    overdue: snapshot.matrix.filter(item => item.warning === 'overdue').length,
  };
  const ownedRuleCount = snapshot.matrix.filter(item => item.ownerIds.length > 0).length;
  const ruleCoverage = Math.round((ownedRuleCount / snapshot.matrix.length) * 100);

  function selectItem(item: ResponsibilityMatrixItem): void {
    setSelectedId(item.id);
    updateLocation('matrix', person === 'all' ? undefined : person, item.id);
  }

  return (
    <div className="rc-matrix-view">
      <section className="rc-alert-strip" aria-label="责任规则提示">
        <button type="button" aria-pressed={risk === 'missing-owner'} className={risk === 'missing-owner' ? 'active missing' : 'missing'} onClick={() => setRisk(current => current === 'missing-owner' ? 'all' : 'missing-owner')}>
          <span><UserCheck size={16} /></span><div><strong>责任缺失</strong><small>点击筛选待配置事项</small></div><b>{warningCounts['missing-owner']}</b>
        </button>
        <button type="button" aria-pressed={risk === 'responsibility-conflict'} className={risk === 'responsibility-conflict' ? 'active conflict' : 'conflict'} onClick={() => setRisk(current => current === 'responsibility-conflict' ? 'all' : 'responsibility-conflict')}>
          <span><GitBranch size={16} /></span><div><strong>责任冲突</strong><small>点击查看多主责规则</small></div><b>{warningCounts['responsibility-conflict']}</b>
        </button>
        <button type="button" aria-pressed={risk === 'overdue'} className={risk === 'overdue' ? 'active overdue' : 'overdue'} onClick={() => setRisk(current => current === 'overdue' ? 'all' : 'overdue')}>
          <span><Clock3 size={16} /></span><div><strong>超时升级</strong><small>点击查看临期与超时</small></div><b>{warningCounts.overdue}</b>
        </button>
        <div className="rc-rule-health"><span><CheckCircle2 size={17} /></span><div><strong>{ruleCoverage}% 规则已覆盖</strong><small>{ownedRuleCount} / {snapshot.matrix.length} 项主责明确</small></div><em>运行概览</em></div>
      </section>

      <section className="rc-filter-bar" aria-label="责任矩阵筛选">
        <label className="rc-search-field"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索事项、岗位或人员" aria-label="搜索责任规则" />{keyword && <button type="button" aria-label="清空搜索" onClick={() => setKeyword('')}><X size={13} /></button>}</label>
        <label><span>部门</span><select value={department} onChange={event => setDepartment(event.target.value)}><option value="all">全部部门</option>{snapshot.departments.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>人员</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">全部人员</option>{snapshot.people.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>业务模块</span><select value={module} onChange={event => setModule(event.target.value)}><option value="all">全部模块</option>{modules.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
        <button type="button" className="rc-clear-filter" onClick={() => { setKeyword(''); setDepartment('all'); setPerson('all'); setModule('all'); setRisk('all'); }}><Filter size={14} />重置</button>
      </section>

      <div className={`rc-matrix-workspace ${selected ? 'has-detail' : ''}`}>
        <section className="rc-matrix-table-panel">
          <header><div><span>全局责任规则</span><h2>业务事项责任矩阵</h2></div><small>{filtered.length} / {snapshot.matrix.length} 项</small></header>
          <div className="rc-matrix-table-scroll hm-scroll-region" tabIndex={0}>
            <table className="rc-matrix-table">
              <thead><tr><th>业务事项</th><th>主责</th><th>协同</th><th>审核</th><th>知会</th><th>时限</th><th>状态 / 操作</th></tr></thead>
              <tbody>
                {filtered.map(item => (
                  <tr
                    className={`${selected?.id === item.id ? 'selected' : ''} state-${item.state}`}
                    key={item.id}
                    tabIndex={0}
                    onClick={() => selectItem(item)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectItem(item); } }}
                  >
                    <td><span>{item.module}</span><strong>{item.matter}</strong><small>{item.description}</small></td>
                    <td>
                      {item.ownerIds.length
                        ? <PersonPills ids={item.ownerIds} />
                        : <button type="button" className="rc-configure-owner" onClick={event => { event.stopPropagation(); selectItem(item); }}><UserCheck size={12} />补充主责</button>}
                    </td>
                    <td><PersonPills ids={item.collaboratorIds} /></td>
                    <td><PersonPills ids={item.reviewerIds} /></td>
                    <td><PersonPills ids={item.informedIds} limit={1} /></td>
                    <td><strong className="rc-due-label">{item.dueLabel}</strong></td>
                    <td className="rc-state-action-cell">
                      <button type="button" className={`rc-state-pill ${item.state}`} onClick={event => { event.stopPropagation(); selectItem(item); }}>{item.warning && <AlertCircle size={11} />}{ruleStateLabels[item.state]}</button>
                      <div className="rc-row-actions" aria-label={`${item.matter}快捷操作`}>
                        <button type="button" title="查看责任链" aria-label="查看责任链" onClick={event => { event.stopPropagation(); selectItem(item); }}><GitBranch size={13} /></button>
                        <button type="button" title="编辑责任规则" aria-label="编辑责任规则" onClick={event => { event.stopPropagation(); selectItem(item); }}><PencilLine size={13} /></button>
                        <a href={item.route} title="查看关联事项" aria-label="查看关联事项" onClick={event => event.stopPropagation()}><Link2 size={13} /></a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <div className="rc-empty-result"><Search size={22} /><strong>没有匹配的责任规则</strong><span>调整筛选条件后重试</span></div>}
          </div>
        </section>
        {selected && <MatrixDetail item={selected} onClose={() => { setSelectedId(''); updateLocation('matrix', person === 'all' ? undefined : person); }} onPerson={onOpenRole} />}
      </div>
    </div>
  );
}

type RoleDetailPanel = 'responsibilities' | 'modules' | 'collaboration' | 'escalation';

function responsibilityType(item: ResponsibilityMatrixItem, personId: string): string {
  if (item.ownerIds.includes(personId)) return '主责';
  if (item.reviewerIds.includes(personId)) return '审核';
  if (item.collaboratorIds.includes(personId)) return '协同';
  return '知会';
}

function responsibilityHandoff(item: ResponsibilityMatrixItem, personId: string): ResponsibilityPerson | null {
  const candidateId = [...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds, ...item.ownerIds]
    .find(id => id !== personId);
  return candidateId ? getPerson(candidateId) : null;
}

function rulesForPerson(personId: string): ResponsibilityMatrixItem[] {
  return snapshot.matrix.filter(item => (
    [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds].includes(personId)
  ));
}

function CollaborationNetwork({
  person,
  responsibilities,
  onSelect,
}: {
  person: ResponsibilityPerson;
  responsibilities: ResponsibilityMatrixItem[];
  onSelect: (personId: string) => void;
}) {
  const collaborators = person.collaboratorIds.slice(0, 5);
  const [activeCollaboratorId, setActiveCollaboratorId] = useState(collaborators[0] || '');
  const activeCollaborator = activeCollaboratorId ? getPerson(activeCollaboratorId) : null;
  const activeRelations = activeCollaborator
    ? responsibilities.filter(item => (
      [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds].includes(activeCollaborator.id)
    ))
    : [];

  useEffect(() => {
    setActiveCollaboratorId(person.collaboratorIds[0] || '');
  }, [person.id, person.collaboratorIds]);

  return (
    <section className="rc-network-card">
      <div className="rc-section-heading"><div><span>协作网络</span><h3>关键协作关系</h3></div><small>{collaborators.length} 位高频对象</small></div>
      <div
        className="rc-network-map"
        onPointerMove={event => applyPerspective(event.currentTarget, event.clientX, event.clientY)}
        onPointerLeave={event => clearPerspective(event.currentTarget)}
      >
        {collaborators.map((collaboratorId, index) => (
          <span
            className={`rc-network-line line-${index + 1} ${activeCollaboratorId === collaboratorId ? 'active' : activeCollaboratorId ? 'muted' : ''}`}
            key={`line-${collaboratorId}`}
            aria-hidden="true"
          />
        ))}
        <div className="rc-network-center"><PersonAvatar personId={person.id} size="large" /><strong>{person.name}</strong><small>{person.role}</small></div>
        {collaborators.map((collaboratorId, index) => {
          const collaborator = getPerson(collaboratorId);
          const relationCount = responsibilities.filter(item => (
            [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds].includes(collaboratorId)
          )).length;
          return (
            <button
              type="button"
              className={`rc-network-node node-${index + 1} ${activeCollaboratorId === collaboratorId ? 'active' : ''}`}
              key={collaboratorId}
              title={`${collaborator.name} · ${collaborator.role}\n共同关联 ${relationCount} 项责任规则`}
              onPointerEnter={() => setActiveCollaboratorId(collaboratorId)}
              onFocus={() => setActiveCollaboratorId(collaboratorId)}
              onClick={() => onSelect(collaboratorId)}
            >
              <PersonAvatar personId={collaboratorId} /><span><strong>{collaborator.name}</strong><small>{collaborator.role}</small></span><b>{relationCount}</b>
            </button>
          );
        })}
      </div>
      <div className="rc-network-context" aria-live="polite">
        {activeCollaborator ? (
          <>
            <span><PersonAvatar personId={activeCollaborator.id} size="small" /><strong>{activeCollaborator.name}</strong></span>
            <p>{activeRelations[0]?.matter || '日常跨部门协作'}{activeRelations.length > 1 ? ` 等 ${activeRelations.length} 项关联事项` : ''}</p>
            <button type="button" onClick={() => onSelect(activeCollaborator.id)}>查看角色<ChevronRight size={13} /></button>
          </>
        ) : <p>悬停协作对象查看责任摘要</p>}
      </div>
    </section>
  );
}

function RolesView({
  selectedPersonId,
  onSelectPerson,
  onOpenMatrix,
  onOpenWork,
}: {
  selectedPersonId: string;
  onSelectPerson: (personId: string) => void;
  onOpenMatrix: (personId: string) => void;
  onOpenWork: (personId: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [department, setDepartment] = useState('all');
  const [roleStatus, setRoleStatus] = useState<ResponsibilityPersonStatus | 'all'>('all');
  const [activePanel, setActivePanel] = useState<RoleDetailPanel>('responsibilities');
  const selected = getPerson(selectedPersonId);
  const selectedRules = useMemo(() => rulesForPerson(selectedPersonId), [selectedPersonId]);
  const selectedWork = useMemo(() => snapshot.workItems.filter(item => (
    item.ownerId === selectedPersonId || item.nextPersonId === selectedPersonId || item.participantIds.includes(selectedPersonId)
  )), [selectedPersonId]);
  const ownedCount = selectedRules.filter(item => item.ownerIds.includes(selectedPersonId)).length;
  const loadPercent = Math.min(100, Math.max(18, 28 + selectedWork.filter(item => item.state !== 'done').length * 11));
  const groupedPeople = useMemo(() => snapshot.departments.map(groupDepartment => ({
    department: groupDepartment,
    people: snapshot.people.filter(person => {
      if (person.departmentId !== groupDepartment.id) return false;
      if (department !== 'all' && person.departmentId !== department) return false;
      if (roleStatus !== 'all' && person.status !== roleStatus) return false;
      const search = keyword.trim().toLowerCase();
      return !search || `${person.name} ${person.role} ${groupDepartment.label}`.toLowerCase().includes(search);
    }),
  })).filter(group => group.people.length), [department, keyword, roleStatus]);

  useEffect(() => {
    setActivePanel('responsibilities');
  }, [selectedPersonId]);

  return (
    <div className="rc-roles-view rc-roles-view-v2">
      <aside className="rc-role-list">
        <header><div><span>组织角色</span><h2>角色与人员</h2></div><b>{snapshot.people.length}</b></header>
        <label className="rc-search-field"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索姓名或岗位" aria-label="搜索角色或人员" />{keyword && <button type="button" aria-label="清空搜索" onClick={() => setKeyword('')}><X size={13} /></button>}</label>
        <div className="rc-role-list-filters">
          <label><span>部门</span><select value={department} onChange={event => setDepartment(event.target.value)}><option value="all">全部</option>{snapshot.departments.map(item => <option value={item.id} key={item.id}>{item.shortLabel}</option>)}</select></label>
          <label><span>状态</span><select value={roleStatus} onChange={event => setRoleStatus(event.target.value as ResponsibilityPersonStatus | 'all')}><option value="all">全部</option><option value="active">在岗</option><option value="unconfigured">待配置</option></select></label>
        </div>
        <div className="rc-role-list-scroll hm-scroll-region" tabIndex={0}>
          {groupedPeople.map(group => (
            <section key={group.department.id}>
              <h3>{group.department.label}<span>{group.people.length}</span></h3>
              {group.people.map(person => (
                <button type="button" key={person.id} className={`${selected.id === person.id ? 'selected' : ''} ${person.status}`} onClick={() => onSelectPerson(person.id)}>
                  <PersonAvatar personId={person.id} />
                  <span><strong>{person.name}</strong><small>{person.role}</small></span>
                  {person.status === 'unconfigured' ? <em>待配置</em> : <i className="rc-role-online" title="在岗" />}
                </button>
              ))}
            </section>
          ))}
          {!groupedPeople.length && <div className="rc-role-list-empty"><Search size={18} /><strong>暂无匹配人员</strong><button type="button" onClick={() => { setKeyword(''); setDepartment('all'); setRoleStatus('all'); }}>清除筛选</button></div>}
        </div>
      </aside>

      <section className="rc-role-workbench hm-scroll-region" tabIndex={0}>
        <header className="rc-role-hero">
          <div className="rc-role-identity">
            <PersonAvatar personId={selected.id} size="large" />
            <div><span>{departmentMap.get(selected.departmentId)?.label}</span><h2>{selected.name}</h2><p>{selected.role}</p></div>
          </div>
          <p className="rc-role-summary">{selected.summary}</p>
          <div className="rc-role-kpis" aria-label={`${selected.name}角色概览`}>
            <div><span>状态</span><strong className={selected.status}>{selected.status === 'active' ? '在岗' : '待配置'}</strong></div>
            <div><span>当前负荷</span><strong>{loadPercent}%</strong><i><em style={{ width: `${loadPercent}%` }} /></i></div>
            <div><span>主要责任</span><strong>{ownedCount}</strong><small>项主责规则</small></div>
            <div><span>协同事项</span><strong>{selectedWork.length}</strong><small>项工作关联</small></div>
          </div>
          <div className="rc-role-hero-actions">
            <button type="button" onClick={() => onOpenMatrix(selected.id)}>责任矩阵<ArrowRight size={13} /></button>
            <button type="button" className="primary" onClick={() => onOpenWork(selected.id)}>进入工作预览<ArrowRight size={13} /></button>
          </div>
        </header>

        <div className="rc-role-workspace-grid">
          <div className="rc-role-primary">
            <div className="rc-role-overview-grid" aria-label="角色职责概览">
              <button type="button" className={activePanel === 'responsibilities' ? 'active' : ''} onClick={() => setActivePanel('responsibilities')}>
                <span><Target size={17} /></span><div><small>职责边界</small><h3>核心职责</h3><p>{selected.coreResponsibilities[0]}</p></div><b>{selected.coreResponsibilities.length}</b>
              </button>
              <button type="button" className={activePanel === 'modules' ? 'active' : ''} onClick={() => setActivePanel('modules')}>
                <span><Layers3 size={17} /></span><div><small>业务范围</small><h3>管理模块</h3><p>{selected.managedModules.slice(0, 2).join('、')}</p></div><b>{selected.managedModules.length}</b>
              </button>
              <button type="button" className={activePanel === 'collaboration' ? 'active' : ''} onClick={() => setActivePanel('collaboration')}>
                <span><UsersRound size={17} /></span><div><small>协同对象</small><h3>主要协作</h3><p>{selected.collaboratorIds.slice(0, 2).map(id => getPerson(id).name).join('、')}</p></div><b>{selected.collaboratorIds.length}</b>
              </button>
              <button type="button" className={activePanel === 'escalation' ? 'active' : ''} onClick={() => setActivePanel('escalation')}>
                <span><ShieldCheck size={17} /></span><div><small>治理关系</small><h3>审核与升级</h3><p>{[...selected.reviewerIds, ...selected.escalationIds].slice(0, 2).map(id => getPerson(id).name).join('、') || '无需上级审核'}</p></div><b>{selected.reviewerIds.length + selected.escalationIds.length}</b>
              </button>
            </div>

            <section className={`rc-role-panel-detail panel-${activePanel}`}>
              {activePanel === 'responsibilities' && <ol>{selected.coreResponsibilities.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></li>)}</ol>}
              {activePanel === 'modules' && <div className="rc-role-module-links">{selected.managedModules.map(module => <button type="button" onClick={() => onOpenMatrix(selected.id)} key={module}>{module}<ArrowUpRight size={12} /></button>)}</div>}
              {activePanel === 'collaboration' && <div className="rc-role-collaborator-links">{selected.collaboratorIds.slice(0, 6).map(id => { const person = getPerson(id); return <button type="button" key={id} onClick={() => onSelectPerson(id)}><PersonAvatar personId={id} size="small" /><span><strong>{person.name}</strong><small>{person.role}</small></span></button>; })}</div>}
              {activePanel === 'escalation' && <div className="rc-escalation-flow"><div><span>日常审核</span><PersonPills ids={selected.reviewerIds} limit={3} /></div><ArrowRight size={16} /><div><span>升级决策</span><PersonPills ids={selected.escalationIds} limit={3} /></div></div>}
            </section>

            <section className="rc-role-ledger">
              <div className="rc-section-heading"><div><span>职责清单</span><h3>责任规则与交接</h3></div><small>{selectedRules.length} 项关联规则</small></div>
              <div className="rc-role-ledger-scroll hm-scroll-region" tabIndex={0}>
                <table>
                  <thead><tr><th>业务事项</th><th>责任类型</th><th>触发条件</th><th>交接对象</th><th>时限</th><th>关联流程</th><th>状态</th></tr></thead>
                  <tbody>{selectedRules.map(item => {
                    const handoff = responsibilityHandoff(item, selected.id);
                    return (
                      <tr key={`${selected.id}-${item.id}`}>
                        <td><a href={item.route}><strong>{item.matter}</strong><small>{item.module}</small></a></td>
                        <td><span className={`rc-relation-type type-${responsibilityType(item, selected.id)}`}>{responsibilityType(item, selected.id)}</span></td>
                        <td title={item.description}>{item.description}</td>
                        <td>{handoff ? <button type="button" onClick={() => onSelectPerson(handoff.id)}><PersonAvatar personId={handoff.id} size="small" />{handoff.name}</button> : <span>—</span>}</td>
                        <td><strong>{item.dueLabel}</strong></td>
                        <td title={item.flow.map(step => step.label).join(' → ')}>{item.flow.map(step => step.label).slice(0, 2).join(' → ')}</td>
                        <td><button type="button" className={`rc-state-pill ${item.state}`} onClick={() => onOpenMatrix(selected.id)}>{ruleStateLabels[item.state]}</button></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                {!selectedRules.length && <div className="rc-role-ledger-empty"><Info size={18} /><strong>当前角色尚未关联责任规则</strong><button type="button" onClick={() => onOpenMatrix(selected.id)}>前往责任矩阵配置</button></div>}
              </div>
            </section>
          </div>

          <aside className="rc-role-insights">
            <CollaborationNetwork person={selected} responsibilities={selectedRules} onSelect={onSelectPerson} />
            <section className="rc-permission-card">
              <div className="rc-section-heading"><div><span>权限范围</span><h3>初版配置预览</h3></div><em>未生效</em></div>
              <p><Info size={13} /><strong>仅用于后续配置参考</strong><span>当前不会改变任何账号访问范围或操作权限。</span></p>
              <div>
                {selected.permissions.map(permission => (
                  <article key={`${permission.module}-${permission.scope}`}>
                    <span className={`mode-${permission.mode}`}>{permission.mode === '查看' ? <Eye size={13} /> : permission.mode === '审核' ? <ShieldCheck size={13} /> : <UserCog size={13} />}{permission.mode}</span>
                    <div><strong>{permission.module}</strong><small>{permission.scope}</small></div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}

type DerivedWorkItem = ResponsibilityWorkItem & { displayRelation: WorkRelation };

function relationForPerson(item: ResponsibilityWorkItem, personId: string): WorkRelation | null {
  if (item.ownerId === personId) return item.relation;
  if (item.nextPersonId === personId) return 'review';
  if (item.participantIds.includes(personId)) return item.relation === 'informed' ? 'informed' : 'assist';
  return null;
}

function WorkItemCard({
  item,
  onQuickAction,
}: {
  item: DerivedWorkItem;
  onQuickAction: (label: string, item: DerivedWorkItem) => void;
}) {
  const nextPerson = getPerson(item.nextPersonId);
  return (
    <article className={`rc-work-item priority-${item.priority}`}>
      <header><span>{item.source}</span><em>{priorityLabels[item.priority]}</em></header>
      <a className="rc-work-item-title" href={item.route}><h3>{item.title}</h3><ArrowUpRight size={13} /></a>
      <div className="rc-work-progress"><span style={{ width: `${item.progress}%` }} /></div>
      <div className="rc-work-meta"><span className={`state-${item.state}`}>{item.stateLabel}</span><span><Clock3 size={11} />{item.dueLabel}</span></div>
      <footer><span>下一步交接</span><PersonAvatar personId={nextPerson.id} size="small" /><strong>{nextPerson.name}</strong><small>{nextPerson.role}</small></footer>
      <div className="rc-work-quick-actions" aria-label={`${item.title}快捷操作`}>
        <a href={item.route} title="查看详情"><Eye size={13} />查看</a>
        <button type="button" title="确认接收" onClick={() => onQuickAction('已确认接收', item)}><CheckCheck size={13} />接收</button>
        <button type="button" title="催办协同人" onClick={() => onQuickAction(`已提醒${nextPerson.name}`, item)}><Send size={13} />催办</button>
        <button type="button" title="标记已读" onClick={() => onQuickAction('已标记为已读', item)}><MessageSquareText size={13} />已读</button>
      </div>
    </article>
  );
}

function WorkPreview({
  selectedPersonId,
  onSelectPerson,
}: {
  selectedPersonId: string;
  onSelectPerson: (personId: string) => void;
}) {
  const [dateScope, setDateScope] = useState<WorkDateScope | 'all'>('today');
  const [priority, setPriority] = useState<WorkPriority | 'all'>('all');
  const [state, setState] = useState<WorkState | 'all'>('all');
  const [collapsedRelations, setCollapsedRelations] = useState<Record<'assist' | 'informed', boolean>>({ assist: false, informed: false });
  const [quickFeedback, setQuickFeedback] = useState('');
  const selected = getPerson(selectedPersonId);
  const allPersonItems = useMemo(() => snapshot.workItems.map(item => {
    const displayRelation = relationForPerson(item, selectedPersonId);
    return displayRelation ? { ...item, displayRelation } : null;
  }).filter((item): item is DerivedWorkItem => item !== null), [selectedPersonId]);
  const filtered = useMemo(() => allPersonItems.filter(item => (
    (dateScope === 'all' || item.dateScope === dateScope)
    && (priority === 'all' || item.priority === priority)
    && (state === 'all' || item.state === state)
  )), [allPersonItems, dateScope, priority, state]);
  const progress = allPersonItems.length
    ? Math.round(allPersonItems.reduce((sum, item) => sum + item.progress, 0) / allPersonItems.length)
    : 0;
  const urgentItems = allPersonItems.filter(item => item.priority === 'urgent' && item.state !== 'done');
  const focusItem = urgentItems[0] || allPersonItems.find(item => item.state !== 'done') || allPersonItems[0];
  const focusOwner = focusItem ? getPerson(focusItem.ownerId) : selected;
  const focusNext = focusItem ? getPerson(focusItem.nextPersonId) : selected;
  const collaboratorFrequency = new Map<string, number>();
  allPersonItems.forEach(item => {
    [...item.participantIds, item.nextPersonId].forEach(id => {
      if (id !== selectedPersonId) collaboratorFrequency.set(id, (collaboratorFrequency.get(id) || 0) + 1);
    });
  });
  const workload = Array.from(collaboratorFrequency.entries()).sort((first, second) => second[1] - first[1]).slice(0, 5);
  const todayTodo = allPersonItems.filter(item => item.dateScope === 'today' && item.state !== 'done').length;
  const dueSoon = allPersonItems.filter(item => item.state !== 'done' && (item.priority === 'urgent' || item.priority === 'high')).length;
  const completed = allPersonItems.filter(item => item.state === 'done').length;
  const focusPathIds = focusItem
    ? Array.from(new Set([focusItem.ownerId, ...focusItem.participantIds.slice(0, 2), focusItem.nextPersonId]))
    : [selected.id];

  function handleQuickAction(label: string, item: DerivedWorkItem): void {
    setQuickFeedback(`${item.title} · ${label}（预览）`);
    window.setTimeout(() => setQuickFeedback(''), 2400);
  }

  function clearWorkFilters(): void {
    setDateScope('all');
    setPriority('all');
    setState('all');
  }

  return (
    <div className="rc-work-view">
      <section className="rc-work-focus">
        <div className="rc-focus-leading">
          <div className="rc-focus-icon"><Sparkles size={20} /></div>
          <div><span>今日协同焦点 · {selected.name}</span><h2>{focusItem?.title || '当前没有需要推进的协同事项'}</h2><p>{focusItem ? `${focusItem.source} · ${focusItem.module}` : `${selected.role} · 工作节奏正常`}</p></div>
        </div>
        <div className="rc-focus-context">
          <div><span>风险原因</span><strong>{focusItem?.priority === 'urgent' ? '紧急事项，需在当前时限内完成交接' : focusItem?.state === 'waiting' ? '当前节点等待协作输入' : '按计划推进，关注下一节点衔接'}</strong></div>
          <div><span>下一步动作</span><strong>{focusItem ? `完成当前处理并交接给 ${focusNext.name}` : '查看全部工作事项'}</strong></div>
          <div className="rc-focus-people"><span>相关责任人</span><button type="button" onClick={() => onSelectPerson(focusOwner.id)}><PersonAvatar personId={focusOwner.id} size="small" />{focusOwner.name}</button><ArrowRight size={12} /><button type="button" onClick={() => onSelectPerson(focusNext.id)}><PersonAvatar personId={focusNext.id} size="small" />{focusNext.name}</button></div>
        </div>
        <div className="rc-focus-action">
          <div className="rc-focus-progress"><div><strong>{focusItem?.progress ?? progress}%</strong><span>当前推进</span></div><i><span style={{ width: `${focusItem?.progress ?? progress}%` }} /></i></div>
          <a href={focusItem?.route || '/workspace/workflows'}>进入处理<ArrowUpRight size={14} /></a>
        </div>
      </section>

      <section className="rc-work-toolbar" aria-label="工作预览筛选">
        <label><span>预览人员</span><select value={selectedPersonId} onChange={event => onSelectPerson(event.target.value)}>{snapshot.people.map(person => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label>
        <label><span>日期</span><select value={dateScope} onChange={event => setDateScope(event.target.value as WorkDateScope | 'all')}><option value="today">今天</option><option value="tomorrow">明天</option><option value="week">本周</option><option value="all">全部</option></select></label>
        <label><span>优先级</span><select value={priority} onChange={event => setPriority(event.target.value as WorkPriority | 'all')}><option value="all">全部优先级</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">常规</option></select></label>
        <label><span>状态</span><select value={state} onChange={event => setState(event.target.value as WorkState | 'all')}><option value="all">全部状态</option>{Object.entries(workStateLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <div className="rc-work-filter-result"><Filter size={14} /><strong>{filtered.length}</strong><span>项当前结果</span></div>
      </section>

      <div className="rc-work-main">
        <section className="rc-work-board">
          {(['owned', 'review'] as WorkRelation[]).map(relation => {
            const items = filtered.filter(item => item.displayRelation === relation);
            return (
              <section className={`rc-work-column relation-${relation}`} key={relation}>
                <header><div><span>{relation === 'owned' ? <Target size={15} /> : relation === 'review' ? <ShieldCheck size={15} /> : relation === 'assist' ? <UsersRound size={15} /> : <BellRing size={15} />}</span><div><h2>{relationLabels[relation]}</h2><p>{relationDescriptions[relation]}</p></div></div><b>{items.length}</b></header>
                <div className="rc-work-column-scroll hm-scroll-region" tabIndex={0}>
                  {items.map(item => <WorkItemCard item={item} onQuickAction={handleQuickAction} key={`${selectedPersonId}-${item.id}-${relation}`} />)}
                  {!items.length && <div className="rc-work-empty"><CheckCircle2 size={19} /><strong>{relation === 'owned' ? '当前没有主责事项' : '当前没有待审核事项'}</strong><span>{filtered.length ? '当前职责关系下没有匹配事项' : '可能是日期或状态筛选隐藏了事项'}</span><div><button type="button" onClick={clearWorkFilters}>查看全部</button><button type="button" onClick={() => setDateScope('week')}>切换本周</button></div></div>}
                </div>
              </section>
            );
          })}
          <div className="rc-work-secondary">
            {(['assist', 'informed'] as const).map(relation => {
              const items = filtered.filter(item => item.displayRelation === relation);
              const collapsed = collapsedRelations[relation];
              return (
                <section className={`rc-work-column rc-work-column-compact relation-${relation} ${collapsed ? 'collapsed' : ''}`} key={relation}>
                  <header>
                    <div><span>{relation === 'assist' ? <UsersRound size={15} /> : <BellRing size={15} />}</span><div><h2>{relationLabels[relation]}</h2><p>{relationDescriptions[relation]}</p></div></div>
                    <b>{items.length}</b>
                    <button type="button" aria-label={collapsed ? `展开${relationLabels[relation]}` : `收起${relationLabels[relation]}`} onClick={() => setCollapsedRelations(current => ({ ...current, [relation]: !current[relation] }))}>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
                  </header>
                  {!collapsed && <div className="rc-work-column-scroll hm-scroll-region" tabIndex={0}>
                    {items.map(item => <WorkItemCard item={item} onQuickAction={handleQuickAction} key={`${selectedPersonId}-${item.id}-${relation}`} />)}
                    {!items.length && <div className="rc-work-empty compact"><CheckCircle2 size={17} /><strong>暂无{relationLabels[relation]}</strong><span>可查看全部日期或切换人员</span><div><button type="button" onClick={clearWorkFilters}>查看全部</button></div></div>}
                  </div>}
                </section>
              );
            })}
          </div>
        </section>

        <aside className="rc-work-side hm-scroll-region" tabIndex={0}>
          <section className="rc-load-card">
            <div className="rc-section-heading"><div><span>今日工作</span><h3>工作负荷</h3></div><ListChecks size={16} /></div>
            <div className="rc-selected-person-mini"><PersonAvatar personId={selected.id} size="large" /><div><strong>{selected.name}</strong><span>{selected.role}</span></div><em>{allPersonItems.length} 项</em></div>
            <div className="rc-workload-metrics">
              <div><span>今日待办</span><strong>{todayTodo}</strong><CalendarDays size={13} /></div>
              <div><span>临期</span><strong>{dueSoon}</strong><CalendarClock size={13} /></div>
              <div className="risk"><span>高风险</span><strong>{urgentItems.length}</strong><AlertTriangle size={13} /></div>
              <div className="done"><span>已完成</span><strong>{completed}</strong><CheckCircle2 size={13} /></div>
            </div>
            <div className="rc-load-subheading"><span>协作对象负荷</span><Network size={13} /></div>
            <div className="rc-load-bars">
              {workload.length ? workload.map(([personId, count], index) => {
                const person = getPerson(personId);
                const width = Math.min(100, 42 + count * 16 - index * 3);
                return <button type="button" key={personId} onClick={() => onSelectPerson(personId)}><PersonAvatar personId={personId} size="small" /><span><strong>{person.name}</strong><i><em style={{ width: `${width}%` }} /></i></span><b>{count}</b></button>;
              }) : <p>当前没有协作负荷数据</p>}
            </div>
          </section>
          <section className="rc-side-risk">
            <div className="rc-section-heading"><div><span>待协调风险</span><h3>需要优先关注</h3></div><b>{urgentItems.length}</b></div>
            {urgentItems.slice(0, 3).map(item => <a href={item.route} key={item.id}><AlertTriangle size={14} /><span><strong>{item.title}</strong><small>{item.dueLabel}</small></span><ChevronRight size={13} /></a>)}
            {!urgentItems.length && <p><CheckCircle2 size={15} />当前没有紧急风险</p>}
          </section>
        </aside>
      </div>

      <section className="rc-work-footer-grid">
        <article className="rc-handoff-timeline">
          <div className="rc-section-heading"><div><span>当前工作流</span><h3>责任交接路径</h3></div><Workflow size={16} /></div>
          <div className="rc-mini-flow">{focusPathIds.map((personId, index) => {
            const person = getPerson(personId);
            const isCurrent = personId === selected.id || index === Math.min(1, focusPathIds.length - 1);
            return <span key={`${focusItem?.id || 'empty'}-${personId}-${index}`}><button type="button" className={isCurrent ? 'current' : ''} onClick={() => onSelectPerson(personId)}><PersonAvatar personId={personId} size="small" /><i>{isCurrent ? '当前' : index + 1}</i><strong>{person.name}</strong><small>{person.role}</small></button>{index < focusPathIds.length - 1 && <ArrowRight size={13} />}</span>;
          })}</div>
        </article>
        <article>
          <div className="rc-section-heading"><div><span>今日完成</span><h3>职责检查点</h3></div><CheckCircle2 size={16} /></div>
          <ul>{selected.checklist.slice(0, 3).map((item, index) => <li key={item}><span className={index < 2 ? 'done' : ''}>{index < 2 ? <Check size={11} /> : <Clock3 size={11} />}</span>{item}</li>)}</ul>
        </article>
        <article>
          <div className="rc-section-heading"><div><span>升级关系</span><h3>需要协调时</h3></div><ShieldCheck size={16} /></div>
          <div className="rc-escalation-people"><PersonPills ids={selected.reviewerIds} limit={2} /><ArrowRight size={14} /><PersonPills ids={selected.escalationIds} limit={2} /></div>
        </article>
      </section>
      {quickFeedback && <div className="rc-action-toast" role="status"><CheckCircle2 size={15} />{quickFeedback}</div>}
    </div>
  );
}

export default function ResponsibilityCollaborationShell({ user }: ResponsibilityCollaborationShellProps) {
  const matchedPerson = snapshot.people.find(person => person.name === user.employee?.name || person.name === user.displayName);
  const [activeTab, setActiveTab] = useState<ResponsibilityTab>('matrix');
  const [selectedPersonId, setSelectedPersonId] = useState(matchedPerson?.id || 'lin-bo');
  const [initialMatterId, setInitialMatterId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    const requestedPerson = params.get('person');
    if (requestedTab === 'roles' || requestedTab === 'work' || requestedTab === 'matrix') setActiveTab(requestedTab);
    if (requestedPerson && personMap.has(requestedPerson)) setSelectedPersonId(requestedPerson);
    setInitialMatterId(params.get('matter') || '');
  }, []);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  function openTab(tab: ResponsibilityTab, personId = selectedPersonId): void {
    setActiveTab(tab);
    setSelectedPersonId(personId);
    setInitialMatterId('');
    updateLocation(tab, tab === 'matrix' ? undefined : personId);
  }

  function selectRole(personId: string): void {
    setSelectedPersonId(personId);
    updateLocation('roles', personId);
  }

  function selectWorkPerson(personId: string): void {
    setSelectedPersonId(personId);
    updateLocation('work', personId);
  }

  const riskCount = snapshot.matrix.filter(item => item.warning).length;
  const configuredCount = snapshot.people.filter(person => person.status === 'active').length;

  return (
    <main className="hm-workbench-root hm-workbench-navigation-overlay rc-shell">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/responsibilities"
        subtitle="职责规则与个人协同入口"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
        hideHeader
        sidebarTriggerTargetId="responsibility-navigation-trigger"
      />

      <div className="rc-page-frame">
        <section className="rc-command-bar">
          <span className="rc-navigation-trigger" id="responsibility-navigation-trigger" aria-label="平台导航入口" />
          <div className="rc-inline-title"><Network size={18} /><div><strong>职责与协同</strong><small>责任规则 · 角色边界 · 个人入口</small></div></div>
          <nav className="rc-tabs" aria-label="职责与协同页面">
            {tabItems.map(tab => {
              const Icon = tab.icon;
              return <button type="button" className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => openTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined}><Icon size={14} /><span><strong>{tab.label}</strong><small>{tab.description}</small></span></button>;
            })}
          </nav>
          <div className="rc-command-meta"><span><CircleDot size={12} />前端原型数据</span><a href="/workspace/workflows">流程中心<ArrowUpRight size={13} /></a></div>
        </section>

        <section className="rc-summary-strip" aria-label="职责协同概览">
          <button type="button" className={activeTab === 'roles' ? 'active' : ''} onClick={() => openTab('roles')}><span className="blue"><UsersRound size={16} /></span><div><small>人员与岗位</small><strong>{snapshot.people.length}</strong><em>{configuredCount} 已配置</em></div></button>
          <button type="button" className={activeTab === 'matrix' ? 'active' : ''} onClick={() => openTab('matrix')}><span className="indigo"><Layers3 size={16} /></span><div><small>责任事项</small><strong>{snapshot.matrix.length}</strong><em>{snapshot.departments.length} 个部门</em></div></button>
          <button type="button" onClick={() => { setActiveTab('matrix'); setInitialMatterId(snapshot.matrix.find(item => item.warning)?.id || ''); updateLocation('matrix', undefined, snapshot.matrix.find(item => item.warning)?.id); }}><span className="orange"><AlertTriangle size={16} /></span><div><small>规则提醒</small><strong>{riskCount}</strong><em>缺失 · 冲突 · 超时</em></div></button>
          <button type="button" className={activeTab === 'work' ? 'active' : ''} onClick={() => openTab('work')}><span className="green"><BriefcaseBusiness size={16} /></span><div><small>今日协同事项</small><strong>{snapshot.workItems.filter(item => item.dateScope === 'today').length}</strong><em>个人入口模拟</em></div></button>
        </section>

        <section className="rc-page-content">
          {activeTab === 'matrix' && <MatrixView initialMatterId={initialMatterId} onOpenRole={personId => { setActiveTab('roles'); setSelectedPersonId(personId); updateLocation('roles', personId); }} />}
          {activeTab === 'roles' && <RolesView selectedPersonId={selectedPersonId} onSelectPerson={selectRole} onOpenMatrix={personId => { setActiveTab('matrix'); setInitialMatterId(snapshot.matrix.find(item => [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds].includes(personId))?.id || ''); updateLocation('matrix', personId); }} onOpenWork={personId => { setActiveTab('work'); setSelectedPersonId(personId); updateLocation('work', personId); }} />}
          {activeTab === 'work' && <WorkPreview selectedPersonId={selectedPersonId} onSelectPerson={selectWorkPerson} />}
        </section>
      </div>
    </main>
  );
}
