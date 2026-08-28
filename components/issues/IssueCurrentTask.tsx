'use client';

import { AlertCircle, CheckCircle2, FileText, ShieldCheck, UsersRound } from 'lucide-react';
import type { IssueDTO, IssueStatus } from '@/types';

const stages: IssueStatus[] = ['pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'];
const titles: Record<IssueStatus, string> = { pending: '接单并明确处理责任', processing: '完成处理后提交验证', verifying: '核对证据并完成验证', awaiting_confirmation: '等待发起人确认完结', closed: '问题已完结并归档' };

export function IssueCurrentTask({ issue, accountName, saving, dirty, onAction, onContext, onEvidence }: {
  issue: IssueDTO; accountName: string; saving: boolean; dirty: boolean;
  onAction: (target: IssueStatus) => void; onContext: () => void; onEvidence: () => void;
}) {
  const workflow = issue.workflow;
  const actions = workflow?.actions.filter(action => action.allowed) || [];
  const blockers = [...new Set(actions.flatMap(action => action.blockers))];
  const actualVerifier = [...(issue.activities || [])].reverse().find(activity => activity.toStatus === 'awaiting_confirmation')?.actor;
  return <section className={`issue-current-task stage-${issue.status}`} aria-label="当前待办与下一步">
    <header><div><span>第 {stages.indexOf(issue.status) + 1} 步 / 共 5 步</span><h3>{titles[issue.status]}</h3></div><ShieldCheck aria-hidden="true" /></header>
    <dl>
      <div><dt>{issue.status === 'closed' ? '实际确认人' : '当前待办人'}</dt><dd>{issue.status === 'closed' ? issue.requesterConfirmedBy?.displayName || '历史记录未登记' : workflow?.waitingFor || '正在核对责任信息'}</dd></div>
      <div><dt>本账号</dt><dd>{accountName}<small>{actions.length ? actions.some(action => action.adminOverride) ? '管理员操作需填写审计原因' : '可以办理当前任务' : '当前阶段仅可查看'}</small></dd></div>
    </dl>
    {workflow?.verification.kind !== 'missing' && workflow?.verification.text && <div className="issue-task-evidence"><CheckCircle2 size={18} /><div><strong>{workflow.verification.kind === 'major_approval' ? '有效重大审批结论' : '验证结论'}</strong><p>{workflow.verification.text}</p><small>{workflow.verification.kind === 'major_approval' ? `质量复核：${issue.majorApproval?.qualityReviewedByName || '未登记'} · 总经办终审：${issue.majorApproval?.finalReviewedByName || '未登记'}` : actualVerifier ? `实际验证人：${actualVerifier.displayName || actualVerifier.username}` : `指定验证人：${issue.verifier?.name || '未登记'}`}</small>{issue.verifiedAt && <small>验证时间：{new Date(issue.verifiedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small>}</div></div>}
    {issue.status === 'closed' && <p className="issue-task-closed">确认时间：{issue.requesterConfirmedAt ? new Date(issue.requesterConfirmedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '历史记录未登记'}{issue.requesterConfirmationNote && ` · ${issue.requesterConfirmationNote}`}</p>}
    {workflow?.permissionReason && <p className="issue-task-notice"><AlertCircle size={17} />{workflow.permissionReason}</p>}
    {!workflow && <p className="issue-task-notice">操作资格尚未加载，请刷新后重试。</p>}
    {!!blockers.length && <div className="issue-task-blockers" role="status"><strong>还需要完成</strong><ul>{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
    {dirty && <p className="issue-task-notice">责任信息有未保存修改，请先保存或放弃；切换问题时草稿会保留。</p>}
    <footer>
      <div className="issue-task-links"><button type="button" onClick={onContext}><UsersRound size={16} />责任信息</button><button type="button" onClick={onEvidence}><FileText size={16} />查看证据（{issue.attachmentCount}）</button></div>
      <div className="issue-task-actions">{actions.map(action => <button key={action.target} type="button" className={action.target !== 'processing' || issue.status === 'pending' ? 'primary' : ''}
        disabled={saving || dirty || (action.target === 'closed' && action.blockers.length > 0)} onClick={() => onAction(action.target)}>{action.label}</button>)}</div>
    </footer>
  </section>;
}
