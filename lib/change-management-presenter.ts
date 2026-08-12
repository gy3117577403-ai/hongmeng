import type { ChangeStatus } from '@/types';
import type { ProcessRouteChangeStatus } from '@/lib/process-route-change-contract';

export type ChangeViewScope = 'mine' | 'all' | 'closed';

export type ChangeProgressStep = {
  key: string;
  label: string;
  state: 'done' | 'current' | 'pending';
};

export function changeScopeQuery(scope: ChangeViewScope, userId: string): Record<string, string> {
  if (scope === 'mine') return { ownerId: userId, openOnly: 'true' };
  if (scope === 'closed') return { status: 'closed' };
  return {};
}

function progress(labels: string[], currentIndex: number, completed = false): ChangeProgressStep[] {
  return labels.map((label, index) => ({
    key: `${index}-${label}`,
    label,
    state: completed || index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
  }));
}

export function genericChangeProgress(status: ChangeStatus): ChangeProgressStep[] {
  const labels = ['提交', '影响评估', '执行变更', '验证关闭'];
  const index: Record<ChangeStatus, number> = {
    draft: 0,
    assessing: 1,
    implementing: 2,
    verifying: 3,
    closed: 3,
  };
  return progress(labels, index[status], status === 'closed');
}

export function processRouteChangeProgress(status: ProcessRouteChangeStatus): ChangeProgressStep[] {
  const labels = ['现场提交', '工艺审核', '启用同步', '员工报工'];
  const currentIndex: Record<ProcessRouteChangeStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 1,
    APPROVED: 2,
    REJECTED: 1,
    ACTIVATING: 2,
    ACTIVE: 3,
    FAILED: 2,
  };
  return progress(labels, currentIndex[status]);
}

export function changeQueueSection(status: ChangeStatus): 'active' | 'closed' {
  return status === 'closed' ? 'closed' : 'active';
}
