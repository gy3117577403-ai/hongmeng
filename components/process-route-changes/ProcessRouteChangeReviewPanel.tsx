'use client';

import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Clock3,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  millisecondsFromSeconds,
  normalizeOptionalProcessRouteChangeNote,
  processRouteChangeIdempotencyKey,
  processRouteChangeStatusLabels,
  processRouteChangeReviewNoteError,
  processRouteChangeTypeLabel,
  secondsFromMilliseconds,
  type ProcessRouteChangeDTO,
  type ProcessRouteChangeListResponse,
  type ProcessRouteTimeChangeDTO,
} from '@/lib/process-route-change-contract';

type ReviewStep = {
  id: string;
  processName: string;
  position: number;
  sequenceGroup: number;
  standardMillisecondsPerUnit?: number | null;
};

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = String((value as { error?: unknown }).error || '').trim();
    if (message) return message;
  }
  return fallback;
}

function formatLabor(value?: string | number | null): string {
  const milliseconds = Number(value || 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 小时';
  return `${(milliseconds / 3_600_000).toFixed(2)} 小时`;
}

export function ProcessRouteChangeReviewPanel({
  routeId,
  routeVersion,
  steps,
  canReview,
  initialChangeId,
  onActivated,
}: {
  routeId: string;
  routeVersion: number;
  steps: ReviewStep[];
  canReview: boolean;
  initialChangeId?: string;
  onActivated?: () => void;
}) {
  const [changes, setChanges] = useState<ProcessRouteChangeDTO[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [affectedQty, setAffectedQty] = useState('');
  const [newStepSeconds, setNewStepSeconds] = useState('');
  const [timeChanges, setTimeChanges] = useState<ProcessRouteTimeChangeDTO[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ routeId });
      const response = await fetch(`/api/process-management/route-changes?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<ProcessRouteChangeListResponse> & { changes?: ProcessRouteChangeDTO[] };
      if (!response.ok) throw new Error(responseError(body, '工艺变更加载失败'));
      const list = Array.isArray(body.data) ? body.data : Array.isArray(body.changes) ? body.changes : [];
      setChanges(list);
      setSelectedId(current => list.some(item => item.id === current)
        ? current
        : list.some(item => item.id === initialChangeId) ? initialChangeId as string : list[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工艺变更加载失败');
    } finally {
      setLoading(false);
    }
  }, [initialChangeId, routeId]);

  useEffect(() => { void load(); }, [load]);

  const selected = changes.find(item => item.id === selectedId) || null;
  const submittedCount = changes.filter(item => item.status === 'SUBMITTED').length;
  const selectedPayload = selected?.payload;

  useEffect(() => {
    if (!selected) return;
    setReviewReason(selected.reviewReason || '');
    setAffectedQty(String(selected.payload.affectedQty || selected.impact?.affectedQty || ''));
    setNewStepSeconds(secondsFromMilliseconds(selected.payload.newStandardMillisecondsPerUnit));
    setTimeChanges(selected.payload.timeChanges.map(item => ({ ...item })));
    setError('');
    setMessage('');
  }, [selected]);

  const insertAnchor = useMemo(() => steps.find(step => step.id === selectedPayload?.insertBeforeStepId) || null, [selectedPayload?.insertBeforeStepId, steps]);
  const movedStep = useMemo(() => steps.find(step => step.id === selectedPayload?.moveStepId) || null, [selectedPayload?.moveStepId, steps]);
  const moveAnchor = useMemo(() => steps.find(step => step.id === selectedPayload?.moveBeforeStepId) || null, [selectedPayload?.moveBeforeStepId, steps]);
  const normalizedTimeChanges = timeChanges.map(item => ({
    stepId: item.stepId,
    standardMillisecondsPerUnit: item.standardMillisecondsPerUnit,
  }));
  const canApprove = Boolean(selected && selected.status === 'SUBMITTED' && canReview);
  const canActivate = Boolean(selected && selected.status === 'APPROVED' && canReview);

  async function command(action: 'approve' | 'reject' | 'activate'): Promise<void> {
    if (!selected || saving) return;
    const parsedAffectedQty = Number(affectedQty);
    const parsedNewStepStandard = millisecondsFromSeconds(newStepSeconds);
    if (action === 'approve') {
      if (!Number.isSafeInteger(parsedAffectedQty) || parsedAffectedQty <= 0) {
        setError('请输入正确的当前工单应报数量');
        return;
      }
      if ((selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH') && !parsedNewStepStandard) {
        setError('请确认新增工序标准工时');
        return;
      }
      if (timeChanges.some(item => !item.stepId || !item.standardMillisecondsPerUnit)) {
        setError('请确认全部工时变更项');
        return;
      }
    }
    const reviewNoteError = action === 'activate'
      ? null
      : processRouteChangeReviewNoteError(action, reviewReason);
    if (reviewNoteError) {
      setError(reviewNoteError);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const endpoint = action === 'activate'
        ? `/api/process-management/route-changes/${encodeURIComponent(selected.id)}/activate`
        : `/api/process-management/route-changes/${encodeURIComponent(selected.id)}/review`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'activate' ? {
          expectedVersion: selected.version,
          expectedRouteVersion: routeVersion,
          idempotencyKey: processRouteChangeIdempotencyKey('activate-change'),
        } : {
          action,
          expectedVersion: selected.version,
          reviewReason: normalizeOptionalProcessRouteChangeNote(reviewReason),
          affectedQty: parsedAffectedQty,
          newStandardMillisecondsPerUnit: parsedNewStepStandard,
          timeChanges: normalizedTimeChanges,
          idempotencyKey: processRouteChangeIdempotencyKey(`review-${action}`),
        }),
      });
      const body = await response.json().catch(() => ({})) as { data?: ProcessRouteChangeDTO; error?: unknown };
      if (!response.ok) throw new Error(responseError(body, action === 'activate' ? '工艺变更启用失败' : '工艺审核失败'));
      setMessage(action === 'approve'
        ? '工艺审核已通过，请核对影响后一键启用。'
        : action === 'reject'
          ? '已驳回现场提案。'
          : body.data?.historicalLaborRecalculationPending
            ? '路线与产品主档已启用；历史工时和达成率仍在等待重算，完成前不会标记为最终结果。'
            : '已启用：当前工单、产品主档、扫码工序及历史工时已同步到新版本。');
      await load();
      if (action === 'activate') onActivated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工艺变更操作失败');
    } finally {
      setSaving(false);
    }
  }

  return <section className="workflow-route-change-panel" aria-label="工艺变更审核">
    <header>
      <div><span><GitPullRequestArrow size={16} />现场工艺变更</span><h3>待审核与待启用</h3></div>
      <p><b>{submittedCount}</b><small>待工艺审核</small></p>
      <button type="button" disabled={loading || saving} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={15} />刷新</button>
    </header>

    {loading && !changes.length ? <div className="workflow-route-change-empty"><Loader2 className="spin" /><span>正在加载现场提案...</span></div> : !changes.length ? <div className="workflow-route-change-empty"><CheckCircle2 /><span><strong>当前工单没有工艺变更提案</strong><small>员工在扫码报工页提交后会出现在这里。</small></span></div> : <div className="workflow-route-change-layout">
      <nav aria-label="工艺变更提案列表">{changes.map(item => <button className={item.id === selectedId ? 'active' : ''} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><i className={`status-${item.status.toLowerCase()}`} /><span><strong>{processRouteChangeTypeLabel(item.payload.changeType)}</strong><small>{item.requesterName || '现场员工'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</small></span><em>{processRouteChangeStatusLabels[item.status]}</em></button>)}</nav>

      {selected && <article className="workflow-route-change-review">
        <header><span><small>{selected.workOrderCode || '当前工单'} · 基于 R{selected.baseRouteVersion}</small><strong>{selected.payload.newProcessName || selected.payload.movedProcessName || processRouteChangeTypeLabel(selected.payload.changeType)}</strong></span><em className={`status-${selected.status.toLowerCase()}`}>{processRouteChangeStatusLabels[selected.status]}</em></header>

        {(selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH') && <section className="workflow-route-change-insert"><GitCommitHorizontal size={22} /><span><small>插入位置</small><strong>{insertAnchor ? `在第 ${insertAnchor.position} 道「${insertAnchor.processName}」之前` : '待核对插入位置'}</strong><em>NEW · 启用后标记</em></span></section>}
        {selected.payload.changeType === 'MOVE_STEP' && <section className="workflow-route-change-insert"><ArrowDownUp size={22} /><span><small>完整顺序组移动</small><strong>{movedStep ? `顺序组 ${movedStep.sequenceGroup}：${movedStep.processName}` : selected.payload.movedProcessName || '待核对移动工序'} → {moveAnchor ? `顺序组 ${moveAnchor.sequenceGroup}之前` : '路线末尾'}</strong><em>启用时再校验</em></span></section>}

        <div className="workflow-route-change-fields">
          {(selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH') && <label><span>新增工序标准工时</span><div><input inputMode="decimal" value={newStepSeconds} disabled={!canApprove || saving} onChange={event => setNewStepSeconds(event.target.value)} /><em>秒/件</em></div></label>}
          <label><span>当前工单应报数量（整单）</span><input inputMode="numeric" value={affectedQty} disabled readOnly /></label>
        </div>

        {!!timeChanges.length && <section className="workflow-route-change-times"><header><span><Clock3 size={15} />工时追溯变更</span><em>{timeChanges.length} 道</em></header>{timeChanges.map((item, index) => <label key={`${item.stepId}-${index}`}><span>{steps.find(step => step.id === item.stepId)?.processName || item.processName || '未知工序'}</span><div><input inputMode="decimal" value={secondsFromMilliseconds(item.standardMillisecondsPerUnit)} disabled={!canApprove || saving} onChange={event => { const milliseconds = millisecondsFromSeconds(event.target.value); setTimeChanges(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, standardMillisecondsPerUnit: milliseconds || 0 } : entry)); }} /><em>秒/件</em></div><b>NEW</b></label>)}</section>}

        <section className="workflow-route-change-impact"><div><GitPullRequestArrow /><span><small>后序已报工</small><strong>{selected.impact?.downstreamReportedStepCount || 0} 道</strong></span></div><div><Clock3 /><span><small>追溯报工</small><strong>{selected.impact?.affectedCompletionCount || 0} 笔</strong></span></div><div><Users /><span><small>影响员工</small><strong>{selected.impact?.affectedEmployeeCount || 0} 人</strong></span></div><div><RotateCcw /><span><small>标准工时</small><strong>{formatLabor(selected.impact?.previousStandardLaborMilliseconds)} → {formatLabor(selected.impact?.nextStandardLaborMilliseconds)}</strong></span></div></section>
        {!!selected.impact?.warnings?.length && <ul className="workflow-route-change-warnings">{selected.impact.warnings.map(warning => <li key={warning}><AlertTriangle size={14} />{warning}</li>)}</ul>}

        <label className="workflow-route-change-reason"><span>工艺审核意见（可选）</span><textarea rows={2} value={reviewReason} disabled={!canApprove || saving} placeholder="通过或驳回均可留空；如需补充，可填写判断依据" onChange={event => setReviewReason(event.target.value)} /></label>
        {message && <p className="workflow-route-change-message success"><Check size={15} />{message}</p>}
        {error && <p className="workflow-route-change-message error"><AlertTriangle size={15} />{error}</p>}

        <footer>
          {!canReview && <span>当前账号可查看，仅工艺更新权限可审核与启用。</span>}
          {canApprove && <><button className="reject" type="button" disabled={saving} onClick={() => void command('reject')}><X size={16} />驳回</button><button className="approve" type="button" disabled={saving} onClick={() => void command('approve')}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}通过并锁定工时</button></>}
          {canActivate && <button className="activate" type="button" disabled={saving} onClick={() => void command('activate')}>{saving ? <Loader2 className="spin" size={16} /> : <Play size={16} />}一键启用到当前工单与产品主档</button>}
        </footer>
      </article>}
    </div>}
    {error && !selected && <p className="workflow-route-change-message error"><AlertTriangle size={15} />{error}</p>}
  </section>;
}
