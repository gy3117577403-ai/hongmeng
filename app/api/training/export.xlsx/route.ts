import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { reportDateRange } from '@/lib/report-date-range';
import { createTrainingWorkbook } from '@/lib/training-workbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const range = reportDateRange({
      period: req.nextUrl.searchParams.get('period'),
      date: req.nextUrl.searchParams.get('date'),
      startDate: req.nextUrl.searchParams.get('startDate'),
      endDate: req.nextUrl.searchParams.get('endDate'),
      fallbackPeriod: 'month',
    });
    const plans = await prisma.trainingPlan.findMany({
      where: { deletedAt: null, startAt: { lt: range.end }, endAt: { gte: range.start } },
      include: {
        course: true,
        participants: true,
        sessions: {
          include: { attendanceRecords: true, feedbacks: true },
          orderBy: { sequence: 'asc' },
        },
      },
      orderBy: [{ startAt: 'asc' }, { code: 'asc' }],
    });
    const rows = plans.flatMap(plan => plan.participants.map(participant => ({
      planCode: plan.code,
      planTitle: plan.title,
      courseName: plan.course?.name || '临时培训',
      startAt: plan.startAt,
      endAt: plan.endAt,
      employeeNo: participant.employeeNoSnapshot,
      employeeName: participant.employeeNameSnapshot,
      department: participant.departmentSnapshot,
      team: participant.teamSnapshot,
      position: participant.positionSnapshot,
      attendanceStatus: participant.attendanceStatus,
      actualMinutes: participant.actualMinutes,
      assessmentMode: plan.assessmentMode,
      theoryScore: participant.theoryScore,
      practicalScore: participant.practicalScore,
      score: participant.score,
      result: participant.result,
      reviewStatus: participant.reviewStatus,
      certificationId: participant.certificationId,
    })));
    const sessionRows = plans.flatMap(plan => {
      const participants = new Map(plan.participants.map(participant => [participant.id, participant]));
      return plan.sessions.flatMap(session => {
        const attendanceByParticipant = new Map(session.attendanceRecords.map(record => [record.participantId, record]));
        return [...participants.values()].map(participant => {
          const attendance = attendanceByParticipant.get(participant.id);
          return {
            planCode: plan.code,
            planTitle: plan.title,
            sessionSequence: session.sequence,
            sessionName: session.name,
            sessionStartAt: session.startAt,
            sessionEndAt: session.endAt,
            location: session.location,
            employeeNo: participant.employeeNoSnapshot,
            employeeName: participant.employeeNameSnapshot,
            department: participant.departmentSnapshot,
            team: participant.teamSnapshot,
            attendanceStatus: attendance?.status || 'NOT_INITIALIZED',
            checkInAt: attendance?.checkInAt || null,
            checkOutAt: attendance?.checkOutAt || null,
            source: attendance?.source || null,
            correctionReason: attendance?.correctionReason || null,
          };
        });
      });
    });
    const feedbackRows = plans.flatMap(plan => {
      const participants = new Map(plan.participants.map(participant => [participant.id, participant]));
      return plan.sessions.flatMap(session => session.feedbacks.flatMap(feedback => {
        const participant = participants.get(feedback.participantId);
        if (!participant) return [];
        return [{
          planCode: plan.code,
          planTitle: plan.title,
          sessionSequence: session.sequence,
          sessionName: session.name,
          employeeNo: participant.employeeNoSnapshot,
          employeeName: participant.employeeNameSnapshot,
          department: participant.departmentSnapshot,
          team: participant.teamSnapshot,
          overallRating: feedback.overallRating,
          contentRating: feedback.contentRating,
          trainerRating: feedback.trainerRating,
          practicalValueRating: feedback.practicalValueRating,
          issueTags: Array.isArray(feedback.issueTags)
            ? feedback.issueTags.filter((tag): tag is string => typeof tag === 'string')
            : [],
          comment: feedback.comment,
          followUpRequested: feedback.followUpRequested,
          submittedAt: feedback.submittedAt,
          updatedAt: feedback.updatedAt,
        }];
      }));
    });
    const feedbackSummaries = plans.flatMap(plan => plan.sessions.map(session => {
      const attended = session.attendanceRecords.filter(record => ['PRESENT', 'LATE'].includes(record.status));
      const average = (values: number[]) => values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10
        : null;
      return {
        planCode: plan.code,
        planTitle: plan.title,
        sessionSequence: session.sequence,
        sessionName: session.name,
        participantCount: plan.participants.length,
        attendedCount: attended.length,
        eligibleFeedbackCount: attended.length,
        feedbackCount: session.feedbacks.length,
        feedbackRate: attended.length ? Math.round(session.feedbacks.length / attended.length * 1_000) / 10 : 0,
        averageOverallRating: average(session.feedbacks.map(feedback => feedback.overallRating)),
        averageContentRating: average(session.feedbacks.map(feedback => feedback.contentRating)),
        averageTrainerRating: average(session.feedbacks.map(feedback => feedback.trainerRating)),
        averagePracticalValueRating: average(session.feedbacks.map(feedback => feedback.practicalValueRating)),
        followUpCount: session.feedbacks.filter(feedback => feedback.followUpRequested).length,
      };
    }));
    const startDate = dateKey(range.start);
    const endDate = dateKey(new Date(range.end.getTime() - 1));
    const buffer = await createTrainingWorkbook({
      startDate,
      endDate,
      generatedAt: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date()),
      rows,
      sessionRows,
      feedbackRows,
      feedbackSummaries,
    });
    await logOp({
      userId: user.id,
      action: 'export_training_workbook',
      targetType: 'training_plan',
      detail: {
        startDate,
        endDate,
        planCount: plans.length,
        participantRowCount: rows.length,
        sessionAttendanceRowCount: sessionRows.length,
        feedbackRowCount: feedbackRows.length,
        sheetCount: 4,
      },
    });
    const fileName = `员工培训发展记录表_${startDate}_${endDate}.xlsx`;
    const responseBody = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '培训台账导出失败';
    console.error('training workbook export failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
