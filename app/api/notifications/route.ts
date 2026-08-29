import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  loadNotificationInbox,
  parseNotificationInboxState,
  SYSTEM_NOTIFICATION_CATEGORIES,
  type SystemNotificationCategory,
} from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireCapability('NOTIFICATIONS', 'READ');
    const categoryValue = String(request.nextUrl.searchParams.get('category') || '').toUpperCase();
    const category = categoryValue && categoryValue !== 'ALL'
      ? categoryValue as SystemNotificationCategory
      : null;
    if (category && !SYSTEM_NOTIFICATION_CATEGORIES.includes(category)) {
      return NextResponse.json({ ok: false, error: '通知分类不正确' }, { status: 400 });
    }
    const stateValue = request.nextUrl.searchParams.get('state')
      ?? request.nextUrl.searchParams.get('status')
      ?? 'pending';
    const state = parseNotificationInboxState(stateValue);
    if (!state) {
      return NextResponse.json({ ok: false, error: '通知状态必须是 pending 或 completed' }, { status: 400 });
    }
    const inbox = await loadNotificationInbox(user.id, user.access, {
      limit: integer(request.nextUrl.searchParams.get('limit'), 30, 100),
      cursor: request.nextUrl.searchParams.get('cursor'),
      unreadOnly: request.nextUrl.searchParams.get('unreadOnly') === 'true',
      category,
      state,
    });
    return NextResponse.json({ ok: true, ...inbox });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('notification inbox failed', error);
    return NextResponse.json({ ok: false, error: '通知加载失败' }, { status: 500 });
  }
}
