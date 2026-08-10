'use client';

import { AlertTriangle, Delete, KeyRound, LoaderCircle, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type BoundTerminalView = {
  name?: string | null;
  location?: string | null;
};

export default function FieldReportPinGate({
  code,
  terminal,
}: {
  code: string;
  terminal?: BoundTerminalView | null;
}) {
  const router = useRouter();
  const pinInput = useRef<HTMLInputElement>(null);
  const [employeeNo, setEmployeeNo] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function updatePin(value: string): void {
    setPin(value.replace(/\D/g, '').slice(0, 6));
    setError('');
  }

  function pressDigit(value: string): void {
    if (loading) return;
    updatePin(`${pin}${value}`);
    pinInput.current?.focus();
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const normalizedEmployeeNo = employeeNo.trim();
    if (!normalizedEmployeeNo) {
      setError('请输入员工编号');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError('请输入 6 位报工 PIN');
      pinInput.current?.focus();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/field-report/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, employeeNo: normalizedEmployeeNo, pin }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        updatePin('');
        setError(body.error || body.message || '员工编号或 PIN 不正确');
        requestAnimationFrame(() => pinInput.current?.focus());
        return;
      }
      setPin('');
      router.refresh();
    } catch {
      updatePin('');
      setError('终端网络异常，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="field-pin-gate">
      <section className="field-pin-gate-card" aria-labelledby="field-pin-title">
        <header>
          <span className="field-pin-gate-brand">杭</span>
          <div>
            <small>共享报工终端</small>
            <strong id="field-pin-title">员工身份验证</strong>
          </div>
          <em><MonitorSmartphone />{terminal?.name || '已绑定终端'}</em>
        </header>

        <div className="field-pin-gate-context">
          <ShieldCheck />
          <span>
            <strong>扫码工单已识别</strong>
            <small>{terminal?.location ? `${terminal.location} · ` : ''}验证通过后仅进入本次报工，不会匿名记录。</small>
          </span>
        </div>

        <form onSubmit={event => void submit(event)}>
          <label>
            <span>员工编号</span>
            <input
              autoFocus
              autoCapitalize="none"
              autoComplete="username"
              disabled={loading}
              inputMode="text"
              maxLength={32}
              placeholder="请输入员工编号"
              value={employeeNo}
              onChange={event => { setEmployeeNo(event.target.value); setError(''); }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  pinInput.current?.focus();
                }
              }}
            />
          </label>
          <label>
            <span>6 位报工 PIN</span>
            <input
              ref={pinInput}
              aria-describedby={error ? 'field-pin-error' : undefined}
              autoComplete="off"
              disabled={loading}
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="••••••"
              type="password"
              value={pin}
              onChange={event => updatePin(event.target.value)}
            />
            <small>PIN 由管理员设置，系统不会显示或回填原 PIN。</small>
          </label>

          <div className="field-pin-keypad" aria-label="数字键盘">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(value => (
              <button key={value} type="button" disabled={loading} onClick={() => pressDigit(value)}>{value}</button>
            ))}
            <button className="utility" type="button" disabled={loading || !pin} onClick={() => updatePin('')}>清空</button>
            <button type="button" disabled={loading} onClick={() => pressDigit('0')}>0</button>
            <button className="utility" type="button" aria-label="删除一位" disabled={loading || !pin} onClick={() => updatePin(pin.slice(0, -1))}><Delete /></button>
          </div>

          {error && <div className="field-pin-error" id="field-pin-error" role="alert"><AlertTriangle />{error}</div>}
          <button className="field-pin-submit" type="submit" disabled={loading || !employeeNo.trim() || pin.length !== 6}>
            {loading ? <><LoaderCircle className="spin" />正在验证...</> : <><KeyRound />验证并进入报工</>}
          </button>
        </form>
      </section>
      <p className="field-pin-gate-footnote">每次报工完成后自动退出当前员工身份，下一位员工需重新验证。</p>
    </main>
  );
}
