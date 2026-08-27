'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, Plus, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import type { AccountStatusDTO, CurrentUserDTO, EmployeeDTO, UserDTO } from '@/types';

function fieldOnly(account: UserDTO): boolean {
  const now = Date.now();
  const grants = (account.accessGrants || []).filter(grant => grant.isActive
    && (!grant.effectiveTo || Date.parse(grant.effectiveTo) > now));
  return grants.length > 0 && grants.every(grant => grant.profileKey === 'FIELD_REPORTER');
}

export default function EmployeeAccountsWorkbench({ user }: { user: CurrentUserDTO }) {
  const [accounts, setAccounts] = useState<UserDTO[]>([]);
  const [employees, setEmployees] = useState<EmployeeDTO[]>([]);
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accountStatus, setAccountStatus] = useState<AccountStatusDTO>('ACTIVE');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = accounts.find(account => account.id === selectedId) || null;
  const newEmployee = employees.find(employee => employee.id === employeeId) || null;
  const newFieldAccount = newEmployee?.departmentRecord?.code === 'PRODUCTION';
  const availableEmployees = employees.filter(employee => employee.isActive
    && !employee.user && !employee.linkedUser
    && !accounts.some(account => account.employeeId === employee.id));
  const visibleAccounts = useMemo(() => accounts.filter(account =>
    `${account.username} ${account.displayName} ${account.employee?.name || ''} ${account.employee?.department || ''}`
      .toLocaleLowerCase('zh-CN').includes(keyword.trim().toLocaleLowerCase('zh-CN'))), [accounts, keyword]);

  const load = useCallback(async (focusEmployeeId?: string) => {
    setLoading(true);
    try {
      const results = await Promise.all([fetch('/api/users', { cache: 'no-store' }), fetch('/api/employees', { cache: 'no-store' })]);
      const [accountBody, employeeBody] = await Promise.all(results.map(response => response.json()));
      if (!results[0].ok || !accountBody.ok) throw new Error(accountBody.error || '账号列表加载失败');
      if (!results[1].ok || !employeeBody.ok) throw new Error(employeeBody.error || '员工档案加载失败');
      const next = (accountBody.users as UserDTO[]).filter(account => account.employeeId
        && account.id !== user.id && account.laborRole !== 'ADMIN'
        && !(account.accessGrants || []).some(grant => grant.profileKey === 'ADMIN_GLOBAL'));
      setAccounts(next);
      setEmployees(employeeBody.employees || []);
      if (focusEmployeeId) {
        const account = next.find(item => item.employeeId === focusEmployeeId);
        setSelectedId(account?.id || '');
        setCreating(!account);
        setEmployeeId(focusEmployeeId);
        const employee = (employeeBody.employees as EmployeeDTO[]).find(item => item.id === focusEmployeeId);
        if (!account && (employee?.user || employee?.linkedUser)) {
          setCreating(false);
          setError('该员工账号受保护或属于当前登录人，请从管理员或个人账号入口管理。');
        }
        setUsername(employee?.employeeNo || '');
        setDisplayName(employee?.name || '');
      } else setSelectedId(current => next.some(item => item.id === current) ? current : next[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '账号列表加载失败');
    } finally { setLoading(false); }
  }, [user.id]);

  useEffect(() => { void load(new URLSearchParams(window.location.search).get('employeeId') || undefined); }, [load]);
  useEffect(() => {
    if (!selected || creating) return;
    setDisplayName(selected.displayName);
    setAccountStatus(selected.accountStatus || (selected.isActive ? 'ACTIVE' : 'DISABLED'));
    setPassword('');
  }, [selected, creating]);

  async function mutate(url: string, method: string, body: Record<string, unknown>, success: string, focus?: string) {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '操作失败');
      setPassword('');
      setCreating(false);
      await load(focus);
      setMessage(success);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败'); }
    finally { setBusy(false); }
  }

  function createAccount(event: FormEvent) {
    event.preventDefault();
    void mutate('/api/users', 'POST', { employeeId, username: username.trim(), displayName: displayName.trim(), password, mustChangePassword: true },
      newFieldAccount ? '员工现场报工账号已开通，沿用现场临时密码规则。' : '员工账号已开通，首次登录须修改临时密码。', employeeId);
  }

  return <main className="employee-accounts-page">
    <header className="employee-accounts-header">
      <div><Link href="/workspace/employees"><ArrowLeft size={17} />返回人事管理</Link><h1><UsersRound />员工账号管理</h1><p>开通员工账号、维护启停状态和重置登录密码</p></div>
      <button type="button" className="primary" disabled={busy || loading} onClick={() => { setCreating(true); setSelectedId(''); setEmployeeId(''); setUsername(''); setDisplayName(''); setPassword(''); setError(''); setMessage(''); }}><Plus size={18} />开通员工账号</button>
    </header>
    <div className="employee-accounts-boundary"><ShieldCheck size={20} /><p>仅管理绑定员工的普通账号。管理员账号、本人账号和权限授权由原有入口管理；已有部门、兼岗和代班权限会保留。<br />现场临时密码不能进入后台；后台密码重置后，旧登录立即失效，下次登录须修改密码。</p></div>
    {error && <div role="alert" className="employee-accounts-feedback error">{error}</div>}
    {message && <div role="status" className="employee-accounts-feedback success">{message}</div>}
    <div className="employee-accounts-layout">
      <section className="employee-accounts-list" aria-label="员工账号列表">
        <header><label><Search size={17} /><input aria-label="搜索员工账号" placeholder="搜索员工、工号或部门" value={keyword} onChange={event => setKeyword(event.target.value)} /></label><button type="button" aria-label="刷新账号列表" disabled={busy || loading} onClick={() => { setError(''); void load(); }}><RefreshCw size={17} /></button></header>
        <p>{loading ? '正在加载…' : `${visibleAccounts.length} 个员工账号`}</p>
        <div className="employee-accounts-list-scroll">{visibleAccounts.map(account => <button type="button" className={selectedId === account.id && !creating ? 'selected' : ''} key={account.id} disabled={busy} onClick={() => { setSelectedId(account.id); setCreating(false); setError(''); setMessage(''); }}>
          <span className="employee-accounts-avatar">{(account.employee?.name || account.displayName).slice(0, 1)}</span>
          <span><strong>{account.employee?.name || account.displayName}</strong><small>{account.username} · {account.employee?.department || '部门待维护'}</small></span>
          <em className={account.isActive && account.accountStatus === 'ACTIVE' ? 'active' : 'inactive'}>{account.isActive && account.accountStatus === 'ACTIVE' ? '已启用' : '已停用'}</em>
        </button>)}</div>
        {!loading && !visibleAccounts.length && <div className="employee-accounts-empty">没有符合条件的员工账号</div>}
      </section>
      <section className="employee-accounts-editor" aria-label={creating ? '开通员工账号' : '员工账号设置'}>
        {creating ? <form onSubmit={createAccount}>
          <h2>开通员工账号</h2><p>按员工所属部门建立基础账号。主管、组长、总经办及额外授权由管理员配置。</p>
          <label>绑定员工<select required value={employeeId} disabled={busy} onChange={event => { const employee = employees.find(item => item.id === event.target.value); setEmployeeId(event.target.value); setUsername(employee?.employeeNo || ''); setDisplayName(employee?.name || ''); }}><option value="">选择未开通账号的在职员工</option>{availableEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.name} · {employee.department || '部门未设置'}</option>)}</select></label>
          <label>登录账号<input required maxLength={80} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label>
          <label>显示名称<input required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
          {newFieldAccount ? <p className="employee-accounts-note">生产员工基础账号仅用于扫码报工，初始临时密码为 123456；需要后台权限时由管理员授权并设置新的安全密码。</p> : <label>初始临时密码<input type="password" required minLength={6} maxLength={64} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><small>至少 6 位，不可使用常见密码或包含完整登录账号。</small></label>}
          <button type="submit" className="primary" disabled={busy || !employeeId}>{busy ? '正在保存…' : '确认开通'}</button>
        </form> : selected ? <>
          <div className="employee-accounts-identity"><span className="employee-accounts-avatar">{(selected.employee?.name || selected.displayName).slice(0, 1)}</span><div><h2>{selected.employee?.name || selected.displayName}</h2><p>{selected.username} · {selected.employee?.position || '岗位未设置'}</p></div></div>
          <form onSubmit={event => { event.preventDefault(); void mutate(`/api/users/${selected.id}`, 'PATCH', { displayName, accountStatus }, '账号信息已保存，原有权限保持不变。'); }}>
            <label>显示名称<input required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
            <label>账号状态<select value={accountStatus} onChange={event => setAccountStatus(event.target.value as AccountStatusDTO)}><option value="ACTIVE">启用</option><option value="SUSPENDED">暂停</option><option value="DISABLED">停用</option><option value="PENDING">待开通</option></select><small>停用会使旧登录失效，不删除员工档案、报工或历史工时。</small></label>
            <button type="submit" className="primary" disabled={busy}>保存账号信息</button>
          </form>
          <form className="employee-accounts-password" onSubmit={event => { event.preventDefault(); void mutate(`/api/users/${selected.id}/reset-password`, 'POST', { password }, fieldOnly(selected) ? '现场临时密码已重置，旧登录已失效。' : '密码已重置，旧登录已失效；员工下次登录须修改临时密码。'); }}>
            <h3><KeyRound size={18} />重置登录密码</h3>
            {selected.passwordSetupRequired && <p className="employee-accounts-note">该账号已获后台授权，但仍持有现场临时密码。设置新的安全密码后才能登录后台。</p>}
            {fieldOnly(selected) ? <p>此账号仅用于现场报工，重置为现场临时密码 123456。</p> : <label>新的临时密码<input type="password" required minLength={6} maxLength={64} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><small>重置后员工需重新登录，并修改临时密码。</small></label>}
            <button type="submit" disabled={busy}>确认重置密码</button>
          </form>
        </> : <div className="employee-accounts-empty"><UsersRound size={38} /><h2>选择员工账号</h2><p>从左侧选择员工，或开通一个新账号。</p></div>}
      </section>
    </div>
  </main>;
}
