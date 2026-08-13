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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  millisecondsFromSeconds,
  normalizeOptionalProcessRouteChangeNote,
  processRouteChangeCommandIdempotencyKey,
  processRouteChangeIdempotencyKey,
  processRouteChangeStatusLabels,
  processRouteChangeReviewNoteError,
  processRouteChangeTypeLabel,
  resolveProcessRouteChangeDefinitionBinding,
  secondsFromMilliseconds,
  type ProcessRouteChangeDTO,
  type ProcessRouteChangeListResponse,
  type ProcessRouteTimeChangeDTO,
} from '@/lib/process-route-change-contract';
import {
  publishProcessRouteChangeClientUpdate,
  subscribeProcessRouteChangeClientUpdates,
} from '@/lib/process-route-change-client-sync';

type ReviewStep = {
  id: string;
  processName: string;
  position: number;
  sequenceGroup: number;
  standardMillisecondsPerUnit?: number | null;
};

type ReviewProcessDefinition = {
  id: string;
  code: string;
  name: string;
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

type ProcessRouteChangeCommandResponse = {
  data?: ProcessRouteChangeDTO;
  error?: unknown;
  code?: unknown;
  currentStatus?: unknown;
  currentVersion?: unknown;
};

function replaceProcessRouteChange(
  changes: ProcessRouteChangeDTO[],
  replacement: ProcessRouteChangeDTO,
): ProcessRouteChangeDTO[] {
  return changes.some(item => item.id === replacement.id)
    ? changes.map(item => item.id === replacement.id ? replacement : item)
    : [replacement, ...changes];
}

function resolvedCommandMessage(
  status: ProcessRouteChangeDTO['status'],
  action: 'approve' | 'reject' | 'activate' | 'reevaluate',
): { success: boolean; message: string } | null {
  if (action === 'approve') {
    if (status === 'APPROVED') return { success: true, message: '该申请已经审核通过，请直接执行一键启用。' };
    if (status === 'ACTIVATING') return { success: true, message: '该申请已经审核通过，正在启用中，请稍后刷新。' };
    if (status === 'ACTIVE') return { success: true, message: '该申请已经审核并启用，无需重复审批。' };
    if (status === 'REJECTED') return { success: false, message: '该申请已经被驳回，不能再次执行通过。' };
    if (status === 'FAILED') return { success: false, message: '该申请已通过审核，但启用失败，请查看启用错误后处理。' };
  }
  if (action === 'reject') {
    if (status === 'REJECTED') return { success: true, message: '该申请已经驳回，无需重复操作。' };
    if (status !== 'SUBMITTED' && status !== 'APPROVED') return { success: false, message: `该申请当前为“${processRouteChangeStatusLabels[status]}”，不能再次驳回。` };
  }
  if (action === 'activate') {
    if (status === 'ACTIVE') return { success: true, message: '该申请已经启用，无需重复操作。' };
    if (status === 'ACTIVATING') return { success: true, message: '该申请正在启用中，请稍后刷新。' };
    if (status === 'FAILED') return { success: false, message: '该申请启用失败，请查看错误后重新评估。' };
  }
  if (action === 'reevaluate') {
    if (status === 'SUBMITTED') return { success: true, message: '已按最新路线重新评估，请重新审核。' };
    if (status === 'ACTIVE') return { success: true, message: '该申请已经启用，无需重新评估。' };
  }
  return null;
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
  const [processDefinitions, setProcessDefinitions] = useState<ReviewProcessDefinition[]>([]);
  const [processDefinitionsLoading, setProcessDefinitionsLoading] = useState(true);
  const [processDefinitionsError, setProcessDefinitionsError] = useState('');
  const [newProcessDefinitionId, setNewProcessDefinitionId] = useState('');
  const [affectedQty, setAffectedQty] = useState('');
  const [newStepSeconds, setNewStepSeconds] = useState('');
  const [timeChanges, setTimeChanges] = useState<ProcessRouteTimeChangeDTO[]>([]);
  const commandInFlightRef = useRef(false);
  const panelInstanceIdRef = useRef(processRouteChangeIdempotencyKey('route-change-review-panel'));

  const load = useCallback(async (): Promise<ProcessRouteChangeDTO[]> => {
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
      return list;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工艺变更加载失败');
      return [];
    } finally {
      setLoading(false);
    }
  }, [initialChangeId, routeId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => subscribeProcessRouteChangeClientUpdates(update => {
    if (update.routeId !== routeId || update.sourceId === panelInstanceIdRef.current) return;
    void load();
  }), [load, routeId]);

  useEffect(() => {
    setError('');
    setMessage('');
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    setProcessDefinitionsLoading(true);
    setProcessDefinitionsError('');
    fetch('/api/process-definitions', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as {
          definitions?: ReviewProcessDefinition[];
          error?: unknown;
        };
        if (!response.ok || !Array.isArray(body.definitions)) {
          throw new Error(responseError(body, '工序定义加载失败'));
        }
        if (!cancelled) setProcessDefinitions(body.definitions);
      })
      .catch(reason => {
        if (!cancelled) setProcessDefinitionsError(reason instanceof Error ? reason.message : '工序定义加载失败');
      })
      .finally(() => {
        if (!cancelled) setProcessDefinitionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = changes.find(item => item.id === selectedId) || null;
  const submittedCount = changes.filter(item => item.status === 'SUBMITTED').length;
  const selectedPayload = selected?.payload;

  useEffect(() => {
    if (!selected) return;
    setReviewReason(selected.reviewReason || '');
    setAffectedQty(String(selected.payload.affectedQty || selected.impact?.affectedQty || ''));
    setNewStepSeconds(secondsFromMilliseconds(selected.payload.newStandardMillisecondsPerUnit));
    setTimeChanges(selected.payload.timeChanges.map(item => ({ ...item })));
    const binding = resolveProcessRouteChangeDefinitionBinding(
      selected.payload.newProcessName,
      selected.payload.newProcessDefinitionId,
      processDefinitions,
    );
    setNewProcessDefinitionId(binding.selectedId);
  }, [processDefinitions, selected]);

  const insertAnchor = useMemo(() => steps.find(step => step.id === selectedPayload?.insertBeforeStepId) || null, [selectedPayload?.insertBeforeStepId, steps]);
  const movedStep = useMemo(() => steps.find(step => step.id === selectedPayload?.moveStepId) || null, [selectedPayload?.moveStepId, steps]);
  const moveAnchor = useMemo(() => steps.find(step => step.id === selectedPayload?.moveBeforeStepId) || null, [selectedPayload?.moveBeforeStepId, steps]);
  const definitionBinding = useMemo(() => resolveProcessRouteChangeDefinitionBinding(
    selectedPayload?.newProcessName,
    newProcessDefinitionId || selectedPayload?.newProcessDefinitionId,
    processDefinitions,
  ), [newProcessDefinitionId, processDefinitions, selectedPayload?.newProcessDefinitionId, selectedPayload?.newProcessName]);
  const normalizedTimeChanges = timeChanges.map(item => ({
    stepId: item.stepId,
    standardMillisecondsPerUnit: item.standardMillisecondsPerUnit,
  }));
  const canApprove = Boolean(selected && selected.status === 'SUBMITTED' && canReview);
  const canActivate = Boolean(selected && selected.status === 'APPROVED' && canReview);
  const canReject = Boolean(selected && (selected.status === 'SUBMITTED' || selected.status === 'APPROVED') && canReview);
  const canReevaluate = Boolean(selected && selected.status === 'APPROVED' && selected.routeVersionConflict && canReview);
  const selectedIncludesInsert = selected?.payload.changeType === 'INSERT_STEP' || selected?.payload.changeType === 'BOTH';
  const definitionApprovalBlocked = Boolean(selectedIncludesInsert && (
    processDefinitionsLoading
    || processDefinitionsError
    || definitionBinding.requiresExplicitSelection
  ));

  async function command(action: 'approve' | 'reject' | 'activate' | 'reevaluate'): Promise<void> {
    if (!selected || saving || commandInFlightRef.current) return;
    const parsedAffectedQty = Number(affectedQty);
    const parsedNewStepStandard = millisecondsFromSeconds(newStepSeconds);
    const includesInsert = selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH';
    const resolvedDefinitionBinding = resolveProcessRouteChangeDefinitionBinding(
      selected.payload.newProcessName,
      newProcessDefinitionId || selected.payload.newProcessDefinitionId,
      processDefinitions,
    );
    if (action === 'approve') {
      if (!Number.isSafeInteger(parsedAffectedQty) || parsedAffectedQty <= 0) {
        setError('请输入正确的当前工单应报数量');
        return;
      }
      if (includesInsert && !parsedNewStepStandard) {
        setError('请确认新增工序标准工时');
        return;
      }
      if (includesInsert && processDefinitionsLoading) {
        setError('工序定义仍在加载，请稍后再通过');
        return;
      }
      if (includesInsert && processDefinitionsError) {
        setError(`无法核对工序定义：${processDefinitionsError}`);
        return;
      }
      if (includesInsert && resolvedDefinitionBinding.requiresExplicitSelection) {
        setError(`存在 ${resolvedDefinitionBinding.exactMatches.length} 个同名“${selected.payload.newProcessName || '新增工序'}”，请明确选择要绑定的工序定义`);
        return;
      }
      if (timeChanges.some(item => !item.stepId || !item.standardMillisecondsPerUnit)) {
        setError('请确认全部工时变更项');
        return;
      }
    }
    const reviewNoteError = action === 'activate' || action === 'reevaluate'
      ? null
      : processRouteChangeReviewNoteError(action, reviewReason);
    if (reviewNoteError) {
      setError(reviewNoteError);
      return;
    }
    commandInFlightRef.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const endpoint = action === 'activate'
        ? `/api/process-management/route-changes/${encodeURIComponent(selected.id)}/activate`
        : action === 'reevaluate'
          ? `/api/process-management/route-changes/${encodeURIComponent(selected.id)}/reevaluate`
          : `/api/process-management/route-changes/${encodeURIComponent(selected.id)}/review`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'activate' ? {
          expectedVersion: selected.version,
          expectedRouteVersion: selected.currentRouteVersion ?? routeVersion,
          idempotencyKey: processRouteChangeCommandIdempotencyKey(selected.id, selected.version, action),
        } : action === 'reevaluate' ? {
          expectedVersion: selected.version,
          idempotencyKey: processRouteChangeCommandIdempotencyKey(selected.id, selected.version, action),
        } : {
          action,
          expectedVersion: selected.version,
          reviewReason: normalizeOptionalProcessRouteChangeNote(reviewReason),
          newProcessDefinitionId: includesInsert ? resolvedDefinitionBinding.selectedId || null : null,
          affectedQty: parsedAffectedQty,
          newStandardMillisecondsPerUnit: parsedNewStepStandard,
          timeChanges: normalizedTimeChanges,
          idempotencyKey: processRouteChangeCommandIdempotencyKey(selected.id, selected.version, action),
        }),
      });
      const body = await response.json().catch(() => ({})) as ProcessRouteChangeCommandResponse;
      if (!response.ok) {
        const code = String(body.code || '');
        if (code === 'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT' || code === 'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT') {
          const latestChanges = await load();
          const latest = latestChanges.find(item => item.id === selected.id) || null;
          if (latest) {
            publishProcessRouteChangeClientUpdate({
              changeId: latest.id,
              routeId: latest.routeId,
              sourceId: panelInstanceIdRef.current,
              status: latest.status,
              version: latest.version,
            });
            const feedback = resolvedCommandMessage(latest.status, action);
            if (feedback) {
              if (feedback.success) setMessage(feedback.message);
              else setError(feedback.message);
              if (latest.status === 'ACTIVE') onActivated?.();
              return;
            }
            const serverStatus = String(body.currentStatus || '').trim();
            if (latest.status === 'SUBMITTED' && serverStatus && serverStatus !== latest.status) {
              throw new Error(`系统状态不一致：审核节点为 ${serverStatus}，列表仍为 SUBMITTED。请联系管理员检查服务实例数据库配置。`);
            }
          }
        }
        throw new Error(responseError(body, action === 'activate'
          ? '工艺变更启用失败'
          : action === 'reevaluate'
            ? '工艺变更重新评估失败'
            : '工艺审核失败'));
      }
      if (body.data) {
        setChanges(current => replaceProcessRouteChange(current, body.data as ProcessRouteChangeDTO));
        publishProcessRouteChangeClientUpdate({
          changeId: body.data.id,
          routeId: body.data.routeId,
          sourceId: panelInstanceIdRef.current,
          status: body.data.status,
          version: body.data.version,
        });
      }
      const resolved = body.data ? resolvedCommandMessage(body.data.status, action) : null;
      if (resolved && !resolved.success) {
        setError(resolved.message);
      } else {
        setMessage(action === 'activate'
          ? (body.data?.historicalLaborRecalculationPending
              ? '路线与产品主档已启用；历史工时和达成率仍在等待重算，完成前不会标记为最终结果。'
              : '已启用：当前工单、产品主档、扫码工序及历史工时已同步到新版本。')
          : action === 'reevaluate' && body.data?.status === 'SUBMITTED'
            ? '已基于最新工艺路线重新评估，请重新审核后再启用。'
          : action === 'approve' && body.data?.status === 'APPROVED'
            ? '工艺审核已通过，请核对影响后一键启用。'
            : action === 'reject' && body.data?.status === 'REJECTED'
              ? '已驳回现场提案。'
              : resolved?.message || '工艺变更状态已更新。');
      }
      await load();
      if (body.data?.status === 'ACTIVE') onActivated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工艺变更操作失败');
    } finally {
      commandInFlightRef.current = false;
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
          {(selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH') && <label className="workflow-route-change-definition"><span>绑定工序定义</span><select value={definitionBinding.selectedId} disabled={!canApprove || saving || processDefinitionsLoading || Boolean(processDefinitionsError)} aria-invalid={definitionBinding.requiresExplicitSelection} onChange={event => setNewProcessDefinitionId(event.target.value)}>
            {processDefinitionsLoading && <option value="">正在加载工序库…</option>}
            {!processDefinitionsLoading && processDefinitionsError && <option value="">工序库加载失败</option>}
            {!processDefinitionsLoading && !processDefinitionsError && definitionBinding.exactMatches.length === 0 && <option value="">无同名定义；通过后新建“{selected.payload.newProcessName || '新增工序'}”</option>}
            {!processDefinitionsLoading && !processDefinitionsError && definitionBinding.exactMatches.length > 1 && <option value="">检测到多个同名工序，请明确选择</option>}
            {!processDefinitionsLoading && !processDefinitionsError && definitionBinding.exactMatches.map(definition => <option key={definition.id} value={definition.id}>{definition.name} · {definition.code || definition.id}</option>)}
          </select><small className={definitionBinding.requiresExplicitSelection || processDefinitionsError ? 'error' : ''}>{processDefinitionsError
            ? processDefinitionsError
            : definitionBinding.requiresExplicitSelection
              ? `发现 ${definitionBinding.exactMatches.length} 个同名定义，系统不会按名称猜测`
              : definitionBinding.createsNewDefinition
                ? '没有现有同名定义，可留空；审核通过后由系统新建'
                : '已按唯一同名工序自动绑定，可核对编码'}</small></label>}
          {(selected.payload.changeType === 'INSERT_STEP' || selected.payload.changeType === 'BOTH') && <label><span>新增工序标准工时</span><div><input inputMode="decimal" value={newStepSeconds} disabled={!canApprove || saving} onChange={event => setNewStepSeconds(event.target.value)} /><em>秒/{selected.payload.newReportQuantityBasis === 'action' ? selected.payload.newReportUnitLabel || '动作' : selected.payload.newUnitLabel || '件'}</em></div><small>{selected.payload.newReportQuantityBasis === 'action' ? `按动作数量报工 · 每${selected.payload.newUnitLabel || '套'} ${selected.payload.newUnitsPerProduct || 1} ${selected.payload.newReportUnitLabel || '个'}` : `按产品数量报工 · 单位 ${selected.payload.newUnitLabel || '件'}`}</small></label>}
          <label><span>当前工单应报数量（整单）</span><input inputMode="numeric" value={affectedQty} disabled readOnly /></label>
        </div>

        {!!timeChanges.length && <section className="workflow-route-change-times"><header><span><Clock3 size={15} />工时追溯变更</span><em>{timeChanges.length} 道</em></header>{timeChanges.map((item, index) => <label key={`${item.stepId}-${index}`}><span>{steps.find(step => step.id === item.stepId)?.processName || item.processName || '未知工序'}</span><div><input inputMode="decimal" value={secondsFromMilliseconds(item.standardMillisecondsPerUnit)} disabled={!canApprove || saving} onChange={event => { const milliseconds = millisecondsFromSeconds(event.target.value); setTimeChanges(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, standardMillisecondsPerUnit: milliseconds || 0 } : entry)); }} /><em>秒/件</em></div><b>NEW</b></label>)}</section>}

        <section className="workflow-route-change-impact"><div><GitPullRequestArrow /><span><small>后序已报工</small><strong>{selected.impact?.downstreamReportedStepCount || 0} 道</strong></span></div><div><Clock3 /><span><small>追溯报工</small><strong>{selected.impact?.affectedCompletionCount || 0} 笔</strong></span></div><div><Users /><span><small>影响员工</small><strong>{selected.impact?.affectedEmployeeCount || 0} 人</strong></span></div><div><RotateCcw /><span><small>标准工时</small><strong>{formatLabor(selected.impact?.previousStandardLaborMilliseconds)} → {formatLabor(selected.impact?.nextStandardLaborMilliseconds)}</strong></span></div></section>
        {!!selected.impact?.warnings?.length && <ul className="workflow-route-change-warnings">{selected.impact.warnings.map(warning => <li key={warning}><AlertTriangle size={14} />{warning}</li>)}</ul>}

        <label className="workflow-route-change-reason"><span>工艺审核意见（可选）</span><textarea rows={2} value={reviewReason} disabled={!canReject || saving} placeholder="通过或驳回均可留空；如需补充，可填写判断依据" onChange={event => setReviewReason(event.target.value)} /></label>
        {selected.routeVersionConflict && <p className="workflow-route-change-message error"><AlertTriangle size={15} />工艺路线已从 R{selected.baseRouteVersion} 更新到 R{selected.currentRouteVersion ?? routeVersion}。请先重新评估，重新审核后才能启用。</p>}
        {message && <p className="workflow-route-change-message success"><Check size={15} />{message}</p>}
        {error && <p className="workflow-route-change-message error"><AlertTriangle size={15} />{error}</p>}

        <footer>
          {!canReview && <span>当前账号可查看，仅工艺更新权限可审核与启用。</span>}
          {canReject && <button className="reject" type="button" disabled={saving} onClick={() => void command('reject')}><X size={16} />{selected.status === 'APPROVED' ? '撤销通过并驳回' : '驳回'}</button>}
          {canApprove && <button className="approve" type="button" disabled={saving || definitionApprovalBlocked} title={definitionApprovalBlocked ? '请先完成工序定义核对' : undefined} onClick={() => void command('approve')}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}通过并锁定工时</button>}
          {canReevaluate && <button className="reevaluate" type="button" disabled={saving} onClick={() => void command('reevaluate')}>{saving ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}按最新路线重新评估</button>}
          {canActivate && !selected.routeVersionConflict && <button className="activate" type="button" disabled={saving} onClick={() => void command('activate')}>{saving ? <Loader2 className="spin" size={16} /> : <Play size={16} />}一键启用到当前工单与产品主档</button>}
        </footer>
      </article>}
    </div>}
    {error && !selected && <p className="workflow-route-change-message error"><AlertTriangle size={15} />{error}</p>}
  </section>;
}
