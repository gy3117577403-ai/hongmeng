'use client';

import {
  Bell,
  Building2,
  ChevronRight,
  Clock3,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CurrentUserDTO } from '@/types';

const MODULE_LABELS: Partial<Record<CurrentUserDTO['access']['modules'][number], string>> = {
  BUSINESS: '业务部',
  PROCUREMENT: '采购部',
  WAREHOUSE: '仓储部',
  ENGINEERING: '工程部',
  QUALITY: '质量部',
  PROCESS: '工艺部',
  PLANNING: '计划部',
  HR: '人事部',
  PRODUCTION: '生产管理',
  MAJOR_APPROVAL: '重大事项审批',
  ACCOUNT_ADMIN: '账号管理',
  SYSTEM_CONFIGURATION: '系统配置',
};

function accountScopeLabel(user: CurrentUserDTO): string {
  if (user.access.modules.includes('ACCOUNT_ADMIN')) return '系统管理员 · 全部模块';
  if (user.access.modules.includes('MAJOR_APPROVAL')) return '全局只读 · 重大事项审批';
  const businessLabels = user.access.modules
    .map(module => MODULE_LABELS[module])
    .filter((label): label is string => Boolean(label));
  return businessLabels.length ? businessLabels.join('、') : '仅个人账号与系统内通知';
}

export default function AccountCenterShell({ user }: { user: CurrentUserDTO }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const employeeName = user.employee?.name || user.displayName || user.username;

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <main className="account-center-root">
      <header className="account-center-header">
        <div className="account-center-brand"><span>杭</span><div><b>杭连电子协同平台</b><small>个人账号中心</small></div></div>
        <button type="button" onClick={logout} disabled={loggingOut}><LogOut />{loggingOut ? '退出中…' : '退出登录'}</button>
      </header>

      <section className="account-center-hero">
        <div className="account-center-avatar" aria-hidden="true">{employeeName.slice(0, 1)}</div>
        <div><small>当前登录账号</small><h1>{employeeName}</h1><p>{user.employee?.employeeNo || user.username}</p></div>
        <span className="account-center-state"><ShieldCheck />账号正常</span>
      </section>

      <div className="account-center-grid">
        <section className="account-center-card account-center-profile">
          <header><UserRound /><div><h2>账号信息</h2><p>员工档案与登录身份已绑定</p></div></header>
          <dl>
            <div><dt>登录账号</dt><dd>{user.username}</dd></div>
            <div><dt>员工编号</dt><dd>{user.employee?.employeeNo || '未绑定'}</dd></div>
            <div><dt>所属部门</dt><dd><Building2 />{user.employee?.department || '管理员账号'}</dd></div>
            <div><dt>岗位</dt><dd>{user.employee?.position || '—'}</dd></div>
            <div><dt>最近登录</dt><dd><Clock3 />{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '首次登录'}</dd></div>
          </dl>
        </section>

        <section className="account-center-card">
          <header><ShieldCheck /><div><h2>当前权限</h2><p>由管理员按部门、兼岗或代班配置</p></div></header>
          <div className="account-center-scope"><b>{accountScopeLabel(user)}</b><span>权限变更后，旧登录会自动失效并要求重新登录。</span></div>
        </section>

        <section className="account-center-card">
          <header><Bell /><div><h2>系统内通知</h2><p>后续业务流程通知统一汇总到这里</p></div></header>
          <div className="account-center-empty"><Bell /><b>暂无新通知</b><span>流程模块接入后，将显示待办、审批和账号变更消息。</span></div>
        </section>

        <section className="account-center-card account-center-security">
          <header><KeyRound /><div><h2>账号安全</h2><p>建议定期更换登录密码</p></div></header>
          <Link href="/change-password?next=%2Faccount"><span><KeyRound /><b>修改登录密码</b></span><ChevronRight /></Link>
        </section>
      </div>
    </main>
  );
}
