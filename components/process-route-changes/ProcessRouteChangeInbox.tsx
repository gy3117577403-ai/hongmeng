'use client';

import { AlertTriangle, GitPullRequestArrow, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProcessRouteChangeReviewPanel } from '@/components/process-route-changes/ProcessRouteChangeReviewPanel';
import {
  processRouteChangeTypeLabel,
  processRouteChangeStatusLabels,
  type ProcessRouteChangeDTO,
  type ProcessRouteChangeListResponse,
} from '@/lib/process-route-change-contract';

function responseError(value: unknown): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = String((value as { error?: unknown }).error || '').trim();
    if (message) return message;
  }
  return '待审核工艺变更加载失败';
}

export function ProcessRouteChangeInbox() {
  const [changes, setChanges] = useState<ProcessRouteChangeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState('');
  const [reviewRoute, setReviewRoute] = useState<{
    changeId: string;
    routeId: string;
    routeVersion: number;
    steps: Array<{
      id: string;
      processName: string;
      position: number;
      sequenceGroup: number;
      standardMillisecondsPerUnit?: number | null;
    }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const responses = await Promise.all(['SUBMITTED', 'APPROVED'].map(status => (
        fetch(`/api/process-management/route-changes?status=${status}`, { cache: 'no-store' })
      )));
      const bodies = await Promise.all(responses.map(response => (
        response.json().catch(() => ({})) as Promise<Partial<ProcessRouteChangeListResponse>>
      )));
      const failedIndex = responses.findIndex(response => !response.ok);
      if (failedIndex >= 0) throw new Error(responseError(bodies[failedIndex]));
      setChanges(bodies.flatMap(body => Array.isArray(body.data) ? body.data : [])
        .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '待审核工艺变更加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openReview(change: ProcessRouteChangeDTO): Promise<void> {
    if (openingId) return;
    setOpeningId(change.id);
    setError('');
    try {
      const response = await fetch(`/api/process-management/routes/${encodeURIComponent(change.routeId)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as {
        route?: {
          id?: string;
          version?: number;
          steps?: Array<{
            id?: string;
            processName?: string;
            position?: number;
            sequenceGroup?: number;
            standardMillisecondsPerUnit?: number | null;
          }>;
        };
        error?: unknown;
      };
      if (!response.ok || !body.route?.id || !Number.isSafeInteger(body.route.version)) {
        throw new Error(responseError(body));
      }
      setReviewRoute({
        changeId: change.id,
        routeId: body.route.id,
        routeVersion: body.route.version as number,
        steps: (body.route.steps || []).flatMap(step => (
          step.id && step.processName && Number.isSafeInteger(step.position) && Number.isSafeInteger(step.sequenceGroup)
            ? [{
                id: step.id,
                processName: step.processName,
                position: step.position as number,
                sequenceGroup: step.sequenceGroup as number,
                standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
              }]
            : []
        )),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工艺变更审核加载失败');
    } finally {
      setOpeningId('');
    }
  }

  return <><details className="workflow-route-change-inbox">
    <summary>
      <GitPullRequestArrow size={14} />待工艺处理
      {loading ? <Loader2 className="spin" size={13} /> : <b>{changes.length}</b>}
    </summary>
    <div>
      <header><span><strong>现场工艺变更</strong><small>跨工单待审核 / 待启用队列</small></span><button type="button" disabled={loading} onClick={event => { event.preventDefault(); void load(); }}><RefreshCw className={loading ? 'spin' : ''} size={14} />刷新</button></header>
      {error && <p className="error"><AlertTriangle size={14} />{error}</p>}
      {!loading && !error && !changes.length && <p>当前没有待审核提案。</p>}
      {!!changes.length && <nav>{changes.map(change => <button
        type="button"
        key={change.id}
        disabled={Boolean(openingId)}
        onClick={() => { void openReview(change); }}
      >
        <span><strong>{change.workOrderCode || '生产工单'} · {processRouteChangeTypeLabel(change.payload.changeType)}</strong><small>{change.payload.newProcessName || change.payload.movedProcessName || change.title || change.payload.reason || '现场提案'} · {change.requesterName || '现场员工'}</small></span>
        <em>{openingId === change.id ? <Loader2 className="spin" size={13} /> : processRouteChangeStatusLabels[change.status]}</em>
      </button>)}</nav>}
    </div>
  </details>
  {reviewRoute && <div className="workflow-route-change-modal" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) setReviewRoute(null);
  }}>
    <section role="dialog" aria-modal="true" aria-label="工艺变更审核窗口">
      <button className="workflow-route-change-modal-close" type="button" aria-label="关闭审核窗口" onClick={() => setReviewRoute(null)}><X size={18} /></button>
      <ProcessRouteChangeReviewPanel
        routeId={reviewRoute.routeId}
        routeVersion={reviewRoute.routeVersion}
        steps={reviewRoute.steps}
        canReview
        initialChangeId={reviewRoute.changeId}
        onActivated={() => { setReviewRoute(null); void load(); }}
      />
    </section>
  </div>}
  </>;
}
