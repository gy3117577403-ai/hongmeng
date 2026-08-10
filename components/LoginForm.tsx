'use client';

import { useEffect, useState } from 'react';

type EmployeeIdentity = {
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
};

export default function LoginForm({ nextPath = '/home' }: { nextPath?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [identity, setIdentity] = useState<EmployeeIdentity | null>(null);
  const [identityState, setIdentityState] = useState<'idle' | 'loading' | 'missing'>('idle');

  useEffect(() => {
    const message = sessionStorage.getItem('hm-login-notice') || '';
    if (!message) return;
    sessionStorage.removeItem('hm-login-notice');
    setNotice(message);
  }, []);

  useEffect(() => {
    const employeeNo = username.trim();
    setIdentity(null);
    if (!/^\d{2,12}$/.test(employeeNo)) {
      setIdentityState('idle');
      return undefined;
    }
    setIdentityState('loading');
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/auth/employee-identity?employeeNo=${encodeURIComponent(employeeNo)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.found) {
          setIdentityState('missing');
          return;
        }
        setIdentity(body.employee as EmployeeIdentity);
        setIdentityState('idle');
      } catch (reason) {
        if ((reason as { name?: string }).name !== 'AbortError') setIdentityState('missing');
      }
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.message || '登录失败');
        return;
      }
      const safeNextPath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/home';
      if (d.mustChangePassword === true) {
        location.href = `/change-password?next=${encodeURIComponent(safeNextPath)}`;
        return;
      }
      location.href = safeNextPath;
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero" aria-label="系统介绍">
        <div className="login-logo">▤</div>
        <span className="login-kicker">计划 · 技术 · 生产统一入口</span>
        <h1>杭连协同平台</h1>
        <p>企业生产协同与资料管理系统</p>
        <strong>连接周计划、技术资料、生产执行与工单现场。</strong>
        <div className="login-feature-grid" aria-hidden="true">
          <div><b>PDF</b><span>图纸预览</span></div>
          <div><b>SOP</b><span>指导书</span></div>
          <div><b>S3</b><span>对象存储</span></div>
          <div><b>PG</b><span>持久化</span></div>
        </div>
      </section>

      <form className="login-card" onSubmit={submit}>
        <div className="login-card-title">
          <span>账号登录</span>
          <strong>欢迎回来</strong>
        </div>
        <label>员工编号 / 管理账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="生产员工请输入员工编号" autoFocus /></label>
        {identity && <div className="login-employee-identity" role="status">
          <span>身份已识别</span>
          <strong>{identity.employeeNo} · {identity.name}</strong>
          <small>{[identity.department, identity.team || identity.position].filter(Boolean).join(' · ') || '员工档案已关联'}</small>
        </div>}
        {identityState === 'loading' && <div className="login-identity-hint">正在核对员工姓名...</div>}
        {identityState === 'missing' && <div className="login-identity-hint warning">未找到已开通的员工账号，请核对编号或联系管理员</div>}
        <label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {notice && <div className="form-success" role="status">{notice}</div>}
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={loading || !username.trim() || !password}>{loading ? '登录中...' : identity ? `以 ${identity.name} 身份登录` : '登录'}</button>
      </form>
    </main>
  );
}
