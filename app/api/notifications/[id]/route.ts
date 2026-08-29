import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  setNotificationCompletedState,
  setNotificationReadState,
  snoozeNotification,
} from '@/lib/system-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireCapability('NOTIFICATIONS', 'UPDATE');
    const body = await request.json().catch(() => null) as {
      read?: unknown;
      snoozeMinutes?: unknown;
      completed?: unknown;
      completionReason?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: '通知操作不正确' }, { status: 400 });
    }
    const hasRead = typeof body.read === 'boolean';
    const hasSnooze = typeof body.snoozeMinutes === 'number';
    const hasCompleted = typeof body.completed === 'boolean';
    if (Number(hasRead) + Number(hasSnooze) + Number(hasCompleted) !== 1) {
      return NextResponse.json({ ok: false, error: '请选择一项通知操作' }, { status: 400 });
    }
    if (hasCompleted) {
      const completed = body.completed as boolean;
      const result = await setNotificationCompletedState(
        user.id,
        params.id,
        completed,
        typeof body.completionReason === 'string' ? body.completionReason : null,
      );
      if (result.status === 'not_found') {
        return NextResponse.json({ ok: false, error: '通知不存在' }, { status: 404 });
      }
      if (result.status === 'not_restorable') {
        return NextResponse.json({ ok: false, error: '该消息由业务状态自动收口，不能手动恢复' }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        completed,
        completedAt: result.completedAt?.toISOString() || null,
        completionKind: result.completionKind,
        canRestore: result.canRestore,
      });
    }
    if (hasSnooze) {
      try {
        const snoozedUntil = await snoozeNotification(user.id, params.id, body.snoozeMinutes as number);
        if (!snoozedUntil) return NextResponse.json({ ok: false, error: '通知不存在' }, { status: 404 });
        return NextResponse.json({ ok: true, snoozedUntil: snoozedUntil.toISOString() });
      } catch (error) {
        if (error instanceof Error && error.message.includes('稍后提醒时间')) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
        }
        throw error;
      }
    }
    const found = await setNotificationReadState(user.id, params.id, body.read as boolean);
    if (!found) return NextResponse.json({ ok: false, error: '通知不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, read: body.read as boolean });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('notification state update failed', error);
    return NextResponse.json({ ok: false, error: '通知状态更新失败' }, { status: 500 });
  }
}
