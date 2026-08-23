import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { trainingApiError } from '@/lib/training-api';
import {
  TRAINING_SESSION_ATTENDANCE_STATUSES,
  TrainingQrError,
  type TrainingSessionAttendanceStatus,
} from '@/lib/training-qr';
import { updateTrainingSessionAttendance } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const status = String(body.status || '').trim() as TrainingSessionAttendanceStatus;
    if (!TRAINING_SESSION_ATTENDANCE_STATUSES.includes(status)) {
      throw new TrainingQrError('出勤状态不正确', 400, 'TRAINING_ATTENDANCE_STATUS_INVALID');
    }
    const expectedVersion = Number(body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new TrainingQrError('出勤版本不正确，请刷新后重试', 409, 'TRAINING_ATTENDANCE_VERSION_INVALID');
    }
    const row = await updateTrainingSessionAttendance({
      attendanceId: params.id,
      status,
      expectedVersion,
      reason: String(body.reason || ''),
      actorId: user.id,
    });
    await logOp({
      userId: user.id,
      action: 'correct_training_session_attendance',
      targetType: 'training_session_attendance',
      targetId: row.id,
      detail: { sessionId: row.sessionId, participantId: row.participantId, status: row.status, reason: String(body.reason || '').slice(0, 500) },
    });
    return NextResponse.json({
      ok: true,
      attendance: {
        id: row.id,
        status: row.status,
        checkInAt: row.checkInAt?.toISOString() || null,
        source: row.source,
        correctionReason: row.correctionReason,
        version: row.version,
      },
    });
  } catch (error) {
    return trainingApiError(error, '课次出勤修改失败', 'update training session attendance failed');
  }
}
