import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/department-access';

type RouteChangeApiUser = {
  id: string;
  username?: string | null;
  displayName?: string | null;
  access: Parameters<typeof hasCapability>[0];
};

export function processRouteChangeActor(user: Pick<RouteChangeApiUser, 'username' | 'displayName'>): string {
  return String(user.displayName || user.username || '未知用户').trim();
}

export function canReadProcessRouteChanges(user: RouteChangeApiUser): boolean {
  return hasCapability(user.access, 'PROCESS', 'READ')
    || hasCapability(user.access, 'PROCESS', 'UPDATE')
    || hasCapability(user.access, 'SYSTEM_CONFIGURATION', 'MANAGE');
}

export function canReviewProcessRouteChanges(user: RouteChangeApiUser): boolean {
  return hasCapability(user.access, 'PROCESS', 'UPDATE')
    || hasCapability(user.access, 'SYSTEM_CONFIGURATION', 'MANAGE');
}

export function processRouteChangeErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; status?: unknown; code?: unknown };
    const status = Number(record.status);
    if (Number.isSafeInteger(status) && status >= 400 && status <= 599) {
      return NextResponse.json({
        ok: false,
        error: String(record.message || fallback),
        code: record.code ? String(record.code) : 'PROCESS_ROUTE_CHANGE_FAILED',
      }, { status });
    }
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
