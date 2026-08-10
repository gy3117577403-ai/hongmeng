import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { markAllNotificationsRead } from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireCapability('NOTIFICATIONS', 'UPDATE');
    const updatedCount = await markAllNotificationsRead(user.id);
    return NextResponse.json({ ok: true, updatedCount });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('notification read all failed', error);
    return NextResponse.json({ ok: false, error: '全部已读操作失败' }, { status: 500 });
  }
}
