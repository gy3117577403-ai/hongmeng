'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  Copy,
  Filter,
  GitBranch,
  Info,
  PencilLine,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  responsibilityCollaborationPrototype,
  type ResponsibilityMatrixItem,
  type ResponsibilityPerson,
  type ResponsibilityRuleState,
  type ResponsibilityWarningKind,
} from '@/lib/responsibility-collaboration';
import type { CurrentUserDTO } from '@/types';

type MatrixRelationKey = 'ownerIds' | 'collaboratorIds' | 'reviewerIds' | 'informedIds';
type MatrixRiskFilter = ResponsibilityWarningKind | 'all';
type MatrixStatusFilter = ResponsibilityRuleState | 'all';

type EditorState = {
  itemId: string;
  relation: MatrixRelationKey;
  selectedIds: string[];
  anchor: { top: number; left: number };
};

type HoverState = {
  personId: string;
  top: number;
  left: number;
};

const snapshot = responsibilityCollaborationPrototype;
const personMap = new Map(snapshot.people.map(person => [person.id, person]));
const departmentMap = new Map(snapshot.departments.map(department => [department.id, department]));

const relationLabels: Record<MatrixRelationKey, string> = {
  ownerIds: '主责',
  collaboratorIds: '协同',
  reviewerIds: '审核',
  informedIds: '知会',
};

const ruleStateLabels: Record<ResponsibilityRuleState, string> = {
  healthy: '运行正常',
  attention: '需要关注',
  overdue: '已超时',
  conflict: '责任冲突',
  unassigned: '负责人缺失',
};

function cloneMatrixItem(item: ResponsibilityMatrixItem): ResponsibilityMatrixItem {
  return {
    ...item,
    ownerIds: [...item.ownerIds],
    collaboratorIds: [...item.collaboratorIds],
    reviewerIds: [...item.reviewerIds],
    informedIds: [...item.informedIds],
    flow: item.flow.map(step => ({ ...step, personIds: [...step.personIds] })),
    changeLog: item.changeLog.map(change => ({ ...change })),
  };
}

function getPerson(personId: string): ResponsibilityPerson {
  return personMap.get(personId) || snapshot.people[0];
}

function personProfileHref(personId: string): string {
  return `/workspace/employees?view=directory&person=${encodeURIComponent(personId)}&detail=collaboration`;
}

function updateMatrixLocation(personId?: string, matterId?: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set('view', 'responsibilities');
  params.delete('tab');
  if (personId) params.set('person', personId);
  else params.delete('person');
  if (matterId) params.set('matter', matterId);
  else params.delete('matter');
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function PersonAvatar({ personId, size = 'normal' }: { personId: string; size?: 'small' | 'normal' }) {
  const person = getPerson(personId);
  return (
    <span className={`rc-person-avatar ${size} ${person.status === 'unconfigured' ? 'unconfigured' : ''}`} aria-hidden="true">
      {person.initials}
    </span>
  );
}

function PersonPills({
  ids,
  relation,
  item,
  limit = 2,
  onEdit,
  onHover,
}: {
  ids: string[];
  relation: MatrixRelationKey;
  item: ResponsibilityMatrixItem;
  limit?: number;
  onEdit: (event: ReactMouseEvent<HTMLElement>, item: ResponsibilityMatrixItem, relation: MatrixRelationKey) => void;
  onHover: (personId: string, rect: DOMRect | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? ids : ids.slice(0, limit);
  const hiddenCount = Math.max(0, ids.length - limit);

  return (
    <span className={`rc-person-pills rc-person-pills-editable ${expanded ? 'expanded' : ''}`}>
      {visible.map(id => {
        const person = getPerson(id);
        return (
          <button
            type="button"
            className={`rc-person-chip ${person.status === 'unconfigured' ? 'unconfigured' : ''}`}
            key={id}
            aria-label={`${person.name}，${person.role}，点击调整${relationLabels[relation]}`}
            onClick={event => onEdit(event, item, relation)}
            onMouseEnter={event => onHover(id, event.currentTarget.getBoundingClientRect())}
            onFocus={event => onHover(id, event.currentTarget.getBoundingClientRect())}
            onBlur={() => onHover('', null)}
          >
            <PersonAvatar personId={id} size="small" />
            <span>{person.name}</span>
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="rc-person-pill-more"
          aria-label={expanded ? '收起完整人员名单' : `展开另外${hiddenCount}人`}
          onClick={event => {
            event.stopPropagation();
            setExpanded(current => !current);
          }}
        >
          {expanded ? '收起' : `+${hiddenCount}`}
        </button>
      )}
      <button
        type="button"
        className={`rc-person-add ${ids.length ? '' : 'empty'}`}
        aria-label={`调整${relationLabels[relation]}人员`}
        onClick={event => onEdit(event, item, relation)}
      >
        {ids.length ? <PencilLine size={12} /> : <><Plus size={12} />待配置</>}
      </button>
    </span>
  );
}

function PersonHoverCard({ state, items, onClose }: { state: HoverState; items: ResponsibilityMatrixItem[]; onClose: () => void }) {
  const person = getPerson(state.personId);
  const owned = items.filter(item => item.ownerIds.includes(person.id)).length;
  const involved = items.filter(item => [
    ...item.ownerIds,
    ...item.collaboratorIds,
    ...item.reviewerIds,
    ...item.informedIds,
  ].includes(person.id)).length;
  const top = Math.min(state.top, window.innerHeight - 208);
  const left = Math.min(state.left, window.innerWidth - 292);

  return createPortal(
    <aside className="rc-person-hover-card" style={{ top, left }} role="status">
      <header><PersonAvatar personId={person.id} /><div><strong>{person.name}</strong><span>{person.role}</span></div><em>{person.status === 'active' ? '在岗' : '待配置'}</em><button type="button" onClick={onClose} aria-label="关闭人员摘要"><X size={13} /></button></header>
      <p>{person.summary}</p>
      <dl>
        <div><dt>所属部门</dt><dd>{departmentMap.get(person.departmentId)?.label}</dd></div>
        <div><dt>当前职责</dt><dd>{owned} 项主责 · {involved} 项参与</dd></div>
      </dl>
      <a href={personProfileHref(person.id)}>打开人员职责档案<ArrowUpRight size={13} /></a>
    </aside>,
    document.body,
  );
}

function ResponsibilityDetail({
  item,
  onClose,
  onEdit,
}: {
  item: ResponsibilityMatrixItem;
  onClose: () => void;
  onEdit: (event: ReactMouseEvent<HTMLElement>, item: ResponsibilityMatrixItem, relation: MatrixRelationKey) => void;
}) {
  const relations: MatrixRelationKey[] = ['ownerIds', 'collaboratorIds', 'reviewerIds', 'informedIds'];
  return (
    <aside className="rc-matrix-detail rc-matrix-detail-config" aria-label={`${item.matter}责任详情`}>
      <header>
        <div><span>{item.module}</span><h2>{item.matter}</h2><p>{item.description}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭责任详情"><X size={16} /></button>
      </header>
      {item.warningText && <div className={`rc-rule-warning ${item.warning || ''}`}><AlertTriangle size={16} /><div><strong>{ruleStateLabels[item.state]}</strong><p>{item.warningText}</p></div></div>}
      <section className="rc-detail-section">
        <div className="rc-section-heading"><div><span>责任配置</span><h3>人员归属与交接关系</h3></div><small>点击人员即可调整</small></div>
        <div className="rc-config-relation-list">
          {relations.map(relation => (
            <article key={relation}>
              <span>{relationLabels[relation]}</span>
              <PersonPills ids={item[relation]} item={item} relation={relation} limit={3} onEdit={onEdit} onHover={() => undefined} />
            </article>
          ))}
        </div>
      </section>
      <section className="rc-detail-section rc-detail-rule-section">
        <div className="rc-section-heading"><div><span>规则条件</span><h3>触发、时限与升级</h3></div></div>
        <div className="rc-detail-rule-grid">
          <article><span>触发条件</span><strong>{item.triggerCondition}</strong></article>
          <article><span>完成时限</span><strong>{item.dueLabel}</strong></article>
          <article className="wide"><span>升级规则</span><strong>{item.escalationRule}</strong></article>
          <article className="wide"><span>关联流程</span><strong>{item.flow.map(step => step.label).join(' → ')}</strong></article>
        </div>
      </section>
      <section className="rc-detail-section rc-change-log">
        <div className="rc-section-heading"><div><span>配置记录</span><h3>最近修改</h3></div><small>{item.changeLog.length} 条</small></div>
        <ol>{item.changeLog.slice(0, 5).map(change => <li key={`${change.at}-${change.actorId}-${change.action}`}><PersonAvatar personId={change.actorId} size="small" /><span><strong>{change.action}</strong><small>{getPerson(change.actorId).name} · {change.at}</small></span></li>)}</ol>
      </section>
      <footer><a href={item.route}>打开来源业务<ArrowUpRight size={14} /></a><span><Info size={13} />仅调整责任归属，不改业务数据</span></footer>
    </aside>
  );
}

function AssignmentEditor({
  state,
  items,
  onClose,
  onApply,
}: {
  state: EditorState;
  items: ResponsibilityMatrixItem[];
  onClose: () => void;
  onApply: (itemId: string, relation: MatrixRelationKey, selectedIds: string[], reason: string) => void;
}) {
  const item = items.find(entry => entry.id === state.itemId) || items[0];
  const [relation, setRelation] = useState(state.relation);
  const [selectedIds, setSelectedIds] = useState(state.selectedIds);
  const [keyword, setKeyword] = useState('');
  const [department, setDepartment] = useState('all');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');

  useEffect(() => {
    setRelation(state.relation);
    setSelectedIds([...item[state.relation]]);
    setKeyword('');
    setDepartment('all');
    setReason('');
    setValidation('');
  }, [item, state.relation]);

  const candidates = snapshot.people.filter(person => {
    const search = keyword.trim().toLowerCase();
    const matchesSearch = !search || `${person.name} ${person.role} ${person.summary}`.toLowerCase().includes(search);
    return matchesSearch && (department === 'all' || person.departmentId === department);
  });

  function changeRelation(next: MatrixRelationKey): void {
    setRelation(next);
    setSelectedIds([...item[next]]);
    setValidation('');
  }

  function blockedReason(person: ResponsibilityPerson): string {
    if (person.status === 'unconfigured') return '该岗位尚未配置正式人员';
    if (item.id === 'sales-demand-intake' && person.id === 'li-qin' && (relation === 'ownerIds' || relation === 'reviewerIds')) {
      return relation === 'ownerIds' ? '销售助理不能成为正式销售事项最终主责' : '销售助理不能成为正式销售事项最终审核人';
    }
    return '';
  }

  function togglePerson(person: ResponsibilityPerson): void {
    const blocked = blockedReason(person);
    if (blocked) {
      setValidation(blocked);
      return;
    }
    setValidation('');
    if (relation === 'ownerIds') {
      setSelectedIds(selectedIds[0] === person.id ? [] : [person.id]);
      return;
    }
    setSelectedIds(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id]);
  }

  function submit(): void {
    if (!reason.trim()) {
      setValidation('请填写本次责任归属调整原因');
      return;
    }
    onApply(item.id, relation, selectedIds, reason.trim());
  }

  const top = Math.min(state.anchor.top, window.innerHeight - 610);
  const left = Math.min(state.anchor.left, window.innerWidth - 520);
  const before = item[relation];
  const changed = before.join('|') !== selectedIds.join('|');

  return createPortal(
    <>
      <button type="button" className="rc-assignment-backdrop" aria-label="关闭人员配置" onClick={onClose} />
      <section className="rc-assignment-editor" style={{ top: Math.max(12, top), left: Math.max(12, left) }} aria-label={`${item.matter}人员配置`}>
        <header>
          <div><span>责任归属调整</span><h2>{item.matter}</h2><p>悬浮式配置 · 不离开当前责任矩阵</p></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>
        <nav aria-label="责任关系">
          {(Object.keys(relationLabels) as MatrixRelationKey[]).map(key => (
            <button type="button" className={relation === key ? 'active' : ''} key={key} onClick={() => changeRelation(key)}>
              {relationLabels[key]}<b>{item[key].length}</b>
            </button>
          ))}
        </nav>
        <div className="rc-assignment-current">
          <span>当前选择</span>
          <div>{selectedIds.length ? selectedIds.map(id => <button type="button" key={id} onClick={() => setSelectedIds(current => current.filter(value => value !== id))}><PersonAvatar personId={id} size="small" />{getPerson(id).name}<X size={11} /></button>) : <em>尚未配置{relationLabels[relation]}</em>}</div>
        </div>
        <div className="rc-assignment-filters">
          <label><Search size={14} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索姓名或岗位" /></label>
          <select value={department} onChange={event => setDepartment(event.target.value)} aria-label="按部门筛选">
            <option value="all">全部部门</option>
            {snapshot.departments.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </div>
        <div className="rc-assignment-people hm-scroll-region">
          {candidates.map(person => {
            const blocked = blockedReason(person);
            const selected = selectedIds.includes(person.id);
            return (
              <button type="button" className={`${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`} key={person.id} onClick={() => togglePerson(person)} title={blocked}>
                <PersonAvatar personId={person.id} />
                <span><strong>{person.name}</strong><small>{person.role} · {departmentMap.get(person.departmentId)?.shortLabel}</small></span>
                {blocked ? <em>不可选</em> : selected ? <Check size={15} /> : <Plus size={14} />}
              </button>
            );
          })}
        </div>
        {item.id === 'sales-demand-intake' && <div className="rc-assignment-policy"><ShieldCheck size={14} /><span><strong>销售决策保护</strong>李琴可承担资料与沟通协同，但不能替代正式销售主责或最终审核人。</span></div>}
        <label className="rc-assignment-reason"><span>调整原因（必填）</span><input value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：本周岗位分工调整，由新负责人承接" /></label>
        <div className="rc-assignment-impact">
          <Info size={14} /><span><strong>影响预览</strong>仅更新当前事项的{relationLabels[relation]}归属；业务单据、流程状态和历史记录不变。</span>
        </div>
        {validation && <p className="rc-assignment-validation"><AlertCircle size={13} />{validation}</p>}
        <footer>
          <span>前端配置预览，刷新后恢复原型数据</span>
          <div><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={!changed} onClick={submit}><Save size={14} />应用调整</button></div>
        </footer>
      </section>
    </>,
    document.body,
  );
}

export function ResponsibilityMatrixWorkspace({ user }: { user: CurrentUserDTO }) {
  const [items, setItems] = useState<ResponsibilityMatrixItem[]>(() => snapshot.matrix.map(cloneMatrixItem));
  const [keyword, setKeyword] = useState('');
  const [department, setDepartment] = useState('all');
  const [person, setPerson] = useState('all');
  const [module, setModule] = useState('all');
  const [ruleStatus, setRuleStatus] = useState<MatrixStatusFilter>('all');
  const [risk, setRisk] = useState<MatrixRiskFilter>('all');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPerson = params.get('person');
    const requestedMatter = params.get('matter');
    if (requestedPerson && personMap.has(requestedPerson)) setPerson(requestedPerson);
    if (requestedMatter && items.some(item => item.id === requestedMatter)) setSelectedId(requestedMatter);
  }, [items]);

  const modules = useMemo(() => Array.from(new Set(items.map(item => item.module))), [items]);
  const filtered = useMemo(() => items.filter(item => {
    const search = keyword.trim().toLowerCase();
    const people = [...item.ownerIds, ...item.collaboratorIds, ...item.reviewerIds, ...item.informedIds];
    const matchesKeyword = !search || [item.matter, item.description, item.module, item.roleKeyword, ...people.map(id => `${getPerson(id).name} ${getPerson(id).role}`)]
      .some(value => value.toLowerCase().includes(search));
    return matchesKeyword
      && (department === 'all' || item.departmentId === department)
      && (person === 'all' || people.includes(person))
      && (module === 'all' || item.module === module)
      && (ruleStatus === 'all' || item.state === ruleStatus)
      && (risk === 'all' || item.warning === risk);
  }), [department, items, keyword, module, person, risk, ruleStatus]);
  const selected = items.find(item => item.id === selectedId) || null;
  const warningCounts = {
    'missing-owner': items.filter(item => item.warning === 'missing-owner').length,
    'responsibility-conflict': items.filter(item => item.warning === 'responsibility-conflict').length,
    overdue: items.filter(item => item.warning === 'overdue').length,
  };
  const healthyCount = items.filter(item => item.state === 'healthy').length;
  const configuredPeople = snapshot.people.filter(entry => entry.status === 'active').length;
  const health = Math.round(((healthyCount + configuredPeople) / (items.length + snapshot.people.length)) * 100);
  const actor = snapshot.people.find(entry => entry.name === user.employee?.name || entry.name === user.displayName) || getPerson('pan-dan-dan');

  function selectItem(item: ResponsibilityMatrixItem): void {
    setSelectedId(item.id);
    updateMatrixLocation(person === 'all' ? undefined : person, item.id);
  }

  function openEditor(event: ReactMouseEvent<HTMLElement>, item: ResponsibilityMatrixItem, relation: MatrixRelationKey): void {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setHover(null);
    setEditor({
      itemId: item.id,
      relation,
      selectedIds: [...item[relation]],
      anchor: { top: rect.bottom + 8, left: Math.max(12, rect.left - 180) },
    });
  }

  function applyAssignment(itemId: string, relation: MatrixRelationKey, selectedIds: string[], reason: string): void {
    setItems(current => current.map(item => {
      if (item.id !== itemId) return item;
      const next: ResponsibilityMatrixItem = { ...item, [relation]: selectedIds };
      if (!next.ownerIds.length) {
        next.state = 'unassigned';
        next.warning = 'missing-owner';
        next.warningText = next.ownerPlaceholder || '该事项尚未配置正式主责人。';
      } else if (next.ownerIds.length > 1) {
        next.state = 'conflict';
        next.warning = 'responsibility-conflict';
        next.warningText = '同一事项存在多个主责，请保留一位最终负责人。';
      } else if (item.warning === 'missing-owner' || item.warning === 'responsibility-conflict') {
        next.state = 'healthy';
        next.warning = undefined;
        next.warningText = undefined;
      }
      next.changeLog = [{
        at: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
        actorId: actor.id,
        action: `调整${relationLabels[relation]}：${reason}`,
      }, ...item.changeLog];
      return next;
    }));
    setEditor(null);
    setToast(`已更新${relationLabels[relation]}归属（前端预览）`);
    window.setTimeout(() => setToast(''), 2600);
  }

  function previewAction(action: string, item: ResponsibilityMatrixItem): void {
    setToast(`${item.matter} · ${action}（配置预览）`);
    window.setTimeout(() => setToast(''), 2400);
  }

  function setPersonHover(personId: string, rect: DOMRect | null): void {
    if (!personId || !rect) {
      setHover(null);
      return;
    }
    setHover({ personId, top: rect.bottom + 8, left: rect.left });
  }

  return (
    <div className="rc-responsibility-workspace">
      <section className="rc-health-bar rc-embedded-health" aria-label="职责配置健康状态">
        <div className="rc-health-status"><span><CheckCircle2 size={15} /></span><strong>职责健康 {health}%</strong><small>人员与规则配置总览</small></div>
        <dl>
          <div><dt>人员</dt><dd>{snapshot.people.length}</dd><small>{configuredPeople} 在岗</small></div>
          <div><dt>责任事项</dt><dd>{items.length}</dd><small>{healthyCount} 运行正常</small></div>
          <div><dt>本次调整</dt><dd>{items.reduce((total, item, index) => total + Math.max(0, item.changeLog.length - snapshot.matrix[index].changeLog.length), 0)}</dd><small>当前会话预览</small></div>
        </dl>
        <button type="button" onClick={() => {
          const riskItem = items.find(item => item.warning);
          setRisk('all');
          if (riskItem) selectItem(riskItem);
        }}><AlertTriangle size={14} /><span><strong>{items.filter(item => item.warning).length} 项异常</strong><small>查看缺失、冲突与超时升级</small></span><ChevronRight size={14} /></button>
      </section>

      <section className="rc-matrix-toolbar" aria-label="责任矩阵筛选和异常入口">
        <div className="rc-filter-bar">
          <label className="rc-search-field"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索事项、岗位或人员" />{keyword && <button type="button" onClick={() => setKeyword('')} aria-label="清空搜索"><X size={13} /></button>}</label>
          <label><span>部门</span><select value={department} onChange={event => setDepartment(event.target.value)}><option value="all">全部部门</option>{snapshot.departments.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
          <label><span>人员</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">全部人员</option>{snapshot.people.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          <label><span>业务模块</span><select value={module} onChange={event => setModule(event.target.value)}><option value="all">全部模块</option>{modules.map(entry => <option value={entry} key={entry}>{entry}</option>)}</select></label>
          <label><span>状态</span><select value={ruleStatus} onChange={event => setRuleStatus(event.target.value as MatrixStatusFilter)}><option value="all">全部状态</option>{Object.entries(ruleStateLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button type="button" className="rc-clear-filter" onClick={() => { setKeyword(''); setDepartment('all'); setPerson('all'); setModule('all'); setRuleStatus('all'); setRisk('all'); }}><Filter size={14} />重置</button>
        </div>
        <div className="rc-exception-tags">
          <span>异常入口</span>
          <button type="button" className={risk === 'missing-owner' ? 'active missing' : 'missing'} onClick={() => setRisk(current => current === 'missing-owner' ? 'all' : 'missing-owner')}><UserCheck size={13} />责任缺失<b>{warningCounts['missing-owner']}</b></button>
          <button type="button" className={risk === 'responsibility-conflict' ? 'active conflict' : 'conflict'} onClick={() => setRisk(current => current === 'responsibility-conflict' ? 'all' : 'responsibility-conflict')}><GitBranch size={13} />责任冲突<b>{warningCounts['responsibility-conflict']}</b></button>
          <button type="button" className={risk === 'overdue' ? 'active overdue' : 'overdue'} onClick={() => setRisk(current => current === 'overdue' ? 'all' : 'overdue')}><Clock3 size={13} />超时升级<b>{warningCounts.overdue}</b></button>
        </div>
      </section>

      <div className={`rc-matrix-workspace ${selected ? 'has-detail' : ''}`}>
        <section className="rc-matrix-table-panel">
          <header><div><span>规则管理工作台</span><h2>业务事项责任矩阵</h2></div><small>{filtered.length} / {items.length} 项</small></header>
          <div className="rc-matrix-table-scroll hm-scroll-region" tabIndex={0}>
            <table className="rc-matrix-table">
              <thead><tr><th>业务事项</th><th>主责</th><th>协同</th><th>审核</th><th>知会</th><th>时限</th><th>状态 / 操作</th></tr></thead>
              <tbody>{filtered.map(item => (
                <tr className={`${selected?.id === item.id ? 'selected' : ''} state-${item.state}`} key={item.id} tabIndex={0} onClick={() => selectItem(item)} onKeyDown={event => { if (event.key === 'Enter') selectItem(item); }}>
                  <td><span className="rc-matter-meta">{item.module}{item.warning && <em className={`warning-${item.warning}`}>{ruleStateLabels[item.state]}</em>}</span><strong>{item.matter}</strong><small>{item.description}</small></td>
                  <td><PersonPills ids={item.ownerIds} item={item} relation="ownerIds" onEdit={openEditor} onHover={setPersonHover} /></td>
                  <td><PersonPills ids={item.collaboratorIds} item={item} relation="collaboratorIds" onEdit={openEditor} onHover={setPersonHover} /></td>
                  <td><PersonPills ids={item.reviewerIds} item={item} relation="reviewerIds" onEdit={openEditor} onHover={setPersonHover} /></td>
                  <td><PersonPills ids={item.informedIds} item={item} relation="informedIds" limit={1} onEdit={openEditor} onHover={setPersonHover} /></td>
                  <td><strong className="rc-due-label">{item.dueLabel}</strong></td>
                  <td className="rc-state-action-cell">
                    <button type="button" className={`rc-state-pill ${item.state}`} onClick={event => { event.stopPropagation(); selectItem(item); }}>{item.warning && <AlertCircle size={11} />}{ruleStateLabels[item.state]}</button>
                    <div className="rc-row-actions">
                      <button type="button" title="查看责任链" onClick={event => { event.stopPropagation(); selectItem(item); }}><GitBranch size={13} /></button>
                      <button type="button" title="编辑人员归属" onClick={event => openEditor(event, item, 'ownerIds')}><PencilLine size={13} /></button>
                      <button type="button" title="复制责任规则" onClick={event => { event.stopPropagation(); previewAction('已复制规则草稿', item); }}><Copy size={13} /></button>
                      <button type="button" title="停用责任规则" onClick={event => { event.stopPropagation(); previewAction('已进入停用确认', item); }}><CirclePause size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!filtered.length && <div className="rc-empty-result"><Search size={22} /><strong>没有匹配的责任规则</strong><span>调整筛选条件后重试</span></div>}
          </div>
        </section>
        {selected && <ResponsibilityDetail item={selected} onClose={() => { setSelectedId(''); updateMatrixLocation(person === 'all' ? undefined : person); }} onEdit={openEditor} />}
      </div>

      {hover && !editor && <PersonHoverCard state={hover} items={items} onClose={() => setHover(null)} />}
      {editor && <AssignmentEditor state={editor} items={items} onClose={() => setEditor(null)} onApply={applyAssignment} />}
      {toast && <div className="rc-action-toast" role="status"><CheckCircle2 size={15} />{toast}</div>}
    </div>
  );
}
