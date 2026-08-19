'use client';

import { AlertTriangle, CheckCircle2, Database, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type { CurrentUserDTO } from '@/types';

type ModuleAudit = {
  module: string;
  label: string;
  status: 'CONNECTED' | 'EMPTY_SOURCE' | 'SCOPE_EMPTY' | 'BROKEN_ACCESS';
  scopeLabel: string | null;
  globalCount: number | null;
  visibleCount: number | null;
  blockedEndpoints: string[];
};

type AccountAudit = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  accountStatus: string;
  productionScope: string;
  employee: { employeeNo: string; name: string; department: string | null; team: string | null } | null;
  modules: ModuleAudit[];
  issues: string[];
};

type AuditPayload = {
  ok: boolean;
  generatedAt?: string;
  summary?: {
    accountCount: number;
    activeAccountCount: number;
    issueAccountCount: number;
    brokenModuleCount: number;
    scopeEmptyCount: number;
  };
  datasets?: Record<string, number>;
  accounts?: AccountAudit[];
  error?: string;
};

function statusText(status: ModuleAudit['status']): string {
  if (status === 'BROKEN_ACCESS') return '接口未接通';
  if (status === 'SCOPE_EMPTY') return '范围无数据';
  if (status === 'EMPTY_SOURCE') return '数据源为空';
  return '已接通';
}

export default function AccessDataAuditShell({ user }: { user: CurrentUserDTO }) {
  const [payload, setPayload] = useState<AuditPayload>({ ok: true });
  const [keyword, setKeyword] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/system/access-data-audit', { cache: 'no-store' });
      const body = await response.json() as AuditPayload;
      if (!response.ok) throw new Error(body.error || '审计数据加载失败');
      setPayload(body);
    } catch (error) {
      setPayload({ ok: false, error: error instanceof Error ? error.message : '审计数据加载失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accounts = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase('zh-CN');
    return (payload.accounts || []).filter(account => {
      if (onlyIssues && !account.issues.length) return false;
      if (!query) return true;
      const text = [account.username, account.displayName, account.employee?.employeeNo, account.employee?.name,
        account.employee?.department, account.employee?.team, ...account.modules.map(module => module.label)]
        .filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
      return text.includes(query);
    });
  }, [keyword, onlyIssues, payload.accounts]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  const summary = payload.summary || { accountCount: 0, activeAccountCount: 0, issueAccountCount: 0, brokenModuleCount: 0, scopeEmptyCount: 0 };

  return <main className="access-audit-page hm-workbench-root">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/permissions"
      subtitle="逐账号核对菜单、接口与数据范围"
      menuItems={[{ label: '退出登录', onSelect: () => void logout() }]}
    />
    <div className="access-audit-main">
      <header className="access-audit-hero">
        <div><span><ShieldCheck size={18} />协同权限体检</span><h1>权限与数据联通审计</h1><p>同一张表同时核对账号可见模块、最小读取接口和业务数据范围，定位“菜单有了但页面为空”。</p></div>
        <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={17} />重新审计</button>
      </header>

      <section className="access-audit-summary" aria-label="审计汇总">
        <article><UsersRound /><span>账号总数<small>当前系统账号</small></span><strong>{summary.accountCount}</strong></article>
        <article><CheckCircle2 /><span>正常启用<small>可登录账号</small></span><strong>{summary.activeAccountCount}</strong></article>
        <article className={summary.issueAccountCount ? 'warning' : ''}><AlertTriangle /><span>待处理账号<small>权限或范围异常</small></span><strong>{summary.issueAccountCount}</strong></article>
        <article className={summary.brokenModuleCount ? 'danger' : ''}><Database /><span>接口断链<small>菜单与 API 不一致</small></span><strong>{summary.brokenModuleCount}</strong></article>
      </section>

      <section className="access-audit-toolbar">
        <label><Search size={17} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索账号、员工、部门、班组或模块" /></label>
        <button className={onlyIssues ? 'active' : ''} type="button" onClick={() => setOnlyIssues(value => !value)}>只看待处理 <b>{summary.issueAccountCount}</b></button>
        <span>{payload.generatedAt ? `审计时间 ${new Date(payload.generatedAt).toLocaleString('zh-CN')}` : '尚未完成审计'}</span>
      </section>

      {payload.error && <div className="access-audit-error"><AlertTriangle size={17} />{payload.error}</div>}

      <section className="access-audit-table">
        <div className="access-audit-head"><span>账号 / 员工</span><span>职责范围</span><span>模块与数据联通</span><span>结果</span></div>
        <div className="access-audit-rows hm-scroll-region" tabIndex={0}>
          {accounts.map(account => <article className={account.issues.length ? 'has-issue' : ''} key={account.id}>
            <div className="access-audit-account"><strong>{account.displayName}</strong><span>{account.username}{account.employee ? ` · ${account.employee.employeeNo}` : ''}</span><small>{account.employee ? `${account.employee.department || '部门未设置'} · ${account.employee.team || '班组未设置'}` : '未绑定员工'}</small></div>
            <div className="access-audit-scope"><strong>{account.productionScope === 'TEAM' ? '本人班组' : account.productionScope === 'WORKSHOP' ? '生产车间' : account.productionScope === 'GLOBAL' ? '全局' : '非生产范围'}</strong><small>{account.isActive && account.accountStatus === 'ACTIVE' ? '账号有效' : `账号 ${account.accountStatus}`}</small></div>
            <div className="access-audit-modules">{account.modules.map(module => <span className={module.status.toLocaleLowerCase('en-US')} title={module.blockedEndpoints.join('\n')} key={module.module}><b>{module.label}</b><em>{statusText(module.status)}{module.scopeLabel ? ` · ${module.scopeLabel}` : ''}{module.visibleCount !== null ? ` · ${module.visibleCount}/${module.globalCount}` : ''}</em></span>)}</div>
            <div className="access-audit-result">{account.issues.length ? <><AlertTriangle /><strong>{account.issues.length} 项待处理</strong><small>{account.issues.join('；')}</small></> : <><CheckCircle2 /><strong>联通正常</strong><small>可见模块均有读取链路</small></>}</div>
          </article>)}
          {!loading && !accounts.length && <div className="access-audit-empty"><ShieldCheck /><strong>没有匹配账号</strong><span>清除筛选条件后查看全部账号。</span></div>}
          {loading && <div className="access-audit-empty"><RefreshCw className="spin" /><strong>正在逐账号核对</strong><span>检查权限、接口和业务数据范围。</span></div>}
        </div>
      </section>
    </div>
  </main>;
}
