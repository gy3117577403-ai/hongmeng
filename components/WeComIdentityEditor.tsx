'use client';
import { useState } from 'react';

export type WeComIdentityRecipient = {
  id: string; employeeNo: string; name: string; wecomUserId: string; maskedMobile: string;
  accountName: string; updatedAt: string; mentionLabel: string; mentionState: string;
  testId: string | null; testedAt: string | null;
};
export default function WeComIdentityEditor({ employee, onSaved, onClose }: {
  employee: WeComIdentityRecipient; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState(employee.wecomUserId), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save(action: 'SAVE_IDENTITY' | 'CONFIRM_MENTION', result?: string) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/integrations/wecom/robot', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employeeId: employee.id, expectedUpdatedAt: employee.updatedAt,
          wecomUserId: value, identityConfirmed: checked, result, testId: employee.testId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '保存失败');
      await onSaved(); setMessage(action === 'SAVE_IDENTITY' ? '身份已保存，可选中此员工试发验证。' : '群内核对结果已记录。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  return <section className="settings-wecom-identity" aria-label="员工提醒身份设置">
    <header><div><h4>{employee.employeeNo} · {employee.name}</h4><p>登录账号：{employee.accountName}</p></div><button onClick={onClose} disabled={busy}>收起设置</button></header>
    <p>当前手机号：{employee.maskedMobile}　·　{employee.mentionLabel}</p>
    <label>企业微信成员 UserID<input aria-label="企业微信成员 UserID" value={value} onChange={event => { setValue(event.target.value); setChecked(false); }} placeholder="从企业微信通讯录核对，留空使用手机号" maxLength={64} /></label>
    <label className="settings-wecom-confirm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span>已核对该成员属于此员工</span></label>
    <div className="settings-wecom-identity-actions"><button disabled={busy || Boolean(value.trim()) && !checked} onClick={() => void save('SAVE_IDENTITY')}>{busy ? '保存中…' : '保存提醒身份'}</button>
      {employee.testId && ['TEST_ACCEPTED', 'CONFIRMED', 'NEEDS_CHECK'].includes(employee.mentionState) && <><button disabled={busy} onClick={() => void save('CONFIRM_MENTION', 'CONFIRMED')}>群内已看到正确 @</button><button disabled={busy} onClick={() => void save('CONFIRM_MENTION', 'NEEDS_CHECK')}>群内未正确 @</button></>}
    </div>
    {employee.testedAt && <small>上次试发：{new Date(employee.testedAt).toLocaleString('zh-CN')}</small>}
    {message && <p role="status">{message}</p>}
  </section>;
}
