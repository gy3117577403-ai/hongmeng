import { canAccessAppRoute } from '@/lib/app-route-access';
import type { AccessModuleCode } from '@/lib/department-access';
import type { HomeDashboardData } from '@/types/home-dashboard';

type HomeAccess = { modules: readonly AccessModuleCode[] };

function routeOrSummary(access: HomeAccess, route: string): string {
  return canAccessAppRoute(access, route) ? route : '/home';
}

/**
 * Keep company-level counts visible while removing drill-down records outside
 * the viewer's modules. This is the concrete meaning of "基础摘要" in phase 1.
 */
export function scopeHomeDashboardData(
  data: HomeDashboardData,
  access: HomeAccess,
): HomeDashboardData {
  return {
    ...data,
    kpis: data.kpis.map(item => ({
      ...item,
      route: routeOrSummary(access, item.route),
    })),
    actionItems: data.actionItems.filter(item => canAccessAppRoute(access, item.targetRoute)),
    issues: data.issues.filter(item => canAccessAppRoute(access, item.targetRoute)),
    todayNodes: data.todayNodes.filter(item => canAccessAppRoute(access, item.targetRoute)),
    workstreams: data.workstreams.map(stream => ({
      ...stream,
      route: routeOrSummary(access, stream.route),
      items: stream.items.filter(item => canAccessAppRoute(access, item.targetRoute)),
    })),
    collaboration: data.collaboration.map(item => ({
      ...item,
      route: routeOrSummary(access, item.route),
    })),
  };
}
