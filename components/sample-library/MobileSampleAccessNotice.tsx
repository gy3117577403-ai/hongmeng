'use client';

import { useState } from 'react';
import { BookOpen, RefreshCw, LogOut } from 'lucide-react';
import styles from './MobileSampleAccessNotice.module.css';

export default function MobileSampleAccessNotice({ displayName, username, next, capture = false }: { displayName: string; username: string; next: string; capture?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function switchAccount() {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试');
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    } catch { setError('网络连接失败，请重试'); setBusy(false); }
  }
  return <main className={styles.page}><section className={styles.card}>
    <span className={styles.icon}><BookOpen size={30} /></span>
    <p>手机样品{capture ? '采集' : '库'}</p><h1>当前账号尚未开通</h1>
    <strong>{displayName} · {username}</strong>
    <p>请由管理员或人事开通“{capture ? '手机样品采集 · 协同' : '手机样品库 · 只读'}”。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => window.location.reload()}><RefreshCw size={18} />重新检查权限</button>
    <button className={styles.secondary} disabled={busy} onClick={() => void switchAccount()}><LogOut size={18} />切换账号</button>
  </section></main>;
}
