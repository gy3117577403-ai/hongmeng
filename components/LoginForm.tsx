'use client';

import { useState } from 'react';

export default function LoginForm({ nextPath = '/production' }: { nextPath?: string }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      location.href = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/production';
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
        <span className="login-kicker">生产资料统一入口</span>
        <h1>工单资料库</h1>
        <p>鸿蒙平板生产资料管理系统</p>
        <strong>集中管理图纸、SOP、成品图、辅料规格与注意事项。</strong>
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
        <label>账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? '登录中...' : '登录'}</button>
      </form>
    </main>
  );
}
