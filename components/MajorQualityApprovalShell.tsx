'use client';

import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileCheck2,
  Gavel,
  History,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { useToastBridge } from '@/components/ToastProvider';
import type { CurrentUserDTO } from '@/types';

type ApprovalStatus =
  | 'PENDING_QUALITY_REVIEW'
  | 'PENDING_GM_APPROVAL'
  | 'APPROVED'
  | 'QUALITY_RETURNED'
  | 'GM_RETURNED'
  | 'CANCELLED';

type ApprovalFilter = 'ALL' | Exclude<ApprovalStatus, 'CANCELLED'>;
type ApprovalDecision = 'APPROVE' | 'RETURN';
type ReviewStage = 'QUALITY' | 'FINAL';

type ApprovalEvent = {
  id: string;
  action: string;
  fromStatus?: ApprovalStatus | null;
  toStatus?: ApprovalStatus | null;
  note?: string | null;
  actorName?: string | null;
  createdAt: string;
};

type MajorApproval = {
  id: string;
  round: number;
  status: ApprovalStatus;
  version: number;
  issue: {
    id: string;
    code: string;
    title: string;
    priority: string;
    majorQualityReason?: string | null;
    description?: string | null;
    solution?: string | null;
    verificationResult?: string | null;
    workOrderCode?: string | null;
    reporterName?: string | null;
    assigneeName?: string | null;
    createdAt: string;
    sourceDeleted?: boolean;
    snapshotVersion?: number;
    attachments?: Array<{ id: string; name: string; mimeType: string; fileType: string; size: string }>;
  };
  submittedByName?: string | null;
  submittedAt: string;
  qualityReviewedByName?: string | null;
  qualityReviewedAt?: string | null;
  qualityReviewNote?: string | null;
  finalReviewedByName?: string | null;
  finalReviewedAt?: string | null;
  finalReviewNote?: string | null;
  events?: ApprovalEvent[];
};

type ApprovalViewer = {
  canQualityReview: boolean;
  canFinalApprove: boolean;
};

type ApprovalResponse = {
  ok: boolean;
  approvals?: MajorApproval[];
  counts?: Record<string, number>;
  viewer?: ApprovalViewer;
  error?: string;
  message?: string;
};

type DecisionDialog = {
  stage: ReviewStage;
  decision: ApprovalDecision;
};

const FILTERS: ApprovalFilter[] = [
  'ALL',
  'PENDING_QUALITY_REVIEW',
  'PENDING_GM_APPROVAL',
  'QUALITY_RETURNED',
  'GM_RETURNED',
  'APPROVED',
];

const statusMeta: Record<ApprovalStatus, { label: string; shortLabel: string; description: string }> = {
  PENDING_QUALITY_REVIEW: { label: '待质量二级复核', shortLabel: '待质量复核', description: '需由本轮提交人以外的质量人员复核' },
  PENDING_GM_APPROVAL: { label: '待总经办终审', shortLabel: '待终审', description: '质量复核已通过，等待总经办最终决定' },
  APPROVED: { label: '终审通过', shortLabel: '已通过', description: '两级审批已完成，重大质量事项已闭环' },
  QUALITY_RETURNED: { label: '质量复核退回', shortLabel: '质量退回', description: '需完善处理方案后重新提交审批' },
  GM_RETURNED: { label: '总经办退回', shortLabel: '终审退回', description: '需按终审意见整改后重新发起' },
  CANCELLED: { label: '审批已撤回', shortLabel: '已撤回', description: '本轮审批已终止' },
};

const filterMeta: Record<ApprovalFilter, { label: string; hint: string }> = {
  ALL: { label: '全部', hint: '全部重大事项' },
  PENDING_QUALITY_REVIEW: { label: '待质量复核', hint: '质量二级复核' },
  PENDING_GM_APPROVAL: { label: '待总经办终审', hint: '重大事项终审' },
  QUALITY_RETURNED: { label: '质量退回', hint: '需整改重提' },
  GM_RETURNED: { label: '终审退回', hint: '需整改重提' },
  APPROVED: { label: '已通过', hint: '审批闭环' },
};

const eventActionLabels: Record<string, string> = {
  SUBMIT: '提交重大质量审批',
  SUBMITTED: '提交重大质量审批',
  QUALITY_APPROVE: '质量二级复核通过',
  QUALITY_APPROVED: '质量二级复核通过',
  QUALITY_RETURN: '质量二级复核退回',
  QUALITY_RETURNED: '质量二级复核退回',
  FINAL_APPROVE: '总经办终审通过',
  FINAL_APPROVED: '总经办终审通过',
  FINAL_RETURN: '总经办终审退回',
  GM_RETURNED: '总经办终审退回',
  CANCEL: '撤回审批',
  CANCELLED: '撤回审批',
};

function isApprovalFilter(value: string | null): value is ApprovalFilter {
  return !!value && FILTERS.includes(value as ApprovalFilter);
}

function formatDate(value?: string | null, includeTime = true): string {
  if (!value) return '尚未发生';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

function priorityLabel(priority: string): string {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}

function countFor(counts: Record<string, number>, filter: ApprovalFilter, approvals: MajorApproval[]): number {
  const direct = counts[filter];
  if (Number.isFinite(direct)) return direct;
  if (filter === 'ALL') {
    const total = counts.total ?? counts.all;
    if (Number.isFinite(total)) return total;
    const groupedTotal = Object.values(counts).reduce((sum, value) => (
      Number.isFinite(value) ? sum + value : sum
    ), 0);
    return groupedTotal || approvals.length;
  }
  return approvals.filter(item => item.status === filter).length;
}

function eventLabel(event: ApprovalEvent): string {
  const action = String(event.action || '').trim().toUpperCase();
  return eventActionLabels[action]
    || (event.toStatus ? `流转为${statusMeta[event.toStatus]?.label || event.toStatus}` : event.action || '审批状态更新');
}

function reviewStepState(approval: MajorApproval, step: ReviewStage): 'done' | 'current' | 'pending' | 'returned' {
  if (step === 'QUALITY') {
    if (approval.status === 'PENDING_QUALITY_REVIEW') return 'current';
    if (approval.status === 'QUALITY_RETURNED') return 'returned';
    if (approval.qualityReviewedAt) return 'done';
    return 'pending';
  }
  if (approval.status === 'PENDING_GM_APPROVAL') return 'current';
  if (approval.status === 'GM_RETURNED') return 'returned';
  if (approval.status === 'APPROVED') return 'done';
  return 'pending';
}

export default function MajorQualityApprovalShell({ user }: { user: CurrentUserDTO }) {
  const searchParams = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const requestedApprovalId = searchParams.get('approvalId') || '';
  const [filter, setFilter] = useState<ApprovalFilter>(() => isApprovalFilter(requestedStatus) ? requestedStatus : 'ALL');
  const [approvals, setApprovals] = useState<MajorApproval[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [viewer, setViewer] = useState<ApprovalViewer>({ canQualityReview: false, canFinalApprove: false });
  const [selected, setSelected] = useState<MajorApproval | null>(null);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState<DecisionDialog | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const initialViewerFilterChosenRef = useRef(false);
  const selectedIdRef = useRef(requestedApprovalId);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  useToastBridge(toast, setToast);

  const loadApprovals = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`/api/major-quality-approvals?status=${encodeURIComponent(filter)}`, {
        cache: 'no-store',
        signal,
      });
      const body = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as ApprovalResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || body.message || '重大质量审批加载失败');
      const nextApprovals = Array.isArray(body.approvals) ? body.approvals : [];
      const nextViewer = body.viewer || { canQualityReview: false, canFinalApprove: false };
      setApprovals(nextApprovals);
      setCounts(body.counts || {});
      setViewer(nextViewer);
      const preferredId = selectedIdRef.current || requestedApprovalId;
      const nextSelected = nextApprovals.find(item => item.id === preferredId) || nextApprovals[0] || null;
      selectedIdRef.current = nextSelected?.id || '';
      setSelected(nextSelected);

      if (!initialViewerFilterChosenRef.current) {
        initialViewerFilterChosenRef.current = true;
        if (!isApprovalFilter(requestedStatus)) {
          if (nextViewer.canFinalApprove && !nextViewer.canQualityReview) setFilter('PENDING_GM_APPROVAL');
          else if (nextViewer.canQualityReview && !nextViewer.canFinalApprove) setFilter('PENDING_QUALITY_REVIEW');
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setApprovals([]);
      setSelected(null);
      setLoadError(error instanceof Error ? error.message : '重大质量审批加载失败');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [filter, requestedApprovalId, requestedStatus]);

  useEffect(() => {
    const controller = new AbortController();
    void loadApprovals(controller.signal);
    return () => controller.abort();
  }, [loadApprovals, reloadKey]);

  useEffect(() => {
    if (!selected) return;
    selectedIdRef.current = selected.id;
    const params = new URLSearchParams(window.location.search);
    params.set('approvalId', selected.id);
    params.set('status', filter);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }, [filter, selected]);

  useEffect(() => {
    if (!dialog) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => modalCloseRef.current?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !submitting) setDialog(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dialog, submitting]);

  const visibleApprovals = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return approvals;
    return approvals.filter(item => [
      item.issue.code,
      item.issue.title,
      item.issue.workOrderCode,
      item.issue.majorQualityReason,
      item.issue.reporterName,
      item.issue.assigneeName,
      item.submittedByName,
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalized));
  }, [approvals, keyword]);

  const orderedEvents = useMemo(() => [...(selected?.events || [])].sort(
    (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
  ), [selected]);

  const canActOnSelected = selected?.status === 'PENDING_QUALITY_REVIEW'
    ? viewer.canQualityReview
    : selected?.status === 'PENDING_GM_APPROVAL'
      ? viewer.canFinalApprove
      : false;

  function chooseFilter(next: ApprovalFilter): void {
    selectedIdRef.current = '';
    setSelected(null);
    setFilter(next);
  }

  function chooseApproval(approval: MajorApproval): void {
    selectedIdRef.current = approval.id;
    setSelected(approval);
  }

  function openDecision(decision: ApprovalDecision): void {
    if (!selected || !canActOnSelected) return;
    const stage: ReviewStage = selected.status === 'PENDING_QUALITY_REVIEW' ? 'QUALITY' : 'FINAL';
    setDecisionNote('');
    setDecisionError('');
    setDialog({ stage, decision });
  }

  async function submitDecision(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !dialog || !decisionNote.trim()) return;
    setSubmitting(true);
    setDecisionError('');
    const endpoint = dialog.stage === 'QUALITY'
      ? `/api/issues/${encodeURIComponent(selected.issue.id)}/major-approval/quality-review`
      : `/api/issues/${encodeURIComponent(selected.issue.id)}/major-approval/final-decision`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: selected.id,
          expectedVersion: selected.version,
          decision: dialog.decision,
          note: decisionNote.trim(),
        }),
      });
      const body = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || body.message || '审批提交失败');
      const stageLabel = dialog.stage === 'QUALITY' ? '质量复核' : '总经办终审';
      setToast(`${stageLabel}${dialog.decision === 'APPROVE' ? '已通过' : '已退回'}`);
      setDialog(null);
      setDecisionNote('');
      setReloadKey(value => value + 1);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : '审批提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const decisionTitle = dialog
    ? `${dialog.stage === 'QUALITY' ? '质量二级复核' : '总经办终审'} · ${dialog.decision === 'APPROVE' ? '确认通过' : '退回整改'}`
    : '';

  return (
    <main className="hm-major-approval-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/approvals"
        subtitle="重大质量事项二级复核与终审"
        menuItems={[
          { label: '账号中心', href: '/account' },
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
        utilityActions={<>
          <Link className="hm-workbench-button" href="/workspace/issues" prefetch={false}><ShieldCheck size={15} />问题管理</Link>
          <button className="hm-workbench-button" type="button" disabled={loading} onClick={() => setReloadKey(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
        </>}
      />

      <div className="major-approval-frame">
        <WorkbenchPageHeader
          kicker="质量治理"
          title="重大质量审批"
          description="质量部二级复核后提交总经办终审；每次决定、意见和经办人均完整留痕。"
          titleId="major-approval-title"
          actions={<div className="major-viewer-badges">
            {viewer.canQualityReview && <span><UserRoundCheck size={14} />质量复核</span>}
            {viewer.canFinalApprove && <span><Gavel size={14} />重大终审</span>}
            {!viewer.canQualityReview && !viewer.canFinalApprove && <span className="readonly"><ShieldCheck size={14} />审批只读</span>}
          </div>}
        />

        <section className="major-approval-summary" aria-label="重大质量审批状态概览">
          {FILTERS.map(item => {
            const active = filter === item;
            return <button type="button" className={`${active ? 'active' : ''} status-${item.toLowerCase()}`} aria-pressed={active} onClick={() => chooseFilter(item)} key={item}>
              <span>{filterMeta[item].label}<small>{filterMeta[item].hint}</small></span>
              <strong>{countFor(counts, item, approvals)}</strong>
            </button>;
          })}
        </section>

        <div className="major-approval-workspace">
          <section className="major-approval-queue" aria-label="重大质量审批队列">
            <header>
              <div><ClipboardCheck size={17} /><span><b>{filterMeta[filter].label}</b><small>{visibleApprovals.length} 条当前结果</small></span></div>
              <button type="button" aria-label="刷新审批队列" title="刷新审批队列" disabled={loading} onClick={() => setReloadKey(value => value + 1)}><RefreshCw className={loading ? 'spin' : ''} size={15} /></button>
            </header>
            <label className="major-approval-search">
              <Search size={15} aria-hidden="true" />
              <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索问题、工单、责任人" aria-label="搜索重大质量审批" />
              {keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={14} /></button>}
            </label>
            <div className="major-approval-queue-scroll hm-scroll-region" tabIndex={0}>
              {loading && <div className="major-approval-empty"><Loader2 className="spin" /><b>正在加载审批队列</b><span>正在核对最新审批状态和版本</span></div>}
              {!loading && loadError && <div className="major-approval-empty error"><AlertCircle /><b>审批队列加载失败</b><span>{loadError}</span><button type="button" onClick={() => setReloadKey(value => value + 1)}>重新加载</button></div>}
              {!loading && !loadError && !visibleApprovals.length && <div className="major-approval-empty"><CheckCircle2 /><b>当前队列没有事项</b><span>新的重大质量事项提交后会自动进入对应队列。</span></div>}
              {!loading && !loadError && visibleApprovals.map(approval => {
                const meta = statusMeta[approval.status];
                return <button type="button" className={`major-approval-card ${selected?.id === approval.id ? 'active' : ''} status-${approval.status.toLowerCase()}`} aria-pressed={selected?.id === approval.id} key={approval.id} onClick={() => chooseApproval(approval)}>
                  <div className="major-card-top"><span>{approval.issue.code}</span><em className={`priority-${approval.issue.priority}`}>{priorityLabel(approval.issue.priority)}</em><i>{meta.shortLabel}</i></div>
                  <strong title={approval.issue.title}>{approval.issue.title}</strong>
                  <p title={approval.issue.majorQualityReason || ''}>{approval.issue.majorQualityReason || '未填写重大质量判定依据'}</p>
                  <footer><span>第 {approval.round} 轮</span><span>{approval.issue.workOrderCode || '未关联工单'}</span><time>{formatDate(approval.submittedAt, false)}</time></footer>
                </button>;
              })}
            </div>
          </section>

          <section className="major-approval-detail" aria-label="重大质量审批详情">
            {!selected ? <div className="major-detail-empty"><ShieldAlert /><h2>选择一项重大质量事项</h2><p>查看问题依据、复核意见和完整审批时间线。</p></div> : <>
              <header className="major-detail-header">
                <div><span>{selected.issue.code} · 第 {selected.round} 轮审批</span><h2>{selected.issue.title}</h2><p>{selected.issue.workOrderCode ? `关联工单 ${selected.issue.workOrderCode}` : '未关联生产工单'} · 创建于 {formatDate(selected.issue.createdAt)}</p></div>
                <div><em className={`major-status status-${selected.status.toLowerCase()}`}>{statusMeta[selected.status].label}</em>{selected.issue.sourceDeleted ? <span className="major-source-deleted">源问题已删除，审批快照仍保留</span> : <Link href={`/workspace/issues?issueId=${encodeURIComponent(selected.issue.id)}`} prefetch={false}>打开问题详情<ExternalLink size={13} /></Link>}</div>
              </header>

              <section className="major-approval-steps" aria-label="审批进度">
                <div className="done"><span><FileCheck2 /></span><div><b>重大事项提交</b><small>{selected.submittedByName || '系统'} · {formatDate(selected.submittedAt)}</small></div></div>
                <ChevronRight aria-hidden="true" />
                <div className={reviewStepState(selected, 'QUALITY')}><span><UserRoundCheck /></span><div><b>质量二级复核</b><small>{selected.qualityReviewedAt ? `${selected.qualityReviewedByName || '质量人员'} · ${formatDate(selected.qualityReviewedAt)}` : '等待第二名质量人员'}</small></div></div>
                <ChevronRight aria-hidden="true" />
                <div className={reviewStepState(selected, 'FINAL')}><span><Gavel /></span><div><b>总经办终审</b><small>{selected.finalReviewedAt ? `${selected.finalReviewedByName || '总经办'} · ${formatDate(selected.finalReviewedAt)}` : '质量复核通过后进入'}</small></div></div>
              </section>

              <div className="major-detail-body">
                <div className="major-detail-content hm-scroll-region">
                  <section className="major-reason-card">
                    <header><ShieldAlert size={17} /><div><span>重大质量判定</span><b>必须核实的影响与风险</b></div></header>
                    <p>{selected.issue.majorQualityReason || '尚未填写重大质量判定依据。'}</p>
                  </section>

                  <section className="major-fact-grid">
                    <article><span>问题报告人</span><b>{selected.issue.reporterName || '系统记录'}</b><small>原始问题提出人</small></article>
                    <article><span>当前负责人</span><b>{selected.issue.assigneeName || '待分派'}</b><small>整改主责任人</small></article>
                    <article><span>提交审批</span><b>{selected.submittedByName || '系统'}</b><small>{formatDate(selected.submittedAt)}</small></article>
                    <article><span>当前阶段</span><b>{statusMeta[selected.status].shortLabel}</b><small>{statusMeta[selected.status].description}</small></article>
                  </section>

                  <section className="major-evidence-section">
                    <header><MessageSquareText size={16} /><h3>问题与整改依据 · 提交快照 v{selected.issue.snapshotVersion ?? 0}</h3></header>
                    <article><span>问题描述</span><p>{selected.issue.description || '未填写问题描述。'}</p></article>
                    <article><span>处理方案</span><p>{selected.issue.solution || '尚未提交处理方案。'}</p></article>
                    <article><span>验证结果</span><p>{selected.issue.verificationResult || '尚未填写验证结果。'}</p></article>
                    <article><span>提交时附件</span><p>{selected.issue.attachments?.length ? selected.issue.attachments.map(file => file.name).join('、') : '本轮提交时没有附件。'}</p></article>
                  </section>

                  {(selected.qualityReviewNote || selected.finalReviewNote) && <section className="major-review-notes">
                    <header><BadgeCheck size={16} /><h3>已形成的审批意见</h3></header>
                    {selected.qualityReviewNote && <article><span>质量二级复核</span><p>{selected.qualityReviewNote}</p><small>{selected.qualityReviewedByName || '质量人员'} · {formatDate(selected.qualityReviewedAt)}</small></article>}
                    {selected.finalReviewNote && <article><span>总经办终审</span><p>{selected.finalReviewNote}</p><small>{selected.finalReviewedByName || '总经办'} · {formatDate(selected.finalReviewedAt)}</small></article>}
                  </section>}
                </div>

                <aside className="major-approval-timeline">
                  <header><History size={16} /><div><h3>审批时间线</h3><span>{orderedEvents.length} 条留痕</span></div></header>
                  <div className="major-timeline-scroll hm-scroll-region" tabIndex={0}>
                    {orderedEvents.map(event => <article key={event.id}>
                      <span className={`timeline-mark ${event.toStatus ? `status-${event.toStatus.toLowerCase()}` : ''}`} />
                      <div><b>{eventLabel(event)}</b>{event.note && <p>{event.note}</p>}<small>{event.actorName || '系统'} · {formatDate(event.createdAt)}</small></div>
                    </article>)}
                    {!orderedEvents.length && <div className="timeline-empty"><Clock3 /><span>暂无审批事件</span></div>}
                  </div>
                </aside>
              </div>

              <footer className="major-detail-actions">
                <div><ShieldCheck size={17} /><span><b>{statusMeta[selected.status].label}</b><small>{canActOnSelected ? '请核对全部依据后给出明确意见，意见将永久留痕。' : statusMeta[selected.status].description}</small></span></div>
                {canActOnSelected && <div className="major-action-buttons"><button className="return" type="button" onClick={() => openDecision('RETURN')}><RotateCcw size={15} />退回整改</button><button className="approve" type="button" onClick={() => openDecision('APPROVE')}><Check size={16} />确认通过</button></div>}
              </footer>
            </>}
          </section>
        </div>
      </div>

      {dialog && selected && <div className="major-decision-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) setDialog(null); }}>
        <form className={`major-decision-dialog decision-${dialog.decision.toLowerCase()}`} role="dialog" aria-modal="true" aria-labelledby="major-decision-title" onSubmit={submitDecision}>
          <header><span className="decision-icon">{dialog.decision === 'APPROVE' ? <BadgeCheck /> : <RotateCcw />}</span><div><small>{selected.issue.code} · 第 {selected.round} 轮</small><h2 id="major-decision-title">{decisionTitle}</h2></div><button ref={modalCloseRef} type="button" aria-label="关闭审批弹窗" title="关闭" disabled={submitting} onClick={() => setDialog(null)}><X size={19} /></button></header>
          <div className="major-decision-summary"><span>{statusMeta[selected.status].shortLabel}</span><b>{selected.issue.title}</b><p>{dialog.decision === 'APPROVE' ? '通过后将进入下一审批阶段；总经办终审通过后问题自动闭环。' : '退回后问题进入整改状态，需要完善处理方案后重新提交。'}</p></div>
          <label>审批意见 <em>必填</em><textarea autoFocus required maxLength={2000} rows={5} value={decisionNote} onChange={event => { setDecisionNote(event.target.value); setDecisionError(''); }} placeholder={dialog.decision === 'APPROVE' ? '说明核验范围、判断依据和通过结论…' : '明确指出需整改的问题、补充资料和重新提交条件…'} /></label>
          <div className="major-decision-count"><span>{decisionNote.trim().length} / 2000</span><small>意见会记录经办账号和提交时间，提交后不可匿名修改。</small></div>
          {decisionError && <p className="major-decision-error" role="alert"><AlertCircle size={15} />{decisionError}</p>}
          <footer><button type="button" disabled={submitting} onClick={() => setDialog(null)}><ArrowLeft size={15} />继续核对</button><button className={dialog.decision === 'APPROVE' ? 'approve' : 'return'} type="submit" disabled={submitting || !decisionNote.trim()}>{submitting ? <Loader2 className="spin" size={16} /> : dialog.decision === 'APPROVE' ? <Check size={16} /> : <RotateCcw size={16} />}{submitting ? '正在提交…' : dialog.decision === 'APPROVE' ? '提交通过决定' : '确认退回整改'}</button></footer>
        </form>
      </div>}
    </main>
  );
}
