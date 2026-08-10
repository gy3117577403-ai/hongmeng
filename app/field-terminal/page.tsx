'use client';

import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MonitorSmartphone,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import './field-terminal.css';

export default function FieldTerminalPage() {
  const [name, setName] = useState('车间共享报工终端');
  const [location, setLocation] = useState('');
  const [code, setCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const next = query.get('next') || '';
    if (query.get('bootstrap') !== '1' || !next.startsWith('/field-report/')) return;
    const destination = new URL(next, window.location.origin);
    destination.searchParams.set('terminalBootstrap', '1');
    window.location.replace(`${destination.pathname}${destination.search}`);
  }, []);

  async function enroll(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('请输入终端名称');
      return;
    }
    setEnrolling(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/field-report/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), location: location.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setError('请先用管理员账号登录，再在本机完成终端注册');
        } else {
          setError(body.error || '终端注册失败，请稍后重试');
        }
        return;
      }
      setMessage('本机已注册为共享报工终端，管理员登录已安全退出。现在可以扫描流转单二维码。');
    } catch {
      setError('网络异常，请检查连接后重试');
    } finally {
      setEnrolling(false);
    }
  }

  function openTicket(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = code.trim();
    if (!normalized) {
      setError('请扫描二维码或输入流转单代码');
      return;
    }
    window.location.href = `/field-report/${encodeURIComponent(normalized)}`;
  }

  return (
    <main className="field-terminal-page">
      <header className="field-terminal-header">
        <span className="field-terminal-brand">杭</span>
        <div>
          <small>生产现场</small>
          <strong>共享报工终端</strong>
        </div>
        <em><ShieldCheck />一人一 PIN · 全程留痕</em>
      </header>

      <section className="field-terminal-hero">
        <div>
          <span><MonitorSmartphone /></span>
          <small>终端模式</small>
          <h1>扫码后验证员工身份，再提交本次报工</h1>
          <p>二维码仍对应原工单；PIN 只在已注册的共享平板上使用，并且每次提交后自动退出当前员工。</p>
        </div>
        <ol>
          <li><b>1</b><span><strong>管理员注册本机</strong><small>只需首次或设备重置后操作</small></span></li>
          <li><b>2</b><span><strong>员工扫描流转单</strong><small>进入原二维码报工地址</small></span></li>
          <li><b>3</b><span><strong>员工编号 + 6 位 PIN</strong><small>身份只绑定本次工单与 5 分钟会话</small></span></li>
        </ol>
      </section>

      <section className="field-terminal-grid">
        <form className="field-terminal-card" onSubmit={event => void enroll(event)}>
          <header><span><LockKeyhole /></span><div><small>管理员操作</small><strong>注册这台共享终端</strong></div></header>
          <label>
            <span>终端名称</span>
            <input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：一车间 1 号平板" />
          </label>
          <label>
            <span>放置位置（选填）</span>
            <input maxLength={120} value={location} onChange={event => setLocation(event.target.value)} placeholder="例如：装配线入口" />
          </label>
          <p>提交时会退出管理员账号并将本机切换为共享终端模式。停用设备请回到账号管理中的“共享终端”列表。</p>
          <button type="submit" disabled={enrolling || name.trim().length < 2}>
            {enrolling ? <><LoaderCircle className="spin" />正在注册...</> : <><KeyRound />注册本机</>}
          </button>
          <a href="/login?next=%2Ffield-terminal">还未登录管理员账号？前往登录 <ArrowRight /></a>
        </form>

        <form className="field-terminal-card ticket" onSubmit={openTicket}>
          <header><span><QrCode /></span><div><small>现场员工</small><strong>扫描流转单开始报工</strong></div></header>
          <div className="field-terminal-scan"><QrCode /><strong>建议直接使用相机扫码</strong><small>扫描纸质流转单上的原二维码，无需重新打印。</small></div>
          <label>
            <span>流转单代码（扫码失败时使用）</span>
            <input autoCapitalize="none" maxLength={180} value={code} onChange={event => setCode(event.target.value)} placeholder="输入二维码中的报工代码" />
          </label>
          <button type="submit" disabled={!code.trim()}><QrCode />打开报工单</button>
        </form>
      </section>

      {(message || error) && (
        <aside className={message ? 'field-terminal-notice success' : 'field-terminal-notice error'} role="status">
          {message ? <CheckCircle2 /> : <LockKeyhole />}
          <span>{message || error}</span>
        </aside>
      )}
    </main>
  );
}
