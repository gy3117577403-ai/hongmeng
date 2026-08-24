import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { canReviewAbnormalTimeEvent } from '@/lib/abnormal-time-access';
import { serializeAbnormalTimeEvent } from '@/lib/attendance';
import { reviewAbnormalTimeEvent } from '@/lib/abnormal-time-review-service';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const decision = body.decision === 'rejected' ? 'rejected' as const : body.decision === 'confirmed' ? 'confirmed' as const : null;
    if (!decision) return NextResponse.json({ ok: false, error: '请选择确认或驳回' }, { status: 400 });
    const note = cleanProcessText(body.note, 500);
    if (decision === 'rejected' && !note) {
      return NextResponse.json({ ok: false, error: '驳回时请填写原因' }, { status: 400 });
    }
    const event = await reviewAbnormalTimeEvent({
      eventId: params.id,
      reviewerId: user.id,
      decision,
      note: note || null,
      expectedVersion: body.expectedVersion === undefined ? undefined : Number(body.expectedVersion),
      canReviewEmployeeIds: employeeIds => canReviewAbnormalTimeEvent(user, employeeIds),
    });
    await logOp({
      userId: user.id,
      action: decision === 'confirmed' ? 'supervisor_confirm_abnormal_time' : 'supervisor_reject_abnormal_time',
      targetType: 'abnormal_time_event',
      targetId: event.id,
      detail: {
        sequence: event.sequence,
        employeeExempt: event.employeeExempt,
        approvedDurationMilliseconds: event.approvedDurationMilliseconds,
      },
    });
    return NextResponse.json({ ok: true, event: serializeAbnormalTimeEvent(event) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅车间主管、质量部或管理员可以审核当前范围的异常工时');
    const message = error instanceof Error ? error.message : '异常工时审核失败';
    console.error('supervisor review abnormal time failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
