'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { InternalQualityRiskDTO } from '@/types';

export default function QualityNotificationHistory({ report, canRetry, busy, onRetry }: {
  report: InternalQualityRiskDTO; canRetry: boolean; busy: boolean;
  onRetry: (id: string, confirmResend: boolean) => void;
}) {
  const [checkingId, setCheckingId] = useState('');
  const rows = report.notifications || [];
  const states: Record<string, string> = { PENDING: '待发送', SENDING: '发送中', WAITING_CONFIG: '等待配置',
    FAILED: '发送失败', SENT: '企微接口已接收', SKIPPED: '过期提醒已取消', UNCERTAIN: '回执未确认' };
  return <details className="qv3-card qv3-notification-log"><summary>通知与处理记录 <span>· {rows.length} 条</span></summary>
    <p>接口接收不代表群内已 @ 或员工已接单。人员处理状态以任务为准。</p>
    {canRetry && <Link href="/workspace/quality/notifications">查看提醒设置与人员绑定</Link>}
    {rows.map(item => {
      const snapshot = item.deliverySnapshot;
      const task = report.tasks.find(task => task.id === item.taskId);
      return <article className="qv3-notification" key={item.id}>
        <div><strong>{item.title}</strong><span className={'qv4-phase phase-' + (item.state === 'SENT' ? 'ARCHIVED' : 'ACCEPT')}>{states[item.state] || item.state}</span></div>
        {snapshot ? <p>接收人：{snapshot.employeeName} · {snapshot.employeeNo}<br />账号：{snapshot.accountName} · {snapshot.method === 'USER_ID' ? '企业微信成员' : '手机号'} {snapshot.maskedTarget}</p> : <small>{!item.lastAttemptAt && ['PENDING', 'WAITING_CONFIG', 'SKIPPED'].includes(item.state) ? '尚未发送；发送时会记录接收账号与员工。' : '此消息未保留发送身份记录，无法核实当时的提醒目标。'}</small>}
        {item.lastAttemptAt && <small>最近发送：{new Date(item.lastAttemptAt).toLocaleString('zh-CN')}{item.deliveryCount && item.deliveryCount > 1 ? ` · 同人 ${item.deliveryCount} 项合并提醒` : ''}</small>}
        {task && <small>业务任务：{({ TODO: '待接单', IN_PROGRESS: '处理中', COMPLETED: '已提交', VERIFIED: '品质已确认', CANCELLED: '已取消' } as Record<string, string>)[task.status] || task.status}</small>}
        {item.lastError && <small>{item.lastError}</small>}
        {item.deliveryContent && <details><summary>查看发送内容</summary><pre>{item.deliveryContent}</pre></details>}
        {!report.deletedAt && canRetry && ['FAILED', 'WAITING_CONFIG', 'UNCERTAIN'].includes(item.state) && (
          item.state === 'UNCERTAIN' ? checkingId === item.id ? <div><span>核对群消息后仍需重发？</span><button disabled={busy} onClick={() => { onRetry(item.id, true); setCheckingId(''); }}>确认重新排队</button><button onClick={() => setCheckingId('')}>取消</button></div>
            : <button disabled={busy} onClick={() => setCheckingId(item.id)}>核对后重发</button>
          : <button disabled={busy} onClick={() => onRetry(item.id, false)}>重新排队</button>)}
      </article>;
    })}
    {!rows.length && <p>暂无通知记录</p>}
    <div>{report.activities.slice(0, 20).map(item => <p key={item.id}><b>{item.actorName}</b> · {item.content} <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></p>)}</div>
  </details>;
}
