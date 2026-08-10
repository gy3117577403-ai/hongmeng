import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { setNotificationReadState } from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireCapability('NOTIFICATIONS', 'UPDATE');
    const body = await request.json().catch(() => null) as { read?: unknown } | null;
    if (!body || typeof body.read !== 'boolean') {
      return NextResponse.json({ ok: false, error: '已读状态不正确' }, { status: 400 });
    }
    const found = await setNotificationReadState(user.id, params.id, body.read);
    if (!found) return NextResponse.json({ ok: false, error: '通知不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, read: body.read });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('notification read state failed', error);
    return NextResponse.json({ ok: false, error: '通知状态更新失败' }, { status: 500 });
  }
}
