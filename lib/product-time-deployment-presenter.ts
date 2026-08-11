import type {
  ProductTimeDeploymentDiffDTO,
  ProductTimeDeploymentDTO,
  ProductTimeDeploymentRouteDTO,
  ProductTimeDeploymentStatus,
} from '@/types';

export type ProductTimeDeploymentDiffCounts = {
  insert: number;
  move: number;
  updateTime: number;
  delete: number;
};

export function countProductTimeDeploymentDiffs(
  diffs: ProductTimeDeploymentDiffDTO[],
): ProductTimeDeploymentDiffCounts {
  return diffs.reduce<ProductTimeDeploymentDiffCounts>((counts, diff) => {
    if (diff.kind === 'insert') counts.insert += 1;
    if (diff.kind === 'move') counts.move += 1;
    if (diff.kind === 'update_time') counts.updateTime += 1;
    if (diff.kind === 'delete') counts.delete += 1;
    return counts;
  }, { insert: 0, move: 0, updateTime: 0, delete: 0 });
}

export function productTimeDeploymentStatusText(status: ProductTimeDeploymentStatus): string {
  const labels: Record<ProductTimeDeploymentStatus, string> = {
    preview: '影响预览',
    pending: '等待发布',
    applying: '正在同步',
    active: '发布成功',
    failed: '发布失败',
  };
  return labels[status];
}

export function productTimeDeploymentRouteStateText(state: ProductTimeDeploymentRouteDTO['state']): string {
  if (state === 'unstarted') return '未报工';
  if (state === 'in_progress') return '在制';
  return '已完成';
}

export function productTimeDeploymentRouteStatusText(status: ProductTimeDeploymentRouteDTO['status']): string {
  const labels: Record<ProductTimeDeploymentRouteDTO['status'], string> = {
    pending: '待同步',
    applying: '同步中',
    succeeded: '已同步',
    failed: '失败',
    blocked: '冲突阻断',
    unchanged: '无需更新',
  };
  return labels[status];
}

export function productTimeDeploymentProgress(deployment: Pick<ProductTimeDeploymentDTO, 'routes'>): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = deployment.routes.length;
  const completed = deployment.routes.filter(route => (
    route.status === 'succeeded'
      || route.status === 'failed'
      || route.status === 'blocked'
      || route.status === 'unchanged'
  )).length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 100,
  };
}

export function failedProductTimeDeploymentRoutes(
  deployment: Pick<ProductTimeDeploymentDTO, 'routes'>,
): ProductTimeDeploymentRouteDTO[] {
  return deployment.routes.filter(route => route.status === 'failed' || route.status === 'blocked');
}
