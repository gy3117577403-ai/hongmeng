import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeUserIdsForEmployees, createSystemNotification } from '@/lib/system-notifications';
import {
  createTrainingQrCode,
  hashTrainingQrCode,
  parseTrainingFeedbackInput,
  parseTrainingQrCode,
  trainingCheckInSchedule,
  trainingCheckInStatus,
  TrainingQrError,
  trainingQrTemporalState,
  verifyTrainingQrCode,
  type TrainingQrPurpose,
  type TrainingSessionAttendanceStatus,
} from '@/lib/training-qr';

type TrainingTx = Prisma.TransactionClient;

function asQrPurpose(value: string): TrainingQrPurpose {
  if (value === 'CHECK_IN' || value === 'FEEDBACK') return value;
  throw new TrainingQrError('培训二维码用途不正确', 409, 'TRAINING_QR_PURPOSE_INVALID');
}

async function serializableTrainingOperation<T>(
  operation: (tx: TrainingTx) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      });
    } catch (error) {
      if (
        attempt < 2
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) {
        throw new TrainingQrError(
          '培训现场数据已被其他人更新，请刷新后重试',
          409,
          'TRAINING_QR_CONFLICT',
        );
      }
      throw error;
    }
  }
  throw new TrainingQrError(
    '培训现场数据已被其他人更新，请刷新后重试',
    409,
    'TRAINING_QR_CONFLICT',
  );
}

export async function ensureTrainingSessionAttendanceRows(
  tx: TrainingTx,
  planId: string,
): Promise<number> {
  const [sessions, participants, existing] = await Promise.all([
    tx.trainingSession.findMany({ where: { planId }, select: { id: true } }),
    tx.trainingParticipant.findMany({ where: { planId }, select: { id: true } }),
    tx.trainingSessionAttendance.findMany({
      where: { session: { planId } },
      select: { sessionId: true, participantId: true },
    }),
  ]);
  const keys = new Set(existing.map(row => `${row.sessionId}:${row.participantId}`));
  const data = sessions.flatMap(session => participants
    .filter(participant => !keys.has(`${session.id}:${participant.id}`))
    .map(participant => ({
      id: crypto.randomUUID(),
      sessionId: session.id,
      participantId: participant.id,
      status: 'INVITED',
      source: 'SYSTEM_INVITE',
    })));
  if (!data.length) return 0;
  const created = await tx.trainingSessionAttendance.createMany({ data, skipDuplicates: true });
  return created.count;
}

export async function syncTrainingParticipantAttendance(
  tx: TrainingTx,
  participantId: string,
) {
  const participant = await tx.trainingParticipant.findUnique({
    where: { id: participantId },
    include: {
      plan: { select: { id: true } },
      sessionAttendances: {
        include: { session: { select: { id: true } } },
        orderBy: { session: { sequence: 'asc' } },
      },
    },
  });
  if (!participant) throw new TrainingQrError('参训人员不存在', 404, 'TRAINING_PARTICIPANT_NOT_FOUND');
  const sessionCount = await tx.trainingSession.count({ where: { planId: participant.planId } });
  const records = participant.sessionAttendances;
  if (!sessionCount) return participant;
  if (records.length < sessionCount) {
    await ensureTrainingSessionAttendanceRows(tx, participant.planId);
    return syncTrainingParticipantAttendance(tx, participantId);
  }

  const attended = records.filter(record => record.status === 'PRESENT' || record.status === 'LATE');
  const unresolved = records.filter(record => record.status === 'INVITED');
  let attendanceStatus: string;
  if (attended.length === records.length) {
    attendanceStatus = records.some(record => record.status === 'LATE') ? 'LATE' : 'PRESENT';
  } else if (attended.length > 0) {
    attendanceStatus = 'PARTIAL';
  } else if (unresolved.length > 0) {
    attendanceStatus = 'INVITED';
  } else if (records.every(record => record.status === 'LEAVE')) {
    attendanceStatus = 'LEAVE';
  } else {
    attendanceStatus = 'ABSENT';
  }

  const checkIns = attended
    .map(record => record.checkInAt)
    .filter((value): value is Date => Boolean(value));
  const checkOuts = attended
    .map(record => record.checkOutAt)
    .filter((value): value is Date => Boolean(value));
  const checkInAt = checkIns.length
    ? new Date(Math.min(...checkIns.map(value => value.getTime())))
    : null;
  const checkOutAt = checkOuts.length === attended.length && checkOuts.length
    ? new Date(Math.max(...checkOuts.map(value => value.getTime())))
    : null;
  const status = attendanceStatus === 'INVITED'
    ? 'INVITED'
    : ['PRESENT', 'LATE'].includes(attendanceStatus)
      ? 'ATTENDED'
      : attendanceStatus;

  return tx.trainingParticipant.update({
    where: { id: participantId },
    data: {
      attendanceStatus,
      checkInAt,
      checkOutAt,
      status,
      version: { increment: 1 },
    },
  });
}

function serializeIssueTags(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

function feedbackPayload(feedback: {
  id: string;
  overallRating: number;
  contentRating: number;
  trainerRating: number;
  practicalValueRating: number;
  issueTags: Prisma.JsonValue;
  comment: string | null;
  followUpRequested: boolean;
  submittedAt: Date;
  updatedAt: Date;
  version: number;
} | null) {
  return feedback ? {
    id: feedback.id,
    overallRating: feedback.overallRating,
    contentRating: feedback.contentRating,
    trainerRating: feedback.trainerRating,
    practicalValueRating: feedback.practicalValueRating,
    issueTags: serializeIssueTags(feedback.issueTags),
    comment: feedback.comment,
    followUpRequested: feedback.followUpRequested,
    submittedAt: feedback.submittedAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
    version: feedback.version,
  } : null;
}

export function serializeTrainingQrWindow(window: {
  id: string;
  sessionId: string;
  purpose: string;
  status: string;
  tokenHash: string;
  generation: number;
  opensAt: Date;
  expiresAt: Date;
  openedAt: Date;
  closedAt: Date | null;
  openedById: string;
  closedById: string | null;
}, now = new Date()) {
  const purpose = asQrPurpose(window.purpose);
  const effectiveStatus = trainingQrTemporalState({
    status: window.status,
    opensAt: window.opensAt,
    expiresAt: window.expiresAt,
    now,
  });
  const code = ['SCHEDULED', 'OPEN'].includes(effectiveStatus)
    ? createTrainingQrCode({
      id: window.id,
      generation: window.generation,
      sessionId: window.sessionId,
      purpose,
    })
    : null;
  return {
    id: window.id,
    sessionId: window.sessionId,
    purpose,
    status: effectiveStatus,
    generation: window.generation,
    opensAt: window.opensAt.toISOString(),
    expiresAt: window.expiresAt.toISOString(),
    openedAt: window.openedAt.toISOString(),
    closedAt: window.closedAt?.toISOString() || null,
    openedById: window.openedById,
    closedById: window.closedById,
    code,
    scanPath: code ? `/training/scan/${encodeURIComponent(code)}` : null,
  };
}

export async function startTrainingSession(input: {
  sessionId: string;
  actorId: string;
  expectedVersion?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return serializableTrainingOperation(async tx => {
    const current = await tx.trainingSession.findUnique({
      where: { id: input.sessionId },
      include: { plan: true },
    });
    if (!current || current.plan.deletedAt) {
      throw new TrainingQrError('培训课次不存在或已删除', 404, 'TRAINING_SESSION_NOT_FOUND');
    }
    if (current.plan.status === 'CANCELLED' || current.status === 'CANCELLED') {
      throw new TrainingQrError('已取消的培训课次不能开始', 409, 'TRAINING_SESSION_CANCELLED');
    }
    if (!['PUBLISHED', 'IN_PROGRESS'].includes(current.plan.status)) {
      throw new TrainingQrError('只有已发布或进行中的计划可以开始课次', 409, 'TRAINING_SESSION_START_NOT_ALLOWED');
    }
    if (current.status === 'COMPLETED') {
      throw new TrainingQrError('本课次已经结束，不能重复开始', 409, 'TRAINING_SESSION_ALREADY_COMPLETED');
    }
    if (current.status === 'IN_PROGRESS') {
      return { session: current, idempotent: true };
    }
    if (current.status !== 'SCHEDULED') {
      throw new TrainingQrError('当前课次状态不能开始', 409, 'TRAINING_SESSION_START_NOT_ALLOWED');
    }

    await ensureTrainingSessionAttendanceRows(tx, current.planId);
    if (current.plan.status === 'PUBLISHED') {
      const planUpdate = await tx.trainingPlan.updateMany({
        where: { id: current.planId, status: 'PUBLISHED', version: current.plan.version, deletedAt: null },
        data: {
          status: 'IN_PROGRESS',
          startedAt: current.plan.startedAt || now,
          updatedById: input.actorId,
          version: { increment: 1 },
        },
      });
      if (planUpdate.count !== 1) {
        throw new TrainingQrError('培训计划已被其他人更新，请刷新后重试', 409, 'TRAINING_PLAN_CONFLICT');
      }
    }
    const sessionUpdate = await tx.trainingSession.updateMany({
      where: {
        id: current.id,
        status: 'SCHEDULED',
        ...(input.expectedVersion === undefined ? {} : { version: input.expectedVersion }),
      },
      data: {
        status: 'IN_PROGRESS',
        actualStartAt: current.actualStartAt || now,
        version: { increment: 1 },
      },
    });
    if (sessionUpdate.count !== 1) {
      throw new TrainingQrError('课次已被其他人更新，请刷新后重试', 409, 'TRAINING_SESSION_CONFLICT');
    }
    const session = await tx.trainingSession.findUniqueOrThrow({ where: { id: current.id } });
    await tx.trainingActivity.create({
      data: {
        planId: current.planId,
        action: 'start_training_session',
        content: `开始课次：${current.name}`,
        actorId: input.actorId,
        detail: { sessionId: current.id, actualStartAt: session.actualStartAt?.toISOString() || now.toISOString() },
      },
    });
    return { session, idempotent: false };
  });
}

export async function createTrainingQrWindow(input: {
  sessionId: string;
  purpose: TrainingQrPurpose;
  actorId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return serializableTrainingOperation(async tx => {
    const session = await tx.trainingSession.findUnique({
      where: { id: input.sessionId },
      include: {
        plan: {
          include: {
            participants: { select: { id: true, employeeId: true } },
          },
        },
      },
    });
    if (!session || session.plan.deletedAt) {
      throw new TrainingQrError('培训课次不存在或已删除', 404, 'TRAINING_SESSION_NOT_FOUND');
    }
    if (session.plan.status === 'CANCELLED' || session.status === 'CANCELLED') {
      throw new TrainingQrError('已取消的培训课次不能开放二维码', 409, 'TRAINING_SESSION_CANCELLED');
    }
    if (input.purpose === 'CHECK_IN' && !['PUBLISHED', 'IN_PROGRESS'].includes(session.plan.status)) {
      throw new TrainingQrError('只有已发布或进行中的计划可以开放签到', 409, 'TRAINING_CHECK_IN_NOT_ALLOWED');
    }
    if (input.purpose === 'CHECK_IN' && !['SCHEDULED', 'IN_PROGRESS'].includes(session.status)) {
      throw new TrainingQrError('已结束的课次不能重新开放签到', 409, 'TRAINING_CHECK_IN_NOT_ALLOWED');
    }
    if (input.purpose === 'FEEDBACK' && !['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED'].includes(session.plan.status)) {
      throw new TrainingQrError('请先开始培训，再开放课后反馈', 409, 'TRAINING_FEEDBACK_NOT_ALLOWED');
    }
    if (input.purpose === 'FEEDBACK' && !['IN_PROGRESS', 'COMPLETED'].includes(session.status)) {
      throw new TrainingQrError('请先开始当前课次，再结束并开放课后反馈', 409, 'TRAINING_FEEDBACK_NOT_ALLOWED');
    }

    await ensureTrainingSessionAttendanceRows(tx, session.planId);

    const latest = await tx.trainingQrWindow.findFirst({
      where: { sessionId: session.id, purpose: input.purpose },
      orderBy: { generation: 'desc' },
      select: { generation: true },
    });
    await tx.trainingQrWindow.updateMany({
      where: {
        sessionId: session.id,
        purpose: input.purpose,
        status: { in: ['SCHEDULED', 'OPEN'] },
      },
      data: { status: 'REVOKED', closedAt: now, closedById: input.actorId },
    });

    let opensAt: Date;
    let expiresAt: Date;
    let storedStatus: 'SCHEDULED' | 'OPEN';
    if (input.purpose === 'CHECK_IN') {
      const schedule = trainingCheckInSchedule(session);
      if (now.getTime() >= schedule.expiresAt.getTime()) {
        throw new TrainingQrError('本课次签到时间已经结束', 409, 'TRAINING_CHECK_IN_EXPIRED');
      }
      opensAt = now.getTime() < schedule.opensAt.getTime() ? schedule.opensAt : now;
      expiresAt = schedule.expiresAt;
      storedStatus = opensAt.getTime() > now.getTime() ? 'SCHEDULED' : 'OPEN';
    } else {
      opensAt = now;
      expiresAt = new Date(now.getTime() + session.feedbackDeadlineHours * 3_600_000);
      storedStatus = 'OPEN';
      await tx.trainingQrWindow.updateMany({
        where: { sessionId: session.id, purpose: 'CHECK_IN', status: { in: ['SCHEDULED', 'OPEN'] } },
        data: { status: 'CLOSED', closedAt: now, closedById: input.actorId },
      });
      const actualStartAt = session.actualStartAt || session.startAt;
      await tx.trainingSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          actualEndAt: session.actualEndAt || now,
          actualMinutes: session.actualMinutes ?? Math.max(0, Math.round((now.getTime() - actualStartAt.getTime()) / 60_000)),
          version: { increment: 1 },
        },
      });
      const unresolved = await tx.trainingSessionAttendance.findMany({
        where: { sessionId: session.id, status: 'INVITED' },
        select: { id: true, participantId: true },
      });
      if (unresolved.length) {
        await tx.trainingSessionAttendance.updateMany({
          where: { id: { in: unresolved.map(record => record.id) }, status: 'INVITED' },
          data: {
            status: 'ABSENT',
            source: 'SYSTEM_FINALIZE',
            correctedAt: now,
            correctedById: input.actorId,
            correctionReason: '课次结束时仍未签到',
            version: { increment: 1 },
          },
        });
        for (const participantId of new Set(unresolved.map(record => record.participantId))) {
          await syncTrainingParticipantAttendance(tx, participantId);
        }
      }
    }

    const id = crypto.randomUUID();
    const generation = (latest?.generation || 0) + 1;
    const code = createTrainingQrCode({ id, generation, sessionId: session.id, purpose: input.purpose });
    const window = await tx.trainingQrWindow.create({
      data: {
        id,
        sessionId: session.id,
        purpose: input.purpose,
        status: storedStatus,
        tokenHash: hashTrainingQrCode(code),
        generation,
        opensAt,
        expiresAt,
        openedAt: now,
        openedById: input.actorId,
      },
    });
    await tx.trainingActivity.create({
      data: {
        planId: session.planId,
        action: input.purpose === 'CHECK_IN' ? 'open_check_in_qr' : 'open_feedback_qr',
        content: input.purpose === 'CHECK_IN'
          ? `开放课次签到：${session.name}`
          : `结束课次并开放反馈：${session.name}`,
        actorId: input.actorId,
        detail: { sessionId: session.id, qrWindowId: window.id, generation, expiresAt: expiresAt.toISOString() },
      },
    });
    const recipientUserIds = await activeUserIdsForEmployees(
      tx,
      session.plan.participants.map(participant => participant.employeeId),
      { excludeUserIds: [input.actorId] },
    );
    await createSystemNotification(tx, {
      eventType: input.purpose === 'CHECK_IN' ? 'TRAINING_CHECK_IN_OPENED' : 'TRAINING_FEEDBACK_OPENED',
      dedupeKey: `training-${input.purpose.toLowerCase()}:${window.id}:g${generation}`,
      category: 'TODO',
      priority: input.purpose === 'CHECK_IN' ? 'HIGH' : 'NORMAL',
      title: input.purpose === 'CHECK_IN'
        ? `培训签到：${session.plan.title}`
        : `课后反馈：${session.plan.title}`,
      body: `${session.name}${session.location ? ` · ${session.location}` : ''} · 截止 ${expiresAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
      targetRoute: null,
      sourceType: 'training_session',
      sourceId: session.id,
      actorId: input.actorId,
      metadata: { planId: session.planId, sessionId: session.id, purpose: input.purpose, generation },
      expiresAt,
      recipientUserIds,
    });
    return {
      window: serializeTrainingQrWindow(window, now),
      code,
      participantCount: session.plan.participants.length,
    };
  });
}

export async function closeTrainingQrWindow(input: {
  windowId: string;
  actorId: string;
  revoke?: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return serializableTrainingOperation(async tx => {
    const current = await tx.trainingQrWindow.findUnique({
      where: { id: input.windowId },
      include: { session: { include: { plan: true } } },
    });
    if (!current || current.session.plan.deletedAt) {
      throw new TrainingQrError('二维码窗口不存在', 404, 'TRAINING_QR_WINDOW_NOT_FOUND');
    }
    if (!['SCHEDULED', 'OPEN'].includes(current.status)) return serializeTrainingQrWindow(current, now);
    const status = input.revoke ? 'REVOKED' : 'CLOSED';
    const updated = await tx.trainingQrWindow.update({
      where: { id: current.id },
      data: { status, closedAt: now, closedById: input.actorId },
    });
    await tx.trainingActivity.create({
      data: {
        planId: current.session.planId,
        action: input.revoke ? 'revoke_training_qr' : 'close_training_qr',
        content: `${input.revoke ? '作废' : '关闭'}${current.purpose === 'CHECK_IN' ? '签到' : '反馈'}二维码：${current.session.name}`,
        actorId: input.actorId,
        detail: { sessionId: current.sessionId, qrWindowId: current.id, purpose: current.purpose },
      },
    });
    return serializeTrainingQrWindow(updated, now);
  });
}

async function resolveWindowForEmployee(
  tx: TrainingTx,
  code: string,
  employeeId: string,
) {
  const parsed = parseTrainingQrCode(code);
  const window = await tx.trainingQrWindow.findUnique({
    where: { id: parsed.id },
    include: {
      session: {
        include: {
          plan: {
            include: {
              participants: {
                where: { employeeId },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!window) throw new TrainingQrError('培训二维码无效或不存在', 404, 'TRAINING_QR_NOT_FOUND');
  const purpose = asQrPurpose(window.purpose);
  if (!verifyTrainingQrCode({
    code,
    id: window.id,
    generation: window.generation,
    sessionId: window.sessionId,
    purpose,
    tokenHash: window.tokenHash,
  })) {
    throw new TrainingQrError('培训二维码校验失败，请重新扫描', 404, 'TRAINING_QR_NOT_FOUND');
  }
  if (window.session.plan.deletedAt || window.session.plan.status === 'CANCELLED' || window.session.status === 'CANCELLED') {
    throw new TrainingQrError('该培训课次已经取消', 410, 'TRAINING_SESSION_CANCELLED');
  }
  const participant = window.session.plan.participants[0];
  if (!participant) {
    throw new TrainingQrError('你不在本课次参训名单中，请联系培训负责人', 403, 'TRAINING_PARTICIPANT_NOT_INVITED');
  }
  const [attendance, feedback] = await Promise.all([
    tx.trainingSessionAttendance.findUnique({
      where: { sessionId_participantId: { sessionId: window.sessionId, participantId: participant.id } },
    }),
    tx.trainingFeedback.findUnique({
      where: { sessionId_participantId: { sessionId: window.sessionId, participantId: participant.id } },
    }),
  ]);
  return { window, purpose, session: window.session, participant, attendance, feedback };
}

function scanPayload(resolved: Awaited<ReturnType<typeof resolveWindowForEmployee>>, now: Date) {
  const effectiveStatus = trainingQrTemporalState({
    status: resolved.window.status,
    opensAt: resolved.window.opensAt,
    expiresAt: resolved.window.expiresAt,
    now,
  });
  return {
    purpose: resolved.purpose,
    window: {
      id: resolved.window.id,
      status: effectiveStatus,
      opensAt: resolved.window.opensAt.toISOString(),
      expiresAt: resolved.window.expiresAt.toISOString(),
    },
    plan: {
      id: resolved.session.plan.id,
      code: resolved.session.plan.code,
      title: resolved.session.plan.title,
      mode: resolved.session.plan.mode,
    },
    session: {
      id: resolved.session.id,
      name: resolved.session.name,
      startAt: resolved.session.startAt.toISOString(),
      endAt: resolved.session.endAt.toISOString(),
      location: resolved.session.location,
      status: resolved.session.status,
    },
    participant: {
      id: resolved.participant.id,
      employeeNo: resolved.participant.employeeNoSnapshot,
      employeeName: resolved.participant.employeeNameSnapshot,
      department: resolved.participant.departmentSnapshot,
      team: resolved.participant.teamSnapshot,
    },
    attendance: resolved.attendance ? {
      id: resolved.attendance.id,
      status: resolved.attendance.status,
      checkInAt: resolved.attendance.checkInAt?.toISOString() || null,
      source: resolved.attendance.source,
      version: resolved.attendance.version,
    } : null,
    feedback: feedbackPayload(resolved.feedback),
    serverTime: now.toISOString(),
  };
}

export async function resolveTrainingSelfScan(input: {
  code: string;
  employeeId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const resolved = await prisma.$transaction(tx => resolveWindowForEmployee(tx, input.code, input.employeeId));
  return scanPayload(resolved, now);
}

export async function checkInTrainingSelf(input: {
  code: string;
  employeeId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return serializableTrainingOperation(async tx => {
    const resolved = await resolveWindowForEmployee(tx, input.code, input.employeeId);
    if (resolved.purpose !== 'CHECK_IN') {
      throw new TrainingQrError('当前二维码用于课后反馈，不能签到', 409, 'TRAINING_QR_PURPOSE_MISMATCH');
    }
    if (resolved.attendance && ['PRESENT', 'LATE'].includes(resolved.attendance.status)) {
      return { ...scanPayload(resolved, now), idempotent: true };
    }
    const effectiveStatus = trainingQrTemporalState({
      status: resolved.window.status,
      opensAt: resolved.window.opensAt,
      expiresAt: resolved.window.expiresAt,
      now,
    });
    if (effectiveStatus === 'SCHEDULED') {
      throw new TrainingQrError('签到尚未开放', 409, 'TRAINING_CHECK_IN_NOT_OPEN');
    }
    if (effectiveStatus !== 'OPEN') {
      throw new TrainingQrError('签到二维码已关闭或过期', 410, 'TRAINING_CHECK_IN_CLOSED');
    }
    if (resolved.attendance && resolved.attendance.status !== 'INVITED') {
      throw new TrainingQrError('出勤状态已由培训负责人登记，请联系负责人修改', 409, 'TRAINING_ATTENDANCE_ALREADY_DECIDED');
    }
    const status = trainingCheckInStatus({
      startAt: resolved.session.startAt,
      lateAfterMinutes: resolved.session.lateAfterMinutes,
      now,
    });
    const attendance = await tx.trainingSessionAttendance.upsert({
      where: {
        sessionId_participantId: {
          sessionId: resolved.session.id,
          participantId: resolved.participant.id,
        },
      },
      create: {
        sessionId: resolved.session.id,
        participantId: resolved.participant.id,
        status,
        checkInAt: now,
        source: 'QR_SELF',
        qrWindowId: resolved.window.id,
      },
      update: {
        status,
        checkInAt: now,
        source: 'QR_SELF',
        qrWindowId: resolved.window.id,
        correctedAt: null,
        correctedById: null,
        correctionReason: null,
        version: { increment: 1 },
      },
    });
    await syncTrainingParticipantAttendance(tx, resolved.participant.id);
    await tx.trainingActivity.create({
      data: {
        planId: resolved.session.planId,
        action: 'self_check_in',
        content: `${resolved.participant.employeeNameSnapshot}扫码${status === 'LATE' ? '迟到签到' : '签到'}`,
        actorId: null,
        detail: {
          sessionId: resolved.session.id,
          participantId: resolved.participant.id,
          employeeId: input.employeeId,
          attendanceId: attendance.id,
          qrWindowId: resolved.window.id,
          status,
        },
      },
    });
    return {
      ...scanPayload({ ...resolved, attendance }, now),
      idempotent: false,
    };
  });
}

export async function submitTrainingFeedbackSelf(input: {
  code: string;
  employeeId: string;
  body: Record<string, unknown>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const feedbackInput = parseTrainingFeedbackInput(input.body);
  return serializableTrainingOperation(async tx => {
    const resolved = await resolveWindowForEmployee(tx, input.code, input.employeeId);
    if (resolved.purpose !== 'FEEDBACK') {
      throw new TrainingQrError('当前二维码用于签到，不能提交课后反馈', 409, 'TRAINING_QR_PURPOSE_MISMATCH');
    }
    const effectiveStatus = trainingQrTemporalState({
      status: resolved.window.status,
      opensAt: resolved.window.opensAt,
      expiresAt: resolved.window.expiresAt,
      now,
    });
    if (effectiveStatus === 'SCHEDULED') {
      throw new TrainingQrError('课后反馈尚未开放', 409, 'TRAINING_FEEDBACK_NOT_OPEN');
    }
    if (effectiveStatus !== 'OPEN') {
      throw new TrainingQrError('课后反馈已经关闭或过期', 410, 'TRAINING_FEEDBACK_CLOSED');
    }
    if (!resolved.attendance || !['PRESENT', 'LATE'].includes(resolved.attendance.status)) {
      throw new TrainingQrError('只有本课次已签到或迟到签到的员工可以提交反馈', 409, 'TRAINING_FEEDBACK_ATTENDANCE_REQUIRED');
    }
    let feedback;
    if (resolved.feedback) {
      if (feedbackInput.version === null || feedbackInput.version !== resolved.feedback.version) {
        throw new TrainingQrError('反馈已在其他页面更新，请刷新后重试', 409, 'TRAINING_FEEDBACK_CONFLICT');
      }
      feedback = await tx.trainingFeedback.update({
        where: { id: resolved.feedback.id },
        data: {
          overallRating: feedbackInput.overallRating,
          contentRating: feedbackInput.contentRating,
          trainerRating: feedbackInput.trainerRating,
          practicalValueRating: feedbackInput.practicalValueRating,
          issueTags: feedbackInput.issueTags,
          comment: feedbackInput.comment,
          followUpRequested: feedbackInput.followUpRequested,
          version: { increment: 1 },
        },
      });
    } else {
      feedback = await tx.trainingFeedback.create({
        data: {
          sessionId: resolved.session.id,
          participantId: resolved.participant.id,
          overallRating: feedbackInput.overallRating,
          contentRating: feedbackInput.contentRating,
          trainerRating: feedbackInput.trainerRating,
          practicalValueRating: feedbackInput.practicalValueRating,
          issueTags: feedbackInput.issueTags,
          comment: feedbackInput.comment,
          followUpRequested: feedbackInput.followUpRequested,
          submittedAt: now,
        },
      });
    }
    await tx.trainingActivity.create({
      data: {
        planId: resolved.session.planId,
        action: resolved.feedback ? 'update_feedback' : 'submit_feedback',
        content: `${resolved.participant.employeeNameSnapshot}${resolved.feedback ? '更新' : '提交'}课后反馈`,
        actorId: null,
        detail: {
          sessionId: resolved.session.id,
          participantId: resolved.participant.id,
          employeeId: input.employeeId,
          feedbackId: feedback.id,
          followUpRequested: feedback.followUpRequested,
        },
      },
    });
    return {
      ...scanPayload({ ...resolved, feedback }, now),
      saved: true,
    };
  });
}

export async function updateTrainingSessionAttendance(input: {
  attendanceId: string;
  status: TrainingSessionAttendanceStatus;
  expectedVersion: number;
  reason: string;
  actorId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reason = input.reason.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!reason) {
    throw new TrainingQrError('手工修改出勤必须填写原因', 400, 'TRAINING_ATTENDANCE_REASON_REQUIRED');
  }
  return serializableTrainingOperation(async tx => {
    const current = await tx.trainingSessionAttendance.findUnique({
      where: { id: input.attendanceId },
      include: {
        participant: true,
        session: { include: { plan: true } },
      },
    });
    if (!current || current.session.plan.deletedAt) {
      throw new TrainingQrError('课次出勤记录不存在', 404, 'TRAINING_ATTENDANCE_NOT_FOUND');
    }
    const attended = input.status === 'PRESENT' || input.status === 'LATE';
    const updated = await tx.trainingSessionAttendance.updateMany({
      where: { id: current.id, version: input.expectedVersion },
      data: {
        status: input.status,
        checkInAt: attended ? (current.checkInAt || now) : null,
        checkOutAt: attended ? current.checkOutAt : null,
        source: 'ADMIN_MANUAL',
        qrWindowId: null,
        correctedAt: now,
        correctedById: input.actorId,
        correctionReason: reason,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new TrainingQrError('出勤记录已被其他人更新，请刷新后重试', 409, 'TRAINING_ATTENDANCE_CONFLICT');
    }
    const row = await tx.trainingSessionAttendance.findUniqueOrThrow({ where: { id: current.id } });
    await syncTrainingParticipantAttendance(tx, current.participantId);
    await tx.trainingActivity.create({
      data: {
        planId: current.session.planId,
        action: 'correct_session_attendance',
        content: `修改 ${current.participant.employeeNameSnapshot} 的课次出勤：${current.status} → ${input.status}`,
        actorId: input.actorId,
        detail: {
          sessionId: current.sessionId,
          participantId: current.participantId,
          attendanceId: current.id,
          fromStatus: current.status,
          toStatus: input.status,
          reason,
        },
      },
    });
    return row;
  });
}

export async function trainingPlanAccountReadiness(planId: string) {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, deletedAt: null },
    select: {
      id: true,
      title: true,
      participants: {
        select: {
          id: true,
          employeeId: true,
          employeeNoSnapshot: true,
          employeeNameSnapshot: true,
          employee: {
            select: {
              isActive: true,
              user: { select: { id: true, isActive: true, accountStatus: true, employeeId: true } },
            },
          },
        },
        orderBy: { employeeNoSnapshot: 'asc' },
      },
    },
  });
  if (!plan) throw new TrainingQrError('培训计划不存在或已删除', 404, 'TRAINING_PLAN_NOT_FOUND');
  const participants = plan.participants.map(participant => {
    const account = participant.employee.user;
    const ready = participant.employee.isActive
      && Boolean(account)
      && account?.isActive === true
      && account.accountStatus === 'ACTIVE'
      && account.employeeId === participant.employeeId;
    let issue: string | null = null;
    if (!participant.employee.isActive) issue = '员工档案已停用';
    else if (!account) issue = '未关联个人账号';
    else if (!account.isActive || account.accountStatus !== 'ACTIVE') issue = '个人账号已停用或冻结';
    else if (account.employeeId !== participant.employeeId) issue = '账号员工关联不一致';
    return {
      participantId: participant.id,
      employeeId: participant.employeeId,
      employeeNo: participant.employeeNoSnapshot,
      employeeName: participant.employeeNameSnapshot,
      ready,
      issue,
    };
  });
  return {
    planId: plan.id,
    title: plan.title,
    participantCount: participants.length,
    readyCount: participants.filter(participant => participant.ready).length,
    blockedCount: participants.filter(participant => !participant.ready).length,
    participants,
  };
}

export async function trainingSessionLive(sessionId: string, now = new Date()) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      plan: {
        include: {
          participants: {
            include: {
              employee: {
                select: {
                  isActive: true,
                  user: { select: { isActive: true, accountStatus: true } },
                },
              },
              sessionAttendances: { where: { sessionId } },
              feedbacks: { where: { sessionId } },
            },
            orderBy: [
              { departmentSnapshot: 'asc' },
              { teamSnapshot: 'asc' },
              { employeeNoSnapshot: 'asc' },
            ],
          },
        },
      },
      qrWindows: { orderBy: [{ purpose: 'asc' }, { generation: 'desc' }] },
    },
  });
  if (!session || session.plan.deletedAt) {
    throw new TrainingQrError('培训课次不存在或已删除', 404, 'TRAINING_SESSION_NOT_FOUND');
  }
  const participants = session.plan.participants.map(participant => {
    const attendance = participant.sessionAttendances[0] || null;
    const feedback = participant.feedbacks[0] || null;
    return {
      id: participant.id,
      employeeId: participant.employeeId,
      employeeNo: participant.employeeNoSnapshot,
      employeeName: participant.employeeNameSnapshot,
      department: participant.departmentSnapshot,
      position: participant.positionSnapshot,
      team: participant.teamSnapshot,
      accountReady: participant.employee.isActive
        && participant.employee.user?.isActive === true
        && participant.employee.user.accountStatus === 'ACTIVE',
      attendance: attendance ? {
        id: attendance.id,
        status: attendance.status,
        checkInAt: attendance.checkInAt?.toISOString() || null,
        checkOutAt: attendance.checkOutAt?.toISOString() || null,
        source: attendance.source,
        correctionReason: attendance.correctionReason,
        version: attendance.version,
      } : null,
      feedback: feedbackPayload(feedback),
    };
  });
  const feedbacks = participants.map(participant => participant.feedback).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const feedbackEligibleCount = participants.filter(participant => (
    participant.attendance && ['PRESENT', 'LATE'].includes(participant.attendance.status)
  )).length;
  const average = (field: 'overallRating' | 'contentRating' | 'trainerRating' | 'practicalValueRating') => (
    feedbacks.length
      ? Math.round(feedbacks.reduce((sum, feedback) => sum + feedback[field], 0) / feedbacks.length * 10) / 10
      : null
  );
  return {
    serverTime: now.toISOString(),
    plan: { id: session.plan.id, code: session.plan.code, title: session.plan.title, status: session.plan.status },
    session: {
      id: session.id,
      name: session.name,
      sequence: session.sequence,
      startAt: session.startAt.toISOString(),
      endAt: session.endAt.toISOString(),
      location: session.location,
      status: session.status,
      actualStartAt: session.actualStartAt?.toISOString() || null,
      actualEndAt: session.actualEndAt?.toISOString() || null,
      checkInOpenMinutes: session.checkInOpenMinutes,
      lateAfterMinutes: session.lateAfterMinutes,
      checkInCloseMinutes: session.checkInCloseMinutes,
      feedbackDeadlineHours: session.feedbackDeadlineHours,
      feedbackRequired: session.feedbackRequired,
      version: session.version,
    },
    windows: session.qrWindows.map(window => serializeTrainingQrWindow(window, now)),
    participants,
    summary: {
      participantCount: participants.length,
      presentCount: participants.filter(participant => participant.attendance?.status === 'PRESENT').length,
      lateCount: participants.filter(participant => participant.attendance?.status === 'LATE').length,
      absentCount: participants.filter(participant => participant.attendance?.status === 'ABSENT').length,
      leaveCount: participants.filter(participant => participant.attendance?.status === 'LEAVE').length,
      invitedCount: participants.filter(participant => !participant.attendance || participant.attendance.status === 'INVITED').length,
      feedbackEligibleCount,
      feedbackCount: feedbacks.length,
      feedbackRate: feedbackEligibleCount ? Math.round(feedbacks.length / feedbackEligibleCount * 100) : 0,
      followUpCount: feedbacks.filter(feedback => feedback.followUpRequested).length,
      averageOverallRating: average('overallRating'),
      averageContentRating: average('contentRating'),
      averageTrainerRating: average('trainerRating'),
      averagePracticalValueRating: average('practicalValueRating'),
    },
  };
}
