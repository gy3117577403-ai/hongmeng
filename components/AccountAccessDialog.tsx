'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Boxes, Check, ChevronRight, Eye, Factory, FolderOpen, GitBranch, KeyRound, Loader2, Monitor, Plus, QrCode, RefreshCw, Search, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import type { CurrentUserDTO, EmployeeDTO, UserDTO } from '@/types';
import { BUSINESS_ACCESS_MODULES, type BusinessAccessModule, type ModulePermissions } from '@/lib/module-permissions';
import { isGlobalAccountManager } from '@/lib/employee-account-access';
import { useModalLayer } from './useModalLayer';

const profileLabels: Record<string, string> = { DEPARTMENT_FULL: '部门工作台', PROCESS_SPECIALIST: '工艺专员', DRAWING_LIBRARY_READER: '图纸只读', DRAWING_LIBRARY_EDITOR: '图纸编辑', PRODUCT_TIME_READER: '工时只读', REPORT_PEOPLE_READER: '人员效率报表', QUALITY_REVIEWER: '质量审核', QUALITY_DATA_OPERATOR: '质量填报', FIELD_REPORTER: '扫码报工', WORKSHOP_SUPERVISOR: '车间主管', WORKSHOP_TEAM_LEADER: '车间组长', PLANNING_COLLABORATOR: '计划协同', PRODUCTION_COLLABORATOR: '生产只读', MATERIAL_FOLLOW_UP_OPERATOR: '物料跟进', TRAINING_COLLABORATOR: '培训协同', GM_OFFICE_READER_APPROVER: '总经办', FINANCE_ACCOUNT_ONLY: '财务账号', ADMIN_GLOBAL: '系统管理员', MODULE_ACCESS: '模块授权' };
const moduleIcons = { production: Factory, quality: ShieldCheck, materials: Boxes, technology: FolderOpen, people: UsersRound, collaboration: GitBranch, reports: BarChart3 };
type Draft = { id: string; employeeId: string; username: string; displayName: string; accountStatus: string; permissions: ModulePermissions; workbench: boolean; field: boolean; password: string; expectedUpdatedAt: string; adopt: boolean };
const emptyDraft = (): Draft => ({ id: '', employeeId: '', username: '', displayName: '', accountStatus: 'ACTIVE', permissions: {}, workbench: true, field: false, password: '', expectedUpdatedAt: '', adopt: true });
function accountDraft(account: UserDTO): Draft { return { id: account.id, employeeId: account.employeeId || '', username: account.username, displayName: account.displayName, accountStatus: account.accountStatus || (account.isActive ? 'ACTIVE' : 'DISABLED'), permissions: account.moduleAccess?.permissions || {}, workbench: account.moduleAccess?.workbenchEnabled ?? account.accessMethods?.workbench !== false, field: Boolean(account.accessMethods?.fieldReport), password: '', expectedUpdatedAt: account.updatedAt, adopt: Boolean(account.moduleAccess) }; }
function statusName(value?: string | null) { return ({ ACTIVE: '正常', DISABLED: '已停用', SUSPENDED: '已暂停', PENDING: '待开通' } as Record<string, string>)[value || 'ACTIVE'] || value; }
function time(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未登录'; }

export default function AccountAccessDialog({ user, initialEmployeeId, onClose }: { user: CurrentUserDTO; initialEmployeeId?: string; onClose: () => void }) {
  const canAuthorize = isGlobalAccountManager(user);
  const [accounts, setAccounts] = useState<UserDTO[]>([]);
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [department, setDepartment] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [tab, setTab] = useState<'basic' | 'modules' | 'security'>('modules');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const discardRef = useRef<HTMLElement>(null);
  const exitRef = useRef<() => void>(() => {});
  const backRef = useRef<() => void>(() => {});
  const closingRef = useRef(false);
  const loadOnceRef = useRef(false);
  const historyStartedRef = useRef(false);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const selected = accounts.find(account => account.id === draft?.id);
  const protectedAccount = Boolean(selected && (selected.id === user.id || selected.laborRole === 'ADMIN' || selected.accessGrants?.some(grant => grant.profileKey === 'ADMIN_GLOBAL')));
  const effectiveEdit = canAuthorize && !protectedAccount;
  const selectDraft = (next: Draft, nextTab: typeof tab = 'modules') => { setDraft(next); setBaseline(JSON.stringify(next)); setTab(nextTab); setError(''); setMessage(''); };
  const requestExit = (action: () => void) => { if (busy) return; if (dirty) setDiscard(() => action); else action(); };
  const closeEditor = () => requestExit(() => { setDraft(null); setBaseline(''); setError(''); });
  const closeAll = () => requestExit(() => { closingRef.current = true; if (window.history.state?.accountAccessLayer) window.history.back(); else onClose(); });
  exitRef.current = onClose;
  backRef.current = () => { if (closingRef.current) { onClose(); return; } if (draft) { window.history.pushState({ ...window.history.state, accountAccessLayer: true }, '', window.location.href); closeEditor(); } else if (dirty) { window.history.pushState({ ...window.history.state, accountAccessLayer: true }, '', window.location.href); closeAll(); } else onClose(); };
  useEffect(() => {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!historyStartedRef.current) { window.history.pushState({ ...window.history.state, accountAccessLayer: true }, '', window.location.href); historyStartedRef.current = true; }
    const pop = () => backRef.current();
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); requestAnimationFrame(() => focus?.focus()); };
  }, []);
  useModalLayer({ open: true, layerRef: dialogRef, onClose: draft ? closeEditor : closeAll, interactionEnabled: !discard });
  useModalLayer({ open: Boolean(discard), layerRef: discardRef, onClose: () => setDiscard(null) });
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all([fetch('/api/users', { cache: 'no-store' }), fetch('/api/employees', { cache: 'no-store' })]);
      const [body, people] = await Promise.all(responses.map(response => response.json()));
      if (!responses[0].ok || !body.ok) throw new Error(body.error || '账号加载失败');
      if (!responses[1].ok || !people.ok) throw new Error(people.error || '员工加载失败');
      setAccounts(body.users || []); setEmployees(people.employees || []);
      if (!loadOnceRef.current && initialEmployeeId) {
        const account = (body.users as UserDTO[]).find(item => item.employeeId === initialEmployeeId);
        const employee = (people.employees as EmployeeDTO[]).find(item => item.id === initialEmployeeId);
        if (account) selectDraft(accountDraft(account));
        else if (employee) selectDraft({ ...emptyDraft(), employeeId: employee.id, username: employee.employeeNo, displayName: employee.name }, 'basic');
      }
      loadOnceRef.current = true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : '加载失败'); }
    finally { setLoading(false); }
  }, [initialEmployeeId]);
  useEffect(() => { void load(); }, [load]);
  const patch = (change: Partial<Draft>) => setDraft(current => current ? { ...current, ...change } : current);
  const updatePermission = (key: BusinessAccessModule, level?: 'READ' | 'COLLABORATE') => { if (!draft) return; const permissions = { ...draft.permissions }; if (level) permissions[key] = level; else delete permissions[key]; patch({ permissions, adopt: true, workbench: true }); };
  const save = async () => {
    if (!draft || busy || protectedAccount) return;
    setBusy(true); setError(''); setMessage('');
    try {
      let response: Response;
      if (effectiveEdit && draft.adopt) {
        response = await fetch('/api/users/module-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, modulePermissions: draft.permissions, workbenchEnabled: draft.workbench, fieldReportEnabled: draft.field }) });
      } else if (draft.id) {
        response = await fetch(`/api/users/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: draft.displayName, accountStatus: draft.accountStatus }) });
      } else {
        response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: draft.employeeId, username: draft.username, displayName: draft.displayName, password: draft.password, mustChangePassword: true }) });
      }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || '保存失败');
      if (draft.id && draft.password && !(effectiveEdit && draft.adopt)) {
        const reset = await fetch(`/api/users/${draft.id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: draft.password }) });
        const result = await reset.json(); if (!reset.ok || !result.ok) throw new Error(`基本信息已保存；密码未更新：${result.error || '请重试'}`);
      }
      const latest = await fetch('/api/users', { cache: 'no-store' }); const data = await latest.json();
      if (!latest.ok || !data.ok) throw new Error('保存成功，但账号列表刷新失败，请刷新核对');
      const next = (data.users as UserDTO[]).find(account => account.id === (body.user?.id || draft.id) || account.employeeId === draft.employeeId);
      setAccounts(data.users); if (next) selectDraft(accountDraft(next), tab);
      setMessage('配置已保存，列表已更新；该账号旧登录已按变更规则失效。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const departments = Array.from(new Set(accounts.map(account => account.employee?.department).filter(Boolean))) as string[];
  const visible = accounts.filter(account => {
    const text = `${account.displayName} ${account.username} ${account.employee?.name || ''} ${account.employee?.department || ''}`.toLocaleLowerCase();
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase())) && (!department || account.employee?.department === department)
      && (!moduleFilter || Boolean(account.moduleAccess?.permissions[moduleFilter as BusinessAccessModule]))
      && (filter === 'all' || filter === 'active' && account.accountStatus === 'ACTIVE' || filter === 'disabled' && account.accountStatus !== 'ACTIVE' || filter === 'field' && account.accessMethods?.fieldReport || filter === 'legacy' && !account.moduleAccess && account.laborRole !== 'ADMIN');
  });
  const chosen = Object.values(draft?.permissions || {});
  const original = selected?.moduleAccess?.permissions || {};
  const changedCount = BUSINESS_ACCESS_MODULES.filter(module => original[module.key] !== draft?.permissions[module.key]).length;
  return <div className="aa-backdrop">
    <section ref={dialogRef} className="aa-dialog" role="dialog" aria-modal="true" aria-label="账号与访问管理" tabIndex={-1}>
      <header className="aa-header"><div className="aa-title-icon"><UsersRound size={25} /></div><div><h1>账号与访问管理</h1><p>按模块开通权限，后台与扫码独立配置</p></div><button className="aa-icon" aria-label="关闭账号管理" disabled={busy} onClick={closeAll}><X /></button></header>
      <div className="aa-summary"><span>账号 <b>{accounts.length}</b></span><button aria-pressed={filter === 'active'} onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}><i />正常 <b>{accounts.filter(account => account.accountStatus === 'ACTIVE').length}</b></button><button aria-pressed={filter === 'disabled'} onClick={() => setFilter(filter === 'disabled' ? 'all' : 'disabled')}>暂停 / 停用 <b>{accounts.filter(account => account.accountStatus !== 'ACTIVE').length}</b></button><button aria-pressed={filter === 'legacy'} onClick={() => setFilter(filter === 'legacy' ? 'all' : 'legacy')}>旧权限待整理 <b>{accounts.filter(account => !account.moduleAccess && account.laborRole !== 'ADMIN').length}</b></button><span className="aa-summary-note"><ShieldCheck size={15} />管理员保留全部权限</span></div>
      <div className="aa-toolbar"><label className="aa-search"><Search size={18} /><input aria-label="搜索员工账号" placeholder="姓名、工号或部门" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="按部门筛选账号" value={department} onChange={event => setDepartment(event.target.value)}><option value="">全部部门</option>{departments.map(name => <option key={name}>{name}</option>)}</select><select aria-label="按授权模块筛选" value={moduleFilter} onChange={event => setModuleFilter(event.target.value)}><option value="">全部模块</option>{BUSINESS_ACCESS_MODULES.map(module => <option key={module.key} value={module.key}>{module.label}</option>)}</select><button className="aa-icon" aria-label="刷新账号" disabled={loading || busy} onClick={() => requestExit(() => { setDraft(null); void load(); })}><RefreshCw size={18} /></button><button className="aa-primary" disabled={loading || busy} onClick={() => requestExit(() => selectDraft(emptyDraft(), 'basic'))}><Plus size={18} />开通账号</button></div>
      {error && <div role="alert" className="aa-feedback aa-error">{error}</div>}{message && <div role="status" className="aa-feedback aa-success"><Check size={16} />{message}</div>}
      <div className={`aa-workspace ${draft ? 'is-editing' : ''}`}>
        <section className="aa-list" aria-label="员工账号列表"><header><strong>员工账号</strong><span>显示 {visible.length} / {accounts.length}</span><button onClick={() => setFilter(filter === 'field' ? 'all' : 'field')} aria-pressed={filter === 'field'}><QrCode size={14} />扫码账号</button></header><div className="aa-list-scroll" aria-busy={loading}>
          {loading ? <div className="aa-empty"><Loader2 className="aa-spin" /><p>正在加载账号</p></div> : visible.map(account => {
            const entries = Object.entries(account.moduleAccess?.permissions || {}); const isAdmin = account.laborRole === 'ADMIN';
            return <button key={account.id} type="button" className={`aa-account ${draft?.id === account.id ? 'selected' : ''}`} disabled={busy} onClick={() => requestExit(() => selectDraft(accountDraft(account)))}><span className="aa-avatar">{(account.employee?.name || account.displayName).slice(0, 1)}</span><span className="aa-account-main"><span className="aa-account-name"><strong>{account.employee?.name || account.displayName}</strong><em className={account.accountStatus === 'ACTIVE' ? 'active' : 'inactive'}>{statusName(account.accountStatus)}</em></span><small>{account.username} · {account.employee?.department || '未设置部门'}</small><span className="aa-tags">{isAdmin ? <span className="collab">全部模块 · 管理员</span> : account.moduleAccess ? <><span className="collab">协同 {entries.filter(([, level]) => level === 'COLLABORATE').length} 项</span><span className="read">只读 {entries.filter(([, level]) => level === 'READ').length} 项</span></> : <span className="legacy">旧权限 · 保持生效</span>}{account.accessMethods?.fieldReport && <span><QrCode size={12} />扫码</span>}</span><small>最近登录 {time(account.lastLoginAt)}</small></span><ChevronRight size={17} /></button>;
          })}{!loading && !visible.length && <div className="aa-empty"><Search /><p>没有符合筛选的账号</p><button onClick={() => { setQuery(''); setDepartment(''); setModuleFilter(''); setFilter('all'); }}>清除筛选</button></div>}
        </div></section>
        <section className="aa-editor" aria-label="账号配置">{!draft ? <div className="aa-welcome"><div><ShieldCheck size={38} /></div><h2>让每个人拥有恰当的操作权限</h2><p>选择左侧员工，查看后台模块与扫码入口。<br />只读用于查看，协同用于处理业务。</p><div className="aa-welcome-modules">{BUSINESS_ACCESS_MODULES.map(module => { const Icon = moduleIcons[module.key]; return <span key={module.key}><Icon size={18} />{module.label}</span>; })}</div></div> : <>
          <header className="aa-editor-header"><span className="aa-avatar"><UserRound size={23} /></span><div><h2>{draft.id ? draft.displayName : '开通员工账号'}</h2><p>{draft.id ? `${draft.username} · ${selected?.employee?.department || '部门未设置'}` : '绑定员工，设置访问范围'}</p></div><button className="aa-icon" aria-label="关闭员工编辑" onClick={closeEditor} disabled={busy}><X size={19} /></button></header>
          <nav className="aa-tabs" aria-label="账号设置页签">{([['basic', '基本信息'], ['modules', '模块权限'], ['security', '登录与安全']] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} aria-selected={tab === key} role="tab">{label}</button>)}</nav>
          <div className="aa-editor-scroll">
            {protectedAccount && <div className="aa-notice">{selected?.id === user.id ? '当前登录账号：自身权限由另一位管理员维护。' : '系统管理员保留全部权限和既有身份，此处只读展示。'}</div>}
            {tab === 'basic' && <div className="aa-form"><label>绑定员工<select aria-label="绑定员工" value={draft.employeeId} disabled={Boolean(draft.id)} onChange={event => { const employee = employees.find(item => item.id === event.target.value); patch({ employeeId: event.target.value, username: employee?.employeeNo || '', displayName: employee?.name || '' }); }}><option value="">请选择员工</option>{employees.filter(employee => employee.id === draft.employeeId || employee.isActive && !accounts.some(account => account.employeeId === employee.id)).map(employee => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.name} · {employee.department || '部门未设置'}</option>)}</select></label><label>登录账号<input value={draft.username} disabled={Boolean(draft.id)} onChange={event => patch({ username: event.target.value })} /></label><label>显示姓名<input value={draft.displayName} disabled={protectedAccount} onChange={event => patch({ displayName: event.target.value })} /></label><label>账号状态<select value={draft.accountStatus} disabled={protectedAccount} onChange={event => patch({ accountStatus: event.target.value })}><option value="ACTIVE">正常</option><option value="SUSPENDED">暂停</option><option value="DISABLED">停用</option></select></label><div className="aa-notice">所属部门跟随员工档案；调整部门不会自动改变模块权限。</div></div>}
            {tab === 'modules' && <>
              {!draft.adopt && !protectedAccount && <div className="aa-notice legacy"><strong>旧权限正在生效</strong><p>本次不修改权限时继续沿用原方案。选择模块后，保存将替换旧业务授权及兼岗授权。</p><div className="aa-legacy-grants">{selected?.accessGrants?.filter(grant => grant.isActive).map(grant => <span key={grant.id}>{profileLabels[grant.profileKey] || '原业务授权'}{grant.department?.name ? ` · ${grant.department.name}` : ''}</span>)}</div>{effectiveEdit && <button onClick={() => patch({ adopt: true })}>改用模块授权 <ChevronRight size={14} /></button>}</div>}
              {!canAuthorize && <div className="aa-notice">你可以维护普通账号状态及密码；模块授权由管理员配置。</div>}
              <div className="aa-module-heading"><div><h3>开通业务模块</h3><p>已选 {chosen.length} 项 · 协同 {chosen.filter(level => level === 'COLLABORATE').length} · 只读 {chosen.filter(level => level === 'READ').length}</p></div><select aria-label="复制员工模块权限" disabled={!effectiveEdit} value="" onChange={event => { const source = accounts.find(account => account.id === event.target.value); if (source?.moduleAccess) patch({ permissions: { ...source.moduleAccess.permissions }, workbench: true, adopt: true }); }}><option value="">复制已有配置</option>{accounts.filter(account => account.moduleAccess && account.id !== draft.id).map(account => <option value={account.id} key={account.id}>{account.displayName} · {account.username}</option>)}</select></div>
              <div className="aa-bulk"><button disabled={!effectiveEdit || !chosen.length} onClick={() => patch({ adopt: true, permissions: Object.fromEntries(Object.keys(draft.permissions).map(key => [key, 'READ'])) })}>所选设为只读</button><button disabled={!effectiveEdit || !chosen.length} onClick={() => patch({ adopt: true, permissions: Object.fromEntries(Object.keys(draft.permissions).map(key => [key, 'COLLABORATE'])) })}>所选设为协同</button><span>未勾选的模块不开放</span></div>
              <div className="aa-module-list">{BUSINESS_ACCESS_MODULES.map(module => { const level = draft.permissions[module.key]; const Icon = moduleIcons[module.key]; return <article className={`aa-module ${level ? level.toLowerCase() : ''}`} key={module.key}><label><input type="checkbox" aria-label={`开通${module.label}`} checked={Boolean(level)} disabled={!effectiveEdit} onChange={event => updatePermission(module.key, event.target.checked ? 'READ' : undefined)} /><span className="aa-module-icon"><Icon size={20} /></span><span><strong>{module.label}</strong><small>{module.description}</small></span></label><div className="aa-level" aria-label={`${module.label}权限`}><button type="button" disabled={!effectiveEdit || !level} aria-pressed={level === 'READ'} onClick={() => updatePermission(module.key, 'READ')}><Eye size={14} />只读</button><button type="button" disabled={!effectiveEdit || !level} aria-pressed={level === 'COLLABORATE'} onClick={() => updatePermission(module.key, 'COLLABORATE')}><Check size={14} />协同</button></div></article>; })}</div>
              <p className="aa-module-help"><Eye size={15} />只读可查询、预览与导出；协同可维护、上传及处理模块业务。审核流程仍按原规则执行。</p>
              <p className="aa-module-help"><ShieldCheck size={15} />账号授权、系统管理员身份和系统配置不随业务模块自动开放。</p>
            </>}
            {tab === 'security' && <div className="aa-form"><h3>访问方式</h3><label className="aa-entry"><input type="checkbox" checked={draft.workbench} disabled={!effectiveEdit} onChange={event => patch({ workbench: event.target.checked, permissions: event.target.checked ? draft.permissions : {}, adopt: true })} /><Monitor /><span><strong>后台工作台</strong><small>使用已选择的业务模块</small></span></label><label className="aa-entry"><input type="checkbox" checked={draft.field} disabled={!effectiveEdit} onChange={event => patch({ field: event.target.checked, adopt: true })} /><QrCode /><span><strong>扫码报工</strong><small>生产岗位实名报工，与后台入口独立</small></span></label><label><span><KeyRound size={15} />{draft.id ? '重置登录密码' : '初始登录密码'}</span><input type="password" autoComplete="new-password" placeholder={draft.id ? '留空保持现有密码' : '设置首次登录密码'} value={draft.password} disabled={protectedAccount} onChange={event => patch({ password: event.target.value })} /></label><div className="aa-notice">新设密码后首次登录需要修改；停用账号或更新访问权限会使旧登录失效。</div>{selected && <p className="aa-module-help">最近更新 {time(selected.updatedAt)} · 最近登录 {time(selected.lastLoginAt)}</p>}</div>}
          </div>
          <footer className="aa-editor-footer"><span>{dirty ? draft.adopt && changedCount ? `待保存 · ${changedCount} 项模块变化` : '有未保存修改' : '配置已同步'}{!draft.id && <small>请在登录与安全中设置初始密码</small>}</span><button onClick={closeEditor} disabled={busy}>取消</button><button className="aa-primary" disabled={busy || protectedAccount || !dirty && Boolean(draft.id)} onClick={() => void save()}>{busy ? <Loader2 className="aa-spin" size={17} /> : <Check size={17} />}{busy ? '保存中' : '保存配置'}</button></footer>
        </>}</section>
      </div>
    </section>
    {discard && <div className="aa-discard-backdrop"><section ref={discardRef} className="aa-discard" role="alertdialog" aria-modal="true" aria-label="未保存的账号修改"><h2>有尚未保存的修改</h2><p>继续编辑可以保留当前填写的配置。</p><div><button onClick={() => setDiscard(null)}>继续编辑</button><button className="aa-primary" onClick={() => { const action = discard; setDiscard(null); action(); }}>放弃修改</button></div></section></div>}
  </div>;
}
