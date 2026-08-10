'use client';

import { useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

export default function ChangePasswordForm({
  username,
  displayName,
  required,
  nextPath,
}: {
  username: string;
  displayName: string;
  required: boolean;
  nextPath: string;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.message || '修改密码失败');
        return;
      }
      sessionStorage.setItem('hm-login-notice', '密码修改成功，请使用新密码重新登录');
      location.href = `/login?next=${encodeURIComponent(nextPath)}`;
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="change-password-page">
      <form className="change-password-card" onSubmit={submit}>
        <span className="change-password-kicker">账号安全</span>
        <h1>{required ? '首次登录，请先修改密码' : '修改登录密码'}</h1>
        <p>{displayName || username} · 修改后其他设备的旧登录将自动失效。</p>
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            autoFocus
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
          />
          <small>至少 {MIN_PASSWORD_LENGTH} 位，不能使用常见弱密码或包含完整账号。</small>
        </label>
        <label>
          再次输入新密码
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
          />
        </label>
        {error && <div className="change-password-error" role="alert">{error}</div>}
        <button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
          {saving ? '保存中…' : '保存新密码'}
        </button>
      </form>
    </main>
  );
}
