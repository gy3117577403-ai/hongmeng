'use client';

import { LogOut, QrCode, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AccessUnavailableShell({ fieldReportOnly }: { fieldReportOnly: boolean }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

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
    <main className="access-unavailable-root">
      <section>
        <span>{fieldReportOnly ? <QrCode /> : <ShieldAlert />}</span>
        <small>杭连电子协同平台</small>
        <h1>{fieldReportOnly ? '请扫描工单二维码进入报工' : '账号暂未配置可用界面'}</h1>
        <p>{fieldReportOnly
          ? '此账号仅用于具名扫码报工，不能进入管理工作台。'
          : '请联系管理员确认员工部门、主权限或当前代班有效期。'}</p>
        <button type="button" onClick={logout} disabled={loggingOut}><LogOut />{loggingOut ? '退出中…' : '退出并返回登录'}</button>
      </section>
    </main>
  );
}
